import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { BotDatabase, StoredPinRecord } from '../db/database.js';

const PIN_PATTERN = /^\d{6}$/;
const DEFAULT_PIN = '123456';
const SESSION_TTL_MS = 12 * 3_600_000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

interface AttemptBucket {
  failedCount: number;
  lockedUntil: number;
}

interface SessionPayload {
  iat: number;
  exp: number;
  v: number;
}

export type VerifyPinResult =
  | { ok: true; token: string; expiresAt: number; isDefaultPin: boolean }
  | {
      ok: false;
      status: 401 | 429;
      error: string;
      remainingAttempts?: number;
      retryAfterSeconds?: number;
    };

export interface PinAuthOptions {
  envPin?: string;
  nowProvider?: () => number;
}

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString('hex');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function extractBearerToken(headerValue?: string | string[]): string | null {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return null;
  const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/i.exec(raw.trim());
  return match?.[1] ?? null;
}

export class PinAuthService {
  private readonly sessionSecret: Buffer;
  private readonly nowProvider: () => number;
  private readonly attemptMap = new Map<string, AttemptBucket>();

  constructor(
    private readonly db: BotDatabase,
    options: PinAuthOptions = {},
  ) {
    this.sessionSecret = randomBytes(32);
    this.nowProvider = options.nowProvider ?? (() => Date.now());
    this.initializePin(options.envPin);
  }

  private now(): number {
    return this.nowProvider();
  }

  private initializePin(rawEnvPin?: string): void {
    const envPin = rawEnvPin?.trim() ?? '';
    const existing = this.db.getPinRecord();

    if (PIN_PATTERN.test(envPin)) {
      const envDigest = sha256Hex(envPin);
      if (
        !existing ||
        existing.source !== 'custom' ||
        existing.envDigest !== envDigest
      ) {
        const salt = randomBytes(16).toString('hex');
        const record: StoredPinRecord = {
          salt,
          hash: hashPin(envPin, salt),
          source: 'env',
          envDigest,
          updatedAt: this.now(),
        };
        this.db.savePinRecord(record);
      }
      return;
    }

    if (!existing) {
      const salt = randomBytes(16).toString('hex');
      const record: StoredPinRecord = {
        salt,
        hash: hashPin(DEFAULT_PIN, salt),
        source: 'default',
        updatedAt: this.now(),
      };
      this.db.savePinRecord(record);
    }
  }

  private getRequiredRecord(): StoredPinRecord {
    const rec = this.db.getPinRecord();
    if (!rec) {
      this.initializePin('');
      return this.db.getPinRecord()!;
    }
    return rec;
  }

  isDefaultPin(): boolean {
    return this.getRequiredRecord().source === 'default';
  }

  private signSession(pinVersion: number): { token: string; expiresAt: number } {
    const iat = this.now();
    const exp = iat + SESSION_TTL_MS;
    const payload: SessionPayload = { iat, exp, v: pinVersion };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sigB64 = createHmac('sha256', this.sessionSecret)
      .update(payloadB64)
      .digest('base64url');
    return { token: `${payloadB64}.${sigB64}`, expiresAt: exp };
  }

  verifyToken(token: string | null | undefined): boolean {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payloadB64, sigB64] = parts;
    if (!payloadB64 || !sigB64) return false;

    const expectedSig = createHmac('sha256', this.sessionSecret)
      .update(payloadB64)
      .digest();
    let actualSig: Buffer;
    try {
      actualSig = Buffer.from(sigB64, 'base64url');
    } catch {
      return false;
    }
    if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
      return false;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as Partial<SessionPayload>;
      if (
        typeof payload.exp !== 'number' ||
        typeof payload.v !== 'number' ||
        this.now() >= payload.exp
      ) {
        return false;
      }
      return payload.v === this.getRequiredRecord().updatedAt;
    } catch {
      return false;
    }
  }

  verifyPin(pin: string, clientIp = 'unknown'): VerifyPinResult {
    const now = this.now();
    const key = clientIp || 'unknown';
    const bucket = this.attemptMap.get(key);

    if (bucket && bucket.lockedUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000));
      return {
        ok: false,
        status: 429,
        error: `Terlalu banyak percobaan salah. Coba lagi dalam ${retryAfterSeconds} detik.`,
        retryAfterSeconds,
      };
    }

    const cleanPin = String(pin ?? '').trim();
    const record = this.getRequiredRecord();
    const matches =
      PIN_PATTERN.test(cleanPin) && safeEqualHex(hashPin(cleanPin, record.salt), record.hash);

    if (!matches) {
      const failedCount = (bucket && bucket.lockedUntil <= now ? bucket.failedCount : 0) + 1;
      if (failedCount >= MAX_FAILED_ATTEMPTS) {
        const lockedUntil = now + LOCKOUT_MS;
        this.attemptMap.set(key, { failedCount: 0, lockedUntil });
        const retryAfterSeconds = Math.ceil(LOCKOUT_MS / 1000);
        return {
          ok: false,
          status: 429,
          error: `Terlalu banyak percobaan salah. Coba lagi dalam ${retryAfterSeconds} detik.`,
          retryAfterSeconds,
        };
      }
      this.attemptMap.set(key, { failedCount, lockedUntil: 0 });
      const remainingAttempts = MAX_FAILED_ATTEMPTS - failedCount;
      return {
        ok: false,
        status: 401,
        error: `PIN salah. Sisa ${remainingAttempts} percobaan.`,
        remainingAttempts,
      };
    }

    this.attemptMap.delete(key);
    const { token, expiresAt } = this.signSession(record.updatedAt);
    return {
      ok: true,
      token,
      expiresAt,
      isDefaultPin: record.source === 'default',
    };
  }

  changePin(currentPin: string, newPin: string): { token: string; expiresAt: number } {
    const cleanCurrent = String(currentPin ?? '').trim();
    const cleanNext = String(newPin ?? '').trim();

    if (!PIN_PATTERN.test(cleanNext)) {
      throw new Error('PIN baru harus tepat 6 digit angka (0-9).');
    }

    const record = this.getRequiredRecord();
    const currentValid =
      PIN_PATTERN.test(cleanCurrent) &&
      safeEqualHex(hashPin(cleanCurrent, record.salt), record.hash);
    if (!currentValid) {
      throw new Error('PIN saat ini salah.');
    }

    const salt = randomBytes(16).toString('hex');
    const updatedAt = Math.max(this.now(), record.updatedAt + 1);
    const nextRecord: StoredPinRecord = {
      salt,
      hash: hashPin(cleanNext, salt),
      source: 'custom',
      envDigest: record.envDigest,
      updatedAt,
    };
    this.db.savePinRecord(nextRecord);
    return this.signSession(updatedAt);
  }
}

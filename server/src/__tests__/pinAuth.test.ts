import { describe, expect, it } from 'vitest';
import { BotDatabase } from '../db/database.js';
import { PinAuthService } from '../auth/pinAuth.js';

describe('PinAuthService (scrypt hashing, HMAC sessions, brute-force lockout)', () => {
  it('initializes with default 6-digit PIN 123456 when env PIN is unset and flags isDefaultPin', () => {
    const db = new BotDatabase(':memory:');
    const auth = new PinAuthService(db, { envPin: '' });

    expect(auth.isDefaultPin()).toBe(true);
    const bad = auth.verifyPin('000000', '127.0.0.1');
    expect(bad.ok).toBe(false);

    const ok = auth.verifyPin('123456', '127.0.0.1');
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error('Expected valid unlock');
    expect(auth.verifyToken(ok.token)).toBe(true);
    expect(auth.verifyToken('invalid.token')).toBe(false);
    db.close();
  });

  it('uses DASHBOARD_PIN from env when provided and marks isDefaultPin false', () => {
    const db = new BotDatabase(':memory:');
    const auth = new PinAuthService(db, { envPin: '849201' });

    expect(auth.isDefaultPin()).toBe(false);
    expect(auth.verifyPin('123456', '10.0.0.1').ok).toBe(false);
    const res = auth.verifyPin('849201', '10.0.0.1');
    expect(res.ok).toBe(true);
    db.close();
  });

  it('locks out client IP after 5 consecutive wrong PIN attempts and resets after lockout window', () => {
    const db = new BotDatabase(':memory:');
    let now = 1_000_000;
    const auth = new PinAuthService(db, { envPin: '554433', nowProvider: () => now });

    for (let i = 0; i < 4; i++) {
      const r = auth.verifyPin('111111', '1.2.3.4');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(401);
    }

    const fifth = auth.verifyPin('111111', '1.2.3.4');
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) {
      expect(fifth.status).toBe(429);
      expect(fifth.retryAfterSeconds).toBeGreaterThan(0);
    }

    // Even valid PIN is blocked during cooldown
    const blocked = auth.verifyPin('554433', '1.2.3.4');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(429);

    // After 61s lockout expires, valid PIN succeeds
    now += 61_000;
    const unblocked = auth.verifyPin('554433', '1.2.3.4');
    expect(unblocked.ok).toBe(true);
    db.close();
  });

  it('changes PIN securely and invalidates previously issued session tokens', () => {
    const db = new BotDatabase(':memory:');
    let now = 2_000_000;
    const auth = new PinAuthService(db, { envPin: '', nowProvider: () => now });

    const login1 = auth.verifyPin('123456', '127.0.0.1');
    if (!login1.ok) throw new Error('Expected login1 success');
    expect(auth.verifyToken(login1.token)).toBe(true);

    now += 1000;
    expect(() => auth.changePin('999999', '778899')).toThrow(/salah|invalid/i);
    expect(() => auth.changePin('123456', '12ab')).toThrow(/6/i);

    const changed = auth.changePin('123456', '778899');
    expect(auth.isDefaultPin()).toBe(false);
    // Previous token issued before PIN rotation must immediately fail verification
    expect(auth.verifyToken(login1.token)).toBe(false);
    // Newly returned token must be valid
    expect(auth.verifyToken(changed.token)).toBe(true);
    expect(auth.verifyPin('123456', '127.0.0.1').ok).toBe(false);
    expect(auth.verifyPin('778899', '127.0.0.1').ok).toBe(true);
    db.close();
  });
});

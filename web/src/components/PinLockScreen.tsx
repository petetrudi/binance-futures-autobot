import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete, Lock, LockOpen, RotateCcw, ShieldCheck } from 'lucide-react';
import type { AuthVerifyResponse } from '@bot/shared';
import { api } from '../lib/api.js';

interface PinLockScreenProps {
  pinLength?: number;
  onUnlocked: (session: AuthVerifyResponse) => void;
}

interface KeyRipple {
  id: number;
  key: string;
}

interface FlyingDigit {
  id: number;
  digit: string;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
}

type LockPhase = 'idle' | 'verifying' | 'error' | 'assembling' | 'exiting';

const KEYPAD_KEYS: Array<{ value: string; sub?: string }> = [
  { value: '1', sub: '•' },
  { value: '2', sub: 'ABC' },
  { value: '3', sub: 'DEF' },
  { value: '4', sub: 'GHI' },
  { value: '5', sub: 'JKL' },
  { value: '6', sub: 'MNO' },
  { value: '7', sub: 'PQRS' },
  { value: '8', sub: 'TUV' },
  { value: '9', sub: 'WXYZ' },
  { value: 'clear' },
  { value: '0', sub: 'LOCK' },
  { value: 'back' },
];

// Converges the 6 elevated glass nodes inward toward the center rail
const ASSEMBLE_OFFSETS_PX = [20, 12, 4, -4, -12, -20];

export function PinLockScreen({
  pinLength = 6,
  onUnlocked,
}: PinLockScreenProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const [phase, setPhase] = useState<LockPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lockoutSec, setLockoutSec] = useState<number>(0);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [recentSlotIndex, setRecentSlotIndex] = useState<number | null>(null);
  const [ripples, setRipples] = useState<KeyRipple[]>([]);
  const [flights, setFlights] = useState<FlyingDigit[]>([]);

  const keyRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const idCounter = useRef(0);
  const timersRef = useRef<number[]>([]);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  }, []);

  useEffect(() => {
    return () => {
      for (const t of timersRef.current) window.clearTimeout(t);
    };
  }, []);

  // Countdown timer when rate-limited
  useEffect(() => {
    if (lockoutSec <= 0) return;
    const t = window.setInterval(() => {
      setLockoutSec((prev) => {
        if (prev <= 1) {
          setErrorMessage(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [lockoutSec]);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const triggerKeyFeedback = useCallback(
    (key: string, digitForFlight?: string, targetSlotIdx?: number) => {
      setPressedKey(key);
      schedule(() => {
        setPressedKey((cur) => (cur === key ? null : cur));
      }, 170);

      const rid = ++idCounter.current;
      setRipples((prev) => [...prev, { id: rid, key }]);
      schedule(() => {
        setRipples((prev) => prev.filter((r) => r.id !== rid));
      }, 480);

      if (
        digitForFlight &&
        targetSlotIdx !== undefined &&
        !prefersReducedMotion()
      ) {
        const keyEl = keyRefs.current[key];
        const slotEl = slotRefs.current[targetSlotIdx];
        if (keyEl && slotEl) {
          const kr = keyEl.getBoundingClientRect();
          const sr = slotEl.getBoundingClientRect();
          const fid = ++idCounter.current;
          setFlights((prev) => [
            ...prev,
            {
              id: fid,
              digit: digitForFlight,
              startX: kr.left + kr.width / 2,
              startY: kr.top + kr.height / 2,
              deltaX: sr.left + sr.width / 2 - (kr.left + kr.width / 2),
              deltaY: sr.top + sr.height / 2 - (kr.top + kr.height / 2),
            },
          ]);
          schedule(() => {
            setFlights((prev) => prev.filter((f) => f.id !== fid));
          }, 360);
        }
      }
    },
    [schedule],
  );

  const verifyEnteredPin = useCallback(
    async (fullPin: string) => {
      setPhase('verifying');
      setErrorMessage(null);
      const startedAt = Date.now();

      try {
        const session = await api.verifyPin(fullPin);
        const elapsed = Date.now() - startedAt;
        const minScanDelay = prefersReducedMotion() ? 0 : Math.max(0, 140 - elapsed);

        schedule(() => {
          if (prefersReducedMotion()) {
            setPhase('exiting');
            schedule(() => onUnlocked(session), 140);
            return;
          }

          // Phase 1 & 2: digits lift upward & converge into one locked-in crystal chain
          setPhase('assembling');
          schedule(() => {
            // Phase 3: vault smoothly dissolves into live terminal
            setPhase('exiting');
            schedule(() => onUnlocked(session), 340);
          }, 960);
        }, minScanDelay);
      } catch (err) {
        const apiErr = err as Error & { retryAfterSeconds?: number };
        setPhase('error');
        setErrorMessage(apiErr.message || 'PIN salah. Silakan coba lagi.');
        if (apiErr.retryAfterSeconds && apiErr.retryAfterSeconds > 0) {
          setLockoutSec(apiErr.retryAfterSeconds);
        }
        schedule(() => {
          setDigits([]);
          setRecentSlotIndex(null);
          setPhase('idle');
        }, 520);
      }
    },
    [onUnlocked, schedule],
  );

  const handleDigitPress = useCallback(
    (digit: string) => {
      if (phase !== 'idle' || lockoutSec > 0) return;
      if (digits.length >= pinLength) return;

      const nextIndex = digits.length;
      const nextDigits = [...digits, digit];
      setErrorMessage(null);
      setDigits(nextDigits);
      setRecentSlotIndex(nextIndex);
      triggerKeyFeedback(digit, digit, nextIndex);

      schedule(() => {
        setRecentSlotIndex((cur) => (cur === nextIndex ? null : cur));
      }, 240);

      if (nextDigits.length === pinLength) {
        void verifyEnteredPin(nextDigits.join(''));
      }
    },
    [digits, lockoutSec, phase, pinLength, schedule, triggerKeyFeedback, verifyEnteredPin],
  );

  const handleBackspace = useCallback(() => {
    if (phase !== 'idle' || lockoutSec > 0 || digits.length === 0) return;
    triggerKeyFeedback('back');
    setDigits((prev) => prev.slice(0, -1));
    setRecentSlotIndex(null);
    setErrorMessage(null);
  }, [digits.length, lockoutSec, phase, triggerKeyFeedback]);

  const handleClear = useCallback(() => {
    if (phase !== 'idle' || lockoutSec > 0 || digits.length === 0) return;
    triggerKeyFeedback('clear');
    setDigits([]);
    setRecentSlotIndex(null);
    setErrorMessage(null);
  }, [digits.length, lockoutSec, phase, triggerKeyFeedback]);

  // Keyboard support (0-9, Backspace, Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigitPress(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleBackspace, handleClear, handleDigitPress]);

  const isSuccessSequence = phase === 'assembling' || phase === 'exiting';
  const inputsDisabled = phase !== 'idle' || lockoutSec > 0;

  return (
    <main
      className={`pin-vault-backdrop relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4 py-8 text-slate-100 select-none ${
        phase === 'exiting' ? 'pin-vault-exit' : ''
      }`}
    >
      {/* Ambient liquid-glass refraction orbs */}
      <div
        aria-hidden="true"
        className="pin-orb-drift-a pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pin-orb-drift-b pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-3xl"
      />
      <div aria-hidden="true" className="pin-vault-grid pointer-events-none absolute inset-0" />

      {/* Floating glass digit particles flying from pressed keys up into slots */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
        {flights.map((f) => (
          <span
            key={f.id}
            style={
              {
                left: `${f.startX}px`,
                top: `${f.startY}px`,
                '--flight-x': `${f.deltaX}px`,
                '--flight-y': `${f.deltaY}px`,
              } as React.CSSProperties
            }
            className="pin-flight-digit font-mono-num fixed -ml-4 -mt-4 flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-300/70 bg-cyan-400/25 text-base font-bold text-white shadow-[0_0_22px_rgba(34,211,238,0.65)] backdrop-blur-md"
          >
            {f.digit}
          </span>
        ))}
      </div>

      {/* Main Frosted Glass Vault Card */}
      <section
        aria-labelledby="pin-vault-title"
        className="pin-glass-card relative z-10 w-full max-w-[392px] overflow-hidden rounded-[28px] p-6 sm:p-7"
      >
        {/* Specular unlock sheen sweep */}
        {isSuccessSequence && (
          <div
            aria-hidden="true"
            className="pin-sheen-sweep pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent"
          />
        )}

        {/* Top Emblem + Title */}
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-3.5 flex h-14 w-14 items-center justify-center">
            {isSuccessSequence && (
              <span
                aria-hidden="true"
                className="pin-unlock-halo pointer-events-none absolute inset-0 rounded-2xl border-2 border-emerald-400/80"
              />
            )}
            <div
              className={`relative flex h-14 w-14 items-center justify-center rounded-2xl border backdrop-blur-md transition-colors duration-300 ${
                isSuccessSequence
                  ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-300 shadow-[0_0_30px_rgba(16,185,129,0.45)]'
                  : phase === 'error'
                    ? 'border-rose-400/60 bg-rose-500/20 text-rose-300 shadow-[0_0_24px_rgba(244,63,94,0.38)]'
                    : 'border-white/20 bg-white/[0.08] text-cyan-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
              }`}
            >
              {isSuccessSequence ? (
                <LockOpen aria-hidden="true" className="h-6 w-6" />
              ) : (
                <Lock aria-hidden="true" className="h-6 w-6" />
              )}
            </div>
          </div>

          <h1
            id="pin-vault-title"
            className="text-base font-bold tracking-[0.16em] text-white"
          >
            APEX-QUANT VAULT
          </h1>
          <p className="mt-1 text-xs text-slate-300/80">
            {isSuccessSequence
              ? 'PIN terverifikasi — merangkai kunci akses...'
              : phase === 'verifying'
                ? 'Memverifikasi kode akses...'
                : 'Masukkan 6-Digit PIN untuk mengakses terminal'}
          </p>
        </div>

        {/* 6-Digit Glass Display Slots (Rise & Interlock on Completion) */}
        <div className="relative mt-9 mb-4 flex items-center justify-center">
          {/* Luminous energy filament that ignites while elevated digits interlock */}
          {isSuccessSequence && (
            <div
              aria-hidden="true"
              className="pin-link-beam pointer-events-none absolute top-1/2 left-6 right-6 h-[2px] -translate-y-[28px] origin-center rounded-full bg-gradient-to-r from-cyan-400 via-emerald-300 to-cyan-400 opacity-0 shadow-[0_0_16px_rgba(52,211,153,0.95)]"
            />
          )}

          <div
            role="group"
            aria-label={`Input PIN ${digits.length} dari ${pinLength} digit`}
            className={`relative flex items-center justify-center gap-2.5 ${
              phase === 'error' ? 'pin-row-shake' : ''
            }`}
          >
            {Array.from({ length: pinLength }, (_, idx) => {
              const value = digits[idx];
              const filled = value !== undefined;
              const isJustEntered = recentSlotIndex === idx;
              const assembleX = ASSEMBLE_OFFSETS_PX[idx] ?? 0;

              return (
                <div
                  key={idx}
                  ref={(el) => {
                    slotRefs.current[idx] = el;
                  }}
                  data-filled={filled ? 'true' : 'false'}
                  data-state={phase}
                  style={
                    {
                      '--assemble-x': `${assembleX}px`,
                      animationDelay:
                        phase === 'verifying'
                          ? `${idx * 70}ms`
                          : isSuccessSequence
                            ? `${idx * 55}ms`
                            : undefined,
                    } as React.CSSProperties
                  }
                  className={`pin-slot-glass relative flex h-12 w-11 items-center justify-center rounded-2xl transition-colors duration-200 ${
                    isJustEntered ? 'pin-slot-pop' : ''
                  } ${phase === 'verifying' ? 'pin-slot-verifying' : ''} ${
                    isSuccessSequence ? 'pin-slot-assemble' : ''
                  }`}
                >
                  {filled ? (
                    isSuccessSequence ? (
                      <span className="font-mono-num text-lg font-bold text-emerald-100 drop-shadow-[0_0_10px_rgba(16,185,129,0.9)]">
                        {value}
                      </span>
                    ) : isJustEntered ? (
                      <span className="font-mono-num text-lg font-bold text-cyan-200 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
                        {value}
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className={`h-3 w-3 rounded-full shadow-md transition-transform duration-200 ${
                          phase === 'error'
                            ? 'bg-rose-400 shadow-rose-500/70'
                            : 'bg-cyan-300 shadow-cyan-400/80'
                        }`}
                      />
                    )
                  ) : (
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-white/20"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Status / Error Feedback Live Region */}
        <div className="mb-4 flex min-h-[24px] items-center justify-center text-center">
          {errorMessage ? (
            <p
              role="alert"
              className="rounded-full border border-rose-500/35 bg-rose-500/10 px-3 py-0.5 text-[11px] font-medium text-rose-300"
            >
              {lockoutSec > 0
                ? `Terkunci sementara · Coba lagi dalam ${lockoutSec} detik`
                : errorMessage}
            </p>
          ) : isSuccessSequence ? (
            <p
              aria-live="polite"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-0.5 text-[11px] font-semibold tracking-wide text-emerald-300"
            >
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              AKSES DITERIMA
            </p>
          ) : (
            <p className="text-[11px] text-slate-400/80">
              Klik keypad kaca atau ketik angka 0–9 di keyboard
            </p>
          )}
        </div>

        {/* 12-Key Liquid Glass Keypad */}
        <div className="grid grid-cols-3 gap-2.5">
          {KEYPAD_KEYS.map((item) => {
            const isAction = item.value === 'clear' || item.value === 'back';
            const isPressed = pressedKey === item.value;
            const keyRipples = ripples.filter((r) => r.key === item.value);

            const ariaLabel =
              item.value === 'clear'
                ? 'Reset semua digit PIN'
                : item.value === 'back'
                  ? 'Hapus satu digit terakhir'
                  : `Angka ${item.value}`;

            const onClick =
              item.value === 'clear'
                ? handleClear
                : item.value === 'back'
                  ? handleBackspace
                  : () => handleDigitPress(item.value);

            return (
              <button
                key={item.value}
                ref={(el) => {
                  keyRefs.current[item.value] = el;
                }}
                type="button"
                aria-label={ariaLabel}
                data-pressed={isPressed ? 'true' : 'false'}
                disabled={inputsDisabled || (isAction && digits.length === 0)}
                onClick={onClick}
                className={`pin-glass-key flex min-h-[60px] flex-col items-center justify-center rounded-2xl text-slate-100 disabled:cursor-not-allowed disabled:opacity-40 ${
                  isAction ? 'text-slate-300' : ''
                }`}
              >
                {/* Glass press ripple ring */}
                {keyRipples.map((r) => (
                  <span
                    key={r.id}
                    aria-hidden="true"
                    className="pin-key-ripple pointer-events-none absolute h-12 w-12 rounded-full bg-cyan-300/35"
                  />
                ))}

                {item.value === 'clear' ? (
                  <>
                    <RotateCcw aria-hidden="true" className="h-4 w-4 text-slate-300" />
                    <span className="mt-1 text-[10px] font-semibold tracking-wider text-slate-400">
                      RESET
                    </span>
                  </>
                ) : item.value === 'back' ? (
                  <>
                    <Delete aria-hidden="true" className="h-4 w-4 text-slate-300" />
                    <span className="mt-1 text-[10px] font-semibold tracking-wider text-slate-400">
                      HAPUS
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono-num relative z-10 text-2xl font-semibold leading-none text-white">
                      {item.value}
                    </span>
                    {item.sub && (
                      <span className="relative z-10 mt-1 text-[9px] font-medium tracking-[0.2em] text-slate-400/80">
                        {item.sub}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer security notice */}
        <div className="mt-5 flex items-center justify-center gap-2 border-t border-white/10 pt-3.5 text-[10px] tracking-wide text-slate-400/75">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
          <span>Protected Session · Selalu meminta PIN saat akses baru</span>
        </div>
      </section>
    </main>
  );
}

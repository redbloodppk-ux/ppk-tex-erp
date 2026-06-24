'use client';
/**
 * AppLock — local "quick-unlock" gate over an already-logged-in Supabase session.
 *
 * Once the owner has logged in fully on a device, they can set a 4-digit PIN
 * (and optionally Face ID on iPhone / fingerprint on Android). After that the
 * app re-opens behind a PIN pad on each fresh load or after 5 min of inactivity
 * — no full email login needed. 5 wrong PINs forces a real sign-out.
 *
 * Setup is triggered from the Topbar user menu via the `ppk:lock-setup` event.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  Lock, Fingerprint, ScanFace, Delete, ShieldCheck, X, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  isLockConfigured, setPin as savePin, verifyPin, clearLock,
  recordFail, resetFails, markUnlocked, touchActivity, shouldLock,
  hasBiometric, clearBiometricCredId, MAX_FAILS,
} from '@/lib/app-lock/store';
import { isBiometricAvailable, registerBiometric, verifyBiometric } from '@/lib/app-lock/biometric';

type SetupStep = 'menu' | 'pin' | 'confirm' | 'biometric' | 'done';

export function AppLock({ userLabel }: { userLabel: string }) {
  const [locked, setLocked] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  // lock-screen entry state
  const [entry, setEntry] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  // setup modal state
  const [setupOpen, setSetupOpen] = useState(false);
  const [step, setStep] = useState<SetupStep>('menu');
  const [firstPin, setFirstPin] = useState('');
  const [setupEntry, setSetupEntry] = useState('');
  const [setupErr, setSetupErr] = useState('');

  const autoTried = useRef(false);

  const refresh = useCallback(() => {
    const cfg = isLockConfigured();
    setConfigured(cfg);
    setBioOn(hasBiometric());
    setLocked(shouldLock());
  }, []);

  // initial wiring
  useEffect(() => {
    refresh();
    isBiometricAvailable().then(setBioAvailable);
  }, [refresh]);

  // Re-evaluate the lock when the tab regains focus / becomes visible, and
  // keep the activity timer fresh while the user is interacting.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setLocked(shouldLock()); };
    const onActivity = () => touchActivity();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    const iv = window.setInterval(() => { if (shouldLock()) setLocked(true); }, 30_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.clearInterval(iv);
    };
  }, []);

  // Setup trigger from the Topbar menu.
  useEffect(() => {
    const open = () => { setStep('menu'); setFirstPin(''); setSetupEntry(''); setSetupErr(''); setSetupOpen(true); };
    window.addEventListener('ppk:lock-setup', open);
    return () => window.removeEventListener('ppk:lock-setup', open);
  }, []);

  // Lock body scroll while the lock screen or setup modal is up.
  useEffect(() => {
    if (locked || setupOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [locked, setupOpen]);

  const doUnlock = useCallback(() => {
    markUnlocked();
    setEntry('');
    setError('');
    setLocked(false);
  }, []);

  async function forceSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearLock();
    window.location.href = '/login';
  }

  const tryBiometric = useCallback(async () => {
    const ok = await verifyBiometric();
    if (ok) doUnlock();
  }, [doUnlock]);

  // Auto-prompt biometric once when the lock screen appears.
  useEffect(() => {
    if (locked && bioOn && bioAvailable && !autoTried.current) {
      autoTried.current = true;
      tryBiometric();
    }
    if (!locked) autoTried.current = false;
  }, [locked, bioOn, bioAvailable, tryBiometric]);

  // ── PIN entry on the lock screen ──────────────────────────────────────
  async function pushDigit(d: string) {
    if (entry.length >= 4) return;
    const next = entry + d;
    setEntry(next);
    setError('');
    if (next.length === 4) {
      const ok = await verifyPin(next);
      if (ok) {
        resetFails();
        doUnlock();
      } else {
        const fails = recordFail();
        if (fails >= MAX_FAILS) {
          await forceSignOut();
          return;
        }
        setError(`Wrong PIN — ${MAX_FAILS - fails} ${MAX_FAILS - fails === 1 ? 'try' : 'tries'} left`);
        setShake(true);
        setTimeout(() => { setShake(false); setEntry(''); }, 400);
      }
    }
  }

  function backspace() {
    setEntry(e => e.slice(0, -1));
    setError('');
  }

  // ── Setup PIN entry ───────────────────────────────────────────────────
  async function pushSetupDigit(d: string) {
    if (setupEntry.length >= 4) return;
    const next = setupEntry + d;
    setSetupEntry(next);
    setSetupErr('');
    if (next.length === 4) {
      if (step === 'pin') {
        setFirstPin(next);
        setSetupEntry('');
        setStep('confirm');
      } else if (step === 'confirm') {
        if (next === firstPin) {
          await savePin(next);
          setConfigured(true);
          setSetupEntry('');
          if (bioAvailable) setStep('biometric');
          else setStep('done');
        } else {
          setSetupErr('PINs did not match — start again');
          setFirstPin('');
          setSetupEntry('');
          setStep('pin');
        }
      }
    }
  }

  async function enableBiometric() {
    const ok = await registerBiometric(userLabel || 'PPK TEX');
    if (ok) { setBioOn(true); setStep('done'); }
    else setSetupErr('Could not enable biometric on this device');
  }

  function disableLock() {
    clearLock();
    setConfigured(false);
    setBioOn(false);
    setSetupOpen(false);
    setLocked(false);
  }

  // ── Renders ───────────────────────────────────────────────────────────
  const showBioOnLock = bioOn && bioAvailable;

  return (
    <>
      {locked && (
        <LockScreen
          entry={entry}
          error={error}
          shake={shake}
          showBio={showBioOnLock}
          onDigit={pushDigit}
          onBackspace={backspace}
          onBiometric={tryBiometric}
        />
      )}

      {setupOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-paper rounded-2xl border border-line shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line/60">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo" />
                <span className="font-semibold text-ink">Quick Unlock</span>
              </div>
              <button onClick={() => setSetupOpen(false)} className="p-1.5 rounded-lg hover:bg-cloud" aria-label="Close">
                <X className="w-4 h-4 text-ink-soft" />
              </button>
            </div>

            <div className="p-5">
              {step === 'menu' && !configured && (
                <div className="space-y-4">
                  <p className="text-sm text-ink-soft">
                    Set a 4-digit PIN to re-open the app on this device without typing your email each time.
                  </p>
                  <button
                    onClick={() => { setStep('pin'); setSetupEntry(''); setFirstPin(''); setSetupErr(''); }}
                    className="w-full py-2.5 rounded-xl bg-indigo text-white font-semibold text-sm hover:opacity-90"
                  >
                    Create a 4-digit PIN
                  </button>
                </div>
              )}

              {step === 'menu' && configured && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-emerald-700">
                    <Check className="w-4 h-4" /> Quick Unlock is on for this device.
                  </div>
                  <button
                    onClick={() => { setStep('pin'); setSetupEntry(''); setFirstPin(''); setSetupErr(''); }}
                    className="w-full py-2.5 rounded-xl border border-line text-ink font-medium text-sm hover:bg-cloud"
                  >
                    Change PIN
                  </button>
                  {bioAvailable && !bioOn && (
                    <button
                      onClick={enableBiometric}
                      className="w-full py-2.5 rounded-xl border border-line text-ink font-medium text-sm hover:bg-cloud flex items-center justify-center gap-2"
                    >
                      <ScanFace className="w-4 h-4" /> Enable Face ID / Fingerprint
                    </button>
                  )}
                  {bioOn && (
                    <button
                      onClick={() => { clearBiometricCredId(); setBioOn(false); }}
                      className="w-full py-2.5 rounded-xl border border-line text-ink-soft font-medium text-sm hover:bg-cloud"
                    >
                      Turn off Face ID / Fingerprint
                    </button>
                  )}
                  <button
                    onClick={disableLock}
                    className="w-full py-2.5 rounded-xl text-rose-600 font-medium text-sm hover:bg-rose-50"
                  >
                    Disable Quick Unlock
                  </button>
                </div>
              )}

              {(step === 'pin' || step === 'confirm') && (
                <div className="space-y-4">
                  <p className="text-center text-sm font-medium text-ink">
                    {step === 'pin' ? 'Enter a new 4-digit PIN' : 'Re-enter to confirm'}
                  </p>
                  <Dots count={setupEntry.length} />
                  {setupErr && <p className="text-center text-xs text-rose-600">{setupErr}</p>}
                  <Keypad onDigit={pushSetupDigit} onBackspace={() => setSetupEntry(e => e.slice(0, -1))} />
                </div>
              )}

              {step === 'biometric' && (
                <div className="space-y-4 text-center">
                  <ScanFace className="w-12 h-12 text-indigo mx-auto" />
                  <p className="text-sm text-ink-soft">
                    Add Face ID / fingerprint for one-tap unlock on this device?
                  </p>
                  {setupErr && <p className="text-xs text-rose-600">{setupErr}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setStep('done')} className="flex-1 py-2.5 rounded-xl border border-line text-ink-soft text-sm font-medium hover:bg-cloud">
                      Skip
                    </button>
                    <button onClick={enableBiometric} className="flex-1 py-2.5 rounded-xl bg-indigo text-white text-sm font-semibold hover:opacity-90">
                      Enable
                    </button>
                  </div>
                </div>
              )}

              {step === 'done' && (
                <div className="space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6 text-emerald-600" />
                  </div>
                  <p className="text-sm text-ink">Quick Unlock is ready on this device.</p>
                  <button onClick={() => setSetupOpen(false)} className="w-full py-2.5 rounded-xl bg-indigo text-white text-sm font-semibold hover:opacity-90">
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Dots({ count }: { count: number }) {
  return (
    <div className="flex justify-center gap-3">
      {[0, 1, 2, 3].map(i => (
        <span
          key={i}
          className={cn(
            'w-3.5 h-3.5 rounded-full border-2 transition-colors',
            i < count ? 'bg-indigo border-indigo' : 'border-ink-mute/40',
          )}
        />
      ))}
    </div>
  );
}

function Keypad({ onDigit, onBackspace }: { onDigit: (d: string) => void; onBackspace: () => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="grid grid-cols-3 gap-2.5 max-w-[15rem] mx-auto">
      {keys.map(k => (
        <button
          key={k}
          onClick={() => onDigit(k)}
          className="h-14 rounded-xl bg-cloud text-ink text-xl font-semibold hover:bg-indigo/10 active:scale-95 transition"
        >
          {k}
        </button>
      ))}
      <span />
      <button
        onClick={() => onDigit('0')}
        className="h-14 rounded-xl bg-cloud text-ink text-xl font-semibold hover:bg-indigo/10 active:scale-95 transition"
      >
        0
      </button>
      <button
        onClick={onBackspace}
        className="h-14 rounded-xl flex items-center justify-center text-ink-soft hover:bg-cloud active:scale-95 transition"
        aria-label="Backspace"
      >
        <Delete className="w-6 h-6" />
      </button>
    </div>
  );
}

function LockScreen({
  entry, error, shake, showBio, onDigit, onBackspace, onBiometric,
}: {
  entry: string;
  error: string;
  shake: boolean;
  showBio: boolean;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onBiometric: () => void;
}) {
  // Hardware keyboard support (desktop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') onDigit(e.key);
      else if (e.key === 'Backspace') onBackspace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDigit, onBackspace]);

  return (
    <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-gradient-to-b from-indigo to-violet text-white p-6">
      <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center mb-5">
        <Lock className="w-6 h-6" />
      </div>
      <div className="font-display font-extrabold text-xl tracking-wider mb-1">PPK TEX</div>
      <p className="text-white/70 text-sm mb-7">Enter your PIN to unlock</p>

      <div className={cn('mb-3', shake && 'animate-[shake_0.4s]')}>
        <div className="flex justify-center gap-3">
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              className={cn(
                'w-3.5 h-3.5 rounded-full border-2 transition-colors',
                i < entry.length ? 'bg-white border-white' : 'border-white/50',
              )}
            />
          ))}
        </div>
      </div>
      <p className="h-5 text-sm text-rose-200 mb-4">{error}</p>

      <div className="grid grid-cols-3 gap-3 max-w-[16rem]">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => (
          <button
            key={k}
            onClick={() => onDigit(k)}
            className="h-16 w-16 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 text-2xl font-semibold transition"
          >
            {k}
          </button>
        ))}
        {showBio ? (
          <button
            onClick={onBiometric}
            className="h-16 w-16 rounded-full flex items-center justify-center hover:bg-white/15 active:scale-95 transition"
            aria-label="Unlock with biometric"
          >
            <Fingerprint className="w-7 h-7" />
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={() => onDigit('0')}
          className="h-16 w-16 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 text-2xl font-semibold transition"
        >
          0
        </button>
        <button
          onClick={onBackspace}
          className="h-16 w-16 rounded-full flex items-center justify-center hover:bg-white/15 active:scale-95 transition"
          aria-label="Backspace"
        >
          <Delete className="w-7 h-7" />
        </button>
      </div>

      {showBio && (
        <button
          onClick={onBiometric}
          className="mt-7 flex items-center gap-2 text-sm text-white/80 hover:text-white"
        >
          <ScanFace className="w-4 h-4" /> Unlock with Face ID / Fingerprint
        </button>
      )}
    </div>
  );
}

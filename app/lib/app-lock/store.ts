/**
 * app-lock/store.ts — local "quick-unlock" state for this device.
 *
 * This is NOT a server credential. The real session is the Supabase session
 * (cookies). The PIN / biometric is a *local gate* over an already-logged-in
 * session, exactly like a banking app: you log in fully once on a device, and
 * after that a 4-digit PIN (or Face ID / fingerprint) re-opens the app.
 *
 * The PIN itself is never stored — only a PBKDF2-SHA-256 hash + random salt,
 * kept in localStorage (per device, per browser).
 */

const KEY = {
  enabled: 'ppk.lock.enabled',
  salt: 'ppk.lock.salt',
  hash: 'ppk.lock.hash',
  fails: 'ppk.lock.fails',
  cred: 'ppk.lock.cred', // WebAuthn credential id (base64url), if biometric set up
} as const;

/** sessionStorage marker — once unlocked, route changes in the same tab stay open. */
const SESSION_KEY = 'ppk.lock.unlockedAt';

/** Re-lock after this much inactivity (ms). */
export const INACTIVITY_MS = 5 * 60 * 1000;

/** Wrong PINs allowed before we force a full re-login. */
export const MAX_FAILS = 5;

const PBKDF2_ITERATIONS = 120_000;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i] as number);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

/** Has the user set up a PIN on this device? */
export function isLockConfigured(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(KEY.enabled) === '1' && !!localStorage.getItem(KEY.hash);
}

/** Save a freshly-chosen 4-digit PIN. */
export async function setPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPin(pin, salt);
  localStorage.setItem(KEY.salt, toBase64(salt));
  localStorage.setItem(KEY.hash, hash);
  localStorage.setItem(KEY.enabled, '1');
  localStorage.removeItem(KEY.fails);
}

/** Check an entered PIN against the stored hash. */
export async function verifyPin(pin: string): Promise<boolean> {
  const saltB64 = localStorage.getItem(KEY.salt);
  const stored = localStorage.getItem(KEY.hash);
  if (!saltB64 || !stored) return false;
  const candidate = await hashPin(pin, fromBase64(saltB64));
  return candidate === stored;
}

/** Remove all lock config from this device (used when disabling). */
export function clearLock(): void {
  localStorage.removeItem(KEY.enabled);
  localStorage.removeItem(KEY.salt);
  localStorage.removeItem(KEY.hash);
  localStorage.removeItem(KEY.fails);
  localStorage.removeItem(KEY.cred);
  sessionStorage.removeItem(SESSION_KEY);
}

export function getFails(): number {
  const n = Number(localStorage.getItem(KEY.fails) ?? '0');
  return Number.isFinite(n) ? n : 0;
}

export function recordFail(): number {
  const next = getFails() + 1;
  localStorage.setItem(KEY.fails, String(next));
  return next;
}

export function resetFails(): void {
  localStorage.removeItem(KEY.fails);
}

export function getBiometricCredId(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(KEY.cred);
}

export function setBiometricCredId(id: string): void {
  localStorage.setItem(KEY.cred, id);
}

export function clearBiometricCredId(): void {
  localStorage.removeItem(KEY.cred);
}

export function hasBiometric(): boolean {
  return !!getBiometricCredId();
}

/** Mark the app unlocked for this tab/session. */
export function markUnlocked(): void {
  sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  resetFails();
}

/** Refresh the "last active" timestamp so the inactivity timer keeps resetting. */
export function touchActivity(): void {
  if (sessionStorage.getItem(SESSION_KEY)) {
    sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  }
}

/** Should the app currently show the lock screen? */
export function shouldLock(): boolean {
  if (!isLockConfigured()) return false;
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return true; // fresh load / new tab → locked
  const last = Number(raw);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > INACTIVITY_MS;
}

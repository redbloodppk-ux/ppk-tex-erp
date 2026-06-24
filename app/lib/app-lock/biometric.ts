/**
 * app-lock/biometric.ts — Face ID (iPhone) / fingerprint (Android, Windows Hello)
 * unlock via WebAuthn platform authenticator.
 *
 * Because this is a *local* convenience gate over an already-established Supabase
 * session (not a server credential), we don't verify the assertion on a server.
 * We register a platform passkey, then on unlock ask the device to verify the
 * user (`userVerification: 'required'`). A successful ceremony = unlock.
 */

import { getBiometricCredId, setBiometricCredId } from './store';

function bufToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i] as number);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBuf(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const s = atob(b64 + pad);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

/** Is a platform authenticator (Face ID / fingerprint) available on this device? */
export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Register a platform passkey and remember its credential id. Returns true on success. */
export async function registerBiometric(label: string): Promise<boolean> {
  if (!(await isBiometricAvailable())) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: challenge as unknown as BufferSource,
        rp: { name: 'PPK TEX' },
        user: {
          id: userId as unknown as BufferSource,
          name: label,
          displayName: label,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    setBiometricCredId(bufToBase64url(cred.rawId));
    return true;
  } catch {
    return false;
  }
}

/** Prompt Face ID / fingerprint. Returns true if the user verified successfully. */
export async function verifyBiometric(): Promise<boolean> {
  const credId = getBiometricCredId();
  if (!credId) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge as unknown as BufferSource,
        allowCredentials: [
          {
            type: 'public-key',
            id: base64urlToBuf(credId) as unknown as BufferSource,
          },
        ],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

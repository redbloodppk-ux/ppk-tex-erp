'use client';
import { Suspense, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';

// Next 15 requires components that read `useSearchParams()` to be inside a
// <Suspense> boundary so the rest of the tree can prerender while this part
// bails to client-side rendering.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'request' | 'verify'>('request');
  const [busy, setBusy] = useState(false);
  // Show any error passed in the URL (e.g. from /auth/callback or layout bounce).
  const [error, setError] = useState<string | null>(params.get('error'));
  const router = useRouter();
  const supabase = createClient();

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) setError(error.message);
    else setStage('verify');
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.push(params.get('next') ?? '/app/dashboard');
    router.refresh();
  }

  return (
    <main className="min-h-screen grid place-items-center bg-brand-gradient p-4">
      <div className="w-full max-w-md card p-8">
        <div className="mb-6 text-center">
          <div className="inline-block px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold tracking-wide mb-3">
            PPK TEX ERP
          </div>
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-ink-soft mt-1">Email-only sign in. We send a one-time code.</p>
        </div>

        {stage === 'request' && (
          <form onSubmit={requestOtp} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="input" placeholder="you@ppktex.in" autoFocus
              />
            </div>
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {stage === 'verify' && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <p className="text-sm text-ink-soft">
              Code sent to <span className="font-semibold text-ink">{email}</span>
            </p>
            <div>
              <label className="label">One-time code (6–8 digits)</label>
              <input
                type="text" inputMode="numeric" pattern="[0-9]{6,8}" maxLength={8} minLength={6}
                required value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                className="input num text-center text-lg tracking-widest" autoFocus
              />
            </div>
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button type="button" onClick={() => setStage('request')} className="btn-ghost w-full text-xs">
              Use a different email
            </button>
          </form>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 text-err text-sm">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}

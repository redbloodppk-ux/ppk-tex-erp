// Reusable GSTIN input + auto-fill widget.
// Drop into any form that captures a GSTIN. Parent passes `onResolve` to receive
// the fetched record and populate its own fields (name, address, city, state, pincode…).
//
// The widget renders an <input name={name}> so it participates in normal HTML
// FormData submission — the parent's <form> picks up the GSTIN value automatically.

'use client';
import { useState } from 'react';
import { Loader2, Search, CheckCircle2, AlertCircle } from 'lucide-react';

export type GstinAddress = {
  building?: string;
  street?: string;
  locality?: string;
  city?: string;
  district?: string;
  state?: string;
  state_code?: string;
  pincode?: string;
};

export type GstinData = {
  gstin: string;
  legal_name: string;
  trade_name?: string | null;
  status?: string;
  constitution?: string;
  taxpayer_type?: string;
  registration_date?: string;
  nature_of_business?: string[];
  address?: GstinAddress;
};

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

type Props = {
  /** Field name for form submission. Default: "gstin". */
  name?: string;
  /** Initial value (e.g. when editing an existing customer). */
  defaultValue?: string;
  /** Called with the fetched record when verification succeeds. */
  onResolve: (data: GstinData) => void;
  /** Label override. Default: "GSTIN". */
  label?: string;
  className?: string;
};

export function GstinLookup({
  name = 'gstin',
  defaultValue = '',
  onResolve,
  label = 'GSTIN',
  className,
}: Props) {
  const [value, setValue] = useState(defaultValue.toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [mocked, setMocked] = useState(false);

  const isValid = GSTIN_REGEX.test(value);

  async function lookup() {
    if (!isValid) {
      setError('Invalid GSTIN format (15 chars).');
      return;
    }
    setBusy(true);
    setError(null);
    setResolved(false);
    setMocked(false);
    try {
      // Route lives under /app/* so middleware enforces auth — only logged-in users
      // can burn GST lookup credits when we plug in a real provider.
      const res = await fetch(`/app/api/gst/${encodeURIComponent(value)}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error ?? `Lookup failed (HTTP ${res.status})`);
        return;
      }
      onResolve(json.data as GstinData);
      setResolved(true);
      setMocked(Boolean(json.mocked));
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
    } finally {
      setBusy(false);
    }
  }

  // GSTIN is 15 chars in a specific pattern. Highlight in red whenever the
  // operator has typed something but the value isn't 15 chars yet OR is the
  // wrong format. Pristine empty input stays neutral.
  const showInvalid = value.length > 0 && !isValid;

  return (
    <div className={className}>
      <label className="label flex items-center gap-1.5">
        <span>{label}</span>
        {resolved && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
      </label>
      <div className="flex gap-2">
        <input
          name={name}
          value={value}
          onChange={(e) => {
            // Force uppercase, strip anything that isn't A-Z or 0-9.
            setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
            setResolved(false);
            setError(null);
          }}
          onKeyDown={(e) => {
            // Enter triggers verification instead of submitting the parent form.
            if (e.key === 'Enter' && isValid && !busy) {
              e.preventDefault();
              lookup();
            }
          }}
          className={
            'input num uppercase flex-1 ' +
            (showInvalid
              ? 'border-rose-400 bg-rose-50 text-rose-800 focus:border-rose-500 focus:ring-rose-200'
              : '')
          }
          placeholder="33ABCDE1234F1Z5"
          maxLength={15}
          autoComplete="off"
          aria-invalid={showInvalid}
        />
        <button
          type="button"
          onClick={lookup}
          disabled={!isValid || busy}
          className="btn-primary px-3 whitespace-nowrap text-xs"
          title={isValid ? 'Fetch business details from GST portal' : 'Enter a valid 15-char GSTIN first'}
        >
          {busy ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Fetching…
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Verify
            </span>
          )}
        </button>
      </div>
      {showInvalid && !error && (
        <p className="mt-1 text-xs text-rose-600 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {value.length < 15
            ? `Enter all 15 characters (${value.length}/15 typed).`
            : 'Format must be 2 digits + 5 letters + 4 digits + 1 letter + 1 alphanum + Z + 1 alphanum.'}
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs text-err flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}
      {resolved && !error && (
        <p className="mt-1 text-xs text-emerald-700">
          {mocked
            ? 'Details fetched (mock data — set GST_API_KEY in Vercel to use the live GST portal).'
            : 'Details fetched from live GST portal.'}
        </p>
      )}
    </div>
  );
}

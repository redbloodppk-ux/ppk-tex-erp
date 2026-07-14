'use client';
/**
 * Company Profile edit form — Settings → Company.
 *
 * Wires the shared GstinLookup widget into a full editor for the
 * company_profile row. Verifying the GSTIN auto-fills every field
 * the GST portal returns (legal name, trade name = display name,
 * address, city, state, pincode) and stamps a verified_at timestamp
 * so the green tick survives a page reload. Editing the GSTIN value
 * clears the timestamp client-side — verification has to be redone.
 *
 * Field mapping from the GST portal payload:
 *   gstin                       → form.gstin
 *   legal_name                  → form.legal_name
 *   trade_name (fallback legal) → form.display_name
 *   PAN (derived from GSTIN 3-12) → form.pan
 *   address.building+street     → form.address_line1
 *   address.locality            → form.address_line2
 *   address.city / district     → form.city
 *   address.state               → form.state
 *   address.pincode             → form.pincode
 *
 * Singleton table — there's only one company_profile row. We INSERT
 * the first time, UPDATE thereafter.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, CheckCircle2, AlertTriangle } from 'lucide-react';
import { GstinLookup, type GstinData } from '@/app/components/gstin-lookup';

interface CompanyRow {
  id: number | null;
  legal_name: string;
  display_name: string;
  gstin: string;
  pan: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
  fy_start_month: number;
  base_currency: string;
  /** Most recent successful verification timestamp from /app/api/gst.
   *  Reloaded with the row so the green tick persists. */
  gstin_verified_at: string | null;
  /** Bank details printed on every invoice + DC under "Make cheques
   *  payable to …" — editable here so the operator can change the
   *  account without touching code. Falls back to lib/company
   *  constants on the print if any field is blank. */
  bank_name: string;
  bank_account_no: string;
  bank_ifsc: string;
  bank_branch: string;
}

interface Props {
  initial: Partial<CompanyRow> | null;
}

const EMPTY: CompanyRow = {
  id: null,
  legal_name: '',
  display_name: '',
  gstin: '',
  pan: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: 'Tamil Nadu',
  pincode: '',
  phone: '',
  email: '',
  website: '',
  fy_start_month: 4,
  base_currency: 'INR',
  gstin_verified_at: null,
  bank_name: '',
  bank_account_no: '',
  bank_ifsc: '',
  bank_branch: '',
};

/** Pull the 10-character PAN out of a GSTIN. Positions 3-12 (0-indexed
 *  2 through 11) hold the PAN, e.g. "33AAAAA0000A1Z5" → "AAAAA0000A".
 *  Defensive — returns '' if the GSTIN isn't the right length. */
function panFromGstin(gstin: string): string {
  if (typeof gstin !== 'string' || gstin.length < 12) return '';
  return gstin.slice(2, 12);
}

/** Merge the DB row over the EMPTY defaults, then coerce any NULL string
 *  columns (address_line2, phone, email, website, bank_* …) back to ''.
 *  Without this, a null from the DB overrides the '' default via the
 *  spread, and `.trim()` in handleSave throws — leaving the Save button
 *  spinning forever with nothing written. */
function fromInitial(initial: Partial<CompanyRow> | null): CompanyRow {
  const merged: CompanyRow = { ...EMPTY, ...(initial ?? {}) };
  for (const k of Object.keys(EMPTY) as Array<keyof CompanyRow>) {
    if (typeof EMPTY[k] === 'string' && (merged[k] === null || merged[k] === undefined)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[k] = '';
    }
  }
  if (merged.fy_start_month == null) merged.fy_start_month = 4;
  if (!merged.base_currency) merged.base_currency = 'INR';
  return merged;
}

export function CompanyForm({ initial }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState<CompanyRow>(() => fromInitial(initial));
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  /** Called when the GstinLookup component successfully fetches details
   *  from the GST portal. We overwrite every field the portal gives us;
   *  fields the portal doesn't return are left untouched. */
  function applyGstinPayload(data: GstinData): void {
    setForm((f) => {
      const addr = data.address ?? {};
      const line1 = [addr.building, addr.street].filter(Boolean).join(', ').trim();
      const line2 = addr.locality ?? '';
      const city = addr.city ?? addr.district ?? f.city;
      const state = addr.state ?? f.state;
      const pincode = addr.pincode ?? f.pincode;
      const trade = (data.trade_name ?? '').trim();
      const legal = (data.legal_name ?? '').trim();
      return {
        ...f,
        gstin: data.gstin,
        legal_name: legal || f.legal_name,
        // Display / trade name commonly differs from the legal name
        // (e.g. "PPK TEX" vs "PRAVEEN PERUMAL KUMAR"). Prefer the trade
        // name when present, fall back to the legal name otherwise.
        display_name: trade || legal || f.display_name,
        pan: panFromGstin(data.gstin) || f.pan,
        address_line1: line1 || f.address_line1,
        address_line2: line2 || f.address_line2,
        city,
        state,
        pincode,
      };
    });
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSavedMsg(null);

    // Basic required-field check before bothering the DB. The DB has
    // CHECK constraints on GSTIN format + NOT NULL on the required
    // columns so we'll get a clean message either way; this catches
    // mistakes faster.
    const required: Array<[keyof CompanyRow, string]> = [
      ['legal_name', 'Legal name is required.'],
      ['display_name', 'Display name is required.'],
      ['gstin', 'GSTIN is required.'],
      ['pan', 'PAN is required.'],
      ['address_line1', 'Address line 1 is required.'],
      ['city', 'City is required.'],
      ['state', 'State is required.'],
      ['pincode', 'Pincode is required.'],
    ];
    for (const [k, msg] of required) {
      const v = form[k];
      if (v == null || (typeof v === 'string' && v.trim() === '')) {
        setError(msg);
        setBusy(false);
        return;
      }
    }

    // Null-safe trim — some fields can still be null if the row predates
    // the column (e.g. bank_* added later).
    const s = (v: string | null | undefined): string => (v ?? '').trim();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const payload = {
        legal_name: s(form.legal_name),
        display_name: s(form.display_name),
        gstin: s(form.gstin).toUpperCase(),
        pan: s(form.pan).toUpperCase(),
        address_line1: s(form.address_line1),
        address_line2: s(form.address_line2) || null,
        city: s(form.city),
        state: s(form.state),
        pincode: s(form.pincode),
        phone: s(form.phone) || null,
        email: s(form.email) || null,
        website: s(form.website) || null,
        fy_start_month: form.fy_start_month,
        base_currency: form.base_currency || 'INR',
        gstin_verified_at: form.gstin_verified_at || null,
        bank_name:       s(form.bank_name)       || null,
        bank_account_no: s(form.bank_account_no) || null,
        bank_ifsc:       s(form.bank_ifsc).toUpperCase() || null,
        bank_branch:     s(form.bank_branch)     || null,
      };

      if (form.id != null) {
        const { error: err } = await sb.from('company_profile').update(payload).eq('id', form.id);
        if (err) { setError(err.message); return; }
        setSavedMsg('Company profile saved.');
      } else {
        const { error: err } = await sb.from('company_profile').insert(payload);
        if (err) { setError(err.message); return; }
        setSavedMsg('Company profile created.');
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* GSTIN lookup — top of form because it auto-fills everything below */}
      <div className="card p-4 bg-gradient-to-br from-indigo-50/40 to-violet-50/30 border border-indigo-200">
        <GstinLookup
          label="GSTIN"
          defaultValue={form.gstin}
          initialVerifiedAt={form.gstin_verified_at}
          onResolve={applyGstinPayload}
          onVerified={(iso) => setForm((f) => ({ ...f, gstin_verified_at: iso || null }))}
        />
        <p className="text-[11px] text-ink-mute mt-2">
          Tap <strong>Verify</strong> after entering the 15-character GSTIN. Legal name,
          trade name (display name), PAN and full address auto-fill below. Edit any field
          afterwards if the portal value is stale.
        </p>
      </div>

      {/* Identity */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Business identity</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Legal Name *</label>
            <input
              className="input"
              value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
              placeholder="As registered on GST"
              required
            />
          </div>
          <div>
            <label className="label">Display Name *</label>
            <input
              className="input"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Short / trade name shown on invoices"
              required
            />
          </div>
          <div>
            <label className="label">PAN *</label>
            <input
              className="input num uppercase"
              value={form.pan}
              onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
              placeholder="Auto-filled from GSTIN"
              maxLength={10}
              required
            />
            <p className="text-[10px] text-ink-mute mt-0.5">
              Auto-derived from positions 3–12 of the GSTIN.
            </p>
          </div>
          <div>
            <label className="label">Base currency</label>
            <input
              className="input num"
              value={form.base_currency}
              onChange={(e) => setForm({ ...form, base_currency: e.target.value.toUpperCase() })}
              maxLength={3}
            />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Registered address</h3>
        <div>
          <label className="label">Address line 1 *</label>
          <input
            className="input"
            value={form.address_line1}
            onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
            placeholder="Door / Building / Street"
            required
          />
        </div>
        <div>
          <label className="label">Address line 2</label>
          <input
            className="input"
            value={form.address_line2}
            onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
            placeholder="Locality / Landmark"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">City *</label>
            <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required />
          </div>
          <div>
            <label className="label">State *</label>
            <input className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required />
          </div>
          <div>
            <label className="label">Pincode *</label>
            <input
              className="input num"
              value={form.pincode}
              onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              maxLength={6}
              required
            />
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Contact</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Phone</label>
            <input
              type="tel"
              className="input num"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+91 98765 43210"
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Website</label>
            <input
              className="input"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://"
            />
          </div>
        </div>
      </div>

      {/* Bank details — printed on every invoice + DC */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Bank details</h3>
        <p className="text-[11px] text-ink-mute -mt-1">
          These appear in the &ldquo;Make all cheques payable to&hellip;&rdquo; block on every invoice + DC print.
          Leave any field blank to fall back to the built-in default.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Bank name</label>
            <input
              className="input"
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              placeholder="e.g. YES BANK"
            />
          </div>
          <div>
            <label className="label">Branch</label>
            <input
              className="input"
              value={form.bank_branch}
              onChange={(e) => setForm({ ...form, bank_branch: e.target.value })}
              placeholder="e.g. ERODE"
            />
          </div>
          <div>
            <label className="label">Account number</label>
            <input
              className="input num"
              value={form.bank_account_no}
              onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })}
              placeholder="e.g. 062363400000783"
            />
          </div>
          <div>
            <label className="label">IFSC code</label>
            <input
              className="input num uppercase"
              value={form.bank_ifsc}
              onChange={(e) => setForm({ ...form, bank_ifsc: e.target.value.toUpperCase() })}
              placeholder="e.g. YESB0000623"
              maxLength={11}
            />
          </div>
        </div>
      </div>

      {/* Financial-year start */}
      <div className="card p-5">
        <h3 className="font-semibold text-sm mb-3">Financial year</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <div>
            <label className="label">FY start month</label>
            <select
              className="input"
              value={form.fy_start_month}
              onChange={(e) => setForm({ ...form, fy_start_month: Number(e.target.value) })}
            >
              {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <p className="text-[10px] text-ink-mute mt-0.5">
              India standard is April. Affects FY codes on doc sequences (DC/26-27/NNNN etc.).
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="card p-3 bg-rose-50/40 border-rose-200 text-rose-800 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}
      {savedMsg && (
        <div className="card p-3 bg-emerald-50/40 border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {savedMsg}
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save company profile
        </button>
      </div>
    </form>
  );
}

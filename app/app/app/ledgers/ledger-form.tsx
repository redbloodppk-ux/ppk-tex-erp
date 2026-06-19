'use client';
/**
 * Shared Ledger form used by /new and /[id]. Mirrors the Customer / Mill
 * pattern: type and group are mandatory dropdowns sourced from
 * ledger_type and ledger_group masters. GSTIN auto-fills name / address.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GstinLookup, type GstinData } from '@/app/components/gstin-lookup';
import { Loader2, Trash2, Archive } from 'lucide-react';

export interface LedgerOption { id: number; code: string; name: string; }

export interface LedgerFormValues {
  name: string;
  type_id: string;
  group_id: string;
  address1: string;
  address2: string;
  address3: string;
  address4: string;
  phone: string;
  email: string;
  pan_no: string;
  gstin: string;
  /** ISO timestamp of the most recent successful GSTIN verification.
   *  See migration 099. NULL / empty means unverified. */
  gstin_verified_at: string | null;
  area: string;
  active: boolean;
  notes: string;
  /** Bank account details — only shown / required when this ledger's
   *  type is BANK (migration 106). NULL on every non-bank ledger. */
  bank_name: string;
  bank_account_no: string;
  bank_ifsc: string;
  bank_branch: string;
  /** Opening balance (migration 203). A single as-on-date figure with an
   *  explicit Dr/Cr side. Hidden for CUSTOMER / SUPPLIER types, which carry
   *  their opening via party_opening_ledger instead. */
  opening_date: string;
  opening_amount: string;
  opening_dr_cr: 'Dr' | 'Cr';
}

interface LedgerFormProps {
  ledgerId?: number;
  code?: string;
  initial?: Partial<LedgerFormValues>;
  types: LedgerOption[];
  groups: LedgerOption[];
}

const EMPTY: LedgerFormValues = {
  name: '', type_id: '', group_id: '',
  address1: '', address2: '', address3: '', address4: '',
  phone: '', email: '', pan_no: '', gstin: '', gstin_verified_at: null, area: '',
  active: true, notes: '',
  bank_name: '', bank_account_no: '', bank_ifsc: '', bank_branch: '',
  opening_date: '', opening_amount: '', opening_dr_cr: 'Dr',
};

export function LedgerForm({ ledgerId, code, initial, types, groups }: LedgerFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = typeof ledgerId === 'number';
  const v: LedgerFormValues = { ...EMPTY, ...(initial ?? {}) };

  const [form, setForm] = useState<LedgerFormValues>(v);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Is the currently picked ledger type BANK? Bank-account fields
  // only show / validate when this is true.
  const isBankType: boolean = (() => {
    if (!form.type_id) return false;
    const t = types.find((x) => String(x.id) === String(form.type_id));
    return t?.name === 'BANK';
  })();

  // CUSTOMER / SUPPLIER ledgers carry their pre-ERP outstanding through the
  // per-bill party_opening_ledger (Settings → Opening Ledger), so the single
  // opening figure here would double count. Hide it for those two types; show
  // it for every other accounting ledger (BANK, AGENT, CASH, TAX, …).
  const isPartyBackedType: boolean = (() => {
    if (!form.type_id) return false;
    const t = types.find((x) => String(x.id) === String(form.type_id));
    return t?.name === 'CUSTOMER' || t?.name === 'SUPPLIER';
  })();

  const nameRef = useRef<HTMLInputElement>(null);
  const addr1Ref = useRef<HTMLInputElement>(null);
  const addr2Ref = useRef<HTMLInputElement>(null);
  const addr3Ref = useRef<HTMLInputElement>(null);
  const addr4Ref = useRef<HTMLInputElement>(null);
  const areaRef  = useRef<HTMLInputElement>(null);

  function patch(p: Partial<LedgerFormValues>) { setForm((f) => ({ ...f, ...p })); }

  function applyGst(d: GstinData) {
    // Clicking Verify is an explicit "fill from GST portal" action, so
    // overwrite the on-screen fields with the canonical values - including
    // over anything the operator may have typed.
    const next: Partial<LedgerFormValues> = {};
    const name = d.trade_name || d.legal_name;
    if (name) next.name = name;
    const a = d.address;
    if (a) {
      if (a.building) next.address1 = a.building;
      if (a.street)   next.address2 = a.street;
      if (a.locality) next.address3 = a.locality;
      if (a.city || a.pincode) {
        next.address4 = [a.city, a.pincode].filter(Boolean).join(' - ');
      }
      if (a.city) next.area = a.city;
    }
    if (Object.keys(next).length > 0) patch(next);
  }

  async function handleSave() {
    setError(null); setSavedMsg(null);
    const name = form.name.trim();
    if (name === '')         { setError('Ledger name is required.'); return; }
    if (form.type_id === '') { setError('Ledger type is required.'); return; }
    if (form.group_id === ''){ setError('Account group is required.'); return; }

    // Bank-type ledgers need the account details so payments can
    // record where the money came from / went to.
    if (isBankType) {
      if (form.bank_name.trim()       === '') { setError('Bank name is required for BANK ledgers.');    return; }
      if (form.bank_account_no.trim() === '') { setError('Account number is required for BANK ledgers.'); return; }
      if (form.bank_ifsc.trim()       === '') { setError('IFSC code is required for BANK ledgers.');     return; }
    }

    // Opening balance — parse + light validation. Only enforced for ledgers
    // that actually show the field (non party-backed).
    const openingAmt = Number(form.opening_amount) || 0;
    if (!isPartyBackedType && openingAmt < 0) {
      setError('Opening amount cannot be negative — use the Dr / Cr toggle to set the side.');
      return;
    }
    if (!isPartyBackedType && openingAmt > 0 && form.opening_date.trim() === '') {
      setError('Opening date is required when an opening amount is entered.');
      return;
    }

    const payload = {
      name,
      type_id: Number(form.type_id),
      group_id: Number(form.group_id),
      address1: form.address1.trim() === '' ? null : form.address1.trim(),
      address2: form.address2.trim() === '' ? null : form.address2.trim(),
      address3: form.address3.trim() === '' ? null : form.address3.trim(),
      address4: form.address4.trim() === '' ? null : form.address4.trim(),
      phone:    form.phone.trim() === '' ? null : form.phone.trim(),
      email:    form.email.trim() === '' ? null : form.email.trim(),
      pan_no:   form.pan_no.trim() === '' ? null : form.pan_no.trim().toUpperCase(),
      gstin:    form.gstin.trim() === '' ? null : form.gstin.trim().toUpperCase(),
      // Verification timestamp from the GST lookup widget. The DB
      // trigger from migration 099 auto-clears it when gstin changes.
      gstin_verified_at: form.gstin_verified_at || null,
      area:     form.area.trim() === '' ? null : form.area.trim(),
      active:   form.active,
      notes:    form.notes.trim() === '' ? null : form.notes.trim(),
      // Bank account details — saved only for BANK type, cleared
      // otherwise so a re-typed ledger doesn't carry stale bank data.
      bank_name:       isBankType && form.bank_name.trim()       !== '' ? form.bank_name.trim()                  : null,
      bank_account_no: isBankType && form.bank_account_no.trim() !== '' ? form.bank_account_no.trim()            : null,
      bank_ifsc:       isBankType && form.bank_ifsc.trim()       !== '' ? form.bank_ifsc.trim().toUpperCase()    : null,
      bank_branch:     isBankType && form.bank_branch.trim()     !== '' ? form.bank_branch.trim()                : null,
      // Opening balance — only for non party-backed ledgers. Cleared
      // (zeroed) for CUSTOMER / SUPPLIER so a re-typed ledger can't carry a
      // stray opening that double counts against party_opening_ledger.
      opening_date:   !isPartyBackedType && form.opening_date.trim() !== '' ? form.opening_date : null,
      opening_amount: !isPartyBackedType ? openingAmt : 0,
      opening_dr_cr:  !isPartyBackedType && openingAmt > 0 ? form.opening_dr_cr : null,
    };

    setBusy(true);

    // Duplicate-GSTIN guard: a GSTIN should map to exactly one ledger. If
    // another ledger already carries this GSTIN, intimate the operator and
    // abort rather than creating a duplicate party in the books. On edit we
    // exclude the row being edited so re-saving the same ledger is allowed.
    // Scope the GSTIN check to the same type+group: one business legitimately
    // has separate ledgers per accounting bucket (e.g. a party that is both a
    // Customer and a Job Work vendor), and those share the same GSTIN. We only
    // block a duplicate GSTIN WITHIN the same type+group.
    const gstinClean = form.gstin.trim().toUpperCase();
    if (gstinClean !== '') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let dupQ = (supabase as any).from('ledger').select('id, name, code')
        .ilike('gstin', gstinClean)
        .eq('type_id', Number(form.type_id))
        .eq('group_id', Number(form.group_id))
        .limit(1);
      if (isEdit) dupQ = dupQ.neq('id', ledgerId);
      const { data: dup } = await dupQ.maybeSingle();
      if (dup) {
        setBusy(false);
        setError(`GSTIN ${gstinClean} is already used by ledger "${dup.name}"${dup.code ? ` (${dup.code})` : ''} with the same type and group. Not saved.`);
        return;
      }
    }

    // Same-name guard (catches blank-GSTIN duplicates the GSTIN check above
    // can't see). A party that is genuinely two things — e.g. customer AND
    // vendor — legitimately has one ledger per type+group, so we only block a
    // new row that matches an existing one on name AND type AND group.
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let nameQ = (supabase as any).from('ledger')
        .select('id, name, code')
        .ilike('name', name)
        .eq('type_id', Number(form.type_id))
        .eq('group_id', Number(form.group_id))
        .limit(1);
      if (isEdit) nameQ = nameQ.neq('id', ledgerId);
      const { data: dupName } = await nameQ.maybeSingle();
      if (dupName) {
        setBusy(false);
        setError(`A ledger named "${name}" with the same type and group already exists (${dupName.code}). Not saved — open that one and edit it instead of creating a duplicate.`);
        return;
      }
    }

    if (isEdit) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('ledger').update(payload).eq('id', ledgerId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      // Auto-close on save: redirect back to the ledgers list, matching
      // the same flow as Create.
      router.push('/app/ledgers');
      router.refresh();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('ledger').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      router.push('/app/ledgers');
      router.refresh();
    }
  }

  async function handleArchive() {
    if (!isEdit) return;
    const ok = window.confirm('Archive this ledger? It will be hidden from active lists.');
    if (ok === false) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('ledger').update({ active: false }).eq('id', ledgerId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.push('/app/ledgers'); router.refresh();
  }

  async function handleDelete() {
    if (!isEdit) return;
    const ok = window.confirm('Permanently delete this ledger?');
    if (ok === false) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('ledger').delete().eq('id', ledgerId);
    setBusy(false);
    if (err) { setError(err.message + ' - try Archive instead.'); return; }
    router.push('/app/ledgers'); router.refresh();
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Ledger Code</label>
          <div className="input num bg-cloud/60 text-ink-mute select-none">
            {code ?? 'Auto-generated (LED-NNNN)'}
          </div>
        </div>
        <div>
          <label className="label">Ledger Type *</label>
          <select className="input w-full" value={form.type_id}
            onChange={(e) => patch({ type_id: e.target.value })}>
            <option value="">--- pick ---</option>
            {types.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Account Group *</label>
          <select className="input w-full" value={form.group_id}
            onChange={(e) => patch({ group_id: e.target.value })}>
            <option value="">--- pick ---</option>
            {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Ledger Name *</label>
          <input ref={nameRef} className="input w-full" value={form.name}
            onChange={(e) => patch({ name: e.target.value })} />
        </div>
        <GstinLookup
          onResolve={applyGst}
          defaultValue={form.gstin}
          initialVerifiedAt={form.gstin_verified_at ?? null}
          onVerified={(iso) => patch({ gstin_verified_at: iso })}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="label">Address 1</label>
          <input ref={addr1Ref} className="input w-full" value={form.address1}
            onChange={(e) => patch({ address1: e.target.value })} />
        </div>
        <div>
          <label className="label">Address 2</label>
          <input ref={addr2Ref} className="input w-full" value={form.address2}
            onChange={(e) => patch({ address2: e.target.value })} />
        </div>
        <div>
          <label className="label">Address 3</label>
          <input ref={addr3Ref} className="input w-full" value={form.address3}
            onChange={(e) => patch({ address3: e.target.value })} />
        </div>
        <div>
          <label className="label">Address 4</label>
          <input ref={addr4Ref} className="input w-full" value={form.address4}
            onChange={(e) => patch({ address4: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="label">Phone</label>
          <input type="tel" className="input num w-full" value={form.phone}
            onChange={(e) => patch({ phone: e.target.value })} />
        </div>
        <div>
          <label className="label">Email</label>
          <input type="email" className="input w-full" value={form.email}
            onChange={(e) => patch({ email: e.target.value })} />
        </div>
        <div>
          <label className="label">PAN No</label>
          <input className="input uppercase w-full" value={form.pan_no}
            onChange={(e) => patch({ pan_no: e.target.value })} />
        </div>
        <div>
          <label className="label">Area</label>
          <input ref={areaRef} className="input w-full" value={form.area}
            onChange={(e) => patch({ area: e.target.value })} />
        </div>
      </div>

      {/* Bank account details — only shown when the picked ledger type
          is BANK. Saved into ledger.bank_* columns (migration 106) and
          referenced by the Payments page when listing accounts. */}
      {isBankType && (
        <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-indigo-900">🏦 Bank account details</span>
            <span className="text-[11px] text-indigo-700">required for BANK-type ledgers</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Bank name *</label>
              <input className="input w-full" placeholder="e.g. HDFC Bank"
                value={form.bank_name} onChange={(e) => patch({ bank_name: e.target.value })} />
            </div>
            <div>
              <label className="label">Branch</label>
              <input className="input w-full" placeholder="e.g. Erode Main"
                value={form.bank_branch} onChange={(e) => patch({ bank_branch: e.target.value })} />
            </div>
            <div>
              <label className="label">Account number *</label>
              <input className="input num w-full" placeholder="e.g. 50100123456789"
                value={form.bank_account_no}
                onChange={(e) => patch({ bank_account_no: e.target.value.replace(/\s+/g, '') })} />
            </div>
            <div>
              <label className="label">IFSC code *</label>
              <input className="input uppercase w-full" placeholder="e.g. HDFC0001234"
                value={form.bank_ifsc}
                onChange={(e) => patch({ bank_ifsc: e.target.value.toUpperCase().replace(/\s+/g, '') })}
                maxLength={11} />
            </div>
          </div>
        </div>
      )}

      {/* Opening balance — shown for every ledger except CUSTOMER /
          SUPPLIER (those carry opening via Settings → Opening Ledger).
          A single as-on-date figure with an explicit Dr / Cr side. */}
      {!isPartyBackedType && form.type_id !== '' && (
        <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-emerald-900">📒 Opening balance</span>
            <span className="text-[11px] text-emerald-700">balance carried in as on a date (optional)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label">As on date</label>
              <input type="date" className="input w-full" value={form.opening_date}
                onChange={(e) => patch({ opening_date: e.target.value })} />
            </div>
            <div>
              <label className="label">Opening amount</label>
              <input type="number" inputMode="decimal" step="0.01" min="0"
                className="input num w-full" placeholder="0.00"
                value={form.opening_amount}
                onChange={(e) => patch({ opening_amount: e.target.value })} />
            </div>
            <div>
              <label className="label">Dr / Cr</label>
              <select className="input w-full" value={form.opening_dr_cr}
                onChange={(e) => patch({ opening_dr_cr: e.target.value as 'Dr' | 'Cr' })}>
                <option value="Dr">Dr — receivable / asset (they owe us / we hold)</option>
                <option value="Cr">Cr — payable / liability (we owe)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Notes</label>
          <input className="input w-full" placeholder="(optional)" value={form.notes}
            onChange={(e) => patch({ notes: e.target.value })} />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.active}
              onChange={(e) => patch({ active: e.target.checked })} />
            <span className="text-sm">Active</span>
          </label>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{error}</div>}
      {savedMsg && <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{savedMsg}</div>}

      {/* Action bar — wraps onto two rows on mobile so the primary Save
          button stays inside the viewport. */}
      <div className="flex flex-wrap justify-between gap-2 pt-2">
        <div className="flex flex-wrap gap-2">
          {isEdit && (
            <>
              <button type="button" onClick={handleArchive} disabled={busy}
                className="btn-ghost text-amber-700">
                <Archive className="w-4 h-4" /> Archive
              </button>
              <button type="button" onClick={handleDelete} disabled={busy}
                className="btn-ghost text-red-700">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button type="button" onClick={() => router.back()} className="btn-ghost flex-1 sm:flex-none justify-center">Cancel</button>
          <button type="button" onClick={handleSave} disabled={busy} className="btn-primary flex-1 sm:flex-none justify-center">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Ledger'}
          </button>
        </div>
      </div>
    </div>
  );
}

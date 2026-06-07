'use client';
/**
 * Shared Party form — used by /new (create) and /[id] (edit).
 * Mirrors the Customer form: GSTIN auto-lookup that fills name, address,
 * city, state and pincode. Plus a Party Type dropdown so the operator
 * tags the new row as Customer / Mill / Jobwork / Sizing / etc.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GstinLookup, type GstinData } from '@/app/components/gstin-lookup';
import { Loader2, Trash2, Archive } from 'lucide-react';

export interface PartyTypeOpt { id: number; code: string; name: string; }

export interface PartyFormValues {
  /** Legacy single type — kept for back-compat. The canonical source of
   *  truth is `party_type_ids` below. */
  party_type_id: string;
  /** Migration 081: a party can belong to multiple types (e.g. Customer
   *  + Bobbin Supplier). Stored as a bigint[] in the DB. */
  party_type_ids: string[];
  name: string;
  gstin: string;
  /** ISO timestamp of the most recent successful GSTIN verification.
   *  Empty string / null means unverified. Migration 099 wires a DB
   *  trigger that auto-clears this column whenever gstin itself
   *  changes, so re-verification is required to get the tick back. */
  gstin_verified_at: string | null;
  contact_person: string;
  phone: string;
  email: string;
  billing_address: string;
  city: string;
  state: string;
  state_code: string;
  pincode: string;
  credit_limit: number;
  payment_terms_days: number;
  is_vip: boolean;
  status: 'active' | 'inactive' | 'archived';
  notes: string;
}

interface PartyFormProps {
  partyId?: number;
  initial?: Partial<PartyFormValues>;
  code?: string;
}

const EMPTY: PartyFormValues = {
  party_type_id: '',
  party_type_ids: [],
  name: '',
  gstin: '',
  gstin_verified_at: null,
  contact_person: '',
  phone: '',
  email: '',
  billing_address: '',
  city: '',
  state: 'Tamil Nadu',
  state_code: '33',
  pincode: '',
  credit_limit: 0,
  payment_terms_days: 30,
  is_vip: false,
  status: 'active',
  notes: '',
};

export function PartyForm({ partyId, initial, code }: PartyFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = typeof partyId === 'number';
  const values: PartyFormValues = { ...EMPTY, ...(initial ?? {}) };

  const [partyTypes, setPartyTypes] = useState<PartyTypeOpt[]>([]);
  // Ledger types — the accounting bucket the linked ledger row will
  // sit in. Loaded once for the dropdown; the operator's pick is
  // persisted onto party.ledger_id's ledger.type_id after save.
  const [ledgerTypes,   setLedgerTypes]   = useState<Array<{ id: number; name: string }>>([]);
  const [ledgerTypeId,  setLedgerTypeId]  = useState<string>('');
  // Multi-type selection. Hydrate from values.party_type_ids when editing
  // an existing party, or from the single legacy party_type_id when older
  // rows haven't been migrated yet.
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>(() => {
    const arr = values.party_type_ids ?? [];
    if (arr.length > 0) return arr.map((s) => String(s));
    if (values.party_type_id) return [String(values.party_type_id)];
    return [];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Verification timestamp tracked separately because it's set by a
  // callback from <GstinLookup> (not a normal input). An empty string
  // means "not verified in this session and not previously verified".
  const [gstinVerifiedAt, setGstinVerifiedAt] = useState<string>(values.gstin_verified_at ?? '');

  function toggleType(idStr: string): void {
    setSelectedTypeIds((prev) => prev.includes(idStr)
      ? prev.filter((x) => x !== idStr)
      : [...prev, idStr].sort());
  }
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const billingRef = useRef<HTMLTextAreaElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  const stateCodeRef = useRef<HTMLInputElement>(null);
  const pincodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [ptRes, ltRes] = await Promise.all([
        sb.from('party_type_master').select('id, code, name').eq('active', true).order('name'),
        sb.from('ledger_type').select('id, name').eq('active', true).order('name'),
      ]);
      setPartyTypes((ptRes.data ?? []) as PartyTypeOpt[]);
      setLedgerTypes(((ltRes.data ?? []) as Array<{ id: number; name: string }>));
    })();
  }, [supabase]);

  // On edit, hydrate the ledger-type dropdown from the party's linked
  // ledger's type_id. We do this in a separate effect so it can wait
  // until both the partyId and the ledger types list are available.
  useEffect(() => {
    if (!isEdit || partyId == null) return;
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb.from('party').select('ledger_id').eq('id', partyId).maybeSingle();
      const ledgerId = data?.ledger_id;
      if (ledgerId == null) return;
      const { data: led } = await sb.from('ledger').select('type_id').eq('id', ledgerId).maybeSingle();
      if (cancelled) return;
      if (led?.type_id != null) setLedgerTypeId(String(led.type_id));
    })();
    return () => { cancelled = true; };
  }, [isEdit, partyId, supabase]);

  function applyGst(d: GstinData) {
    // Clicking Verify is an explicit "fill from GST portal" action, so we
    // overwrite the on-screen fields with the canonical values returned by
    // the lookup - including over anything the operator may have typed.
    const name = d.trade_name || d.legal_name;
    if (nameRef.current && name) nameRef.current.value = name;

    const a = d.address;
    if (a) {
      if (billingRef.current) {
        const line = [a.building, a.street, a.locality].filter(Boolean).join(', ');
        if (line) billingRef.current.value = line;
      }
      if (cityRef.current && a.city) cityRef.current.value = a.city;
      if (stateRef.current && a.state) stateRef.current.value = a.state;
      if (stateCodeRef.current && a.state_code) stateCodeRef.current.value = a.state_code;
      if (pincodeRef.current && a.pincode) pincodeRef.current.value = a.pincode;
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    const fd = new FormData(e.currentTarget);

    if (selectedTypeIds.length === 0) {
      setBusy(false); setError('Pick at least one party type.'); return;
    }
    const typeIdNums = selectedTypeIds.map((s) => Number(s)).filter((n) => Number.isFinite(n));

    const payload = {
      // Multi-type array (canonical). The DB trigger keeps party_type_id
      // in sync with the first element, so we send both for safety.
      party_type_ids: typeIdNums,
      party_type_id: typeIdNums[0],
      name: String(fd.get('name') ?? '').trim(),
      gstin: String(fd.get('gstin') ?? '').trim().toUpperCase() || null,
      // Persist verification timestamp from the lookup widget. An empty
      // string means the user never clicked Verify (or cleared the field)
      // so we save NULL. A DB trigger (migration 099) also clears this
      // whenever gstin itself is edited, as a belt-and-braces safeguard.
      gstin_verified_at: gstinVerifiedAt || null,
      contact_person: String(fd.get('contact_person') ?? '').trim() || null,
      phone: String(fd.get('phone') ?? '').trim() || null,
      email: String(fd.get('email') ?? '').trim() || null,
      billing_address: String(fd.get('billing_address') ?? '').trim(),
      city: String(fd.get('city') ?? '').trim() || null,
      state: String(fd.get('state') ?? 'Tamil Nadu').trim() || null,
      state_code: String(fd.get('state_code') ?? '').trim() || null,
      pincode: String(fd.get('pincode') ?? '').trim() || null,
      credit_limit: Number(fd.get('credit_limit') ?? 0) || 0,
      payment_terms_days: Number(fd.get('payment_terms_days') ?? 30) || 30,
      is_vip: fd.get('is_vip') === 'on',
      status: String(fd.get('status') ?? 'active') as 'active' | 'inactive' | 'archived',
      notes: String(fd.get('notes') ?? '').trim() || null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Helper — propagate the picked ledger_type to the party's linked
    // ledger row. Best-effort: if the party has no linked ledger yet
    // (e.g. the linking trigger fires later) we silently skip.
    async function syncLedgerType(partyIdToSync: number): Promise<void> {
      const pickedTypeId = ledgerTypeId === '' ? null : Number(ledgerTypeId);
      if (pickedTypeId == null) return;
      const { data: p } = await sb.from('party').select('ledger_id').eq('id', partyIdToSync).maybeSingle();
      const linkedLedgerId = p?.ledger_id;
      if (linkedLedgerId == null) return;
      await sb.from('ledger').update({ type_id: pickedTypeId }).eq('id', linkedLedgerId);
    }

    if (isEdit) {
      const { error: err } = await sb.from('party').update(payload).eq('id', partyId);
      if (err) { setBusy(false); setError(err.message); return; }
      await syncLedgerType(partyId as number);
      setBusy(false);
      setSavedMsg('Saved.');
      router.refresh();
    } else {
      const { data: inserted, error: err } = await sb.from('party').insert(payload).select('id').single();
      if (err) { setBusy(false); setError(err.message); return; }
      if (inserted?.id != null) {
        await syncLedgerType(inserted.id);
      }
      setBusy(false);
      router.push('/app/parties');
      router.refresh();
    }
  }

  async function handleArchive() {
    if (!isEdit) return;
    if (!window.confirm('Archive this party? Hidden from active lists; data preserved.')) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('party').update({ status: 'archived' }).eq('id', partyId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.push('/app/parties');
    router.refresh();
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!window.confirm('Permanently delete this party? Blocked by FK if referenced.')) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('party').delete().eq('id', partyId);
    setBusy(false);
    if (err) { setError(err.message + ' - try Archive instead.'); return; }
    router.push('/app/parties');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Party Code</label>
          <div className="input num bg-cloud/60 text-ink-mute flex items-center cursor-not-allowed select-none">
            {code ?? 'Auto-generated (PRT-XXXX)'}
          </div>
          {!isEdit && (
            <p className="text-[11px] text-ink-mute mt-1">Assigned automatically when saved.</p>
          )}
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="label mb-0">Party Type *</label>
            <span className="text-[11px] text-ink-mute">
              {selectedTypeIds.length === 0
                ? 'Pick one or more'
                : `${selectedTypeIds.length} selected`}
            </span>
          </div>
          <div className="rounded-lg border border-line bg-cloud/30 p-2.5">
            {partyTypes.length === 0 ? (
              <div className="text-xs text-ink-mute py-1.5 px-1">Loading party types...</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {partyTypes.map((t) => {
                  const idStr = String(t.id);
                  const active = selectedTypeIds.includes(idStr);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleType(idStr)}
                      aria-pressed={active}
                      className={
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ' +
                        (active
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
                          : 'border-line bg-white text-ink-soft hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/50')
                      }
                    >
                      <span
                        className={
                          'inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border ' +
                          (active
                            ? 'border-white bg-white text-indigo-600'
                            : 'border-line bg-white text-transparent')
                        }
                      >
                        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none">
                          <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      {t.name}
                    </button>
                  );
                })}
                <a
                  href="/app/settings/party-types"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Add a new party type in Settings"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-line text-xs font-semibold text-ink-mute hover:border-indigo-400 hover:text-indigo-700 hover:bg-white transition"
                >
                  <span className="text-base leading-none">+</span> New type
                </a>
              </div>
            )}
          </div>
          <p className="text-[11px] text-ink-mute mt-1.5">
            Pick every role this business plays for you. A party can be
            <span className="font-semibold text-ink"> Customer</span> +
            <span className="font-semibold text-ink"> Bobbin Supplier</span> at the same time - no need to duplicate.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <GstinLookup
            onResolve={applyGst}
            defaultValue={values.gstin}
            initialVerifiedAt={values.gstin_verified_at ?? null}
            onVerified={setGstinVerifiedAt}
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select name="status" className="input" defaultValue={values.status}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Ledger type — picks the accounting bucket the linked ledger
          row sits in (e.g. SUNDRY DEBTORS for a customer, JOB WORK
          (VENDOR) for a jobwork party). On save we write this to the
          party's linked ledger row so reports + payment flows route
          to the right group. */}
      <div>
        <label className="label">Ledger type</label>
        <select
          className="input"
          value={ledgerTypeId}
          onChange={(e) => setLedgerTypeId(e.target.value)}
        >
          <option value="">— Leave to default —</option>
          {ledgerTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <p className="text-[11px] text-ink-mute mt-1">
          Optional. When set, the party&rsquo;s linked ledger row is
          re-tagged with this type on save. Leave as default if the
          party type already maps to the correct ledger type.
        </p>
      </div>

      <div>
        <label className="label">Name *</label>
        <input ref={nameRef} name="name" required className="input"
          placeholder="Party business name" defaultValue={values.name} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Contact Person</label>
          <input name="contact_person" className="input" defaultValue={values.contact_person} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input name="phone" type="tel" className="input num"
            placeholder="+91 98765 43210" defaultValue={values.phone} />
        </div>
      </div>

      <div>
        <label className="label">Email</label>
        <input name="email" type="email" className="input" defaultValue={values.email} />
      </div>

      <div>
        <label className="label">Billing Address</label>
        <textarea ref={billingRef} name="billing_address" rows={2} className="input mb-2"
          placeholder="Door / street / locality" defaultValue={values.billing_address} />
        <div className="grid grid-cols-4 gap-2">
          <input ref={cityRef} name="city" className="input" placeholder="City"
            defaultValue={values.city} />
          <input ref={stateRef} name="state" className="input" placeholder="State"
            defaultValue={values.state} />
          <input ref={stateCodeRef} name="state_code" className="input num"
            placeholder="State code (e.g. 33)" maxLength={2}
            defaultValue={values.state_code}
            title="GST state code - first 2 digits of GSTIN. Auto-fills on Verify." />
          <input ref={pincodeRef} name="pincode" className="input num"
            placeholder="Pincode" maxLength={6} defaultValue={values.pincode} />
        </div>
        <p className="text-[10px] text-ink-mute mt-1">
          State code auto-fills when you Verify the GSTIN. It's the first 2 digits
          (e.g. 33 = Tamil Nadu) and drives IGST vs CGST/SGST on invoices.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="label">Credit Limit (Rs)</label>
          <input name="credit_limit" type="number" min={0} step={1000}
            className="input num" defaultValue={values.credit_limit} />
        </div>
        <div>
          <label className="label">Payment Terms (days)</label>
          <input name="payment_terms_days" type="number" min={0} max={180}
            className="input num" defaultValue={values.payment_terms_days} />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 pb-2">
            <input name="is_vip" type="checkbox" defaultChecked={values.is_vip} className="w-4 h-4 accent-amber-500" />
            <span className="text-sm">VIP party</span>
          </label>
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea name="notes" rows={2} className="input" defaultValue={values.notes}
          placeholder="Optional internal notes" />
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{error}</div>}
      {savedMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{savedMsg}</div>
      )}

      {/* Action bar — wraps onto two rows on mobile so the primary Save
          button never gets pushed past the right edge of the viewport.
          On wider screens it stays as one row, archive/delete on the
          left, cancel/save on the right. */}
      <div className="flex flex-wrap justify-between gap-2 pt-2">
        <div className="flex flex-wrap gap-2">
          {isEdit && (
            <>
              <button type="button" onClick={handleArchive} disabled={busy}
                className="btn-ghost text-amber-700"
                title="Hide from active lists; data preserved">
                <Archive className="w-4 h-4" /> Archive
              </button>
              <button type="button" onClick={handleDelete} disabled={busy}
                className="btn-ghost text-red-700"
                title="Permanently delete (blocked by FK if referenced)">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button type="button" onClick={() => router.back()} className="btn-ghost flex-1 sm:flex-none justify-center">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary flex-1 sm:flex-none justify-center">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Party'}
          </button>
        </div>
      </div>
    </form>
  );
}

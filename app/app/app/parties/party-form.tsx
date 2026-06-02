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
      const { data } = await sb.from('party_type_master')
        .select('id, code, name').eq('active', true).order('name');
      setPartyTypes((data ?? []) as PartyTypeOpt[]);
    })();
  }, [supabase]);

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
    if (isEdit) {
      const { error: err } = await sb.from('party').update(payload).eq('id', partyId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Saved.');
      router.refresh();
    } else {
      const { error: err } = await sb.from('party').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
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
          <label className="label">Party Type * <span className="text-ink-mute font-normal">(tick all that apply)</span></label>
          <div className="flex items-start gap-1.5">
            <div className="flex-1 input min-h-[40px] py-1.5 flex flex-wrap gap-1.5 items-center">
              {partyTypes.length === 0 ? (
                <span className="text-xs text-ink-mute">Loading...</span>
              ) : partyTypes.map((t) => {
                const idStr = String(t.id);
                const active = selectedTypeIds.includes(idStr);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleType(idStr)}
                    className={
                      'px-2.5 py-1 rounded-full border text-xs font-semibold transition ' +
                      (active
                        ? 'border-transparent bg-indigo-600 text-white'
                        : 'border-line bg-white text-ink-soft hover:bg-haze/60')
                    }
                  >
                    {active && <span className="mr-1">✓</span>}
                    {t.name}
                  </button>
                );
              })}
            </div>
            <a href="/app/settings/party-types" target="_blank" rel="noopener noreferrer"
              title="Add new party type"
              className="inline-flex items-center justify-center w-9 px-2 rounded-lg border border-line bg-white text-indigo-700 hover:bg-indigo-50 text-base font-bold shrink-0 self-stretch">
              +
            </a>
          </div>
          <p className="text-[11px] text-ink-mute mt-1">
            One party can be e.g. <span className="font-semibold">Customer</span> + <span className="font-semibold">Bobbin Supplier</span> at the same time - no need to create duplicate rows.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <GstinLookup onResolve={applyGst} defaultValue={values.gstin} />
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

      <div className="flex justify-between gap-2 pt-2">
        <div className="flex gap-2">
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
        <div className="flex gap-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Party'}
          </button>
        </div>
      </div>
    </form>
  );
}

'use client';
/**
 * Shared customer form — used by /new (create) and /[id] (edit).
 *
 * Refs are used for GSTIN-lookup auto-fill so the rest of the form can stay
 * uncontrolled and rely on FormData submission.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GstinLookup, type GstinData } from '@/app/components/gstin-lookup';
import { Loader2, Trash2, Archive } from 'lucide-react';

export interface CustomerFormValues {
  name: string;
  gstin: string;
  /** ISO timestamp of the most recent successful GSTIN verification.
   *  See migration 099. NULL / empty means unverified. */
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
  status: 'active' | 'inactive' | 'archived';
}

interface CustomerFormProps {
  /** If supplied, the form is in edit mode. Otherwise create mode. */
  customerId?: number;
  /** Pre-existing values (edit mode) or sensible defaults. */
  initial?: Partial<CustomerFormValues>;
  /** Existing code, displayed read-only. */
  code?: string;
}

const EMPTY: CustomerFormValues = {
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
  status: 'active',
};

export function CustomerForm({ customerId, initial, code }: CustomerFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = typeof customerId === 'number';
  const values: CustomerFormValues = { ...EMPTY, ...(initial ?? {}) };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // Verification timestamp from <GstinLookup>'s onVerified callback.
  // Persisted to customer.gstin_verified_at on save.
  const [gstinVerifiedAt, setGstinVerifiedAt] = useState<string>(values.gstin_verified_at ?? '');

  const nameRef = useRef<HTMLInputElement>(null);
  const billingRef = useRef<HTMLTextAreaElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  const stateCodeRef = useRef<HTMLInputElement>(null);
  const pincodeRef = useRef<HTMLInputElement>(null);

  function applyGst(d: GstinData) {
    // Clicking Verify is an explicit "fill from GST portal" action, so we
    // overwrite the on-screen fields with the canonical values from the
    // lookup - including over anything the operator may have typed.
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

    const billing_address = String(fd.get('billing_address') ?? '').trim();
    if (billing_address === '') {
      setBusy(false);
      setError('Billing address is required.');
      return;
    }

    const payload = {
      name: String(fd.get('name') ?? '').trim(),
      gstin: String(fd.get('gstin') ?? '').trim().toUpperCase() || null,
      // Verification timestamp from the GST lookup widget. Empty = never
      // verified. The DB trigger from migration 099 also clears this
      // automatically when gstin itself is changed.
      gstin_verified_at: gstinVerifiedAt || null,
      contact_person: String(fd.get('contact_person') ?? '').trim() || null,
      phone: String(fd.get('phone') ?? '').trim() || null,
      email: String(fd.get('email') ?? '').trim() || null,
      billing_address,
      city: String(fd.get('city') ?? '').trim() || null,
      state: String(fd.get('state') ?? 'Tamil Nadu').trim() || null,
      state_code: String(fd.get('state_code') ?? '').trim() || null,
      pincode: String(fd.get('pincode') ?? '').trim() || null,
      credit_limit: Number(fd.get('credit_limit') ?? 0) || 0,
      payment_terms_days: Number(fd.get('payment_terms_days') ?? 30) || 30,
      status: String(fd.get('status') ?? 'active') as 'active' | 'inactive' | 'archived',
    };

    if (isEdit) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any)
        .from('customer')
        .update(payload)
        .eq('id', customerId);
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      // Auto-close on save: redirect back to the customers list, matching
      // the same flow as Create (and the Parties / Ledger forms).
      router.push('/app/customers');
      router.refresh();
    } else {
      // code omitted for create — trg_customer_autogen_code fills it.
      // Cast supabase via any because the generated types lag the latest
      // migrations (state_code was added in 080).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('customer').insert(payload);
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      router.push('/app/customers');
      router.refresh();
    }
  }

  async function handleArchive() {
    if (!isEdit) return;
    const ok = window.confirm('Archive this customer? It will be hidden from active lists but data is preserved.');
    if (ok === false) return;
    setBusy(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('customer')
      .update({ status: 'archived' })
      .eq('id', customerId);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push('/app/customers');
    router.refresh();
  }

  async function handleDelete() {
    if (!isEdit) return;
    const ok = window.confirm(
      'Permanently delete this customer? This cannot be undone. If invoices or orders reference this customer, deletion will be blocked.',
    );
    if (ok === false) return;
    setBusy(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('customer').delete().eq('id', customerId);
    setBusy(false);
    if (err) {
      setError(err.message + ' — try Archive instead.');
      return;
    }
    router.push('/app/customers');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Customer Code</label>
          <div className="input num bg-cloud/60 text-ink-mute flex items-center cursor-not-allowed select-none">
            {code ?? 'Auto-generated (CUST-XXXX)'}
          </div>
          {!isEdit && (
            <p className="text-[11px] text-ink-mute mt-1">
              Assigned automatically when saved.
            </p>
          )}
        </div>
        <GstinLookup
          onResolve={applyGst}
          defaultValue={values.gstin}
          initialVerifiedAt={values.gstin_verified_at ?? null}
          onVerified={setGstinVerifiedAt}
        />
      </div>

      <div>
        <label className="label">Name *</label>
        <input
          ref={nameRef}
          name="name"
          required
          className="input"
          placeholder="Customer business name"
          defaultValue={values.name}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Contact Person</label>
          <input name="contact_person" className="input" defaultValue={values.contact_person} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            name="phone"
            type="tel"
            className="input num"
            placeholder="+91 98765 43210"
            defaultValue={values.phone}
          />
        </div>
      </div>

      <div>
        <label className="label">Email</label>
        <input name="email" type="email" className="input" defaultValue={values.email} />
      </div>

      <div>
        <label className="label">Billing Address *</label>
        <textarea
          ref={billingRef}
          name="billing_address"
          required
          rows={2}
          className="input mb-2"
          placeholder="Door / street / locality"
          defaultValue={values.billing_address}
        />
        <div className="grid grid-cols-4 gap-2">
          <input ref={cityRef} name="city" className="input" placeholder="City"
            defaultValue={values.city} />
          <input ref={stateRef} name="state" className="input" placeholder="State"
            defaultValue={values.state} />
          <input ref={stateCodeRef} name="state_code" className="input num"
            placeholder="State code (e.g. 33)" maxLength={2}
            defaultValue={values.state_code}
            title="GST state code - first 2 digits of GSTIN. Auto-fills on Verify." />
          <input
            ref={pincodeRef}
            name="pincode"
            className="input num"
            placeholder="641001"
            maxLength={6}
            defaultValue={values.pincode}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="label">Credit Limit (Rs)</label>
          <input
            name="credit_limit"
            type="number"
            min={0}
            step={1000}
            className="input num"
            defaultValue={values.credit_limit}
          />
        </div>
        <div>
          <label className="label">Payment Terms (days)</label>
          <input
            name="payment_terms_days"
            type="number"
            min={0}
            max={180}
            className="input num"
            defaultValue={values.payment_terms_days}
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

      {error && <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{error}</div>}
      {savedMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{savedMsg}</div>
      )}

      {/* Action bar — wraps onto two rows on mobile so the primary Save
          button stays inside the viewport. On wider screens it stays
          as one row, archive/delete on the left, cancel/save on the
          right. */}
      <div className="flex flex-wrap justify-between gap-2 pt-2">
        <div className="flex flex-wrap gap-2">
          {isEdit && (
            <>
              <button
                type="button"
                onClick={handleArchive}
                disabled={busy}
                className="btn-ghost text-amber-700"
                title="Hide from active lists; data preserved"
              >
                <Archive className="w-4 h-4" /> Archive
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="btn-ghost text-red-700"
                title="Permanently delete (blocked by FK if referenced)"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button type="button" onClick={() => router.back()} className="btn-ghost flex-1 sm:flex-none justify-center">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary flex-1 sm:flex-none justify-center">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Customer'}
          </button>
        </div>
      </div>
    </form>
  );
}

'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { GstinLookup, type GstinData } from '@/app/components/gstin-lookup';

export default function NewCustomerPage() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for fields that the GSTIN lookup will auto-fill. We use refs (not state) so
  // the rest of the form remains uncontrolled — keeps the diff small and FormData works.
  const nameRef = useRef<HTMLInputElement>(null);
  const billingRef = useRef<HTMLTextAreaElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  const pincodeRef = useRef<HTMLInputElement>(null);

  function applyGst(d: GstinData) {
    // Only auto-fill empty fields so we don't blow away anything the user typed.
    if (nameRef.current && !nameRef.current.value) {
      nameRef.current.value = d.trade_name || d.legal_name;
    }
    const a = d.address;
    if (a) {
      if (billingRef.current && !billingRef.current.value) {
        const line = [a.building, a.street, a.locality].filter(Boolean).join(', ');
        if (line) billingRef.current.value = line;
      }
      if (cityRef.current && !cityRef.current.value && a.city) cityRef.current.value = a.city;
      // State always gets refreshed — the GSTIN's first 2 digits are authoritative.
      if (stateRef.current && a.state) stateRef.current.value = a.state;
      if (pincodeRef.current && !pincodeRef.current.value && a.pincode) {
        pincodeRef.current.value = a.pincode;
      }
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);

    const billing_address = String(fd.get('billing_address') ?? '').trim();
    if (!billing_address) {
      setBusy(false);
      setError('Billing address is required.');
      return;
    }

    const payload = {
      // `code` is intentionally omitted — the trg_customer_autogen_code trigger
      // assigns the next CUST-XXXX from the doc_sequence registry on insert.
      name: String(fd.get('name') ?? '').trim(),
      gstin: String(fd.get('gstin') ?? '').trim().toUpperCase() || null,
      contact_person: String(fd.get('contact_person') ?? '').trim() || null,
      phone: String(fd.get('phone') ?? '').trim() || null,
      email: String(fd.get('email') ?? '').trim() || null,
      billing_address,
      city: String(fd.get('city') ?? '').trim() || null,
      state: String(fd.get('state') ?? 'Tamil Nadu').trim() || null,
      pincode: String(fd.get('pincode') ?? '').trim() || null,
      credit_limit: Number(fd.get('credit_limit') ?? 0) || 0,
      payment_terms_days: Number(fd.get('payment_terms_days') ?? 30) || 30,
      status: 'active' as const,
    };

    const { error } = await supabase.from('customer').insert(payload);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push('/app/customers');
    router.refresh();
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New Customer"
        crumbs={[{ label: 'Customers', href: '/app/customers' }, { label: 'New' }]}
      />

      <form onSubmit={onSubmit} className="card p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Customer Code</label>
            <div className="input num bg-cloud/60 text-ink-mute flex items-center cursor-not-allowed select-none">
              Auto-generated (CUST-XXXX)
            </div>
            <p className="text-[11px] text-ink-mute mt-1">
              Assigned automatically when saved.
            </p>
          </div>
          <GstinLookup onResolve={applyGst} />
        </div>

        <div>
          <label className="label">Name *</label>
          <input
            ref={nameRef}
            name="name"
            required
            className="input"
            placeholder="Customer business name"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Contact Person</label>
            <input name="contact_person" className="input" />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              name="phone"
              type="tel"
              className="input num"
              placeholder="+91 98765 43210"
            />
          </div>
        </div>

        <div>
          <label className="label">Email</label>
          <input name="email" type="email" className="input" />
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
          />
          <div className="grid grid-cols-3 gap-2">
            <input ref={cityRef} name="city" className="input" placeholder="City" />
            <input
              ref={stateRef}
              name="state"
              className="input"
              defaultValue="Tamil Nadu"
            />
            <input
              ref={pincodeRef}
              name="pincode"
              className="input num"
              placeholder="641001"
              maxLength={6}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Credit Limit (₹)</label>
            <input
              name="credit_limit"
              type="number"
              min={0}
              step={1000}
              className="input num"
              defaultValue={0}
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
              defaultValue={30}
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Create Customer'}
          </button>
        </div>
      </form>
    </div>
  );
}

'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { GstinLookup, type GstinData } from '@/app/components/gstin-lookup';
import type { Database } from '@/lib/database.types';

// `code` is omitted from the payload — trg_mill_autogen_code fills it
// from the doc_sequence registry. We cast to Insert at the call site so
// the rest of the payload is type-checked against the table schema.
type MillInsert = Database['public']['Tables']['mill']['Insert'];

export default function NewMillPage() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPreferred, setIsPreferred] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);

  function applyGst(d: GstinData) {
    if (nameRef.current && !nameRef.current.value) {
      nameRef.current.value = d.trade_name || d.legal_name;
    }
    const a = d.address;
    if (a) {
      if (addressRef.current && !addressRef.current.value) {
        const line = [a.building, a.street, a.locality].filter(Boolean).join(', ');
        if (line) addressRef.current.value = line;
      }
      if (cityRef.current && !cityRef.current.value && a.city) cityRef.current.value = a.city;
      if (stateRef.current && a.state) stateRef.current.value = a.state;
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);

    const name = String(fd.get('name') ?? '').trim();
    if (!name) {
      setBusy(false);
      setError('Mill name is required.');
      return;
    }

    const payload = {
      // `code` is intentionally omitted — trg_mill_autogen_code assigns
      // the next MILL-XXX from the doc_sequence registry on insert.
      name,
      gstin: String(fd.get('gstin') ?? '').trim().toUpperCase() || null,
      contact_person: String(fd.get('contact_person') ?? '').trim() || null,
      phone: String(fd.get('phone') ?? '').trim() || null,
      email: String(fd.get('email') ?? '').trim() || null,
      address: String(fd.get('address') ?? '').trim() || null,
      city: String(fd.get('city') ?? '').trim() || null,
      state: String(fd.get('state') ?? 'Tamil Nadu').trim() || null,
      is_preferred: isPreferred,
      notes: String(fd.get('notes') ?? '').trim() || null,
      status: 'active' as const,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertErr } = await (supabase as any).from('mill').insert(payload as MillInsert);
    setBusy(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    router.push('/app/mills');
    router.refresh();
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New Mill"
        crumbs={[{ label: 'Mills', href: '/app/mills' }, { label: 'New' }]}
      />

      <form onSubmit={onSubmit} className="card p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Mill Code</label>
            <div className="input num bg-cloud/60 text-ink-mute flex items-center cursor-not-allowed select-none">
              Auto-generated (MILL-XXX)
            </div>
            <p className="text-[11px] text-ink-mute mt-1">
              Assigned automatically when saved.
            </p>
          </div>
          <GstinLookup onResolve={applyGst} />
        </div>

        <div>
          <label className="label">Mill Name *</label>
          <input
            ref={nameRef}
            name="name"
            required
            className="input"
            placeholder="Sri Ganapathi Mills Pvt Ltd"
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
          <label className="label">Address</label>
          <textarea
            ref={addressRef}
            name="address"
            rows={2}
            className="input mb-2"
            placeholder="Door / street / locality"
          />
          <div className="grid grid-cols-2 gap-2">
            <input ref={cityRef} name="city" className="input" placeholder="City" />
            <input
              ref={stateRef}
              name="state"
              className="input"
              defaultValue="Tamil Nadu"
            />
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <input name="notes" className="input" placeholder="(optional)" />
        </div>

        <div>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPreferred}
              onChange={(e) => setIsPreferred(e.target.checked)}
            />
            <span className="text-sm">Mark as preferred supplier</span>
          </label>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Saving...' : 'Create Mill'}
          </button>
        </div>
      </form>
    </div>
  );
}

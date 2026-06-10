'use client';
/**
 * Shared Jobwork Party form — used by /new (create) and /[id] (edit).
 * Mirrors the Customer form layout. GSTIN lookup integration can be
 * added later; for now operators type the GSTIN manually.
 *
 * The new-row case can be opened for either `kind='jobwork'` (default)
 * or `kind='outsource'`. The kind picks the prefix series that the
 * BEFORE INSERT trigger (fn_autogen_code, mig 123) will use:
 *   jobwork   → JWP-NNNN   (legacy format)
 *   outsource → OWP/26-27/NNNN
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Trash2, Archive } from 'lucide-react';

export interface JobworkPartyFormValues {
  name: string;
  gstin: string;
  contact_person: string;
  phone: string;
  email: string;
  billing_address: string;
  city: string;
  state: string;
  pincode: string;
  credit_limit: number;
  payment_terms_days: number;
  status: 'active' | 'inactive' | 'archived';
  notes: string;
}

interface JobworkPartyFormProps {
  partyId?: number;
  initial?: Partial<JobworkPartyFormValues>;
  code?: string;
  /** 'jobwork' (default) or 'outsource'. New rows are inserted with
   *  this kind, which drives the auto-issued code prefix via the
   *  fn_autogen_code trigger. Ignored on edit (the existing row's
   *  kind is preserved). */
  kind?: 'jobwork' | 'outsource';
}

const EMPTY: JobworkPartyFormValues = {
  name: '',
  gstin: '',
  contact_person: '',
  phone: '',
  email: '',
  billing_address: '',
  city: '',
  state: 'Tamil Nadu',
  pincode: '',
  credit_limit: 0,
  payment_terms_days: 30,
  status: 'active',
  notes: '',
};

export function JobworkPartyForm({ partyId, initial, code, kind = 'jobwork' }: JobworkPartyFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = typeof partyId === 'number';
  const values: JobworkPartyFormValues = { ...EMPTY, ...(initial ?? {}) };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // Live preview of the next auto-issued code from doc_sequence —
  // matches whichever prefix series this row's `kind` will route to.
  const [nextCodePreview, setNextCodePreview] = useState<string>('');

  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    void (async () => {
      const docType = kind === 'outsource' ? 'outsource_party' : 'jobwork_party';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb
        .from('doc_sequence')
        .select('prefix, format, fy_code, next_value')
        .eq('doc_type', docType)
        .maybeSingle();
      if (cancelled || !data) return;
      const { prefix, format, fy_code, next_value } = data as {
        prefix: string; format: string; fy_code: string; next_value: number;
      };
      const seqMatch = /\{seq:(0+)\}/.exec(format);
      const width = seqMatch?.[1]?.length ?? 4;
      const seqStr = String(next_value).padStart(width, '0');
      const built = format
        .replace('{prefix}', prefix)
        .replace('{fy}', fy_code)
        .replace(/\{seq:0+\}/, seqStr);
      setNextCodePreview(built);
    })();
    return () => { cancelled = true; };
  }, [kind, isEdit, supabase]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    const fd = new FormData(e.currentTarget);

    const billing_address = String(fd.get('billing_address') ?? '').trim();
    const payload = {
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
      status: String(fd.get('status') ?? 'active') as 'active' | 'inactive' | 'archived',
      notes: String(fd.get('notes') ?? '').trim() || null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    if (isEdit) {
      const { error: err } = await sb.from('jobwork_party').update(payload).eq('id', partyId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      // Auto-close on save: redirect back to the list, matching the
      // same flow as Create (and the Parties / Ledger / Customer forms).
      router.push(kind === 'outsource' ? '/app/outsource' : '/app/jobwork-parties');
      router.refresh();
    } else {
      // code omitted - trg_jobwork_party_autogen_code fills it.
      // `kind` is set explicitly so the trigger routes to the correct
      // doc_sequence row (jobwork_party vs outsource_party).
      const insertPayload = { ...payload, kind };
      const { error: err } = await sb.from('jobwork_party').insert(insertPayload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      router.push(kind === 'outsource' ? '/app/outsource' : '/app/jobwork-parties');
      router.refresh();
    }
  }

  async function handleArchive() {
    if (!isEdit) return;
    if (!window.confirm('Archive this jobwork party? Hidden from active lists; data preserved.')) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('jobwork_party').update({ status: 'archived' }).eq('id', partyId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    router.push('/app/jobwork-parties');
    router.refresh();
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!window.confirm('Permanently delete this jobwork party? This cannot be undone. Delete will fail if bobbin records reference this party.')) return;
    setBusy(true); setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('jobwork_party').delete().eq('id', partyId);
    setBusy(false);
    if (err) { setError(err.message + ' - try Archive instead.'); return; }
    router.push('/app/jobwork-parties');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">{kind === 'outsource' ? 'Outsource Weaver Code' : 'Jobwork Party Code'}</label>
          <div className="input num bg-cloud/60 text-ink-mute flex items-center cursor-not-allowed select-none font-mono text-xs">
            {code
              ?? (nextCodePreview
                ? `Auto (${nextCodePreview})`
                : (kind === 'outsource' ? 'Auto-generated (OWP/26-27/NNNN)' : 'Auto-generated (JWP-NNNN)'))}
          </div>
          {!isEdit && (
            <p className="text-[11px] text-ink-mute mt-1">Assigned automatically when saved.</p>
          )}
        </div>
        <div>
          <label className="label">GSTIN</label>
          <input name="gstin" className="input num" placeholder="33AAAAA0000A1Z5"
            maxLength={15} defaultValue={values.gstin} />
        </div>
      </div>

      <div>
        <label className="label">Name *</label>
        <input name="name" required className="input"
          placeholder="Jobwork party business name" defaultValue={values.name} />
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
        <textarea name="billing_address" rows={2} className="input mb-2"
          placeholder="Door / street / locality" defaultValue={values.billing_address} />
        <div className="grid grid-cols-3 gap-2">
          <input name="city" className="input" placeholder="City" defaultValue={values.city} />
          <input name="state" className="input" defaultValue={values.state} />
          <input name="pincode" className="input num" placeholder="641001"
            maxLength={6} defaultValue={values.pincode} />
        </div>
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
        <label className="label">Notes</label>
        <textarea name="notes" rows={2} className="input"
          placeholder="Optional internal notes" defaultValue={values.notes} />
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
            {isEdit
              ? 'Save Changes'
              : kind === 'outsource' ? 'Create Outsource Weaver' : 'Create Jobwork Party'}
          </button>
        </div>
      </div>
    </form>
  );
}

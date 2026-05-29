'use client';
/**
 * Shared mill form — used by /new (create) and /[id] (edit).
 *
 * GSTIN-lookup auto-fills name + address fields via refs so the rest of
 * the form can stay uncontrolled and rely on FormData submission.
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { GstinLookup, type GstinData } from '@/app/components/gstin-lookup';
import type { Database } from '@/lib/database.types';
import { Loader2, Trash2, Archive } from 'lucide-react';

type MillInsert = Database['public']['Tables']['mill']['Insert'];

export interface MillFormValues {
  name: string;
  gstin: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  is_preferred: boolean;
  notes: string;
  status: 'active' | 'inactive' | 'archived';
}

interface MillFormProps {
  /** If supplied, the form is in edit mode. Otherwise create mode. */
  millId?: number;
  /** Pre-existing values (edit mode) or sensible defaults. */
  initial?: Partial<MillFormValues>;
  /** Existing code, displayed read-only. */
  code?: string;
}

const EMPTY: MillFormValues = {
  name: '',
  gstin: '',
  contact_person: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  state: 'Tamil Nadu',
  is_preferred: false,
  notes: '',
  status: 'active',
};

export function MillForm({ millId, initial, code }: MillFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = typeof millId === 'number';
  const values: MillFormValues = { ...EMPTY, ...(initial ?? {}) };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [isPreferred, setIsPreferred] = useState<boolean>(values.is_preferred);

  const nameRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);

  function applyGst(d: GstinData) {
    if (nameRef.current && nameRef.current.value === '') {
      nameRef.current.value = d.trade_name || d.legal_name;
    }
    const a = d.address;
    if (a) {
      if (addressRef.current && addressRef.current.value === '') {
        const line = [a.building, a.street, a.locality].filter(Boolean).join(', ');
        if (line) addressRef.current.value = line;
      }
      if (cityRef.current && cityRef.current.value === '' && a.city) {
        cityRef.current.value = a.city;
      }
      if (stateRef.current && a.state) stateRef.current.value = a.state;
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    const fd = new FormData(e.currentTarget);

    const name = String(fd.get('name') ?? '').trim();
    if (name === '') {
      setBusy(false);
      setError('Mill name is required.');
      return;
    }

    const payload = {
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
      status: String(fd.get('status') ?? 'active') as 'active' | 'inactive' | 'archived',
    };

    if (isEdit) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any)
        .from('mill')
        .update(payload)
        .eq('id', millId);
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      setSavedMsg('Saved.');
      router.refresh();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any)
        .from('mill')
        .insert(payload as MillInsert);
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      router.push('/app/mills');
      router.refresh();
    }
  }

  async function handleArchive() {
    if (!isEdit) return;
    const ok = window.confirm('Archive this mill? It will be hidden from active lists but data is preserved.');
    if (ok === false) return;
    setBusy(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any)
      .from('mill')
      .update({ status: 'archived' })
      .eq('id', millId);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push('/app/mills');
    router.refresh();
  }

  async function handleDelete() {
    if (!isEdit) return;
    const ok = window.confirm(
      'Permanently delete this mill? This cannot be undone. If yarn lots or bobbins reference this mill, deletion will be blocked.',
    );
    if (ok === false) return;
    setBusy(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('mill').delete().eq('id', millId);
    setBusy(false);
    if (err) {
      setError(err.message + ' — try Archive instead.');
      return;
    }
    router.push('/app/mills');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Mill Code</label>
          <div className="input num bg-cloud/60 text-ink-mute flex items-center cursor-not-allowed select-none">
            {code ?? 'Auto-generated (MILL-XXX)'}
          </div>
          {!isEdit && (
            <p className="text-[11px] text-ink-mute mt-1">
              Assigned automatically when saved.
            </p>
          )}
        </div>
        <GstinLookup onResolve={applyGst} defaultValue={values.gstin} />
      </div>

      <div>
        <label className="label">Mill Name *</label>
        <input
          ref={nameRef}
          name="name"
          required
          className="input"
          placeholder="Sri Ganapathi Mills Pvt Ltd"
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
        <label className="label">Address</label>
        <textarea
          ref={addressRef}
          name="address"
          rows={2}
          className="input mb-2"
          placeholder="Door / street / locality"
          defaultValue={values.address}
        />
        <div className="grid grid-cols-2 gap-2">
          <input ref={cityRef} name="city" className="input" placeholder="City" defaultValue={values.city} />
          <input ref={stateRef} name="state" className="input" defaultValue={values.state} />
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <input name="notes" className="input" placeholder="(optional)" defaultValue={values.notes} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Status</label>
          <select name="status" className="input" defaultValue={values.status}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPreferred}
              onChange={(e) => setIsPreferred(e.target.checked)}
            />
            <span className="text-sm">Mark as preferred supplier</span>
          </label>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{error}</div>}
      {savedMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{savedMsg}</div>
      )}

      <div className="flex justify-between gap-2 pt-2">
        <div className="flex gap-2">
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
        <div className="flex gap-2">
          <button type="button" onClick={() => router.back()} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Mill'}
          </button>
        </div>
      </div>
    </form>
  );
}

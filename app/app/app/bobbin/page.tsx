'use client';
/**
 * Bobbin Stock - purchase log of every bobbin batch the mill has bought.
 *
 * Each row is one purchase: code BB-{ends}-{metres} auto-generated, the
 * description (display name) auto-formats as "{ends}-ends x {metres}m",
 * plus purchase date, supplier (mill), invoice no, quantity, price/pc,
 * GST % and total (auto = qty * price * (1 + gst/100), stored as a
 * Postgres GENERATED column).
 *
 * Mandatory fields: ends, metres, quantity, purchase_date, invoice_no.
 *
 * The form is hidden by default. Click "Add Purchase" to reveal a blank
 * form, or click "Edit" on any row to load it into the form for changes.
 *
 * RLS: anyone authenticated reads; owner / mill_manager writes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2, Pencil, X, Save } from 'lucide-react';

type RecordStatus = 'active' | 'inactive' | 'archived';

interface Bobbin {
  id: number;
  code: string;
  description: string;
  ends_per_bobbin: number;
  bobbin_metre: number;
  bobbin_price: number;
  quantity: number;
  gst_pct: number;
  total_amount: number;
  is_lurex: boolean;
  vendor_id: number | null;
  purchase_date: string | null;
  invoice_no: string | null;
  production_mode: 'inhouse' | 'jobwork' | null;
  jobwork_party_id: number | null;
  status: RecordStatus;
  notes: string | null;
}

interface MillOption {
  id: number;
  code: string;
  name: string;
}

interface JobworkPartyOption {
  id: number;
  code: string;
  name: string;
}

interface FormState {
  ends_per_bobbin: string;
  bobbin_metre: string;
  bobbin_price: string;
  quantity: string;
  gst_pct: string;
  vendor_id: string;
  purchase_date: string;
  invoice_no: string;
  is_lurex: boolean;
  notes: string;
  production_mode: 'inhouse' | 'jobwork';
  jobwork_party_id: string;
}

const EMPTY_FORM: FormState = {
  ends_per_bobbin: '',
  bobbin_metre: '',
  bobbin_price: '0',
  quantity: '',
  gst_pct: '18',
  vendor_id: '',
  purchase_date: '',
  invoice_no: '',
  is_lurex: false,
  notes: '',
  production_mode: 'inhouse',
  jobwork_party_id: '',
};

function toNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildDescription(ends: number | null, metres: number | null): string {
  if (ends === null || metres === null) return '';
  return String(ends) + '-ends x ' + String(metres) + 'm';
}

function fmtDate(s: string | null): string {
  if (s === null || s === '') return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + String(d.getFullYear());
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function BobbinPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<Bobbin[]>([]);
  const [mills, setMills] = useState<MillOption[]>([]);
  const [jobworkParties, setJobworkParties] = useState<JobworkPartyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [bobbinRes, millRes, jwpRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('bobbin')
        .select('id, code, description, ends_per_bobbin, bobbin_metre, bobbin_price, quantity, gst_pct, total_amount, is_lurex, vendor_id, purchase_date, invoice_no, production_mode, jobwork_party_id, status, notes')
        .neq('status', 'archived')
        .order('purchase_date', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('mill')
        .select('id, code, name')
        .neq('status', 'archived')
        .order('name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('jobwork_party')
        .select('id, code, name')
        .eq('status', 'active')
        .order('name'),
    ]);
    if (bobbinRes.error) {
      setError(bobbinRes.error.message);
    } else if (millRes.error) {
      setError(millRes.error.message);
    } else if (jwpRes.error) {
      setError(jwpRes.error.message);
    } else {
      setRows((bobbinRes.data ?? []) as unknown as Bobbin[]);
      setMills((millRes.data ?? []) as unknown as MillOption[]);
      setJobworkParties((jwpRes.data ?? []) as unknown as JobworkPartyOption[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const ends = useMemo<number | null>(() => toNumOrNull(form.ends_per_bobbin), [form.ends_per_bobbin]);
  const metres = useMemo<number | null>(() => toNumOrNull(form.bobbin_metre), [form.bobbin_metre]);
  const descPreview = useMemo<string>(() => buildDescription(ends, metres), [ends, metres]);

  const totalPreview = useMemo<number>(() => {
    const qty = toNumOrNull(form.quantity) ?? 0;
    const price = toNumOrNull(form.bobbin_price) ?? 0;
    const gst = toNumOrNull(form.gst_pct) ?? 0;
    const raw = qty * price * (1 + gst / 100);
    return Math.round(raw * 100) / 100;
  }, [form.quantity, form.bobbin_price, form.gst_pct]);

  function openNewForm() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, purchase_date: todayISO() });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function openEditForm(b: Bobbin) {
    setEditingId(b.id);
    setForm({
      ends_per_bobbin: String(b.ends_per_bobbin),
      bobbin_metre:    String(b.bobbin_metre),
      bobbin_price:    String(b.bobbin_price),
      quantity:        String(b.quantity),
      gst_pct:         String(b.gst_pct),
      vendor_id:       b.vendor_id === null ? '' : String(b.vendor_id),
      purchase_date:   b.purchase_date ?? '',
      invoice_no:      b.invoice_no ?? '',
      is_lurex:        b.is_lurex,
      notes:           b.notes ?? '',
      production_mode: b.production_mode === 'jobwork' ? 'jobwork' : 'inhouse',
      jobwork_party_id: b.jobwork_party_id === null ? '' : String(b.jobwork_party_id),
    });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    setError(null);
    setSavedMsg(null);

    if (ends === null || ends <= 0) { setError('Enter a positive ends-per-bobbin.'); return; }
    if (metres === null || metres <= 0) { setError('Enter a positive bobbin length (metres).'); return; }

    const qty = toNumOrNull(form.quantity);
    if (qty === null || qty <= 0) { setError('Quantity is required.'); return; }
    if (form.purchase_date.trim() === '') { setError('Purchase date is required.'); return; }
    if (form.invoice_no.trim() === '')    { setError('Invoice number is required.'); return; }
    if (form.production_mode === 'jobwork' && form.jobwork_party_id === '') {
      setError('Pick the jobwork party for this purchase.');
      return;
    }

    const description = buildDescription(ends, metres);

    const payload = {
      // code omitted - trg_bobbin_autogen_code fills it server-side (BB-NNNN).
      description,
      ends_per_bobbin: ends,
      bobbin_metre: metres,
      bobbin_price: toNumOrNull(form.bobbin_price) ?? 0,
      quantity: Math.trunc(qty),
      gst_pct: toNumOrNull(form.gst_pct) ?? 0,
      vendor_id: form.vendor_id === '' ? null : Number(form.vendor_id),
      purchase_date: form.purchase_date,
      invoice_no: form.invoice_no.trim(),
      is_lurex: form.is_lurex,
      notes: form.notes.trim() === '' ? null : form.notes.trim(),
      production_mode: form.production_mode,
      jobwork_party_id: form.production_mode === 'jobwork' && form.jobwork_party_id !== ''
        ? Number(form.jobwork_party_id) : null,
      status: 'active' as const,
    };

    setBusy(true);
    if (editingId === null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('bobbin').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Added purchase ' + description + '.');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('bobbin').update(payload).eq('id', editingId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Updated ' + description + '.');
    }
    closeForm();
    await load();
  }

  async function deleteRow(id: number, code: string) {
    const ok = window.confirm('Delete bobbin purchase ' + code + '?\n\nIf bobbin_stock rows reference this, the database will block the delete.');
    if (ok === false) return;
    setError(null);
    setSavedMsg(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('bobbin').delete().eq('id', id);
    if (err) {
      const archiveOk = window.confirm('Hard delete failed (' + err.message + ').\n\nArchive it instead so it stops appearing in lists?');
      if (archiveOk) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('bobbin').update({ status: 'archived' }).eq('id', id);
        setRows((prev) => prev.filter((r) => r.id !== id));
        setSavedMsg('Archived ' + code + '.');
      } else {
        setError(err.message);
      }
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Deleted ' + code + '.');
  }

  function millLabel(id: number | null): string {
    if (id === null) return '-';
    const m = mills.find((x) => x.id === id);
    return m ? m.code + ' - ' + m.name : '#' + String(id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bobbin Stock"
        subtitle="Log of every bobbin batch purchased. Code, display name and total auto-calculate."
        actions={
          formOpen ? (
            <button type="button" className="btn-ghost" onClick={closeForm}>
              <X className="w-4 h-4" /> Close form
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={openNewForm}>
              <Plus className="w-4 h-4" /> Add Purchase
            </button>
          )
        }
      />

      {error && <p className="text-sm text-err">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      {formOpen && (
        <div className="card p-5 space-y-3">
          <h2 className="font-display font-bold text-base">
            {editingId === null ? 'New bobbin purchase' : 'Edit bobbin purchase'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label">Code (auto)</label>
              <div className="input bg-cloud/40 text-ink-mute select-none">
                Auto (BB-NNNN)
              </div>
            </div>
            <div>
              <label className="label" htmlFor="b-ends">Ends per bobbin *</label>
              <input
                id="b-ends"
                type="number"
                min={1}
                step="1"
                className="input num w-full"
                placeholder="60"
                value={form.ends_per_bobbin}
                onChange={(e) => setForm((f) => ({ ...f, ends_per_bobbin: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="b-metre">Length (m) *</label>
              <input
                id="b-metre"
                type="number"
                min={0}
                step="0.01"
                className="input num w-full"
                placeholder="200"
                value={form.bobbin_metre}
                onChange={(e) => setForm((f) => ({ ...f, bobbin_metre: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Display name (auto)</label>
              <div className="input bg-cloud/40 text-ink-soft select-none">
                {descPreview || '-'}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="b-qty">Quantity (pcs) *</label>
              <input
                id="b-qty"
                type="number"
                min={1}
                step="1"
                className="input num w-full"
                placeholder="500"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="b-price">Price (Rs/pc)</label>
              <input
                id="b-price"
                type="number"
                min={0}
                step="0.01"
                className="input num w-full"
                value={form.bobbin_price}
                onChange={(e) => setForm((f) => ({ ...f, bobbin_price: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="b-gst">GST %</label>
              <input
                id="b-gst"
                type="number"
                min={0}
                step="0.01"
                className="input num w-full"
                value={form.gst_pct}
                onChange={(e) => setForm((f) => ({ ...f, gst_pct: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Total (auto)</label>
              <div className="input num bg-emerald-50 text-emerald-800 font-semibold select-none">
                {fmtMoney(totalPreview)}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="b-vendor">Supplier (mill)</label>
              <select
                id="b-vendor"
                className="input w-full"
                value={form.vendor_id}
                onChange={(e) => setForm((f) => ({ ...f, vendor_id: e.target.value }))}
              >
                <option value="">--- none ---</option>
                {mills.map((m) => (
                  <option key={m.id} value={String(m.id)}>{m.code} - {m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="b-date">Purchase date *</label>
              <input
                id="b-date"
                type="date"
                required
                className="input w-full"
                value={form.purchase_date}
                onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="b-inv">Invoice no *</label>
              <input
                id="b-inv"
                type="text"
                required
                className="input w-full"
                placeholder="INV-12345"
                value={form.invoice_no}
                onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))}
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.is_lurex}
                  onChange={(e) => setForm((f) => ({ ...f, is_lurex: e.target.checked }))}
                />
                <span className="text-xs text-ink-soft">Lurex bobbin</span>
              </label>
            </div>

            <div>
              <label className="label" htmlFor="b-mode">Production mode *</label>
              <select
                id="b-mode"
                className="input w-full"
                value={form.production_mode}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  production_mode: e.target.value === 'jobwork' ? 'jobwork' : 'inhouse',
                  // Clear party when switching back to in-house so a stale
                  // FK doesn't get re-saved on the next edit.
                  jobwork_party_id: e.target.value === 'jobwork' ? f.jobwork_party_id : '',
                }))}
              >
                <option value="inhouse">In-house</option>
                <option value="jobwork">Job work</option>
              </select>
            </div>
            {form.production_mode === 'jobwork' && (
              <div className="md:col-span-3">
                <label className="label" htmlFor="b-jwp">Jobwork party *</label>
                <div className="flex items-stretch gap-1.5">
                  <select
                    id="b-jwp"
                    className="input w-full"
                    value={form.jobwork_party_id}
                    onChange={(e) => setForm((f) => ({ ...f, jobwork_party_id: e.target.value }))}
                  >
                    <option value="">--- pick a party ---</option>
                    {jobworkParties.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.code} - {p.name}</option>
                    ))}
                  </select>
                  <a href="/app/jobwork-parties" target="_blank" rel="noopener noreferrer"
                    title="Add new jobwork party"
                    className="inline-flex items-center justify-center w-9 px-2 rounded-lg border border-line bg-white text-indigo-700 hover:bg-indigo-50 text-base font-bold shrink-0">
                    +
                  </a>
                </div>
              </div>
            )}

            <div className="md:col-span-4">
              <label className="label" htmlFor="b-notes">Notes</label>
              <input
                id="b-notes"
                type="text"
                className="input w-full"
                placeholder="(optional)"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={closeForm} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId === null ? 'Save Purchase' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading purchases...
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No bobbin purchases recorded yet. Click <strong>Add Purchase</strong> to log the first one.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3">Code</th>
                <th className="text-left px-3 py-3">Description</th>
                <th className="text-right px-3 py-3">Qty</th>
                <th className="text-right px-3 py-3">Price Rs</th>
                <th className="text-right px-3 py-3">GST %</th>
                <th className="text-right px-3 py-3">Total Rs</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Supplier</th>
                <th className="text-left px-3 py-3">Purchase date</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Invoice no</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-3 font-mono text-xs">{b.code}</td>
                  <td className="px-3 py-3 font-semibold">{b.description}</td>
                  <td className="px-3 py-3 text-right num">{b.quantity}</td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(b.bobbin_price)}</td>
                  <td className="px-3 py-3 text-right num">{b.gst_pct}</td>
                  <td className="px-3 py-3 text-right num font-semibold text-emerald-700">{fmtMoney(b.total_amount)}</td>
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft">{millLabel(b.vendor_id)}</td>
                  <td className="px-3 py-3 text-ink-soft">{fmtDate(b.purchase_date)}</td>
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft font-mono text-xs">{b.invoice_no ?? '-'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-indigo-50 text-indigo-600"
                        title="Edit this purchase"
                        onClick={() => openEditForm(b)}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-red-50 text-red-600"
                        title="Delete this purchase"
                        onClick={() => deleteRow(b.id, b.code)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

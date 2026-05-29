'use client';
/**
 * Bobbin Stock - purchase log of every bobbin batch the mill has bought.
 *
 * Each row is one purchase: code BB-{ends}-{metres} auto-generated, the
 * description (display name) auto-formats as "{ends}-ends x {metres}m",
 * plus purchase date, supplier (mill), invoice no, and price per piece.
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
  is_lurex: boolean;
  vendor_id: number | null;
  purchase_date: string | null;
  invoice_no: string | null;
  status: RecordStatus;
  notes: string | null;
}

interface MillOption {
  id: number;
  code: string;
  name: string;
}

interface FormState {
  ends_per_bobbin: string;
  bobbin_metre: string;
  bobbin_price: string;
  vendor_id: string;
  purchase_date: string;
  invoice_no: string;
  is_lurex: boolean;
  notes: string;
}

const EMPTY_FORM: FormState = {
  ends_per_bobbin: '',
  bobbin_metre: '',
  bobbin_price: '0',
  vendor_id: '',
  purchase_date: '',
  invoice_no: '',
  is_lurex: false,
  notes: '',
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

function buildCode(ends: number | null, metres: number | null): string {
  if (ends === null || metres === null) return '';
  return 'BB-' + String(ends) + '-' + String(metres);
}

function buildDescription(ends: number | null, metres: number | null): string {
  if (ends === null || metres === null) return '';
  return String(ends) + '-ends x ' + String(metres) + 'm';
}

function fmtDate(s: string | null): string {
  if (s === null || s === '') return '-';
  // Display DD-MMM-YYYY (e.g. 29-May-2026).
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + String(d.getFullYear());
}

export default function BobbinPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<Bobbin[]>([]);
  const [mills, setMills] = useState<MillOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [bobbinRes, millRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('bobbin')
        .select('id, code, description, ends_per_bobbin, bobbin_metre, bobbin_price, is_lurex, vendor_id, purchase_date, invoice_no, status, notes')
        .neq('status', 'archived')
        .order('purchase_date', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('mill')
        .select('id, code, name')
        .neq('status', 'archived')
        .order('name'),
    ]);
    if (bobbinRes.error) {
      setError(bobbinRes.error.message);
    } else if (millRes.error) {
      setError(millRes.error.message);
    } else {
      setRows((bobbinRes.data ?? []) as unknown as Bobbin[]);
      setMills((millRes.data ?? []) as unknown as MillOption[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const ends = useMemo<number | null>(() => toNumOrNull(form.ends_per_bobbin), [form.ends_per_bobbin]);
  const metres = useMemo<number | null>(() => toNumOrNull(form.bobbin_metre), [form.bobbin_metre]);
  const codePreview = useMemo<string>(() => buildCode(ends, metres), [ends, metres]);
  const descPreview = useMemo<string>(() => buildDescription(ends, metres), [ends, metres]);

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
      vendor_id:       b.vendor_id === null ? '' : String(b.vendor_id),
      purchase_date:   b.purchase_date ?? '',
      invoice_no:      b.invoice_no ?? '',
      is_lurex:        b.is_lurex,
      notes:           b.notes ?? '',
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

    if (ends === null || ends <= 0) {
      setError('Enter a positive ends-per-bobbin.');
      return;
    }
    if (metres === null || metres <= 0) {
      setError('Enter a positive bobbin length (metres).');
      return;
    }
    const code = buildCode(ends, metres);
    const description = buildDescription(ends, metres);

    // If creating, guard against duplicate codes (same ends + metres).
    if (editingId === null && rows.some((r) => r.code.toLowerCase() === code.toLowerCase())) {
      setError('A bobbin with code "' + code + '" already exists. Pick Edit on that row instead.');
      return;
    }

    const payload = {
      code,
      description,
      ends_per_bobbin: ends,
      bobbin_metre: metres,
      bobbin_price: toNumOrNull(form.bobbin_price) ?? 0,
      vendor_id: form.vendor_id === '' ? null : Number(form.vendor_id),
      purchase_date: form.purchase_date === '' ? null : form.purchase_date,
      invoice_no: form.invoice_no.trim() === '' ? null : form.invoice_no.trim(),
      is_lurex: form.is_lurex,
      notes: form.notes.trim() === '' ? null : form.notes.trim(),
      status: 'active' as const,
      // loading_per_metre and reorder_pieces stay at their column defaults (0).
    };

    setBusy(true);
    if (editingId === null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('bobbin').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Added purchase ' + code + '.');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('bobbin').update(payload).eq('id', editingId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Updated ' + code + '.');
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
        subtitle="Log of every bobbin batch purchased. Code and display name auto-generate from ends and metres."
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
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-base">
              {editingId === null ? 'New bobbin purchase' : 'Edit bobbin purchase'}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label">Code (auto)</label>
              <div className="input bg-cloud/40 text-ink-mute select-none">
                {codePreview || 'BB-???-???'}
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
              <label className="label" htmlFor="b-date">Purchase date</label>
              <input
                id="b-date"
                type="date"
                className="input w-full"
                value={form.purchase_date}
                onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="b-inv">Invoice no</label>
              <input
                id="b-inv"
                type="text"
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
            <div className="md:col-span-3">
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
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-right px-4 py-3">Ends</th>
                <th className="text-right px-4 py-3">Length (m)</th>
                <th className="text-right px-4 py-3">Price Rs</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Supplier</th>
                <th className="text-left px-4 py-3">Purchase date</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Invoice no</th>
                <th className="text-center px-4 py-3">Lurex</th>
                <th className="text-right px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3 font-mono text-xs">{b.code}</td>
                  <td className="px-4 py-3 font-semibold">{b.description}</td>
                  <td className="px-4 py-3 text-right num">{b.ends_per_bobbin}</td>
                  <td className="px-4 py-3 text-right num">{b.bobbin_metre}</td>
                  <td className="px-4 py-3 text-right num">{b.bobbin_price}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-ink-soft">{millLabel(b.vendor_id)}</td>
                  <td className="px-4 py-3 text-ink-soft">{fmtDate(b.purchase_date)}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-ink-soft font-mono text-xs">{b.invoice_no ?? '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {b.is_lurex ? <span className="pill bg-amber-50 text-amber-700">lurex</span> : <span className="text-ink-mute">-</span>}
                  </td>
                  <td className="px-4 py-3">
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

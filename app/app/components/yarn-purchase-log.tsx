'use client';
/**
 * Shared "yarn purchase log" component. Used by /yarn-stock and
 * /porvai-yarn-stock - the only difference between the two screens is
 * the yarn_kind discriminator passed in via props.
 *
 * UX matches Bobbin Stock: list view by default with an "Add Purchase"
 * button revealing the form. lot_code is auto-generated server-side via
 * the 'lot' doc_sequence (LOT-NNNN).
 *
 * Mandatory: yarn_count, mill, received_date, received_kg, invoice_no.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2, Pencil, X, Save } from 'lucide-react';

type YarnKind = 'yarn' | 'porvai';

interface Lot {
  id: number;
  lot_code: string;
  yarn_count_id: number;
  mill_id: number;
  received_date: string;
  received_kg: number;
  cost_per_kg: number;
  gst_pct: number;
  total_amount: number;
  invoice_no: string | null;
  notes: string | null;
}

interface CountOption { id: number; code: string; display_name: string; }
interface MillOption  { id: number; code: string; name: string; }

interface FormState {
  yarn_count_id: string;
  mill_id: string;
  received_date: string;
  received_kg: string;
  cost_per_kg: string;
  gst_pct: string;
  invoice_no: string;
  notes: string;
}

const EMPTY: FormState = {
  yarn_count_id: '',
  mill_id: '',
  received_date: '',
  received_kg: '',
  cost_per_kg: '',
  gst_pct: '5',
  invoice_no: '',
  notes: '',
};

function toNumOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

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

export interface YarnPurchaseLogProps {
  yarnKind: YarnKind;
  title: string;
  subtitle: string;
}

export function YarnPurchaseLog({ yarnKind, title, subtitle }: YarnPurchaseLogProps) {
  const supabase = createClient();

  const [rows, setRows] = useState<Lot[]>([]);
  const [counts, setCounts] = useState<CountOption[]>([]);
  const [mills, setMills] = useState<MillOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [lotRes, countRes, millRes] = await Promise.all([
      sb.from('yarn_lot')
        .select('id, lot_code, yarn_count_id, mill_id, received_date, received_kg, cost_per_kg, gst_pct, total_amount, invoice_no, notes')
        .eq('yarn_kind', yarnKind)
        .order('received_date', { ascending: false })
        .order('id', { ascending: false }),
      sb.from('yarn_count').select('id, code, display_name').neq('status', 'archived').order('code'),
      sb.from('mill').select('id, code, name').neq('status', 'archived').order('name'),
    ]);
    if (lotRes.error) setError(lotRes.error.message);
    else if (countRes.error) setError(countRes.error.message);
    else if (millRes.error) setError(millRes.error.message);
    else {
      setRows((lotRes.data ?? []) as unknown as Lot[]);
      setCounts((countRes.data ?? []) as unknown as CountOption[]);
      setMills((millRes.data ?? []) as unknown as MillOption[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase, yarnKind]);

  useEffect(() => { void load(); }, [load]);

  const totalPreview = useMemo<number>(() => {
    const qty = toNumOrNull(form.received_kg) ?? 0;
    const rate = toNumOrNull(form.cost_per_kg) ?? 0;
    const gst = toNumOrNull(form.gst_pct) ?? 0;
    return Math.round(qty * rate * (1 + gst / 100) * 100) / 100;
  }, [form.received_kg, form.cost_per_kg, form.gst_pct]);

  function openNewForm() {
    setEditingId(null);
    setForm({ ...EMPTY, received_date: todayISO() });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function openEditForm(l: Lot) {
    setEditingId(l.id);
    setForm({
      yarn_count_id: String(l.yarn_count_id),
      mill_id:       String(l.mill_id),
      received_date: l.received_date,
      received_kg:   String(l.received_kg),
      cost_per_kg:   String(l.cost_per_kg),
      gst_pct:       String(l.gst_pct),
      invoice_no:    l.invoice_no ?? '',
      notes:         l.notes ?? '',
    });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY);
  }

  async function handleSave() {
    setError(null);
    setSavedMsg(null);

    const yarnCountId = form.yarn_count_id === '' ? null : Number(form.yarn_count_id);
    const millId      = form.mill_id === '' ? null : Number(form.mill_id);
    const receivedKg  = toNumOrNull(form.received_kg);
    const costPerKg   = toNumOrNull(form.cost_per_kg);
    const gst         = toNumOrNull(form.gst_pct) ?? 0;

    if (yarnCountId === null) { setError('Yarn count is required.'); return; }
    if (millId === null)      { setError('Supplier mill is required.'); return; }
    if (form.received_date.trim() === '') { setError('Purchase date is required.'); return; }
    if (receivedKg === null || receivedKg <= 0) { setError('Quantity (kg) is required.'); return; }
    if (costPerKg === null || costPerKg < 0)    { setError('Rate per kg is required.'); return; }
    if (form.invoice_no.trim() === '')          { setError('Invoice number is required.'); return; }

    const payload = {
      // lot_code omitted - 'lot' doc_sequence trigger fills it.
      yarn_kind: yarnKind,
      yarn_count_id: yarnCountId,
      mill_id: millId,
      received_date: form.received_date,
      received_kg: receivedKg,
      cost_per_kg: costPerKg,
      gst_pct: gst,
      invoice_no: form.invoice_no.trim(),
      notes: form.notes.trim() === '' ? null : form.notes.trim(),
      ...(editingId === null
        ? {
            current_kg: receivedKg,
            delivery_destination: 'warehouse' as const,
          }
        : {}),
    };

    setBusy(true);
    if (editingId === null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('yarn_lot').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Added purchase.');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('yarn_lot').update(payload).eq('id', editingId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Updated.');
    }
    closeForm();
    await load();
  }

  async function deleteRow(id: number, lotCode: string) {
    const ok = window.confirm('Delete yarn lot ' + lotCode + '?\n\nIf any downstream record references this lot, the database will block the delete.');
    if (ok === false) return;
    setError(null);
    setSavedMsg(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('yarn_lot').delete().eq('id', id);
    if (err) { setError(err.message); return; }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Deleted ' + lotCode + '.');
  }

  function countLabel(id: number): string {
    const c = counts.find((x) => x.id === id);
    return c ? c.code + ' - ' + c.display_name : '#' + String(id);
  }
  function millLabel(id: number): string {
    const m = mills.find((x) => x.id === id);
    return m ? m.code + ' - ' + m.name : '#' + String(id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
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
          <CheckCircle2 className="h-4 w-4" /> {savedMsg}
        </p>
      )}

      {formOpen && (
        <div className="card p-5 space-y-3">
          <h2 className="font-display font-bold text-base">
            {editingId === null ? 'New purchase' : 'Edit purchase'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label">Lot code (auto)</label>
              <div className="input bg-cloud/40 text-ink-mute select-none">Auto (LOT-NNNN)</div>
            </div>
            <div>
              <label className="label" htmlFor="y-count">Yarn count *</label>
              <select id="y-count" className="input w-full"
                value={form.yarn_count_id}
                onChange={(e) => setForm((f) => ({ ...f, yarn_count_id: e.target.value }))}>
                <option value="">--- pick ---</option>
                {counts.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.code} - {c.display_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="y-mill">Mill (supplier) *</label>
              <select id="y-mill" className="input w-full"
                value={form.mill_id}
                onChange={(e) => setForm((f) => ({ ...f, mill_id: e.target.value }))}>
                <option value="">--- pick ---</option>
                {mills.map((m) => (
                  <option key={m.id} value={String(m.id)}>{m.code} - {m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="y-date">Purchase date *</label>
              <input id="y-date" type="date" required className="input w-full"
                value={form.received_date}
                onChange={(e) => setForm((f) => ({ ...f, received_date: e.target.value }))} />
            </div>

            <div>
              <label className="label" htmlFor="y-qty">Quantity (kg) *</label>
              <input id="y-qty" type="number" min={0} step="0.001" className="input num w-full"
                value={form.received_kg}
                onChange={(e) => setForm((f) => ({ ...f, received_kg: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="y-rate">Rate (Rs/kg) *</label>
              <input id="y-rate" type="number" min={0} step="0.01" className="input num w-full"
                value={form.cost_per_kg}
                onChange={(e) => setForm((f) => ({ ...f, cost_per_kg: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="y-gst">GST %</label>
              <input id="y-gst" type="number" min={0} step="0.01" className="input num w-full"
                value={form.gst_pct}
                onChange={(e) => setForm((f) => ({ ...f, gst_pct: e.target.value }))} />
            </div>
            <div>
              <label className="label">Total (auto)</label>
              <div className="input num bg-emerald-50 text-emerald-800 font-semibold select-none">
                {fmtMoney(totalPreview)}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="y-inv">Invoice no *</label>
              <input id="y-inv" type="text" required className="input w-full" placeholder="INV-12345"
                value={form.invoice_no}
                onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))} />
            </div>
            <div className="md:col-span-3">
              <label className="label" htmlFor="y-notes">Notes</label>
              <input id="y-notes" type="text" className="input w-full" placeholder="(optional)"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={closeForm} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId === null ? 'Save Purchase' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading purchases...
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No purchases recorded yet. Click <strong>Add Purchase</strong> to log the first one.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-3">Lot</th>
                <th className="text-left px-3 py-3">Yarn count</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Mill</th>
                <th className="text-right px-3 py-3">Qty (kg)</th>
                <th className="text-right px-3 py-3">Rate Rs/kg</th>
                <th className="text-right px-3 py-3">GST %</th>
                <th className="text-right px-3 py-3">Total Rs</th>
                <th className="text-left px-3 py-3">Date</th>
                <th className="text-left px-3 py-3 hidden md:table-cell">Invoice</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-3 font-mono text-xs">{l.lot_code}</td>
                  <td className="px-3 py-3 font-semibold">{countLabel(l.yarn_count_id)}</td>
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft">{millLabel(l.mill_id)}</td>
                  <td className="px-3 py-3 text-right num">{l.received_kg}</td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(l.cost_per_kg)}</td>
                  <td className="px-3 py-3 text-right num">{l.gst_pct}</td>
                  <td className="px-3 py-3 text-right num font-semibold text-emerald-700">{fmtMoney(l.total_amount)}</td>
                  <td className="px-3 py-3 text-ink-soft">{fmtDate(l.received_date)}</td>
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft font-mono text-xs">{l.invoice_no ?? '-'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" className="p-1 rounded hover:bg-indigo-50 text-indigo-600"
                        title="Edit this purchase" onClick={() => openEditForm(l)}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button type="button" className="p-1 rounded hover:bg-red-50 text-red-600"
                        title="Delete this purchase" onClick={() => deleteRow(l.id, l.lot_code)}>
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

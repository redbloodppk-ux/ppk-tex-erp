/**
 * FabricPurchaseLog - purchase log of every fabric batch the mill has
 * bought. Mirrors YarnPurchaseLog but uses fabric_quality for the SKU
 * picker, metres for the quantity, and a rate-unit dropdown so the
 * operator can quote rate per metre OR per piece.
 *
 * Mandatory: quality, supplier, metres, rate, invoice_no.
 *
 * The form is hidden by default; "Add Purchase" reveals it, "Edit"
 * loads an existing row into it.
 */
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, CheckCircle2, Trash2, Pencil, X, Save } from 'lucide-react';

type RateUnit = 'm' | 'pcs';
type Delivery = 'in_house' | 'sizing';

interface FabricRow {
  id: number;
  code: string;
  fabric_quality_id: number | null;
  supplier_party_id: number | null;
  received_date: string;
  received_metres: number;
  received_pieces: number | null;
  rate_unit: RateUnit;
  rate: number;
  gst_pct: number;
  total_amount: number;
  invoice_no: string | null;
  notes: string | null;
  delivery_destination: Delivery;
}

interface QualityOption { id: number; code: string | null; name: string; }
interface SupplierOption { id: number; code: string; name: string; }

interface FormState {
  fabric_quality_id:    string;
  supplier_party_id:    string;
  received_date:        string;
  received_metres:      string;
  received_pieces:      string;
  rate_unit:            RateUnit;
  rate:                 string;
  gst_pct:              string;
  invoice_no:           string;
  notes:                string;
  delivery_destination: Delivery;
}

const EMPTY: FormState = {
  fabric_quality_id:    '',
  supplier_party_id:    '',
  received_date:        '',
  received_metres:      '',
  received_pieces:      '',
  rate_unit:            'm',
  rate:                 '',
  gst_pct:              '5',
  invoice_no:           '',
  notes:                '',
  delivery_destination: 'in_house',
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

function deliveryLabel(d: Delivery): string {
  return d === 'in_house' ? 'In-house warehouse' : 'Sizing warehouse';
}

export function FabricPurchaseLog(): React.ReactElement {
  const supabase = createClient();

  const [rows, setRows] = useState<FabricRow[]>([]);
  const [qualities, setQualities] = useState<QualityOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [formOpen,  setFormOpen]  = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form,      setForm]      = useState<FormState>(EMPTY);
  const [busy,      setBusy]      = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Suppliers come from the unified party table (party_type =
    // 'Mill / Yarn Supplier' for fabric resale buys).
    const ptRes = await sb.from('party_type_master')
      .select('id').eq('name', 'Mill / Yarn Supplier').maybeSingle();
    const supplierTypeId = ptRes.data?.id as number | undefined;

    const [rowsRes, qRes, sRes] = await Promise.all([
      sb.from('fabric_purchase')
        .select('id, code, fabric_quality_id, supplier_party_id, received_date, received_metres, received_pieces, rate_unit, rate, gst_pct, total_amount, invoice_no, notes, delivery_destination')
        .eq('status', 'active')
        .order('received_date', { ascending: false })
        .order('id', { ascending: false }),
      sb.from('fabric_quality')
        .select('id, code, name')
        .eq('active', true)
        .order('name'),
      supplierTypeId
        ? sb.from('party')
            .select('id, code, name')
            .contains('party_type_ids', [supplierTypeId])
            .eq('status', 'active')
            .order('name')
        : Promise.resolve({ data: [] as SupplierOption[], error: null }),
    ]);
    if (rowsRes.error)    setError(rowsRes.error.message);
    else if (qRes.error)  setError(qRes.error.message);
    else if (sRes.error)  setError(sRes.error.message);
    else {
      setRows((rowsRes.data ?? []) as unknown as FabricRow[]);
      setQualities((qRes.data ?? []) as unknown as QualityOption[]);
      setSuppliers((sRes.data ?? []) as unknown as SupplierOption[]);
      setError(null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // Total preview matches the DB GENERATED column: qty × rate × (1 + gst/100),
  // where qty is metres when rate_unit='m' or pieces when 'pcs'.
  const totalPreview = useMemo<number>(() => {
    const rate = toNumOrNull(form.rate) ?? 0;
    const gst  = toNumOrNull(form.gst_pct) ?? 0;
    const qty  = form.rate_unit === 'm'
      ? (toNumOrNull(form.received_metres) ?? 0)
      : (toNumOrNull(form.received_pieces) ?? 0);
    return Math.round(qty * rate * (1 + gst / 100) * 100) / 100;
  }, [form.received_metres, form.received_pieces, form.rate, form.gst_pct, form.rate_unit]);

  function openNewForm(): void {
    setEditingId(null);
    setForm({ ...EMPTY, received_date: todayISO() });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function openEditForm(r: FabricRow): void {
    setEditingId(r.id);
    setForm({
      fabric_quality_id:    r.fabric_quality_id === null ? '' : String(r.fabric_quality_id),
      supplier_party_id:    r.supplier_party_id === null ? '' : String(r.supplier_party_id),
      received_date:        r.received_date,
      received_metres:      String(r.received_metres),
      received_pieces:      r.received_pieces === null ? '' : String(r.received_pieces),
      rate_unit:            r.rate_unit,
      rate:                 String(r.rate),
      gst_pct:              String(r.gst_pct),
      invoice_no:           r.invoice_no ?? '',
      notes:                r.notes ?? '',
      delivery_destination: r.delivery_destination,
    });
    setFormOpen(true);
    setSavedMsg(null);
    setError(null);
  }

  function closeForm(): void {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY);
  }

  async function handleSave(): Promise<void> {
    setError(null);
    setSavedMsg(null);

    const qualityId    = form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id);
    const supplierId   = form.supplier_party_id === '' ? null : Number(form.supplier_party_id);
    const metres       = toNumOrNull(form.received_metres);
    const pieces       = toNumOrNull(form.received_pieces);
    const rate         = toNumOrNull(form.rate);
    const gst          = toNumOrNull(form.gst_pct) ?? 0;

    if (qualityId === null)                       { setError('Fabric quality is required.'); return; }
    if (supplierId === null)                      { setError('Supplier is required.'); return; }
    if (form.received_date.trim() === '')         { setError('Purchase date is required.'); return; }
    if (metres === null || metres <= 0)           { setError('Quantity in metres must be > 0.'); return; }
    if (rate === null || rate < 0)                { setError('Rate is required.'); return; }
    if (form.invoice_no.trim() === '')            { setError('Invoice number is required.'); return; }
    if (form.rate_unit === 'pcs' && (pieces === null || pieces <= 0)) {
      setError('When the rate is per piece, also enter the piece count.');
      return;
    }

    const payload = {
      fabric_quality_id:    qualityId,
      supplier_party_id:    supplierId,
      received_date:        form.received_date,
      received_metres:      metres,
      received_pieces:      pieces,
      rate_unit:            form.rate_unit,
      rate,
      gst_pct:              gst,
      invoice_no:           form.invoice_no.trim(),
      notes:                form.notes.trim() === '' ? null : form.notes.trim(),
      delivery_destination: form.delivery_destination,
      // current_metres is auto-defaulted by a DB trigger to
      // received_metres on insert.
      ...(editingId === null ? { current_metres: metres } : {}),
    };

    setBusy(true);
    if (editingId === null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('fabric_purchase').insert(payload);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Added purchase.');
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: err } = await (supabase as any).from('fabric_purchase').update(payload).eq('id', editingId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Updated.');
    }
    closeForm();
    await load();
  }

  async function deleteRow(id: number, code: string): Promise<void> {
    const ok = window.confirm('Delete fabric purchase ' + code + '?\n\nIf any downstream record references this batch, the database will block the delete.');
    if (ok === false) return;
    setError(null);
    setSavedMsg(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('fabric_purchase').delete().eq('id', id);
    if (err) { setError(err.message); return; }
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Deleted ' + code + '.');
  }

  function qualityLabel(id: number | null): string {
    if (id === null) return '-';
    const q = qualities.find((x) => x.id === id);
    return q ? `${q.code ?? '#' + id} - ${q.name}` : '#' + String(id);
  }
  function supplierLabel(id: number | null): string {
    if (id === null) return '-';
    const s = suppliers.find((x) => x.id === id);
    return s ? s.code + ' - ' + s.name : '#' + String(id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fabric Stock"
        subtitle="Purchase log of every fabric batch bought from a supplier. Code, total and reports update automatically."
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
        <p className="flex items-center gap-1.5 text-sm text-emerald-700">
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
              <label className="label">Fabric code (auto)</label>
              <div className="input bg-cloud/40 text-ink-mute select-none">Auto (FP/26-27/NNNN)</div>
            </div>
            <div>
              <label className="label" htmlFor="fp-quality">Fabric quality *</label>
              <select id="fp-quality" className="input w-full"
                value={form.fabric_quality_id}
                onChange={(e) => setForm((f) => ({ ...f, fabric_quality_id: e.target.value }))}>
                <option value="">--- pick ---</option>
                {qualities.map((q) => (
                  <option key={q.id} value={String(q.id)}>
                    {q.code ?? '#' + q.id} - {q.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fp-supplier">Supplier *</label>
              <select id="fp-supplier" className="input w-full"
                value={form.supplier_party_id}
                onChange={(e) => setForm((f) => ({ ...f, supplier_party_id: e.target.value }))}>
                <option value="">--- pick ---</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.code} - {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fp-date">Purchase date *</label>
              <input id="fp-date" type="date" required className="input w-full"
                value={form.received_date}
                onChange={(e) => setForm((f) => ({ ...f, received_date: e.target.value }))} />
            </div>

            <div>
              <label className="label" htmlFor="fp-metres">Quantity (metres) *</label>
              <input id="fp-metres" type="number" min={0} step="0.01" className="input num w-full"
                value={form.received_metres}
                onChange={(e) => setForm((f) => ({ ...f, received_metres: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="fp-unit">Rate unit *</label>
              <select id="fp-unit" className="input w-full"
                value={form.rate_unit}
                onChange={(e) => setForm((f) => ({ ...f, rate_unit: e.target.value as RateUnit }))}>
                <option value="m">Metres (per metre)</option>
                <option value="pcs">Pieces (per piece)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fp-rate">
                Rate (Rs / {form.rate_unit === 'm' ? 'metre' : 'piece'}) *
              </label>
              <input id="fp-rate" type="number" min={0} step="0.01" className="input num w-full"
                value={form.rate}
                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="fp-gst">GST %</label>
              <input id="fp-gst" type="number" min={0} step="0.01" className="input num w-full"
                value={form.gst_pct}
                onChange={(e) => setForm((f) => ({ ...f, gst_pct: e.target.value }))} />
            </div>

            {form.rate_unit === 'pcs' && (
              <div>
                <label className="label" htmlFor="fp-pcs">Piece count *</label>
                <input id="fp-pcs" type="number" min={0} step="1" className="input num w-full"
                  value={form.received_pieces}
                  onChange={(e) => setForm((f) => ({ ...f, received_pieces: e.target.value }))} />
                <p className="text-[11px] text-ink-mute mt-1">Total = pieces &times; rate.</p>
              </div>
            )}
            <div>
              <label className="label">Total (auto)</label>
              <div className="input num bg-emerald-50 text-emerald-800 font-semibold select-none">
                {fmtMoney(totalPreview)}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fp-dest">Delivery destination *</label>
              <select id="fp-dest" className="input w-full"
                value={form.delivery_destination}
                onChange={(e) => setForm((f) => ({ ...f, delivery_destination: e.target.value as Delivery }))}>
                <option value="in_house">In-house warehouse</option>
                <option value="sizing">Sizing warehouse</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fp-inv">Invoice no *</label>
              <input id="fp-inv" type="text" required className="input w-full" placeholder="INV-12345"
                value={form.invoice_no}
                onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))} />
            </div>

            <div className="md:col-span-4">
              <label className="label" htmlFor="fp-notes">Notes</label>
              <input id="fp-notes" type="text" className="input w-full" placeholder="(optional)"
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
          No fabric purchases recorded yet. Click <strong>Add Purchase</strong> to log the first one.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Code</th>
                <th className="text-left  px-3 py-3">Fabric quality</th>
                <th className="text-left  px-3 py-3 hidden md:table-cell">Supplier</th>
                <th className="text-right px-3 py-3">Metres</th>
                <th className="text-right px-3 py-3">Pieces</th>
                <th className="text-right px-3 py-3">Rate (Rs)</th>
                <th className="text-left  px-3 py-3">Unit</th>
                <th className="text-right px-3 py-3">GST %</th>
                <th className="text-right px-3 py-3">Total Rs</th>
                <th className="text-left  px-3 py-3">Delivery</th>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3 hidden lg:table-cell">Invoice</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-3 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-3 font-semibold">{qualityLabel(r.fabric_quality_id)}</td>
                  <td className="px-3 py-3 hidden md:table-cell text-ink-soft">{supplierLabel(r.supplier_party_id)}</td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(Number(r.received_metres))}</td>
                  <td className="px-3 py-3 text-right num">{r.received_pieces ?? '-'}</td>
                  <td className="px-3 py-3 text-right num">{fmtMoney(Number(r.rate))}</td>
                  <td className="px-3 py-3 text-xs text-ink-soft">{r.rate_unit === 'm' ? 'per metre' : 'per piece'}</td>
                  <td className="px-3 py-3 text-right num">{Number(r.gst_pct)}</td>
                  <td className="px-3 py-3 text-right num font-semibold text-emerald-700">{fmtMoney(Number(r.total_amount))}</td>
                  <td className="px-3 py-3 text-ink-soft">{deliveryLabel(r.delivery_destination)}</td>
                  <td className="px-3 py-3 text-ink-soft">{fmtDate(r.received_date)}</td>
                  <td className="px-3 py-3 hidden lg:table-cell text-ink-soft font-mono text-xs">{r.invoice_no ?? '-'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" className="p-1 rounded hover:bg-indigo-50 text-indigo-600"
                        title="Edit" onClick={() => openEditForm(r)}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button type="button" className="p-1 rounded hover:bg-rose-50 text-rose-600"
                        title="Delete" onClick={() => deleteRow(r.id, r.code)}>
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

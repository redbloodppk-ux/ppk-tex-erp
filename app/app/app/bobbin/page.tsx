'use client';
/**
 * Bobbin Purchase Log — every batch of bobbin pieces the mill buys.
 *
 * After migration 140 the bobbin table is a 1:1 master keyed by
 * (ends_per_bobbin, production_mode), and each restock event lives in
 * bobbin_purchase. This page:
 *
 *   • Add Purchase form (multi-item): pick a bobbin from the master,
 *     enter qty (pcs) + price/pc + gst. Top section (date, supplier,
 *     invoice) is shared across all lines. One Save inserts N
 *     bobbin_purchase rows in a single batch.
 *
 *   • Purchases list: chronological bobbin_purchase rows joined to the
 *     bobbin master for code / ends / m/pc display. Inline edit and
 *     soft-delete.
 *
 *   • By default the master picker shows In-house bobbins
 *     (production_mode = 'inhouse') because this page sits under the
 *     In-house Stock sidebar. Toggle pills let you switch the mode if
 *     you also want to log a Job Work or Outsource bobbin purchase.
 *
 * RLS: anyone authenticated reads; owner / mill_manager writes
 * (enforced on the bobbin_purchase table).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { InhouseStockTabs } from '@/app/components/inhouse-stock-tabs';
import { Loader2, Plus, CheckCircle2, Trash2, X, Save, Pencil, Check } from 'lucide-react';

type ProductionMode = 'inhouse' | 'jobwork' | 'outsource';

const MODE_LABEL: Record<ProductionMode, string> = {
  inhouse: 'In-house',
  jobwork: 'Job Work',
  outsource: 'Outsource',
};

interface BobbinMasterOpt {
  id: number;
  code: string;
  ends_per_bobbin: number;
  bobbin_metre: number | null;
  is_lurex: boolean;
  production_mode: ProductionMode;
}

interface PartyOption {
  id: number;
  code: string;
  name: string;
}

interface PurchaseRow {
  id: number;
  bobbin_id: number;
  purchase_date: string | null;
  invoice_no: string | null;
  vendor_id: number | null;
  pieces_purchased: number | string | null;
  bobbin_metre: number | string | null;
  bobbin_price: number | string | null;
  total_amount: number | string | null;
  notes: string | null;
  bobbin: {
    id: number;
    code: string;
    ends_per_bobbin: number;
    bobbin_metre: number | null;
    is_lurex: boolean;
    production_mode: ProductionMode;
  } | null;
}

interface AddItem {
  bobbin_id: string;
  qty_pcs: string;
  /** Per-piece metres, prefills from the picked bobbin master. Editable
   *  so partial bobbins / short pieces can be recorded for this
   *  purchase — the master's m/pc is NOT changed. */
  metre_per_pc: string;
  price_per_pc: string;
  gst_pct: string;
}

/** Inline-edit state for an existing bobbin_purchase row. The bobbin
 *  master itself is locked — switching bobbins on a saved purchase
 *  is an identity change, so the operator should delete + re-add. */
interface EditRow {
  purchase_date: string;
  invoice_no: string;
  supplier_party_id: string;
  pieces_purchased: string;
  bobbin_metre: string;
  bobbin_price: string;
  notes: string;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeEmptyItem(): AddItem {
  return { bobbin_id: '', qty_pcs: '', metre_per_pc: '', price_per_pc: '', gst_pct: '18' };
}

function fmtMoney(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNumber(v: unknown, fractionDigits = 0): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-IN', { maximumFractionDigits: fractionDigits });
}

export default function BobbinPurchasePage() {
  const supabase = createClient();
  const [bobbinMasters, setBobbinMasters] = useState<BobbinMasterOpt[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [modePick, setModePick] = useState<ProductionMode>('inhouse');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<EditRow>({
    purchase_date: '',
    invoice_no: '',
    supplier_party_id: '',
    pieces_purchased: '',
    bobbin_metre: '',
    bobbin_price: '',
    notes: '',
  });
  const [savingEditId, setSavingEditId] = useState<number | null>(null);

  const [form, setForm] = useState<{
    purchase_date: string;
    invoice_no: string;
    supplier_party_id: string;
    notes: string;
    items: AddItem[];
  }>({
    purchase_date: todayISO(),
    invoice_no: '',
    supplier_party_id: '',
    notes: '',
    items: [makeEmptyItem()],
  });

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Resolve the Bobbin Supplier party_type id so the supplier dropdown
    // stays focused. Falls back to all parties if the type row isn't
    // present yet.
    const ptRes = await sb
      .from('party_type_master')
      .select('id')
      .eq('name', 'Bobbin Supplier')
      .maybeSingle();
    const bobbinSupplierTypeId: number | null = ptRes.data?.id ?? null;

    const [bmRes, supRes, purRes] = await Promise.all([
      sb.from('bobbin')
        .select('id, code, ends_per_bobbin, bobbin_metre, is_lurex, production_mode')
        .neq('status', 'archived')
        .order('production_mode')
        .order('ends_per_bobbin'),
      bobbinSupplierTypeId === null
        ? sb.from('party').select('id, code, name').eq('status', 'active').order('name')
        : sb.from('party').select('id, code, name')
            .eq('status', 'active')
            .contains('party_type_ids', [bobbinSupplierTypeId])
            .order('name'),
      sb.from('bobbin_purchase')
        .select(`id, bobbin_id, purchase_date, invoice_no, vendor_id, pieces_purchased,
                 bobbin_metre, bobbin_price, total_amount, notes,
                 bobbin:bobbin_id ( id, code, ends_per_bobbin, bobbin_metre, is_lurex, production_mode )`)
        .order('purchase_date', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false }),
    ]);

    if (bmRes.error)  { setError(bmRes.error.message); setLoading(false); return; }
    if (supRes.error) { setError(supRes.error.message); setLoading(false); return; }
    if (purRes.error) { setError(purRes.error.message); setLoading(false); return; }

    setBobbinMasters((bmRes.data ?? []) as BobbinMasterOpt[]);
    setSuppliers((supRes.data ?? []) as PartyOption[]);
    setPurchases((purRes.data ?? []) as PurchaseRow[]);
    setError(null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const bobbinById = useMemo<Map<number, BobbinMasterOpt>>(() => {
    const m = new Map<number, BobbinMasterOpt>();
    bobbinMasters.forEach((b) => m.set(b.id, b));
    return m;
  }, [bobbinMasters]);

  const supplierById = useMemo<Map<number, PartyOption>>(() => {
    const m = new Map<number, PartyOption>();
    suppliers.forEach((s) => m.set(s.id, s));
    return m;
  }, [suppliers]);

  // Bobbins filtered to the active mode pill (so the line dropdown only
  // surfaces the bobbins matching the current purchase scope).
  const visibleBobbins = useMemo<BobbinMasterOpt[]>(
    () => bobbinMasters.filter((b) => b.production_mode === modePick),
    [bobbinMasters, modePick],
  );

  function reset(): void {
    setForm({
      purchase_date: todayISO(),
      invoice_no: '',
      supplier_party_id: '',
      notes: '',
      items: [makeEmptyItem()],
    });
  }

  function addItemRow(): void {
    setForm((f) => ({ ...f, items: [...f.items, makeEmptyItem()] }));
  }
  function removeItemRow(idx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items,
    }));
  }
  function patchItem(idx: number, patch: Partial<AddItem>): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }
  function pickBobbinForItem(idx: number, bobbinId: string): void {
    const bm = bobbinId === '' ? null : bobbinMasters.find((b) => b.id === Number(bobbinId)) ?? null;
    const prefill = bm?.bobbin_metre != null ? String(bm.bobbin_metre) : '';
    patchItem(idx, { bobbin_id: bobbinId, metre_per_pc: prefill });
  }

  async function save(): Promise<void> {
    setError(null);
    setSavedMsg(null);
    if (!form.purchase_date) { setError('Purchase date is required.'); return; }
    if (!form.invoice_no.trim()) { setError('Invoice no. is required.'); return; }

    const validItems = form.items.filter(
      (it) => it.bobbin_id !== '' && Number(it.qty_pcs) > 0,
    );
    if (validItems.length === 0) {
      setError('Pick a bobbin and enter a positive quantity for at least one line.');
      return;
    }
    const badIdx = form.items.findIndex(
      (it) => it.bobbin_id !== '' && !(Number(it.qty_pcs) > 0),
    );
    if (badIdx !== -1) {
      setError(`Line ${badIdx + 1}: quantity must be greater than zero.`);
      return;
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payloads = validItems.map((it) => {
      const qtyPcs = Number(it.qty_pcs);
      const metre = it.metre_per_pc === '' ? null : Number(it.metre_per_pc);
      const price = it.price_per_pc === '' ? 0 : Number(it.price_per_pc);
      // total_amount is a generated column on bobbin_purchase (pcs *
      // price), so we don't need to write it. GST isn't a column on
      // bobbin_purchase either — capture it in notes so the rate
      // isn't lost.
      const gst = it.gst_pct === '' ? 0 : Number(it.gst_pct);
      const noteSuffix = gst > 0 ? ` · GST ${gst}%` : '';
      return {
        bobbin_id: Number(it.bobbin_id),
        purchase_date: form.purchase_date,
        invoice_no: form.invoice_no.trim(),
        vendor_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
        pieces_purchased: qtyPcs,
        bobbin_metre: metre,
        bobbin_price: price,
        notes: (form.notes.trim() || '') + noteSuffix || null,
      };
    });
    const { error: err } = await sb.from('bobbin_purchase').insert(payloads);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setSavedMsg(`Saved ${payloads.length} purchase line${payloads.length === 1 ? '' : 's'}.`);
    reset();
    setOpen(false);
    await load();
  }

  function startEdit(p: PurchaseRow): void {
    setEditingId(p.id);
    setEditRow({
      purchase_date:    p.purchase_date ?? '',
      invoice_no:       p.invoice_no ?? '',
      supplier_party_id: p.vendor_id == null ? '' : String(p.vendor_id),
      pieces_purchased: p.pieces_purchased == null ? '' : String(p.pieces_purchased),
      bobbin_metre:     p.bobbin_metre == null ? '' : String(p.bobbin_metre),
      bobbin_price:     p.bobbin_price == null ? '' : String(p.bobbin_price),
      notes:            p.notes ?? '',
    });
    setError(null);
    setSavedMsg(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditRow({
      purchase_date: '', invoice_no: '', supplier_party_id: '',
      pieces_purchased: '', bobbin_metre: '', bobbin_price: '', notes: '',
    });
  }

  async function saveEdit(id: number): Promise<void> {
    if (!editRow.purchase_date) { setError('Purchase date is required.'); return; }
    if (!editRow.invoice_no.trim()) { setError('Invoice no. is required.'); return; }
    const qty = Number(editRow.pieces_purchased);
    if (!(qty > 0)) { setError('Qty (pcs) must be greater than 0.'); return; }
    setError(null);
    setSavedMsg(null);
    setSavingEditId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const metre = editRow.bobbin_metre === '' ? null : Number(editRow.bobbin_metre);
    const price = editRow.bobbin_price === '' ? null : Number(editRow.bobbin_price);
    const { error: err } = await sb
      .from('bobbin_purchase')
      .update({
        purchase_date:    editRow.purchase_date,
        invoice_no:       editRow.invoice_no.trim(),
        vendor_id:        editRow.supplier_party_id === '' ? null : Number(editRow.supplier_party_id),
        pieces_purchased: qty,
        bobbin_metre:     metre,
        bobbin_price:     price,
        notes:            editRow.notes.trim() || null,
      })
      .eq('id', id);
    setSavingEditId(null);
    if (err) { setError(err.message); return; }
    cancelEdit();
    await load();
    setSavedMsg('Purchase updated.');
  }

  async function deleteRow(id: number, label: string): Promise<void> {
    const ok = window.confirm(`Delete purchase entry ${label}?\n\nThis hard-deletes the bobbin_purchase row.`);
    if (!ok) return;
    setError(null);
    setSavedMsg(null);
    setDeletingId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('bobbin_purchase').delete().eq('id', id);
    setDeletingId(null);
    if (err) { setError(err.message); return; }
    setPurchases((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg(`Deleted ${label}.`);
  }

  return (
    <div>
      <InhouseStockTabs />
      <PageHeader
        title="Bobbin Stock"
        subtitle="Every bobbin batch purchased. Pick a bobbin from the master, enter qty + price; multiple lines per purchase share the invoice."
        actions={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="btn-primary text-xs flex items-center gap-1"
          >
            {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {open ? 'Close form' : 'Add Purchase'}
          </button>
        }
      />

      {error && <p className="text-sm text-err mb-2">{error}</p>}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-sm text-green-600 mb-2">
          <CheckCircle2 className="h-4 w-4" />
          {savedMsg}
        </p>
      )}

      {open && (
        <div className="card p-3 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-base">New bobbin purchase</h2>
            <div className="flex items-center gap-1">
              {(['inhouse', 'jobwork', 'outsource'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModePick(m)}
                  className={
                    'px-2.5 py-1 rounded text-[11px] font-semibold border ' +
                    (modePick === m
                      ? 'bg-ink text-white border-ink'
                      : 'bg-paper text-ink-soft border-line hover:bg-haze')
                  }
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Top section — shared across every line in this submission */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label text-xs">Purchase date *</label>
              <input
                type="date"
                className="input h-9 text-sm"
                value={form.purchase_date}
                onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Invoice no. *</label>
              <input
                className="input h-9 text-sm"
                placeholder="INV-12345"
                value={form.invoice_no}
                onChange={(e) => setForm({ ...form, invoice_no: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Supplier (optional)</label>
              <select
                className="input h-9 text-sm"
                value={form.supplier_party_id}
                onChange={(e) => setForm({ ...form, supplier_party_id: e.target.value })}
              >
                <option value="">--- none ---</option>
                {suppliers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Notes</label>
              <input
                className="input h-9 text-sm"
                placeholder="(optional)"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          {/* Line items */}
          <div className="border border-line/40 rounded-md overflow-hidden">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-10" />
                <col />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-16" />
                <col className="w-24" />
                <col className="w-10" />
              </colgroup>
              <thead className="bg-cloud/60 text-[10px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Bobbin *</th>
                  <th className="px-2 py-2 text-right">Qty (pcs) *</th>
                  <th className="px-2 py-2 text-right">M/pc</th>
                  <th className="px-2 py-2 text-right">Total (m)</th>
                  <th className="px-2 py-2 text-right">Price (₹/pc)</th>
                  <th className="px-2 py-2 text-right">GST %</th>
                  <th className="px-2 py-2 text-right">Total (₹)</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {form.items.map((it, idx) => {
                  const bm = it.bobbin_id === '' ? null : bobbinById.get(Number(it.bobbin_id)) ?? null;
                  const qty = Number(it.qty_pcs || 0);
                  const mpp = Number(it.metre_per_pc || 0);
                  const price = Number(it.price_per_pc || 0);
                  const gst = Number(it.gst_pct || 0);
                  const totalMetres = qty > 0 && mpp > 0 ? qty * mpp : 0;
                  const total = qty > 0 && price > 0
                    ? qty * price * (1 + gst / 100)
                    : 0;
                  return (
                    <tr key={idx} className="border-t border-line/40 align-middle">
                      <td className="px-2 py-1.5 text-ink-mute">{idx + 1}</td>
                      <td className="px-2 py-1.5">
                        <select
                          className="input h-8 text-xs w-full"
                          value={it.bobbin_id}
                          onChange={(e) => pickBobbinForItem(idx, e.target.value)}
                        >
                          <option value="">--- pick ---</option>
                          {visibleBobbins.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.code} ({b.ends_per_bobbin} ends{b.is_lurex ? ' · lurex' : ''})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={1}
                          className="input num h-8 text-xs w-full text-right"
                          value={it.qty_pcs}
                          onChange={(e) => patchItem(idx, { qty_pcs: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="input num h-8 text-xs w-full text-right"
                          value={it.metre_per_pc}
                          placeholder={bm?.bobbin_metre != null ? String(bm.bobbin_metre) : ''}
                          onChange={(e) => patchItem(idx, { metre_per_pc: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right num text-xs font-semibold text-indigo-700">
                        {totalMetres > 0 ? totalMetres.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="input num h-8 text-xs w-full text-right"
                          value={it.price_per_pc}
                          onChange={(e) => patchItem(idx, { price_per_pc: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="input num h-8 text-xs w-full text-right"
                          value={it.gst_pct}
                          onChange={(e) => patchItem(idx, { gst_pct: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right num text-xs font-semibold">
                        {total > 0 ? fmtMoney(total) : '—'}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeItemRow(idx)}
                          disabled={form.items.length === 1}
                          title="Remove line"
                          className="p-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-cloud/30 border-t border-line/40">
                <tr>
                  <td colSpan={4} className="px-2 py-2">
                    <button
                      type="button"
                      onClick={addItemRow}
                      className="text-xs text-indigo-700 inline-flex items-center gap-1 hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add line
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right num text-xs font-semibold text-indigo-700">
                    {(() => {
                      const grandM = form.items.reduce((s, it) => {
                        const q = Number(it.qty_pcs || 0);
                        const m = Number(it.metre_per_pc || 0);
                        return s + (q > 0 && m > 0 ? q * m : 0);
                      }, 0);
                      return grandM > 0 ? `${grandM.toLocaleString('en-IN', { maximumFractionDigits: 2 })} m` : '—';
                    })()}
                  </td>
                  <td colSpan={2} />
                  <td className="px-2 py-2 text-right num text-xs font-semibold">
                    {(() => {
                      const grand = form.items.reduce((s, it) => {
                        const q = Number(it.qty_pcs || 0);
                        const p = Number(it.price_per_pc || 0);
                        const g = Number(it.gst_pct || 0);
                        return s + (q > 0 && p > 0 ? q * p * (1 + g / 100) : 0);
                      }, 0);
                      return grand > 0 ? `₹ ${fmtMoney(grand)}` : '—';
                    })()}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-[10px] text-ink-mute">
            Bobbins are managed in Settings &rarr; Bobbin Master. Mode pills above the form let you switch between
            In-house / Job Work / Outsource bobbins; the line dropdown is filtered to the picked mode.
            M/pc prefills from the bobbin master but can be overridden for partial bobbins.
          </p>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="btn-secondary text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="btn-primary text-xs flex items-center gap-1"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save all
            </button>
          </div>
        </div>
      )}

      {/* Purchase log */}
      {loading ? (
        <div className="card p-6 flex items-center gap-2 text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading purchases...
        </div>
      ) : purchases.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">
          No bobbin purchases yet. Click <strong>Add Purchase</strong> above to log your first one.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3">Bobbin</th>
                <th className="text-left  px-3 py-3">Mode</th>
                <th className="text-left  px-3 py-3">Supplier</th>
                <th className="text-left  px-3 py-3">Invoice</th>
                <th className="text-right px-3 py-3">Qty (pcs)</th>
                <th className="text-right px-3 py-3">M/pc</th>
                <th className="text-right px-3 py-3">Total (m)</th>
                <th className="text-right px-3 py-3">Price (₹/pc)</th>
                <th className="text-right px-3 py-3">Total (₹)</th>
                <th className="text-left  px-3 py-3">Notes</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const bm = p.bobbin;
                const sup = p.vendor_id != null ? supplierById.get(p.vendor_id) : null;
                const label = bm
                  ? `${bm.code} (${bm.ends_per_bobbin} ends)`
                  : `Bobbin #${p.bobbin_id}`;
                const isEditing = editingId === p.id;
                const isSavingThis = savingEditId === p.id;
                if (isEditing) {
                  const editQty = Number(editRow.pieces_purchased || 0);
                  const editMpp = Number(editRow.bobbin_metre || 0);
                  const editPrice = Number(editRow.bobbin_price || 0);
                  const editTotalM = editQty > 0 && editMpp > 0 ? editQty * editMpp : 0;
                  const editTotalR = editQty > 0 && editPrice > 0 ? editQty * editPrice : 0;
                  return (
                    <tr key={p.id} className="border-t border-line/40 bg-amber-50/40 align-middle">
                      <td className="px-3 py-2">
                        <input type="date" className="input h-8 text-xs"
                          value={editRow.purchase_date}
                          onChange={(e) => setEditRow({ ...editRow, purchase_date: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-ink-soft">
                        {label}
                        <div className="text-[10px] text-ink-mute font-sans">bobbin locked</div>
                      </td>
                      <td className="px-3 py-2">
                        {bm && (
                          <span className={
                            'inline-block px-2 py-0.5 rounded text-[10px] ' +
                            (bm.production_mode === 'inhouse'   ? 'bg-emerald-50 text-emerald-700' :
                             bm.production_mode === 'jobwork'   ? 'bg-amber-50 text-amber-700' :
                                                                  'bg-indigo-50 text-indigo-700')
                          }>{MODE_LABEL[bm.production_mode]}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select className="input h-8 text-xs w-full"
                          value={editRow.supplier_party_id}
                          onChange={(e) => setEditRow({ ...editRow, supplier_party_id: e.target.value })}>
                          <option value="">— none —</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input className="input h-8 text-xs w-full font-mono"
                          value={editRow.invoice_no}
                          onChange={(e) => setEditRow({ ...editRow, invoice_no: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={1} className="input num h-8 text-xs w-full text-right"
                          value={editRow.pieces_purchased}
                          onChange={(e) => setEditRow({ ...editRow, pieces_purchased: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={0} step={0.01} className="input num h-8 text-xs w-full text-right"
                          value={editRow.bobbin_metre}
                          onChange={(e) => setEditRow({ ...editRow, bobbin_metre: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 text-right num text-xs font-semibold text-indigo-700">
                        {editTotalM > 0 ? `${editTotalM.toLocaleString('en-IN', { maximumFractionDigits: 2 })} m` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={0} step={0.01} className="input num h-8 text-xs w-full text-right"
                          value={editRow.bobbin_price}
                          onChange={(e) => setEditRow({ ...editRow, bobbin_price: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 text-right num text-xs font-semibold">
                        {editTotalR > 0 ? fmtMoney(editTotalR) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <input className="input h-8 text-xs w-full"
                          value={editRow.notes}
                          onChange={(e) => setEditRow({ ...editRow, notes: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => saveEdit(p.id)}
                          disabled={isSavingThis}
                          title="Save changes"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          {isSavingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSavingThis}
                          title="Discard changes"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-ink-soft hover:bg-haze ml-1 disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={p.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{p.purchase_date ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{label}</td>
                    <td className="px-3 py-2">
                      {bm && (
                        <span className={
                          'inline-block px-2 py-0.5 rounded text-[10px] ' +
                          (bm.production_mode === 'inhouse'   ? 'bg-emerald-50 text-emerald-700' :
                           bm.production_mode === 'jobwork'   ? 'bg-amber-50 text-amber-700' :
                                                                'bg-indigo-50 text-indigo-700')
                        }>
                          {MODE_LABEL[bm.production_mode]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{sup?.name ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.invoice_no ?? '—'}</td>
                    <td className="px-3 py-2 text-right num">{fmtNumber(p.pieces_purchased, 2)}</td>
                    <td className="px-3 py-2 text-right num text-xs text-ink-soft">{fmtNumber(p.bobbin_metre, 0)}</td>
                    <td className="px-3 py-2 text-right num text-xs font-semibold text-indigo-700">
                      {(() => {
                        const q = Number(p.pieces_purchased ?? 0);
                        const m = Number(p.bobbin_metre ?? 0);
                        const t = q > 0 && m > 0 ? q * m : 0;
                        return t > 0 ? `${t.toLocaleString('en-IN', { maximumFractionDigits: 2 })} m` : '—';
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right num">{fmtMoney(p.bobbin_price)}</td>
                    <td className="px-3 py-2 text-right num font-semibold">{fmtMoney(p.total_amount)}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft">{p.notes ?? ''}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        disabled={editingId !== null || deletingId === p.id}
                        title="Edit this purchase"
                        className="p-1 rounded text-indigo-700 hover:bg-indigo-50 disabled:opacity-30"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRow(p.id, label)}
                        disabled={deletingId === p.id || editingId !== null}
                        title="Delete this purchase"
                        className="p-1 rounded text-rose-600 hover:bg-rose-50 ml-1 disabled:opacity-30"
                      >
                        {deletingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

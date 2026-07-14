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
 *     bobbin master for code / ends / m/pc display. A row's Edit button
 *     reopens the Add form pre-filled; Save then UPDATEs that row.
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
import { Loader2, Plus, CheckCircle2, Trash2, X, Save, Pencil, Check, ArrowLeft, RotateCcw } from 'lucide-react';
import React from 'react';
import { CardFilter } from '@/app/components/card-filter';

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
  round_off: number | string | null;
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
  /** Set when the form is editing an existing invoice — the
   *  bobbin_purchase row this line came from. Lines without a row_id
   *  are new lines added during the edit and get INSERTed. */
  row_id?: number;
}

/** A "Return to Supplier" event — empty / unwanted bobbin pieces being
 *  shipped back to the bobbin's original supplier. Mirrors the jobwork
 *  bobbin_return path but with jobwork_party_id = NULL because the
 *  bobbins were at the mill (in-house), not at a jobworker. */
interface BobbinReturnRow {
  id: number;
  bobbin_id: number;
  supplier_party_id: number | null;
  return_date: string;
  quantity_pcs: number;
  reference_no: string | null;
  notes: string | null;
  status: string;
}

interface ReturnForm {
  return_date: string;
  quantity_pcs: string;
  reference_no: string;
  notes: string;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeEmptyItem(): AddItem {
  return { bobbin_id: '', qty_pcs: '', metre_per_pc: '', price_per_pc: '', gst_pct: '18' };
}

/** GST is stored as a " · GST X%" suffix on the purchase notes (there is
 *  no gst column on bobbin_purchase). These helpers pull it back out so
 *  an invoice edit re-hydrates the form exactly as it was entered. */
function parseGstFromNotes(notes: string | null): string {
  const m = /·\s*GST\s*([\d.]+)%/.exec(notes ?? '');
  return m?.[1] ?? '0';
}
function stripGstSuffix(notes: string | null): string {
  return (notes ?? '').replace(/\s*·\s*GST\s*[\d.]+%/, '').trim();
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
  /** When non-null the big form is editing an existing invoice: these are
   *  the bobbin_purchase ids that were loaded in. On save, loaded lines
   *  get UPDATEd, new lines INSERTed, removed lines DELETEd. */
  const [editInvoiceIds, setEditInvoiceIds] = useState<number[] | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [modePick, setModePick] = useState<ProductionMode>('inhouse');
  /** When non-null the big form is editing a SINGLE bobbin_purchase row
   *  (opened via a row's pencil button) — Save UPDATEs that row instead
   *  of inserting a new one. */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [returns, setReturns] = useState<BobbinReturnRow[]>([]);
  const [returnOpenId, setReturnOpenId] = useState<number | null>(null);
  const [returnForm, setReturnForm] = useState<ReturnForm>({
    return_date: todayISO(), quantity_pcs: '', reference_no: '', notes: '',
  });
  const [returnBusyId, setReturnBusyId] = useState<number | null>(null);
  const [deletingReturnId, setDeletingReturnId] = useState<number | null>(null);

  const [form, setForm] = useState<{
    purchase_date: string;
    invoice_no: string;
    supplier_party_id: string;
    notes: string;
    round_off: string;
    items: AddItem[];
  }>({
    purchase_date: todayISO(),
    invoice_no: '',
    supplier_party_id: '',
    notes: '',
    round_off: '',
    items: [makeEmptyItem()],
  });
  // Round Off: auto-fills to snap the invoice total to the nearest rupee
  // but stays editable. Stored on the first line of the invoice.
  const [roundOffTouched, setRoundOffTouched] = useState<boolean>(false);

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

    const [bmRes, supRes, purRes, retRes] = await Promise.all([
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
                 bobbin_metre, bobbin_price, round_off, total_amount, notes,
                 bobbin:bobbin_id ( id, code, ends_per_bobbin, bobbin_metre, is_lurex, production_mode )`)
        .order('purchase_date', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false }),
      // In-house returns: bobbin_return rows where jobwork_party_id IS NULL
      // (the bobbins were at the mill, going back to the supplier, no
      // jobworker involved). Tolerate the table not existing yet.
      sb.from('bobbin_return')
        .select('id, bobbin_id, supplier_party_id, return_date, quantity_pcs, reference_no, notes, status')
        .is('jobwork_party_id', null)
        .eq('status', 'active')
        .order('return_date', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false }),
    ]);

    if (bmRes.error)  { setError(bmRes.error.message); setLoading(false); return; }
    if (supRes.error) { setError(supRes.error.message); setLoading(false); return; }
    if (purRes.error) { setError(purRes.error.message); setLoading(false); return; }
    // retRes failure is tolerated — if the bobbin_return table doesn't
    // exist on this DB the return UI just stays empty.

    setBobbinMasters((bmRes.data ?? []) as BobbinMasterOpt[]);
    setSuppliers((supRes.data ?? []) as PartyOption[]);
    setPurchases((purRes.data ?? []) as PurchaseRow[]);
    setReturns(((retRes?.data ?? []) as BobbinReturnRow[]) ?? []);
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

  // Invoice base = Σ(pcs × price) across valid lines. This matches the
  // stored total_amount (which excludes GST — GST lives in notes), so the
  // round-off snaps the *payable* invoice total to a whole rupee.
  const invoiceBilling = useMemo(() => {
    const base = form.items.reduce((s, it) => {
      const q = Number(it.qty_pcs || 0);
      const p = Number(it.price_per_pc || 0);
      return s + (q > 0 && p > 0 ? q * p : 0);
    }, 0);
    const roundedBase = Math.round(base * 100) / 100;
    const autoRoundOff = Math.round((Math.round(roundedBase) - roundedBase) * 100) / 100;
    return { base: roundedBase, autoRoundOff };
  }, [form.items]);

  const effectiveRoundOff = roundOffTouched
    ? (form.round_off === '' ? 0 : Number(form.round_off) || 0)
    : invoiceBilling.autoRoundOff;
  const invoiceGrandTotal = Math.round((invoiceBilling.base + effectiveRoundOff) * 100) / 100;

  function reset(): void {
    setForm({
      purchase_date: todayISO(),
      invoice_no: '',
      supplier_party_id: '',
      notes: '',
      round_off: '',
      items: [makeEmptyItem()],
    });
    setRoundOffTouched(false);
    setEditInvoiceIds(null);
    setEditingId(null);
  }

  /** Click on an invoice number in the log → reopen the big purchase
   *  form pre-filled with EVERY line that shares that invoice (same
   *  invoice no + supplier), so the whole purchase can be edited at
   *  once: header fields, every line, lines added or removed. */
  function openInvoiceEdit(p: PurchaseRow): void {
    const grouped = p.invoice_no == null || p.invoice_no === ''
      ? [p]
      : purchases.filter(
          (x) => x.invoice_no === p.invoice_no && x.vendor_id === p.vendor_id,
        );
    const group = grouped.length > 0 ? grouped : [p];
    const first = group[0] as PurchaseRow;
    // The invoice round-off is the sum of every line's stored round_off
    // (in practice it sits on one line, but summing is safe either way).
    const groupRoundOff = group.reduce((s, x) => s + (Number(x.round_off ?? 0) || 0), 0);
    setRoundOffTouched(Math.abs(groupRoundOff) > 0.005);
    setForm({
      purchase_date: first.purchase_date ?? todayISO(),
      invoice_no: first.invoice_no ?? '',
      supplier_party_id: first.vendor_id == null ? '' : String(first.vendor_id),
      notes: stripGstSuffix(first.notes),
      round_off: Math.abs(groupRoundOff) > 0.005 ? String(Math.round(groupRoundOff * 100) / 100) : '',
      items: group.map((x) => ({
        row_id: x.id,
        bobbin_id: String(x.bobbin_id),
        qty_pcs: x.pieces_purchased == null ? '' : String(x.pieces_purchased),
        metre_per_pc: x.bobbin_metre == null ? '' : String(x.bobbin_metre),
        price_per_pc: x.bobbin_price == null ? '' : String(x.bobbin_price),
        gst_pct: parseGstFromNotes(x.notes),
      })),
    });
    setEditInvoiceIds(group.map((x) => x.id));
    // Point the mode pill at the bobbins actually on this invoice so the
    // line dropdowns list them.
    const mode = first.bobbin?.production_mode;
    if (mode !== undefined) setModePick(mode);
    setEditingId(null);
    setReturnOpenId(null);
    setError(null);
    setSavedMsg(null);
    setOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    const toPayload = (it: AddItem) => {
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
        // The whole invoice round-off rides on the first line; the rest
        // carry 0. total_amount = pcs*price + round_off, so the invoice's
        // payable total lands on a whole rupee.
        round_off: 0,
        notes: (form.notes.trim() || '') + noteSuffix || null,
      };
    };

    if (editingId !== null) {
      // Row edit — the form was reopened from a row's pencil button, so
      // UPDATE that single bobbin_purchase row instead of inserting.
      // Same columns the old inline row editor wrote.
      const it = validItems[0];
      if (!it) { setBusy(false); return; }
      const qty = Number(it.qty_pcs);
      const metre = it.metre_per_pc === '' ? null : Number(it.metre_per_pc);
      const price = it.price_per_pc === '' ? null : Number(it.price_per_pc);
      const gst = it.gst_pct === '' ? 0 : Number(it.gst_pct);
      const noteSuffix = gst > 0 ? ` · GST ${gst}%` : '';
      const { error: err } = await sb
        .from('bobbin_purchase')
        .update({
          purchase_date:    form.purchase_date,
          invoice_no:       form.invoice_no.trim(),
          vendor_id:        form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
          pieces_purchased: qty,
          bobbin_metre:     metre,
          bobbin_price:     price,
          notes:            (form.notes.trim() + noteSuffix) || null,
        })
        .eq('id', editingId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg('Purchase updated.');
    } else if (editInvoiceIds === null) {
      // New purchase — plain multi-line insert. Round-off sits on line 1.
      const payloads = validItems.map(toPayload);
      const firstPayload = payloads[0];
      if (firstPayload) firstPayload.round_off = effectiveRoundOff;
      const { error: err } = await sb.from('bobbin_purchase').insert(payloads);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setSavedMsg(`Saved ${payloads.length} purchase line${payloads.length === 1 ? '' : 's'}.`);
    } else {
      // Invoice edit — update the lines that were loaded in, insert any
      // newly added lines, delete lines the operator removed.
      const keptIds = new Set(
        validItems.map((it) => it.row_id).filter((id): id is number => id !== undefined),
      );
      const removedIds = editInvoiceIds.filter((id) => !keptIds.has(id));

      for (const [i, it] of validItems.entries()) {
        const payload = toPayload(it);
        // Whole invoice round-off rides on the first line; rest carry 0.
        payload.round_off = i === 0 ? effectiveRoundOff : 0;
        const { error: err } = it.row_id === undefined
          ? await sb.from('bobbin_purchase').insert(payload)
          : await sb.from('bobbin_purchase').update(payload).eq('id', it.row_id);
        if (err) { setBusy(false); setError(err.message); return; }
      }
      if (removedIds.length > 0) {
        const { error: err } = await sb.from('bobbin_purchase').delete().in('id', removedIds);
        if (err) { setBusy(false); setError(err.message); return; }
      }
      setBusy(false);
      setSavedMsg(`Invoice updated (${validItems.length} line${validItems.length === 1 ? '' : 's'}${removedIds.length > 0 ? `, ${removedIds.length} removed` : ''}).`);
    }
    reset();
    setOpen(false);
    await load();
  }

  /** Edit = reopen the Add form pre-filled with this row's values.
   *  Saving then UPDATEs the row instead of inserting a new one. */
  function startEdit(p: PurchaseRow): void {
    setEditingId(p.id);
    setEditInvoiceIds(null);
    const rowRoundOff = Number(p.round_off ?? 0) || 0;
    setRoundOffTouched(Math.abs(rowRoundOff) > 0.005);
    setForm({
      purchase_date: p.purchase_date ?? todayISO(),
      invoice_no: p.invoice_no ?? '',
      supplier_party_id: p.vendor_id == null ? '' : String(p.vendor_id),
      notes: stripGstSuffix(p.notes),
      round_off: Math.abs(rowRoundOff) > 0.005 ? String(Math.round(rowRoundOff * 100) / 100) : '',
      items: [{
        bobbin_id: String(p.bobbin_id),
        qty_pcs: p.pieces_purchased == null ? '' : String(p.pieces_purchased),
        metre_per_pc: p.bobbin_metre == null ? '' : String(p.bobbin_metre),
        price_per_pc: p.bobbin_price == null ? '' : String(p.bobbin_price),
        gst_pct: parseGstFromNotes(p.notes),
      }],
    });
    // Point the mode pill at this purchase's bobbin so the line
    // dropdown lists it.
    const mode = p.bobbin?.production_mode;
    if (mode !== undefined) setModePick(mode);
    setReturnOpenId(null);
    setError(null);
    setSavedMsg(null);
    setOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openReturnFor(p: PurchaseRow): void {
    // Toggle the inline return form for this purchase row. Pre-fill the
    // date as today and clear the qty / reference / notes so the
    // operator only has to type the returned-pcs count.
    if (returnOpenId === p.id) { setReturnOpenId(null); return; }
    setReturnOpenId(p.id);
    setReturnForm({ return_date: todayISO(), quantity_pcs: '', reference_no: '', notes: '' });
    setError(null);
    setSavedMsg(null);
  }

  function cancelReturn(): void {
    setReturnOpenId(null);
    setReturnForm({ return_date: todayISO(), quantity_pcs: '', reference_no: '', notes: '' });
  }

  async function saveReturn(p: PurchaseRow): Promise<void> {
    const qty = Math.trunc(Number(returnForm.quantity_pcs));
    if (!returnForm.return_date) { setError('Return date is required.'); return; }
    if (!(qty > 0)) { setError('Returned qty (pcs) must be greater than 0.'); return; }
    setError(null);
    setSavedMsg(null);
    setReturnBusyId(p.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      bobbin_id:         p.bobbin_id,
      // Supplier defaults to the purchase's vendor — the same party
      // the bobbins came from. Operator can override later if needed.
      supplier_party_id: p.vendor_id ?? null,
      jobwork_party_id:  null,
      return_date:       returnForm.return_date,
      quantity_pcs:      qty,
      reference_no:      returnForm.reference_no.trim() || null,
      notes:             returnForm.notes.trim() || null,
      status:            'active',
    };
    const { error: err } = await sb.from('bobbin_return').insert(payload);
    setReturnBusyId(null);
    if (err) { setError(err.message); return; }
    cancelReturn();
    await load();
    setSavedMsg('Return logged.');
  }

  async function deleteReturn(id: number): Promise<void> {
    if (!window.confirm('Delete this return entry?\n\nThis hard-deletes the bobbin_return row.')) return;
    setError(null);
    setSavedMsg(null);
    setDeletingReturnId(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase as any).from('bobbin_return').delete().eq('id', id);
    setDeletingReturnId(null);
    if (err) { setError(err.message); return; }
    setReturns((prev) => prev.filter((r) => r.id !== id));
    setSavedMsg('Return deleted.');
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
            onClick={() => {
              if (open) { setOpen(false); reset(); }
              else setOpen(true);
            }}
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
            <h2 className="font-display font-bold text-base">
              {editingId !== null
                ? 'Edit bobbin purchase'
                : editInvoiceIds === null
                  ? 'New bobbin purchase'
                  : `Edit purchase — invoice ${form.invoice_no || '(no invoice no)'}`}
            </h2>
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

          {editingId !== null && (
            <div className="text-xs font-semibold text-indigo bg-indigo-50 border border-indigo/20 rounded-md px-3 py-2">
              Editing an existing entry — Save will update it, not create a new one.
            </div>
          )}

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
                          {/* Keep a loaded line's bobbin visible even when the
                              mode pill filters it out (mixed-mode invoices). */}
                          {bm !== null && !visibleBobbins.some((b) => b.id === bm.id) && (
                            <option value={bm.id}>
                              {bm.code} ({bm.ends_per_bobbin} ends{bm.is_lurex ? ' · lurex' : ''})
                            </option>
                          )}
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

          {/* Invoice round-off — snaps the payable total (Σ pcs × price)
              to a whole rupee. Auto by default, editable. */}
          <div className="flex justify-end">
            <div className="w-full sm:w-80 space-y-1.5 text-sm">
              <div className="flex items-center justify-between text-ink-soft">
                <span>Subtotal (pcs × price)</span>
                <span className="num">₹ {fmtMoney(invoiceBilling.base)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5">
                  <span>Round Off</span>
                  {roundOffTouched && (
                    <button type="button"
                      onClick={() => { setRoundOffTouched(false); setForm((f) => ({ ...f, round_off: '' })); }}
                      className="text-[11px] text-indigo-700 inline-flex items-center gap-0.5"
                      title="Reset to the auto nearest-rupee value">
                      <RotateCcw className="w-3 h-3" /> auto
                    </button>
                  )}
                </label>
                <input type="number" step="0.01"
                  className="input num h-8 text-sm w-28 text-right"
                  value={roundOffTouched ? form.round_off : (invoiceBilling.autoRoundOff !== 0 ? String(invoiceBilling.autoRoundOff) : '0.00')}
                  onChange={(e) => { setRoundOffTouched(true); setForm((f) => ({ ...f, round_off: e.target.value })); }} />
              </div>
              <div className="flex items-center justify-between font-semibold border-t border-line/40 pt-1.5">
                <span>Invoice total</span>
                <span className="num">₹ {fmtMoney(invoiceGrandTotal)}</span>
              </div>
            </div>
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
              {busy
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : editingId !== null ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {editingId !== null ? 'Update' : editInvoiceIds === null ? 'Save all' : 'Save changes'}
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
        <>
        {/* Mobile / PWA: card view. The purchase log is wide; below md we
            render each purchase as a tap-friendly card. Inline edit / return
            forms live in the desktop table, which is hidden on mobile. */}
        <CardFilter placeholder="Search purchases…">
          {purchases.map((p) => {
            const bm = p.bobbin;
            const sup = p.vendor_id != null ? supplierById.get(p.vendor_id) : null;
            const label = bm
              ? `${bm.code} (${bm.ends_per_bobbin} ends)`
              : `Bobbin #${p.bobbin_id}`;
            const q = Number(p.pieces_purchased ?? 0);
            const m = Number(p.bobbin_metre ?? 0);
            const totalM = q > 0 && m > 0 ? q * m : 0;
            return (
              <div key={p.id} className={'card p-3' + (editingId === p.id ? ' bg-indigo-50/50' : '')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-ink break-words">{label}</div>
                    <div className="text-xs text-ink-soft mt-0.5">{p.purchase_date ?? '—'}</div>
                  </div>
                  {bm && (
                    <span className={
                      'pill shrink-0 ' +
                      (bm.production_mode === 'inhouse'   ? 'bg-emerald-50 text-emerald-700' :
                       bm.production_mode === 'jobwork'   ? 'bg-amber-50 text-amber-700' :
                                                            'bg-indigo-50 text-indigo-700')
                    }>{MODE_LABEL[bm.production_mode]}</span>
                  )}
                </div>

                <div className="text-xs text-ink-soft mt-2">
                  <span className="text-ink-mute">Supplier: </span>{sup?.name ?? '—'}
                </div>
                {p.invoice_no && (
                  <div className="text-xs mt-1">
                    <span className="text-ink-mute">Invoice: </span>
                    <button
                      type="button"
                      onClick={() => openInvoiceEdit(p)}
                      title="Edit all lines of this invoice"
                      className="font-mono text-indigo-700 hover:underline disabled:opacity-50 disabled:no-underline"
                    >
                      {p.invoice_no}
                    </button>
                  </div>
                )}
                <div className="text-xs mt-1">
                  <span className="text-ink-mute">Qty: </span><span className="num">{fmtNumber(p.pieces_purchased, 2)} pcs</span>
                  {' · '}<span className="text-ink-mute">M/pc: </span><span className="num">{fmtNumber(p.bobbin_metre, 0)}</span>
                  {totalM > 0 && (
                    <span> · <span className="text-ink-mute">Total: </span><span className="num text-indigo-700 font-semibold">{totalM.toLocaleString('en-IN', { maximumFractionDigits: 2 })} m</span></span>
                  )}
                </div>
                {p.notes && (
                  <div className="text-xs text-ink-soft mt-1 break-words">{p.notes}</div>
                )}

                <div className="flex items-end justify-between mt-2 pt-2 border-t border-line/40">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openReturnFor(p)}
                      disabled={deletingId === p.id}
                      title="Return to supplier"
                      className="p-1 rounded text-amber-700 hover:bg-amber-50 disabled:opacity-30"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      disabled={deletingId === p.id}
                      title="Edit this purchase"
                      className="p-1 rounded text-indigo-700 hover:bg-indigo-50 disabled:opacity-30"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteRow(p.id, label)}
                      disabled={deletingId === p.id}
                      title="Delete this purchase"
                      className="p-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                    >
                      {deletingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total ₹</div>
                    <div className="num font-semibold">{fmtMoney(p.total_amount)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardFilter>

        <div className="card overflow-x-auto hidden md:block">
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
                const isReturnOpen = returnOpenId === p.id;
                return (
                  <React.Fragment key={p.id}>
                  <tr className={'border-t border-line/40 hover:bg-haze/60' + (editingId === p.id ? ' bg-indigo-50/50' : '')}>
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
                    <td className="px-3 py-2 font-mono text-xs">
                      {p.invoice_no == null || p.invoice_no === '' ? (
                        '—'
                      ) : (
                        <button
                          type="button"
                          onClick={() => openInvoiceEdit(p)}
                          title="Edit all lines of this invoice"
                          className="text-indigo-700 hover:underline disabled:opacity-50 disabled:no-underline"
                        >
                          {p.invoice_no}
                        </button>
                      )}
                    </td>
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
                        onClick={() => openReturnFor(p)}
                        disabled={deletingId === p.id}
                        title="Return to supplier"
                        className="p-1 rounded text-amber-700 hover:bg-amber-50 disabled:opacity-30"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        disabled={deletingId === p.id}
                        title="Edit this purchase"
                        className="p-1 rounded text-indigo-700 hover:bg-indigo-50 ml-1 disabled:opacity-30"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRow(p.id, label)}
                        disabled={deletingId === p.id}
                        title="Delete this purchase"
                        className="p-1 rounded text-rose-600 hover:bg-rose-50 ml-1 disabled:opacity-30"
                      >
                        {deletingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                  {isReturnOpen && (
                    <tr className="bg-amber-50/60 border-t border-amber-200/60">
                      <td colSpan={12} className="px-3 py-3">
                        <div className="flex flex-wrap items-end gap-2">
                          <div>
                            <label className="text-[10px] uppercase tracking-wide text-ink-mute block">Return date *</label>
                            <input type="date" className="input h-8 text-xs"
                              value={returnForm.return_date}
                              onChange={(e) => setReturnForm({ ...returnForm, return_date: e.target.value })} />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-wide text-ink-mute block">Returned pcs *</label>
                            <input type="number" min={1} className="input num h-8 text-xs w-28 text-right"
                              value={returnForm.quantity_pcs}
                              onChange={(e) => setReturnForm({ ...returnForm, quantity_pcs: e.target.value })} />
                          </div>
                          <div className="flex-1 min-w-[140px]">
                            <label className="text-[10px] uppercase tracking-wide text-ink-mute block">Reference</label>
                            <input className="input h-8 text-xs w-full"
                              placeholder="DR / DC no, optional"
                              value={returnForm.reference_no}
                              onChange={(e) => setReturnForm({ ...returnForm, reference_no: e.target.value })} />
                          </div>
                          <div className="flex-1 min-w-[180px]">
                            <label className="text-[10px] uppercase tracking-wide text-ink-mute block">Notes</label>
                            <input className="input h-8 text-xs w-full"
                              value={returnForm.notes}
                              onChange={(e) => setReturnForm({ ...returnForm, notes: e.target.value })} />
                          </div>
                          <div className="text-[10px] text-ink-mute">
                            Supplier: <strong>{sup?.name ?? '— (none on purchase)'}</strong>
                          </div>
                          <div className="flex gap-1">
                            <button type="button"
                              onClick={() => saveReturn(p)}
                              disabled={returnBusyId === p.id}
                              className="btn-primary text-xs h-8 px-3 flex items-center gap-1">
                              {returnBusyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              Save return
                            </button>
                            <button type="button"
                              onClick={cancelReturn}
                              disabled={returnBusyId === p.id}
                              className="btn-secondary text-xs h-8 px-3 flex items-center gap-1">
                              <X className="h-3.5 w-3.5" />
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Returns history — in-house bobbin returns to supplier. Shows
          past bobbin_return rows (jobwork_party_id IS NULL) with a
          delete button so mistakes can be rolled back. */}
      {returns.length > 0 && (
        <>
        {/* Mobile / PWA: card view for returns. */}
        <div className="md:hidden mt-4">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
            <ArrowLeft className="h-4 w-4 text-amber-700" />
            Returns to Supplier
          </h3>
          <CardFilter placeholder="Search returns…">
            {returns.map((r) => {
              const bm = bobbinById.get(r.bobbin_id) ?? null;
              const sup = r.supplier_party_id != null ? supplierById.get(r.supplier_party_id) : null;
              const lbl = bm ? `${bm.code} (${bm.ends_per_bobbin} ends)` : `Bobbin #${r.bobbin_id}`;
              return (
                <div key={r.id} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-ink break-words">{lbl}</div>
                      <div className="text-xs text-ink-soft mt-0.5">{r.return_date}</div>
                    </div>
                    <div className="num font-semibold text-amber-700 shrink-0">
                      {Number(r.quantity_pcs ?? 0).toLocaleString('en-IN')} pcs
                    </div>
                  </div>
                  <div className="text-xs text-ink-soft mt-2">
                    <span className="text-ink-mute">Supplier: </span>{sup?.name ?? '—'}
                  </div>
                  {r.reference_no && (
                    <div className="text-xs mt-1">
                      <span className="text-ink-mute">Reference: </span><span className="font-mono">{r.reference_no}</span>
                    </div>
                  )}
                  {r.notes && (
                    <div className="text-xs text-ink-soft mt-1 break-words">{r.notes}</div>
                  )}
                  <div className="flex items-center gap-4 mt-2 pt-2 border-t border-line/40">
                    <button
                      type="button"
                      onClick={() => deleteReturn(r.id)}
                      disabled={deletingReturnId === r.id}
                      title="Delete this return"
                      className="p-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30 inline-flex items-center gap-1 text-xs"
                    >
                      {deletingReturnId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </CardFilter>
        </div>

        <div className="card mt-4 overflow-x-auto hidden md:block">
          <div className="px-3 py-2 border-b border-line/40 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <ArrowLeft className="h-4 w-4 text-amber-700" />
              Returns to Supplier
            </h3>
            <span className="text-[11px] text-ink-mute">
              {returns.length} {returns.length === 1 ? 'return' : 'returns'} ·{' '}
              {returns.reduce((s, r) => s + Number(r.quantity_pcs ?? 0), 0).toLocaleString('en-IN')} pcs total
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3">Bobbin</th>
                <th className="text-left  px-3 py-3">Supplier</th>
                <th className="text-right px-3 py-3">Qty (pcs)</th>
                <th className="text-left  px-3 py-3">Reference</th>
                <th className="text-left  px-3 py-3">Notes</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => {
                const bm = bobbinById.get(r.bobbin_id) ?? null;
                const sup = r.supplier_party_id != null ? supplierById.get(r.supplier_party_id) : null;
                const lbl = bm ? `${bm.code} (${bm.ends_per_bobbin} ends)` : `Bobbin #${r.bobbin_id}`;
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{r.return_date}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{lbl}</td>
                    <td className="px-3 py-2 text-xs">{sup?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-right num font-semibold text-amber-700">
                      {Number(r.quantity_pcs ?? 0).toLocaleString('en-IN')}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.reference_no ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft">{r.notes ?? ''}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => deleteReturn(r.id)}
                        disabled={deletingReturnId === r.id}
                        title="Delete this return"
                        className="p-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                      >
                        {deletingReturnId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

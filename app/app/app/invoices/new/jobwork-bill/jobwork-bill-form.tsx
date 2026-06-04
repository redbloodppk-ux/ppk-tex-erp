'use client';
/**
 * Jobwork Bill creation form.
 *
 * Flow:
 *  1. Pick a jobwork party. Loads every confirmed, un-invoiced jobwork DC
 *     for that party.
 *  2. Tick the DCs to include on this bill.
 *  3. For every fabric quality that appears across the picked DCs, a
 *     locked invoice line is computed:
 *
 *       quantity (metres) = sum of metres from picked DCs of that quality
 *       pieces, bundles   = sums (display-only, not on the invoice line)
 *       rate              = fabric_quality.pick_cost_per_m  (locked)
 *       amount            = quantity * rate
 *
 *  4. GST % and bill date are the only editable header fields.
 *  5. Save → creates invoice (auto-numbered JB/26-27/NNNN), invoice_lines,
 *     and stamps invoice_id + status='invoiced' onto every picked DC.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, AlertTriangle } from 'lucide-react';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface PartyOpt {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  billing_address: string | null;
  state: string | null;
  state_code: string | null;
}

interface DcRow {
  id: number;
  code: string;
  dc_date: string;
  party_id: number | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  total_bundles: number | null;
  fabric_receipt_id: number | null;
}

interface DcItemRow {
  dc_id: number;
  fabric_quality_id: number | null;
  metres: number | string | null;
  pieces: number | null;
  bundles: number | null;
  hsn: string | null;
}

/** Aggregated billing data per DC × quality, sourced from the fabric
 *  receipt (not the DC). The receipt is the source of truth for what
 *  actually changed hands. When `entry_mode='pcs'` the row was entered
 *  as a towel count and we bill per piece. */
interface ReceiptAggRow {
  dc_id: number;
  fabric_quality_id: number | null;
  received_metres: number;     // sum of received_metres on the receipt
  pieces_from_receipt: number; // sum of no_of_pieces on the receipt (towel rows only)
  any_towel: boolean;          // true if any receipt item had length_per_pc > 0
  towel_length: number;        // representative length_per_pc (last-seen non-null)
  hsn: string | null;
}

interface FabricQualityRow {
  id: number;
  code: string;
  name: string;
  hsn: string | null;
  pick_cost_per_m: number | string | null;
  /** Towel length (metres per piece). When set, the bill line switches
   *  from per-metre to per-piece pricing: rate = pick_cost_per_m ×
   *  meter_per_pc, quantity = pieces, uom = pcs. */
  meter_per_pc: number | string | null;
  /** Merge-delivery flag + common name. When two qualities share the
   *  same merged_name, their lines are rolled up into a single invoice
   *  line under that name. */
  is_merged: boolean | null;
  merged_name: string | null;
}

interface JobworkBillFormProps {
  parties: ReadonlyArray<PartyOpt>;
}

interface LineAgg {
  fq_id: number;
  fq_code: string;
  fq_name: string;
  hsn: string;
  /** Base rate per metre from fabric_quality.pick_cost_per_m. */
  base_rate: number;
  /** Towel length (metres per piece) from fabric_quality.meter_per_pc.
   *  0 means the quality is sold in metres (not a towel). */
  towel_length: number;
  /** Effective billing rate: per-piece rate when towel_length > 0,
   *  otherwise the per-metre rate. */
  rate: number;
  /** Effective quantity: pieces when towel_length > 0, otherwise metres. */
  quantity: number;
  /** Effective unit of measure: 'pcs' for towels, 'mtr' otherwise. */
  uom: 'pcs' | 'mtr';
  metres: number;     // sum across selected DCs (raw)
  pieces: number;     // sum across selected DCs (raw)
  bundles: number;    // sum across selected DCs (display)
  taxable: number;    // quantity * rate
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(v: number): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const PPKTEX_STATE_CODE = '33'; // Tamil Nadu

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export function JobworkBillForm({ parties }: JobworkBillFormProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();

  // ── Form state ──
  const [partyId, setPartyId]   = useState<string>('');
  const [billDate, setBillDate] = useState<string>(todayISO());
  const [gstPct, setGstPct]     = useState<string>('5');
  const [notes, setNotes]       = useState<string>('');
  const [busy, setBusy]         = useState<boolean>(false);
  const [error, setError]       = useState<string | null>(null);
  /** Preview of the bill code the trigger will generate on save
   *  (e.g. "JB/26-27/0004"). Read from doc_sequence on mount. */
  const [nextInvoiceCode, setNextInvoiceCode] = useState<string>('');

  // ── Data state ──
  const [dcs, setDcs]                 = useState<DcRow[]>([]);
  const [items, setItems]             = useState<DcItemRow[]>([]);
  const [receiptAggs, setReceiptAggs] = useState<ReceiptAggRow[]>([]);
  const [qualityById, setQualityById] = useState<Map<number, FabricQualityRow>>(new Map());
  const [pickedDcIds, setPickedDcIds] = useState<Set<number>>(new Set());
  const [loadingDcs, setLoadingDcs]   = useState<boolean>(false);

  // ── Preview the next invoice code from doc_sequence on mount ──
  // The actual code is generated by the BEFORE INSERT trigger, but we
  // peek the counter so the operator sees what number this bill will
  // take before they save it.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error: dsErr } = await sb
        .from('doc_sequence')
        .select('prefix, format, fy_code, next_value')
        .eq('doc_type', 'jobwork_invoice')
        .maybeSingle();
      if (cancelled) return;
      if (dsErr || !data) {
        setNextInvoiceCode('');
        return;
      }
      const { prefix, format, fy_code, next_value } = data as {
        prefix: string; format: string; fy_code: string; next_value: number;
      };
      // Format placeholder is e.g. "{prefix}/{fy}/{seq:0000}". We render
      // the sequence with the requested zero-padding width.
      const seqMatch = /\{seq:(0+)\}/.exec(format);
      const width = seqMatch?.[1]?.length ?? 4;
      const seqStr = String(next_value).padStart(width, '0');
      const code = format
        .replace('{prefix}', prefix)
        .replace('{fy}', fy_code)
        .replace(/\{seq:0+\}/, seqStr);
      setNextInvoiceCode(code);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // Reload DCs whenever party changes.
  useEffect(() => {
    if (partyId === '') {
      setDcs([]);
      setItems([]);
      setPickedDcIds(new Set());
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoadingDcs(true);
      setError(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;

      // All un-invoiced jobwork DCs for this party. We surface both
      // receipted (status='confirmed') and not-yet-receipted DCs so the
      // operator can see the gap; only receipted DCs are selectable for
      // billing (UI disables the checkbox otherwise).
      const { data: hdrs, error: hdrErr } = await sb
        .from('delivery_challan')
        .select('id, code, dc_date, party_id, total_metres, total_pieces, total_bundles, fabric_receipt_id')
        .eq('production_mode', 'jobwork')
        .eq('party_id', Number(partyId))
        .in('status', ['draft', 'confirmed'])
        .is('invoice_id', null)
        .order('dc_date', { ascending: false })
        .order('id', { ascending: false });
      if (cancelled) return;
      if (hdrErr) { setError(hdrErr.message); setLoadingDcs(false); return; }

      const dcList = (hdrs ?? []) as DcRow[];
      setDcs(dcList);
      setPickedDcIds(new Set());

      if (dcList.length === 0) {
        setItems([]);
        setReceiptAggs([]);
        setLoadingDcs(false);
        return;
      }

      const dcIds = dcList.map((d) => d.id);
      const { data: itemRows } = await sb
        .from('delivery_challan_item')
        .select('dc_id, fabric_quality_id, metres, pieces, bundles, hsn')
        .in('dc_id', dcIds);
      if (cancelled) return;
      const itemList = (itemRows ?? []) as DcItemRow[];
      setItems(itemList);

      // ── Receipt-side aggregates ──
      // For receipted DCs we want the bill quantity to come from the
      // fabric_receipt (the source of truth for what arrived), not the
      // DC. If a receipt item had a towel length set we treat the
      // received quantity as PIECES on the invoice line.
      const receiptIds = dcList.map((d) => d.fabric_receipt_id).filter((x): x is number => x != null);
      if (receiptIds.length > 0) {
        const { data: rItems } = await sb
          .from('fabric_receipt_item')
          .select('receipt_id, fabric_quality_id, received_metres, no_of_pieces, length_per_pc, entry_mode')
          .in('receipt_id', receiptIds);
        if (cancelled) return;

        // Map receipt_id -> dc_id so we can attribute receipt items back.
        const dcByReceipt = new Map<number, number>();
        for (const d of dcList) {
          if (d.fabric_receipt_id != null) dcByReceipt.set(d.fabric_receipt_id, d.id);
        }

        // HSN lookup from DC items (receipt items don't carry it).
        const hsnByKey = new Map<string, string | null>();
        for (const ir of itemList) {
          hsnByKey.set(`${ir.dc_id}|${ir.fabric_quality_id ?? 'n'}`, ir.hsn);
        }

        const aggByKey = new Map<string, ReceiptAggRow>();
        type RawRi = {
          receipt_id: number;
          fabric_quality_id: number | null;
          received_metres: number | string | null;
          no_of_pieces: number | null;
          length_per_pc: number | string | null;
          entry_mode: string | null;
        };
        for (const ri of (rItems ?? []) as RawRi[]) {
          const dcId = dcByReceipt.get(ri.receipt_id);
          if (dcId === undefined) continue;
          const key = `${dcId}|${ri.fabric_quality_id ?? 'n'}`;
          let agg = aggByKey.get(key);
          if (!agg) {
            agg = {
              dc_id: dcId,
              fabric_quality_id: ri.fabric_quality_id,
              received_metres: 0,
              pieces_from_receipt: 0,
              any_towel: false,
              towel_length: 0,
              hsn: hsnByKey.get(key) ?? null,
            };
            aggByKey.set(key, agg);
          }
          agg.received_metres += num(ri.received_metres);
          const isTowelRow = ri.entry_mode === 'pcs' || num(ri.length_per_pc) > 0;
          if (isTowelRow) {
            agg.pieces_from_receipt += Number(ri.no_of_pieces ?? 0);
            agg.any_towel = true;
            if (num(ri.length_per_pc) > 0) agg.towel_length = num(ri.length_per_pc);
          }
        }
        setReceiptAggs(Array.from(aggByKey.values()));
      } else {
        setReceiptAggs([]);
      }

      // Load fabric_quality master for the qualities that appear.
      const qIds = Array.from(new Set(
        itemList.map((r) => r.fabric_quality_id).filter((x): x is number => x != null),
      ));
      if (qIds.length > 0) {
        const { data: qRows } = await sb
          .from('fabric_quality')
          .select('id, code, name, hsn, pick_cost_per_m, meter_per_pc, is_merged, merged_name')
          .in('id', qIds);
        if (cancelled) return;
        const m = new Map<number, FabricQualityRow>();
        for (const q of (qRows ?? []) as FabricQualityRow[]) m.set(q.id, q);
        setQualityById(m);
      } else {
        setQualityById(new Map());
      }
      setLoadingDcs(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [partyId, supabase]);

  const party = useMemo<PartyOpt | null>(() => {
    if (partyId === '') return null;
    return parties.find((p) => p.id === Number(partyId)) ?? null;
  }, [partyId, parties]);

  // ── Aggregated lines, keyed by fabric_quality_id ──
  // Source of truth = the fabric_receipt (not the DC). If any receipt
  // row for this quality was entered with a towel length, we bill per
  // piece using the pieces recorded on the receipt. Per-piece rate =
  // pick_cost_per_m × towel_length. Total amount is equivalent to
  // received_metres × pick_cost_per_m when pieces × towel_length matches
  // metres on the receipt, but we use the operator-confirmed piece
  // count as the line quantity.
  const lines = useMemo<LineAgg[]>(() => {
    if (pickedDcIds.size === 0) return [];
    // Quick lookup of receipt aggregates by (dc_id, fabric_quality_id).
    const receiptByKey = new Map<string, ReceiptAggRow>();
    for (const ra of receiptAggs) {
      receiptByKey.set(`${ra.dc_id}|${ra.fabric_quality_id ?? 'n'}`, ra);
    }

    // Aggregation key: for merged-delivery qualities (is_merged=true +
    // merged_name set) we use the merged_name so every sibling rolls up
    // into ONE invoice line. For standalone qualities we key by id.
    // The line's fq_id stays a single representative id (the first
    // sibling encountered) so the saved invoice_line still references a
    // real fabric_quality row.
    const groupKey = (fq: FabricQualityRow): string => {
      const mn = (fq.merged_name ?? '').trim();
      if (fq.is_merged && mn !== '') return `m:${mn}`;
      return `fq:${fq.id}`;
    };
    const groupDisplay = (fq: FabricQualityRow): { code: string; name: string } => {
      const mn = (fq.merged_name ?? '').trim();
      if (fq.is_merged && mn !== '') return { code: mn, name: '' };
      return { code: fq.code, name: fq.name };
    };

    const byKey = new Map<string, LineAgg>();
    for (const it of items) {
      if (!pickedDcIds.has(it.dc_id)) continue;
      if (it.fabric_quality_id == null) continue;
      const fq = qualityById.get(it.fabric_quality_id);
      if (!fq) continue;
      const receipt = receiptByKey.get(`${it.dc_id}|${it.fabric_quality_id}`);
      const metres = receipt ? receipt.received_metres : num(it.metres);
      const baseRate = num(fq.pick_cost_per_m);
      const masterTowelLen = num(fq.meter_per_pc);
      const receiptTowel = receipt?.any_towel === true;
      const towelLength = receiptTowel ? (receipt!.towel_length || masterTowelLen) : masterTowelLen;
      const isTowel = receiptTowel || (!receipt && masterTowelLen > 0);
      const pieces = receipt ? receipt.pieces_from_receipt : (it.pieces ?? 0);
      const effectiveRate = isTowel ? round2(baseRate * towelLength) : baseRate;
      const key = groupKey(fq);
      const existing = byKey.get(key);
      if (existing) {
        existing.metres += metres;
        existing.pieces += pieces;
        existing.bundles += it.bundles ?? 0;
        existing.quantity = existing.uom === 'pcs' ? existing.pieces : existing.metres;
        existing.taxable = round2(existing.quantity * existing.rate);
      } else {
        const display = groupDisplay(fq);
        const quantity = isTowel ? pieces : metres;
        byKey.set(key, {
          fq_id: fq.id,
          fq_code: display.code,
          fq_name: display.name,
          hsn: it.hsn ?? fq.hsn ?? '',
          base_rate: baseRate,
          towel_length: towelLength,
          rate: effectiveRate,
          quantity,
          uom: isTowel ? 'pcs' : 'mtr',
          metres,
          pieces,
          bundles: it.bundles ?? 0,
          taxable: round2(quantity * effectiveRate),
        });
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.fq_code.localeCompare(b.fq_code));
  }, [items, pickedDcIds, qualityById, receiptAggs]);

  // ── Totals (header) ──
  const gst = num(gstPct);
  const isInterstate = (party?.state_code ?? '') !== '' && party?.state_code !== PPKTEX_STATE_CODE;
  const totals = useMemo(() => {
    const taxable = lines.reduce<number>((s, l) => s + l.taxable, 0);
    const cgst = isInterstate ? 0 : round2(taxable * gst / 200);
    const sgst = isInterstate ? 0 : round2(taxable * gst / 200);
    const igst = isInterstate ? round2(taxable * gst / 100) : 0;
    const grand = round2(taxable + cgst + sgst + igst);
    const metres = lines.reduce<number>((s, l) => s + l.metres, 0);
    const pieces = lines.reduce<number>((s, l) => s + l.pieces, 0);
    const bundles = lines.reduce<number>((s, l) => s + l.bundles, 0);
    return { taxable: round2(taxable), cgst, sgst, igst, grand, metres, pieces, bundles };
  }, [lines, gst, isInterstate]);

  // ── Pick / unpick handlers ──
  function toggleDc(dcId: number): void {
    setPickedDcIds((prev) => {
      const next = new Set(prev);
      if (next.has(dcId)) next.delete(dcId); else next.add(dcId);
      return next;
    });
  }
  function pickAll(): void {
    setPickedDcIds(new Set(dcs.map((d) => d.id)));
  }
  function clearAll(): void {
    setPickedDcIds(new Set());
  }

  // ── Pricing safety: any line with base_rate 0 means pick_cost_per_m wasn't set ──
  const missingRateQualities = useMemo<string[]>(
    () => lines.filter((l) => l.base_rate <= 0).map((l) => l.fq_code),
    [lines],
  );

  async function handleSave(): Promise<void> {
    setError(null);
    if (party === null) { setError('Pick a jobwork party.'); return; }
    if (pickedDcIds.size === 0) { setError('Pick at least one DC.'); return; }
    if (lines.length === 0) { setError('Selected DCs have no fabric quality lines.'); return; }
    if (missingRateQualities.length > 0) {
      setError(`Set pick_cost_per_m on: ${missingRateQualities.join(', ')}`);
      return;
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // ── 1. Insert invoice header ──
    const headerPayload = {
      doc_type: 'jobwork_invoice',
      source_kind: 'free',
      jobwork_party_id: party.id,
      customer_id: null,
      invoice_date: billDate,
      party_name: party.name,
      party_gstin: party.gstin,
      party_state: party.state,
      place_of_supply: party.state,
      is_interstate: isInterstate,
      subtotal: totals.taxable,
      gst_amount: round2(totals.cgst + totals.sgst + totals.igst),
      total: totals.grand,
      amount_paid: 0,
      taxable_value: totals.taxable,
      cgst_amount: totals.cgst,
      sgst_amount: totals.sgst,
      igst_amount: totals.igst,
      round_off: 0,
      // Jobwork bills are saved already-issued - you only create one when
      // you mean to hand it to the customer. Status can still be edited
      // later (cancelled, paid, etc.) from the invoice detail page.
      status: 'issued',
      notes: notes || null,
    };

    const { data: invRow, error: invErr } = await sb
      .from('invoice')
      .insert(headerPayload)
      .select('id, invoice_no')
      .single();
    if (invErr || !invRow?.id) {
      setBusy(false);
      setError(invErr?.message ?? 'Failed to create invoice.');
      return;
    }
    const invoiceId = invRow.id as number;

    // ── 2. Insert invoice lines ──
    const linesPayload = lines.map((l) => {
      const taxable = l.taxable;
      const cgst = isInterstate ? 0 : round2(taxable * gst / 200);
      const sgst = isInterstate ? 0 : round2(taxable * gst / 200);
      const igst = isInterstate ? round2(taxable * gst / 100) : 0;
      const lineTotal = round2(taxable + cgst + sgst + igst);
      return {
        invoice_id: invoiceId,
        description: `Jobwork weaving - ${l.fq_code}${l.fq_name ? ' (' + l.fq_name + ')' : ''}`,
        quantity: l.quantity,
        rate: l.rate,
        hsn_sac: l.hsn || null,
        uom: l.uom,
        discount_pct: 0,
        discount_amount: 0,
        gst_rate_pct: gst,
        taxable_amount: taxable,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: igst,
        total_amount: lineTotal,
      };
    });

    const { error: lineErr } = await sb.from('invoice_line').insert(linesPayload);
    if (lineErr) {
      setBusy(false);
      setError(`Invoice ${invRow.invoice_no} saved but lines failed: ${lineErr.message}`);
      return;
    }

    // ── 3. Stamp invoice_id + status='invoiced' onto each picked DC ──
    const dcIds = Array.from(pickedDcIds);
    const { error: dcErr } = await sb
      .from('delivery_challan')
      .update({ invoice_id: invoiceId, status: 'invoiced' })
      .in('id', dcIds);
    if (dcErr) {
      setBusy(false);
      setError(`Invoice ${invRow.invoice_no} saved, but linking DCs failed: ${dcErr.message}`);
      return;
    }

    setBusy(false);
    router.push('/app/invoices?type=jobwork_invoice');
    router.refresh();
  }

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────

  return (
    <form className="space-y-4 max-w-6xl" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      {/* ───── Party + header ───── */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Invoice no</label>
            <div className="input bg-cloud/40 text-ink font-mono text-sm">
              {nextInvoiceCode || <span className="text-ink-mute">Auto (JB/...)</span>}
            </div>
          </div>
          <div>
            <label className="label">Jobwork Party *</label>
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className="input"
              required
            >
              <option value="">Select party...</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Bill Date *</label>
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="input"
              required
            />
          </div>
          <div>
            <label className="label">GST %</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={gstPct}
              onChange={(e) => setGstPct(e.target.value)}
              className="input"
            />
          </div>
        </div>

        {party !== null && (
          <div className="text-xs text-ink-soft space-y-0.5">
            {party.gstin && <div><b>GSTIN:</b> {party.gstin}</div>}
            {party.billing_address && <div><b>Address:</b> {party.billing_address}</div>}
            {party.state && <div><b>State:</b> {party.state} ({party.state_code ?? '-'}) &nbsp; {isInterstate ? <span className="pill bg-amber-50 text-amber-700">Interstate (IGST)</span> : <span className="pill bg-emerald-50 text-emerald-700">Intrastate (CGST+SGST)</span>}</div>}
          </div>
        )}
      </div>

      {/* ───── DC picker ───── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line/60 bg-cloud/40 flex items-center justify-between">
          <h2 className="font-display font-bold text-sm">Pick DCs to bill</h2>
          {dcs.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <button type="button" onClick={pickAll} className="text-indigo hover:underline">Pick all</button>
              <span className="text-ink-mute">·</span>
              <button type="button" onClick={clearAll} className="text-ink-soft hover:underline">Clear</button>
            </div>
          )}
        </div>
        {partyId === '' ? (
          <div className="p-6 text-center text-ink-mute text-sm">Pick a jobwork party first.</div>
        ) : loadingDcs ? (
          <div className="p-6 text-ink-mute text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading DCs...
          </div>
        ) : dcs.length === 0 ? (
          <div className="p-6 text-center text-ink-mute text-sm">
            No confirmed jobwork DCs waiting to be billed for this party.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-3 py-2 w-10" />
                <th className="text-left px-3 py-2">DC No</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Receipt</th>
                <th className="text-right px-3 py-2">Metres</th>
                <th className="text-right px-3 py-2">Pcs</th>
                <th className="text-right px-3 py-2">Bundles</th>
              </tr>
            </thead>
            <tbody>
              {dcs.map((d) => {
                const picked = pickedDcIds.has(d.id);
                const receipted = d.fabric_receipt_id !== null;
                return (
                  <tr
                    key={d.id}
                    className={'border-t border-line/40 ' +
                      (receipted ? 'cursor-pointer ' + (picked ? 'bg-indigo/5' : 'hover:bg-haze/60')
                                  : 'bg-rose-50/40 opacity-70')}
                    onClick={() => { if (receipted) toggleDc(d.id); }}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={picked}
                        disabled={!receipted}
                        onChange={() => toggleDc(d.id)}
                        onClick={(e) => e.stopPropagation()}
                        title={receipted ? 'Pick / unpick this DC' : 'DC has no fabric receipt yet - cannot bill'}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{d.code}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft">{fmtDate(d.dc_date)}</td>
                    <td className="px-3 py-2">
                      {receipted ? (
                        <span className="pill bg-emerald-50 text-emerald-700 text-[10px] uppercase tracking-wide">
                          Receipted
                        </span>
                      ) : (
                        <span className="pill bg-rose-50 text-rose-700 text-[10px] uppercase tracking-wide" title="Save a Fabric Receipt against this DC before billing">
                          Not receipted
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right num">{Number(d.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-right num">{d.total_pieces ?? 0}</td>
                    <td className="px-3 py-2 text-right num">{d.total_bundles ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ───── Auto-aggregated lines ───── */}
      {lines.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
            <h2 className="font-display font-bold text-sm">Bill lines (auto-calculated, not editable)</h2>
            <p className="text-[11px] text-ink-mute mt-0.5">
              Towel qualities bill per piece: rate = pick cost/m × towel length. Others bill per metre.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-3 py-2">Quality</th>
                <th className="text-left px-3 py-2">HSN</th>
                <th className="text-right px-3 py-2">Metres</th>
                <th className="text-right px-3 py-2">Pcs</th>
                <th className="text-right px-3 py-2">Bundles</th>
                <th className="text-right px-3 py-2">Qty (billed)</th>
                <th className="text-right px-3 py-2">Rate</th>
                <th className="text-right px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.fq_id} className="border-t border-line/40">
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.fq_code}</div>
                    {l.fq_name && <div className="text-[11px] text-ink-mute">{l.fq_name}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">{l.hsn || '-'}</td>
                  <td className="px-3 py-2 text-right num">{fmtMoney(l.metres)}</td>
                  <td className="px-3 py-2 text-right num">{l.pieces}</td>
                  <td className="px-3 py-2 text-right num">{l.bundles}</td>
                  <td className="px-3 py-2 text-right num">
                    <span className="font-semibold">{l.uom === 'pcs' ? l.quantity : fmtMoney(l.quantity)}</span>
                    <span className="text-[10px] text-ink-mute ml-1">{l.uom}</span>
                  </td>
                  <td className="px-3 py-2 text-right num">
                    {l.base_rate > 0 ? (
                      <>
                        <div>Rs {fmtMoney(l.rate)} / {l.uom}</div>
                        {l.uom === 'pcs' && (
                          <div className="text-[10px] text-ink-mute">
                            {fmtMoney(l.base_rate)} × {fmtMoney(l.towel_length)} m
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-rose-600 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> not set</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right num font-semibold">{fmtMoney(l.taxable)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line bg-cloud/30 font-semibold">
              <tr>
                <td className="px-3 py-2.5" colSpan={2}>Totals</td>
                <td className="px-3 py-2.5 text-right num">{fmtMoney(totals.metres)}</td>
                <td className="px-3 py-2.5 text-right num">{totals.pieces}</td>
                <td className="px-3 py-2.5 text-right num">{totals.bundles}</td>
                <td className="px-3 py-2.5"></td>
                <td className="px-3 py-2.5"></td>
                <td className="px-3 py-2.5 text-right num">{fmtMoney(totals.taxable)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ───── Tax summary ───── */}
      {lines.length > 0 && (
        <div className="card p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Taxable</div>
              <div className="num font-bold">Rs {fmtMoney(totals.taxable)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">CGST ({gst / 2}%)</div>
              <div className="num font-bold">Rs {fmtMoney(totals.cgst)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">SGST ({gst / 2}%)</div>
              <div className="num font-bold">Rs {fmtMoney(totals.sgst)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">IGST ({gst}%)</div>
              <div className="num font-bold">Rs {fmtMoney(totals.igst)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Grand total</div>
              <div className="num font-bold text-emerald-700 text-lg">Rs {fmtMoney(totals.grand)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="card p-4">
        <label className="label">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="input"
          placeholder="Anything to record on this bill"
        />
      </div>

      {error && (
        <div className="card p-3 text-err text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save jobwork bill
        </button>
        <button
          type="button"
          onClick={() => router.push('/app/invoices')}
          className="btn-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

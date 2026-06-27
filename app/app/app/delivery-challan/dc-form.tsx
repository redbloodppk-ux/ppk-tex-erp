'use client';
/**
 * Delivery Challan form (shared by /new and /[id]).
 *
 * Hierarchical item model:
 *   Item (fabric quality + HSN)
 *     Bundle #1
 *       Piece 1: 5.20 m
 *       Piece 2: 6.10 m
 *     Bundle #2
 *       Piece 1: 5.50 m
 *       ...
 *
 * The operator first says "how many bundles" - we render that many bundle
 * cards. In each card they add piece-metre entries (one entry per piece).
 *
 * Item-level snapshots:
 *   metres  = sum of every piece across every bundle
 *   pieces  = total piece count across every bundle
 *   bundles = number of bundles
 *
 * Header-level snapshots are sums across all items.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, Trash2, Save, X } from 'lucide-react';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';
import {
  leftoverBundles,
  selFromBundles,
  groupSelectionToBundles,
  type PieceSel,
} from '@/lib/dc-leftover';

export type ProductionMode = 'inhouse' | 'jobwork' | 'outsource';

export interface PartyOpt {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  billing_address: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  party_type_ids: number[] | null;
}

export interface QualityOpt {
  id: number;
  code: string | null;
  name: string;
  hsn: string | null;
  production_mode: string | null;
  is_merged: boolean | null;
  merged_name: string | null;
  /** Towel length (metres per piece) from the fabric_quality master. */
  meter_per_pc: number | null;
  /** Product type from the master. Only 'towel' is counted in pieces;
   *  fabric / woven / dhoties are metre deliveries. */
  fabric_type: string | null;
}

/** Each piece is just a metres value (as a string for controlled input). */
export type Piece = string;

/** A bundle is an ordered list of pieces. */
export interface Bundle {
  sno: number;
  pieces: Piece[];
}

export interface DcItem {
  id?: number;
  sno: number;
  fabric_quality_id: string;
  description: string;
  hsn: string;
  bundles: Bundle[];
  // Summary-mode totals: operator types these directly when the DC entry
  // mode is 'summary'. They are ignored in 'detailed' mode where the totals
  // get rolled up from bundles[].pieces[].
  summary_metres: string;
  summary_pieces: string;
  summary_bundles: string;
  /**
   * When the operator seeds an item from the "From production batches"
   * picker, this carries the source production_batch.id. On save we
   * persist it to delivery_challan_item.production_batch_id and write a
   * stock_ledger outflow with bucket='production_fabric',
   * source_kind='delivery_challan_item', referencing the same batch.
   *
   * Manually-entered items leave this null.
   */
  production_batch_id?: number | null;
}

/**
 * "From production batches" picker model. Each row represents one
 * production_batch that still has remaining production_fabric stock
 * (net inflow > outflow) so the operator can pick from it.
 */
export interface BatchOpt {
  id: number;
  batch_code: string;
  costing_id: number;
  quality_code: string | null;
  quality_name: string | null;
  /** fabric_quality.id whose costing_id matches this batch's costing_id. */
  fabric_quality_id: number | null;
  fabric_quality_hsn: string | null;
  entry_mode: 'summary' | 'detailed';
  produced_m: number;
  total_pieces: number | null;
  total_bundles: number | null;
  bundles_detail: Array<{ sno: number; pieces: number[] }>;
  /** Remaining (net inflow − outflow) in the inflow's unit. */
  available: number;
  /** Unit the batch's production_fabric inflow was recorded in. */
  unit: 'm' | 'pcs';
}

export type DcEntryMode = 'detailed' | 'summary';

export interface DcFormValues {
  id?: number;
  code?: string;
  dc_date: string;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
  production_mode: ProductionMode;
  /**
   * detailed - hierarchical bundle/piece grid (default)
   * summary  - flat totals only per fabric quality
   */
  entry_mode: DcEntryMode;
  /**
   * Optional link to the sales_order this DC partially / fully fulfils.
   * When set, the AFTER-trigger fn_so_refresh_status (migration 193)
   * walks the SO forward to partial_dispatch / dispatched.
   */
  sales_order_id: string;
  party_id: string;
  ship_to_same: boolean;
  ship_to_party_id: string;
  bill_to_name: string;
  bill_to_address: string;
  bill_to_gstin: string;
  bill_to_state: string;
  bill_to_state_code: string;
  ship_to_name: string;
  ship_to_address: string;
  ship_to_gstin: string;
  ship_to_state: string;
  ship_to_state_code: string;
  vehicle_no: string;
  notes: string;
  items: DcItem[];
}

interface DcFormProps {
  initial?: DcFormValues;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyItem(sno: number): DcItem {
  return {
    sno,
    fabric_quality_id: '',
    description: '',
    hsn: '',
    bundles: [{ sno: 1, pieces: [''] }],
    summary_metres: '',
    summary_pieces: '',
    summary_bundles: '',
    production_batch_id: null,
  };
}

export const EMPTY_DC: DcFormValues = {
  dc_date: todayISO(),
  status: 'draft',
  production_mode: 'inhouse',
  entry_mode: 'detailed',
  sales_order_id: '',
  party_id: '',
  ship_to_same: true,
  ship_to_party_id: '',
  bill_to_name: '', bill_to_address: '', bill_to_gstin: '', bill_to_state: '', bill_to_state_code: '',
  ship_to_name: '', ship_to_address: '', ship_to_gstin: '', ship_to_state: '', ship_to_state_code: '',
  vehicle_no: '',
  notes: '',
  items: [emptyItem(1)],
};

function num(s: string): number {
  const t = (s ?? '').toString().trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Sum of piece metres across one bundle. */
function bundleMetres(b: Bundle): number {
  return b.pieces.reduce((s, p) => s + num(p), 0);
}

/** Item-level snapshots: metres = sum across bundles, pieces = total
 *  pieces, bundles = bundle count. Empty piece strings are ignored. */
function itemTotals(it: DcItem, mode: DcEntryMode = 'detailed'): { metres: number; pieces: number; bundles: number } {
  if (mode === 'summary') {
    return {
      metres:  num(it.summary_metres),
      pieces:  Math.round(num(it.summary_pieces)),
      bundles: Math.round(num(it.summary_bundles)),
    };
  }
  let metres = 0;
  let pieces = 0;
  for (const b of it.bundles) {
    for (const p of b.pieces) {
      const v = num(p);
      if (v > 0) {
        metres += v;
        pieces += 1;
      }
    }
  }
  return { metres, pieces, bundles: it.bundles.length };
}

export function DeliveryChallanForm({ initial }: DcFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = initial?.id != null;

  const [form, setForm] = useState<DcFormValues>({ ...EMPTY_DC, ...(initial ?? {}) });
  const [allParties, setAllParties]         = useState<PartyOpt[]>([]);
  const [qualities,  setQualities]          = useState<QualityOpt[]>([]);
  // Open sales orders for the currently-picked customer. Refreshed
  // whenever the customer changes so the operator only sees SOs they
  // could plausibly be delivering against. Each row carries the total
  // metres and delivered-so-far metres so we can show the balance.
  const [openSos, setOpenSos] = useState<Array<{
    id: number; so_number: string; delivery_date: string | null;
    total_metres: number; delivered_metres: number;
  }>>([]);
  const [customerTypeId,  setCustomerTypeId]  = useState<number | null>(null);
  const [jobworkTypeId,   setJobworkTypeId]   = useState<number | null>(null);
  const [outsourceTypeId, setOutsourceTypeId] = useState<number | null>(null);
  // Recent vehicle numbers used on past DCs — fed into a native
  // <datalist> so the operator can pick one without retyping. Sourced
  // straight from delivery_challan.vehicle_no, deduped, and capped at
  // 50 so the suggestion list stays short.
  const [vehicleSuggestions, setVehicleSuggestions] = useState<string[]>([]);
  const [busy,  setBusy]  = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Preview of the next DC code the BEFORE INSERT trigger will mint
  // — peeked from doc_sequence so the operator knows the number ahead
  // of saving. Re-read whenever production_mode changes; each mode
  // pulls from its own series (DC / JDC / ODC).
  const [nextDcCode, setNextDcCode] = useState<string>('');

  // Items source toggle. 'manual' (default) keeps the existing form
  // behaviour where the operator types each item by hand. 'production_batch'
  // opens a picker that lists in-house production batches with leftover
  // stock and seeds one DC item per picked batch (quality, metres, pieces,
  // bundles, bundles_detail). Only meaningful for inhouse DCs.
  const [itemsSource, setItemsSource] = useState<'manual' | 'production_batch'>('manual');
  const [batchOpts, setBatchOpts] = useState<BatchOpt[]>([]);
  const [batchesLoading, setBatchesLoading] = useState<boolean>(false);
  // Per-batch piece selection state. Keyed by production_batch.id. Each
  // entry is the full list of that batch's leftover pieces, each flagged
  // selected / unselected and tagged with the DC bundle number it should
  // land in. Only populated for detailed-mode batches in the picker.
  const [batchSel, setBatchSel] = useState<Record<number, PieceSel[]>>({});
  // Keys "<batchId>:<dcBundleNo>" for bundle rows expanded in the
  // selection panel so the operator can see/toggle individual pieces.
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
  // Set of production_batch.ids currently ticked in the picker. Driven
  // off form.items so unchecking the picker stays in sync if the
  // operator deletes a seeded item directly from the list below.
  const pickedBatchIds = useMemo<Set<number>>(() => {
    const s = new Set<number>();
    for (const it of form.items) {
      if (it.production_batch_id != null) s.add(it.production_batch_id);
    }
    return s;
  }, [form.items]);

  // ---- Load reference data ----
  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [ptRes, partyRes, fqRes] = await Promise.all([
        sb.from('party_type_master').select('id, name').in('name', ['Customer', 'Jobwork Party', 'Outsource Weaver']),
        sb.from('party').select('id, code, name, gstin, billing_address, city, state, state_code, pincode, party_type_ids').eq('status', 'active').order('name'),
        sb.from('fabric_quality').select('id, code, name, hsn, production_mode, is_merged, merged_name, meter_per_pc, fabric_type').eq('active', true).order('name'),
      ]);
      const types = (ptRes.data ?? []) as Array<{ id: number; name: string }>;
      setCustomerTypeId(types.find((t) => t.name === 'Customer')?.id ?? null);
      setJobworkTypeId(types.find((t) => t.name === 'Jobwork Party')?.id ?? null);
      setOutsourceTypeId(types.find((t) => t.name === 'Outsource Weaver')?.id ?? null);
      setAllParties((partyRes.data ?? []) as PartyOpt[]);
      setQualities(((fqRes.data ?? []) as Array<Omit<QualityOpt, 'meter_per_pc'> & { meter_per_pc: number | string | null }>)
        .map((q) => ({ ...q, meter_per_pc: q.meter_per_pc != null && q.meter_per_pc !== '' ? Number(q.meter_per_pc) : null })));

      // Pull recent vehicle numbers for the autocomplete datalist.
      // We grab the last 200 DC vehicle entries (newest first), dedupe
      // case-insensitively, and keep the first 50 unique values. The
      // user usually rotates between a handful of trucks so this is
      // plenty without bloating the suggestion list.
      const vehRes = await sb
        .from('delivery_challan')
        .select('vehicle_no')
        .not('vehicle_no', 'is', null)
        .order('dc_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(200);
      const seen = new Set<string>();
      const uniques: string[] = [];
      for (const row of (vehRes.data ?? []) as Array<{ vehicle_no: string | null }>) {
        const v = (row.vehicle_no ?? '').trim().toUpperCase();
        if (v === '' || seen.has(v)) continue;
        seen.add(v);
        uniques.push(v);
        if (uniques.length >= 50) break;
      }
      setVehicleSuggestions(uniques);
    })();
  }, [supabase]);

  // ---- Load open SOs for the current customer ----
  // Only the "Against Sales Order" picker uses this list, and it's only
  // meaningful on in-house DCs (the SO flow doesn't apply to job-work /
  // outsource). Re-fetches when the picked customer changes; runs only
  // while production_mode='inhouse' so we don't ping the table for
  // jobwork / outsource party_ids.
  useEffect(() => {
    if (form.production_mode !== 'inhouse' || form.party_id === '') {
      setOpenSos([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data: soRows } = await sb
        .from('sales_order')
        .select('id, so_number, delivery_date, status')
        .eq('customer_id', Number(form.party_id))
        .in('status', ['approved', 'in_production', 'partial_dispatch', 'dispatched'])
        .order('order_date', { ascending: false })
        .limit(50);
      const sos = (soRows ?? []) as Array<{
        id: number; so_number: string; delivery_date: string | null;
      }>;
      if (sos.length === 0) { if (!cancelled) setOpenSos([]); return; }

      const ids = sos.map((s) => s.id);
      const { data: lineRows } = await sb
        .from('sales_order_line')
        .select('so_id, quantity_m, delivered_m')
        .in('so_id', ids);
      const tot = new Map<number, { total_metres: number; delivered_metres: number }>();
      for (const id of ids) tot.set(id, { total_metres: 0, delivered_metres: 0 });
      for (const ln of (lineRows ?? []) as Array<{ so_id: number; quantity_m: number | string | null; delivered_m: number | string | null }>) {
        const slot = tot.get(ln.so_id);
        if (!slot) continue;
        slot.total_metres     += Number(ln.quantity_m  ?? 0);
        slot.delivered_metres += Number(ln.delivered_m ?? 0);
      }

      if (cancelled) return;
      setOpenSos(sos.map((s) => ({
        id: s.id,
        so_number: s.so_number,
        delivery_date: s.delivery_date,
        total_metres:     tot.get(s.id)?.total_metres     ?? 0,
        delivered_metres: tot.get(s.id)?.delivered_metres ?? 0,
      })));
      // Auto-link when the customer has exactly one open SO and the
      // operator hasn't picked one yet (new DCs only). This stops
      // batch-picker DCs from silently saving with no SO link, which
      // leaves the order stuck at 'confirmed'. They can still switch it
      // back to "none" in the dropdown.
      const onlySo = sos.length === 1 ? sos[0] : undefined;
      if (!isEdit && onlySo) {
        const onlyId = String(onlySo.id);
        setForm((f) => (f.sales_order_id === '' ? { ...f, sales_order_id: onlyId } : f));
      }
    })();
    return () => { cancelled = true; };
  }, [form.party_id, form.production_mode, supabase, isEdit]);

  // ---- Party dropdown filtered by mode ----
  // Each production mode targets a specific party type:
  //   inhouse   → Customer
  //   jobwork   → Jobwork Party
  //   outsource → Outsource Weaver
  const filteredParties = useMemo<PartyOpt[]>(() => {
    if (form.production_mode === 'jobwork') {
      return jobworkTypeId === null
        ? allParties
        : allParties.filter((p) => (p.party_type_ids ?? []).includes(jobworkTypeId));
    }
    if (form.production_mode === 'outsource') {
      return outsourceTypeId === null
        ? allParties
        : allParties.filter((p) => (p.party_type_ids ?? []).includes(outsourceTypeId));
    }
    return customerTypeId === null
      ? allParties
      : allParties.filter((p) => (p.party_type_ids ?? []).includes(customerTypeId));
  }, [allParties, form.production_mode, customerTypeId, jobworkTypeId, outsourceTypeId]);

  const partyById = useMemo(() => new Map(allParties.map((p) => [p.id, p])), [allParties]);

  // Options for the type-ahead party pickers: "CODE - NAME" labels so the
  // operator can search by either the party code or any word of the name.
  const partyOptions = useMemo<SearchSelectOption[]>(
    () => filteredParties.map((p) => ({ value: String(p.id), label: `${p.code} - ${p.name}` })),
    [filteredParties],
  );
  const shipToOptions = useMemo<SearchSelectOption[]>(
    () => allParties.map((p) => ({ value: String(p.id), label: `${p.code} - ${p.name}` })),
    [allParties],
  );

  // Peek the next DC code from doc_sequence whenever the production
  // mode changes (or on first paint, when the form is new). Each mode
  // reads from its own row:
  //   inhouse   → 'dc'           (DC/26-27/NNNN)
  //   jobwork   → 'jobwork_dc'   (JDC/26-27/NNNN)
  //   outsource → 'outsource_dc' (ODC/26-27/NNNN)
  // The BEFORE INSERT trigger generates the real code on save; this
  // is purely a UI peek.
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    void (async () => {
      const docType = form.production_mode === 'jobwork'
        ? 'jobwork_dc'
        : form.production_mode === 'outsource'
          ? 'outsource_dc'
          : 'dc';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb
        .from('doc_sequence')
        .select('prefix, format, fy_code, next_value')
        .eq('doc_type', docType)
        .maybeSingle();
      if (cancelled) return;
      if (!data) { setNextDcCode(''); return; }
      const { prefix, format, fy_code, next_value } = data as {
        prefix: string; format: string; fy_code: string; next_value: number;
      };
      const seqMatch = /\{seq:(0+)\}/.exec(format);
      const width = seqMatch?.[1]?.length ?? 4;
      const seqStr = String(next_value).padStart(width, '0');
      const code = format
        .replace('{prefix}', prefix)
        .replace('{fy}', fy_code)
        .replace(/\{seq:0+\}/, seqStr);
      setNextDcCode(code);
    })();
    return () => { cancelled = true; };
  }, [form.production_mode, isEdit, supabase]);

  // ---- Load production batches with leftover stock ----
  // Fires whenever the operator flips the items source to
  // 'production_batch' on an in-house DC. We:
  //   1. Read every stock_ledger row for bucket='production_fabric'
  //      keyed by source_kind='production_batch', sum inflow − outflow
  //      per batch id and keep those with a positive remainder.
  //   2. Pull the matching production_batch rows + their costing_master
  //      (for quality_code / quality_name).
  //   3. Resolve a fabric_quality row whose costing_id matches, so the
  //      seeded item has the right fabric_quality_id + hsn. Batches
  //      whose costing has no linked fabric_quality are still shown but
  //      seeded with a null fabric_quality_id (the operator can pick
  //      one manually before saving).
  useEffect(() => {
    if (itemsSource !== 'production_batch') {
      setBatchOpts([]);
      return;
    }
    let cancelled = false;
    setBatchesLoading(true);
    const mode = form.production_mode;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;

      // Pieces already shipped per batch across NON-cancelled DCs. Used to
      // trim each batch down to its leftover bundles (by piece value, so
      // partial bundles and DC-side renumbering both work). Cancelled DCs
      // are excluded because their stock has been restored.
      const loadShippedByBatch = async (batchIds: number[]): Promise<Map<number, number[]>> => {
        const out = new Map<number, number[]>();
        if (batchIds.length === 0) return out;
        const { data: dciRows } = await sb
          .from('delivery_challan_item')
          .select('production_batch_id, bundles_detail, delivery_challan!inner(status)')
          .in('production_batch_id', batchIds);
        for (const d of (dciRows ?? []) as Array<{
          production_batch_id: number | null;
          bundles_detail: Array<{ sno: number; pieces: number[] }> | null;
          delivery_challan: { status: string } | Array<{ status: string }> | null;
        }>) {
          if (d.production_batch_id == null) continue;
          const dc = Array.isArray(d.delivery_challan) ? d.delivery_challan[0] : d.delivery_challan;
          if (dc?.status === 'cancelled') continue;
          const arr = out.get(d.production_batch_id) ?? [];
          for (const bd of (d.bundles_detail ?? [])) {
            for (const p of (bd.pieces ?? [])) arr.push(Number(p));
          }
          out.set(d.production_batch_id, arr);
        }
        return out;
      };

      // ===== jobwork / outsource: load batches from fabric_stock =====
      // These modes never write production_fabric ledger rows. Their produced
      // fabric lives as fabric_stock rows (one per batch, source_type matching
      // the mode). Available metres = metres_available (generated col), which
      // already nets any prior DC depletion of metres_out. We mirror the
      // in-house loader's shape so the picker/seed code is mode-agnostic.
      if (mode === 'jobwork' || mode === 'outsource') {
        const sourceType = mode === 'jobwork' ? 'jobwork' : 'outsourced';
        const { data: fsRows, error: fsErr } = await sb
          .from('fabric_stock')
          .select('id, batch_id, costing_id, metres_available')
          .eq('source_type', sourceType)
          .not('batch_id', 'is', null);
        if (fsErr || cancelled) {
          if (!cancelled) { setBatchOpts([]); setBatchesLoading(false); }
          return;
        }
        const availByBatch = new Map<number, number>();
        const costingByBatch = new Map<number, number>();
        for (const r of (fsRows ?? []) as Array<{
          id: number; batch_id: number | null; costing_id: number | null; metres_available: number | string | null;
        }>) {
          if (r.batch_id == null) continue;
          const id = Number(r.batch_id);
          availByBatch.set(id, (availByBatch.get(id) ?? 0) + Number(r.metres_available ?? 0));
          if (r.costing_id != null && !costingByBatch.has(id)) costingByBatch.set(id, Number(r.costing_id));
        }
        const liveIds: number[] = [];
        for (const [id, avail] of availByBatch) {
          if (avail > 0.0001) liveIds.push(id);
        }
        // Keep already-picked batches visible even if their remainder is 0
        // (this DC's planned depletion may have already zeroed metres_available).
        for (const id of pickedBatchIds) {
          if (!liveIds.includes(id)) liveIds.push(id);
        }
        if (liveIds.length === 0) {
          if (!cancelled) { setBatchOpts([]); setBatchesLoading(false); }
          return;
        }
        const { data: batchRows, error: batchErr } = await sb
          .from('production_batch')
          .select('id, batch_code, costing_id, produced_m, entry_mode, total_pieces, total_bundles, bundles_detail')
          .in('id', liveIds)
          .order('batch_code', { ascending: false });
        if (batchErr || cancelled) {
          if (!cancelled) { setBatchOpts([]); setBatchesLoading(false); }
          return;
        }
        const batches = (batchRows ?? []) as Array<{
          id: number; batch_code: string; costing_id: number;
          produced_m: number | string | null;
          entry_mode: string | null;
          total_pieces: number | null;
          total_bundles: number | null;
          bundles_detail: Array<{ sno: number; pieces: number[] }> | null;
        }>;
        if (batches.length === 0) {
          if (!cancelled) { setBatchOpts([]); setBatchesLoading(false); }
          return;
        }
        const costingIds = Array.from(new Set(batches.map((b) => b.costing_id)));
        const [cmRes, fqRes] = await Promise.all([
          sb.from('costing_master').select('id, quality_code, quality_name').in('id', costingIds),
          sb.from('fabric_quality').select('id, name, hsn, costing_id').in('costing_id', costingIds),
        ]);
        if (cancelled) { setBatchesLoading(false); return; }
        const cmById = new Map<number, { quality_code: string | null; quality_name: string | null }>();
        for (const c of (cmRes.data ?? []) as Array<{ id: number; quality_code: string | null; quality_name: string | null }>) {
          cmById.set(c.id, { quality_code: c.quality_code, quality_name: c.quality_name });
        }
        const fqByCostingId = new Map<number, { id: number; name: string; hsn: string | null }>();
        for (const fq of (fqRes.data ?? []) as Array<{ id: number; name: string; hsn: string | null; costing_id: number | null }>) {
          if (fq.costing_id == null) continue;
          if (!fqByCostingId.has(fq.costing_id)) {
            fqByCostingId.set(fq.costing_id, { id: fq.id, name: fq.name, hsn: fq.hsn });
          }
        }
        const shippedByBatch = await loadShippedByBatch(liveIds);
        if (cancelled) { setBatchesLoading(false); return; }
        const opts: BatchOpt[] = batches.map((b) => {
          const cm = cmById.get(b.costing_id);
          const fq = fqByCostingId.get(b.costing_id);
          const avail = availByBatch.get(b.id) ?? 0;
          const allBundles = (b.bundles_detail ?? []) as Array<{ sno: number; pieces: number[] }>;
          // Batches already picked on THIS DC keep their full bundle set so
          // the live selection isn't hidden; others are trimmed to leftovers.
          const lo = pickedBatchIds.has(b.id)
            ? { bundles: allBundles, pieces: allBundles.reduce((n, x) => n + x.pieces.length, 0) }
            : leftoverBundles(allBundles, shippedByBatch.get(b.id) ?? []);
          const trimmed = !pickedBatchIds.has(b.id) && (shippedByBatch.get(b.id)?.length ?? 0) > 0;
          return {
            id: b.id,
            batch_code: b.batch_code,
            costing_id: b.costing_id,
            quality_code: cm?.quality_code ?? null,
            quality_name: cm?.quality_name ?? null,
            fabric_quality_id: fq?.id ?? null,
            fabric_quality_hsn: fq?.hsn ?? null,
            entry_mode: (b.entry_mode === 'detailed' ? 'detailed' : 'summary'),
            // Seed the delivered metres from what's available (unit='m'), so
            // toggleBatchPick fills the line with the remaining metres.
            produced_m: avail > 0.0001 ? avail : Number(b.produced_m ?? 0),
            total_pieces: trimmed ? lo.pieces : b.total_pieces,
            total_bundles: trimmed ? lo.bundles.length : b.total_bundles,
            bundles_detail: lo.bundles,
            available: avail,
            unit: 'm',
          };
        });
        if (!cancelled) { setBatchOpts(opts); setBatchesLoading(false); }
        return;
      }

      // ===== in-house: load batches from production_fabric stock_ledger =====
      // 1. Sum all production_fabric ledger rows per batch.
      const { data: ledgerRows, error: ledErr } = await sb
        .from('stock_ledger')
        .select('source_id, direction, quantity, unit')
        .eq('bucket', 'production_fabric')
        .eq('source_kind', 'production_batch');
      if (ledErr || cancelled) {
        if (!cancelled) { setBatchOpts([]); setBatchesLoading(false); }
        return;
      }
      // Track per-batch: net available, the inflow unit (copied from
      // the first 'in' row we see for that batch).
      const perBatch = new Map<number, { net: number; unit: 'm' | 'pcs' }>();
      for (const r of (ledgerRows ?? []) as Array<{
        source_id: number | null; direction: string; quantity: number | string | null; unit: string | null;
      }>) {
        if (r.source_id == null) continue;
        const id = Number(r.source_id);
        const qty = Number(r.quantity ?? 0);
        const slot = perBatch.get(id) ?? { net: 0, unit: 'm' as 'm' | 'pcs' };
        if (r.direction === 'in') {
          slot.net += qty;
          // Lock the unit to the inflow's unit. If multiple inflows
          // disagree (shouldn't happen) the first one wins.
          const u = r.unit === 'pcs' ? 'pcs' : 'm';
          slot.unit = u;
        } else if (r.direction === 'out') {
          slot.net -= qty;
        }
        perBatch.set(id, slot);
      }

      // 1b. Subtract DC deliveries. Outflows are logged under
      // source_kind='delivery_challan_item' (source_id = the DC line id),
      // with the batch link living on delivery_challan_item.production_batch_id.
      // Without this a fully-delivered batch keeps its full original stock and
      // wrongly stays in the picker. We net each outflow back onto its batch
      // (and add back any reversal 'in' rows from a cancelled DC).
      const { data: dcLedger } = await sb
        .from('stock_ledger')
        .select('source_id, direction, quantity')
        .eq('bucket', 'production_fabric')
        .eq('source_kind', 'delivery_challan_item');
      const dciIds = Array.from(new Set(
        ((dcLedger ?? []) as Array<{ source_id: number | null }>)
          .map((r) => r.source_id)
          .filter((v): v is number => v != null),
      ));
      // Map DC line id -> batch id, and collect which bundle snos have
      // already left the building so we can show only leftover bundles.
      const dciToBatch = new Map<number, number>();
      if (dciIds.length > 0) {
        const { data: dciRows } = await sb
          .from('delivery_challan_item')
          .select('id, production_batch_id')
          .in('id', dciIds);
        for (const d of (dciRows ?? []) as Array<{
          id: number;
          production_batch_id: number | null;
        }>) {
          if (d.production_batch_id == null) continue;
          dciToBatch.set(d.id, d.production_batch_id);
        }
      }
      for (const r of (dcLedger ?? []) as Array<{
        source_id: number | null; direction: string; quantity: number | string | null;
      }>) {
        if (r.source_id == null) continue;
        const batchId = dciToBatch.get(Number(r.source_id));
        if (batchId == null) continue;
        const slot = perBatch.get(batchId);
        if (!slot) continue;
        const qty = Number(r.quantity ?? 0);
        if (r.direction === 'out') slot.net -= qty;
        else if (r.direction === 'in') slot.net += qty;
        perBatch.set(batchId, slot);
      }

      const liveIds: number[] = [];
      for (const [id, slot] of perBatch) {
        if (slot.net > 0.0001) liveIds.push(id);
      }
      // Also keep batches that are currently selected in the form so
      // the picker still shows them as ticked (otherwise the operator
      // could lose track of an already-seeded batch whose remainder is
      // 0 only because we've already counted this DC's planned outflow).
      for (const id of pickedBatchIds) {
        if (!liveIds.includes(id)) liveIds.push(id);
      }
      if (liveIds.length === 0) {
        if (!cancelled) { setBatchOpts([]); setBatchesLoading(false); }
        return;
      }

      // 2. Pull production_batch rows for those ids.
      const { data: batchRows, error: batchErr } = await sb
        .from('production_batch')
        .select('id, batch_code, costing_id, produced_m, entry_mode, total_pieces, total_bundles, bundles_detail')
        .in('id', liveIds)
        .order('batch_code', { ascending: false });
      if (batchErr || cancelled) {
        if (!cancelled) { setBatchOpts([]); setBatchesLoading(false); }
        return;
      }
      const batches = (batchRows ?? []) as Array<{
        id: number; batch_code: string; costing_id: number;
        produced_m: number | string | null;
        entry_mode: string | null;
        total_pieces: number | null;
        total_bundles: number | null;
        bundles_detail: Array<{ sno: number; pieces: number[] }> | null;
      }>;
      if (batches.length === 0) {
        if (!cancelled) { setBatchOpts([]); setBatchesLoading(false); }
        return;
      }

      // 3. Costings + their fabric_quality linkage.
      const costingIds = Array.from(new Set(batches.map((b) => b.costing_id)));
      const [cmRes, fqRes] = await Promise.all([
        sb.from('costing_master')
          .select('id, quality_code, quality_name')
          .in('id', costingIds),
        sb.from('fabric_quality')
          .select('id, name, hsn, costing_id')
          .in('costing_id', costingIds),
      ]);
      if (cancelled) { setBatchesLoading(false); return; }
      const cmById = new Map<number, { quality_code: string | null; quality_name: string | null }>();
      for (const c of (cmRes.data ?? []) as Array<{ id: number; quality_code: string | null; quality_name: string | null }>) {
        cmById.set(c.id, { quality_code: c.quality_code, quality_name: c.quality_name });
      }
      const fqByCostingId = new Map<number, { id: number; name: string; hsn: string | null }>();
      for (const fq of (fqRes.data ?? []) as Array<{ id: number; name: string; hsn: string | null; costing_id: number | null }>) {
        if (fq.costing_id == null) continue;
        // First fabric_quality wins per costing — multiple is rare.
        if (!fqByCostingId.has(fq.costing_id)) {
          fqByCostingId.set(fq.costing_id, { id: fq.id, name: fq.name, hsn: fq.hsn });
        }
      }

      const shippedByBatch = await loadShippedByBatch(liveIds);
      if (cancelled) { setBatchesLoading(false); return; }
      const opts: BatchOpt[] = batches.map((b) => {
        const cm = cmById.get(b.costing_id);
        const fq = fqByCostingId.get(b.costing_id);
        const slot = perBatch.get(b.id) ?? { net: 0, unit: 'm' as 'm' | 'pcs' };
        const allBundles = (b.bundles_detail ?? []) as Array<{ sno: number; pieces: number[] }>;
        // Trim to leftover pieces (by value). Batches already picked on THIS
        // DC keep their full set so the live selection isn't hidden.
        const lo = pickedBatchIds.has(b.id)
          ? { bundles: allBundles, pieces: allBundles.reduce((n, x) => n + x.pieces.length, 0) }
          : leftoverBundles(allBundles, shippedByBatch.get(b.id) ?? []);
        const trimmed = !pickedBatchIds.has(b.id) && (shippedByBatch.get(b.id)?.length ?? 0) > 0;
        return {
          id: b.id,
          batch_code: b.batch_code,
          costing_id: b.costing_id,
          quality_code: cm?.quality_code ?? null,
          quality_name: cm?.quality_name ?? null,
          fabric_quality_id: fq?.id ?? null,
          fabric_quality_hsn: fq?.hsn ?? null,
          entry_mode: (b.entry_mode === 'detailed' ? 'detailed' : 'summary'),
          produced_m: Number(b.produced_m ?? 0),
          total_pieces: trimmed ? lo.pieces : b.total_pieces,
          total_bundles: trimmed ? lo.bundles.length : b.total_bundles,
          bundles_detail: lo.bundles,
          available: slot.net,
          unit: slot.unit,
        };
      });
      if (!cancelled) {
        setBatchOpts(opts);
        setBatchesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [itemsSource, form.production_mode, supabase, pickedBatchIds]);

  // ---- Fabric quality dropdown filtered by DC production mode ----
  // String mismatch alert: delivery_challan.production_mode stores
  // 'jobwork' (no underscore) but fabric_quality.production_mode stores
  // 'job_work' (with underscore — see migration 065 + fabric quality
  // form). We normalize: the DC's 'jobwork' mode matches fabric
  // qualities whose production_mode is either 'job_work' or 'jobwork'.
  // In inhouse DCs we show everything that ISN'T a jobwork quality
  // (covers inhouse + outsourcing + null). Qualities already saved on
  // an item stay visible so the operator can see what was picked
  // before, even if the mode now disqualifies them.
  const filteredQualities = useMemo<QualityOpt[]>(() => {
    const keepIds = new Set<number>(
      form.items
        .map((it) => Number(it.fabric_quality_id))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
    const isJobworkQuality = (q: QualityOpt): boolean =>
      q.production_mode === 'job_work' || q.production_mode === 'jobwork';

    // Step 1: apply the production-mode filter (with keepIds escape
    // hatch so any quality already on an item stays visible).
    const modeFiltered = form.production_mode === 'jobwork'
      ? qualities.filter((q) => isJobworkQuality(q) || keepIds.has(q.id))
      : qualities.filter((q) => !isJobworkQuality(q) || keepIds.has(q.id));

    // Step 2: collapse merged-delivery siblings. For each merged group
    // (rows with is_merged=true sharing a merged_name), show ONE option
    // with the merged_name as the label. The option's value is the id
    // of a representative sibling - we prefer a sibling already saved
    // on an item so existing DCs reload correctly; otherwise the
    // smallest id wins.
    const mergedGroups = new Map<string, QualityOpt[]>();
    const standalone: QualityOpt[] = [];
    for (const q of modeFiltered) {
      if (q.is_merged && q.merged_name && q.merged_name.trim() !== '') {
        const mn = q.merged_name.trim();
        const list = mergedGroups.get(mn);
        if (list) list.push(q);
        else mergedGroups.set(mn, [q]);
      } else {
        standalone.push(q);
      }
    }
    const result: QualityOpt[] = [...standalone];
    for (const [mn, group] of mergedGroups) {
      const keepSibling = group.find((q) => keepIds.has(q.id));
      const rep = keepSibling ?? group.slice().sort((a, b) => a.id - b.id)[0]!;
      // Overlay the merged_name as the displayed `name` so the dropdown
      // option label reads "Bath Towel 30x60" instead of "FQ-0001".
      result.push({ ...rep, name: mn });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [qualities, form.production_mode, form.items]);

  function pickParty(partyIdStr: string): void {
    setForm((f) => {
      // Clear any previously-selected SO — it belonged to the old
      // customer and is no longer in the openSos list once the
      // customer changes.
      const next = { ...f, party_id: partyIdStr, sales_order_id: '' };
      const p = partyById.get(Number(partyIdStr));
      if (p) {
        next.bill_to_name       = p.name;
        next.bill_to_address    = [p.billing_address, p.city, p.pincode].filter(Boolean).join(', ');
        next.bill_to_gstin      = p.gstin ?? '';
        next.bill_to_state      = p.state ?? '';
        next.bill_to_state_code = p.state_code ?? '';
      }
      return next;
    });
  }

  function pickShipToParty(partyIdStr: string): void {
    setForm((f) => {
      const next = { ...f, ship_to_party_id: partyIdStr };
      const p = partyById.get(Number(partyIdStr));
      if (p) {
        next.ship_to_name       = p.name;
        next.ship_to_address    = [p.billing_address, p.city, p.pincode].filter(Boolean).join(', ');
        next.ship_to_gstin      = p.gstin ?? '';
        next.ship_to_state      = p.state ?? '';
        next.ship_to_state_code = p.state_code ?? '';
      }
      return next;
    });
  }

  // ---- Item helpers ----
  function setItem(idx: number, patch: Partial<DcItem>): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }
  function addItem(): void {
    setForm((f) => ({ ...f, items: [...f.items, emptyItem(f.items.length + 1)] }));
  }
  function removeItem(idx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.filter((_, i) => i !== idx).map((it, i) => ({ ...it, sno: i + 1 })),
    }));
  }
  function pickFabric(idx: number, fqIdStr: string): void {
    const fq = qualities.find((q) => String(q.id) === fqIdStr);
    setItem(idx, {
      fabric_quality_id: fqIdStr,
      description: fq?.name ?? '',
      hsn: fq?.hsn ?? '',
    });
  }

  // ---- Selection-panel mutators ----
  // Every mutator computes the next PieceSel[] for one batch and routes it
  // through applySelection so the DC item rebuilds in lock-step. They read
  // the live selection out of batchSel inside applySelection's own setter
  // path via the `cur` snapshot passed in by the caller.
  function currentSel(batchId: number): PieceSel[] {
    return batchSel[batchId] ?? [];
  }
  // Flip one piece (by its index in the batch's selection array) on/off.
  function togglePiece(batchId: number, idx: number): void {
    const cur = currentSel(batchId);
    const next = cur.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p));
    applySelection(batchId, next);
  }
  // Select / deselect every piece currently grouped under one DC bundle.
  function toggleBundle(batchId: number, dcBundle: number, selected: boolean): void {
    const cur = currentSel(batchId);
    const next = cur.map((p) => (p.dcBundle === dcBundle ? { ...p, selected } : p));
    applySelection(batchId, next);
  }
  // Select / deselect all pieces for the batch.
  function setAllPieces(batchId: number, selected: boolean): void {
    const cur = currentSel(batchId);
    const next = cur.map((p) => ({ ...p, selected }));
    applySelection(batchId, next);
  }
  // Move one piece (by index) into a different DC bundle number. Used to
  // regroup pieces across bundles on the DC without touching the batch.
  function movePiece(batchId: number, idx: number, dcBundle: number): void {
    const cur = currentSel(batchId);
    const next = cur.map((p, i) => (i === idx ? { ...p, dcBundle } : p));
    applySelection(batchId, next);
  }
  // Expand / collapse a bundle row in the selection panel.
  function toggleExpand(batchId: number, dcBundle: number): void {
    const key = `${batchId}:${dcBundle}`;
    setExpandedBundles((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ---- Production batch picker helpers ----
  // Rebuilds the seeded DC item for one batch from its current piece
  // selection. Groups the selected pieces into DC bundles (by their
  // assigned dcBundle number), recomputes the metres / pieces / bundles
  // totals, and writes them onto the matching form item. The batch's own
  // layout is untouched — only the DC item changes.
  function applySelection(batchId: number, sel: PieceSel[]): void {
    setBatchSel((m) => ({ ...m, [batchId]: sel }));
    const grouped = groupSelectionToBundles(sel);
    const selPieces = sel.filter((p) => p.selected);
    const metres = selPieces.reduce((s, p) => s + p.metres, 0);
    const metresR = Math.round(metres * 100) / 100;
    setForm((f) => ({
      ...f,
      items: f.items.map((it) => {
        if (it.production_batch_id !== batchId) return it;
        const bundles: Bundle[] = grouped.length > 0
          ? grouped.map((g) => ({ sno: g.sno, pieces: g.pieces.length > 0 ? g.pieces : [''] }))
          : [{ sno: 1, pieces: [''] }];
        return {
          ...it,
          bundles,
          summary_metres:  metresR > 0 ? String(metresR) : '',
          summary_pieces:  selPieces.length > 0 ? String(selPieces.length) : '',
          summary_bundles: grouped.length > 0 ? String(grouped.length) : '',
        };
      }),
    }));
  }

  // Seeds (or removes) a DC item for one batch. The seeded item is
  // pre-filled with the batch's fabric_quality, metres / pieces /
  // bundles snapshots, and a copy of its bundles_detail so the print
  // grid rehydrates correctly. The operator can still edit any field.
  function toggleBatchPick(batch: BatchOpt, checked: boolean): void {
    if (!checked) {
      // Drop this batch's piece-selection state alongside its item.
      setBatchSel((m) => {
        if (!(batch.id in m)) return m;
        const next = { ...m };
        delete next[batch.id];
        return next;
      });
    }
    setForm((f) => {
      if (!checked) {
        // Remove every item that points at this batch.
        const filtered = f.items.filter((it) => it.production_batch_id !== batch.id);
        const items = (filtered.length === 0 ? [emptyItem(1)] : filtered)
          .map((it, i) => ({ ...it, sno: i + 1 }));
        return { ...f, items };
      }
      // Already seeded? No-op.
      if (f.items.some((it) => it.production_batch_id === batch.id)) return f;

      const qualityLabel = batch.quality_name ?? batch.quality_code ?? '';
      const description = qualityLabel === ''
        ? batch.batch_code
        : `${qualityLabel} — ${batch.batch_code}`;

      // Mirror the batch's entry_mode onto this item so the operator
      // sees either the bundle grid (detailed) or the flat totals
      // (summary). We also rebuild the local `bundles` Bundle[] shape
      // from the saved bundles_detail so the grid is editable.
      const isDetailed = batch.entry_mode === 'detailed' && batch.bundles_detail.length > 0;
      const bundles: Bundle[] = isDetailed
        ? batch.bundles_detail.map((bd, i) => ({
            sno: i + 1,
            pieces: (bd.pieces ?? []).map((p) => String(p)),
          }))
        : [{ sno: 1, pieces: [''] }];

      // Summary totals — used in 'summary' entry mode AND surfaced as
      // the totals snapshot so the operator can verify at a glance.
      // 'metres' field on the DC item conceptually holds metres for
      // non-towel batches and pcs for towel-batches whose inflow was
      // recorded in pcs. The save flow uses these directly.
      const metres = batch.unit === 'm'
        ? batch.produced_m
        : (batch.total_pieces ?? batch.produced_m);
      const pieces = batch.total_pieces ?? 0;
      const bundleCount = batch.total_bundles ?? bundles.length;

      const seeded: DcItem = {
        sno: 0, // re-numbered below
        fabric_quality_id: batch.fabric_quality_id != null ? String(batch.fabric_quality_id) : '',
        description,
        hsn: batch.fabric_quality_hsn ?? '',
        bundles,
        summary_metres:  metres > 0 ? String(metres) : '',
        summary_pieces:  pieces > 0 ? String(pieces) : '',
        summary_bundles: bundleCount > 0 ? String(bundleCount) : '',
        production_batch_id: batch.id,
      };

      // If the current items list is just the default empty starter,
      // replace it; otherwise append.
      const isEmptyStarter = f.items.length === 1
        && f.items[0]!.fabric_quality_id === ''
        && f.items[0]!.description === ''
        && f.items[0]!.production_batch_id == null
        && f.items[0]!.summary_metres === ''
        && (f.items[0]!.bundles.length === 1 && (f.items[0]!.bundles[0]?.pieces.length ?? 0) === 1
            && (f.items[0]!.bundles[0]?.pieces[0] ?? '') === '');
      const next = isEmptyStarter ? [seeded] : [...f.items, seeded];
      return { ...f, items: next.map((it, i) => ({ ...it, sno: i + 1 })) };
    });
    // Seed piece-selection state for detailed batches so the operator can
    // pick/move individual pieces. Summary batches keep whole-quantity
    // behaviour and get no selection panel.
    if (checked && batch.entry_mode === 'detailed' && batch.bundles_detail.length > 0) {
      setBatchSel((m) => {
        if (batch.id in m) return m; // already seeded
        return { ...m, [batch.id]: selFromBundles(batch.bundles_detail) };
      });
    }
  }

  // ---- Bundle helpers ----
  // When the operator types "Bundles = N" we either grow or shrink the
  // bundle list to length N. New bundles start with one empty piece input.
  function setBundleCount(itemIdx: number, count: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        const target = Math.max(0, Math.min(count, 200));
        const cur = it.bundles;
        let next: Bundle[];
        if (target > cur.length) {
          const grow: Bundle[] = [];
          for (let k = cur.length; k < target; k++) {
            grow.push({ sno: k + 1, pieces: [''] });
          }
          next = [...cur, ...grow];
        } else if (target < cur.length) {
          next = cur.slice(0, target);
        } else {
          next = cur;
        }
        return { ...it, bundles: next.map((b, k) => ({ ...b, sno: k + 1 })) };
      }),
    }));
  }
  function setPiece(itemIdx: number, bundleIdx: number, pieceIdx: number, value: string): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => {
            if (j !== bundleIdx) return b;
            return { ...b, pieces: b.pieces.map((p, k) => (k === pieceIdx ? value : p)) };
          }),
        };
      }),
    }));
  }
  // Enter-as-Tab navigation. Attached at the items-container level so
  // a single handler covers every field inside the items section:
  // No. of bundles, No. of pieces, each piece input, summary inputs,
  // HSN, description, etc.
  //
  // Skipped on purpose:
  //   - <textarea>          (Enter keeps its native newline behaviour)
  //   - <button>            (Enter on a button should click it)
  //   - <input type="file"> (would steal focus before the picker opens)
  //
  // The walk is DOM-ordered so the focus chain naturally follows the
  // visible layout: bundle-count → No. of pieces → piece 1 → piece 2
  // → ... → next bundle's No. of pieces → ... → next item.
  function handleItemsEnter(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (tag === 'INPUT' && (target as HTMLInputElement).type === 'file') return;
    // IME composition (e.g. typing in a non-Latin script) — let the
    // user finish composing before we hijack Enter.
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();

    // Pull every focusable input/select inside the items container
    // (this DIV is what we attached the handler to via currentTarget).
    const container = e.currentTarget;
    const focusable = Array.from(container.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([type="hidden"]):not([type="file"]), select:not([disabled])',
    ));
    const idx = focusable.indexOf(target);
    if (idx === -1) return;
    const next = focusable[idx + 1];
    if (next) {
      next.focus();
      // Select the contents of number/text inputs so a fresh Enter →
      // type → Enter cycle replaces the value instead of appending.
      if (next instanceof HTMLInputElement &&
          (next.type === 'number' || next.type === 'text')) {
        next.select();
      }
    } else {
      target.blur();
    }
  }

  // Grow or shrink a bundle's piece list to length `count`. Mirrors
  // setBundleCount but one level deeper. Keeps any metres the operator
  // already typed; new piece slots start blank. Lower bound is 1 so
  // an existing bundle never collapses to zero rows (the operator can
  // still delete the bundle itself by lowering "No. of bundles").
  function setPieceCount(itemIdx: number, bundleIdx: number, count: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => {
            if (j !== bundleIdx) return b;
            const target = Math.max(1, Math.min(count, 200));
            const cur = b.pieces;
            let next: Piece[];
            if (target > cur.length) {
              const grow: Piece[] = [];
              for (let k = cur.length; k < target; k++) grow.push('');
              next = [...cur, ...grow];
            } else if (target < cur.length) {
              next = cur.slice(0, target);
            } else {
              next = cur;
            }
            return { ...b, pieces: next };
          }),
        };
      }),
    }));
  }
  function addPiece(itemIdx: number, bundleIdx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => (j === bundleIdx ? { ...b, pieces: [...b.pieces, ''] } : b)),
        };
      }),
    }));
  }
  function removePiece(itemIdx: number, bundleIdx: number, pieceIdx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => {
            if (j !== bundleIdx) return b;
            const next = b.pieces.filter((_, k) => k !== pieceIdx);
            return { ...b, pieces: next.length === 0 ? [''] : next };
          }),
        };
      }),
    }));
  }

  // ---- DC-level totals snapshot ----
  const headerTotals = useMemo(() => {
    let metres = 0, pieces = 0, bundles = 0;
    for (const it of form.items) {
      const t = itemTotals(it, form.entry_mode);
      metres  += t.metres;
      pieces  += t.pieces;
      bundles += t.bundles;
    }
    return { metres, pieces, bundles };
  }, [form.items, form.entry_mode]);

  // A fabric quality is a towel ONLY when its master's product type is
  // 'towel'. Towel items are counted in PIECES, so their "total" reads in
  // pcs instead of metres on the form and the print. We must NOT key off
  // meter_per_pc > 0 here: fabric / woven / dhoties qualities also carry a
  // meter_per_pc (used as a count<->metre factor), so that old heuristic
  // wrongly flagged metre deliveries as towels.
  const towelQualityIds = useMemo(() => {
    const s = new Set<number>();
    for (const q of qualities) {
      if (q.fabric_type === 'towel') s.add(q.id);
    }
    return s;
  }, [qualities]);
  // A towel line is counted in PIECES only when its values are whole
  // numbers (towel counts). If the operator entered decimal lengths
  // (e.g. 96.7) then — even on a towel quality — this is really a metre
  // delivery, so we fall back to reporting it under metres.
  const itemHasDecimalValue = (it: DcItem): boolean => {
    if (form.entry_mode === 'summary') {
      return !Number.isInteger(num(it.summary_metres));
    }
    for (const b of it.bundles) {
      for (const p of b.pieces) {
        const v = num(p);
        if (v > 0 && !Number.isInteger(v)) return true;
      }
    }
    return !Number.isInteger(itemTotals(it, form.entry_mode).metres);
  };
  const isTowelItem = (it: DcItem): boolean =>
    it.fabric_quality_id !== '' &&
    towelQualityIds.has(Number(it.fabric_quality_id)) &&
    !itemHasDecimalValue(it);

  // DC-level display split: towel pieces are reported separately from
  // woven metres so a towel DC never shows its piece count under "metres".
  // (headerTotals stays the source of truth for the saved row.)
  const headerDisplay = useMemo(() => {
    let metres = 0, towelPcs = 0;
    for (const it of form.items) {
      const t = itemTotals(it, form.entry_mode);
      if (isTowelItem(it)) towelPcs += Math.round(t.metres);
      else metres += t.metres;
    }
    return { metres, towelPcs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.items, form.entry_mode, towelQualityIds]);

  // ---- Save ----
  async function handleSave(): Promise<void> {
    setError(null);
    if (form.party_id === '') { setError('Pick a party.'); return; }
    if (!form.ship_to_same && form.ship_to_party_id === '') {
      setError('Pick a Ship-To party (or tick "Same as Bill-To").'); return;
    }
    if (form.vehicle_no.trim() === '') { setError('Vehicle number is required.'); return; }
    if (form.items.length === 0)       { setError('Add at least one item.'); return; }

    // Nudge the operator if this in-house DC could fulfil an open sales
    // order but none is linked — an unlinked DC never advances the SO
    // status (it stays 'confirmed'). They can still proceed deliberately.
    if (
      form.production_mode === 'inhouse' &&
      openSos.length > 0 &&
      form.sales_order_id === '' &&
      !window.confirm(
        `This customer has ${openSos.length} open sales order(s) but this DC is not linked to any. ` +
        `If it should fulfil one, pick it under "Against Sales Order" so the order status updates. ` +
        `Save without linking?`,
      )
    ) {
      return;
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const headerPayload = {
      dc_date: form.dc_date,
      status: form.status,
      production_mode: form.production_mode,
      entry_mode: form.entry_mode,
      sales_order_id: form.sales_order_id === '' ? null : Number(form.sales_order_id),
      party_id: Number(form.party_id),
      ship_to_same: form.ship_to_same,
      ship_to_party_id: form.ship_to_same ? null
        : (form.ship_to_party_id === '' ? null : Number(form.ship_to_party_id)),
      bill_to_name: form.bill_to_name || null,
      bill_to_address: form.bill_to_address || null,
      bill_to_gstin: form.bill_to_gstin || null,
      bill_to_state: form.bill_to_state || null,
      bill_to_state_code: form.bill_to_state_code || null,
      ship_to_name: form.ship_to_same ? form.bill_to_name : (form.ship_to_name || null),
      ship_to_address: form.ship_to_same ? form.bill_to_address : (form.ship_to_address || null),
      ship_to_gstin: form.ship_to_same ? form.bill_to_gstin : (form.ship_to_gstin || null),
      ship_to_state: form.ship_to_same ? form.bill_to_state : (form.ship_to_state || null),
      ship_to_state_code: form.ship_to_same ? form.bill_to_state_code : (form.ship_to_state_code || null),
      vehicle_no: form.vehicle_no.trim(),
      total_metres: headerTotals.metres,
      total_pieces: headerTotals.pieces,
      total_bundles: headerTotals.bundles,
      notes: form.notes || null,
    };

    let dcId: number;
    // dcCode is needed downstream when writing stock_ledger reference_no
    // entries for production-batch outflows. On edit we already have it
    // in form.code; on create we pull it back from the insert (the
    // BEFORE INSERT trigger fills it).
    let dcCode: string = (form.code ?? '').trim();
    if (isEdit && form.id != null) {
      // On edit only, allow overriding the auto-generated DC code so the
      // user can correct a typo or re-align to a different series. On
      // create we always let fn_autogen_code assign it.
      const editPayload = {
        ...headerPayload,
        code: (form.code ?? '').trim() || null,
      };
      const { error: err } = await sb.from('delivery_challan').update(editPayload).eq('id', form.id);
      if (err) { setBusy(false); setError(err.message); return; }
      dcId = form.id;
      // Drop and re-create items so the bundles_detail / batch link
      // stay in lock-step with the form state.
      // Also clear any prior production_fabric outflows tied to the
      // old items so the ledger doesn't double-count after re-insert.
      const { data: oldItems } = await sb
        .from('delivery_challan_item')
        .select('id, production_batch_id, metres')
        .eq('dc_id', dcId);
      const oldItemsTyped = (oldItems ?? []) as Array<{
        id: number; production_batch_id: number | null; metres: number | string | null;
      }>;
      const oldItemIds = oldItemsTyped.map((x) => x.id);
      if (oldItemIds.length > 0) {
        await sb.from('stock_ledger')
          .delete()
          .eq('bucket', 'production_fabric')
          .eq('source_kind', 'delivery_challan_item')
          .in('source_id', oldItemIds);
      }
      // jobwork/outsource don't use the production_fabric ledger — their
      // depletion lives in fabric_stock.metres_out. Restore (subtract back)
      // the old items' delivered metres before we re-insert + re-deplete,
      // mirroring the ledger delete above so an edit nets to zero drift.
      if (form.production_mode === 'jobwork' || form.production_mode === 'outsource') {
        const restoreByBatch = new Map<number, number>();
        for (const o of oldItemsTyped) {
          if (o.production_batch_id == null) continue;
          const qty = Number(o.metres ?? 0);
          if (!(qty > 0)) continue;
          restoreByBatch.set(o.production_batch_id, (restoreByBatch.get(o.production_batch_id) ?? 0) + qty);
        }
        if (restoreByBatch.size > 0) {
          const sourceType = form.production_mode === 'jobwork' ? 'jobwork' : 'outsourced';
          const bids = Array.from(restoreByBatch.keys());
          const { data: fsRows } = await sb
            .from('fabric_stock')
            .select('id, batch_id, metres_out')
            .eq('source_type', sourceType)
            .in('batch_id', bids);
          for (const r of (fsRows ?? []) as Array<{ id: number; batch_id: number | null; metres_out: number | string | null }>) {
            if (r.batch_id == null) continue;
            const delta = restoreByBatch.get(Number(r.batch_id));
            if (delta == null) continue;
            const newOut = Math.max(0, Number(r.metres_out ?? 0) - delta);
            await sb.from('fabric_stock').update({ metres_out: newOut }).eq('id', r.id);
          }
        }
      }
      await sb.from('delivery_challan_item').delete().eq('dc_id', dcId);
    } else {
      // On create, jobwork + outsource DCs may set a custom code
      // (e.g. to match a paper book number). In-house DCs always use
      // the auto-generated DC/26-27/NNNN. Blank code falls through to
      // the autogen trigger (which picks DC / JDC / ODC by
      // production_mode — see migration 114b).
      const customCodeAllowed = form.production_mode === 'jobwork' || form.production_mode === 'outsource';
      const createPayload = customCodeAllowed && (form.code ?? '').trim() !== ''
        ? { ...headerPayload, code: (form.code ?? '').trim() }
        : headerPayload;
      const { data, error: err } = await sb.from('delivery_challan').insert(createPayload).select('id, code').single();
      if (err || !data?.id) { setBusy(false); setError(err?.message ?? 'Insert failed'); return; }
      dcId = data.id as number;
      dcCode = (data.code as string | null) ?? dcCode;
    }

    const itemsPayload = form.items.map((it) => {
      const t = itemTotals(it, form.entry_mode);
      // Summary mode stores an empty bundles_detail array - the print
      // template uses that as the signal to skip the bundle grid and
      // just show the totals row.
      const bundles_detail = form.entry_mode === 'summary'
        ? []
        : it.bundles.map((b) => ({
            sno: b.sno,
            pieces: b.pieces.map((p) => num(p)).filter((n) => n > 0),
          }));
      return {
        dc_id: dcId,
        sno: it.sno,
        fabric_quality_id: it.fabric_quality_id === '' ? null : Number(it.fabric_quality_id),
        description: it.description || null,
        hsn: it.hsn || null,
        metres: t.metres || null,
        pieces: t.pieces || null,
        bundles: t.bundles || null,
        bundles_detail,
        production_batch_id: it.production_batch_id ?? null,
      };
    });
    // Track which inserted item.id belongs to which production_batch_id
    // so the post-insert ledger write knows where to point its outflow.
    // Items come back from Supabase in insert order, so pairing by
    // index is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let insertedItems: Array<{ id: number; production_batch_id: number | null; fabric_quality_id: number | null; metres: number | null; pieces: number | null }> = [];
    if (itemsPayload.length > 0) {
      const { data: itemRows, error: itemErr } = await sb
        .from('delivery_challan_item')
        .insert(itemsPayload)
        .select('id, production_batch_id, fabric_quality_id, metres, pieces');
      if (itemErr) { setBusy(false); setError(itemErr.message); return; }
      insertedItems = (itemRows ?? []) as typeof insertedItems;
    }

    // Production-batch outflows. In-house batches deplete via the
    // production_fabric stock_ledger (unit-matched outflow rows).
    // jobwork/outsource batches deplete via fabric_stock.metres_out
    // (handled in the else branch below).
    const ledgerBatchItems = insertedItems.filter((it) => it.production_batch_id != null);
    if (ledgerBatchItems.length > 0 && form.production_mode !== 'inhouse') {
      // ----- jobwork / outsource: bump fabric_stock.metres_out -----
      // metres_available is a generated column, so we never touch it —
      // we add the delivered metres onto metres_out. Phase 2 keeps one
      // fabric_stock row per batch, so a single update per batch suffices.
      const deltaByBatch = new Map<number, number>();
      for (const it of ledgerBatchItems) {
        const qty = Number(it.metres ?? 0);
        if (!(qty > 0)) continue;
        const bid = Number(it.production_batch_id);
        deltaByBatch.set(bid, (deltaByBatch.get(bid) ?? 0) + qty);
      }
      if (deltaByBatch.size > 0) {
        const sourceType = form.production_mode === 'jobwork' ? 'jobwork' : 'outsourced';
        const bids = Array.from(deltaByBatch.keys());
        const { data: fsRows, error: fsReadErr } = await sb
          .from('fabric_stock')
          .select('id, batch_id, metres_out')
          .eq('source_type', sourceType)
          .in('batch_id', bids);
        if (!fsReadErr) {
          for (const r of (fsRows ?? []) as Array<{ id: number; batch_id: number | null; metres_out: number | string | null }>) {
            if (r.batch_id == null) continue;
            const delta = deltaByBatch.get(Number(r.batch_id));
            if (delta == null) continue;
            const newOut = Number(r.metres_out ?? 0) + delta;
            const { error: updErr } = await sb
              .from('fabric_stock')
              .update({ metres_out: newOut })
              .eq('id', r.id);
            if (updErr) {
              // Non-fatal: the DC is already saved. Surface a warning so
              // the operator can reconcile fabric stock later.
              // eslint-disable-next-line no-console
              console.warn('DC saved but fabric_stock depletion failed:', updErr);
              setError(`DC saved but fabric stock depletion failed: ${updErr.message}`);
              setBusy(false);
              return;
            }
          }
        }
      }
    } else if (ledgerBatchItems.length > 0) {
      const uniqueBatchIds = Array.from(
        new Set(ledgerBatchItems.map((it) => Number(it.production_batch_id))),
      );
      const { data: inflowRows, error: inflowErr } = await sb
        .from('stock_ledger')
        .select('source_id, unit, fabric_quality_id')
        .eq('bucket', 'production_fabric')
        .eq('source_kind', 'production_batch')
        .eq('direction', 'in')
        .in('source_id', uniqueBatchIds);
      // Build a unit-lookup cache so we don't re-query per item.
      const unitByBatch = new Map<number, { unit: 'm' | 'pcs'; fabric_quality_id: number | null }>();
      if (!inflowErr) {
        for (const r of (inflowRows ?? []) as Array<{ source_id: number | null; unit: string | null; fabric_quality_id: number | null }>) {
          if (r.source_id == null) continue;
          unitByBatch.set(Number(r.source_id), {
            unit: r.unit === 'pcs' ? 'pcs' : 'm',
            fabric_quality_id: r.fabric_quality_id,
          });
        }
      }

      const outflowRows: Array<Record<string, unknown>> = [];
      for (const it of ledgerBatchItems) {
        const batchId = Number(it.production_batch_id);
        const lookup = unitByBatch.get(batchId);
        // Defensive fallback: if we couldn't find the inflow row (e.g.
        // stock_ledger was hand-edited), default to 'm' and the item's
        // own fabric_quality_id. The outflow will still write — it'll
        // just look mismatched in the warehouse pivot.
        const unit: 'm' | 'pcs' = lookup?.unit ?? 'm';
        const fqId = lookup?.fabric_quality_id ?? it.fabric_quality_id;
        // For towels the batch inflow is recorded in pcs as the TOWEL
        // COUNT, and the DC item stores that same count in `metres`
        // (the column is overloaded; `pieces` holds the number of
        // physical bundles/cuts, not towels). So the outflow quantity
        // is always `metres` — using `pieces` here under-deducted the
        // towel stock (e.g. 15 shipped instead of 800).
        const qty = Number(it.metres ?? 0);
        if (!(qty > 0)) continue;
        outflowRows.push({
          bucket: 'production_fabric',
          direction: 'out',
          fabric_quality_id: fqId,
          quantity: qty,
          unit,
          event_date: form.dc_date,
          source_kind: 'delivery_challan_item',
          source_id: it.id,
          reference_no: dcCode || null,
          notes: 'Shipped via DC from production batch',
        });
      }
      if (outflowRows.length > 0) {
        const { error: sledErr } = await sb.from('stock_ledger').insert(outflowRows);
        if (sledErr) {
          // Non-fatal: the DC is already saved. Surface a warning so
          // the operator can reconcile the warehouse pivot later
          // (same pattern as the invoice flow).
          // eslint-disable-next-line no-console
          console.warn('DC saved but production-batch stock ledger write failed:', sledErr);
          setError(`DC saved but production-batch stock ledger write failed: ${sledErr.message}`);
          setBusy(false);
          return;
        }
      }
    }

    setBusy(false);
    router.push('/app/delivery-challan');
    router.refresh();
  }

  return (
    <form className="card p-5 space-y-5 max-w-5xl" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      {/* Header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          {/*
            DC No is editable on:
              - any edit screen (fix typos / re-align series)
              - jobwork CREATE (so the operator can type a custom code
                that matches their paper book number)
            In-house CREATE stays locked - that's where strict sequential
            numbering matters most.
          */}
          {(() => {
            const canCustomise = form.production_mode === 'jobwork' || form.production_mode === 'outsource';
            const editable = isEdit || canCustomise;
            const hint = isEdit
              ? '(editable)'
              : (canCustomise ? '(optional - leave blank for auto)' : '');
            // Preview reads from doc_sequence (DC / JDC / ODC) so the
            // operator sees the actual next number, not a static
            // example. Falls back to the legacy stub if the load
            // hasn't completed.
            const fallbackStub = form.production_mode === 'jobwork'
              ? 'JDC/26-27/0001'
              : form.production_mode === 'outsource'
                ? 'ODC/26-27/0001'
                : 'DC/26-27/0001';
            const placeholder = nextDcCode || fallbackStub;
            return (
              <>
                <label className="label">
                  DC No {hint !== '' && <span className="text-[10px] text-ink-mute font-normal">{hint}</span>}
                </label>
                {editable ? (
                  <input
                    type="text"
                    className="input font-mono text-xs"
                    value={form.code ?? ''}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder={placeholder}
                    required={isEdit}
                  />
                ) : (
                  <div className="input bg-cloud/40 text-ink-mute font-mono text-xs">
                    {nextDcCode ? `Auto (${nextDcCode})` : 'Auto (assigned on save)'}
                  </div>
                )}
              </>
            );
          })()}
        </div>
        <div>
          <label className="label">DC Date *</label>
          <input type="date" className="input" required value={form.dc_date}
            onChange={(e) => setForm({ ...form, dc_date: e.target.value })} />
        </div>
        <div>
          <label className="label">
            Status
            <span className="text-[10px] text-ink-mute font-normal ml-2">(automatic)</span>
          </label>
          {/* Status is no longer hand-edited - it follows the workflow:
              new DC = draft → fabric receipt saved = confirmed → invoice
              raised = invoiced. The pill below mirrors what's stored. */}
          {(() => {
            const cls =
              form.status === 'invoiced'  ? 'bg-emerald-50 text-emerald-700'
              : form.status === 'confirmed' ? 'bg-amber-50 text-amber-700'
              : form.status === 'cancelled' ? 'bg-rose-50 text-rose-700'
              : 'bg-slate-100 text-slate-600';
            const label =
              form.status === 'invoiced'  ? 'Invoiced'
              : form.status === 'confirmed' ? 'Confirmed'
              : form.status === 'cancelled' ? 'Cancelled'
              : 'Draft';
            return (
              <div className="input bg-cloud/40 flex items-center">
                <span className={`pill ${cls} text-xs uppercase tracking-wide`}>{label}</span>
              </div>
            );
          })()}
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="label">Production Mode *</label>
          {/* Grid so the three buttons share the row width evenly on
              mobile instead of one overflowing off-screen. The parent
              cell spans both columns on mobile (col-span-2 in the
              grid-cols-2 viewport) so all three options fit on one line
              without truncating. */}
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button"
              onClick={() => setForm({ ...form, production_mode: 'inhouse', party_id: '', sales_order_id: '' })}
              className={'w-full px-2 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap ' +
                (form.production_mode === 'inhouse'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>In-house</button>
            <button type="button"
              onClick={() => setForm({ ...form, production_mode: 'jobwork', party_id: '', sales_order_id: '' })}
              className={'w-full px-2 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap ' +
                (form.production_mode === 'jobwork'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>Job-work</button>
            <button type="button"
              onClick={() => setForm({ ...form, production_mode: 'outsource', party_id: '', sales_order_id: '' })}
              className={'w-full px-2 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap ' +
                (form.production_mode === 'outsource'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>Outsource</button>
          </div>
        </div>
      </div>

      {/* Entry mode toggle — controls whether items are captured as a
          full bundle/piece grid or as flat totals per quality. */}
      <div>
        <label className="label">
          Item Entry Mode
          <span className="text-[10px] text-ink-mute font-normal ml-2">
            {form.entry_mode === 'detailed'
              ? 'Capture every bundle and piece (default).'
              : 'Type total metres / pieces / bundles per fabric quality only.'}
          </span>
        </label>
        <div className="flex gap-1.5 max-w-md">
          <button type="button"
            onClick={() => setForm({ ...form, entry_mode: 'detailed' })}
            className={'flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ' +
              (form.entry_mode === 'detailed'
                ? 'border-transparent bg-indigo-600 text-white'
                : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
            Detailed (bundle / piece)
          </button>
          <button type="button"
            onClick={() => setForm({ ...form, entry_mode: 'summary' })}
            className={'flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ' +
              (form.entry_mode === 'summary'
                ? 'border-transparent bg-indigo-600 text-white'
                : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
            Summary (totals only)
          </button>
        </div>
      </div>

      {/* Vehicle number — mandatory. Backed by a native datalist of
          recently-used vehicle numbers from past DCs so the operator
          can pick a familiar truck instead of retyping it. Typing a
          new value still works (it'll auto-add itself to the list the
          next time the form is opened, since the suggestions are
          re-pulled from delivery_challan.vehicle_no on mount). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Vehicle Number *</label>
          <input className="input num uppercase" required placeholder="TN 38 AB 1234"
            list="dc-vehicle-history"
            autoComplete="off"
            value={form.vehicle_no}
            onChange={(e) => setForm({ ...form, vehicle_no: e.target.value.toUpperCase() })} />
          <datalist id="dc-vehicle-history">
            {vehicleSuggestions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          {vehicleSuggestions.length > 0 && (
            <p className="text-[11px] text-ink-mute mt-1">
              Tip: start typing to pick from {vehicleSuggestions.length} recent vehicle number{vehicleSuggestions.length === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      </div>

      {/* Party */}
      <div className="rounded-lg border border-line bg-cloud/20 p-4 space-y-3">
        <div>
          <label className="label">
            {form.production_mode === 'jobwork'   ? 'Jobwork Party *'
             : form.production_mode === 'outsource' ? 'Outsource party *'
             : 'Customer *'}
          </label>
          {/* Type-ahead picker: typing any words of the name (or the
              party code) narrows the list — much faster than scrolling
              a long native dropdown. */}
          <SearchSelect
            options={partyOptions}
            value={form.party_id}
            onChange={pickParty}
            required
            placeholder={`Type to search ${form.production_mode === 'jobwork' ? 'jobwork party' : form.production_mode === 'outsource' ? 'outsource party' : 'customer'} name…`}
          />
        </div>

        {/* Against Sales Order — optional. Only shown for in-house DCs
            (the SO flow doesn't apply to job-work or outsource), once
            the operator has picked a customer. Listing open SOs lets
            the operator point this DC at one so the trigger from
            migration 193 walks the SO status forward. The summary line
            below shows balance metres so they can tell at a glance if
            this DC partially or fully fulfils it. */}
        {form.production_mode === 'inhouse' && form.party_id !== '' && openSos.length > 0 && (
          <div>
            <label className="label">
              Against Sales Order
              <span className="text-[10px] text-ink-mute font-normal ml-2">(optional)</span>
            </label>
            <select
              className="input h-9 text-sm"
              value={form.sales_order_id}
              onChange={(e) => setForm({ ...form, sales_order_id: e.target.value })}
            >
              <option value="">--- none ---</option>
              {openSos.map((s) => {
                const balance = Math.max(0, s.total_metres - s.delivered_metres);
                const parts = [s.so_number];
                if (s.delivery_date) parts.push(`delivery ${s.delivery_date}`);
                parts.push(`${balance.toFixed(2)} m left`);
                return (
                  <option key={s.id} value={s.id}>
                    {parts.join(' · ')}
                  </option>
                );
              })}
            </select>
            {form.sales_order_id !== '' && (() => {
              const s = openSos.find((x) => String(x.id) === form.sales_order_id);
              if (!s) return null;
              const balance = Math.max(0, s.total_metres - s.delivered_metres);
              return (
                <p className="text-[11px] text-ink-mute mt-1">
                  {s.so_number} · delivery {s.delivery_date ?? '—'} ·
                  ordered {s.total_metres.toFixed(2)} m · delivered {s.delivered_metres.toFixed(2)} m ·
                  <span className="font-semibold text-indigo-700"> balance {balance.toFixed(2)} m</span>
                </p>
              );
            })()}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">Bill-To Name</label>
            <input className="input" value={form.bill_to_name}
              onChange={(e) => setForm({ ...form, bill_to_name: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Bill-To GSTIN</label>
            <input className="input num uppercase" value={form.bill_to_gstin}
              onChange={(e) => setForm({ ...form, bill_to_gstin: e.target.value.toUpperCase() })} />
          </div>
          <div className="md:col-span-2">
            <label className="label text-xs">Bill-To Address</label>
            <textarea className="input min-h-[60px]" value={form.bill_to_address}
              onChange={(e) => setForm({ ...form, bill_to_address: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">State</label>
            <input className="input" value={form.bill_to_state}
              onChange={(e) => setForm({ ...form, bill_to_state: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">State Code</label>
            <input className="input num" maxLength={2} value={form.bill_to_state_code}
              onChange={(e) => setForm({ ...form, bill_to_state_code: e.target.value })} />
          </div>
        </div>
      </div>

      {/* Ship-To */}
      <div className="rounded-lg border border-line bg-cloud/20 p-4 space-y-3">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={form.ship_to_same}
            onChange={(e) => setForm({ ...form, ship_to_same: e.target.checked })} />
          <span className="text-sm font-semibold">Ship-To same as Bill-To</span>
        </label>
        {!form.ship_to_same && (
          <>
            <div>
              <label className="label">Ship-To Party</label>
              <SearchSelect
                options={shipToOptions}
                value={form.ship_to_party_id}
                onChange={pickShipToParty}
                placeholder="Type to search shipping party name…"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">Ship-To Name</label>
                <input className="input" value={form.ship_to_name}
                  onChange={(e) => setForm({ ...form, ship_to_name: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">Ship-To GSTIN</label>
                <input className="input num uppercase" value={form.ship_to_gstin}
                  onChange={(e) => setForm({ ...form, ship_to_gstin: e.target.value.toUpperCase() })} />
              </div>
              <div className="md:col-span-2">
                <label className="label text-xs">Ship-To Address</label>
                <textarea className="input min-h-[60px]" value={form.ship_to_address}
                  onChange={(e) => setForm({ ...form, ship_to_address: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">State</label>
                <input className="input" value={form.ship_to_state}
                  onChange={(e) => setForm({ ...form, ship_to_state: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">State Code</label>
                <input className="input num" maxLength={2} value={form.ship_to_state_code}
                  onChange={(e) => setForm({ ...form, ship_to_state_code: e.target.value })} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Items source toggle.
          'Manual entry' keeps the original UX where the operator types
          each item by hand. 'From production batches' opens a checklist
          of in-house production batches that still have leftover stock
          (net inflow > outflow in the production_fabric bucket) — ticking
          one seeds a DC item with the batch's quality, metres, pieces,
          bundles, and bundles_detail. On save the DC writes a matching
          stock_ledger outflow that depletes the batch's inflow.
          Only meaningful on inhouse DCs — jobwork / outsource modes still
          flow through the fabric_receipt path. */}
      {(form.production_mode === 'inhouse'
        || form.production_mode === 'jobwork'
        || form.production_mode === 'outsource') && (
        <div>
          <label className="label">
            Items Source
            <span className="text-[10px] text-ink-mute font-normal ml-2">
              {itemsSource === 'manual'
                ? 'Type each item by hand (default).'
                : form.production_mode === 'inhouse'
                  ? 'Pick from in-house production batches with leftover stock.'
                  : 'Pick from produced batches with leftover fabric stock.'}
            </span>
          </label>
          <div className="flex gap-1.5 max-w-md">
            <button type="button"
              onClick={() => setItemsSource('manual')}
              className={'flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ' +
                (itemsSource === 'manual'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
              Manual entry
            </button>
            <button type="button"
              onClick={() => setItemsSource('production_batch')}
              className={'flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ' +
                (itemsSource === 'production_batch'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
              From production batches
            </button>
          </div>
        </div>
      )}

      {/* Production batch picker — when the toggle is flipped (any of the
          three production modes). Each row is a checkbox that seeds (or
          removes) a DC item for that batch. In-house pulls leftover stock
          from the production_fabric ledger; jobwork/outsource pull from
          fabric_stock. Selected items remain freely editable below. */}
      {itemsSource === 'production_batch' && (
        <div className="rounded-lg border border-line bg-paper">
          <div className="flex items-center justify-between p-3 border-b border-line/60">
            <h3 className="font-display font-bold text-sm">Pick production batches</h3>
            <span className="text-[11px] text-ink-mute">
              {batchesLoading
                ? 'Loading…'
                : `${batchOpts.length} batch${batchOpts.length === 1 ? '' : 'es'} with stock`}
            </span>
          </div>
          <div className="p-3 space-y-1.5 max-h-96 overflow-auto">
            {batchesLoading && (
              <div className="text-xs text-ink-mute py-2">Loading production batches…</div>
            )}
            {!batchesLoading && batchOpts.length === 0 && (
              <div className="text-xs text-ink-mute py-2">
                No production batches with leftover stock right now.
              </div>
            )}
            {batchOpts.map((b) => {
              const checked = pickedBatchIds.has(b.id);
              const qualityLabel = b.quality_name ?? b.quality_code ?? '(no quality)';
              const unitLabel = b.unit === 'pcs' ? 'pcs' : 'm';
              const noLink = b.fabric_quality_id == null;
              // The piece-selection panel only applies to detailed batches
              // (those carry a real bundle/piece layout). Summary batches
              // keep whole-quantity behaviour and show no panel.
              const showPanel = checked
                && b.entry_mode === 'detailed'
                && b.bundles_detail.length > 0;
              const sel = batchSel[b.id] ?? [];
              // Group the selection into the DC bundle buckets it currently
              // maps to, preserving each piece's index in `sel` so the
              // mutators can address it.
              const bundleNos = Array.from(new Set(sel.map((p) => p.dcBundle))).sort((a, c) => a - c);
              const selCount = sel.filter((p) => p.selected).length;
              return (
                <Fragment key={b.id}>
                <label
                  className={'flex items-start gap-2 p-2 rounded border cursor-pointer ' +
                    (checked
                      ? 'border-indigo-400 bg-indigo-50/60'
                      : 'border-line bg-white hover:bg-haze/40')}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={(e) => toggleBatchPick(b, e.target.checked)}
                  />
                  <div className="flex-1 text-xs">
                    <div className="font-semibold text-ink">
                      {b.batch_code}
                      <span className="ml-2 text-ink-soft font-normal">{qualityLabel}</span>
                    </div>
                    <div className="text-[11px] text-ink-mute mt-0.5">
                      Available: <span className="font-mono">{b.available.toFixed(2)} {unitLabel}</span>
                      {b.total_pieces != null && b.total_pieces > 0 && (
                        <> · {b.total_pieces} pcs</>
                      )}
                      {b.total_bundles != null && b.total_bundles > 0 && (
                        <> · {b.total_bundles} bundles</>
                      )}
                      {noLink && (
                        <span className="ml-2 text-amber-700">
                          no fabric_quality linked — set one before saving
                        </span>
                      )}
                    </div>
                  </div>
                </label>
                {showPanel && (
                  <div className="ml-6 mb-1 rounded border border-indigo-200 bg-white p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-ink-soft">
                        Pieces on this DC: <span className="font-mono">{selCount}</span> / {sel.length}
                      </span>
                      <span className="flex gap-1.5">
                        <button type="button"
                          className="text-[11px] text-indigo-600 hover:underline"
                          onClick={() => setAllPieces(b.id, true)}>
                          Select all
                        </button>
                        <span className="text-line">·</span>
                        <button type="button"
                          className="text-[11px] text-indigo-600 hover:underline"
                          onClick={() => setAllPieces(b.id, false)}>
                          Clear
                        </button>
                      </span>
                    </div>
                    {bundleNos.map((bn) => {
                      const key = `${b.id}:${bn}`;
                      const expanded = expandedBundles.has(key);
                      // pieces in this DC bundle, with their sel index
                      const inBundle = sel
                        .map((p, i) => ({ p, i }))
                        .filter((x) => x.p.dcBundle === bn);
                      const allOn = inBundle.length > 0 && inBundle.every((x) => x.p.selected);
                      const someOn = inBundle.some((x) => x.p.selected);
                      const bundleMetres = inBundle
                        .filter((x) => x.p.selected)
                        .reduce((s, x) => s + x.p.metres, 0);
                      return (
                        <div key={bn} className="rounded border border-line/70 bg-haze/20">
                          <div className="flex items-center gap-2 px-2 py-1">
                            <input
                              type="checkbox"
                              checked={allOn}
                              ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
                              onChange={(e) => toggleBundle(b.id, bn, e.target.checked)}
                            />
                            <button type="button"
                              className="flex-1 flex items-center justify-between text-left text-[11px]"
                              onClick={() => toggleExpand(b.id, bn)}>
                              <span className="font-semibold text-ink">
                                Bundle {bn}
                                <span className="ml-1.5 font-normal text-ink-mute">
                                  {inBundle.filter((x) => x.p.selected).length}/{inBundle.length} pcs
                                  · <span className="font-mono">{(Math.round(bundleMetres * 100) / 100)}</span> {unitLabel}
                                </span>
                              </span>
                              <span className="text-ink-mute">{expanded ? '▾' : '▸'}</span>
                            </button>
                          </div>
                          {expanded && (
                            <div className="px-2 pb-1.5 grid grid-cols-1 gap-1">
                              {inBundle.map(({ p, i }) => (
                                <div key={i} className="flex items-center gap-2 text-[11px]">
                                  <input
                                    type="checkbox"
                                    checked={p.selected}
                                    onChange={() => togglePiece(b.id, i)}
                                  />
                                  <span className="font-mono w-16">{p.metres} {unitLabel}</span>
                                  <span className="text-ink-mute">orig bundle {p.origSno}</span>
                                  <label className="ml-auto flex items-center gap-1 text-ink-mute">
                                    move to
                                    <input
                                      type="number"
                                      min={1}
                                      value={p.dcBundle}
                                      onChange={(e) => {
                                        const v = parseInt(e.target.value, 10);
                                        if (Number.isFinite(v) && v >= 1) movePiece(b.id, i, v);
                                      }}
                                      className="input h-6 w-12 text-[11px] px-1"
                                    />
                                  </label>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Items + bundles */}
      <div className="rounded-lg border border-line bg-paper">
        <div className="flex items-center justify-between p-3 border-b border-line/60">
          <h3 className="font-display font-bold text-sm">Items</h3>
          <button type="button" className="btn-ghost text-xs" onClick={addItem}>
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>
        {/* onKeyDown on the items container drives Enter-as-Tab navigation
            across every input/select inside (CORR-ext2). Textareas and
            buttons are skipped inside the handler. */}
        <div className="p-3 space-y-4" onKeyDown={handleItemsEnter}>
          {form.items.map((it, itemIdx) => {
            const tot = itemTotals(it, form.entry_mode);
            return (
              <div key={itemIdx} className="rounded-lg border border-line bg-cloud/10 p-3 space-y-3">
                {/* Item header row */}
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-12 md:col-span-1 text-xs text-ink-mute pt-2">Item #{it.sno}</div>
                  <div className="col-span-12 md:col-span-4">
                    <label className="label text-[10px]">Fabric Quality</label>
                    <select className="input h-9 text-sm w-full"
                      value={it.fabric_quality_id}
                      onChange={(e) => pickFabric(itemIdx, e.target.value)}>
                      <option value="">--- pick ---</option>
                      {filteredQualities.map((q) => (
                        <option key={q.id} value={q.id}>{q.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-8 md:col-span-4">
                    <label className="label text-[10px]">Description</label>
                    <input className="input h-9 text-sm" value={it.description}
                      onChange={(e) => setItem(itemIdx, { description: e.target.value })} />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <label className="label text-[10px]">HSN</label>
                    <input className="input h-9 text-sm num" value={it.hsn}
                      onChange={(e) => setItem(itemIdx, { hsn: e.target.value })} />
                  </div>
                  <div className="col-span-12 md:col-span-1 flex justify-end md:justify-center pt-5">
                    <button type="button"
                      onClick={() => removeItem(itemIdx)}
                      disabled={form.items.length === 1}
                      className="p-1.5 rounded hover:bg-rose-50 text-rose-600 disabled:opacity-40"
                      title={form.items.length === 1 ? 'At least one item is required' : 'Remove item'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Summary mode: just three flat input fields per item.
                    Detailed mode (default) shows the bundle grid below. */}
                {form.entry_mode === 'summary' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-line/40 pt-3">
                    <div>
                      <label className="label text-[10px]">Total metres / towels</label>
                      <input type="number" step={0.01} min={0}
                        className="input h-9 text-sm num text-right"
                        placeholder="0.00"
                        value={it.summary_metres}
                        onChange={(e) => setForm({
                          ...form,
                          items: form.items.map((x, i) => i === itemIdx ? { ...x, summary_metres: e.target.value } : x),
                        })} />
                    </div>
                    <div>
                      <label className="label text-[10px]">Total pieces</label>
                      <input type="number" step={1} min={0}
                        className="input h-9 text-sm num text-right"
                        placeholder="0"
                        value={it.summary_pieces}
                        onChange={(e) => setForm({
                          ...form,
                          items: form.items.map((x, i) => i === itemIdx ? { ...x, summary_pieces: e.target.value } : x),
                        })} />
                    </div>
                    <div>
                      <label className="label text-[10px]">Total bundles</label>
                      <input type="number" step={1} min={0}
                        className="input h-9 text-sm num text-right"
                        placeholder="0"
                        value={it.summary_bundles}
                        onChange={(e) => setForm({
                          ...form,
                          items: form.items.map((x, i) => i === itemIdx ? { ...x, summary_bundles: e.target.value } : x),
                        })} />
                    </div>
                  </div>
                ) : (
                <>
                {/* Bundles count picker */}
                <div className="flex flex-wrap items-end gap-3 border-t border-line/40 pt-3">
                  <div>
                    <label className="label text-[10px]">No. of bundles</label>
                    <input type="number" min={0} max={200} step={1}
                      className="input h-9 text-sm num w-28 text-right"
                      value={it.bundles.length}
                      onChange={(e) => setBundleCount(itemIdx, Number(e.target.value) || 0)} />
                  </div>
                  <p className="text-[11px] text-ink-mute pb-2">
                    Type the bundle count, then inside each bundle type its piece count and fill the metres for each piece.
                  </p>
                </div>

                {/* Per-bundle piece-entry cards */}
                {it.bundles.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {it.bundles.map((b, bundleIdx) => {
                      const bMetres = bundleMetres(b);
                      const bPieces = b.pieces.filter((p) => num(p) > 0).length;
                      return (
                        <div key={bundleIdx} className="rounded-lg border border-line bg-white p-2.5">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-ink-soft">Bundle #{b.sno}</span>
                            <span className="text-[10px] text-ink-mute">
                              {bPieces} pcs / {bMetres.toFixed(2)} m
                            </span>
                          </div>
                          {/* Pieces-count picker — same UX as the bundle count
                              picker above. Type N to spawn N empty piece rows. */}
                          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-line/60">
                            <label className="text-[10px] uppercase tracking-wide text-ink-mute">No. of pieces</label>
                            <input
                              type="number" min={1} max={200} step={1}
                              className="input h-7 text-xs num w-16 text-right"
                              value={b.pieces.length}
                              onChange={(e) => setPieceCount(itemIdx, bundleIdx, Number(e.target.value) || 1)}
                            />
                          </div>
                          <div className="space-y-1">
                            {b.pieces.map((p, pieceIdx) => (
                              <div key={pieceIdx} className="flex items-center gap-1">
                                <span className="text-[10px] text-ink-mute w-5 text-right">{pieceIdx + 1}.</span>
                                <input
                                  id={`dc-piece-${itemIdx}-${bundleIdx}-${pieceIdx}`}
                                  type="number" step={0.01} min={0}
                                  placeholder="metres"
                                  className="input h-8 text-xs num flex-1 text-right"
                                  value={p}
                                  onChange={(e) => setPiece(itemIdx, bundleIdx, pieceIdx, e.target.value)}
                                />
                                <button type="button"
                                  onClick={() => removePiece(itemIdx, bundleIdx, pieceIdx)}
                                  disabled={b.pieces.length === 1}
                                  className="text-rose-500 hover:text-rose-700 p-1 disabled:opacity-30"
                                  title="Remove piece">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button type="button"
                            onClick={() => addPiece(itemIdx, bundleIdx)}
                            className="mt-1.5 w-full text-[11px] text-indigo-700 hover:bg-indigo-50 py-1 rounded border border-dashed border-line">
                            + Add piece
                          </button>
                          <div className="mt-1.5 pt-1.5 border-t border-line/60 text-right text-[11px] font-semibold text-indigo-700">
                            Total: {bMetres.toFixed(2)} m
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </>
                )}

                {/* Item totals (auto-snapshot). Towel qualities are
                    counted in pieces, so their headline total reads pcs. */}
                <div className="flex flex-wrap justify-end gap-4 border-t border-line/40 pt-2 text-xs">
                  {isTowelItem(it) ? (
                    <>
                      <div>Total Towel Pcs: <span className="num font-bold text-indigo-700">{Math.round(tot.metres)} pcs</span></div>
                      <div>No. of Pcs: <span className="num font-bold">{tot.pieces}</span></div>
                    </>
                  ) : (
                    <>
                      <div>Total Metres: <span className="num font-bold text-indigo-700">{tot.metres.toFixed(2)} m</span></div>
                      <div>No. of Pcs: <span className="num font-bold">{tot.pieces}</span></div>
                    </>
                  )}
                  <div>No. of Bundles: <span className="num font-bold">{tot.bundles}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* DC-level totals. Towel pieces are surfaced on their own line
            and excluded from the metres figure. */}
        <div className="border-t-2 border-line bg-cloud/40 px-3 py-3 flex flex-wrap justify-end gap-6 text-sm font-semibold">
          {headerDisplay.towelPcs > 0 && (
            <div>DC Total Towels: <span className="num text-indigo-700">{headerDisplay.towelPcs} pcs</span></div>
          )}
          {headerDisplay.metres > 0 && (
            <div>DC Total Metres: <span className="num text-indigo-700">{headerDisplay.metres.toFixed(2)} m</span></div>
          )}
          <div>DC Total Pcs: <span className="num">{headerTotals.pieces}</span></div>
          <div>DC Total Bundles: <span className="num">{headerTotals.bundles}</span></div>
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[60px]" value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-2">{error}</div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={() => router.back()} disabled={busy}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isEdit ? 'Save Changes' : 'Create DC'}
        </button>
      </div>
    </form>
  );
}

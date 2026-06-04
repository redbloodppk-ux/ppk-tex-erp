/**
 * Fabric Receipt stock reductions.
 *
 * Called right after a fabric_receipt + fabric_receipt_item set is
 * inserted. Walks each saved item and reduces the matching stock rows
 * FIFO. The reductions are best-effort - if there's not enough stock
 * the function returns a structured "shortfalls" array so the UI can
 * warn the user, but the receipt itself stays saved.
 *
 * Stock buckets touched
 *   pavu.meters         -= received_metres                  (warp fabric)
 *   yarn_lot.current_kg -= weft_consumed_kg   (kind != 'porvai')
 *   yarn_lot.current_kg -= porvai_consumed_kg (kind  = 'porvai')
 *   bobbin.quantity     -= ceil(metres / bobbin.bobbin_metre)
 *
 * Matching strategy
 *   pavu     - via fabric_quality_warp_count.yarn_count_id ->
 *              sizing_job.warp_count_id -> pavu.sizing_job_id, FIFO by id
 *   weft yarn - via fabric_quality_weft.yarn_count_id -> yarn_lot
 *              (excluding kind='porvai'), FIFO by received_date
 *   porvai yarn - any yarn_lot with yarn_kind='porvai', FIFO by
 *              received_date. (No FK link exists yet from fabric_quality
 *              to a specific porvai count; refine when that lands.)
 *   bobbin   - only reduced when the receipt item carries an explicit
 *              bobbin_id (the user picked one). FIFO not relevant since
 *              we have a direct id.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

export interface ReceiptItemForReduction {
  fabric_quality_id: number | null;
  received_metres: number;
  weft_consumed_kg: number | null;
  porvai_consumed_kg: number | null;
  /** Whether to fire bobbin reduction at all - set from the form when
   *  the quality has a bobbin assigned (bobbin_pcs_per_m > 0). The
   *  actual bobbin row is resolved inside reduceBobbin via the fabric
   *  quality's calc_snapshot. */
  has_bobbin: boolean;
}

export interface Shortfall {
  bucket: 'pavu' | 'weft_yarn' | 'porvai_yarn' | 'bobbin';
  fabric_quality_id: number | null;
  needed: number;
  applied: number;
  unit: 'm' | 'kg' | 'pcs';
  note?: string;
}

export interface ReductionResult {
  applied: {
    pavu_m: number;
    weft_kg: number;
    porvai_kg: number;
    bobbin_pcs: number;
  };
  shortfalls: Shortfall[];
}

/* ───────────────────── individual reducers ───────────────────── */

/** Resolve the set of fabric_quality ids that share stock with the
 *  given one - itself plus any is_merged siblings sharing merged_name. */
async function getPooledQualityIds(sb: Sb, fabric_quality_id: number): Promise<number[]> {
  const out: number[] = [fabric_quality_id];
  const { data: self } = await sb
    .from('fabric_quality')
    .select('is_merged, merged_name')
    .eq('id', fabric_quality_id)
    .maybeSingle();
  const mergedName = self?.merged_name?.trim?.() ?? '';
  if (self?.is_merged && mergedName !== '') {
    const { data: siblings } = await sb
      .from('fabric_quality')
      .select('id')
      .eq('is_merged', true)
      .eq('merged_name', mergedName);
    for (const s of ((siblings ?? []) as Array<{ id: number }>)) {
      if (!out.includes(s.id)) out.push(s.id);
    }
  }
  return out;
}

/** Look up the warp / weft / porvai counts for a fabric quality, POOLED
 *  across merged-delivery siblings. Tries link tables first, falls back
 *  to calc_snapshot ids. All return values are arrays so downstream
 *  reducers can run a single IN() against the full pool. */
async function getQualityYarnCounts(
  sb: Sb,
  fabric_quality_id: number,
): Promise<{ warpCountIds: number[]; weftCountIds: number[]; porvaiCountIds: number[] }> {
  const qIds = await getPooledQualityIds(sb, fabric_quality_id);

  const [wcRes, weftRes, fqRes] = await Promise.all([
    sb.from('fabric_quality_warp_count').select('yarn_count_id').in('fabric_quality_id', qIds),
    sb.from('fabric_quality_weft').select('fabric_quality_id, yarn_count_id').in('fabric_quality_id', qIds),
    sb.from('fabric_quality').select('id, calc_snapshot').in('id', qIds),
  ]);

  const warpSet   = new Set<number>();
  const weftSet   = new Set<number>();
  const porvaiSet = new Set<number>();

  for (const r of ((wcRes.data ?? []) as Array<{ yarn_count_id: number | null }>)) {
    if (r.yarn_count_id != null) warpSet.add(Number(r.yarn_count_id));
  }
  const weftLinkedFqIds = new Set<number>();
  for (const r of ((weftRes.data ?? []) as Array<{ fabric_quality_id: number; yarn_count_id: number | null }>)) {
    weftLinkedFqIds.add(r.fabric_quality_id);
    if (r.yarn_count_id != null) weftSet.add(Number(r.yarn_count_id));
  }
  for (const r of ((fqRes.data ?? []) as Array<{ id: number; calc_snapshot: Record<string, unknown> | null }>)) {
    const snap = r.calc_snapshot;
    if (!snap) continue;
    if (warpSet.size === 0 && snap.warpCountId != null && snap.warpCountId !== '') {
      const n = Number(snap.warpCountId);
      if (Number.isFinite(n) && n > 0) warpSet.add(n);
    }
    if (!weftLinkedFqIds.has(r.id) && snap.weftCountId != null && snap.weftCountId !== '') {
      const n = Number(snap.weftCountId);
      if (Number.isFinite(n) && n > 0) weftSet.add(n);
    }
    if (snap.porvaiCountId != null && snap.porvaiCountId !== '') {
      const n = Number(snap.porvaiCountId);
      if (Number.isFinite(n) && n > 0) porvaiSet.add(n);
    }
  }
  return {
    warpCountIds: Array.from(warpSet),
    weftCountIds: Array.from(weftSet),
    porvaiCountIds: Array.from(porvaiSet),
  };
}

/** Reduce jobwork_warp_beam.total_metres FIFO across the fabric
 *  quality AND any merged-delivery siblings (same merged_name). The
 *  stock pool the operator sees in the Stock card matches the pool we
 *  subtract from here. Returns per-beam breakdown so the orchestrator
 *  can record one ledger row per beam touched. */
async function reducePavu(
  sb: Sb,
  fabric_quality_id: number,
  metres: number,
): Promise<{ applied: number; perBeam: Array<{ beam_id: number; cut: number; party_id: number | null; quality_id: number | null }> }> {
  if (metres <= 0) return { applied: 0, perBeam: [] };

  // Resolve the set of fabric_quality ids that share warp stock with
  // this one. If is_merged + merged_name is set we pull siblings.
  const qIds: number[] = [fabric_quality_id];
  const { data: self } = await sb
    .from('fabric_quality')
    .select('is_merged, merged_name')
    .eq('id', fabric_quality_id)
    .maybeSingle();
  if (self?.is_merged && self.merged_name && self.merged_name.trim() !== '') {
    const { data: siblings } = await sb
      .from('fabric_quality')
      .select('id')
      .eq('is_merged', true)
      .eq('merged_name', self.merged_name.trim());
    for (const s of ((siblings ?? []) as Array<{ id: number }>)) {
      if (!qIds.includes(s.id)) qIds.push(s.id);
    }
  }

  // FIFO by given_date then id (oldest beam consumed first), across
  // every fabric_quality_id in the pool.
  const { data: beams } = await sb
    .from('jobwork_warp_beam')
    .select('id, total_metres, jobwork_party_id, fabric_quality_id')
    .in('fabric_quality_id', qIds)
    .gt('total_metres', 0)
    .order('given_date', { ascending: true })
    .order('id', { ascending: true });

  let remaining = metres;
  let applied = 0;
  const perBeam: Array<{ beam_id: number; cut: number; party_id: number | null; quality_id: number | null }> = [];
  for (const b of (beams ?? []) as Array<{ id: number; total_metres: number | string; jobwork_party_id: number | null; fabric_quality_id: number | null }>) {
    if (remaining <= 0) break;
    const available = Number(b.total_metres);
    const cut = Math.min(available, remaining);
    const next = Math.max(0, available - cut);
    const { error } = await sb.from('jobwork_warp_beam').update({ total_metres: next }).eq('id', b.id);
    if (error) break;
    applied += cut;
    remaining -= cut;
    perBeam.push({ beam_id: b.id, cut, party_id: b.jobwork_party_id, quality_id: b.fabric_quality_id });
  }
  return { applied: Math.round(applied * 100) / 100, perBeam };
}

/** Reduce jobwork_weft_bag.total_kg FIFO across one or more yarn counts.
 *  Multiple counts come into play when merged-delivery siblings each
 *  have a different weft (or porvai) yarn count assigned but share the
 *  same stock pool. Returns per-bag breakdown for the ledger. */
async function reduceWeftBag(
  sb: Sb,
  yarn_count_ids: number[],
  kg: number,
): Promise<{ applied: number; perBag: Array<{ bag_id: number; cut: number; party_id: number | null; count_id: number | null }> }> {
  if (kg <= 0 || yarn_count_ids.length === 0) return { applied: 0, perBag: [] };

  const { data: bags } = await sb
    .from('jobwork_weft_bag')
    .select('id, total_kg, jobwork_party_id, yarn_count_id')
    .in('yarn_count_id', yarn_count_ids)
    .gt('total_kg', 0)
    .order('given_date', { ascending: true })
    .order('id', { ascending: true });

  let remaining = kg;
  let applied = 0;
  const perBag: Array<{ bag_id: number; cut: number; party_id: number | null; count_id: number | null }> = [];
  for (const b of (bags ?? []) as Array<{ id: number; total_kg: number | string; jobwork_party_id: number | null; yarn_count_id: number | null }>) {
    if (remaining <= 0) break;
    const avail = Number(b.total_kg);
    const cut = Math.min(avail, remaining);
    const next = Math.max(0, avail - cut);
    const { error } = await sb.from('jobwork_weft_bag').update({ total_kg: next }).eq('id', b.id);
    if (error) break;
    applied += cut;
    remaining -= cut;
    perBag.push({ bag_id: b.id, cut, party_id: b.jobwork_party_id, count_id: b.yarn_count_id });
  }
  return { applied: Math.round(applied * 100) / 100, perBag };
}

/** Reduce bobbin.quantity FIFO across every jobwork bobbin whose spec
 *  (ends_per_bobbin + bobbin_metre) matches a bobbin assigned to ANY
 *  fabric quality in the merged pool. Pool defaults to the single
 *  quality if it's not part of a merged group. */
async function reduceBobbin(
  sb: Sb,
  fabric_quality_id: number,
  metres: number,
): Promise<{ applied_pcs: number; applied_m: number; perBobbin: Array<{ bobbin_id: number; cut_pcs: number; cut_m: number; party_id: number | null }> }> {
  if (metres <= 0) return { applied_pcs: 0, applied_m: 0, perBobbin: [] };

  // Step 1: pool the pool. Each quality may assign a different bobbin
  // (id) - we collect all assigned bobbin ids across the pool.
  const pooledQIds = await getPooledQualityIds(sb, fabric_quality_id);
  const { data: fqs } = await sb
    .from('fabric_quality')
    .select('id, calc_snapshot')
    .in('id', pooledQIds);
  const assignedBobbinIds = new Set<number>();
  for (const r of ((fqs ?? []) as Array<{ id: number; calc_snapshot: Record<string, unknown> | null }>)) {
    const bid = r.calc_snapshot?.bobbinId;
    if (bid != null && bid !== '') {
      const n = Number(bid);
      if (Number.isFinite(n) && n > 0) assignedBobbinIds.add(n);
    }
  }
  if (assignedBobbinIds.size === 0) return { applied_pcs: 0, applied_m: 0, perBobbin: [] };

  // Step 2: every spec (ends_per_bobbin + bobbin_metre) the pool uses.
  const { data: assignedRows } = await sb
    .from('bobbin')
    .select('ends_per_bobbin, bobbin_metre')
    .in('id', Array.from(assignedBobbinIds));
  const specs: Array<{ ends: number; per: number }> = [];
  const seen = new Set<string>();
  for (const r of ((assignedRows ?? []) as Array<{ ends_per_bobbin: number | null; bobbin_metre: number | string | null }>)) {
    const e = Number(r.ends_per_bobbin) || 0;
    const p = Number(r.bobbin_metre)   || 0;
    if (e <= 0 || p <= 0) continue;
    const k = e + ':' + p;
    if (seen.has(k)) continue;
    seen.add(k);
    specs.push({ ends: e, per: p });
  }
  if (specs.length === 0) return { applied_pcs: 0, applied_m: 0, perBobbin: [] };

  // Step 3: FIFO across every jobwork bobbin matching any spec. We need
  // to issue one query per spec because PostgREST doesn't support
  // matching on (col1, col2) tuples; results are interleaved + sorted.
  type BobRow = { id: number; quantity: number | string; bobbin_metre: number | string; purchase_date: string | null; jobwork_party_id: number | null };
  const allBobs: BobRow[] = [];
  for (const s of specs) {
    const { data: bobs } = await sb
      .from('bobbin')
      .select('id, quantity, bobbin_metre, purchase_date, jobwork_party_id')
      .eq('production_mode', 'jobwork')
      .eq('ends_per_bobbin', s.ends)
      .eq('bobbin_metre', s.per)
      .gt('quantity', 0);
    for (const r of (bobs ?? []) as BobRow[]) allBobs.push(r);
  }
  allBobs.sort((a, b) => {
    const da = a.purchase_date ?? '';
    const db = b.purchase_date ?? '';
    if (da !== db) return da < db ? -1 : 1;
    return a.id - b.id;
  });

  let remaining_m = metres;
  let total_pcs = 0;
  let total_m_consumed = 0;
  const perBobbin: Array<{ bobbin_id: number; cut_pcs: number; cut_m: number; party_id: number | null }> = [];
  for (const b of allBobs) {
    if (remaining_m <= 0) break;
    const rowPer = Number(b.bobbin_metre);
    const avail  = Number(b.quantity);
    const pcsNeeded = Math.ceil(remaining_m / rowPer);
    const pcsToCut  = Math.min(avail, pcsNeeded);
    const next = Math.max(0, avail - pcsToCut);
    const { error } = await sb.from('bobbin').update({ quantity: next }).eq('id', b.id);
    if (error) break;
    total_pcs += pcsToCut;
    const mCut = pcsToCut * rowPer;
    total_m_consumed += mCut;
    remaining_m -= mCut;
    perBobbin.push({ bobbin_id: b.id, cut_pcs: pcsToCut, cut_m: mCut, party_id: b.jobwork_party_id });
  }
  return {
    applied_pcs: total_pcs,
    applied_m: Math.round(total_m_consumed * 100) / 100,
    perBobbin,
  };
}

/* ───────────────────── orchestrator ───────────────────── */

/** Optional receipt context used to tag every ledger entry we write. */
export interface ReceiptContext {
  receipt_id: number | null;
  receipt_code: string | null;
  receipt_date: string | null;  // YYYY-MM-DD
}

export async function applyFabricReceiptStockReductions(
  sb: Sb,
  items: ReceiptItemForReduction[],
  ctx?: ReceiptContext,
): Promise<ReductionResult> {
  const result: ReductionResult = {
    applied: { pavu_m: 0, weft_kg: 0, porvai_kg: 0, bobbin_pcs: 0 },
    shortfalls: [],
  };

  // Collect every outflow we want to write to stock_ledger. We push the
  // bulk insert at the end so a partial failure doesn't leave half a
  // receipt's worth of ledger rows orphaned.
  type LedgerRow = {
    bucket: 'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin';
    direction: 'out';
    jobwork_party_id: number | null;
    fabric_quality_id: number | null;
    yarn_count_id: number | null;
    bobbin_id: number | null;
    quantity: number;
    unit: 'm' | 'kg' | 'pcs';
    event_date: string;
    source_kind: 'fabric_receipt';
    source_id: number | null;
    reference_no: string | null;
    notes: string | null;
  };
  const ledgerRows: LedgerRow[] = [];
  const event_date = ctx?.receipt_date ?? new Date().toISOString().slice(0, 10);
  const source_id = ctx?.receipt_id ?? null;
  const reference_no = ctx?.receipt_code ?? null;

  for (const it of items) {
    if (it.fabric_quality_id == null) continue;

    // PAVU
    if (it.received_metres > 0) {
      const r = await reducePavu(sb, it.fabric_quality_id, it.received_metres);
      result.applied.pavu_m += r.applied;
      for (const b of r.perBeam) {
        if (b.cut <= 0) continue;
        ledgerRows.push({
          bucket: 'warp_beam', direction: 'out',
          jobwork_party_id: b.party_id, fabric_quality_id: b.quality_id,
          yarn_count_id: null, bobbin_id: null,
          quantity: Math.round(b.cut * 100) / 100, unit: 'm',
          event_date, source_kind: 'fabric_receipt', source_id, reference_no,
          notes: `From warp beam #${b.beam_id}`,
        });
      }
      if (r.applied + 0.005 < it.received_metres) {
        result.shortfalls.push({
          bucket: 'pavu', fabric_quality_id: it.fabric_quality_id,
          needed: it.received_metres, applied: r.applied, unit: 'm',
          note: 'Available warp-beam metres less than received - check Jobwork \u2192 Warp beam given for this fabric quality.',
        });
      }
    }

    // Resolve all three yarn-count sets once per item. Each set is
    // already pooled across merged-delivery siblings inside the helper.
    const { weftCountIds, porvaiCountIds } = await getQualityYarnCounts(sb, it.fabric_quality_id);

    // WEFT YARN - reduces jobwork_weft_bag.total_kg FIFO across every
    // yarn count in the pool.
    if (it.weft_consumed_kg && it.weft_consumed_kg > 0) {
      const r = await reduceWeftBag(sb, weftCountIds, it.weft_consumed_kg);
      result.applied.weft_kg += r.applied;
      for (const b of r.perBag) {
        if (b.cut <= 0) continue;
        ledgerRows.push({
          bucket: 'weft_yarn', direction: 'out',
          jobwork_party_id: b.party_id, fabric_quality_id: it.fabric_quality_id,
          yarn_count_id: b.count_id, bobbin_id: null,
          quantity: Math.round(b.cut * 1000) / 1000, unit: 'kg',
          event_date, source_kind: 'fabric_receipt', source_id, reference_no,
          notes: `From weft bag #${b.bag_id}`,
        });
      }
      if (r.applied + 0.005 < it.weft_consumed_kg) {
        result.shortfalls.push({
          bucket: 'weft_yarn', fabric_quality_id: it.fabric_quality_id,
          needed: it.weft_consumed_kg, applied: r.applied, unit: 'kg',
          note: weftCountIds.length === 0
            ? 'No weft yarn count linked to this fabric quality.'
            : 'Available weft kgs in Jobwork \u2192 Weft bag given less than consumed - check stock for this count (pool includes merged siblings).',
        });
      }
    }

    // PORVAI YARN - same table as weft, FIFO across the pooled porvai
    // counts.
    if (it.porvai_consumed_kg && it.porvai_consumed_kg > 0) {
      const r = await reduceWeftBag(sb, porvaiCountIds, it.porvai_consumed_kg);
      result.applied.porvai_kg += r.applied;
      for (const b of r.perBag) {
        if (b.cut <= 0) continue;
        ledgerRows.push({
          bucket: 'porvai_yarn', direction: 'out',
          jobwork_party_id: b.party_id, fabric_quality_id: it.fabric_quality_id,
          yarn_count_id: b.count_id, bobbin_id: null,
          quantity: Math.round(b.cut * 1000) / 1000, unit: 'kg',
          event_date, source_kind: 'fabric_receipt', source_id, reference_no,
          notes: `From porvai bag #${b.bag_id}`,
        });
      }
      if (r.applied + 0.005 < it.porvai_consumed_kg) {
        result.shortfalls.push({
          bucket: 'porvai_yarn', fabric_quality_id: it.fabric_quality_id,
          needed: it.porvai_consumed_kg, applied: r.applied, unit: 'kg',
          note: porvaiCountIds.length === 0
            ? 'No porvai yarn count assigned on the fabric quality master.'
            : 'Available porvai kgs in Jobwork \u2192 Weft bag given less than consumed for this count (pool includes merged siblings).',
        });
      }
    }

    // BOBBIN - spec match (ends_per_bobbin + bobbin_metre), FIFO by
    // purchase_date across jobwork bobbins.
    if (it.has_bobbin && it.received_metres > 0) {
      const r = await reduceBobbin(sb, it.fabric_quality_id, it.received_metres);
      result.applied.bobbin_pcs += r.applied_pcs;
      for (const b of r.perBobbin) {
        if (b.cut_pcs <= 0) continue;
        // Store bobbin consumption in METRES so the warehouse pivot
        // reads it directly without needing to multiply by bobbin_metre.
        // (1 m fabric consumes 1 m of bobbin yarn.)
        ledgerRows.push({
          bucket: 'bobbin', direction: 'out',
          jobwork_party_id: b.party_id, fabric_quality_id: it.fabric_quality_id,
          yarn_count_id: null, bobbin_id: b.bobbin_id,
          quantity: Math.round(b.cut_m * 100) / 100, unit: 'm',
          event_date, source_kind: 'fabric_receipt', source_id, reference_no,
          notes: `${b.cut_pcs} pcs × bobbin spec`,
        });
      }
      if (r.applied_m + 0.005 < it.received_metres) {
        result.shortfalls.push({
          bucket: 'bobbin', fabric_quality_id: it.fabric_quality_id,
          needed: it.received_metres, applied: r.applied_m, unit: 'm',
          note: 'Available bobbin metres in Jobwork \u2192 Bobbin given less than received for this spec (pool includes merged siblings).',
        });
      }
    }
  }

  // Persist ledger rows in one batch. If insert fails we swallow the
  // error - the receipt itself is already saved and the live balances
  // were already updated; the ledger is a derived audit trail.
  if (ledgerRows.length > 0) {
    try {
      await sb.from('stock_ledger').insert(ledgerRows);
    } catch {
      // Ignore - ledger write is best-effort.
    }
  }

  return result;
}

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

/** Look up the warp / weft / porvai counts for a fabric quality. Tries
 *  the link tables first, falls back to calc_snapshot ids. */
async function getQualityYarnCounts(
  sb: Sb,
  fabric_quality_id: number,
): Promise<{ warpCountIds: number[]; weftCountId: number | null; porvaiCountId: number | null }> {
  const [wcRes, weftRes, fqRes] = await Promise.all([
    sb.from('fabric_quality_warp_count').select('yarn_count_id').eq('fabric_quality_id', fabric_quality_id),
    sb.from('fabric_quality_weft').select('yarn_count_id').eq('fabric_quality_id', fabric_quality_id).limit(1).maybeSingle(),
    sb.from('fabric_quality').select('calc_snapshot').eq('id', fabric_quality_id).maybeSingle(),
  ]);
  const warpCountIds: number[] = ((wcRes.data ?? []) as Array<{ yarn_count_id: number | null }>)
    .map((r) => r.yarn_count_id)
    .filter((x): x is number => x != null);
  let weftCountId: number | null = weftRes?.data?.yarn_count_id ?? null;
  let porvaiCountId: number | null = null;

  const snap = fqRes?.data?.calc_snapshot as Record<string, unknown> | null;
  if (snap) {
    if (warpCountIds.length === 0 && snap.warpCountId != null && snap.warpCountId !== '') {
      const n = Number(snap.warpCountId);
      if (Number.isFinite(n) && n > 0) warpCountIds.push(n);
    }
    if (weftCountId == null && snap.weftCountId != null && snap.weftCountId !== '') {
      const n = Number(snap.weftCountId);
      if (Number.isFinite(n) && n > 0) weftCountId = n;
    }
    if (snap.porvaiCountId != null && snap.porvaiCountId !== '') {
      const n = Number(snap.porvaiCountId);
      if (Number.isFinite(n) && n > 0) porvaiCountId = n;
    }
  }
  return { warpCountIds, weftCountId, porvaiCountId };
}

/** Reduce jobwork_warp_beam.total_metres FIFO across the fabric
 *  quality AND any merged-delivery siblings (same merged_name). The
 *  stock pool the operator sees in the Stock card matches the pool we
 *  subtract from here. */
async function reducePavu(
  sb: Sb,
  fabric_quality_id: number,
  metres: number,
): Promise<{ applied: number }> {
  if (metres <= 0) return { applied: 0 };

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
    .select('id, total_metres')
    .in('fabric_quality_id', qIds)
    .gt('total_metres', 0)
    .order('given_date', { ascending: true })
    .order('id', { ascending: true });

  let remaining = metres;
  let applied = 0;
  for (const b of (beams ?? []) as Array<{ id: number; total_metres: number | string }>) {
    if (remaining <= 0) break;
    const available = Number(b.total_metres);
    const cut = Math.min(available, remaining);
    const next = Math.max(0, available - cut);
    const { error } = await sb.from('jobwork_warp_beam').update({ total_metres: next }).eq('id', b.id);
    if (error) break;
    applied += cut;
    remaining -= cut;
  }
  return { applied: Math.round(applied * 100) / 100 };
}

/** Reduce jobwork_weft_bag.total_kg FIFO for the matching yarn count.
 *  Used for both weft and porvai consumption - the bag table holds both
 *  (just keyed by yarn_count_id, no yarn_kind distinction needed). */
async function reduceWeftBag(
  sb: Sb,
  yarn_count_id: number | null,
  kg: number,
): Promise<{ applied: number }> {
  if (kg <= 0 || yarn_count_id == null) return { applied: 0 };

  const { data: bags } = await sb
    .from('jobwork_weft_bag')
    .select('id, total_kg')
    .eq('yarn_count_id', yarn_count_id)
    .gt('total_kg', 0)
    .order('given_date', { ascending: true })
    .order('id', { ascending: true });

  let remaining = kg;
  let applied = 0;
  for (const b of (bags ?? []) as Array<{ id: number; total_kg: number | string }>) {
    if (remaining <= 0) break;
    const avail = Number(b.total_kg);
    const cut = Math.min(avail, remaining);
    const next = Math.max(0, avail - cut);
    const { error } = await sb.from('jobwork_weft_bag').update({ total_kg: next }).eq('id', b.id);
    if (error) break;
    applied += cut;
    remaining -= cut;
  }
  return { applied: Math.round(applied * 100) / 100 };
}

/** Reduce bobbin.quantity FIFO across every jobwork bobbin whose spec
 *  (ends_per_bobbin + bobbin_metre) matches the bobbin assigned to the
 *  fabric quality via calc_snapshot.bobbinId. Same flavour as warp beam
 *  and weft bag: multiple batches accumulate, FIFO by purchase_date. */
async function reduceBobbin(
  sb: Sb,
  fabric_quality_id: number,
  metres: number,
): Promise<{ applied_pcs: number; applied_m: number }> {
  if (metres <= 0) return { applied_pcs: 0, applied_m: 0 };

  // Step 1: which bobbin is assigned to this quality?
  const { data: fq } = await sb
    .from('fabric_quality')
    .select('calc_snapshot')
    .eq('id', fabric_quality_id)
    .maybeSingle();
  const bobbinIdRaw = fq?.calc_snapshot?.bobbinId;
  if (bobbinIdRaw == null || bobbinIdRaw === '') return { applied_pcs: 0, applied_m: 0 };

  // Step 2: pull the assigned bobbin's spec.
  const { data: assigned } = await sb
    .from('bobbin')
    .select('ends_per_bobbin, bobbin_metre')
    .eq('id', Number(bobbinIdRaw))
    .maybeSingle();
  if (!assigned) return { applied_pcs: 0, applied_m: 0 };
  const ends = Number(assigned.ends_per_bobbin) || 0;
  const per  = Number(assigned.bobbin_metre)   || 0;
  if (ends <= 0 || per <= 0) return { applied_pcs: 0, applied_m: 0 };

  // Step 3: FIFO across jobwork bobbins of matching spec.
  const { data: bobs } = await sb
    .from('bobbin')
    .select('id, quantity, bobbin_metre')
    .eq('production_mode', 'jobwork')
    .eq('ends_per_bobbin', ends)
    .eq('bobbin_metre', per)
    .gt('quantity', 0)
    .order('purchase_date', { ascending: true })
    .order('id', { ascending: true });

  let remaining_m = metres;
  let total_pcs = 0;
  let total_m_consumed = 0;
  for (const b of (bobs ?? []) as Array<{ id: number; quantity: number | string; bobbin_metre: number | string }>) {
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
  }
  return {
    applied_pcs: total_pcs,
    applied_m: Math.round(total_m_consumed * 100) / 100,
  };
}

/* ───────────────────── orchestrator ───────────────────── */

export async function applyFabricReceiptStockReductions(
  sb: Sb,
  items: ReceiptItemForReduction[],
): Promise<ReductionResult> {
  const result: ReductionResult = {
    applied: { pavu_m: 0, weft_kg: 0, porvai_kg: 0, bobbin_pcs: 0 },
    shortfalls: [],
  };

  for (const it of items) {
    if (it.fabric_quality_id == null) continue;

    // PAVU
    if (it.received_metres > 0) {
      const r = await reducePavu(sb, it.fabric_quality_id, it.received_metres);
      result.applied.pavu_m += r.applied;
      if (r.applied + 0.005 < it.received_metres) {
        result.shortfalls.push({
          bucket: 'pavu', fabric_quality_id: it.fabric_quality_id,
          needed: it.received_metres, applied: r.applied, unit: 'm',
          note: 'Available warp-beam metres less than received - check Jobwork \u2192 Warp beam given for this fabric quality.',
        });
      }
    }

    // Resolve all three yarn counts once per item.
    const { weftCountId, porvaiCountId } = await getQualityYarnCounts(sb, it.fabric_quality_id);

    // WEFT YARN - reduces jobwork_weft_bag.total_kg matched by yarn_count.
    if (it.weft_consumed_kg && it.weft_consumed_kg > 0) {
      const r = await reduceWeftBag(sb, weftCountId, it.weft_consumed_kg);
      result.applied.weft_kg += r.applied;
      if (r.applied + 0.005 < it.weft_consumed_kg) {
        result.shortfalls.push({
          bucket: 'weft_yarn', fabric_quality_id: it.fabric_quality_id,
          needed: it.weft_consumed_kg, applied: r.applied, unit: 'kg',
          note: weftCountId == null
            ? 'No weft yarn count linked to this fabric quality.'
            : 'Available weft kgs in Jobwork \u2192 Weft bag given less than consumed - check stock for this count.',
        });
      }
    }

    // PORVAI YARN - same table as weft, matched by the porvai yarn count
    // from calc_snapshot.porvaiCountId.
    if (it.porvai_consumed_kg && it.porvai_consumed_kg > 0) {
      const r = await reduceWeftBag(sb, porvaiCountId, it.porvai_consumed_kg);
      result.applied.porvai_kg += r.applied;
      if (r.applied + 0.005 < it.porvai_consumed_kg) {
        result.shortfalls.push({
          bucket: 'porvai_yarn', fabric_quality_id: it.fabric_quality_id,
          needed: it.porvai_consumed_kg, applied: r.applied, unit: 'kg',
          note: porvaiCountId == null
            ? 'No porvai yarn count assigned on the fabric quality master.'
            : 'Available porvai kgs in Jobwork \u2192 Weft bag given less than consumed for this count.',
        });
      }
    }

    // BOBBIN - spec match (ends_per_bobbin + bobbin_metre), FIFO by
    // purchase_date across jobwork bobbins.
    if (it.has_bobbin && it.received_metres > 0) {
      const r = await reduceBobbin(sb, it.fabric_quality_id, it.received_metres);
      result.applied.bobbin_pcs += r.applied_pcs;
      if (r.applied_m + 0.005 < it.received_metres) {
        result.shortfalls.push({
          bucket: 'bobbin', fabric_quality_id: it.fabric_quality_id,
          needed: it.received_metres, applied: r.applied_m, unit: 'm',
          note: 'Available bobbin metres in Jobwork \u2192 Bobbin given less than received for this spec.',
        });
      }
    }
  }

  return result;
}

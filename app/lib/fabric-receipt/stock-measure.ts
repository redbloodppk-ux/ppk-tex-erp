/**
 * Stock measurement helper for fabric receipts.
 *
 * Computes the current jobwork stock balance pooled across the receipt's
 * fabric qualities AND any merged-delivery siblings. Used by the
 * fabric-receipt save flow to capture a before/after snapshot per
 * receipt so each receipt becomes a self-contained transaction record.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

export interface BucketSnapshot {
  warp_m: number;
  weft_kg: number;
  porvai_kg: number;
  bobbin_pcs: number;
  /** Bobbin metres = sum of (quantity × bobbin_metre) across matched
   *  jobwork bobbins. Convenient for "received metres" comparison. */
  bobbin_m: number;
}

/** Resolve the set of fabric_quality ids that share stock with the
 *  given one (self + any merged-delivery siblings). */
async function pooledQualityIds(sb: Sb, fabricQualityIds: number[]): Promise<number[]> {
  const out = new Set<number>(fabricQualityIds);
  if (fabricQualityIds.length === 0) return [];
  const { data: selves } = await sb
    .from('fabric_quality')
    .select('id, is_merged, merged_name')
    .in('id', fabricQualityIds);
  const mergedNames = new Set<string>();
  for (const r of ((selves ?? []) as Array<{ id: number; is_merged: boolean; merged_name: string | null }>)) {
    if (r.is_merged && r.merged_name && r.merged_name.trim() !== '') {
      mergedNames.add(r.merged_name.trim());
    }
  }
  if (mergedNames.size > 0) {
    const { data: siblings } = await sb
      .from('fabric_quality')
      .select('id')
      .eq('is_merged', true)
      .in('merged_name', Array.from(mergedNames));
    for (const s of ((siblings ?? []) as Array<{ id: number }>)) out.add(s.id);
  }
  return Array.from(out);
}

/** Look up the warp / weft / porvai / bobbin specs for a set of fabric
 *  qualities. Pools across merged siblings. */
async function resolveKeysForQualities(
  sb: Sb,
  fabricQualityIds: number[],
): Promise<{
  pooledQIds: number[];
  weftCountIds: Set<number>;
  porvaiCountIds: Set<number>;
  bobbinSpecs: Array<{ ends: number; per: number }>;
}> {
  const pooledQIds = await pooledQualityIds(sb, fabricQualityIds);
  if (pooledQIds.length === 0) {
    return { pooledQIds: [], weftCountIds: new Set(), porvaiCountIds: new Set(), bobbinSpecs: [] };
  }

  const [wcRes, weftRes, fqRes] = await Promise.all([
    sb.from('fabric_quality_warp_count').select('yarn_count_id').in('fabric_quality_id', pooledQIds),
    sb.from('fabric_quality_weft').select('fabric_quality_id, yarn_count_id').in('fabric_quality_id', pooledQIds),
    sb.from('fabric_quality').select('id, calc_snapshot').in('id', pooledQIds),
  ]);

  const weftSet   = new Set<number>();
  const porvaiSet = new Set<number>();
  const bobbinIds = new Set<number>();

  const weftLinkedFqIds = new Set<number>();
  for (const r of ((weftRes.data ?? []) as Array<{ fabric_quality_id: number; yarn_count_id: number | null }>)) {
    weftLinkedFqIds.add(r.fabric_quality_id);
    if (r.yarn_count_id != null) weftSet.add(Number(r.yarn_count_id));
  }
  for (const r of ((fqRes.data ?? []) as Array<{ id: number; calc_snapshot: Record<string, unknown> | null }>)) {
    const snap = r.calc_snapshot;
    if (!snap) continue;
    if (!weftLinkedFqIds.has(r.id) && snap.weftCountId != null && snap.weftCountId !== '') {
      const n = Number(snap.weftCountId);
      if (Number.isFinite(n) && n > 0) weftSet.add(n);
    }
    if (snap.porvaiCountId != null && snap.porvaiCountId !== '') {
      const n = Number(snap.porvaiCountId);
      if (Number.isFinite(n) && n > 0) porvaiSet.add(n);
    }
    if (snap.bobbinId != null && snap.bobbinId !== '') {
      const n = Number(snap.bobbinId);
      if (Number.isFinite(n) && n > 0) bobbinIds.add(n);
    }
  }
  // wcRes is unused for now (warp count) - the warp stock is pooled by
  // fabric_quality_id directly via jobwork_warp_beam.
  void wcRes;

  // Bobbin specs: resolve (ends_per_bobbin, bobbin_metre) for each
  // assigned bobbin id, dedupe.
  const bobbinSpecs: Array<{ ends: number; per: number }> = [];
  if (bobbinIds.size > 0) {
    const { data: assignedRows } = await sb
      .from('bobbin')
      .select('ends_per_bobbin, bobbin_metre')
      .in('id', Array.from(bobbinIds));
    const seen = new Set<string>();
    for (const r of ((assignedRows ?? []) as Array<{ ends_per_bobbin: number | null; bobbin_metre: number | string | null }>)) {
      const e = Number(r.ends_per_bobbin) || 0;
      const p = Number(r.bobbin_metre)   || 0;
      if (e <= 0 || p <= 0) continue;
      const k = e + ':' + p;
      if (seen.has(k)) continue;
      seen.add(k);
      bobbinSpecs.push({ ends: e, per: p });
    }
  }

  return { pooledQIds, weftCountIds: weftSet, porvaiCountIds: porvaiSet, bobbinSpecs };
}

/** Measure the current IN-HOUSE stock balance across all four buckets
 *  for the union of the provided fabric qualities (pooled with merged-
 *  delivery siblings). Mirrors the Warehouse → In-house pivots:
 *    warp   = opening stock + warp beam purchases + in-stock pavu
 *             − previous in-house receipt items
 *    weft   = opening stock + in-house yarn_lot.current_kg (kind=yarn)
 *    porvai = opening stock + in-house yarn_lot.current_kg (kind=porvai)
 *    bobbin = opening stock + purchases − returns − in-house ledger outs */
async function measureInhouseStock(sb: Sb, fabricQualityIds: number[]): Promise<BucketSnapshot> {
  const result: BucketSnapshot = { warp_m: 0, weft_kg: 0, porvai_kg: 0, bobbin_pcs: 0, bobbin_m: 0 };
  const pooledQIds = await pooledQualityIds(sb, fabricQualityIds);
  if (pooledQIds.length === 0) return result;

  // Warp specs (totalEnds + warpCountId) and bobbin ids from snapshots;
  // weft / porvai counts via the shared resolver.
  const { weftCountIds, porvaiCountIds } = await resolveKeysForQualities(sb, fabricQualityIds);
  const { data: fqRows } = await sb
    .from('fabric_quality')
    .select('id, calc_snapshot')
    .in('id', pooledQIds);
  const specKeys = new Set<string>();
  const specEnds = new Set<number>();
  const bobbinIds = new Set<number>();
  for (const r of ((fqRows ?? []) as Array<{ id: number; calc_snapshot: Record<string, unknown> | null }>)) {
    const snap = r.calc_snapshot ?? {};
    const ends = Number(snap['totalEnds']);
    const countId = Number(snap['warpCountId']);
    if (Number.isFinite(ends) && ends > 0) {
      specKeys.add(`${ends}|${Number.isFinite(countId) && countId > 0 ? countId : ''}`);
      specEnds.add(ends);
    }
    const rawIds: unknown[] = Array.isArray(snap['bobbinIds']) && (snap['bobbinIds'] as unknown[]).length > 0
      ? [...(snap['bobbinIds'] as unknown[])]
      : [snap['bobbinId']];
    // Legacy second slot (bobbinId2) may not be in bobbinIds[].
    if (snap['bobbinId2'] != null && snap['bobbinId2'] !== '') rawIds.push(snap['bobbinId2']);
    for (const v of rawIds) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) bobbinIds.add(n);
    }
  }

  // ── Warp metres ───────────────────────────────────────────────
  if (specKeys.size > 0) {
    const [openRes, purRes, pavuRes, outRes] = await Promise.all([
      sb.from('opening_stock')
        .select('warp_ends, yarn_count_id, quantity')
        .eq('bucket', 'warp_beam').eq('mode', 'inhouse').eq('status', 'active'),
      sb.from('inhouse_warp_beam_purchase')
        .select('metres, yarn_count_id, ends:ends_id ( ends_count )')
        .eq('status', 'active'),
      sb.from('pavu')
        .select('meters, ends, sizing_job:sizing_job_id ( warp_count_id )')
        .eq('production_mode', 'in_house')
        .eq('status', 'in_stock'),
      sb.from('fabric_receipt_item')
        .select('received_metres, receipt:receipt_id!inner ( status, dc:dc_id!inner ( production_mode ) )')
        .in('fabric_quality_id', pooledQIds),
    ]);
    for (const r of ((openRes.data ?? []) as Array<{ warp_ends: number | null; yarn_count_id: number | null; quantity: number | string | null }>)) {
      if (r.warp_ends == null) continue;
      if (!specKeys.has(`${Number(r.warp_ends)}|${r.yarn_count_id ?? ''}`)) continue;
      result.warp_m += Number(r.quantity ?? 0);
    }
    for (const r of ((purRes.data ?? []) as Array<{ metres: number | string | null; yarn_count_id: number | null; ends: { ends_count: number | null } | null }>)) {
      const e = Number(r.ends?.ends_count ?? 0);
      if (e <= 0 || !specKeys.has(`${e}|${r.yarn_count_id ?? ''}`)) continue;
      result.warp_m += Number(r.metres ?? 0);
    }
    for (const r of ((pavuRes.data ?? []) as Array<{ meters: number | string | null; ends: number | null; sizing_job: { warp_count_id: number | null } | null }>)) {
      const e = Number(r.ends ?? 0);
      if (e <= 0 || !specEnds.has(e)) continue;
      const wc = r.sizing_job?.warp_count_id ?? null;
      if (!(specKeys.has(`${e}|${wc ?? ''}`) || wc == null)) continue;
      result.warp_m += Number(r.meters ?? 0);
    }
    for (const r of ((outRes.data ?? []) as Array<{ received_metres: number | string | null; receipt: { status: string; dc: { production_mode: string | null } | null } | null }>)) {
      if (r.receipt?.dc?.production_mode !== 'inhouse') continue;
      if (r.receipt?.status === 'draft') continue;
      result.warp_m -= Number(r.received_metres ?? 0);
    }
  }

  // ── Weft / porvai kgs ─────────────────────────────────────────
  const measureYarn = async (countIds: Set<number>, kind: 'yarn' | 'porvai'): Promise<number> => {
    if (countIds.size === 0) return 0;
    const ids = Array.from(countIds);
    const [oRes, lRes] = await Promise.all([
      sb.from('opening_stock').select('quantity')
        .eq('bucket', kind === 'porvai' ? 'porvai_yarn' : 'weft_yarn')
        .eq('mode', 'inhouse').eq('status', 'active')
        .in('yarn_count_id', ids),
      sb.from('yarn_lot').select('current_kg')
        .in('yarn_count_id', ids)
        .eq('delivery_destination', 'in_house')
        .eq('yarn_kind', kind),
    ]);
    let kg = 0;
    for (const r of ((oRes.data ?? []) as Array<{ quantity: number | string | null }>)) kg += Number(r.quantity ?? 0);
    for (const r of ((lRes.data ?? []) as Array<{ current_kg: number | string | null }>)) kg += Number(r.current_kg ?? 0);
    return kg;
  };
  result.weft_kg   = await measureYarn(weftCountIds, 'yarn');
  result.porvai_kg = await measureYarn(porvaiCountIds, 'porvai');

  // ── Bobbin metres ─────────────────────────────────────────────
  if (bobbinIds.size > 0) {
    const ids = Array.from(bobbinIds);
    const [perRes, openRes, purRes, retRes, outRes] = await Promise.all([
      sb.from('bobbin').select('id, bobbin_metre').in('id', ids),
      sb.from('opening_stock').select('quantity')
        .eq('bucket', 'bobbin').eq('mode', 'inhouse').eq('status', 'active')
        .in('bobbin_id', ids),
      sb.from('bobbin_purchase').select('bobbin_id, pieces_purchased').in('bobbin_id', ids),
      sb.from('bobbin_return').select('bobbin_id, quantity_pcs')
        .is('jobwork_party_id', null).eq('status', 'active')
        .in('bobbin_id', ids),
      sb.from('stock_ledger').select('quantity')
        .eq('bucket', 'bobbin').eq('direction', 'out')
        .is('jobwork_party_id', null)
        .in('bobbin_id', ids),
    ]);
    const perById = new Map<number, number>();
    let per0 = 0;
    for (const r of ((perRes.data ?? []) as Array<{ id: number; bobbin_metre: number | string | null }>)) {
      const p = Number(r.bobbin_metre ?? 0);
      perById.set(r.id, p);
      if (per0 === 0 && p > 0) per0 = p;
    }
    for (const r of ((openRes.data ?? []) as Array<{ quantity: number | string | null }>)) {
      result.bobbin_m += Number(r.quantity ?? 0);
    }
    for (const r of ((purRes.data ?? []) as Array<{ bobbin_id: number | null; pieces_purchased: number | string | null }>)) {
      const per = r.bobbin_id != null ? (perById.get(r.bobbin_id) ?? 0) : 0;
      result.bobbin_m += Number(r.pieces_purchased ?? 0) * per;
    }
    for (const r of ((retRes.data ?? []) as Array<{ bobbin_id: number | null; quantity_pcs: number | string | null }>)) {
      const per = r.bobbin_id != null ? (perById.get(r.bobbin_id) ?? 0) : 0;
      result.bobbin_m -= Number(r.quantity_pcs ?? 0) * per;
    }
    for (const r of ((outRes.data ?? []) as Array<{ quantity: number | string | null }>)) {
      result.bobbin_m -= Number(r.quantity ?? 0);
    }
    result.bobbin_m = Math.max(0, result.bobbin_m);
    result.bobbin_pcs = per0 > 0 ? result.bobbin_m / per0 : 0;
  }

  result.warp_m     = Math.round(result.warp_m     * 100) / 100;
  result.weft_kg    = Math.round(result.weft_kg    * 1000) / 1000;
  result.porvai_kg  = Math.round(result.porvai_kg  * 1000) / 1000;
  result.bobbin_pcs = Math.round(result.bobbin_pcs * 100) / 100;
  result.bobbin_m   = Math.round(result.bobbin_m   * 100) / 100;
  return result;
}

/** Measure the current jobwork stock balance across all four buckets
 *  for the union of the provided fabric qualities (pooled with merged-
 *  delivery siblings). All values are positive numbers; rounding is
 *  applied so the snapshot reads cleanly in the UI. */
export async function measureStock(
  sb: Sb,
  fabricQualityIds: number[],
  /** When provided, the bobbin pool is scoped to this jobwork party —
   *  matching the per-party pool the Warehouse → Job Work pivot shows. */
  jobworkPartyId?: number | null,
  /** 'inhouse' switches every bucket to the IN-HOUSE stock sources so
   *  in-house receipts snapshot the right before/after figures. */
  productionMode?: 'inhouse' | 'jobwork' | 'outsource',
): Promise<BucketSnapshot> {
  const result: BucketSnapshot = { warp_m: 0, weft_kg: 0, porvai_kg: 0, bobbin_pcs: 0, bobbin_m: 0 };
  if (fabricQualityIds.length === 0) return result;
  if (productionMode === 'inhouse') return measureInhouseStock(sb, fabricQualityIds);

  const { pooledQIds, weftCountIds, porvaiCountIds, bobbinSpecs } =
    await resolveKeysForQualities(sb, fabricQualityIds);

  if (pooledQIds.length > 0) {
    const { data: wbRows } = await sb
      .from('jobwork_warp_beam')
      .select('total_metres')
      .in('fabric_quality_id', pooledQIds)
      .gt('total_metres', 0);
    result.warp_m = ((wbRows ?? []) as Array<{ total_metres: number | string | null }>)
      .reduce((s, r) => s + Number(r.total_metres ?? 0), 0);
  }

  if (weftCountIds.size > 0) {
    const { data: wbagRows } = await sb
      .from('jobwork_weft_bag')
      .select('total_kg')
      .in('yarn_count_id', Array.from(weftCountIds))
      .gt('total_kg', 0);
    result.weft_kg = ((wbagRows ?? []) as Array<{ total_kg: number | string | null }>)
      .reduce((s, r) => s + Number(r.total_kg ?? 0), 0);
  }

  if (porvaiCountIds.size > 0) {
    const { data: pBagRows } = await sb
      .from('jobwork_weft_bag')
      .select('total_kg')
      .in('yarn_count_id', Array.from(porvaiCountIds))
      .gt('total_kg', 0);
    result.porvai_kg = ((pBagRows ?? []) as Array<{ total_kg: number | string | null }>)
      .reduce((s, r) => s + Number(r.total_kg ?? 0), 0);
  }

  // ── Bobbin pool ──────────────────────────────────────────────────
  // The job-work bobbin balance is DERIVED, mirroring the Warehouse →
  // Job Work → Bobbin pivot exactly:
  //   inflow  = active jobwork_bobbin_issue pieces × bobbin_metre
  //   outflow = stock_ledger rows (bucket='bobbin', stored in metres)
  // bobbin.quantity is NOT read here — since migration 141/142 it only
  // tracks godown/master stock, not what's sitting with a jobwork
  // party. (Reading it was the bug that made receipts snapshot 0.)
  if (jobworkPartyId != null) {
    // Party-scoped: the pool is everything issued to THIS party (any
    // spec) minus the party's recorded outflows — exactly what the
    // Warehouse pivot shows for the party. This path does not depend
    // on calc_snapshot.bobbinId, which can go stale (migration 140
    // consolidated bobbin ids but couldn't re-point the JSON field).
    const { data: issues } = await sb
      .from('jobwork_bobbin_issue')
      .select('pieces_issued, bobbin:bobbin_id ( bobbin_metre )')
      .eq('status', 'active')
      .eq('jobwork_party_id', jobworkPartyId);
    let issued_m = 0;
    let per0 = 0;
    for (const r of ((issues ?? []) as Array<{ pieces_issued: number | string | null; bobbin: { bobbin_metre: number | string | null } | null }>)) {
      const per = Number(r.bobbin?.bobbin_metre ?? 0);
      const pcs = Number(r.pieces_issued ?? 0);
      issued_m += per > 0 ? pcs * per : pcs;
      if (per0 === 0 && per > 0) per0 = per;
    }
    const { data: outs } = await sb
      .from('stock_ledger')
      .select('quantity')
      .eq('bucket', 'bobbin')
      .eq('direction', 'out')
      .eq('jobwork_party_id', jobworkPartyId);
    const consumed_m = ((outs ?? []) as Array<{ quantity: number | string | null }>)
      .reduce((s, r) => s + Number(r.quantity ?? 0), 0);
    result.bobbin_m = Math.max(0, issued_m - consumed_m);
    result.bobbin_pcs = per0 > 0 ? result.bobbin_m / per0 : 0;
  } else if (bobbinSpecs.length > 0) {
    // Unscoped (backfill): match by spec. Resolve every bobbin master
    // id matching any assigned spec, in ANY production mode — legacy
    // ledger rows may reference the in-house twin (same ends + m/pc)
    // of the job-work bobbin.
    const { data: masterRows } = await sb
      .from('bobbin')
      .select('id, ends_per_bobbin, bobbin_metre');
    const perById = new Map<number, number>();
    for (const r of ((masterRows ?? []) as Array<{ id: number; ends_per_bobbin: number | null; bobbin_metre: number | string | null }>)) {
      const e = Number(r.ends_per_bobbin) || 0;
      const p = Number(r.bobbin_metre)   || 0;
      if (bobbinSpecs.some((s) => s.ends === e && s.per === p)) perById.set(r.id, p);
    }
    const matchIds = Array.from(perById.keys());
    if (matchIds.length > 0) {
      const { data: issues } = await sb
        .from('jobwork_bobbin_issue')
        .select('bobbin_id, pieces_issued')
        .eq('status', 'active')
        .in('bobbin_id', matchIds);
      let issued_m = 0;
      let issued_pcs = 0;
      for (const r of ((issues ?? []) as Array<{ bobbin_id: number; pieces_issued: number | string | null }>)) {
        const per = perById.get(r.bobbin_id) ?? 0;
        const pcs = Number(r.pieces_issued ?? 0);
        issued_pcs += pcs;
        issued_m   += per > 0 ? pcs * per : pcs;
      }

      const { data: outs } = await sb
        .from('stock_ledger')
        .select('quantity')
        .eq('bucket', 'bobbin')
        .eq('direction', 'out')
        .in('bobbin_id', matchIds);
      const consumed_m = ((outs ?? []) as Array<{ quantity: number | string | null }>)
        .reduce((s, r) => s + Number(r.quantity ?? 0), 0);

      result.bobbin_m = Math.max(0, issued_m - consumed_m);
      const per0 = bobbinSpecs[0]?.per ?? 0;
      result.bobbin_pcs = per0 > 0 ? result.bobbin_m / per0 : issued_pcs;
    }
  }

  // Round for clean rendering.
  result.warp_m     = Math.round(result.warp_m     * 100) / 100;
  result.weft_kg    = Math.round(result.weft_kg    * 1000) / 1000;
  result.porvai_kg  = Math.round(result.porvai_kg  * 1000) / 1000;
  result.bobbin_pcs = Math.round(result.bobbin_pcs * 100) / 100;
  result.bobbin_m   = Math.round(result.bobbin_m   * 100) / 100;
  return result;
}

/** Shape persisted into fabric_receipt.stock_snapshot. Bobbin balance is
 *  tracked in METRES (sum of quantity × bobbin_metre across matching
 *  jobwork bobbins), not pieces. The operator thinks in metres on the
 *  receipt — pieces are an implementation detail. */
export interface StockSnapshotJson {
  warp_beam:   { before_m: number;  consumed_m: number;  after_m: number  };
  weft_yarn:   { before_kg: number; consumed_kg: number; after_kg: number };
  porvai_yarn: { before_kg: number; consumed_kg: number; after_kg: number };
  bobbin:      { before_m: number;  consumed_m: number;  after_m: number  };
}

/** Build the snapshot JSON from two BucketSnapshot measurements. */
export function buildSnapshot(before: BucketSnapshot, after: BucketSnapshot): StockSnapshotJson {
  return {
    warp_beam: {
      before_m:    before.warp_m,
      consumed_m:  Math.round((before.warp_m - after.warp_m) * 100) / 100,
      after_m:     after.warp_m,
    },
    weft_yarn: {
      before_kg:   before.weft_kg,
      consumed_kg: Math.round((before.weft_kg - after.weft_kg) * 1000) / 1000,
      after_kg:    after.weft_kg,
    },
    porvai_yarn: {
      before_kg:   before.porvai_kg,
      consumed_kg: Math.round((before.porvai_kg - after.porvai_kg) * 1000) / 1000,
      after_kg:    after.porvai_kg,
    },
    bobbin: {
      before_m:    before.bobbin_m,
      consumed_m:  Math.round((before.bobbin_m - after.bobbin_m) * 100) / 100,
      after_m:     after.bobbin_m,
    },
  };
}

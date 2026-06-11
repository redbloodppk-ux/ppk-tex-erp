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
): Promise<BucketSnapshot> {
  const result: BucketSnapshot = { warp_m: 0, weft_kg: 0, porvai_kg: 0, bobbin_pcs: 0, bobbin_m: 0 };
  if (fabricQualityIds.length === 0) return result;

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

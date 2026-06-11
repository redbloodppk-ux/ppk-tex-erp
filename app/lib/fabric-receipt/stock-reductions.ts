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
 *   bobbin (job-work pool, derived) — consumption recorded via the
 *   stock_ledger row only; bobbin.quantity (godown stock) is untouched
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

/** Consume from the job-work bobbin pool for every spec (ends_per_bobbin
 *  + bobbin_metre) assigned to ANY fabric quality in the merged pool.
 *
 *  The pool is DERIVED (mirrors the Warehouse → Job Work → Bobbin pivot
 *  and measureStock):
 *    available = active jobwork_bobbin_issue pieces × m/pc
 *              − stock_ledger bobbin outflows (metres)
 *  Nothing is mutated here — the consumption is recorded by the ledger
 *  row the orchestrator writes, which itself reduces the derived pool.
 *  bobbin.quantity is never touched: since migration 141/142 it tracks
 *  godown stock, not the party's pool (reading it was the bug that
 *  zeroed bobbin on receipts). */
async function reduceBobbin(
  sb: Sb,
  fabric_quality_id: number,
  metres: number,
  jobworkPartyId: number | null,
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
  // The assigned bobbin id can be STALE — migration 140 consolidated
  // bobbin ids but couldn't re-point calc_snapshot.bobbinId (JSON).
  // When we know the jobwork party we therefore don't depend on the
  // spec at all: the pool is whatever was issued to the party.
  if (specs.length === 0 && jobworkPartyId == null) {
    return { applied_pcs: 0, applied_m: 0, perBobbin: [] };
  }

  // Step 3 (unscoped fallback only): resolve every bobbin master id
  // matching any spec, in ANY production mode — legacy ledger outflows
  // may reference the in-house twin (same ends + m/pc).
  const matchIds: number[] = [];
  if (jobworkPartyId == null) {
    const { data: masterRows } = await sb
      .from('bobbin')
      .select('id, ends_per_bobbin, bobbin_metre');
    for (const r of ((masterRows ?? []) as Array<{ id: number; ends_per_bobbin: number | null; bobbin_metre: number | string | null }>)) {
      const e = Number(r.ends_per_bobbin) || 0;
      const p = Number(r.bobbin_metre)   || 0;
      if (specs.some((s) => s.ends === e && s.per === p)) matchIds.push(r.id);
    }
    if (matchIds.length === 0) return { applied_pcs: 0, applied_m: 0, perBobbin: [] };
  }

  // Step 4: derive the available pool = issued metres − consumed metres
  // (mirrors the Warehouse pivot and measureStock).
  let qIn = sb
    .from('jobwork_bobbin_issue')
    .select('bobbin_id, pieces_issued, jobwork_party_id, issue_date, bobbin:bobbin_id ( bobbin_metre )')
    .eq('status', 'active')
    .order('issue_date', { ascending: true });
  qIn = jobworkPartyId != null
    ? qIn.eq('jobwork_party_id', jobworkPartyId)
    : qIn.in('bobbin_id', matchIds);
  const { data: issues } = await qIn;
  type IssueRow = {
    bobbin_id: number; pieces_issued: number | string | null;
    jobwork_party_id: number | null; issue_date: string | null;
    bobbin: { bobbin_metre: number | string | null } | null;
  };
  let issued_m = 0;
  let attrBobbinId: number | null = null;
  let attrPartyId: number | null = null;
  let attrPer = 0;
  for (const r of ((issues ?? []) as IssueRow[])) {
    const per = Number(r.bobbin?.bobbin_metre ?? 0);
    const pcs = Number(r.pieces_issued ?? 0);
    issued_m += per > 0 ? pcs * per : pcs;
    if (attrBobbinId == null && pcs > 0) {
      attrBobbinId = r.bobbin_id;
      attrPartyId  = r.jobwork_party_id;
      attrPer      = per;
    }
  }
  if (attrBobbinId == null) return { applied_pcs: 0, applied_m: 0, perBobbin: [] };

  let qOut = sb
    .from('stock_ledger')
    .select('quantity')
    .eq('bucket', 'bobbin')
    .eq('direction', 'out');
  qOut = jobworkPartyId != null
    ? qOut.eq('jobwork_party_id', jobworkPartyId)
    : qOut.in('bobbin_id', matchIds);
  const { data: outs } = await qOut;
  const consumed_m = ((outs ?? []) as Array<{ quantity: number | string | null }>)
    .reduce((s, r) => s + Number(r.quantity ?? 0), 0);

  const available_m = Math.max(0, issued_m - consumed_m);
  const cut_m = Math.min(metres, available_m);
  if (cut_m <= 0) return { applied_pcs: 0, applied_m: 0, perBobbin: [] };

  const cut_pcs = attrPer > 0 ? Math.round((cut_m / attrPer) * 100) / 100 : cut_m;
  return {
    applied_pcs: cut_pcs,
    applied_m: Math.round(cut_m * 100) / 100,
    perBobbin: [{
      bobbin_id: attrBobbinId,
      cut_pcs,
      cut_m: Math.round(cut_m * 100) / 100,
      party_id: attrPartyId ?? jobworkPartyId,
    }],
  };
}

/* ───────────────────── orchestrator ───────────────────── */

/** Optional receipt context used to tag every ledger entry we write. */
export interface ReceiptContext {
  receipt_id: number | null;
  receipt_code: string | null;
  receipt_date: string | null;  // YYYY-MM-DD
  /** Jobwork party that owns this DC (jobwork_party.id, NOT party.id).
   *  Used as a fallback for the stock_ledger.jobwork_party_id column
   *  when the underlying issue / bobbin row's party_id is NULL —
   *  which is the case for bobbins after migration 142 because the
   *  bobbin master is no longer per-party. Without this fallback the
   *  Warehouse → Job Work → Bobbin pivot can't find the outflow. */
  jobwork_party_id?: number | null;
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
  // Resolve once: if the caller passed a DC-level jobwork_party_id,
  // use it as a fallback for any ledger row whose source issue row
  // doesn't carry one. The Warehouse pivot uses this column to find
  // outflows per jobwork party.
  const ctxJwPartyId: number | null = ctx?.jobwork_party_id ?? null;

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
          jobwork_party_id: b.party_id ?? ctxJwPartyId, fabric_quality_id: b.quality_id,
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
          jobwork_party_id: b.party_id ?? ctxJwPartyId, fabric_quality_id: it.fabric_quality_id,
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
          jobwork_party_id: b.party_id ?? ctxJwPartyId, fabric_quality_id: it.fabric_quality_id,
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
      const r = await reduceBobbin(sb, it.fabric_quality_id, it.received_metres, ctxJwPartyId);
      result.applied.bobbin_pcs += r.applied_pcs;
      for (const b of r.perBobbin) {
        if (b.cut_pcs <= 0) continue;
        // Store bobbin consumption in METRES so the warehouse pivot
        // reads it directly without needing to multiply by bobbin_metre.
        // (1 m fabric consumes 1 m of bobbin yarn.)
        ledgerRows.push({
          bucket: 'bobbin', direction: 'out',
          jobwork_party_id: b.party_id ?? ctxJwPartyId, fabric_quality_id: it.fabric_quality_id,
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

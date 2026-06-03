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
  bobbin_id: number | null;
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

/** Reduce pavu.meters FIFO across pavus whose sizing_job uses one of
 *  the fabric quality's warp counts. */
async function reducePavu(
  sb: Sb,
  fabric_quality_id: number,
  metres: number,
): Promise<{ applied: number }> {
  if (metres <= 0) return { applied: 0 };

  // Step 1: warp_count_ids for this fabric quality.
  const { data: wcRows } = await sb
    .from('fabric_quality_warp_count')
    .select('yarn_count_id')
    .eq('fabric_quality_id', fabric_quality_id);
  const warpCountIds = (wcRows ?? [])
    .map((r: { yarn_count_id: number | null }) => r.yarn_count_id)
    .filter((x: number | null): x is number => x != null);
  if (warpCountIds.length === 0) return { applied: 0 };

  // Step 2: sizing_job ids whose warp_count_id matches.
  const { data: sjRows } = await sb
    .from('sizing_job')
    .select('id')
    .in('warp_count_id', warpCountIds);
  const sjIds = (sjRows ?? []).map((r: { id: number }) => r.id);
  if (sjIds.length === 0) return { applied: 0 };

  // Step 3: pavus FIFO with meters > 0.
  const { data: pavus } = await sb
    .from('pavu')
    .select('id, meters')
    .in('sizing_job_id', sjIds)
    .gt('meters', 0)
    .order('id');

  let remaining = metres;
  let applied = 0;
  for (const p of (pavus ?? []) as Array<{ id: number; meters: number | string }>) {
    if (remaining <= 0) break;
    const available = Number(p.meters);
    const cut = Math.min(available, remaining);
    const newMeters = Math.max(0, available - cut);
    const { error } = await sb.from('pavu').update({ meters: newMeters }).eq('id', p.id);
    if (error) break;
    applied += cut;
    remaining -= cut;
  }
  return { applied: Math.round(applied * 100) / 100 };
}

/** Reduce yarn_lot.current_kg FIFO for the matching yarn count. */
async function reduceYarnLot(
  sb: Sb,
  yarn_count_id: number | null,
  kg: number,
  kind: 'weft' | 'porvai',
): Promise<{ applied: number }> {
  if (kg <= 0) return { applied: 0 };

  let q = sb
    .from('yarn_lot')
    .select('id, current_kg, yarn_kind, received_date')
    .gt('current_kg', 0)
    .order('received_date', { ascending: true })
    .order('id', { ascending: true });

  if (kind === 'porvai') {
    q = q.eq('yarn_kind', 'porvai');
  } else if (yarn_count_id != null) {
    q = q.eq('yarn_count_id', yarn_count_id);
    // For weft we deliberately don't filter on yarn_kind - any non-porvai
    // lot of the right count works.
  } else {
    return { applied: 0 };
  }

  const { data: lots } = await q;

  let remaining = kg;
  let applied = 0;
  for (const l of (lots ?? []) as Array<{ id: number; current_kg: number | string }>) {
    if (remaining <= 0) break;
    const avail = Number(l.current_kg);
    const cut = Math.min(avail, remaining);
    const next = Math.max(0, avail - cut);
    const { error } = await sb.from('yarn_lot').update({ current_kg: next }).eq('id', l.id);
    if (error) break;
    applied += cut;
    remaining -= cut;
  }
  return { applied: Math.round(applied * 100) / 100 };
}

/** Reduce bobbin.quantity by ceil(metres / bobbin_metre). Only runs
 *  when the receipt item explicitly carries a bobbin_id. */
async function reduceBobbin(
  sb: Sb,
  bobbin_id: number | null,
  metres: number,
): Promise<{ applied_pcs: number; applied_m: number }> {
  if (bobbin_id == null || metres <= 0) return { applied_pcs: 0, applied_m: 0 };
  const { data: b } = await sb
    .from('bobbin')
    .select('id, bobbin_metre, quantity')
    .eq('id', bobbin_id)
    .maybeSingle();
  if (!b) return { applied_pcs: 0, applied_m: 0 };
  const per = Number(b.bobbin_metre) || 0;
  if (per <= 0) return { applied_pcs: 0, applied_m: 0 };
  const pcsNeeded = Math.ceil(metres / per);
  const avail = Number(b.quantity) || 0;
  const pcsToCut = Math.min(avail, pcsNeeded);
  const next = Math.max(0, avail - pcsToCut);
  const { error } = await sb.from('bobbin').update({ quantity: next }).eq('id', bobbin_id);
  if (error) return { applied_pcs: 0, applied_m: 0 };
  return { applied_pcs: pcsToCut, applied_m: Math.round(pcsToCut * per * 100) / 100 };
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
          note: 'Available pavu metres less than received - check sizing job stock for this quality.',
        });
      }
    }

    // WEFT YARN
    if (it.weft_consumed_kg && it.weft_consumed_kg > 0) {
      const { data: weftLink } = await sb
        .from('fabric_quality_weft')
        .select('yarn_count_id')
        .eq('fabric_quality_id', it.fabric_quality_id)
        .limit(1)
        .maybeSingle();
      const weftCountId = weftLink?.yarn_count_id ?? null;
      const r = await reduceYarnLot(sb, weftCountId, it.weft_consumed_kg, 'weft');
      result.applied.weft_kg += r.applied;
      if (r.applied + 0.005 < it.weft_consumed_kg) {
        result.shortfalls.push({
          bucket: 'weft_yarn', fabric_quality_id: it.fabric_quality_id,
          needed: it.weft_consumed_kg, applied: r.applied, unit: 'kg',
          note: weftCountId == null
            ? 'No weft yarn count linked to this fabric quality.'
            : 'Available weft yarn kgs less than consumed - check yarn stock for this count.',
        });
      }
    }

    // PORVAI YARN
    if (it.porvai_consumed_kg && it.porvai_consumed_kg > 0) {
      const r = await reduceYarnLot(sb, null, it.porvai_consumed_kg, 'porvai');
      result.applied.porvai_kg += r.applied;
      if (r.applied + 0.005 < it.porvai_consumed_kg) {
        result.shortfalls.push({
          bucket: 'porvai_yarn', fabric_quality_id: it.fabric_quality_id,
          needed: it.porvai_consumed_kg, applied: r.applied, unit: 'kg',
          note: 'No porvai yarn stock found - check yarn_lot rows with yarn_kind = porvai.',
        });
      }
    }

    // BOBBIN
    if (it.bobbin_id != null && it.received_metres > 0) {
      const r = await reduceBobbin(sb, it.bobbin_id, it.received_metres);
      result.applied.bobbin_pcs += r.applied_pcs;
      if (r.applied_m + 0.005 < it.received_metres) {
        result.shortfalls.push({
          bucket: 'bobbin', fabric_quality_id: it.fabric_quality_id,
          needed: it.received_metres, applied: r.applied_m, unit: 'm',
          note: 'Selected bobbin did not have enough quantity left.',
        });
      }
    }
  }

  return result;
}

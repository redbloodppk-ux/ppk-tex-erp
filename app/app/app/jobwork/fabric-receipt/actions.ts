'use server';
/**
 * Server actions for the Fabric Receipt list page.
 *
 * backfillStockSnapshots() — for every fabric receipt that doesn't have
 * a stock_snapshot yet, reconstruct one by walking the timeline
 * backwards from today's stock. The receipt's "after" balance is
 * computed as today_balance + sum of consumption from receipts saved
 * AFTER this one (chronologically), and "before" = after + this
 * receipt's own consumption.
 *
 * Caveats:
 *   - We can only reconstruct what we can derive from fabric_receipt_item
 *     totals. If items were edited without re-running reductions, the
 *     numbers will drift from the live balances.
 *   - The backfill treats each receipt's union-of-qualities as a single
 *     pool, matching how the save-time snapshot is captured.
 */
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { measureStock } from '@/lib/fabric-receipt/stock-measure';

interface ReceiptItem {
  fabric_quality_id: number | null;
  received_metres: number | string | null;
  weft_consumed_kg: number | string | null;
  porvai_consumed_kg: number | string | null;
  bobbin_consumed_pcs: number | string | null;
}

interface ReceiptForBackfill {
  id: number;
  code: string;
  receipt_date: string;
  stock_snapshot: unknown | null;
  items: ReceiptItem[];
}

export interface BackfillResult {
  scanned: number;
  updated: number;
  skipped: number;
  error?: string;
}

function n(v: unknown): number {
  if (v == null || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round2(x: number): number  { return Math.round(x * 100)  / 100;  }
function round3(x: number): number  { return Math.round(x * 1000) / 1000; }

interface BucketTotals {
  warp_m: number;
  weft_kg: number;
  porvai_kg: number;
  bobbin_pcs: number;
}

function consumedTotals(items: ReceiptItem[]): BucketTotals {
  return items.reduce<BucketTotals>(
    (acc, it) => ({
      warp_m:     acc.warp_m     + n(it.received_metres),
      weft_kg:    acc.weft_kg    + n(it.weft_consumed_kg),
      porvai_kg:  acc.porvai_kg  + n(it.porvai_consumed_kg),
      bobbin_pcs: acc.bobbin_pcs + n(it.bobbin_consumed_pcs),
    }),
    { warp_m: 0, weft_kg: 0, porvai_kg: 0, bobbin_pcs: 0 },
  );
}

export async function backfillStockSnapshots(): Promise<BackfillResult> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // 1. Pull every receipt with its items, newest first. We walk in
  //    reverse-chronological order to reconstruct each receipt's
  //    historical balance from today's snapshot.
  const { data: receipts, error } = await sb
    .from('fabric_receipt')
    .select(`
      id, code, receipt_date, stock_snapshot,
      items:fabric_receipt_item (
        fabric_quality_id, received_metres,
        weft_consumed_kg, porvai_consumed_kg, bobbin_consumed_pcs
      )
    `)
    .order('receipt_date', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    const msg = error.message ?? '';
    // Common cause: migration 091 not applied yet. Give a clearer message.
    if (/stock_snapshot/i.test(msg) && /does not exist/i.test(msg)) {
      return {
        scanned: 0, updated: 0, skipped: 0,
        error: 'Apply migration 091_fabric_receipt_stock_snapshot.sql in Supabase first — the stock_snapshot column does not exist yet.',
      };
    }
    return { scanned: 0, updated: 0, skipped: 0, error: msg };
  }

  const list = (receipts ?? []) as ReceiptForBackfill[];
  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  // 2. For each receipt that doesn't yet have a snapshot, compute one.
  //    Running totals: for each receipt R (going newest -> oldest), the
  //    "after R" balance equals today's balance + sum of consumption
  //    from receipts STRICTLY AFTER R (which we've already visited in
  //    the walk because we're going newest first). We track that
  //    running sum per pool key so receipts that share a quality pool
  //    accumulate the right amount.
  //
  //    Pool key = sorted list of fabric_quality_ids on the receipt.
  //    This isn't a perfect pool identity (true pool = merged siblings)
  //    but it gives a stable bucket the running sum can attach to.
  //    For the snapshot we use measureStock(pool_qIds) which DOES handle
  //    merged-sibling expansion correctly.
  const runningPostReceipt: Record<string, BucketTotals> = {};

  for (const r of list) {
    scanned++;
    if (r.stock_snapshot) { skipped++; continue; }
    const qIds = Array.from(new Set(
      (r.items ?? [])
        .map((it) => it.fabric_quality_id)
        .filter((x): x is number => x != null),
    ));
    if (qIds.length === 0) { skipped++; continue; }

    // Today's balance for this receipt's pool (handles merged siblings).
    let todayBalance: BucketTotals;
    try {
      const m = await measureStock(sb, qIds);
      todayBalance = { warp_m: m.warp_m, weft_kg: m.weft_kg, porvai_kg: m.porvai_kg, bobbin_pcs: m.bobbin_pcs };
    } catch {
      skipped++;
      continue;
    }

    const poolKey = qIds.slice().sort((a, b) => a - b).join(',');
    const accAfter = runningPostReceipt[poolKey] ?? { warp_m: 0, weft_kg: 0, porvai_kg: 0, bobbin_pcs: 0 };

    // after this receipt = today + everything consumed by NEWER receipts
    const afterR = {
      warp_m:     todayBalance.warp_m     + accAfter.warp_m,
      weft_kg:    todayBalance.weft_kg    + accAfter.weft_kg,
      porvai_kg:  todayBalance.porvai_kg  + accAfter.porvai_kg,
      bobbin_pcs: todayBalance.bobbin_pcs + accAfter.bobbin_pcs,
    };
    const consumed = consumedTotals(r.items ?? []);
    const beforeR = {
      warp_m:     afterR.warp_m     + consumed.warp_m,
      weft_kg:    afterR.weft_kg    + consumed.weft_kg,
      porvai_kg:  afterR.porvai_kg  + consumed.porvai_kg,
      bobbin_pcs: afterR.bobbin_pcs + consumed.bobbin_pcs,
    };

    const snapshot = {
      warp_beam:   { before_m:  round2(beforeR.warp_m),     consumed_m:  round2(consumed.warp_m),     after_m:  round2(afterR.warp_m)     },
      weft_yarn:   { before_kg: round3(beforeR.weft_kg),    consumed_kg: round3(consumed.weft_kg),    after_kg: round3(afterR.weft_kg)    },
      porvai_yarn: { before_kg: round3(beforeR.porvai_kg),  consumed_kg: round3(consumed.porvai_kg),  after_kg: round3(afterR.porvai_kg)  },
      bobbin:      { before_pcs: round2(beforeR.bobbin_pcs), consumed_pcs: round2(consumed.bobbin_pcs), after_pcs: round2(afterR.bobbin_pcs), before_m: 0, after_m: 0 },
    };

    const { error: upErr } = await sb
      .from('fabric_receipt')
      .update({ stock_snapshot: snapshot })
      .eq('id', r.id);
    if (upErr) { skipped++; continue; }
    updated++;

    // Roll the running total forward (older receipts saw this one's
    // consumption on top of their own future).
    runningPostReceipt[poolKey] = {
      warp_m:     accAfter.warp_m     + consumed.warp_m,
      weft_kg:    accAfter.weft_kg    + consumed.weft_kg,
      porvai_kg:  accAfter.porvai_kg  + consumed.porvai_kg,
      bobbin_pcs: accAfter.bobbin_pcs + consumed.bobbin_pcs,
    };
  }

  revalidatePath('/app/jobwork/fabric-receipt');
  return { scanned, updated, skipped };
}

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
  /** Stored historically in PCS, but the snapshot now tracks bobbin in
   *  METRES. We convert pcs → metres via the assigned bobbin's
   *  bobbin_metre when we read it (resolved inside measureStock). For
   *  the consumed delta here we just use received_metres since each
   *  metre of fabric consumes one metre of bobbin yarn 1:1 when the
   *  quality has a bobbin assigned. */
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
  /** Bobbin consumption in METRES. For each receipt item that has
   *  bobbin_consumed_pcs > 0 we use received_metres as the bobbin metre
   *  consumption (1 m fabric consumes 1 m bobbin yarn). */
  bobbin_m: number;
}

function consumedTotals(items: ReceiptItem[]): BucketTotals {
  return items.reduce<BucketTotals>(
    (acc, it) => ({
      warp_m:    acc.warp_m    + n(it.received_metres),
      weft_kg:   acc.weft_kg   + n(it.weft_consumed_kg),
      porvai_kg: acc.porvai_kg + n(it.porvai_consumed_kg),
      bobbin_m:  acc.bobbin_m  + (n(it.bobbin_consumed_pcs) > 0 ? n(it.received_metres) : 0),
    }),
    { warp_m: 0, weft_kg: 0, porvai_kg: 0, bobbin_m: 0 },
  );
}

/** @param force When true, recompute the snapshot for EVERY receipt —
 *  not just the ones missing one. Use after stock-logic changes (e.g.
 *  negative balances) so old receipts show corrected before/after. */
export async function backfillStockSnapshots(force = false): Promise<BackfillResult> {
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
    const qIds = Array.from(new Set(
      (r.items ?? [])
        .map((it) => it.fabric_quality_id)
        .filter((x): x is number => x != null),
    ));
    if (qIds.length === 0) { skipped++; continue; }

    const poolKey = qIds.slice().sort((a, b) => a - b).join(',');
    const accAfter = runningPostReceipt[poolKey] ?? { warp_m: 0, weft_kg: 0, porvai_kg: 0, bobbin_m: 0 };
    const consumed = consumedTotals(r.items ?? []);

    // ALWAYS roll the running total forward — even receipts we don't
    // rewrite consumed stock, and older receipts in the same pool need
    // that consumption on top of their own future.
    runningPostReceipt[poolKey] = {
      warp_m:    accAfter.warp_m    + consumed.warp_m,
      weft_kg:   accAfter.weft_kg   + consumed.weft_kg,
      porvai_kg: accAfter.porvai_kg + consumed.porvai_kg,
      bobbin_m:  accAfter.bobbin_m  + consumed.bobbin_m,
    };

    if (!force && r.stock_snapshot) { skipped++; continue; }

    // Today's balance for this receipt's pool (handles merged siblings).
    // measureStock is negative-aware: over-consumed pools come back as
    // negative figures instead of being clamped at zero.
    let todayBalance: BucketTotals;
    try {
      const m = await measureStock(sb, qIds);
      todayBalance = { warp_m: m.warp_m, weft_kg: m.weft_kg, porvai_kg: m.porvai_kg, bobbin_m: m.bobbin_m };
    } catch {
      skipped++;
      continue;
    }

    // after this receipt = today + everything consumed by NEWER receipts
    const afterR = {
      warp_m:    todayBalance.warp_m    + accAfter.warp_m,
      weft_kg:   todayBalance.weft_kg   + accAfter.weft_kg,
      porvai_kg: todayBalance.porvai_kg + accAfter.porvai_kg,
      bobbin_m:  todayBalance.bobbin_m  + accAfter.bobbin_m,
    };
    const beforeR = {
      warp_m:    afterR.warp_m    + consumed.warp_m,
      weft_kg:   afterR.weft_kg   + consumed.weft_kg,
      porvai_kg: afterR.porvai_kg + consumed.porvai_kg,
      bobbin_m:  afterR.bobbin_m  + consumed.bobbin_m,
    };

    const snapshot = {
      warp_beam:   { before_m:  round2(beforeR.warp_m),    consumed_m:  round2(consumed.warp_m),    after_m:  round2(afterR.warp_m)    },
      weft_yarn:   { before_kg: round3(beforeR.weft_kg),   consumed_kg: round3(consumed.weft_kg),   after_kg: round3(afterR.weft_kg)   },
      porvai_yarn: { before_kg: round3(beforeR.porvai_kg), consumed_kg: round3(consumed.porvai_kg), after_kg: round3(afterR.porvai_kg) },
      bobbin:      { before_m:  round2(beforeR.bobbin_m),  consumed_m:  round2(consumed.bobbin_m),  after_m:  round2(afterR.bobbin_m)  },
    };

    const { error: upErr } = await sb
      .from('fabric_receipt')
      .update({ stock_snapshot: snapshot })
      .eq('id', r.id);
    if (upErr) { skipped++; continue; }
    updated++;
  }

  revalidatePath('/app/jobwork/fabric-receipt');
  return { scanned, updated, skipped };
}

// ─── Reorganize receipts: dedupe + renumber to match source DC ──────────────

export interface ReorganizeResult {
  duplicates_removed: number;
  renumbered: number;
  skipped: number;
  error?: string;
}

/** Parse the trailing sequence number out of a code like "JDC/26-27/0021"
 *  or "FR/26-27/3". Returns the integer part of the LAST '/' segment, or
 *  null if it can't be parsed. */
function parseTrailingSeq(code: string | null | undefined): number | null {
  if (!code) return null;
  const tail = code.split('/').pop();
  if (!tail) return null;
  const m = /^(\d+)/.exec(tail);
  return m ? Number(m[1]) : null;
}

/** Pad a sequence to a 4-digit string. */
function pad4(n: number): string { return String(n).padStart(4, '0'); }

/** Dedupe + renumber fabric_receipt codes so each FR matches its source
 *  DC's sequence number. Steps:
 *   1. Group receipts by dc_id; for each dc_id with > 1 receipt, keep
 *      the newest (highest id) and cancel the rest (reverse stock,
 *      delete items, delete header, free... but in this case the
 *      remaining receipt still occupies the DC so we don't reset it).
 *   2. For each surviving receipt, parse the source DC's seq and set
 *      the receipt's code to FR/<fy>/<seq:0000>.
 *   3. Clear all stock_snapshot fields (forcing a fresh backfill).
 *   4. Resync doc_sequence.fabric_receipt next_value to MAX(seq) + 1.
 *
 * The caller is expected to click "Backfill snapshots" afterwards to
 * regenerate the per-receipt before/after rows from current stock.
 */
export async function reorganizeFabricReceipts(): Promise<ReorganizeResult> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // 1. Pull every receipt with its dc_id, ordered by id ascending. We
  //    use the receipt with the HIGHEST id per dc_id as the canonical
  //    one (assumed to be the most recently saved + most correct).
  const { data: receipts, error: rxErr } = await sb
    .from('fabric_receipt')
    .select('id, code, dc_id, dc:dc_id ( id, code, production_mode )')
    .order('id', { ascending: true });
  if (rxErr) return { duplicates_removed: 0, renumbered: 0, skipped: 0, error: rxErr.message };

  type ReceiptRow = { id: number; code: string; dc_id: number | null; dc: { id: number; code: string; production_mode: string | null } | null };
  const list = (receipts ?? []) as ReceiptRow[];

  // Group by dc_id.
  const byDc = new Map<number, ReceiptRow[]>();
  const standalone: ReceiptRow[] = [];
  for (const r of list) {
    if (r.dc_id == null) { standalone.push(r); continue; }
    const arr = byDc.get(r.dc_id);
    if (arr) arr.push(r);
    else byDc.set(r.dc_id, [r]);
  }

  // 2. Cancel duplicate receipts (everything except the highest-id one
  //    per dc_id). Reuses cancelFabricReceipt logic inline so we don't
  //    cross-import a server action.
  let duplicates_removed = 0;
  for (const [, group] of byDc) {
    if (group.length <= 1) continue;
    const sorted = group.slice().sort((a, b) => a.id - b.id);
    const survivors = sorted.slice(-1); // keep latest
    const losers = sorted.slice(0, -1);
    void survivors;
    for (const loser of losers) {
      const ok = await internalCancelReceipt(sb, loser.id, false /* leave DC alone, survivor still holds it */);
      if (ok) duplicates_removed++;
    }
  }

  // 3. Re-read survivors after dedupe and renumber to match DC seq.
  const { data: postDedupe } = await sb
    .from('fabric_receipt')
    .select('id, code, dc:dc_id ( id, code )')
    .order('id', { ascending: true });
  let renumbered = 0;
  let skipped = 0;
  let maxSeq = 0;
  for (const r of (postDedupe ?? []) as Array<{ id: number; code: string; dc: { id: number; code: string } | null }>) {
    const seq = parseTrailingSeq(r.dc?.code ?? null);
    if (seq == null) { skipped++; continue; }
    // Build new code mirroring the DC's FY portion. JDC/26-27/0021 -> FR/26-27/0021.
    const parts = (r.dc?.code ?? '').split('/');
    const fy = parts.length >= 3 ? parts[1] : '26-27';
    const newCode = `FR/${fy}/${pad4(seq)}`;
    if (r.code === newCode) { skipped++; if (seq > maxSeq) maxSeq = seq; continue; }
    const { error: upErr } = await sb
      .from('fabric_receipt')
      .update({ code: newCode, stock_snapshot: null })
      .eq('id', r.id);
    if (upErr) { skipped++; continue; }
    renumbered++;
    if (seq > maxSeq) maxSeq = seq;
  }
  // Even rows we skipped should have snapshots cleared so the next
  // backfill regenerates a consistent history.
  await sb.from('fabric_receipt').update({ stock_snapshot: null }).is('stock_snapshot', null);

  // 4. Resync the doc_sequence so the NEXT new receipt continues from
  //    maxSeq + 1. We try the function from migration 092 first; if
  //    it's not there fall back to a direct UPDATE.
  try {
    await sb.rpc('fn_resync_doc_sequence', { p_doc_type: 'fabric_receipt' });
  } catch {
    try {
      await sb.from('doc_sequence')
        .update({ next_value: maxSeq + 1 })
        .eq('doc_type', 'fabric_receipt');
    } catch {
      // ignore - resync is best-effort
    }
  }

  revalidatePath('/app/jobwork/fabric-receipt');
  void standalone;
  return { duplicates_removed, renumbered, skipped };
}

// ─── Chronological ledger backfill ──────────────────────────────────────────
// For every fabric receipt that has no stock_ledger entries yet, derive
// the outflow rows directly from fabric_receipt_item + the fabric_quality
// calc_snapshot. Each ledger row carries the receipt_date so the
// warehouse pivot view can sort it chronologically against the inflows
// (jobwork_warp_beam.given_date, jobwork_weft_bag.given_date, bobbin
// .purchase_date) and compute a true running balance per column.

export interface RebuildLedgerResult {
  receipts_scanned: number;
  receipts_rebuilt: number;
  ledger_rows_inserted: number;
  error?: string;
}

export async function rebuildStockLedgerFromReceipts(): Promise<RebuildLedgerResult> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // 1. Pull every receipt with its items + the receipt code (for
  //    reference_no in ledger entries). Ordered by date ascending so
  //    that, if multiple receipts touch the same pool, the ledger
  //    inserts happen in chronological order.
  const { data: receipts, error } = await sb
    .from('fabric_receipt')
    .select(`
      id, code, receipt_date, party_id,
      party:party_id ( id, name ),
      items:fabric_receipt_item (
        fabric_quality_id, received_metres,
        weft_yarn_count_id, weft_consumed_kg,
        porvai_consumed_kg, bobbin_consumed_pcs
      )
    `)
    .order('receipt_date', { ascending: true })
    .order('id', { ascending: true });
  if (error) {
    return { receipts_scanned: 0, receipts_rebuilt: 0, ledger_rows_inserted: 0, error: error.message };
  }
  const receiptList = (receipts ?? []) as Array<{
    id: number; code: string; receipt_date: string;
    party_id: number | null;
    party: { id: number; name: string } | null;
    items: Array<{
      fabric_quality_id: number | null;
      received_metres: number | string | null;
      weft_yarn_count_id: number | null;
      weft_consumed_kg: number | string | null;
      porvai_consumed_kg: number | string | null;
      bobbin_consumed_pcs: number | string | null;
    }>;
  }>;

  // 2. Bulk-fetch fabric_quality master rows (calc_snapshot has the
  //    porvai count id and bobbin id we need for outflow tagging).
  const qIds = Array.from(new Set(
    receiptList.flatMap((r) => r.items.map((it) => it.fabric_quality_id))
      .filter((x): x is number => x != null),
  ));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fqById = new Map<number, { calc_snapshot: any }>();
  if (qIds.length > 0) {
    const { data: fqRows } = await sb
      .from('fabric_quality')
      .select('id, calc_snapshot')
      .in('id', qIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of ((fqRows ?? []) as Array<{ id: number; calc_snapshot: any }>)) {
      fqById.set(r.id, r);
    }
  }

  // 2b. Bridge party.id → jobwork_party.id by NAME (different id
  //     spaces for the same physical party — same pragmatic bridge the
  //     save flow uses). The warehouse pivots find outflows via
  //     stock_ledger.jobwork_party_id, so tagging matters.
  const jwByName = new Map<string, number>();
  try {
    const { data: jwRows } = await sb.from('jobwork_party').select('id, name');
    for (const j of ((jwRows ?? []) as Array<{ id: number; name: string | null }>)) {
      if (j.name) jwByName.set(j.name.trim().toUpperCase(), j.id);
    }
  } catch { /* table may not exist */ }

  // 3. For each receipt, check WHICH buckets already have ledger rows.
  //    Buckets with rows are skipped (don't double-count); missing
  //    buckets get rows derived from the items.
  let receipts_rebuilt = 0;
  let ledger_rows_inserted = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRows: any[] = [];

  for (const r of receiptList) {
    // Which buckets already have ledger rows for this receipt? Skipping
    // per BUCKET (not per receipt) matters: older saves often wrote the
    // warp row but silently dropped weft/bobbin when the party had no
    // stock — those missing buckets are exactly what we backfill here.
    const existingBuckets = new Set<string>();
    try {
      const { data: exRows } = await sb
        .from('stock_ledger')
        .select('bucket')
        .eq('source_kind', 'fabric_receipt')
        .eq('source_id', r.id);
      for (const e of ((exRows ?? []) as Array<{ bucket: string }>)) existingBuckets.add(e.bucket);
    } catch {
      // Ledger table may not exist - rebuild flow will fail gracefully
      // when we try to insert; we still scan items.
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowsForThis: any[] = [];
    const jwParty = r.party?.name ? (jwByName.get(r.party.name.trim().toUpperCase()) ?? null) : null;
    for (const it of r.items) {
      const fqId = it.fabric_quality_id;
      const snap = fqId != null ? fqById.get(fqId)?.calc_snapshot ?? null : null;
      const metres = Number(it.received_metres ?? 0);
      const weftKg = Number(it.weft_consumed_kg ?? 0);
      const porvaiKg = Number(it.porvai_consumed_kg ?? 0);
      const bobbinPcs = Number(it.bobbin_consumed_pcs ?? 0);

      if (!existingBuckets.has('warp_beam') && metres > 0 && fqId != null) {
        rowsForThis.push({
          bucket: 'warp_beam', direction: 'out',
          jobwork_party_id: jwParty,
          fabric_quality_id: fqId,
          quantity: Math.round(metres * 100) / 100, unit: 'm',
          event_date: r.receipt_date,
          source_kind: 'fabric_receipt', source_id: r.id,
          reference_no: r.code, notes: 'Backfilled from receipt items',
        });
      }
      if (!existingBuckets.has('weft_yarn') && weftKg > 0) {
        // Count id from the item, falling back to the quality snapshot.
        let weftCountId: number | null = it.weft_yarn_count_id;
        if (weftCountId == null && snap?.weftCountId != null && snap.weftCountId !== '') {
          const n2 = Number(snap.weftCountId);
          if (Number.isFinite(n2) && n2 > 0) weftCountId = n2;
        }
        rowsForThis.push({
          bucket: 'weft_yarn', direction: 'out',
          jobwork_party_id: jwParty,
          fabric_quality_id: fqId, yarn_count_id: weftCountId,
          quantity: Math.round(weftKg * 1000) / 1000, unit: 'kg',
          event_date: r.receipt_date,
          source_kind: 'fabric_receipt', source_id: r.id,
          reference_no: r.code, notes: 'Backfilled from receipt items',
        });
      }
      // Porvai yarn count id is not stored on the item, we resolve it
      // from the fabric_quality's calc_snapshot.porvaiCountId.
      if (!existingBuckets.has('porvai_yarn') && porvaiKg > 0 && snap?.porvaiCountId != null && snap.porvaiCountId !== '') {
        const porvaiCountId = Number(snap.porvaiCountId);
        if (Number.isFinite(porvaiCountId) && porvaiCountId > 0) {
          rowsForThis.push({
            bucket: 'porvai_yarn', direction: 'out',
            jobwork_party_id: jwParty,
            fabric_quality_id: fqId, yarn_count_id: porvaiCountId,
            quantity: Math.round(porvaiKg * 1000) / 1000, unit: 'kg',
            event_date: r.receipt_date,
            source_kind: 'fabric_receipt', source_id: r.id,
            reference_no: r.code, notes: 'Backfilled from receipt items',
          });
        }
      }
      // Bobbin outflow: stored in METRES (the receipt's
      // bobbin_consumed_pcs column actually holds metres - one m of
      // fabric consumes one m of bobbin yarn). We write unit='m' so the
      // warehouse loader can use the value directly without trying to
      // convert pcs → metres again. bobbin_id may be null (stale or
      // missing snapshot id) — the jobwork pivot matches outflows by
      // jobwork_party_id so the row is still found.
      if (!existingBuckets.has('bobbin') && bobbinPcs > 0) {
        let bobbinId: number | null = null;
        if (snap?.bobbinId != null && snap.bobbinId !== '') {
          const n3 = Number(snap.bobbinId);
          if (Number.isFinite(n3) && n3 > 0) bobbinId = n3;
        }
        rowsForThis.push({
          bucket: 'bobbin', direction: 'out',
          jobwork_party_id: jwParty,
          fabric_quality_id: fqId, bobbin_id: bobbinId,
          quantity: Math.round(bobbinPcs * 100) / 100, unit: 'm',
          event_date: r.receipt_date,
          source_kind: 'fabric_receipt', source_id: r.id,
          reference_no: r.code, notes: 'Backfilled from receipt items',
        });
      }
    }
    if (rowsForThis.length > 0) {
      allRows.push(...rowsForThis);
      receipts_rebuilt++;
    }
  }

  if (allRows.length > 0) {
    try {
      const { error: insErr } = await sb.from('stock_ledger').insert(allRows);
      if (insErr) {
        return {
          receipts_scanned: receiptList.length, receipts_rebuilt: 0, ledger_rows_inserted: 0,
          error: /stock_ledger/i.test(insErr.message ?? '') && /does not exist/i.test(insErr.message ?? '')
            ? 'Apply migration 090_stock_ledger.sql first.'
            : insErr.message,
        };
      }
      ledger_rows_inserted = allRows.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Insert failed.';
      return { receipts_scanned: receiptList.length, receipts_rebuilt: 0, ledger_rows_inserted: 0, error: msg };
    }
  }

  revalidatePath('/app/warehouse');
  revalidatePath('/app/jobwork/fabric-receipt');
  return { receipts_scanned: receiptList.length, receipts_rebuilt, ledger_rows_inserted };
}

/** Internal cancel helper used by reorganizeFabricReceipts. Mirrors
 *  cancelFabricReceipt's reversal logic but takes a flag for whether to
 *  also reset the source DC. When deduping we leave the DC pointing at
 *  the surviving receipt. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function internalCancelReceipt(sb: any, receiptId: number, resetDc: boolean): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ledgerRows: any[] = [];
  try {
    const res = await sb
      .from('stock_ledger')
      .select('id, bucket, fabric_quality_id, yarn_count_id, bobbin_id, quantity, notes')
      .eq('source_kind', 'fabric_receipt')
      .eq('source_id', receiptId);
    if (!res.error) ledgerRows = res.data ?? [];
  } catch { ledgerRows = []; }

  // ONLY credit rows that name the exact source row ("beam #N" /
  // "lot #N" / "bag #N"). Backfilled and forced negative-balance rows
  // never reduced a live table — deleting the ledger row below is
  // their complete reversal. Crediting them into the smallest-id row
  // was the bug that inflated yarn lots past their received kgs.
  for (const row of ledgerRows) {
    const qty = Number(row.quantity ?? 0);
    if (qty <= 0) continue;
    const notes = String(row.notes ?? '');
    try {
      if (row.bucket === 'warp_beam') {
        const m = /beam #(\d+)/i.exec(notes);
        if (m?.[1] != null) {
          const { data: beam } = await sb
            .from('jobwork_warp_beam')
            .select('id, total_metres')
            .eq('id', Number(m[1]))
            .maybeSingle();
          if (beam) {
            await sb.from('jobwork_warp_beam').update({ total_metres: Number(beam.total_metres ?? 0) + qty }).eq('id', beam.id);
          }
        }
      } else if (row.bucket === 'weft_yarn' || row.bucket === 'porvai_yarn') {
        const lotMatch = /lot #(\d+)/i.exec(notes);
        const bagMatch = /bag #(\d+)/i.exec(notes);
        if (lotMatch?.[1] != null) {
          const { data: lot } = await sb.from('yarn_lot').select('id, current_kg').eq('id', Number(lotMatch[1])).maybeSingle();
          if (lot) {
            await sb.from('yarn_lot').update({ current_kg: Number(lot.current_kg ?? 0) + qty }).eq('id', lot.id);
          }
        } else if (bagMatch?.[1] != null) {
          const { data: bag } = await sb.from('jobwork_weft_bag').select('id, total_kg').eq('id', Number(bagMatch[1])).maybeSingle();
          if (bag) {
            await sb.from('jobwork_weft_bag').update({ total_kg: Number(bag.total_kg ?? 0) + qty }).eq('id', bag.id);
          }
        }
      }
      // bucket === 'bobbin': nothing to restore — the job-work bobbin
      // pool is derived (issues − ledger outflows); deleting the ledger
      // rows below restores it. bobbin.quantity is godown stock.
    } catch { /* keep going */ }
  }

  try {
    await sb.from('stock_ledger')
      .delete()
      .eq('source_kind', 'fabric_receipt')
      .eq('source_id', receiptId);
  } catch { /* ignore */ }

  const { error: itErr } = await sb.from('fabric_receipt_item').delete().eq('receipt_id', receiptId);
  if (itErr) return false;

  if (resetDc) {
    // Look up dc_id first, then reset.
    const { data: hdr } = await sb.from('fabric_receipt').select('dc_id').eq('id', receiptId).maybeSingle();
    if (hdr?.dc_id) {
      await sb.from('delivery_challan')
        .update({ fabric_receipt_id: null, status: 'draft' })
        .eq('id', hdr.dc_id);
    }
  }

  const { error: rmErr } = await sb.from('fabric_receipt').delete().eq('id', receiptId);
  return rmErr == null;
}

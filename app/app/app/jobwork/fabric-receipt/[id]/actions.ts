'use server';
/**
 * Server actions for a single fabric receipt.
 *
 * cancelFabricReceipt(id) - reverses every stock reduction that this
 * receipt applied, then deletes the receipt + items, then frees the
 * source DC so a fresh receipt can be entered. Used to power an
 * "Edit (cancel + recreate)" UX from the detail page.
 *
 * Reversal strategy:
 *   - Read stock_ledger rows for this receipt (where source_kind =
 *     'fabric_receipt' AND source_id = receipt_id).
 *   - For each, add the quantity back into the matching source table:
 *       warp_beam   -> jobwork_warp_beam.total_metres
 *                      (added to the smallest-id beam in the pool)
 *       weft_yarn   -> jobwork_weft_bag.total_kg (smallest-id bag)
 *       porvai_yarn -> jobwork_weft_bag.total_kg (smallest-id bag)
 *       bobbin      -> bobbin.quantity (via stock_ledger.bobbin_id)
 *   - Delete the stock_ledger rows for this receipt.
 *   - Delete fabric_receipt_item rows.
 *   - Reset the linked DC: fabric_receipt_id = null, status = 'draft'.
 *   - Delete the fabric_receipt header.
 *
 * Pool totals are restored exactly; the individual beam/bag/bobbin
 * balances may shift since we add to the smallest-id row in the pool
 * rather than tracking which row originally got reduced (the ledger
 * notes carry a hint but we don't parse it). For FIFO matching that's
 * acceptable because FIFO consumes across the pool by date anyway.
 */
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface CancelReceiptResult {
  ok: boolean;
  dc_id?: number;
  error?: string;
}

/** Reverse a receipt's stock effects: restore warp/weft pools from the
 *  ledger rows, delete the ledger rows, delete the receipt items. The
 *  header itself is NOT touched — callers decide whether to delete it
 *  (cancel) or keep it for re-entry under the same code (edit). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reverseReceiptStock(sb: any, receiptId: number): Promise<string | null> {
  // Load all stock_ledger rows for this receipt. If the table doesn't
  //    exist yet (migration 090 not applied) we just skip the reversal -
  //    there were no recorded outflows to reverse.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ledgerRows: any[] = [];
  try {
    const res = await sb
      .from('stock_ledger')
      .select('id, bucket, fabric_quality_id, yarn_count_id, bobbin_id, quantity')
      .eq('source_kind', 'fabric_receipt')
      .eq('source_id', receiptId);
    if (res.error) ledgerRows = [];
    else ledgerRows = res.data ?? [];
  } catch {
    ledgerRows = [];
  }

  // 3. Reverse each ledger row by topping the matching source table.
  for (const row of ledgerRows) {
    const qty = Number(row.quantity ?? 0);
    if (qty <= 0) continue;
    try {
      if (row.bucket === 'warp_beam' && row.fabric_quality_id != null) {
        const { data: beam } = await sb
          .from('jobwork_warp_beam')
          .select('id, total_metres')
          .eq('fabric_quality_id', row.fabric_quality_id)
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (beam) {
          const next = Number(beam.total_metres ?? 0) + qty;
          await sb.from('jobwork_warp_beam').update({ total_metres: next }).eq('id', beam.id);
        }
      } else if ((row.bucket === 'weft_yarn' || row.bucket === 'porvai_yarn') && row.yarn_count_id != null) {
        const { data: bag } = await sb
          .from('jobwork_weft_bag')
          .select('id, total_kg')
          .eq('yarn_count_id', row.yarn_count_id)
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (bag) {
          const next = Number(bag.total_kg ?? 0) + qty;
          await sb.from('jobwork_weft_bag').update({ total_kg: next }).eq('id', bag.id);
        }
      }
      // bucket === 'bobbin': nothing to restore here. The job-work
      // bobbin pool is DERIVED (jobwork_bobbin_issue inflows −
      // stock_ledger outflows), so deleting this receipt's ledger rows
      // in step 4 puts the metres back automatically. bobbin.quantity
      // is godown stock and is no longer reduced by receipts — adding
      // metres into that pcs column would corrupt the master.
    } catch {
      // Best effort - keep going on individual failures.
    }
  }

  // Delete the ledger rows.
  try {
    await sb.from('stock_ledger')
      .delete()
      .eq('source_kind', 'fabric_receipt')
      .eq('source_id', receiptId);
  } catch {
    // ignore
  }

  // Delete items.
  const { error: itErr } = await sb.from('fabric_receipt_item').delete().eq('receipt_id', receiptId);
  if (itErr) return `Could not delete items: ${itErr.message}`;
  return null;
}

/** Free a receipt's source DC so it can be receipted again. The DC is
 *  only ever released by its own receipt — this is the single place
 *  that clears the fabric_receipt_id lock. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function releaseDc(sb: any, dcId: number | null): Promise<string | null> {
  if (dcId == null) return null;
  const { error: dcErr } = await sb
    .from('delivery_challan')
    .update({ fabric_receipt_id: null, status: 'draft' })
    .eq('id', dcId);
  return dcErr ? `Could not reset DC: ${dcErr.message}` : null;
}

export async function cancelFabricReceipt(receiptId: number): Promise<CancelReceiptResult> {
  if (!Number.isInteger(receiptId) || receiptId <= 0) {
    return { ok: false, error: 'Invalid receipt id.' };
  }
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: hdr, error: hdrErr } = await sb
    .from('fabric_receipt')
    .select('id, dc_id')
    .eq('id', receiptId)
    .maybeSingle();
  if (hdrErr || !hdr) return { ok: false, error: hdrErr?.message ?? 'Receipt not found.' };
  const dcId: number | null = hdr.dc_id ?? null;

  const revErr = await reverseReceiptStock(sb, receiptId);
  if (revErr) return { ok: false, error: revErr };

  const dcErr = await releaseDc(sb, dcId);
  if (dcErr) return { ok: false, error: dcErr };

  // Cancel = the receipt ceases to exist; its code is retired.
  const { error: rmErr } = await sb.from('fabric_receipt').delete().eq('id', receiptId);
  if (rmErr) return { ok: false, error: `Could not delete receipt: ${rmErr.message}` };

  revalidatePath('/app/jobwork/fabric-receipt');
  revalidatePath('/app/jobwork');
  return { ok: true, dc_id: dcId ?? undefined };
}

/** Edit-in-place: reverse the stock and free the DC exactly like a
 *  cancel, but KEEP the receipt header (same id + code) marked as
 *  'draft'. The re-entry form then updates this header on save, so the
 *  receipt code (e.g. FR/26-27/0018) is preserved and no new number is
 *  drawn from the sequence. */
export async function editFabricReceipt(receiptId: number): Promise<CancelReceiptResult> {
  if (!Number.isInteger(receiptId) || receiptId <= 0) {
    return { ok: false, error: 'Invalid receipt id.' };
  }
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: hdr, error: hdrErr } = await sb
    .from('fabric_receipt')
    .select('id, dc_id')
    .eq('id', receiptId)
    .maybeSingle();
  if (hdrErr || !hdr) return { ok: false, error: hdrErr?.message ?? 'Receipt not found.' };
  const dcId: number | null = hdr.dc_id ?? null;

  const revErr = await reverseReceiptStock(sb, receiptId);
  if (revErr) return { ok: false, error: revErr };

  const dcErr = await releaseDc(sb, dcId);
  if (dcErr) return { ok: false, error: dcErr };

  // Keep the header so the code survives; clear the stale snapshot and
  // park it as draft until the corrected entry is saved.
  const { error: upErr } = await sb
    .from('fabric_receipt')
    .update({ status: 'draft', stock_snapshot: null })
    .eq('id', receiptId);
  if (upErr) return { ok: false, error: `Could not mark receipt as draft: ${upErr.message}` };

  revalidatePath('/app/jobwork/fabric-receipt');
  revalidatePath('/app/jobwork');
  return { ok: true, dc_id: dcId ?? undefined };
}

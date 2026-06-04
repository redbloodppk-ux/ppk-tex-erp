'use server';
/**
 * Server actions for the Ledger list page.
 *
 * deleteLedger(id) — tries a hard DELETE first. If the ledger is
 * referenced by another row (customer.ledger_id, jobwork_party.ledger_id,
 * payment.ledger_id, invoice.ledger_id, etc.) the FK constraint blocks
 * the delete and we fall back to a soft delete (active=false) so the
 * ledger disappears from active lists without breaking history.
 */
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface DeleteLedgerResult {
  ok: boolean;
  soft_deleted: boolean;
  error?: string;
}

export async function deleteLedger(id: number): Promise<DeleteLedgerResult> {
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, soft_deleted: false, error: 'Invalid ledger id.' };
  }
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Attempt a hard delete first.
  const { error: hardErr } = await sb.from('ledger').delete().eq('id', id);
  if (!hardErr) {
    revalidatePath('/app/ledgers');
    return { ok: true, soft_deleted: false };
  }

  // Foreign-key violation -> fall back to a soft delete (active = false).
  const fkViolation = hardErr.code === '23503' || /foreign key/i.test(hardErr.message ?? '');
  if (fkViolation) {
    const { error: softErr } = await sb.from('ledger').update({ active: false }).eq('id', id);
    if (softErr) {
      return { ok: false, soft_deleted: false, error: softErr.message };
    }
    revalidatePath('/app/ledgers');
    return { ok: true, soft_deleted: true };
  }

  return { ok: false, soft_deleted: false, error: hardErr.message };
}

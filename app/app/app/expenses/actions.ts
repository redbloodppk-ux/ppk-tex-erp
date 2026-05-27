'use server';
/**
 * Server actions for the cash-expense register.
 */
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function deleteExpenseEntry(
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // expense_entry is from migration 035 — types not regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('expense_entry').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/app/expenses');
  return { ok: true };
}

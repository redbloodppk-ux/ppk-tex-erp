'use server';
/**
 * Employee loan server actions — delete (and a small revalidate after
 * inserts/updates from the client form).
 *
 * RLS enforces who can write; we just call Supabase and bubble any error
 * back to the client.
 */
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function deleteEmployeeLoan(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // employee_loan was added in migration 219 — types not yet regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('employee_loan').delete().eq('id', id);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/app/loans');
  return { ok: true };
}

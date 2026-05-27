'use server';
/**
 * Wage entry server actions — delete (and a small revalidate helper after
 * inserts/updates from client forms).
 *
 * RLS already enforces who can write; we just call Supabase and bubble any
 * error back to the client form.
 */
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function deleteWageEntry(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  // wage_entry was added in migration 031 — types not yet regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('wage_entry').delete().eq('id', id);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/app/wages');
  return { ok: true };
}

/**
 * Tiny helper used by Settings → Users pages and actions to gate access
 * to the owner role only. Returns the calling app_user row on success;
 * throws an Error on failure that the caller can translate to a 403 or
 * a redirect.
 *
 * Why server-side: client UIs can hide buttons, but only a server check
 * stops a hand-crafted POST. Every server action that mutates app_user
 * MUST call this first.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OwnerCheckResult {
  userId: string;
  email: string;
  fullName: string;
  role: string;
}

export class NotOwnerError extends Error {
  constructor(message = 'This page is restricted to the owner role.') {
    super(message);
    this.name = 'NotOwnerError';
  }
}

export async function requireOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
): Promise<OwnerCheckResult> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new NotOwnerError('Not signed in.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: row } = await sb
    .from('app_user')
    .select('id, email, full_name, role')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (!row) throw new NotOwnerError('No app_user row for current session.');
  if (row.role !== 'owner') throw new NotOwnerError();
  return {
    userId: row.id as string,
    email: row.email as string,
    fullName: row.full_name as string,
    role: row.role as string,
  };
}

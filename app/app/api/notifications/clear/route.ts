/**
 * POST /api/notifications/clear — "Clear all" for the derived feed.
 *
 * Upserts the caller's notification_clear marker to now(). Everything
 * with occurred_at on or before this moment disappears from the feed;
 * new events appear again as they happen.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { error } = await sb
    .from('notification_clear')
    .upsert({ user_id: auth.user.id, cleared_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

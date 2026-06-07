/**
 * GET /api/notifications/count — CORR-H6
 *
 * Tiny endpoint the NotificationBell polls every 60 s. Returns just the
 * total and the worst severity so the bell can pick the dot colour
 * without us shipping every notification body on every poll.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchNotificationCount } from '@/lib/notifications/source';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) {
    return NextResponse.json({ total: 0, worstSeverity: null }, { status: 200 });
  }
  const result = await fetchNotificationCount(supabase);
  return NextResponse.json(result, {
    headers: {
      // Don't let intermediate caches hold this — the count moves with
      // every approval / stock movement.
      'Cache-Control': 'no-store',
    },
  });
}

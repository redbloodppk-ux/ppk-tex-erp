/**
 * GET /api/notifications — CORR-H6
 *
 * Returns the full feed (count + items) for the bell's dropdown and
 * the /app/notifications full-page list. Both share this endpoint to
 * keep the source-of-truth in one place.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchNotifications } from '@/lib/notifications/source';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) {
    return NextResponse.json(
      { total: 0, worstSeverity: null, items: [] },
      { status: 200 },
    );
  }
  const feed = await fetchNotifications(supabase);
  return NextResponse.json(feed, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

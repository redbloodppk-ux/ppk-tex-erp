/**
 * GET /app/api/widget/status
 *
 * The only thing the iPhone home-screen widget can reach.
 *
 * PPK, 2026-09-16, after weighing what it means to keep a key on a phone:
 * "yes go head without cash".
 *
 * WHAT IT RETURNS
 * Looms running, the last logged day's metres, and which reminders are due.
 * That is the whole surface. No cash, no balances, no party names, no
 * invoice numbers, no amounts. The shape is fixed by fn_widget_status
 * (migration 302) rather than assembled here, so widening it takes a
 * migration and a conversation, not an edit to a route file.
 *
 * HOW IT IS GUARDED
 *  - A bearer token in the Authorization header, compared in constant time.
 *    In the header rather than the query string so it stays out of browser
 *    history, proxy logs and Vercel's request log.
 *  - fn_widget_status is granted to service_role ONLY. The anon key ships in
 *    every browser bundle, so a function anon could call would make the
 *    token decorative. This route reaches Postgres as service_role and is
 *    the only path in.
 *  - No token configured means the route is off, not open. A deployment
 *    that forgets the env var serves 503, never data.
 *  - noindex and no-store, so nothing caches a copy at the edge.
 *
 * Rotating the key: change WIDGET_API_TOKEN in Vercel and redeploy. Every
 * phone holding the old one stops working immediately.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Constant-time compare that does not leak length through early return. */
function tokenMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Still burn a comparison so a wrong-length guess costs the same as a
    // wrong-value one.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

const DENY = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } as const;

export async function GET(req: Request): Promise<NextResponse> {
  const expected = process.env.WIDGET_API_TOKEN;
  if (!expected || expected.length < 20) {
    return NextResponse.json(
      { error: 'Widget feed is not configured.' },
      { status: 503, headers: DENY },
    );
  }

  const header = req.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!supplied || !tokenMatches(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: DENY });
  }

  // createServiceClient builds a client either way, and a missing key would
  // fail later as a confusing auth error. Check it here and say so plainly.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'Widget feed is not configured.' },
      { status: 503, headers: DENY },
    );
  }

  try {
    const sb = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (sb as any).rpc('fn_widget_status');
    if (error) {
      // The message could name tables; the phone gets a flat failure.
      console.error('widget status rpc failed', error.message);
      return NextResponse.json({ error: 'Unavailable' }, { status: 502, headers: DENY });
    }
    return NextResponse.json(data, { headers: DENY });
  } catch (e) {
    console.error('widget status failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Unavailable' }, { status: 502, headers: DENY });
  }
}

// Middleware: refresh Supabase session on every request.
// Prevents user from being silently logged out as JWT expires.
//
// Also enforces a per-user/per-IP write rate limit (CORR-H4). The
// limiter only sees POST/PUT/PATCH/DELETE — GET stays uncapped so
// browsing the app feels snappy. Exceeded requests get HTTP 429 with
// a Retry-After header so the browser can back off automatically.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { consume as rateLimitConsume } from '@/lib/rate-limit';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Resolve the rate-limit key for a request. Prefer the signed-in
 *  user's auth uid (from the sb-* cookie); fall back to the client
 *  IP for unauthenticated bursts (e.g. someone hammering /login). */
function rateLimitKey(request: NextRequest, userId: string | null): string {
  if (userId) return `u:${userId}`;
  const xff = request.headers.get('x-forwarded-for');
  // x-forwarded-for is a CSV: "<client>, <proxy1>, <proxy2>".
  const ip = xff?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'anonymous';
  return `ip:${ip}`;
}

/** Build a 429 response with explanatory body + standard headers. */
function tooManyRequestsResponse(retryAfterSec: number): NextResponse {
  return new NextResponse(
    JSON.stringify({
      error: 'Too many requests',
      message: 'You\u2019re saving faster than the safety throttle allows. Wait a few seconds and try again.',
      retry_after_sec: retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSec),
        // Make sure intermediate caches don't pin the 429.
        'Cache-Control': 'no-store',
      },
    },
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touch the session — refreshes it if needed.
  const { data: { user } } = await supabase.auth.getUser();

  // ── CORR-H4: write rate limit ─────────────────────────────────────
  // Apply ONLY to mutating verbs. Skip OPTIONS/GET/HEAD so the limiter
  // can't interfere with navigation. Skip Next's own internals (already
  // excluded by the middleware matcher, but belt-and-braces here too).
  if (MUTATING_METHODS.has(request.method)) {
    const key = rateLimitKey(request, user?.id ?? null);
    const result = rateLimitConsume(key);
    if (!result.ok) {
      return tooManyRequestsResponse(result.retryAfterSec);
    }
    // Surface the bucket state on every write so devtools / curl can
    // see how close we are to the limit. Mirrors GitHub's convention.
    supabaseResponse.headers.set('X-RateLimit-Limit',     String(result.limit));
    supabaseResponse.headers.set('X-RateLimit-Remaining', String(result.remaining));
    supabaseResponse.headers.set('X-RateLimit-Burst',     String(result.burst));
  }

  // Protect /app/* routes — redirect to /login if not authenticated.
  const url = request.nextUrl.clone();
  const isProtected = url.pathname.startsWith('/app') || url.pathname === '/';
  const isAuthPage = url.pathname.startsWith('/login') || url.pathname.startsWith('/signup');

  if (isProtected && !user) {
    url.pathname = '/login';
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && user) {
    url.pathname = '/app/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

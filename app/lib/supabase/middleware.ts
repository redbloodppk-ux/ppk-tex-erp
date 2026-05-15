// Middleware: refresh Supabase session on every request.
// Prevents user from being silently logged out as JWT expires.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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

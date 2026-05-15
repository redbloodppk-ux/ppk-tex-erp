// Handles redirects from Supabase Auth (magic links, email-confirmation links).
// Supabase sends the user to /auth/callback?code=<one-time-code>; we exchange
// that for a session cookie, then redirect into the app.
//
// Without this route, clicking a magic link does nothing — the middleware
// sees no session and bounces back to /login.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/app/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // Fall through to /login with the error message.
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  // No code at all → something went wrong upstream.
  return NextResponse.redirect(`${origin}/login?error=missing_code`);
}

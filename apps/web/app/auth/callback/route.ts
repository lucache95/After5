import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// OAuth + magic link land here. Exchange the `code` query param for a
// session cookie, then redirect to ?next=... (defaults to /account).
// Supabase's helper sets the session cookies on `cookies()` — middleware
// will refresh them on subsequent requests.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/account';

  if (!code) {
    console.error('[auth/callback] no code in query', Object.fromEntries(searchParams.entries()));
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession failed', {
      message: error.message,
      status: error.status,
      name: error.name,
    });
    // Surface the error name/code in the redirect so we can debug
    // without having to rummage through server logs.
    const reason = encodeURIComponent(error.message || 'exchange_failed');
    return NextResponse.redirect(`${origin}/login?error=auth&reason=${reason}`);
  }

  if (!data?.session) {
    console.error('[auth/callback] no session returned despite no error');
    return NextResponse.redirect(`${origin}/login?error=no_session`);
  }

  // Path-only redirect to avoid open-redirect via crafted next param.
  const safeNext = next.startsWith('/') ? next : '/account';
  return NextResponse.redirect(`${origin}${safeNext}`);
}

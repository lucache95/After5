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

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Path-only redirect to avoid open-redirect via crafted next param.
      const safeNext = next.startsWith('/') ? next : '/account';
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}

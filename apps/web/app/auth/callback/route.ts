import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// OAuth + magic link land here. Exchange the `code` query param for a
// session cookie, then redirect to ?next=... (defaults to /account).
// Supabase's helper sets the session cookies on `cookies()` — middleware
// will refresh them on subsequent requests.
//
// Side effect: upsert a subscribers row (source='auth_signup') for every
// successful sign-in so the live "X claimed of 100" counter on the
// homepage stays in sync with reality. Email is the conflict key, so
// this is safe to run on every callback (existing rows just get touched).

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

  // Mirror the auth user into subscribers so social-proof counts include
  // OAuth/magic-link signups. Best-effort — log + continue if it fails.
  await mirrorToSubscribers(data.session.user).catch((err) => {
    console.error('[auth/callback] mirrorToSubscribers failed', err);
  });

  // Path-only redirect to avoid open-redirect via crafted next param.
  const safeNext = next.startsWith('/') ? next : '/account';
  return NextResponse.redirect(`${origin}${safeNext}`);
}

interface SessionUser {
  email?: string | null;
  user_metadata?: { full_name?: string; name?: string; first_name?: string } | null;
}

async function mirrorToSubscribers(user: SessionUser) {
  const email = user.email?.toLowerCase().trim();
  if (!email) return;

  const meta = user.user_metadata ?? {};
  const firstName =
    meta.first_name ||
    (meta.full_name?.split(' ')[0] ?? '') ||
    (meta.name?.split(' ')[0] ?? '') ||
    null;

  const admin = createAdminClient();
  // Schema unique key is (email, source), so naive upsert would create a
  // duplicate row for someone who first signed up via plan_gate then
  // signed in via Google. Check email existence across all sources first.
  const { data: existing } = await admin
    .from('subscribers')
    .select('id, first_name')
    .eq('email', email)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Backfill first_name if it was missing (e.g. early_access form
    // didn't collect it but Google OAuth gave us one).
    if (!existing.first_name && firstName) {
      await admin.from('subscribers').update({ first_name: firstName }).eq('id', existing.id);
    }
    return;
  }

  const { error } = await admin
    .from('subscribers')
    .insert({ email, first_name: firstName, source: 'auth_signup' });
  if (error) {
    console.error('[auth/callback] subscribers insert error', error);
  }
}

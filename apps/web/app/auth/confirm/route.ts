import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';

// Token-hash email confirm — the @supabase/ssr server-side verifyOtp pattern.
// Complements /auth/callback (which handles the PKCE `?code` flow). This path
// handles links that carry a `token_hash` instead of a PKCE code: admin-
// generated magic links (admin.generateLink) and email links of the
// {token_hash}+{type} shape. verifyOtp sets the session cookies via the
// @supabase/ssr server client, same as exchangeCodeForSession does.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/home';
  const safeNext = next.startsWith('/') ? next : '/home';

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) {
    console.error('[auth/confirm] verifyOtp failed', { message: error.message, status: error.status });
    const reason = encodeURIComponent(error.message || 'verify_failed');
    return NextResponse.redirect(`${origin}/login?error=auth&reason=${reason}`);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}

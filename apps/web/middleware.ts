import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

// Refreshes the Supabase auth session on every request and writes any
// rotated cookies back onto the outgoing response. Required for SSR auth
// — without this, the cookie that pages read can be expired by the time
// they render.
//
// Public routes pass straight through; we don't enforce auth here. Page-
// or route-level guards (e.g. /admin/*, /account) handle redirects.

export async function middleware(request: NextRequest) {
  // Canonical domain: redirect www → apex so auth cookies (PKCE verifier)
  // always live on the same origin as the OAuth callback.
  const host = request.headers.get('host') ?? '';
  if (host.startsWith('www.')) {
    const url = request.nextUrl.clone();
    url.host = host.replace('www.', '');
    return NextResponse.redirect(url, 301);
  }

  // Auth code rescue: if Supabase falls back to Site URL and lands the
  // OAuth/magic-link `?code=` on a page that doesn't know how to exchange
  // it, forward to /auth/callback so we still capture the session. Only
  // triggers on pages that aren't already the callback handler.
  const code = request.nextUrl.searchParams.get('code');
  if (code && !request.nextUrl.pathname.startsWith('/auth/callback')) {
    const callbackUrl = new URL('/auth/callback', request.url);
    callbackUrl.searchParams.set('code', code);
    const next = request.nextUrl.searchParams.get('next');
    if (next) callbackUrl.searchParams.set('next', next);
    return NextResponse.redirect(callbackUrl);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }: CookieToSet) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Run on every page/route except static assets, image optimizer, favicon
    // and the auth callback (which manages its own response — running the
    // session-refresh middleware here rebuilds the response and drops the
    // PKCE code-verifier / session cookies the callback is setting).
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};

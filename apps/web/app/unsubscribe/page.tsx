// /unsubscribe — one-click opt-out from weekly broadcasts. Token in the
// query string is HMAC-signed; verifying it lets us flip the flag without
// asking the user to log in.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { verifyUnsubToken } from '@/lib/email/unsubscribe-token';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function UnsubscribePage(props: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await props.searchParams;
  const email = token ? verifyUnsubToken(token) : null;

  let status: 'ok' | 'invalid' | 'already_off' = 'invalid';

  if (email) {
    const admin = createAdminClient();
    // Cast: generated DB types don't yet include email_opt_out column.
    const { data: existing } = await (admin as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            limit: (n: number) => {
              maybeSingle: () => Promise<{ data: { email_opt_out: boolean } | null }>;
            };
          };
        };
      };
    })
      .from('subscribers')
      .select('email_opt_out')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (existing?.email_opt_out) {
      status = 'already_off';
    } else {
      await (admin as unknown as {
        from: (t: string) => {
          update: (p: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<unknown>;
          };
        };
      })
        .from('subscribers')
        .update({ email_opt_out: true, opted_out_at: new Date().toISOString() })
        .eq('email', email);
      status = 'ok';
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-gradient-to-br from-amber-200/45 via-orange-200/25 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-gradient-to-tl from-rose-200/45 via-amber-100/25 to-transparent blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-xl items-center px-6 py-16 md:px-10">
        <div className="w-full text-center">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Unsubscribe
          </p>

          {status === 'ok' && (
            <>
              <h1 className="font-display text-4xl font-bold leading-tight tracking-[-0.02em] text-text md:text-5xl">
                You&apos;re <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>off</em> the list.
              </h1>
              <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-secondary md:text-lg">
                No more weekly notes. You&apos;ll still get account-related emails (sign-in links, etc.) since those aren&apos;t marketing.
              </p>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted">
                Removed: <span className="text-text">{email}</span>
              </p>
            </>
          )}

          {status === 'already_off' && (
            <>
              <h1 className="font-display text-4xl font-bold leading-tight tracking-[-0.02em] text-text md:text-5xl">
                Already done.
              </h1>
              <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-secondary md:text-lg">
                You&apos;re not on the weekly list. If you keep getting emails, hit
                {' '}
                <Link href="/tell-us" className="text-accent underline decoration-accent/40 underline-offset-[4px]">tell-us</Link>
                {' '}and I&apos;ll dig in.
              </p>
            </>
          )}

          {status === 'invalid' && (
            <>
              <h1 className="font-display text-4xl font-bold leading-tight tracking-[-0.02em] text-text md:text-5xl">
                Bad link.
              </h1>
              <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-secondary md:text-lg">
                That unsubscribe link doesn&apos;t look right — it might be cut off or expired.
                Email{' '}
                <a href="mailto:hello@tryafter5.app" className="text-accent underline decoration-accent/40 underline-offset-[4px]">hello@tryafter5.app</a>
                {' '}and I&apos;ll remove you manually.
              </p>
            </>
          )}

          <div className="mt-10 flex justify-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-pill bg-text px-6 py-3 text-sm font-medium text-background transition-transform hover:-translate-y-0.5"
            >
              Back to After5
              <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

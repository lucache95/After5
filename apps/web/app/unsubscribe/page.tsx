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
    <main className="min-h-dvh bg-shell-base">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] items-center px-6 py-16">
        <div className="w-full text-center">
          <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
            unsubscribe
          </p>

          {status === 'ok' && (
            <>
              <h1 className="font-heading text-4xl lowercase leading-tight text-shell-ink md:text-5xl">
                you&apos;re off the list
              </h1>
              <p className="mx-auto mt-5 max-w-[420px] font-body text-[15px] leading-relaxed text-shell-ink/70">
                no more weekly notes. you&apos;ll still get account emails (sign-in links and the like) since those aren&apos;t marketing.
              </p>
              <p className="mx-auto mt-3 max-w-[420px] font-body text-sm text-shell-ink/50">
                removed: <span className="text-shell-ink">{email}</span>
              </p>
            </>
          )}

          {status === 'already_off' && (
            <>
              <h1 className="font-heading text-4xl lowercase leading-tight text-shell-ink md:text-5xl">
                already done
              </h1>
              <p className="mx-auto mt-5 max-w-[420px] font-body text-[15px] leading-relaxed text-shell-ink/70">
                you&apos;re not on the weekly list. if you keep getting emails, hit
                {' '}
                <Link href="/tell-us" className="text-shell-accent underline decoration-shell-accent/40 underline-offset-4">tell-us</Link>
                {' '}and i&apos;ll dig in.
              </p>
            </>
          )}

          {status === 'invalid' && (
            <>
              <h1 className="font-heading text-4xl lowercase leading-tight text-shell-ink md:text-5xl">
                bad link
              </h1>
              <p className="mx-auto mt-5 max-w-[420px] font-body text-[15px] leading-relaxed text-shell-ink/70">
                that unsubscribe link doesn&apos;t look right — it might be cut off or expired. email{' '}
                <a href="mailto:hello@tryafter5.app" className="text-shell-accent underline decoration-shell-accent/40 underline-offset-4">hello@tryafter5.app</a>
                {' '}and i&apos;ll remove you by hand.
              </p>
            </>
          )}

          <div className="mt-9 flex justify-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full bg-shell-accent px-6 py-3 font-body text-sm font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95"
            >
              back to after5
              <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

// /api/cron/onboarding-drip — fires daily from Vercel Cron (see vercel.json).
// Advances the 5-step onboarding drip: for each step S (day-offset D), find
// signed-up users whose welcome went out >= D days ago and who are at step S-1,
// send step S, and advance drip_step ONLY on a successful send (a failure leaves
// the step so the next daily run retries). At most ONE step per user per run.
//
// Audience: subscribers with welcome_sent_at set (real app signups), opted in,
// and source <> 'waitlist' (waitlisters can't use app features yet — they get
// the separate waitlist flow, not this drip).
//
// Auth: Authorization: Bearer ${CRON_SECRET} OR ?secret=. ?dry_run=true counts
// without sending.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { DRIP_STEPS, renderDripStep } from '@/lib/email/onboarding-drip';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Candidate {
  id: string;
  email: string | null;
  first_name: string | null;
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });

  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const querySecret = url.searchParams.get('secret');
  if (authHeader !== `Bearer ${expected}` && querySecret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dryRun = url.searchParams.get('dry_run') === 'true';

  // Loose client: generated types don't include the drip columns.
  const admin = createAdminClient() as unknown as {
    from: (t: string) => any;
  };

  const now = new Date();
  const processed = new Set<string>(); // emails advanced this run → one step per user per run
  const perStep: Record<string, number> = {};
  let sent = 0;
  let failed = 0;

  for (let s = 1; s <= DRIP_STEPS.length; s++) {
    const def = DRIP_STEPS[s - 1];
    const cutoff = new Date(now.getTime() - def.day * 86_400_000).toISOString();

    const { data, error } = await admin.from('subscribers')
      .select('id, email, first_name')
      .eq('drip_step', s - 1)
      .eq('email_opt_out', false)
      .neq('source', 'waitlist')
      .not('welcome_sent_at', 'is', null)
      .lte('welcome_sent_at', cutoff);

    if (error) {
      return NextResponse.json({ error: 'query failed', step: s, details: error.message }, { status: 500 });
    }

    const candidates: Candidate[] = (data ?? []).filter(
      (c: Candidate) => c.email && !processed.has(c.email.toLowerCase()),
    );
    perStep[`step_${s}`] = candidates.length;

    if (dryRun) {
      for (const c of candidates) processed.add(c.email!.toLowerCase());
      continue;
    }

    for (const c of candidates) {
      const email = c.email!.toLowerCase();
      const rendered = renderDripStep(s, { email, firstName: c.first_name });
      if (!rendered) continue;

      const ok = await sendEmail({ to: email, subject: rendered.subject, html: rendered.html, text: rendered.text, tag: DRIP_STEPS[s - 1].tag });
      if (ok) {
        await admin.from('subscribers').update({ drip_step: s, drip_last_sent_at: now.toISOString() }).eq('id', c.id);
        processed.add(email);
        sent += 1;
      } else {
        failed += 1;
      }
      await new Promise((res) => setTimeout(res, 110)); // pace Resend
    }
  }

  return NextResponse.json({ dry_run: dryRun, sent, failed, per_step: perStep });
}

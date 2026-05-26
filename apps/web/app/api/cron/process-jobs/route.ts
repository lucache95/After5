// apps/web/app/api/cron/process-jobs/route.ts
// /api/cron/process-jobs — fires from Vercel Cron every minute (see vercel.json).
// Thin proxy: authenticates the cron call, then invokes the process-jobs Edge
// Function. Auth: Authorization: Bearer ${CRON_SECRET} OR ?secret=. ?dry_run=true skips.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });

  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const querySecret = url.searchParams.get('secret');
  const ok = authHeader === `Bearer ${expected}` || querySecret === expected;
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (url.searchParams.get('dry_run') === 'true') return NextResponse.json({ dry_run: true, invoked: false });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const runnerSecret = process.env.JOBS_RUNNER_SECRET;
  if (!supabaseUrl || !runnerSecret) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_SUPABASE_URL or JOBS_RUNNER_SECRET missing' }, { status: 500 });
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/process-jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jobs-secret': runnerSecret },
    body: '{}',
  });
  const summary = await res.json().catch(() => ({}));
  return NextResponse.json({ invoked: true, status: res.status, summary }, { status: res.ok ? 200 : 502 });
}

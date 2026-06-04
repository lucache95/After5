// /api/cron/close-loop — fires from Vercel Cron every 15 min (see vercel.json).
// Invokes the service-role sweep_loop_terminus() RPC, which (a) flips past-dated
// active locks to 'completed' (and their date_instances to 'completed', enqueuing
// the rating_window job), and (b) sweeps past-dated unmatched 'seeking' nights to
// 'expired'. This is the loop terminus (E5 / D-01 / D-02): the loop must always
// terminate and never trap the user.
//
// Why a dedicated cron route (not a job_type): the sweep is a periodic, time-driven
// batch with no per-entity timer — a cron route invoking the sweep RPC directly is
// the simplest fit and avoids adding a new job_type enum value (Pattern 4, research).
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}` (Vercel sends this on cron
// invoke) OR ?secret=... query param. Reuses CRON_SECRET — no new env var. Dry-run:
// ?dry_run=true authorizes and reports without invoking the sweep.
//
// sweep_loop_terminus is idempotent + stale-tolerant + never-raises, so re-invocation
// (overlapping ticks, retries) is safe.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  // ── Auth (copied verbatim from offer-expiring) ─────────
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const querySecret = url.searchParams.get('secret');
  const ok = authHeader === `Bearer ${expected}` || querySecret === expected;
  if (!ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = url.searchParams.get('dry_run') === 'true';
  if (dryRun) {
    return NextResponse.json({ dry_run: true, swept: false });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return NextResponse.json(
      { error: 'admin client unavailable', details: String(err) },
      { status: 500 },
    );
  }

  // sweep_loop_terminus returns the count of locks completed (and rating windows opened).
  const { data, error } = await admin.rpc('sweep_loop_terminus');
  if (error) {
    return NextResponse.json({ error: 'sweep failed', details: error.message }, { status: 500 });
  }

  return NextResponse.json({ swept: true, completed: data ?? 0 });
}

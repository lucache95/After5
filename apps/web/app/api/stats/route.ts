// Live social-proof stats used by the early-access banner + signup toast.
// Two kinds of data:
//   1. Aggregate count of subscribers (for "X of 100 spots claimed")
//   2. Recent 10 signups (first_name + city + created_at) for rotating toast
//
// Cached for 60s via fetch-revalidate so we don't hammer the DB on every
// page load. Counter updates within a minute of a real signup, which is
// plenty fast for the UI effect.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// force-dynamic: this route uses the service-role admin client, so it must NOT be
// statically prerendered at build time (that requires SUPABASE_SECRET_KEY, which CI
// doesn't have — it was failing the GitHub Actions `static-checks` build). Runs
// per-request instead; the UI effect tolerates that fine.
export const dynamic = 'force-dynamic';

const EARLY_ACCESS_CAP = 100;

interface RecentSignup {
  first_name: string;
  city: string | null;
  created_at: string;
}

// Social proof is decorative — this route must never 500 the pages that poll
// it. Anything that goes wrong (no service key in this environment, missing
// table on a fresh local stack, network failure) degrades to this.
const EMPTY = {
  claimed: 0,
  remaining: EARLY_ACCESS_CAP,
  cap: EARLY_ACCESS_CAP,
  recent: [] as RecentSignup[],
};

export async function GET() {
  try {
    // Service-role client — subscribers RLS only allows INSERT for anon, so
    // a user-context client returns 0 rows here. We only return non-PII
    // fields (first_name, city, created_at) to the public — emails stay on
    // the server. Throws when SUPABASE_SECRET_KEY is unset/empty (e.g. a dev
    // server started against the local stack without the secret exported) —
    // that used to bubble up as a 500 on every page mounting the banner.
    const supabase = createAdminClient();

    // Aggregate count — every subscriber row is a real signup now (seed_demo
    // rows were deleted on 2026-04-22).
    const { count, error: countError } = await supabase
      .from('subscribers')
      .select('*', { count: 'exact', head: true });
    if (countError) {
      console.warn('[api/stats] subscriber count failed', countError.message);
      return NextResponse.json(EMPTY);
    }

    const claimed = count ?? 0;
    const remaining = Math.max(0, EARLY_ACCESS_CAP - claimed);

    // Recent 10 with first_name — used for the rotating toast. Exclude
    // rows without first_name because they'd render oddly ("from Glenmore
    // just claimed"). A failure here still returns the count.
    const { data: recentRaw, error: recentError } = await supabase
      .from('subscribers')
      .select('first_name, city, created_at')
      .not('first_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);
    if (recentError) console.warn('[api/stats] recent signups failed', recentError.message);

    const recent: RecentSignup[] = (recentRaw ?? [])
      .filter((r): r is RecentSignup => typeof r.first_name === 'string' && r.first_name.length > 0)
      .map((r) => ({
        first_name: r.first_name,
        city: r.city,
        created_at: r.created_at,
      }));

    return NextResponse.json({
      claimed,
      remaining,
      cap: EARLY_ACCESS_CAP,
      recent,
    });
  } catch (err) {
    console.warn('[api/stats] degraded to empty payload', err instanceof Error ? err.message : err);
    return NextResponse.json(EMPTY);
  }
}

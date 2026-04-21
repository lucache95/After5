// Live social-proof stats used by the early-access banner + signup toast.
// Two kinds of data:
//   1. Aggregate count of subscribers (for "X of 100 spots claimed")
//   2. Recent 10 signups (first_name + city + created_at) for rotating toast
//
// Cached for 60s via fetch-revalidate so we don't hammer the DB on every
// page load. Counter updates within a minute of a real signup, which is
// plenty fast for the UI effect.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const revalidate = 60;

const EARLY_ACCESS_CAP = 100;

interface RecentSignup {
  first_name: string;
  city: string | null;
  created_at: string;
}

export async function GET() {
  const supabase = await createClient();

  // Aggregate count — includes seed rows so the banner has a non-zero
  // figure at launch. Real signups land in the same table and bump it.
  const { count } = await supabase
    .from('subscribers')
    .select('*', { count: 'exact', head: true });

  const claimed = count ?? 0;
  const remaining = Math.max(0, EARLY_ACCESS_CAP - claimed);

  // Recent 10 with first_name — used for the rotating toast. Exclude
  // rows without first_name because they'd render oddly ("from Glenmore
  // just claimed").
  const { data: recentRaw } = await supabase
    .from('subscribers')
    .select('first_name, city, created_at')
    .not('first_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

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
}

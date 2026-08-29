// POST /api/ideas/[id]/vote — toggle the signed-in user's upvote on a public
// idea. Uses the user's session (not service-role) so auth.uid() resolves inside
// toggle_feature_vote, which also hard-checks the idea is public + dedupes via
// the unique constraint. Returns the new { voted, vote_count }.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: { voted: boolean; vote_count: number }[] | null; error: { message: string } | null }>;
  }).rpc('toggle_feature_vote', { p_feedback: id });

  if (error) return NextResponse.json({ error: 'vote_failed', details: error.message }, { status: 400 });
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ voted: row?.voted ?? false, vote_count: row?.vote_count ?? 0 });
}

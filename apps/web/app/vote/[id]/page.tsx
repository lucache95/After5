// Voting page — friends/partner open this URL, see the 3 plans, tap their
// favorite. Anonymous via a localStorage voter_token. Tally is visible
// inline so the planner can see in real time.

import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { VoteCards } from './VoteCards';

interface VoteSession {
  id: string;
  itinerary_ids: string[];
  created_at: string;
}

interface ItineraryRow {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
  cover_image_url: string | null;
}

interface VoteRow {
  itinerary_id: string;
  voter_name: string | null;
}

export default async function VotePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: session } = await (supabase
    .from('vote_sessions') as any)
    .select('id, itinerary_ids, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!session) notFound();
  const sess = session as VoteSession;

  const { data: itinsRaw } = await supabase
    .from('itineraries')
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops, cover_image_url')
    .in('id', sess.itinerary_ids);

  const itins = (itinsRaw ?? []) as ItineraryRow[];
  // Order to match the original session's itinerary_ids order.
  const ordered = sess.itinerary_ids
    .map((iid) => itins.find((i) => i.id === iid))
    .filter((x): x is ItineraryRow => Boolean(x));

  const { data: votesRaw } = await (supabase
    .from('plan_votes') as any)
    .select('itinerary_id, voter_name')
    .eq('session_id', sess.id);

  const votes = (votesRaw ?? []) as VoteRow[];
  const tally: Record<string, number> = {};
  for (const v of votes) tally[v.itinerary_id] = (tally[v.itinerary_id] ?? 0) + 1;
  const voterNames = votes
    .map((v) => v.voter_name)
    .filter((n): n is string => Boolean(n));

  return (
    <main className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-content items-center justify-between px-6 py-5 md:px-10">
          <a href="/" className="font-display text-xl font-semibold tracking-tight text-text">
            After5
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-content px-6 py-12 md:px-10 md:py-20">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Vote on a plan
        </p>
        <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
          Which one do you actually want to do?
        </h1>
        <p className="mt-4 max-w-prose text-base text-secondary md:text-lg">
          Someone shared three date plans with you. Tap the one you'd want to do —
          they'll see your vote on their end. {voterNames.length > 0 && (
            <span> Already voted: {Array.from(new Set(voterNames)).join(', ')}.</span>
          )}
        </p>

        <div className="mt-12">
          <VoteCards sessionId={sess.id} itineraries={ordered} initialTally={tally} />
        </div>
      </div>
    </main>
  );
}

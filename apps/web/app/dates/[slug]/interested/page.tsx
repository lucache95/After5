// apps/web/app/dates/[slug]/interested/page.tsx
// Server entry for the host interested-list (spec §4.1). Follows the 5a feed
// pattern: createClient() → getUser() → gate → fetch Tier-3 → props to the
// client child. Non-host → minimal 403 state; flag off → ComingSoonBanner.
// Candidate PII stays Tier-3 (first_name/age/clear_photo_url/city) read via the
// profiles_select_revealed RLS policy on the profiles table for
// shortlisted/interested candidates.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { InterestedList, type HostCandidate } from './InterestedList';

export const dynamic = 'force-dynamic';

function clampWindow(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 24;
  return Math.min(72, Math.max(12, Math.round(n)));
}

export default async function InterestedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Route segment is [slug] (shared with the planner itinerary route); here it carries the instance id.
  const { slug: instanceId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dates/${instanceId}/interested`);

  const { data: instance } = await supabase
    .from('date_instances').select('id, creator_id').eq('id', instanceId).maybeSingle();

  if (!instance || instance.creator_id !== user.id) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
        <div className="mx-auto max-w-[420px]">
          <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">not your date</h1>
          <p className="mt-4 font-body text-lg text-shell-ink/70">this list belongs to whoever posted the night.</p>
        </div>
      </main>
    );
  }

  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  const { data: windowRow } = await supabase
    .from('feature_config').select('value').eq('key', 'offer_window_hours').maybeSingle();
  const offerWindowHours = clampWindow(windowRow?.value);

  // Tier-3 join: queue_entries (RLS-scoped to creator) → revealed profile fields.
  // profiles_select_revealed is an RLS policy on profiles; the join uses the
  // canonical profiles FK. Columns projected stay at Tier-3 (first_name/age/city/
  // clear_photo_url) per spec §2.6 + the residual-column-leak mitigation note.
  const { data: queue } = await supabase
    .from('queue_entries')
    // Disambiguate the embed: queue_entries has TWO FKs to profiles (candidate_id + creator_id),
    // so an unhinted profiles embed errors with PGRST201. Pin the candidate FK explicitly.
    .select('candidate_id, status, rank, candidate:profiles!queue_entries_candidate_id_fkey(first_name, age, city, clear_photo_url)')
    .eq('date_instance_id', instanceId)
    .order('rank', { ascending: true, nullsFirst: false })
    .limit(60);

  const { data: offer } = await supabase
    .from('offers')
    .select('candidate_id, status')
    .eq('date_instance_id', instanceId)
    .eq('status', 'active')
    .maybeSingle();

  const candidates: HostCandidate[] = (queue ?? []).map((q) => {
    const c = (q.candidate ?? {}) as { first_name?: string | null; age?: number | null; city?: string | null; clear_photo_url?: string | null };
    return {
      candidate_id: q.candidate_id,
      status: q.status,
      rank: q.rank,
      first_name: c.first_name ?? 'someone',
      age: c.age ?? null,
      city: c.city ?? null,
      photo_url: c.clear_photo_url ?? null,
      // Eligibility flag is not cheaply available here; default true and let
      // P5002 at offer time handle the already-booked case (spec §4.2 fallback).
      can_enter_lock_flow: true,
    };
  });

  return (
    <InterestedList
      instanceId={instanceId}
      userId={user.id}
      offerWindowHours={offerWindowHours}
      activeOffer={offer ? { candidate_id: offer.candidate_id } : null}
      candidates={candidates}
    />
  );
}

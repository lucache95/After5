// apps/web/app/reciprocal/[pairId]/page.tsx
// Server entry for the reciprocal chooser (spec §4.5). getUser → load the pair
// (RLS self-read) → 403 if the user isn't a party → fetch both competing
// instances with itinerary title/cover → ReciprocalChooser. The pair row carries
// VERIFIED against live schema: reciprocal_pairs carries ONLY low_user/high_user
// (no instance columns). The two competing instances are derived from the two
// ACTIVE offers between the pair (both directions); match_resolve_reciprocal
// validates the chosen instance is owned by one of the pair.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ReciprocalChooser, type ReciprocalInstance } from './ReciprocalChooser';

export const dynamic = 'force-dynamic';

export default async function ReciprocalPage({
  params,
}: {
  params: Promise<{ pairId: string }>;
}) {
  const { pairId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/reciprocal/${pairId}`);

  const { data: pair } = await supabase
    .from('reciprocal_pairs')
    .select('id, high_user, low_user, status')
    .eq('id', pairId)
    .maybeSingle();

  const party = pair && (pair.high_user === user.id || pair.low_user === user.id);
  if (!pair || !party) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
        <div className="mx-auto max-w-[420px]">
          <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">not your decision</h1>
          <p className="mt-4 font-body text-lg text-shell-ink/70">this reciprocal choice belongs to someone else.</p>
        </div>
      </main>
    );
  }

  // Both active offers between the two users (RLS lets either party read both,
  // since each is creator on one and candidate on the other).
  const lo = pair.low_user;
  const hi = pair.high_user;
  const { data: offersRaw } = await supabase
    .from('offers')
    .select(
      'id, date_instance_id, creator_id, candidate_id, status, ' +
      'date_instance:date_instances(id, starts_at, creator_id, itinerary:itineraries(title, cover_image_url))',
    )
    .eq('status', 'active')
    .or(`and(creator_id.eq.${lo},candidate_id.eq.${hi}),and(creator_id.eq.${hi},candidate_id.eq.${lo})`);

  // Cast to a concrete type: Supabase join syntax produces a union with
  // GenericStringError that TypeScript cannot narrow automatically.
  type OfferRow = {
    id: string;
    date_instance_id: string;
    creator_id: string;
    candidate_id: string;
    status: string;
    date_instance: { id: string; starts_at: string | null; creator_id: string; itinerary: { title: string | null; cover_image_url: string | null } | null } | null;
  };
  const offers = (offersRaw ?? []) as unknown as OfferRow[];

  // A reciprocal CHOICE needs two distinct live instances. If fewer remain
  // (one expired/resolved), the pair is effectively stale — mirror P5009 copy.
  const distinct = Array.from(new Map(offers.map((o) => [o.date_instance_id, o])).values());
  if (distinct.length < 2) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
        <div className="mx-auto max-w-[420px]">
          <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">nothing to choose</h1>
          <p className="mt-4 font-body text-lg text-shell-ink/70">one of these dates already moved on.</p>
        </div>
      </main>
    );
  }

  const toInstance = (o: OfferRow): ReciprocalInstance => {
    const di = o.date_instance ?? { starts_at: null, itinerary: null };
    const it = di.itinerary ?? { title: null, cover_image_url: null };
    return {
      id: o.date_instance_id,
      title: it.title ?? 'a night out',
      starts_at: di.starts_at ?? new Date().toISOString(),
      cover_image_url: it.cover_image_url ?? null,
    };
  };

  // Deterministic A/B: the viewer's own instance (they created) first.
  const mine = distinct.find((o) => o.creator_id === user.id) ?? distinct[0];
  const theirs = distinct.find((o) => o.id !== mine.id) ?? distinct[1];

  return (
    <ReciprocalChooser
      pairId={pairId}
      instanceA={toInstance(mine)}
      instanceB={toInstance(theirs)}
    />
  );
}

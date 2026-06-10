// apps/web/app/offers/[offerId]/page.tsx
// Server entry for the candidate's offer screen (spec §4.2). Mirrors the host
// interested page: createClient() → getUser() → flag → recipient check → own
// account gate → render the client child. Every read runs under the candidate's
// SSR (RLS-bound) client:
//   - offers: offers_party_read lets the candidate read an offer addressed to them.
//   - profiles (host): match_reveal_allowed exposes the host's Tier-3 reveal.
//   - date_instances: the offer-recipient read policy (migration 127500) lets the
//     candidate read the offered night; if it's still hidden the embed comes back
//     null and OfferDetail degrades to "details unlock when you accept".
//   - feature_config: client-readable (migration 127300).
// The offers embeds are FK-hinted (bug class 3): offers has two FKs to profiles
// (creator_id + candidate_id) and one to date_instances, so an unhinted embed
// errors PGRST201. instanceId comes from the offers.date_instance_id COLUMN (always
// readable) so withdraw works even when the embedded instance row is RLS-hidden.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { signBlurredUrls } from '@/lib/after5/photos';
import { normalizeNightDetailStops, type NightDetailNight } from '@after5/api-client';
import { OfferDetail } from './OfferDetail';
import { AccountGate } from './AccountGate';
import { deriveGateReason } from './gate';

export const dynamic = 'force-dynamic';

export default async function OfferPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const { offerId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/offers/${offerId}`);

  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  const { data: offer } = await supabase
    .from('offers')
    .select(`id, status, expires_at, candidate_id, creator_id, date_instance_id,
      host:profiles!offers_creator_id_fkey ( first_name, age, city, blurred_photo_url ),
      instance:date_instances!offers_date_instance_id_fkey ( starts_at, itinerary_id )`)
    .eq('id', offerId)
    .maybeSingle();

  if (!offer || offer.candidate_id !== user.id) {
    return (
      <>
        <DeepRouteHeader backHref="/inbox" backLabel="back to inbox" />
        <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
          <div className="mx-auto max-w-[420px]">
            <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">not your offer</h1>
            <p className="mt-4 font-body text-lg text-shell-ink/70">this one was sent to someone else.</p>
          </div>
        </main>
      </>
    );
  }

  const { data: me } = await supabase
    .from('profiles')
    .select('dating_enabled, verification, standing, account_state')
    .eq('id', user.id)
    .maybeSingle();
  const reason = me ? deriveGateReason(me) : null;
  if (reason) {
    return (
      <>
        <DeepRouteHeader backHref="/inbox" backLabel="back to inbox" />
        <AccountGate reason={reason} />
      </>
    );
  }

  const host = (offer.host ?? {}) as {
    first_name?: string | null; age?: number | null; city?: string | null; blurred_photo_url?: string | null;
  };
  const instance = (offer.instance ?? null) as { starts_at?: string | null; itinerary_id?: string | null } | null;

  // E15 rung-2 (REQ-E15 / D-03): sign the host's BLURRED photo PATH only. The offer
  // surface stays pre-lock, so the clear path is NEVER signed here (T-05-05/T-05-06).
  // The blurred signer needs no reveal gate (the blurred asset IS the privacy artifact).
  // OfferDetail applies the softer rung-2 CSS blur on top of this signed blurred url.
  // Degrade to null on a missing path or a signing hiccup so OfferDetail falls back to
  // the placeholder; never crash the offer page.
  // COHERENCE (same class as da08d7d on the lock hero): a rooted path ('/...') is a
  // public-asset blurred mirror (seed/legacy) — render directly; anything else is a
  // private storage path — sign it. Either way the value IS the blurred variant
  // (profiles.blurred_photo_url), so the blind contract holds.
  let hostPhotoUrl: string | null = null;
  if (host.blurred_photo_url) {
    if (host.blurred_photo_url.startsWith('/')) {
      hostPhotoUrl = host.blurred_photo_url;
    } else {
      const [signed] = await signBlurredUrls(supabase, [host.blurred_photo_url]).catch(() => []);
      hostPhotoUrl = signed ?? null;
    }
  }

  // COHERENCE (live crawl 2026-06-10): an accepted offer renders the locked-in state,
  // which links to the match. The lock row is the one on this offer's date_instance
  // where the viewer is a party (locks_party_read RLS enforces the same; the explicit
  // party filter keeps the intent readable). unique(date_instance_id) ⇒ at most one.
  // A miss degrades to null and OfferDetail links to /matches instead.
  let lockId: string | null = null;
  if (offer.status === 'accepted' && offer.date_instance_id) {
    const { data: lock } = await supabase
      .from('locks')
      .select('id')
      .eq('date_instance_id', offer.date_instance_id)
      .or(`creator_id.eq.${user.id},matched_user_id.eq.${user.id}`)
      .maybeSingle();
    lockId = lock?.id ?? null;
  }

  // E13: render the matched night's full plan. Second RLS read — the forked
  // itinerary is readable by id (itineraries_readable_by_id USING(true)) once the
  // offer-recipient policy (127500) has let us read the instance + its itinerary_id.
  // NOT get_night_detail (blind/pre-swipe-only — T-03-16). Normalize the raw stops
  // JSON HERE (rich/thin shape drift) before handing to PlanTimeline (D-12/03-04).
  let stops: ReturnType<typeof normalizeNightDetailStops> = [];
  let vibeTags: string[] | null = null;
  // Founder rule: the same read also fills a NightDetailNight so OfferDetail can
  // open the FULL plan sheet (preloaded — no client RPC; get_night_detail is
  // blind/pre-swipe-only and would return empty here). All fields are blind-safe
  // itinerary columns the feed already exposes; the feed-only slots the table
  // doesn't carry (venue_neighborhood / is_seed) stay empty — the sheet
  // tolerates nulls. starts_at is already shown minute-precise on this page,
  // so threading it as time_window_start leaks nothing new.
  let night: NightDetailNight | null = null;
  if (instance?.itinerary_id) {
    const { data: it } = await supabase
      .from('itineraries')
      .select('stops, vibe_tags, title, hook, why_it_works, why_note, cover_image_url, pay_setting, total_cost_pp, total_duration_min')
      .eq('id', instance.itinerary_id)
      .maybeSingle();
    stops = normalizeNightDetailStops(it?.stops);
    vibeTags = (it?.vibe_tags as string[] | null) ?? null;
    if (it) {
      night = {
        date_instance_id: offer.date_instance_id ?? '',
        time_window_start: instance.starts_at ?? '',
        pay_setting: (it.pay_setting as string | null) ?? null,
        vibe_tags: vibeTags,
        why_note: it.why_note ?? null,
        hook: it.hook ?? null,
        why_it_works: it.why_it_works ?? null,
        cover_image_url: it.cover_image_url ?? null,
        title: it.title ?? null,
        venue_neighborhood: null,
        is_seed: false,
        total_cost_pp: it.total_cost_pp ?? null,
        total_duration_min: it.total_duration_min ?? null,
        stops,
      };
    }
  }

  return (
    <>
      <DeepRouteHeader
        backHref="/inbox"
        backLabel="back to inbox"
        title={host.first_name ?? undefined}
      />
      <OfferDetail
        offerId={offer.id}
        instanceId={offer.date_instance_id ?? null}
        expiresAt={offer.expires_at}
        status={offer.status}
        host={{
          first_name: host.first_name ?? 'someone',
          age: host.age ?? null,
          city: host.city ?? null,
          photo_url: hostPhotoUrl,
        }}
        date={instance?.starts_at ? { startsAt: instance.starts_at } : null}
        stops={stops}
        vibeTags={vibeTags}
        night={night}
        lockId={lockId}
      />
    </>
  );
}

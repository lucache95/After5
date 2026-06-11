// Server entry for /matches — the bottom-nav "dates" tab. Lists the viewer's
// locks under their own RLS client (locks_party_read restricts to
// creator_id|matched_user_id=auth.uid()). Each lock embeds BOTH party profiles
// FK-hinted (locks has 3 FKs to profiles — bug class 4) so the counterpart's
// name/photo render in one query; the date instance is embedded via its FK for
// the time label (readable post-lock via the 127500 lock-stage policy), and the
// instance embed carries the itinerary TITLE inline (itineraries select is
// USING(true)) so the card can sell the night — still one query.
//
// Tab destination: always wrapped in the Tier-1 shell (masthead + BottomTabShell),
// mirroring /my-nights — a primary tab must never dead-end without the bottom nav.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { BottomTabShell } from '@/components/BottomTabShell';
import { NotificationToast } from '@/components/NotificationToast';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { resolveMirrorPhotoSrc } from '@/lib/after5/photo-src';
import { MatchesList, type MatchCard } from './MatchesList';
import { bucketLocksByStart, isRatingOpen, pickCounterpart, type LockRowWithParties } from './lock-view';

export const dynamic = 'force-dynamic';

export default async function MatchesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/matches');

  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  const { data: rows } = await supabase
    .from('locks')
    .select(`
      id, status, locked_at, rating_closed_at, cancel_reason, creator_id, matched_user_id, date_instance_id,
      creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
      instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range, itinerary:itineraries ( title ) )
    `)
    .order('locked_at', { ascending: false });

  const locks = (rows ?? []) as unknown as LockRowWithParties[];
  const { upcoming, past } = bucketLocksByStart(locks);
  const toCard = async (l: LockRowWithParties, isUpcoming: boolean): Promise<MatchCard> => {
    const counterpart = pickCounterpart(l, user.id);
    // COHERENCE FIX: real users' clear_photo_url mirror is a relative storage
    // path — sign it (or pass through rooted/absolute) before next/image sees
    // it. This list is post-lock, so the clear photo is the correct tier.
    if (counterpart) {
      counterpart.clear_photo_url = await resolveMirrorPhotoSrc(supabase, counterpart.clear_photo_url, { width: 128 });
    }
    return {
      id: l.id,
      status: l.status,
      counterpart,
      startsAt: l.instance?.starts_at ?? null,
      nightTitle: l.instance?.itinerary?.title ?? null,
      // Mirrors LockDetail's rate gate (window open + not cancelled) — derived
      // from the already-fetched time_range, no extra query. The rate page itself
      // hard-gates the window + already-rated, so a stale chip can't over-rate.
      ratable: !isUpcoming && l.status !== 'cancelled' && isRatingOpen(l.instance),
    };
  };
  const [upcomingCards, pastCards] = await Promise.all([
    Promise.all(upcoming.map((l) => toCard(l, true))),
    Promise.all(past.map((l) => toCard(l, false))),
  ]);

  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav aria-label="masthead" className="mx-auto flex w-full max-w-[420px] items-center justify-between px-5 py-3.5">
          <Link href="/" className="font-heading text-2xl lowercase text-shell-accent">after5</Link>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[420px] px-5 pb-28 pt-8">
        <MatchesList upcoming={upcomingCards} past={pastCards} />
      </div>

      <NotificationToast userId={user.id} />
      <BottomTabShell userId={user.id} />
    </main>
  );
}

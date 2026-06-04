// Server entry for /matches/[lockId] (spec §4.2). Loads the lock with FK-hinted
// embeds (locks has 3 profiles FKs — bug class 4), gates to participants (RLS
// locks_party_read already hides non-party rows; the id check is defense-in-depth),
// derives the counterpart + rating-window state, and renders LockDetail.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { normalizeNightDetailStops } from '@after5/api-client';
import { LockDetail } from './LockDetail';
import { listMyPhotos, signClearUrls } from '@/lib/after5/photos';
import { pickCounterpart, isRatingOpen, type LockRowWithParties, type RevealPrompt } from '../lock-view';

export const dynamic = 'force-dynamic';

export default async function LockPage({
  params, searchParams,
}: {
  params: Promise<{ lockId: string }>;
  searchParams: Promise<{ just?: string }>;
}) {
  const { lockId } = await params;
  const { just } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/matches/${lockId}`);

  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  const { data: row } = await supabase
    .from('locks')
    .select(`
      id, status, locked_at, rating_closed_at, cancel_reason, creator_id, matched_user_id, date_instance_id,
      creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags, prompt_answers, pronouns ),
      matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags, prompt_answers, pronouns ),
      instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range, itinerary_id ),
      thread:chat_threads!chat_threads_lock_id_fkey ( id )
    `)
    .eq('id', lockId)
    .maybeSingle();

  const lock = row as unknown as LockRowWithParties | null;
  if (!lock || (lock.creator_id !== user.id && lock.matched_user_id !== user.id)) {
    return (
      <>
        <DeepRouteHeader backHref="/matches" backLabel="back to matches" />
        <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
          <div className="mx-auto max-w-[420px]">
            <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">that&apos;s not your match</h1>
            <p className="mt-4 font-body text-lg text-shell-ink/70">this one isn&apos;t yours to see.</p>
          </div>
        </main>
      </>
    );
  }

  // chat_threads.lock_id is a one-to-one back-reference; the embed comes back as an
  // array (or object) — normalize to the single promoted thread for this lock.
  const threadEmbed = (row as unknown as { thread?: { id: string } | { id: string }[] | null }).thread;
  const threadId = Array.isArray(threadEmbed) ? threadEmbed[0]?.id ?? null : threadEmbed?.id ?? null;

  const counterpart = pickCounterpart(lock, user.id);
  if (!counterpart) {
    return (
      <>
        <DeepRouteHeader backHref="/matches" backLabel="back to matches" />
        <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
          <div className="mx-auto max-w-[420px]">
            <h1 className="font-heading text-3xl lowercase text-shell-ink">couldn&apos;t load that</h1>
            <p className="mt-3 font-body text-shell-ink/70">something glitched. head back and try again.</p>
          </div>
        </main>
      </>
    );
  }

  // M6 reveal data. The pair is locked, so profile_photos_revealed_read +
  // profile_photos_clear_reveal_read (storage) pass for the counterpart's rows;
  // signClearUrls mints short-lived signed URLs only because the RLS'd client
  // is allowed to read them. This is the end-to-end fix for the broken reveal
  // photo (clear_photo_url was a raw private path handed to next/image).
  let photos: string[] = [];
  let photoError = false;
  try {
    const rows = await listMyPhotos(supabase, counterpart.id);
    photos = await signClearUrls(supabase, rows.map((r) => r.clear_path));
    // Fallback: if no gallery rows yet (pre-M6 profiles), sign the legacy mirror.
    if (photos.length === 0 && counterpart.clear_photo_url) {
      const { data: signed } = await supabase.storage
        .from('profile-photos')
        .createSignedUrl(counterpart.clear_photo_url, 60 * 10);
      if (signed?.signedUrl) photos = [signed.signedUrl];
    }
  } catch {
    photos = [];
  }
  // WR-01: a genuinely empty reveal (signing threw, or no rows + no mirror) must surface
  // the held-blur "pull to retry" state in the ceremony rather than dissolving over a
  // blank gradient. Thread the outcome down so RevealModal can hold instead of play.
  if (photos.length === 0) photoError = true;

  // Join the counterpart's prompt answers to active prompt labels (server-side).
  let prompts: RevealPrompt[] = [];
  const answers = counterpart.prompt_answers ?? [];
  if (answers.length > 0) {
    const { data: defs } = await supabase
      .from('profile_prompts')
      .select('id, label')
      .in('id', answers.map((a) => a.prompt_id));
    const labelById = new Map((defs ?? []).map((d) => [d.id, d.label]));
    prompts = answers
      .filter((a) => a.answer?.trim())
      .map((a) => ({ label: labelById.get(a.prompt_id) ?? a.prompt_id, answer: a.answer }));
  }

  // E13: render the matched night's full plan. Post-lock the whole itinerary is
  // fair game; the lock participant reads the instance (locks_party_read) → its
  // itinerary_id → itineraries.stops (itineraries_readable_by_id USING(true)).
  // Normalize the raw stops JSON HERE (rich/thin shape drift) before PlanTimeline.
  let stops: ReturnType<typeof normalizeNightDetailStops> = [];
  let vibeTags: string[] | null = null;
  if (lock.instance?.itinerary_id) {
    const { data: it } = await supabase
      .from('itineraries')
      .select('stops, vibe_tags')
      .eq('id', lock.instance.itinerary_id)
      .maybeSingle();
    stops = normalizeNightDetailStops(it?.stops);
    vibeTags = (it?.vibe_tags as string[] | null) ?? null;
  }

  return (
    <>
      <DeepRouteHeader
        backHref="/matches"
        backLabel="back to matches"
        title={counterpart.first_name ?? undefined}
      />
      <LockDetail
        lockId={lock.id}
        status={lock.status}
        counterpart={counterpart}
        threadId={threadId}
        startsAt={lock.instance?.starts_at ?? null}
        ratingOpen={isRatingOpen(lock.instance)}
        justLocked={just === '1'}
        photos={photos}
        photoError={photoError}
        prompts={prompts}
        stops={stops}
        vibeTags={vibeTags}
      />
    </>
  );
}

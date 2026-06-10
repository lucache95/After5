// Server entry for /matches/[lockId] (spec §4.2). Loads the lock with FK-hinted
// embeds (locks has 3 profiles FKs — bug class 4), gates to participants (RLS
// locks_party_read already hides non-party rows; the id check is defense-in-depth),
// derives the counterpart + rating-window state, and renders LockDetail.
//
// Night data comes from get_lock_night_detail(p_lock) — the post-lock twin of
// the blind feed RPC. get_night_detail(p_instance) requires status='seeking' +
// starts_at > now() + creator <> viewer, all wrong for a locked/past night, so
// it (and the RLS-fragile inline itinerary embed) always degraded to "plan's
// being put together." The lock RPC gates ONLY on the viewer being a party.
//
// Tab destination: a dates-tab leaf keeps the Tier-1 bottom nav mounted (the
// dates tab stays active via usePathname prefix match) plus a back affordance
// to /matches — the payoff screen must never dead-end.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { DeepRouteHeader } from '@/components/DeepRouteHeader';
import { BottomTabShell } from '@/components/BottomTabShell';
import { NotificationToast } from '@/components/NotificationToast';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { normalizeNightDetailStops, type NightDetailNight, type NightDetailStop } from '@after5/api-client';
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
      creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags, prompt_answers, pronouns, verification, reliability_score ),
      matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags, prompt_answers, pronouns, verification, reliability_score ),
      instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range ),
      thread:chat_threads!chat_threads_lock_id_fkey ( id )
    `)
    .eq('id', lockId)
    .maybeSingle();

  const lock = row as unknown as LockRowWithParties | null;
  if (!lock || (lock.creator_id !== user.id && lock.matched_user_id !== user.id)) {
    return (
      <>
        <DeepRouteHeader backHref="/matches" backLabel="back to matches" />
        <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 pb-28 text-center">
          <div className="mx-auto max-w-[420px]">
            <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">that&apos;s not your match</h1>
            <p className="mt-4 font-body text-lg text-shell-ink/70">this one isn&apos;t yours to see.</p>
          </div>
        </main>
        <BottomTabShell userId={user.id} />
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
        <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 pb-28 text-center">
          <div className="mx-auto max-w-[420px]">
            <h1 className="font-heading text-3xl lowercase text-shell-ink">couldn&apos;t load that</h1>
            <p className="mt-3 font-body text-shell-ink/70">something glitched. head back and try again.</p>
          </div>
        </main>
        <BottomTabShell userId={user.id} />
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
    // Fallback: if no gallery rows yet (pre-M6 profiles), use the legacy mirror.
    // COHERENCE: the matches LIST renders clear_photo_url verbatim, so this
    // surface must accept every shape the list accepts or the two disagree
    // (live repro: list showed the photo, this hero showed the initial).
    // A rooted path ('/...') is a public asset — render directly; anything
    // else is a private storage path — sign it.
    if (photos.length === 0 && counterpart.clear_photo_url) {
      if (counterpart.clear_photo_url.startsWith('/')) {
        photos = [counterpart.clear_photo_url];
      } else {
        const { data: signed } = await supabase.storage
          .from('profile-photos')
          .createSignedUrl(counterpart.clear_photo_url, 60 * 10);
        if (signed?.signedUrl) photos = [signed.signedUrl];
      }
    }
  } catch {
    photos = [];
  }
  // WR-01/fix-02: a genuinely empty reveal (signing threw, or no rows + no mirror)
  // surfaces the honest post-lock empty state — initial-letter avatar + "no photo
  // yet." — never a blur (identity is already revealed on this surface).
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

  // E13/E21 + fix-02: the matched night via the party-gated get_lock_night_detail
  // RPC (locked + past nights return; the pre-lock get_night_detail filters them
  // out). Normalize the raw stops JSON HERE (rich/thin shape drift) before
  // PlanTimeline. An RPC miss/error degrades to the empty-plan copy only.
  let nightTitle: string | null = null;
  let stops: NightDetailStop[] = [];
  let vibeTags: string[] | null = null;
  let nightWindowStart: string | null = null;
  // Founder rule: the FULL detail row, threaded to LockDetail → NightDetailSheet
  // as `preloaded` (the sheet's own get_night_detail is pre-lock-only and returns
  // empty for a lock). Same column shape as get_night_detail (fix02), so the
  // whole row maps 1:1 onto NightDetailNight — nothing dropped anymore
  // (hook / why_it_works / cover / pay / cost / duration ride along).
  let night: NightDetailNight | null = null;
  try {
    const { data: nightRows } = await supabase.rpc('get_lock_night_detail', { p_lock: lockId });
    const row = Array.isArray(nightRows) ? nightRows[0] : nightRows;
    if (row) {
      night = {
        date_instance_id: row.date_instance_id,
        time_window_start: row.time_window_start,
        pay_setting: row.pay_setting ?? null,
        vibe_tags: row.vibe_tags ?? null,
        why_note: row.why_note ?? null,
        hook: row.hook ?? null,
        why_it_works: row.why_it_works ?? null,
        cover_image_url: row.cover_image_url ?? null,
        title: row.title ?? null,
        venue_neighborhood: row.venue_neighborhood ?? null,
        is_seed: row.is_seed === true,
        total_cost_pp: row.total_cost_pp ?? null,
        total_duration_min: row.total_duration_min ?? null,
        stops: normalizeNightDetailStops(row.stops),
      };
      nightTitle = night.title;
      stops = night.stops;
      vibeTags = night.vibe_tags;
      nightWindowStart = night.time_window_start ?? null;
    }
  } catch {
    // degrade: LockDetail shows "plan's being put together."
  }

  // E19 (REQ-E19 / D-03 / D-04): derive the soft reconfirm / check-in flags from the viewer's
  // own notification rows (RLS notifications_recipient_read scopes to user_id = auth.uid()).
  // A live, unread date_reconfirm / safety_checkin for THIS lock surfaces its soft card.
  // reconfirmNoReply: a day-of reconfirm that's been sitting unread past a soft window — a
  // quiet nudge, never an escalation. Light derivation, mirroring isRatingOpen.
  let reconfirmDue = false;
  let reconfirmNoReply = false;
  let checkinDue = false;
  if (lock.status === 'active') {
    const { data: notifs } = await supabase
      .from('notifications')
      .select('type, read_at, created_at')
      .in('type', ['date_reconfirm', 'safety_checkin'])
      .eq('user_id', user.id)
      .filter('payload->>lock_id', 'eq', lockId)
      .order('created_at', { ascending: false });
    const RECONFIRM_NO_REPLY_MIN = 240; // 4h with no ack reads as the soft "no reply yet" nudge
    for (const n of notifs ?? []) {
      if (n.read_at) continue;
      if (n.type === 'date_reconfirm') {
        reconfirmDue = true;
        const age = Date.now() - new Date(n.created_at).getTime();
        if (age >= RECONFIRM_NO_REPLY_MIN * 60_000) reconfirmNoReply = true;
      } else if (n.type === 'safety_checkin') {
        checkinDue = true;
      }
    }
  }

  return (
    <>
      {/* Back-only chrome — the hero owns the name (single h1, no duplicate). */}
      <DeepRouteHeader backHref="/matches" backLabel="back to matches" />
      <LockDetail
        lockId={lock.id}
        status={lock.status}
        counterpart={counterpart}
        threadId={threadId}
        startsAt={lock.instance?.starts_at ?? nightWindowStart}
        ratingOpen={isRatingOpen(lock.instance)}
        justLocked={just === '1'}
        photos={photos}
        photoError={photoError}
        prompts={prompts}
        nightTitle={nightTitle}
        stops={stops}
        vibeTags={vibeTags}
        night={night}
        reconfirmDue={reconfirmDue}
        reconfirmNoReply={reconfirmNoReply}
        checkinDue={checkinDue}
      />
      <NotificationToast userId={user.id} />
      <BottomTabShell userId={user.id} />
    </>
  );
}

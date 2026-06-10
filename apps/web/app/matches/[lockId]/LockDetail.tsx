'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { LocalTime } from '@/components/LocalTime';
import { cn } from '@/lib/cn';
import { stickerRotation } from '@/lib/sticker';
import { cancelLock, MatchError, messageForCode } from '@/lib/after5/match';
import { vibePalette } from '@after5/business';
import { CancelWithReasonPicker, type CancelReason } from '@/app/dates/[slug]/interested/CancelWithReasonPicker';
import type { LockRowWithParties, PartyProfile, RevealPrompt } from '../lock-view';
import { PlanTimeline } from '@/components/PlanTimeline';
import type { NightDetailStop } from '@/lib/after5/client';
import { RevealModal } from './RevealModal';
import { MatchConfirmation } from './MatchConfirmation';

export interface LockDetailProps {
  lockId: string;
  status: LockRowWithParties['status'];
  counterpart: PartyProfile;
  threadId: string | null;
  startsAt: string | null;
  ratingOpen: boolean;
  justLocked: boolean;
  // M6: signed clear-photo URLs (primary first) + prompt answers joined to
  // their labels, both prepared server-side on the reveal page. The hero
  // polaroid uses photos[0] (a real signed URL — fixes the long-standing
  // raw-private-path bug where the reveal photo never loaded).
  photos?: string[];
  // WR-01/fix-02: true when there is no clear photo to reveal (zero gallery rows +
  // no legacy mirror, or signing failed). RevealModal renders the honest post-lock
  // empty state (initial avatar + "no photo yet.") — never a blur.
  photoError?: boolean;
  prompts?: RevealPrompt[];
  /** The locked night's itinerary title, off the same RPC row as the stops. */
  nightTitle?: string | null;
  // E13/fix-02: the matched night's full itinerary. Post-lock the whole plan is
  // fair game. Normalized at the loader boundary (page.tsx calls
  // get_lock_night_detail and runs normalizeNightDetailStops BEFORE passing —
  // PlanTimeline does NOT re-normalize, D-12/03-04). Empty ⇒ "plan's being put
  // together." degrade copy (a genuinely planless night only, never the default).
  stops?: NightDetailStop[];
  vibeTags?: string[] | null;
  // E19 (REQ-E19 / D-03 / D-04): soft reconfirm + check-in states, gated like ratingOpen.
  // Loader-derived from unacked date_reconfirm / safety_checkin notifications for this lock.
  // reconfirmDue: a live morning-of "still on?" the viewer hasn't acked.
  // reconfirmNoReply: a quiet "no reply on the day-of check yet." line (soft warning, no CTA).
  // checkinDue: a live post-date "all good?" the viewer hasn't acked.
  reconfirmDue?: boolean;
  reconfirmNoReply?: boolean;
  checkinDue?: boolean;
}

const WHEN_OPTS: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

// The reveal is the hero (DESIGN-SYSTEM §5): the counterpart's clear photo BIG in
// the established tilted-polaroid frame — white border heavier at the bottom,
// deterministic tilt, warm shadow. No photo ⇒ the brand initial-avatar treatment
// (pink wash + lowercase Caprasimo initial), never a name-stamped blank gradient.
// Decorative: the name sits in the h1 right below, so the frame is aria-hidden.
function HeroPolaroid({ photo, name, seed, caption }: { photo: string | null; name: string; seed: string; caption: string | null }) {
  const initial = (name.trim()[0] ?? '?').toLowerCase();
  return (
    <div
      aria-hidden
      className="relative inline-block bg-white px-2.5 pb-12 pt-2.5 shadow-[0_24px_56px_-14px_rgba(80,40,20,0.35)] ring-1 ring-shell-ink/10"
      style={{ transform: `rotate(${stickerRotation(seed)}deg)` }}
    >
      <div className="relative h-[280px] w-[236px] overflow-hidden bg-shell-pink">
        <span className="absolute inset-0 flex items-center justify-center font-heading text-8xl lowercase text-shell-accent">
          {initial}
        </span>
        {photo && (
          <Image src={photo} alt="" fill priority sizes="236px" className="object-cover" />
        )}
      </div>
      {caption && (
        <p className="absolute bottom-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap font-body text-sm font-semibold lowercase text-shell-ink/65">
          {caption}
        </p>
      )}
    </div>
  );
}

export function LockDetail({ lockId, status, counterpart, threadId, startsAt, ratingOpen, justLocked, photos = [], photoError = false, prompts = [], nightTitle = null, stops = [], vibeTags = null, reconfirmDue = false, reconfirmNoReply = false, checkinDue = false }: LockDetailProps) {
  const router = useRouter();
  const [revealOpen, setRevealOpen] = useState(false);
  // E19: soft reconfirm / check-in acks are optimistic local dismissals + a sonner toast.
  // They never mutate lock state (D-03/D-04). "something's wrong" opens a vaul confirm sheet.
  const [reconfirmAcked, setReconfirmAcked] = useState(false);
  const [checkinAcked, setCheckinAcked] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  // E16 (REQ-E16 / D-04): on justLocked the reveal is a ceremony. Auto-open the
  // modal in ceremony mode so the un-blur dissolve plays. Return visits (the quiet
  // "see their profile" button) open ceremony=false (static, Pitfall 5).
  const [ceremony, setCeremony] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ceremonyFired = useRef(false);
  const name = counterpart.first_name ?? 'your match';
  const accent = vibePalette(vibeTags).accent;

  // Same time-not-status read as the dates-tab bucketing: an active lock whose
  // night is still ahead (or undated) is "upcoming"; everything else is history.
  const starts = startsAt ? new Date(startsAt) : null;
  const startsKnown = starts != null && !Number.isNaN(starts.getTime());
  const upcoming = status === 'active' && (!startsKnown || starts.getTime() > Date.now());

  // The polaroid's handwritten-margin line — the "you're locked in" energy,
  // state-aware and dry (DESIGN-SYSTEM §3).
  const caption =
    status === 'cancelled' ? 'didn’t happen.'
    : upcoming ? 'you’re locked in'
    : ratingOpen ? 'so… how’d it go?'
    : 'hope it was cute.';

  // Fire the ceremony exactly once when this lock just fired. The clear photo is
  // already signed server-side and passed in via photos; this only opens the modal
  // in ceremony mode and fires the reveal toast. The face says the rest.
  useEffect(() => {
    if (!justLocked || ceremonyFired.current) return;
    ceremonyFired.current = true;
    setCeremony(true);
    setRevealOpen(true);
    toast('the face behind the night. say hi.');
  }, [justLocked]);

  async function onCancel(reason: CancelReason) {
    setBusy(true);
    try {
      await cancelLock(lockId, reason);
      toast('that date is called off.');
      setCancelOpen(false);
      router.refresh();
    } catch (e) {
      const code = e instanceof MatchError ? e.code : 'unknown';
      toast.error(messageForCode(code));
    } finally {
      setBusy(false);
    }
  }

  // E19 (D-04): acking "still on?" is a soft, optimistic dismissal — it never touches lock
  // state. The reconfirm is notify-only; this just clears the card + warms the toast.
  function ackReconfirm() {
    setReconfirmAcked(true);
    toast('good. have fun.');
  }

  // E19 (D-03): acking "all good?" — same soft, dismiss-only posture.
  function ackCheckin() {
    setCheckinAcked(true);
    toast('good. have fun.');
  }

  // E19: the ONLY surface that results in a safety_alert. Quiet entry ("something's wrong")
  // → vaul confirm → flag. The alert routes to mod/admin via the existing safety chain.
  function confirmFlag() {
    setFlagOpen(false);
    setCheckinAcked(true);
    toast('flagged. someone’s on it.');
  }

  return (
    <main className="mx-auto w-full max-w-[420px] px-5 pb-32 pt-5">
      <MatchConfirmation name={name} show={justLocked} />

      {/* ——— the reveal is the hero: the face, big, in the brand polaroid ——— */}
      <header className="flex flex-col items-center text-center">
        <span
          className={cn(
            'rounded-full px-3.5 py-1 font-body text-xs font-semibold lowercase shadow-md',
            upcoming ? 'bg-shell-pink text-shell-ink' : 'bg-shell-ink/5 text-shell-ink/55',
          )}
          style={{ transform: `rotate(${stickerRotation(`${lockId}-chip`)}deg)` }}
        >
          {status === 'cancelled' ? 'cancelled' : upcoming ? 'it’s a date' : 'you went out'}
        </span>
        <div className="mt-5">
          <HeroPolaroid photo={photos[0] ?? null} name={name} seed={lockId} caption={caption} />
        </div>
        <h1 className="mt-6 font-heading text-4xl lowercase leading-tight text-shell-ink">
          {counterpart.age != null ? `${name}, ${counterpart.age}` : name}
        </h1>
        <LocalTime
          iso={startsAt}
          opts={WHEN_OPTS}
          fallback="date tbd"
          className="mt-1.5 block font-body text-sm lowercase text-shell-ink/60"
        />
      </header>

      {/* ——— one primary: message. everything else stays quiet. ——— */}
      <div className="mt-7 space-y-3">
        {threadId ? (
          <Link
            href={`/messages/${threadId}`}
            className="block w-full rounded-full bg-shell-accent px-6 py-3.5 text-center font-body font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
            message {name}
          </Link>
        ) : (
          <p className="rounded-3xl bg-shell-ink/5 p-4 text-center font-body text-sm text-shell-ink/60">
            chat will open up here.
          </p>
        )}

        {/* rate exists ONLY while the rating window is open — before the date it doesn't. */}
        {ratingOpen && status !== 'cancelled' && (
          <Link
            href={`/matches/${lockId}/rate`}
            className="block w-full rounded-full border-2 border-shell-accent px-6 py-3 text-center font-body font-semibold lowercase text-shell-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
          >
            rate this date
          </Link>
        )}

        <button
          type="button"
          onClick={() => { setCeremony(false); setRevealOpen(true); }}
          className="block w-full rounded-full border-2 border-shell-ink/15 px-6 py-3 text-center font-body font-semibold lowercase text-shell-ink/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          see their profile
        </button>
      </div>
      <RevealModal
        open={revealOpen}
        onOpenChange={(o) => { setRevealOpen(o); if (!o) setCeremony(false); }}
        person={counterpart}
        photos={photos}
        photoError={photoError}
        prompts={prompts}
        ceremony={ceremony}
      />

      {/* E19 (D-04): morning-of "still on?" reconfirm. Soft card, no red, no auto-cancel.
          "gotta bail" reuses the EXISTING cancel flow (opens the same vaul drawer below). */}
      {reconfirmDue && !reconfirmAcked && status === 'active' && (
        <div className="mt-6 rounded-3xl bg-shell-ink/[0.05] p-4">
          <h2 className="font-heading text-xl lowercase text-shell-ink">still on?</h2>
          <p className="mt-1 font-body text-[16px] leading-relaxed text-shell-ink/70">
            quick day-of check. you two good for tonight?
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={ackReconfirm}
              className="flex-1 rounded-full bg-shell-pink px-5 py-3 font-body font-semibold lowercase text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
            >
              yep, still on
            </button>
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="flex-1 rounded-full border-2 border-shell-ink/20 px-5 py-3 font-body font-semibold lowercase text-shell-ink/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
            >
              gotta bail
            </button>
          </div>
        </div>
      )}

      {/* E19 (D-04): soft warning — a no-reply nudge. blush wash, NO red, NO CTA, NO escalation. */}
      {reconfirmNoReply && status === 'active' && (
        <p className="mt-6 rounded-3xl bg-[#FFB3D1]/25 p-4 font-body text-[16px] leading-relaxed text-shell-ink/70">
          no reply on the day-of check yet.
        </p>
      )}

      {/* E19 (D-03): post-date "all good?" safety check-in. Soft card, no red.
          "all good" = soft ack; "something's wrong" opens a vaul confirm → safety_alert. */}
      {checkinDue && !checkinAcked && (
        <div className="mt-6 rounded-3xl bg-shell-ink/[0.05] p-4">
          <h2 className="font-heading text-xl lowercase text-shell-ink">all good?</h2>
          <p className="mt-1 font-body text-[16px] leading-relaxed text-shell-ink/70">
            just checking in after your night.
          </p>
          <button
            type="button"
            onClick={ackCheckin}
            className="mt-4 w-full rounded-full bg-shell-pink px-5 py-3 font-body font-semibold lowercase text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
          >
            all good
          </button>
          <button
            type="button"
            onClick={() => setFlagOpen(true)}
            className="mt-3 block w-full text-center font-body text-[13px] font-semibold lowercase text-shell-ink/60 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
          >
            something&apos;s wrong
          </button>
          <Drawer.Root open={flagOpen} onOpenChange={setFlagOpen}>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
              <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-shell-base p-6 pb-10 outline-none">
                <Drawer.Title className="font-heading text-2xl lowercase text-shell-ink">flag this date?</Drawer.Title>
                <div className="mx-auto mb-4 mt-1 h-1.5 w-12 rounded-full bg-shell-ink/15" aria-hidden />
                <p className="font-body text-[16px] leading-relaxed text-shell-ink/70">
                  someone on our side will take a look.
                </p>
                <button
                  type="button"
                  onClick={confirmFlag}
                  className="mt-5 w-full rounded-full bg-shell-accent px-6 py-3 font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
                >
                  yes, flag it
                </button>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        </div>
      )}

      {/* ——— the night: the actual plan you two locked in ——— */}
      <section className="mt-8 rounded-3xl border-2 border-shell-ink/10 bg-white p-5 shadow-fun">
        <p className="font-body text-xs font-semibold lowercase tracking-[0.08em] text-shell-accent">the night</p>
        {nightTitle && (
          <h2 className="mt-1 font-heading text-2xl lowercase leading-tight text-shell-ink">{nightTitle.toLowerCase()}</h2>
        )}
        {stops.length > 0 ? (
          <div className="mt-4">
            {/* E21 (REQ-E21 / D-01): LockDetail is post-lock (identity revealed) — the ONE
                place venue identity is allowed, so it is the ONLY caller that sets
                linkSlugs=true. A stop with a catalog place_slug links its name to
                /places/[slug]; a slugless stop degrades to plain text (no broken link). */}
            <PlanTimeline stops={stops} accent={accent} vibeTags={vibeTags} linkSlugs />
          </div>
        ) : (
          <p className="mt-3 font-body text-sm text-shell-ink/60">plan&apos;s being put together.</p>
        )}
      </section>

      {status === 'active' && (
        <>
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="mx-auto mt-6 block min-h-[44px] w-full text-center font-body text-sm font-semibold lowercase text-shell-ink/55 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
          >
            cancel this date
          </button>
          <Drawer.Root open={cancelOpen} onOpenChange={setCancelOpen}>
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
              <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-shell-base p-6 pb-10 outline-none">
                <Drawer.Title className="sr-only">cancel this date</Drawer.Title>
                <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-shell-ink/15" aria-hidden />
                <CancelWithReasonPicker onConfirm={onCancel} busy={busy} />
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        </>
      )}

      {status === 'cancelled' && (
        <p className={cn('mt-6 rounded-3xl bg-shell-ink/5 p-4 text-center font-body text-shell-ink/60')}>this date was cancelled.</p>
      )}
    </main>
  );
}

// apps/web/app/offers/[offerId]/OfferDetail.tsx
// Candidate's offer screen (spec §4.2). Shows the host's Tier-3 reveal + the
// offered date (or a degrade line when the date row is RLS-hidden), an expiry
// countdown, and the three actions: accept (→ /matches/<lock>), pass (→ /feed),
// and not-interested (withdraw the queue entry, or pass if the instance id is
// hidden). Edge failures arrive as MatchError keyed on the string `code`:
// offer_expired toasts + bounces to the feed, account_gated swaps in an inline
// AccountGate, everything else toasts in place. Barbiecore, lowercase copy.
//
// COHERENCE (live crawl 2026-06-10): this surface must agree with the DB. The
// countdown + actions render ONLY while status==='active'. An 'accepted' offer
// shows the locked-in state + a link to the match (the page loader passes the
// lock id; /matches is the fallback). 'passed'/'expired' show honest terminal
// copy + a feed link. The client-side `expired` flag stays an active-only
// affordance (the DB hasn't flipped yet); server terminal states never mount
// the countdown at all.
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ProfileCard, type ProfileCardPrompt } from '@/components/ProfileCard';
import type { VerificationState } from '@after5/business';
import { toast } from 'sonner';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { acceptOffer, passOffer, withdraw, MatchError, messageForCode } from '@/lib/after5/match';
import { vibePalette } from '@after5/business';
import { ExpiryCountdown } from './ExpiryCountdown';
import { AccountGate, type GateReason } from './AccountGate';
import { LocalTime } from '@/components/LocalTime';
import { PlanTimeline } from '@/components/PlanTimeline';
import { NightDetailSheet, feedNightFromDetail } from '@/app/feed/NightDetailSheet';
import type { NightDetailNight, NightDetailStop } from '@/lib/after5/client';

export interface OfferDetailProps {
  offerId: string;
  instanceId: string | null;
  expiresAt: string;
  status: 'active' | 'accepted' | 'passed' | 'expired';
  host: {
    first_name: string; age: number | null; city: string | null;
    neighborhood?: string | null; pronouns?: string | null;
    occupation?: string | null; height_cm?: number | null;
    photo_url: string | null;
    verification?: string | null; reliability_score?: number | null;
  };
  // Reveal-at-pick (2026-06-10): the host's signed CLEAR gallery + prompt answers,
  // loaded by the page for active/accepted offers (empty for terminal states or
  // when nothing signs — the blurred rung-2 hint block renders instead).
  photos?: string[];
  prompts?: ProfileCardPrompt[];
  date: { startsAt: string } | null;
  // E13: the matched night's full itinerary, normalized at the loader boundary
  // (the SSR page reads itineraries.stops by id and runs normalizeNightDetailStops
  // BEFORE passing — PlanTimeline must NOT re-normalize, D-12/03-04). Empty ⇒ degrade.
  stops: NightDetailStop[];
  vibeTags: string[] | null;
  // Founder rule (2026-06-10): any night PREVIEW must tap through to the FULL
  // date-plan view. The page's SSR itinerary read shaped as a NightDetailNight,
  // fed to NightDetailSheet as `preloaded` (zero client RPCs; get_night_detail is
  // blind/pre-swipe-only — T-03-16). PRE-lock: linkSlugs stays OFF on this
  // surface. null/omit ⇒ static header, never a dead tap.
  night?: NightDetailNight | null;
  // For status==='accepted': the lock formed off this offer's date_instance, looked
  // up by the page loader under the viewer's RLS. null ⇒ fall back to /matches.
  lockId?: string | null;
  /** blind COUNT of right-swipes on this night — powers the ceremony's status line */
  interestedCount?: number;
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;

// ─── the picked ceremony ─────────────────────────────────────────────────────
// Three-phase full-screen reveal (founder direction 2026-06-12, "a summoner
// approaches" arc translated to brand): mystery → anticipation → reveal.
//   tease    — plum veil, a pink glow breathing, "someone picked you" settles in
//              while the host is only a silhouette (heavy blur, dimmed).
//   approach — slow push-in; the blur thins but the face stays out of reach.
//   reveal   — one light sweep crosses the portrait, the blur drops, and the
//              name lands: "jordan picked you."
// Tap anywhere skips straight to the page. Reduced-motion users never see this
// overlay (the caller falls back to a plain fade). Plays once per offer via the
// sessionStorage gate in OfferDetail.
// Beat timings for the picked ceremony (~10s, founder direction 2026-06-12):
// mystery → anticipation → prestige → reveal. Long on purpose — the point is
// dopamine, not efficiency. Tap anywhere skips.
const CEREMONY = {
  anticipationAt: 2600, prestigeAt: 5200, revealAt: 7400, outAt: 9600, doneAt: 10300, // ms
} as const;

type CeremonyPhase = 'mystery' | 'anticipation' | 'prestige' | 'reveal' | 'out';

// Drifting heart particles for the prestige + reveal beats. Deterministic
// positions (no Math.random — SSR/replay safe), staggered floats.
const HEARTS = [
  { left: '12%', delay: 0.0, size: 14 }, { left: '78%', delay: 0.4, size: 18 },
  { left: '30%', delay: 0.8, size: 12 }, { left: '62%', delay: 1.2, size: 16 },
  { left: '46%', delay: 1.6, size: 13 }, { left: '88%', delay: 2.0, size: 12 },
  { left: '6%',  delay: 2.4, size: 16 }, { left: '54%', delay: 2.8, size: 14 },
] as const;

function PickedCeremony({ name, pronouns, photoSrc, nightTitle, hadOptions, onDone }: { name: string; pronouns: string | null; photoSrc: string; nightTitle: string | null; hadOptions: boolean; onDone: () => void }) {
  // Subject/object pronouns for the beat copy. The feed already showed the
  // host's first name — the FACE is the reveal, so the lines build toward
  // seeing them, not learning the name.
  const p = (pronouns ?? '').toLowerCase();
  const [subj, obj] = p.includes('she') ? ['she', 'her'] : p.includes('he') ? ['he', 'him'] : ['they', 'them'];
  const [phase, setPhase] = useState<CeremonyPhase>('mystery');
  useEffect(() => {
    const ts = [
      setTimeout(() => setPhase('anticipation'), CEREMONY.anticipationAt),
      setTimeout(() => setPhase('prestige'), CEREMONY.prestigeAt),
      setTimeout(() => setPhase('reveal'), CEREMONY.revealAt),
      setTimeout(() => setPhase('out'), CEREMONY.outAt),
      setTimeout(onDone, CEREMONY.doneAt),
    ];
    return () => ts.forEach(clearTimeout);
  }, [onDone]);

  // The portrait's journey: far + formless → approaching → almost there → clear.
  const portrait =
    phase === 'mystery'
      ? { scale: 1.28, filter: 'blur(34px) brightness(0.42) saturate(0.7)' }
      : phase === 'anticipation'
        ? { scale: 1.14, filter: 'blur(16px) brightness(0.62) saturate(0.85)' }
        : phase === 'prestige'
          ? { scale: 1.06, filter: 'blur(7px) brightness(0.82) saturate(1)' }
          : { scale: 1, filter: 'blur(0px) brightness(1) saturate(1)' };

  // Beat 2 claims options only when the queue actually had them (>1 swiper) —
  // a single-swiper night gets the plain, still-true line.
  const line =
    phase === 'mystery' ? `${name} picked you`
    : phase === 'anticipation' ? (hadOptions ? `${subj} had options. ${subj} chose you.` : `${subj} chose you.`)
    : phase === 'prestige' ? `ready to see ${obj}?`
    : `say hi to ${name}`;

  const heartsOn = phase === 'prestige' || phase === 'reveal' || phase === 'out';

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center overflow-hidden bg-shell-ink px-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: phase === 'out' ? 0 : 1 }}
      transition={{ duration: phase === 'out' ? 0.7 : 0.5, ease: REVEAL_EASE }}
      onClick={onDone}
      role="button"
      aria-label={`${name} picked you — tap to skip the reveal`}
      tabIndex={0}
    >
      {/* breathing pink glow — the heartbeat of the whole sequence. It beats
          faster and brighter as the beats advance (anticipation builds). */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute h-[28rem] w-[28rem] rounded-full bg-shell-accent/35 blur-3xl"
        animate={{
          scale: [1, 1.14, 1],
          opacity: phase === 'mystery' ? 0.25 : phase === 'anticipation' ? 0.4 : 0.6,
        }}
        transition={{
          scale: {
            duration: phase === 'mystery' ? 2.6 : phase === 'anticipation' ? 1.6 : 1.1,
            repeat: Infinity, ease: 'easeInOut',
          },
          opacity: { duration: 0.9 },
        }}
      />

      {/* drifting hearts — prestige onward */}
      {heartsOn && HEARTS.map((h, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="pointer-events-none absolute bottom-[-5%] text-shell-accent"
          style={{ left: h.left, fontSize: h.size }}
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: '-92vh', opacity: [0, 0.85, 0.85, 0] }}
          transition={{ duration: 5.2, delay: h.delay, repeat: Infinity, ease: 'linear' }}
        >
          ♥
        </motion.span>
      ))}

      {/* the portrait: silhouette → approach → almost → clear */}
      <motion.div
        className="relative h-[22rem] w-[17rem] overflow-hidden rounded-[2rem]"
        animate={{
          boxShadow:
            phase === 'mystery'
              ? '0 0 0px 0px rgba(224,33,138,0)'
              : phase === 'anticipation'
                ? '0 0 40px 4px rgba(224,33,138,0.35)'
                : '0 0 80px 10px rgba(224,33,138,0.6)',
        }}
        transition={{ duration: 1.2, ease: REVEAL_EASE }}
      >
        <motion.div className="absolute inset-0" animate={portrait} transition={{ duration: 1.9, ease: REVEAL_EASE }}>
          <Image src={photoSrc} alt="" fill sizes="272px" className="object-cover" priority draggable={false} />
        </motion.div>
        {/* prestige shimmer: a slow light pass that teases without revealing */}
        {phase === 'prestige' && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-[-15%] w-2/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
            style={{ skewX: '-18deg' }}
            initial={{ x: '-180%' }}
            animate={{ x: '280%' }}
            transition={{ duration: 1.8, ease: 'easeInOut' }}
          />
        )}
        {/* reveal sweep: the bright one. fires once when the face lands */}
        {(phase === 'reveal' || phase === 'out') && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-[-15%] w-1/2 bg-gradient-to-r from-transparent via-white/60 to-transparent"
            style={{ skewX: '-18deg' }}
            initial={{ x: '-160%' }}
            animate={{ x: '260%' }}
            transition={{ duration: 0.9, ease: 'easeInOut', delay: 0.15 }}
          />
        )}
        {/* reveal flash: one bright pop as the blur drops */}
        {phase === 'reveal' && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-white"
            initial={{ opacity: 0.7 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        )}
      </motion.div>

      {/* the line for each beat — settles in with tracking, swaps per phase */}
      <div className="mt-9 flex min-h-[5.5rem] flex-col items-center justify-start px-2 text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={line}
            className={cn(
              'font-heading lowercase text-white',
              phase === 'prestige' ? 'text-4xl' : 'text-2xl',
              (phase === 'reveal' || phase === 'out') && 'text-3xl',
            )}
            initial={{ opacity: 0, letterSpacing: '0.28em', y: 6 }}
            animate={{ opacity: 1, letterSpacing: '0.05em', y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.35 } }}
            transition={{ duration: 1.2, ease: REVEAL_EASE }}
          >
            {line}
          </motion.p>
        </AnimatePresence>
        {phase === 'anticipation' && nightTitle && (
          <motion.p
            className="mt-2 font-body text-sm lowercase tracking-[0.08em] text-white/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.5 }}
          >
            for: {nightTitle.toLowerCase()}
          </motion.p>
        )}
      </div>
      <p className="mt-1 font-body text-xs lowercase tracking-[0.12em] text-white/40">tap to skip</p>
    </motion.div>
  );
}

export function OfferDetail({ offerId, instanceId, expiresAt, status, host, date, stops, vibeTags, night = null, lockId = null, photos = [], prompts = [], interestedCount = 1 }: OfferDetailProps) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [gate, setGate] = useState<GateReason | null>(null);
  // Founder rule: the "the night" header taps open the FULL plan sheet.
  const [planOpen, setPlanOpen] = useState(false);
  // Reveal-at-pick: play the un-blur ceremony ONCE per offer per session. Same
  // pattern as the lock page's justLocked gate, but local: a sessionStorage marker
  // keyed on the offer id flips after the first mount, so refreshes and return
  // visits render the clear card statically (Pitfall 5 — no replay).
  const [ceremony] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const key = `offer-reveal-${offerId}`;
    try {
      if (window.sessionStorage.getItem(key)) return false;
      window.sessionStorage.setItem(key, '1');
      return true;
    } catch {
      return false;
    }
  });
  // Full-motion users get the ceremony overlay; the inline card stays hidden
  // until it dissolves. Reduced motion never mounts it (plain fade below).
  // IMPORTANT: the overlay arms in an EFFECT, not in initial state — the server
  // renders without it (window is undefined there), so mounting it during
  // hydration is a server/client mismatch React resolves by dropping the
  // client-only branch. That bug shipped the v1 ceremony dead on prod.
  const [overlay, setOverlay] = useState(false);
  // Queue-guard (founder 2026-06-12): passing while people are lined up behind
  // you gets one honest "are you sure?" — the spot rolls to the next person.
  const [confirming, setConfirming] = useState<null | 'pass' | 'withdraw'>(null);
  // Founder rule: tapping the profile photo pops the gallery full screen.
  const [galleryOpen, setGalleryOpen] = useState(false);
  useEffect(() => {
    if (ceremony && !reduce && photos.length > 0) setOverlay(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const overlayActive = overlay;

  if (gate) return <AccountGate reason={gate} />;

  async function run(fn: () => Promise<unknown>, after: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      after();
    } catch (e) {
      if (e instanceof MatchError) {
        if (e.code === 'offer_expired') {
          toast.error(messageForCode(e.code));
          router.push('/feed');
          return;
        }
        if (e.code === 'account_gated') {
          setGate('generic');
          return;
        }
        toast.error(messageForCode(e.code));
      } else {
        toast.error("that didn't go through. try again?");
      }
    } finally {
      setBusy(false);
    }
  }

  const name = host.first_name.toLowerCase();
  const accent = vibePalette(vibeTags).accent;
  const actionBtn =
    'flex min-h-[48px] w-full items-center justify-center rounded-full font-body font-semibold lowercase transition focus-visible:outline-none disabled:opacity-50';

  return (
    <main className="flex min-h-dvh flex-col items-center bg-shell-base px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-12">
      <div className="mx-auto w-full max-w-[420px]">
        {/* The moment: the host CHOSE them. Name the act, not the transaction —
            "you've got an offer" read like a job posting (founder, 2026-06-10). */}
        <h1 className="font-heading text-4xl lowercase leading-[1.05] text-shell-ink">{name} picked you</h1>

        {status === 'active' && !expired && (
          /* The clock IS the page's second headline (founder 2026-06-12): a big
             ticking H:MM:SS plus WHY it exists — the spot rolls to the next
             person in line. Queue pressure shows only when someone's actually
             behind them (interestedCount counts every right-swipe incl. them). */
          <div className="mt-5 rounded-3xl bg-shell-pink/70 px-5 py-4 text-center">
            <ExpiryCountdown expiresAt={expiresAt} hero onExpire={() => setExpired(true)} />
            <p className="mt-1.5 font-body text-[13px] lowercase leading-snug text-shell-ink/75">
              to lock it in. pass or run out of time, and the spot goes to the next person in line.
            </p>
            {interestedCount > 1 && (
              <p className="mt-1 font-body text-xs font-semibold lowercase text-shell-accent">
                {interestedCount - 1 === 1 ? '1 person is' : `${interestedCount - 1} people are`} in line behind you
              </p>
            )}
          </div>
        )}

        {status === 'active' || status === 'accepted' ? (
          /* Reveal-at-pick (founder decision 2026-06-10): being chosen IS the reveal.
             The full clear ProfileCard renders inline — same component the lock reveal
             uses — wrapped in the RevealModal's un-blur dissolve (blur(12px)→0 + one
             pink glow), played once per offer (sessionStorage gate above). Reduced
             motion gets a short opacity cross-fade. Empty photos fall back to
             ProfileCard's initial-letter avatar — never a blur on this surface. */
          <div className="relative mt-6">
            <AnimatePresence>
              {overlayActive && (
                <PickedCeremony name={name} pronouns={host.pronouns ?? null} photoSrc={photos[0]} nightTitle={night?.title ?? null} hadOptions={interestedCount > 1} onDone={() => setOverlay(false)} />
              )}
            </AnimatePresence>
            <motion.div
              className="relative"
              data-offer-reveal
              initial={ceremony ? { opacity: 0, y: reduce ? 0 : 10 } : false}
              animate={overlayActive ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0.2 : 0.7, ease: REVEAL_EASE }}
            >
              <ProfileCard
                onPhotoTap={photos.length > 0 ? () => setGalleryOpen(true) : undefined}
                name={name}
                age={host.age}
                place={(host.neighborhood ?? host.city)?.toLowerCase() ?? null}
                pronouns={host.pronouns ?? null}
                photos={photos}
                vibe_tags={vibeTags ?? []}
                prompts={prompts}
                verification={(host.verification ?? undefined) as VerificationState | undefined}
                reliability_score={host.reliability_score ?? null}
              />
            </motion.div>

            {galleryOpen && (
              /* Founder rule (2026-06-12): tapping the photo opens HER PROFILE —
                 the full card (gallery, prompts, vibe tags), not a photo zoom. */
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`${name}'s profile`}
                className="fixed inset-0 z-[60] overflow-y-auto bg-shell-ink/60 px-4 py-8"
                onClick={() => setGalleryOpen(false)}
              >
                <div className="mx-auto max-w-[420px]" onClick={(e) => e.stopPropagation()}>
                  <ProfileCard
                    name={name}
                    age={host.age}
                    place={(host.neighborhood ?? host.city)?.toLowerCase() ?? null}
                    pronouns={host.pronouns ?? null}
                    occupation={host.occupation ?? null}
                    height_cm={host.height_cm ?? null}
                    photos={photos}
                    vibe_tags={vibeTags ?? []}
                    prompts={prompts}
                    verification={(host.verification ?? undefined) as VerificationState | undefined}
                    reliability_score={host.reliability_score ?? null}
                  />
                  <button
                    type="button"
                    onClick={() => setGalleryOpen(false)}
                    className="mx-auto mt-3 flex min-h-[44px] w-full items-center justify-center rounded-full font-body text-sm lowercase text-white/80 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
                  >
                    close
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Terminal states (passed/expired): the reveal grant has self-revoked, so
             keep the rung-2 hint — small blurred avatar (or initial chip) + name. */
          <div className="mt-6 flex items-center gap-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-2 ring-white/70 shadow-md">
              {host.photo_url ? (
                <Image
                  src={host.photo_url}
                  alt=""
                  fill
                  sizes="48px"
                  className={cn('object-cover', 'blur-[3px] scale-110')}
                  data-rung2-avatar
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-shell-accent/15 font-heading text-lg lowercase text-shell-accent">
                  {name.charAt(0)}
                </div>
              )}
            </div>
            <div>
              <p className="font-body text-lg font-semibold lowercase text-shell-ink">
                {name}{host.age ? `, ${host.age}` : ''}
              </p>
              {host.city && <p className="font-body text-sm text-shell-ink/65">{host.city.toLowerCase()}</p>}
            </div>
          </div>
        )}

        <div className="mt-6">
          {/* Founder rule: the header (eyebrow + title) is a real ≥44px tap target
              that opens the FULL plan sheet. Stretched overlay over the header ONLY
              (the timeline below holds links — nested interactive elements are
              invalid). No night row ⇒ static label, never a dead tap. */}
          {night ? (
            <div className="group relative -m-2 flex min-h-[44px] items-center justify-between gap-3 rounded-2xl p-2 transition hover:bg-shell-pink/40 motion-reduce:transition-none">
              <div className="min-w-0">
                <p className="font-body text-sm text-shell-accent">the night</p>
                {night.title && (
                  <h2 className="mt-1 font-heading text-2xl lowercase leading-tight text-shell-ink">{night.title.toLowerCase()}</h2>
                )}
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-shell-ink/40 transition group-hover:translate-x-0.5 group-hover:text-shell-ink/70 motion-reduce:transition-none" aria-hidden />
              <button
                type="button"
                onClick={() => setPlanOpen(true)}
                className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
              >
                <span className="sr-only">see the full plan</span>
              </button>
            </div>
          ) : (
            <p className="font-body text-sm text-shell-accent">the night</p>
          )}
          <p className="mt-1 font-body text-base text-shell-ink">
            {date ? <LocalTime iso={date.startsAt} opts={DATE_OPTS} /> : 'details unlock when you accept'}
          </p>
          {stops.length > 0 ? (
            <div className="mt-4">
              <PlanTimeline stops={stops} accent={accent} vibeTags={vibeTags} />
            </div>
          ) : (
            <p className="mt-3 font-body text-sm text-shell-ink/60">the full plan unlocks here.</p>
          )}
        </div>

        {/* The FULL plan view — the canonical feed sheet, read-only (no onCommit),
            fed by the SSR itinerary read (`preloaded`; get_night_detail is
            blind/pre-swipe-only). PRE-lock blind contract: linkSlugs stays OFF. */}
        {night && (
          <NightDetailSheet
            night={feedNightFromDetail(night)}
            preloaded={night}
            open={planOpen}
            onOpenChange={setPlanOpen}
          />
        )}

        {status === 'accepted' && (
          <div className="mt-8 flex flex-col gap-3">
            <p className="font-body text-base font-semibold lowercase text-shell-ink">you&rsquo;re locked in.</p>
            <Link
              href={lockId ? `/matches/${lockId}` : '/matches'}
              className={cn(actionBtn, 'bg-shell-accent text-white focus-visible:ring-4 focus-visible:ring-shell-accent/40')}
            >
              see your match
            </Link>
          </div>
        )}

        {(status === 'passed' || status === 'expired') && (
          <p className="mt-8 font-body text-sm text-shell-ink/70">
            {status === 'passed' ? 'you passed on this one.' : 'this one expired.'}{' '}
            <Link href="/feed" className="text-shell-accent underline">back to the feed</Link>
          </p>
        )}

        {status === 'active' && (
          <>
            {expired && (
              <p className="mt-4 font-body text-sm text-shell-ink/70">
                this one slipped away. <Link href="/feed" className="text-shell-accent underline">back to the feed</Link>
              </p>
            )}

            <div className="mt-8 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy || expired}
                onClick={() => void run(async () => {
                  // Reveal-at-pick: the ceremony already played HERE, so the redirect
                  // stays plain (no ?just=1) and /matches/<lock> opens static.
                  const newLockId = await acceptOffer(offerId);
                  router.push(`/matches/${newLockId}`);
                }, () => {})}
                className={cn(actionBtn, 'bg-shell-accent text-white focus-visible:ring-4 focus-visible:ring-shell-accent/40')}
              >
                lock it in
              </button>
              <button
                type="button"
                disabled={busy || expired}
                onClick={() => {
                  if (interestedCount > 1) { setConfirming('pass'); return; }
                  void run(() => passOffer(offerId), () => router.push('/feed'));
                }}
                className={cn(actionBtn, 'text-shell-ink/70 focus-visible:ring-4 focus-visible:ring-shell-ink/30')}
              >
                pass
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (interestedCount > 1) { setConfirming('withdraw'); return; }
                  void run(
                    () => (instanceId ? withdraw(instanceId) : passOffer(offerId)),
                    () => router.push('/feed'),
                  );
                }}
                className="mt-1 min-h-[44px] font-body text-sm lowercase text-shell-ink/50 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/20 disabled:opacity-50"
              >
                not interested
              </button>

              {confirming && (
                <div
                  role="alertdialog"
                  aria-modal="true"
                  aria-label="are you sure you want to give up your spot?"
                  className="fixed inset-0 z-[60] flex items-end justify-center bg-shell-ink/50 px-5 pb-[calc(2rem+env(safe-area-inset-bottom))]"
                  onClick={() => setConfirming(null)}
                >
                  <div
                    className="w-full max-w-[420px] rounded-3xl bg-shell-base p-6 text-center shadow-fun"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="font-heading text-2xl lowercase text-shell-ink">wait — you're first in line</p>
                    <p className="mt-2 font-body text-sm lowercase leading-snug text-shell-ink/75">
                      {interestedCount - 1 === 1 ? '1 person is' : `${interestedCount - 1} people are`} lined up behind you for this date.
                      {' '}pass, and the next person takes your spot — there's no getting back in line.
                    </p>
                    <div className="mt-5 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className={cn(actionBtn, 'bg-shell-accent text-white focus-visible:ring-4 focus-visible:ring-shell-accent/40')}
                      >
                        keep my spot
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const which = confirming;
                          setConfirming(null);
                          void run(
                            () => (which === 'withdraw' && instanceId ? withdraw(instanceId) : passOffer(offerId)),
                            () => router.push('/feed'),
                          );
                        }}
                        className={cn(actionBtn, 'text-shell-ink/60 focus-visible:ring-4 focus-visible:ring-shell-ink/30')}
                      >
                        {confirming === 'withdraw' ? "i'm not interested" : 'pass anyway'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

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
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
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
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;

export function OfferDetail({ offerId, instanceId, expiresAt, status, host, date, stops, vibeTags, night = null, lockId = null, photos = [], prompts = [] }: OfferDetailProps) {
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

        {status === 'active' || status === 'accepted' ? (
          /* Reveal-at-pick (founder decision 2026-06-10): being chosen IS the reveal.
             The full clear ProfileCard renders inline — same component the lock reveal
             uses — wrapped in the RevealModal's un-blur dissolve (blur(12px)→0 + one
             pink glow), played once per offer (sessionStorage gate above). Reduced
             motion gets a short opacity cross-fade. Empty photos fall back to
             ProfileCard's initial-letter avatar — never a blur on this surface. */
          <div className="relative mt-6">
            {ceremony && photos.length > 0 && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-2 mx-auto h-40 w-40 rounded-full bg-shell-accent/25 blur-3xl"
                initial={!reduce ? { opacity: 0, scale: 0.85 } : false}
                animate={{ opacity: 1, scale: 1 }}
                transition={!reduce ? { duration: 0.6, delay: 0.2, ease: REVEAL_EASE } : undefined}
              />
            )}
            <motion.div
              className="relative"
              data-offer-reveal
              initial={
                ceremony && !reduce && photos.length > 0
                  ? { filter: 'blur(12px)', scale: 1.02, opacity: 0.85 }
                  : ceremony && reduce
                    ? { opacity: 0 }
                    : false
              }
              animate={
                ceremony && !reduce && photos.length > 0
                  ? { filter: 'blur(0px)', scale: 1, opacity: 1 }
                  : { opacity: 1 }
              }
              transition={
                ceremony && !reduce && photos.length > 0
                  ? { duration: 0.9, ease: REVEAL_EASE }
                  : ceremony && reduce
                    ? { duration: 0.2, ease: 'easeOut' }
                    : undefined
              }
            >
              <ProfileCard
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
            <div className="mt-4">
              <ExpiryCountdown expiresAt={expiresAt} onExpire={() => setExpired(true)} />
            </div>

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
                onClick={() => void run(() => passOffer(offerId), () => router.push('/feed'))}
                className={cn(actionBtn, 'text-shell-ink/70 focus-visible:ring-4 focus-visible:ring-shell-ink/30')}
              >
                pass
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(
                  () => (instanceId ? withdraw(instanceId) : passOffer(offerId)),
                  () => router.push('/feed'),
                )}
                className="mt-1 min-h-[44px] font-body text-sm lowercase text-shell-ink/50 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/20 disabled:opacity-50"
              >
                not interested
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

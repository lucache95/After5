// apps/web/app/offers/[offerId]/OfferDetail.tsx
// Candidate's offer screen (spec §4.2). Shows the host's Tier-3 reveal + the
// offered date (or a degrade line when the date row is RLS-hidden), an expiry
// countdown, and the three actions: accept (→ /matches/<lock>), pass (→ /feed),
// and not-interested (withdraw the queue entry, or pass if the instance id is
// hidden). Edge failures arrive as MatchError keyed on the string `code`:
// offer_expired toasts + bounces to the feed, account_gated swaps in an inline
// AccountGate, everything else toasts in place. Barbiecore, lowercase copy.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { acceptOffer, passOffer, withdraw, MatchError, messageForCode } from '@/lib/after5/match';
import { vibePalette } from '@after5/business';
import { ExpiryCountdown } from './ExpiryCountdown';
import { AccountGate, type GateReason } from './AccountGate';
import { LocalTime } from '@/components/LocalTime';
import { PlanTimeline } from '@/components/PlanTimeline';
import type { NightDetailStop } from '@/lib/after5/client';

export interface OfferDetailProps {
  offerId: string;
  instanceId: string | null;
  expiresAt: string;
  status: 'active' | 'accepted' | 'passed' | 'expired';
  host: { first_name: string; age: number | null; city: string | null; photo_url: string | null };
  date: { startsAt: string } | null;
  // E13: the matched night's full itinerary, normalized at the loader boundary
  // (the SSR page reads itineraries.stops by id and runs normalizeNightDetailStops
  // BEFORE passing — PlanTimeline must NOT re-normalize, D-12/03-04). Empty ⇒ degrade.
  stops: NightDetailStop[];
  vibeTags: string[] | null;
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

export function OfferDetail({ offerId, instanceId, expiresAt, host, date, stops, vibeTags }: OfferDetailProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [gate, setGate] = useState<GateReason | null>(null);

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

        <div className="mt-6 flex items-center gap-3">
          {/* Rung-2 host hint (REQ-E15 / D-03): a small 48px blurred avatar, secondary
              to the night below. CSS blur(3px) over the already-blurred signed asset,
              one step softer than the feed's rung-1 blur(8px), so the face begins to
              resolve as a match reward without revealing the clear photo. A null photo
              falls back to an initial chip, never a broken image. */}
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

        <div className="mt-6">
          <p className="font-body text-sm text-shell-accent">the night</p>
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
              const lockId = await acceptOffer(offerId);
              router.push(`/matches/${lockId}`);
            }, () => {})}
            className={cn(actionBtn, 'bg-shell-accent text-white focus-visible:ring-4 focus-visible:ring-shell-accent/40')}
          >
            accept
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
      </div>
    </main>
  );
}

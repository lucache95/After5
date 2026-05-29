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
import Link from 'next/link';
import { toast } from 'sonner';
import { Polaroid } from '@/components/Polaroid';
import { cn } from '@/lib/cn';
import { acceptOffer, passOffer, withdraw, MatchError, messageForCode } from '@/lib/after5/match';
import { ExpiryCountdown } from './ExpiryCountdown';
import { AccountGate, type GateReason } from './AccountGate';

export interface OfferDetailProps {
  offerId: string;
  instanceId: string | null;
  expiresAt: string;
  status: 'active' | 'accepted' | 'passed' | 'expired';
  host: { first_name: string; age: number | null; city: string | null; photo_url: string | null; bio: string | null };
  date: { startsAt: string } | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function OfferDetail({ offerId, instanceId, expiresAt, host, date }: OfferDetailProps) {
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
  const actionBtn =
    'flex min-h-[48px] w-full items-center justify-center rounded-full font-body font-semibold lowercase transition focus-visible:outline-none disabled:opacity-50';

  return (
    <main className="flex min-h-dvh flex-col items-center bg-shell-base px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-12">
      <div className="mx-auto w-full max-w-[420px]">
        <h1 className="font-heading text-4xl lowercase leading-[1.05] text-shell-ink">you&apos;ve got an offer</h1>

        <div className="mt-6 flex items-start gap-4">
          <Polaroid
            src={host.photo_url ?? '/places/place-walk.jpg'}
            alt={host.first_name}
            size="sm"
            tone="dating"
          />
          <div>
            <p className="font-body text-lg font-semibold lowercase text-shell-ink">
              {name}{host.age ? `, ${host.age}` : ''}
            </p>
            {host.city && <p className="font-body text-sm text-shell-ink/65">{host.city.toLowerCase()}</p>}
            {host.bio && <p className="mt-2 font-body text-sm text-shell-ink/80">{host.bio}</p>}
          </div>
        </div>

        <div className="mt-6">
          <p className="font-body text-sm text-shell-accent">the night</p>
          <p className="mt-1 font-body text-base text-shell-ink">
            {date ? formatDate(date.startsAt) : 'details unlock when you accept'}
          </p>
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

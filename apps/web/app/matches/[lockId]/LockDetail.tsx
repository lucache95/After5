'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { Polaroid } from '@/components/Polaroid';
import { LocalTime } from '@/components/LocalTime';
import { cn } from '@/lib/cn';
import { cancelLock, MatchError, messageForCode } from '@/lib/after5/match';
import { CancelWithReasonPicker, type CancelReason } from '@/app/dates/[slug]/interested/CancelWithReasonPicker';
import type { LockRowWithParties, PartyProfile, RevealPrompt } from '../lock-view';
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
  // their labels, both prepared server-side on the reveal page. The header
  // thumbnail uses photos[0] (a real signed URL — fixes the long-standing
  // raw-private-path bug where the reveal photo never loaded).
  photos?: string[];
  prompts?: RevealPrompt[];
}

const WHEN_OPTS: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

export function LockDetail({ lockId, status, counterpart, threadId, startsAt, ratingOpen, justLocked, photos = [], prompts = [] }: LockDetailProps) {
  const router = useRouter();
  const [revealOpen, setRevealOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = counterpart.first_name ?? 'your match';

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

  return (
    <main className="mx-auto w-full max-w-[480px] space-y-6 px-4 py-6">
      <MatchConfirmation name={name} show={justLocked} />

      <header className="flex items-center gap-4">
        <Polaroid src={photos[0] ?? ''} alt={name} size="md" tone="dating" />
        <div className="min-w-0">
          <h1 className="truncate font-heading text-3xl lowercase text-shell-ink">{name}</h1>
          <LocalTime iso={startsAt} opts={WHEN_OPTS} fallback="date tbd" className="block font-body text-shell-ink/70" />
        </div>
      </header>

      <button
        type="button"
        onClick={() => setRevealOpen(true)}
        className="w-full rounded-full bg-shell-pink px-6 py-3 font-body font-semibold lowercase text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
      >
        see their profile
      </button>
      <RevealModal open={revealOpen} onOpenChange={setRevealOpen} person={counterpart} photos={photos} prompts={prompts} />

      {threadId ? (
        <Link
          href={`/messages/${threadId}`}
          className="block w-full rounded-full bg-shell-accent px-6 py-3 text-center font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          message {name}
        </Link>
      ) : (
        <p className="rounded-3xl bg-shell-ink/5 p-4 text-center font-body text-sm text-shell-ink/60">
          chat will open up here.
        </p>
      )}

      {ratingOpen && status !== 'cancelled' && (
        <Link
          href={`/matches/${lockId}/rate`}
          className="block w-full rounded-full bg-shell-accent px-6 py-3 text-center font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          rate this date
        </Link>
      )}

      {status === 'active' && (
        <>
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="w-full rounded-full border-2 border-shell-ink/20 px-6 py-3 font-body font-semibold lowercase text-shell-ink/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
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
        <p className={cn('rounded-3xl bg-shell-ink/5 p-4 text-center font-body text-shell-ink/60')}>this date was cancelled.</p>
      )}
    </main>
  );
}

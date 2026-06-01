'use client';
import Link from 'next/link';
import { Polaroid } from '@/components/Polaroid';
import { cn } from '@/lib/cn';
import { LocalTime } from '@/components/LocalTime';
import { lockStatusLabel, type LockRowWithParties, type PartyProfile } from './lock-view';

export interface MatchCard {
  id: string;
  status: LockRowWithParties['status'];
  counterpart: PartyProfile | null;
  startsAt: string | null;
}

const WHEN_OPTS: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

function Card({ card }: { card: MatchCard }) {
  const name = card.counterpart?.first_name ?? 'someone';
  const past = card.status !== 'active';
  return (
    <Link
      href={`/matches/${card.id}`}
      className={cn(
        'flex items-center gap-4 rounded-3xl border-2 border-shell-ink/10 bg-white p-3 transition',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 hover:border-shell-ink/25',
        past && 'opacity-70',
      )}
    >
      <Polaroid src={card.counterpart?.clear_photo_url ?? ''} alt={name} size="sm" tone="dating" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-xl lowercase text-shell-ink">{name}</p>
        <LocalTime iso={card.startsAt} opts={WHEN_OPTS} fallback="date tbd" className="block truncate font-body text-sm text-shell-ink/65" />
      </div>
      <span className="shrink-0 rounded-full bg-shell-pink px-3 py-1 font-body text-xs font-semibold lowercase text-shell-ink">
        {lockStatusLabel(card.status)}
      </span>
    </Link>
  );
}

export function MatchesList({ active, past }: { active: MatchCard[]; past: MatchCard[] }) {
  if (active.length === 0 && past.length === 0) {
    return (
      <div className="mx-auto max-w-[420px] py-16 text-center">
        <h1 className="font-heading text-4xl lowercase text-shell-ink">no locked dates yet</h1>
        <p className="mt-3 font-body text-shell-ink/70">when you match, it shows up here.</p>
        <Link href="/feed" className="mt-6 inline-block rounded-full bg-shell-accent px-6 py-3 font-body font-semibold lowercase text-white">
          browse dates
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[480px] space-y-8 px-4 py-6">
      <h1 className="font-heading text-4xl lowercase text-shell-ink">your matches</h1>
      {active.length > 0 && (
        <section aria-label="active matches" className="space-y-3">
          <h2 className="font-body text-sm font-semibold uppercase tracking-wide text-shell-ink/50">locked in</h2>
          {active.map((c) => <Card key={c.id} card={c} />)}
        </section>
      )}
      {past.length > 0 && (
        <section aria-label="past matches" className="space-y-3">
          <h2 className="font-body text-sm font-semibold uppercase tracking-wide text-shell-ink/50">past</h2>
          {past.map((c) => <Card key={c.id} card={c} />)}
        </section>
      )}
    </div>
  );
}

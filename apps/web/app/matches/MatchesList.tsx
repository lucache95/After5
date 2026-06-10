'use client';
// The dates-tab list body (/matches). Two sections, upcoming first then past,
// bucketed server-side by the night's starts_at. Each card sells the night AND
// the person: the counterpart's clear photo in a mini tilted polaroid frame
// (matches are post-lock, so clear is correct here), falling back to the brand
// initial-avatar — never a name-stamped blank polaroid. The whole card links to
// /matches/[lockId] via a stretched link; a ratable lock swaps the status chip
// for a sibling "rate it →" CTA layered above it (nested <a> is invalid HTML).
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/cn';
import { stickerRotation } from '@/lib/sticker';
import { LocalTime } from '@/components/LocalTime';
import { matchChipLabel, type LockRowWithParties, type PartyProfile } from './lock-view';

export interface MatchCard {
  id: string;
  status: LockRowWithParties['status'];
  counterpart: PartyProfile | null;
  startsAt: string | null;
  /** Itinerary title surfaced through the existing instance embed (one query). */
  nightTitle: string | null;
  /** Server-derived: rating window open and the lock wasn't cancelled. */
  ratable: boolean;
}

// "mon, jun 1 · 1:44 pm" — dry, lowercase, viewer-local (DESIGN-SYSTEM §3).
function whenLabel(d: Date): string {
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`.toLowerCase();
}

// Mini polaroid avatar: white frame, deterministic -3°..+3° tilt (§5), the
// clear photo inside. No photo → the brand initial-avatar treatment (pink wash
// + lowercase Caprasimo initial), same as the inbox rows. Decorative — the
// name sits right next to it, so the whole frame is aria-hidden.
function PolaroidAvatar({ photo, name, seed, faded }: { photo: string | null; name: string; seed: string; faded: boolean }) {
  const initial = (name.trim()[0] ?? '?').toLowerCase();
  return (
    <span
      aria-hidden
      className="block shrink-0 bg-white p-1 pb-2.5 shadow-md ring-1 ring-shell-ink/10"
      style={{ transform: `rotate(${stickerRotation(seed)}deg)` }}
    >
      <span className="relative block h-16 w-16 overflow-hidden bg-shell-pink">
        <span className="absolute inset-0 flex items-center justify-center font-heading text-2xl lowercase text-shell-accent">
          {initial}
        </span>
        {photo && (
          <Image
            src={photo}
            alt=""
            fill
            sizes="64px"
            className={cn('object-cover', faded && 'grayscale-[0.35]')}
          />
        )}
      </span>
    </span>
  );
}

function Card({ card, upcoming }: { card: MatchCard; upcoming: boolean }) {
  const name = (card.counterpart?.first_name ?? 'someone').toLowerCase();
  const title = card.nightTitle?.toLowerCase() ?? null;
  return (
    <div className="relative flex items-center gap-3.5 rounded-3xl border-2 border-shell-ink/10 bg-white p-3.5 shadow-fun transition hover:border-shell-accent/40">
      <PolaroidAvatar
        photo={card.counterpart?.clear_photo_url ?? null}
        name={name}
        seed={card.id}
        faded={!upcoming}
      />

      <div className="min-w-0 flex-1">
        {/* Stretched link — the whole card taps through to the match detail. */}
        <Link
          href={`/matches/${card.id}`}
          aria-label={`your date with ${name}`}
          className="focus-visible:outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-4 focus-visible:after:ring-shell-accent/40"
        >
          <span className="block truncate font-heading text-xl leading-tight lowercase text-shell-ink">{name}</span>
        </Link>
        {title && <p className="mt-0.5 truncate font-body text-sm text-shell-ink/70">{title}</p>}
        <LocalTime
          iso={card.startsAt}
          format={whenLabel}
          fallback="date tbd"
          className="mt-0.5 block truncate font-body text-xs text-shell-ink/50"
        />
      </div>

      {card.ratable ? (
        <Link
          href={`/matches/${card.id}/rate`}
          className="relative z-10 flex min-h-[44px] shrink-0 items-center rounded-full bg-shell-accent px-4 font-body text-xs font-semibold lowercase text-white shadow-fun transition hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
        >
          rate it →
        </Link>
      ) : (
        <span
          className={cn(
            'shrink-0 rounded-full px-3 py-1 font-body text-xs font-semibold lowercase',
            upcoming ? 'bg-shell-pink text-shell-ink' : 'bg-shell-ink/5 text-shell-ink/55',
          )}
        >
          {matchChipLabel(card.status, upcoming)}
        </span>
      )}
    </div>
  );
}

export function MatchesList({ upcoming, past }: { upcoming: MatchCard[]; past: MatchCard[] }) {
  const empty = upcoming.length === 0 && past.length === 0;
  return (
    <>
      <h1 className="font-heading text-4xl lowercase text-shell-ink">your dates</h1>
      <p className="mt-2 font-body text-sm text-shell-ink/60">people you&apos;ve locked in with. don&apos;t be late.</p>

      {empty ? (
        <div className="mt-10 rounded-3xl border-2 border-dashed border-shell-accent/30 bg-shell-pink/50 px-6 py-14 text-center">
          <p className="font-heading text-3xl leading-tight lowercase text-shell-ink">no matches yet.</p>
          <p className="mx-auto mt-2 max-w-[16rem] font-body text-sm text-shell-ink/65">the nights are waiting.</p>
          <Link
            href="/feed"
            className="mt-6 inline-block rounded-full bg-shell-accent px-7 py-3 font-body font-semibold lowercase text-white shadow-fun transition hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
            browse tonight&apos;s nights
          </Link>
        </div>
      ) : (
        <div className="mt-7 space-y-9">
          {upcoming.length > 0 && (
            <section aria-label="upcoming dates" className="space-y-3.5">
              <h2 className="font-heading text-2xl lowercase text-shell-ink">upcoming</h2>
              {upcoming.map((c) => <Card key={c.id} card={c} upcoming />)}
            </section>
          )}
          {past.length > 0 && (
            <section aria-label="past dates" className="space-y-3.5">
              <h2 className="font-heading text-2xl lowercase text-shell-ink">past</h2>
              {past.map((c) => <Card key={c.id} card={c} upcoming={false} />)}
            </section>
          )}
        </div>
      )}
    </>
  );
}

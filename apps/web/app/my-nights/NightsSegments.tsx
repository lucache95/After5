'use client';
// apps/web/app/my-nights/NightsSegments.tsx
// E25 (D-02 scoped): a two-segment upcoming/archive toggle over the host's own
// already-fetched nights. NO second DB query — the page passes the full list and
// this leaf buckets it in memory by date_instances.status:
//   upcoming = seeking | matched | active   (live)
//   archive  = completed | expired | cancelled   (past)
// Archive rows reuse the SAME NightCard row + lifecycleLabel corner chip — no new
// card design. An empty archive shows the funny empty state (UI-SPEC §Copywriting).
import { useState } from 'react';
import { CalendarHeart, Heart } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { LocalTime } from '@/components/LocalTime';
import { cn } from '@/lib/cn';
import { coverImageForNight } from '@/lib/place-image';
import { NightCardActions, type VenueOption, type AmbientOption } from './NightCardActions';

export interface NightRow {
  id: string;
  starts_at: string;
  status: string;
  duration_min: number | null;
  venue_id: string | null;
  ambient_sound_id: string | null;
  itinerary: {
    title: string | null;
    cover_image_url: string | null;
    inputs: { vibe?: string[] } | null;
  } | null;
}

type Bucket = 'upcoming' | 'archive';

// Bucket membership over date_instances.status. Kept as plain sets so the
// archive-bucket test can assert the contract directly.
const UPCOMING_STATUSES = new Set(['seeking', 'matched', 'active']);
const ARCHIVE_STATUSES = new Set(['completed', 'expired', 'cancelled']);

export function bucketForStatus(status: string): Bucket | null {
  if (UPCOMING_STATUSES.has(status)) return 'upcoming';
  if (ARCHIVE_STATUSES.has(status)) return 'archive';
  return null;
}

const WHEN_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

// Lifecycle label for the corner chip when a night isn't actively seeking.
function lifecycleLabel(status: string): string {
  switch (status) {
    case 'matched': return 'matched';
    case 'completed': return 'done';
    case 'cancelled': return 'cancelled';
    case 'expired': return 'expired';
    case 'seeking': return 'open';
    default: return status;
  }
}

function NightCard({ night, interested, venues, ambientSounds }: { night: NightRow; interested: number; venues: VenueOption[]; ambientSounds: AmbientOption[] }) {
  const title = night.itinerary?.title?.toLowerCase() ?? 'your night out';
  // Guarantee a tasteful, on-theme banner — never a flat pink placeholder.
  const cover = coverImageForNight({
    cover_image_url: night.itinerary?.cover_image_url,
    vibe_tags: night.itinerary?.inputs?.vibe,
    seedKey: night.id,
  });

  // Corner chip: a matched night reads "matched"; an open night with people in
  // the queue surfaces the count (more useful than "open"); everything else
  // shows its lifecycle label.
  const seeking = night.status === 'seeking';
  let chipText: string;
  let chipClass: string;
  if (night.status === 'matched') {
    chipText = 'matched';
    chipClass = 'bg-white text-shell-accent';
  } else if (seeking && interested > 0) {
    chipText = `${interested} interested`;
    chipClass = 'bg-shell-accent text-white';
  } else if (seeking) {
    chipText = 'open';
    chipClass = 'bg-white text-shell-ink';
  } else {
    chipText = lifecycleLabel(night.status);
    chipClass = 'bg-white text-shell-ink/55';
  }

  return (
    <div>
    <Link
      href={`/dates/${night.id}/interested`}
      className="group block overflow-hidden rounded-3xl border-2 border-shell-ink/10 bg-white shadow-fun transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 hover:border-shell-accent/40 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <div className="relative h-36 w-full overflow-hidden bg-shell-pink">
        <Image
          src={cover}
          alt=""
          fill
          sizes="420px"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          draggable={false}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(61,15,46,0) 45%, rgba(61,15,46,0.55) 100%)' }}
          aria-hidden
        />
        <span
          className={`absolute right-3 top-3 rounded-full px-3 py-1 font-body text-xs font-semibold lowercase shadow-md ${chipClass}`}
        >
          {chipText}
        </span>
      </div>

      <div className="px-4 pb-4 pt-3">
        <p className="line-clamp-2 font-heading text-xl leading-tight lowercase text-shell-ink">{title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-sm text-shell-ink/65">
          <span className="flex items-center gap-1.5">
            <CalendarHeart className="h-4 w-4 shrink-0 text-shell-accent" aria-hidden />
            <LocalTime iso={night.starts_at} opts={WHEN_OPTS} />
          </span>
          <span className="flex items-center gap-1.5">
            <Heart className="h-4 w-4 shrink-0 text-shell-accent" aria-hidden />
            {interested === 1 ? '1 interested' : `${interested} interested`}
          </span>
        </div>
      </div>
    </Link>

      {/* Host controls (E6/E7): cancel + edit, rendered ONLY on the host's own
          seeking night. NightCardActions returns null for any other status, so
          this row is invisible on matched/completed/expired/cancelled cards. */}
      {seeking && (
        <div className="mt-2.5">
          <NightCardActions
            night={{
              id: night.id,
              starts_at: night.starts_at,
              status: night.status,
              duration_min: night.duration_min,
              venue_id: night.venue_id,
              ambient_sound_id: night.ambient_sound_id,
            }}
            venues={venues}
            ambientSounds={ambientSounds}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The host's posted-nights list with an upcoming/archive segment toggle.
 * Buckets the already-fetched rows in memory; archive defaults to empty copy.
 */
export function NightsSegments({
  nights,
  counts,
  venues,
  ambientSounds,
}: {
  nights: NightRow[];
  /** date_instance_id → interested tally, computed server-side. */
  counts: Record<string, number>;
  venues: VenueOption[];
  ambientSounds: AmbientOption[];
}) {
  const [bucket, setBucket] = useState<Bucket>('upcoming');

  const upcoming = nights.filter((n) => bucketForStatus(n.status) === 'upcoming');
  const archive = nights.filter((n) => bucketForStatus(n.status) === 'archive');
  const shown = bucket === 'upcoming' ? upcoming : archive;

  return (
    <>
      <div
        role="tablist"
        aria-label="upcoming or archived nights"
        className="mt-6 flex gap-1 rounded-full bg-shell-ink/5 p-1"
      >
        {(['upcoming', 'archive'] as const).map((seg) => {
          const active = bucket === seg;
          return (
            <button
              key={seg}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setBucket(seg)}
              className={cn(
                'min-h-[44px] flex-1 rounded-full px-5 font-body text-sm font-semibold lowercase transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none',
                active
                  ? 'bg-shell-accent text-white shadow-fun'
                  : 'text-shell-ink/60 hover:text-shell-ink',
              )}
            >
              {seg}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        bucket === 'archive' ? (
          <div className="mt-10 rounded-3xl border-2 border-dashed border-shell-accent/30 bg-shell-pink/50 px-6 py-12 text-center">
            <p className="font-heading text-2xl lowercase text-shell-ink">nothing in the rear-view yet</p>
            <p className="mx-auto mt-2 max-w-[18rem] font-body text-sm text-shell-ink/65">
              your past nights and matches land here once they wrap.
            </p>
          </div>
        ) : (
          <div className="mt-10 rounded-3xl border-2 border-dashed border-shell-accent/30 bg-shell-pink/50 px-6 py-12 text-center">
            <p className="font-heading text-2xl lowercase text-shell-ink">nothing posted yet</p>
            <p className="mx-auto mt-2 max-w-[16rem] font-body text-sm text-shell-ink/65">
              put a night out there and people nearby can slide in.
            </p>
            <Link
              href="/nights/new"
              className="mt-6 inline-block rounded-full bg-shell-accent px-7 py-3 font-body font-semibold lowercase text-white shadow-fun transition hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              post your first night
            </Link>
          </div>
        )
      ) : (
        <section aria-label="your posted nights" className="mt-6 space-y-4">
          {shown.map((night) => (
            <NightCard
              key={night.id}
              night={night}
              interested={counts[night.id] ?? 0}
              venues={venues}
              ambientSounds={ambientSounds}
            />
          ))}
        </section>
      )}
    </>
  );
}

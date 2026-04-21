'use client';

// Client-side filter + grid for the /dates catalog. URL params sync (so
// shares preserve filter state) but no refetch — all data is fetched
// server-side once and filtered in memory. Keeps the page fast and
// indexable while letting users narrow by vibe/price/duration/location.

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { coverImageFor } from '@/lib/place-image';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/relative-time';

export interface DateRow {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
  inputs?: { vibe?: string[]; location?: 'out' | 'home' } | null;
  generated_at?: string | null;
}

const VIBE_OPTIONS = [
  'romantic', 'chill', 'adventurous', 'boujee', 'cozy', 'spontaneous', 'lively', 'intimate',
];
const PRICE_OPTIONS = [
  { id: 'cheap',    label: '$0–50',    test: (n: number) => n <= 50 },
  { id: 'mid',      label: '$50–150',  test: (n: number) => n > 50 && n <= 150 },
  { id: 'splurge',  label: '$150+',    test: (n: number) => n > 150 },
];
const DURATION_OPTIONS = [
  { id: 'short',  label: '≤2 hr',  test: (m: number) => m <= 120 },
  { id: 'medium', label: '2–4 hr', test: (m: number) => m > 120 && m <= 240 },
  { id: 'long',   label: '4 hr+',  test: (m: number) => m > 240 },
];
const LOCATION_OPTIONS = [
  { id: 'out',  label: 'Out and about' },
  { id: 'home', label: 'At home' },
];

export function DatesFilter({ items }: { items: DateRow[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const selectedVibes = (params.get('vibe') ?? '').split(',').filter(Boolean);
  const selectedPrice = params.get('price');
  const selectedDuration = params.get('duration');
  const selectedLocation = params.get('location');

  function update(key: string, value: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (value && value.length > 0) sp.set(key, value);
    else sp.delete(key);
    router.replace(`/dates?${sp.toString()}`, { scroll: false });
  }

  function toggleVibe(v: string) {
    const next = selectedVibes.includes(v)
      ? selectedVibes.filter((x) => x !== v)
      : [...selectedVibes, v];
    update('vibe', next.join(','));
  }

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (selectedVibes.length > 0) {
        const itVibes = it.inputs?.vibe ?? [];
        if (!selectedVibes.some((v) => itVibes.includes(v))) return false;
      }
      if (selectedPrice) {
        const opt = PRICE_OPTIONS.find((p) => p.id === selectedPrice);
        if (opt && !opt.test(it.total_cost_pp ?? 0)) return false;
      }
      if (selectedDuration) {
        const opt = DURATION_OPTIONS.find((d) => d.id === selectedDuration);
        if (opt && !opt.test(it.total_duration_min ?? 0)) return false;
      }
      if (selectedLocation) {
        if ((it.inputs?.location ?? 'out') !== selectedLocation) return false;
      }
      return true;
    });
  }, [items, selectedVibes, selectedPrice, selectedDuration, selectedLocation]);

  const hasFilters =
    selectedVibes.length > 0 || selectedPrice || selectedDuration || selectedLocation;

  return (
    <>
      {/* Filter bar */}
      <div className="mb-12 space-y-5 rounded-card border border-border bg-surface p-5 md:p-7">
        <FilterRow label="Vibe">
          {VIBE_OPTIONS.map((v) => (
            <Chip
              key={v}
              active={selectedVibes.includes(v)}
              onClick={() => toggleVibe(v)}
              label={v}
            />
          ))}
        </FilterRow>
        <FilterRow label="Price">
          {PRICE_OPTIONS.map((p) => (
            <Chip
              key={p.id}
              active={selectedPrice === p.id}
              onClick={() => update('price', selectedPrice === p.id ? null : p.id)}
              label={p.label}
            />
          ))}
        </FilterRow>
        <FilterRow label="Duration">
          {DURATION_OPTIONS.map((d) => (
            <Chip
              key={d.id}
              active={selectedDuration === d.id}
              onClick={() => update('duration', selectedDuration === d.id ? null : d.id)}
              label={d.label}
            />
          ))}
        </FilterRow>
        <FilterRow label="Where">
          {LOCATION_OPTIONS.map((l) => (
            <Chip
              key={l.id}
              active={selectedLocation === l.id}
              onClick={() => update('location', selectedLocation === l.id ? null : l.id)}
              label={l.label}
            />
          ))}
        </FilterRow>

        {hasFilters && (
          <div className="flex items-center justify-between border-t border-border pt-4">
            <span className="text-sm text-muted [font-variant-numeric:tabular-nums]">
              {filtered.length} of {items.length} {filtered.length === 1 ? 'plan' : 'plans'}
            </span>
            <button
              type="button"
              onClick={() => router.replace('/dates', { scroll: false })}
              className="text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center text-base text-muted">
          No plans match these filters yet. Try widening the vibe or price.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-7">
          {filtered.map((it) => {
            const stops = (Array.isArray(it.stops) ? it.stops : []) as Array<{ place_type?: string; photo_url?: string | null }>;
            const cover = coverImageFor(stops);
            const totalHr =
              it.total_duration_min !== null
                ? Math.round((it.total_duration_min / 60) * 10) / 10
                : 0;
            return (
              <Link key={it.id} href={`/dates/${it.slug}`} className="group flex flex-col">
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-surface">
                  <Image
                    src={cover}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.03]"
                  />
                </div>
                <h2 className="mt-4 font-display text-lg font-semibold leading-tight text-text md:text-xl">
                  {it.title}
                </h2>
                {it.hook && (
                  <p className="mt-1 line-clamp-2 text-sm text-secondary">{it.hook}</p>
                )}
                <p className="mt-3 text-sm text-muted [font-variant-numeric:tabular-nums]">
                  <span className="text-text">${Math.round(it.total_cost_pp ?? 0)}</span>
                  <span className="mx-1.5 text-border">·</span>
                  <span>{totalHr} hr</span>
                  <span className="mx-1.5 text-border">·</span>
                  <span>{stops.length} stops</span>
                </p>
                {it.generated_at && (
                  <p className="mt-1 text-xs text-muted">
                    Built {relativeTime(it.generated_at)}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-2 min-w-[60px] text-xs font-medium uppercase tracking-[0.18em] text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-pill border px-3 py-1.5 text-xs font-medium capitalize transition-colors',
        active
          ? 'border-accent bg-accent text-white'
          : 'border-border bg-background text-text hover:border-text/40',
      )}
    >
      {label}
    </button>
  );
}

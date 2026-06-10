'use client';
import { useEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { browserAfter5Client, saveFeedFilters, type FeedFilters } from '@/lib/after5/client';
import { cn } from '@/lib/cn';

// Real searcher FilterSheet (DESIGN-SYSTEM §4, spec 2026-06-03 §3, 04-UI-SPEC §2).
// Two labeled groups: `dealbreakers` (hard — HIDE non-matching nights server-side)
// and `nice to have` (soft — re-sort only). Apply self-writes profiles.feed_filters
// via saveFeedFilters (owner-scoped, no RPC), then fires onApplied so the parent
// closes + re-queries. A save failure shows a dry sonner toast and does NOT call
// onApplied (the Task1→Task2 callback contract). Inclusive framing throughout:
// nothing is ever labeled "exclude"; an empty group means "no filter".

// Hard-filter option vocabularies. host_genders mirrors PostNightForm's GENDER_OPTIONS.
const HOST_GENDER_OPTIONS = [
  { id: 'woman', label: 'women' },
  { id: 'man', label: 'men' },
  { id: 'nonbinary', label: 'nonbinary' },
] as const;
// max price: stepped chips (single-select; the cap). undefined = no cap.
const PRICE_OPTIONS = [40, 60, 80, 120] as const;
// max distance (km): stepped chips (single-select; the cap). undefined = no cap.
const DISTANCE_OPTIONS = [10, 25, 50, 100] as const;

// Soft-filter option vocabularies.
const VIBE_OPTIONS = ['chill', 'creative', 'nightlife', 'foodie', 'active', 'cozy'] as const;
const WHO_PAYS_OPTIONS = [
  { id: 'i_pay', label: 'i pay' },
  { id: 'they_pay', label: 'they pay' },
  { id: 'split', label: 'split' },
] as const;
const TIME_OPTIONS = [
  { id: 'weekend', label: 'this weekend' },
  { id: 'weeknights', label: 'weeknights' },
  { id: 'daytime', label: 'daytime' },
] as const;

const CHIP_BASE =
  'min-h-[44px] rounded-full px-4 font-body text-[13px] font-semibold lowercase transition ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 ' +
  'motion-reduce:transition-none';
const CHIP_ON = 'bg-shell-accent text-white shadow-fun';
const CHIP_OFF = 'bg-white/80 text-shell-ink ring-1 ring-shell-ink/10 hover:ring-shell-accent/40';

/** Sections a quick chip can ask the sheet to open scrolled to. */
export type FilterSection = 'distance' | 'price' | 'vibe';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// Build a FeedFilters object from the local draft, omitting empty/unset keys so an
// untouched sheet persists the inclusive empty-object default.
function buildFilters(draft: {
  hostGenders: string[];
  maxPrice: number | null;
  maxDistanceKm: number | null;
  vibes: string[];
  whoPays: string[];
  timeBuckets: string[];
  ageMin: string;
  ageMax: string;
}): FeedFilters {
  const f: FeedFilters = {};
  if (draft.hostGenders.length) f.host_genders = draft.hostGenders;
  if (draft.maxPrice != null) f.max_price = draft.maxPrice;
  if (draft.maxDistanceKm != null) f.max_distance_km = draft.maxDistanceKm;
  if (draft.vibes.length) f.vibes = draft.vibes;
  if (draft.whoPays.length) f.who_pays = draft.whoPays;
  if (draft.timeBuckets.length) f.time_buckets = draft.timeBuckets;
  const min = Number(draft.ageMin);
  const max = Number(draft.ageMax);
  if (draft.ageMin !== '' && draft.ageMax !== '' && Number.isFinite(min) && Number.isFinite(max)) {
    f.host_age_range = [min, max];
  }
  return f;
}

export function FilterSheet({
  open,
  onOpenChange,
  userId,
  current,
  onApplied,
  initialSection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Signed-in viewer id; passed to saveFeedFilters (RLS gates a forged id, T-04-04). */
  userId: string;
  /** The viewer's persisted filters, to seed the sheet on open. */
  current?: FeedFilters;
  /** Fired exactly once on a successful apply; the parent closes + re-queries. */
  onApplied?: (filters: FeedFilters) => void;
  /** Quick-chip anchor: scroll this section into view when the sheet opens. */
  initialSection?: FilterSection;
}) {
  const [hostGenders, setHostGenders] = useState<string[]>([]);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | null>(null);
  const [vibes, setVibes] = useState<string[]>([]);
  const [whoPays, setWhoPays] = useState<string[]>([]);
  const [timeBuckets, setTimeBuckets] = useState<string[]>([]);
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [saving, setSaving] = useState(false);

  // Quick-chip anchors: each chip's section gets a ref; on open we scroll the
  // asked-for section into view (one shared sheet, no per-chip sheets).
  const distanceRef = useRef<HTMLDivElement>(null);
  const priceRef = useRef<HTMLDivElement>(null);
  const vibeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !initialSection) return;
    const refs = { distance: distanceRef, price: priceRef, vibe: vibeRef } as const;
    // Defer past vaul's mount/enter so the scroll container has its final layout.
    const t = window.setTimeout(() => {
      const reduce =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      refs[initialSection].current?.scrollIntoView?.({
        block: 'start',
        behavior: reduce ? 'auto' : 'smooth',
      });
    }, 60);
    return () => window.clearTimeout(t);
  }, [open, initialSection]);

  // Seed the draft from the persisted filters each time the sheet opens, so a
  // cancel-without-apply leaves the on-screen state matching reality next open.
  useEffect(() => {
    if (!open) return;
    const c = current ?? {};
    setHostGenders(c.host_genders ?? []);
    setMaxPrice(c.max_price ?? null);
    setMaxDistanceKm(c.max_distance_km ?? null);
    setVibes(c.vibes ?? []);
    setWhoPays(c.who_pays ?? []);
    setTimeBuckets(c.time_buckets ?? []);
    setAgeMin(c.host_age_range ? String(c.host_age_range[0]) : '');
    setAgeMax(c.host_age_range ? String(c.host_age_range[1]) : '');
  }, [open, current]);

  function reset() {
    setHostGenders([]);
    setMaxPrice(null);
    setMaxDistanceKm(null);
    setVibes([]);
    setWhoPays([]);
    setTimeBuckets([]);
    setAgeMin('');
    setAgeMax('');
  }

  async function apply() {
    if (saving) return;
    const filters = buildFilters({
      hostGenders,
      maxPrice,
      maxDistanceKm,
      vibes,
      whoPays,
      timeBuckets,
      ageMin,
      ageMax,
    });
    setSaving(true);
    try {
      await saveFeedFilters(browserAfter5Client(), userId, filters);
      // success → tell the parent (close + re-query) then close the sheet.
      onApplied?.(filters);
      onOpenChange(false);
    } catch {
      // dry, lowercase, fixed string — never leak raw error text (T-04-06).
      toast.error('that didn’t save. try again?');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80dvh] w-full max-w-[420px] flex-col rounded-t-3xl bg-shell-base text-shell-ink shadow-fun outline-none">
          <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-shell-ink/20" aria-hidden />
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-8 pt-5">
            <div>
              <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
                filters
              </Drawer.Title>
              <Drawer.Description className="mt-1 font-body text-[15px] text-shell-ink/65">
                hard filters hide. the rest just nudge what floats up.
              </Drawer.Description>
            </div>

            {/* ── dealbreakers (hard — HIDE) ── */}
            <section className="flex flex-col gap-4">
              <h3 className="font-heading text-xl lowercase text-shell-ink">dealbreakers</h3>

              <div>
                <p className="mb-2 font-body text-[13px] lowercase text-shell-ink/65">who&apos;s hosting</p>
                <div role="group" aria-label="who's hosting" className="flex flex-wrap gap-2">
                  {HOST_GENDER_OPTIONS.map((opt) => {
                    const on = hostGenders.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setHostGenders((g) => toggle(g, opt.id))}
                        className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div ref={priceRef} className="scroll-mt-4">
                <p className="mb-2 font-body text-[13px] lowercase text-shell-ink/65">max price</p>
                <div role="radiogroup" aria-label="max price" className="flex flex-wrap gap-2">
                  {PRICE_OPTIONS.map((p) => {
                    const on = maxPrice === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setMaxPrice((cur) => (cur === p ? null : p))}
                        className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                      >
                        ≤ ${p}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div ref={distanceRef} className="scroll-mt-4">
                <p className="mb-2 font-body text-[13px] lowercase text-shell-ink/65">how far</p>
                <div role="radiogroup" aria-label="how far" className="flex flex-wrap gap-2">
                  {DISTANCE_OPTIONS.map((km) => {
                    const on = maxDistanceKm === km;
                    return (
                      <button
                        key={km}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setMaxDistanceKm((cur) => (cur === km ? null : km))}
                        className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                      >
                        ≤ {km}km
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* ── nice to have (soft — SORT) ── */}
            <section className="flex flex-col gap-4">
              <h3 className="font-heading text-xl lowercase text-shell-ink">nice to have</h3>

              <div ref={vibeRef} className="scroll-mt-4">
                <p className="mb-2 font-body text-[13px] lowercase text-shell-ink/65">vibe</p>
                <div role="group" aria-label="vibe" className="flex flex-wrap gap-2">
                  {VIBE_OPTIONS.map((v) => {
                    const on = vibes.includes(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setVibes((cur) => toggle(cur, v))}
                        className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 font-body text-[13px] lowercase text-shell-ink/65">who pays</p>
                <div role="group" aria-label="who pays" className="flex flex-wrap gap-2">
                  {WHO_PAYS_OPTIONS.map((opt) => {
                    const on = whoPays.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setWhoPays((cur) => toggle(cur, opt.id))}
                        className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 font-body text-[13px] lowercase text-shell-ink/65">when</p>
                <div role="group" aria-label="when" className="flex flex-wrap gap-2">
                  {TIME_OPTIONS.map((opt) => {
                    const on = timeBuckets.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setTimeBuckets((cur) => toggle(cur, opt.id))}
                        className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-end gap-3">
                <label htmlFor="host-age-min" className="flex-1">
                  <span className="mb-1.5 block font-body text-[13px] lowercase text-shell-ink/65">
                    their youngest
                  </span>
                  <input
                    id="host-age-min"
                    type="number"
                    inputMode="numeric"
                    min={18}
                    max={99}
                    value={ageMin}
                    onChange={(e) => setAgeMin(e.target.value)}
                    className="min-h-[44px] w-full rounded-2xl bg-white/80 px-4 font-body text-[15px] text-shell-ink ring-1 ring-shell-ink/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
                  />
                </label>
                <label htmlFor="host-age-max" className="flex-1">
                  <span className="mb-1.5 block font-body text-[13px] lowercase text-shell-ink/65">
                    their oldest
                  </span>
                  <input
                    id="host-age-max"
                    type="number"
                    inputMode="numeric"
                    min={18}
                    max={99}
                    value={ageMax}
                    onChange={(e) => setAgeMax(e.target.value)}
                    className="min-h-[44px] w-full rounded-2xl bg-white/80 px-4 font-body text-[15px] text-shell-ink ring-1 ring-shell-ink/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
                  />
                </label>
              </div>
            </section>

            <div className="mt-1 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={saving}
                className="flex h-14 items-center justify-center rounded-full bg-shell-accent px-7 font-heading text-lg lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100 disabled:opacity-60"
              >
                {saving ? 'saving…' : 'apply filters'}
              </button>
              <button
                type="button"
                onClick={reset}
                className="flex min-h-[44px] items-center justify-center rounded-full font-body text-[15px] lowercase text-shell-ink/65 transition hover:text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none"
              >
                reset filters
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

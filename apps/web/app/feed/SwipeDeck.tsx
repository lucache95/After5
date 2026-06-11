'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
  type PanInfo,
} from 'framer-motion';
import { toast } from 'sonner';
import { Heart, X, Volume2, VolumeX, SlidersHorizontal, ChevronDown } from 'lucide-react';
import {
  browserAfter5Client,
  recordSwipe,
  ambientSoundUrl,
  saveFeedFilters,
  type FeedNight,
  type FeedFilters,
} from '@/lib/after5/client';
import type { FeedTier } from '@after5/business';
import { NightCard } from './NightCard';
import { NightDetailSheet } from './NightDetailSheet';
import { stickerRotation } from '@/lib/sticker';
import { FilterSheet, type FilterSection } from './FilterSheet';
import { useAmbientDeck } from './useAmbientDeck';
import { BottomTabShell } from '@/components/BottomTabShell';
import { cn } from '@/lib/cn';
import { PendingButtonContent } from '@/components/PendingButtonContent';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

// Tier-1 shell screen (DESIGN-SYSTEM §1/§4): Barbiecore pink page, phone-width column.
// The swipe stack is the primary interaction; buttons are an accessible fallback (§6).
// Keyset pagination stays deferred — one page of 20, empty state on exhaustion.

type Direction = 'left' | 'right';
const SWIPE_THRESHOLD = 110; // px of horizontal travel to commit
const VELOCITY_THRESHOLD = 600; // px/s flick to commit even on a short drag

// Day-scope (spec 2026-06-03 §3 "coarse time buckets"). tonight / this weekend
// stay HEADING-ONLY intent labels for now (hard-filtering the default deck by
// them would empty thin-liquidity feeds — deferred). "pick a day" is REAL: it
// reveals a 14-day chip row and filters the deck CLIENT-SIDE on the local
// calendar day of time_window_start (the SSR query has no time param to pass).
// A day RANGE is deliberately out of scope — "this weekend" covers that case.
const DAY_SCOPES = [
  { key: 'tonight', label: 'tonight' },
  { key: 'weekend', label: 'this weekend' },
  { key: 'any', label: 'pick a day' },
] as const;

// Local YYYY-MM-DD key for a date — the unit "pick a day" filters on.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The next 14 tappable days: chip label ("wed 11") + heading label ("wed jun 11").
function nextDays(count = 14): { key: string; chip: string; heading: string }[] {
  const today = new Date();
  return Array.from({ length: count }, (_, k) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    const month = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    return {
      key: dayKey(d),
      chip: `${weekday} ${d.getDate()}`,
      heading: `${weekday} ${month} ${d.getDate()}`,
    };
  });
}

// The 3 quick chips (D-04): shortcuts INTO the FilterSheet (not inline editors).
// Each shows its CURRENT value as sub-text (live from feed_filters; "any" when
// unset); tapping one opens the sheet scrolled to that section. distance/price
// are the hard caps; vibe is the soft pref.
const QUICK_CHIPS = [
  { key: 'distance', label: 'distance' },
  { key: 'price', label: 'price' },
  { key: 'vibe', label: 'vibe' },
] as const;

// The current-value sub-text a quick chip shows (always a string; "any" = unset).
function chipValue(key: (typeof QUICK_CHIPS)[number]['key'], filters: FeedFilters): string {
  if (key === 'distance') return filters.max_distance_km != null ? `${filters.max_distance_km} km` : 'any';
  if (key === 'price') return filters.max_price != null ? `$${filters.max_price} and under` : 'any';
  const vibes = filters.vibes ?? [];
  if (vibes.length === 0) return 'any';
  return vibes.length === 1 ? vibes[0]! : `${vibes[0]} +${vibes.length - 1}`;
}

// Any HARD filter (the three that HIDE) set → the empty deck is filtered, not genuine.
function hasHardFilter(filters: FeedFilters): boolean {
  return (
    (filters.host_genders?.length ?? 0) > 0 ||
    filters.max_price != null ||
    filters.max_distance_km != null
  );
}

export function SwipeDeck({
  initial,
  tier = 'live',
  userId = '',
  filters = {},
  canAct = true,
}: {
  initial: FeedNight[];
  tier?: FeedTier;
  /** Signed-in viewer id; passed to the FilterSheet self-write (RLS-gated). */
  userId?: string;
  /** The viewer's persisted feed_filters (seeds chips + the empty-state branch). */
  filters?: FeedFilters;
  /**
   * F1 (launch): false for a signed-in but PRE-VERIFICATION viewer — the deck
   * renders read-only. Interest (right) routes to a verify prompt → /onboarding
   * instead of record_swipe; pass (left) just advances locally (nothing persists
   * pre-verification). Filters are hidden (no prefs exist yet to filter with).
   */
  canAct?: boolean;
}) {
  const router = useRouter();
  const [scopeIdx, setScopeIdx] = useState(0);
  // "pick a day" selection: local YYYY-MM-DD, null until a chip is tapped.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // Cards swiped THIS SESSION — excluded when the day filter recomputes the deck,
  // so changing scope never resurfaces a night the viewer already acted on.
  const swipedRef = useRef<Set<string>>(new Set());
  const days = useMemo(() => nextDays(), []);
  const isDayScope = DAY_SCOPES[scopeIdx].key === 'any';
  // Day filter is CLIENT-SIDE over the SSR page of nights (see DAY_SCOPES note).
  const scoped = useMemo(() => {
    if (!isDayScope || !pickedDay) return initial;
    return initial.filter(
      (n) =>
        dayKey(new Date(n.time_window_start)) === pickedDay &&
        !swipedRef.current.has(n.date_instance_id),
    );
  }, [initial, isDayScope, pickedDay]);
  const [deck, setDeck] = useState(scoped);
  const [i, setI] = useState(0);
  // router.refresh() (filter apply / loosen) re-runs the SSR feed and passes a new
  // `initial` (and a scope change re-filters it), but useState won't re-init on a
  // prop change — reset the deck + index when the night set changes (React "adjust
  // state during render" pattern: no effect, no flash). Without this a filter that
  // emptied the feed leaves the stale card on screen.
  const deckSig = scoped.map((n) => n.date_instance_id).join(',');
  const [prevSig, setPrevSig] = useState(deckSig);
  if (deckSig !== prevSig) {
    setPrevSig(deckSig);
    setDeck(scoped);
    setI(0);
  }
  const [busy, setBusy] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  // Which FilterSheet section a quick chip asked to scroll to (null = plain open).
  const [sheetSection, setSheetSection] = useState<FilterSection | null>(null);
  const reduceMotion = useReducedMotion();
  const pickedDayMeta = pickedDay ? days.find((d) => d.key === pickedDay) ?? null : null;
  const scopeLabel =
    isDayScope && pickedDayMeta ? pickedDayMeta.heading : DAY_SCOPES[scopeIdx].label;
  function cycleScope() {
    const next = (scopeIdx + 1) % DAY_SCOPES.length;
    setScopeIdx(next);
    if (DAY_SCOPES[next].key !== 'any') setPickedDay(null);
  }

  // After a successful apply (or empty-state loosen) the persisted filters changed;
  // re-run the SSR browseFeed (force-dynamic) so the deck reflects the new filters.
  function refetchFeed() {
    router.refresh();
  }

  // Ambient deck: resolve each card's relative ambient path to a public URL, then
  // crossfade as the active index advances. Default muted; the pill is the gesture.
  const urls = useMemo(
    () => deck.map((n) => ambientSoundUrl(n.ambient_sound_path, SUPABASE_URL)),
    [deck],
  );
  const { unmuted, toggleMute } = useAmbientDeck(urls, i, { reduceMotion: !!reduceMotion });

  const current = deck[i];
  const next = deck[i + 1];
  const after = deck[i + 2];
  const remaining = deck.length - i;

  async function commit(direction: Direction) {
    if (!current || busy) return false;
    // F1: pre-verification the deck is browse-only. The interest action is the
    // gate — friendly prompt + CTA into onboarding, no record_swipe call ever.
    if (!canAct) {
      if (direction === 'right') {
        toast('verify to match on this night — takes 2 minutes', {
          action: { label: 'verify me', onClick: () => router.push('/onboarding') },
        });
        return false; // card snaps back; the night stays on top
      }
      // pass: keep browsing — advance locally, nothing persists pre-verification.
      swipedRef.current.add(current.date_instance_id);
      setDetailOpen(false);
      setI((n) => n + 1);
      return true;
    }
    setBusy(true);
    try {
      await recordSwipe(browserAfter5Client(), current.date_instance_id, direction);
      swipedRef.current.add(current.date_instance_id);
      setDetailOpen(false); // close the detail sheet if the swipe came from inside it
      setI((n) => n + 1);
      return true;
    } catch {
      // dry, lowercase error — card will snap back and interaction re-enables.
      toast.error('that didn’t send. try again?');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Empty decks are NOT a separate full-screen page: the header, day chips, and
  // quick-filter chips stay on screen for EVERY empty state so the viewer can
  // adjust the thing that emptied the deck in place (the old full-screen
  // EmptyDeck stranded them with no filter controls — founder repro 2026-06-10).
  // The flavor of empty (picked-day / filtered / genuine) only swaps the body.
  return (
    <main className="flex min-h-dvh flex-col bg-shell-base px-5 pb-24 pt-7">
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col">
        <header className="mb-5 flex items-center justify-between">
          {/* Tappable day-scope (spec §3): cycles tonight → this weekend → pick a
              day. The chevron signals it toggles; the heading stays the h1. */}
          <h1>
            <button
              type="button"
              onClick={cycleScope}
              aria-label={`showing ${scopeLabel}. tap to change the day`}
              className="flex items-center gap-1.5 font-heading text-3xl lowercase text-shell-ink transition active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 rounded-lg motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              {scopeLabel}
              <ChevronDown className="h-5 w-5 text-shell-accent" aria-hidden />
            </button>
          </h1>
          <div className="flex items-center gap-3">
            {/* F1: filters are preference-driven — hidden pre-verification (the
                teaser feed is the default audience; there are no prefs to filter). */}
            {canAct && (
              <button
                type="button"
                onClick={() => {
                  setSheetSection(null); // plain open — no section scroll
                  setFilterOpen(true);
                }}
                aria-label="filters"
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-shell-ink shadow-subtle transition',
                  'hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                  'motion-reduce:transition-none motion-reduce:hover:scale-100',
                )}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={toggleMute}
              aria-pressed={unmuted}
              aria-label={unmuted ? 'mute the soundtrack' : 'tap to unmute the soundtrack'}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-shell-ink shadow-subtle transition',
                'hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                'motion-reduce:transition-none motion-reduce:hover:scale-100',
                unmuted && 'bg-shell-accent text-white',
              )}
            >
              {unmuted
                ? <Volume2 className="h-4 w-4" aria-hidden />
                : <VolumeX className="h-4 w-4" aria-hidden />}
            </button>
            <p className="font-body text-sm text-shell-ink/75" aria-live="polite">
              {remaining} left
            </p>
          </div>
        </header>

        {/* "pick a day" chip row: the next 14 days, horizontally scrollable. Visible
            for every viewer (it's browsing, not a preference filter — teaser mode
            keeps it; F1 only hides the preference chips below). */}
        {isDayScope && (
          <div
            role="group"
            aria-label="pick a day"
            className="-mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1"
          >
            {days.map((d) => {
              const on = pickedDay === d.key;
              return (
                <button
                  key={d.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPickedDay(d.key)}
                  className={cn(
                    'min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-4 font-body text-[13px] font-semibold lowercase transition',
                    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                    'motion-reduce:transition-none',
                    on
                      ? 'bg-shell-accent text-white shadow-fun'
                      : 'bg-white/80 text-shell-ink ring-1 ring-shell-ink/10 hover:ring-shell-accent/40',
                  )}
                >
                  {d.chip}
                </button>
              );
            })}
          </div>
        )}

        {/* Quick-filter chips (D-04): shortcuts into the sheet. Each shows its CURRENT
            value as sub-text ("any" when unset); a set value flips the chip to accent.
            Tapping opens the FilterSheet scrolled to that chip's section.
            Hidden pre-verification along with the sheet (F1). */}
        {canAct && (
        <div role="group" aria-label="quick filters" className="mb-5 flex flex-wrap gap-2">
          {QUICK_CHIPS.map(({ key, label }) => {
            const value = chipValue(key, filters);
            const active = value !== 'any';
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSheetSection(key);
                  setFilterOpen(true);
                }}
                aria-label={`${label}, ${value}. tap to open filters`}
                className={cn(
                  'flex min-h-[48px] flex-col items-start justify-center rounded-full px-4 py-1 text-left font-body lowercase shadow-md transition',
                  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                  'motion-reduce:transition-none motion-reduce:hover:scale-100',
                  active
                    ? 'bg-shell-accent text-white shadow-fun'
                    : 'bg-white/80 text-shell-ink ring-1 ring-shell-ink/10 hover:ring-shell-accent/40',
                )}
              >
                <span className="text-[13px] font-semibold leading-tight">{label}</span>
                <span
                  className={cn(
                    'text-[11px] leading-tight',
                    active ? 'text-white/85' : 'text-shell-ink/60',
                  )}
                >
                  {value}
                </span>
              </button>
            );
          })}
        </div>
        )}

        {current ? (
          <div className="relative flex-1">
            {/* peeking cards behind the active one — depth, not interactive */}
            {after && <PeekCard key={`peek-${after.date_instance_id}`} night={after} depth={2} />}
            {next && <PeekCard key={`peek-${next.date_instance_id}`} night={next} depth={1} />}

            <ActiveCard
              key={current.date_instance_id}
              night={current}
              busy={busy}
              reduceMotion={!!reduceMotion}
              onCommit={commit}
              onOpenDetail={() => setDetailOpen(true)}
            />
          </div>
        ) : isDayScope && pickedDay ? (
          /* picked-day empty: try another day. */
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
            <p className="font-heading text-3xl lowercase text-shell-ink">
              nothing on {scopeLabel} yet.
            </p>
            <p className="mt-3 font-body text-[15px] text-shell-ink/65">
              try another day — or{' '}
              <Link
                href="/nights/new"
                className="font-semibold text-shell-accent underline decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40"
              >
                post your own night
              </Link>
              .
            </p>
          </div>
        ) : hasHardFilter(filters) ? (
          /* filtered empty: name the most-restrictive filter + one-tap loosen. */
          <FilteredEmptyBody userId={userId} filters={filters} onLoosened={refetchFeed} />
        ) : (
          /* genuinely empty: everyone's been seen. */
          <GenuinelyEmptyBody tier={tier} />
        )}

        {current && (
          <NightDetailSheet
            night={current}
            open={detailOpen}
            busy={busy}
            onOpenChange={setDetailOpen}
            onCommit={(direction) => void commit(direction)}
          />
        )}

        {canAct && (
          <FilterSheet
            open={filterOpen}
            onOpenChange={setFilterOpen}
            userId={userId}
            current={filters}
            onApplied={refetchFeed}
            initialSection={sheetSection ?? undefined}
          />
        )}

        {current && (
        <div className="mt-6 flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={() => void commit('left')}
            disabled={busy}
            aria-label="nope, pass on this one"
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-full bg-white text-shell-ink shadow-fun transition',
              'hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/60',
              'motion-reduce:transition-none motion-reduce:hover:scale-100',
              busy && 'opacity-50',
            )}
          >
            <X className="h-7 w-7" strokeWidth={2.5} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void commit('right')}
            disabled={busy}
            aria-label="interested — slide this onto my list"
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-full bg-white text-shell-accent ring-1 ring-shell-ink/10 shadow-fun transition',
              'hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
              'motion-reduce:transition-none motion-reduce:hover:scale-100',
              busy && 'opacity-50',
            )}
          >
            <Heart className="h-7 w-7" strokeWidth={2.5} fill="currentColor" aria-hidden />
          </button>
        </div>
        )}
      </div>
      <BottomTabShell />
    </main>
  );
}

// Non-interactive card stacked behind the active one. A CASUAL PILE, not a tidy fan:
// each card behind is nudged off-centre (alternating sides) and tilted a few degrees a
// different way, plus a width step + downward offset so the rims peek. Per-card tilt is
// deterministic (stickerRotation of the id) so it stays put across renders / hydration.
function PeekCard({ night, depth }: { night: FeedNight; depth: 1 | 2 }) {
  const dir = depth === 1 ? -1 : 1; // alternate which side each card leans
  const tilt = dir * (3 + stickerRotation(night.date_instance_id ?? night.title)); // ~ ±3-6°
  const shiftX = dir * (depth * 9); // off-centre nudge, grows with depth
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 10 - depth,
        transform: `translate(${shiftX}px, ${depth * 22}px) rotate(${tilt}deg) scale(${1 - depth * 0.07})`,
        opacity: depth === 2 ? 0.8 : 0.92,
      }}
    >
      <NightCard night={night} />
    </div>
  );
}

// The top, draggable card: rotate via x, two tint overlays growing with |x|,
// fly-off on commit, spring snap-back on cancel. Reduced motion → no drift/rotate.
function ActiveCard({
  night,
  busy,
  reduceMotion,
  onCommit,
  onOpenDetail,
}: {
  night: FeedNight;
  busy: boolean;
  reduceMotion: boolean;
  onCommit: (direction: Direction) => Promise<boolean>;
  onOpenDetail: () => void;
}) {
  const x = useMotionValue(0);
  // Tap-vs-drag: record where the pointer went down; if it lifts within a few
  // px we treat it as a tap-to-read (open the detail sheet) rather than a swipe.
  const downPoint = useRef<{ x: number; y: number } | null>(null);
  const TAP_SLOP = 8; // px of movement still counts as a tap, not a drag
  const rotate = useTransform(x, [-200, 200], reduceMotion ? [0, 0] : [-12, 12]);
  const likeOpacity = useTransform(x, [10, SWIPE_THRESHOLD], [0, 1]);
  const nopeOpacity = useTransform(x, [-SWIPE_THRESHOLD, -10], [1, 0]);

  // Belt-and-suspenders: if this component instance is ever reused for a
  // different card (e.g. key identity is preserved across a re-render), snap
  // x back to 0 so the like/nope overlays start clean on the new card.
  useEffect(() => {
    x.set(0);
  }, [night.date_instance_id, x]);

  function flyOff(direction: Direction) {
    const target = direction === 'right' ? 600 : -600;
    if (reduceMotion) {
      x.set(0);
    } else {
      void animate(x, target, { type: 'spring', stiffness: 350, damping: 40 });
    }
  }

  function snapBack() {
    // Reduced motion: settle instantly (no spring), but keep the gesture itself.
    if (reduceMotion) {
      x.set(0);
    } else {
      void animate(x, 0, { type: 'spring', stiffness: 500, damping: 32 });
    }
  }

  async function handleDragEnd(_e: unknown, info: PanInfo) {
    const offset = info.offset.x;
    const velocity = info.velocity.x;
    const past =
      Math.abs(offset) > SWIPE_THRESHOLD || Math.abs(velocity) > VELOCITY_THRESHOLD;
    if (!past || busy) {
      snapBack();
      return;
    }
    const direction: Direction = offset > 0 || velocity > 0 ? 'right' : 'left';
    flyOff(direction);
    const ok = await onCommit(direction);
    if (!ok) snapBack(); // error → bring it back so they can retry
  }

  return (
    <motion.div
      className="absolute inset-0 z-10 cursor-grab touch-pan-y rounded-3xl active:cursor-grabbing focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
      style={{ x, rotate }}
      role="button"
      tabIndex={0}
      aria-label={`${night.title ?? 'a night out'} — tap to read the full plan before you swipe`}
      onPointerDown={(e) => {
        downPoint.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = downPoint.current;
        downPoint.current = null;
        if (!start || busy) return;
        const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (moved <= TAP_SLOP) onOpenDetail();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      // Drag stays enabled under reduced motion (it's the primary interaction);
      // the rotate/fly flourish is what gets neutralised, not the gesture.
      drag="x"
      dragSnapToOrigin={false}
      dragElastic={0.7}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={(e, info) => void handleDragEnd(e, info)}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
      // Promote the next card in from the peek stack (scale/opacity only — the
      // peek cards sit at ~0.95 scale / 0.65 opacity, so this reads as continuity).
      initial={reduceMotion ? false : { scale: 0.94, opacity: 0.65 }}
      animate={reduceMotion ? false : { scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
    >
      <NightCard night={night} />

      {/* interested (right) — green wash */}
      <motion.div
        aria-hidden
        style={{ opacity: likeOpacity }}
        className="pointer-events-none absolute inset-0 flex items-start justify-start rounded-3xl bg-emerald-500/35 p-6"
      >
        <span className="rotate-[-8deg] rounded-2xl border-4 border-emerald-50 px-3 py-1 font-heading text-2xl lowercase text-emerald-50 shadow-md">
          yes
        </span>
      </motion.div>

      {/* pass (left) — dark red/black wash */}
      <motion.div
        aria-hidden
        style={{ opacity: nopeOpacity }}
        className="pointer-events-none absolute inset-0 flex items-start justify-end rounded-3xl bg-swipe-nope/55 p-6"
      >
        <span className="rotate-[8deg] rounded-2xl border-4 border-rose-50/90 px-3 py-1 font-heading text-2xl lowercase text-rose-50 shadow-md">
          nope
        </span>
      </motion.div>
    </motion.div>
  );
}

// The most-restrictive hard filter + how to loosen it. Order of restrictiveness:
// distance (tightest reach), then price, then host gender. Distance/price get a
// concrete one-tap widen; gender gets a "drop it" loosen.
type Loosen = { line: string; cta: string; next: FeedFilters };
function mostRestrictive(filters: FeedFilters): Loosen {
  if (filters.max_distance_km != null) {
    const widened =
      filters.max_distance_km < 50 ? 50
      : filters.max_distance_km < 100 ? 100
      : null;
    return {
      line: `your distance is set to ${filters.max_distance_km}km.`,
      cta: widened != null ? `widen to ${widened}km?` : 'remove the distance cap?',
      next:
        widened != null
          ? { ...filters, max_distance_km: widened }
          : (({ max_distance_km: _drop, ...rest }) => rest)(filters),
    };
  }
  if (filters.max_price != null) {
    const widened = filters.max_price < 120 ? 120 : 200;
    return {
      line: `your max price is $${filters.max_price}.`,
      cta: `raise it to $${widened}?`,
      next: { ...filters, max_price: widened },
    };
  }
  // host gender is the remaining hard filter
  const { host_genders: _drop, ...rest } = filters;
  return {
    line: 'you only want certain hosts.',
    cta: 'open it to everyone?',
    next: rest,
  };
}

// Inline (renders UNDER the persistent feed header — never its own <main>).
function FilteredEmptyBody({
  userId,
  filters,
  onLoosened,
}: {
  userId: string;
  filters: FeedFilters;
  onLoosened?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const loosen = mostRestrictive(filters);

  async function widen() {
    if (busy) return;
    setBusy(true);
    try {
      await saveFeedFilters(browserAfter5Client(), userId, loosen.next);
      onLoosened?.();
    } catch {
      toast.error('that didn’t save. try again?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="mx-auto max-w-[420px]">
        <p className="font-heading text-3xl lowercase leading-[1.1] text-shell-ink">
          nothing fits those filters.
        </p>
        <p className="mt-4 font-body text-lg text-shell-ink/70">{loosen.line}</p>
        <button
          type="button"
          onClick={() => void widen()}
          disabled={busy}
          className="mt-5 min-h-[44px] rounded-full px-2 font-body text-[15px] font-semibold lowercase text-shell-accent underline decoration-2 underline-offset-4 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-60 motion-reduce:transition-none"
        >
          <PendingButtonContent pending={busy} pendingLabel="widening…" accessibilityLabel="widening filters" size={14}>
            {loosen.cta}
          </PendingButtonContent>
        </button>
        <p className="mt-6 font-body text-[15px] text-shell-ink/60">
          or be the main character.{' '}
          <Link
            href="/nights/new"
            className="font-semibold text-shell-accent underline decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40"
          >
            post your own night
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

// Genuinely-empty (DESIGN-SYSTEM §3): funny-not-helpful, multi-city (no Kelowna).
// Unchanged from the shipped copy.
function GenuinelyEmptyBody({ tier }: { tier: FeedTier }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <div className="mx-auto max-w-[420px]">
        <p className="font-heading text-3xl lowercase leading-[1.1] text-shell-ink">
          that’s everyone for now.
        </p>
        <p className="mt-4 font-body text-lg text-shell-ink/70">
          touch grass and come back later.
        </p>
        {tier === 'thin' ? (
          <p className="mt-6 font-body text-[15px] text-shell-ink/60">
            it’s quiet out here. be the main character —{' '}
            <Link
              href="/nights/new"
              className="font-semibold text-shell-accent underline decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40"
            >
              post your own night
            </Link>
            .
          </p>
        ) : (
          <p className="mt-6 font-body text-[15px] text-shell-ink/60">
            or{' '}
            <Link
              href="/nights/new"
              className="font-semibold text-shell-accent underline decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40"
            >
              post your own night
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}

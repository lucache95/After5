'use client';
import { useState, useEffect } from 'react';
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
import { Heart, X } from 'lucide-react';
import { browserAfter5Client, recordSwipe, type FeedNight } from '@/lib/after5/client';
import type { FeedTier } from '@after5/business';
import { NightCard } from './NightCard';
import { BottomTabShell } from '@/components/BottomTabShell';
import { cn } from '@/lib/cn';

// Tier-1 shell screen (DESIGN-SYSTEM §1/§4): Barbiecore pink page, phone-width column.
// The swipe stack is the primary interaction; buttons are an accessible fallback (§6).
// Keyset pagination stays deferred — one page of 20, empty state on exhaustion.

type Direction = 'left' | 'right';
const SWIPE_THRESHOLD = 110; // px of horizontal travel to commit
const VELOCITY_THRESHOLD = 600; // px/s flick to commit even on a short drag

export function SwipeDeck({ initial, tier = 'live' }: { initial: FeedNight[]; tier?: FeedTier }) {
  const [deck] = useState(initial);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const reduceMotion = useReducedMotion();

  const current = deck[i];
  const next = deck[i + 1];
  const after = deck[i + 2];
  const remaining = deck.length - i;

  async function commit(direction: Direction) {
    if (!current || busy) return false;
    setBusy(true);
    try {
      await recordSwipe(browserAfter5Client(), current.date_instance_id, direction);
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

  if (deck.length === 0 || i >= deck.length) {
    return <EmptyDeck tier={tier} />;
  }

  return (
    <main className="flex min-h-dvh flex-col bg-shell-base px-5 pb-24 pt-7">
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col">
        <header className="mb-5 flex items-baseline justify-between">
          <h1 className="font-heading text-3xl lowercase text-shell-ink">tonight</h1>
          <p className="font-body text-sm text-shell-ink/75" aria-live="polite">
            {remaining} left
          </p>
        </header>

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
          />
        </div>

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
              'flex h-16 w-16 items-center justify-center rounded-full bg-shell-accent text-white shadow-fun transition',
              'hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
              'motion-reduce:transition-none motion-reduce:hover:scale-100',
              busy && 'opacity-50',
            )}
          >
            <Heart className="h-7 w-7" strokeWidth={2.5} fill="currentColor" aria-hidden />
          </button>
        </div>
        <p className="mt-3 text-center font-body text-xs text-shell-ink/75">
          swipe right if you’re in · left to skip
        </p>
      </div>
      <BottomTabShell />
    </main>
  );
}

// Non-interactive card stacked behind the active one (scale-down + y-offset + lower z).
function PeekCard({ night, depth }: { night: FeedNight; depth: 1 | 2 }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 10 - depth,
        transform: `translateY(${depth * 14}px) scale(${1 - depth * 0.05})`,
        opacity: depth === 2 ? 0.6 : 0.85,
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
}: {
  night: FeedNight;
  busy: boolean;
  reduceMotion: boolean;
  onCommit: (direction: Direction) => Promise<boolean>;
}) {
  const x = useMotionValue(0);
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
      className="absolute inset-0 z-10 cursor-grab touch-pan-y active:cursor-grabbing"
      style={{ x, rotate }}
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

// Empty / end-of-deck (DESIGN-SYSTEM §3): funny-not-helpful, multi-city (no Kelowna).
function EmptyDeck({ tier }: { tier: FeedTier }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 pb-24 text-center">
      <div className="mx-auto max-w-[420px]">
        <p className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">
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
      <BottomTabShell />
    </main>
  );
}

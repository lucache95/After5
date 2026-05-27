'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { browserAfter5Client, postNight } from '@/lib/after5/client';
import { stickerRotation } from '@/lib/sticker';
import { cn } from '@/lib/cn';

// Tier-1 shell surface (DESIGN-SYSTEM §1): Barbiecore pink chrome.
// Creator flow — pick a plan, set a time, post it. People nearby can slide in; you choose who.

interface Plan {
  id: string;
  title: string | null;
  cover_image_url: string | null;
  vibe_tags: string[] | null;
}

// ISO string for the datetime-local min attribute (now, rounded to the minute)
function nowMin(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  // datetime-local format: YYYY-MM-DDTHH:mm
  return d.toISOString().slice(0, 16);
}

export function PostNightForm({ plans }: { plans: Plan[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const reduceMotion = useReducedMotion();

  const isDateFuture = startsAt !== '' && new Date(startsAt) > new Date();
  const canPost = selectedId !== '' && isDateFuture && phase !== 'saving';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    setPhase('saving');
    setErrorMsg('');
    try {
      await postNight(browserAfter5Client(), {
        itinerary_id: selectedId,
        starts_at: new Date(startsAt).toISOString(),
      });
      toast.success("posted. it's live.");
      router.push('/home');
    } catch (err) {
      console.error('[PostNightForm] post failed', err);
      const msg =
        err instanceof Error ? err.message : "couldn't post that. try again?";
      setErrorMsg(msg);
      setPhase('error');
      toast.error("couldn't post that. try again?");
    }
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (plans.length === 0) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-6 text-center">
        <div className="mx-auto max-w-[420px]">
          <p className="font-heading text-4xl lowercase leading-[1.05] text-shell-ink">
            no plans yet.
          </p>
          <p className="mt-3 font-body text-[15px] text-shell-ink/70">
            go cook one first, then post it.
          </p>
          <Link
            href="/plan"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-shell-accent px-7 py-3 font-body text-[15px] font-semibold text-white shadow-fun transition hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none"
          >
            build a plan
          </Link>
        </div>
      </main>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────
  return (
    <main className="min-h-dvh bg-shell-base px-5 pb-12 pt-8">
      <div className="mx-auto max-w-[420px]">
        {/* Header */}
        <header className="mb-7">
          <h1 className="font-heading text-3xl lowercase leading-[1.05] text-shell-ink">
            post a night
          </h1>
          <p className="mt-2 font-body text-[14px] text-shell-ink/65">
            pick a plan. set the time. people nearby can say they&apos;re in — you choose who makes the cut.
          </p>
        </header>

        <form onSubmit={submit} className="space-y-6" noValidate>
          {/* ── Plan picker ── */}
          <fieldset>
            <legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">
              which plan?
            </legend>

            <div
              className="space-y-3"
              role="radiogroup"
              aria-label="pick a plan"
            >
              {plans.map((plan, idx) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  selected={selectedId === plan.id}
                  onSelect={() => setSelectedId(plan.id)}
                  index={idx}
                  reduceMotion={!!reduceMotion}
                />
              ))}
            </div>
          </fieldset>

          {/* ── When picker ── */}
          <div>
            <label
              htmlFor="starts-at"
              className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink"
            >
              when&apos;s the night?
            </label>
            <input
              id="starts-at"
              type="datetime-local"
              value={startsAt}
              min={nowMin()}
              onChange={(e) => setStartsAt(e.target.value)}
              className={cn(
                'block w-full rounded-2xl border bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink',
                'focus:outline-none focus:ring-2 focus:ring-shell-accent/60',
                'border-shell-ink/15',
              )}
              aria-describedby={startsAt && !isDateFuture ? 'time-hint' : undefined}
            />
            {startsAt && !isDateFuture && (
              <p id="time-hint" className="mt-1.5 font-body text-xs text-shell-accent">
                that&apos;s already gone. pick something later.
              </p>
            )}
          </div>

          {/* ── Error alert ── */}
          {phase === 'error' && errorMsg && (
            <div
              role="alert"
              className="rounded-2xl border border-shell-accent/30 bg-white/70 px-4 py-3 font-body text-[13px] text-shell-ink"
            >
              {errorMsg}
            </div>
          )}

          {/* ── Submit CTA ── */}
          <button
            type="submit"
            disabled={!canPost}
            className={cn(
              'mt-1 flex min-h-[48px] w-full items-center justify-center rounded-full font-body text-[16px] font-semibold lowercase transition',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
              'motion-reduce:transition-none',
              canPost
                ? 'bg-shell-accent text-white shadow-fun hover:opacity-90 active:scale-95'
                : 'cursor-not-allowed bg-shell-ink/10 text-shell-ink/35',
            )}
            aria-busy={phase === 'saving'}
          >
            {phase === 'saving'
              ? 'posting…'
              : phase === 'error'
              ? 'try again'
              : 'post it'}
          </button>
        </form>
      </div>
    </main>
  );
}

// ── PlanCard ─────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
  index: number;
  reduceMotion: boolean;
}

function PlanCard({ plan, selected, onSelect, index, reduceMotion }: PlanCardProps) {
  const tags = (plan.vibe_tags ?? []).filter(Boolean).slice(0, 4);

  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-pressed={selected}
      onClick={onSelect}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={reduceMotion ? false : { opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: 'spring', stiffness: 400, damping: 32 }}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
      className={cn(
        // Base: full-width tappable card, ≥44px target, left-aligned text
        'flex w-full items-start gap-3 rounded-3xl bg-white/80 p-3 text-left transition',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
        'motion-reduce:transition-none',
        // Selected ring
        selected
          ? 'ring-2 ring-shell-accent shadow-fun'
          : 'ring-1 ring-shell-ink/10 shadow-subtle hover:ring-shell-accent/40',
      )}
    >
      {/* Thumbnail */}
      <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl bg-shell-base">
        {plan.cover_image_url ? (
          <Image
            src={plan.cover_image_url}
            alt=""
            fill
            sizes="72px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Sparkles
              className="h-6 w-6 text-shell-accent/40"
              aria-hidden
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="font-heading text-[17px] lowercase leading-tight text-shell-ink line-clamp-2">
          {plan.title?.toLowerCase() ?? 'untitled plan'}
        </p>

        {tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="vibe tags">
            {tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full bg-shell-accent px-2.5 py-0.5 font-body text-[11px] font-semibold text-white shadow-md"
                style={{ transform: `rotate(${stickerRotation(tag)}deg)` }}
              >
                {tag.toLowerCase()}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Selection indicator */}
      <div
        aria-hidden
        className={cn(
          'mt-1 h-5 w-5 shrink-0 rounded-full border-2 transition',
          selected
            ? 'border-shell-accent bg-shell-accent'
            : 'border-shell-ink/20 bg-transparent',
        )}
      />
    </motion.button>
  );
}

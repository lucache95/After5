'use client';

// Bottom-left rotating social-proof toast. Two kinds of events mixed
// together, sorted newest-first:
//   - Recent claims:  "Emma from Glenmore just claimed a spot · 3 hr ago"
//   - Recent builds:  "Sarah from Lower Mission built 'Westside Sunset' · 1 day ago"
//
// Choreography:
//   1. First mount: 4s grace period before fading in (don't fight the hero).
//   2. Each rotation: 320ms exit (fade + slide-down + scale-down) → swap
//      content → 320ms enter (fade + slide-up + scale-up). Rotation cadence
//      is 8s so users still get ~7s to read each card.
//   3. Mobile: pinned bottom-left with safe-area padding; tighter width
//      and slightly smaller padding so it doesn't crowd touch targets.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { relativeTime } from '@/lib/relative-time';
import { Avatar } from './Avatar';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';

interface ClaimEvent {
  type: 'claim';
  name: string;
  city: string | null;
  at: string;
}

interface BuildEvent {
  type: 'build';
  name: string;
  city: string | null;
  at: string;
  title: string;
  slug: string;
}

type ProofEvent = ClaimEvent | BuildEvent;

const DISMISSED_KEY = 'after5_social_proof_dismissed';
const ROTATE_MS = 8000;
const TRANSITION_MS = 320;

type Phase = 'enter' | 'visible' | 'exit';

function lower(s: string): string {
  return (s ?? '').toLowerCase().trim();
}

export function RecentBuildsToast() {
  const [events, setEvents] = useState<ProofEvent[]>([]);
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>('enter');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(DISMISSED_KEY)) setDismissed(true);
  }, []);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [buildsRes, statsRes] = await Promise.all([
        supabase
          .from('itineraries')
          .select('slug, title, built_by_name, built_by_neighborhood, generated_at')
          .eq('is_public', true)
          .not('built_by_name', 'is', null)
          .not('slug', 'is', null)
          .order('generated_at', { ascending: false })
          .limit(10),
        fetch('/api/stats', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);

      if (cancelled) return;

      const builds: BuildEvent[] = (buildsRes.data ?? [])
        .filter((b) => b.slug && b.title && b.built_by_name)
        .map((b) => ({
          type: 'build' as const,
          name: b.built_by_name as string,
          city: b.built_by_neighborhood,
          at: b.generated_at as string,
          title: b.title as string,
          slug: b.slug as string,
        }));

      const claims: ClaimEvent[] = (statsRes?.recent ?? []).map((r: { first_name: string; city: string | null; created_at: string }) => ({
        type: 'claim' as const,
        name: r.first_name,
        city: r.city,
        at: r.created_at,
      }));

      const merged: ProofEvent[] = [...builds, ...claims]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 12);

      // Avoid showing the same person back-to-back (e.g. "Stephen built X"
      // immediately followed by "Stephen claimed a spot"). Walk the list and
      // swap each consecutive same-name pair with the next available
      // different-named event further down. Preserves recency-first order
      // when no swap is needed.
      for (let i = 1; i < merged.length; i++) {
        if (lower(merged[i].name) !== lower(merged[i - 1].name)) continue;
        for (let j = i + 1; j < merged.length; j++) {
          if (
            lower(merged[j].name) !== lower(merged[i - 1].name) &&
            (i + 1 >= merged.length || lower(merged[j].name) !== lower(merged[i + 1]?.name ?? ''))
          ) {
            const tmp = merged[i];
            merged[i] = merged[j];
            merged[j] = tmp;
            break;
          }
        }
      }

      if (merged.length > 0) {
        setEvents(merged);
        setTimeout(() => {
          setVisible(true);
          // Allow the entrance animation to play, then settle.
          requestAnimationFrame(() => setPhase('visible'));
        }, 4000);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dismissed]);

  // Choreographed rotation: exit → swap → enter.
  useEffect(() => {
    if (events.length <= 1 || !visible) return;
    const interval = setInterval(() => {
      setPhase('exit');
      window.setTimeout(() => {
        setIdx((i) => (i + 1) % events.length);
        setPhase('enter');
        // Two rAFs to guarantee the browser paints the entering state
        // before transitioning to visible.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setPhase('visible'));
        });
      }, TRANSITION_MS);
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, [events.length, visible]);

  if (dismissed || !visible || events.length === 0) return null;
  const e = events[idx];
  if (!e) return null;

  function dismiss() {
    setDismissed(true);
    if (typeof window !== 'undefined') sessionStorage.setItem(DISMISSED_KEY, '1');
  }

  const ago = relativeTime(e.at);
  const cityLabel = e.city ? ` from ${e.city}` : '';

  const body = e.type === 'claim' ? (
    <>
      <p className="text-[13px] leading-snug text-text md:text-sm">
        <span className="font-medium">{e.name}</span>
        <span className="text-secondary">{cityLabel} just claimed a free spot</span>
      </p>
      <p className="mt-0.5 text-[11px] text-muted md:text-xs">{ago}</p>
    </>
  ) : (
    <>
      <p className="text-[13px] leading-snug text-text md:text-sm">
        <span className="font-medium">{e.name}</span>
        <span className="text-secondary">{cityLabel} built</span>
      </p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-text md:text-sm">{e.title}</p>
      <p className="mt-0.5 text-[11px] text-muted md:text-xs">{ago}</p>
    </>
  );

  const href = e.type === 'build' ? `/dates/${e.slug}` : '/login';

  // Phase → transform/opacity. Visible = settled state; enter starts
  // slightly down + faded; exit slides down + fades.
  const phaseClass =
    phase === 'visible'
      ? 'opacity-100 translate-y-0 scale-100'
      : phase === 'exit'
        ? 'opacity-0 translate-y-3 scale-[0.96]'
        : /* enter */ 'opacity-0 translate-y-3 scale-[0.96]';

  return (
    <div
      // Mobile: tighter width, padding bottom for safe-area + room above
      // sticky bottom CTAs. Desktop: original size.
      className="fixed bottom-3 left-3 right-3 z-40 max-w-[320px] md:bottom-4 md:left-4 md:right-auto md:max-w-[340px]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div
        className={cn(
          'transform-gpu transition-all ease-out',
          phaseClass,
        )}
        style={{ transitionDuration: `${TRANSITION_MS}ms` }}
      >
        <Link
          href={href}
          className="flex items-start gap-3 rounded-card border border-border bg-background px-3.5 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_8px_32px_rgba(0,0,0,0.14)] md:px-4"
        >
          <Avatar name={e.name} size="md" />
          <div className="flex-1 min-w-0">{body}</div>
          <button
            type="button"
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              dismiss();
            }}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-text active:bg-surface"
          >
            <X className="pointer-events-none h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </Link>
      </div>
    </div>
  );
}

'use client';

// Bottom-left rotating social-proof toast. Two kinds of events mixed
// together, sorted newest-first:
//   - Recent claims:  "Emma from Glenmore just claimed a spot · 3 hr ago"
//   - Recent builds:  "Sarah from Lower Mission built 'Westside Sunset' · 1 day ago"
// Fades in 4s after page load, rotates every 8s, dismissible for the session.
// Claims come from /api/stats (includes 10 seed rows for launch UX).

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { relativeTime } from '@/lib/relative-time';
import { Avatar } from './Avatar';
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

export function RecentBuildsToast() {
  const [events, setEvents] = useState<ProofEvent[]>([]);
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

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
        fetch('/api/stats', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null),
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

      // Merge, sort newest-first, cap at 12 for rotation variety.
      const merged: ProofEvent[] = [...builds, ...claims]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 12);

      if (merged.length > 0) {
        setEvents(merged);
        setTimeout(() => setVisible(true), 4000);
      }
    })();
    return () => { cancelled = true; };
  }, [dismissed]);

  useEffect(() => {
    if (events.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % events.length), 8000);
    return () => clearInterval(id);
  }, [events.length]);

  if (dismissed || !visible || events.length === 0) return null;
  const e = events[idx];
  if (!e) return null;

  function dismiss() {
    setDismissed(true);
    if (typeof window !== 'undefined') sessionStorage.setItem(DISMISSED_KEY, '1');
  }

  // Build readable message inline.
  const ago = relativeTime(e.at);
  const cityLabel = e.city ? ` from ${e.city}` : '';

  const body = e.type === 'claim' ? (
    <>
      <p className="text-sm leading-snug text-text">
        <span className="font-medium">{e.name}</span>
        <span className="text-secondary">{cityLabel} just claimed a free spot</span>
      </p>
      <p className="mt-0.5 text-xs text-muted">{ago}</p>
    </>
  ) : (
    <>
      <p className="text-sm leading-snug text-text">
        <span className="font-medium">{e.name}</span>
        <span className="text-secondary">{cityLabel} built</span>
      </p>
      <p className="mt-0.5 truncate text-sm font-medium text-text">{e.title}</p>
      <p className="mt-0.5 text-xs text-muted">{ago}</p>
    </>
  );

  const href = e.type === 'build' ? `/dates/${e.slug}` : '/login';

  return (
    <div className="fixed bottom-4 left-4 z-40 max-w-[340px] animate-[fadeIn_.4s_ease-out]">
      <Link
        href={href}
        className="flex items-start gap-3 rounded-card border border-border bg-background px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_8px_32px_rgba(0,0,0,0.14)]"
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
          className="-mr-1 -mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </Link>
      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

'use client';

// Bottom-left toast that rotates through recent attributed plans.
// "Sarah from Glenmore built 'Trail sweat, then a slow pour' · 2 hr ago".
// Fades in 6s after page load, rotates every 10s, dismissible. Pulls from
// itineraries with built_by_name set (gate-attributed).

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { relativeTime } from '@/lib/relative-time';
import { X } from 'lucide-react';

interface RecentBuild {
  id: string;
  slug: string | null;
  title: string | null;
  built_by_name: string | null;
  built_by_neighborhood: string | null;
  generated_at: string | null;
}

const DISMISSED_KEY = 'after5_recent_builds_dismissed';

export function RecentBuildsToast() {
  const [builds, setBuilds] = useState<RecentBuild[]>([]);
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Honor dismissal for the session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(DISMISSED_KEY)) setDismissed(true);
  }, []);

  // Pull recent attributed plans on mount.
  useEffect(() => {
    if (dismissed) return;
    const supabase = createClient();
    supabase
      .from('itineraries')
      .select('id, slug, title, built_by_name, built_by_neighborhood, generated_at')
      .eq('is_public', true)
      .not('built_by_name', 'is', null)
      .not('slug', 'is', null)
      .order('generated_at', { ascending: false })
      .limit(8)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setBuilds(data as RecentBuild[]);
          // Delay show by 6s so the toast doesn't fight the hero for attention.
          setTimeout(() => setVisible(true), 6000);
        }
      });
  }, [dismissed]);

  // Rotate every 10s.
  useEffect(() => {
    if (builds.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % builds.length), 10000);
    return () => clearInterval(id);
  }, [builds.length]);

  if (dismissed || !visible || builds.length === 0) return null;
  const b = builds[idx];
  if (!b) return null;

  function dismiss() {
    setDismissed(true);
    if (typeof window !== 'undefined') sessionStorage.setItem(DISMISSED_KEY, '1');
  }

  return (
    <div className="fixed bottom-4 left-4 z-40 max-w-[340px] animate-[fadeIn_.4s_ease-out]">
      <Link
        href={b.slug ? `/dates/${b.slug}` : '/dates'}
        className="flex items-start gap-3 rounded-card border border-border bg-background px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_8px_32px_rgba(0,0,0,0.14)]"
      >
        <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-snug text-text">
            <span className="font-medium">{b.built_by_name}</span>
            {b.built_by_neighborhood && (
              <span className="text-secondary"> from {b.built_by_neighborhood}</span>
            )}
            <span className="text-secondary"> built</span>
          </p>
          {b.title && (
            <p className="mt-0.5 truncate text-sm font-medium text-text">{b.title}</p>
          )}
          <p className="mt-1 text-xs text-muted">{relativeTime(b.generated_at)}</p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
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

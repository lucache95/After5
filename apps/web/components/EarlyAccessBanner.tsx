'use client';

// Thin promo bar across the top of every page. Establishes the early-
// adopter offer ("forever free for the first 100 members") so it's
// visible at every entry point without needing dedicated marketing pages.
//
// Hidden when the user is already authed — they've claimed their spot.
// Hidden on /login, /admin, /auth (compete with auth flow) and /offline
// (links can't work offline).
// Dismissible — sessionStorage, so it comes back next visit but doesn't
// nag mid-session.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const STORAGE_KEY = 'after5_early_access_dismissed_v1';

export function EarlyAccessBanner() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(true); // hide until hydrated
  const [authed, setAuthed] = useState<boolean | null>(null); // null = loading
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const wasDismissed = sessionStorage.getItem(STORAGE_KEY) === '1';
    setDismissed(wasDismissed);
  }, []);

  // Resolve auth state once on mount — no subscription needed, banner is static.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setAuthed(!!user);
    }).catch(() => {
      setAuthed(false);
    });
  }, []);

  // Pull live spots-remaining once on mount. Endpoint is cached 60s on the
  // server so this is cheap; we just show the count that was true ~1 min ago.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.remaining === 'number') setRemaining(data.remaining);
      })
      .catch(() => { /* fall back to no count */ });
    return () => { cancelled = true; };
  }, []);

  // Routes where the banner would compete or feel weird.
  const hideOn =
    pathname === '/login' ||
    pathname === '/offline' ||
    pathname?.startsWith('/admin') ||
    pathname?.startsWith('/auth');

  // Wait for auth resolution before showing; authenticated users never see it.
  if (hideOn || dismissed || authed === null || authed) return null;

  function handleDismiss() {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  }

  // Only show the scarcity count when we have a number AND there's real
  // scarcity to call out. If the cap is full, frame it differently.
  const countChip = remaining !== null ? (
    remaining > 0 ? (
      <span className="inline-flex items-center gap-1 rounded-pill bg-amber-950/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-amber-950 [font-variant-numeric:tabular-nums]">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-700 animate-pulse" />
        {remaining} {remaining === 1 ? 'spot' : 'spots'} left
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-pill bg-amber-950/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-amber-950">
        spots full — join the waitlist
      </span>
    )
  ) : null;

  return (
    <aside
      aria-label="early access announcement"
      className="relative z-[60] bg-gradient-to-r from-amber-100 via-rose-100 to-amber-100 text-amber-950"
    >
      <div className="mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-2 md:px-10">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-medium leading-tight md:text-[13px]">
          <span aria-hidden className="text-amber-700">★</span>
          <span>forever free for the first 100 members.</span>
          {countChip}
          <Link
            href="/login"
            className="underline decoration-amber-700/50 decoration-1 underline-offset-[4px] transition-colors hover:decoration-amber-900"
          >
            claim your spot →
          </Link>
        </p>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="dismiss"
          className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-amber-900/70 transition-colors hover:bg-amber-200/60 hover:text-amber-950"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </div>
    </aside>
  );
}

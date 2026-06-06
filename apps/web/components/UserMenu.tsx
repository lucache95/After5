'use client';

// Auth-aware nav widget. Drop into any header.
//   - Signed out → "sign in" link to /login
//   - Signed in  → avatar that opens a small dating-IA menu
//                  (profile + your nights + matches + messages + sign out)
//
// Barbiecore (DESIGN-SYSTEM §1–3): shell.* tokens, font-heading/font-body,
// lowercase dry copy. The dropdown points at the live dating loop, NOT the
// legacy planner. A discreet "plan a date" wedge link stays at the bottom.
//
// Two visual variants — `on-dark` for image-overlay headers (homepage hero
// nav), `on-light` for standard light-bg headers.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from './Avatar';
import { cn } from '@/lib/cn';

interface SessionUser {
  email: string;
  firstName: string | null;
}

// Dating-app IA. Primary destinations are the live loop surfaces; the planner
// link is the discreet wedge at the bottom, not part of the main nav.
const MENU_ITEMS: { href: string; label: string }[] = [
  { href: '/account', label: 'your profile' },
  { href: '/my-nights', label: 'your nights' },
  { href: '/matches', label: 'matches' },
  { href: '/messages', label: 'messages' },
];

export function UserMenu({ variant = 'on-light' }: { variant?: 'on-dark' | 'on-light' }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Resolve session + profile once on mount; update on auth events.
  useEffect(() => {
    const supabase = createClient();

    async function resolve() {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) {
        setUser(null);
        setHydrated(true);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name')
        .eq('id', u.id)
        .maybeSingle();
      setUser({
        email: u.email ?? '',
        firstName: profile?.first_name ?? null,
      });
      setHydrated(true);
    }
    void resolve();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void resolve();
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  // Close menu on outside click + Escape
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Pre-hydration: render nothing to avoid flash. Header CTA still appears
  // alongside this so the bar isn't empty.
  if (!hydrated) {
    return <span aria-hidden className="inline-block h-9 w-9" />;
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className={cn(
          'font-body text-sm font-medium lowercase transition-colors',
          variant === 'on-dark'
            ? 'text-white/90 hover:text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]'
            : 'text-shell-ink/70 hover:text-shell-ink',
        )}
      >
        sign in
      </Link>
    );
  }

  const displayName = (user.firstName || user.email.split('@')[0] || 'you').toLowerCase();

  return (
    <div ref={wrapRef} className="relative flex items-center gap-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="account menu"
        aria-expanded={open}
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-shadow',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
          variant === 'on-dark'
            ? 'ring-2 ring-white/40 hover:ring-white/70'
            : 'ring-2 ring-shell-accent/30 hover:ring-shell-accent/60',
        )}
      >
        <Avatar name={displayName} size="md" className="!h-9 !w-9 !text-sm" />
      </button>

      {open && (
        <div
          // Anchor near the avatar but constrain so it never overflows small
          // viewports. -right-2 nudges it just past the avatar's right edge;
          // the max-width clamp keeps it inside iPhone-SE width.
          className="absolute -right-2 top-12 z-50 w-[min(15rem,calc(100vw-2rem))] origin-top-right rounded-3xl border-2 border-shell-ink/10 bg-shell-base py-2 shadow-fun"
          role="menu"
        >
          <div className="border-b border-shell-ink/10 px-4 py-3">
            <p className="font-heading text-base lowercase text-shell-ink">{displayName}</p>
            <p className="mt-0.5 truncate font-body text-xs text-shell-ink/60">{user.email}</p>
          </div>
          {MENU_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 font-body text-sm lowercase text-shell-ink transition-colors hover:bg-shell-pink/60"
              role="menuitem"
            >
              {item.label}
            </Link>
          ))}
          {/* discreet planner wedge — not part of the main dating IA. Phase 10:
              points straight at the generate funnel. */}
          <Link
            href="/create/generate"
            onClick={() => setOpen(false)}
            className="block border-t border-shell-ink/10 px-4 py-2.5 font-body text-xs lowercase text-shell-ink/55 transition-colors hover:bg-shell-pink/60 hover:text-shell-ink/80"
            role="menuitem"
          >
            plan a date
          </Link>
          <form action="/auth/signout" method="post" className="border-t border-shell-ink/10">
            <button
              type="submit"
              className="block w-full px-4 py-2.5 text-left font-body text-sm lowercase text-shell-ink transition-colors hover:bg-shell-pink/60"
              role="menuitem"
            >
              sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

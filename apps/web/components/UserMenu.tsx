'use client';

// Auth-aware nav widget. Drop into any header.
//   - Signed out → "Sign in" link to /login
//   - Signed in  → "My dates" link + avatar that opens a small menu
//                  with profile name + sign-out action
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
          'text-sm font-medium transition-colors',
          variant === 'on-dark'
            ? 'text-white/90 hover:text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]'
            : 'text-secondary hover:text-text',
        )}
      >
        Sign in
      </Link>
    );
  }

  const displayName = user.firstName || user.email.split('@')[0] || 'You';

  return (
    <div ref={wrapRef} className="relative flex items-center gap-4">
      {/* "My dates" text hidden on small screens — avatar alone takes you to
          /account via the menu. Keeps the nav from wrapping on iPhone SE. */}
      <Link
        href="/account"
        className={cn(
          'hidden text-sm font-medium transition-colors sm:inline',
          variant === 'on-dark'
            ? 'text-white/95 hover:text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]'
            : 'text-secondary hover:text-text',
        )}
      >
        My dates
      </Link>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-shadow',
          variant === 'on-dark'
            ? 'ring-2 ring-white/40 hover:ring-white/70'
            : 'ring-2 ring-border hover:ring-text/40',
        )}
      >
        <Avatar name={displayName} size="md" className="!h-9 !w-9 !text-sm" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-12 z-50 w-60 origin-top-right rounded-card border border-border bg-background py-2 shadow-[0_16px_40px_-8px_rgba(0,0,0,0.18)]"
          role="menu"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="font-display text-sm font-semibold text-text">{displayName}</p>
            <p className="mt-0.5 truncate text-xs text-secondary">{user.email}</p>
          </div>
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-text transition-colors hover:bg-surface"
            role="menuitem"
          >
            My dates
          </Link>
          <Link
            href="/plan"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-text transition-colors hover:bg-surface"
            role="menuitem"
          >
            Plan a date
          </Link>
          <form action="/auth/signout" method="post" className="border-t border-border">
            <button
              type="submit"
              className="block w-full px-4 py-2 text-left text-sm text-text transition-colors hover:bg-surface"
              role="menuitem"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

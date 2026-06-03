'use client';
// Tier-1 bottom-tab nav (DESIGN-SYSTEM §4): fixed, phone-width, lowercase labels.
// Unified inbox (#84) nav: discover · dates · ➕ · inbox · profile — five slots with
// a CENTER-RAISED "+" (TikTok pattern) that links to /create (the create chooser,
// owned by another agent). The inbox tab REPLACES the old messages tab and absorbs
// the notification bell: a combined unread pill (activity + threads) sits on its
// icon via InboxTabBadge (seeded only when a userId is passed — every authed page
// that mounts the nav passes it).
// Active state: ink-color label with a 2px pink bar above the icon (high-contrast;
// the audit found pink-on-cream at 11px failed AA, so the readable text stays ink).
// Active tab is derived from the URL via usePathname (aria-current="page").
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, CalendarHeart, Inbox, UserRound, Plus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { InboxTabBadge } from './InboxTabBadge';

type Tab = { key: string; label: string; href: string; icon: LucideIcon; badge?: boolean };

const TABS: Tab[] = [
  { key: 'discover', label: 'discover', href: '/feed', icon: Compass },
  { key: 'dates', label: 'dates', href: '/my-nights', icon: CalendarHeart },
  { key: 'inbox', label: 'inbox', href: '/inbox', icon: Inbox, badge: true },
  { key: 'profile', label: 'profile', href: '/home', icon: UserRound },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomTabShell({ userId }: { userId?: string } = {}) {
  const pathname = usePathname() ?? '';
  // Split the four real tabs around the center "+" so the raised button sits in
  // the middle of the row (discover · dates · + · inbox · profile).
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  return (
    <nav
      aria-label="primary"
      className="fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex w-full max-w-[420px] items-stretch justify-around gap-1 border-t border-shell-ink/10 bg-shell-base/95 px-2 py-2 backdrop-blur-md">
        {left.map((tab) => (
          <TabLink key={tab.key} tab={tab} pathname={pathname} userId={userId} />
        ))}

        {/* Center-raised create button — links to /create (the chooser is another
            agent's; this just points at it). Pulled up out of the bar with a pink
            disc so it reads as the primary action, TikTok-style. */}
        <div className="flex flex-1 items-start justify-center">
          <Link
            href="/create"
            aria-label="create"
            aria-current={isActive(pathname, '/create') ? 'page' : undefined}
            className={cn(
              '-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-shell-accent text-white shadow-fun ring-4 ring-shell-base transition',
              'hover:scale-105 active:scale-95',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/50',
              'motion-reduce:transition-none motion-reduce:hover:scale-100',
            )}
          >
            <Plus className="h-7 w-7" strokeWidth={2.75} aria-hidden />
          </Link>
        </div>

        {right.map((tab) => (
          <TabLink key={tab.key} tab={tab} pathname={pathname} userId={userId} />
        ))}
      </div>
    </nav>
  );
}

function TabLink({ tab, pathname, userId }: { tab: Tab; pathname: string; userId?: string }) {
  const Icon = tab.icon;
  const active = isActive(pathname, tab.href);
  return (
    <Link
      href={tab.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50',
        'motion-reduce:transition-none',
        active ? 'text-shell-ink' : 'text-shell-ink/75 hover:text-shell-ink',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -top-1.5 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-shell-accent"
        />
      )}
      <span className="relative">
        <Icon className="h-6 w-6" strokeWidth={active ? 2.6 : 2} aria-hidden />
        {tab.badge && userId && <InboxTabBadge userId={userId} />}
      </span>
      <span className={cn('font-body text-[11px] lowercase leading-none', active && 'font-semibold')}>
        {tab.label}
      </span>
    </Link>
  );
}

'use client';
// Tier-1 bottom-tab nav (DESIGN-SYSTEM §4): fixed, phone-width, lowercase labels,
// hot-pink ACCENT on the active tab only. Two surfaces ship (discover → /feed,
// profile → /home); dates + messages aren't built yet, so they're NOT dead links —
// tapping fires a dry "coming soon" toast and they wear a tiny "soon" badge.
// Active tab is derived from the URL via usePathname (aria-current="page").
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { Compass, CalendarHeart, MessageCircle, UserRound, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

type LiveTab = { kind: 'live'; key: string; label: string; href: string; icon: LucideIcon };
type SoonTab = { kind: 'soon'; key: string; label: string; icon: LucideIcon };
type Tab = LiveTab | SoonTab;

const TABS: Tab[] = [
  { kind: 'live', key: 'discover', label: 'discover', href: '/feed', icon: Compass },
  { kind: 'soon', key: 'dates', label: 'dates', icon: CalendarHeart },
  { kind: 'soon', key: 'messages', label: 'messages', icon: MessageCircle },
  { kind: 'live', key: 'profile', label: 'profile', href: '/home', icon: UserRound },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomTabShell() {
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label="primary"
      className="fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex w-full max-w-[420px] items-stretch justify-around gap-1 border-t border-shell-ink/10 bg-shell-base/95 px-2 py-2 backdrop-blur-md">
        {TABS.map((tab) => {
          const Icon = tab.icon;

          if (tab.kind === 'live') {
            const active = isActive(pathname, tab.href);
            return (
              <Link
                key={tab.key}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50',
                  'motion-reduce:transition-none',
                  active ? 'text-shell-accent' : 'text-shell-ink/55 hover:text-shell-ink',
                )}
              >
                <Icon
                  className="h-6 w-6"
                  strokeWidth={active ? 2.6 : 2}
                  aria-hidden
                />
                <span className="font-body text-[11px] lowercase leading-none">{tab.label}</span>
              </Link>
            );
          }

          // coming-soon tab: never navigates. Dry toast + persistent "soon" badge.
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => toast('coming soon ✨', { description: `${tab.label} aren’t live yet — sit tight.` })}
              aria-label={`${tab.label} — coming soon`}
              className={cn(
                'relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 transition-colors',
                'text-shell-ink/40 hover:text-shell-ink/60',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50',
                'motion-reduce:transition-none',
              )}
            >
              <span className="relative inline-flex">
                <Icon className="h-6 w-6" strokeWidth={2} aria-hidden />
                <span
                  aria-hidden
                  className="absolute -right-3 -top-1.5 rounded-full bg-shell-pink px-1.5 py-px font-body text-[8px] font-semibold lowercase tracking-wide text-shell-accent ring-1 ring-shell-accent/20"
                >
                  soon
                </span>
              </span>
              <span className="font-body text-[11px] lowercase leading-none">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

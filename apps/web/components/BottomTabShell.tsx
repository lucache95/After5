'use client';
// Tier-1 bottom-tab nav (DESIGN-SYSTEM §4): fixed, phone-width, lowercase labels.
// Active state: ink-color label with a 2px pink bar above the icon (high-contrast;
// the audit found pink-on-cream at 11px failed AA, so the readable text stays ink).
// Live surfaces: discover → /feed, dates → /my-nights, messages → /messages,
// profile → /home. The SoonTab branch stays for any future coming-soon tab.
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
  { kind: 'live', key: 'dates', label: 'dates', href: '/my-nights', icon: CalendarHeart },
  { kind: 'live', key: 'messages', label: 'messages', href: '/messages', icon: MessageCircle },
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
                  'relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50',
                  'motion-reduce:transition-none',
                  active
                    ? 'text-shell-ink'
                    : 'text-shell-ink/75 hover:text-shell-ink',
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute -top-1.5 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-shell-accent"
                  />
                )}
                <Icon
                  className="h-6 w-6"
                  strokeWidth={active ? 2.6 : 2}
                  aria-hidden
                />
                <span
                  className={cn(
                    'font-body text-[11px] lowercase leading-none',
                    active && 'font-semibold',
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            );
          }

          // coming-soon tab: never navigates. Dry toast + muted state.
          // Locked state is communicated via the muted color and the aria-label.
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => toast('coming soon ✨', { description: `${tab.label} aren’t live yet — sit tight.` })}
              aria-label={`${tab.label} — coming soon`}
              className={cn(
                'relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 transition-colors',
                'text-shell-ink/60 hover:text-shell-ink/75',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50',
                'motion-reduce:transition-none',
              )}
            >
              <Icon className="h-6 w-6" strokeWidth={2} aria-hidden />
              <span className="font-body text-[11px] lowercase leading-none">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

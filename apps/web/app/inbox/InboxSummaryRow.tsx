// apps/web/app/inbox/InboxSummaryRow.tsx
// A collapsed category row for the inbox (founder 2026-06-12, TikTok inbox
// pattern): a round icon + label + one-line preview + optional unread count,
// the whole row a tap-target to a dedicated page. Server-rendered Link — no
// client state; the destination page owns the live list. Mirrors TikTok's
// "New followers / Activity / System notifications" rows above the DMs.
import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export function InboxSummaryRow({
  href,
  Icon,
  label,
  preview,
  count = 0,
  tone = 'neutral',
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  /** One-line preview under the label (latest item / tally). */
  preview: string;
  /** Unread/queue count — shows a pink badge + bolds the row when > 0. */
  count?: number;
  /** 'accent' tints the icon disc pink (queue); 'neutral' is the default. */
  tone?: 'neutral' | 'accent';
}) {
  const active = count > 0;
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-[64px] items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/50',
        active ? 'bg-shell-pink/40 hover:bg-shell-pink/60' : 'bg-white hover:bg-shell-ink/5',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
          tone === 'accent' || active ? 'bg-shell-accent text-white' : 'bg-shell-ink/5 text-shell-ink/60',
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block font-body text-[15px] lowercase text-shell-ink', active && 'font-semibold')}>
          {label}
        </span>
        <span className="block truncate font-body text-[13px] text-shell-ink/55">{preview}</span>
      </span>
      {count > 0 && (
        <span
          aria-label={`${count} new`}
          className="shrink-0 rounded-full bg-shell-accent px-2 py-0.5 font-body text-[11px] font-semibold leading-none text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      <ChevronRight className="h-5 w-5 shrink-0 text-shell-ink/30" aria-hidden />
    </Link>
  );
}

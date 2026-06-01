'use client';
// Phase 7 messages tab — the viewer's chat threads. One row per thread (per
// offer/night, per plan §0 decision #4): counterpart photo + name, the night's
// date label, last-message preview, and an unread dot. Barbiecore: phone-width,
// rounded cards, lowercase Caprasimo title, dry empty state. Each row links to
// the conversation at /messages/[threadId].
import Link from 'next/link';
import { Polaroid } from '@/components/Polaroid';
import { LocalTime } from '@/components/LocalTime';
import { cn } from '@/lib/cn';
import type { ThreadSummary } from './thread-view';

function Row({ thread }: { thread: ThreadSummary }) {
  const name = thread.counterpartName ?? 'someone';
  const hasUnread = thread.unread > 0;
  return (
    <Link
      href={`/messages/${thread.threadId}`}
      aria-label={`chat with ${name}${hasUnread ? `, ${thread.unread} unread` : ''}`}
      className={cn(
        'flex min-h-[44px] items-center gap-4 rounded-3xl border-2 border-shell-ink/10 bg-white p-3 transition',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 hover:border-shell-ink/25',
      )}
    >
      <Polaroid src={thread.counterpartPhotoUrl ?? ''} alt={name} size="sm" tone="dating" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={cn('truncate font-heading text-xl lowercase text-shell-ink', hasUnread && 'font-semibold')}>
            {name}
          </p>
          {hasUnread && (
            <span
              aria-hidden
              className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-shell-accent"
            />
          )}
        </div>
        <LocalTime
          iso={thread.startsAt}
          opts={{ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }}
          fallback="date tbd"
          className="truncate font-body text-xs text-shell-ink/55"
        />
        <p
          className={cn(
            'truncate font-body text-sm',
            hasUnread ? 'text-shell-ink/80' : 'text-shell-ink/55',
          )}
        >
          {thread.lastMessage ?? 'no messages yet'}
        </p>
      </div>
    </Link>
  );
}

export function ThreadList({ threads }: { threads: ThreadSummary[] }) {
  if (threads.length === 0) {
    return (
      <main className="mx-auto w-full max-w-[420px] px-4 py-16 text-center">
        <h1 className="font-heading text-4xl lowercase text-shell-ink">no chats yet</h1>
        <p className="mt-3 font-body text-shell-ink/70">lock eyes on a night first.</p>
        <Link
          href="/feed"
          className="mt-6 inline-block rounded-full bg-shell-accent px-6 py-3 font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          browse dates
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[420px] space-y-6 px-4 py-6">
      <h1 className="font-heading text-4xl lowercase text-shell-ink">messages</h1>
      <ul aria-label="conversations" className="space-y-3">
        {threads.map((t) => (
          <li key={t.threadId}>
            <Row thread={t} />
          </li>
        ))}
      </ul>
    </main>
  );
}

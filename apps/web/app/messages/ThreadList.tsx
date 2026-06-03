'use client';
// Phase 7 messages tab — the viewer's chat threads. One row per thread (per
// offer/night, per plan §0 decision #4): counterpart photo + name, last-message
// preview (one line), a relative timestamp, and an unread dot/count. Barbiecore:
// phone-width, tight rows, round avatar with a pink-wash fallback (never '' to
// next/image), lowercase Caprasimo title, dry empty state. Each row links to the
// conversation at /messages/[threadId].
import Image from 'next/image';
import Link from 'next/link';
import { LocalTime } from '@/components/LocalTime';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/cn';
import type { ThreadSummary } from './thread-view';

// Round counterpart avatar. Guards a missing photo with a pink-wash circle
// carrying the name's first letter — never passes '' to next/image. Swaps to the
// same fallback if the photo URL errors (expired/blocked) so a row never breaks.
function Avatar({ src, name, dimmed }: { src: string | null; name: string; dimmed: boolean }) {
  const initial = (name.trim()[0] ?? '?').toLowerCase();
  return (
    <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-full bg-shell-pink ring-2 ring-white">
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 flex items-center justify-center font-heading text-2xl lowercase text-shell-accent',
          dimmed && 'opacity-70',
        )}
      >
        {initial}
      </span>
      {src && (
        <Image
          src={src}
          alt={name}
          fill
          sizes="56px"
          className={cn('object-cover', dimmed && 'opacity-90')}
        />
      )}
    </span>
  );
}

// Exported so the unified inbox (#84) can render the same row under its own base
// path. `basePath` re-homes the conversation link so back-nav stays in-tab
// (/inbox/[threadId] vs the standalone /messages/[threadId]); defaults to messages.
export function ThreadRow({ thread, basePath = '/messages' }: { thread: ThreadSummary; basePath?: string }) {
  const name = thread.counterpartName ?? 'someone';
  const hasUnread = thread.unread > 0;
  const count = thread.unread > 9 ? '9+' : String(thread.unread);
  const preview = thread.lastMessage ?? 'no messages yet, say hey';
  return (
    <Link
      href={`${basePath}/${thread.threadId}`}
      aria-label={`chat with ${name}${hasUnread ? `, ${thread.unread} unread` : ''}`}
      className={cn(
        'flex min-h-[44px] items-center gap-3 rounded-2xl px-3 py-2.5 transition',
        'hover:bg-shell-pink/50 focus-visible:bg-shell-pink/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
        hasUnread && 'bg-shell-pink/40',
      )}
    >
      <Avatar src={thread.counterpartPhotoUrl} name={name} dimmed={!hasUnread && thread.lastMessage == null} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate font-heading text-lg lowercase leading-tight text-shell-ink',
              hasUnread && 'font-semibold',
            )}
          >
            {name}
          </span>
          {thread.lastAt && (
            <LocalTime
              iso={thread.lastAt}
              format={(d) => relativeTime(d)}
              fallback=""
              className={cn(
                'shrink-0 font-body text-[11px] lowercase tabular-nums',
                hasUnread ? 'font-semibold text-shell-accent' : 'text-shell-ink/45',
              )}
            />
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate font-body text-sm',
              hasUnread ? 'text-shell-ink/80' : 'text-shell-ink/50',
            )}
          >
            {preview}
          </span>
          {hasUnread && (
            <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-shell-accent px-1.5 font-body text-[11px] font-semibold leading-none text-white">
              {count}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

export function ThreadList({ threads }: { threads: ThreadSummary[] }) {
  if (threads.length === 0) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-[420px] flex-col items-center justify-center px-6 py-16 text-center">
        <span className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-shell-pink text-4xl">
          💌
        </span>
        <h1 className="font-heading text-4xl lowercase text-shell-ink">no chats yet</h1>
        <p className="mt-3 max-w-[16rem] font-body text-shell-ink/65">
          lock eyes on a night and the chat opens up here.
        </p>
        <Link
          href="/feed"
          className="mt-7 inline-block rounded-full bg-shell-accent px-7 py-3 font-body font-semibold lowercase text-white shadow-fun transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          browse dates
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[420px] px-3 py-6">
      <h1 className="px-1 font-heading text-4xl lowercase text-shell-ink">messages</h1>
      <ul aria-label="conversations" className="mt-4 space-y-0.5">
        {threads.map((t) => (
          <li key={t.threadId}>
            <ThreadRow thread={t} />
          </li>
        ))}
      </ul>
    </main>
  );
}

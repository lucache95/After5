'use client';
// Phase 7 conversation view (Task 11). Seeds from the server's initial messages,
// subscribes to live inserts (postgres_changes; the SENDER ALSO RECEIVES THE ECHO
// of their own insert, so every fold dedupes by message id via mergeMessage), marks
// the thread read on mount + on window focus, and renders bubbles (own vs
// counterpart aligned). The composer is optimistic: a temp row appears instantly and
// is reconciled when the realtime echo lands (replace temp id) or rolled back on
// failure.
//
// Soft rapport nudge (plan decision #2): purely informational. While both_ready is
// false we show "say hi before you lock in" — unless the pair is ALREADY locked
// (coherence fix, live crawl 2026-06-10), where the honest line is "you're locked
// in. break the ice."; once both have sent, a subtle "you've both said hi 👋"
// either way. It NEVER gates sending, accepting, or locking — no lock/accept code
// is touched here.
//
// Header avatar (coherence fix): every other counterpart surface shows one. The
// page passes counterpartPhotoUrl ONLY post-lock (clear photo, same source the
// inbox ThreadRow renders); pre-lock it is null and the initial chip keeps the
// blind contract — never a blurred photo pretending to be clear.
//
// Report (plan decision #5): a small "report" affordance on RECEIVED bubbles only.
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { subscribeThreadMessages } from '@/lib/after5/realtime';
import { reportMessage } from '@/lib/after5/chat';
import { markRead } from '@/lib/after5/chat';
import { MatchError, messageForCode } from '@/lib/after5/match';
import { track } from '@/app/PostHogProvider';
import { cn } from '@/lib/cn';
import { mergeMessage, type MessageRow } from '../thread-view';
import { Composer } from './Composer';
import { LocalTime } from '@/components/LocalTime';

export interface ConversationProps {
  threadId: string;
  viewerId: string;
  counterpartName: string;
  // lock_id present on the thread — flips the rapport nudge to the locked variant.
  locked?: boolean;
  // Clear photo for the header avatar; the page passes this ONLY when locked
  // (blind contract). null ⇒ initial chip.
  counterpartPhotoUrl?: string | null;
  messageable: boolean;
  bothReady: boolean;
  initialMessages: MessageRow[];
}

function Bubble({
  message,
  isOwn,
  onReport,
}: {
  message: MessageRow;
  isOwn: boolean;
  onReport: (id: string) => void;
}) {
  return (
    <li className={cn('flex flex-col', isOwn ? 'items-end' : 'items-start')}>
      <div className={cn('group flex max-w-[80%] items-end gap-1.5', isOwn && 'flex-row-reverse')}>
        <div
          data-own={isOwn ? 'true' : 'false'}
          className={cn(
            'rounded-3xl px-4 py-2 font-body',
            isOwn ? 'bg-shell-accent text-white' : 'bg-shell-pink text-shell-ink',
          )}
        >
          {message.body}
        </div>
        {!isOwn && (
          <button
            type="button"
            onClick={() => onReport(message.id)}
            aria-label="report this message"
            className="shrink-0 rounded-full p-1 text-xs lowercase text-shell-ink/40 opacity-0 transition hover:text-shell-ink/70 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40 group-hover:opacity-100"
          >
            report
          </button>
        )}
      </div>
      <LocalTime
        iso={message.created_at}
        opts={{ hour: 'numeric', minute: '2-digit' }}
        className="mt-0.5 px-1 font-body text-[10px] text-shell-ink/40"
      />
    </li>
  );
}

export function Conversation({
  threadId,
  viewerId,
  counterpartName,
  locked = false,
  counterpartPhotoUrl = null,
  messageable,
  bothReady,
  initialMessages,
}: ConversationProps) {
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const [ready, setReady] = useState(bothReady);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  // Derive the soft nudge from whether each party has sent >=1 (UI affordance only).
  useEffect(() => {
    const fromViewer = messages.some((m) => m.sender_id === viewerId);
    const fromOther = messages.some((m) => m.sender_id !== viewerId);
    if (fromViewer && fromOther) setReady(true);
  }, [messages, viewerId]);

  // Analytics: one chat_opened per thread mount.
  useEffect(() => {
    track.chatOpened(threadId);
  }, [threadId]);

  // Live inserts — dedupe by id (the sender receives their own echo).
  useEffect(() => {
    const off = subscribeThreadMessages(threadId, (row) => {
      setMessages((prev) => mergeMessage(prev, row));
    });
    return off;
  }, [threadId]);

  // Mark read on mount + whenever the window regains focus.
  useEffect(() => {
    const mark = () => {
      markRead(threadId).catch(() => {});
    };
    mark();
    window.addEventListener('focus', mark);
    return () => window.removeEventListener('focus', mark);
  }, [threadId]);

  // Auto-scroll to newest, respecting reduced-motion.
  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    listEndRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }, [messages]);

  const onOptimistic = useCallback((tempId: string, body: string) => {
    setMessages((prev) => mergeMessage(prev, {
      id: tempId, thread_id: threadId, sender_id: viewerId, body,
      read_at: null, created_at: new Date().toISOString(),
    }));
  }, [threadId, viewerId]);

  const onSettled = useCallback((tempId: string, messageId: string | null) => {
    setMessages((prev) => {
      if (messageId === null) return prev.filter((m) => m.id !== tempId); // rollback
      // Reconcile the temp row to the real id; the realtime echo (same id) then dedupes.
      if (prev.some((m) => m.id === messageId)) return prev.filter((m) => m.id !== tempId);
      return prev.map((m) => (m.id === tempId ? { ...m, id: messageId } : m));
    });
  }, []);

  async function confirmReport() {
    if (!reportTarget) return;
    const id = reportTarget;
    setReportTarget(null);
    try {
      await reportMessage(id);
      toast('reported. we’ll take a look.');
    } catch (e) {
      const code = e instanceof MatchError ? e.code : 'server_error';
      toast.error(messageForCode(code));
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col px-4 py-4">
      <header className="flex items-center gap-3 pb-3">
        {/* Counterpart avatar (~40px per the design system). Clear photo only when
            the page passed one (post-lock, the inbox ThreadRow's source); otherwise
            the initial chip — the blind contract pre-lock. */}
        <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-full bg-shell-pink ring-2 ring-white">
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center font-heading text-lg lowercase text-shell-accent"
          >
            {(counterpartName.trim()[0] ?? '?').toLowerCase()}
          </span>
          {counterpartPhotoUrl && (
            <Image src={counterpartPhotoUrl} alt="" fill sizes="40px" className="object-cover" />
          )}
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-heading text-2xl lowercase text-shell-ink">{counterpartName}</h1>
          <p className="font-body text-xs text-shell-ink/55">
            {ready ? 'you’ve both said hi 👋' : locked ? 'you’re locked in. break the ice.' : 'say hi before you lock in'}
          </p>
        </div>
      </header>

      <ul
        role="log"
        aria-live="polite"
        aria-label="messages"
        className="flex flex-1 flex-col gap-2 overflow-y-auto py-2"
      >
        {messages.map((m) => (
          <Bubble key={m.id} message={m} isOwn={m.sender_id === viewerId} onReport={setReportTarget} />
        ))}
        <div ref={listEndRef} aria-hidden />
      </ul>

      {messageable ? (
        <div className="pt-2">
          <Composer threadId={threadId} onOptimistic={onOptimistic} onSettled={onSettled} />
        </div>
      ) : (
        <p className="py-3 text-center font-body text-sm text-shell-ink/55">this chat is closed.</p>
      )}

      {reportTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4" role="dialog" aria-label="report message">
          <div className="w-full max-w-[420px] rounded-3xl bg-shell-base p-6">
            <p className="font-heading text-xl lowercase text-shell-ink">report this message?</p>
            <p className="mt-1 font-body text-sm text-shell-ink/65">we’ll review it. they won’t be told who reported.</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="min-h-[44px] flex-1 rounded-full border-2 border-shell-ink/20 px-4 py-2 font-body font-semibold lowercase text-shell-ink/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
              >
                never mind
              </button>
              <button
                type="button"
                onClick={() => void confirmReport()}
                className="min-h-[44px] flex-1 rounded-full bg-shell-accent px-4 py-2 font-body font-semibold lowercase text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
              >
                report
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// apps/web/app/messages/thread-view.ts
// Server-safe pure helpers for the Phase 7 chat UI. NO 'use client' — imported by
// the server pages (messages/page.tsx, [threadId]/page.tsx) AND the client
// components, so it must stay framework-neutral (same rule as lock-view.ts).
import type { Database } from '@after5/types';

export type MessageRow = Database['public']['Tables']['messages']['Row'];

// One thread-list row: counterpart (reveal-aware) + last-message preview + unread.
export interface ThreadSummary {
  threadId: string;
  counterpartName: string | null;
  counterpartPhotoUrl: string | null;
  dateLabel: string; // e.g. "fri, jun 6 · 7:00 pm" (the night, not the guy)
  lastMessage: string | null;
  lastAt: string | null;
  unread: number;
  messageable: boolean;
}

const PREVIEW_MAX = 64;

// Unread for the VIEWER = messages from the counterpart that they haven't read.
// (read_at IS NULL AND sender_id <> me — the DB derives the same condition.)
export function unreadCount(messages: MessageRow[], viewerId: string): number {
  return messages.filter((m) => m.sender_id !== viewerId && m.read_at == null).length;
}

// Snippet of the newest message, truncated. Null on an empty thread.
export function lastMessagePreview(messages: MessageRow[]): { body: string; at: string } | null {
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1];
  const body = last.body.length > PREVIEW_MAX ? `${last.body.slice(0, PREVIEW_MAX - 1)}…` : last.body;
  return { body, at: last.created_at };
}

// Most-recent thread first; threads with no messages (null lastAt) sink to the bottom.
export function sortThreadsByRecency(threads: ThreadSummary[]): ThreadSummary[] {
  return [...threads].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
}

// Dedupe a message list by id, preserving order. The realtime subscription echoes
// the sender's own insert back, and an optimistic row may collide with the persisted
// one — keep the FIRST occurrence so an optimistic row already in place isn't dropped.
export function dedupeById(messages: MessageRow[]): MessageRow[] {
  const seen = new Set<string>();
  const out: MessageRow[] = [];
  for (const m of messages) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

// Insert/replace a message keyed by id, then keep oldest -> newest by created_at.
// Used by the conversation view to fold a realtime insert (or a reconciled
// optimistic row) into state without duplicating an id already present.
export function mergeMessage(messages: MessageRow[], incoming: MessageRow): MessageRow[] {
  const next = messages.some((m) => m.id === incoming.id)
    ? messages.map((m) => (m.id === incoming.id ? incoming : m))
    : [...messages, incoming];
  return [...next].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// Whether a thread can take new messages: open or promoted, never revoked/closed.
// Mirrors the server-side chat_thread_messageable predicate (Gate A).
export function isMessageable(state: string | null, revokedAt: string | null): boolean {
  return (state === 'open' || state === 'promoted') && revokedAt == null;
}

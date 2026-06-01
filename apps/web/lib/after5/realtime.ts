// apps/web/lib/after5/realtime.ts
// Supabase Realtime helper for the host interested-list (Seam 5). The channel
// is scoped by USER ID (queue:<userId>), not device, so a host gets new
// right-swipes on whichever device they're on. We additionally filter the
// postgres_changes stream to this instance's queue_entries inserts; RLS still
// gates what rows the socket may deliver.
'use client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { browserAfter5Client } from '@/lib/after5/client';
import type { After5Client } from '@after5/api-client';
import type { Database } from '@after5/types';

// Realtime postgres_changes is RLS-gated: the Realtime authorizer evaluates each
// table's RLS policy using the SOCKET's JWT. createBrowserClient (@supabase/ssr) does
// not reliably push the session token onto the realtime socket before a mount-effect
// subscribe fires, so the socket joins as anon → the authorizer denies every row →
// an idle subscriber silently receives NOTHING (proven on prod: chat recipients only
// saw new messages on reload). Fix: read the current session and setAuth the token
// onto the socket BEFORE joining the channel. See task #59 / chat-happy-path E2E.
async function joinAuthed(client: After5Client, channel: RealtimeChannel): Promise<void> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (token) client.realtime.setAuth(token);
  channel.subscribe();
}

export type QueueEntryRow = Database['public']['Tables']['queue_entries']['Row'];

export function subscribeQueueInserts(
  userId: string,
  instanceId: string,
  onInsert: (row: QueueEntryRow) => void,
): () => void {
  const client = browserAfter5Client();
  // Unique channel name per subscription: Supabase reuses a channel by topic, so a
  // fixed name collides when the same hook double-mounts (strict mode) or multiple
  // components subscribe — the reused channel is already subscribed and .on() throws
  // "cannot add postgres_changes callbacks after subscribe". RLS + the filter still scope rows.
  const ch = client
    .channel(`queue:${userId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'queue_entries',
        filter: `date_instance_id=eq.${instanceId}`,
      },
      (payload: { new: QueueEntryRow }) => onInsert(payload.new),
    );
  void joinAuthed(client, ch);
  return () => {
    client.removeChannel(ch);
  };
}

export type NotificationRow = Database['public']['Tables']['notifications']['Row'];

// Sub-project G (in-app notifications). User-scoped channel `notif:<userId>`.
// We add an explicit user_id filter (belt on top of RLS notifications_recipient_read)
// so the socket only delivers this viewer's rows. Caller (badge/toast) re-renders.
export function subscribeNotifications(
  userId: string,
  onInsert: (row: NotificationRow) => void,
): () => void {
  const client = browserAfter5Client();
  const ch = client
    .channel(`notif:${userId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload: { new: NotificationRow }) => onInsert(payload.new),
    );
  void joinAuthed(client, ch);
  return () => { client.removeChannel(ch); };
}

export type LockRow = Database['public']['Tables']['locks']['Row'];

// Sub-project F (MatchConfirmation). User-scoped channel: a viewer gets locks
// inserted where they participate. RLS (locks_party_read) already gates which
// rows the socket delivers, so no server-side filter string is needed; the
// caller still re-checks the new row references this viewer.
export function subscribeLockInserts(
  userId: string,
  onInsert: (row: LockRow) => void,
): () => void {
  const client = browserAfter5Client();
  const ch = client
    .channel(`locks:${userId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'locks' },
      (payload: { new: LockRow }) => onInsert(payload.new),
    );
  void joinAuthed(client, ch);
  return () => {
    client.removeChannel(ch);
  };
}

export type MessageRow = Database['public']['Tables']['messages']['Row'];

// Phase 7 conversation view. One channel per thread (`chat:<threadId>:<uuid>`); the
// unique suffix avoids topic-reuse collisions on double-mount, like the other
// subscribers above. RLS (messages_party_read) gates which inserts the socket
// delivers; we add an explicit thread_id filter as belt. Caller appends the new row
// (deduping by id, since the sender also receives the echo of their own insert).
export function subscribeThreadMessages(
  threadId: string,
  onInsert: (row: MessageRow) => void,
): () => void {
  const client = browserAfter5Client();
  const ch = client
    .channel(`chat:${threadId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
      (payload: { new: MessageRow }) => onInsert(payload.new),
    );
  void joinAuthed(client, ch);
  return () => {
    client.removeChannel(ch);
  };
}

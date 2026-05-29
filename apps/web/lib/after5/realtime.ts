// apps/web/lib/after5/realtime.ts
// Supabase Realtime helper for the host interested-list (Seam 5). The channel
// is scoped by USER ID (queue:<userId>), not device, so a host gets new
// right-swipes on whichever device they're on. We additionally filter the
// postgres_changes stream to this instance's queue_entries inserts; RLS still
// gates what rows the socket may deliver.
'use client';
import { browserAfter5Client } from '@/lib/after5/client';
import type { Database } from '@after5/types';

export type QueueEntryRow = Database['public']['Tables']['queue_entries']['Row'];

export function subscribeQueueInserts(
  userId: string,
  instanceId: string,
  onInsert: (row: QueueEntryRow) => void,
): () => void {
  const client = browserAfter5Client();
  const ch = client
    .channel(`queue:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'queue_entries',
        filter: `date_instance_id=eq.${instanceId}`,
      },
      (payload: { new: QueueEntryRow }) => onInsert(payload.new),
    )
    .subscribe();
  return () => {
    client.removeChannel(ch);
  };
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
    .channel(`locks:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'locks' },
      (payload: { new: LockRow }) => onInsert(payload.new),
    )
    .subscribe();
  return () => {
    client.removeChannel(ch);
  };
}

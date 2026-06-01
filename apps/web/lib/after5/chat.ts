// apps/web/lib/after5/chat.ts
// Typed client wrapper for Phase 7 chat (mirrors match.ts). Writes go through the
// chat-* edge functions -> SECURITY DEFINER RPCs (chat_send_message / report_message,
// both REVOKEd from authenticated). chat_mark_read is GRANTed to authenticated, so it
// is called DIRECTLY via supabase.rpc (it derives the actor from auth.uid()). Reads of
// messages/threads go direct through the browser client under party-read RLS (no edge
// fn) — same posture as match_ratings reads.
// Canonical edge envelope (see _shared/errcode.ts):
//   success → { ok: true, data: T }
//   failure → { ok: false, code: '<name>', message, detail?, errcode?: 'P50xx' }
// Errors surface as MatchError keyed on the string `code`
// (chat_not_party / chat_closed / cannot_report / auth_mismatch / ...).
'use client';
import { browserAfter5Client } from '@/lib/after5/client';
import { MatchError, type MatchErrorName } from '@/lib/after5/match';
import type { Database } from '@after5/types';

export type MessageRow = Database['public']['Tables']['messages']['Row'];

// Discriminated result of chat_send_message (RPC returns jsonb).
export type SendResult = {
  kind: 'message';
  message_id: string;
  both_ready?: boolean;   // present on a fresh send (UI nudge); absent on idempotent replay
  idempotent?: boolean;   // true when a retry with the same idem_key returned the first result
};

// Discriminated result of report_message.
export type ReportResult = { kind: 'report'; report_id: string };

type Envelope<T> = { ok: boolean; data?: T; code?: string; errcode?: string; detail?: string };

// Edge functions return a 2xx JSON envelope on the happy path AND, for handled
// failures, may surface as a non-2xx with the same body on `data`. We read the body
// either way and throw MatchError (keyed on the string `code`) when ok === false.
async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await browserAfter5Client().functions.invoke<Envelope<T>>(fn, { body });
  if (!data) throw new MatchError('unknown' as MatchErrorName);
  if (data.ok === false) {
    throw new MatchError((data.code as MatchErrorName) ?? 'unknown', data.errcode, data.detail);
  }
  return data.data as T;
}

function idemKey(): string {
  return crypto.randomUUID();
}

// Send a message into a thread. Mints an idem_key (caller may pass their own so a
// retry is coalesced server-side). Returns the discriminated send result; throws
// MatchError('chat_not_party' | 'chat_closed' | 'auth_mismatch') on the keyed failures.
export function sendMessage(threadId: string, body: string, idem_key?: string): Promise<SendResult> {
  return call<SendResult>('chat-send-message', {
    thread_id: threadId,
    body,
    idem_key: idem_key ?? idemKey(),
  });
}

// Report a received message. reason is optional. Throws MatchError('cannot_report')
// when the actor is the sender or not a party to the thread.
export function reportMessage(messageId: string, reason?: string): Promise<ReportResult> {
  return call<ReportResult>('chat-report-message', { message_id: messageId, reason });
}

// Mark all unread messages in a thread as read. chat_mark_read is GRANTed to
// authenticated and derives the actor from auth.uid(), so this calls the RPC
// directly (no edge fn). Returns the number of rows marked read.
export async function markRead(threadId: string): Promise<number> {
  const { data, error } = await browserAfter5Client().rpc('chat_mark_read', { p_thread: threadId });
  if (error) throw new MatchError('server_error', error.code, error.message);
  return (data as number | null) ?? 0;
}

// Initial conversation load: messages for a thread, oldest -> newest, RLS-gated.
export async function fetchMessages(threadId: string): Promise<MessageRow[]> {
  const { data, error } = await browserAfter5Client()
    .from('messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) throw new MatchError('server_error', error.code, error.message);
  return (data ?? []) as MessageRow[];
}

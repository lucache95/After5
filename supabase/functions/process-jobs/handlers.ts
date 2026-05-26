// supabase/functions/process-jobs/handlers.ts
// Per-job_type dispatch table. Each handler invokes the CANONICAL consumer RPC
// (INTEGRATION-CONTRACT C2 + owners) — P2 never writes loop state itself and ships
// no p5_* stubs. payload carries entity ids ({offer_id}, {instance_id}, {lock_id}, …).

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { dispatchNotification, type NotificationType } from '../_shared/notify.ts';

// Bare SupabaseClient (default generics) so a real createClient(url, key) result
// — SupabaseClient<any, 'public', any> — is assignable here. (ReturnType<typeof
// createClient> resolves the schema generic to `never`, which a concrete 'public'
// client is NOT assignable to; this matches the existing generate-plan convention.)
type Db = SupabaseClient;
export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  run_after: string;
  status: string;
}
export type Handler = (db: Db, job: Job) => Promise<void>;

const id = (j: Job, k: string) => (j.payload[k] as string | undefined) ?? null;

// offer_expiry → P5's idempotent, lock-guarded match_expire_offer (C2). It marks
// the offer expired, transitions the queue entry, and auto-rolls inline. P2 only calls.
const offerExpiry: Handler = async (db, job) => {
  await db.rpc('match_expire_offer', { p_offer: id(job, 'offer_id') });
};

// standby_roll → P5's match_auto_roll (C2). (Normally enqueued by P5, dispatched here.)
const standbyRoll: Handler = async (db, job) => {
  await db.rpc('match_auto_roll', { p_instance: id(job, 'instance_id') });
};

// notify both parties of a lock (day_of_reconfirm / safety_checkin / reconfirm_timeout).
async function notifyLockParties(db: Db, job: Job, type: NotificationType, title: string, body: string) {
  const lockId = id(job, 'lock_id');
  const { data: lock } = await db.from('locks').select('creator_id, matched_user_id').eq('id', lockId!).single();
  if (!lock) return;
  const l = lock as Record<string, string>;
  for (const uid of [l.creator_id, l.matched_user_id]) {
    await dispatchNotification(db, { userId: uid, type, payload: { title, body, data: { lock_id: lockId }, dedup_key: `${type}:${lockId}:${uid}` } });
  }
}

// Generic deferred notification from payload (job_type 'notify').
const genericNotify: Handler = async (db, job) => {
  await dispatchNotification(db, {
    userId: job.payload.user_id as string,
    type: job.payload.notification_type as NotificationType,
    payload: (job.payload.notification_payload as Record<string, unknown>) ?? {},
  });
};

export const HANDLERS: Record<string, Handler> = {
  offer_expiry: offerExpiry,
  standby_roll: standbyRoll,
  // P5/S6 close path (RPC name finalized in S6); call by canonical name.
  stale_date_close: async (db, job) => { await db.rpc('match_stale_date_close', { p_instance: id(job, 'instance_id') }); },
  // pending_expiry: P5/S6 reaps an expired pending queue entry (canonical name in S6).
  pending_expiry: async (db, job) => { await db.rpc('match_expire_pending', { p_queue_entry: id(job, 'queue_entry_id') }); },
  day_of_reconfirm: (db, job) => notifyLockParties(db, job, 'date_reconfirm', 'Confirm your night', 'Still on for tonight? Tap to reconfirm.'),
  safety_checkin: (db, job) => notifyLockParties(db, job, 'safety_checkin', 'Checking in', 'You good? Tap to confirm you’re safe.'),
  reconfirm_timeout: async (db, job) => { await db.rpc('match_reconfirm_timeout', { p_lock: id(job, 'lock_id') }); },
  bulk_withdraw: async (db, job) => { await db.rpc('match_bulk_withdraw', { p_actor: id(job, 'user_id') }); },
  chat_purge: async (db, job) => { await db.rpc('chat_purge_thread', { p_thread: id(job, 'thread_id') }); },           // P6/S7
  rating_window: async (db, job) => { await db.rpc('close_rating_window', { p_lock: id(job, 'lock_id') }); },          // P7/S8 (C11.10 canonical name)
  deletion_process: async (db, job) => { await db.rpc('process_deletion', { p_user: id(job, 'user_id') }); },          // P9/S10
  analytics_relay: async (db, job) => { await db.rpc('analytics_relay_drain', { p_batch: job.payload }); },            // P11/S12 owns the body
  notify: genericNotify,
};

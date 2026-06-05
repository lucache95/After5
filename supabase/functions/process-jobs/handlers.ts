// supabase/functions/process-jobs/handlers.ts
// Per-job_type dispatch table. Each handler invokes the CANONICAL consumer RPC
// (INTEGRATION-CONTRACT C2 + owners) — P2 never writes loop state itself and ships
// no p5_* stubs. payload carries entity ids ({offer_id}, {instance_id}, {lock_id}, ...).

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { dispatchNotification, type NotificationType } from "../_shared/notify.ts";

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

// Throw on RPC error so the index.ts loop fails (not completes) the job.
// supabase-js resolves { error } instead of throwing — a missing function
// (PGRST202 / 42883) would otherwise look like success.
export async function callRpc(db: Db, fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await db.rpc(fn, args);
  if (error) {
    const e = new Error(`rpc ${fn} failed: ${error.message}`) as Error & { rpcCode?: string; rpcFn?: string };
    e.rpcCode = (error as { code?: string }).code;
    e.rpcFn = fn;
    throw e;
  }
}

const id = (j: Job, k: string) => (j.payload[k] as string | undefined) ?? null;

// offer_expiry -> P5's idempotent, lock-guarded match_expire_offer (C2). It marks
// the offer expired, transitions the queue entry, and auto-rolls inline. P2 only calls.
const offerExpiry: Handler = async (db, job) => {
  await callRpc(db, "match_expire_offer", { p_offer: id(job, "offer_id") });
};

// standby_roll -> P5's match_auto_roll (C2). (Normally enqueued by P5, dispatched here.)
const standbyRoll: Handler = async (db, job) => {
  await callRpc(db, "match_auto_roll", { p_instance: id(job, "instance_id") });
};

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
  // payload key is 'user' (set by match_cancel_lock safety branch + match_autowithdraw_user_conflicts overflow).
  bulk_withdraw: async (db, job) => { await callRpc(db, "match_bulk_withdraw", { p_actor: id(job, "user") }); },
  chat_purge: async (db, job) => { await callRpc(db, "chat_purge_thread", { p_thread: id(job, "thread_id") }); },           // P6/S7
  rating_window: async (db, job) => { await callRpc(db, "close_rating_window", { p_lock: id(job, "lock_id") }); },          // P7/S8 (C11.10 canonical name)
  // E19 (D-04 / D-03): morning-of reconfirm + post-date safety check-in. Both dispatch-only
  // RPCs (no lock-state mutation) that never raise on a resolved lock — see 06-03 migration.
  day_of_reconfirm: async (db, job) => { await callRpc(db, "dispatch_date_reconfirm", { p_lock: id(job, "lock_id") }); },  // P6/E19
  safety_checkin: async (db, job) => { await callRpc(db, "dispatch_safety_checkin", { p_lock: id(job, "lock_id") }); },    // P6/E19
  analytics_relay: async (db, job) => { await callRpc(db, "analytics_relay_drain", { p_batch: job.payload }); },            // P11/S12 owns the body
  notify: genericNotify,
};

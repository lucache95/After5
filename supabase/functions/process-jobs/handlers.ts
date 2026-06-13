// supabase/functions/process-jobs/handlers.ts
// Per-job_type dispatch table. Each handler invokes the CANONICAL consumer RPC
// (INTEGRATION-CONTRACT C2 + owners) — P2 never writes loop state itself and ships
// no p5_* stubs. payload carries entity ids ({offer_id}, {instance_id}, {lock_id}, ...).

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { dispatchNotification, type NotificationType } from "../_shared/notify.ts";
import { seedCity } from "./seed-city.ts";

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

// Like callRpc but returns the rows. process_account_deletion returns SETOF text
// (the storage paths the handler must purge). Same fail-closed posture as callRpc:
// throws on rpc error so the job retries / dead-letters rather than silently skipping.
export async function callRpcReturning<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const e = new Error(`rpc ${fn} failed: ${error.message}`) as Error & { rpcCode?: string; rpcFn?: string };
    e.rpcCode = (error as { code?: string }).code;
    e.rpcFn = fn;
    throw e;
  }
  return data as T;
}

// deletion_process (ACCT-01) -> finalize a soft-deleted account at the 7-day mark.
// Order (fail-loud, idempotent on retry):
//   1. process_account_deletion(user) anonymizes the row IN THE DB and RETURNS the
//      profile-photos storage paths to purge (clear + blurred + mirror urls).
//   2. delete those objects from the `profile-photos` bucket.
//   3. delete the auth.users row via the service-role admin API so the email/phone
//      free and they cannot sign back in.
// Storage + auth deletes tolerate not-found (a retry after a partial success must not
// hard-fail the whole job); any OTHER error throws so the runner retries/dead-letters.
// payload key is 'user' (set by request_account_deletion's enqueue).
const deletionProcess: Handler = async (db, job) => {
  const user = id(job, "user");
  if (!user) throw new Error("deletion_process: payload.user is required");

  // 1. Anonymize in the DB; collect the storage paths to purge.
  const paths = (await callRpcReturning<string[] | null>(db, "process_account_deletion", { p_user: user })) ?? [];

  // 2. Purge the photo objects. removeObjects tolerates already-gone keys (Supabase
  //    storage remove() does not error on missing objects), so this is retry-safe.
  if (paths.length > 0) {
    const { error: storageErr } = await db.storage.from("profile-photos").remove(paths);
    // A genuine storage failure (not just missing objects) must retry the job.
    if (storageErr && !/not.?found|no such|does not exist/i.test(storageErr.message)) {
      throw new Error(`deletion_process: storage remove failed: ${storageErr.message}`);
    }
  }

  // 3. Remove the auth user. Tolerate "user not found" (already deleted on a prior
  //    attempt) so a retry drains cleanly; any other error throws to retry.
  const { error: authErr } = await db.auth.admin.deleteUser(user);
  if (authErr && !/not.?found|user.*not.*exist/i.test(authErr.message)) {
    throw new Error(`deletion_process: auth deleteUser failed: ${authErr.message}`);
  }
};

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
  // DATA-02 (P8): async city pre-seed. Unlike the loop handlers this one writes
  // corpus tables directly (Foursquare fetch → places upsert → cities.seeded_at)
  // rather than calling a consumer RPC — it IS the consumer. payload = {city_id};
  // dedup_key=city_id on the enqueue side (poison-loop safe). See seed-city.ts.
  seed_city: seedCity,
  notify: genericNotify,
  // ACCT-01: 7-day finalize — anonymize the DB row, purge photo objects, remove auth user.
  deletion_process: deletionProcess,
};

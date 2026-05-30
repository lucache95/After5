# Infra Audit §4 Edge Functions / APIs · §5 Background Jobs / Async

Date: 2026-05-30 · Scope: READ-ONLY · Repo = authority · Prod ref `ufufmcpnysvwtutpbian` (MCP read-only).

---

## §4 Edge Functions / APIs

### Edge functions (`supabase/functions/**`, cross-ref prod `list_edge_functions`)

16 functions deployed on prod, all ACTIVE. verify_jwt confirmed against `config.toml` + prod metadata.

| fn | verify_jwt (prod) | auth model | secrets | idempotency | failure → caller | webhook sig |
|----|----|----|----|----|----|----|
| `persona-webhook` | **false** | HMAC `Persona-Signature` (`verifyPersonaSignature`) | `PERSONA_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | DB upsert `onConflict user_id,kind` (state-convergent), no event-ledger | 401 bad_sig / 500 on upsert (Persona retries) | **YES, fail-closed** |
| `start-verification` | true | JWT → `auth.getUser()`; reference-id = uid; 409 if already verified | `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, anon, service-role | upsert verifications | 401/502/500 | n/a |
| `confirm-phone` | true | JWT; **requires `user.phone_confirmed_at`** before writing verified phone row | service-role | upsert | 400 phone_not_confirmed / 401 | n/a |
| `match-shortlist` / `-make-offer` / `-accept-offer` / `-pass-offer` / `-withdraw` / `-cancel-lock` / `-demand-hint` / `-resolve-reciprocal` (8) | true | `withMatchHandler`: JWT verify → `auth.getUser()`; **`p_actor` always = `user.id`** (never client-supplied) | anon, service-role | `p_idem_key` minted server-side if absent (RPC enforces) | errcode-mapped JSON via `pgErrorToResponse` | n/a |
| `process-jobs` | false | header `x-jobs-secret` == `JOBS_RUNNER_SECRET` (rejects if env unset) | `JOBS_RUNNER_SECRET`, service-role | per-job (see §5) | 401 unauth / 500 claim_failed / 200 summary | n/a |
| `generate-plan` | false | (AI plan gen — pre-dating; not security-critical for this audit) | OpenAI etc | — | — | — |
| `classify-photos`/`generate-cover`/`generate-blur` | mixed | image pipeline | — | — | — | — |

**Verdict §4 edge: GREEN.** The two flagged unauth endpoints are correctly defended:
- **`persona-webhook` — SAFE.** Verifies Persona HMAC over `${t}.${rawBody}` with SHA-256, constant-time compare, and **fails closed on missing/empty secret** (explicit guard: empty key would be attacker-reproducible). A forged call cannot mark a user verified. Caveat: signature replay-window (`t`) is parsed but **not age-checked** — a captured valid signed body could be replayed; low risk because the operation is idempotent/state-convergent, but no timestamp-staleness rejection exists.
- **`process-jobs` — SAFE-ish.** Gated by `x-jobs-secret`; rejects when env unset (no empty-secret bypass). Anyone with the secret can trigger it, but it only claims/dispatches already-enqueued jobs (no arbitrary payload injection). No rate-limit, but idempotent. Acceptable.
- **8 match-* — SAFE.** JWT verified, `p_actor` bound to `user.id` server-side; client cannot impersonate.

### Next API routes (`apps/web/app/api/**`)
- RLS-bound (`createClient` SSR + `getUser`): `notifications`, `votes`, `vote-sessions`, `saved-plans` (writes), `insiders/submit-task`. GREEN.
- Admin (`requireAdmin` + service-role): `admin/insiders`, `admin/venues`, `admin/eval`. GREEN.
- Service-role unauthenticated by design (public marketing/funnel): `subscribe`, `stats`, `insiders/apply` (in-memory IP rate-limit 3/day — **resets per serverless instance, weak**), `feedback` (token-auth from email), `tell-us`. Mostly fine; `insiders/apply` rate-limit is best-effort only.
- Cron routes (`cron/process-jobs`, `cron/weekly-broadcast`, `cron/post-date-feedback`): auth = `Authorization: Bearer ${CRON_SECRET}` OR `?secret=` query param. **The query-param fallback puts the secret in URLs/logs** — minor YELLOW. Rejects if `CRON_SECRET` unset.

---

## §5 Background Jobs / Async

### Queue + RPCs (`jobs` table, `20260525123000/123100`)
- `jobs`: RLS enabled, **no policies** (service-role only). Partial unique index `jobs_dedup_active(type, dedup_key) WHERE status in (pending,running)` → active-dedup.
- `enqueue_job`: idempotent on `(type, dedup_key)`; null dedup → always insert.
- `claim_due_jobs`: `FOR UPDATE SKIP LOCKED`, pending→running, +attempts, stamps `locked_at`. Concurrent-tick safe.
- `complete_job`/`fail_job`: status-guarded on `running` (cancel-mid-flight safe).
- `requeue_stuck_jobs`: running + (`locked_at` null OR < now−5min) → pending. Crash recovery. Runs every tick before claim.

### Retry / dead-letter — REAL
`fail_job`: exponential backoff `now() + 1min*2^least(attempts,6)`; at **attempts ≥ 5 → status='failed' (dead-letter terminal)**. Not infinite. Verified.

### Poison-loop / 6 dormant types — **the real risk: SILENT-COMPLETE, not poison-loop**
job_type enum = 13 values; `HANDLERS` maps all 13 (test asserts coverage). Prod RPC check confirms **6 dispatch targets DO NOT EXIST**: `match_stale_date_close`, `match_expire_pending`, `match_reconfirm_timeout`, `chat_purge_thread`, `process_deletion`, `analytics_relay_drain`. (Existing: `match_expire_offer`, `match_auto_roll`, `match_bulk_withdraw`, `close_rating_window`, `dispatch_notification`.)

**Critical behavior:** handlers call `await db.rpc('missing_fn', …)` and **do not inspect the returned `{error}`**. supabase-js `.rpc()` resolves (does not throw) on a PostgREST `PGRST202 function-not-found`. So the handler returns normally → `process-jobs` calls `complete_job` → **the job is marked `done` despite never running**. This is NOT a poison-loop (no retry storm, no dead-letter) — it is a **silent no-op completion**: e.g. a `deletion_process` (GDPR) or `chat_purge` job reports success while doing nothing. **No guard catches a missing RPC.** RED for the safety/compliance types (deletion, chat purge, stale-date close). The only handler that would surface anything is `safety_checkin`, and only if its RPC *threw* — but `safety_checkin` dispatches `dispatch_notification`, which exists, so the alert path is moot for the missing ones.

> Note: these 6 types are "dormant" — no current code path enqueues them (their producer phases S6/S7/S8/S10/S12 are unbuilt). Risk is latent until something enqueues one.

### Scheduling — **Vercel cron only; pg_cron NOT installed**
`list_extensions` + `select from cron.job` → `relation "cron.job" does not exist`. pg_cron and pg_net are **not installed on prod**. Sole scheduler = Vercel `vercel.json` crons: `process-jobs` every minute, `weekly-broadcast` Sun 16:00 UTC, `post-date-feedback` daily 17:00 UTC. If Vercel cron is paused/unpaid, **all timers stop** — single point of failure, no DB-side fallback.

### Notification delivery — **inserts rows; network delivery NOT wired**
`dispatch_notification` (RPC): consent → quiet-hours → rate-limit → channel pick (push_ios→android→web→email→admin_alert/suppressed); dedup short-circuit on `(type, dedup_key)`; safety types bypass gates and fail-loud to `admin_alert` + `raise_admin_alert` when no channel. Inserts a `notifications` row. Then `notify.ts` is the network half — **but every default sender is a stub**: `defaultSendExpo` is implemented (POST exp.host, inspects ticket errors) yet `defaultSendWebPush` returns `web_push_not_configured`, `defaultSendEmail` returns `email_not_wired`, `defaultSendOpsEmail` returns `ops_email_not_wired`. So: **push CAN deliver if a device has an Expo token; web-push, email, and ops-alert email all just log/no-op.** Marketing email (`weekly-broadcast`, `post-date-feedback`) DOES deliver via Resend (`lib/email/resend`) — separate path. Net: in-app notification rows are written and readable; the **ops fail-loud email and email fallback are non-functional** (admin_alerts row is the only durable signal for safety failures).

### Duplicate-event handling
- Persona duplicates: deduped at the **data layer** via `verifications` upsert `onConflict user_id,kind` (convergent) — but **no idempotency ledger / event-id dedup**; a duplicate `inquiry.approved` re-runs the DOB upsert + re-fires `dispatch_notification` (which itself dedups only if a `dedup_key` is passed — and persona-webhook passes **none**, so duplicate verification notifications are possible).
- Jobs: dedup via active partial unique index + `enqueue_job` short-circuit.
- Notifications: `dispatch_notification` dedups on `(type, dedup_key)` only when caller supplies `dedup_key` (lock-party notifies do; persona/generic do not).

**Verdict §5: YELLOW→RED.** Retry/dead-letter correct; scheduling functional but Vercel-SPOF + pg_cron absent. Two RED items: (1) missing-RPC jobs silently complete (compliance/safety no-ops), (2) notification email + ops-alert delivery unwired (only push + in-app rows actually deliver).

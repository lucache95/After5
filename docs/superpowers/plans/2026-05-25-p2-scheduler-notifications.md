SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P2 (Stage S2) — Async / Config / Notify / Chat-core Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Authority & scope.** This is the **S2 shared spine** of the Reconciled Master Plan. P2 **owns** most of the canonical async/config/notify objects every other stage consumes. The canonical names, enums, signatures, and migration bands below are defined by `INTEGRATION-CONTRACT.md` (C1, C3, C6, C10, C11). Where this plan previously guessed names (`enqueue`, `kind`, `run_at`, `dedupe_key`, `notify`, `p5_promote_standby`, …) those guesses are **SUPERSEDED**; this plan now defines exactly the contract names. Build this stage **after S1 (schema spine)** and **before every consumer** (S3/S4/S5/S6/S7/…).

**Goal:** Ship the shared async + config + notification + chat-core backbone that the matching mechanic (S6/P5), chat (S7/P6), trust & safety (S8/P7), lifecycle (S10/P9), and analytics (S12/P11) all depend on:

- the canonical `jobs` table + `job_type`/`job_status` enums + `enqueue_job`/`cancel_jobs` + a claim-and-dispatch runner (C1);
- `notifications` log + `notification_type` enum + `notification_preferences` (consent/quiet-hours) + `devices` (C11.2) + `register_device` + `dispatch_notification` with the contract delivery order and the **safety fail-loud** terminus (C1, C11.8);
- `feature_config` + `offer_expires_at()` (C11.1, band `123800`) — owned here because P5 (band `126xxx`) depends on it;
- `analytics_events` append-only outbox table (C11.8, band `123900`) — table owned here; the `analytics_relay` drain handler is P11's;
- `admin_alerts` + an always-on ops sink (C11.8) — the "fail loud" terminus for safety notifications with no device;
- `can_enter_lock_flow(p_user)` gate (C3) — reads `account_state` + `standing` (columns added in S1) so S6 can call it before S8 ships the standing ladder;
- chat-core primitives `open_chat_thread`/`close_chat_thread`/`promote_chat_thread_to_lock`/`chat_lock_ready` (C11.7, band `124500`) — the thread table + these four functions are an S2 prerequisite so P5's tests can call them; P6's rich messaging stays in S7.

P2 ships the backbone and the canonical enqueue/dispatch/config interface. **P2 does not implement loop transitions.** The `offer_expiry` job handler calls P5's `match_expire_offer(p_offer)` (C2) — which is idempotent, marks the offer expired under the instance advisory lock, and triggers auto-roll inline. There is no separate "standby_roll" step owned here and **no `p5_*` stub**: P5 owns `match_expire_offer`/`match_auto_roll`/`match_next_standby`. **Depends on:** S6/P5 `match_expire_offer` for the `offer_expiry` handler body to do real work (until S6 lands, the handler's call is a documented dependency, not a stub we fill).

**Architecture (concrete choice — justified):**

- **Scheduler = the canonical `jobs` table (C1) + a runner Edge Function invoked by a Vercel cron every minute.** *Why this and not Inngest:* (1) the repo already ships the exact pattern — `apps/web/vercel.json` defines `crons` hitting `/api/cron/*`, and those routes call a service-role Supabase client. (2) The mechanic's timers are minute-granular, DB-state-driven (an offer's `expires_at`, an instance's `starts_at + 30min`) — a query-and-act loop, precisely a `jobs` table with `run_after`/`status`/`attempts`. (3) Inngest is reserved for the content/ingestion pipelines. (4) A `jobs` table is testable with psql like every other invariant. The Vercel cron is the *trigger*; the Edge Function `process-jobs` is the *worker* (service-role, claims due jobs with `for update skip locked`, dispatches per `type`, retries with backoff, dead-letters at `attempts >= 5`). A thin Next.js route `/api/cron/process-jobs` (matching the existing cron routes' auth + shape) invokes the Edge Function.

- **Push provider = Expo Push for native iOS+Android, with a Web Push (VAPID) fallback, and Resend email as the final fallback** for high-stakes/safety notifications when no push token exists. Native is the load-bearing channel; web push is best-effort; email is the guaranteed fallback. **For safety types (`safety_checkin`,`safety_alert`) with no device, dispatch fails loud** to `admin_alerts` + ops email (C11.8) — never a silent drop.

**Tech Stack:** Supabase Postgres (migrations `supabase/migrations/`), RLS with `auth.uid()`; one new Edge Function `supabase/functions/process-jobs/` (Deno) + one shared notification dispatch module `supabase/functions/_shared/notify.ts`; one new Vercel cron route `apps/web/app/api/cron/process-jobs/route.ts` (mirrors existing cron routes' `CRON_SECRET` auth); reuse the existing `rate_limits` table + `rate_limit_check` RPC for notification-storm limiting; Expo Push HTTP API + Web Push (VAPID) + Resend; psql invariant tests in `supabase/tests/`; Deno unit tests for the Edge Function logic; vitest for the cron route (root config owned by P1/S3 — C10; do **not** bootstrap a duplicate vitest config here).

**Source docs:** `INTEGRATION-CONTRACT.md` (C1, C3, C6, C10, C11 — **authoritative**); `RECONCILED-MASTER-PLAN.md` (S2 stage, §7 canonical shared architecture); the P2 pre-build audit `audits/2026-05-25-p2-scheduler-notifications-audit.md`; spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§7.3 offer window, §7.6 auto-roll, §8 day-of reconfirm + 30-min check-in, §10 push dependency).

**Conventions (follow exactly):** migration filenames `YYYYMMDDHHMMSS_snake_description.sql` in **P2's band `123000–1239xx`** (C6), except chat-core which lands at **`124500`** (C11.7) so it is available before P5's `126xxx` tests; enable RLS on every table; create policies idempotently with `DO $$ BEGIN CREATE POLICY … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`; attach the existing `set_updated_at()` trigger to tables with `updated_at`; `auth.uid()` authz; all transition/admin logic `SECURITY DEFINER`; internal helpers `revoke execute from public, authenticated`; uuid PKs via `gen_random_uuid()`. Edge Functions follow `supabase/functions/generate-plan/` structure. Cron routes follow `apps/web/app/api/cron/post-date-feedback/route.ts`. **All psql tests use the C8 `_fixtures.sql` helpers (`mk_user`/`mk_itinerary`/`mk_instance`) — no bare `insert into profiles` (which violates the `auth.users` FK).** Tests `\i 'supabase/tests/_fixtures.sql'` (shipped by S1).

**Local test loop:** `supabase db reset` (applies all migrations + seeds), then for a psql test:
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`
Tests use `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior (clean exit = PASS). For Edge Function logic: `deno test --allow-env supabase/functions/process-jobs/<file>_test.ts`. For the cron route: `pnpm test` (root vitest config, owned by P1/S3).

---

## Canonical contract objects this stage owns (single source — do not redefine elsewhere)

| Object | Form | Contract | Band |
|---|---|---|---|
| `job_type` enum | 13 values (full set, below) | C1 | `123000` |
| `job_status` enum | `pending,running,done,failed,cancelled` | C1 | `123000` |
| `jobs` table | C1 shape (`id,type,run_after,dedup_key,payload,status,attempts,last_error,created_at`) | C1 | `123000` |
| `enqueue_job` / `cancel_jobs` | C1 signatures | C1 | `123100` |
| `notification_type` enum | 11 values (C1) | C1 | `123400` |
| `notifications` log | recipient-read RLS | C1 | `123400` |
| `notification_preferences` | consent + quiet-hours | C11.8 | `123300` |
| `devices` | C11.2 form (surrogate id + `unique nulls not distinct`) | C11.2 | `123200` |
| `register_device` / `dispatch_notification` | C1 signatures | C1 | `123200`/`123600` |
| `feature_config` + `offer_expires_at()` | C11.1 | C11.1 | `123800` |
| `analytics_events` outbox | append-only (drain handler = P11) | C11.8 | `123900` |
| `admin_alerts` + ops sink | "fail loud" terminus | C11.8 | `123700` |
| `can_enter_lock_flow(p_user)` | reads `account_state`+`standing` (S1 cols) | C3 | `123500` |
| chat-core thread table + 4 fns | `open/close/promote/ready` | C11.7 | `124500` |

**`job_type` enum (C1 — exactly these 13 values, no more, no fewer):**
`offer_expiry`, `standby_roll`, `pending_expiry`, `stale_date_close`, `day_of_reconfirm`, `safety_checkin`, `reconfirm_timeout`, `bulk_withdraw`, `chat_purge`, `rating_window`, `deletion_process`, `analytics_relay`, `notify`.

**`notification_type` enum (C1 — exactly these 11 values):**
`new_match`, `offer_received`, `offer_expiring`, `standby_promoted`, `date_reconfirm`, `safety_checkin`, `safety_alert`, `new_message`, `rating_request`, `moderation_action`, `account`.

> **Job-type → handler ownership (C1/C2):** P2 ships the runner + the dispatch table; each handler dispatches by `type`. The **state-mutating bodies** are owned by the consumer stage:
> - `offer_expiry` → calls P5's `match_expire_offer(p_offer)` (C2; idempotent; auto-rolls inline). P2 owns only the call.
> - `standby_roll` → calls P5's `match_auto_roll(p_instance)` (C2). Enqueued by P5, not by P2.
> - `stale_date_close` → calls P5's `match_*` close path (S6 names it); P2 dispatches.
> - `day_of_reconfirm` / `safety_checkin` / `reconfirm_timeout` → dispatch the relevant `dispatch_notification` to both parties (P2 owns the notify; P7/S8 owns escalation state).
> - `bulk_withdraw` → calls P5/P9 withdraw path.
> - `chat_purge` → P6/S7 retention.
> - `rating_window` → P7/S8.
> - `deletion_process` → P9/S10.
> - `analytics_relay` → **P11/S12** drains `analytics_events` to PostHog (P2 ships the table only; the handler is referenced, not built here).
> - `notify` → generic deferred notification (P2 owns).
>
> P2 does **not** invent `p5_*` hooks. The dispatch table maps each `type` to a callee RPC name (per C2/owners); for types whose RPC ships in a later stage, the handler invokes the canonical name and the dispatch is exercised once that stage lands. **Depends on:** S6 (`match_expire_offer`, `match_auto_roll`), S7 (`chat_purge`), S8 (`rating_window`), S10 (`deletion_process`), S12 (`analytics_relay`).

---

## File Structure

- `supabase/migrations/123NNN_p2_*.sql` — one migration per schema task (jobs, RPCs, devices, preferences, notifications, dispatch, admin_alerts, gate, feature_config, analytics_events) + `124500_p2_chat_core.sql`.
- `supabase/tests/p2_*.sql` — one psql invariant/RLS test file per schema task that warrants it (all `\i '_fixtures.sql'`).
- `supabase/functions/process-jobs/index.ts` — the runner Edge Function (claim → dispatch by `type` → reschedule/complete).
- `supabase/functions/process-jobs/handlers.ts` — per-`job_type` dispatch table (calls canonical consumer RPCs; no `p5_*`).
- `supabase/functions/process-jobs/handlers_test.ts` — Deno unit tests for handler dispatch + the consumer-RPC boundary.
- `supabase/functions/_shared/notify.ts` — `dispatchNotification()` (consent → quiet-hours → rate-limit → push→web→email; safety fail-loud). Shared so any Edge Function can call it.
- `supabase/functions/_shared/notify_test.ts` — Deno unit tests for the gate order + fail-loud (providers mocked).
- `apps/web/app/api/cron/process-jobs/route.ts` — Vercel cron entry (every minute) invoking the `process-jobs` Edge Function.
- `apps/web/app/api/cron/process-jobs/route.test.ts` — vitest (uses the **root** P1/S3 vitest config — C10; no local config).
- `apps/web/vercel.json` — add the `*/1 * * * *` cron entry.
- `supabase/config.toml` — register `[functions.process-jobs]` (`verify_jwt = false`; service-role-internal, gated by a shared secret header).
- `packages/types/src/database.ts` — regenerated last.

---

## Task 1: `job_type` / `job_status` enums + canonical `jobs` table (C1)

**Files:**
- Create: `supabase/migrations/20260525123000_p2_jobs.sql`
- Test: `supabase/tests/p2_jobs.sql`

> **Conformance:** This is the **single** `jobs` table (C1). No other phase may create a `jobs` table. The column is `type` (not `job_type`/`kind`), the timestamp is `run_after` (not `run_at`), the dedup column is `dedup_key` (not `dedupe_key`). P5/P7/P9 shims that defined divergent shapes are **SUPERSEDED** — they reference this table.

- [ ] **Step 1: Write the failing test** (table + the partial index that lets the runner claim due jobs + the C1 dedup index)

```sql
-- supabase/tests/p2_jobs.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='jobs' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs missing or RLS off'; END IF;
  -- C1 column names
  PERFORM 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='type';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs.type (job_type) column missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='run_after';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs.run_after column missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='dedup_key';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs.dedup_key column missing'; END IF;
  -- full job_type enum (spot-check the consumer-critical values)
  IF NOT ('offer_expiry' = ANY (enum_range(null::job_type)::text[])) THEN RAISE EXCEPTION 'job_type missing offer_expiry'; END IF;
  IF NOT ('analytics_relay' = ANY (enum_range(null::job_type)::text[])) THEN RAISE EXCEPTION 'job_type missing analytics_relay'; END IF;
  IF NOT ('chat_purge' = ANY (enum_range(null::job_type)::text[])) THEN RAISE EXCEPTION 'job_type missing chat_purge'; END IF;
  IF NOT ('deletion_process' = ANY (enum_range(null::job_type)::text[])) THEN RAISE EXCEPTION 'job_type missing deletion_process'; END IF;
  -- C1 active-dedup unique index
  PERFORM 1 FROM pg_indexes WHERE tablename='jobs' AND indexname='jobs_dedup_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs_dedup_active index missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** — `relation "jobs" does not exist`.

- [ ] **Step 3: Write the migration** (verbatim C1 shape)

```sql
-- supabase/migrations/20260525123000_p2_jobs.sql
-- THE canonical jobs table (INTEGRATION-CONTRACT C1). Single source; no other
-- phase creates a jobs table. A row = one timer the mechanic needs to fire.
-- A Vercel cron (every minute) invokes process-jobs, which claims due rows
-- (status='pending', run_after<=now()) with FOR UPDATE SKIP LOCKED, dispatches
-- per `type`, retries with backoff, dead-letters at attempts>=5.

create type job_type as enum (
  'offer_expiry','standby_roll','pending_expiry','stale_date_close',
  'day_of_reconfirm','safety_checkin','reconfirm_timeout','bulk_withdraw',
  'chat_purge','rating_window','deletion_process','analytics_relay','notify'
);
create type job_status as enum ('pending','running','done','failed','cancelled');

create table jobs (
  id uuid primary key default gen_random_uuid(),
  type job_type not null,
  run_after timestamptz not null default now(),
  dedup_key text,
  payload jsonb not null default '{}',
  status job_status not null default 'pending',
  attempts int not null default 0,
  last_error text,
  -- locked_at supports crash recovery (requeue_stuck_jobs); not in the C1 minimal
  -- DDL but a permitted runner-internal column (no consumer reads it).
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

-- C1 active-dedup: at most one pending|running job per (type, dedup_key).
create unique index jobs_dedup_active on jobs(type, dedup_key)
  where status in ('pending','running') and dedup_key is not null;
-- Runner hot query: pending jobs due now.
create index jobs_due_idx on jobs (run_after) where status = 'pending';
create index jobs_type_idx on jobs (type, status);

alter table jobs enable row level security;
-- No policies: jobs are written/read only by the service-role runner
-- (default-deny for anon/authenticated, same posture as rate_limits).
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p2_jobs.sql`
Expected: PASS (no output, exit 0).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123000_p2_jobs.sql supabase/tests/p2_jobs.sql
git commit -m "P2/S2: canonical jobs table + job_type/job_status enums (INTEGRATION-CONTRACT C1)"
```

---

## Task 2: `enqueue_job()` + `cancel_jobs()` + claim/complete/fail/requeue RPCs (C1)

**Files:**
- Create: `supabase/migrations/20260525123100_p2_jobs_rpcs.sql`
- Test: `supabase/tests/p2_jobs_rpcs.sql`

> **Conformance:** Exact C1 signatures —
> - `enqueue_job(p_type job_type, p_run_after timestamptz, p_payload jsonb default '{}', p_dedup_key text default null) returns uuid`
> - `cancel_jobs(p_type job_type, p_dedup_key text) returns int`
>
> Entity references (offer/lock/instance/queue) live **inside `payload`** (jsonb), not as columns. The runner claims with `for update skip locked`. `cancel_jobs` is what P5's `match_accept_offer` calls to cancel a pending `offer_expiry` (`cancel_jobs('offer_expiry', offer_id)`) — it MUST exist.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p2_jobs_rpcs.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE j1 uuid; j2 uuid; n int; claimed int; cancelled int;
BEGIN
  -- idempotent enqueue: same (type, dedup_key) twice while pending → one row
  j1 := enqueue_job('safety_checkin', now() + interval '1 minute', '{}'::jsonb, 'sc:fixture');
  j2 := enqueue_job('safety_checkin', now() + interval '5 minute', '{}'::jsonb, 'sc:fixture');
  IF j1 <> j2 THEN RAISE EXCEPTION 'enqueue not idempotent: % <> %', j1, j2; END IF;
  SELECT count(*) INTO n FROM jobs WHERE dedup_key='sc:fixture' AND status='pending';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 pending dedup row, got %', n; END IF;

  -- due-in-past is claimable; due-in-future is not
  PERFORM enqueue_job('offer_expiry', now() - interval '1 minute', '{}'::jsonb, 'due:past');
  PERFORM enqueue_job('offer_expiry', now() + interval '1 hour',  '{}'::jsonb, 'due:future');
  SELECT count(*) INTO claimed FROM claim_due_jobs(10);
  IF claimed <> 1 THEN RAISE EXCEPTION 'claim_due_jobs returned %, expected 1', claimed; END IF;
  PERFORM 1 FROM jobs WHERE dedup_key='due:past' AND status='running' AND locked_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'claimed job not marked running/locked'; END IF;

  -- cancel_jobs cancels the pending due:future row (C1; P5 calls this on accept)
  cancelled := cancel_jobs('offer_expiry', 'due:future');
  IF cancelled <> 1 THEN RAISE EXCEPTION 'cancel_jobs cancelled %, expected 1', cancelled; END IF;
  PERFORM 1 FROM jobs WHERE dedup_key='due:future' AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel_jobs did not mark cancelled'; END IF;

  RAISE NOTICE 'jobs RPCs OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function enqueue_job(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525123100_p2_jobs_rpcs.sql
-- Canonical job RPCs (INTEGRATION-CONTRACT C1). Exact signatures; callers across
-- S6/S7/S8/S10/S12 use these names. Entity refs live in payload jsonb.

-- Idempotent enqueue. If a pending|running job with the same (type, dedup_key)
-- exists, return its id unchanged. dedup_key null => no dedup (every call inserts).
create or replace function enqueue_job(
  p_type      job_type,
  p_run_after timestamptz,
  p_payload   jsonb default '{}',
  p_dedup_key text default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if p_dedup_key is not null then
    select id into v_id from jobs
     where type = p_type and dedup_key = p_dedup_key and status in ('pending','running')
     limit 1;
    if found then return v_id; end if;
  end if;

  insert into jobs (type, run_after, payload, dedup_key)
  values (p_type, p_run_after, coalesce(p_payload,'{}'), p_dedup_key)
  on conflict (type, dedup_key) where (status in ('pending','running') and dedup_key is not null)
    do nothing
  returning id into v_id;

  if v_id is null and p_dedup_key is not null then
    select id into v_id from jobs
     where type = p_type and dedup_key = p_dedup_key and status in ('pending','running')
     limit 1;
  end if;
  return v_id;
end $fn$;

-- Cancel pending|running jobs matching (type, dedup_key). Returns rows cancelled.
-- P5's match_accept_offer calls cancel_jobs('offer_expiry', offer_id) so a
-- resolved offer's timer never fires.
create or replace function cancel_jobs(p_type job_type, p_dedup_key text)
returns int language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  update jobs set status='cancelled'
   where type = p_type and dedup_key = p_dedup_key and status in ('pending','running');
  get diagnostics n = row_count;
  return n;
end $fn$;

-- Atomically claim up to N due jobs (pending→running, stamp locked_at, +attempts).
-- SKIP LOCKED makes concurrent runners / overlapping ticks safe.
create or replace function claim_due_jobs(p_limit int default 50)
returns setof jobs
language plpgsql security definer set search_path = public as $fn$
begin
  return query
  with due as (
    select id from jobs
     where status = 'pending' and run_after <= now()
     order by run_after
     for update skip locked
     limit p_limit
  )
  update jobs j
     set status = 'running', locked_at = now(), attempts = j.attempts + 1
    from due where j.id = due.id
  returning j.*;
end $fn$;

create or replace function complete_job(p_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update jobs set status='done', last_error=null where id=p_id;
end $fn$;

-- Retry with exponential backoff; dead-letter at attempts>=5 (C1).
create or replace function fail_job(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $fn$
declare a int;
begin
  select attempts into a from jobs where id=p_id;
  if a >= 5 then
    update jobs set status='failed', last_error=p_error where id=p_id;
  else
    update jobs
       set status='pending', last_error=p_error, locked_at=null,
           run_after = now() + (interval '1 minute' * power(2, least(a,6)))
     where id=p_id;
  end if;
end $fn$;

-- Recover crashed runners: jobs stuck 'running' past a grace window → 'pending'.
create or replace function requeue_stuck_jobs(p_grace interval default interval '5 minutes')
returns int language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  update jobs set status='pending', locked_at=null
   where status='running' and locked_at < now() - p_grace;
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke execute on function enqueue_job(job_type, timestamptz, jsonb, text) from public, authenticated;
revoke execute on function cancel_jobs(job_type, text) from public, authenticated;
revoke execute on function claim_due_jobs(int) from public, authenticated;
revoke execute on function complete_job(uuid) from public, authenticated;
revoke execute on function fail_job(uuid, text) from public, authenticated;
revoke execute on function requeue_stuck_jobs(interval) from public, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `jobs RPCs OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123100_p2_jobs_rpcs.sql supabase/tests/p2_jobs_rpcs.sql
git commit -m "P2/S2: enqueue_job + cancel_jobs + claim/complete/fail/requeue (C1 signatures)"
```

---

## Task 3: `devices` table (C11.2 form) + `register_device()` (C1)

**Files:**
- Create: `supabase/migrations/20260525123200_p2_devices.sql`
- Test: `supabase/tests/p2_devices.sql`

> **Conformance:** Use the **C11.2** `devices` DDL (surrogate `id` PK + `unique nulls not distinct (user_id, expo_push_token)`), NOT the C1 composite-PK form (that PK was a compile-breaker, fixed by C11.2). Columns: `id, user_id, expo_push_token, web_push_sub, platform, last_seen`. `register_device(p_token text, p_platform text, p_web_push jsonb default null)` is called from P1/S3 onboarding + the native bootstrap (this stage supplies the RPC so the load-bearing push path is registrable from day one — closes audit "no token-registration path").

- [ ] **Step 1: Write the failing test** (C11.2 columns + `unique nulls not distinct` + owner RLS + register_device upserts)

```sql
-- supabase/tests/p2_devices.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; n int;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='devices' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'devices missing or RLS off'; END IF;
  -- C11.2 columns
  PERFORM 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='expo_push_token';
  IF NOT FOUND THEN RAISE EXCEPTION 'devices.expo_push_token missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='web_push_sub';
  IF NOT FOUND THEN RAISE EXCEPTION 'devices.web_push_sub missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='id';
  IF NOT FOUND THEN RAISE EXCEPTION 'devices surrogate id missing'; END IF;
  -- nulls-not-distinct unique constraint exists
  PERFORM 1 FROM pg_indexes WHERE tablename='devices'
    AND indexdef ILIKE '%user_id%expo_push_token%';
  IF NOT FOUND THEN RAISE EXCEPTION 'devices (user_id, expo_push_token) unique missing'; END IF;

  -- register_device upserts (same user+token twice => one row)
  u := mk_user('dev');
  PERFORM set_config('request.jwt.claim.sub', u::text, true);
  PERFORM register_device('ExponentPushToken[x]','ios', null);
  PERFORM register_device('ExponentPushToken[x]','ios', null);
  SELECT count(*) INTO n FROM devices WHERE user_id=u;
  IF n <> 1 THEN RAISE EXCEPTION 'register_device not idempotent: % rows', n; END IF;
  RAISE NOTICE 'devices OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "devices" does not exist`).

- [ ] **Step 3: Write the migration** (C11.2 verbatim DDL + register_device)

```sql
-- supabase/migrations/20260525123200_p2_devices.sql
-- Push-token registry (INTEGRATION-CONTRACT C11.2 — supersedes the C1 composite-PK
-- form, which was a compile-breaker). Mobile (Expo) registers its push token on
-- app start; web registers its Web Push (VAPID) subscription. Dispatch reads
-- active rows via the service-role client.

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  expo_push_token text,
  web_push_sub jsonb,
  platform text,
  last_seen timestamptz not null default now(),
  unique nulls not distinct (user_id, expo_push_token)
);
create index devices_user_idx on devices (user_id);

alter table devices enable row level security;
do $$ begin
  create policy "devices_owner_all" on devices for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- register_device(p_token, p_platform, p_web_push) — called from P1/S3 onboarding
-- + native bootstrap. Upserts the caller's device row (auth.uid()), refreshes
-- last_seen. C1 signature.
create or replace function register_device(
  p_token text, p_platform text, p_web_push jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'register_device requires an authenticated user'; end if;
  insert into devices (user_id, expo_push_token, web_push_sub, platform, last_seen)
  values (v_uid, p_token, p_web_push, p_platform, now())
  on conflict (user_id, expo_push_token) do update
    set web_push_sub = excluded.web_push_sub,
        platform     = excluded.platform,
        last_seen    = now()
  returning id into v_id;
  return v_id;
end $fn$;

revoke execute on function register_device(text, text, jsonb) from public;
-- authenticated keeps execute (a user registers their own device via auth.uid()).
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `devices OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123200_p2_devices.sql supabase/tests/p2_devices.sql
git commit -m "P2/S2: devices (C11.2 form) + register_device RPC (C1)"
```

---

## Task 4: `notification_preferences` (consent + quiet-hours) (C11.8)

**Files:**
- Create: `supabase/migrations/20260525123300_p2_notification_preferences.sql`
- Test: `supabase/tests/p2_notification_preferences.sql`

> **Conformance:** `dispatch_notification` reads this (C1 order: consent → quiet-hours → rate-limit). Safety types (`safety_checkin`, `safety_alert`) bypass it entirely (C1). Quiet-hours are stored here and **actually enforced** in `dispatch_notification` (Task 7) using the user's city timezone (`cities.timezone` via `profiles.primary_city_id`) — the audit flagged that the old plan stored quiet-hours columns but never applied them. If S1 has not yet wired `primary_city_id`, quiet-hours evaluation degrades to "no quiet window" (permissive) rather than evaluating in the wrong tz. **Depends on:** S1 `profiles.primary_city_id` + `cities.timezone`.

- [ ] **Step 1: Write the failing test** (per-user prefs row, owner-only, quiet-hours columns present)

```sql
-- supabase/tests/p2_notification_preferences.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='notification_preferences' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'notification_preferences missing or RLS off'; END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='notification_preferences' AND column_name='quiet_hours_start';
  IF NOT FOUND THEN RAISE EXCEPTION 'quiet_hours_start missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525123300_p2_notification_preferences.sql
-- Per-user consent + quiet-hours (INTEGRATION-CONTRACT C11.8). dispatch_notification
-- reads this in the C1 order (consent → quiet-hours → rate-limit). Safety types
-- (safety_checkin, safety_alert) bypass all of it (C1). Quiet hours are evaluated
-- in the user's city timezone in dispatch_notification (Task 7), not stored-only.

create table notification_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  -- category toggles (apply to non-safety types)
  offers_enabled boolean not null default true,        -- offer_received/offer_expiring/standby_promoted
  matches_enabled boolean not null default true,       -- new_match
  messages_enabled boolean not null default true,      -- new_message
  reminders_enabled boolean not null default true,     -- date_reconfirm, rating_request
  account_enabled boolean not null default true,       -- account, moderation_action
  -- quiet hours, local to the user's city tz; safety types bypass these
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_notification_preferences_updated_at before update on notification_preferences
  for each row execute function set_updated_at();

alter table notification_preferences enable row level security;
do $$ begin
  create policy "notif_prefs_owner_all" on notification_preferences for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Auto-create a default prefs row on profile creation (dispatch treats a missing
-- row as permissive defaults too, so this is data hygiene, not correctness-load-bearing).
create or replace function ensure_notification_preferences() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into notification_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $fn$;
do $$ begin
  create trigger profiles_ensure_notif_prefs after insert on profiles
    for each row execute function ensure_notification_preferences();
exception when duplicate_object then null; end $$;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123300_p2_notification_preferences.sql supabase/tests/p2_notification_preferences.sql
git commit -m "P2/S2: notification_preferences (consent + quiet-hours; safety bypass) (C11.8)"
```

---

## Task 5: `notifications` delivery log + `notification_type` enum (C1)

**Files:**
- Create: `supabase/migrations/20260525123400_p2_notifications.sql`
- Test: `supabase/tests/p2_notifications.sql`

> **Conformance:** The enum is exactly the **C1 11-value** set (`new_match, offer_received, offer_expiring, standby_promoted, date_reconfirm, safety_checkin, safety_alert, new_message, rating_request, moderation_action, account`). The old plan's `offer_expired`/`date_auto_closed`/`lock_confirmed`/`new_interest`/`cancellation`/`pending_expired` enum values are **SUPERSEDED** — consumers map their events onto the C1 values (e.g. an expired offer notifies the candidate with `standby_promoted` to the next person and the creator with `account`/`date_reconfirm` per S6's spec; "someone swiped" is not a launch notification type). Recipient-read + mark-read RLS; service-role inserts/updates.

- [ ] **Step 1: Write the failing test** (recipient-read RLS; enum has the C1 safety + match values)

```sql
-- supabase/tests/p2_notifications.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='notifications' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'notifications missing or RLS off'; END IF;
  IF NOT ('safety_checkin' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing safety_checkin'; END IF;
  IF NOT ('safety_alert' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing safety_alert'; END IF;
  IF NOT ('new_match' = ANY (enum_range(null::notification_type)::text[]))
    THEN RAISE EXCEPTION 'notification_type missing new_match'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525123400_p2_notifications.sql
-- Append-only delivery log + the canonical notification_type enum (C1).
-- One row per (recipient, event); dispatch inserts it, then updates delivery
-- state. Also the backing store for an in-app notification center.

create type notification_type as enum (
  'new_match','offer_received','offer_expiring','standby_promoted','date_reconfirm',
  'safety_checkin','safety_alert','new_message','rating_request','moderation_action','account'
);
create type notification_channel as enum ('push_ios','push_android','web_push','email','admin_alert','suppressed');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type notification_type not null,
  payload jsonb not null default '{}',   -- title/body/deep-link entity ids (C1: dispatch takes p_payload)
  dedup_key text,
  channel notification_channel,          -- chosen channel, 'suppressed', or 'admin_alert' (fail-loud)
  delivered boolean not null default false,
  delivery_error text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedup_uniq
  on notifications (type, dedup_key) where dedup_key is not null;
create index notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;
do $$ begin
  create policy "notifications_recipient_read" on notifications for select
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "notifications_recipient_mark_read" on notifications for update
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123400_p2_notifications.sql supabase/tests/p2_notifications.sql
git commit -m "P2/S2: notifications log + notification_type enum (C1 11-value set)"
```

---

## Task 6: Notification storm rate-limit — typed wrapper over `rate_limit_check` (C1)

**Files:**
- Create: `supabase/migrations/20260525123450_p2_notification_rate_limit.sql`
- Test: `supabase/tests/p2_notification_rate_limit.sql`

> **Conformance:** C1 says the dispatch order reuses `rate_limit_check`. C10 says P11's batching folds into this one anti-storm system — so there is **one** rate limiter here; P11 does **not** ship `notification_batches`/`coalesce_notification` (those are SUPERSEDED, DS1). Safety types (`safety_checkin`, `safety_alert`) are never limited.

**Design:** Reuse the existing `rate_limits` table + `rate_limit_check(p_identifier, p_endpoint, p_max_requests)` RPC. `notification_rate_check(user_id, type)` maps each notification category to a per-hour cap, delegating to `rate_limit_check` with `identifier=user_id`, `endpoint='notify:<type>'`. Safety types return "never limited."

- [ ] **Step 1: Write the failing test** (a noisy category is capped; safety is never capped)

```sql
-- supabase/tests/p2_notification_rate_limit.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid := gen_random_uuid(); r json; allowed boolean; i int;
BEGIN
  FOR i IN 1..30 LOOP r := notification_rate_check(u, 'new_message'); END LOOP;
  r := notification_rate_check(u, 'new_message');
  allowed := (r->>'allowed')::boolean;
  IF allowed THEN RAISE EXCEPTION 'new_message should be rate-limited after burst'; END IF;

  FOR i IN 1..100 LOOP r := notification_rate_check(u, 'safety_checkin'); END LOOP;
  allowed := (r->>'allowed')::boolean;
  IF NOT allowed THEN RAISE EXCEPTION 'safety_checkin must never be rate-limited'; END IF;

  FOR i IN 1..100 LOOP r := notification_rate_check(u, 'safety_alert'); END LOOP;
  allowed := (r->>'allowed')::boolean;
  IF NOT allowed THEN RAISE EXCEPTION 'safety_alert must never be rate-limited'; END IF;
  RAISE NOTICE 'notification rate-limit OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function notification_rate_check(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525123450_p2_notification_rate_limit.sql
-- The single anti-storm guard (C1 + C10: P11's batching folds in here; no second
-- system). Reuses rate_limits + rate_limit_check (20260522110000_rate_limits.sql).
-- Safety categories (safety_checkin, safety_alert) are exempt.

create or replace function notification_rate_check(
  p_user_id uuid, p_type notification_type
) returns json
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_cap int; v_endpoint text := 'notify:' || p_type::text;
begin
  -- Safety + high-stakes-1:1 events are never throttled.
  if p_type in ('safety_checkin','safety_alert','offer_received','offer_expiring',
                'standby_promoted','date_reconfirm','new_match') then
    return json_build_object('allowed', true, 'current_count', 0, 'retry_after_seconds', 0);
  end if;
  v_cap := case p_type
    when 'new_message'       then 30
    when 'rating_request'    then 10
    when 'moderation_action' then 20
    when 'account'           then 20
    else 30
  end;
  return rate_limit_check(p_user_id::text, v_endpoint, v_cap);
end $fn$;

revoke execute on function notification_rate_check(uuid, notification_type) from public, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `notification rate-limit OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123450_p2_notification_rate_limit.sql supabase/tests/p2_notification_rate_limit.sql
git commit -m "P2/S2: notification_rate_check wrapper (single anti-storm system; safety exempt) (C1/C10)"
```

---

## Task 7: `admin_alerts` + ops "fail loud" sink (C11.8)

**Files:**
- Create: `supabase/migrations/20260525123700_p2_admin_alerts.sql`
- Test: `supabase/tests/p2_admin_alerts.sql`

> **Conformance:** C11.8 owns this here. `admin_alerts(id, kind, payload, created_at, resolved_at)` + an always-on out-of-band sink (ops email via Resend **and** a row insert). It is the terminus for the C1 safety fail-loud rule: a `safety_checkin`/`safety_alert` with no device inserts an `admin_alerts` row AND emails ops — never a silent drop. P7/S8 and P8/S9 **consume** this table (referenced, not built there). The SQL side here is the `raise_admin_alert(p_kind text, p_payload jsonb)` writer + table; the ops-email half is wired in `notify.ts` (Task 9) so the alert reaches a human out-of-band even if the in-app channel is empty.

- [ ] **Step 1: Write the failing test** (table + writer; raising an alert inserts a row)

```sql
-- supabase/tests/p2_admin_alerts.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE a uuid; n int;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='admin_alerts' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_alerts missing or RLS off'; END IF;
  a := raise_admin_alert('safety_no_device', '{"user_id":"x","type":"safety_checkin"}'::jsonb);
  SELECT count(*) INTO n FROM admin_alerts WHERE id=a AND kind='safety_no_device' AND resolved_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'raise_admin_alert did not insert open alert'; END IF;
  RAISE NOTICE 'admin_alerts OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525123700_p2_admin_alerts.sql
-- Admin-alert channel — the "fail loud" terminus (INTEGRATION-CONTRACT C11.8).
-- A safety notification with no deliverable device inserts a row here AND (via
-- notify.ts) emails ops; it never dead-ends in an empty channel. P7/S8 + P8/S9
-- consume this table (admin console + safety escalation).

create table admin_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index admin_alerts_open_idx on admin_alerts (created_at desc) where resolved_at is null;

alter table admin_alerts enable row level security;
-- Service-role + admin-only (admin RLS added by P8/S9 admin console using
-- admin_has_role()); no anon/authenticated access by default.

create or replace function raise_admin_alert(p_kind text, p_payload jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  insert into admin_alerts (kind, payload) values (p_kind, coalesce(p_payload,'{}'))
  returning id into v_id;
  return v_id;
end $fn$;

revoke execute on function raise_admin_alert(text, jsonb) from public, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123700_p2_admin_alerts.sql supabase/tests/p2_admin_alerts.sql
git commit -m "P2/S2: admin_alerts table + raise_admin_alert writer (fail-loud terminus) (C11.8)"
```

---

## Task 8: `dispatch_notification()` RPC — consent → quiet-hours → rate-limit → channel (C1)

**Files:**
- Create: `supabase/migrations/20260525123600_p2_dispatch_notification.sql`
- Test: `supabase/tests/p2_dispatch_notification.sql`

> **Conformance:** Exact C1 signature `dispatch_notification(p_user uuid, p_type notification_type, p_payload jsonb)`. The old 6-arg form (`title, body, data, dedup_key`) is **SUPERSEDED** — title/body/deep-link/dedup all live inside `p_payload` (`{title, body, data, dedup_key}`). Order: **consent → quiet-hours → rate-limit → channel (push→web→email)** (C1). **Safety types (`safety_checkin`, `safety_alert`) bypass consent/quiet/rate-limit; if no device exists they MUST fail loud** — the RPC returns `channel='admin_alert'`, `raise_admin_alert(...)` fires, and `notify.ts` (Task 9) also emails ops (C1, C11.8). Quiet-hours evaluated in the user's city tz (degrade to permissive if `primary_city_id`/tz absent). **Depends on:** S1 `profiles.primary_city_id` + `cities.timezone`.

> **Migration ordering note:** this migration is timestamped `123600` but reads `admin_alerts`/`raise_admin_alert` (`123700`). Postgres resolves plpgsql callee names at runtime, so creation order is fine for the function body; however `db reset` applies in timestamp order, so the `raise_admin_alert` call is resolved at first invocation (after both migrations apply). Tests run post-`db reset`, so both exist. (If a strict-order lint complains, renumber this to `123750` — still inside P2's band and after `admin_alerts`.)

- [ ] **Step 1: Write the failing test** (opt-out suppresses non-safety; safety with no device → admin_alert + fail-loud; dedup)

```sql
-- supabase/tests/p2_dispatch_notification.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; res json; ch text; n int; alerts_before int; alerts_after int;
BEGIN
  u := mk_user('disp');
  -- opt out of everything (non-safety) + no device registered
  update notification_preferences
     set push_enabled=false, email_enabled=false, offers_enabled=false
   where user_id = u;

  -- non-safety offer notification with no consent/channel → suppressed
  res := dispatch_notification(u, 'offer_received',
           json_build_object('title','Offer','body','You got an offer','dedup_key','d1')::jsonb);
  ch := res->>'channel';
  IF ch <> 'suppressed' THEN RAISE EXCEPTION 'opted-out offer not suppressed: %', ch; END IF;

  -- safety notification, NO device → must fail loud to admin_alert (never suppressed)
  SELECT count(*) INTO alerts_before FROM admin_alerts WHERE kind='safety_no_device';
  res := dispatch_notification(u, 'safety_checkin',
           json_build_object('title','Check in','body','You ok?','dedup_key','d2')::jsonb);
  ch := res->>'channel';
  IF ch = 'suppressed' THEN RAISE EXCEPTION 'safety notification was suppressed'; END IF;
  IF ch <> 'admin_alert' THEN RAISE EXCEPTION 'safety w/ no device should fail loud, got %', ch; END IF;
  SELECT count(*) INTO alerts_after FROM admin_alerts WHERE kind='safety_no_device';
  IF alerts_after <> alerts_before + 1 THEN RAISE EXCEPTION 'no admin_alert raised for tokenless safety'; END IF;

  -- dedup: re-dispatch same (type, dedup_key) does not insert a 2nd row
  res := dispatch_notification(u, 'safety_checkin',
           json_build_object('title','Check in','body','You ok?','dedup_key','d2')::jsonb);
  SELECT count(*) INTO n FROM notifications WHERE type='safety_checkin' AND dedup_key='d2';
  IF n <> 1 THEN RAISE EXCEPTION 'dedup failed: % rows', n; END IF;
  RAISE NOTICE 'dispatch_notification OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function dispatch_notification(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525123600_p2_dispatch_notification.sql
-- Decision + log + fail-loud half of dispatch (network delivery is in notify.ts).
-- C1 signature: dispatch_notification(p_user, p_type, p_payload). Order:
-- consent → quiet-hours → rate-limit → channel (push→web→email). Safety types
-- bypass all gates; with no device they FAIL LOUD (channel='admin_alert' +
-- raise_admin_alert) — never silent (C1, C11.8). p_payload carries
-- {title, body, data, dedup_key}.

create or replace function dispatch_notification(
  p_user uuid, p_type notification_type, p_payload jsonb default '{}'
) returns json
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_is_safety boolean := p_type in ('safety_checkin','safety_alert');
  v_dedup text := nullif(p_payload->>'dedup_key','');
  v_prefs notification_preferences%rowtype;
  v_allowed boolean := true;
  v_rate json;
  v_notif_id uuid; v_existing uuid;
  v_tokens jsonb;
  v_channel notification_channel := 'suppressed';
  v_tz text; v_local time; v_qs time; v_qe time; v_in_quiet boolean := false;
begin
  -- dedup short-circuit
  if v_dedup is not null then
    select id into v_existing from notifications where type=p_type and dedup_key=v_dedup limit 1;
    if found then
      return json_build_object('notification_id', v_existing, 'channel', 'suppressed',
                               'tokens', '[]'::jsonb, 'reason', 'dedup');
    end if;
  end if;

  select * into v_prefs from notification_preferences where user_id = p_user;

  if not v_is_safety then
    -- 1) consent gate (missing prefs row => permissive defaults)
    if v_prefs.user_id is not null then
      if (not v_prefs.push_enabled and not v_prefs.email_enabled) then v_allowed := false;
      elsif p_type in ('offer_received','offer_expiring','standby_promoted') and not v_prefs.offers_enabled then v_allowed := false;
      elsif p_type = 'new_match' and not v_prefs.matches_enabled then v_allowed := false;
      elsif p_type = 'new_message' and not v_prefs.messages_enabled then v_allowed := false;
      elsif p_type in ('date_reconfirm','rating_request') and not v_prefs.reminders_enabled then v_allowed := false;
      elsif p_type in ('account','moderation_action') and not v_prefs.account_enabled then v_allowed := false;
      end if;
    end if;
    -- 2) quiet-hours gate (user's city tz; degrade permissive if tz unknown)
    if v_allowed and v_prefs.quiet_hours_start is not null and v_prefs.quiet_hours_end is not null then
      select c.timezone into v_tz from profiles pr
        join cities c on c.id = pr.primary_city_id where pr.id = p_user;
      if v_tz is not null then
        v_local := (now() at time zone v_tz)::time;
        v_qs := v_prefs.quiet_hours_start; v_qe := v_prefs.quiet_hours_end;
        v_in_quiet := case when v_qs <= v_qe then (v_local >= v_qs and v_local < v_qe)
                           else (v_local >= v_qs or v_local < v_qe) end; -- wraps midnight
        if v_in_quiet then v_allowed := false; end if;
      end if;
    end if;
    -- 3) rate-limit gate
    if v_allowed then
      v_rate := notification_rate_check(p_user, p_type);
      if not (v_rate->>'allowed')::boolean then v_allowed := false; end if;
    end if;
  end if;

  -- channel pick: native push → web push → email. Safety always proceeds.
  if v_allowed or v_is_safety then
    select coalesce(jsonb_agg(jsonb_build_object(
             'platform', platform, 'expo_push_token', expo_push_token, 'web_push_sub', web_push_sub)), '[]'::jsonb)
      into v_tokens from devices
     where user_id = p_user and (expo_push_token is not null or web_push_sub is not null);

    if v_tokens @> '[{"platform":"ios"}]' then v_channel := 'push_ios';
    elsif v_tokens @> '[{"platform":"android"}]' then v_channel := 'push_android';
    elsif v_tokens @> '[{"platform":"web"}]' then v_channel := 'web_push';
    elsif coalesce(v_prefs.email_enabled, true) then v_channel := 'email';
    elsif v_is_safety then v_channel := 'admin_alert';  -- safety w/ no channel: fail loud
    else v_channel := 'suppressed';
    end if;

    -- For safety types, an 'email' channel is only acceptable if email is wired;
    -- the network layer (notify.ts) escalates to admin_alert on email failure.
    -- If there is genuinely NO device AND no email, fail loud here.
    if v_is_safety and v_channel in ('suppressed') then v_channel := 'admin_alert'; end if;
    if v_is_safety and v_channel = 'email' and not coalesce(v_prefs.email_enabled, true) then
      v_channel := 'admin_alert';
    end if;
  end if;

  insert into notifications (user_id, type, payload, dedup_key, channel)
  values (p_user, p_type, coalesce(p_payload,'{}'), v_dedup, v_channel)
  returning id into v_notif_id;

  -- fail-loud terminus: a safety notification that resolved to admin_alert raises one now.
  if v_is_safety and v_channel = 'admin_alert' then
    perform raise_admin_alert('safety_no_device',
      json_build_object('user_id', p_user, 'type', p_type::text, 'notification_id', v_notif_id)::jsonb);
  end if;

  return json_build_object(
    'notification_id', v_notif_id,
    'channel', v_channel,
    'tokens', case when v_channel in ('push_ios','push_android','web_push') then v_tokens else '[]'::jsonb end
  );
end $fn$;

create or replace function mark_notification_delivered(p_id uuid, p_error text default null)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  update notifications set delivered = (p_error is null), delivery_error = p_error where id = p_id;
end $fn$;

revoke execute on function dispatch_notification(uuid, notification_type, jsonb) from public, authenticated;
revoke execute on function mark_notification_delivered(uuid, text) from public, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `dispatch_notification OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123600_p2_dispatch_notification.sql supabase/tests/p2_dispatch_notification.sql
git commit -m "P2/S2: dispatch_notification (C1 signature; consent→quiet→rate→channel; safety fail-loud)"
```

---

## Task 9: `_shared/notify.ts` — network delivery (Expo + Web Push + email) + ops fail-loud

**Files:**
- Create: `supabase/functions/_shared/notify.ts`
- Test: `supabase/functions/_shared/notify_test.ts`

> **Conformance:** `dispatchNotification()` calls the C1 `dispatch_notification` RPC (3-arg: `p_user`, `p_type`, `p_payload`), then performs the network send for the chosen channel. **For `channel='admin_alert'` (safety fail-loud), it emails ops via Resend** so the alert reaches a human even though the in-app channel was empty (C11.8). For safety types, if push/email delivery fails, it escalates to `raise_admin_alert` + ops email rather than logging a silent failure. Providers are injected so tests mock the network. **Expo receipt/error handling:** read the Expo ticket body (a 200 can carry per-message `status:'error'`) and treat per-message errors as delivery failures, not successes (closes audit "delivery metrics lie").

- [ ] **Step 1: Write the failing test** (suppressed → no send; native channel → Expo called + mark-delivered; admin_alert safety → ops email called)

```ts
// supabase/functions/_shared/notify_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { dispatchNotification } from './notify.ts';

function fakeClient(dispatchResult: unknown) {
  const calls: Record<string, unknown[]> = {};
  return {
    calls,
    rpc(name: string, args: unknown) {
      (calls[name] ??= []).push(args);
      if (name === 'dispatch_notification') return Promise.resolve({ data: dispatchResult, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

Deno.test('suppressed channel performs no network send', async () => {
  const client = fakeClient({ notification_id: 'n1', channel: 'suppressed', tokens: [] });
  let expoCalled = false;
  await dispatchNotification(client as never,
    { userId: 'u1', type: 'offer_received', payload: { title: 't', body: 'b' } },
    { sendExpo: async () => { expoCalled = true; return { ok: true }; } });
  assertEquals(expoCalled, false);
  assertEquals(client.calls['mark_notification_delivered'], undefined);
});

Deno.test('native channel sends via Expo and marks delivered', async () => {
  const client = fakeClient({
    notification_id: 'n2', channel: 'push_ios',
    tokens: [{ platform: 'ios', expo_push_token: 'ExponentPushToken[x]' }],
  });
  let sentTo = '';
  await dispatchNotification(client as never,
    { userId: 'u1', type: 'safety_checkin', payload: { title: 't', body: 'b' } },
    { sendExpo: async (toks) => { sentTo = toks[0]; return { ok: true }; } });
  assertEquals(sentTo, 'ExponentPushToken[x]');
  assertEquals((client.calls['mark_notification_delivered'] as unknown[]).length, 1);
});

Deno.test('safety admin_alert channel emails ops (fail loud)', async () => {
  const client = fakeClient({ notification_id: 'n3', channel: 'admin_alert', tokens: [] });
  let opsEmailed = false;
  await dispatchNotification(client as never,
    { userId: 'u1', type: 'safety_checkin', payload: { title: 't', body: 'b' } },
    { sendOpsEmail: async () => { opsEmailed = true; return { ok: true }; } });
  assertEquals(opsEmailed, true);
});
```

- [ ] **Step 2: Run it, expect FAIL** — module `./notify.ts` not found.

- [ ] **Step 3: Write the module**

```ts
// supabase/functions/_shared/notify.ts
// Network-delivery half of notification dispatch. Calls the C1 dispatch_notification
// RPC (p_user, p_type, p_payload) for the consent/quiet/ratelimit/log decision, then
// sends over the chosen channel. channel='admin_alert' (safety fail-loud, C11.8)
// emails ops. Providers are injected so unit tests mock the network.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

type DbClient = ReturnType<typeof createClient> | { rpc: (n: string, a: unknown) => Promise<{ data: unknown; error: unknown }> };

// Mirrors the SQL notification_type enum (C1) exactly.
export type NotificationType =
  | 'new_match' | 'offer_received' | 'offer_expiring' | 'standby_promoted' | 'date_reconfirm'
  | 'safety_checkin' | 'safety_alert' | 'new_message' | 'rating_request' | 'moderation_action' | 'account';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  payload: { title?: string; body?: string; data?: Record<string, unknown>; dedup_key?: string };
}

interface DispatchDecision {
  notification_id: string;
  channel: 'push_ios' | 'push_android' | 'web_push' | 'email' | 'admin_alert' | 'suppressed';
  tokens: Array<{ platform: string; expo_push_token?: string; web_push_sub?: unknown }>;
}

export interface NotifyDeps {
  sendExpo?: (tokens: string[], n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
  sendWebPush?: (subs: unknown[], n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
  sendEmail?: (userId: string, n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
  sendOpsEmail?: (n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
}

const SAFETY = new Set<NotificationType>(['safety_checkin', 'safety_alert']);

// Default Expo push: POST to exp.host, then INSPECT the ticket body — a 200 can
// carry per-message status:'error' (DeviceNotRegistered, MessageRejected). Treat
// any per-message error as a delivery failure (do not trust res.ok alone).
async function defaultSendExpo(tokens: string[], n: NotifyInput) {
  const messages = tokens.map((to) => ({
    to, title: n.payload.title ?? '', body: n.payload.body ?? '', data: n.payload.data ?? {},
    sound: 'default', priority: SAFETY.has(n.type) || n.type === 'date_reconfirm' ? 'high' : 'default',
  }));
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) return { ok: false, error: `expo ${res.status}` };
  const body = await res.json().catch(() => null) as { data?: Array<{ status?: string; message?: string }> } | null;
  const errored = body?.data?.find((t) => t.status === 'error');
  return errored ? { ok: false, error: `expo_ticket:${errored.message ?? 'error'}` } : { ok: true };
}

async function defaultSendWebPush(_subs: unknown[], _n: NotifyInput) {
  // Web Push (VAPID) best-effort fallback — uses VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
  // env (documented in this plan's secrets). Native is load-bearing.
  return { ok: false, error: 'web_push_not_configured' };
}

async function defaultSendEmail(_userId: string, _n: NotifyInput) {
  // High-stakes fallback via the repo's Resend sender. Wired through a small
  // internal endpoint/shared lib; returns ok:false until wired so failures are
  // logged (and, for safety types, escalated to ops) — never silently dropped.
  return { ok: false, error: 'email_not_wired' };
}

async function defaultSendOpsEmail(n: NotifyInput) {
  // Always-on out-of-band ops alert (Resend → ops inbox) — the C11.8 fail-loud sink.
  // Wire to OPS_ALERT_EMAIL + Resend. Returns ok:false until wired (the admin_alerts
  // row already guarantees a human-visible record).
  void n;
  return { ok: false, error: 'ops_email_not_wired' };
}

export async function dispatchNotification(
  db: DbClient, input: NotifyInput, deps: NotifyDeps = {},
): Promise<{ notificationId: string | null; channel: string; delivered: boolean }> {
  const sendExpo = deps.sendExpo ?? defaultSendExpo;
  const sendWebPush = deps.sendWebPush ?? defaultSendWebPush;
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const sendOpsEmail = deps.sendOpsEmail ?? defaultSendOpsEmail;

  const { data, error } = await db.rpc('dispatch_notification', {
    p_user: input.userId, p_type: input.type, p_payload: input.payload ?? {},
  });
  if (error) throw new Error(`dispatch_notification rpc failed: ${JSON.stringify(error)}`);
  const decision = data as DispatchDecision;

  if (decision.channel === 'suppressed') {
    return { notificationId: decision.notification_id, channel: 'suppressed', delivered: false };
  }

  // Safety fail-loud: the RPC already raised an admin_alerts row; we ALSO email ops.
  if (decision.channel === 'admin_alert') {
    await sendOpsEmail(input);
    return { notificationId: decision.notification_id, channel: 'admin_alert', delivered: false };
  }

  let result: { ok: boolean; error?: string };
  if (decision.channel === 'push_ios' || decision.channel === 'push_android') {
    result = await sendExpo(decision.tokens.map((t) => t.expo_push_token!).filter(Boolean), input);
  } else if (decision.channel === 'web_push') {
    result = await sendWebPush(decision.tokens.map((t) => t.web_push_sub).filter(Boolean), input);
  } else {
    result = await sendEmail(input.userId, input);
  }

  // Safety types whose delivery failed escalate to ops (never a silent failure).
  if (!result.ok && SAFETY.has(input.type)) {
    await db.rpc('raise_admin_alert', {
      p_kind: 'safety_delivery_failed',
      p_payload: { user_id: input.userId, type: input.type, notification_id: decision.notification_id, error: result.error },
    });
    await sendOpsEmail(input);
  }

  await db.rpc('mark_notification_delivered', {
    p_id: decision.notification_id, p_error: result.ok ? null : (result.error ?? 'delivery_failed'),
  });
  return { notificationId: decision.notification_id, channel: decision.channel, delivered: result.ok };
}
```

- [ ] **Step 4: Run test, expect PASS** — `deno test --allow-env supabase/functions/_shared/notify_test.ts`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/notify.ts supabase/functions/_shared/notify_test.ts
git commit -m "P2/S2: _shared/notify.ts — Expo/web/email delivery + Expo receipt check + safety fail-loud to ops"
```

---

## Task 10: `process-jobs/handlers.ts` — dispatch table calling canonical consumer RPCs

**Files:**
- Create: `supabase/functions/process-jobs/handlers.ts`
- Test: `supabase/functions/process-jobs/handlers_test.ts`

> **Conformance (the audit's #1 finding fixed):** There are **no `p5_promote_standby`/`p5_reap_pending` stubs** — those were fictional and are removed. Each `job_type` maps to the **canonical** consumer RPC (C2/owners):
> - `offer_expiry` → `match_expire_offer(p_offer)` (C2; idempotent; auto-rolls inline). P2 does NOT write offer state directly (the audit's offer-double-write race is eliminated).
> - `standby_roll` → `match_auto_roll(p_instance)` (C2). (Enqueued by P5, not by P2's offer_expiry handler.)
> - `stale_date_close` → P5's close path (S6).
> - `day_of_reconfirm` / `safety_checkin` / `reconfirm_timeout` → `dispatch_notification` to the relevant party/parties (P2 owns notify; P7/S8 owns escalation).
> - `bulk_withdraw` → P5/P9 withdraw path; `chat_purge` → P6/S7; `rating_window` → P7/S8; `deletion_process` → P9/S10.
> - `analytics_relay` → **P11/S12** (not built here — handler imported from P11's module; P2 ships the table only).
> - `notify` → generic deferred `dispatch_notification` from payload.
>
> For job types whose consumer RPC ships in a later stage, the handler invokes the canonical name; the dispatch is exercised once that stage lands. **The handler never marks loop state itself.** **Depends on:** S6 (`match_expire_offer`, `match_auto_roll`, stale-close), S7 (`chat_purge`), S8 (`rating_window`), S10 (`deletion_process`), S12 (`analytics_relay`).

- [ ] **Step 1: Write the failing test** (registry covers all 13 types; offer_expiry calls `match_expire_offer`, NOT a direct offer update; safety_checkin dispatches notify)

```ts
// supabase/functions/process-jobs/handlers_test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { HANDLERS } from './handlers.ts';

const ALL_TYPES = [
  'offer_expiry','standby_roll','pending_expiry','stale_date_close',
  'day_of_reconfirm','safety_checkin','reconfirm_timeout','bulk_withdraw',
  'chat_purge','rating_window','deletion_process','analytics_relay','notify',
];

Deno.test('every job_type has a handler', () => {
  for (const t of ALL_TYPES) assert(typeof HANDLERS[t] === 'function', `missing handler ${t}`);
});

Deno.test('offer_expiry calls match_expire_offer (no direct offer write)', async () => {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const fakeDb = {
    rpc: (name: string, args: unknown) => { rpcCalls.push({ name, args }); return Promise.resolve({ data: null, error: null }); },
    from: () => { throw new Error('handler must not write tables directly'); },
  };
  await HANDLERS['offer_expiry'](fakeDb as never, {
    id: 'j1', type: 'offer_expiry', payload: { offer_id: 'o1' }, run_after: '', status: 'running',
  } as never);
  assert(rpcCalls.some((c) => c.name === 'match_expire_offer'), 'did not call match_expire_offer');
});
```

- [ ] **Step 2: Run it, expect FAIL** (`./handlers.ts` not found).

- [ ] **Step 3: Write the module**

```ts
// supabase/functions/process-jobs/handlers.ts
// Per-job_type dispatch table. Each handler invokes the CANONICAL consumer RPC
// (INTEGRATION-CONTRACT C2 + owners) — P2 never writes loop state itself and ships
// no p5_* stubs. payload carries entity ids ({offer_id}, {instance_id}, {lock_id}, …).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { dispatchNotification, type NotificationType } from '../_shared/notify.ts';

type Db = ReturnType<typeof createClient>;
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
  rating_window: async (db, job) => { await db.rpc('close_rating_window', { p_lock: id(job, 'lock_id') }); },          // P7/S8
  deletion_process: async (db, job) => { await db.rpc('process_deletion', { p_user: id(job, 'user_id') }); },          // P9/S10
  analytics_relay: async (db, job) => { await db.rpc('analytics_relay_drain', { p_batch: job.payload }); },            // P11/S12 owns the body
  notify: genericNotify,
};
```

> **Note on later-stage RPC names:** `match_stale_date_close`, `match_expire_pending`, `match_reconfirm_timeout`, `match_bulk_withdraw`, `chat_purge_thread`, `close_rating_window`, `process_deletion`, `analytics_relay_drain` are the **callee names P2 dispatches to**; their bodies are owned by S6/S7/S8/S10/S12 respectively. If the owning stage finalizes a different canonical name, update this one dispatch line (a single seam) — never re-add a P2-local stub. The Deno test only asserts the dispatch *call*, so it passes before the callees exist; the e2e SQL (Task 13) exercises only `offer_expiry` against the real S6 RPC once S6 lands.

- [ ] **Step 4: Run test, expect PASS** (`deno test --allow-env supabase/functions/process-jobs/handlers_test.ts`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-jobs/handlers.ts supabase/functions/process-jobs/handlers_test.ts
git commit -m "P2/S2: job dispatch table → canonical consumer RPCs (offer_expiry→match_expire_offer; no p5_* stubs)"
```

---

## Task 11: `feature_config` + `offer_expires_at()` (C11.1, band `123800`)

**Files:**
- Create: `supabase/migrations/20260525123800_p2_feature_config.sql`
- Test: `supabase/tests/p2_feature_config.sql`

> **Conformance:** Owned here (C11.1) because P5 (band `126xxx`) depends on it. Exact C11.1 DDL + helper. P5's `match_make_offer` sets `expires_at := offer_expires_at()` — **no hardcoded 24h anywhere** (CV8). Clamp 12–72h, DST-safe via `make_interval`.

- [ ] **Step 1: Write the failing test** (config row seeded; helper returns a clamped, DST-safe future ts)

```sql
-- supabase/tests/p2_feature_config.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE base timestamptz := '2026-05-25 12:00:00+00'; got timestamptz; hours numeric;
BEGIN
  PERFORM 1 FROM feature_config WHERE key='offer_window_hours';
  IF NOT FOUND THEN RAISE EXCEPTION 'feature_config offer_window_hours seed missing'; END IF;
  got := offer_expires_at(base);
  hours := extract(epoch from (got - base)) / 3600;
  IF hours < 12 OR hours > 72 THEN RAISE EXCEPTION 'offer_expires_at out of 12-72h clamp: %', hours; END IF;
  RAISE NOTICE 'feature_config OK (% hours)', hours;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration** (C11.1 verbatim)

```sql
-- supabase/migrations/20260525123800_p2_feature_config.sql
-- feature_config + offer_expires_at() (INTEGRATION-CONTRACT C11.1). Owned by P2
-- (band 123800) because P5 (band 126xxx) depends on these. P5's match_make_offer
-- uses offer_expires_at() — no hardcoded 24h.

create table feature_config (
  key text primary key, value jsonb not null,
  updated_at timestamptz not null default now() );
insert into feature_config(key,value) values ('offer_window_hours','24'::jsonb) on conflict do nothing;

create or replace function offer_expires_at(p_from timestamptz default now()) returns timestamptz
language sql stable as $$
  select p_from + make_interval(hours =>
    greatest(12, least(72, (select (value#>>'{}')::int from feature_config where key='offer_window_hours'))) ) $$;

alter table feature_config enable row level security;
-- service-role + admin writes only (admin RLS added by P8/S9); no anon/authenticated.
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123800_p2_feature_config.sql supabase/tests/p2_feature_config.sql
git commit -m "P2/S2: feature_config + offer_expires_at() (C11.1)"
```

---

## Task 12: `analytics_events` outbox table (C11.8, band `123900`)

**Files:**
- Create: `supabase/migrations/20260525123900_p2_analytics_events.sql`
- Test: `supabase/tests/p2_analytics_events.sql`

> **Conformance:** C11.8 — the **table** is created here (band `123900`) so P5/P2 can emit into it. The **`analytics_relay` job handler + retention (30d purge) are P11/S12** — referenced, not built here (Task 10's `analytics_relay` dispatch points at P11's `analytics_relay_drain`). Append-only outbox.

- [ ] **Step 1: Write the failing test** (table exists, append-only shape)

```sql
-- supabase/tests/p2_analytics_events.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='analytics_events' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events missing or RLS off'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='analytics_events' AND column_name='event_name';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events.event_name missing'; END IF;
  PERFORM 1 FROM information_schema.columns WHERE table_name='analytics_events' AND column_name='relayed_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events.relayed_at (drain marker) missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525123900_p2_analytics_events.sql
-- Append-only analytics outbox (INTEGRATION-CONTRACT C11.8). The table is owned by
-- P2 (band 123900) so P5/P2 can emit. The analytics_relay job handler that drains
-- this to PostHog + the 30-day retention purge are P11/S12 (referenced in handlers.ts
-- via analytics_relay_drain). Every C2 transition emits a row here (C2/C8).

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  distinct_id uuid,                 -- user (nullable for system events)
  properties jsonb not null default '{}',
  created_at timestamptz not null default now(),
  relayed_at timestamptz            -- set by P11's analytics_relay drain; null = pending
);
create index analytics_events_pending_idx on analytics_events (created_at) where relayed_at is null;

alter table analytics_events enable row level security;
-- service-role only (emit + drain); no anon/authenticated.

-- emit_analytics(event_name, distinct_id, properties) — convenience writer C2 uses.
create or replace function emit_analytics(p_event text, p_distinct_id uuid, p_props jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  insert into analytics_events (event_name, distinct_id, properties)
  values (p_event, p_distinct_id, coalesce(p_props,'{}')) returning id into v_id;
  return v_id;
end $fn$;
revoke execute on function emit_analytics(text, uuid, jsonb) from public, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123900_p2_analytics_events.sql supabase/tests/p2_analytics_events.sql
git commit -m "P2/S2: analytics_events outbox table + emit_analytics (drain handler = P11/S12) (C11.8)"
```

---

## Task 13: `can_enter_lock_flow(p_user)` gate (C3, band `123500`)

**Files:**
- Create: `supabase/migrations/20260525123500_p2_can_enter_lock_flow.sql`
- Test: `supabase/tests/p2_can_enter_lock_flow.sql`

> **Conformance:** C3 — defined here (S2) so S6/P5 can call it before S8 ships the standing ladder (per master plan §6). Reads `profiles.account_state` + `profiles.standing` + `rollover_frozen` (columns added in S1). Returns true iff `account_state='active' AND standing NOT IN ('cooldown','locked_ban','suspended') AND NOT rollover_frozen` (C3). P5's `match_make_offer`/`match_accept_offer` MUST call it (C2). A `paused` user returns false (C11.9 — cannot create/accept new offers). **Depends on:** S1 `profiles.account_state` (`account_lifecycle`), `profiles.standing` (`standing_state`), `profiles.rollover_frozen`.

- [ ] **Step 1: Write the failing test** (active+good → true; paused → false; cooldown → false; suspended → false)

```sql
-- supabase/tests/p2_can_enter_lock_flow.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid;
BEGIN
  u := mk_user('gate');
  -- defaults (S1): account_state='active', standing='good', rollover_frozen=false
  IF NOT can_enter_lock_flow(u) THEN RAISE EXCEPTION 'active+good should pass gate'; END IF;

  update profiles set account_state='paused' where id=u;
  IF can_enter_lock_flow(u) THEN RAISE EXCEPTION 'paused must fail gate (C11.9)'; END IF;

  update profiles set account_state='active', standing='cooldown' where id=u;
  IF can_enter_lock_flow(u) THEN RAISE EXCEPTION 'cooldown must fail gate'; END IF;

  update profiles set standing='suspended' where id=u;
  IF can_enter_lock_flow(u) THEN RAISE EXCEPTION 'suspended must fail gate'; END IF;

  update profiles set standing='good', rollover_frozen=true where id=u;
  IF can_enter_lock_flow(u) THEN RAISE EXCEPTION 'rollover_frozen must fail gate'; END IF;
  RAISE NOTICE 'can_enter_lock_flow OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525123500_p2_can_enter_lock_flow.sql
-- P5 lock-flow gate (INTEGRATION-CONTRACT C3). Defined in S2 so S6/P5 can call it
-- before S8 ships the standing ladder. Reads the two orthogonal C3 fields on
-- profiles (account_state owner P9/S10; standing owner P7/S8) + rollover_frozen,
-- all added in S1. P5's match_make_offer/match_accept_offer MUST call it (C2).

create or replace function can_enter_lock_flow(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where id = p_user
       and account_state = 'active'
       and standing not in ('cooldown','locked_ban','suspended')
       and coalesce(rollover_frozen, false) = false
  );
$$;
-- predicate read by P5 RPCs (SECURITY DEFINER); keep grant-revoked from direct callers.
revoke execute on function can_enter_lock_flow(uuid) from public, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525123500_p2_can_enter_lock_flow.sql supabase/tests/p2_can_enter_lock_flow.sql
git commit -m "P2/S2: can_enter_lock_flow gate reading account_state+standing+rollover_frozen (C3)"
```

---

## Task 14: chat-core primitives (C11.7, band `124500`)

**Files:**
- Create: `supabase/migrations/20260525124500_p2_chat_core.sql`
- Test: `supabase/tests/p2_chat_core.sql`

> **Conformance:** C11.7 — the chat **thread table + `open_chat_thread`/`close_chat_thread`/`promote_chat_thread_to_lock`/`chat_lock_ready`** ship in this early **chat-core** slice at band `124500` (before P5's `126xxx`) so P5's tests can call them. **P6's rich messaging/retention/moderation stays in P6's band `127xxx` (S7)** — only the four primitives + the thread table are here. Signatures (C2/C9): `open_chat_thread(p_offer uuid)`, `chat_lock_ready(p_thread uuid) returns bool`, `promote_chat_thread_to_lock(p_offer uuid, p_lock uuid)`, `close_chat_thread(p_offer uuid)`. `match_reveal_allowed` (C2) is the reveal predicate — chat-core does NOT define a competing one (C9). FK/legal-hold posture (C9): threads survive profile delete (tombstone, not cascade) and carry `revoked_at`; held threads exempt from purge (P9/S10). **Depends on:** S1 `offers`/`locks` tables.

- [ ] **Step 1: Write the failing test** (open creates thread; chat_lock_ready predicate; promote attaches lock; close marks closed)

```sql
-- supabase/tests/p2_chat_core.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE thr uuid; ready boolean;
BEGIN
  -- the four primitives must exist with the C2/C9 signatures
  PERFORM 1 FROM pg_proc WHERE proname='open_chat_thread';
  IF NOT FOUND THEN RAISE EXCEPTION 'open_chat_thread missing'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='close_chat_thread';
  IF NOT FOUND THEN RAISE EXCEPTION 'close_chat_thread missing'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='promote_chat_thread_to_lock';
  IF NOT FOUND THEN RAISE EXCEPTION 'promote_chat_thread_to_lock missing'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='chat_lock_ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'chat_lock_ready missing'; END IF;
  -- thread table survives profile delete (tombstone) → has revoked_at, no cascade-only design
  PERFORM 1 FROM information_schema.columns WHERE table_name='chat_threads' AND column_name='revoked_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'chat_threads.revoked_at missing (C9 legal-hold)'; END IF;
  RAISE NOTICE 'chat-core primitives OK';
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525124500_p2_chat_core.sql
-- Chat-core slice (INTEGRATION-CONTRACT C11.7). Ships at band 124500 (before P5
-- 126xxx) so P5's tests can call open_chat_thread/chat_lock_ready/promote/close.
-- P6's rich messaging/retention/moderation lands later in S7 (band 127xxx) on top
-- of this table. P5 calls these per C2. Reveal predicate is match_reveal_allowed
-- (C2/C9) — chat-core does NOT define a competing reveal. Legal-hold posture (C9):
-- thread survives profile delete (tombstone), carries revoked_at; held threads
-- exempt from purge (P9/S10).

create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references offers(id) on delete cascade,
  lock_id uuid references locks(id) on delete set null,
  state text not null default 'open' check (state in ('open','promoted','closed')),
  both_ready boolean not null default false,   -- rapport gate (S7 sets via real messaging)
  legal_hold boolean not null default false,   -- P9/S10 sets; exempts from purge
  revoked_at timestamptz,                      -- C9 tombstone marker
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index chat_threads_offer_uniq on chat_threads (offer_id);
create index chat_threads_lock_idx on chat_threads (lock_id);

create trigger set_chat_threads_updated_at before update on chat_threads
  for each row execute function set_updated_at();

alter table chat_threads enable row level security;
-- Participant-read RLS is added by P6/S7 (it joins offer→participants). For S2,
-- service-role only (P5 RPCs are SECURITY DEFINER). No anon/authenticated writes.

-- open_chat_thread(p_offer): called by match_make_offer (C2). Idempotent.
create or replace function open_chat_thread(p_offer uuid) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  insert into chat_threads (offer_id) values (p_offer)
  on conflict (offer_id) do update set updated_at = now()
  returning id into v_id;
  return v_id;
end $fn$;

-- chat_lock_ready(p_thread): the lock gate (C2). True iff both parties have built
-- enough rapport (S7 messaging flips both_ready) OR a mutual override applies.
create or replace function chat_lock_ready(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select both_ready from chat_threads where id = p_thread), false);
$$;

-- promote_chat_thread_to_lock(p_offer, p_lock): on accept (C2).
create or replace function promote_chat_thread_to_lock(p_offer uuid, p_lock uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update chat_threads set lock_id = p_lock, state = 'promoted', updated_at = now()
   where offer_id = p_offer;
end $fn$;

-- close_chat_thread(p_offer): on pass/expire (C2). Held threads are NOT purged
-- (P9/S10 honors legal_hold); closing just marks state.
create or replace function close_chat_thread(p_offer uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update chat_threads set state = 'closed', revoked_at = coalesce(revoked_at, now()), updated_at = now()
   where offer_id = p_offer and not legal_hold;
end $fn$;

revoke execute on function open_chat_thread(uuid) from public, authenticated;
revoke execute on function chat_lock_ready(uuid) from public, authenticated;
revoke execute on function promote_chat_thread_to_lock(uuid, uuid) from public, authenticated;
revoke execute on function close_chat_thread(uuid) from public, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525124500_p2_chat_core.sql supabase/tests/p2_chat_core.sql
git commit -m "P2/S2: chat-core primitives (open/close/promote/chat_lock_ready) at band 124500 (C11.7)"
```

---

## Task 15: `process-jobs/index.ts` — the runner Edge Function

**Files:**
- Create: `supabase/functions/process-jobs/index.ts`
- Modify: `supabase/config.toml` (register `[functions.process-jobs]`)

**Design:** A `serve` handler that (1) authenticates via a shared `JOBS_RUNNER_SECRET` header, (2) calls `requeue_stuck_jobs()`, (3) calls `claim_due_jobs(limit)`, (4) for each claimed job runs `HANDLERS[job.type]` then `complete_job`/`fail_job`, (5) returns `{ claimed, done, failed }`. Service-role client. Bounded per-tick limit so a single invocation finishes well under the 150s Edge wall-clock; the every-minute cron drains the backlog.

> **Conformance:** dispatch keys on `job.type` (the C1 column), and a failed job dead-letters at `attempts>=5` (C1, via `fail_job`). A dead-lettered **safety** job is not silent — `fail_job` failures of `safety_checkin` jobs are surfaced via `raise_admin_alert` in the runner's catch path (closes the audit "failed safety job dies quietly" gap).

- [ ] **Step 1: Register the function + assert it boots** (no failing-test harness for the HTTP shell; covered by handler/notify unit tests + the e2e in Task 17).

- [ ] **Step 2: Write the Edge Function**

```ts
// supabase/functions/process-jobs/index.ts
// The scheduler runner (INTEGRATION-CONTRACT C1). Invoked every minute by
// /api/cron/process-jobs. Claims due jobs, dispatches by job.type, completes/fails.
// Service-role. Auth: header `x-jobs-secret: ${JOBS_RUNNER_SECRET}`. verify_jwt=false
// (config.toml) because this is service-to-service.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';
import { HANDLERS, type Job } from './handlers.ts';

const CLAIM_LIMIT = 50;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const expected = Deno.env.get('JOBS_RUNNER_SECRET');
  if (!expected || req.headers.get('x-jobs-secret') !== expected) return json({ error: 'unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  await supabase.rpc('requeue_stuck_jobs', {});
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_due_jobs', { p_limit: CLAIM_LIMIT });
  if (claimErr) return json({ error: 'claim_failed', details: claimErr.message }, 500);
  const jobs = (claimed ?? []) as Job[];

  let done = 0, failed = 0;
  for (const job of jobs) {
    const handler = HANDLERS[job.type];
    try {
      if (!handler) throw new Error(`no handler for ${job.type}`);
      await handler(supabase, job);
      await supabase.rpc('complete_job', { p_id: job.id });
      done++;
    } catch (e) {
      await supabase.rpc('fail_job', { p_id: job.id, p_error: String(e) });
      // Safety jobs never fail silently — surface the failure to ops (C11.8).
      if (job.type === 'safety_checkin') {
        await supabase.rpc('raise_admin_alert', {
          p_kind: 'safety_job_failed', p_payload: { job_id: job.id, error: String(e) },
        });
      }
      failed++;
    }
  }
  return json({ claimed: jobs.length, done, failed });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}
```

- [ ] **Step 3: Register the function in `supabase/config.toml`** (near `[functions.generate-plan]`):

```toml
[functions.process-jobs]
verify_jwt = false
```

- [ ] **Step 4: Verify it boots locally**

Run: `supabase functions serve process-jobs --no-verify-jwt`, then:
`curl -s -X POST http://127.0.0.1:54321/functions/v1/process-jobs -H "x-jobs-secret: wrong"` → expect `401`.
With the correct `JOBS_RUNNER_SECRET`: `{ "claimed": 0, "done": 0, "failed": 0 }` against an empty queue.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-jobs/index.ts supabase/config.toml
git commit -m "P2/S2: process-jobs runner (claim/dispatch-by-type/complete; safety dead-letter alerts)"
```

---

## Task 16: `/api/cron/process-jobs` Vercel cron route + every-minute schedule

**Files:**
- Create: `apps/web/app/api/cron/process-jobs/route.ts`
- Create: `apps/web/app/api/cron/process-jobs/route.test.ts`
- Modify: `apps/web/vercel.json` (add the cron entry)

**Design:** Mirror the existing cron routes' `CRON_SECRET` bearer auth, then invoke the `process-jobs` Edge Function with the `JOBS_RUNNER_SECRET` header. Thin proxy (route does no DB work; the Edge Function claims under the 150s budget). `?dry_run=true` returns without invoking.

> **Conformance (C10):** This test uses the **root** `vitest.config.ts` owned by P1/S3 (`pnpm test`). P2 does **not** create a local vitest config (DS4 — five duplicate configs collapsed to P1's root). If the root config does not yet exist when this stage runs, it is a P1/S3 prerequisite, not a P2 deliverable.

- [ ] **Step 1: Write the failing test** (vitest; root config)

```ts
// apps/web/app/api/cron/process-jobs/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();

describe('/api/cron/process-jobs', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CRON_SECRET = 'cron-secret';
    process.env.JOBS_RUNNER_SECRET = 'runner-secret';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    globalThis.fetch = fetchMock as never;
    fetchMock.mockReset();
  });

  it('rejects when CRON_SECRET is wrong', async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('https://app/api/cron/process-jobs'));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invokes the process-jobs edge function with the runner secret', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ claimed: 2, done: 2, failed: 0 }), { status: 200 }));
    const { GET } = await import('./route');
    const res = await GET(new Request('https://app/api/cron/process-jobs', { headers: { authorization: 'Bearer cron-secret' } }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['x-jobs-secret']).toBe('runner-secret');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm test apps/web/app/api/cron/process-jobs/route.test.ts` cannot resolve `./route`.

- [ ] **Step 3: Write the route**

```ts
// apps/web/app/api/cron/process-jobs/route.ts
// /api/cron/process-jobs — fires from Vercel Cron every minute (see vercel.json).
// Thin proxy: authenticates the cron call, then invokes the process-jobs Edge
// Function. Auth: Authorization: Bearer ${CRON_SECRET} OR ?secret=. ?dry_run=true skips.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });

  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const querySecret = url.searchParams.get('secret');
  const ok = authHeader === `Bearer ${expected}` || querySecret === expected;
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (url.searchParams.get('dry_run') === 'true') return NextResponse.json({ dry_run: true, invoked: false });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const runnerSecret = process.env.JOBS_RUNNER_SECRET;
  if (!supabaseUrl || !runnerSecret) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_SUPABASE_URL or JOBS_RUNNER_SECRET missing' }, { status: 500 });
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/process-jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jobs-secret': runnerSecret },
    body: '{}',
  });
  const summary = await res.json().catch(() => ({}));
  return NextResponse.json({ invoked: true, status: res.status, summary }, { status: res.ok ? 200 : 502 });
}
```

- [ ] **Step 4: Add the cron schedule to `apps/web/vercel.json`** (append to the existing `crons` array):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "cd ../.. && pnpm install --frozen-lockfile",
  "buildCommand": "cd ../.. && pnpm --filter @after5/web build",
  "outputDirectory": ".next",
  "crons": [
    { "path": "/api/cron/weekly-broadcast", "schedule": "0 16 * * 0" },
    { "path": "/api/cron/post-date-feedback", "schedule": "0 17 * * *" },
    { "path": "/api/cron/process-jobs", "schedule": "* * * * *" }
  ]
}
```

> **Assumption:** every-minute crons require Vercel Pro. Documented fallback: `pg_cron` + `net.http_post` invoking the same Edge Function. A cron-heartbeat alert (no tick in N minutes → `raise_admin_alert`) is a recommended follow-up (referenced; not in P2 scope unless S12 observability picks it up).

- [ ] **Step 5: Run test, expect PASS** — `pnpm test apps/web/app/api/cron/process-jobs/route.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/cron/process-jobs/route.ts apps/web/app/api/cron/process-jobs/route.test.ts apps/web/vercel.json
git commit -m "P2/S2: every-minute Vercel cron route invoking process-jobs (root vitest config, C10)"
```

---

## Task 17: End-to-end integration test (jobs + dispatch compose; offer_expiry seam)

**Files:**
- Create: `supabase/tests/p2_e2e_jobs_dispatch.sql`

**Design:** A psql integration test that exercises the DB-side contracts without the network, using `mk_*` fixtures (C8): enqueue + claim + cancel; dispatch a safety notification with no device and assert the fail-loud `admin_alerts` row; assert the `offer_expiry` job is enqueued/claimable and that completing it via `complete_job` works.

> **Conformance:** The `offer_expiry` handler body calls P5's `match_expire_offer` (C2), which does not exist until S6. So this e2e proves the **P2-owned** contracts (enqueue/claim/cancel/dispatch/fail-loud) compose; the full offer→expire→auto-roll path is proven in S6's tests once `match_expire_offer` lands. **Depends on:** S6 for the end-to-end offer-expiry behavior.

- [ ] **Step 1: Write the test**

```sql
-- supabase/tests/p2_e2e_jobs_dispatch.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE u uuid; j uuid; claimed_id uuid; res json; n int; alerts int; cancelled int;
BEGIN
  u := mk_user('e2e');

  -- enqueue an offer_expiry timer (entity ids in payload, C1)
  j := enqueue_job('offer_expiry', now()-interval '1 second',
                   jsonb_build_object('offer_id', gen_random_uuid()), 'offer_expiry:e2e');
  select id into claimed_id from claim_due_jobs(10) limit 1;
  IF claimed_id <> j THEN RAISE EXCEPTION 'claim returned wrong job'; END IF;
  PERFORM complete_job(j);
  PERFORM 1 FROM jobs WHERE id=j AND status='done';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_expiry job not done'; END IF;

  -- cancel_jobs no-ops on an already-resolved key, cancels a fresh pending one
  PERFORM enqueue_job('offer_expiry', now()+interval '1 hour', '{}'::jsonb, 'cancel:e2e');
  cancelled := cancel_jobs('offer_expiry', 'cancel:e2e');
  IF cancelled <> 1 THEN RAISE EXCEPTION 'cancel_jobs expected 1, got %', cancelled; END IF;

  -- safety dispatch with NO device → fail loud (admin_alert + admin_alerts row)
  SELECT count(*) INTO alerts FROM admin_alerts WHERE kind='safety_no_device';
  res := dispatch_notification(u, 'safety_checkin',
           json_build_object('title','Check in','body','You ok?','dedup_key','e2e:safe')::jsonb);
  IF (res->>'channel') <> 'admin_alert' THEN RAISE EXCEPTION 'safety w/ no device not fail-loud: %', res->>'channel'; END IF;
  SELECT count(*) INTO n FROM admin_alerts WHERE kind='safety_no_device';
  IF n <> alerts + 1 THEN RAISE EXCEPTION 'fail-loud admin_alert not raised'; END IF;

  RAISE NOTICE 'p2 e2e jobs+dispatch OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect PASS** (after Tasks 1–14 migrations applied)

Run: `supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p2_e2e_jobs_dispatch.sql`
Expected: prints `p2 e2e jobs+dispatch OK`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/p2_e2e_jobs_dispatch.sql
git commit -m "P2/S2: e2e psql — enqueue/claim/cancel + safety fail-loud compose"
```

---

## Task 18: Full reset verification + regenerate types

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset** — `supabase db reset`. Expected: all S1 + P2 migrations apply in band order (`123000`→`124500`).

- [ ] **Step 2: Run all P2 psql tests**

```bash
for f in supabase/tests/p2_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Run all Deno unit tests** — `deno test --allow-env supabase/functions/_shared/notify_test.ts supabase/functions/process-jobs/handlers_test.ts`. Expected: pass.

- [ ] **Step 4: Run the cron-route vitest** — `pnpm test apps/web/app/api/cron/process-jobs/route.test.ts` (root config). Expected: pass.

- [ ] **Step 5: Regenerate TypeScript types** — `pnpm db:types`. Expected: `packages/types/src/database.ts` now includes `jobs`, `devices`, `notification_preferences`, `notifications`, `feature_config`, `analytics_events`, `admin_alerts`, `chat_threads`, the enums (`job_type`, `job_status`, `notification_type`, `notification_channel`), and functions (`enqueue_job`, `cancel_jobs`, `register_device`, `dispatch_notification`, `notification_rate_check`, `offer_expires_at`, `emit_analytics`, `raise_admin_alert`, `can_enter_lock_flow`, `open_chat_thread`, `close_chat_thread`, `promote_chat_thread_to_lock`, `chat_lock_ready`).

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P2/S2: regenerate database types for the async/config/notify/chat-core spine"
```

---

## Self-Review

**Contract conformance (S2 spine, INTEGRATION-CONTRACT C1/C3/C6/C10/C11):**
- Canonical `jobs` table + 13-value `job_type` + 5-value `job_status` + `enqueue_job`/`cancel_jobs` (C1) → Tasks 1–2. No `kind`/`run_at`/`dedupe_key`/`enqueue` variants. ✅
- `notifications` + 11-value `notification_type` + `notification_preferences` + `devices` (C11.2) + `register_device` + `dispatch_notification` (consent→quiet→rate→channel; safety fail-loud) (C1, C11.8) → Tasks 3–9. ✅
- `feature_config` + `offer_expires_at()` (C11.1, band `123800`) → Task 11. ✅
- `analytics_events` outbox table (C11.8, band `123900`); drain handler = P11/S12 (referenced) → Task 12. ✅
- `admin_alerts` + ops fail-loud sink (C11.8) → Task 7 + Task 9. ✅
- `can_enter_lock_flow(p_user)` reading `account_state`+`standing`+`rollover_frozen` (C3) → Task 13. ✅
- chat-core primitives `open/close/promote_chat_thread_to_lock/chat_lock_ready` at band `124500` (C11.7) → Task 14. ✅
- Runner dispatches by `job.type`; `offer_expiry`→`match_expire_offer` (C2); **no `p5_*` stubs** → Tasks 10, 15. ✅
- One anti-storm system (C10/DS1); root vitest config (C10/DS4) → Tasks 6, 16. ✅
- Migration bands within P2's `123000–1239xx` + chat-core `124500` (C6/C11) → all tasks. ✅
- Tests via `mk_user`/`mk_itinerary`/`mk_instance` (C8) → all psql tests `\i '_fixtures.sql'`. ✅

**What this plan deliberately does NOT do (boundary discipline):**
- No loop transitions (offer/standby/lock state) — those are S6/P5 via the canonical `match_*` RPCs the handlers call.
- No rich chat messaging/retention/moderation — S7/P6 (band `127xxx`), built on the chat-core thread table here.
- No `analytics_relay` drain handler / PostHog client — S12/P11.
- No standing ladder writes — S8/P7 (this stage only ships the gate that reads `standing`).
- No second `jobs`/`browse_feed`/reveal/demand/vitest/state-model — references only (C10 rule 3).

**Idempotency / concurrency:** `claim_due_jobs` uses `for update skip locked`; `enqueue_job` dedups on the C1 `(type, dedup_key)` active index; `cancel_jobs` is set-based; `dispatch_notification` dedups on `(type, dedup_key)`; `fail_job` dead-letters at `attempts>=5`; `requeue_stuck_jobs` recovers crashed runners. The audit's `Date.now()` standby dedup bug is gone (P2 no longer enqueues `standby_roll`; P5 owns auto-roll).

**Safety fails loud (C1/C11.8):** a tokenless `safety_checkin`/`safety_alert` resolves to `channel='admin_alert'`, raises an `admin_alerts` row, and emails ops via `notify.ts`. Delivery failures of safety types escalate to `raise_admin_alert` + ops email. A dead-lettered safety job raises an `admin_alert` from the runner. No silent safety drop anywhere.

**Key assumptions stated:**
- **S1 prerequisites:** `_fixtures.sql` (`mk_user`/`mk_itinerary`/`mk_instance`), `profiles.account_state`/`standing`/`rollover_frozen`, `profiles.primary_city_id` + `cities.timezone`, base tables (`offers`, `locks`, `queue_entries`, `date_instances`), `set_updated_at()`, `rate_limits`+`rate_limit_check`.
- **Later-stage callee RPCs** (`match_expire_offer`, `match_auto_roll`, `match_stale_date_close`, `match_expire_pending`, `match_reconfirm_timeout`, `match_bulk_withdraw`, `chat_purge_thread`, `close_rating_window`, `process_deletion`, `analytics_relay_drain`) are dispatched by canonical name; their bodies land in S6/S7/S8/S10/S12. If an owning stage finalizes a different name, update the single dispatch line — never re-add a P2-local stub.
- **Root vitest config** owned by P1/S3 (C10); P2 ships no local config.
- **Secrets/env:** `JOBS_RUNNER_SECRET`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, `EXPO_ACCESS_TOKEN`, `OPS_ALERT_EMAIL` (Resend) — documented here per C11.8.
- **Vercel Pro** for the every-minute cron; `pg_cron` + `net.http_post` is the documented fallback.

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. The later-stage callee RPC names are documented cross-stage dependencies (Depends on), not P2 placeholders.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p2-scheduler-notifications.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

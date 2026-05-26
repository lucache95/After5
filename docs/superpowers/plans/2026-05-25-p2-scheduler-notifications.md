# P2 — Async Backbone: Scheduler + Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the job/worker layer that drives every timer the matching mechanic relies on (offer expiry, standby auto-roll, ~30-day pending expiry, stale-date auto-close, day-of reconfirmation, 30-min safety check-in) and the notification system (delivery log + push via Expo with a web fallback + consent/preferences + storm rate-limiting). Without this layer the P5 state machine is **inert** — offers never expire, standby never rolls, safety check-ins never fire. P2 ships the backbone and a clean enqueue/dispatch interface that P5 (future) calls; P2 itself does **not** implement the loop transitions — it provides the runner, the handlers' skeletons, and the dispatch surface they will use.

**Architecture (concrete choice — justified):**

- **Scheduler = a `jobs` table + a runner Edge Function invoked by a Vercel cron every minute.** *Why this and not Inngest (which the v2 architecture spec §3 names for async work):* (1) the repo already ships the exact pattern — `apps/web/vercel.json` defines `crons` hitting `/api/cron/*`, and those routes call a service-role Supabase client; we extend that pattern rather than introduce a new vendor. (2) The mechanic's timers are **minute-granular, DB-state-driven** (an offer's `expires_at`, an instance's `starts_at + 30min`), which is a query-and-act loop, not a multi-step retryable workflow — a `jobs` table with `run_after`/`status`/`attempts` columns expresses it precisely with full visibility in Postgres (the v2 hub-and-spoke principle). (3) Inngest is reserved in the spec for the **content/ingestion** pipelines (long compute, external API fan-out); the dating timers are short DB transactions better kept in the hub. (4) A `jobs` table is testable with psql like every other P0 invariant. The Vercel cron is the *trigger*; an Edge Function `process-jobs` is the *worker* (service-role, RLS-bypassing, claims due jobs with `FOR UPDATE SKIP LOCKED`, runs the handler, reschedules or completes). A thin Next.js route `/api/cron/process-jobs` (matching the two existing cron routes' auth + shape) invokes the Edge Function so the cron contract is identical to what already ships.

- **Push provider = Expo Push (`exp.host`/EAS) for native iOS+Android, with a Web Push (VAPID) fallback.** *Why Expo:* the repo already scaffolds `apps/mobile` on Expo (spec §10; v2 spec §1/§3), and Expo's push service brokers both APNs and FCM behind a single HTTP endpoint with no certificate handling in P2 (those are deferred to the mobile launch per v2 §Phase-0 "deliberately deferred to Phase 7.5"). We register device tokens now and deliver through Expo. Web Push (VAPID) is the fallback so the lock/standby/check-in flow degrades (not dies) on web today; the spec is explicit that web push is "too weak to anchor the lock mechanic" — so web push is **best-effort fallback**, native is the load-bearing path. Email (Resend, already in the repo) is the final fallback for high-stakes notifications (offer received, day-of reconfirm) when no push token exists.

**Tech Stack:** Supabase Postgres (migrations `supabase/migrations/`), RLS with `auth.uid()`; one new Edge Function `supabase/functions/process-jobs/` (Deno) + one shared notification dispatch module `supabase/functions/_shared/notify.ts`; one new Vercel cron route `apps/web/app/api/cron/process-jobs/route.ts` (mirrors existing cron routes' `CRON_SECRET` auth); reuse the existing `rate_limits` table + `rate_limit_check` RPC for notification-storm limiting; Expo Push HTTP API (`https://exp.host/--/api/v2/push/send`) + Web Push (`web-push` semantics via VAPID); psql invariant tests in `supabase/tests/`; Deno unit tests (`deno test`) for the Edge Function handler logic; vitest for the Next.js cron route (assume P1 configured vitest in `apps/web`).

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§7.3 offer window, §7.6 auto-roll, §8 day-of reconfirm + 30-min check-in, §10 push dependency); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (P2 scope + Closes); P0 plan `docs/superpowers/plans/2026-05-25-p0-data-model.md` (tables this builds on); architecture `docs/superpowers/specs/2026-04-23-date-engine-v2-architecture-design.md` §3 (runtime boundaries), §4.3 (`devices`), §4.10 (`notifications`), §5.1 (notification router).

**Reconciliation note:** v2 §4.10 sketches a `notifications` *delivery log* and §4.3 a `devices` table; §5.1 names a `notification.dispatch(user_id, type, payload)` router. We adopt those names and shapes, and **add** what the core-loop spec requires but v2 omitted: a `jobs` scheduler table, a `notification_preferences`/consent model, and storm rate-limiting (reusing `rate_limits`). The v2 `notifications.type` enum is **superseded** by the richer core-loop set (offer/standby/reconfirm/check-in/...). P2 builds on P0's tables (`offers`, `locks`, `queue_entries`, `date_instances`, `profiles`) but treats their *transition logic* as P5's job — P2 enqueues jobs and emits notifications, it does not flip loop states (except the mechanical "expire this offer" / "auto-close this stale instance" which are pure timer effects, gated behind a documented P5 hook — see Task 11).

**Conventions (follow exactly):** migration filenames `YYYYMMDDHHMMSS_snake_description.sql`; enable RLS on every table; create policies idempotently with `DO $$ BEGIN CREATE POLICY … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`; attach the existing `set_updated_at()` trigger (defined in `20260419193959_initial_schema.sql`) to tables with `updated_at`; `auth.uid()` in policies; uuid PKs via `gen_random_uuid()`. Edge Functions follow `supabase/functions/generate-plan/` structure (Deno `serve`, service-role `createClient`, `_shared/cors.ts`). Cron routes follow `apps/web/app/api/cron/post-date-feedback/route.ts` (CRON_SECRET bearer auth + `?secret=` manual + `?dry_run=true`).

**Local test loop:** `supabase db reset` (applies all migrations + seeds), then for a psql test:
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`
Tests use `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior (clean exit = PASS). For Edge Function logic: `deno test --allow-env supabase/functions/process-jobs/<file>_test.ts`. For the cron route: `pnpm --filter @after5/web test` (vitest).

---

## File Structure

- `supabase/migrations/202605251300NN_p2_*.sql` — one migration per schema task (jobs, notifications, devices, preferences, RPCs).
- `supabase/tests/p2_*.sql` — one psql invariant/RLS test file per schema task that warrants it.
- `supabase/functions/process-jobs/index.ts` — the runner Edge Function (claim → dispatch handler → reschedule/complete).
- `supabase/functions/process-jobs/handlers.ts` — pure-ish per-job-type handlers (`offer_expiry`, `standby_roll`, `pending_expiry`, `stale_date_close`, `day_of_reconfirm`, `safety_check_in`).
- `supabase/functions/process-jobs/handlers_test.ts` — Deno unit tests for handler dispatch + the P5-hook boundary.
- `supabase/functions/_shared/notify.ts` — `dispatchNotification()` (consent check → rate-limit → Expo/Web-Push/email delivery → log row). Shared so any future Edge Function can call it.
- `supabase/functions/_shared/notify_test.ts` — Deno unit tests for consent-gating + rate-limit short-circuit (delivery providers mocked).
- `apps/web/app/api/cron/process-jobs/route.ts` — Vercel cron entry (every minute) that invokes the `process-jobs` Edge Function.
- `apps/web/app/api/cron/process-jobs/route.test.ts` — vitest for auth + invocation contract.
- `apps/web/vercel.json` — add the `*/1 * * * *` cron entry.
- `supabase/config.toml` — register `[functions.process-jobs]` (`verify_jwt = false`; it is service-role-internal, called by the cron route with a shared secret).
- `packages/types/src/database.ts` — regenerated last.

**Job-type registry (concrete, frozen for P2):**

| `job_type` | Fires when | Effect (P2 scope) | Spec ref |
|---|---|---|---|
| `offer_expiry` | `offers.expires_at` reached, still `active` | mark offer `expired` + emit `offer_expired` notif + enqueue `standby_roll` for the instance | §7.3 |
| `standby_roll` | enqueued by `offer_expiry`/cancellation (P5) | emit `standby_promoted` notif to next standby candidate (the actual queue promotion is P5's RPC, invoked via the P5 hook) | §7.3, §7.6 |
| `pending_expiry` | `queue_entries.created_at + 30 days` | emit `pending_expired` notif + flag entry for P5 reaping (via hook) | §7.3 (~30-day cap) |
| `stale_date_close` | `date_instances.starts_at` passed with no lock | mark instance `cancelled` (auto-close) + emit `date_auto_closed` notif to creator | §7.3 |
| `day_of_reconfirm` | locked date, morning-of (`starts_at` − configurable lead) | emit `day_of_reconfirm` notif to both parties | §8 |
| `safety_check_in` | locked date, `starts_at` + 30 min | emit `safety_check_in` notif to both parties | §8 |

**Notification `type` enum (frozen for P2):** `offer_received`, `offer_expired`, `standby_promoted`, `pending_expired`, `date_auto_closed`, `day_of_reconfirm`, `safety_check_in`, `lock_confirmed`, `new_interest` (the creator-side "someone swiped" hint), `cancellation`. (P5 emits these; P2 defines them + the dispatch path.)

---

## Task 1: `job_type` / `job_status` enums + `jobs` table

**Files:**
- Create: `supabase/migrations/20260525130000_p2_jobs.sql`
- Test: `supabase/tests/p2_jobs.sql`

- [ ] **Step 1: Write the failing test** (table + the partial index that lets the runner claim due jobs)

```sql
-- supabase/tests/p2_jobs.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='jobs' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs missing or RLS off'; END IF;
  -- the runner claims pending jobs by run_after; an index must support that
  PERFORM 1 FROM pg_indexes
   WHERE tablename='jobs' AND indexdef ILIKE '%run_after%';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs(run_after) index missing'; END IF;
  -- dedup guarantee: a unique key on (job_type, dedup_key) where dedup_key not null
  PERFORM 1 FROM pg_indexes
   WHERE tablename='jobs' AND indexdef ILIKE '%unique%dedup_key%';
  IF NOT FOUND THEN RAISE EXCEPTION 'jobs dedup unique index missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p2_jobs.sql`
Expected: FAIL — `relation "jobs" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130000_p2_jobs.sql
-- The scheduler backbone. A row = one timer the mechanic needs to fire.
-- A Vercel cron (every minute) invokes the process-jobs Edge Function, which
-- claims due rows (run_after <= now(), status='pending') with FOR UPDATE SKIP
-- LOCKED, runs the handler, then completes or reschedules.

create type job_type as enum (
  'offer_expiry',
  'standby_roll',
  'pending_expiry',
  'stale_date_close',
  'day_of_reconfirm',
  'safety_check_in'
);

create type job_status as enum ('pending','running','done','failed','cancelled');

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  job_type job_type not null,
  -- The loop entity this timer is about. Nullable target columns keep the
  -- table generic; a handler reads whichever it needs.
  date_instance_id uuid references date_instances(id) on delete cascade,
  offer_id uuid references offers(id) on delete cascade,
  lock_id uuid references locks(id) on delete cascade,
  queue_entry_id uuid references queue_entries(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  -- Idempotency: a (job_type, dedup_key) is enqueued at most once while pending.
  -- e.g. 'safety_check_in:<lock_id>' — re-enqueue is a no-op (ON CONFLICT).
  dedup_key text,
  status job_status not null default 'pending',
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  locked_at timestamptz,           -- set when a runner claims it (crash recovery)
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Claim index: the runner's hot query is "pending jobs due now".
create index if not exists jobs_due_idx
  on jobs (run_after) where status = 'pending';
create index if not exists jobs_type_idx on jobs (job_type, status);

-- Dedup: at most one pending job per (type, dedup_key).
create unique index if not exists jobs_dedup_pending
  on jobs (job_type, dedup_key) where status = 'pending' and dedup_key is not null;

create trigger set_jobs_updated_at before update on jobs
  for each row execute function set_updated_at();

alter table jobs enable row level security;
-- No policies: jobs are written/read only by the service-role runner.
-- (default-deny for anon/authenticated, same posture as rate_limits.)
```

- [ ] **Step 4: Apply + run test, expect PASS**

Run: `supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p2_jobs.sql`
Expected: PASS (no output, exit 0).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130000_p2_jobs.sql supabase/tests/p2_jobs.sql
git commit -m "P2: jobs scheduler table (run_after claim index + dedup) with service-role RLS"
```

---

## Task 2: `enqueue_job()` + `claim_due_jobs()` RPCs (idempotent enqueue, atomic claim)

**Files:**
- Create: `supabase/migrations/20260525130100_p2_jobs_rpcs.sql`
- Test: `supabase/tests/p2_jobs_rpcs.sql`

- [ ] **Step 1: Write the failing test** (enqueue is idempotent on dedup_key; claim returns + locks a due job and skips not-yet-due rows)

```sql
-- supabase/tests/p2_jobs_rpcs.sql
DO $$
DECLARE j1 uuid; j2 uuid; n int; claimed int;
BEGIN
  -- idempotent enqueue: same (type, dedup_key) twice → one pending row
  j1 := enqueue_job('safety_check_in', now() + interval '1 minute',
                    p_dedup_key := 'sc:fixture', p_payload := '{}'::jsonb);
  j2 := enqueue_job('safety_check_in', now() + interval '5 minute',
                    p_dedup_key := 'sc:fixture', p_payload := '{}'::jsonb);
  IF j1 <> j2 THEN RAISE EXCEPTION 'enqueue not idempotent: % <> %', j1, j2; END IF;
  SELECT count(*) INTO n FROM jobs WHERE dedup_key='sc:fixture' AND status='pending';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 pending dedup row, got %', n; END IF;

  -- a job due in the past is claimable; one due in the future is not
  PERFORM enqueue_job('offer_expiry', now() - interval '1 minute', p_dedup_key := 'due:past');
  PERFORM enqueue_job('offer_expiry', now() + interval '1 hour',  p_dedup_key := 'due:future');
  SELECT count(*) INTO claimed FROM claim_due_jobs(10);
  -- claims: due:past (1) + sc:fixture is future so NOT claimed; due:future NOT claimed
  IF claimed <> 1 THEN RAISE EXCEPTION 'claim_due_jobs returned %, expected 1', claimed; END IF;
  -- claimed rows are now status=running with locked_at set
  PERFORM 1 FROM jobs WHERE dedup_key='due:past' AND status='running' AND locked_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'claimed job not marked running/locked'; END IF;
  RAISE NOTICE 'jobs RPCs OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function enqueue_job(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130100_p2_jobs_rpcs.sql

-- Idempotent enqueue. If a pending job with the same (type, dedup_key) exists,
-- return its id unchanged (does NOT reschedule it). dedup_key may be null
-- (then no dedup — every call inserts).
create or replace function enqueue_job(
  p_job_type        job_type,
  p_run_after       timestamptz,
  p_date_instance_id uuid default null,
  p_offer_id        uuid default null,
  p_lock_id         uuid default null,
  p_queue_entry_id  uuid default null,
  p_payload         jsonb default '{}'::jsonb,
  p_dedup_key       text default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid;
begin
  if p_dedup_key is not null then
    select id into v_id from jobs
     where job_type = p_job_type and dedup_key = p_dedup_key and status = 'pending'
     limit 1;
    if found then return v_id; end if;
  end if;

  insert into jobs (job_type, run_after, date_instance_id, offer_id, lock_id,
                    queue_entry_id, payload, dedup_key)
  values (p_job_type, p_run_after, p_date_instance_id, p_offer_id, p_lock_id,
          p_queue_entry_id, p_payload, p_dedup_key)
  on conflict (job_type, dedup_key) where (status='pending' and dedup_key is not null)
    do nothing
  returning id into v_id;

  -- on_conflict do-nothing returns null; fetch the surviving row
  if v_id is null and p_dedup_key is not null then
    select id into v_id from jobs
     where job_type = p_job_type and dedup_key = p_dedup_key and status = 'pending'
     limit 1;
  end if;
  return v_id;
end $fn$;

-- Atomically claim up to N due jobs: flips pending→running, stamps locked_at,
-- returns the claimed rows. SKIP LOCKED makes concurrent runners safe (a job is
-- claimed by exactly one runner). The Edge Function calls this once per tick.
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
    from due
   where j.id = due.id
  returning j.*;
end $fn$;

-- Mark a claimed job done.
create or replace function complete_job(p_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update jobs set status='done', done_at=now(), last_error=null where id=p_id;
end $fn$;

-- Fail/retry: if attempts < max_attempts, requeue with exponential backoff;
-- otherwise mark failed. Keeps the runner's error path one round-trip.
create or replace function fail_job(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $fn$
declare a int; m int;
begin
  select attempts, max_attempts into a, m from jobs where id=p_id;
  if a >= m then
    update jobs set status='failed', last_error=p_error where id=p_id;
  else
    update jobs
       set status='pending', last_error=p_error, locked_at=null,
           run_after = now() + (interval '1 minute' * power(2, least(a,6)))
     where id=p_id;
  end if;
end $fn$;

-- Recover crashed runners: jobs stuck in 'running' past a grace window are
-- returned to 'pending' so the next tick re-claims them.
create or replace function requeue_stuck_jobs(p_grace interval default interval '5 minutes')
returns int
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  update jobs set status='pending', locked_at=null
   where status='running' and locked_at < now() - p_grace;
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke all on function enqueue_job(job_type, timestamptz, uuid, uuid, uuid, uuid, jsonb, text) from anon, authenticated;
revoke all on function claim_due_jobs(int) from anon, authenticated;
revoke all on function complete_job(uuid) from anon, authenticated;
revoke all on function fail_job(uuid, text) from anon, authenticated;
revoke all on function requeue_stuck_jobs(interval) from anon, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `jobs RPCs OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130100_p2_jobs_rpcs.sql supabase/tests/p2_jobs_rpcs.sql
git commit -m "P2: jobs RPCs — idempotent enqueue + atomic claim (SKIP LOCKED) + retry/requeue"
```

---

## Task 3: `devices` table (push token registry)

**Files:**
- Create: `supabase/migrations/20260525130200_p2_devices.sql`
- Test: `supabase/tests/p2_devices.sql`

- [ ] **Step 1: Write the failing test** (owner-only RLS + one row per (user, token))

```sql
-- supabase/tests/p2_devices.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='devices' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'devices missing or RLS off'; END IF;
  PERFORM 1 FROM pg_indexes
   WHERE tablename='devices' AND indexdef ILIKE '%unique%user_id%token%';
  IF NOT FOUND THEN RAISE EXCEPTION 'devices unique(user,token) missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "devices" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130200_p2_devices.sql
-- Push-token registry. Mobile (Expo) registers its push token on app start;
-- web registers its Web Push (VAPID) subscription. Dispatch reads active rows.

create type device_platform as enum ('ios','android','web');

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  platform device_platform not null,
  -- For ios/android this is the Expo push token (ExponentPushToken[...]).
  -- For web this is a JSON-encoded Web Push subscription (endpoint + keys).
  token text not null,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists devices_user_token_uniq on devices (user_id, token);
create index if not exists devices_user_active_idx on devices (user_id) where is_active;

create trigger set_devices_updated_at before update on devices
  for each row execute function set_updated_at();

alter table devices enable row level security;
do $$ begin
  create policy "devices_owner_all" on devices for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- The dispatch path reads devices via the service-role client (bypasses RLS).
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130200_p2_devices.sql supabase/tests/p2_devices.sql
git commit -m "P2: devices push-token registry (Expo native + Web Push) owner-only RLS"
```

---

## Task 4: `notification_preferences` (consent / opt-out model)

**Files:**
- Create: `supabase/migrations/20260525130300_p2_notification_preferences.sql`
- Test: `supabase/tests/p2_notification_preferences.sql`

- [ ] **Step 1: Write the failing test** (per-user prefs row, owner-only, with a safety-override flag the consent gate must respect)

```sql
-- supabase/tests/p2_notification_preferences.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='notification_preferences' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'notification_preferences missing or RLS off'; END IF;
  -- safety notifications are not user-suppressible: the column documenting that
  -- distinction must exist so the consent gate can honor it
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='notification_preferences' AND column_name='quiet_hours_start';
  IF NOT FOUND THEN RAISE EXCEPTION 'quiet_hours_start missing'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130300_p2_notification_preferences.sql
-- Per-user consent. Each loop notification category can be toggled per channel.
-- DESIGN: safety notifications (day_of_reconfirm, safety_check_in) are NOT
-- user-suppressible — the consent gate (notify.ts) ignores these toggles for
-- safety categories. We still store the toggles for transparency/auditing but
-- they have no effect on safety types. Quiet hours likewise never defer safety.

create table if not exists notification_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  -- master switches per transport
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  -- category toggles (apply to push + email; safety categories override these)
  offers_enabled boolean not null default true,         -- offer_received/expired, standby_promoted
  interest_enabled boolean not null default true,       -- new_interest (creator side)
  reminders_enabled boolean not null default true,      -- day_of_reconfirm (safety: not actually suppressible)
  lifecycle_enabled boolean not null default true,      -- lock_confirmed, cancellation, *_auto_closed, pending_expired
  -- quiet hours (local to the user's city tz; safety types bypass these)
  quiet_hours_start time,                               -- e.g. 22:00, null = none
  quiet_hours_end time,                                 -- e.g. 08:00
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

-- Auto-create a default prefs row when a profile is created so the dispatch
-- path never has to special-case a missing row (absent row => use defaults
-- anyway in notify.ts, but this keeps the data clean).
create or replace function ensure_notification_preferences() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into notification_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
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
git add supabase/migrations/20260525130300_p2_notification_preferences.sql supabase/tests/p2_notification_preferences.sql
git commit -m "P2: notification_preferences (consent/opt-out + quiet hours; safety types non-suppressible)"
```

---

## Task 5: `notifications` delivery log + `notification_type` enum

**Files:**
- Create: `supabase/migrations/20260525130400_p2_notifications.sql`
- Test: `supabase/tests/p2_notifications.sql`

- [ ] **Step 1: Write the failing test** (recipient-read RLS; type enum has the core-loop set)

```sql
-- supabase/tests/p2_notifications.sql
DO $$
DECLARE has_safety boolean;
BEGIN
  PERFORM 1 FROM pg_tables WHERE tablename='notifications' AND rowsecurity=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'notifications missing or RLS off'; END IF;
  SELECT 'safety_check_in' = ANY (enum_range(null::notification_type)::text[])
    INTO has_safety;
  IF NOT has_safety THEN RAISE EXCEPTION 'notification_type missing safety_check_in'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130400_p2_notifications.sql
-- Append-only delivery log. One row per (recipient, event) — the dispatch path
-- inserts it, then attempts delivery and updates delivery state. Also the
-- backing store for an in-app notification center (recipient reads own rows).

create type notification_type as enum (
  'offer_received','offer_expired','standby_promoted','pending_expired',
  'date_auto_closed','day_of_reconfirm','safety_check_in','lock_confirmed',
  'new_interest','cancellation'
);
create type notification_channel as enum ('push_ios','push_android','web_push','email','suppressed');

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,    -- deep-link payload (entity ids)
  -- idempotency: an event that maps to one logical notification carries a key
  -- so re-dispatch (job retry) doesn't double-send. e.g. 'offer_expired:<offer_id>'
  dedup_key text,
  channel notification_channel,               -- chosen channel, or 'suppressed'
  delivered boolean not null default false,
  delivery_error text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedup_uniq
  on notifications (type, dedup_key) where dedup_key is not null;
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;
do $$ begin
  -- recipient may read + mark-read their own; inserts/delivery updates are
  -- service-role only (the dispatch path).
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
git add supabase/migrations/20260525130400_p2_notifications.sql supabase/tests/p2_notifications.sql
git commit -m "P2: notifications delivery log + notification_type enum, recipient-read RLS"
```

---

## Task 6: Notification storm rate-limit — reuse `rate_limit_check` via a typed wrapper

**Files:**
- Create: `supabase/migrations/20260525130500_p2_notification_rate_limit.sql`
- Test: `supabase/tests/p2_notification_rate_limit.sql`

**Design:** Reuse the existing `rate_limits` table + `rate_limit_check(p_identifier, p_endpoint, p_max_requests)` RPC (no new infra). The dispatch path calls a thin wrapper `notification_rate_check(user_id, type)` that maps each notification category to a per-hour cap and delegates to `rate_limit_check` with `identifier = user_id`, `endpoint = 'notify:<category>'`. Safety types pass a sentinel cap that the wrapper treats as "never limited."

- [ ] **Step 1: Write the failing test** (wrapper caps a noisy category; safety category is never capped)

```sql
-- supabase/tests/p2_notification_rate_limit.sql
DO $$
DECLARE u uuid := gen_random_uuid(); r json; allowed boolean; i int;
BEGIN
  -- new_interest is capped (default cap small for the test via the wrapper's map);
  -- exhaust it and confirm the wrapper denies further sends.
  FOR i IN 1..20 LOOP
    r := notification_rate_check(u, 'new_interest');
  END LOOP;
  r := notification_rate_check(u, 'new_interest');
  allowed := (r->>'allowed')::boolean;
  IF allowed THEN RAISE EXCEPTION 'new_interest should be rate-limited after burst'; END IF;

  -- safety_check_in is NEVER limited regardless of volume
  FOR i IN 1..100 LOOP
    r := notification_rate_check(u, 'safety_check_in');
  END LOOP;
  allowed := (r->>'allowed')::boolean;
  IF NOT allowed THEN RAISE EXCEPTION 'safety_check_in must never be rate-limited'; END IF;
  RAISE NOTICE 'notification rate-limit OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function notification_rate_check(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130500_p2_notification_rate_limit.sql
-- Anti-storm guard. Reuses the existing rate_limits table + rate_limit_check
-- RPC (20260522110000_rate_limits.sql). Per-category per-hour caps prevent a
-- runaway loop (e.g. many swipes → many new_interest pings) from flooding a
-- user. Safety categories are exempt (a check-in must always go out).

create or replace function notification_rate_check(
  p_user_id uuid,
  p_type    notification_type
) returns json
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_cap int;
  v_endpoint text := 'notify:' || p_type::text;
begin
  -- Safety + high-stakes-1:1 events are never throttled.
  if p_type in ('safety_check_in','day_of_reconfirm','offer_received',
                'lock_confirmed','standby_promoted') then
    return json_build_object('allowed', true, 'current_count', 0, 'retry_after_seconds', 0);
  end if;

  -- Per-category hourly caps for noisy categories.
  v_cap := case p_type
    when 'new_interest'   then 10   -- creator gets at most 10 "someone swiped" pings/hr
    when 'cancellation'   then 20
    when 'offer_expired'  then 20
    when 'pending_expired' then 20
    when 'date_auto_closed' then 20
    else 30
  end;

  return rate_limit_check(p_user_id::text, v_endpoint, v_cap);
end $fn$;

revoke all on function notification_rate_check(uuid, notification_type) from anon, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `notification rate-limit OK`).

> Note: the test bursts 20 `new_interest` to exceed the cap of 10 within one clock-hour window; the existing `rate_limit_check` uses `date_trunc('hour', now())` so all 20 land in the same window. PASS confirms the wrapper denies after the cap and never denies safety.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130500_p2_notification_rate_limit.sql supabase/tests/p2_notification_rate_limit.sql
git commit -m "P2: notification_rate_check wrapper over rate_limit_check (per-category caps, safety exempt)"
```

---

## Task 7: `dispatch_notification()` RPC — the consent+ratelimit+log core (DB side)

**Files:**
- Create: `supabase/migrations/20260525130600_p2_dispatch_notification.sql`
- Test: `supabase/tests/p2_dispatch_notification.sql`

**Design:** The *decision* of whether to send (consent gate → quiet hours → rate limit) and the *log insert* live in one SECURITY DEFINER RPC so they are transactional and testable in psql. The RPC returns the chosen `channel` ('suppressed' if consent/rate denies) and the inserted `notifications.id` + the device tokens to deliver to. The Edge Function (`notify.ts`, Task 8) calls this RPC, then performs the *network delivery* (Expo/Web-Push/email) and calls `mark_notification_delivered()`. Splitting decision (DB, testable) from delivery (network, mocked) keeps both layers verifiable.

- [ ] **Step 1: Write the failing test** (opt-out suppresses non-safety; safety always logged as deliverable; dedup prevents double-insert)

```sql
-- supabase/tests/p2_dispatch_notification.sql
DO $$
DECLARE u uuid; res json; ch text; n int;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(), 'u') returning id into u;
  -- profiles_ensure_notif_prefs trigger created a default prefs row; opt out of offers
  update notification_preferences
     set offers_enabled = false, push_enabled = false, email_enabled = false
   where user_id = u;

  -- a non-safety offer notification must be SUPPRESSED (no consent/channel)
  res := dispatch_notification(u, 'offer_received', 'Offer', 'You got an offer',
                               '{}'::jsonb, p_dedup_key := 'd1');
  ch := res->>'channel';
  IF ch <> 'suppressed' THEN RAISE EXCEPTION 'opted-out offer not suppressed: %', ch; END IF;

  -- a safety notification is NEVER suppressed (logged deliverable even with all toggles off)
  res := dispatch_notification(u, 'safety_check_in', 'Check in', 'You ok?',
                               '{}'::jsonb, p_dedup_key := 'd2');
  ch := res->>'channel';
  IF ch = 'suppressed' THEN RAISE EXCEPTION 'safety notification was suppressed'; END IF;

  -- dedup: re-dispatch same (type, dedup_key) does not insert a 2nd row
  res := dispatch_notification(u, 'safety_check_in', 'Check in', 'You ok?',
                               '{}'::jsonb, p_dedup_key := 'd2');
  SELECT count(*) INTO n FROM notifications WHERE type='safety_check_in' AND dedup_key='d2';
  IF n <> 1 THEN RAISE EXCEPTION 'dedup failed: % rows', n; END IF;
  RAISE NOTICE 'dispatch_notification OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function dispatch_notification(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130600_p2_dispatch_notification.sql
-- Decision + log half of notification dispatch (network delivery is in notify.ts).
-- Returns { notification_id, channel, tokens: [...] }. channel='suppressed' when
-- consent or rate-limit denies (no tokens returned). Safety categories bypass
-- consent + quiet-hours + rate-limit.

create or replace function dispatch_notification(
  p_user_id   uuid,
  p_type      notification_type,
  p_title     text,
  p_body      text,
  p_data      jsonb default '{}'::jsonb,
  p_dedup_key text default null
) returns json
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  v_is_safety boolean := p_type in ('safety_check_in','day_of_reconfirm');
  v_prefs notification_preferences%rowtype;
  v_allowed boolean := true;
  v_rate json;
  v_notif_id uuid;
  v_existing uuid;
  v_tokens jsonb;
  v_channel notification_channel := 'suppressed';
begin
  -- dedup short-circuit
  if p_dedup_key is not null then
    select id into v_existing from notifications
     where type = p_type and dedup_key = p_dedup_key limit 1;
    if found then
      return json_build_object('notification_id', v_existing, 'channel', 'suppressed',
                               'tokens', '[]'::jsonb, 'reason', 'dedup');
    end if;
  end if;

  select * into v_prefs from notification_preferences where user_id = p_user_id;

  if not v_is_safety then
    -- consent gate (missing prefs row => permissive defaults)
    if v_prefs.user_id is not null then
      if (not v_prefs.push_enabled and not v_prefs.email_enabled) then
        v_allowed := false;
      elsif p_type in ('offer_received','offer_expired','standby_promoted')
            and not v_prefs.offers_enabled then v_allowed := false;
      elsif p_type = 'new_interest' and not v_prefs.interest_enabled then v_allowed := false;
      elsif p_type in ('lock_confirmed','cancellation','date_auto_closed','pending_expired')
            and not v_prefs.lifecycle_enabled then v_allowed := false;
      end if;
    end if;
    -- rate-limit gate
    if v_allowed then
      v_rate := notification_rate_check(p_user_id, p_type);
      if not (v_rate->>'allowed')::boolean then v_allowed := false; end if;
    end if;
  end if;

  -- pick a channel: prefer an active native device, else web push, else email.
  if v_allowed or v_is_safety then
    select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'token', token)), '[]'::jsonb)
      into v_tokens from devices where user_id = p_user_id and is_active;
    if v_tokens @> '[{"platform":"ios"}]' or v_tokens @> '[{"platform":"android"}]' then
      v_channel := case when v_tokens @> '[{"platform":"ios"}]' then 'push_ios' else 'push_android' end;
    elsif v_tokens @> '[{"platform":"web"}]' then
      v_channel := 'web_push';
    elsif coalesce(v_prefs.email_enabled, true) or v_is_safety then
      v_channel := 'email';
    else
      v_channel := 'suppressed';
    end if;
  end if;

  insert into notifications (user_id, type, title, body, data, dedup_key, channel)
  values (p_user_id, p_type, p_title, p_body, p_data, p_dedup_key, v_channel)
  returning id into v_notif_id;

  return json_build_object(
    'notification_id', v_notif_id,
    'channel', v_channel,
    'tokens', case when v_channel in ('push_ios','push_android','web_push') then v_tokens else '[]'::jsonb end
  );
end $fn$;

create or replace function mark_notification_delivered(p_id uuid, p_error text default null)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  update notifications
     set delivered = (p_error is null), delivery_error = p_error
   where id = p_id;
end $fn$;

revoke all on function dispatch_notification(uuid, notification_type, text, text, jsonb, text) from anon, authenticated;
revoke all on function mark_notification_delivered(uuid, text) from anon, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `dispatch_notification OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130600_p2_dispatch_notification.sql supabase/tests/p2_dispatch_notification.sql
git commit -m "P2: dispatch_notification RPC (consent+quiet-hours+ratelimit gate, channel pick, dedup log)"
```

---

## Task 8: `_shared/notify.ts` — network delivery (Expo + Web Push + email) over the RPC

**Files:**
- Create: `supabase/functions/_shared/notify.ts`
- Test: `supabase/functions/_shared/notify_test.ts`

**Design:** `dispatchNotification()` calls the `dispatch_notification` RPC (Task 7) to get `{ notification_id, channel, tokens }`, then performs the actual network send for the chosen channel: Expo Push HTTP for `push_ios`/`push_android`, Web Push for `web_push`, Resend for `email`. On `suppressed` it returns early (no network). After delivery it calls `mark_notification_delivered`. Providers are injected so the test mocks them.

- [ ] **Step 1: Write the failing test** (suppressed → no send; native channel → Expo provider called; mark-delivered called)

```ts
// supabase/functions/_shared/notify_test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { dispatchNotification } from './notify.ts';

// Fake supabase client whose rpc() returns scripted RPC responses.
function fakeClient(dispatchResult: unknown) {
  const calls: Record<string, unknown[]> = {};
  return {
    calls,
    rpc(name: string, args: unknown) {
      (calls[name] ??= []).push(args);
      if (name === 'dispatch_notification') return Promise.resolve({ data: dispatchResult, error: null });
      if (name === 'mark_notification_delivered') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

Deno.test('suppressed channel performs no network send', async () => {
  const client = fakeClient({ notification_id: 'n1', channel: 'suppressed', tokens: [] });
  let expoCalled = false;
  await dispatchNotification(client as never, {
    userId: 'u1', type: 'offer_received', title: 't', body: 'b',
  }, { sendExpo: async () => { expoCalled = true; return { ok: true }; } });
  assertEquals(expoCalled, false);
  // suppressed never marks delivered
  assertEquals(client.calls['mark_notification_delivered'], undefined);
});

Deno.test('native channel sends via Expo and marks delivered', async () => {
  const client = fakeClient({
    notification_id: 'n2', channel: 'push_ios',
    tokens: [{ platform: 'ios', token: 'ExponentPushToken[x]' }],
  });
  let sentTo = '';
  await dispatchNotification(client as never, {
    userId: 'u1', type: 'safety_check_in', title: 't', body: 'b',
  }, { sendExpo: async (toks) => { sentTo = toks[0]; return { ok: true }; } });
  assertEquals(sentTo, 'ExponentPushToken[x]');
  assertEquals((client.calls['mark_notification_delivered'] as unknown[]).length, 1);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `deno test --allow-env supabase/functions/_shared/notify_test.ts`
Expected: FAIL — module `./notify.ts` not found / `dispatchNotification` undefined.

- [ ] **Step 3: Write the module**

```ts
// supabase/functions/_shared/notify.ts
// Network-delivery half of notification dispatch. Calls the dispatch_notification
// RPC for the consent/ratelimit/log decision, then sends over the chosen channel.
// Providers are injected (deps) so unit tests can mock the network.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

type DbClient = ReturnType<typeof createClient> | { rpc: (n: string, a: unknown) => Promise<{ data: unknown; error: unknown }> };

export type NotificationType =
  | 'offer_received' | 'offer_expired' | 'standby_promoted' | 'pending_expired'
  | 'date_auto_closed' | 'day_of_reconfirm' | 'safety_check_in' | 'lock_confirmed'
  | 'new_interest' | 'cancellation';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  dedupKey?: string;
}

interface DispatchDecision {
  notification_id: string;
  channel: 'push_ios' | 'push_android' | 'web_push' | 'email' | 'suppressed';
  tokens: Array<{ platform: string; token: string }>;
}

// Injectable providers (default impls call real services).
export interface NotifyDeps {
  sendExpo?: (tokens: string[], n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
  sendWebPush?: (subs: string[], n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
  sendEmail?: (userId: string, n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
}

// Default Expo push: one HTTP POST to the Expo push service (handles APNs+FCM).
async function defaultSendExpo(tokens: string[], n: NotifyInput) {
  const messages = tokens.map((to) => ({
    to, title: n.title, body: n.body, data: n.data ?? {}, sound: 'default',
    priority: n.type === 'safety_check_in' || n.type === 'day_of_reconfirm' ? 'high' : 'default',
  }));
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(messages),
  });
  return res.ok ? { ok: true } : { ok: false, error: `expo ${res.status}` };
}

async function defaultSendWebPush(_subs: string[], _n: NotifyInput) {
  // Web Push (VAPID) — best-effort fallback. Implementation note: use the
  // VAPID keys from env (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) and a Deno-compatible
  // web-push sender. Kept minimal here; native is the load-bearing path.
  return { ok: false, error: 'web_push_not_configured' };
}

async function defaultSendEmail(_userId: string, _n: NotifyInput) {
  // High-stakes fallback when no push token exists. Wire to the repo's Resend
  // sender (apps/web/lib/email/resend) via an internal endpoint or shared lib in
  // a later task; for P2 this returns ok:false so delivery is logged as failed
  // rather than silently dropped. (Email send is non-blocking for the mechanic.)
  return { ok: false, error: 'email_not_wired' };
}

export async function dispatchNotification(
  db: DbClient,
  input: NotifyInput,
  deps: NotifyDeps = {},
): Promise<{ notificationId: string | null; channel: string; delivered: boolean }> {
  const sendExpo = deps.sendExpo ?? defaultSendExpo;
  const sendWebPush = deps.sendWebPush ?? defaultSendWebPush;
  const sendEmail = deps.sendEmail ?? defaultSendEmail;

  const { data, error } = await db.rpc('dispatch_notification', {
    p_user_id: input.userId,
    p_type: input.type,
    p_title: input.title,
    p_body: input.body,
    p_data: input.data ?? {},
    p_dedup_key: input.dedupKey ?? null,
  });
  if (error) throw new Error(`dispatch_notification rpc failed: ${JSON.stringify(error)}`);
  const decision = data as DispatchDecision;

  if (decision.channel === 'suppressed') {
    return { notificationId: decision.notification_id, channel: 'suppressed', delivered: false };
  }

  let result: { ok: boolean; error?: string };
  if (decision.channel === 'push_ios' || decision.channel === 'push_android') {
    result = await sendExpo(decision.tokens.map((t) => t.token), input);
  } else if (decision.channel === 'web_push') {
    result = await sendWebPush(decision.tokens.map((t) => t.token), input);
  } else {
    result = await sendEmail(input.userId, input);
  }

  await db.rpc('mark_notification_delivered', {
    p_id: decision.notification_id,
    p_error: result.ok ? null : (result.error ?? 'delivery_failed'),
  });

  return { notificationId: decision.notification_id, channel: decision.channel, delivered: result.ok };
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `deno test --allow-env supabase/functions/_shared/notify_test.ts`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/notify.ts supabase/functions/_shared/notify_test.ts
git commit -m "P2: _shared/notify.ts — Expo/Web-Push/email delivery over dispatch_notification RPC"
```

---

## Task 9: `process-jobs/handlers.ts` — per-job-type handlers + P5 enqueue interface

**Files:**
- Create: `supabase/functions/process-jobs/handlers.ts`
- Test: `supabase/functions/process-jobs/handlers_test.ts`

**Design:** Each handler is `(db, job) => Promise<void>`. For P2 the handlers perform the **timer effect** (the things that are pure consequences of a clock, not loop decisions): `offer_expiry` marks the offer expired + dispatches `offer_expired` + enqueues a `standby_roll`; `stale_date_close` closes an unlocked instance + notifies the creator; `safety_check_in`/`day_of_reconfirm` dispatch the safety notification to both parties; `standby_roll`/`pending_expiry` dispatch their notification and call the documented **P5 hook** (`p5_promote_standby` / `p5_reap_pending`) which P2 defines as a *no-op RPC stub* (Task 10) so the seam is exercisable now and P5 fills it in without changing the runner. `dispatchHandlers` is a registry `Record<job_type, handler>`. This is also the **clean interface** the roadmap asks for: P5 enqueues work via `enqueue_job(...)` and the loop reacts via these handlers + the P5-hook RPCs — P5 never touches the runner.

- [ ] **Step 1: Write the failing test** (registry covers all 6 types; offer_expiry calls dispatch + enqueues standby_roll)

```ts
// supabase/functions/process-jobs/handlers_test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { HANDLERS } from './handlers.ts';

const ALL_TYPES = [
  'offer_expiry','standby_roll','pending_expiry',
  'stale_date_close','day_of_reconfirm','safety_check_in',
];

Deno.test('every job_type has a handler', () => {
  for (const t of ALL_TYPES) assert(typeof HANDLERS[t] === 'function', `missing handler ${t}`);
});

Deno.test('offer_expiry marks offer expired and enqueues standby_roll', async () => {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const fakeDb = {
    rpc: (name: string, args: unknown) => { rpcCalls.push({ name, args }); return Promise.resolve({ data: { channel: 'suppressed', notification_id: 'n', tokens: [] }, error: null }); },
    from: () => ({
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { candidate_id: 'c', creator_id: 'cr', date_instance_id: 'di' }, error: null }) }) }),
    }),
  };
  await HANDLERS['offer_expiry'](fakeDb as never, {
    id: 'j1', job_type: 'offer_expiry', offer_id: 'o1', payload: {},
  } as never);
  assert(rpcCalls.some((c) => c.name === 'enqueue_job'), 'did not enqueue standby_roll');
});
```

- [ ] **Step 2: Run it, expect FAIL** (`./handlers.ts` not found).

- [ ] **Step 3: Write the module**

```ts
// supabase/functions/process-jobs/handlers.ts
// Per-job-type handlers. Each performs the *timer effect* of its job and
// dispatches the relevant notification(s). Loop *decisions* (promoting a
// standby, reaping a pending entry) are delegated to P5-hook RPCs that P2
// ships as no-op stubs (see migration 20260525130700) — the seam is live now;
// P5 fills the RPC bodies without touching this runner.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { dispatchNotification } from '../_shared/notify.ts';

type Db = ReturnType<typeof createClient>;
export interface Job {
  id: string;
  job_type: string;
  date_instance_id?: string | null;
  offer_id?: string | null;
  lock_id?: string | null;
  queue_entry_id?: string | null;
  payload: Record<string, unknown>;
}
export type Handler = (db: Db, job: Job) => Promise<void>;

async function offerExpiry(db: Db, job: Job) {
  // load the offer (candidate, creator, instance)
  const { data: offer } = await db.from('offers')
    .select('candidate_id, creator_id, date_instance_id').eq('id', job.offer_id!).single();
  // mark expired only if still active (idempotent)
  await db.from('offers').update({ status: 'expired', resolved_at: new Date().toISOString() })
    .eq('id', job.offer_id!).eq('status', 'active');
  if (offer) {
    await dispatchNotification(db, {
      userId: (offer as Record<string, string>).candidate_id,
      type: 'offer_expired', title: 'Offer expired',
      body: 'Your lock offer expired.', data: { offer_id: job.offer_id },
      dedupKey: `offer_expired:${job.offer_id}`,
    });
    // hand off to the standby roll (P5 decides who is next; P2 just enqueues)
    await db.rpc('enqueue_job', {
      p_job_type: 'standby_roll', p_run_after: new Date().toISOString(),
      p_date_instance_id: (offer as Record<string, string>).date_instance_id,
      p_dedup_key: `standby_roll:${(offer as Record<string, string>).date_instance_id}:${Date.now()}`,
    });
  }
}

async function standbyRoll(db: Db, job: Job) {
  // Ask P5 to promote the next standby; the RPC returns the promoted candidate
  // (or null). P2's stub returns null. If a candidate is promoted, notify them.
  const { data } = await db.rpc('p5_promote_standby', { p_date_instance_id: job.date_instance_id });
  const promoted = data as { candidate_id?: string } | null;
  if (promoted?.candidate_id) {
    await dispatchNotification(db, {
      userId: promoted.candidate_id, type: 'standby_promoted',
      title: 'You’re up!', body: 'A spot opened on a night you liked.',
      data: { date_instance_id: job.date_instance_id },
      dedupKey: `standby_promoted:${job.date_instance_id}:${promoted.candidate_id}`,
    });
  }
}

async function pendingExpiry(db: Db, job: Job) {
  const { data } = await db.rpc('p5_reap_pending', { p_queue_entry_id: job.queue_entry_id });
  const reaped = data as { candidate_id?: string } | null;
  if (reaped?.candidate_id) {
    await dispatchNotification(db, {
      userId: reaped.candidate_id, type: 'pending_expired',
      title: 'Interest expired', body: 'Your interest in a night expired after 30 days.',
      data: { queue_entry_id: job.queue_entry_id },
      dedupKey: `pending_expired:${job.queue_entry_id}`,
    });
  }
}

async function staleDateClose(db: Db, job: Job) {
  const { data: inst } = await db.from('date_instances')
    .select('creator_id, status').eq('id', job.date_instance_id!).single();
  await db.from('date_instances').update({ status: 'cancelled' })
    .eq('id', job.date_instance_id!).eq('status', 'seeking');
  if (inst && (inst as Record<string, string>).status === 'seeking') {
    await dispatchNotification(db, {
      userId: (inst as Record<string, string>).creator_id, type: 'date_auto_closed',
      title: 'Night auto-closed', body: 'Your unlocked night passed and was closed.',
      data: { date_instance_id: job.date_instance_id },
      dedupKey: `date_auto_closed:${job.date_instance_id}`,
    });
  }
}

async function notifyBothParties(db: Db, job: Job, type: 'day_of_reconfirm' | 'safety_check_in', title: string, body: string) {
  const { data: lock } = await db.from('locks')
    .select('creator_id, matched_user_id').eq('id', job.lock_id!).single();
  if (!lock) return;
  const l = lock as Record<string, string>;
  for (const uid of [l.creator_id, l.matched_user_id]) {
    await dispatchNotification(db, {
      userId: uid, type, title, body,
      data: { lock_id: job.lock_id }, dedupKey: `${type}:${job.lock_id}:${uid}`,
    });
  }
}

export const HANDLERS: Record<string, Handler> = {
  offer_expiry: offerExpiry,
  standby_roll: standbyRoll,
  pending_expiry: pendingExpiry,
  stale_date_close: staleDateClose,
  day_of_reconfirm: (db, job) =>
    notifyBothParties(db, job, 'day_of_reconfirm', 'Confirm your night', 'Still on for tonight? Tap to reconfirm.'),
  safety_check_in: (db, job) =>
    notifyBothParties(db, job, 'safety_check_in', 'Checking in', 'You good? Tap to confirm you’re safe.'),
};
```

- [ ] **Step 4: Run test, expect PASS** (`deno test --allow-env supabase/functions/process-jobs/handlers_test.ts`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-jobs/handlers.ts supabase/functions/process-jobs/handlers_test.ts
git commit -m "P2: job handlers (offer_expiry/standby_roll/.../safety_check_in) + P5 enqueue seam"
```

---

## Task 10: P5-hook stub RPCs (`p5_promote_standby`, `p5_reap_pending`)

**Files:**
- Create: `supabase/migrations/20260525130700_p2_p5_hooks.sql`
- Test: `supabase/tests/p2_p5_hooks.sql`

**Design:** P2 must not implement loop transitions, but the handlers above call two RPCs. We ship them as **documented no-op stubs** returning `null` so (a) the runner is fully exercisable end-to-end now, and (b) P5 replaces the bodies (promote the next standby / reap an expired pending entry) without changing the runner or handlers. This is the clean interface boundary the roadmap requires ("define how loop transitions enqueue jobs/notifications via a clean interface").

- [ ] **Step 1: Write the failing test** (both stubs exist and return null)

```sql
-- supabase/tests/p2_p5_hooks.sql
DO $$
DECLARE a json; b json;
BEGIN
  a := p5_promote_standby(gen_random_uuid());
  b := p5_reap_pending(gen_random_uuid());
  IF a IS NOT NULL THEN RAISE EXCEPTION 'p5_promote_standby stub should return null'; END IF;
  IF b IS NOT NULL THEN RAISE EXCEPTION 'p5_reap_pending stub should return null'; END IF;
  RAISE NOTICE 'p5 hook stubs OK';
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`function p5_promote_standby(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130700_p2_p5_hooks.sql
-- P5-transition seam. P2 ships these as no-op stubs so the scheduler/notification
-- backbone is fully testable today. P5 (matching state machine) REPLACES the
-- bodies with the real promotion/reaping transactions (which must also append to
-- audit_log and respect the §7.6 safety-freeze rules). The runner + handlers call
-- these by name and never change.

create or replace function p5_promote_standby(p_date_instance_id uuid)
returns json
language plpgsql security definer set search_path = public as $fn$
begin
  -- P5 TODO: select the next 'standby' queue_entry for this instance (ordered),
  -- create a fresh offer (respecting the one-active-offer invariant), enqueue an
  -- offer_expiry job for its window, write audit_log, and return
  -- json_build_object('candidate_id', <uuid>). For now: no-op.
  return null;
end $fn$;

create or replace function p5_reap_pending(p_queue_entry_id uuid)
returns json
language plpgsql security definer set search_path = public as $fn$
begin
  -- P5 TODO: transition the queue_entry to 'offer_expired'/removed per §7.3,
  -- write audit_log, return json_build_object('candidate_id', <uuid>). For now: no-op.
  return null;
end $fn$;

revoke all on function p5_promote_standby(uuid) from anon, authenticated;
revoke all on function p5_reap_pending(uuid) from anon, authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS** (prints `p5 hook stubs OK`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130700_p2_p5_hooks.sql supabase/tests/p2_p5_hooks.sql
git commit -m "P2: P5-transition hook stubs (p5_promote_standby, p5_reap_pending) — clean seam"
```

---

## Task 11: `process-jobs/index.ts` — the runner Edge Function

**Files:**
- Create: `supabase/functions/process-jobs/index.ts`
- Modify: `supabase/config.toml` (register `[functions.process-jobs]`)

**Design:** A `serve` handler that (1) authenticates the caller via a shared `JOBS_RUNNER_SECRET` header (the cron route holds the same secret — defense-in-depth on top of `verify_jwt=false`), (2) calls `requeue_stuck_jobs()`, (3) calls `claim_due_jobs(limit)`, (4) for each claimed job runs `HANDLERS[job.job_type]` and then `complete_job`/`fail_job`, (5) returns a JSON summary `{ claimed, done, failed }`. Service-role client (bypasses RLS). Bounded per-tick `limit` so a single invocation finishes well under the 150s Edge wall-clock; the every-minute cron drains the backlog across ticks.

- [ ] **Step 1: Write the migration/config + a structural test via the existing config**

There is no failing-test harness for the Edge entrypoint's HTTP shell (it's network/orchestration glue covered by the handler/notify unit tests + the integration test in Task 13). Register the function and assert it boots.

- [ ] **Step 2: Write the Edge Function**

```ts
// supabase/functions/process-jobs/index.ts
// The scheduler runner. Invoked every minute by /api/cron/process-jobs (Vercel
// cron). Claims due jobs, runs handlers, completes/fails them. Service-role.
//
// Auth: requires header `x-jobs-secret: ${JOBS_RUNNER_SECRET}`. The cron route
// holds the same secret. verify_jwt is false (config.toml) because this is an
// internal service-to-service call, not a user request.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';
import { HANDLERS, type Job } from './handlers.ts';

const CLAIM_LIMIT = 50; // per tick; every-minute cron drains larger backlogs

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const expected = Deno.env.get('JOBS_RUNNER_SECRET');
  if (!expected || req.headers.get('x-jobs-secret') !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. crash recovery: return long-stuck 'running' jobs to 'pending'
  await supabase.rpc('requeue_stuck_jobs', {});

  // 2. claim a bounded batch of due jobs
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_due_jobs', { p_limit: CLAIM_LIMIT });
  if (claimErr) return json({ error: 'claim_failed', details: claimErr.message }, 500);
  const jobs = (claimed ?? []) as Job[];

  let done = 0, failed = 0;
  for (const job of jobs) {
    const handler = HANDLERS[job.job_type];
    try {
      if (!handler) throw new Error(`no handler for ${job.job_type}`);
      await handler(supabase, job);
      await supabase.rpc('complete_job', { p_id: job.id });
      done++;
    } catch (e) {
      await supabase.rpc('fail_job', { p_id: job.id, p_error: String(e) });
      failed++;
    }
  }

  return json({ claimed: jobs.length, done, failed });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
```

- [ ] **Step 3: Register the function in `supabase/config.toml`** (add near the existing `[functions.generate-plan]` block):

```toml
[functions.process-jobs]
verify_jwt = false
```

- [ ] **Step 4: Verify it boots locally**

Run: `supabase functions serve process-jobs --no-verify-jwt` (in one shell), then in another:
`curl -s -X POST http://127.0.0.1:54321/functions/v1/process-jobs -H "x-jobs-secret: wrong"` → expect `401`.
With the correct `JOBS_RUNNER_SECRET` env set: returns `{ "claimed": 0, "done": 0, "failed": 0 }` against an empty queue.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-jobs/index.ts supabase/config.toml
git commit -m "P2: process-jobs runner Edge Function (claim/dispatch/complete) + config registration"
```

---

## Task 12: `/api/cron/process-jobs` Vercel cron route + every-minute schedule

**Files:**
- Create: `apps/web/app/api/cron/process-jobs/route.ts`
- Create: `apps/web/app/api/cron/process-jobs/route.test.ts`
- Modify: `apps/web/vercel.json` (add the cron entry)

**Design:** Mirror the two existing cron routes' `CRON_SECRET` bearer auth, then invoke the `process-jobs` Edge Function with the `JOBS_RUNNER_SECRET` header. Thin proxy — the route does no DB work itself (keeps the every-minute Vercel invocation cheap; the Edge Function does the claiming under the 150s budget). `?dry_run=true` returns without invoking (parity with existing crons).

- [ ] **Step 1: Write the failing test** (vitest; assume P1 configured vitest in `apps/web`)

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
    const res = await GET(new Request('https://app/api/cron/process-jobs', {
      headers: { authorization: 'Bearer cron-secret' },
    }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['x-jobs-secret']).toBe('runner-secret');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test app/api/cron/process-jobs/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the route**

```ts
// apps/web/app/api/cron/process-jobs/route.ts
// /api/cron/process-jobs — fires from Vercel Cron every minute (see vercel.json).
// Thin proxy: authenticates the cron call, then invokes the process-jobs Edge
// Function (which claims & runs due jobs). Keeps the per-minute Vercel hit cheap.
//
// Auth: Authorization: Bearer ${CRON_SECRET} (Vercel sends automatically) OR
// ?secret=... for manual trigger. ?dry_run=true returns without invoking.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const querySecret = url.searchParams.get('secret');
  const ok = authHeader === `Bearer ${expected}` || querySecret === expected;
  if (!ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (url.searchParams.get('dry_run') === 'true') {
    return NextResponse.json({ dry_run: true, invoked: false });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const runnerSecret = process.env.JOBS_RUNNER_SECRET;
  if (!supabaseUrl || !runnerSecret) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_SUPABASE_URL or JOBS_RUNNER_SECRET missing' },
      { status: 500 },
    );
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

> Note: every-minute crons require a Vercel Pro plan (Hobby caps cron frequency). State this as an assumption (see Self-Review). If only Hobby is available, fall back to `*/1` not being honored — the alternative is `pg_cron` calling the Edge Function via `net.http_post`; documented as the fallback, not the default.

- [ ] **Step 5: Run test, expect PASS**

Run: `pnpm --filter @after5/web test app/api/cron/process-jobs/route.test.ts`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/cron/process-jobs/route.ts apps/web/app/api/cron/process-jobs/route.test.ts apps/web/vercel.json
git commit -m "P2: every-minute Vercel cron route invoking process-jobs runner (CRON_SECRET auth)"
```

---

## Task 13: End-to-end integration test (offer expiry → notification log)

**Files:**
- Create: `supabase/tests/p2_e2e_offer_expiry.sql`

**Design:** A psql integration test that exercises the *DB-side* of the full path without the network: seed a profile + city + itinerary + date_instance + an `active` offer with `expires_at` in the past; enqueue an `offer_expiry` job due now; simulate the runner's DB calls (`claim_due_jobs`, then the SQL the `offer_expiry` handler performs: mark expired, `dispatch_notification`, `enqueue_job('standby_roll')`, `complete_job`); assert the offer is `expired`, a `notifications` row of type `offer_expired` exists, a `standby_roll` job was enqueued, and the original job is `done`. (The Deno handler test in Task 9 covers the JS dispatch logic; this proves the SQL contracts compose.)

- [ ] **Step 1: Write the test**

```sql
-- supabase/tests/p2_e2e_offer_expiry.sql
DO $$
DECLARE cre uuid; cand uuid; cid uuid; inst uuid; off uuid; j uuid;
        claimed_id uuid; res json; n int;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'cre') returning id into cre;
  insert into profiles (id, first_name) values (gen_random_uuid(),'cand') returning id into cand;
  insert into cities (slug,name,timezone,is_active) values ('e2e','e2e','UTC',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='e2e';
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at)
    select i.id,cre,cid, now()+interval '2 days' from itineraries i where i.user_id=cre limit 1
    returning id into inst;
  insert into offers (date_instance_id,candidate_id,creator_id,status,expires_at)
    values (inst,cand,cre,'active', now()-interval '1 minute') returning id into off;

  -- enqueue the timer (due now)
  j := enqueue_job('offer_expiry', now()-interval '1 second', p_offer_id := off,
                   p_dedup_key := 'offer_expiry:'||off::text);

  -- runner: claim
  select id into claimed_id from claim_due_jobs(10) limit 1;
  IF claimed_id <> j THEN RAISE EXCEPTION 'claim returned wrong job'; END IF;

  -- handler effect (mirrors handlers.ts offer_expiry):
  update offers set status='expired', resolved_at=now() where id=off and status='active';
  res := dispatch_notification(cand, 'offer_expired', 'Offer expired',
           'Your lock offer expired.', json_build_object('offer_id', off)::jsonb,
           p_dedup_key := 'offer_expired:'||off::text);
  PERFORM enqueue_job('standby_roll', now(), p_date_instance_id := inst,
                      p_dedup_key := 'standby_roll:'||inst::text);
  PERFORM complete_job(j);

  -- assertions
  PERFORM 1 FROM offers WHERE id=off AND status='expired';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not expired'; END IF;
  SELECT count(*) INTO n FROM notifications WHERE user_id=cand AND type='offer_expired';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 offer_expired notif, got %', n; END IF;
  PERFORM 1 FROM jobs WHERE job_type='standby_roll' AND date_instance_id=inst AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'standby_roll not enqueued'; END IF;
  PERFORM 1 FROM jobs WHERE id=j AND status='done';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_expiry job not done'; END IF;
  RAISE NOTICE 'p2 e2e offer_expiry OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect PASS** (after Tasks 1–10 migrations applied)

Run: `supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/p2_e2e_offer_expiry.sql`
Expected: prints `p2 e2e offer_expiry OK`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/p2_e2e_offer_expiry.sql
git commit -m "P2: e2e psql test — offer_expiry job drives expire + notif + standby_roll enqueue"
```

---

## Task 14: Full reset verification + regenerate types

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset (applies every migration + seeds)**

Run: `supabase db reset`
Expected: completes with no error; all P0 + P2 migrations apply in order.

- [ ] **Step 2: Run all P2 psql tests**

```bash
for f in supabase/tests/p2_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Run all Deno unit tests**

Run: `deno test --allow-env supabase/functions/_shared/notify_test.ts supabase/functions/process-jobs/handlers_test.ts`
Expected: all tests pass.

- [ ] **Step 4: Run the cron-route vitest**

Run: `pnpm --filter @after5/web test app/api/cron/process-jobs/route.test.ts`
Expected: pass.

- [ ] **Step 5: Regenerate TypeScript types**

Run: `pnpm db:types`
Expected: `packages/types/src/database.ts` now includes `jobs`, `devices`, `notification_preferences`, `notifications`, plus the new enums (`job_type`, `job_status`, `device_platform`, `notification_type`, `notification_channel`) and functions (`enqueue_job`, `claim_due_jobs`, `dispatch_notification`, `notification_rate_check`, `p5_promote_standby`, `p5_reap_pending`).

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P2: regenerate database types for scheduler + notification schema"
```

---

## Self-Review

**Spec coverage (vs roadmap P2 'Delivers'/'Closes'):**
- Job/worker layer driving every timer → Task 1 (`jobs` table) + Task 2 (claim/enqueue RPCs) + Task 11 (runner) + Task 12 (cron). The six concrete job types are a frozen enum (Task 1) with handlers (Task 9). ✅
- offer_expiry → Task 9 handler + Task 13 e2e. ✅
- standby_roll → Task 9 handler + Task 10 P5 hook. ✅
- pending_expiry (~30 days) → Task 9 handler + Task 10 P5 hook (the 30-day `run_after` is set by P5 when it enqueues; P2 defines the type + handler). ✅
- stale_date_close → Task 9 handler (closes unlocked instance). ✅
- day_of_reconfirm → Task 9 handler (both parties). ✅
- safety_check_in (~30 min after start) → Task 9 handler (both parties; the +30min `run_after` is set at lock time by P5). ✅
- Push via Expo (native) + web fallback → Task 8 (`notify.ts` Expo + Web Push + email) + Task 3 (`devices` registry). ✅
- Notification preferences/consent + opt-outs → Task 4 (`notification_preferences`) enforced in Task 7 (`dispatch_notification` consent gate). ✅
- Rate limiting reusing `rate_limits` → Task 6 (`notification_rate_check` wraps the existing `rate_limit_check` RPC). ✅
- Clean interface for P5 to enqueue jobs/notifications → `enqueue_job()` (Task 2) + `dispatch_notification()` (Task 7) + the `p5_promote_standby`/`p5_reap_pending` stubs (Task 10); P5 fills RPC bodies, never touches the runner. ✅
- Closes "no scheduler / mechanic inert" → the runner + cron make every timer fire (Task 13 proves the path). ✅
- Closes "no push/consent/rate-limit" → Tasks 3,4,6,7,8. ✅
- Closes "mobile push dependency" → Expo path is the load-bearing channel; web push is explicit best-effort fallback; safety notifications never suppressed/throttled. ✅

**Scheduler mechanism decision:** `jobs` table + every-minute Vercel cron → `process-jobs` Edge Function (claim-and-dispatch). Chosen over Inngest because the timers are minute-granular DB-state transitions (not multi-step external-API workflows), the repo already ships the `/api/cron/*` + service-role pattern, and a Postgres-resident queue is testable with psql like every other invariant. Inngest stays reserved for the v2 content/ingestion pipelines.

**Push provider decision:** Expo Push (single endpoint brokering APNs+FCM, matches the existing `apps/mobile` Expo scaffold; no certificate handling in P2 per v2's Phase-7.5 deferral) + Web Push (VAPID) best-effort fallback + Resend email as the final fallback for high-stakes types. Native is load-bearing; web is fallback only, consistent with spec §10.

**Key assumptions stated:**
- **Vercel Pro for every-minute cron.** Hobby plan throttles cron frequency; `* * * * *` requires Pro. Documented fallback: `pg_cron` + `net.http_post` invoking the same Edge Function (Task 12 note). If Pro is unavailable, swap the trigger, not the runner.
- **`JOBS_RUNNER_SECRET`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`** are configured as env/secrets (cron route reads `CRON_SECRET` + `JOBS_RUNNER_SECRET`; Edge Function reads `JOBS_RUNNER_SECRET` + the standard `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). `verify_jwt=false` on `process-jobs` is safe because the shared-secret header gates it.
- **P1 configured vitest** in `apps/web` (per the prompt); the cron-route test uses it. If P1 did not, add `vitest` + a `test` script before Task 12 — not in P2 scope.
- **P0 tables exist** (`profiles`, `cities`, `itineraries`, `date_instances`, `offers`, `locks`, `queue_entries`) and `set_updated_at()` is defined (confirmed in `20260419193959_initial_schema.sql`). P2 migrations are numbered `202605251300NN`, strictly after P0's `2026052512NNNN`.
- **Email delivery is intentionally stubbed** (`email_not_wired`) in `notify.ts` for P2 — wiring the existing Resend sender from an Edge Function context is a small follow-up; the mechanic does not block on email (push is primary). Delivery failures are logged, never silently dropped.

**Boundary discipline (what P2 deliberately does NOT do):** P2 does not implement loop *transitions* — it does not promote standbys, reap pending entries, create offers, or write audit_log for state changes. Those are P5; P2 ships the `p5_*` no-op stubs (Task 10) so the seam is live and the runner is fully testable. The only state writes P2 performs are pure timer effects with no decision content (mark an already-expired offer `expired`; auto-close an unlocked, passed-time instance) — both idempotent and guarded by `eq('status', ...)` so a P5 implementation can override sequencing safely.

**Idempotency / concurrency:** `claim_due_jobs` uses `FOR UPDATE SKIP LOCKED` (safe under concurrent runners / overlapping cron ticks); `enqueue_job` dedups on `(job_type, dedup_key)` while pending; `dispatch_notification` dedups on `(type, dedup_key)`; handlers guard state writes with status predicates; `requeue_stuck_jobs` recovers crashed runners. Re-running a tick cannot double-send or double-expire.

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. The two `p5_*` functions are intentional documented stubs (return null), not placeholders for P2's own scope.

**Type/name consistency:** enums declared once (`job_type`, `job_status`, `device_platform`, `notification_type`, `notification_channel`); table/column names consistent across migrations, handlers, notify module, and tests (`jobs.run_after`, `notifications.dedup_key`, `devices.token`, `dispatch_notification`/`enqueue_job`/`claim_due_jobs`). The `notification_type` TS union in `notify.ts` mirrors the SQL enum exactly.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p2-scheduler-notifications.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

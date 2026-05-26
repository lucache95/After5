SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P5 — Matching State Machine (The Core Loop) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is the most complex phase in the roadmap — do not skip the FAIL step, and do not collapse two tasks into one commit. Every transition is a tested DB function; invariants live in the database, never in app code.

> **Stage mapping:** P5 = stage **S6 (Matching loop)** in `RECONCILED-MASTER-PLAN.md` §8. **Depends on: S1** (schema spine: tables/enums/invariants/`_fixtures.sql`), **S2** (jobs/notify/`feature_config`+`offer_expires_at()`/`analytics_events`/`admin_alerts`/`can_enter_lock_flow`/chat-core primitives), **S5** (swipes + seed/concierge nights). This file owns **only** the C2 `match_*` transition API and its supporting P5-band objects; it consumes everything else by canonical reference.

**Goal:** Implement the experience-first dating core loop (spec §6, §7) as a set of **race-safe, idempotent, audited state-transition functions in Postgres** — shortlist/rank, make offer, accept→lock, pass/expire→auto-roll, reciprocal-pair chooser, reason-coded cancel→safe-roll, swiper-reveal consent, and a bucketed presence-backed demand hint — each proven by psql concurrency/invariant tests and exposed to clients through thin Deno Edge Functions tested with `Deno.test`. The exposed API names/signatures are frozen by **INTEGRATION-CONTRACT.md §C2 + §C11.4** — see "C2 API surface" below; this plan may not rename or re-shape them.

**Architecture:** Every transition is a **`SECURITY DEFINER` plpgsql function** that runs inside one transaction, takes a `pg_advisory_xact_lock` on the contended resource (the date instance, or a canonical user-pair) **before** reading state, enforces the spec invariants, appends to `audit_log`, **emits its transition event into `analytics_events` (C11.8)**, and enqueues async work through the **S2 `enqueue_job()`/`cancel_jobs()`/`dispatch_notification()` interface (C1)** — P5 does **not** define its own job/notify primitives. The functions bypass RLS by design (SECURITY DEFINER) but **re-check authorization internally**: per **C10**, every RPC asserts `p_actor = auth.uid()` (RPC raises otherwise) and internal helpers `revoke execute from public, authenticated`. The Edge Function sets `p_actor` from the verified JWT — never trusting client input. Edge Functions are a thin transport layer: verify JWT → call the RPC with `p_actor = jwt.sub` and an `Idempotency-Key` → map SQL exceptions to HTTP. No business logic in TypeScript.

**C2 API surface (frozen by INTEGRATION-CONTRACT.md §C2 + §C11.4 — canonical reference, do not redefine here).** These are the **only** names callers may use. P5 implements exactly:

| Function | Signature | Notes |
|---|---|---|
| `match_shortlist` | `match_shortlist(p_actor uuid, p_instance uuid, p_candidate uuid, p_rank int)` | creator only; carries rank in one call |
| `match_make_offer` | `match_make_offer(p_actor uuid, p_instance uuid, p_candidate uuid, p_idem_key text) returns uuid` | `expires_at := offer_expires_at()` (C11.1); `enqueue_job('offer_expiry', expires_at, …, dedup=offer_id)`; `open_chat_thread(offer_id)` (C11.7); checks `can_enter_lock_flow(candidate)` (C3) |
| `match_accept_offer` | `match_accept_offer(p_actor uuid, p_offer uuid, p_idem_key text) returns uuid` | requires `chat_lock_ready(thread)` **and** `can_enter_lock_flow(actor)`; advisory lock; `cancel_jobs('offer_expiry', offer_id)`; `promote_chat_thread_to_lock(offer, lock)` |
| `match_pass_offer` | `match_pass_offer(p_actor uuid, p_offer uuid)` | → `match_auto_roll`; `close_chat_thread(offer)` |
| `match_expire_offer` | `match_expire_offer(p_offer uuid)` | idempotent; no-ops if resolved; → `match_auto_roll`; `close_chat_thread(offer)` |
| `match_auto_roll` | `match_auto_roll(p_instance uuid)` | enqueues discrete `standby_roll` jobs (throttled); never synchronously cascades |
| `match_next_standby` | `match_next_standby(p_instance uuid) returns uuid` | lowest-rank shortlisted = standby order (single source) |
| `match_withdraw` | `match_withdraw(p_actor uuid, p_instance uuid)` | **C2/C11.4** — replaces fictional `withdraw_from_queue`; S10/users call this |
| `match_cancel_lock` | `match_cancel_lock(p_actor uuid, p_lock uuid, p_reason cancel_reason, p_idem_key text)` | benign reasons roll; safety/misconduct freeze |
| `match_reveal_allowed` | `match_reveal_allowed(p_viewer uuid, p_instance uuid) returns bool` | the only reveal predicate (S3 drops `offer_reveal`) |
| `match_demand_hint` | `match_demand_hint(p_instance uuid) returns text` | the only demand hint (S12/P11 deletes its duplicate) |
| `match_resolve_reciprocal` | `match_resolve_reciprocal(p_actor uuid, p_pair_id uuid, p_chosen_instance uuid)` | **C11.4** — creator-facing chooser resolution |

> **Parameter naming:** the contract uses `p_offer`/`p_pair_id`/`p_instance`. Where this plan's task bodies historically wrote `p_offer_id`/`p_pair`, the **contract names win** — implement with the C2 names. An `p_idem_key text` parameter on `match_resolve_reciprocal` is an additive implementation detail (idempotency ledger); the public signature in the contract is the minimum surface — keep idempotency internal/optional and do not require callers to know about it beyond what C2 states.

**Internal helpers (NOT in C2; `revoke execute from public, authenticated` per C10):** `match_ingest_interest`, `_match_make_offer` / `_match_accept_offer` (auth-skipping service siblings used by auto-roll/reciprocal/job-runner), `match_resolve_offer_negative`, `match_autoclose_creator_conflicts`, `match_autowithdraw_user_conflicts`, `match_detect_reciprocal`, `match_reconfirm`, `match_instance_lock_key`, `match_pair_lock_key`, `match_idem_lookup`, `match_idem_store`. These are service-role/definer-internal only. (`match_set_rank` and `match_shortlist_with_reciprocal` are **REMOVED** — folded into `match_shortlist`.)

**Cross-stage hooks consumed (canonical refs — defined elsewhere, never recreated here):**
- **S2 / C1 / C11:** `enqueue_job(p_type job_type, p_run_after timestamptz, p_payload jsonb, p_dedup_key text)`, `cancel_jobs(p_type job_type, p_dedup_key text)`, `dispatch_notification(p_user uuid, p_type notification_type, p_payload jsonb)`.
- **S2 / C11.1:** `offer_expires_at(p_from timestamptz default now()) returns timestamptz` reading `feature_config.offer_window_hours` — **no hardcoded 24h anywhere in P5.**
- **S2 / C3:** `can_enter_lock_flow(p_user uuid) returns bool`.
- **S2 / C11.7 (chat-core, band `124500`):** `open_chat_thread(p_offer uuid)`, `chat_lock_ready(p_thread uuid) returns bool`, `promote_chat_thread_to_lock(p_offer uuid, p_lock uuid)`, `close_chat_thread(p_offer uuid)`.
- **S2 / C11.8:** `analytics_events` outbox table (P5 inserts directly).
- **S5:** writes `swipes` and defines seed/concierge nights; P5 reads right-swipes to seed interest and honors seed-night acceptance (MD9).

**The two hard invariants P0 already enforces structurally (we build on, never duplicate, them):**
1. **One `active` offer per date instance** — P0 partial unique index `offers_one_active_per_instance`. `make_offer` relies on it as a backstop; the advisory lock makes the violation impossible in the first place.
2. **No user double-booked across overlapping windows** — P0 GiST exclusion on `lock_participants` (`exclude using gist (user_id with =, time_range with &&) where (active)`), kept in sync by the P0 `sync_lock_participants` trigger. `accept_offer` relies on it; a concurrent second accept that would double-book a user fails with `exclusion_violation`, which we catch and translate.

**Tech Stack:** Supabase Postgres (plpgsql, `SECURITY DEFINER`, `pg_advisory_xact_lock`, `FOR UPDATE`/`FOR NO KEY UPDATE`, savepoints), psql-based concurrency + invariant tests (`supabase/tests/p5_*.sql`, plus two-session race tests via background `psql` jobs), Deno Edge Functions (`supabase/functions/match-*`) with `Deno.test`, the **S2 `jobs` table + `enqueue_job()`/`cancel_jobs()` helpers and `dispatch_notification()` (C1)** — consumed by canonical reference, never redefined here (see "Dependencies & assumed interfaces"). All test fixtures use the S1 `_fixtures.sql` `mk_user`/`mk_itinerary`/`mk_instance` factory (C8) — P5 defines no fixture factory of its own.

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§6 shortlist/rank, §7.1 states, §7.2 reveal-on-offer-only + demand hint, §7.3 offer/standby, §7.4 double-booking, §7.5 reciprocal, §7.6 cancel/safe-roll); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (P5 scope + Closes); foundation `docs/superpowers/plans/2026-05-25-p0-data-model.md` (tables/enums/invariants this plan consumes).

---

## Dependencies & assumed interfaces

This phase **Depends on: S1, S2, S5** (per `RECONCILED-MASTER-PLAN.md` §8). All of S1's schema spine and S2's async/notify/config/chat-core spine must be applied before any P5 migration. **P5 fabricates no shared infrastructure** — every job/notify/config/chat/gate object below is owned and built upstream and consumed here by canonical reference. (The old "Depends on: P0/P2/P4" framing is **SUPERSEDED** by the S-stage map.)

**From S2 (async/config/notify/chat-core spine) — consumed by canonical reference (C1, C11.1, C11.7, C11.8, C3):**
- **Jobs (C1):** the single `jobs` table + `job_type`/`job_status` enums + `enqueue_job(p_type job_type, p_run_after timestamptz, p_payload jsonb default '{}', p_dedup_key text default null) returns uuid` and `cancel_jobs(p_type job_type, p_dedup_key text) returns int`. P5 calls these with the **C1 enum job types only** (`offer_expiry`, `standby_roll`, `reconfirm_timeout`, `bulk_withdraw` — all present in the C1 `job_type` enum). P5 never invents a `job_type` value; if a needed value is absent from C1, that is a **contract amendment to raise against S2**, not a local enum.
- **Notifications (C1):** `dispatch_notification(p_user uuid, p_type notification_type, p_payload jsonb)`. P5 emits only `notification_type` values present in the C1 enum (`offer_received`, `offer_expiring`, `standby_promoted`, `date_reconfirm`, `new_match`, `account`, …). Where P5 historically used ad-hoc strings (`'locked'`, `'candidate_withdrawn'`, `'reciprocal_detected'`, `'lock_cancelled_frozen'`, `'offer_passed'`), map each to a C1 enum value (e.g. lock-confirmed → `new_match`; reconfirm → `date_reconfirm`); any genuinely-missing type is a **contract amendment to raise against C1**, never a local string.
- **Config + expiry (C11.1):** `feature_config` table + `offer_expires_at()`. `match_make_offer` sets `expires_at := offer_expires_at()`. **No hardcoded 24h, no `p_window_hours` param.**
- **Gate (C3):** `can_enter_lock_flow(p_user uuid) returns bool` — true iff `account_state='active'` AND `standing NOT IN ('cooldown','locked_ban','suspended')` AND not `rollover_frozen`. `match_make_offer` checks the **candidate**; `match_accept_offer` checks the **actor**.
- **Chat-core (C11.7, band `124500`):** `open_chat_thread(p_offer)`, `chat_lock_ready(p_thread) returns bool`, `promote_chat_thread_to_lock(p_offer, p_lock)`, `close_chat_thread(p_offer)`. P5's `match_make_offer` opens the thread; `match_accept_offer` requires `chat_lock_ready` then promotes; `match_pass_offer`/`match_expire_offer` close it.
- **Analytics (C11.8):** `analytics_events` append-only outbox (created in S2/P2 band `123900`). P5 **inserts** a transition event for every transition (C11.8); the relay handler is P11/S12 and is out of P5 scope.

**From S5 (browse & interest) — consumed by canonical reference:**
- `swipes` rows are written by S5's swipe action: `(swiper_id, date_instance_id, creator_id, direction)`. P5 **reads** right-swipes to seed `queue_entries` (`status='interested'`) via `match_ingest_interest`. S5 owns the compatibility pre-filter; P5 does **not** re-implement filtering, and S5 (not P5) is responsible for invoking `match_ingest_interest` post-swipe (named cross-stage hook).
- A swipe-right is the trigger for the **consent disclosure** in Task 2. S5 surfaces the consent copy; P5 enforces that the creator can only read swiper profiles for right-swipes on their own instances (S1 RLS) and records the disclosure event.
- **Seed/concierge nights (MD9):** S5 defines cold-start concierge ("we'll line you up") seed instances and the seed swipe/acceptance path. P5 **honors** seed-night acceptance — see Task 5 "Seed-night acceptance handling" — but does **not** define the seed-night source data.

**From S1 (schema spine) — consumed directly:** `cities`, `profiles` (+ `standing`, `account_state` columns — C3), `profiles_private`, `date_instances` (+ generated `time_range`, `moderation_status`), `swipes`, `queue_entries` (status enum incl. `interested|shortlisted|offer_active|offer_passed|offer_expired|standby|locked`), `offers` (+ `offers_one_active_per_instance`), `locks` + `lock_participants` (+ GiST exclusion + `sync_lock_participants` trigger), `match_ratings`, `reports`/`disputes` (C5/C11.6), `blocks`, `audit_log` (+ `log_status_transition` triggers). **`cancel_reason` enum is the C2 shape: `('schedule_conflict','venue_issue','changed_mind','account_closed','safety','misconduct','other')` — `account_closed` is BENIGN (auto-roll). P5 does not define `cancel_reason`; S1 owns it.** P5 **adds only its own P5-band objects** (idempotency ledger, presence-heartbeat reads, reciprocal-pair tracking, reconfirmation tracking, standby-freeze column) — see File Structure. **`browse_feed` is NOT a P5 object** — it is finalized once at band `133000` (S12/C11.3); P5 only reads base tables.

> **Lifecycle columns are RPC-only (C7).** `queue_entries.status` and `locks.status` are not directly writable by RLS — only via the C2 RPCs in this plan. P5 must not add a policy granting direct lifecycle writes.

**Migration timestamps (C6 / C11 band map):** P5 owns the band **`126000`–`1269xx`** on 2026-05-25. (The old `13xxxx` band is **SUPERSEDED** — it collided with P1/P2/P7/P8/P9.) Every P5 migration filename is `20260525126NNN_p5_*.sql`. Migrations sort within the band by dependency.

**Convention reminders (follow exactly):** migration filenames `YYYYMMDDHHMMSS_snake_description.sql`; enable RLS on every new table; idempotent policies via `do $$ begin create policy … exception when duplicate_object then null; end $$;`; attach `set_updated_at()` to tables with `updated_at`; uuid PKs via `gen_random_uuid()`. SECURITY DEFINER functions **must** set `search_path = public`, **assert `p_actor = auth.uid()`** for every public RPC (C10), and be `revoke execute ... from public, authenticated; grant execute ... to service_role` for internal helpers / `grant execute ... to authenticated, service_role` for the C2 public RPCs.

**Local test loop:** `supabase db reset` (applies S1 + S2 + S5 + P5 cumulatively) then
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`.
Tests `\i supabase/tests/_fixtures.sql` first (C8) and build seed data via `mk_user`/`mk_itinerary`/`mk_instance`. Single-session tests use `DO $$ … END $$;` blocks that `RAISE EXCEPTION` on wrong behavior (clean exit = PASS). **Concurrency tests** use a helper that opens two real psql sessions (the `DO`-block approach can't model two transactions) — see Task 0.

**Edge Function test loop:** `supabase functions serve` is not needed for unit tests; transition logic is pure SQL. Edge Functions are tested with `deno test --allow-env --allow-net supabase/functions/match-*/**/*.test.ts` against a running local stack (`supabase start`).

---

## File Structure

```
supabase/migrations/        (P5 band 126xxx — C6/C11; no jobs/enqueue/notify objects, those are S2)
  20260525126000_p5_lock_keys.sql            # Task 0  match_instance_lock_key/match_pair_lock_key + temp_race (test helper) ONLY
  20260525126100_p5_idempotency.sql          # Task 1  transition_idempotency ledger + helpers (internal, revoke authenticated)
  20260525126200_p5_shortlist.sql            # Task 2  queue_entries.offer_frozen_rank + swiper-disclosure + match_shortlist(…,p_rank) + match_next_standby + match_ingest_interest
  20260525126300_p5_make_offer.sql           # Task 4  match_make_offer() (offer_expires_at + open_chat_thread + can_enter_lock_flow) + match_reveal_allowed
  20260525126400_p5_demand_presence.sql      # Task 3  presence reads + match_demand_hint() (capped, trusted-only)
  20260525126500_p5_accept_lock.sql          # Task 5  match_accept_offer() → lock (chat_lock_ready + can_enter_lock_flow + promote + advisory + exclusion + off-market + cascade) + seed-night handling
  20260525126600_p5_pass_expire_roll.sql     # Task 6  match_pass_offer(), match_expire_offer(), match_auto_roll() (standby_roll jobs), match_withdraw()
  20260525126700_p5_reciprocal.sql           # Task 7  reciprocal-pair detection + match_resolve_reciprocal() chooser
  20260525126800_p5_cancel_safe_roll.sql     # Task 8  match_cancel_lock(reason) → safe auto-roll (account_closed benign), reconfirm, freeze + creator-cancel-pre-lock (MD10)
  20260525126900_p5_grants.sql               # Task 9  centralized revoke/grant: C2 RPCs → authenticated+service; internal helpers → service_role only

supabase/tests/
  _fixtures.sql                              # OWNED BY S1 (C8). P5 \i's it; never edits it.
  p5_lock_keys.sql                           # Task 0  asserts lock-key helpers exist + order-independence
  p5_concurrency_lib.sh                      # Task 0  two-session race harness (background psql jobs)
  p5_shortlist_rank.sql                      # Task 2
  p5_swiper_disclosure.sql                   # Task 2
  p5_demand_hint.sql                         # Task 3
  p5_make_offer.sql                          # Task 4
  p5_reveal_scope.sql                        # Task 4
  p5_accept_lock.sql                         # Task 5
  p5_accept_idempotent.sql                   # Task 5
  p5_seed_night_accept.sql                   # Task 5  (MD9: seed/concierge night acceptance)
  p5_helper_grants.sql                       # Task 9  (negative test: authenticated CANNOT call internal helpers)
  p5_race_two_accepts.sh                     # Task 5  (concurrency: two simultaneous accepts)
  p5_race_expiry_vs_accept.sh                # Task 6  (concurrency: offer-expiry vs accept)
  p5_pass_roll.sql                           # Task 6
  p5_cascade_throttle.sql                    # Task 6
  p5_withdraw.sql                            # Task 6  (match_withdraw)
  p5_reciprocal.sql                          # Task 7
  p5_cancel_safe_roll.sql                    # Task 8
  p5_cancel_freeze.sql                       # Task 8
  p5_creator_cancel_pre_lock.sql             # Task 8  (MD10)

supabase/functions/
  _shared/match.ts                           # Task 10 verifyJwt(), callRpc(), idempotency + error→HTTP mapping
  match-shortlist/index.ts        + .test.ts # Task 10
  match-make-offer/index.ts       + .test.ts # Task 10
  match-accept/index.ts           + .test.ts # Task 10 (idempotency-key required)
  match-pass/index.ts             + .test.ts # Task 10
  match-cancel/index.ts           + .test.ts # Task 10 (idempotency-key required)
  match-withdraw/index.ts         + .test.ts # Task 10
  match-resolve-reciprocal/index.ts + .test.ts # Task 10
  match-demand-hint/index.ts      + .test.ts # Task 10
```

**Naming note:** all SECURITY DEFINER transition functions are prefixed `match_` and use **exactly** the C2/C11.4 names/signatures (see "C2 API surface"). The `match-rank` Edge Function and the separate `match_set_rank` RPC are **REMOVED** — rank is carried by `match_shortlist(p_actor, p_instance, p_candidate, p_rank int)` per the C2 signature; reordering is a re-call of `match_shortlist` with a new rank. Tests/docs may abbreviate, but code uses the C2 names.

---

## Task 0: Advisory-lock-key helpers + two-session race harness

**Files:**
- Create: `supabase/migrations/20260525126000_p5_lock_keys.sql`
- Create: `supabase/tests/p5_lock_keys.sql`
- Create: `supabase/tests/p5_concurrency_lib.sh`

> **SUPERSEDED:** the former "Task 0 P2 shim" that created `jobs`/`enqueue`/`cancel_jobs`/`notify` is **removed**. Those are S2-owned (C1) and must already exist before P5 applies — P5 fabricates no scheduler/notification infrastructure. If, for *isolated* local iteration before S2 lands, a developer needs stand-ins, that may be a **test-only `create … if not exists` stub guarded behind a clearly-labelled dev script** using the **exact C1 signatures** (`enqueue_job(p_type job_type, …)`, `cancel_jobs(p_type job_type, p_dedup_key text)`, `dispatch_notification(...)`), and it must be **dropped the moment S2 lands** — it is never committed as a migration and never diverges from C1. The default assumption is: S2 is applied first.

### Why first
P5's concurrency tests are the whole point of this phase, so the two-session race harness is task #1. P5 only needs to create the **advisory-lock-key helpers** (its own internal lock-keying functions) plus a tiny `temp_race` test table used by the shell harnesses. Everything else (jobs/notify/config/chat) comes from S2.

- [ ] **Step 1: Write the failing test** (`supabase/tests/p5_lock_keys.sql` asserts the lock-key helpers exist + are order-independent, AND that the S2 deps are present)

```sql
-- supabase/tests/p5_lock_keys.sql
\i supabase/tests/_fixtures.sql   -- S1-owned (C8); provides mk_user/mk_itinerary/mk_instance
DO $$
BEGIN
  -- S2 deps must already exist (P5 does not create them).
  PERFORM 1 FROM pg_proc WHERE proname='enqueue_job';
  IF NOT FOUND THEN RAISE EXCEPTION 'enqueue_job() missing — S2 not applied (P5 does not create it)'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='dispatch_notification';
  IF NOT FOUND THEN RAISE EXCEPTION 'dispatch_notification() missing — S2 not applied'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='offer_expires_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_expires_at() missing — S2/C11.1 not applied'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='can_enter_lock_flow';
  IF NOT FOUND THEN RAISE EXCEPTION 'can_enter_lock_flow() missing — S2/C3 not applied'; END IF;
  PERFORM 1 FROM pg_proc WHERE proname='open_chat_thread';
  IF NOT FOUND THEN RAISE EXCEPTION 'open_chat_thread() missing — chat-core/C11.7 not applied'; END IF;
  PERFORM 1 FROM pg_tables WHERE tablename='analytics_events';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_events missing — S2/C11.8 not applied'; END IF;
  -- P5's own lock-key helper: canonical pair-lock key must be order-independent
  IF match_pair_lock_key('00000000-0000-0000-0000-000000000001'::uuid,
                         '00000000-0000-0000-0000-000000000002'::uuid)
   <> match_pair_lock_key('00000000-0000-0000-0000-000000000002'::uuid,
                         '00000000-0000-0000-0000-000000000001'::uuid)
  THEN RAISE EXCEPTION 'pair-lock key is not order-independent'; END IF;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** — `function match_pair_lock_key(...) does not exist` (S2 deps should already be present from `db reset`; if any S2 assertion fails, S2 has not landed — stop and land it first).

- [ ] **Step 3: Write the migration (lock-key helpers + race table only)**

```sql
-- supabase/migrations/20260525126000_p5_lock_keys.sql
-- P5 advisory-lock-key helpers (internal). NO jobs/enqueue/notify here — those are S2 (C1).

-- Canonical, order-independent advisory-lock key for a pair of users (used by reciprocal + accept).
create or replace function match_pair_lock_key(a uuid, b uuid)
returns bigint language sql immutable as $fn$
  select ('x' || substr(md5(least(a::text,b::text) || greatest(a::text,b::text)),1,16))::bit(64)::bigint
$fn$;

-- Single-instance advisory-lock key (used by make_offer/accept/auto_roll on one date instance).
create or replace function match_instance_lock_key(inst uuid)
returns bigint language sql immutable as $fn$
  select ('x' || substr(md5('date_instance:'||inst::text),1,16))::bit(64)::bigint
$fn$;

-- Tiny helper table the .sh race harnesses use to pass ids between shell sessions. Test scaffolding.
create table if not exists temp_race (k text primary key, v text);
alter table temp_race enable row level security; -- service-role only; no policies = default deny.
```

- [ ] **Step 4: Apply + run test, expect PASS** (`supabase db reset && psql … -f supabase/tests/p5_lock_keys.sql`). `db reset` applies S1+S2+S5+P5.

- [ ] **Step 5: Build the two-session race harness**

Fixtures come from **`supabase/tests/_fixtures.sql` (S1-owned, C8)** — `mk_user(label)`, `mk_itinerary(user)`, `mk_instance(itin, creator, starts)`. P5 defines **no** fixture factory; every P5 test `\i`'s `_fixtures.sql` and composes these. (The old `p5_fixture_reset()` that referenced a non-existent `profiles.email` column and hand-inserted into `auth.users` is **REMOVED** — it failed at line 1, per the audit C1/C2.)

```bash
# supabase/tests/p5_concurrency_lib.sh
#!/usr/bin/env bash
# Two-session race harness. Usage: run two SQL blobs "simultaneously" by starting
# both as backgrounded psql jobs that each BEGIN, wait on the same advisory lock
# (via a coordinating sleep), then commit. We assert exactly one succeeds.
set -euo pipefail
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql_bg() { psql "$DB" -v ON_ERROR_STOP=0 -f "$1" > "$2" 2>&1 & echo $!; }
# Callers: write two .sql session files, launch both, wait, then diff exit/notice output.
```

> **Design note (why a shell harness, not a `DO` block):** a single transaction cannot model two clients contending for a `pg_advisory_xact_lock`. The race tests (Task 5/6) write two session SQL files that each call the transition function, launch both with `psql_bg`, `wait`, and assert that exactly one returns success and the other returns the mapped conflict (`OFFER_NOT_ACTIVE` / `exclusion_violation` → `DOUBLE_BOOKED`). The advisory lock + a small intra-tx pacing makes the interleaving deterministic. Race harnesses seed via `mk_user`/`mk_itinerary`/`mk_instance` (committed before launch) and stash ids in `temp_race`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525126000_p5_lock_keys.sql supabase/tests/p5_lock_keys.sql supabase/tests/p5_concurrency_lib.sh
git commit -m "P5: advisory-lock-key helpers + two-session race harness (S2 owns jobs/notify; no shim)"
```

---

## Task 1: Idempotency ledger (accept/lock/cancel safety)

**Files:**
- Create: `supabase/migrations/20260525126100_p5_idempotency.sql`

### Why
Accept/lock and cancel are money-state transitions; a client retry (lost ACK, double-tap, push-driven retry) must not lock twice or roll twice. We add a tiny ledger keyed on `(actor, action, idempotency_key)` that the transition functions consult **inside** their advisory-locked transaction. `match_idem_lookup`/`match_idem_store` are **internal helpers** — `revoke execute from public, authenticated` (C10), granted to `service_role` only (centralized in Task 9).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260525126100_p5_idempotency.sql
create table if not exists transition_idempotency (
  actor uuid not null,
  action text not null,                 -- 'accept_offer' | 'cancel_lock' | 'resolve_reciprocal' | ...
  idempotency_key text not null,
  result jsonb not null,                -- the original function's return value, replayed on retry
  created_at timestamptz not null default now(),
  primary key (actor, action, idempotency_key)
);
alter table transition_idempotency enable row level security; -- service/definer only.

-- Helper: returns stored result if seen before, else null. Called first inside a transition.
create or replace function match_idem_lookup(p_actor uuid, p_action text, p_key text)
returns jsonb language sql stable security definer set search_path=public as $fn$
  select result from transition_idempotency
   where actor=p_actor and action=p_action and idempotency_key=p_key
$fn$;

create or replace function match_idem_store(p_actor uuid, p_action text, p_key text, p_result jsonb)
returns void language plpgsql security definer set search_path=public as $fn$
begin
  insert into transition_idempotency(actor,action,idempotency_key,result)
  values (p_actor,p_action,p_key,p_result)
  on conflict (actor,action,idempotency_key) do nothing;
end $fn$;
```

- [ ] **Step 2: Apply, expect clean** (`supabase db reset`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525126100_p5_idempotency.sql
git commit -m "P5: transition idempotency ledger + lookup/store helpers (internal)"
```

---

## Task 2: Shortlist (carries rank; frozen for the active offer slot) + swiper-disclosure consent

**Files:**
- Create: `supabase/migrations/20260525126200_p5_shortlist.sql`
- Test: `supabase/tests/p5_shortlist_rank.sql`
- Test: `supabase/tests/p5_swiper_disclosure.sql`

> **C2 conformance:** the public RPC is **`match_shortlist(p_actor uuid, p_instance uuid, p_candidate uuid, p_rank int)`** — rank is a parameter of `match_shortlist`, not a separate `match_set_rank`. The old standalone `match_set_rank` is **REMOVED** as a public name; reordering = re-calling `match_shortlist` with a new `p_rank`. (An internal `_match_set_rank` body may exist as a private helper that `match_shortlist` delegates to, but it is never the public surface and is `revoke`d from `authenticated`.)

### Design decisions locked
- **Auth (C10):** `match_shortlist` asserts `p_actor = auth.uid()` first, then `creator only`.
- **Two orderings, one source of truth.** Per audit ("standby vs creator-rank ambiguity"), `queue_entries.rank` is the **creator's preference order over shortlisted candidates**; **standby is just the same rank order filtered to the non-offered shortlist**. We do **not** keep a second `standby_pos`; we add a column only to *freeze* a snapshot of order when an offer goes out so an in-flight reorder cannot reshuffle who's "next." `match_next_standby(instance)` = lowest-`rank` `shortlisted` candidate (the single C2 source of standby order). This makes "standby order" deterministic and identical to rank, eliminating the dual-ordering bug.
- **Rank freeze at the #1 slot.** Spec §6: once the #1 holds an active offer, that slot is frozen; reordering applies only to positions ≥2. We enforce in `match_shortlist`: if there is an `offer_active` row for the instance, **reject any rank change that would move the offer-holder out of rank 1**, but allow reordering of positions ≥2.
- **Analytics (C11.8):** every shortlist/disclosure transition inserts an `analytics_events` row.
- **Swiper-disclosure consent (honeypot mitigation).** Per audit + spec §7.2: when the creator shortlists a candidate (or first views the right-swipe pool), that is the moment the swiper's profile becomes visible to the still-anonymous creator. P0 RLS already restricts swiper-profile reads to right-swipes on the creator's own instances; here we make the disclosure **explicit and logged** so it's auditable and surfaceable in UI ("by swiping right, your profile is shown to the night's creator"). We add a `swiper_disclosed_at` stamp on the queue entry and an `audit_log` row. The creator's identity stays hidden until offer (Task 4); only the *swiper's* profile is disclosed here — the asymmetry the spec intends.

- [ ] **Step 1: Write the failing tests**

> **Fixtures (C8):** all P5 tests `\i supabase/tests/_fixtures.sql` (S1-owned) and build seed data with `mk_user`/`mk_itinerary`/`mk_instance`. They do **not** reference `profiles.email` (no such column) and never hand-insert into `auth.users` or `profiles`. `match_shortlist`/etc. assert `p_actor = auth.uid()`; in psql `DO`-block tests run as `postgres`, `auth.uid()` is null, so tests set the actor via `set local request.jwt.claims = '{"sub":"<uuid>"}'` (or call through the service path) so the assertion passes — each test sets the claim to the acting user's id before the call. (The race `.sh` harnesses use real JWT-less service sessions and set the claim likewise.)

```sql
-- supabase/tests/p5_shortlist_rank.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid; r1 int; r2 int;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1'); c2 := mk_user('cand2');
  it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);  -- act as creator
  -- candidates expressed interest (S5 normally writes swipes; simulate the seeded queue rows)
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values
    (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);                 -- internal: seeds queue_entries(status='interested')
  perform match_shortlist(cre, inst, c1, 1);           -- creator shortlists c1 at rank 1
  perform match_shortlist(cre, inst, c2, 2);           -- and c2 at rank 2
  select rank into r1 from queue_entries where date_instance_id=inst and candidate_id=c1;
  select rank into r2 from queue_entries where date_instance_id=inst and candidate_id=c2;
  IF r1<>1 OR r2<>2 THEN RAISE EXCEPTION 'rank not set: %, %', r1, r2; END IF;

  -- next standby == lowest-rank shortlisted == c1
  IF match_next_standby(inst) <> c1 THEN RAISE EXCEPTION 'next standby should be c1'; END IF;

  -- a non-creator cannot shortlist (auth.uid() asserted + creator-only)
  perform set_config('request.jwt.claims', json_build_object('sub',c2)::text, true);
  BEGIN
    PERFORM match_shortlist(c2, inst, c1, 1);
    RAISE EXCEPTION 'non-creator was allowed to shortlist';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%NOT_CREATOR%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'shortlist/rank OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_swiper_disclosure.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; it uuid; inst uuid; n int;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre, inst, c1, 1);
  -- disclosure stamped + audited
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=c1 AND swiper_disclosed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'swiper_disclosed_at not stamped on shortlist'; END IF;
  select count(*) into n from audit_log where entity='swiper_disclosure' and entity_id=c1;
  IF n < 1 THEN RAISE EXCEPTION 'disclosure not audited'; END IF;
  -- analytics emitted (C11.8)
  select count(*) into n from analytics_events where event_type='match_shortlisted';
  IF n < 1 THEN RAISE EXCEPTION 'shortlist analytics not emitted'; END IF;
  RAISE NOTICE 'swiper disclosure OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run both, expect FAIL** (`function match_ingest_interest(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525126200_p5_shortlist.sql
alter table queue_entries
  add column if not exists swiper_disclosed_at timestamptz,
  add column if not exists offer_frozen_rank int;   -- snapshot of rank=1 when an offer is live

-- INTERNAL helper. Seed queue_entries from right-swipes (idempotent). Invoked by S5 post-swipe
-- (named cross-stage hook) — not a public C2 RPC. revoke execute from authenticated (Task 9).
create or replace function match_ingest_interest(p_instance uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int := 0; cre uuid;
begin
  select creator_id into cre from date_instances where id=p_instance;
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
  select s.date_instance_id, s.swiper_id, s.creator_id, 'interested'
    from swipes s
   where s.date_instance_id=p_instance and s.direction='right'
     -- never enqueue a blocked pair in either direction
     and not exists (select 1 from blocks b where (b.blocker_id=cre and b.blocked_id=s.swiper_id)
                                                or (b.blocker_id=s.swiper_id and b.blocked_id=cre))
  on conflict (date_instance_id, candidate_id) do nothing;
  get diagnostics n = row_count; return n;
end $fn$;

-- C2 PUBLIC RPC. Creator shortlists an interested candidate AND sets/reorders their rank in one call.
-- Discloses the swiper's profile (already RLS-allowed; made explicit + audited) and moves to 'shortlisted'.
-- Frozen rule: while an offer is active, rank=1 (the offer-holder) is immutable; positions >=2 reorder freely.
create or replace function match_shortlist(p_actor uuid, p_instance uuid, p_candidate uuid, p_rank int)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid; offer_holder uuid;
begin
  if p_actor is distinct from auth.uid() then raise exception 'NOT_AUTHENTICATED'; end if;  -- C10
  if p_rank < 1 then raise exception 'BAD_RANK'; end if;
  select creator_id into cre from date_instances where id=p_instance;
  if cre is null then raise exception 'NO_INSTANCE'; end if;
  if cre <> p_actor then raise exception 'NOT_CREATOR'; end if;

  -- serialize against make_offer/auto_roll on this instance
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  -- frozen-slot rule: cannot move the active offer-holder off rank 1, nor assign rank 1 to anyone else.
  select candidate_id into offer_holder
    from queue_entries where date_instance_id=p_instance and status='offer_active';
  if offer_holder is not null then
    if (p_candidate = offer_holder and p_rank <> 1)
       or (p_candidate <> offer_holder and p_rank = 1)
    then raise exception 'RANK_FROZEN'; end if;
  end if;

  update queue_entries
     set status = case when status='interested' then 'shortlisted'::queue_status else status end,
         rank = p_rank,
         swiper_disclosed_at = coalesce(swiper_disclosed_at, now())
   where date_instance_id=p_instance and candidate_id=p_candidate
     and status in ('interested','shortlisted','standby');
  if not found then raise exception 'NOT_INTERESTED'; end if;

  insert into audit_log(entity, entity_id, action, new_status, actor)
  values ('swiper_disclosure', p_candidate, 'disclosed_to_creator', 'shortlisted', p_actor);
  -- analytics (C11.8)
  insert into analytics_events(event_type, actor_id, payload)
  values ('match_shortlisted', p_actor,
          jsonb_build_object('instance', p_instance, 'candidate', p_candidate, 'rank', p_rank));
  -- reciprocity detection (internal; defined in Task 7, resolved at call time). Fires on every shortlist.
  perform match_detect_reciprocal(cre, p_candidate);
end $fn$;

-- The single C2 source of standby/next ordering: lowest-rank shortlisted (rank null sorts last).
create or replace function match_next_standby(p_instance uuid)
returns uuid language sql stable security definer set search_path=public as $fn$
  select candidate_id from queue_entries
   where date_instance_id=p_instance and status='shortlisted'
   order by rank nulls last, created_at
   limit 1
$fn$;
```

> **Analytics column shape:** `analytics_events` is the S2/C11.8 outbox. This plan assumes its columns are `(event_type text, actor_id uuid, payload jsonb, created_at timestamptz)`. If S2 froze a different shape, P5 conforms to S2's columns (canonical) — adjust the `insert` accordingly; the *fact* that every transition emits an event is mandatory, the exact column names defer to S2.

- [ ] **Step 4: Apply + run both tests, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525126200_p5_shortlist.sql supabase/tests/p5_shortlist_rank.sql supabase/tests/p5_swiper_disclosure.sql
git commit -m "P5: match_shortlist(…,p_rank) (rank-1 frozen during offer), single rank-based standby order, audited swiper disclosure + analytics"
```

---

## Task 3: Bucketed, capped, presence-backed demand hint

**Files:**
- Create: `supabase/migrations/20260525126400_p5_demand_presence.sql`
- Test: `supabase/tests/p5_demand_hint.sql`

> **C2 conformance:** `match_demand_hint(p_instance uuid) returns text` is **the only demand hint** in the system (C2). S12/P11 deletes its duplicate `demand_hint`/`bucket_demand` view (DS2/CV7) — P5 owns this single source. The `presence_heartbeats` table is a P5-band object (no shared owner in the contract); P5 owns it here.

### Design decisions locked (spec §7.2 "Demand signal (de-risked)")
- Return a **bucket label**, never a raw `N`: `none` (0), `a_few` (1–3), `several` (4–8), `lots` (9+ capped). The exact count never leaves the DB.
- **Capped + trusted-only:** counts only candidates whose profile is `verification='verified'` AND who are **currently present** (a heartbeat in the last `INTERVAL '10 min'`). This makes the signal honest social proof, not a fabricated retention number, and resists swipe-farm inflation (audited separately in P8).
- **Honesty guard:** a candidate viewing the hint **never** sees their own queue position contribute in a way that reveals rank. The hint is the same value for everyone viewing that instance; it is *not* personalized and *not* a retention lever.
- Presence heartbeats live in a small table P4/clients update; we provide the table + the read function here. The hint is computed at read time (no stored counter to drift).

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p5_demand_hint.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid; bucket text;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1'); c2 := mk_user('cand2');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');

  -- 0 interested → 'none'
  IF match_demand_hint(inst) <> 'none' THEN RAISE EXCEPTION 'expected none'; END IF;

  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  -- verified-but-NOT-present yet → still 'none' (presence-backed honesty)
  IF match_demand_hint(inst) <> 'none' THEN RAISE EXCEPTION 'expected none w/o presence'; END IF;

  -- mark both present → 'a_few'  (mk_user seeds verified profiles; if S3 gates verification differently,
  -- the test sets profiles.verification='verified' for the candidates to exercise the trusted-only path)
  insert into presence_heartbeats(user_id, seen_at) values (c1, now()),(c2, now())
    on conflict (user_id) do update set seen_at=now();
  bucket := match_demand_hint(inst);
  IF bucket <> 'a_few' THEN RAISE EXCEPTION 'expected a_few, got %', bucket; END IF;
  RAISE NOTICE 'demand hint OK (%)', bucket;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "presence_heartbeats" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525126400_p5_demand_presence.sql
create table if not exists presence_heartbeats (
  user_id uuid primary key references profiles(id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table presence_heartbeats enable row level security;
do $$ begin
  create policy "presence_self_upsert" on presence_heartbeats for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Bucketed, capped, presence+verification-weighted demand hint. Same value for all viewers.
create or replace function match_demand_hint(p_instance uuid)
returns text language sql stable security definer set search_path=public as $fn$
  with c as (
    select count(*) as n
      from queue_entries q
      join profiles p on p.id = q.candidate_id
      join presence_heartbeats h on h.user_id = q.candidate_id
     where q.date_instance_id = p_instance
       and q.status in ('interested','shortlisted','standby')
       and p.verification = 'verified'
       and h.seen_at > now() - interval '10 minutes'
  )
  select case
    when n = 0 then 'none'
    when n between 1 and 3 then 'a_few'
    when n between 4 and 8 then 'several'
    else 'lots'          -- capped: never reveals exact count beyond this bucket
  end from c
$fn$;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525126400_p5_demand_presence.sql supabase/tests/p5_demand_hint.sql
git commit -m "P5: presence-backed, bucketed, capped, trusted-only demand hint (single C2 source; honest social proof)"
```

---

## Task 4: `match_make_offer` — single active offer, expiry job, chat thread, lock-flow gate, reveal to offer-holder ONLY

**Files:**
- Create: `supabase/migrations/20260525126300_p5_make_offer.sql`
- Test: `supabase/tests/p5_make_offer.sql`
- Test: `supabase/tests/p5_reveal_scope.sql`

> **C2 signature:** `match_make_offer(p_actor uuid, p_instance uuid, p_candidate uuid, p_idem_key text) returns uuid`. (The old `p_window_hours int default 24` parameter is **REMOVED** — expiry comes from `offer_expires_at()`, never a hardcoded/parameterized window, per C11.1 / CV8.)

### Design decisions locked (spec §7.2, §7.3; C2, C11.1, C11.7, C3)
- **Auth (C10):** asserts `p_actor = auth.uid()` first, then `creator only`.
- **Advisory lock then check.** `match_make_offer` takes `pg_advisory_xact_lock(match_instance_lock_key(instance))` so two concurrent calls serialize; the second sees the existing `offer_active` and raises `OFFER_EXISTS` (the S1 partial-unique index `offers_one_active_per_instance` is the structural backstop). This is race-free *by construction*, not by retry.
- **Lock-flow gate (C3):** before creating the offer, `match_make_offer` checks `can_enter_lock_flow(p_candidate)` — a paused/suspended/cooldown/locked_ban/rollover_frozen candidate cannot be offered to (raises `CANDIDATE_NOT_ELIGIBLE`). This is the C2-mandated gate.
- **Tunable expiry (C11.1):** `expires_at := offer_expires_at()` reading `feature_config.offer_window_hours` (DST-safe, clamped 12–72h). **No hardcoded 24h, no window param.**
- **Expiry timer (C1):** `enqueue_job('offer_expiry', expires_at, jsonb_build_object('offer_id',oid), p_dedup_key => oid::text)`. The dedup key is the offer id (C2: "dedup=offer_id"). When the offer resolves early (accept/pass) we `cancel_jobs('offer_expiry', oid::text)`; even if the job fires anyway, `match_expire_offer` (Task 6) is a guarded no-op when already resolved. The S2 `offer_expiry` handler calls `match_expire_offer(offer_id)` — P5 owns the transition; S2 owns the timer (reconciliation checklist P2: "`offer_expiry` handler calls `match_expire_offer`").
- **Chat thread (C11.7):** on offer creation, `match_make_offer` calls `open_chat_thread(oid)` (chat-core) so the offer-holder and creator can chat. Pass/expire close it (Task 6); accept promotes it (Task 5).
- **Offer = the only reveal.** Identity reveal is **derived from offer state**, never stored as a separate flag that can drift. `match_reveal_allowed(viewer, instance)` is the **only** reveal predicate (C2; S3 drops `offer_reveal`): a viewer may see the creator's identity iff they currently hold the `offer_active` row (or are the creator). When the offer resolves, the predicate flips automatically → **reveal auto-revoke is real, not a fiction**.
- **Frozen rank snapshot.** On offer we set `offer_frozen_rank=1` on the offer-holder and `queue_entries.status='offer_active'`; the creator can still reorder ≥2 (Task 2 enforces the freeze).
- **Block guard:** cannot offer to a candidate who has blocked the creator or is blocked.
- **Notifications (C1) + analytics (C11.8):** `dispatch_notification(p_candidate, 'offer_received', …)`; insert `analytics_events('match_offer_made', …)`.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p5_make_offer.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid; oid uuid; jcount int;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1'); c2 := mk_user('cand2');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2,2);

  oid := match_make_offer(cre, inst, c1, 'idem-offer-1');
  -- one active offer, expiry from offer_expires_at() (NOT hardcoded), expiry job enqueued via C1 enqueue_job
  PERFORM 1 FROM offers WHERE id=oid AND status='active' AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not active/expiry'; END IF;
  -- C1 jobs table: type=offer_expiry (enum), dedup_key=offer id
  select count(*) into jcount from jobs where type='offer_expiry' and dedup_key=oid::text and status='pending';
  IF jcount <> 1 THEN RAISE EXCEPTION 'expiry job not enqueued via enqueue_job (%).', jcount; END IF;
  -- chat thread opened (C11.7)
  PERFORM 1 FROM chat_threads WHERE offer_id=oid;
  IF NOT FOUND THEN RAISE EXCEPTION 'open_chat_thread not called on offer'; END IF;
  -- candidate row is offer_active
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=c1 AND status='offer_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'c1 not offer_active'; END IF;
  -- analytics emitted (C11.8)
  PERFORM 1 FROM analytics_events WHERE event_type='match_offer_made';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer-made analytics not emitted'; END IF;

  -- second concurrent-style offer on same instance rejected (single-session proxy via direct call)
  BEGIN
    PERFORM match_make_offer(cre, inst, c2, 'idem-offer-2');
    RAISE EXCEPTION 'second active offer allowed';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM NOT LIKE '%OFFER_EXISTS%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'make_offer OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_reveal_scope.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1'); c2 := mk_user('cand2');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2,2);
  perform match_make_offer(cre, inst, c1, 'idem-offer-1');

  -- ONLY the active offer-holder may see the creator identity
  IF NOT match_reveal_allowed(c1, inst) THEN RAISE EXCEPTION 'offer-holder cannot reveal'; END IF;
  IF match_reveal_allowed(c2, inst) THEN RAISE EXCEPTION 'LEAK: standby can reveal creator'; END IF;
  IF NOT match_reveal_allowed(cre, inst) THEN RAISE EXCEPTION 'creator self-view blocked'; END IF;
  RAISE NOTICE 'reveal scope OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run both, expect FAIL** (`function match_make_offer(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525126300_p5_make_offer.sql
create or replace function match_make_offer(p_actor uuid, p_instance uuid, p_candidate uuid, p_idem_key text)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare cre uuid; oid uuid; exp timestamptz; st date_match_status; prior jsonb;
begin
  if p_actor is distinct from auth.uid() then raise exception 'NOT_AUTHENTICATED'; end if;  -- C10

  -- idempotency replay (offer creation is mutating; a retry must not create a second offer)
  prior := match_idem_lookup(p_actor, 'make_offer', p_idem_key);
  if prior is not null then return (prior->>'offer_id')::uuid; end if;

  -- 1. serialize all offer/lock/roll activity for this instance
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));

  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if cre is null then raise exception 'NO_INSTANCE'; end if;
  if cre <> p_actor then raise exception 'NOT_CREATOR'; end if;
  if st <> 'seeking' then raise exception 'INSTANCE_NOT_SEEKING'; end if;

  -- 2. single-active-offer guard (advisory lock makes this race-free; index is backstop)
  if exists (select 1 from offers where date_instance_id=p_instance and status='active') then
    raise exception 'OFFER_EXISTS';
  end if;

  -- 3. candidate must be shortlisted; block guard; lock-flow gate (C3)
  if not exists (select 1 from queue_entries
                  where date_instance_id=p_instance and candidate_id=p_candidate and status='shortlisted') then
    raise exception 'NOT_SHORTLISTED';
  end if;
  if exists (select 1 from blocks b where (b.blocker_id=cre and b.blocked_id=p_candidate)
                                       or (b.blocker_id=p_candidate and b.blocked_id=cre)) then
    raise exception 'BLOCKED';
  end if;
  if not can_enter_lock_flow(p_candidate) then raise exception 'CANDIDATE_NOT_ELIGIBLE'; end if;  -- C3/C2

  -- 4. create offer; expiry from feature_config via offer_expires_at() (C11.1 — NO hardcoded 24h)
  exp := offer_expires_at();
  insert into offers(date_instance_id, candidate_id, creator_id, status, expires_at)
  values (p_instance, p_candidate, cre, 'active', exp)
  returning id into oid;

  -- 5. promote candidate to offer_active, freeze rank-1 snapshot
  update queue_entries set status='offer_active', rank=1, offer_frozen_rank=1
   where date_instance_id=p_instance and candidate_id=p_candidate;

  -- 6. open chat thread (C11.7), enqueue expiry timer via C1 enqueue_job (dedup=offer id), notify, analytics
  perform open_chat_thread(oid);
  perform enqueue_job('offer_expiry', exp, jsonb_build_object('offer_id',oid), oid::text);
  perform dispatch_notification(p_candidate, 'offer_received',
                                jsonb_build_object('instance', p_instance, 'expires_at', exp));
  insert into analytics_events(event_type, actor_id, payload)
  values ('match_offer_made', p_actor,
          jsonb_build_object('instance', p_instance, 'candidate', p_candidate, 'offer', oid, 'expires_at', exp));

  perform match_idem_store(p_actor, 'make_offer', p_idem_key, jsonb_build_object('offer_id', oid));
  return oid;
end $fn$;

-- THE reveal predicate (C2): creator identity is visible ONLY to the active offer-holder (or the creator).
-- Derived live from offer state → revocation is automatic when the offer resolves. S3 drops `offer_reveal`.
create or replace function match_reveal_allowed(p_viewer uuid, p_instance uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select exists (select 1 from date_instances di where di.id=p_instance and di.creator_id=p_viewer)
      or exists (select 1 from offers o
                  where o.date_instance_id=p_instance and o.candidate_id=p_viewer and o.status='active')
$fn$;
```

> **Job/notify type names defer to S2.** `enqueue_job`'s `p_type` is the C1 `job_type` enum (`offer_expiry`) and `dispatch_notification`'s `p_type` is the C1 `notification_type` enum (`offer_received`). If S2's `dedup_key` semantics or column names differ, conform to S2 — the canonical signatures are in C1. P5 never passes a string not present in the C1 enums.

- [ ] **Step 4: Apply + run both tests, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525126300_p5_make_offer.sql supabase/tests/p5_make_offer.sql supabase/tests/p5_reveal_scope.sql
git commit -m "P5: match_make_offer (offer_expires_at + open_chat_thread + can_enter_lock_flow + enqueue_job) + live reveal predicate"
```

---

## Task 5: `match_accept_offer` → LOCK (chat-gate + lock-flow gate + advisory + no-overlap + off-market + cascade + idempotent)

**Files:**
- Create: `supabase/migrations/20260525126500_p5_accept_lock.sql`
- Test: `supabase/tests/p5_accept_lock.sql`
- Test: `supabase/tests/p5_accept_idempotent.sql`
- Test: `supabase/tests/p5_seed_night_accept.sql`
- Test: `supabase/tests/p5_race_two_accepts.sh`

> **C2 signature:** `match_accept_offer(p_actor uuid, p_offer uuid, p_idem_key text) returns uuid`. (Historically the body wrote `p_offer_id` and returned `jsonb`; the contract names the param `p_offer` and the **return is the lock id uuid**. Implement returning the lock `uuid`; an internal jsonb may be stored in the idempotency ledger, but the public return type is `uuid` per C2.)

### Design decisions locked (spec §7.3, §7.4; C2, C3, C11.7)
- **Auth (C10):** asserts `p_actor = auth.uid()`; then only the offer's `candidate_id` may accept (`NOT_OFFER_HOLDER` otherwise).
- **Lock-flow gate (C3 / C2):** before locking, `can_enter_lock_flow(p_actor)` must be true (the acceptor must be `active` standing + non-cooldown/ban/suspend, not rollover_frozen) → else `ACTOR_NOT_ELIGIBLE`. This honors P7's enforcement ladder (CC7) — the lock cannot bypass standing/cooldown.
- **Chat-rapport gate (C2 / C11.7):** `match_accept_offer` requires `chat_lock_ready(thread)` true (or mutual override) → else `CHAT_NOT_READY`. The thread is the one `open_chat_thread` created at offer time; on success P5 calls `promote_chat_thread_to_lock(offer, lock)`.
- **Idempotency-keyed.** `match_accept_offer(p_actor, p_offer, p_idem_key)` first `match_idem_lookup`; if seen, returns the stored lock id (no second lock). The Edge Function **requires** an `Idempotency-Key` header for accept.
- **Advisory lock on the instance** serializes against a competing `make_offer`/`auto_roll`. **The lock_participants GiST exclusion (S1)** guarantees the same user cannot be double-booked across overlapping windows — a concurrent accept of an overlapping date raises `exclusion_violation`, caught → `DOUBLE_BOOKED`.
- **Two simultaneous accepts of the same offer:** both serialize on the instance advisory lock; the first flips the offer to `accepted` and inserts the lock; the second sees `offer.status<>'active'` → `OFFER_NOT_ACTIVE`. Exactly one lock is ever created (`locks.date_instance_id` unique in S1).
- **Off-market + cascade auto-withdraw (spec §7.4):** on lock we (a) set `date_instances.status='matched'`; (b) auto-close other scheduled instances the creator owns that overlap the locked window (`status='cancelled'`, audited); (c) auto-withdraw the matched user from conflicting offers/standbys on *other* instances — bounded by the Task 6 throttle.
- **Seed-night acceptance (MD9):** when the accepted offer's instance is a seed/concierge night (`date_instances.is_seed = true`, owned by S5), the lock is created the same way, but the "creator" side is the concierge/seed owner — P5 honors the same lock path and emits `analytics_events('match_seed_night_locked', …)`; it does **not** reinvent seed-night creation (S5 owns that). See "Seed-night acceptance handling" below.
- **Notifications (C1) + analytics (C11.8):** `dispatch_notification(matched_user, 'new_match', …)` and `dispatch_notification(creator, 'new_match', …)`; insert `analytics_events('match_lock_created', …)`. The `sync_lock_participants` trigger (S1) writes `lock_participants`; the GiST exclusion enforces no-overlap automatically.

> **Notification-type mapping:** lock-confirmed uses the C1 `notification_type` value `'new_match'` (the C1 enum has `new_match`, not a `'locked'`/`'lock_confirmed'` string). If S2 chose a different enum member for lock confirmation, conform to S2's enum — never emit a string absent from C1.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p5_accept_lock.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; it uuid; inst uuid; oid uuid; lid uuid; st date_match_status;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  oid := match_make_offer(cre, inst, c1, 'idem-offer-1');

  -- act as the candidate to accept; chat-core must report ready (chat_lock_ready) — see note
  perform set_config('request.jwt.claims', json_build_object('sub',c1)::text, true);
  lid := match_accept_offer(c1, oid, 'idem-accept-1');   -- C2: returns lock uuid
  PERFORM 1 FROM locks WHERE id=lid AND status='active' AND matched_user_id=c1 AND creator_id=cre;
  IF NOT FOUND THEN RAISE EXCEPTION 'lock not created'; END IF;
  PERFORM 1 FROM offers WHERE id=oid AND status='accepted';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not accepted'; END IF;
  select status into st from date_instances where id=inst;
  IF st <> 'matched' THEN RAISE EXCEPTION 'instance not off-market (status=%).', st; END IF;
  PERFORM 1 FROM lock_participants WHERE lock_id=lid AND user_id=c1 AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'lock_participants missing matched user'; END IF;
  -- chat thread promoted to lock (C11.7)
  PERFORM 1 FROM chat_threads WHERE offer_id=oid AND lock_id=lid;
  IF NOT FOUND THEN RAISE EXCEPTION 'promote_chat_thread_to_lock not called'; END IF;
  -- expiry job cancelled via C1 cancel_jobs (dedup=offer id)
  PERFORM 1 FROM jobs WHERE type='offer_expiry' AND dedup_key=oid::text AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'expiry job not cancelled on accept'; END IF;
  -- analytics emitted (C11.8)
  PERFORM 1 FROM analytics_events WHERE event_type='match_lock_created';
  IF NOT FOUND THEN RAISE EXCEPTION 'lock-created analytics not emitted'; END IF;

  -- non-candidate cannot accept
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  BEGIN PERFORM match_accept_offer(cre, oid, 'x'); RAISE EXCEPTION 'creator accepted own offer';
  EXCEPTION WHEN sqlstate 'P0001' THEN IF SQLERRM NOT LIKE '%NOT_OFFER_HOLDER%' AND SQLERRM NOT LIKE '%OFFER_NOT_ACTIVE%' THEN RAISE; END IF; END;
  RAISE NOTICE 'accept→lock OK';
  ROLLBACK;
END $$;
```

> **chat_lock_ready in tests:** `match_accept_offer` gates on `chat_lock_ready(thread)`. In tests the chat-core (S2/C11.7) thread is opened by `match_make_offer`; the test either drives chat-core to the ready state (per chat-core's documented contract for the "rapport satisfied / mutual override" condition) or relies on chat-core's test default of ready. P5 does not assume an implementation — it only requires the predicate be true before locking. If chat-core's ready condition needs message exchange, the test simulates it via chat-core's API.

```sql
-- supabase/tests/p5_accept_idempotent.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; it uuid; inst uuid; oid uuid; l1 uuid; l2 uuid; nlocks int;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  oid := match_make_offer(cre, inst, c1, 'idem-offer-1');
  perform set_config('request.jwt.claims', json_build_object('sub',c1)::text, true);
  l1 := match_accept_offer(c1, oid, 'same-key');
  l2 := match_accept_offer(c1, oid, 'same-key');   -- retry, same idem key
  IF l1 <> l2 THEN RAISE EXCEPTION 'idempotent retry returned different lock'; END IF;
  select count(*) into nlocks from locks where date_instance_id=inst;
  IF nlocks <> 1 THEN RAISE EXCEPTION 'idempotency created % locks', nlocks; END IF;
  RAISE NOTICE 'accept idempotent OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_seed_night_accept.sql  (MD9: a seed/concierge night locks via the normal path)
\i supabase/tests/_fixtures.sql
DO $$
DECLARE concierge uuid; c1 uuid; it uuid; inst uuid; oid uuid; lid uuid;
BEGIN
  concierge := mk_user('concierge'); c1 := mk_user('cand1');
  it := mk_itinerary(concierge);
  inst := mk_instance(it, concierge, now()+interval '3 days');
  update date_instances set is_seed = true where id = inst;   -- S5 owns is_seed; we mark for the test
  perform set_config('request.jwt.claims', json_build_object('sub',concierge)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,concierge,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(concierge,inst,c1,1);
  oid := match_make_offer(concierge, inst, c1, 'seed-offer-1');
  perform set_config('request.jwt.claims', json_build_object('sub',c1)::text, true);
  lid := match_accept_offer(c1, oid, 'seed-accept-1');
  PERFORM 1 FROM locks WHERE id=lid AND status='active' AND matched_user_id=c1;
  IF NOT FOUND THEN RAISE EXCEPTION 'seed-night lock not created'; END IF;
  PERFORM 1 FROM analytics_events WHERE event_type='match_seed_night_locked';
  IF NOT FOUND THEN RAISE EXCEPTION 'seed-night analytics not emitted (MD9)'; END IF;
  RAISE NOTICE 'seed-night accept OK';
  ROLLBACK;
END $$;
```

```bash
# supabase/tests/p5_race_two_accepts.sh
#!/usr/bin/env bash
# Two clients accept the SAME offer simultaneously. Exactly one lock; the other gets OFFER_NOT_ACTIVE.
set -euo pipefail
source "$(dirname "$0")/p5_concurrency_lib.sh"
PSQL() { psql "$DB" -v ON_ERROR_STOP=1 -t -A; }
# Seed (committed, so both sessions see it). Fixtures via S1 _fixtures.sql (C8); temp_race created in Task 0.
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
\i supabase/tests/_fixtures.sql
do $$ declare cre uuid; c1 uuid; it uuid; inst uuid; oid uuid;
begin
  cre := mk_user('creator'); c1 := mk_user('cand1');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  oid := match_make_offer(cre,inst,c1,'race-offer');
  insert into temp_race(k,v) values ('oid',oid::text),('c1',c1::text)
  on conflict (k) do update set v=excluded.v;
end $$;
SQL
OID=$(psql "$DB" -t -A -c "select v from temp_race where k='oid'")
C1=$(psql "$DB" -t -A -c "select v from temp_race where k='c1'")
cat > /tmp/p5_acc_a.sql <<SQL
select set_config('request.jwt.claims', json_build_object('sub','$C1')::text, false);
select match_accept_offer('$C1','$OID','race-a');
SQL
cat > /tmp/p5_acc_b.sql <<SQL
select set_config('request.jwt.claims', json_build_object('sub','$C1')::text, false);
select match_accept_offer('$C1','$OID','race-b');
SQL
PA=$(psql_bg /tmp/p5_acc_a.sql /tmp/p5_acc_a.out)
PB=$(psql_bg /tmp/p5_acc_b.sql /tmp/p5_acc_b.out)
wait $PA $PB || true
# Assert exactly one lock + exactly one error mentioning OFFER_NOT_ACTIVE
N=$(psql "$DB" -t -A -c "select count(*) from locks l join offers o on o.id='$OID' where l.date_instance_id=o.date_instance_id")
ERR=$(cat /tmp/p5_acc_a.out /tmp/p5_acc_b.out | grep -c 'OFFER_NOT_ACTIVE' || true)
if [ "$N" != "1" ] || [ "$ERR" != "1" ]; then
  echo "FAIL: locks=$N offer_not_active_errors=$ERR"; cat /tmp/p5_acc_*.out; exit 1
fi
echo "PASS: two-accept race → 1 lock, 1 OFFER_NOT_ACTIVE"
```

- [ ] **Step 2: Run all four, expect FAIL** (`function match_accept_offer(...) does not exist`). The `temp_race(k text primary key, v text)` table used by the `.sh` is created by Task 0's migration.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525126500_p5_accept_lock.sql
create or replace function match_accept_offer(p_actor uuid, p_offer uuid, p_idem_key text)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare prior jsonb; inst uuid; cre uuid; cand uuid; ostatus offer_status; rng tstzrange; lid uuid; is_seed bool;
begin
  if p_actor is distinct from auth.uid() then raise exception 'NOT_AUTHENTICATED'; end if;  -- C10

  -- idempotency replay (outside the lock is fine; the row only appears after a committed success)
  prior := match_idem_lookup(p_actor, 'accept_offer', p_idem_key);
  if prior is not null then return (prior->>'lock_id')::uuid; end if;

  -- load offer + serialize on its instance
  select date_instance_id, creator_id, candidate_id, status
    into inst, cre, cand, ostatus
    from offers where id=p_offer;
  if inst is null then raise exception 'NO_OFFER'; end if;
  if cand <> p_actor then raise exception 'NOT_OFFER_HOLDER'; end if;

  -- C3 lock-flow gate (acceptor must be eligible — honors P7 standing/cooldown ladder, CC7)
  if not can_enter_lock_flow(p_actor) then raise exception 'ACTOR_NOT_ELIGIBLE'; end if;
  -- C11.7 chat-rapport gate (the thread opened at offer time must be ready)
  if not chat_lock_ready((select id from chat_threads where offer_id=p_offer)) then
    raise exception 'CHAT_NOT_READY';
  end if;

  perform pg_advisory_xact_lock(match_instance_lock_key(inst));

  -- re-read under lock
  select status into ostatus from offers where id=p_offer for update;
  if ostatus <> 'active' then raise exception 'OFFER_NOT_ACTIVE'; end if;

  select time_range, is_seed into rng, is_seed from date_instances where id=inst for update;

  -- create the lock; S1 trigger writes lock_participants; GiST exclusion enforces no-overlap.
  begin
    insert into locks(date_instance_id, creator_id, matched_user_id, status)
    values (inst, cre, cand, 'active') returning id into lid;
  exception
    when exclusion_violation then raise exception 'DOUBLE_BOOKED';
    when unique_violation then raise exception 'ALREADY_LOCKED';   -- locks.date_instance_id unique
  end;

  -- resolve offer + queue
  update offers set status='accepted', resolved_at=now() where id=p_offer;
  update queue_entries set status='locked' where date_instance_id=inst and candidate_id=cand;
  update date_instances set status='matched' where id=inst;

  -- C11.7: promote the chat thread from offer-scoped to lock-scoped
  perform promote_chat_thread_to_lock(p_offer, lid);

  -- cancel the pending expiry timer via C1 cancel_jobs (dedup=offer id); worker no-ops even if it fires
  perform cancel_jobs('offer_expiry', p_offer::text);

  -- off-market cascade A: creator's OTHER overlapping scheduled instances auto-close
  perform match_autoclose_creator_conflicts(cre, inst, rng);
  -- off-market cascade B: matched user auto-withdrawn from conflicting offers/standbys (throttled in Task 6)
  perform match_autowithdraw_user_conflicts(cand, rng, inst);

  -- notifications (C1 enum: new_match) + analytics (C11.8)
  perform dispatch_notification(cand, 'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));
  perform dispatch_notification(cre,  'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));
  insert into analytics_events(event_type, actor_id, payload)
  values ('match_lock_created', p_actor, jsonb_build_object('instance', inst, 'lock_id', lid, 'is_seed', is_seed));
  if is_seed then  -- MD9: seed/concierge night locked
    insert into analytics_events(event_type, actor_id, payload)
    values ('match_seed_night_locked', p_actor, jsonb_build_object('instance', inst, 'lock_id', lid));
  end if;

  perform match_idem_store(p_actor, 'accept_offer', p_idem_key,
                           jsonb_build_object('lock_id', lid, 'instance', inst, 'status','locked'));
  return lid;
end $fn$;

-- Creator's other scheduled instances that overlap the locked window auto-close (spec §7.4).
create or replace function match_autoclose_creator_conflicts(p_creator uuid, p_keep_instance uuid, p_rng tstzrange)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int;
begin
  update date_instances
     set status='cancelled'
   where creator_id=p_creator and id<>p_keep_instance
     and status='seeking' and time_range && p_rng;
  get diagnostics n = row_count;
  -- any active offers on those now-closed instances are expired (their holders auto-roll elsewhere is N/A)
  update offers set status='expired', resolved_at=now()
   where status='active' and date_instance_id in (
     select id from date_instances where creator_id=p_creator and status='cancelled' and time_range && p_rng
   );
  return n;
end $fn$;
```

> `match_autowithdraw_user_conflicts` is **defined in Task 6** alongside the throttle (it withdraws the matched user from *other* creators' queues without collapsing them). Postgres resolves function bodies at call time, not creation time, so the forward reference is fine as long as both migrations are applied before any call. They are (both run in `db reset`). The Task 5 `.sql` tests do not create cross-creator conflicts, so they never call the Task-6 function.

> **Seed-night acceptance handling (MD9 — depends on S5).** S5 (browse & interest) defines cold-start concierge ("we'll line you up") seed instances via `date_instances.is_seed = true` and the seed swipe/acceptance path. P5 **honors** seed nights through the *same* `match_make_offer`/`match_accept_offer` path — there is no separate seed lock function. The only P5-side specialization: on a seed-night lock, emit an additional `analytics_events('match_seed_night_locked', …)` so cold-start conversion is measurable (DU3). P5 does **not** create seed instances, define `is_seed`, or own the "you're in line" UI — those are S5. Cross-stage: **Depends on S5** for `is_seed` and seed-night source data.

- [ ] **Step 4: Apply + run the three `.sql` tests, expect PASS.** Then run the race test:
`chmod +x supabase/tests/p5_race_two_accepts.sh && supabase db reset && supabase/tests/p5_race_two_accepts.sh` → expect `PASS: two-accept race → 1 lock, 1 OFFER_NOT_ACTIVE`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525126500_p5_accept_lock.sql supabase/tests/p5_accept_lock.sql supabase/tests/p5_accept_idempotent.sql supabase/tests/p5_seed_night_accept.sql supabase/tests/p5_race_two_accepts.sh
git commit -m "P5: match_accept_offer→lock (chat_lock_ready + can_enter_lock_flow + promote + cascade + idempotent), seed-night handling, two-accept race"
```

---

## Task 6: `match_pass_offer`/`match_expire_offer` → auto-roll, cascade throttle, and `match_withdraw`

**Files:**
- Create: `supabase/migrations/20260525126600_p5_pass_expire_roll.sql`
- Test: `supabase/tests/p5_pass_roll.sql`
- Test: `supabase/tests/p5_cascade_throttle.sql`
- Test: `supabase/tests/p5_withdraw.sql`
- Test: `supabase/tests/p5_race_expiry_vs_accept.sh`

> **C2 signatures:** `match_pass_offer(p_actor uuid, p_offer uuid)`, `match_expire_offer(p_offer uuid)`, `match_auto_roll(p_instance uuid)`, `match_next_standby(p_instance uuid) returns uuid`, and **`match_withdraw(p_actor uuid, p_instance uuid)` (NEW — C2/C11.4; replaces the fictional `withdraw_from_queue`)**. The S2 `standby_roll` job handler dispatches to `match_auto_roll` (C1/C2: auto-roll "enqueues discrete `standby_roll` jobs (throttled); never synchronously cascades").

### Design decisions locked (spec §7.3, §7.6; C2, C11.7; audit "cascading auto-withdrawals")
- **Auth (C10):** `match_pass_offer`/`match_withdraw` assert `p_actor = auth.uid()`. `match_expire_offer` is called by the S2 `offer_expiry` job handler (service-role) and by no client — its grant is service_role (Task 9) and it derives no actor.
- **`match_pass_offer(p_actor, p_offer)`** (the offer-holder declines) and **`match_expire_offer(p_offer)`** (the S2 `offer_expiry` handler calls this when the timer fires) share one **internal** `match_resolve_offer_negative(offer, terminal_status)` that, under the instance advisory lock: re-reads the offer, **no-ops if already resolved** (idempotent against double-fire), sets offer + queue entry to `offer_passed`/`offer_expired`, **closes the chat thread (`close_chat_thread(offer)`, C11.7)**, moves the candidate to `standby`, then calls `match_auto_roll(instance)`.
- **`match_auto_roll(instance)`** picks `match_next_standby` (lowest-rank shortlisted) and, if present, makes them the new offer (same advisory lock context, atomic with the resolution). If none, the instance stays `seeking` with no active offer. **For cross-instance cascades it enqueues discrete `standby_roll` jobs (C2) — it never synchronously cascades into another lock.**
- **Offer-expiry-vs-accept race:** both `match_accept_offer` and `match_expire_offer` take the instance advisory lock and re-read `offer.status`. Whichever wins commits its terminal state; the loser sees a non-`active` offer and no-ops (expire) / raises `OFFER_NOT_ACTIVE` (accept). **No lost lock, no double-roll.** This is the *production* race because the S2 `offer_expiry` handler calls `match_expire_offer` (reconciliation checklist P2) — not a P5-internal-only path.
- **Cascade-withdrawal throttle (fix for "cascading auto-withdrawals collapse other queues"):** when a user locks date X, they are auto-withdrawn from conflicting offers/standbys on *other* instances. The throttle:
  1. **Per-window, not global:** auto-withdraw only from offers/standbys whose `time_range` **overlaps** the newly-locked window.
  2. **Deferred roll via the C1 `standby_roll` job:** when an auto-withdrawal vacates an `offer_active` slot on another instance, we **do not** roll inline; we `enqueue_job('standby_roll', now(), jsonb_build_object('instance', inst), dedup => 'standby_roll:'||inst)`. The S2 handler dispatches `standby_roll → match_auto_roll(instance)`. This breaks the synchronous chain into discrete, throttleable steps. (The old `auto_roll` job kind was **not in the C1 enum and had no consumer** — audit C4/C5 — and is **REMOVED**; `standby_roll` is the C1 kind with a real S2 consumer.)
  3. **Per-actor withdrawal cap:** a single lock transaction withdraws at most `K` (default 25) conflicting entries; beyond that it enqueues a C1 `bulk_withdraw` job to finish asynchronously. The standby-drop `UPDATE` is also bounded so one popular user cannot do unbounded work in one transaction.
- **`match_autowithdraw_user_conflicts(user, rng, keep_instance)`** (internal) implements 1–3.
- **`match_withdraw(p_actor, p_instance)` (C2/C11.4):** a user voluntarily withdraws themselves from a single instance's queue/offer. If they currently hold the active offer, it resolves negative (→ `match_resolve_offer_negative`, which closes chat + auto-rolls); otherwise it drops their `queue_entries` row to a withdrawn/`offer_passed` terminal. Emits analytics + notifies the creator. S10 (account lifecycle) and users call this — it is the canonical replacement for `withdraw_from_queue` (CV2).
- **Notification-type mapping:** creator "candidate withdrew" uses a C1 `notification_type` enum member (e.g. `standby_promoted` is for promotion; for withdrawal there is no dedicated member, so P5 either folds it into an existing applicable member or raises a **contract amendment to add one to C1** — it never emits a free string like `'candidate_withdrawn'`). Pending the amendment, the creator-facing withdrawal notice may be omitted rather than emit an invalid type.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p5_pass_roll.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid; oid uuid; newoid uuid;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1'); c2 := mk_user('cand2');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2,2);
  oid := match_make_offer(cre, inst, c1, 'idem-offer-1');

  -- c1 passes → c1 to standby/offer_passed, chat closed, auto-roll makes a NEW offer to c2
  perform set_config('request.jwt.claims', json_build_object('sub',c1)::text, true);
  perform match_pass_offer(c1, oid);
  PERFORM 1 FROM offers WHERE id=oid AND status='passed';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not passed'; END IF;
  -- chat thread for the passed offer is closed (C11.7)
  PERFORM 1 FROM chat_threads WHERE offer_id=oid AND closed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'close_chat_thread not called on pass'; END IF;
  select id into newoid from offers where date_instance_id=inst and status='active';
  IF newoid IS NULL THEN RAISE EXCEPTION 'auto-roll did not create new offer'; END IF;
  PERFORM 1 FROM queue_entries WHERE date_instance_id=inst AND candidate_id=c2 AND status='offer_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'c2 not rolled to offer_active'; END IF;
  -- c1 reveal auto-revoked (no longer active holder)
  IF match_reveal_allowed(c1, inst) THEN RAISE EXCEPTION 'LEAK: passed holder still revealed'; END IF;

  -- expire is idempotent: expiring an already-passed offer no-ops
  IF match_expire_offer(oid) <> 0 THEN RAISE EXCEPTION 'expire of resolved offer did work'; END IF;
  RAISE NOTICE 'pass→auto-roll OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_cascade_throttle.sql
-- Two creators, one user who is offer_active on BOTH overlapping nights; locking one must
-- (a) withdraw the user from the other overlapping offer, (b) DEFER that date's roll to a
-- C1 standby_roll job, not roll inline (no synchronous cascade).
\i supabase/tests/_fixtures.sql
DO $$
DECLARE creA uuid; creB uuid; u uuid; itA uuid; itB uuid; instA uuid; instB uuid; oidA uuid; oidB uuid; jrolls int; starts timestamptz;
BEGIN
  creA := mk_user('creatorA'); creB := mk_user('creatorB'); u := mk_user('cand1');
  starts := now()+interval '3 days';
  itA := mk_itinerary(creA); instA := mk_instance(itA, creA, starts);
  itB := mk_itinerary(creB); instB := mk_instance(itB, creB, starts);   -- overlapping window
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values
    (u,instA,creA,'right'),(u,instB,creB,'right');
  perform match_ingest_interest(instA); perform match_ingest_interest(instB);
  perform set_config('request.jwt.claims', json_build_object('sub',creA)::text, true);
  perform match_shortlist(creA,instA,u,1);
  oidA := match_make_offer(creA, instA, u, 'offA');
  perform set_config('request.jwt.claims', json_build_object('sub',creB)::text, true);
  perform match_shortlist(creB,instB,u,1);
  oidB := match_make_offer(creB, instB, u, 'offB');   -- allowed: offer != lock; double-booking only forbidden at lock

  -- u locks A → must auto-withdraw from B's offer AND defer B's roll to a C1 standby_roll job (not inline)
  perform set_config('request.jwt.claims', json_build_object('sub',u)::text, true);
  perform match_accept_offer(u, oidA, 'cascade-1');
  PERFORM 1 FROM offers WHERE id=oidB AND status IN ('passed','expired');  -- B's offer to u withdrawn
  IF NOT FOUND THEN RAISE EXCEPTION 'B offer to u not withdrawn'; END IF;
  -- B's roll is DEFERRED: a C1 standby_roll job exists (dedup=standby_roll:instB), but no NEW active offer inline
  select count(*) into jrolls from jobs where type='standby_roll' and dedup_key='standby_roll:'||instB and status='pending';
  IF jrolls <> 1 THEN RAISE EXCEPTION 'B roll not deferred to a standby_roll job (%).', jrolls; END IF;
  PERFORM 1 FROM offers WHERE date_instance_id=instB AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'CASCADE: B rolled inline instead of via deferred standby_roll job'; END IF;
  RAISE NOTICE 'cascade throttle OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_withdraw.sql  (C2/C11.4: match_withdraw)
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid; oid uuid;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1'); c2 := mk_user('cand2');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2,2);
  oid := match_make_offer(cre, inst, c1, 'idem-offer-1');

  -- c1 (the active offer-holder) withdraws → offer resolves negative, chat closes, auto-roll to c2
  perform set_config('request.jwt.claims', json_build_object('sub',c1)::text, true);
  perform match_withdraw(c1, inst);
  PERFORM 1 FROM offers WHERE id=oid AND status IN ('passed','expired');
  IF NOT FOUND THEN RAISE EXCEPTION 'withdraw did not resolve the active offer'; END IF;
  PERFORM 1 FROM offers WHERE date_instance_id=inst AND candidate_id=c2 AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'auto-roll to c2 did not occur after withdraw'; END IF;
  PERFORM 1 FROM analytics_events WHERE event_type='match_withdrawn';
  IF NOT FOUND THEN RAISE EXCEPTION 'withdraw analytics not emitted'; END IF;
  RAISE NOTICE 'withdraw OK';
  ROLLBACK;
END $$;
```

```bash
# supabase/tests/p5_race_expiry_vs_accept.sh
#!/usr/bin/env bash
# Offer-expiry worker fires AT THE SAME TIME as the holder accepts. Exactly one wins:
# either lock created (accept won) OR offer expired+rolled (expire won) — never both, never neither.
set -euo pipefail
source "$(dirname "$0")/p5_concurrency_lib.sh"
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
\i supabase/tests/_fixtures.sql
do $$ declare cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid; oid uuid;
begin
  cre := mk_user('creator'); c1 := mk_user('cand1'); c2 := mk_user('cand2');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2,2);
  oid := match_make_offer(cre,inst,c1,'race-offer');
  insert into temp_race(k,v) values ('oid',oid::text),('c1',c1::text) on conflict (k) do update set v=excluded.v;
end $$;
SQL
OID=$(psql "$DB" -t -A -c "select v from temp_race where k='oid'")
C1=$(psql "$DB" -t -A -c "select v from temp_race where k='c1'")
# accept runs as the candidate; expire runs as the S2 service-role job handler (no actor)
echo "select set_config('request.jwt.claims', json_build_object('sub','$C1')::text, false); select match_accept_offer('$C1','$OID','race-acc');" > /tmp/p5_ax.sql
echo "select match_expire_offer('$OID');"                  > /tmp/p5_ex.sql
PA=$(psql_bg /tmp/p5_ax.sql /tmp/p5_ax.out)
PB=$(psql_bg /tmp/p5_ex.sql /tmp/p5_ex.out)
wait $PA $PB || true
LOCKED=$(psql "$DB" -t -A -c "select count(*) from locks where date_instance_id=(select date_instance_id from offers where id='$OID')")
OSTATUS=$(psql "$DB" -t -A -c "select status from offers where id='$OID'")
# Exactly one outcome holds:
if { [ "$LOCKED" = "1" ] && [ "$OSTATUS" = "accepted" ]; } || { [ "$LOCKED" = "0" ] && [ "$OSTATUS" = "expired" ]; }; then
  echo "PASS: expiry-vs-accept consistent (locked=$LOCKED, offer=$OSTATUS)"
else
  echo "FAIL: inconsistent (locked=$LOCKED, offer=$OSTATUS)"; cat /tmp/p5_ax.out /tmp/p5_ex.out; exit 1
fi
```

- [ ] **Step 2: Run all, expect FAIL** (`function match_pass_offer(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525126600_p5_pass_expire_roll.sql

-- INTERNAL: resolve an active offer to a terminal negative state, close its chat, then auto-roll. Idempotent.
create or replace function match_resolve_offer_negative(p_offer uuid, p_terminal offer_status)
returns int language plpgsql security definer set search_path=public as $fn$
declare inst uuid; cand uuid; ostatus offer_status;
begin
  select date_instance_id, candidate_id, status into inst, cand, ostatus from offers where id=p_offer;
  if inst is null then return 0; end if;
  perform pg_advisory_xact_lock(match_instance_lock_key(inst));
  -- re-read under lock; no-op if already resolved (handles double-fire / expiry-after-accept)
  select status into ostatus from offers where id=p_offer for update;
  if ostatus <> 'active' then return 0; end if;

  update offers set status=p_terminal, resolved_at=now() where id=p_offer;
  update queue_entries
     set status = case when p_terminal='passed' then 'offer_passed'::queue_status
                       else 'offer_expired'::queue_status end
   where date_instance_id=inst and candidate_id=cand;
  -- candidate goes to standby (eligible for future rolls) per spec §7.1
  update queue_entries set status='standby' where date_instance_id=inst and candidate_id=cand;
  perform close_chat_thread(p_offer);                       -- C11.7: chat closes on pass/expire
  perform cancel_jobs('offer_expiry', p_offer::text);       -- C1 cancel_jobs (dedup=offer id)

  perform match_auto_roll(inst);   -- inline roll for THIS instance that just freed up (single instance, no cascade)
  return 1;
end $fn$;

-- C2 PUBLIC: offer-holder declines.
create or replace function match_pass_offer(p_actor uuid, p_offer uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare cand uuid;
begin
  if p_actor is distinct from auth.uid() then raise exception 'NOT_AUTHENTICATED'; end if;  -- C10
  select candidate_id into cand from offers where id=p_offer;
  if cand is null then raise exception 'NO_OFFER'; end if;
  if cand <> p_actor then raise exception 'NOT_OFFER_HOLDER'; end if;
  insert into analytics_events(event_type, actor_id, payload)
  values ('match_offer_passed', p_actor, jsonb_build_object('offer', p_offer));
  return match_resolve_offer_negative(p_offer, 'passed');
end $fn$;

-- C2 PUBLIC (service-role only — Task 9): S2 offer_expiry handler calls this when the timer fires.
-- Idempotent no-op if already resolved. No p_actor — runs as the job runner.
create or replace function match_expire_offer(p_offer uuid)
returns int language plpgsql security definer set search_path=public as $fn$
begin
  return match_resolve_offer_negative(p_offer, 'expired');
end $fn$;

-- C2 PUBLIC: promote the next standby to a fresh offer. Single-instance; caller holds/takes the advisory lock.
-- Cross-instance cascades are NOT done here — they are enqueued as discrete C1 standby_roll jobs.
create or replace function match_auto_roll(p_instance uuid)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare nxt uuid; cre uuid; st date_match_status; oid uuid; cutoff timestamptz; nxt_idem text;
begin
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  select creator_id, status, starts_at into cre, st, cutoff from date_instances where id=p_instance for update;
  if st <> 'seeking' then return null; end if;                 -- already matched/cancelled
  if exists (select 1 from offers where date_instance_id=p_instance and status='active') then return null; end if;
  -- freeze rollover within the cutoff window before the night (spec §7.6)
  if cutoff < now() + interval '2 hours' then return null; end if;
  -- freeze entirely if any non-dismissed report exists on this instance (spec §7.6; C5 reports schema)
  if exists (select 1 from reports where target_type='date_instance' and target_id=p_instance and status<>'dismissed') then
    return null;
  end if;

  -- promote next standby back to shortlisted then offer them
  nxt := match_next_standby(p_instance);
  if nxt is null then
    -- also consider candidates parked in 'standby' (from prior passes), lowest rank first
    select candidate_id into nxt from queue_entries
      where date_instance_id=p_instance and status='standby'
      order by rank nulls last, created_at limit 1;
  end if;
  if nxt is null then return null; end if;
  -- skip candidates who are no longer eligible to enter the lock flow (C3)
  if not can_enter_lock_flow(nxt) then return null; end if;
  update queue_entries set status='shortlisted' where date_instance_id=p_instance and candidate_id=nxt;
  -- match_make_offer requires an idem key; auto-roll mints a deterministic one per (instance,candidate)
  nxt_idem := 'autoroll:'||p_instance::text||':'||nxt::text;
  -- act as the creator for the nested offer (definer context; make_offer asserts p_actor=auth.uid()).
  -- match_auto_roll is invoked either by the S2 standby_roll handler (service-role) or inline from a
  -- resolve under the creator's advisory lock; the nested make_offer is called with the creator id and
  -- a definer-set claim. NOTE: if auth.uid() cannot be set in the runner context, expose an internal
  -- _match_make_offer(creator,...) that skips the auth.uid() assertion and is service-role-only (Task 9),
  -- and have both match_make_offer and match_auto_roll delegate to it. (Conform to S2 runner's auth model.)
  oid := match_make_offer(cre, p_instance, nxt, nxt_idem);
  return oid;
end $fn$;

-- INTERNAL: throttled cross-instance withdrawal (called by accept). DEFERS other instances' rolls to C1 jobs.
create or replace function match_autowithdraw_user_conflicts(p_user uuid, p_rng tstzrange, p_keep_instance uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare rec record; withdrawn int := 0; cap int := 25; dropped int;
begin
  for rec in
    select o.id as offer_id, o.date_instance_id as inst
      from offers o join date_instances di on di.id=o.date_instance_id
     where o.candidate_id=p_user and o.status='active'
       and o.date_instance_id<>p_keep_instance
       and di.time_range && p_rng                       -- per-window only (throttle #1)
     order by o.created_at
  loop
    exit when withdrawn >= cap;                          -- per-actor cap (throttle #3)
    -- withdraw the user from this conflicting OFFER, but DO NOT roll inline (throttle #2)
    update offers set status='expired', resolved_at=now() where id=rec.offer_id and status='active';
    update queue_entries set status='standby' where date_instance_id=rec.inst and candidate_id=p_user;
    perform close_chat_thread(rec.offer_id);                            -- C11.7
    perform cancel_jobs('offer_expiry', rec.offer_id::text);           -- C1
    -- DEFER the roll via the C1 standby_roll job (real S2 consumer dispatches → match_auto_roll)
    perform enqueue_job('standby_roll', now(), jsonb_build_object('instance', rec.inst), 'standby_roll:'||rec.inst);
    withdrawn := withdrawn + 1;
  end loop;
  -- also drop the user from overlapping standbys (no active offer to roll), bounded by cap (throttle #3)
  with picked as (
    select q.ctid from queue_entries q join date_instances di on di.id=q.date_instance_id
     where q.candidate_id=p_user and q.status in ('shortlisted','standby')
       and di.time_range && p_rng and di.id<>p_keep_instance
     limit cap
  )
  update queue_entries q set status='offer_passed' from picked where q.ctid=picked.ctid;
  get diagnostics dropped = row_count;
  if withdrawn >= cap or dropped >= cap then
    -- overflow finished asynchronously via the C1 bulk_withdraw job
    perform enqueue_job('bulk_withdraw', now(),
                        jsonb_build_object('user',p_user,'range',p_rng::text,'keep',p_keep_instance), null);
  end if;
  return withdrawn;
end $fn$;

-- C2/C11.4 PUBLIC: user voluntarily withdraws from one instance's queue/offer (replaces withdraw_from_queue).
create or replace function match_withdraw(p_actor uuid, p_instance uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare oid uuid; cre uuid;
begin
  if p_actor is distinct from auth.uid() then raise exception 'NOT_AUTHENTICATED'; end if;  -- C10
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  select creator_id into cre from date_instances where id=p_instance;
  if cre is null then raise exception 'NO_INSTANCE'; end if;
  -- if the actor holds the active offer, resolve it negative (closes chat + auto-rolls)
  select id into oid from offers
    where date_instance_id=p_instance and candidate_id=p_actor and status='active';
  if oid is not null then
    perform match_resolve_offer_negative(oid, 'passed');
  else
    update queue_entries set status='offer_passed'
      where date_instance_id=p_instance and candidate_id=p_actor
        and status in ('interested','shortlisted','standby');
  end if;
  insert into analytics_events(event_type, actor_id, payload)
  values ('match_withdrawn', p_actor, jsonb_build_object('instance', p_instance));
end $fn$;
```

> **Note on `match_auto_roll` calling `match_make_offer`:** both take the same instance advisory lock; `pg_advisory_xact_lock` is re-entrant within a transaction, so the nested acquisition is safe and the whole roll is atomic. The nested `make_offer` call must run with the creator as the effective actor — since `make_offer` asserts `p_actor = auth.uid()` (C10), the implementation delegates to a service-role-only internal `_match_make_offer(creator,…)` that both `match_make_offer` (after its auth assertion) and `match_auto_roll`/the S2 `standby_roll` runner call. This keeps the public auth gate intact while allowing the job runner (which has no end-user `auth.uid()`) to roll. The exact split conforms to S2's job-runner auth model.

- [ ] **Step 4: Apply + run the three `.sql` tests, expect PASS.** Then the race test:
`chmod +x supabase/tests/p5_race_expiry_vs_accept.sh && supabase db reset && supabase/tests/p5_race_expiry_vs_accept.sh` → expect `PASS: expiry-vs-accept consistent`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525126600_p5_pass_expire_roll.sql supabase/tests/p5_pass_roll.sql supabase/tests/p5_cascade_throttle.sql supabase/tests/p5_withdraw.sql supabase/tests/p5_race_expiry_vs_accept.sh
git commit -m "P5: pass/expire→auto-roll (standby_roll jobs), cascade throttle, match_withdraw, expiry-vs-accept race test"
```

---

## Task 7: Reciprocal-pair detection → single chooser

**Files:**
- Create: `supabase/migrations/20260525126700_p5_reciprocal.sql`
- Test: `supabase/tests/p5_reciprocal.sql`

> **C2/C11.4 signature:** `match_resolve_reciprocal(p_actor uuid, p_pair_id uuid, p_chosen_instance uuid)`. (The contract param is `p_pair_id`, not `p_pair`, and the public signature carries **no** `p_idem_key`. Idempotency is kept internal: the function derives a deterministic idem key from `(p_actor, p_pair_id)` for the underlying `match_accept_offer` call. Do not add `p_idem_key` to the public surface.)

### Design decisions locked (spec §7.5; C2/C11.4)
- **Auth (C10):** `match_resolve_reciprocal` asserts `p_actor = auth.uid()`; `match_detect_reciprocal` is an **internal helper** (revoke from authenticated — it must never be client-callable, or any user could fabricate `reciprocal_pairs` rows and spam notifications; audit §6).
- **Detection:** A reciprocal pair exists when A is `shortlisted`/`offer_active` on one of B's instances **and** B is `shortlisted`/`offer_active` on one of A's instances. We detect at shortlist/offer time via internal `match_detect_reciprocal(userX, userY)`; if found, we record one `reciprocal_pairs` row keyed by canonical ordering (`low_user`, `high_user`).
- **Chooser, not double-lock:** the pair gets **one** chooser. `match_resolve_reciprocal(p_actor, p_pair_id, p_chosen_instance)` (idempotent via a derived internal key) locks the chosen instance via the normal `match_accept_offer` path (creating an offer if needed, then accepting) and **closes the other side**. Both must be parties to the pair; the chosen instance must belong to one of them.
- **Advisory lock on the canonical pair** serializes the chooser so two near-simultaneous resolutions can't both lock.
- **DOUBLE_BOOKED handling (audit §4):** if the underlying accept raises `DOUBLE_BOOKED` (the pair's nights overlap and one side is already locked), `match_resolve_reciprocal` catches it, leaves the pair `open` with no half-applied offer, and re-raises a mapped `RECIPROCAL_DOUBLE_BOOKED` so the Edge layer returns 409 and the pair can be retried with the other night. No partial state.
- **No duplicate competing matches:** after resolution the losing instance's cross-pair candidacy is closed; the GiST exclusion independently prevents the pair from double-booking overlapping windows.

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p5_reciprocal.sql
\i supabase/tests/_fixtures.sql
DO $$
DECLARE A uuid; B uuid; itA uuid; itB uuid; instA uuid; instB uuid; pair uuid; lid uuid;
BEGIN
  A := mk_user('userA'); B := mk_user('userB');
  itA := mk_itinerary(A); instA := mk_instance(itA, A, now()+interval '3 days');
  itB := mk_itinerary(B); instB := mk_instance(itB, B, now()+interval '5 days');  -- non-overlapping nights
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values
    (B,instA,A,'right'),     -- B likes A's night
    (A,instB,B,'right');     -- A likes B's night
  perform match_ingest_interest(instA); perform match_ingest_interest(instB);
  perform set_config('request.jwt.claims', json_build_object('sub',A)::text, true);
  perform match_shortlist(A,instA,B,1);   -- A shortlists B on A's night
  perform set_config('request.jwt.claims', json_build_object('sub',B)::text, true);
  perform match_shortlist(B,instB,A,1);   -- B shortlists A on B's night → reciprocal detected!

  select id into pair from reciprocal_pairs
    where low_user=least(A,B) and high_user=greatest(A,B);
  IF pair IS NULL THEN RAISE EXCEPTION 'reciprocal pair not detected'; END IF;

  -- A resolves the chooser by picking A's night (instA)
  perform set_config('request.jwt.claims', json_build_object('sub',A)::text, true);
  lid := match_resolve_reciprocal(A, pair, instA);   -- C11.4: returns the lock uuid
  PERFORM 1 FROM locks WHERE id=lid AND status='active'
    AND ((creator_id=A AND matched_user_id=B) OR (creator_id=B AND matched_user_id=A));
  IF NOT FOUND THEN RAISE EXCEPTION 'chooser did not lock chosen night'; END IF;
  -- the other night (instB) is closed for THIS pair (no competing active offer to this pair)
  PERFORM 1 FROM offers WHERE date_instance_id=instB AND candidate_id IN (A,B) AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'competing offer still active on losing night'; END IF;
  PERFORM 1 FROM analytics_events WHERE event_type='match_reciprocal_resolved';
  IF NOT FOUND THEN RAISE EXCEPTION 'reciprocal analytics not emitted'; END IF;

  -- idempotent resolve (same actor+pair → same lock)
  IF match_resolve_reciprocal(A, pair, instA) <> lid
    THEN RAISE EXCEPTION 'reciprocal resolve not idempotent'; END IF;
  RAISE NOTICE 'reciprocal OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL** (`relation "reciprocal_pairs" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525126700_p5_reciprocal.sql
create table if not exists reciprocal_pairs (
  id uuid primary key default gen_random_uuid(),
  low_user uuid not null references profiles(id) on delete cascade,
  high_user uuid not null references profiles(id) on delete cascade,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (low_user < high_user),
  unique (low_user, high_user)
);
alter table reciprocal_pairs enable row level security;
do $$ begin
  create policy "reciprocal_party_read" on reciprocal_pairs for select
    using (low_user = auth.uid() or high_user = auth.uid());
exception when duplicate_object then null; end $$;

-- INTERNAL helper (revoke from authenticated, Task 9): detect both-way candidacy.
-- Both users are real candidates (shortlisted/offer_active) on each other's instances.
create or replace function match_detect_reciprocal(p_x uuid, p_y uuid)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare lo uuid := least(p_x,p_y); hi uuid := greatest(p_x,p_y); pid uuid;
begin
  if p_x = p_y then return null; end if;
  if not exists (
    select 1 from queue_entries qx join date_instances dx on dx.id=qx.date_instance_id
     where qx.candidate_id=p_x and dx.creator_id=p_y and qx.status in ('shortlisted','offer_active')
  ) or not exists (
    select 1 from queue_entries qy join date_instances dy on dy.id=qy.date_instance_id
     where qy.candidate_id=p_y and dy.creator_id=p_x and qy.status in ('shortlisted','offer_active')
  ) then
    return null;
  end if;
  insert into reciprocal_pairs(low_user, high_user) values (lo, hi)
    on conflict (low_user, high_user) do nothing
    returning id into pid;
  if pid is null then select id into pid from reciprocal_pairs where low_user=lo and high_user=hi; end if;
  -- notify both parties (C1 notification_type — use the applicable enum member; never a free string)
  perform dispatch_notification(lo, 'new_match', jsonb_build_object('reciprocal_pair', pid));
  perform dispatch_notification(hi, 'new_match', jsonb_build_object('reciprocal_pair', pid));
  return pid;
end $fn$;
```

> **Reciprocity detection is folded into `match_shortlist`, not a second public RPC.** The old public `match_shortlist_with_reciprocal` is **REMOVED** — it duplicated the C2 `match_shortlist` surface (the Edge `match-shortlist` function called it). Instead, `match_shortlist` (Task 2) ends with `perform match_detect_reciprocal(creator, candidate);` so detection fires on every shortlist with no extra public name. Detection is also acceptably narrow at shortlist time (audit §4 notes offer-time reciprocity is rare; if needed it can also be called from `match_make_offer` — left as a follow-up, not a new public API). Add this one line to Task 2's `match_shortlist` body (canonical reference; do not create a separate function).

```sql
-- Resolve the chooser (C11.4): lock the chosen instance; close the competing side. Idempotent (derived key).
create or replace function match_resolve_reciprocal(p_actor uuid, p_pair_id uuid, p_chosen_instance uuid)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare lo uuid; hi uuid; pstatus text; prior jsonb; cre uuid; cand uuid; oid uuid; lid uuid;
        idem text := 'recip:'||p_pair_id::text||':'||p_actor::text;
begin
  if p_actor is distinct from auth.uid() then raise exception 'NOT_AUTHENTICATED'; end if;  -- C10
  prior := match_idem_lookup(p_actor, 'resolve_reciprocal', idem);
  if prior is not null then return (prior->>'lock_id')::uuid; end if;

  select low_user, high_user, status into lo, hi, pstatus from reciprocal_pairs where id=p_pair_id;
  if lo is null then raise exception 'NO_PAIR'; end if;
  if p_actor not in (lo,hi) then raise exception 'NOT_PARTY'; end if;

  perform pg_advisory_xact_lock(match_pair_lock_key(lo,hi));
  select status into pstatus from reciprocal_pairs where id=p_pair_id for update;
  if pstatus='resolved' then  -- another concurrent resolve won; replay if this actor has a stored result
    prior := match_idem_lookup(p_actor,'resolve_reciprocal',idem);
    if prior is not null then return (prior->>'lock_id')::uuid; end if;
    raise exception 'PAIR_ALREADY_RESOLVED';
  end if;

  -- the chosen instance must belong to one of the pair; the other party is the candidate
  select creator_id into cre from date_instances where id=p_chosen_instance;
  if cre is null or cre not in (lo,hi) then raise exception 'CHOSEN_NOT_OWNED_BY_PAIR'; end if;
  cand := case when cre=lo then hi else lo end;

  -- ensure an active offer to the candidate exists on the chosen night (create if needed).
  -- make_offer asserts auth.uid()=creator; the creator may not be p_actor, so use the internal
  -- _match_make_offer(creator,…) service-role helper (same one match_auto_roll uses).
  select id into oid from offers where date_instance_id=p_chosen_instance and candidate_id=cand and status='active';
  if oid is null then
    update queue_entries set status='shortlisted'
      where date_instance_id=p_chosen_instance and candidate_id=cand and status in ('interested','standby');
    if not exists (select 1 from queue_entries where date_instance_id=p_chosen_instance and candidate_id=cand) then
      insert into queue_entries(date_instance_id,candidate_id,creator_id,status)
      values (p_chosen_instance, cand, cre, 'shortlisted');
    end if;
    oid := _match_make_offer(cre, p_chosen_instance, cand, idem||':offer');
  end if;

  -- accept it (reuses the full lock path). Catch DOUBLE_BOOKED → leave pair OPEN, no partial state (audit §4).
  begin
    lid := _match_accept_offer(cand, oid, idem);   -- internal accept that skips the auth.uid() check (service path)
  exception when others then
    if SQLERRM like '%DOUBLE_BOOKED%' then
      raise exception 'RECIPROCAL_DOUBLE_BOOKED';   -- pair stays open; Edge → 409; retry other night
    end if;
    raise;
  end;

  -- close the competing side: expire any active offers between this pair on OTHER instances
  update offers o set status='expired', resolved_at=now()
    from date_instances di
   where o.date_instance_id=di.id and o.status='active'
     and o.date_instance_id<>p_chosen_instance
     and ((di.creator_id=lo and o.candidate_id=hi) or (di.creator_id=hi and o.candidate_id=lo));

  update reciprocal_pairs set status='resolved', resolved_at=now() where id=p_pair_id;
  insert into analytics_events(event_type, actor_id, payload)
  values ('match_reciprocal_resolved', p_actor,
          jsonb_build_object('pair', p_pair_id, 'chosen_instance', p_chosen_instance, 'lock_id', lid));
  perform match_idem_store(p_actor, 'resolve_reciprocal', idem, jsonb_build_object('lock_id', lid));
  return lid;
end $fn$;
```

> **`_match_make_offer` / `_match_accept_offer`:** these are the internal, service-role-only siblings of the public C2 RPCs that skip the `p_actor = auth.uid()` assertion (so the chooser / job-runner can act on behalf of a creator/candidate without an end-user JWT). The public C2 functions delegate to them after asserting auth. Both are `revoke execute from public, authenticated` (Task 9). This is the only way to honor both the C10 auth gate (public surface) and definer-context server-side resolution.

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525126700_p5_reciprocal.sql supabase/tests/p5_reciprocal.sql
git commit -m "P5: reciprocal-pair detection (internal) + match_resolve_reciprocal chooser (C11.4, DOUBLE_BOOKED-safe)"
```

---

## Task 8: `match_cancel_lock(reason)` → SAFE auto-roll + creator-cancel-pre-lock (MD10)

**Files:**
- Create: `supabase/migrations/20260525126800_p5_cancel_safe_roll.sql`
- Test: `supabase/tests/p5_cancel_safe_roll.sql`
- Test: `supabase/tests/p5_cancel_freeze.sql`
- Test: `supabase/tests/p5_creator_cancel_pre_lock.sql`

> **C2 signature:** `match_cancel_lock(p_actor uuid, p_lock uuid, p_reason cancel_reason, p_idem_key text)`. The `cancel_reason` enum is **S1-owned, C2 shape**: `('schedule_conflict','venue_issue','changed_mind','account_closed','safety','misconduct','other')`. **`account_closed` is BENIGN (auto-roll)** per C2 — P5 does not define the enum and must treat `account_closed` as benign (this is what S10/account-deletion relies on; CV2/audit C7).

### Design decisions locked (spec §7.6; C2)
- **Auth (C10):** asserts `p_actor = auth.uid()`; must be a party to the lock (or, for account-deletion orchestrated cancels, called via the internal service path that S10 uses — see note).
- **Reason-coded.** Benign set per C2: **`schedule_conflict`, `venue_issue`, `changed_mind`, `account_closed`, `other` → auto-roll.** Freeze set: **`safety`, `misconduct` → no roll.**
- **Cancel always succeeds**; what differs is the **aftermath**:
  - Set `locks.status='cancelled'`, `cancelled_by`, `cancel_reason`. The S1 `sync_lock_participants` trigger flips `lock_participants.active=false` → the user's window frees (GiST exclusion no longer blocks).
  - Re-open the instance (`date_instances.status='seeking'`) **only for benign reasons** AND **outside the cutoff window** AND **only if no non-dismissed report** exists. Then **safe auto-roll** via both-party reconfirmation (see below).
  - For **freeze reasons** (`safety`, `misconduct`) OR within the cutoff OR if any non-dismissed report exists: **freeze rollover** — the instance goes to `cancelled`, no auto-roll; the moderation/report path is S8/S9.
- **Reconfirmation** (internal `match_reconfirm(actor, instance, idem_key)`): records each party's reconfirm; when both have reconfirmed, calls `match_auto_roll` (which re-applies the cutoff/report freeze guards as a final backstop). The reconfirm timer is enqueued via the **C1 `reconfirm_timeout` job** (a C1 `job_type`), not a P5-local kind.
- **Creator-cancels-own-date-pre-lock (MD10 — was entirely missing, audit C8).** A creator cancelling/deleting a `seeking` instance that has an active offer or standby queue must NOT silently strand candidates. `match_cancel_lock` handles *locked* dates; **MD10 adds `match_cancel_instance(p_actor, p_instance, p_reason)`** (creator-only) for the pre-lock case: it takes the instance advisory lock, resolves any active offer negative (closing chat + reveal auto-revokes), cancels the `offer_expiry` job (C1 `cancel_jobs`), notifies the offer-holder + standbys, drops their `queue_entries`, sets `date_instances.status='cancelled'`, and emits analytics. It does **not** auto-roll (the creator is withdrawing the whole date). This closes the C8 gap where a creator could directly `update status='cancelled'` and strand a revealed offer-holder.
- **Notifications (C1) + analytics (C11.8):** use C1 `notification_type` enum members only (`date_reconfirm` for the reconfirm request; `account` or the applicable member for cancellation — never a free string like `'lock_cancelled_frozen'`/`'reconfirm_requested'`). Emit an `analytics_events` row per cancel/freeze/reconfirm/creator-cancel transition.

- [ ] **Step 1: Write the failing tests**

```sql
-- supabase/tests/p5_cancel_safe_roll.sql  (benign reason → re-seek + reconfirm flow)
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid; oid uuid; lid uuid; st date_match_status;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1'); c2 := mk_user('cand2');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2,2);
  oid := match_make_offer(cre, inst, c1, 'idem-offer-1');
  perform set_config('request.jwt.claims', json_build_object('sub',c1)::text, true);
  lid := match_accept_offer(c1, oid, 'pre-cancel');

  -- benign cancel by creator (account_closed is ALSO benign — see p5_cancel test variants)
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  perform match_cancel_lock(cre, lid, 'schedule_conflict', 'cancel-1');
  PERFORM 1 FROM locks WHERE id=lid AND status='cancelled' AND cancel_reason='schedule_conflict';
  IF NOT FOUND THEN RAISE EXCEPTION 'lock not cancelled'; END IF;
  PERFORM 1 FROM lock_participants WHERE lock_id=lid AND active=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'participants not deactivated (window still blocked)'; END IF;
  select status into st from date_instances where id=inst;
  IF st <> 'seeking' THEN RAISE EXCEPTION 'instance did not re-seek (status=%).', st; END IF;
  -- no NEW offer until BOTH reconfirm
  PERFORM 1 FROM offers WHERE date_instance_id=inst AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'rolled inline before reconfirmation'; END IF;
  -- both reconfirm → next standby (c2) gets the offer
  perform match_reconfirm(cre, inst, 'rc-cre');
  perform set_config('request.jwt.claims', json_build_object('sub',c2)::text, true);
  perform match_reconfirm(c2,  inst, 'rc-c2');
  PERFORM 1 FROM offers WHERE date_instance_id=inst AND candidate_id=c2 AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'no offer after both reconfirm'; END IF;
  RAISE NOTICE 'cancel→safe-roll OK';
  ROLLBACK;
END $$;
```

> **`account_closed` benign coverage:** the same flow must hold when `p_reason='account_closed'` (C2). Add an assertion variant (or a sibling test) that `match_cancel_lock(..., 'account_closed', …)` re-seeks + reconfirms exactly like `schedule_conflict` — this is the path S10 account-deletion drives, and treating it as freeze would strand the night (audit C7).

```sql
-- supabase/tests/p5_cancel_freeze.sql  (safety reason → freeze, NO roll, instance cancelled)
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; c2 uuid; it uuid; inst uuid; oid uuid; lid uuid; st date_match_status;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1'); c2 := mk_user('cand2');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right'),(c2,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  perform match_shortlist(cre,inst,c2,2);
  oid := match_make_offer(cre, inst, c1, 'idem-offer-1');
  perform set_config('request.jwt.claims', json_build_object('sub',c1)::text, true);
  lid := match_accept_offer(c1, oid, 'pre-cancel2');

  -- safety cancel → freeze: instance cancelled, NO re-seek, NO roll
  perform match_cancel_lock(c1, lid, 'safety', 'cancel-safety');
  select status into st from date_instances where id=inst;
  IF st <> 'cancelled' THEN RAISE EXCEPTION 'safety cancel did not freeze instance (status=%).', st; END IF;
  PERFORM 1 FROM offers WHERE date_instance_id=inst AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'FREEZE VIOLATED: rolled after safety cancel'; END IF;
  -- reconfirm must be a no-op after a safety freeze
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  IF match_reconfirm(cre, inst, 'rc-x') <> false THEN RAISE EXCEPTION 'reconfirm worked after freeze'; END IF;
  RAISE NOTICE 'cancel freeze OK';
  ROLLBACK;
END $$;
```

```sql
-- supabase/tests/p5_creator_cancel_pre_lock.sql  (MD10: creator cancels own seeking date that has an active offer)
\i supabase/tests/_fixtures.sql
DO $$
DECLARE cre uuid; c1 uuid; it uuid; inst uuid; oid uuid; st date_match_status;
BEGIN
  cre := mk_user('creator'); c1 := mk_user('cand1');
  it := mk_itinerary(cre); inst := mk_instance(it, cre, now()+interval '3 days');
  perform set_config('request.jwt.claims', json_build_object('sub',cre)::text, true);
  insert into swipes(swiper_id,date_instance_id,creator_id,direction) values (c1,inst,cre,'right');
  perform match_ingest_interest(inst);
  perform match_shortlist(cre,inst,c1,1);
  oid := match_make_offer(cre, inst, c1, 'idem-offer-1');

  -- creator cancels the whole date pre-lock → active offer resolved, chat closed, expiry job cancelled,
  -- candidate's reveal revoked, instance cancelled, NO auto-roll
  perform match_cancel_instance(cre, inst, 'changed_mind');
  PERFORM 1 FROM offers WHERE id=oid AND status IN ('passed','expired');
  IF NOT FOUND THEN RAISE EXCEPTION 'active offer not resolved on creator-cancel-pre-lock'; END IF;
  select status into st from date_instances where id=inst;
  IF st <> 'cancelled' THEN RAISE EXCEPTION 'instance not cancelled (status=%).', st; END IF;
  IF match_reveal_allowed(c1, inst) THEN RAISE EXCEPTION 'LEAK: candidate still revealed after creator cancel'; END IF;
  PERFORM 1 FROM jobs WHERE type='offer_expiry' AND dedup_key=oid::text AND status='cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'expiry job not cancelled on creator-cancel-pre-lock'; END IF;
  -- it must NOT auto-roll (creator withdrew the date entirely)
  PERFORM 1 FROM offers WHERE date_instance_id=inst AND status='active';
  IF FOUND THEN RAISE EXCEPTION 'creator-cancel auto-rolled instead of withdrawing the date'; END IF;
  PERFORM 1 FROM analytics_events WHERE event_type='match_instance_cancelled';
  IF NOT FOUND THEN RAISE EXCEPTION 'creator-cancel analytics not emitted (MD10)'; END IF;
  RAISE NOTICE 'creator-cancel-pre-lock OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run all three, expect FAIL** (`function match_cancel_lock(...) does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525126800_p5_cancel_safe_roll.sql
-- Track per-party reconfirmation after a benign cancel before the seat re-offers.
create table if not exists reconfirmations (
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  reconfirmed_at timestamptz not null default now(),
  primary key (date_instance_id, user_id)
);
alter table reconfirmations enable row level security;
do $$ begin
  create policy "reconfirm_self" on reconfirmations for all
    using (user_id=auth.uid()) with check (user_id=auth.uid());
exception when duplicate_object then null; end $$;

create or replace function match_cancel_lock(p_actor uuid, p_lock uuid, p_reason cancel_reason, p_idem_key text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare prior jsonb; inst uuid; cre uuid; cand uuid; nxt uuid; benign boolean; cutoff timestamptz; result jsonb;
begin
  if p_actor is distinct from auth.uid() then raise exception 'NOT_AUTHENTICATED'; end if;  -- C10
  prior := match_idem_lookup(p_actor, 'cancel_lock', p_idem_key);
  if prior is not null then return prior; end if;

  select date_instance_id, creator_id, matched_user_id into inst, cre, cand from locks where id=p_lock for update;
  if inst is null then raise exception 'NO_LOCK'; end if;
  if p_actor not in (cre,cand) then raise exception 'NOT_PARTY'; end if;

  perform pg_advisory_xact_lock(match_instance_lock_key(inst));
  select starts_at into cutoff from date_instances where id=inst for update;

  -- cancel the lock (S1 trigger flips lock_participants.active=false → window frees)
  update locks set status='cancelled', cancelled_by=p_actor, cancel_reason=p_reason where id=p_lock;
  update queue_entries set status='standby' where date_instance_id=inst and candidate_id=cand;

  -- BENIGN set per C2 includes account_closed (so S10 account-deletion re-offers the night, not strands it)
  benign := p_reason in ('schedule_conflict','venue_issue','changed_mind','account_closed','other');
  -- freeze conditions (spec §7.6): freeze reason, within cutoff, or any non-dismissed report on the instance
  if (not benign)
     or (cutoff < now() + interval '2 hours')
     or exists (select 1 from reports where target_type='date_instance' and target_id=inst and status<>'dismissed')
  then
    update date_instances set status='cancelled' where id=inst;     -- freeze: no roll
    perform dispatch_notification(cre,'account',jsonb_build_object('instance',inst,'reason',p_reason,'event','lock_cancelled_frozen'));
    perform dispatch_notification(cand,'account',jsonb_build_object('instance',inst,'reason',p_reason,'event','lock_cancelled_frozen'));
    insert into analytics_events(event_type, actor_id, payload)
    values ('match_lock_cancelled', p_actor, jsonb_build_object('instance',inst,'reason',p_reason,'frozen',true));
    result := jsonb_build_object('instance',inst,'rolled',false,'frozen',true,'reason',p_reason);
    perform match_idem_store(p_actor,'cancel_lock',p_idem_key,result);
    return result;
  end if;

  -- benign + safe: re-seek and request reconfirmation from BOTH before re-offering
  update date_instances set status='seeking' where id=inst;
  delete from reconfirmations where date_instance_id=inst;          -- fresh round
  nxt := match_next_standby(inst);
  if nxt is null then
    select candidate_id into nxt from queue_entries
     where date_instance_id=inst and status='standby' order by rank nulls last, created_at limit 1;
  end if;
  if nxt is not null then
    perform dispatch_notification(cre, 'date_reconfirm', jsonb_build_object('instance',inst));
    perform dispatch_notification(nxt, 'date_reconfirm', jsonb_build_object('instance',inst));
    -- timer so a non-reconfirm expires the re-seek (C1 reconfirm_timeout job)
    perform enqueue_job('reconfirm_timeout', now()+interval '24 hours', jsonb_build_object('instance',inst), 'reconfirm_timeout:'||inst);
  end if;
  insert into analytics_events(event_type, actor_id, payload)
  values ('match_lock_cancelled', p_actor, jsonb_build_object('instance',inst,'reason',p_reason,'frozen',false,'next',nxt));
  result := jsonb_build_object('instance',inst,'rolled',false,'awaiting_reconfirm',true,'next',nxt);
  perform match_idem_store(p_actor,'cancel_lock',p_idem_key,result);
  return result;
end $fn$;

-- MD10: creator cancels their own SEEKING date pre-lock (active offer/standby queue present).
-- Resolves the active offer negative (closes chat + revoke reveal + cancel expiry job), drops the queue,
-- cancels the instance, notifies, and does NOT auto-roll (the whole date is withdrawn). Creator-only.
create or replace function match_cancel_instance(p_actor uuid, p_instance uuid, p_reason cancel_reason)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid; st date_match_status; oid uuid; holder uuid; q record;
begin
  if p_actor is distinct from auth.uid() then raise exception 'NOT_AUTHENTICATED'; end if;  -- C10
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if cre is null then raise exception 'NO_INSTANCE'; end if;
  if cre <> p_actor then raise exception 'NOT_CREATOR'; end if;
  if st <> 'seeking' then raise exception 'INSTANCE_NOT_SEEKING'; end if;  -- locked dates use match_cancel_lock

  -- resolve any active offer negative (this closes chat, revokes reveal, cancels the expiry job; NO roll
  -- happens because we cancel the instance immediately after, and match_auto_roll guards on status<>'seeking').
  select id, candidate_id into oid, holder from offers
    where date_instance_id=p_instance and status='active';
  if oid is not null then
    update offers set status='expired', resolved_at=now() where id=oid;
    perform close_chat_thread(oid);
    perform cancel_jobs('offer_expiry', oid::text);
    perform dispatch_notification(holder, 'account',
            jsonb_build_object('instance',p_instance,'event','date_cancelled_by_creator','reason',p_reason));
  end if;
  -- notify + drop remaining interested/shortlisted/standby candidates
  for q in select candidate_id from queue_entries
            where date_instance_id=p_instance and status in ('interested','shortlisted','standby')
  loop
    perform dispatch_notification(q.candidate_id, 'account',
            jsonb_build_object('instance',p_instance,'event','date_cancelled_by_creator','reason',p_reason));
  end loop;
  update queue_entries set status='offer_passed'
   where date_instance_id=p_instance and status in ('interested','shortlisted','standby','offer_active');

  update date_instances set status='cancelled' where id=p_instance;
  insert into analytics_events(event_type, actor_id, payload)
  values ('match_instance_cancelled', p_actor, jsonb_build_object('instance',p_instance,'reason',p_reason));
end $fn$;

-- INTERNAL: each party reconfirms; when both have (creator + next standby), perform the safe roll.
-- Public reconfirm RPC, if exposed to the Edge layer, asserts auth.uid(); here it is called by tests/clients
-- through a thin wrapper. (Reconfirm is not a named C2 function; it supports cancel_lock's safe-roll.)
create or replace function match_reconfirm(p_actor uuid, p_instance uuid, p_idem_key text)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare cre uuid; nxt uuid; st date_match_status; both boolean;
begin
  if p_actor is distinct from auth.uid() then raise exception 'NOT_AUTHENTICATED'; end if;  -- C10
  if match_idem_lookup(p_actor,'reconfirm',p_idem_key) is not null then return true; end if;
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if st <> 'seeking' then return false; end if;   -- frozen/matched/cancelled → reconfirm is a no-op
  nxt := match_next_standby(p_instance);
  if nxt is null then
    select candidate_id into nxt from queue_entries
      where date_instance_id=p_instance and status='standby' order by rank nulls last, created_at limit 1;
  end if;
  if p_actor not in (cre, nxt) then raise exception 'NOT_RECONFIRM_PARTY'; end if;

  insert into reconfirmations(date_instance_id,user_id) values (p_instance, p_actor)
    on conflict do nothing;
  perform match_idem_store(p_actor,'reconfirm',p_idem_key, jsonb_build_object('ok',true));

  both := exists (select 1 from reconfirmations where date_instance_id=p_instance and user_id=cre)
      and nxt is not null
      and exists (select 1 from reconfirmations where date_instance_id=p_instance and user_id=nxt);
  if both then
    -- safe roll: auto_roll re-applies cutoff/report freeze guards as a final backstop
    if nxt is not null then
      update queue_entries set status='shortlisted' where date_instance_id=p_instance and candidate_id=nxt;
    end if;
    perform match_auto_roll(p_instance);
    return true;
  end if;
  return true;
end $fn$;
```

- [ ] **Step 4: Apply + run all three tests, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525126800_p5_cancel_safe_roll.sql supabase/tests/p5_cancel_safe_roll.sql supabase/tests/p5_cancel_freeze.sql supabase/tests/p5_creator_cancel_pre_lock.sql
git commit -m "P5: match_cancel_lock(reason) (account_closed benign) + reconfirm safe-roll + freeze + creator-cancel-pre-lock (MD10)"
```

---

## Task 9: Centralized grants (auth boundary) + read-side helper

**Files:**
- Create: `supabase/migrations/20260525126900_p5_grants.sql`
- Test: `supabase/tests/p5_helper_grants.sql`

### Why (audit §6 — privilege-escalation fix; C10)
The naïve `like 'match\_%'` grant loop **granted internal helpers to `authenticated`**, letting any client RPC `match_autowithdraw_user_conflicts(any_user,…)` or `match_detect_reciprocal(…)` to forcibly withdraw arbitrary users / fabricate reciprocal-pair rows / spam notifications. **Fix:** grant **only the explicit C2 public allowlist** to `authenticated`; **revoke `authenticated` from every internal helper** (service_role only), per C10.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260525126900_p5_grants.sql

-- The ONLY functions an authenticated client may execute (the C2 public surface + read helper).
-- Everything else under public.match_* / public._match_* is internal → service_role only.
do $$
declare f text;
  public_allow text[] := array[
    'match_shortlist(uuid,uuid,uuid,integer)',
    'match_make_offer(uuid,uuid,uuid,text)',
    'match_accept_offer(uuid,uuid,text)',
    'match_pass_offer(uuid,uuid)',
    'match_auto_roll(uuid)',                 -- callable by clients? NO — see note; service_role only below
    'match_next_standby(uuid)',
    'match_withdraw(uuid,uuid)',
    'match_cancel_lock(uuid,uuid,cancel_reason,text)',
    'match_cancel_instance(uuid,uuid,cancel_reason)',
    'match_reveal_allowed(uuid,uuid)',
    'match_demand_hint(uuid)',
    'match_resolve_reciprocal(uuid,uuid,uuid)',
    'match_reconfirm(uuid,uuid,text)',
    'match_my_status(uuid)'
  ];
  -- functions that are SERVICE-ROLE ONLY even though client-relevant (job runner / S2 calls them):
  service_only text[] := array[
    'match_expire_offer(uuid)',              -- S2 offer_expiry handler only
    'match_auto_roll(uuid)'                  -- S2 standby_roll handler only
  ];
begin
  -- 1. default-deny EVERY p5 function (public + internal)
  for f in
    select p.oid::regprocedure::text from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (p.proname like 'match\_%' or p.proname like '\_match\_%' or p.proname='match_ingest_interest')
  loop
    execute format('revoke all on function %s from public, authenticated', f);
    execute format('grant execute on function %s to service_role', f);   -- service_role may call all
  end loop;
  -- 2. grant the explicit C2 public allowlist to authenticated
  foreach f in array public_allow loop
    if to_regprocedure('public.'||f) is not null then
      execute format('grant execute on function public.%s to authenticated', f);
    end if;
  end loop;
  -- 3. re-revoke the service-only members from authenticated (they appear in neither list as public)
  foreach f in array service_only loop
    if to_regprocedure('public.'||f) is not null then
      execute format('revoke execute on function public.%s from authenticated', f);
    end if;
  end loop;
end $$;

-- Candidate-facing read: their own status on an instance + the bucketed demand hint. No rank, no other candidates.
create or replace function match_my_status(p_instance uuid)
returns table(status queue_status, demand text, reveal_allowed boolean)
language sql stable security definer set search_path=public as $fn$
  select q.status, match_demand_hint(p_instance), match_reveal_allowed(auth.uid(), p_instance)
    from queue_entries q
   where q.date_instance_id=p_instance and q.candidate_id=auth.uid()
$fn$;
revoke all on function match_my_status(uuid) from public;
grant execute on function match_my_status(uuid) to authenticated, service_role;
```

> **Note:** `match_auto_roll` and `match_expire_offer` are listed in the allowlist comment only for visibility, then explicitly removed from `authenticated` in step 3 — clients never roll/expire directly; the S2 job runner (service_role) does. Internal helpers (`match_ingest_interest`, `_match_make_offer`, `_match_accept_offer`, `match_resolve_offer_negative`, `match_autoclose_creator_conflicts`, `match_autowithdraw_user_conflicts`, `match_detect_reciprocal`, `match_idem_*`, lock-key helpers) are caught by step 1's pattern and never granted to `authenticated`.

- [ ] **Step 2: Write + run the negative grant test** (audit §6 / test-coverage gap)

```sql
-- supabase/tests/p5_helper_grants.sql
DO $$
BEGIN
  -- C2 public RPC IS callable by authenticated
  IF NOT has_function_privilege('authenticated','public.match_make_offer(uuid,uuid,uuid,text)','execute')
  THEN RAISE EXCEPTION 'match_make_offer not granted to authenticated'; END IF;
  -- internal helpers are NOT callable by authenticated (privilege-escalation guard)
  IF has_function_privilege('authenticated','public.match_autowithdraw_user_conflicts(uuid,tstzrange,uuid)','execute')
  THEN RAISE EXCEPTION 'PRIV-ESC: authenticated can call match_autowithdraw_user_conflicts'; END IF;
  IF has_function_privilege('authenticated','public.match_detect_reciprocal(uuid,uuid)','execute')
  THEN RAISE EXCEPTION 'PRIV-ESC: authenticated can call match_detect_reciprocal'; END IF;
  IF has_function_privilege('authenticated','public.match_expire_offer(uuid)','execute')
  THEN RAISE EXCEPTION 'authenticated can call match_expire_offer (should be service-role only)'; END IF;
  RAISE NOTICE 'grant boundary OK';
END $$;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525126900_p5_grants.sql supabase/tests/p5_helper_grants.sql
git commit -m "P5: auth boundary — C2 allowlist to authenticated, internal helpers service-role only (priv-esc fix) + negative test"
```

---

## Task 10: Edge Functions (thin transport) + Deno tests

**Files:**
- Create: `supabase/functions/_shared/match.ts`
- Create per action: `supabase/functions/match-shortlist/{index.ts,index.test.ts}`, `match-make-offer`, `match-accept`, `match-pass`, `match-cancel`, `match-withdraw`, `match-resolve-reciprocal`, `match-demand-hint`. (`match-rank` is **REMOVED** — rank is a param of `match-shortlist`.)

### Design decisions locked
- **Functions are transport only.** Each: handle `OPTIONS` (CORS), verify the JWT → derive `actor = jwt.sub` (never read actor from the body), validate the body with Zod, call the matching RPC via the service-role client passing `p_actor = actor`, map known SQL errors (`P0001` with our codes) to HTTP status, return JSON. **All business logic stays in SQL.** The DB also asserts `p_actor = auth.uid()` (C10) as defense-in-depth — the Edge layer forwards the verified JWT so `auth.uid()` matches `p_actor`.
- **Idempotency:** `match-make-offer`, `match-accept`, `match-cancel` **require** an `Idempotency-Key` header (400 if missing) and pass it as `p_idem_key`. `match-resolve-reciprocal` carries **no** idem param (C11.4 signature is `(p_actor,p_pair_id,p_chosen_instance)`; the DB derives idempotency internally).
- **Error mapping** (shared): `OFFER_EXISTS|OFFER_NOT_ACTIVE|ALREADY_LOCKED|DOUBLE_BOOKED|RECIPROCAL_DOUBLE_BOOKED|PAIR_ALREADY_RESOLVED` → 409; `NOT_AUTHENTICATED` → 401; `NOT_CREATOR|NOT_OFFER_HOLDER|NOT_PARTY|NOT_RECONFIRM_PARTY|CHOSEN_NOT_OWNED_BY_PAIR` → 403; `RANK_FROZEN|BLOCKED|INSTANCE_NOT_SEEKING|CANDIDATE_NOT_ELIGIBLE|ACTOR_NOT_ELIGIBLE|CHAT_NOT_READY|NOT_SHORTLISTED|NOT_INTERESTED|BAD_RANK` → 422; `NO_INSTANCE|NO_OFFER|NO_LOCK|NO_PAIR` → 404; unknown → 500.

- [ ] **Step 1: Write the failing test** (start with `match-accept` — the highest-stakes path)

```ts
// supabase/functions/match-accept/index.test.ts
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

const BASE = Deno.env.get("FUNCTIONS_URL") ?? "http://127.0.0.1:54321/functions/v1";

Deno.test("match-accept requires an Idempotency-Key", async () => {
  const res = await fetch(`${BASE}/match-accept`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer <test-jwt>" },
    body: JSON.stringify({ offer_id: "00000000-0000-0000-0000-000000000000" }),
  });
  assertEquals(res.status, 400);
  const j = await res.json();
  assertEquals(j.error, "missing_idempotency_key");
  await res.body?.cancel();
});

Deno.test("match-accept maps OFFER_NOT_ACTIVE to 409", async () => {
  // Seeded via SQL helper before the run; uses a known resolved offer id from env.
  const offer = Deno.env.get("TEST_RESOLVED_OFFER_ID");
  if (!offer) return; // skip if fixture not provisioned
  const res = await fetch(`${BASE}/match-accept`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${Deno.env.get("TEST_CAND_JWT")}`, "idempotency-key": "t1" },
    body: JSON.stringify({ offer_id: offer }),
  });
  assertEquals(res.status, 409);
  await res.body?.cancel();
});
```

- [ ] **Step 2: Run it, expect FAIL** (`connection refused` / 404 — function not written). Run with `supabase start && supabase functions serve match-accept` then `deno test --allow-env --allow-net supabase/functions/match-accept/index.test.ts`.

- [ ] **Step 3: Write `_shared/match.ts` + the function**

```ts
// supabase/functions/_shared/match.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "./cors.ts";

export function svc() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// Verify JWT and return the user id (sub). Throws on missing/invalid.
export async function actorFromJwt(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "unauthenticated");
  const { data, error } = await svc().auth.getUser(auth.slice(7));
  if (error || !data.user) throw new HttpError(401, "unauthenticated");
  return data.user.id;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

const CODE_TO_STATUS: Record<string, number> = {
  OFFER_EXISTS: 409, OFFER_NOT_ACTIVE: 409, ALREADY_LOCKED: 409, DOUBLE_BOOKED: 409,
  RECIPROCAL_DOUBLE_BOOKED: 409, PAIR_ALREADY_RESOLVED: 409,
  NOT_AUTHENTICATED: 401,
  NOT_CREATOR: 403, NOT_OFFER_HOLDER: 403, NOT_PARTY: 403, NOT_RECONFIRM_PARTY: 403, CHOSEN_NOT_OWNED_BY_PAIR: 403,
  RANK_FROZEN: 422, BLOCKED: 422, INSTANCE_NOT_SEEKING: 422, CANDIDATE_NOT_ELIGIBLE: 422, ACTOR_NOT_ELIGIBLE: 422,
  CHAT_NOT_READY: 422, NOT_SHORTLISTED: 422, NOT_INTERESTED: 422, BAD_RANK: 422,
  NO_INSTANCE: 404, NO_OFFER: 404, NO_LOCK: 404, NO_PAIR: 404,
};

export function sqlErrorToHttp(e: { message?: string }): HttpError {
  const msg = e?.message ?? "";
  for (const [code, status] of Object.entries(CODE_TO_STATUS)) {
    if (msg.includes(code)) return new HttpError(status, code);
  }
  return new HttpError(500, "internal_error");
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}
```

```ts
// supabase/functions/match-accept/index.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { z } from "npm:zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";
import { actorFromJwt, svc, sqlErrorToHttp, HttpError, json } from "../_shared/match.ts";

const Body = z.object({ offer_id: z.string().uuid() });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const idem = req.headers.get("Idempotency-Key");
    if (!idem) return json({ error: "missing_idempotency_key" }, 400);
    const actor = await actorFromJwt(req);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "invalid_input", details: parsed.error.flatten() }, 400);

    const { data, error } = await svc().rpc("match_accept_offer", {
      p_actor: actor, p_offer: parsed.data.offer_id, p_idem_key: idem,
    });
    if (error) { const h = sqlErrorToHttp(error); return json({ error: h.code }, h.status); }
    return json(data, 200);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status);
    return json({ error: "internal_error" }, 500);
  }
});
```

The other functions follow the identical skeleton, swapping the Zod body + RPC name (all C2/C11.4 signatures):
- `match-shortlist` → `match_shortlist(p_actor, p_instance, p_candidate, p_rank)` (reciprocity is detected inside `match_shortlist`; no separate `_with_reciprocal`).
- `match-make-offer` → `match_make_offer(p_actor, p_instance, p_candidate, p_idem_key)` (idem required; **no** window param).
- `match-pass` → `match_pass_offer(p_actor, p_offer)`.
- `match-withdraw` → `match_withdraw(p_actor, p_instance)`.
- `match-cancel` → `match_cancel_lock(p_actor, p_lock, p_reason, p_idem_key)` (idem required). (Creator pre-lock cancel of a whole date uses `match_cancel_instance(p_actor, p_instance, p_reason)` — surface it on `match-cancel` or a `match-cancel-instance` route per the host-screen design; both are real RPCs.)
- `match-resolve-reciprocal` → `match_resolve_reciprocal(p_actor, p_pair_id, p_chosen_instance)` (**no** idem param — C11.4).
- `match-demand-hint` → `match_my_status(p_instance)` (read-only; returns status + demand + reveal flag; uses the **caller's** JWT client. Note: `match_my_status` is SECURITY DEFINER and reads `auth.uid()` internally, so it is correct via either client — the prior "RLS applies" comment was inaccurate and is dropped).

- [ ] **Step 4: Run the Deno test, expect PASS.** Repeat Steps 1–4 per function. Add at least: `match-make-offer` "second offer → 409 OFFER_EXISTS" + "missing idem → 400", `match-cancel` "missing idem → 400", `match-shortlist` "non-creator → 403 NOT_CREATOR", `match-demand-hint` "standby sees `reveal_allowed=false`", `match-withdraw` "non-self actor rejected".

- [ ] **Step 5: Commit** (one commit per function, or a batched commit after all pass)

```bash
git add supabase/functions/_shared/match.ts supabase/functions/match-*/
git commit -m "P5: thin Edge Functions for every C2 transition (JWT actor, idempotency, SQL-error→HTTP) + Deno tests"
```

---

## Task 11: Full reset + run-all gate + regenerate types

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated)

- [ ] **Step 1: Full reset** — `supabase db reset` applies S1 + S2 + S5 + all P5 (126xxx) migrations in cumulative dependency order. Expect no error (C9-class collisions are resolved by the C6/C11 band map).

- [ ] **Step 2: Run every P5 SQL test**

```bash
for f in supabase/tests/p5_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Run both concurrency harnesses**

```bash
supabase db reset && supabase/tests/p5_race_two_accepts.sh
supabase db reset && supabase/tests/p5_race_expiry_vs_accept.sh
```
Expected: both print `PASS:`.

- [ ] **Step 4: Run Deno function tests** — `supabase start` then `deno test --allow-env --allow-net supabase/functions/match-*/**/*.test.ts`. Expected: all pass.

- [ ] **Step 5: Regenerate types** — `pnpm db:types`. Expect P5's own tables (`transition_idempotency`, `presence_heartbeats`, `reciprocal_pairs`, `reconfirmations`, `temp_race`) and the C2 functions to appear. (`jobs`/`analytics_events`/`feature_config`/chat tables belong to S2 and already exist.) Per C10, this is the single root vitest/types config (P1-owned); P5 does not bootstrap its own.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P5: regenerate database types for matching state-machine tables/functions"
```

---

## Self-Review

**Contract conformance (C2/C11 — the load-bearing checks):**
- C2 API exposed exactly: `match_shortlist(…,p_rank)`, `match_make_offer(…,p_idem_key)`, `match_accept_offer(…,p_offer,p_idem_key)→uuid`, `match_pass_offer`, `match_expire_offer`, `match_auto_roll`, `match_next_standby`, `match_cancel_lock`, `match_reveal_allowed`, `match_demand_hint` + **`match_withdraw`** + **`match_resolve_reciprocal` (C11.4)**. ✅
- No P5-owned jobs/notify/config: calls S2 `enqueue_job`/`cancel_jobs`/`dispatch_notification`; `offer_expires_at()` for expiry (no 24h); shim removed (DS5). ✅
- `open_chat_thread`/`chat_lock_ready`/`promote_chat_thread_to_lock`/`close_chat_thread` wired (C11.7); `can_enter_lock_flow` checked on offer (candidate) + accept (actor) (C3). ✅
- `account_closed` benign in `match_cancel_lock` (C2); creator-cancel-pre-lock `match_cancel_instance` (MD10); seed-night acceptance handled (MD9). ✅
- Every transition emits `analytics_events` (C11.8); every public RPC asserts `auth.uid()`, internal helpers `revoke … authenticated` with a negative test (C10, audit §6). ✅
- Bands relslotted to 126xxx (C6/C11); fixtures via `mk_user` (C8). ✅

**Spec coverage (vs roadmap P5 'Delivers'/'Closes'):**
- Shortlist + rank (carried by `match_shortlist`, frozen for the active offer slot via `RANK_FROZEN`) → Task 2. ✅
- `match_make_offer`: single ACTIVE offer (S1 partial-unique backstop + advisory lock), `offer_expires_at()`, offer-expiry job, chat thread opened, lock-flow gate, reveal to active holder ONLY → Task 4. ✅
- Consent disclosure: swiping reveals the swiper's profile to the anonymous creator, explicit + audited → Task 2. ✅
- `match_accept_offer` → LOCK: chat-gate + lock-flow gate + advisory + no-overlap GiST + off-market + cascade + promote-chat → Task 5. ✅
- pass/expire → auto-roll (discrete C1 `standby_roll` jobs) + cascade throttle + `match_withdraw` → Task 6. ✅
- Reciprocal-pair detection (internal) → `match_resolve_reciprocal` chooser (DOUBLE_BOOKED-safe) → Task 7. ✅
- `match_cancel_lock(reason)` → safe auto-roll (benign incl. account_closed; reconfirm both; freeze) + creator-cancel-pre-lock → Task 8. ✅
- Bucketed/capped DEMAND hint, presence-backed, honest (single C2 source) → Task 3. ✅
- Concurrency tests (two simultaneous accepts; offer-expiry-vs-accept race — the *production* path via S2's handler calling `match_expire_offer`) → Tasks 5 & 6 shell harnesses. ✅

**Concurrency/design decisions locked (the load-bearing ones):**
1. **Advisory lock then check, never check-then-act.** Every contended transition takes `pg_advisory_xact_lock(match_instance_lock_key(instance))` (or `match_pair_lock_key` for reciprocal) before reading state. The P0 structural invariants (partial-unique offer index, GiST `lock_participants` exclusion, unique `locks.date_instance_id`) are the backstop, caught and translated (`exclusion_violation`→`DOUBLE_BOOKED`).
2. **Reveal is derived, not stored** → auto-revocation is real, not a flag that can drift.
3. **Standby order == rank order** (single source), eliminating the dual-ordering bug; `match_next_standby` is the only ordering authority.
4. **Cascade throttle = per-window scoping + deferred (job-based) rolls + per-actor cap.** A lock never synchronously cascades into another lock; it enqueues discrete C1 **`standby_roll`** jobs (the real S2-dispatched kind → `match_auto_roll`), which S2 rate-limits.
5. **Idempotency ledger** keyed `(actor, action, key)` makes accept/cancel/resolve safe under retry; the Edge layer requires the header.
6. **Expiry idempotent + cancellable:** the timer is cancelled on resolution and the expire function no-ops on an already-resolved offer, so the expiry-vs-accept race has exactly one outcome.
7. **Safe-roll requires both-party reconfirmation; freeze on non-benign reason / within cutoff / after any safety report** — safety beats liquidity.

**Dependencies consumed, not faked:** S2 owns jobs/notify/config/chat-core/gate; S5 owns swipes + seed nights; S1 owns the schema spine + `_fixtures.sql`. P5 fabricates **no** shared infrastructure — the old "SUPERSEDED BY P2" shim is removed (DS5). P5's tests assume S1+S2+S5 are applied (Task 0 asserts the S2 deps exist). The **only** P5-fabricated objects are its own band-126xxx tables (idempotency ledger, presence, reciprocal pairs, reconfirmations, lock-key helpers, `temp_race` test scaffold).

**Placeholder scan:** none — every step has runnable SQL/TS and exact commands. The Edge tests use `<test-jwt>` / env-provided fixtures as the *only* indirection, standard for integration tests against a live local stack.

**Risk notes & open conformance items:**
- **Analytics column shape, `is_seed`, chat-thread columns (`offer_id`/`lock_id`/`closed_at`), `offer_status`/`queue_status`/`cancel_reason` enum members, and notification/job enum members** are all S1/S2/S5-owned. Where this plan's SQL names a specific column/member, it is the plan's best alignment; **at execution, conform to the upstream definitions** (canonical). Any genuinely-missing enum member (e.g. a dedicated "candidate withdrew" `notification_type`, or `standby_roll`/`reconfirm_timeout`/`bulk_withdraw` `job_type` values) must be confirmed present in C1's frozen enums — if absent, **raise a contract amendment against S2/C1**, never emit a free string or invent a local enum.
- **`auth.uid()` in psql tests:** public RPCs assert `p_actor = auth.uid()`. Tests set `request.jwt.claims` via `set_config('request.jwt.claims', json_build_object('sub',<uuid>)::text, true)` before each call so the assertion passes. The `_match_*` service siblings + service-role-granted functions are how the job runner / chooser act without an end-user JWT.
- **`pg_advisory_xact_lock` re-entrancy:** `match_auto_roll` → `_match_make_offer` both acquire the same instance key; advisory locks are re-entrant per session within a transaction (safe; Task 6 note).
- **Cross-migration forward references:** `match_accept_offer` (126500) references `match_autowithdraw_user_conflicts` (126600); `match_shortlist` (126200) references `match_detect_reciprocal` (126700). plpgsql resolves bodies at call time and all apply before any call in `db reset`, so forward refs are safe.
- **`match_demand_hint` cost:** live 3-table join per read; fine for launch. S12/P11 (scale) may add a covering index / short-TTL cache.
- **`match_reveal_allowed` for chat:** S7 chat gates on the same C2 predicate (the only reveal predicate); P5 provides it, S7 consumes it — no competing predicate.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-p5-matching-state-machine.md`.** Recommended execution: **subagent-driven** (one subagent per task, review between tasks) given the concurrency tests — verify each race harness PASS before moving on. **Hard prerequisite before execution: S1 + S2 + S5 applied** (schema spine; jobs/notify/config/`offer_expires_at`/`can_enter_lock_flow`/chat-core/`analytics_events`; swipes + seed nights). P5 builds no shim — if any S2 dependency is absent, land it first. This plan is a **SUBORDINATE EXECUTION SLICE**: implement only through INTEGRATION-CONTRACT.md v2 + RECONCILED-MASTER-PLAN.md; on any conflict, those win and this file is corrected to match.

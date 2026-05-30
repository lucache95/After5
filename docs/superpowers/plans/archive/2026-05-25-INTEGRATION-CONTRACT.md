# Dating Plans — Integration Contract (authoritative)

**Date:** 2026-05-25
**Status:** Authoritative — **v2.1**. Where any phase plan (P0–P11) conflicts with this document, **this document wins.** (v2.1 adds C11.10–C11.13 from the 12-file rewrite wave: the `job_type`→callee map, `notification_type` additions, frozen `analytics_events` columns, and appeal/DOB/auth-sibling ownership.) It freezes the shared contracts the parallel-authored plans each guessed independently (see `audits/2026-05-25-CONSOLIDATED-INTEGRATION-AUDIT.md`, defects I1–I13). Each phase's conforming tasks must be reconciled to the names/types/signatures below before execution.

> **v2 amendments — see §C11 at the end.** C11 closes the gaps found by `audits/2026-05-25-INTEGRATION-CONTRACT-audit.md` (unowned objects, compile-breakers, the browse_feed/account-state regression, P9 duplicate-type collision, reports/disputes DDL, chat-core ordering). **Where C11 conflicts with C1–C10 above, C11 wins.**

**Conventions:** Supabase Postgres; migrations `YYYYMMDDHHMMSS_snake.sql`; RLS on; idempotent policies; `auth.uid()` authz; `set_updated_at()`. All transition/admin logic is `SECURITY DEFINER`; internal helpers `revoke execute from public, authenticated`.

---

## C1 — Async jobs, notifications & devices (owner: P2) [defect I1, I7, I13]

**Single `jobs` table + enum (no other `jobs` table may be created):**
```sql
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
  created_at timestamptz not null default now()
);
create unique index jobs_dedup_active on jobs(type, dedup_key) where status in ('pending','running') and dedup_key is not null;
```
**Canonical functions (all consumers use these exact signatures):**
- `enqueue_job(p_type job_type, p_run_after timestamptz, p_payload jsonb default '{}', p_dedup_key text default null) returns uuid`
- `cancel_jobs(p_type job_type, p_dedup_key text) returns int`
- Runner claims with `for update skip lock_timeout` / `skip locked`, dispatches per `type`, retries with backoff, dead-letters at `attempts >= 5`.

**Notifications:**
```sql
create type notification_type as enum (
  'new_match','offer_received','offer_expiring','standby_promoted','date_reconfirm',
  'safety_checkin','safety_alert','new_message','rating_request','moderation_action','account');
create table devices (
  user_id uuid not null references profiles(id) on delete cascade,
  expo_push_token text, web_push_sub jsonb, platform text,
  last_seen timestamptz not null default now(),
  primary key (user_id, coalesce(expo_push_token, '')) );
```
- `register_device(p_token text, p_platform text, p_web_push jsonb default null)` — called from P1 onboarding + native bootstrap.
- `dispatch_notification(p_user uuid, p_type notification_type, p_payload jsonb)` — order: consent → quiet-hours → rate-limit (reuse `rate_limit_check`) → channel (push→web→email). **Safety types (`safety_checkin`,`safety_alert`) bypass consent/quiet/rate-limit, and if NO REACHABLE CHANNEL exists they MUST fail loud (log + admin alert), never silent.** _Amendment (2026-05-26): "no reachable channel" supersedes the earlier "no device" wording. Email is a legitimate reachable safety channel, so the safety escalation hierarchy is **push → web → email → admin_alert**: a device-less but email-enabled user still receives a safety ping (via email); fail-loud (`channel='admin_alert'` + `raise_admin_alert('safety_no_device', …)` + ops email) fires only when there is no push/web device AND email is disabled. Safety never resolves to `suppressed`._

**Analytics relay:** the `analytics_relay` job type drains P11's `analytics_events` outbox to PostHog via `posthog-node` (P11 ships the handler).

---

## C2 — Match transition API (owner: P5) [defect I2, I10]

These are the **only** names callers may use. `p_actor` must equal `auth.uid()` (RPC raises otherwise). Internal helpers (`match_autowithdraw_user_conflicts`, `match_instance_lock_key`, `match_pair_lock_key`, `match_resolve_offer_negative`, `match_idem_*`) are `revoke execute from authenticated`.

| Function | Signature | Notes |
|---|---|---|
| shortlist | `match_shortlist(p_actor uuid, p_instance uuid, p_candidate uuid, p_rank int)` | creator only |
| make offer | `match_make_offer(p_actor uuid, p_instance uuid, p_candidate uuid, p_idem_key text) returns uuid` | sets `expires_at` from `feature_config` offer-window via `offer_expires_at()`; `enqueue_job('offer_expiry', expires_at, …, dedup=offer_id)`; calls `open_chat_thread(offer_id)`; **checks `can_enter_lock_flow(candidate)`** |
| accept→lock | `match_accept_offer(p_actor uuid, p_offer uuid, p_idem_key text) returns uuid` | requires `chat_lock_ready(thread)` true (or mutual override) **and** `can_enter_lock_flow(actor)`; transactional advisory-lock; `cancel_jobs('offer_expiry', offer_id)` |
| pass | `match_pass_offer(p_actor uuid, p_offer uuid)` | → `match_auto_roll` |
| expire | `match_expire_offer(p_offer uuid)` | idempotent; no-ops if resolved; → `match_auto_roll` |
| auto roll | `match_auto_roll(p_instance uuid)` | enqueues discrete `standby_roll` jobs (throttled); never synchronously cascades |
| next standby | `match_next_standby(p_instance uuid) returns uuid` | lowest-rank shortlisted = standby order (single source) |
| withdraw | `match_withdraw(p_actor uuid, p_instance uuid)` | **NEW — P9/users call this** (replaces the fictional `withdraw_from_queue`) |
| cancel lock | `match_cancel_lock(p_actor uuid, p_lock uuid, p_reason cancel_reason, p_idem_key text)` | benign reasons roll; safety/misconduct freeze |
| reveal | `match_reveal_allowed(p_viewer uuid, p_instance uuid) returns bool` | **the only reveal predicate** (P1 drops `offer_reveal`) |
| demand | `match_demand_hint(p_instance uuid) returns text` | **the only demand hint** (P11 deletes its duplicate) |

```sql
create type cancel_reason as enum
  ('schedule_conflict','venue_issue','changed_mind','account_closed','safety','misconduct','other');
-- BENIGN (auto-roll): schedule_conflict, venue_issue, changed_mind, account_closed, other
-- FREEZE (no roll): safety, misconduct
```
Every transition emits its analytics event into `analytics_events` (C8) and `dispatch_notification` where the spec requires.

---

## C3 — Account state model (owners: P7 standing, P9 lifecycle) [defect I3]

**Two orthogonal fields on `profiles`, not three tables:**
- `standing standing_state` — moderation/reliability gate. Owner: **P7**. Values: `good,warned,cooldown,throttled,reconfirm_required,locked_ban,suspended`. P8 suspend writes `standing='suspended'`.
- `account_state account_lifecycle` — owner: **P9**. Values: `active,paused,deletion_pending,deleted`.

**P5 gate (`can_enter_lock_flow(p_user)` returns bool):** true iff `account_state='active'` AND `standing NOT IN ('cooldown','locked_ban','suspended')` AND not `rollover_frozen`. **P5's `match_make_offer`/`match_accept_offer` MUST call it.** P8's `suspensions` table becomes an *audit log only* (not a source of truth). Delete P8 `account_active()` and P9 `account_status='suspended'` as gates.

---

## C4 — `browse_feed` (owner: P4) [defect I4]

`browse_feed` is **defined exactly once**, in a P4 migration that sorts **after** all base-table column-adds (P3 sound fields, P8 `moderation_status`, P4 `is_seed`). No other phase may `create or replace` it; other phases only `alter table` the base tables. P0's initial view must **not** select `itineraries.vibe_tags` (add that column first — C7).

Final projection (identity-stripped): `date_instance_id, city_id, time_window_start (hour-truncated), itinerary_id, pay_setting, vibe_tags, why_note, sound_title, sound_license, venue_neighborhood, is_seed`.
Filter: `status='seeking' AND starts_at > now() AND moderation_status='approved'`.
Client entrypoint: `browse_feed_for_viewer(p_viewer uuid, p_point geography default null) returns table(...)` — applies mutual compatibility + distance, **returns every surfaced column above plus `distance_m`**, excludes blocked users and already-swiped instances, keyset-paginated.

---

## C5 — `reports` schema + taxonomy (owner: P8 schema; all phases conform) [defect I5]

**One schema; `report_status` keeps `actioned` and `reviewing` (P7 depends on them — do NOT rename/drop):**
```sql
create type report_status as enum ('open','reviewing','actioned','dismissed');
create type report_reason_category as enum
  ('harassment','safety_threat','no_show_dispute','payment_dispute','inappropriate_content','fake_profile','other');
-- reports: id, reporter_id, target_type ('user'|'date_instance'|'message'|'lock'),
--   target_id (FK-less), reason_category, detail, status, resolution_code,
--   pay_setting_snapshot, created_at
```
- Canonical writer: `file_report(p_actor uuid, p_target_type text, p_target_id uuid, p_reason_category report_reason_category, p_detail text, p_pay_setting_snapshot jsonb default null) returns uuid`. P7 SOS, P6 message-report, P10 payment dispute all call it.
- P8 triage reads **both** `reports` and P3's `media_assets` queue, branches on `reason_category`.
- P7 `evaluate_standing`/`can_rematch` read `status='actioned'` (preserved).
- P7↔P8 dispute loop is bidirectional: P7 writes a `disputes` row on a contested no-show; P8 resolution calls back to recompute reliability and clear `match_ratings.disputed`.

---

## C6 — Migration timestamp map [defect I6]

Each phase owns a 100-slot band on 2026-05-25; migrations sort by dependency. No two phases share a band.

| Phase | Band | Phase | Band |
|---|---|---|---|
| P0 | `120000–1211xx` (existing) | P6 | `127000–1279xx` |
| P1 | `122000–1229xx` | P7 | `128000–1289xx` |
| P2 | `123000–1239xx` | P8 | `129000–1299xx` |
| P3 | `124000–1249xx` | P9 | `130000–1309xx` |
| P4 | `125000–1259xx` | P10 | `131000–1319xx` |
| P5 | `126000–1269xx` | P11 | `132000–1329xx` |

`browse_feed`'s single definition lives at the **end of P4's band** (after P3/P8 column-adds land in earlier bands — note P8>P4, so the feed view actually moves to a P8-or-later band: place the final `browse_feed` migration at `129900`, owned by P4's spec but timestamped after P8's `moderation_status`). Shared objects from C1 (jobs/devices/notifications) live in P2's band; C3 fields split P7/P9 bands; C5 `reports` final shape in P8's band.

---

## C7 — Shared schema fixes (owner: P0) [defect: P0 in-plan]

- Add `vibe_tags text[] not null default '{}'` to `itineraries` (and surface on `date_instances`/feed). Fixes the `browse_feed` `CREATE VIEW` failure.
- Lifecycle columns (`queue_entries.status`, `locks.status`) are **not** directly writable by RLS — only via C2 RPCs. Replace `queue_creator_all FOR ALL` with select + RPC-only writes.

---

## C8 — Shared test fixtures (owner: P0) [defect I11]

`supabase/tests/_fixtures.sql` — every psql test `\i`'s this; no test inserts bare into `profiles`/`itineraries`:
```sql
create or replace function mk_user(p_label text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          p_label||'_'||left(uid::text,8)||'@test.local', now(), now());
  insert into profiles (id, first_name) values (uid, p_label);
  return uid;
end $$;
-- mk_itinerary(p_user uuid) and mk_instance(p_itin uuid, p_creator uuid, p_starts timestamptz)
-- satisfy all NOT-NULLs and FKs; defined here.
```

---

## C9 — Chat model & hooks (owner: P6) [defect I8, I9]

P6's **stateful threads win** (reveal + retention + reporting need state). P5 calls: `open_chat_thread(p_offer uuid)` at offer; `chat_lock_ready(p_thread uuid) returns bool` before lock (gate); `promote_chat_thread_to_lock(p_offer uuid, p_lock uuid)` on accept; `close_chat_thread(p_offer uuid)` on pass/expire. `match_reveal_allowed` (C2) is the reveal predicate; P6 does not define a competing one. **FK/legal-hold:** `chat_messages.sender_id on delete set null` + sender tombstone; `chat_threads` survive profile delete (tombstone, not cascade) and carry `revoked_at`; held threads exempt from purge (P9 legal-hold).

---

## C10 — Auth, vitest, feature flags [defect I10, I12, I13]

- **Auth:** every `SECURITY DEFINER` RPC asserts `p_actor = auth.uid()` (or derives actor from `auth.uid()` and drops the param); admin RPCs check `admin_has_role()`; internal helpers `revoke execute from public, authenticated`.
- **vitest:** P1 owns the single root `vitest.config.ts` (workspace globs covering `apps/web` + `packages/*`). P3/P6/P8/P10/P11 **delete** their duplicate setups and assume `pnpm test`.
- **Tunable offer window:** `feature_config` row is the source of truth; `offer_expires_at()` (DST-safe) reads it; P5 uses it (no hardcoded 24h). P11's notification batching folds into C1 `dispatch_notification` (one anti-storm system).

---

## Reconciliation checklist (apply per phase before execution)

- [ ] P0: add `vibe_tags`; fix `browse_feed` (drop here, own in P4); RPC-only lifecycle columns; ship `_fixtures.sql`; all P0 tests use `mk_user`.
- [ ] P1: verification front door (start inquiry + write `phone` row); DOB age gate; advance `onboarding_step`; blurred photo; drop `first_name` from public card; drop `offer_reveal`; own root vitest; `register_device`.
- [ ] P2: adopt C1 names/enum exactly; ship `cancel_jobs`; `offer_expiry` handler calls `match_expire_offer`; remove `p5_*` stubs.
- [ ] P3: real signed-URL + transcode + `process-media` invoker; anonymous-draft claim; only `alter table` for feed columns (no view); delete vitest dup.
- [ ] P4: fix invalid concierge UUID; own the single `browse_feed` (C4) + RPC returning all fields; real pagination + `starts_at>now()`; seed-night handling wired to P5.
- [ ] P5: expose C2 API exactly; call `can_enter_lock_flow`, `open_chat_thread`, `chat_lock_ready`; add `match_withdraw`; `account_closed` benign; emit analytics; auth `auth.uid()`; lock down helper grants; add creator-cancel-pre-lock.
- [ ] P6: C9 hooks; tombstone FKs; `revoked_at`; `chat_purge` job; `new_message` notify; delete vitest dup.
- [ ] P7: P5 calls `can_enter_lock_flow` (coordinated patch); keep `actioned`/`reviewing`; geofence dispute recomputes reliability; bidirectional dispute loop; fixtures via `mk_user`.
- [ ] P8: `standing` is the gate (suspensions = audit log); keep `actioned`/`reviewing`; read `media_assets` + `reason_category`; admin RPC `auth.uid()` + `revoke`; appeal flow + notify; delete vitest dup.
- [ ] P9: `account_state` field (not a 3rd suspended); `match_cancel_lock(account_closed)`/`match_expire_offer`/`match_withdraw`; delete `auth.users` + re-signup defense; C1 job names.
- [ ] P10: disclaimer on all pay surfaces; `file_report` threads `reason_category`; fix P4 contradictory labels; delete vitest dup.
- [ ] P11: `analytics_relay` job + handler; P5 emits all 15 events; read `feature_config`; delete duplicate demand hint + batching; wire `AsyncBoundary`/primitives into the real P4/P5/P6 screens (no orphans); fix a11y feed shape.

---

## C11 — v2 amendments (resolves the contract-audit gaps; overrides C1–C10 on conflict)

**C11.1 — `feature_config` + `offer_expires_at()` (owner: P2, band `123800`).** P5 (band 126xxx) depends on these, so they ship in P2 (earlier).
```sql
create table feature_config (
  key text primary key, value jsonb not null,
  updated_at timestamptz not null default now() );
insert into feature_config(key,value) values ('offer_window_hours','24'::jsonb) on conflict do nothing;
-- DST-safe expiry helper (clamped 12–72h):
create or replace function offer_expires_at(p_from timestamptz default now()) returns timestamptz
language sql stable as $$
  select p_from + make_interval(hours =>
    greatest(12, least(72, (select (value#>>'{}')::int from feature_config where key='offer_window_hours'))) ) $$;
```
P5's `match_make_offer` sets `expires_at := offer_expires_at()`. No hardcoded 24h.

**C11.2 — `devices` PK fix (compile-breaker in C1).** Replace the C1 `devices` DDL with:
```sql
create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  expo_push_token text, web_push_sub jsonb, platform text,
  last_seen timestamptz not null default now(),
  unique nulls not distinct (user_id, expo_push_token) );
```

**C11.3 — `browse_feed` finalization (supersedes C4 "defined once in P4" + the C6 `129900` slot).** The view is built with **`drop view if exists browse_feed; create view …`** (NOT `create or replace`, which forbids column changes) in a single **feed-finalization migration at band `133000`** — after every base-table column it reads exists (`moderation_status` P3/P8, `is_seed` P4, `account_state`/`standing` P7/P9). Earlier phases that need a feed for tests query base tables or a minimal early view that this migration drops. **Filter (mandatory):**
```sql
where di.status='seeking' and di.starts_at > now()
  and di.moderation_status='approved'
  and cr.account_state='active' and cr.standing not in ('suspended','locked_ban')
```
(`cr` = creator profile join.) Closes the regression where paused/suspended creators stayed browsable. No phase uses `create or replace browse_feed`; phases only `alter table` base tables.

**C11.4 — `match_resolve_reciprocal` is part of the C2 API** (creator-facing chooser resolution): `match_resolve_reciprocal(p_actor uuid, p_pair_id uuid, p_chosen_instance uuid)`. Add to C2.

**C11.5 — P9 must NOT redefine shared types.** P9 uses C1's `jobs`/`job_status`/`enqueue_job` (no local copies — duplicate `create type` hard-fails `db reset`). `account_lifecycle` enum is exactly `('active','paused','deletion_pending','deleted')` — **`suspended` is NOT in it** (suspension lives in `profiles.standing`, C3). P8's `suspensions` table is an **audit log only**, never a gate.

**C11.6 — `reports` + `disputes` frozen DDL (completes I5).** `reason_category` (C5 enum) is the **canonical taxonomy**; `detail text` is free-text; there is no separate gating `reason` column. `report_status` stays 4 values (`open,reviewing,actioned,dismissed`); any richer P8 lifecycle is expressed via `resolution_code text`, never by adding/removing enum values P7 reads.
```sql
create table disputes (
  id uuid primary key default gen_random_uuid(),
  lock_id uuid not null references locks(id) on delete cascade,
  raised_by uuid not null references profiles(id),
  kind text not null check (kind in ('no_show','payment','conduct')),
  state text not null default 'open' check (state in ('open','resolved','rejected')),
  resolution jsonb, created_at timestamptz not null default now() );
```
P7 writes a `disputes` row on a contested no-show; P8 resolution updates `disputes.state` **and** calls back `recompute_reliability(user)` + clears `match_ratings.disputed`. (owner: `disputes` table = P7 band `128xxx`; resolution RPC = P8.)

**C11.7 — chat-core is a P5 prerequisite (fixes the band-order test break).** The chat **thread table + `open_chat_thread`/`close_chat_thread`/`promote_chat_thread_to_lock`/`chat_lock_ready`** ship in an early **chat-core** slice at band `124500` (before P5 `126xxx`) so P5's tests can call them. P6's rich messaging/retention/moderation stays in P6's band `127xxx`. (Note: plpgsql resolves callee names at runtime, so creation order is fine, but P5's *tests* need the functions to exist — hence the earlier band.)

**C11.8 — owned objects (no orphans).** Ownership + band:
- `analytics_events` table (append-only outbox) — **created in P2 band `123900`** (so P5/P2 can emit); `analytics_relay` job handler + retention (purge after 30d) — **P11**.
- `moderation_status` enum + column on `date_instances` (`'pending'|'approved'|'rejected'`, default `'approved'` for non-UGC, `'pending'` when UGC attached) — **P3 band `124xxx`**.
- `notification_preferences` (consent + quiet-hours) — **P2 band `123xxx`** (`dispatch_notification` reads it).
- Web-push **VAPID keys** + `EXPO_ACCESS_TOKEN` — env/secrets, documented in **P2**.
- **Admin-alert channel** (the "fail loud" terminus for I7): `admin_alerts(id, kind, payload, created_at, resolved_at)` table + an always-on out-of-band sink (ops email via Resend **and** a row insert). A safety notification with **no reachable channel** (no push/web device AND email disabled — see the escalation hierarchy in the `dispatch_notification` amendment above) inserts an `admin_alerts` row AND emails ops — it never dead-ends in an empty channel. (owner: P2 table; P7/P8 consume.)

**C11.9 — paused-user servicing.** A `paused` user with an **active lock** still owes that date: pause suppresses feed/offers/new swipes but does **not** cancel existing locks; reconfirm/check-in jobs still fire; resume restores feed visibility. A `paused` user cannot create/accept new offers (`can_enter_lock_flow` returns false for non-`active` `account_state`).

---

## C11 — v2.1 amendments (resolves the rewrite-wave seams; override C1–C10 + earlier C11 on conflict)

**C11.10 — `job_type` → callee-RPC map (freezes the last naming ambiguity).** The S2 runner dispatches each `job_type` to exactly this callee (consumers expose these names):
`offer_expiry`→`match_expire_offer(p_offer)`; `standby_roll`→`match_auto_roll(p_instance)`; `pending_expiry`→`match_expire_pending(p_instance)`; `stale_date_close`→`match_stale_date_close(p_instance)`; `day_of_reconfirm`→`match_request_reconfirm(p_lock)`; `reconfirm_timeout`→`match_reconfirm_timeout(p_lock)`; `bulk_withdraw`→`match_bulk_withdraw(p_user)`; `safety_checkin`→`safety_checkin_fire(p_lock)` (P7); `rating_window`→`close_rating_window(p_lock)` (P7); `chat_purge`→`chat_purge_thread(p_thread)` (P6); `deletion_process`→`process_deletion(p_request)` (P9); `analytics_relay`→`analytics_relay_drain()` (P11); `notify`→internal `dispatch_notification`. Any phase exposing a differently-named callee conforms to this map.

**C11.11 — `notification_type` additions.** Extend the C1 enum with: `verification_passed`, `verification_failed`, `appeal_resolved`, `offer_withdrawn` (the "candidate withdrew" signal). No phase emits a free-text notification kind.

**C11.12 — `analytics_events` frozen columns** (owner P2, band `123900`): `id bigint generated always as identity pk, event_type text not null, actor_id uuid, subject_type text, subject_id uuid, payload jsonb not null default '{}', created_at timestamptz not null default now()`. P5/P2 emit via `emit_analytics(event_type, actor_id, subject_type, subject_id, payload)`; P11's `analytics_relay_drain()` consumes + purges >30d.

**C11.13 — small ownership clarifications.**
- **Appeal flow** is owned by **P8/S9** (`appeals` table + `resolve_appeal` RPC + admin appeals route); **P1/S3** owns only the `appeal` *verification state*. No conflict.
- **`profiles_private.birthdate`** is **service-role-writable** (the Persona webhook writes the parsed DOB); owner is its own (no `with check` for `authenticated`). The age-gate trigger reads it.
- **Internal auth-skipping RPC siblings** (e.g., `_match_make_offer`/`_match_accept_offer`) are permitted **only** as `revoke execute from public, authenticated` service-role functions called by the S2 job-runner/chooser; the public `match_*` RPCs keep the `auth.uid()` gate (C10).
- **Open (non-blocking) future amendments to decide before S10/S12:** authoritative GDPR-export scope (chat bodies + `auth` identity ownership); explicit confirmation that `match_cancel_lock(account_closed)` emits the counterparty `dispatch_notification`. Neither blocks S1–S9.

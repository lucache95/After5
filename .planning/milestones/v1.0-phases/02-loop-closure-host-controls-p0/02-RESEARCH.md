# Phase 2: Loop Closure & Host Controls (P0) - Research

**Researched:** 2026-06-03
**Domain:** Postgres SECURITY DEFINER RPCs + Supabase migrations + Vercel-cron job dispatch + notification wiring (backend-heavy, BROWNFIELD live-on-prod)
**Confidence:** HIGH (all claims grounded in the live codebase; every RPC signature, enum, handler, and test below was read directly from `supabase/migrations/`, `supabase/functions/`, `supabase/tests/`, and `apps/web/`)

## Summary

This phase has NO new external packages and NO greenfield scaffolding. Every pattern E5–E9 needs already exists in the repo and must be COPIED, not invented: the SECURITY DEFINER + `auth.uid()` re-check + idempotency-ledger + `dispatch_notification` + `enqueue_job` pattern (canonical exemplar: `match_make_offer` in `20260527126300_p5_make_offer.sql`); the job-handler dispatch table (`process-jobs/handlers.ts`); the psql-assertion SQL test convention (`supabase/tests/*.sql`); and the Vercel-cron → `process-jobs` edge runner (`apps/web/vercel.json` + `apps/web/app/api/cron/process-jobs/route.ts`).

The single largest finding: **E9 must come first and is almost entirely deletion.** The four dead handlers (`stale_date_close`, `pending_expiry`, `reconfirm_timeout`, `deletion_process`) plus the two unwired safety handlers (`day_of_reconfirm`, `safety_checkin`) reference RPCs that are genuinely MISSING `[VERIFIED: grep of supabase/migrations]` and have ZERO producers (no `enqueue_job` call enqueues any of those `job_type` values `[VERIFIED: grep enqueue_job(...)]`). Removing the handler entries is safe — but it forces synchronized edits to TWO Deno test files (`handlers_test.ts` `ALL_TYPES` assertion + `handlers_rpc_fail_closed_test.ts` per-handler reject cases) or the suite breaks. The `job_type` Postgres enum still contains those values; **do NOT drop enum values** (Postgres makes this destructive and `enqueue_job(job_type,...)` would reject a removed value) — leaving orphan enum values is harmless because nothing enqueues them and the runner's `if (!handler) throw` + `raise_admin_alert('job_missing_rpc')` path already fails closed.

**Primary recommendation:** Sequence E9 (delete dead handlers + fix 2 test files) → E5 (completion/no_show/expiry-sweep migration + new `job_type`-free cron that sweeps by time, or a new enqueued job) → E6/E7 (`cancel_night`/`update_night` definer RPCs copied from `match_make_offer`) → E8 (one `dispatch_notification` call inside `match_ingest_interest` + reconcile the `notif-map.ts` href). Apply all migrations to LOCAL only (`supabase db reset`), regen types (`pnpm db:types`), run SQL + Deno + Vitest suites, then run `mcp__supabase__get_advisors type=security` against local. PROD APPLY STAYS GATED.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Lock active→completed transition (E5) | Database / Storage (RPC) | Backend Services (cron job → RPC) | State machine terminus is a DB invariant; cron only triggers the time-based sweep |
| No-show flag (E5) | Database / Storage (RPC) | Presentation (host/either-party action) | Sets the existing `no_show` enum value; secured by `auth.uid()` membership in the lock |
| Past-dated `seeking` expiry sweep (E5) | Backend Services (cron) | Database (sweep RPC) | Time-driven batch; must run via the existing `process-jobs` cron pattern |
| `cancel_night` soft-unpublish (E6) | Database / Storage (definer RPC) | Presentation (`/my-nights`, interested list) | Mutation + notify is an atomic definer-RPC; UI only invokes it |
| `update_night` edit (E7) | Database / Storage (definer RPC) | Presentation (edit UI) | Field validation + material-change notify belong in the RPC transaction boundary |
| `interest_received` dispatch (E8) | Database / Storage (inside `match_ingest_interest`) | Presentation (inbox render via `notif-map.ts`) | Dispatch site is already in the swipe-ingestion RPC; render meta is client-side |
| Dead-handler removal (E9) | Backend Services (edge function) | — | Pure Deno/TypeScript edit to the dispatch table + its tests |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Date reaches `completed` via a HYBRID model: a cron job flips `locks.status` active→completed (and `date_instances`→completed) after the night's end time + a grace buffer; EITHER party can flag "didn't happen / no-show" instead (sets the existing `no_show` lock_status enum value, currently unreachable). The loop always terminates; no-shows are captured.
- **D-02:** A past-dated `seeking` night (no match) is auto-swept to a terminal state (completed/expired) by the same/related cron once `starts_at` + grace passes. Terminal; host can repost a new night.
- **D-03:** E5 only PRODUCES the terminal states + no-show signal. Computing `reliability_score` is E17/Phase 6 — do NOT build aggregation here (but make the `completed`/`no_show`/rating-window data shape clean for E17).
- **D-04:** `cancel_night` = SOFT unpublish (reversible, keeps interest data, hides from feed eligibility) — NOT a hard delete. When a cancelled night has already-interested candidates, dispatch a cancellation notification to those candidates.
- **D-05:** `update_night` lets the host edit time/venue/duration/ambient. On a MATERIAL field change (time or venue) for a night with interested candidates, notify those candidates. Non-material edits (ambient) need no notification.
- **D-06:** Both are SECURITY DEFINER RPCs that re-check `auth.uid()` = the night's creator (secure-by-default; reuse definer-RPC + RLS patterns; no `USING(true)`). Run the Supabase security advisor after the DDL.
- **D-07:** Dispatch `interest_received` from `match_ingest_interest`, deep-linked to that night's `/dates/[slug]/interested` list. In-app notification PER interest; throttle email/push to a digest when volume is high. Exact throttle threshold = research/planner discretion.
- **D-08:** REMOVE the dead job handlers and any enqueue paths now (`reconfirm_timeout`, `stale_date_close`, `expire_pending`/`pending_expiry`, `process_deletion`, and the `day_of_reconfirm`/`safety_checkin` handlers that have no producers/RPCs). Safety flows rebuilt in E19/Phase 6. Sequence E9 cleanup BEFORE E5 schedules any new cron jobs.

### Claude's Discretion
- Exact grace-buffer durations (completion + expiry sweep); cron schedule/cadence (reuse Vercel Cron + process-jobs).
- Throttle threshold/digest window for E8 email/push.
- Whether the no-show flag is a new RPC or folded into an existing transition.
- Minimal UI affordances for cancel/edit on `/my-nights` + interested list (follow DESIGN-SYSTEM.md; small surfaces).

### Deferred Ideas (OUT OF SCOPE)
- `reliability_score` aggregation from completed/no_show/ratings → E17/Phase 6.
- Rebuilding `day_of_reconfirm` + `safety_checkin` safety flows → E19/Phase 6 (Phase 2 only removes the dead handlers).
- `reject_candidate` (host decline) → E12/Phase 3.
- Hard delete of a night → out of scope (soft cancel only).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-E5 | Lock `completed` transition + expiry sweep | Lock state machine (`lock_status` enum already has `completed`/`no_show`), `date_instances.status` (`date_match_status` — lacks `no_show`), the `upper(time_range)+2h` grace convention from accept_lock, `close_rating_window` coordination, `enqueue_job`/cron mechanism — all read and documented below |
| REQ-E6 | Host pre-match cancel night (soft unpublish) | `match_make_offer` definer/idempotency/dispatch exemplar; `date_instances_creator_all` RLS; `queue_entries` interested-candidate targeting; `date_match_status` `cancelled` value |
| REQ-E7 | Host edit night | `post_night` field-validation exemplar (venue-live check, ambient-active check, duration bounds); `set_updated_at` trigger; `time_range` is GENERATED (recomputes from `starts_at`+`duration_min`) |
| REQ-E8 | `interest_received` notification | `match_ingest_interest` dispatch site; `dispatch_notification` signature + consent-gate gap; `notif-map.ts` href reconciliation (currently `/my-nights`, D-07 wants interested list) |
| REQ-E9 | Remove poison-loop | `process-jobs/handlers.ts` dead entries; missing-RPC + zero-producer verification; the 2 Deno test files that must change in lockstep |

## Standard Stack

No new packages. This phase uses only the existing, in-repo stack.

### Core (already installed — versions from `STACK.md` / `package.json`)
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Supabase CLI | 2.101.0 `[VERIFIED: supabase --version]` | local migrate/reset/types; functions serve | Project's canonical DB tool |
| PostgreSQL | 17 (local on `127.0.0.1:54322`) `[VERIFIED: config.toml]` | RPCs, enums, RLS | Source of truth |
| Deno | 1.x (Supabase edge runtime) | `process-jobs` handlers + tests | Existing edge runtime |
| Vitest | 2.1.8 | TS unit tests (web + packages) | Repo test runner |
| `@supabase/supabase-js` | 2.45.0 | client + edge RPC calls | Repo client |

### Local apply / verify commands (from root `package.json`)
```bash
# Local Supabase IS running (54321 returned HTTP 200) [VERIFIED: curl]
pnpm db:reset          # supabase db reset — applies ALL migrations + seed fresh
pnpm db:types          # supabase gen types typescript --local > packages/types/src/database.ts
pnpm db:test           # runs every supabase/tests/*.sql with ON_ERROR_STOP=1 (psql assertions)
pnpm test              # vitest run (web + packages)
# Deno handler tests (E9):
deno test --allow-env supabase/functions/process-jobs/handlers_test.ts \
                       supabase/functions/process-jobs/handlers_rpc_fail_closed_test.ts
```

**Apply protocol (gated):** migrations land in `supabase/migrations/` with the `YYYYMMDDHHMMSS_<slug>.sql` naming convention (latest is `20260603120100_m85_*`). `pnpm db:reset` applies the full chain locally. After local apply, regen types, run all suites, then run the security advisor (below). **PROD APPLY STAYS GATED — owner-approved, batched, separate.**

## Package Legitimacy Audit

No external packages are installed in this phase (backend SQL + TypeScript edits to existing files only). **Audit: N/A — zero new dependencies.**

## Architecture Patterns

### System Architecture Diagram (this phase's data flow)

```text
E8  right-swipe ─► record_swipe() ─► match_ingest_interest(instance)
                                           │  (NEW: after the INSERT)
                                           └─► dispatch_notification(creator,
                                                 'interest_received',
                                                 {date_instance_id, ...})  ──► notifications
                                                                                   │
                                                            in-app render via notif-map.ts (href → /dates/<id>/interested)

E6  host taps "cancel" ─► cancel_night(p_instance, p_idem_key) [DEFINER, auth.uid()=creator]
        │  set date_instances.status='cancelled' (soft, reversible)
        └─► for each interested queue_entry → dispatch_notification(candidate, <cancel type>)

E7  host edits ─► update_night(p_instance, p_starts_at?, p_venue?, p_duration?, p_ambient?, p_idem_key)
        │  validate (venue live, ambient active, duration 30..1440), UPDATE date_instances
        │  (time_range RECOMPUTES via GENERATED column)
        └─► IF starts_at OR venue changed AND has interested → dispatch_notification(candidates, <change type>)

E5  Vercel Cron (* * * * *) ─► /api/cron/process-jobs ─► process-jobs edge ─► claim_due_jobs()
        │                                                                         │
        │  completion path: a sweep RPC finds locks where status='active'         │
        │  AND upper(time_range)+grace < now()  → status='completed',             │
        │  date_instances.status='completed'; coordinate close_rating_window      │
        │  no_show path: either party calls flag_no_show(lock) [DEFINER, membership check]
        │  expiry path: date_instances status='seeking' AND starts_at+grace<now() → 'completed'/'expired'
        ▼
E9  (DONE FIRST) handlers.ts dispatch table: DELETE dead entries; runner's
    `if(!handler) throw` + raise_admin_alert('job_missing_rpc') stays as the fail-closed net
```

### Pattern 1: SECURITY DEFINER RPC (the canonical exemplar for E5/E6/E7)
**What:** Definer RPC that re-checks `auth.uid()`, gates on feature flag, replays idempotency, advisory-locks the instance, mutates, dispatches notifications, records analytics, stores idempotency, returns.
**When to use:** Every E6/E7 RPC and the E5 no-show RPC.
**Source:** `supabase/migrations/20260527126300_p5_make_offer.sql` (read in full). Key skeleton:
```sql
create or replace function <name>(p_actor uuid, p_instance uuid, ..., p_idem_key uuid)
returns <type> language plpgsql security definer set search_path=public as $fn$
declare cre uuid; st date_match_status; prior jsonb;
begin
  -- 1. auth re-check (C10)
  if p_actor is distinct from auth.uid() then raise exception 'auth_mismatch' using errcode='P5001'; end if;
  -- 2. (optional) feature flag gate
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false)
    then raise exception 'feature_disabled' using errcode='P5000'; end if;
  -- 3. idempotency replay
  prior := match_idem_lookup(p_actor, '<action>', p_idem_key);
  if prior is not null then return (prior->>'<k>')::<type>; end if;
  -- 4. serialize this instance
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  -- 5. load + ownership check
  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;
  -- ... mutate, dispatch_notification(...), analytics_events insert ...
  perform match_idem_store(p_actor, '<action>', p_idem_key, jsonb_build_object(...));
end $fn$;
revoke execute on function <name>(...) from public, anon;  -- if internal/admin
grant  execute on function <name>(...) to authenticated;   -- if a public C2 RPC (auth enforced inside)
```
Idempotency helpers (`match_idem_lookup`/`match_idem_store`, `match_instance_lock_key`) live in `20260527126100_p5_idempotency.sql` `[VERIFIED]`. `transition_idempotency` is the ledger table.

### Pattern 2: Field-validating mutation RPC (the exemplar for E7 `update_night`)
**Source:** `post_night` in `20260602120300_m4_post_night_ambient.sql`. It validates, in order: `auth.uid()` not null; verified + dating-enabled; itinerary ownership; **venue must be `approval_status='live' AND is_active`** (curated-place gate); **ambient must be `is_active`**; `duration_min` is bounded by the table CHECK (30..1440). `update_night` should re-use these exact validation clauses for the fields it allows to change.
**CRITICAL — time_range is a GENERATED column:** `date_instances.time_range tstzrange GENERATED ALWAYS AS (tstzrange_from_start_duration(starts_at, duration_min)) STORED` `[VERIFIED: 20260525120300]`. So `update_night` only writes `starts_at`/`duration_min` and `time_range` recomputes automatically — never write `time_range` directly.
**Ambient column nuance:** the night stores `date_instances.ambient_sound_id uuid` (FK → `ambient_sounds`, added in `20260602120100_m4_date_instances_ambient.sql`) `[VERIFIED]`, NOT a text URL. Validate against `ambient_sounds.is_active`.

### Pattern 3: Notification dispatch (E5 cancel-notify, E6, E7, E8)
**Signature:** `dispatch_notification(p_user uuid, p_type notification_type, p_payload jsonb default '{}') returns json` `[VERIFIED: 20260525123600_p2_dispatch_notification.sql]`. It is `revoke`d from public — call it only from inside another DEFINER RPC (`perform dispatch_notification(...)`), exactly as `match_make_offer` does.
**Payload convention:** `{title, body, data, dedup_key}` for the edge sender; loop RPCs also pass entity ids like `{instance, offer_id, lock_id}`. Use `dedup_key` to throttle (the function short-circuits on a duplicate `(type, dedup_key)`).
**Consent-gate GAP (E8-relevant):** the gate in `dispatch_notification` has explicit branches for `offer_*`, `new_match`, `new_message`, `date_reconfirm`/`rating_request`, `account`, `verification_*` — but **NO branch for `interest_received`** `[VERIFIED: read the full consent ladder]`. With no branch it falls through to permissive (always notifies in-app). To honor D-07's "throttle email/push to a digest," the throttle must be implemented at the dispatch call-site (e.g. a `dedup_key` keyed on `interest_received:<instance>:<host>:<hour-bucket>` so repeated swipes within a window collapse to one notification row) OR by adding an `interest_received → matches_enabled` branch to the consent gate. Recommend the `dedup_key` digest-bucket approach (no `dispatch_notification` edit; in-app stays per-interest only if a finer key is used — note D-07 says "in-app PER interest, throttle email/push," so a count-aware payload + coarse dedup for email is the cleanest split). **[ASSUMED]** that a 1-hour bucket is acceptable — confirm with owner.

### Pattern 4: Cron job dispatch (E5 sweep scheduling)
**Mechanism:** `apps/web/vercel.json` defines crons; `/api/cron/process-jobs` (`route.ts`, auth via `Bearer CRON_SECRET`) proxies to the `process-jobs` edge function (`x-jobs-secret: JOBS_RUNNER_SECRET`), which calls `requeue_stuck_jobs()` then `claim_due_jobs()` and dispatches each claimed row through `HANDLERS[job.type]` `[VERIFIED: read index.ts + route.ts]`.
**Two ways to schedule E5's sweep — recommend the dedicated-cron-route approach:**
- (a) **Dedicated Vercel cron route** (like `/api/cron/offer-expiring` which runs `*/30 * * * *`): add a new `/api/cron/close-loop` route that invokes a service-role sweep RPC directly. This AVOIDS adding a new `job_type` enum value and is the simplest fit for a time-swept batch (no per-entity timer needed). **Preferred.**
- (b) Add a self-perpetuating job via `enqueue_job` — heavier; needs a new enum value and a producer. Not recommended for a periodic sweep.
The completion-grace convention to reuse: accept_lock computes `lock_end := upper(rng) + interval '2 hours'` for the rating window `[VERIFIED: 20260527126400 line 128]`. E5's completion sweep should use the SAME grace anchor (`upper(time_range) + grace`) so completion and rating-window close are coherent.

### Recommended migration/file layout
```
supabase/migrations/
  2026060312XXXX_e9_<noop or none>          # E9 is edits to handlers.ts, not a migration
  2026060312XXXX_e5_loop_completion.sql     # sweep RPC + no_show RPC + (maybe) date_match_status 'expired'
  2026060312XXXX_e6_cancel_night.sql        # cancel_night definer RPC
  2026060312XXXX_e7_update_night.sql        # update_night definer RPC
  2026060312XXXX_e8_interest_dispatch.sql   # CREATE OR REPLACE match_ingest_interest with dispatch
supabase/functions/process-jobs/
  handlers.ts                               # DELETE dead entries (E9)
  handlers_test.ts                          # update ALL_TYPES list (E9)
  handlers_rpc_fail_closed_test.ts          # remove dead-handler reject cases (E9)
supabase/tests/
  e5_loop_completion.sql                    # new psql-assertion test
  e6_cancel_night.sql
  e7_update_night.sql
  e8_interest_dispatch.sql
apps/web/app/api/cron/close-loop/route.ts   # E5 cron route (if approach (a))
apps/web/vercel.json                        # add the close-loop cron entry
apps/web/lib/after5/notif-map.ts            # E8: reconcile interest_received href → interested list
apps/web/app/my-nights/page.tsx + components # E6/E7 minimal UI
apps/web/app/dates/[slug]/interested/...    # E6/E7 UI (CancelWithReasonPicker pattern exists)
packages/api-client/src/feed.ts             # E6/E7 client wrappers (postNight pattern)
```

### Anti-Patterns to Avoid
- **Writing `time_range` directly in `update_night`** — it's GENERATED; write `starts_at`/`duration_min` only.
- **Dropping `job_type` enum values in E9** — destructive in Postgres and breaks `enqueue_job`; leave orphan values (nothing enqueues them).
- **`USING(true)` on any UPDATE/DELETE policy** — forbidden by CLAUDE.md; E6 soft-cancel mutates via DEFINER RPC, not via a broadened RLS policy.
- **Calling `dispatch_notification` from a non-definer context** — it's `revoke`d from public; only `perform` it inside a DEFINER RPC.
- **Removing E9 handlers without updating `handlers_test.ts` `ALL_TYPES` + the fail-closed reject cases** — the suite asserts both and will go red.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotent RPC replay | Custom dedup table | `match_idem_lookup`/`match_idem_store` + `transition_idempotency` | Already the loop-wide ledger; planner must pass a `p_idem_key uuid` |
| Per-instance serialization | Ad-hoc locking | `pg_advisory_xact_lock(match_instance_lock_key(p_instance))` | Matches every match-* RPC; avoids offer/cancel races |
| Notification consent/quiet-hours/rate-limit/channel | New notify logic | `dispatch_notification(p_user, p_type, p_payload)` | Already does consent → quiet-hours → rate-limit → channel pick |
| Job claiming/retry/dead-letter | New queue | `enqueue_job`/`claim_due_jobs`/`fail_job` + `process-jobs` | Canonical jobs table; one source (C1) |
| Time recomputation on edit | Manual range math | GENERATED `time_range` column | Recomputes from `starts_at`+`duration_min` |
| Updated-at stamping | Manual `updated_at=now()` everywhere | `set_updated_at()` trigger (already on `date_instances` + `locks`) | Trigger fires on every UPDATE |

**Key insight:** Every primitive E5–E9 needs already exists and is battle-tested in the live loop. The work is composition + deletion, not construction.

## Runtime State Inventory

This is a brownfield phase touching live state. Explicit answers:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | LOCAL Supabase has the full schema; the `job_type` enum already contains the dead values (`pending_expiry`, `stale_date_close`, `day_of_reconfirm`, `safety_checkin`, `reconfirm_timeout`, `deletion_process`) `[VERIFIED: 20260525123000_p2_jobs.sql]`. The `jobs` table may contain stranded rows of those types on prod, but they have no producers and the runner fails-closed via `raise_admin_alert`. | E9: no enum change. Optionally a one-off `update jobs set status='cancelled' where type in (...dead...) and status in ('pending','running')` — verify against local/prod first; likely 0 rows. |
| Live service config | Vercel Cron defs live in `apps/web/vercel.json` (in git) `[VERIFIED]`. E5 adds a cron entry there. No UI-only cron config. | E5: add cron entry to `vercel.json`; deploys with the app (gated). |
| OS-registered state | None — all scheduling is Vercel Cron (declarative in `vercel.json`), no OS scheduler. | None. |
| Secrets/env vars | `CRON_SECRET`, `JOBS_RUNNER_SECRET` already required + wired (process-jobs route reads them) `[VERIFIED: route.ts]`. No new secrets needed; E5's close-loop route reuses `CRON_SECRET`/`JOBS_RUNNER_SECRET`. | None (reuse existing). |
| Build artifacts / installed packages | `packages/types/src/database.ts` is GENERATED from the schema. After E5–E8 migrations apply locally, it is STALE until `pnpm db:types` regenerates it (the new `notification_type` values + any new RPC signatures). `apps/web/.next/` build cache contains stale compiled chunks (irrelevant; rebuilt). | Run `pnpm db:types` after local apply, BEFORE typechecking the UI/api-client edits. |

## Common Pitfalls

### Pitfall 1: Two status models drift (locks vs date_instances)
**What goes wrong:** `lock_status` enum = `active/completed/cancelled/no_show`; `date_match_status` enum = `none/seeking/matched/completed/cancelled` — **`date_match_status` has NO `no_show` value** `[VERIFIED: both migrations read]`. E5 must transition BOTH `locks.status` and `date_instances.status` to `completed`, but a no-show maps to `locks.status='no_show'` while `date_instances.status` stays `completed` (the date was scheduled; the no-show is a lock-level outcome E17 reads).
**How to avoid:** Decide the mapping explicitly in the plan: `no_show` is a lock-level signal only; `date_instances` terminal state is `completed`. If a `date_match_status` `expired` value is wanted for E5's seeking-sweep (D-02), it must be ADDED via `alter type ... add value if not exists 'expired'` (additive, idempotent — same convention as `20260603120000_gated_inbox_notification_types.sql`).
**Warning sign:** A migration trying to set `date_instances.status='no_show'` will throw `invalid input value for enum`.

### Pitfall 2: E9 handler removal breaks two test files silently
**What goes wrong:** `handlers_test.ts` has `const ALL_TYPES = [...all 13...]` and asserts `HANDLERS[t]` is a function for each `[VERIFIED]`. `handlers_rpc_fail_closed_test.ts` has explicit `assertRejects` cases for `stale_date_close`, `pending_expiry`, `reconfirm_timeout`, `deletion_process`, `chat_purge`, `analytics_relay` `[VERIFIED]`. Deleting handlers without editing these two files fails the Deno suite.
**How to avoid:** In the same task, prune `ALL_TYPES` and delete the corresponding reject test cases. **Scope note:** D-08 lists 6 handlers to remove but `chat_purge` (→ missing `chat_purge_thread`) and `analytics_relay` (→ missing `analytics_relay_drain`) are ALSO dead-with-missing-RPC `[VERIFIED]` yet NOT in D-08's removal list (they belong to P6/S7 + P11/S12 future scopes). **Recommendation: remove ONLY the D-08 six; leave `chat_purge`/`analytics_relay` (their owning phases will wire the RPCs).** Flag this boundary to the planner — it is an Open Question.
**Warning sign:** `deno test` red on "missing handler" or an orphaned `assertRejects`.

### Pitfall 3: `interest_received` deep-link mismatch
**What goes wrong:** `notif-map.ts` currently maps `interest_received` href to `() => '/my-nights'` (in `GATED_NOTIF_META`) `[VERIFIED: line 77]`, but D-07 requires deep-link to `/dates/[slug]/interested`. The `inbox-activity.ts` group key is `payload.date_instance_id` `[VERIFIED]`.
**How to avoid:** E8 must (a) dispatch with `payload.date_instance_id` set (the group key the inbox already expects) and (b) update the `hrefFor` to `(p) => { const id = str(p,'date_instance_id'); return id ? \`/dates/${id}/interested\` : '/my-nights'; }`. The route is `/dates/[slug]/interested` where `[slug]` carries the instance id `[VERIFIED: interested/page.tsx reads slug as instanceId]`.
**Warning sign:** Notification taps land on `/my-nights` instead of the specific interested list.

### Pitfall 4: `match_ingest_interest` runs on EVERY right-swipe (idempotent re-ingest)
**What goes wrong:** `match_ingest_interest(p_instance)` re-scans ALL right-swipes for the instance and `ON CONFLICT DO NOTHING`s; it returns `n` = rows inserted (0 if the swiper was already enqueued) `[VERIFIED]`. A naive E8 dispatch on every call would notify the host on re-ingests too.
**How to avoid:** Only dispatch when `n > 0` (a genuinely new interested candidate), and key the dedup so a host isn't spammed. Note `match_ingest_interest` doesn't know WHICH swiper is new from the bulk insert — the plan should either dispatch a count-bearing notification keyed by instance, or refine the insert to capture the new candidate id. Recommend: dispatch once per `n>0` with `payload {date_instance_id, new_count: n}` and a coarse `dedup_key` digest bucket for email.
**Warning sign:** Host gets a notification on repeat swipes by the same person.

### Pitfall 5: Either-party no-show authorization
**What goes wrong:** D-01 says EITHER party can flag no-show. The definer RPC must authorize `auth.uid()` as a MEMBER of the lock (`creator_id` OR `matched_user_id`), not just the creator (unlike E6/E7 which are creator-only).
**How to avoid:** No-show RPC checks `auth.uid() in (creator_id, matched_user_id)` against the `locks` row. This is a DIFFERENT auth predicate from the creator-only E6/E7 RPCs — make it explicit.

## Code Examples

### E8 dispatch site (inside `match_ingest_interest`, CREATE OR REPLACE)
```sql
-- Source pattern: match_make_offer dispatch + the existing match_ingest_interest body
-- (supabase/migrations/20260527126200_p5_shortlist.sql)
create or replace function match_ingest_interest(p_instance uuid)
returns int language plpgsql security definer set search_path=public as $fn$
declare n int := 0; cre uuid;
begin
  select creator_id into cre from date_instances where id=p_instance;
  insert into queue_entries(date_instance_id, candidate_id, creator_id, status)
  select s.date_instance_id, s.swiper_id, s.creator_id, 'interested'
    from swipes s
   where s.date_instance_id=p_instance and s.direction='right'
     and not exists (select 1 from blocks b where (b.blocker_id=cre and b.blocked_id=s.swiper_id)
                                                or (b.blocker_id=s.swiper_id and b.blocked_id=cre))
  on conflict (date_instance_id, candidate_id) do nothing;
  get diagnostics n = row_count;

  -- E8: only notify the host when a NEW interested candidate was added.
  if n > 0 and cre is not null then
    perform dispatch_notification(cre, 'interest_received',
      jsonb_build_object(
        'date_instance_id', p_instance,
        'new_count', n,
        'dedup_key', 'interest_received:'||p_instance::text  -- coarse: collapse to one in-app row per instance; refine per D-07
      ));
  end if;
  return n;
end $fn$;
-- grants unchanged (stays revoked from public; called by record_swipe DEFINER)
```
**Note:** `interest_received` is already a valid `notification_type` value via `20260603120000_gated_inbox_notification_types.sql` (applied to prod per CONTEXT) — no enum migration needed for E8 `[VERIFIED]`.

### E6 soft-cancel skeleton (creator-only, notify interested)
```sql
create or replace function cancel_night(p_actor uuid, p_instance uuid, p_idem_key uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid; st date_match_status; rec record; prior jsonb;
begin
  if p_actor is distinct from auth.uid() then raise exception 'auth_mismatch' using errcode='P5001'; end if;
  prior := match_idem_lookup(p_actor, 'cancel_night', p_idem_key);
  if prior is not null then return; end if;
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;
  if st <> 'seeking' then raise exception 'not_cancellable' using errcode='P0001'; end if;  -- pre-match only (E6)

  update date_instances set status='cancelled', updated_at=now() where id=p_instance;  -- SOFT: row kept, status flips

  -- notify already-interested candidates (D-04)
  for rec in select candidate_id from queue_entries
              where date_instance_id=p_instance
                and status in ('interested','shortlisted','standby')  -- not offer_active/locked (pre-match)
  loop
    perform dispatch_notification(rec.candidate_id, 'account',  -- TODO: choose a cancel notification_type (see Open Q)
      jsonb_build_object('date_instance_id', p_instance, 'reason', 'host_cancelled'));
  end loop;

  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('night_cancelled', p_actor, 'date_instance', p_instance, jsonb_build_object());
  perform match_idem_store(p_actor, 'cancel_night', p_idem_key, jsonb_build_object('ok', true));
end $fn$;
revoke execute on function cancel_night(uuid, uuid, uuid) from public, anon;
grant execute on function cancel_night(uuid, uuid, uuid) to authenticated;
```

### E5 completion sweep (called by the close-loop cron; service-role, stale-tolerant)
```sql
-- Pattern mirrors close_rating_window: SECURITY DEFINER, service-role-only, idempotent, stale-tolerant.
create or replace function sweep_loop_terminus()
returns int language plpgsql security definer set search_path=public as $fn$
declare n int := 0;
begin
  -- completion: active locks whose night ended + grace
  with done as (
    update locks set status='completed', updated_at=now()
     where status='active' and upper(
       (select time_range from date_instances d where d.id=locks.date_instance_id)
     ) + interval '3 hours' < now()  -- grace [ASSUMED 3h — confirm]
    returning date_instance_id)
  update date_instances set status='completed', updated_at=now()
   where id in (select date_instance_id from done) and status='matched';

  -- expiry sweep: past-dated seeking nights (D-02)
  update date_instances set status='completed', updated_at=now()  -- or 'expired' if enum value added
   where status='seeking' and lower(time_range) + interval '3 hours' < now();
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function sweep_loop_terminus() from public, anon, authenticated;  -- service-role-only
```

### SQL test convention (psql assertion, NOT pgTAP)
```sql
-- Source: supabase/tests/b_job_rpcs.sql — \i fixtures, DO blocks, RAISE on failed assert, ROLLBACK per case.
\i supabase/tests/_fixtures.sql            -- provides mk_user / mk_itinerary / mk_instance(itin, creator, starts_at)
DO $$ DECLARE cre uuid; it uuid; inst uuid; BEGIN
  cre := mk_user('e5_cre'); it := mk_itinerary(cre);
  inst := mk_instance(it, cre, now() - interval '1 day');  -- PAST-DATED for sweep
  -- ... insert lock active ... PERFORM sweep_loop_terminus();
  PERFORM 1 FROM locks WHERE date_instance_id=inst AND status='completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'E5: lock not completed'; END IF;
END $$;
```
**Caveat:** `mk_instance` requires the `kelowna` city seed and inserts with default `duration_min=150`, `status='seeking'` `[VERIFIED]`. For a PAST-dated instance, `post_night`'s `starts_at > now()` guard does NOT apply because the fixture inserts directly — use the fixture, not `post_night`, for past-dated test data.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lock lifecycle ends at `matched` | E5 adds `completed`/`no_show` terminus | This phase | Unblocks E17 reliability |
| Dead handlers with missing RPCs sit in dispatch table relying only on fail-closed net | E9 removes the dead branches | This phase | Queue can't read-as-real dead code |
| `interest_received` defined but never dispatched | E8 wires dispatch | This phase | Demand→supply signal closes |

**Deprecated/outdated within scope:** the `day_of_reconfirm`/`safety_checkin` handlers (removed here, rebuilt properly in E19/Phase 6).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A 1-hour digest bucket for E8 email/push throttle is acceptable | Pattern 3 / Pitfall 4 | Host gets too many/few emails; tune the window |
| A2 | Completion + expiry grace buffer of ~3h is acceptable | E5 sweep example | Nights complete too early/late; D leaves this to discretion (confirm) |
| A3 | `date_instances` terminal state for both completion AND seeking-sweep is `completed` (with optional new `expired` enum value for the sweep) | Pitfall 1 | E17 may expect distinct `expired` vs `completed`; confirm enum strategy |
| A4 | E9 removes ONLY the six D-08 handlers; `chat_purge`/`analytics_relay` stay (future-phase scope) | Pitfall 2 | If owner wants them gone too, expand removal + tests |
| A5 | No-show flag is a NEW DEFINER RPC with membership auth (`creator OR matched`) | Pitfall 5 | If folded into the sweep instead, auth model differs (D leaves this to discretion) |
| A6 | Cancel/material-change notifications reuse an existing `notification_type` (no new enum value) — exact type TBD | E6 example / Open Q | A new `night_cancelled`/`night_changed` enum value would need an additive migration |

## Open Questions (RESOLVED)

> All resolved in 02-CONTEXT before planning: Q1 (E6/E7 notif types) → D-09 add `night_cancelled`+`night_changed`; Q2 (seeking-sweep state) → D-10 add `expired` to `date_match_status`; Q3 (E9 scope) → D-11 remove only the 6 D-08 handlers, keep `chat_purge`/`analytics_relay`. Plans 02-02/02-03/02-01 implement these. Do not re-open.

1. **Which `notification_type` for cancel (E6) and material-change (E7)?**
   - What we know: `interest_received` exists; `lock_cancelled_frozen`/`lock_cancelled_rolled` exist but are LOCK-level (post-match), not pre-match night cancellation. `account` is generic.
   - What's unclear: whether to add `night_cancelled` + `night_changed` enum values (additive, idempotent, like the gated-types migration) or reuse `account`.
   - Recommendation: add two additive enum values + `notif-map.ts` entries for clean UX; flag for owner since it touches `notification_type`.

2. **`date_match_status` `expired` vs `completed` for the D-02 seeking sweep.**
   - What we know: enum lacks `expired`; E17 will consume the terminus.
   - Recommendation: add `expired` (additive) so a never-matched night is distinguishable from a completed date; confirm with E17 owner.

3. **Does the consent gate need an `interest_received` branch?**
   - What we know: no branch → permissive in-app (desired per D-07 "in-app PER interest"). Email/push throttle handled via `dedup_key`.
   - Recommendation: leave the gate as-is; throttle at the call site. Confirm the digest semantics.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | local apply/reset/types | ✓ | 2.101.0 | — |
| Local Supabase stack | apply migrations + advisors | ✓ (54321 → HTTP 200) | PG17 | — |
| psql | SQL assertion tests | ✓ (used by `db:test`) | PG17 client | — |
| Deno | process-jobs handler tests | ✓ (Supabase-bundled) | 1.x | — |
| `mcp__supabase__get_advisors` | post-DDL security advisor | assume available (Supabase MCP active) | — | manual `supabase` advisor / SQL lint |

**Missing dependencies with no fallback:** none. **Missing with fallback:** none — local stack is up.

## Validation Architecture

`workflow.nyquist_validation = true` `[VERIFIED: config.json]` — section required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | psql-assertion SQL scripts (`ON_ERROR_STOP=1`, NOT pgTAP) + Vitest 2.1.8 (TS) + Deno std/assert (edge handlers) |
| Config file | `vitest.config.ts` / `vitest.workspace.ts`; SQL via `package.json` `db:test`; Deno inline |
| Quick run command | per-item: `psql $DB_URL -v ON_ERROR_STOP=1 -f supabase/tests/<file>.sql` |
| Full suite command | `pnpm db:reset && pnpm db:test && pnpm test && deno test --allow-env supabase/functions/process-jobs/*_test.ts` |

`$DB_URL = postgresql://postgres:postgres@127.0.0.1:54322/postgres` `[VERIFIED: _all_5b.sh]`.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-E5 | past-dated active lock → completed; past-dated seeking → completed/expired; no_show reachable by either party | SQL assertion | `psql $DB_URL -v ON_ERROR_STOP=1 -f supabase/tests/e5_loop_completion.sql` | ❌ Wave 0 |
| REQ-E6 | creator soft-cancels a seeking night; status='cancelled', row kept, interested candidates notified; non-creator rejected (42501) | SQL assertion | `... -f supabase/tests/e6_cancel_night.sql` | ❌ Wave 0 |
| REQ-E7 | creator edits time/venue/duration/ambient; time_range recomputes; material change notifies interested; invalid venue/ambient rejected | SQL assertion | `... -f supabase/tests/e7_update_night.sql` | ❌ Wave 0 |
| REQ-E8 | right-swipe with n>0 dispatches interest_received to creator with date_instance_id; re-swipe (n=0) does not | SQL assertion | `... -f supabase/tests/e8_interest_dispatch.sql` | ❌ Wave 0 |
| REQ-E8 | inbox renders interest_received deep-linked to interested list | TS unit | `pnpm test` (extend `notif-map`/`inbox-activity` tests) | partial — `inbox-activity.test.ts` exists, href assertion ❌ |
| REQ-E9 | dead handlers removed; remaining handlers all resolve; fail-closed net intact | Deno | `deno test --allow-env supabase/functions/process-jobs/handlers_test.ts handlers_rpc_fail_closed_test.ts` | ✅ exists — must be EDITED |
| REQ-E5 | cron route auth + invokes sweep | TS unit | `pnpm test` (mirror `process-jobs/route.test.ts`) | ❌ Wave 0 (if cron route added) |

### Sampling Rate
- **Per task commit:** the single SQL/Deno/Vitest file touched by that task (`psql ... -f <file>` or `pnpm test <file>` or `deno test <file>`).
- **Per wave merge:** `pnpm db:reset && pnpm db:test` (applies all migrations fresh + runs every SQL assertion) + `pnpm test` + Deno handler tests.
- **Phase gate:** full suite green; `pnpm db:types` regenerated and committed; `mcp__supabase__get_advisors type=security` clean against local; then `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `supabase/tests/e5_loop_completion.sql` — REQ-E5 (completion + no_show + expiry sweep)
- [ ] `supabase/tests/e6_cancel_night.sql` — REQ-E6
- [ ] `supabase/tests/e7_update_night.sql` — REQ-E7
- [ ] `supabase/tests/e8_interest_dispatch.sql` — REQ-E8 (dispatch site)
- [ ] Edit `handlers_test.ts` `ALL_TYPES` + `handlers_rpc_fail_closed_test.ts` reject cases — REQ-E9 (these EXIST; they must change with the handler deletion)
- [ ] Extend `apps/web/lib/after5/__tests__/inbox-activity.test.ts` / a notif-map href test — REQ-E8 deep-link
- [ ] (If cron approach (a)) `apps/web/app/api/cron/close-loop/route.test.ts` — mirror `process-jobs/route.test.ts`
- [ ] `pnpm db:types` regen after local apply (gates UI/api-client typecheck)

**Critical ordering for validation:** migrations must apply LOCALLY (`pnpm db:reset`) and `pnpm db:types` must regenerate `packages/types/src/database.ts` BEFORE any TS that references new RPC signatures or notification types will typecheck.

## Security Domain

`security_enforcement: true`, ASVS level 1, block on high `[VERIFIED: config.json]`.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth `auth.uid()`; every E5 no-show / E6 / E7 RPC re-checks `auth.uid()` inside the DEFINER body |
| V3 Session Management | no (handled by Supabase SSR cookies; no new surface) | — |
| V4 Access Control | yes | E6/E7: `auth.uid() = creator_id` re-check (NOT RLS alone); E5 no-show: `auth.uid() in (creator_id, matched_user_id)`; DEFINER `revoke from public` + `grant to authenticated` only where intended; service-role-only `revoke all` for the sweep RPC |
| V5 Input Validation | yes | E7 reuses `post_night` validators (venue `approval_status='live' AND is_active`; ambient `is_active`; `duration_min` 30..1440 CHECK); `starts_at` sanity; enum-typed params |
| V6 Cryptography | no | — |

### Known Threat Patterns for Postgres-DEFINER + Supabase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Privilege escalation via DEFINER without `auth.uid()` re-check | Elevation of Privilege | Mandatory `if p_actor is distinct from auth.uid() then raise 'auth_mismatch'` (P5001) + ownership check |
| `search_path` hijack in DEFINER function | Elevation of Privilege | Every function declares `set search_path=public` (repo-wide convention `[VERIFIED]`) |
| Over-broad RLS enabling unauthorized soft-cancel/edit | Tampering | NO `USING(true)` on UPDATE/DELETE (CLAUDE.md); mutations go through DEFINER RPC, not broadened RLS |
| Notification dispatch from untrusted caller | Spoofing | `dispatch_notification` is `revoke`d from public; only `perform`ed inside DEFINER RPCs |
| Cron endpoint abuse | Spoofing/DoS | `/api/cron/*` requires `Bearer CRON_SECRET`; edge requires `x-jobs-secret: JOBS_RUNNER_SECRET` `[VERIFIED]` |
| Poison-loop / silent job skip | DoS | E9 removes dead branches; runner's `if(!handler) throw` + `raise_admin_alert('job_missing_rpc')` fail-closed net stays |

**Post-DDL gate (mandatory):** after local apply, run `mcp__supabase__get_advisors` with `type=security` against the local project and resolve any high findings before the phase gate. (Per CLAUDE.md: "run the Supabase security advisor after every DDL.")

## Sources

### Primary (HIGH confidence — read directly this session)
- `supabase/migrations/20260525120700_p0_locks.sql` — `lock_status` enum, `locks` table, RLS, `set_updated_at`
- `supabase/migrations/20260525120300_p0_date_instances.sql` — `date_match_status` enum, GENERATED `time_range`, `date_instances_creator_all` RLS
- `supabase/migrations/20260527127200_p5_job_rpcs_backfill.sql` — `close_rating_window` (stale-tolerant/idempotent exemplar), `rating_closed_at`
- `supabase/migrations/20260527126300_p5_make_offer.sql` — canonical DEFINER+idem+dispatch+enqueue exemplar
- `supabase/migrations/20260602120300_m4_post_night_ambient.sql` + `20260602120700_m4_post_night_drop_4arg.sql` — `post_night` validation exemplar + ambient FK
- `supabase/migrations/20260527126200_p5_shortlist.sql` + `20260527126700_p5_s5_swipe_hook.sql` — `match_ingest_interest` (E8 site) + `record_swipe` hook
- `supabase/migrations/20260525123600_p2_dispatch_notification.sql` — `dispatch_notification` signature + consent-gate (no interest_received branch)
- `supabase/migrations/20260603120000_gated_inbox_notification_types.sql` — `interest_received` enum (applied), additive-enum convention
- `supabase/migrations/20260525123000_p2_jobs.sql` + `20260525123100_p2_jobs_rpcs.sql` — `job_type`/`job_status` enums, jobs table, `enqueue_job`/`claim_due_jobs`/`cancel_jobs`
- `supabase/migrations/20260527126400_p5_accept_lock.sql` — `upper(time_range)+2h` grace convention for rating_window
- `supabase/functions/process-jobs/{index.ts,handlers.ts,handlers_test.ts,handlers_rpc_fail_closed_test.ts}` — E9 dead handlers + fail-closed net + the two test files
- `apps/web/vercel.json` + `apps/web/app/api/cron/process-jobs/route.ts` — cron mechanism
- `apps/web/lib/after5/notif-map.ts` + `inbox-activity.ts` — `interest_received` href (`/my-nights`) + group key
- `apps/web/app/my-nights/page.tsx` + `apps/web/app/dates/[slug]/interested/page.tsx` — host UI surfaces; `[slug]` = instance id
- `supabase/tests/b_job_rpcs.sql` + `_fixtures.sql` + `_all_5b.sh` + root `package.json` — SQL test convention + runners
- `.planning/codebase/ARCHITECTURE.md` + `CONVENTIONS.md` + `./CLAUDE.md` — patterns + constraints
- `.planning/REQUIREMENTS.md` (REQ-E5..E9) + `02-CONTEXT.md` (D-01..D-08) + MVP-AUDIT §B/§E lines 160–206

### Secondary / Tertiary
- None — entire research grounded in first-party codebase reads; no WebSearch needed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all tooling verified present (CLI 2.101.0, local stack HTTP 200).
- Architecture: HIGH — every pattern read directly from live migrations/functions; exemplars cited by file+line.
- Pitfalls: HIGH — the two-status-model gap, the test-file coupling, the href mismatch, and the n>0 re-ingest were all verified against source, not inferred.
- Open enum decisions (cancel/change notification_type, `expired` value): MEDIUM — additive and low-risk, but owner should confirm.

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (stable internal codebase; re-verify if migrations land before planning)

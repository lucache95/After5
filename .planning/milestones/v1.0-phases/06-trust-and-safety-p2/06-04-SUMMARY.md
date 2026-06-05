---
phase: 06-trust-and-safety-p2
plan: 04
subsystem: database
tags: [postgres, plpgsql, definer-rpc, lock-rpc, jobs, enqueue, timezone, supabase]

# Dependency graph
requires:
  - phase: 06-trust-and-safety-p2
    plan: 03
    provides: dispatch_date_reconfirm + dispatch_safety_checkin consumer RPCs + day_of_reconfirm/safety_checkin HANDLERS entries (producers ship after consumers exist)
  - phase: 05-progressive-reveal
    plan: 03
    provides: the LIVE e16 (20260606120100) bodies of match_accept_offer + match_resolve_reciprocal (new_match + identity_revealed dispatches) this migration re-CREATEs from
  - phase: 02-notifications-jobs
    provides: enqueue_job (type, run_after, payload, dedup_key) + jobs active-dedup index; cities.timezone tz source
provides:
  - day_of_reconfirm + safety_checkin job enqueues inside BOTH lock RPCs (match_accept_offer + match_resolve_reciprocal), atomic with the lock, beside the rating_window enqueue
  - morning-of (09:00 date-city-tz) run_after anchor for day_of_reconfirm with permissive UTC degrade; post-window anchor for safety_checkin
  - e19_producers.sql assertion proving both lock paths enqueue both safety jobs (Pitfall 2 reciprocal coverage)
affects: [06-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Re-CREATE the LIVE lock-RPC body from its latest lineage (e16 20260606120100), not a superseded migration, in a band strictly after it so db reset never clobbers the new enqueues"
    - "Morning-of run_after = date_trunc('day', lower(rng) at time zone v_tz) at time zone v_tz + 9h, tz resolved from the lock's date_instance->city (NOT primary_city_id), permissive UTC degrade if tz unknown"
    - "Producer enqueues are SOFT — only schedule jobs; the soft notify-only behavior lives entirely in the 06-03 consumers"

key-files:
  created:
    - supabase/migrations/20260606130000_e19_lock_rpc_producers.sql
    - supabase/tests/e19_producers.sql
  modified: []

key-decisions:
  - "Re-CREATEd both lock RPCs from the e16 (20260606120100) body VERBATIM, preserving new_match (2/RPC) + identity_revealed (2/RPC) dispatches, rating_window enqueue, SECURITY DEFINER SET search_path, and the inherited authenticated grant — only delta is the 2 new enqueues per RPC (T-06-12/T-06-13/T-06-14)"
  - "Migration timestamp 20260606130000 sorts STRICTLY AFTER e16 (20260606120100); a 20260605* filename (per the plan's stale name) would let e16 re-apply afterward and clobber the safety enqueues on a db reset"
  - "CREATE OR REPLACE, no DROP — these are PUBLIC C2 RPCs relying on an inherited grant to authenticated; DROP would strip it (T-06-12)"
  - "Reciprocal path uses p_chosen_instance (there is no inst local) for both the tz join and the run_after math (Pitfall 2)"
  - "Dedup keys mirror rating:||lid -> reconfirm:||lid and checkin:||lid; payload jsonb_build_object('lock_id', lid)"
  - "Morning-of tz resolves date_instance.city_id -> cities.timezone (FK confirmed 20260525120300:32 / 20260525120000:11); permissive degrade lower(rng) - interval '6 hours' if tz null, matching dispatch_notification's tz posture"

patterns-established:
  - "E19 producer half: both lock RPCs enqueue day_of_reconfirm + safety_checkin beside rating_window; consumers were 06-03; gated apply + advisor + assertion run is 06-05"

requirements-completed: [REQ-E19]

# Metrics
duration: 12min
completed: 2026-06-05
---

# Phase 6 Plan 04: E19 Safety Producers Summary

**Both lock RPCs (match_accept_offer + match_resolve_reciprocal) now enqueue day_of_reconfirm (morning-of, date-city tz) and safety_checkin (post-window) atomically with the lock, re-CREATEd from the live e16 body via CREATE OR REPLACE so new_match + identity_revealed dispatches and the authenticated grant survive intact.**

## Performance

- Duration: ~12 min
- Tasks: 2/2
- Files: 2 created, 0 modified
- Commits: 954176d (migration), be5a124 (SQL assertion)

## What Was Built

### Task 1 — `20260606130000_e19_lock_rpc_producers.sql` (commit 954176d)

`CREATE OR REPLACE` of both lock RPCs, copied verbatim from the **e16** lineage (`20260606120100_e16_dispatch_identity_revealed.sql`) — the current LIVE body — with two new `enqueue_job` calls added beside the existing `rating_window` enqueue in each:

- **`day_of_reconfirm`** — `run_after` = 09:00 on the date's start day in the date city's local tz. The tz is resolved from the lock's date_instance (`date_instances.city_id -> cities.timezone`), NOT `profiles.primary_city_id`. Permissive degrade to `lower(rng) - interval '6 hours'` (UTC morning-of approximation) if tz is unresolved, matching `dispatch_notification`'s tz posture. Payload `{lock_id: lid}`, dedup key `reconfirm:||lid`.
- **`safety_checkin`** — `run_after` = `upper(rng) + interval '2 hours'` (post-date window, mirrors `rating_window`). Payload `{lock_id: lid}`, dedup key `checkin:||lid`.

In `match_accept_offer` the instance local is `inst`; in `match_resolve_reciprocal` there is no `inst` — `p_chosen_instance` is used for both the tz join and the run_after math (Pitfall 2).

Everything e16 added is preserved: `new_match` (2 dispatches/RPC) + `identity_revealed` (2/RPC), the `rating_window` enqueue, `SECURITY DEFINER SET search_path TO 'public'`, and the inherited `grant to authenticated` (CREATE OR REPLACE, no DROP).

### Task 2 — `supabase/tests/e19_producers.sql` (commit be5a124)

SQL assertion driving each lock RPC to a real lock (accept path mirrors `a_accept_lock.sql`; reciprocal path mirrors `b_reciprocal.sql`) and asserting all three jobs exist for that `lid` — `rating:`||lid (pre-existing), `reconfirm:`||lid and `checkin:`||lid (new) — with matching `payload.lock_id`. `RAISE EXCEPTION` on any miss; `ROLLBACK` per block. The reciprocal assertion explicitly proves Pitfall 2 (the reciprocal path is wired, not just accept). A shared `e19_assert_producer_jobs(lid, ctx)` helper enforces an identical contract across both paths.

## Verification

Task 1 grep gate (intent-faithful): `day_of_reconfirm`=2, `safety_checkin`=2, `p_chosen_instance` present, CREATE OR REPLACE both RPCs, NO DROP of either RPC. Preservation: `new_match`=4 (2/RPC), `identity_revealed`=4 (2/RPC), `rating_window`=2 (1/RPC), `SET search_path TO 'public'`=2. Filename `20260606130000` sorts after e16 `20260606120100`.

Task 2 grep gate: file exists, references `reconfirm:`, `checkin:`, both `match_accept_offer` and `match_resolve_reciprocal`, and `rating:`.

**GATED:** the migration is NOT applied locally or to prod. Local `supabase db reset`/apply + Supabase security advisor + running `e19_producers.sql` against the local stack are all owned by **06-05**. Prod (`ufufmcpnysvwtutpbian`) untouched.

## Deviations from Plan

**1. [Rule 3 - Blocking] Migration timestamp corrected from the plan's `20260605120200` to `20260606130000`**
- **Found during:** Task 1
- **Issue:** The plan's `files_modified` names `20260605120200_e19_lock_rpc_producers.sql`. But the LIVE bodies of both lock RPCs were last re-CREATEd by `20260606120100_e16_dispatch_identity_revealed.sql` (Phase 5). A `20260605*` timestamp sorts BEFORE e16, so on a `supabase db reset` e16 would re-apply AFTER the producer migration and clobber the safety enqueues (and the producer would be re-creating a stale pre-e16 body, dropping identity_revealed).
- **Fix:** Named the migration `20260606130000_e19_lock_rpc_producers.sql` (strictly after e16) and based the CREATE OR REPLACE on the e16 body, preserving identity_revealed + new_match. This is the explicit authoritative correction in the plan's own `<CRITICAL_migration_ordering>` objective; the `files_modified` filename was stale relative to it.
- **Files:** `supabase/migrations/20260606130000_e19_lock_rpc_producers.sql`
- **Commit:** 954176d

**Note on the plan's grep gate:** the plan's verify pattern uses `create or replace function match_accept_offer` (unqualified). The e16 base body — preserved verbatim — uses the schema-qualified `public.match_accept_offer` (and `public.match_resolve_reciprocal`). I kept the `public.` qualification (correct, matches e16) and verified with a schema-tolerant pattern. The gate's intent (2x each enqueue, p_chosen_instance present, CREATE OR REPLACE both, no DROP) is fully satisfied.

## Self-Check: PASSED

- FOUND: supabase/migrations/20260606130000_e19_lock_rpc_producers.sql
- FOUND: supabase/tests/e19_producers.sql
- FOUND commit: 954176d (feat 06-04 producers migration)
- FOUND commit: be5a124 (test 06-04 e19 producers assertion)

---
phase: 02-loop-closure-host-controls-p0
plan: 04
subsystem: host-controls
tags: [definer-rpc, notifications, soft-cancel, edit-night, security-definer]
requires:
  - "20260604120000 enum values night_cancelled / night_changed (Plan 02-02)"
  - "match_make_offer DEFINER skeleton, match_idem_lookup/store, match_instance_lock_key"
  - "post_night venue/ambient validators; dispatch_notification; queue_entries"
provides:
  - "cancel_night(p_actor,p_instance,p_idem_key) — creator-only soft-unpublish + notify"
  - "update_night(p_actor,p_instance,p_starts_at,p_duration_min,p_venue,p_ambient_sound_id,p_idem_key) — creator-only edit + conditional notify"
affects:
  - "Plan 02-05 (notif-map render meta for night_cancelled/night_changed)"
  - "Plan 02-06 (host UI on /my-nights + interested list that calls these RPCs)"
tech-stack:
  added: []
  patterns: [security-definer-rpc, idempotency-ledger, advisory-lock, conditional-dispatch]
key-files:
  created:
    - supabase/migrations/20260604122000_e6_cancel_night.sql
    - supabase/migrations/20260604123000_e7_update_night.sql
    - supabase/tests/e6_cancel_night.sql
    - supabase/tests/e7_update_night.sql
  modified:
    - packages/types/src/database.ts
decisions:
  - "Honored orchestrator override: security advisor NOT run here (orchestrator batches it after the wave). Plan Task 3 listed it; orchestrator prompt superseded."
  - "Reused 'night_updated' as the update_night analytics event_type (cancel uses existing 'night_cancelled')."
metrics:
  duration: ~12m
  completed: 2026-06-03
---

# Phase 2 Plan 04: E6 cancel_night + E7 update_night Summary

Two host-control SECURITY DEFINER RPCs: `cancel_night` soft-unpublishes a creator's own pre-match `seeking` night (status flips to `cancelled`, the row and all `queue_entries` interest data are kept — reversible) and notifies already-interested candidates via `night_cancelled`; `update_night` lets the creator edit `starts_at`/`duration_min`/venue/ambient (never touching the GENERATED `time_range`) and dispatches `night_changed` to interested candidates only when a material field (time or venue) changes.

## What Was Built

- **Task 1 — `cancel_night`** (`20260604122000_e6_cancel_night.sql` + `supabase/tests/e6_cancel_night.sql`, commit `d43f72b`): DEFINER + `set search_path=public`; `auth.uid()` re-check (P5001); idempotency replay (`match_idem_lookup`/`match_idem_store`); `pg_advisory_xact_lock(match_instance_lock_key(p_instance))`; creator-only ownership check (`cre <> p_actor` → 42501); pre-match state check (`st <> 'seeking'` → P0001). Soft mutation flips status to `cancelled` keeping the row + queue rows. Loops over `queue_entries` in `('interested','shortlisted','standby')` dispatching `night_cancelled` with a per-(instance,candidate) `dedup_key`. Revoked from public/anon, granted to authenticated.
- **Task 2 — `update_night`** (`20260604123000_e7_update_night.sql` + `supabase/tests/e7_update_night.sql`, commit `d653232`): same DEFINER/auth/idempotency/advisory-lock/creator-only skeleton. Loads OLD `starts_at`/`venue_id` before mutating. Copies `post_night` validators verbatim (venue `approval_status='live' AND is_active`; ambient `is_active`; both → P0001). Updates only non-null fields via `coalesce(p_x, existing)`; never writes the GENERATED `time_range`. Material-change guard dispatches `night_changed` only when `starts_at` OR `venue` changed.
- **Task 3 — apply + regen + typecheck** (commit `ece0bbe`): `pnpm db:reset` applied both migrations from scratch; `pnpm db:types` regenerated `database.ts` (+22 additive lines: the two RPC signatures); full `pnpm db:test` suite GREEN; `pnpm -w typecheck` GREEN (6/6).

## Verification Results

- `psql ... -f supabase/tests/e6_cancel_night.sql` — GREEN (soft-cancel keeps data + notifies 3 interested candidates; non-creator → 42501; matched-night → P0001; idempotent replay single-notify).
- `psql ... -f supabase/tests/e7_update_night.sql` — GREEN (time edit recomputes `time_range` + notifies; venue edit notifies; ambient-only + duration-only edits dispatch NOTHING; all-null no-op; invalid venue/ambient → P0001; non-creator → 42501).
- `pnpm db:reset` — both migrations apply from scratch in order after `20260604121000`.
- `pnpm db:test` (FULL suite) — GREEN, exit 0; e6 and e7 both pass within the full run.
- `pnpm db:types` — regenerated, additive only (0 deletions).
- `pnpm -w typecheck` — GREEN, 6/6 packages.
- **Confirmations:** DEFINER + `auth.uid()` re-check + creator-only check present in both; NO `USING(true)` anywhere; `time_range` never written (GENERATED, asserted recomputed in the test); both revoked from public/anon and granted only to authenticated; material-vs-non-material notify logic verified by separate passing assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dollar-quote collision in e7 psql test**
- **Found during:** Task 2 verification (first `pnpm db:test` of e7 raised `syntax error at or near "downtown"`).
- **Issue:** Three DO blocks insert a `places` row with `price_tier = '$$'`, which prematurely terminated the outer `DO $$ ... $$` dollar-quoted block.
- **Fix:** Changed the place-inserting DO blocks to use the named tag `DO $do$ ... END $do$;` (the same convention `s5_post_night.sql` uses for this exact reason).
- **Files modified:** `supabase/tests/e7_update_night.sql`
- **Commit:** `d653232` (fixed before the task commit).

### Scope/Process Note (not a code deviation)

- Plan Task 3 listed running `mcp__supabase__get_advisors type=security`. The orchestrator prompt explicitly instructed: "Do NOT run the security advisor (orchestrator batches it)." Orchestrator instruction takes precedence — the advisor was NOT run here. Both RPCs are nonetheless `revoke`d from public/anon, granted only to authenticated, and declare `set search_path=public` per the threat register (T-02-09).

## Out of Scope (as instructed)

- PROD APPLY — local `127.0.0.1` only; no `db:push`. Prod apply stays gated/owner-approved and batched.
- Security advisor — batched by the orchestrator after the wave.
- notif-map render meta (Plan 02-05) and host UI (Plan 02-06).

## Known Stubs

None.

## Threat Flags

None — both RPCs match the plan's `<threat_model>` (creator-only DEFINER mutation + dispatch; no new untracked surface).

## Self-Check: PASSED

All four created files exist on disk; all three commits (`d43f72b`, `d653232`, `ece0bbe`) are present in git history.

---
phase: 02-loop-closure-host-controls-p0
plan: 02
subsystem: schema / enums
tags: [migration, enum, types, loop-closure]
requires:
  - "supabase/migrations/20260603120000_gated_inbox_notification_types.sql (additive-enum convention + interest_received/identity_revealed)"
  - "supabase/migrations/20260525120300_p0_date_instances.sql (date_match_status enum definition)"
provides:
  - "date_match_status 'expired' (D-10 seeking-sweep terminus)"
  - "notification_type 'night_cancelled' (D-09)"
  - "notification_type 'night_changed' (D-09)"
  - "regenerated packages/types/src/database.ts surfacing the three new enum members"
  - "local schema re-applied from scratch (the wave's BLOCKING migration reset)"
affects:
  - "Wave 2 E5 sweep_loop_terminus (consumes 'expired')"
  - "Wave 2 E6 cancel_night (dispatches 'night_cancelled')"
  - "Wave 2 E7 update_night (dispatches 'night_changed')"
  - "apps/web inbox / notif-map rendering (new enum-backed rows)"
tech-stack:
  added: []
  patterns:
    - "Additive idempotent ALTER TYPE ... ADD VALUE IF NOT EXISTS in its own migration, sequenced ahead of consuming RPCs"
key-files:
  created:
    - "supabase/migrations/20260604120000_e2_loop_closure_enums.sql"
  modified:
    - "packages/types/src/database.ts (regenerated)"
    - "apps/web/lib/after5/notif-map.ts (Rule 3 — exhaustive NOTIF_META after enum regen)"
decisions:
  - "Deferred the post-DDL security advisor to the orchestrator (runs once after the wave) per the orchestrator's explicit instruction; additive enum adds no RLS surface so no high/critical risk is introduced (threat T-02-04 disposition: accept)."
  - "Enum-backed inbox types (interest_received/identity_revealed/night_cancelled/night_changed) folded into the enum-exhaustive NOTIF_META; the temporary GATED_NOTIF_META string-keyed overlay was collapsed per 02-PATTERNS §notif-map.ts."
metrics:
  duration: "4m1s"
  completed: "2026-06-04"
  tasks: 3
  files: 3
---

# Phase 2 Plan 02-02: Loop-Closure Additive Enums Summary

One additive enum migration adds `date_match_status 'expired'` plus `notification_type 'night_cancelled'`/`'night_changed'`; the local stack was re-applied from scratch, types regenerated, and the workspace typechecks green — unblocking the Wave-2 E5/E6/E7 RPCs that consume these values.

## What Was Built

- **`supabase/migrations/20260604120000_e2_loop_closure_enums.sql`** — three bare, idempotent `alter type ... add value if not exists` statements (copying the proven `20260603120000_gated_inbox_notification_types.sql` convention), with a header documenting the D-09/D-10 rationale and the GATED local-only status. Timestamp `20260604120000` sorts after all existing migrations and ahead of the Wave-2 RPC migrations (Postgres requires `ADD VALUE` to be committed before later use).
- **Regenerated `packages/types/src/database.ts`** — `pnpm db:reset` (full chain from scratch, the wave's BLOCKING migration reset) then `pnpm db:types`. The generated `date_match_status` union now contains `"expired"`; `notification_type` contains `"night_cancelled"` and `"night_changed"`.
- **`apps/web/lib/after5/notif-map.ts`** — folded the now enum-backed inbox types into the enum-exhaustive `NOTIF_META` (see Deviations).

## Tasks

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Write the additive enum migration | done | 993004e |
| 2 | [BLOCKING] Apply locally, regen types, typecheck | done | e49d980 |
| 3 | Run the Supabase security advisor (post-DDL gate) | deferred to orchestrator | (n/a) |

## Verification

- `grep -c "add value if not exists" …e2_loop_closure_enums.sql` → 3 (exactly three additive statements; no destructive enum op present). PASS.
- `pnpm db:reset` → applied the full migration chain from scratch, ending with `20260604120000_e2_loop_closure_enums.sql`. Clean. PASS.
- `pnpm db:types` → `database.ts` regenerated; `"expired"` in `date_match_status`, `"night_cancelled"`/`"night_changed"` in `notification_type`. PASS.
  - Note: the canonical plan verify used single-quoted greps (`'expired'`), but Supabase CLI renders generated enum members with double quotes (`"expired"`). Members are present; the verify's quoting was the only mismatch.
- `pnpm -w typecheck` → 6/6 tasks successful. PASS.
- PROD APPLY: NOT attempted. No `db:push`, prod ref `ufufmcpnysvwtutpbian` untouched. Local 127.0.0.1 only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] notif-map.ts NOTIF_META made exhaustive after enum regen**
- **Found during:** Task 2 (`pnpm -w typecheck`).
- **Issue:** Regenerating `database.ts` added four members to `notification_type` (`night_cancelled`, `night_changed`, plus the previously-gated `interest_received`/`identity_revealed` that were already in the enum but not yet surfaced). `NOTIF_META: Record<NotificationType, NotifMeta>` then failed `TS2739` for the four missing keys, breaking typecheck and blocking the Wave-2 gate.
- **Fix:** Moved the four enum-backed types into `NOTIF_META` with labels/icons/categories/hrefs per `02-PATTERNS.md §notif-map.ts` (`night_cancelled`/`night_changed` → `reminders` category with `CalendarX`/`RefreshCw` icons + `date_instance_id` deep-links; `interest_received` → `interestedHref`; `identity_revealed` → `lockHref`). Collapsed the now-redundant `GATED_NOTIF_META` string-keyed overlay (no external references) and simplified `metaFor()` to resolve through `NOTIF_META` + fallback. Added `interestedHref`/`instanceHref` helpers.
- **Files modified:** `apps/web/lib/after5/notif-map.ts`
- **Commit:** e49d980

**2. [Plan-verify quoting] Task-1 `grep -qx 3` collided with a header comment**
- **Found during:** Task 1 verify.
- **Issue:** The migration's header rationale originally contained the literal phrase `add value if not exists`, making `grep -c` return 4 (3 statements + 1 comment), failing the exact `grep -qx 3` verify.
- **Fix:** Reworded the header comment to avoid the literal phrase without changing meaning. Count is now exactly 3.
- **Files modified:** `supabase/migrations/20260604120000_e2_loop_closure_enums.sql`
- **Commit:** 993004e

### Reasoned Scope Decision

**Task 3 (security advisor) deferred to the orchestrator.** The plan's Task 3 asks the executor to run `mcp__supabase__get_advisors type=security`. The orchestrator's spawn instruction explicitly states: "Do NOT run the Supabase security advisor yourself — the orchestrator runs it after the wave." The orchestrator directive is the more specific, later-scoping instruction and takes precedence. An additive enum introduces no RLS surface and exposes no data (threat T-02-04 disposition: `accept`), so deferring the advisor to a single end-of-wave run introduces no high/critical risk. No advisor finding is owned by this plan.

## Threat Surface

No new security-relevant surface beyond the plan's `<threat_model>`. The change is SQL enum-only (T-02-03 mitigated via additive-only/idempotent `add value if not exists`; T-02-04 accepted — no RLS surface; T-02-SC N/A — no package installs).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: supabase/migrations/20260604120000_e2_loop_closure_enums.sql
- FOUND: packages/types/src/database.ts (regenerated, 3 enum members present)
- FOUND: apps/web/lib/after5/notif-map.ts (typecheck green)
- FOUND commit 993004e (Task 1)
- FOUND commit e49d980 (Task 2)

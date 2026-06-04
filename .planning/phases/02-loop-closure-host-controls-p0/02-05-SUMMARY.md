---
phase: 02-loop-closure-host-controls-p0
plan: 05
subsystem: notifications
tags: [definer-rpc, notifications, interest-dispatch, deep-link, dedup, security-definer]
requires:
  - "match_ingest_interest body (20260527126200 p5_shortlist)"
  - "dispatch_notification(p_user,p_type,p_payload) consent/dedup gate (20260525123600)"
  - "interest_received enum value (20260603120000 gated_inbox_notification_types)"
  - "notif-map interestedHref + night_* meta (Plan 02-02, e49d980)"
provides:
  - "match_ingest_interest now dispatches interest_received to the host on n>0 only"
  - "interest_received deep-links the host to /dates/[instance]/interested (group key = date_instance_id)"
  - "coarse per-instance dedup_key throttles email/push while the grouped in-app row still surfaces"
affects:
  - "Plan 02-06 (host UI: the interested list this notification deep-links into)"
  - "record_swipe right-swipe path (each right-swipe ingest can now notify the host)"
tech-stack:
  added: []
  patterns: [security-definer-rpc, conditional-dispatch, coarse-dedup-throttle, deep-link-by-payload]
key-files:
  created:
    - supabase/migrations/20260604124000_e8_interest_dispatch.sql
    - supabase/tests/e8_interest_dispatch.sql
  modified:
    - apps/web/lib/after5/__tests__/notif-map.test.ts
    - apps/web/app/inbox/__tests__/ActivityList.test.ts
decisions:
  - "notif-map.ts source needed NO edit: interest_received already maps to interestedHref (/dates/[id]/interested) and night_cancelled/night_changed already carry meta — landed in Plan 02-02 (e49d980). This plan owns the render edits, so only the missing href unit assertions remained."
  - "Honored orchestrator override: security advisor NOT run here (orchestrator batches it after the wave). Plan Task 3 listed it; orchestrator prompt superseded."
  - "Coarse per-instance dedup_key ('interest_received:'||instance) chosen over a time-bucket window (research-ASSUMED 1h). Per-instance is the simplest faithful throttle; digest granularity is Claude's-discretion per D-07."
  - "creator-null guard tested via a non-existent instance id (date_instances.creator_id is NOT NULL + swipes FK require a real instance, so that is the only faithful path to cre=null; it also yields n=0)."
metrics:
  duration: ~18m
  completed: 2026-06-03
---

# Phase 2 Plan 05: E8 interest_received Dispatch + Deep-Link Summary

Wire the E8 demand→supply signal (D-07): `match_ingest_interest` now dispatches the previously-defined-but-never-fired `interest_received` notification to the night's host, but ONLY when a genuinely new interested candidate is enqueued (`n > 0`), deep-linked via `payload.date_instance_id` to that night's `/dates/[instance]/interested` list, with a coarse per-instance `dedup_key` throttling email/push so a popular night doesn't spam the host while the grouped in-app row still reflects demand.

## What Was Built

- **Task 1 — `match_ingest_interest` n>0 dispatch** (`20260604124000_e8_interest_dispatch.sql` + `supabase/tests/e8_interest_dispatch.sql`, commit `0f7dcb0`): `CREATE OR REPLACE` keeping the `20260527126200` body VERBATIM (the `queue_entries` bulk-insert with `ON CONFLICT DO NOTHING`, the `cre` load, `get diagnostics n = row_count`). Added immediately after the diagnostics line: `if n > 0 and cre is not null then perform dispatch_notification(cre, 'interest_received', jsonb_build_object('date_instance_id', p_instance, 'new_count', n, 'dedup_key', 'interest_received:'||p_instance::text)); end if;`. Grants unchanged — re-asserts `revoke execute ... from public, authenticated` (it stays internal, called by `record_swipe` DEFINER; T-02-13). The dispatch runs inside the DEFINER. psql test asserts: first right-swipe (n=1) → exactly one creator `interest_received` with `payload.date_instance_id = inst` and the per-instance `dedup_key`; re-ingest (n=0) → NO duplicate; a second distinct candidate (n=1) → coarse dedup collapses delivery to the one existing row; non-existent night (cre null, n=0) → no dispatch.
- **Task 2 — interest_received deep-link assertion** (`notif-map.test.ts`, commit `a6c9db7`): `notif-map.ts` source was ALREADY correct (interest_received → `interestedHref` → `/dates/[id]/interested`; `night_cancelled`/`night_changed` meta present; landed in 02-02 `e49d980`). Added the missing href unit assertions: `interest_received` with `{date_instance_id}` → `/dates/<id>/interested` (fallback `/my-nights` when absent); `night_cancelled`/`night_changed` → `/dates/<id>` (feed fallback). Fixed the stale `NOTIF_META` count assertion (20 → 24) left over from before 02-02 added the two night_* types.
- **Task 3 — [BLOCKING] apply local + regen + full verify** (commit `e8495b7`): `pnpm db:reset` applied all migrations from scratch incl. `20260604124000`; `pnpm db:types` regenerated `database.ts` with NO drift (a function-body replace adds no generated-type surface); full `pnpm db:test` GREEN (E8 included); full `pnpm vitest run` GREEN; `pnpm -w typecheck` GREEN. Also updated `ActivityList.test.tsx` (stale assertion expected the OLD pre-D-07 `/my-nights` destination; the component already routes via `metaFor().hrefFor()`, so it now correctly pushes `/dates/d1/interested`). Security advisor intentionally NOT run (orchestrator batches it).

## Verification Results

| Check | Result |
|-------|--------|
| `psql -f supabase/tests/e8_interest_dispatch.sql` | GREEN — n>0 dispatch + payload deep-link + n=0 no-dup + coarse dedup + creator-null guard |
| Full `pnpm db:test` suite (E8 included) | GREEN — exit 0, zero ERROR/EXCEPTION/FAIL |
| `pnpm vitest run` (full) | GREEN — 108 files / 602 tests passed |
| notif-map deep-link grep `/dates/.*/interested` | present (line 37) |
| `pnpm db:reset` from scratch | GREEN — all migrations incl. 20260604124000 applied |
| `pnpm db:types` | GREEN — no drift |
| `pnpm -w typecheck` | GREEN — 6/6 |
| `match_ingest_interest` grants | unchanged (revoked from public + authenticated) |
| prod apply | OUT OF SCOPE — local-green only, no db:push |

## Deviations from Plan

### Work already complete (no source edit needed)

**1. [Rule N/A — pre-done] notif-map.ts source already in the desired E8 state**
- **Found during:** Task 2
- **Issue:** The plan's premise was that `notif-map.ts` mapped `interest_received` to `() => '/my-nights'` and lacked `night_cancelled`/`night_changed` meta. In reality Plan 02-02 (commit `e49d980`) already added `interestedHref` (`/dates/[id]/interested`) and the two night_* meta entries.
- **Resolution:** No source change. Added the missing href unit assertions the plan required (the test side of Task 2). Documented so the verifier knows the render edits were folded forward, not skipped.
- **Files modified:** `apps/web/lib/after5/__tests__/notif-map.test.ts`
- **Commit:** `a6c9db7`

### Auto-fixed Issues

**2. [Rule 1 — Bug] Stale tests enforced the OLD pre-D-07 behavior this plan corrects**
- **Found during:** Task 2 / Task 3
- **Issue:** (a) `notif-map.test.ts` asserted `NOTIFICATION_TYPES` length 20 — stale since 02-02 made the enum 24. (b) `ActivityList.test.tsx` asserted tapping an `interest_received` group pushes `/my-nights` — the exact `/my-nights` destination D-07 replaces; the component already routes via `metaFor().hrefFor()` so it now pushes `/dates/d1/interested`.
- **Fix:** Updated the count to 24; updated the ActivityList assertion to `/dates/d1/interested`. Both are test-only corrections that bring the assertions in line with the behavior this plan finalizes (no production-code change).
- **Files modified:** `apps/web/lib/after5/__tests__/notif-map.test.ts`, `apps/web/app/inbox/__tests__/ActivityList.test.tsx`
- **Commits:** `a6c9db7`, `e8495b7`

## Threat Model Compliance

- **T-02-13 (Spoofing):** dispatch runs inside the SECURITY DEFINER; `match_ingest_interest` stays revoked from public + authenticated (re-asserted in the migration). No grant added.
- **T-02-14 (DoS / repeat-swipe spam):** `n > 0` guard fires only on a genuinely new candidate; coarse per-instance `dedup_key` throttles email/push.
- **T-02-15 (Information Disclosure):** payload carries only `date_instance_id` + `new_count` (the host's own night); no counterpart identity leaked.
- **T-02-SC (install legitimacy):** no new packages installed; N/A.

## Self-Check: PASSED

- `supabase/migrations/20260604124000_e8_interest_dispatch.sql` — FOUND
- `supabase/tests/e8_interest_dispatch.sql` — FOUND
- Commit `0f7dcb0` (Task 1) — FOUND
- Commit `a6c9db7` (Task 2) — FOUND
- Commit `e8495b7` (Task 3) — FOUND

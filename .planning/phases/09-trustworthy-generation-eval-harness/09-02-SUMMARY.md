---
phase: 09-trustworthy-generation-eval-harness
plan: 02
subsystem: database
tags: [ambient-sounds, vibe-tags, browse-feed, postgres, elevenlabs, storage]

# Dependency graph
requires:
  - phase: m4-ambient
    provides: "ambient_sounds table + name unique key, date_instances.ambient_sound_id, browse_feed_for_viewer vibe-overlap lateral, post_night vibe-auto fallback, ambient-sounds bucket (service_role-only write)"
provides:
  - "8 new vibe-matched ambient_sounds rows filling itinerary vibe gaps (foodie, date-night, sunset, cafe, active-hike, upscale, coastal, live-music), seeded idempotently"
  - "SOUND-GENERATION.md — gated v1.0 ElevenLabs audio-gen + service_role upload runbook for the 09-05 phase gate"
  - "SQL verification that a vibe-tagged date auto-resolves a vibe-overlapping NEW track via the existing feed/post_night lateral"
affects: [09-05-phase-gate, audio-content-upload]

# Tech tracking
tech-stack:
  added: []
  patterns: ["idempotent upsert-on-name ambient seed (on conflict (name))", "ROWS-only migration with gated out-of-band audio upload (service_role JWT)", "SQL lateral-pick assertion test (BEGIN..ROLLBACK, div-by-zero failure pattern, reuses _fixtures.sql)"]

key-files:
  created:
    - supabase/migrations/20260606160000_sound01_ambient_loops_seed.sql
    - docs/superpowers/SOUND-GENERATION.md
    - supabase/tests/sound01_vibe_auto_pick.sql
  modified: []

key-decisions:
  - "Re-scoped Task 2 to a SQL VERIFY of the existing date_instance-layer auto-pick (no persist.ts change) — persist.ts only inserts itineraries; the date_instance is born later at post_night, where the vibe-overlap lateral already runs"
  - "8 new tracks (not 10) with sort_order >100 so they outrank base loops on the sort_order-desc tiebreak and never collide with the base 10 names"
  - "ROWS-only migration; audio object upload isolated behind the gated 09-05 phase-gate step (service_role-only bucket write, T-09-04)"

patterns-established:
  - "Expand the ambient library by upsert-on-name migration + a gated audio runbook; no schema/policy change keeps the advisor surface clean"
  - "Verify (don't re-implement) reused infrastructure: lift the exact browse_feed_for_viewer lateral into a SQL assertion test"

requirements-completed: [SOUND-01]

# Metrics
duration: 4min
completed: 2026-06-05
---

# Phase 9 Plan 02: SOUND-01 Expanded Ambient Library Summary

**8 new vibe-matched ambient loops seeded idempotently to widen the auto-pick pool, plus a SQL proof that a generated date auto-resolves a vibe-overlapping NEW track through the existing browse_feed/post_night lateral — persist.ts untouched.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-05T23:56:42Z
- **Completed:** 2026-06-05T23:00:00Z (approx)
- **Tasks:** 2
- **Files modified:** 3 (all created)

## Accomplishments
- Seeded 8 NEW `ambient_sounds` rows (foodie/date-night, sunset, cafe, active-hike, upscale fine-dining, coastal, live-music, rainy-lounge) filling itinerary vibe gaps the base 10 underserve — 18 total active loops.
- Authored `SOUND-GENERATION.md`: the v1.0 ElevenLabs Sound Effects recipe (loop=true, 15s, mono m4a) + service_role-JWT bucket upload, marked as the gated manual audio task for the 09-05 phase gate.
- Proved end-to-end (SQL) that a null-host-pick date_instance with vibe X auto-resolves the highest-sort_order overlapping NEW track, and a no-overlap itinerary resolves to NULL (no crash) — via the EXISTING lateral, no new pick logic.

## Task Commits

1. **Task 1: Seed migration for the expanded ambient library** - `763e1cc` (feat)
2. **Task 2: Verify generated date auto-gets a vibe-matched sound** - `f1341d7` (test)

**Plan metadata:** (final docs commit below)

## Files Created/Modified
- `supabase/migrations/20260606160000_sound01_ambient_loops_seed.sql` - idempotent upsert (on conflict name) of 8 new vibe-tagged ambient rows, sort_order >100, duration_sec 15, `<vibe>/<slug>.m4a` paths; ROWS only (no audio upload, no DDL).
- `docs/superpowers/SOUND-GENERATION.md` - gated v1.0 ElevenLabs audio-gen + service_role upload runbook for the 8 new paths.
- `supabase/tests/sound01_vibe_auto_pick.sql` - BEGIN..ROLLBACK SQL test exercising the exact browse_feed_for_viewer vibe-overlap lateral; 5 assertions all green.

## Decisions Made
- **Task 2 re-scoped per plan-check (W-blocker):** the vibe-overlap auto-pick is ALREADY implemented at the date_instance layer (`browse_feed_for_viewer` lateral + `post_night` vibe-auto fallback). `persist.ts` only inserts `itineraries` — there is no date_instance to write at generation time. So Task 2 VERIFIES the existing path rather than adding a persist→date_instances write. persist.ts UNCHANGED.
- **8 tracks, sort_order >100:** keeps new names distinct from the base 10 and ensures the new loops outrank base loops on the `sort_order desc` tiebreak when both overlap a vibe.
- **vibe_tags drawn from the real tag vocabulary** (vibePalette.ts + seeded affinities) so the `s.vibe_tags && it.vibe_tags` overlap actually fires.

## Deviations from Plan
None - plan executed exactly as written (Task 2's verify-only scope was specified in the plan's plan-check note and behavior block).

## Issues Encountered
None. Local stack had a seeded city but zero profiles; the test creates its own host via the canonical `_fixtures.sql` `mk_user`/`mk_itinerary`/`mk_instance` helpers inside a rolled-back transaction.

## Known Stubs
The audio objects for the 8 new `storage_path`s are NOT yet uploaded (rows-only migration by design). This is intentional and gated: `SOUND-GENERATION.md` documents the service_role-JWT upload as the 09-05 phase-gate task. The paths are final in the seed, so no follow-up migration is needed after upload. Until then, the public bucket URLs for the 8 new paths 404; the vibe-overlap RESOLUTION (which this plan delivers and verifies) is independent of object presence.

## User Setup Required
None during autonomous execution. The one-time audio generation + upload (service_role JWT) is the gated manual content task documented in `docs/superpowers/SOUND-GENERATION.md`, to run at the 09-05 phase gate alongside the batched prod-apply.

## Next Phase Readiness
- Expanded library is local-green; advisor surface unchanged (row-only DML, no DDL). Migration `20260606160000` sorts after `20260606150100` and replays clean on `supabase db reset`.
- Gated for 09-05: batched prod-apply of the seed migration + the audio object upload (idempotent + row-only, safe to batch).

## Self-Check: PASSED

All created files present on disk (migration, runbook, SQL test, SUMMARY); both task commits (763e1cc, f1341d7) present in git log.

---
*Phase: 09-trustworthy-generation-eval-harness*
*Completed: 2026-06-05*

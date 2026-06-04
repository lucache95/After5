# Phase 04 Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed (SCOPE BOUNDARY rule).

## Plan 04-01

### `supabase/tests/p2_e2e_jobs_dispatch.sql` fails on the shared local stack

- **Found during:** Task 3 full `pnpm db:test` run.
- **Symptom:** `ERROR: claim returned wrong job` at line 36 (the job-claim ordering
  assertion), deterministic across repeated isolated runs.
- **Why out of scope:** the test belongs to the P2 jobs/dispatch subsystem (commit
  3b5066a), references NONE of the E10 objects (0 matches for feed_filters / browse_feed /
  reach_preview / target_genders), and depends on the `jobs` queue claim order in the
  SHARED local Postgres, which is sensitive to pre-seeded job rows left by other worktrees
  or sessions. It is unrelated to the feed-filter migrations.
- **Action:** none taken (do NOT fix unrelated subsystem here). The full e10_* suite and
  the extended s5_browse_feed_blind.sql all pass. Re-run after a clean `supabase db reset`
  in a dedicated session if the P2 owner needs to confirm green.

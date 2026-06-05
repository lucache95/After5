---
phase: 4
slug: discoverability-feed-filters-targeting-p1
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-04
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pgTAP-style SQL tests (Supabase local) + Vitest 2.1 (jsdom) + Playwright 1.49 (forced-local) |
| **Config file** | `supabase/tests/` (SQL via `pnpm db:test`) · `apps/web/vitest.config.ts` · `apps/web/playwright.config.ts` (lines 59–64 inject local Supabase URL/keys) |
| **Quick run command** | `pnpm --filter web test -- <file>` (component) / `psql ... -f supabase/tests/e10_*.sql` (SQL RPC) |
| **Full suite command** | `pnpm typecheck && pnpm test && pnpm db:test && CI=1 pnpm --filter web exec playwright test e10-feed-filters` |
| **Estimated runtime** | ~60–120 seconds |

> **Forced-local constraint:** `.env.local` points at PROD. Playwright config forces local Supabase URL/keys when `CI=1`; never run a bare `playwright test` against the prod-pointed env. SQL tests run against the local stack (54322) only.

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched surface (SQL RPC test or component test) — < 30s.
- **After every plan wave:** `pnpm db:test` + `pnpm --filter web test` (+ the e2e spec at the Wave-3 merge).
- **Before `/gsd:verify-work`:** Full suite green + security advisor clean after each DDL migration.
- **Max feedback latency:** 120 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| T1 Wave-0 SQL scaffolds | 04-01 | 1 | REQ-E10 | T-04-01/02/04 | anon-revoke + blind-contract + self-write + targeting-only-fit (fit=true on a gender+age matched night when feed_filters='{}') assertions authored first | SQL | `for f in e10_browse_feed_filters e10_reach_preview e10_feed_filters_rls; do test -f supabase/tests/$f.sql; done` | ❌ creates | ⬜ pending |
| T2 4 migrations (column/feed/reach/index) | 04-01 | 1 | REQ-E10 | T-04-01/02/03/04/05 | grant trio + everyone-norm + blind 13-col + **fit = date_fits_viewer ONLY (targeting-only, NOT soft-gated; soft score in ORDER BY only)** + jsonb whitelist; each migration parses + applies in a rolled-back psql txn (dry check) | SQL | `grep -q "fit boolean" .../e10_browse_feed_filters.sql && grep -q "revoke execute on function reach_preview" .../e10_reach_preview.sql` + per-migration `psql -1 -v ON_ERROR_STOP=1 -f <BEGIN;\i migration;ROLLBACK>` | ❌ creates | ⬜ pending |
| T3 [BLOCKING] local-apply+typegen+advisor | 04-01 | 1 | REQ-E10 | T-04-01/02/03 | advisor after DDL; types regen from live schema (no false-positive); full e10_* suite incl. fit-with-empty-filters case GREEN | SQL+tooling | `pnpm db:test 2>&1 \| tail -5; grep -q feed_filters packages/types/database.ts && grep -q reach_preview packages/types/database.ts` | ❌ runs | ⬜ pending |
| T1 FeedNight.fit + reachPreview() | 04-02 | 2 | REQ-E10 | T-04-04/05 | typed RPC wrapper; throws on error | component | `pnpm --filter @after5/api-client test -- feed` | ❌ creates | ⬜ pending |
| T2 FeedFilters + saveFeedFilters() | 04-02 | 2 | REQ-E10 | T-04-04/05 | self-scoped `.eq('id',userId)` write; typed shape | component | `pnpm --filter @after5/api-client test -- profile && pnpm --filter @after5/api-client typecheck` | ❌ creates | ⬜ pending |
| T1 Real FilterSheet (persist+requery) | 04-03 | 3 | REQ-E10 | T-04-04/06 | saveFeedFilters self-write; fixed friendly error toast; FilterSheet.test.tsx asserts onApplied fires on success (Task1->Task2 callback contract) and is skipped on save error | component | `pnpm --filter web test -- FilterSheet` | ❌ creates | ⬜ pending |
| CKPT visual-verify (sheet+chips+empty) | 04-03 | 3 | REQ-E10 | — | Barbiecore 6-pillar @420px | human | forced-local render + screenshot critique | n/a | ⬜ pending |
| T2 Quick chips + EmptyDeck branch + e2e | 04-03 | 3 | REQ-E10 | T-04-02/04 | filtered-vs-genuine recovery; never auto-relax | component+e2e | `pnpm --filter web test -- SwipeDeck && CI=1 pnpm --filter web exec playwright test e10-feed-filters` | ❌ creates | ⬜ pending |
| T1 Fit pill on NightCard | 04-04 | 3 | REQ-E10 | T-04-02 | data-driven boolean, never a score/identity | component | `pnpm --filter web test -- NightCard` | ❌ creates | ⬜ pending |
| T2 Reach line on PostNightForm | 04-04 | 3 | REQ-E10 | T-04-03/07 | aggregate count only; everyone-normalized; never gates publish | component | `pnpm --filter web test -- PostNightForm` | ❌ creates | ⬜ pending |
| CKPT visual-verify (pill+reach line) | 04-04 | 3 | REQ-E10 | — | Barbiecore 6-pillar @420px | human | forced-local render + screenshot critique | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Authored in Plan 04-01 Task 1 (Nyquist, before the migrations):

- [ ] SQL: hard-filter correctness (gender / max-price / max-distance HIDE rows) on `browse_feed_for_viewer` — `e10_browse_feed_filters.sql`
- [ ] SQL: soft-sort ordering (soft filters only RE-SORT, never HIDE) under the composite `(date_fits_viewer::int*4 + vibe_pts + pay_pts + time_pts) DESC` ORDER BY — `e10_browse_feed_filters.sql`
- [ ] SQL: `fit` is a TARGETING-ONLY signal — assert `fit=true` for a night whose `target_genders` + `target_age_range` genuinely include the viewer EVEN WHEN the viewer has zero soft filters (`feed_filters='{}'`); `fit=false` for a non-targeting night. This locks the D-03/SC-1 regression (a default-state searcher MUST still see the "looks for someone like you" pill on a perfectly-targeted night). The soft score must NOT gate `fit`. — `e10_browse_feed_filters.sql`
- [ ] SQL: everyone-array ≡ empty-array normalization (open nights never drop out of feed or `reach_preview`) — `e10_browse_feed_filters.sql` + `e10_reach_preview.sql`
- [ ] SQL: blind-contract preserved (no itinerary_id/creator_id/venue_id; hour-truncated time) + `fit` present — extend `s5_browse_feed_blind.sql`
- [ ] SQL: `reach_preview` counts + DEFINER grants (revoke anon, grant authenticated) — `e10_reach_preview.sql`
- [ ] SQL: keyset cursor paginates without skip/dupe under the new ORDER BY — `e10_browse_feed_filters.sql`
- [ ] SQL: `feed_filters` self-write only — `e10_feed_filters_rls.sql`
- [ ] Component/e2e: FilterSheet persist (+ onApplied fires on success) + chip→sheet + fit pill + empty-state recovery + reach line — vitest files + `e10-feed-filters.spec.ts`

Reuse harness: `s5_browse_feed_blind.sql`, `e11_targeting.sql`, `p1_preferences.sql`, `_fixtures.sql`; Playwright `playwright.config.ts:59-64` forced-local + `e2e/_helpers/seed.ts`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual-verify FilterSheet, chips, fit pill, empty state, reach line vs 04-UI-SPEC.md | REQ-E10 | Pixel/interaction fidelity to the Barbiecore contract is not assertable in unit tests | Forced-local render @420px + screenshot critique against the 6-pillar rubric (visual-verify-ui-changes rule). Covered by the two blocking checkpoints in 04-03 + 04-04. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are checkpoint/Wave-0-dependent
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (authored in 04-01 Task 1)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
</content>

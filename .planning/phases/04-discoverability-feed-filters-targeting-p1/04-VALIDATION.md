---
phase: 4
slug: discoverability-feed-filters-targeting-p1
status: draft
nyquist_compliant: false
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
| **Config file** | `supabase/tests/` (SQL) · `apps/web/vitest.config.ts` · `apps/web/playwright.config.ts` (lines 59–64 inject local Supabase URL/keys) |
| **Quick run command** | `pnpm --filter web test -- <file>` (component) / `supabase test db` (SQL RPC) |
| **Full suite command** | `pnpm typecheck && pnpm test && supabase test db` |
| **Estimated runtime** | ~60–120 seconds |

> **Forced-local constraint:** `.env.local` points at PROD. Playwright config already forces local Supabase URL/keys when `CI=1`; never run a bare `playwright test` against the prod-pointed env. SQL tests run against the local stack only.

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched surface (SQL RPC test or component test)
- **After every plan wave:** Run the full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _populated by planner_ | | | REQ-E10 | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Candidate test surface (from RESEARCH.md §Validation Architecture — planner finalizes):

- [ ] SQL: hard-filter correctness (gender / max-price / max-distance HIDE rows) on `browse_feed_for_viewer`
- [ ] SQL: soft-sort ordering + `fit` boolean thresholding (strong-match only)
- [ ] SQL: `{everyone}` ≡ `{}` normalization — open nights never drop out of feed or `reach_preview`
- [ ] SQL: blind-contract preserved (no itinerary_id/creator_id/venue_id; scrubbed reservation_url; hour-truncated time) after the extension
- [ ] SQL: `reach_preview` counts match expected candidate sets; DEFINER grants (revoke anon, grant authenticated)
- [ ] SQL: keyset cursor still paginates without skip/dupe under the new ORDER BY
- [ ] Component/e2e: FilterSheet persists `profiles.feed_filters` + chip→sheet open + fit pill render + empty-state active recovery

Reuse existing harness: `supabase/tests/s5_browse_feed_blind.sql`, `e11_targeting.sql`, `p1_preferences.sql`, `_fixtures.sql`; Playwright `route-*`/`5b-`/`m*-` spec pattern.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual-verify the FilterSheet, chips, fit pill, empty state, reach line against 04-UI-SPEC.md | REQ-E10 | Pixel/interaction fidelity to the Barbiecore contract is not assertable in unit tests | Forced-local render @420px + screenshot critique against the 6-pillar rubric (per visual-verify-ui-changes rule) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

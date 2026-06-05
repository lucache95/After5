---
plan: 07-09
phase: 07-enhancements-and-polish-p3
status: complete
autonomous: false
requirements: [REQ-E20, REQ-E21, REQ-E22, REQ-E23, REQ-E24, REQ-E25]
tasks_total: 3
tasks_complete: 3
prod_applied: 2026-06-05
---

# Plan 07-09 Summary — Phase Gate (local apply + visual-verify + gated prod-apply)

Checkpoint plan; orchestrator-owned. All 3 tasks complete.

## Task 1 — [BLOCKING] local apply + advisor baseline + full + SQL suite — DONE
- `supabase db reset` replayed all 10 migrations in order; the 3 Phase-7 migrations
  (`20260606140000_e20` / `140100_e23` / `140200_e24`) sort last and apply cleanly.
- Types regenerated from the LOCAL schema (`packages/types/src/database.ts`, +5 lines:
  the `withdraw_interest` function signature now present — the 07-01 forward-reference
  cast resolves against real types).
- All 3 SQL contract tests green: `e20_night_detail_coords` (per-stop coords + slug +
  graceful degrade + scrub + anon-denied/authenticated-granted), `e23_feed_contract`
  ("ALL ASSERTIONS PASSED" — 18-col set, anon non-exec, keyset no-dup/no-skip,
  city_name = cities.name), `e24_withdraw_interest` (owner-delete-only, P5001 non-owner,
  status-scope, RLS deny-non-owner).
- **Full automated suite: 716/716 unit tests green; `pnpm typecheck` 6/6 packages.**
- `apps/web/e2e/route-07-visual.spec.ts` authored (forced-local @420px CAPTURE_VISUAL
  spec mirroring the 06 recipe), commit `f45890a`.

### Post-merge integration gate caught 3 real issues (all fixed before the prod gate)
The full-suite run after Wave 3 surfaced 13 failures that the per-plan scoped runs missed:
- **1 real 07-05 regression** (`fix(07-05)` `571b9fc`): the detail-sheet skeleton gated on
  `detail === null`, conflating "still loading" with "resolved to null" (no detail / RPC
  error). A null result stranded the user on a perpetual skeleton — defeating the effect's
  own `.catch()` blind-summary fallback. Fixed with a `settled` flag so the skeleton shows
  only while genuinely in flight; once settled (even to null) the sheet drops to the blind
  summary. Restores the SwipeDeck blind-safety guarantee.
- **2 pre-existing stale test mocks** (`fix(07)` `0463799`): `LockDetail.test` + `a11y.test`
  stubbed framer-motion with `motion.span` only, but the real RevealModal they render uses
  `motion.div` (phase-5 reveal ceremony) → `Element type is invalid`, 11 failures. Pre-existing
  (phase-6 gate ran a scoped subset); replaced with a Proxy passthrough for any `motion.*` tag.

## Task 2 — Visual-verify @420px — DONE (PASS, 6/6 surfaces)
Orchestrator captured 7 PNGs (`route-07-visual.spec.ts`) and critiqued each vs 07-UI-SPEC +
DESIGN-SYSTEM. All PASS:
- detail-map — real pink RouteMap (2 numbered pins + pink route line, not terracotta) + `map` coord links (E20)
- detail-coord-link — `?query=lat,lng` per-stop deep-link in PlanTimeline (E20)
- lockdetail-venue-link — stop names underline-link to `/places/[slug]`, post-match only (E21)
- nightcard-city-label — lowercase `kelowna` + 0.1 mi finer distance (E23)
- standby-card — "you're next in line" + neutral `pull my interest` control (E24)
- detail-skeleton + archive-tab — shimmer holds the card shape; upcoming/archive tablist (E25)
PNGs in `__visual__/`.

## Task 3 — GATED PROD-APPLY — DONE (2026-06-05, explicit human approval)
Verified prod `ufufmcpnysvwtutpbian` at the expected pre-Phase-7 baseline first
(`withdraw_interest` absent; `browse_feed_for_viewer` had host-hint cols but NO `city_name`;
`get_night_detail` had NO per-stop coords — no drift). Applied the 3 migrations IN ORDER via MCP:
- `e20_get_night_detail_coords` — `get_night_detail` CREATE OR REPLACE (per-stop lat/lng/place_slug, LEFT-join degrade)
- `e23_browse_feed_city_and_tune` — `browse_feed_for_viewer` DROP+CREATE on e15 body (+city_name, finer distance, COUNT-weighted vibe + mutual-compat nudge)
- `e24_withdraw_interest` — new `withdraw_interest` DEFINER RPC

**Post-apply prod spot-check:** feed returns `city_name` + the 3 host-hint cols; `get_night_detail`
body merges `pj.lat/pj.lng/place_slug` + LEFT-join degrade + reservation_url scrub;
`withdraw_interest` exists; anon EXECUTE denied on all three; authenticated granted on all three;
search_path pinned on all three.
**Prod security advisor:** baseline 137 → post-apply 139. The only change is +1 WARN
(`withdraw_interest` under the established accepted `authenticated_security_definer_function_executable`
pattern that every match_* RPC already carries). ERROR unchanged (1→1), INFO unchanged (15),
NO new finding category. Feed/detail re-CREATEs added zero findings (grants preserved).

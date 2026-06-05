---
phase: 07-enhancements-and-polish-p3
plan: 02
subsystem: feed-rpc
tags: [browse_feed_for_viewer, e22, e23, relevance, city-label, distance, security-definer, keyset]
requires:
  - "browse_feed_for_viewer (e15 body, 20260606120000) — the live body re-CREATEd here"
  - "cities.name + cities.centroid (20260525120000 p0)"
  - "places.lat / places.lng (initial_schema) for finer distance"
provides:
  - "browse_feed_for_viewer returns city_name (= cities.name) — NightCard.tsx:54-56 already reads it"
  - "finer per-night distance_m (venue coords when present, city-centroid fallback)"
  - "tuned soft-score: COUNT-weighted vibe overlap + light mutual-compat nudge, keyset stable"
  - "supabase/tests/e23_feed_contract.sql — the privacy/host-hint/keyset/city_name regression lock"
affects:
  - "downstream feed frontend (NightCard city label + relevance order surface)"
  - "07-09 phase gate (e23_feed_contract.sql + advisor + gated prod-apply)"
tech-stack:
  added: []
  patterns:
    - "feed-RPC DROP+CREATE on the CURRENT body (e15), re-emit verbatim privilege tail (return shape changed)"
    - "keyset tail byte-identical across a soft-score tune (D-03) so the cursor never destabilizes"
key-files:
  created:
    - "supabase/migrations/20260606140100_e23_browse_feed_city_and_tune.sql"
    - "supabase/tests/e23_feed_contract.sql"
  modified: []
decisions:
  - "REQ-E22/E23 NOT marked complete — DB half done + gated; user-facing acceptance (NightCard label + relevance order) + prod-apply land downstream / at the 07-09 gate (mirrors 07-01's E20/E23/E24 pattern)"
metrics:
  duration: ~18m
  completed: 2026-06-05
---

# Phase 07 Plan 02: Feed-RPC City Label + Relevance Tune Summary

One `browse_feed_for_viewer` DROP+CREATE on the live e15 body covers E22 (relevance tune) and E23 (city label + finer distance), locked by the phase's most important regression test.

## What Was Built

**Task 1 — migration `20260606140100_e23_browse_feed_city_and_tune.sql` (GREEN):**
DROP+CREATE (not bare CREATE OR REPLACE — adding `city_name` changes the RETURNS TABLE so Postgres resets privileges) built on the CURRENT live body (e15, `20260606120000`). Changes vs e15:
- **E23 city label:** appended `city_name text` to RETURNS TABLE; `cc.name as city_name` in the SELECT via the already-in-scope `cities cc` join (no new join).
- **E23 finer distance:** `distance_m` now `st_distance(coalesce(venue-coord-point, cc.centroid), me.pt)` — venue `places.lat/lng` when present (the existing `left join places pl on pl.id = di.venue_id`), else the city-centroid fallback. `NightCard` calls `formatDistanceAway(distance_m)` unchanged.
- **E22 soft-score (D-03):** vibe overlap was boolean `it.vibe_tags && f.vibes` (1/0); now `coalesce(cardinality(array(select unnest(it.vibe_tags) intersect select unnest(f.vibes))), 0)` — COUNT-weighted. Added a `+1` light mutual-compat nudge when both sides' gender prefs align beyond the hard gate. The targeting×4, who_pays, and time_bucket terms are unchanged.

Preserved byte-for-byte: the 5-param signature, all 14 e10 cols + the 3 host-hint cols (`cr.blurred_photo_url, cr.first_name, cr.age`), the `date_trunc('hour')` time-blind, every baseline gate + E10 HARD filter (e15:88-103), the `(di.starts_at asc, di.id asc)` keyset tail, the `set search_path = public, extensions` pin, and the verbatim revoke-public/revoke-anon/grant-authenticated tail.

**Task 2 — test `supabase/tests/e23_feed_contract.sql` (authored RED → GREEN):**
The regression lock. Four assertions: (1) OUT column set is EXACTLY the 18 cols (14 e10 + 3 host-hint + `city_name`) in order, with no forbidden creator field (id/email/clear_photo_url/instagram) in the shape; (2) anon + PUBLIC denied EXECUTE, authenticated granted; (3) `city_name` = `cities.name` for a known kelowna seed night; (4) keyset cursor stays stable (no dup, no skip across the page-1→page-2 boundary) under the tuned soft-score.

## Verification

- RED captured: before the migration, assertion 1 failed (live RPC lacked `city_name`). Commit `e58234a`.
- Migration applied cleanly; `e23_feed_contract.sql` → all 4 assertions pass.
- Fresh `supabase db reset --local`: e23 sorts last (`20260606140100` after `20260606140000` e20 from 07-01), applies with no collision; contract test re-run GREEN on the fresh stack.

## TDD Gate Compliance

Plan task was `tdd="true"`. Gate sequence satisfied in git: `test(07-02)` RED commit `e58234a` (test failed pre-implementation) → `feat(07-02)` GREEN commit `72d11e6`. No unexpected early pass; assertion 1 failed correctly during RED.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes (Rules 1-3) and no architectural decisions (Rule 4) were needed. No auth gates. No package installs (consistent with the threat register T-07-SC "accept — no installs this phase").

## Threat Model Coverage

- **T-07-04 (info disclosure on re-CREATE):** mitigated — built on the e15 body, all 3 host-hint cols preserved, verbatim revoke-anon/public + grant-authenticated tail re-emitted; `e23_feed_contract.sql` asserts the exact column set + anon/public denied.
- **T-07-05 (DEFINER search_path):** mitigated — `set search_path = public, extensions` kept.
- **T-07-06 (keyset DoS from the tune):** mitigated — only the score expression changed; the `(starts_at,id)` keyset tail is byte-identical; the test asserts no dup/skip across the boundary.

## Known Stubs

None. Both artifacts are complete and exercised by a passing test.

## Gated / Follow-up

- **Prod UNTOUCHED** (ufufmcpnysvwtutpbian). The migration is local-green only; advisor run + gated batched prod-apply are owned by the 07-09 phase gate (per Phase 5/6 secure-by-default + gated-prod-apply rule).
- **REQ-E22 / REQ-E23 not marked complete.** Their user-facing acceptance (NightCard rendering the city label, the stronger relevance order surfacing in the feed) lands in the downstream frontend wave; this plan ships the DB half only. Mirrors 07-01's E20/E23/E24 handling.

## Self-Check: PASSED

- FOUND: supabase/migrations/20260606140100_e23_browse_feed_city_and_tune.sql
- FOUND: supabase/tests/e23_feed_contract.sql
- FOUND commit e58234a (test RED)
- FOUND commit 72d11e6 (feat GREEN)

---
phase: 07-enhancements-and-polish-p3
verified: 2026-06-05T00:00:00Z
status: passed
score: 4/4 success criteria verified (6/6 requirements, D-02 scope honored)
overrides_applied: 0
re_verification:
  previous_status: none
  note: "Initial retroactive verification of a COMPLETE + prod-applied + pushed phase"
deferred:
  - truth: "E25 draft state (post-night draft vs publish)"
    addressed_in: "future milestone"
    evidence: "07-CONTEXT §Deferred + ROADMAP §Phase 7 Note (D-02): explicitly out of this phase"
  - truth: "E25 typing indicators + read receipts"
    addressed_in: "future milestone"
    evidence: "07-CONTEXT §Deferred + ROADMAP §Phase 7 Note (D-02)"
  - truth: "E25 business-ownership/claim stub"
    addressed_in: "future milestone"
    evidence: "07-CONTEXT §Deferred + ROADMAP §Phase 7 Note (D-02)"
  - truth: "E25 legacy /plan/i/ dead-link cleanup (the E25g brand-audit item)"
    addressed_in: "future milestone"
    evidence: "07-CONTEXT §Deferred — only the /create funnel on /places pages was retired (E21/D-01)"
  - truth: "Phase 5 WR-04 cancelled-lock reveal"
    addressed_in: "tracked todo"
    evidence: ".planning/todos/pending/wr04-cancelled-lock-reveal.md exists; carried from Phase 5"
  - truth: "E22 richer compatibility/chemistry ranking model; E24 automatic standby promotion"
    addressed_in: "future milestone"
    evidence: "07-CONTEXT §Deferred (tune-only D-03; no auto-promotion D-24)"
---

# Phase 7: Enhancements & Polish (P3) Verification Report

**Phase Goal:** Round out the experience — real maps, venues back in the loop, relevance ranking, finer proximity, standby UI, feed/detail polish, and legacy-planner cleanup.
**Verified:** 2026-06-05
**Status:** passed
**Re-verification:** No — initial retroactive verification (phase is COMPLETE + prod-applied + pushed)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | Detail sheet renders a real static map from real coordinates with per-stop links that deep-link to the correct venue | ✓ VERIFIED | `RouteMap.tsx` builds a Mapbox **static-image** URL (`buildStaticMapUrl`, `<Image unoptimized>`, no GL) in Barbiecore pink (`ACCENT='E0218A'`); mounted in `NightDetailSheet.tsx:332` (`<RouteMap stops={stops} />`). Coords flow from `get_night_detail` migration LEFT-joining `places` per `place_id` to merge `lat/lng/place_slug` (`20260606140000_e20`). `PlanTimeline.tsx:56-58` deep-links `?api=1&query=${lat},${lng}` when coords present, name-search fallback otherwise. |
| 2 | Post-match, a matched night links to its venue business page; a `/places` nav-vs-retire decision is made and applied | ✓ VERIFIED | `LockDetail.tsx:248` is the **only** `linkSlugs`-true caller (`grep` confirms); `PlanTimeline` defaults `linkSlugs=false` so blind surfaces never link. `/places/[slug]/page.tsx` has **0** `href="/create"` CTAs (legacy funnel retired, D-01). No `/places` global nav added (decision = link post-match only). Slugless stops degrade to plain text. |
| 3 | Feed reflects compatibility/vibe relevance, cards show a human city label with finer distance, and a standby candidate sees their queue position and can withdraw a pending interest | ✓ VERIFIED | `20260606140100_e23` DROP+CREATE on the e15 body: COUNT-weighted vibe overlap (`cardinality(... intersect ...)`) + `+1` mutual-compat nudge (E22), `city_name` col + `st_distance` over venue coords with city-centroid fallback (E23). `NightCard.tsx:55` renders the city label. `StandbyCard.tsx` shows rank ("you're next in line" / "#N in line") + neutral `pull my interest` calling `withdrawInterest`; `StandbyList` mounted on `/inbox` (page.tsx:159). `withdraw_interest` DEFINER RPC (`20260606140200_e24`) gates on `auth.uid()` (P5001) and deletes only own `status='interested'` row. |
| 4 | Hero consistent, skeleton matches the new card, archive/draft states exist, typing/read receipts work, business-ownership stub exists, legacy `/plan/i/` cleaned up | ✓ VERIFIED (D-02 scope) | Per ROADMAP Note + D-02, this SC ships **only** skeleton + archive this phase. `NightDetailSheet.tsx:72` `DetailSkeleton` + `settled` flag (the 07-09 in-flight fix) renders the shimmer holding the card shape while `get_night_detail` pends. `NightsSegments.tsx` upcoming/archive toggle buckets `date_instances.status` in memory, mounted in `my-nights/page.tsx:92`. Draft/typing/receipts/claim-stub/`/plan/i/` are explicitly DEFERRED (see Deferred Items). |

**Score:** 4/4 success criteria verified · 6/6 requirements satisfied (D-02 scope honored)

### Deferred Items

Items not delivered this phase but explicitly scoped out by D-02 / 07-CONTEXT §Deferred / carried Phase-5 todo. These are NOT gaps.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | E25 draft state | future milestone | 07-CONTEXT §Deferred + ROADMAP Phase 7 Note (D-02) |
| 2 | E25 typing indicators + read receipts | future milestone | 07-CONTEXT §Deferred + ROADMAP Note (D-02) |
| 3 | E25 business-ownership/claim stub | future milestone | 07-CONTEXT §Deferred + ROADMAP Note (D-02) |
| 4 | E25g legacy `/plan/i/` dead-link cleanup | future milestone | 07-CONTEXT §Deferred (only the /create funnel was retired via E21/D-01) |
| 5 | Phase 5 WR-04 cancelled-lock reveal | tracked todo | `.planning/todos/pending/wr04-cancelled-lock-reveal.md` present |
| 6 | E22 richer chemistry model; E24 auto standby-promotion | future milestone | 07-CONTEXT §Deferred (tune-only D-03, no auto-promote D-24) |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| REQ-E20 | Real static map + route in detail sheet; coord stop-links | ✓ SATISFIED | `e20` migration (per-stop lat/lng/place_slug), `RouteMap.tsx` static pink map mounted in sheet, `PlanTimeline` coord deep-links. SQL test `e20_night_detail_coords.sql` present. |
| REQ-E21 | Venues into the loop post-match; `/create` funnel retired; no `/places` nav | ✓ SATISFIED | `LockDetail` sole `linkSlugs=true` caller; 0 `/create` CTAs on `/places/[slug]`; graceful slugless degrade. |
| REQ-E22 | Relevance ranking over chronology | ✓ SATISFIED | `e23` migration COUNT-weighted vibe overlap + mutual-compat nudge; keyset `(starts_at,id)` byte-identical (D-03 tune, not rebuild). |
| REQ-E23 | City label + finer distance | ✓ SATISFIED | `city_name` col + venue-coord `st_distance` in `e23` migration; `NightCard.tsx:55` renders label; `e23_feed_contract.sql` regression locks the 18-col set. |
| REQ-E24 | Standby/waitlist UI + withdraw pending interest | ✓ SATISFIED | `withdraw_interest` DEFINER RPC (auth.uid() gate, status-scoped, secure tail); `StandbyCard`/`StandbyList` on `/inbox`. |
| REQ-E25 | Feed/detail polish (D-02 scoped: skeleton + archive) | ✓ SATISFIED (scoped) | `DetailSkeleton`+`settled` in `NightDetailSheet`; `NightsSegments` archive toggle on `/my-nights`. Remainder deferred per D-02. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260606140000_e20_get_night_detail_coords.sql` | per-stop coord merge | ✓ VERIFIED | LEFT-join `places` on `place_id`; reservation_url scrub preserved; search_path pinned; revoke-anon/grant-authenticated tail re-emitted |
| `supabase/migrations/20260606140100_e23_browse_feed_city_and_tune.sql` | feed re-CREATE on e15 body | ✓ VERIFIED | DROP+CREATE; +`city_name`, finer `st_distance`, COUNT-weighted vibe + mutual-compat nudge; keyset preserved |
| `supabase/migrations/20260606140200_e24_withdraw_interest.sql` | DEFINER withdraw RPC | ✓ VERIFIED | `auth.uid()` P5001 gate, `status='interested'` scope, search_path pinned, anon revoked |
| `apps/web/components/itinerary/RouteMap.tsx` | static pink map | ✓ VERIFIED | 191 lines; static-image (no GL), `E0218A`, `unoptimized`; returns null at 0 coords |
| `apps/web/components/PlanTimeline.tsx` | coord href + opt-in linkSlugs | ✓ VERIFIED | coord deep-link L56-58; `linkSlugs` default-off blind contract |
| `apps/web/app/feed/NightDetailSheet.tsx` | map mount + skeleton | ✓ VERIFIED | RouteMap mounted L332; `DetailSkeleton`+`settled` L72/124; PlanTimeline rendered WITHOUT linkSlugs (blind) |
| `apps/web/app/matches/[lockId]/LockDetail.tsx` | sole linkSlugs caller | ✓ VERIFIED | L248 `linkSlugs` set; only true caller |
| `apps/web/app/places/[slug]/page.tsx` | /create retired | ✓ VERIFIED | `grep -c href="/create"` = 0 |
| `apps/web/components/StandbyCard.tsx` + `StandbyList.tsx` | candidate standby UI | ✓ VERIFIED | rank copy, withdrawInterest call, mounted on /inbox L159 |
| `apps/web/app/my-nights/NightsSegments.tsx` | archive toggle | ✓ VERIFIED | upcoming/archive bucketing, mounted in page.tsx L92 |
| `packages/api-client/src/feed.ts` | place_slug/city_name/withdrawInterest | ✓ VERIFIED | all three present in the Phase-7 contract |
| SQL tests (e20/e23/e24) | contract locks | ✓ VERIFIED | all 3 present; e23 asserts 18-col set + anon-deny + keyset |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| NightDetailSheet | RouteMap | `<RouteMap stops={stops}/>` L332 | ✓ WIRED |
| PlanTimeline | google maps coord link | `?api=1&query=lat,lng` L57 | ✓ WIRED |
| LockDetail | PlanTimeline /places links | `linkSlugs` L248 | ✓ WIRED |
| NightCard | city_name | `geo.city_name` L55 | ✓ WIRED |
| StandbyCard | withdraw_interest RPC | `withdrawInterest(...)` L67 | ✓ WIRED |
| /inbox | StandbyList | import+mount L19/159 | ✓ WIRED |
| my-nights/page | NightsSegments | import+mount L17/92 | ✓ WIRED |
| feed.ts withdrawInterest | client surfaces | re-export in api-client/index + lib/after5/client | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full type-check across monorepo | `pnpm typecheck` | 6 successful, 6 total | ✓ PASS |
| `withdraw_interest` in generated types (confirms types regen after prod-apply) | `grep withdraw_interest packages/types/src/database.ts` | found L4227 | ✓ PASS |
| `/create` retired on places page | `grep -c 'href="/create"'` | 0 | ✓ PASS |
| linkSlugs sole caller (blind contract) | `grep -rln linkSlugs= app components` | only LockDetail + PlanTimeline def | ✓ PASS |

_DB contract tests (e20/e23/e24) and `supabase db reset` replay were intentionally NOT re-run by the verifier (per instruction: do not wipe the seeded local visual-capture stack). The 07-09 gate's claim that all 3 SQL tests pass and 10 migrations replay in order is corroborated by: migration files present and timestamp-ordered last, the `withdraw_interest` signature now in generated types, and typecheck green._

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| (none) | TBD/FIXME/XXX/PLACEHOLDER/"coming soon"/"not implemented" | — | Scan of all 12 Phase-7-modified files returned zero debt markers and zero stub-return patterns. No anti-patterns. |

### Human Verification Required

None blocking. Visual-verify @420px was performed at the 07-09 gate (PASS, 6/6 surfaces) with PNGs persisted in `.planning/phases/07-enhancements-and-polish-p3/__visual__/` (detail-map, detail-coord-link, lockdetail-venue-link, nightcard-city-label, standby-card, detail-skeleton, archive-tab). The 7 PNGs are present on disk; aesthetic judgment already signed off at the gate.

### Gaps Summary

No gaps. All 4 ROADMAP success criteria are observably true in the codebase, and all 6 requirements (REQ-E20..E25) are satisfied with the E25 scope correctly narrowed to skeleton + archive per the user-locked D-02 decision (ratified in the ROADMAP Phase-7 Note). Every artifact exists, is substantive (not a stub), is wired to its caller, and the three DB migrations carry the secure-by-default contract (search_path pinned, anon revoked, authenticated granted, status-scoped delete, P5001 auth gate). The blind contract is intact: the feed/offer surfaces never render `/places` slug links (only post-lock LockDetail does). Type-check passes 6/6 packages and the regenerated types prove the gated prod-apply landed. Deferred items (draft/typing/receipts/claim-stub/`/plan/i/`, plus the carried Phase-5 WR-04 todo and the E22-chemistry/E24-auto-promotion future work) are explicitly scoped out, not missing work.

---

_Verified: 2026-06-05_
_Verifier: Claude (gsd-verifier)_

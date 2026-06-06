# Phase 10: Generation as the Primary Night Path - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning
**Mode:** mvp — wiring + city-selection + retirement; much is already converged.

<domain>
## Phase Boundary

Make generating a date the **primary** way to create a night in the dating app, wire **city selection** (which also unblocks the deferred Phase-8 background pre-seed), keep the improve loop in the flow, and demote/retire the manual-from-scratch door. One requirement: **FLOW-01**.

**Already converged (do NOT rebuild):** `/create` has a chooser (Door 1 generate → `/create/generate`; Door 2 manual). There is NO `/plan` route. Publish is one path (`PublishToFeedButton` → `/nights/new?itinerary=X` → `post_night` → feed). v1.0 E21 already retired the "build a date here" CTAs on `/places`.

**In scope:** the create entry default + city selection + improve-loop placement + manual-door demotion. NOT generation quality (Phase 9), NOT the whole-app UX audit (Phase 11).

**Builds/tests against curated Kelowna — no live Foursquare key needed.** Generation of a cold city falls through the 08-04 cold-start "warming up" path.
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Primary path
- `/create` defaults to the **generate funnel** (Door 1 primary). The manual-from-scratch door (Door 2) is demoted to a quiet secondary "or build from scratch" link — NOT a co-equal door (kept as an escape hatch for hosts who want it).
- The global create CTA / `+` tab opens the generate funnel directly.
- The improve loop (`ImproveControls` from 09-05) is reachable in the generate RESULT before publish — what lands in the feed is the refined date.
- `/places` catalog stays a post-match venue-detail surface (v1.0 E21); it is NOT a creation entry. Verify no "create from this venue" CTA resurrects.

### Area 2 — City selection + pre-seed wiring (the deferred Phase-8 item)
- Add a city selector to the generate funnel's first step; **write `primary_city_id`** on the profile when the user picks/confirms their city.
- On city set, call `enqueueSeedCity(cityId)` fire-and-forget (the Phase-8 helper, `apps/web/lib/after5/enqueue-seed-city.ts`) — this UNBLOCKS the Phase-8 background pre-seed.
- Existing users with `primary_city_id` set → prefill + allow change.
- If the chosen city isn't seeded yet, generation proceeds via the 08-04 cold-start path (the "warming up" state); never block.

### Area 3 — Retirement + cleanup
- Demote (not fully retire) the manual-from-scratch door; verify the demoted manual path still works (no trap/dead link).
- Create-entry copy sells "generate a date" as the default (Barbiecore, lowercase/dry, no em-dashes).
- No dead funnels or broken links introduced.

### Claude's Discretion
- The city-selector UI shape, where exactly primary_city_id is written (profile RPC vs direct update with RLS), the demoted-manual-link placement, and the copy — within DESIGN-SYSTEM + secure-by-default.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/app/create/` — CreateChooser (the Door 1/Door 2 chooser), CreateFlow, generate/page.tsx (the generate funnel), PublishToFeedButton (→ nights/new → post_night).
- `apps/web/app/create/ImproveControls.tsx` (09-05) — the improve UI to keep in the result flow.
- `apps/web/lib/after5/enqueue-seed-city.ts` (08-05) — the fire-and-forget seed trigger to call on city-set.
- `cities` table + `profiles.primary_city_id` (read today by nights/new + browse_feed centroid; written only in test seeds — Phase 10 adds the real write).
- post_night RPC + nights/new/PostNightForm — the publish path (unchanged; one path).

### Established Patterns
- Secure-by-default: a primary_city_id write must respect profiles RLS (self-update only). If a new RPC, pin search_path + revoke anon.
- Barbiecore mobile-first; visual-verify @420px; stop-slop copy.

### Integration Points
- Generate funnel → city selection → primary_city_id write + enqueueSeedCity → generate (Kelowna or cold-start) → improve → publish (post_night) → feed.
- The Phase-8 seed_city job fires once enqueueSeedCity has a caller (this phase).
</code_context>

<specifics>
## Specific Ideas
- This closes the loop the milestone promised: a user picks their city, generates a real date simply, improves it, and publishes it — the "create a date people will actually go on, simply" core.
- Generation/improve are UI-bearing → visual-verify @420px the create entry + city picker + improve placement.
</specifics>

<deferred>
## Deferred Ideas
- The whole-app UX/nav audit (Phase 11).
- The Foursquare live cutover (Phase 8/9 bundled, key-gated).
- Fully retiring the manual door (kept as an escape hatch for MVP).
</deferred>

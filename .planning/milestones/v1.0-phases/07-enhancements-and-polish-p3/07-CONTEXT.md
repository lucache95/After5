# Phase 07: Enhancements & Polish (P3) - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning
**Mode:** mvp — thin vertical slices per requirement; defer aggressively (this is the P3 round-out, not a rebuild)

<domain>
## Phase Boundary

Round out the experience: REQ-E20 (real map + coord stop-links), E21 (venues into the loop), E22 (relevance ranking tune), E23 (city label + finer distance), E24 (standby/waitlist UI), E25 (polish — scoped to skeleton + archive). WIRING + tuning over existing infra; defer the heavy net-new items.

**In scope:**
- **E20:** a real Mapbox map in the night detail sheet (reuse the existing Mapbox token + ItineraryMap/RadiusMap components from the legacy planner); per-stop "map" links use real coordinates (places.lat/lng via the stop's place_id) instead of name text-searches.
- **E21:** link matched-night stops → `/places/[slug]` venue pages (venue identity in the dating loop, post-match). Retire the legacy "build a date here" → `/create` planner funnel on those venue pages. NO `/places` global nav in the dating app.
- **E22:** TUNE the existing e10 soft-score in `browse_feed_for_viewer` (currently targeting×4 + vibe/who-pays/time-bucket overlap). Strengthen it: weight vibe-overlap by match COUNT (not boolean), add a light mutual-compatibility nudge. No ranking rebuild.
- **E23:** return `city_name` (cities.name) from `browse_feed_for_viewer` + render the human city label on NightCard (the slot already exists); finer distance than city-centroid where coords allow.
- **E24:** candidate-side standby/waitlist UI — a candidate sees their queue position ("you're next in line" / rank) and can WITHDRAW a plain `interested` interest (distinct from the offer-stage withdraw). Minimal standby (surface existing queue_entries rank/status; do NOT build complex standby-promotion logic).
- **E25 (scoped):** (b) a detail-sheet loading skeleton matching the new card; (c) an archive view/tab for past (completed/expired) nights + matches. (E25a hero consistency is already satisfied — no work.)

**Out of scope (DEFERRED to a future milestone — user decision):**
- E25d draft state (post-night draft vs publish — needs a flow redesign).
- E25e typing indicators + read receipts (read_at exists; typing is net-new realtime — heavier).
- E25f business-ownership/claim stub + E25g legacy `/plan/i/` dead-link cleanup (the one E25 option not selected).
- E21 "keep /places as global nav" and "retire /places entirely" (both rejected — link post-match only).
- E22 richer/chemistry ranking model (tune-only chosen).

**Mode: mvp** — thin slices.
</domain>

<decisions>
## Implementation Decisions

User-locked (the consequential product/scope calls). Cite these D-IDs in plan must_haves.truths.

### E21 — venues into the loop
- **D-01: Link post-match, no global nav, retire the /create funnel.** Matched-night stops link to `/places/[slug]` (venue identity post-lock). Do NOT add `/places` to the dating app's global nav. Retire the legacy "build a date here" → `/create` CTA on the venue pages (brand cleanup). Graceful degrade: a stop whose place_id isn't in the catalog renders inline (no broken /places link / 404).

### E25 — polish scope
- **D-02: Ship ONLY the detail-sheet skeleton + the archive view.** Defer draft-state, typing-indicators, read-receipts, business-ownership stub, and the /plan/i legacy cleanup to a future milestone. (E25a hero consistency already holds.)

### E22 — relevance ranking
- **D-03: Tune the existing e10 soft-score, do not rebuild.** Keep the `browse_feed_for_viewer` ORDER BY shape (targeting×4 + soft filters + (starts_at,id) keyset). Strengthen relevance: weight vibe-overlap by the COUNT of matched vibe tags (not a boolean 0/1), and add a light mutual-compatibility nudge. The keyset cursor stays stable.

### Claude's Discretion (implementation)
- **E20 map:** Mapbox (the `NEXT_PUBLIC_MAPBOX_TOKEN` + `ItineraryMap.tsx`/`RadiusMap.tsx` already exist). Prefer a lightweight, low-interaction map in the detail sheet (static-ish, reduced-motion friendly) over a heavy GL canvas; reuse the existing component pattern. Per-stop coords come from the stop's place_id → places.lat/lng (join at the detail-RPC boundary or denormalize into the stop shape — planner's call; prefer the get_night_detail RPC adding lat/lng to each stop).
- **E23 distance/label:** add `c.name as city_name` to `browse_feed_for_viewer` (re-CREATE preserves the e10/e15 contract incl. the host-hint cols + re-grant tail). "Finer than city-centroid": use the night's first-stop/venue coords for distance when available, else fall back to city-centroid; keep the NightCard distance UI as-is (it already calls formatDistanceAway).
- **E24 standby:** surface the candidate's existing queue_entries rank/status (read path) as "you're next in line" / position; the withdraw-pending-interest path removes a plain `interested` row (a DEFINER RPC mirroring the existing withdraw patterns, secure-by-default). Do NOT auto-create standby on offer-expiry (that promotion logic is deferred). Re-swipe-after-withdraw behavior: planner's call (simplest: withdrawing just deletes the interest; re-swipe allowed).
- **Secure-by-default + gated-prod-apply:** any RPC re-CREATE / new RPC pins search_path, no USING(true), re-applies grants; advisor after DDL; local-green → gated prod-apply (NOT auto-pushed; prod ufufmcpnysvwtutpbian).
- **Visual-verify @420px** every changed surface (map in detail, venue links, city label, standby UI, skeleton, archive) against DESIGN-SYSTEM.md.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — REQ-E20 (~194), E21 (~200), E22 (~207), E23 (~213), E24 (~219), E25 (~225).
- `.planning/ROADMAP.md` §"Phase 7" — goal + 4 success criteria + Mode:mvp.

### E20 map — REUSE
- `apps/web/components/itinerary/ItineraryMap.tsx` + `apps/web/components/RadiusMap.tsx` — existing Mapbox GL components (legacy planner) to reuse/adapt.
- `apps/web/app/feed/NightDetailSheet.tsx:264-287` — the placeholder route viz to replace.
- `apps/web/components/PlanTimeline.tsx:111-118` — per-stop name-query map links to convert to coord deep-links.
- `supabase/migrations/20260601210000_m5_get_night_detail.sql` — get_night_detail RPC (the stop shape; add lat/lng per stop here).
- `apps/web/.env.local` — `NEXT_PUBLIC_MAPBOX_TOKEN` (present).
- `supabase/migrations/20260419193959_initial_schema.sql` — places.lat / places.lng (decimal 9,6).

### E21 venues — REUSE
- `apps/web/app/places/[slug]/page.tsx` — the live venue page (retire its /create CTA; it becomes the post-match venue link target).
- `apps/web/app/places/page.tsx` — the catalog (leave; just don't add to dating nav).
- `apps/web/app/matches/[lockId]/LockDetail.tsx` + PlanTimeline — where stop→venue links land.

### E22 ranking + E23 label — REUSE (one feed-RPC re-CREATE covers both)
- `supabase/migrations/20260605120500_e10_browse_feed_filters.sql` — the soft-score ORDER BY (lines ~107-117) + the e10 column contract.
- **NOTE:** the LIVE `browse_feed_for_viewer` was last re-CREATEd by Phase 5's e15 (`20260606120000_e15_browse_feed_host_hint.sql`) which added the 3 host-hint cols. Any E22/E23 re-CREATE MUST build on the e15 body (host hint cols + re-grant tail preserved) and be timestamped after the latest migration. Mirror the Phase-6 ordering lesson (post-latest timestamp, unique version prefix).
- `apps/web/app/feed/NightCard.tsx:54-56` — the `city_name` slot already present.
- `packages/api-client/src/feed.ts` — FeedNight type (add city_name).
- `supabase/migrations/20260525120000_p0_extensions_and_cities.sql` — cities.name/centroid.

### E24 standby — REUSE
- `supabase/migrations/20260525120500_p0_queue_entries.sql` — queue_entries (status enum incl. standby/interested/shortlisted, rank).
- `apps/web/app/dates/[slug]/interested/InterestedList.tsx` — host-side (reference; the candidate-side view is net-new).
- Existing withdraw patterns (offer-stage withdraw) to mirror for plain-interested withdraw.

### E25 — REUSE
- `apps/web/app/feed/loading.tsx` — the existing Tier-1 feed skeleton pattern to mirror for the detail sheet.
- `apps/web/app/feed/NightDetailSheet.tsx:85-97` — where the detail skeleton goes (drawer-open while RPC pending).
- `apps/web/app/my-nights/` — where the archive tab/view attaches (date_instances status completed/expired).

### Prior-phase constraints
- Phases 5+6 carried the gated-prod-apply + secure-by-default rules + the migration-ordering lesson (unique version prefix, timestamp after latest, build feed RPC on the e15 body). DESIGN-SYSTEM.md governs all UI.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Mapbox token + ItineraryMap/RadiusMap → E20 map (don't add a new provider).
- e10 soft-score in browse_feed_for_viewer → E22 tune (the ORDER BY already exists).
- cities.name + NightCard city_name slot + formatDistanceAway → E23 (small RPC add + render).
- /places/[slug] fully built → E21 (just link + retire the /create funnel).
- queue_entries rank/status → E24 (surface + a withdraw RPC).
- feed/loading.tsx skeleton + my-nights → E25 skeleton + archive.

### Established Patterns
- **Feed RPC ordering (CRITICAL):** browse_feed_for_viewer is re-CREATEd across phases (e10 → e15). The E22/E23 change re-CREATEs it AGAIN — build on the CURRENT (e15) body (keep the 3 host-hint cols + the drop+recreate re-grant tail), use a unique version prefix timestamped after the latest migration (Phase-6 collision lesson).
- **Secure-by-default + gated-prod-apply** (as Phases 4-6).
- **Visual-verify @420px** every surface.

### Integration Points
- get_night_detail → per-stop lat/lng → Mapbox map + coord stop-links (E20).
- browse_feed_for_viewer → +city_name +tuned soft-score → NightCard label + relevance order (E22/E23).
- matched night stops → /places/[slug] (E21).
- queue_entries → candidate standby view + withdraw RPC (E24).
- NightDetailSheet skeleton + my-nights archive tab (E25).
</code_context>

<specifics>
## Specific Ideas
- All new copy lowercase/dry/Barbiecore, stop-slop, no em-dashes (e.g. standby "you're next in line").
- This is the LAST milestone phase — bias toward shipping the thin slice cleanly over gold-plating; the deferred E25 items + draft/typing/claims are explicitly a future milestone.
</specifics>

<deferred>
## Deferred Ideas
- E25d draft state; E25e typing indicators + read receipts; E25f business-ownership/claim stub; E25g legacy /plan/i dead-link cleanup (the brand-audit legacy-planner retire — except the /create funnel on /places pages, which IS done in E21/D-01).
- E22 richer compatibility/chemistry ranking model.
- E24 automatic standby promotion (offer-expiry → standby) logic.
- E21 /places global nav; multi-city expansion (only Kelowna seeded).
- Phase 5 WR-04 (cancelled-lock reveal) — still tracked in .planning/todos/pending/.
</deferred>

---

*Phase: 07-enhancements-and-polish-p3*
*Context gathered: 2026-06-05*

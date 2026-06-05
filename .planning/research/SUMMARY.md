# v2.0 Research Synthesis — AI Date-Planner (revive + harden + make-compliant)

**Date:** 2026-06-05 · Sources: [`VENUE-DATA.md`](VENUE-DATA.md), [`GENERATION.md`](GENERATION.md)

## The headline

The AI date-planner is **already built and live on prod** — it is the original product (pre-dating-pivot), never removed. `supabase/functions/generate-plan/` is a mature **constraint-first hybrid**: Postgres pre-filters candidate venues (geo/category/hours/price/season) → deterministic TypeScript assembles + stochastically scores the stops → code validators enforce proximity/adjacency/budget/hours → Claude (`claude-sonnet-4-6`) writes ONLY the copy (title, hook, why_it_works, per-stop `what_to_do`) over frozen `place_id`s. Providers exist for `kelowna` (curated), `onthefly` (any-city), and `railway`. It's deployed (edge fn v46, redeployed 2026-06-04), reachable via `/create` → `app/api/create-plan` → publishes to the dating feed via `PublishToFeedButton`, and `GOOGLE_PLACES_API_KEY` is set.

**Verdict (both researchers, independently): refactor, do not replace.** v2.0 = make it legal, make it work in any city, prove it's good, wire it as THE way to create a dating night.

## The make-or-break: licensing (venue corpus)

Google's April-2026 Maps Platform terms (§3.2.3) forbid exactly what the live pipeline does: you may store only a bare `place_id` (NOT name/address/hours/price/ratings/photos), and you may NOT feed Maps Content to an LLM or "create content based on" it. The live `google-places.ts` → `onthefly.ts` → Claude path violates both, and persists Google fields into `places`.

**Recommendation — two-layer venue model:**
- **Foursquare Places API = the canonical, stored, LLM-fed `places` corpus.** It's the one source whose license permits fetch + store-forever + LLM-input + display. (Verify the free-tier transition: legacy V3 deprecates 2026-05-15; build only on the new Places API.)
- **Google demoted to a live, display-time details/photo/map layer**, keyed by the only field legally storable forever (`google_place_id`) — never persisted as content, never fed to the model.
- **Reject bespoke scraping** (worst legal posture, brittle, no cost upside). Use **OSM/Overpass** only as a free lat/lng + category backfill for thin cities.
- **Schema impact is small:** add `fsq_place_id` (+ optional `google_place_id`), extend a `source` column, swap the fetcher. The trigger model (async pre-seed on profile-location-set + cold-start fallback at generation) stays intact.
- **Cost is a non-issue** (<$200/mo every option). This is purely a licensing decision.
- **Cleanup debt:** Google-warmed rows already in `places` must be re-warmed from Foursquare (or relabeled + pulled out of the LLM input path).

## Generation + the customize/improve loop

Keep the constraint-first hybrid (it structurally prevents the two things LLMs fail at: inventing venues + hallucinating proximity/hours). v2.0 generation work:
- **Real proximity:** replace the `drive_cluster` string-label with PostGIS + haversine drive-time hop-gate.
- **Structured output:** migrate the copy-writing pass from fragile raw-JSON parsing to Anthropic tool-use.
- **Improve loop:** single-stop re-pick (Haiku 4.5: deterministic re-pick + one cheap copy rewrite) + NL-tweak intent parsing (free text → scoring knobs → re-run pipeline), persisted via the existing `update_itinerary_stops` RPC.
- **Model split:** Sonnet 4.6 generate (~1¢, 2–4s) · Haiku 4.5 improve loop (<$0.001, <1s) · Opus 4.8 offline judge only.

## The eval harness (the product's actual test)

Combine **deterministic hard checks** (proximity distance, hours-open at the stop's time, schedule monotonicity, budget sum, no hallucinated venues) with an **Opus-4.8 LLM-as-judge rubric** (coherence, desirability/hook, feasibility, budget realism, local specificity) over a pinned golden set, gated in CI.

## THE BIGGEST RISK — silent quality collapse on cold cities

The deterministic guards **pass on null input**: `withinRadius` returns `true` on null coords, `isOpenAt` returns `true` on null hours. Curated Kelowna has these fields hand-filled; Foursquare-warmed venues in a cold city arrive without some of them — so the guards that make generation trustworthy **quietly become no-ops exactly where the corpus is weakest.** A Kelowna-only eval set will read green while new-market quality is poor. **Mitigations (must be requirements):** guards FAIL LOUD on missing data (no silent pass); the eval golden set MUST include a cold on-the-fly city; surface `unverified_rate` per city as a first-class metric.

## v2.0 scope (bare minimum, grounded)

1. **Compliance:** Foursquare = stored/LLM-fed corpus; Google = display-only. (Unblocks any-city, legally.)
2. **Any-city seeding:** pre-seed the user's city into `places` on profile-location-set (async) + cold-start fallback at generation.
3. **Trustworthy guards:** real proximity + hours, FAIL LOUD on missing data.
4. **Generate simply:** one-tap coherent multi-stop date for the user's city (hardened existing engine).
5. **Improve loop:** swap a stop + NL tweaks, stays coherent.
6. **Eval harness:** deterministic + LLM-judge over a golden set incl. a cold city, in CI.
7. **Sound fits the date:** more tracks + vibe-matched recommendation (sound↔cover cohere via shared vibe — no image ML).
8. **Wire into dating + retire legacy `/create`:** generation becomes THE way to create a night; old manual funnel retired.

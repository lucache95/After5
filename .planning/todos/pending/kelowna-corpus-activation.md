---
created: 2026-06-08
title: Kelowna corpus activation — backfill (Google) + promote drafts → 3x the live pool
area: venue-corpus / places / date-generator
status: DONE (executed autonomously 2026-06-08) — see Outcome below + docs/kelowna-diversity-audit-2026-06-08.md
---

## Outcome (2026-06-08, applied to PROD ufufmcpnysvwtutpbian — all reversible)
- **Live pool 59 → 169** (2.86×). Every live row now has hours + coords.
- Backfilled 41 hours + 10 coords via Google (`scripts/backfill-hours-coords.mjs`);
  the old enrich script never wrote opens/closes/lat/lng.
- Gated promotion: 104 promoted, 4 retail duds rejected (Spades Tactical, Art Knapp,
  Okanagan Garden Centres, Rustic Chalk Decor), 12 held back (no Google hours).
- Dead signals revived: **is_delighter 0 → 48**, food_focused 1 → 25, creative 1 → 13.
- Sunset hole closed: **sunset_spot 0 → 3, viewpoint 1 → 4** (6 lookouts hand-added via
  `scripts/seed-sunset-spots.mjs`); mis-typed experiences retyped out of `shop`.
- Diversity audit: 19/21 supply categories meet target; all 14 demand archetypes ≥10.
  Gaps: walks/waterfront (3/6+), markets/shopping (1/3+). See acquisition backlog.
- Variety test: ~8 distinct structures / 12 dates — generator no longer repetitive.
- Provenance/reversal SQL: `apps/web/scripts/sql/2026-06-08-kelowna-corpus-activation.applied.sql`.
- Spec: `docs/superpowers/specs/2026-06-08-kelowna-corpus-activation-design.md`.

## The opportunity
The curated Kelowna corpus is **179 venues but only 59 are live** — the generator only sees the 59.
The other **120 are fully active, well-formed drafts** (`approval_status='draft'`): every one has
photos, vibe_tags, local_insight, AND coords. They're just never promoted, so the generator ignores
them. Promoting them **3x's the live pool (59 → 179)** using inventory already curated — not new work.

## Two data gaps to close first (both backfillable from Google)
- **53 of the 120 drafts are missing hours.** The hardened `isOpenAt` guard fail-louds on null hours,
  so they'd be excluded until filled.
- **10 of the current 59 live venues have null coords.** The hardened haversine/hop-distance guards
  need coords, so those 10 are effectively dropping out of generation today.
- **Feasibility confirmed (2026-06-08):** ALL gap venues carry a `google_place_id`
  (53/53 missing-hours, 10/10 missing-coords, 120/120 drafts) → Google Places Details can backfill
  every one.

## Decision on data source (user, 2026-06-08)
**Google Maps API is OK for MVP seed/enrichment data.** Caveat (accepted): storing + LLM-feeding
Google content is the exact use the 2026 Maps ToS prohibits — accepted as low-probability risk for a
single-city MVP. Hedges: keep `google_place_id` on every row (already do) for attribution/rebuild;
the Foursquare engine (built this milestone) remains the COMPLIANT path for when After5 scales /
raises / goes multi-city.

## Ready-made tooling (already exists — no new scripts needed)
- `apps/web/scripts/enrich-places.mjs` — pulls Google Place Details (hours, phone, website, rating,
  reviews, photos, weekly hours) for every row with a `google_place_id`. Loads `apps/web/.env.local`
  (which points at **PROD**), auths via `SUPABASE_SECRET_KEY`. Uses the new Google Places v1 API.
- `apps/web/scripts/promote-drafts.mjs` — `--list` (table of pending drafts, no change),
  `--all` (draft→live), `--reject "pattern"` (draft→rejected). Same PROD .env.local + secret-key auth.

## Plan when resumed
1. `node scripts/enrich-places.mjs` → backfills the 53 missing hours + 10 missing coords (it enriches
   all google_place_id rows; safe/idempotent — verify it fills `opens`/`closes`/`lat`/`lng`, not just
   the /places page fields).
2. `node scripts/promote-drafts.mjs --list` → eyeball the 120, optionally `--reject` any duds.
3. `node scripts/promote-drafts.mjs --all` → draft→live. Re-check: 59 → ~179 live, all with
   hours+coords.
4. Spot-check a Kelowna generation for variety; this is the single biggest MVP-city quality upgrade.

## Content gaps activation WON'T fix (hand-add)
Even after promoting the 120 drafts, two real holes remain (full analysis:
`docs/kelowna-taxonomy-and-coverage.md`):

1. **Signature-moment inventory is nearly empty: 0 `sunset_spot`, 1 `viewpoint`.** Sunset is an eval
   criterion + there's a `sunset-date` editorial pack with almost nothing to fill it. Hand-add
   ~10–15 west-facing-over-the-lake spots, tagged `sunset_spot`/`viewpoint`, `is_delighter=true`,
   golden-hour `time_of_day`. Starter list (VERIFY names/access/date-fit before importing; each has a
   Google place_id for enrichment):
   - Lookouts: Knox Mountain (Apex lookout + Paul's Tomb), Dilworth Mountain, Mount Boucherie (WK),
     Kalamoir Regional Park (WK), Bertram Creek area (south Mission).
   - Winery overlooks (sunset + glass = double moment): Mission Hill, Quails' Gate, CedarCreek/Tantalus.
   - Waterfront/beach (west-facing sunset): City Park/Hot Sands + boardwalk & Sails, Tugboat Beach,
     Gyro/Boyce-Gyro (Pandosy), Rotary Beach/Marsh, Waterfront Park + Stuart Park (winter skating).
   - Greenway/nature: Mission Creek Greenway, Knox lower trails.
2. **Two dead experience tags:** `food_focused` (1 venue) and `creative` (1) — re-tag a handful of
   existing venues so "foodie"/"creative" date requests resolve.

## Taxonomy note (don't over-build)
The schema already covers ~7 of ChatGPT's 10 proposed layers (vibe_tags, time_of_day, price_tier,
seasonality, effort/energy, is_delighter, editorial-pack archetypes). Do NOT expand to a 50–100-type
master taxonomy — 179 venues ÷ 100 types ≈ <2/type and the generator couldn't fill slots. `date_stage` (first/second/established) was the last candidate axis — **decided NOT to add it
(2026-06-08).** After5 is a blind-dating marketplace: every night is structurally a first date
between strangers, so date_stage would always be "first date" (it's a relic of the old couples
date-planner). Instead, treat **"first date" as the generator's built-in default optimization
target** — bias toward public + escapable + conversation-friendly + not-too-pricey + one signature
moment; the real variation (chill vs adventurous, budget, time) is already covered by
vibe_tags/budget/time_of_day. So the taxonomy work is effectively zero — it's all content + traffic.
Everything else in the 10-layer model waits on Layer-10 outcome data (which only traffic produces).

## Related
- The any-city cold-start `city_warming` (FSQ quality-floor too strict) is a SEPARATE open item — see
  `phase8-prod-cutover-and-preseed-wiring.md`. With Google now greenlit for seed data, cold cities
  could alternatively be seeded from Google too (vs. relaxing the FSQ floor) — decide at resume.

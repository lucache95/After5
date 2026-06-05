# Venue Data Source — Research (v2.0 AI Date-Planner)

**Researched:** 2026-06-05
**Mode:** Comparison + Feasibility (licensing-led)
**Overall confidence:** HIGH on licensing (official ToS quoted), HIGH on Google pricing, MEDIUM on Foursquare free-tier exact numbers (mid-transition, sources disagree)

---

## Primary Recommendation

**Refute the "scrape any city on the fly" instinct AND refute the "Google Places is the cacheable spine" prior — both have a fatal licensing flaw for the *specific* thing After5 wants to do (store venue content indefinitely in our own `places` table AND feed it to an LLM that generates itineraries).** As of the April 2026 Google Maps Platform terms, Section 3.2.3 says, verbatim, **"Customer will not use Google Maps Content to improve machine learning and artificial intelligence models"** and **"Customer will not create content based on Google Maps Content,"** and only the bare `place_id` is exempt from the no-caching rule. **The After5 pre-seed architecture that already exists on prod (`onthefly.ts` + `google-places.ts`) violates both clauses today:** it persists Google's `displayName`, `formattedAddress`, `rating`, `priceLevel`, `regularOpeningHours`, and a Google `photo_url` indefinitely in `places`, and the planner pipeline feeds that text to Anthropic to write itinerary copy.

The compliant spine is a **two-layer model: build our canonical venue database on Foursquare Places API (which explicitly permits storing/caching place attributes in your own database and using them as you wish) for the durable, LLM-fed `places` rows; keep Google strictly as a live, display-time "details + photo + map" layer keyed by the one field you ARE allowed to store forever — `google_place_id`.** Foursquare becomes the legal source of the *cached, LLM-ingested* venue corpus (name, category, lat/lng, hours, price, popularity); Google (if used at all) is fetched fresh at render time and shown on a Google Map with attribution, never persisted beyond `place_id`, never fed to the model. Do NOT make bespoke scraping the spine: it is the worst licensing posture of the four (it breaks Google/Yelp/TripAdvisor ToS *and* risks CFAA/contract claims), and it is the most brittle. Use OSM/Overpass only as a free coverage *backfill* for geometry/category in thin cities, never as the primary because its venue hours/price/photo/rating density is too sparse for date-planning.

---

## The Licensing Verdict (the make-or-break section)

Legend per capability: **(a)** fetch · **(b)** store/cache in our `places` table indefinitely · **(c)** feed to an LLM to generate an itinerary · **(d)** display name/photo/address/hours to users.

### 1. Google Places API (New) — ❌ ILLEGAL for our core plan (b + c are forbidden)

This is the decisive finding. Google's terms changed and now explicitly block both the caching AND the AI use we depend on.

- **(a) Fetch — ✅ allowed.** Standard API use.
- **(b) Store/cache indefinitely — ❌ NO, except `place_id`.** Per the Places policies page: *"You must not pre-fetch, cache, or store Places API content beyond the allowed exceptions."* The only exception: *"The place ID … is exempt from the caching restrictions. You can therefore store place ID values indefinitely."* Lat/lng may be cached **only up to 30 consecutive calendar days** per the Maps Platform Service-Specific Terms §3.2.3(b). **Name, address, hours, price, ratings, photo references — none may be persisted.** Storing them in `places` (which `google-places.ts → googleResultToPlaceRow()` does today) is a ToS violation.
- **(c) Feed to an LLM — ❌ NO.** §3.2.3 (April 2026): *"Customer will not use Google Maps Content to improve machine learning and artificial intelligence models, including to train, test, validate or fine-tune the models"* and *"Customer will not create content based on Google Maps Content."* Passing Google venue fields into Anthropic to author itinerary hooks/why-it-works copy is squarely "creating content based on Google Maps Content." (Google's *own* Places-grounded Gemini path is the only sanctioned AI route, and its "Grounded Output" also cannot be used to train models or be cached.)
- **(d) Display — ⚠️ allowed ONLY live + on a Google Map + attributed.** *"Places API results displayed on a map must be shown on a Google Map"* with the Google logo and third-party data-provider attributions; photos must show their `authorAttributions`. You cannot show Google-sourced hours/photos rehydrated from your own DB hours later — they must be fetched fresh for display.

**Verdict: Google can be a live display/details/photo layer keyed off a stored `place_id`, and nothing more. It legally cannot be the cached, LLM-fed seed corpus. The existing prod pre-seed is non-compliant and must be re-sourced.**

Sources: [Places API Policies](https://developers.google.com/maps/documentation/places/web-service/policies) · [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id) · [Maps Platform Service-Specific Terms §3.2.3](https://cloud.google.com/maps-platform/terms/maps-service-terms) · [Maps Platform Terms](https://cloud.google.com/maps-platform/terms)

### 2. Foursquare Places API — ✅ THE COMPLIANT SPINE (a, b, c, d all allowed)

Foursquare's developer terms are the inverse of Google's: they are built around the assumption that you store their place data in your own systems and use it commercially. There is **no 30-day cache cap and no AI-training prohibition** equivalent to Google's §3.2.3 for licensed Places customers.

- **(a) Fetch — ✅.** Place Search + Place Details endpoints.
- **(b) Store/cache indefinitely — ✅.** Foursquare's model is explicitly "license the data, store it in your app." This is the differentiator that makes the After5 pre-seed legal.
- **(c) Feed to an LLM — ✅.** Foursquare actively markets Places as data "for AI" (their own positioning: "Location Intelligence for AI"). No clause forbidding LLM ingestion of returned attributes for paid Pro endpoints. (Confirm the *current* signed agreement text at integration time — enterprise contracts can add restrictions.)
- **(d) Display — ✅, attribution required.** Must credit "Powered by Foursquare." No mandatory map-provider lock-in (you can render venues on Mapbox, which After5 already uses).

**Verdict: Foursquare is the one source that legally supports fetch + store-forever + LLM-feed + display. It becomes the canonical `places` corpus.** Caveat: data density (hours/photos) is good in US/major metros, thinner than Google globally — see coverage row.

Sources: [Foursquare Places product](https://foursquare.com/products/places-api/) · [Upcoming Places API changes](https://docs.foursquare.com/developer/reference/upcoming-changes) · [Foursquare pricing](https://foursquare.com/pricing/)

### 3. OpenStreetMap (Overpass / Nominatim) — ✅ legal to store, but share-alike + thin data

- **(a) Fetch — ✅** via Overpass (querying) / Nominatim (geocoding). **But:** the public Overpass/Nominatim endpoints have a strict fair-use policy and **forbid bulk/heavy automated use** — pre-seeding cities through the free public servers will get you rate-limited or blocked. You must self-host Overpass or use a planet extract (Geofabrik) for real pre-seeding.
- **(b) Store/cache indefinitely — ✅.** ODbL explicitly permits storing, modifying, and commercial use of the data.
- **(c) Feed to an LLM — ✅.** No AI prohibition. (Be aware: a *produced database* derived from OSM may itself be "Derivative" and carry share-alike obligations — see risk.)
- **(d) Display — ✅ with attribution.** Must credit "© OpenStreetMap contributors" and link `openstreetmap.org/copyright`. **Share-alike trap:** ODbL §4.4 ("produced works") means if your `places` table is a *substantial* extract/derivative of the OSM database, you may be obliged to publish that derived database under ODbL. For a date-app this is usually managed by treating OSM data as one input among many and only publishing produced *works* (the itinerary), not the DB — but it's a real compliance question for a venue DB built primarily on OSM.
- **Data quality reality:** OSM has lat/lng + category + name reliably; **opening hours, price level, photos, and ratings/popularity are sparse and inconsistent** outside dense European metros. Insufficient as a *primary* for date-planning where "is it open at 8pm, is it $$ or $$$, show me a photo" matters.

**Verdict: legal and free, but a coverage/quality backfill — not the spine.** Best use: fill lat/lng + category for venues in thin cities, or cross-reference, never the sole source of the LLM-fed corpus.

Sources: [OSM Copyright/License](https://www.openstreetmap.org/copyright) · [OSMF Licence FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ) · [Overpass API wiki](https://wiki.openstreetmap.org/wiki/Overpass_API)

### 4. Bespoke web scraping (Firecrawl / scraping Google Maps, Yelp, TripAdvisor) — ❌ DO NOT (worst legal posture)

- **(a) Fetch — ⚠️ technically possible, contractually prohibited.** Scraping Google Maps results violates Google ToS; scraping Yelp/TripAdvisor venue pages violates their ToS and robots directives. Scraping the Google Places *API* response and re-storing it is the §3.2.3 violation above by another name.
- **(b)(c)(d) — ❌.** Even where scraping public web pages is not itself unlawful (the legal landscape post-*hiQ v. LinkedIn* is nuanced and US-specific), the *named* sources a date-app would scrape (Google/Yelp/TripAdvisor) all prohibit it by contract, and re-publishing their venue content (name/photo/hours/reviews) to your users invites takedowns, account bans, and copyright/DB-right claims on photos.
- **Brittleness:** layout changes break scrapers constantly; you inherit an unbounded maintenance + anti-bot arms race; per-city pre-seeding at scale is exactly the pattern anti-scraping systems flag.

**Verdict: rejected. Highest legal risk, highest brittleness, no upside over Foursquare.** Firecrawl is fine for *one-off* enrichment of a venue's *own official website* (e.g. a restaurant's own menu/hours page, which the business publishes for that purpose) — not for building the venue corpus.

Sources: [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms) · [Places API Policies](https://developers.google.com/maps/documentation/places/web-service/policies)

---

## Comparison Table

| Source | (b) Store forever? | (c) LLM input? | (d) Display | Data quality for dating | Cost @ our scale | Coverage | Freshness |
|---|---|---|---|---|---|---|---|
| **Google Places (New)** | ❌ `place_id` only; content ≤30d (lat/lng), else no | ❌ **forbidden (§3.2.3)** | ⚠️ live, on Google Map, attributed | ★★★★★ best hours/price/photos/ratings | ~$32/1K Text Search (Pro), 5K free/mo; Details ~$17/1K | ★★★★★ global | live only |
| **Foursquare Places** | ✅ **yes** | ✅ **yes** | ✅ attributed, any map | ★★★★ strong categories, hours, popularity, price | ~$15/1K Pro (CPM) post-Jun 2026; free credits in flux | ★★★★ strong US/metros, good global | refresh on cadence |
| **OSM (Overpass/Nominatim)** | ✅ yes (ODbL) | ✅ yes | ✅ attributed | ★★ lat/lng+category solid; hours/price/photos sparse | free (self-host for bulk) | ★★★ dense in EU, patchy elsewhere | community edits |
| **Bespoke scraping** | ❌ ToS breach | ❌ ToS/copyright | ❌ | varies, unreliable | dev time + anti-bot tax | varies | brittle |

---

## Cost Estimate — the pre-seed-a-city model

**Current prod fetch shape (from `onthefly.ts`):** 5 Text Search calls per cold city (`cafe/restaurant/bar/activity/park`), `maxResultCount: 20`, Pro-tier field mask (includes `rating`, `priceLevel`, `regularOpeningHours`, `photos` → this is the **Pro** SKU, not Basic). No Place Details calls (good — avoids a second SKU). Cold-threshold gate (`COLD_THRESHOLD = 12`) means one paid warm per city, then free reuse.

**If kept on Google Text Search (Pro ≈ $32/1K, 5,000 free Pro calls/month):**
- Per cold city = 5 calls = **$0.16**, or free within the 5,000/mo allowance.
- 5,000 free Pro calls ÷ 5 = **~1,000 new cities/month free**, then $0.16/city.
- 10,000 user-cities/month ≈ 5,000 billable calls ≈ **~$160/mo** — trivial cost.
- **BUT this is the illegal path** (stores content + feeds LLM). Cost is not the constraint; licensing is.

**Foursquare spine (recommended), post-Jun-2026 pricing (~$15/1K Pro CPM, free credit in transition):**
- Pre-seed a city with ~5 category searches + N Place Details for the venues you keep (say 40 venues kept/city → ~45 calls) = **~$0.68/city** at $15/1K, before free credits.
- At 10,000 user-cities/month worst case (every user a brand-new city, which won't happen — cities are shared and cached): ~450,000 calls ≈ **~$5,000/mo** at full rate. Realistically cities are heavily shared, the cold-threshold gate fires once per city, and the actual unique-city count is in the low hundreds/month early → **<$200/mo** at real early scale.
- **Free credits:** sources conflict (legacy "$200/mo credit + 10K free Pro" vs. new "500 free Pro calls/mo" from Jun 1 2026). **Confirm the live free allowance at signup** — this materially changes early-stage cost. (MEDIUM confidence.)

**Net:** at After5's stage, venue-API cost is negligible either way (<$200/mo). **The decision is 100% licensing-driven, not cost-driven.** Don't let a "Google is cheap" argument override the ToS reality.

---

## Recommended Ingestion Architecture (against the existing `places` table)

The good news: the existing schema barely changes. `places` already has `google_place_id`, `source ∈ (curated|discovered|warmed)`, `city_id`, `approval_status`, `discovered_at`. We re-point the *fetcher*, add a provider-id column, and split "store" from "display."

**1. Canonical corpus = Foursquare (store + LLM-feed layer).**
- Add `places.fsq_place_id text` (+ unique partial index, mirroring the existing `google_place_id` one) and `places.source` gains `'foursquare'`.
- Replace `searchText()/googleResultToPlaceRow()` internals with a Foursquare Place Search + Details mapper that fills the SAME columns (`name, address, lat, lng, type, price_tier, opens/closes, photo_url, quality_score`). Keep `mapGoogleTypes`-style category mapping but for FSQ categories.
- These rows are what the planner pipeline (`runPipeline`) reads and what gets fed to Anthropic. **Legal**, because Foursquare permits store + AI use.

**2. Google = live display-only layer, keyed by stored `place_id`.**
- Keep `google_place_id` ONLY as the join key (storing it forever is explicitly allowed). Optionally backfill it on Foursquare rows via a single Text-Search match so we can show a Google Map + fresh Google photo when the user opens a venue detail.
- **Never persist Google name/hours/photo into `places`.** At venue-detail render time, if we want Google's richer photo/hours, fetch fresh via Place Details on the stored `place_id`, render on a Google Map with attribution, discard after the response. This is the only compliant Google use.
- **Migration cleanup:** the rows currently warmed from Google (`source='discovered'`, Google content in `name/address/photo_url`) are non-compliant. Re-warm those cities from Foursquare and overwrite, or relabel + stop using Google content as LLM input.

**3. When to fetch (unchanged trigger model, compliant source).**
- **Pre-seed (async background job):** on profile-location-set, enqueue a `warm_city` job → Foursquare category searches → upsert `places` (`onConflict: fsq_place_id`, `ignoreDuplicates`). Same cold-threshold gate (`< 12 usable` → warm; else skip) keeps repeat cities free.
- **Cold-start fallback (generation time):** if a user generates in an unseeded city, run the same warm inline before `runPipeline` (this is exactly today's `OnTheFlyProvider`, just sourced from Foursquare).

**4. Store vs. reference-only.**
| Field | Store in `places`? | Why |
|---|---|---|
| Foursquare name, address, lat/lng, category→type, price, hours, popularity, photo ref | ✅ store | Foursquare permits it; this is the LLM-fed corpus |
| `fsq_place_id`, `google_place_id` | ✅ store (both are stable join keys) | place_id storage is explicitly allowed by Google; FSQ id is yours |
| Google name/hours/rating/photo bytes | ❌ never persist | §3.2.3 caching ban; fetch live at display only |

**5. Staleness / freshness.**
- Add/keep `places.refreshed_at` (rename/extend `discovered_at`). TTL the Foursquare corpus: re-fetch a venue's hours/price/`businessStatus` when `refreshed_at > 90 days` OR when it's about to be used in a generated itinerary and is stale. Drop/flag venues Foursquare reports closed.
- Google display data is always fresh by construction (fetched live), so no staleness there.
- Cheap nightly job: re-validate the top-N most-used venues per active city rather than the whole table.

---

## Risks / Pitfalls

- **CRITICAL — existing prod is non-compliant.** `google-places.ts` + `onthefly.ts` store Google content (`displayName`, `formattedAddress`, `regularOpeningHours`, `priceLevel`, Google `photo_url`) in `places` and the planner feeds it to Anthropic. This breaks Google's no-cache rule AND the §3.2.3 AI/"create content based on Google Maps Content" ban. **Re-sourcing the corpus to Foursquare is the v2.0 blocker, not an enhancement.** Treat as a P0 compliance item.
- **Foursquare free-tier ambiguity (MEDIUM).** Sources disagree: "$200/mo credit + 10K free Pro calls" (legacy) vs. "500 free Pro calls/mo" effective Jun 1 2026. Verify live allowance + per-call CPM in the signed terms before committing the cost model. Legacy V3 endpoints deprecate **May 15 2026** — build on the new Places API only.
- **Foursquare data density.** Hours/photos thinner than Google outside US metros. Mitigate with the Google live-display layer (compliant) for photos/hours at render time, and OSM lat/lng backfill for thin cities.
- **Google photo display still needs a Google Map.** If you show a Google-sourced photo you trigger the "must display on a Google Map + Google logo + authorAttributions" obligations. If you don't want Google branding in the dating UI, use Foursquare/Mapbox photos and skip Google display entirely.
- **OSM share-alike (ODbL §4.4).** A `places` DB built *primarily* from OSM can become a "Derivative Database" you must publish under ODbL. Keeping OSM as a minority backfill input and only publishing produced *works* (itineraries) avoids this; document the call.
- **Scraping temptation.** The founder's "scrape any city" instinct is the highest-risk option (ToS + copyright + CFAA-adjacent + brittleness) with zero cost advantage over Foursquare. Reserve Firecrawl for scraping a venue's *own* official site for enrichment, never Google/Yelp/TripAdvisor.
- **Attribution debt.** Whatever the spine, ship the required attribution ("Powered by Foursquare" / "© OpenStreetMap contributors" / Google logo) before launch — retrofitting it after users see venues is a compliance gap.
</content>
</invoke>

# After5 — Venue & Experience Taxonomy: Reality vs. the 10-Layer Model (2026-06-08)

Written by Claude, grounded in the live prod corpus + the deployed generator code. Companion to
`date-generator-state-report.md`. Purpose: answer "what are all the types of places/experiences for
Kelowna?" with what *actually exists*, and give an honest read on the proposed 10-layer master
taxonomy before any more generator modeling happens.

---

## TL;DR (the one thing that matters)

ChatGPT's prior message warned: *"do this exercise before adding more generator complexity."* Its next
message then proposed a **master taxonomy of 50–100 venue types, 30–50 experience types, 20–30
signature moments…**. Those two messages point in opposite directions, and the data resolves the
tension clearly:

1. **You already have ~90% of the 10-layer model** — most layers are existing columns, not missing
   features. You don't need to *build* a taxonomy; you have one.
2. **A 50–100-type taxonomy is the wrong move for a 179-venue corpus.** 179 venues ÷ 100 types ≈
   **under 2 venues per type** → the generator literally couldn't fill a slot. Taxonomy granularity
   has to match corpus size. At 19 types you're at ~9 venues/type, which is workable. **More types
   would make generation worse, not better.**
3. **The real levers are content + traffic, not taxonomy depth:** activate the drafts, add the
   missing sunset/viewpoint inventory, then run the marketplace so Layer 10 (outcome data) — the
   only layer that's an actual moat — starts filling. The other 9 layers are inputs you already
   model; Layer 10 is the output you can't fake and can't get without users.

**Recommendation: do NOT expand the taxonomy now. Add at most two cheap axes (below) if they're
free, fix the content gaps, ship, and let outcome data earn the right to a deeper taxonomy later.**

---

## What After5 already has (the real taxonomy)

**Venue types (19):** `restaurant, cafe, winery, brewery, cocktail_bar, bakery, dessert, ice_cream,
hike, walk, park, garden, beach, viewpoint, sunset_spot, gallery, market, shop, activity` + an
`at_home` flag.

**Experience axis — `vibe_tags` (already the thing ChatGPT calls "more important than venue type"):**
`chill, casual, fun, unique, romantic, adventurous, lively, cozy, intimate, boujee, cultural,
spontaneous` (+ near-unused `food_focused`, `creative`).

**Other per-venue axes already stored:** `time_of_day`, `price_tier` ($–$$$$), `seasonality`,
`effort`, `energy`, `weather_dependent`, `pairing_tags`, `is_delighter` (a "wow" flag).

**Assembled archetypes (editorial packs, 7):** sunset-date, classic-done-right, adventure-date,
morning-after, off-beaten-path, underrated-tuesday, date-night-in-out. Plus templates + a
"must-include type" satisfier + WOW_TYPES boosting (`viewpoint, sunset_spot, winery, hike, beach`).

So the generator **already selects combinations of experiences, not raw places** — the premise of
ChatGPT's argument is already true in the code.

---

## ChatGPT's 10 layers, mapped to reality

| Layer | After5 status | Notes |
|---|---|---|
| 1. Human intent (date stage) | **MISSING** | No `date_stage` (first/second/established). The one genuinely new, arguably-cheap axis. |
| 2. Emotional outcome | **HAVE** (partial) | `vibe_tags` covers most (romantic/playful/cozy/adventurous/cultural…). `flirty/nostalgic/intellectual` not tagged. |
| 3. Date archetypes | **HAVE** (implicit) | Editorial packs = archetypes (sunset/wine/adventure/morning-after…). Not a first-class user-facing field. |
| 4. Venue categories | **HAVE** | 19 types. ChatGPT's sub-splits (sushi/italian/speakeasy…) are finer than a 179-venue corpus can support. |
| 5. Signature moments | **HAVE** (implicit) | `is_delighter` + WOW_TYPES + `sunset_spot`/`viewpoint`. Not an explicit `signature_moment` enum. |
| 6. Conversation dynamics | **HAVE** (proxy) | `effort` + `energy` per venue approximate conversation-heavy vs activity-heavy. |
| 7. Time of day | **HAVE** | `time_of_day` column + template time logic. |
| 8. Weather modes | **PARTIAL** | `weather_dependent` boolean only — no live forecast. (Cheap Tier-3 win: add a weather API.) |
| 9. Seasonality | **HAVE** | `seasonality` + season-from-month + `photo_season`. |
| 10. Outcome data (moat) | **INSTRUMENTED, needs traffic** | saves/matches/ratings/reliability/date_instances all exist. The only real moat — and only users fill it. |

**Verdict:** 7 of 10 layers fully present, 2 partial, 1 missing. This is not a system that needs a
taxonomy rebuild. It needs content and traffic.

---

## Kelowna coverage map (live now → after activating the 120 drafts)

| ChatGPT building block | Type(s) | Live | +Draft | Read |
|---|---|---|---|---|
| Wine & tasting | winery | **10** | 17 | Strong — your superpower, already live |
| Food | restaurant | 9 | 17 | Solid |
| Coffee & conversation | cafe | 5 | 12 | OK; deepens with drafts |
| Beer / cocktails | brewery + cocktail_bar | 7 | 26 | Thin live, big draft reserve |
| Adventure activities | activity | 13 | **55** | Huge draft reserve |
| Walks / parks | walk + park + garden | 5 | 16 | Parks nearly all in draft (1 live / 11 draft) |
| Lakeside / beach | beach | 2 | 4 | Thin |
| Dessert | dessert + ice_cream + bakery | 3 | 9 | Mostly in draft |
| Arts & culture | gallery + market | 0 | 6 | **0 live** |
| Shopping | shop | 0 | 10 | **0 live** |
| **Sunset / viewpoint** | sunset_spot + viewpoint | **1** | **1** | ⚠️ Real content gap |

Two dead experience tags: `food_focused` (1 venue), `creative` (1) — "foodie" and "creative" date
requests have almost nothing to match on.

---

## The real gaps + what to do

1. **Activate the 120 drafts** (tabled — see `kelowna-corpus-activation.md`). Fills most thin
   categories: activities 13→55, parks 1→12, cocktail bars 4→18, galleries 0→5, dessert 0→2,
   shops 0→10. Biggest single quality upgrade, using inventory you already curated.
2. **Hand-add sunset/viewpoint inventory** (starter list below). This is the "signature moment"
   category ChatGPT rightly flags, and it's nearly empty (0 `sunset_spot`, 1 `viewpoint`).
3. **Re-tag a handful of venues `food_focused` / `creative`** so those experience requests resolve.
4. **Optional, only if cheap:** add a `date_stage` axis (Layer 1) — the one genuinely missing piece.
   Defer everything else in the 10-layer model until outcome data justifies it.

Explicitly **don't**: expand to 50–100 venue types, add 20–30 signature-moment enums, or model
weather modes / conversation dynamics as new tables right now. The corpus is too small to support the
granularity, and none of it changes the MVP question (*will people match around a night?*).

---

## Sunset / viewpoint starter list (verify before adding)

West-facing over Okanagan Lake = the sunset moment. These are well-known Kelowna spots to seed as
`sunset_spot` / `viewpoint` (each will have a Google `place_id` for enrichment — **verify names,
access, and that they're date-appropriate before importing; this is a starting point, not gospel**):

**Elevated viewpoints / lookouts**
- Knox Mountain Park — Apex lookout + Paul's Tomb trail (summit lake views, classic sunset)
- Dilworth Mountain lookout (city + lake panorama)
- Mount Boucherie (West Kelowna, vineyard + lake views)
- Kalamoir Regional Park (West Kelowna, west-shore lake bluffs)
- Bertram Creek / Bestwine area lookouts (south Mission)

**Winery overlooks (sunset + a glass = double signature moment)**
- Mission Hill Family Estate (terrace/bell-tower overlook)
- Quails' Gate (patio over the lake)
- CedarCreek / Tantalus area terraces

**Waterfront / beach (west-facing sunset over the lake)**
- City Park / Hot Sands Beach + the downtown boardwalk & Sails
- Tugboat Beach (next to the marina)
- Gyro Beach & Boyce-Gyro (Pandosy)
- Rotary Beach / Rotary Marsh
- Waterfront Park boardwalk + Stuart Park (skating in winter — seasonal signature)

**Greenway / nature**
- Mission Creek Greenway (golden-hour walk)
- Knox Mountain lower trails (easy, conversation-friendly)

Target ~10–15 of these, tagged `sunset_spot`/`viewpoint`, with `is_delighter=true` and a
golden-hour `time_of_day`, so the `sunset-date` pack and WOW_TYPES boosting have real inventory.

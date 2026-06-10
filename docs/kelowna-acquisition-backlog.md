# Kelowna Venue-Acquisition Backlog (prioritized)

Standing shopping list of what to add next, derived from the diversity audit
(`docs/kelowna-diversity-audit-2026-06-08.md`). Ordered by **first-date value ×
gap size**. This is the ranked input for a *future* bounded discovery pass — not
scraped yet. Nothing here blocks the marketplace; the activated 169-venue pool is
already varied enough to run.

Status legend: 🔴 below target · 🟡 at floor / thin · 🟢 future upside.

---

## ✅ P0 — DONE (2026-06-09 post-audit pass)

Of the 12 held drafts: **8 promoted** with estimated typical hours (S&J
Paddleboard, Pottery at Studio 108, Okanagan Lavender, Black Box Theatre, Island
Stage [summer], Wine Country Studios, Balkanagan food truck, Inspire Trail
Riding); **4 rejected** on date-fit (Viewpoint Drive — a residential street;
Rutland Arena — hockey rink, events tier; Revelry — nightclub; Little Kitchen
Academy — kids' cooking school). Draft queue is now empty.

---

## P1 — Below-target categories (audit GAPs)

### ✅ Walks / waterfront routes — DONE (2026-06-09): 3 → 7, target 6+ met
Mission Creek Greenway retyped `park`→`walk`; seeded Gellatly Bay Recreational
Trail, Rotary Marsh Park Loop, Abbott Street Heritage Walk. Remaining candidates
if more depth is wanted: Downtown Boardwalk loop as its own row, Knox Apex Road
easy loop.

### ✅ Markets / shopping / bookstores — DONE (2026-06-09): 1 → 3, target met
Seeded **Mosaic Books** (411 Bernard) and **Milkcrate Records** (527 Lawrence)
alongside the existing Farmers' & Crafters' Market. Note: "Kelowna Night Market"
shares its Google listing with the farmers' market society — there is no separate
venue; night-market *events* belong in P3.

### 🟡 Live music / comedy venues — 3 (at floor)
- Doc Willoughby's / live-music pubs, Yamas/Helen's-style acoustic nights,
  Kelowna Actors Studio. (Recurring *events* → P3.)

### 🟡 Mini golf / driving range — 2 (at floor)
- Wild Play / Scandia already in; add a seasonal outdoor mini-golf if one exists.

---

## P2 — Net-new novelty (deferred DISCOVERY targets)

**2026-06-09: top two landed via bounded named adds** (seed-gap-fills.mjs):
✅ **Kelowna Floating Sauna** (3762 Lakeshore Rd — live, `is_delighter=true`) and
✅ **Rusty's Sports Lounge** (Dilworth — billiards/pool). Remaining targets below
still need an active find/scrape pass (Google or Foursquare), gated through the
same enrich → completeness → promote pipeline:
- **Indoor climbing/bouldering socials**, indoor skydiving, trampoline park
- **Curling / public skating** (winter signature; MNP Place hosts some)
- **Hot-air balloon / e-bike wine tours / boat rentals** (premium delighters)
- **U-pick orchards & lavender** beyond Hayat/Indigo Ridge (seasonal)

When this runs, bound it to a named list (≈10–20) — do **not** open-ended scrape.

---

## P3 — Future Tier-1 Expansion: live events (NOT MVP)

Potentially the biggest later unlock — events create unique, non-repeating dates,
but they're ephemeral (not `places` rows) and need a different data model + feed:

- Friday Night Market · comedy shows · outdoor concerts / Parks Alive! ·
  wine & food festivals · live jazz nights · farmers' markets · winery concert
  series · seasonal (Light Up, skating, festivals).

Defer until the marketplace has traffic and outcome data justifies the new
ingestion path.

---

## Deprioritized (intentionally not pursuing for MVP)

- **Clubs / nightclubs / loud nightlife** — weak blind-first-date fit (a first
  date wants conversation, movement, shared experience — not yelling over music).
- **General retail / home & garden stores** — rejected from this pass
  (Art Knapp, Okanagan Garden Centres, Rustic Chalk Decor, Spades Tactical).

---

## How to read priority

The marketplace, not this list, ultimately decides what's valuable — once dates
are being completed and rated, Layer-10 outcome data will re-rank these. Until
then: clear P0 (free), fix P1 walks (cheapest variety win), and let traffic earn
the right to P2/P3.

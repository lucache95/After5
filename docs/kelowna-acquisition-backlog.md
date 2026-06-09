# Kelowna Venue-Acquisition Backlog (prioritized)

Standing shopping list of what to add next, derived from the diversity audit
(`docs/kelowna-diversity-audit-2026-06-08.md`). Ordered by **first-date value ×
gap size**. This is the ranked input for a *future* bounded discovery pass — not
scraped yet. Nothing here blocks the marketplace; the activated 169-venue pool is
already varied enough to run.

Status legend: 🔴 below target · 🟡 at floor / thin · 🟢 future upside.

---

## P0 — Quick wins (already curated, just blocked)

**12 curated drafts are held back only because Google had no structured hours.**
Add hours (manually or a second source) → they promote straight into live:

- S & J Daily Paddleboard Rentals · Kelowna Pottery at Studio 108 · Little Kitchen
  Academy Kelowna (cooking class) · Okanagan Lavender & Herb Farm · Indigo Ridge
  (if not live) · Black Box Theatre · Island Stage · Mary Irwin-adjacent venues ·
  Revelry · Rutland Arena · Wine Country Studios · Balkanagan Kitchen (food truck)
  · Inspire Trail Riding Ranch · "Viewpoint Drive"

These directly feed thin categories (paddle, creative/pottery, live-performance).

---

## P1 — Below-target categories (audit GAPs)

### 🔴 Walks / waterfront routes — 3 / target 6+ (HIGHEST LEVERAGE)
Walks are in nearly every date; thin walk inventory = repetitive "→ walk →"
middle. Add as dedicated `walk` rows (several already exist as `park`):
- Downtown Waterfront Boardwalk (Tugboat → Sails → Stuart Park loop)
- Mission Creek Greenway — full route as a *walk* (currently a `park`)
- Knox Mountain lower / Apex Road easy loop (conversation-friendly)
- Pandosy / Abbott Street Heritage walk (character homes)
- Rotary Marsh + Waterfront Park boardwalk
- Gellatly Bay waterfront walk (West Kelowna)

### 🔴 Markets / shopping / bookstores — 1 / target 3+
- Mosaic Books (downtown indie bookstore — strong rainy-day date)
- Kelowna Night Market (seasonal) / Lakeshore or Westbank markets
- A browsable record/vintage shop (e.g. Milkcrate Records)

### 🟡 Live music / comedy venues — 3 (at floor)
- Doc Willoughby's / live-music pubs, Yamas/Helen's-style acoustic nights,
  Kelowna Actors Studio. (Recurring *events* → P3.)

### 🟡 Mini golf / driving range — 2 (at floor)
- Wild Play / Scandia already in; add a seasonal outdoor mini-golf if one exists.

---

## P2 — Net-new novelty (deferred DISCOVERY targets)

The genuinely-missing long-tail that promotion can't surface — these need an
active find/scrape pass (Google or Foursquare), gated through the same
enrich → completeness → promote pipeline:

- **Floating sauna** on Okanagan Lake (these exist — high "wow"/delighter value)
- **Pool hall / billiards** (no dedicated billiards venue in the corpus)
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

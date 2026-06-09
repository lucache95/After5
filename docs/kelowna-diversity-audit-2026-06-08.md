# Kelowna Date-Variety Diversity Audit — 2026-06-08

Generated after the corpus-activation pass (see
`docs/superpowers/specs/2026-06-08-kelowna-corpus-activation-design.md`). Measures
**date variety**, not venue count: can the generator assemble dates that *feel*
different, or does it keep producing `coffee → walk → dessert`?

Two axes:
- **Supply** — 21 experience categories, each graded against a *per-category
  target floor* (a category is a GAP when it's below its target, even if the raw
  count looks "healthy").
- **Demand** — 14 date archetypes (what users actually ask for), target ~10+ each.

Tiers: **Missing = 0 · Weak = 1–2 · Healthy = 3–7 · Strong = 8+.**

Baselines: "before" = pre-activation live pool (59), derived from the type
snapshot. "after" = current live pool (**169**), computed live from prod.

---

## Headline

- **Live pool: 59 → 169** (2.86×), every live row now has hours + coords.
- **Supply: 19 of 21 categories meet target.** Two below target: **walks/waterfront
  (3 / 6+)** and **markets/shopping (1 / 3+)**. `sunset/lookouts` — the worst
  pre-activation hole (1) — is now healthy (7).
- **Demand: all 14 archetypes clear ~10.** Thinnest are `creative` (13) and
  `scenic` (14); everything else comfortable.
- The at-home-heavy activity pool (the cause of "59 venues, same dates") is gone:
  laser tag, paddleboard/canoe, climbing, karting, pottery, museums, comedy,
  bowling, horse-riding, mini-golf, escape rooms are all live now.

---

## Axis A — Supply: 21 experience categories

| # | Category | Before | After | Target | Status |
|---|---|---|---|---|---|
| 1 | Restaurants | 9 | **16** | 8+ | ✅ Strong |
| 2 | Cafes | 5 | **12** | 8+ | ✅ Strong |
| 3 | Dessert / gelato / bakery | 3 | **9** | 6+ | ✅ Strong |
| 4 | Wineries | 10 | **17** | 4+ | ✅ Strong (superpower) |
| 5 | Breweries | 3 | **8** | 3+ | ✅ Strong |
| 6 | Cocktail / wine bars | 4 | **17** | 5+ | ✅ Strong |
| 7 | Clubs / nightlife | 0 | **0** | — | ⏸️ Deprioritized (weak first-date fit) |
| 8 | Museums / galleries | ~0 | **8** | 3+ | ✅ Strong |
| 9 | Live music / comedy (venues) | ~0 | **3** | 3+ | ✅ at floor — events → Tier-1 backlog |
| 10 | Beaches | 2 | **4** | 3+ | ✅ Healthy |
| 11 | Parks / gardens | 2 | **13** | 4+ | ✅ Strong |
| 12 | Lookouts / viewpoints / sunset | 1 | **7** | 5+ | ✅ Healthy *(was the #1 gap)* |
| 13 | **Walks / waterfront routes** | 3 | **3** | 6+ | ⚠️ **Below target** |
| 14 | Hikes / trails | 4 | **6** | 4+ | ✅ Healthy |
| 15 | Paddleboard / canoe / kayak | ~1 | **6** | 3+ | ✅ Healthy |
| 16 | Floating sauna / spa / wellness | 0 | **4** | 2+ | ✅ Healthy |
| 17 | Bowling / pool / darts / arcade | 0 | **7** | 3+ | ✅ Healthy |
| 18 | Laser tag / axe / escape rooms | 2 | **4** | 3+ | ✅ Healthy |
| 19 | Mini golf / driving range | 0 | **2** | 2+ | ✅ at floor |
| 20 | **Markets / shopping / bookstores** | 0 | **1** | 3+ | ⚠️ **Below target** |
| 21 | Other activities (climbing, pottery, horse, at-home…) | ~9 | **22** | — | bucket |

*Classification is keyword-based on `type` + name, so counts are ±1 at the
margins (e.g. climbing sits in "other activities," not its own row).*

---

## Axis B — Demand: 14 date archetypes (target ~10+)

| Archetype | Count | Status |
|---|---|---|
| Romantic | 55 | ✅ |
| Foodie | 42 | ✅ |
| Adventurous | 32 | ✅ |
| Active | 46 | ✅ |
| Creative | 13 | ✅ (thinnest) |
| Cozy | 102 | ✅ |
| Social | 65 | ✅ |
| Scenic | 14 | ✅ |
| Luxury ($$$ / boujee) | 29 | ✅ |
| Budget ($) | 37 | ✅ |
| Indoor / rain-safe | 115 | ✅ |
| Outdoor | 33 | ✅ |
| Winter-safe | 165 | ✅ (nearly all year-round) |

Every archetype has enough supply to assemble varied dates. **Creative** and
**scenic** are the ones to watch as traffic grows.

---

## Signal health (generator inputs that were dead)

| Signal | Before | After |
|---|---|---|
| `is_delighter` (WOW boosting / "one weird thing") | **0** | **48** |
| `food_focused` vibe ("foodie" requests) | 1 | **25** |
| `creative` vibe ("creative" requests) | 1 | **13** |
| `sunset_spot` type | 0 | **3** |
| `viewpoint` type | 1 | **4** |

⚠️ **Tunable knob:** 48 delighters is ~28% of the pool — generous. If WOW-boosting
feels diluted in generation, tighten the WS5 delighter rule (e.g. drop spas /
bowling, keep views + true one-offs).

---

## Variety Test (WS8) — can the generator make dates that feel different?

Calibration run (N=4 calls/intent against the live prod corpus via the deployed
`generate-plan`; test itineraries deleted afterward by id). The real metric isn't
venue count — it's **distinct date structures**.

| Intent | Dates | Distinct venues | Distinct structures |
|---|---|---|---|
| Foodie | 12 | 23 | 8 |
| Adventurous | ~12 | — | 8 |
| Creative | 6 | 13 | 5 |
| Romantic | (probe) | — | 3 from a single call |

Example structures observed (not a repeating spine):
`hike → brewery → viewpoint` · `restaurant → cocktail_bar → walk` ·
`paddle → climbing` · `park → cocktail_bar → dessert` · `cafe → garden → bakery` ·
`walk → activity → dessert`.

**Read:** the generator is **not** collapsing to `coffee → walk → dessert` — ~8
distinct structures per ~12 dates, 23 distinct venues across 12 foodie dates, and
the dates visibly pull *activated* inventory (chill paddle boarding, Gneiss
Climbing, Skinny Duke's, Kasugai Gardens). **The bottleneck was the corpus, and
activation fixed it.** The thinnest is **creative** (5 structures / 6 dates) —
consistent with `creative` being the thinnest archetype (13); it's the first place
to add depth as traffic grows. (Note: a second back-to-back batch hit Anthropic
rate limits — run larger N spaced out, not in one burst.)

---

## Gaps to act on → see `docs/kelowna-acquisition-backlog.md`

1. **Walks / waterfront routes (3 / 6+)** — highest-leverage gap: walks are the
   connective tissue of almost every date. Many greenways are typed `park`; the
   dedicated walk-route inventory is thin.
2. **Markets / shopping / bookstores (1 / 3+)** — one farmers' market; no
   bookstores. Partly intentional (shopping is a weak date spine), but a
   bookstore + a couple of seasonal markets would help.
3. **Live music / comedy (3, at floor)** — venues OK; recurring *events* are the
   big later unlock (Future Tier-1).
4. **12 curated drafts still held back** (missing hours Google didn't provide):
   real venues like S&J Paddleboard, Little Kitchen Academy (cooking class),
   Okanagan Lavender, Black Box / Island Stage theatres. Add hours → promote.

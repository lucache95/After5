# Kelowna Corpus Activation — Design Spec

**Date:** 2026-06-08
**Area:** venue-corpus / places / date-generator
**Source todo:** `.planning/todos/pending/kelowna-corpus-activation.md`
**Companion analysis:** `docs/kelowna-taxonomy-and-coverage.md`
**Status:** Design approved (brainstorming), pending user review before writing-plans.

---

## Guiding philosophy (the order of operations)

This is **marketplace-first, not engine-first.** We are not pausing to build a global
date engine. We are making sure Kelowna has *enough date variety that the generator
doesn't feel repetitive* while we go get the thing that actually matters: real users,
matches, chats, dates, ratings, and completion data. The marketplace is what tells us
which categories are valuable — outcome data (Layer 10) is the only real moat, and only
traffic produces it.

The generator only needs to be **good enough to support the marketplace right now.**

The failure this design prevents: celebrating "179 venues" while still generating

```
coffee → walk → ice cream
coffee → walk → wine
coffee → walk → dinner
```

over and over. **Venue count is a vanity metric. The real question is: can the generator
create 100 dates that feel different?** This spec is built around answering that, not
around inflating a row count.

---

## Goal

Triple the live generator pool (59 → ~179) using inventory **already curated**, close the
real signature-moment content hole, fix dead generation signals, and — critically —
**measure date variety across experience categories and date archetypes** so we know
exactly where Kelowna is still repetitive and what to acquire next.

## Scope

Strictly `places`-table **data + tagging**. This pass:

- Backfills missing hours/coords from Google.
- Promotes the qualifying curated drafts to live.
- Hand-adds ~10–15 sunset/viewpoint spots (the one genuinely empty category).
- Backfills `is_delighter` and re-tags dead experience tags (`food_focused`, `creative`).
- Runs a **two-dimension diversity audit** + produces a **prioritized acquisition backlog**.
- Runs a **Date Generation Variety Test** to validate the generator isn't repetitive.

### Explicitly OUT of scope (decided 2026-06-08)

- **No schema changes.** No `date_stage` (every After5 night is structurally a blind first
  date — the axis would always be "first date"). No `signature_moment` enum (179 venues is
  too small to support more axes; "signature moment" is represented by existing
  `is_delighter` + `sunset_spot`/`viewpoint` types).
- **No generator code changes, no creation-flow changes.** Fully independent of the
  date-customization canvas — shares no code, touches only `places` rows. Non-blocking.
- **No scraping/discovery this pass.** Net-new venue discovery (floating sauna, pool hall,
  etc.) is deferred to a *future* bounded pass; this pass only produces the backlog that
  prioritizes it.
- **No FSQ pull.** Foursquare stays the compliant path for post-MVP / multi-city. Google is
  the accepted MVP seed source for single-city Kelowna; every row keeps `google_place_id`
  for attribution/rebuild.

---

## Grounding: live prod state (`ufufmcpnysvwtutpbian`, verified 2026-06-08)

| Metric | Value |
|---|---|
| Total `places` rows | 271 |
| Curated Kelowna pool | 179 (59 live + 120 draft) |
| `google_legacy` / `auto` (excluded from LLM pool by design) | 92 |
| Live venues missing coords | 10 |
| Drafts missing hours | 53 |
| Rows with `google_place_id` | 271 (all) |
| Rows with `fsq_place_id` | 0 |
| **`is_delighter = true` (entire corpus)** | **0** |
| `food_focused` tag / `creative` tag | 1 / 1 |
| `sunset_spot` type / `viewpoint` type | 0 / 1 |

**Draft completeness (the 120):** photo 119/120, vibe_tags 120/120, local_insight 120/120,
coords 120/120, hours 67/120. **`quality_score` is saturated** (min 7.0, p25/median 9.0,
max 10.0) — it cannot discriminate quality, so the gate is **completeness + a human content
screen**, never a score threshold.

**Key insight from the activity rows:** the live `activity` pool (13) is mostly *at-home*
ideas (Cookbook Challenge, Vision Board, Movie Marathon, Wine Tasting at Home). The 42
`activity` drafts are the real out-in-the-world breadth (laser tag, paddleboard/canoe
rentals, pottery, museums, climbing, karting, axe throwing, bowling, theatre, comedy, spas,
horse riding, lavender farms). **This is why "59 venues produce the same dates" — and why
promotion is the single biggest variety unlock.**

---

## Workstreams

### WS1 — Backfill (mechanical, idempotent)

Run `apps/web/scripts/enrich-places.mjs` (Google Place Details v1) to fill the **53 missing
draft-hours + 10 missing live-coords**. The `.env.local` points at PROD; auth via
`SUPABASE_SECRET_KEY`. **Verify it writes `opens`/`closes`/`lat`/`lng`** (not just the
/places page fields) before trusting the run. Safe to re-run.

### WS2 — Auto-filter + report (the go/no-go gate)

Gate each draft on **objective completeness**: `photo ∧ coords ∧ hours (post-WS1) ∧
≥1 vibe_tag`. Because `quality_score` is saturated, **date-fit is a content screen, not a
score** — surfaced for human eyes via the report. **Deliver the report BEFORE promoting:**

1. Total passing / total failing.
2. **Breakdown by venue type** (and by the 21 experience categories — see Audit).
3. **Top 20** highest-value additions.
4. **Bottom 20** questionable rows — where tire-shop / strip-mall / office-park duds get
   caught and `--reject`'d.

User approves the passing set → WS3. Failing drafts stay `draft` for a later pass.

### WS3 — Promote + diversity readout

Run `promote-drafts.mjs --reject "<patterns>"` for the duds, then `--all` for the rest.
Re-check: 59 → ~179 live, all with hours+coords. Emit the **before/after live distribution**
framed as the diversity audit (WS6), not a raw count.

### WS4 — Sunset / viewpoint hand-add (the real content hole)

`sunset_spot` = 0, `viewpoint` = 1. Hand-add **~10–15 west-facing-over-the-lake spots** from
the verified starter list in `kelowna-taxonomy-and-coverage.md` (Knox Mtn, Dilworth, Mission
Hill / Quails' Gate overlooks, City Park / Tugboat / Gyro beaches, Mission Creek Greenway,
etc.). Each: type `sunset_spot`/`viewpoint`, `is_delighter=true`, golden-hour `time_of_day`,
with a `google_place_id` for enrichment. **Verify names / access / date-fit before import.**

### WS5 — Fix dead generation signals (pure data)

- **`is_delighter` backfill** (currently 0 corpus-wide — WOW-boosting and the "one weird
  thing" delighter rule have no signal today). Set `true` on genuine wow venues: winery
  overlooks, sunset spots, signature activities (e.g. floating-anything, unusual one-of-a-kind
  experiences). Proposed criteria; user confirms the set before apply.
- **Re-tag `food_focused` / `creative`** (each 1 today) onto a handful of existing venues so
  "foodie" / "creative" date requests resolve.

All applied via gated SQL migrations (secure-by-default, no RLS change, re-run the security
advisor after prod-apply per CLAUDE.md).

---

## WS6 — Diversity Audit (REQUIRED, two dimensions)

The audit is the heart of this spec. It runs **twice** (live now → live after activation) and
operates on **two axes**, because supply and demand are different questions.

### 6A — Supply axis: 21 experience categories

The schema has only 19 coarse `type`s and most experiences are lumped under `activity`, so the
audit applies a **classification layer** (type + name keyword + vibe). Tiers:

| Tier | Count |
|---|---|
| Missing | 0 |
| Weak | 1–2 |
| Healthy | 3–7 |
| Strong | 8+ |

**Tiers are not one-size-fits-all** — each category has a **target floor**, because some
categories recur in nearly every date and deserve more depth (3 wineries is fine; 3 cafes is
not). A category is **flagged as a gap when `actual_tier < target_tier`**, even if it's
technically "Healthy."

| # | Category | Classification rule (type / name / vibe) | Target |
|---|---|---|---|
| 1 | Restaurants | `type=restaurant` | Strong (8+) |
| 2 | Cafes | `type=cafe` | Strong (8+) |
| 3 | Dessert / gelato / bakery | `type ∈ {dessert, ice_cream, bakery}` | Healthy-hi (6+) |
| 4 | Wineries | `type=winery` | Healthy (4+) |
| 5 | Breweries | `type=brewery` | Healthy (3+) |
| 6 | Cocktail / wine bars | `type=cocktail_bar` (+ name `wine bar`) | Healthy-hi (5+) |
| 7 | Clubs / nightlife | name `club\|nightclub\|lounge` | **Deprioritized (0)** |
| 8 | Museums / galleries | `type=gallery ∨ (activity ∧ name museum)` | Healthy (3+) |
| 9 | Live music / comedy / events (venues) | `activity ∧ name comedy\|theatre\|stage\|music` | Healthy (3+) |
| 10 | Beaches | `type=beach` | Healthy (3+) |
| 11 | Parks | `type ∈ {park, garden}` | Healthy (4+) |
| 12 | Lookouts / viewpoints / sunset | `type ∈ {viewpoint, sunset_spot}` | Healthy-hi (5+) |
| 13 | Walks / waterfront routes | `type=walk` | Healthy-hi (6+) |
| 14 | Hikes / trails | `type=hike` | Healthy (4+) |
| 15 | Paddleboard / canoe / kayak | `activity ∧ name paddle\|kayak\|canoe\|sup` | Healthy (3+) |
| 16 | Floating sauna / spa / wellness | `activity ∧ name spa\|sauna\|wellness\|float` | Weak-OK (2+) |
| 17 | Bowling / pool / darts / arcade | `activity ∧ name bowl\|pool\|darts\|arcade\|vr\|games` | Healthy (3+) |
| 18 | Laser tag / axe / escape rooms | `activity ∧ name laser\|lazer\|axe\|escape\|paintball\|karting` | Healthy (3+) |
| 19 | Mini golf / driving range | `activity ∧ name golf\|mini\|driving range` | Weak-OK (2+) |
| 20 | Markets / shopping / bookstores | `type ∈ {market, shop} ∨ name book` | Healthy (3+) |
| 21 | Seasonal activities | `seasonality && {winter} ∨ name skat\|ski\|snow` | Healthy (3+) |

Classification is keyword-based and therefore approximate — edge cases get eyeballed. Target
floors are a **tunable starter table**, not gospel.

### 6B — Demand axis: 14 date archetypes / qualities

What users actually want is an *experience quality*, not a venue type ("something romantic,"
"something low-pressure"). These drive generation quality more than categories do. Mapped to
existing columns (vibe_tags / price_tier / weather / seasonality / effort):

| Archetype | Mapping |
|---|---|
| Romantic | vibe `romantic\|intimate` |
| Foodie | vibe `food_focused` ∨ type `restaurant\|dessert\|winery` |
| Adventurous | vibe `adventurous` ∨ effort/energy high |
| Active | type `hike\|walk\|paddle\|climb` ∨ energy high |
| Creative | vibe `creative` ∨ pottery/paint/gallery |
| Cozy | vibe `cozy\|chill` |
| Social | vibe `lively\|fun\|spontaneous` |
| Scenic | type `viewpoint\|sunset_spot\|beach` ∨ tags `lake_view` |
| Luxury | price `$$$` ∨ vibe `boujee` |
| Budget | price `$` |
| Indoor | `weather_works_in=indoor_friendly` ∨ indoor types |
| Outdoor | type `hike\|walk\|beach\|park\|viewpoint` |
| Rain-safe | `weather_dependent=false` ∨ `weather_works_in ∈ {any, indoor_friendly}` |
| Winter-safe | `seasonality && {year_round, winter}` |

Each archetype reports a venue count (it draws across categories) and a **target of ~10+**, so
the generator has enough supply to assemble *varied* dates of that type.

**Output:** a single audit doc with both tables, `now` vs `after-activation` columns, and a
status per row, so we can *see* which date experiences are still thin.

---

## WS7 — Prioritized Kelowna Acquisition Backlog (standing artifact)

A second output, written to `docs/kelowna-acquisition-backlog.md` so it survives the session.
For every MISSING / below-target category (6A) and thin archetype (6B): **what to add next,
grouped by category, prioritized** by `first-date value × gap size`. This is the ranked
shopping list that feeds a *future* bounded discovery pass — not scraped now.

**Tiering inside the backlog:**

- **MVP gaps** — categories below target that hurt Kelowna variety today.
- **Deprioritized** — clubs / loud nightlife (weak blind-first-date fit: a first date wants
  conversation, movement, shared experience — not yelling over music).
- **Future Tier-1 Expansion: live events.** Markets, comedy shows, outdoor concerts, wine
  festivals, live jazz, farmers' markets. Potentially the *biggest later unlock* — events
  create unique, non-repeating dates — but they are ephemeral, not `places` rows, and **not
  needed for Kelowna MVP.** Captured here so the idea isn't lost.

---

## WS8 — Date Generation Variety Test (validation — the biggest thing)

The whole point. Reuses `@after5/date-quality`'s live-generation wiring (the same generate
path + Kelowna fixtures the eval uses) and adds a **new variety metric** on top — it does NOT
build a new engine.

**Procedure:** generate **N dates each** for 4 intents — Romantic, Adventurous, Foodie,
Creative (N configurable; start with a **small calibration run, ~10–20 each**, before any full
50×4, because live generation costs real Anthropic tokens + time).

**Measure per intent bucket:**

- distinct venues used,
- distinct activities used,
- distinct date *structures* (the archetype/shape, e.g. `cafe→walk→dessert`).

**The signal:** if 50 Romantic dates collapse to only ~8 distinct structures, *that* is the
real bottleneck — and it tells us whether the fix is more corpus (this pass) or generator
tuning (a later, separate decision). The question being answered is **"can the generator make
100 dates that feel different?"** — not "do we have enough venues?"

---

## Risks & rollback

- **Prod writes.** WS1/WS3/WS5 mutate live prod. All reversible: `approval_status` flips back
  to `draft`; enrich is idempotent; tag backfills are gated SQL with before/after counts.
- **Duds going live.** Mitigated by the WS2 gate (completeness + human bottom-20 screen) and
  the WS3 `--reject` step.
- **Variety test cost.** Mitigated by configurable N + calibration run first.
- **Classification drift.** Keyword rules are approximate; flagged, eyeballed, tunable.
- Re-run the Supabase **security advisor** after any prod DDL (CLAUDE.md).

## Definition of done

1. Live pool ~179, every live row has hours + coords.
2. ~10–15 real sunset/viewpoint spots live, `is_delighter=true`.
3. `is_delighter` and `food_focused`/`creative` carry real signal.
4. Diversity audit doc committed, both axes, now-vs-after, gaps flagged against targets.
5. Acquisition backlog doc committed, prioritized, with the events Future-Tier-1 note.
6. Variety test run (calibration N) with distinct-venue / activity / structure numbers per
   intent, and a one-paragraph read on whether the bottleneck is corpus or generator.
7. Todo updated → done.

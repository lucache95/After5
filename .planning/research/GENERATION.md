# Generation & Eval: Multi-Stop Date Itineraries with Claude

**Domain:** AI date-itinerary generation + quality evaluation from a legally-usable real-venue corpus
**Researched:** 2026-06-05
**Overall confidence:** HIGH (codebase grounded + Anthropic API/pricing verified against official docs 2026-06-05)

---

## 1-Paragraph Summary

After5 already ships a mature, **code-assembles / LLM-only-writes** generation pipeline (`supabase/functions/generate-plan/`) — the single most important finding of this research. The architecture invariant is explicit in the code: *"the LLM never picks places."* Postgres filters candidates (geo/category/hours/price/season), deterministic TypeScript fills templated slots with stochastic top-K scoring, code-side validators enforce proximity-cluster, adjacency, budget ceiling, and opening-hours, and only THEN does Claude (`claude-sonnet-4-6`) write the human-facing copy (`title`, `hook`, `why_it_works`, per-stop `what_to_do`) over fixed `place_id`s. This is exactly the hybrid that the literature and our own constraints converge on, and it is the right answer — it structurally eliminates the two failure modes LLMs are worst at (inventing venues, hallucinating proximity/hours). The recommendation is therefore **refactor, do not replace**: keep the pipeline, and invest the v2.0 effort in (a) a real proximity/drive-time model to replace the current `drive_cluster` heuristic, (b) a partial-regeneration path for the customize/improve loop, and (c) the eval harness, which today does not exist and is the actual product test. The single biggest risk is **proximity/feasibility drift on open-city / on-the-fly venues**: the deterministic guards are tuned for the curated Kelowna corpus (hand-authored `drive_cluster`, `opens`/`closes`, `quality_score`), and Foursquare-sourced venues in a cold city arrive without those fields — so the very guards that make generation trustworthy silently degrade to "always pass" (`withinRadius` returns `true` on null coords; `isOpenAt` returns `true` on null hours). The eval harness must run against on-the-fly cities, not just Kelowna, or it will certify a quality bar the product does not actually hit in new markets.

---

## Recommended Generation Architecture (one-liner)

**Keep the existing constraint-first hybrid: Postgres pre-filters → deterministic template-fill + stochastic scoring → code validators (proximity / adjacency / hours / budget) → Claude writes copy over frozen `place_id`s via tool-use structured output.** Add a real drive-time proximity layer, a single-stop repair/regenerate path, and a CI eval harness that combines deterministic checks with an LLM-as-judge rubric on a golden set.

---

## Recommended Generation Architecture (detail)

### The core decision: pre-filter + code-assembles vs let-the-model-pick

**Verdict: pre-filter and let CODE assemble. The model writes, it does not choose.** This is already what the repo does and it is correct. Rationale:

1. **Proximity and hours are arithmetic, not judgment.** "Is venue B within 1.2km of venue A" and "is this place open at 18:30" are deterministic facts. An LLM handed 150 venues with lat/lng will *confidently* place two stops 40 minutes apart and call them "a short stroll." Code does not.
2. **Legal/cost containment.** A pre-filtered candidate set of ~8–25 venues keeps the prompt small (cheap, fast, cacheable) and keeps Foursquare/own data inside the legally-usable boundary without dumping the whole corpus into a third-party model.
3. **It is testable.** Deterministic assembly means the eval harness can assert invariants (every stop open, every hop < N km) as hard pass/fail, not vibes.

The pipeline as it exists today (verified in `providers/pipeline.ts`, `places-filter.ts`, `scoring.ts`):

```
1. filterPlaces()        Postgres: city_id, is_active, approval_status, at_home,
                         price_tier ∈ allowedTiers(budget), seasonality ⊇ {season|year_round}
                         → JS haversine radius pass (PostGIS not enabled)
2. selectTopTemplates()  pick 3 slot-templates matching occasion/vibe
3. buildItineraryFromTemplate()  per slot: placeMatchesSlot (type/effort/price/
                         time_of_day/reservation/isOpenAt) → score → stochastic top-5 pick
                         → budget ceiling check (1.3× or $50 floor) → else null + retry×3
4. injectDelighter()     swap weakest stop for a tagged "one weird thing" if budget allows
5. enforceSequenceRules()  editorial-pack position rules (e.g. last stop = view)
6. fixAdjacency()        no two same-category-group stops back-to-back (food/drink/sweet)
7. writeItineraries()    Claude writes title/hook/why_it_works/what_to_do over FIXED ids
8. photo scrub           drop snow-in-summer / daytime-photo-at-night stops
9. persist()             write itineraries.stops jsonb (the canonical shape)
```

This is a strong, opinionated, constraint-first design. The v2.0 work is to harden it for non-curated cities and add the customize loop + eval — not to rebuild it.

### Where to invest: the proximity gap

The one architecturally weak link is **proximity/drive-time**, currently modeled by `drive_cluster` (a hand-authored string label per venue) plus a flat `estimateDriveMin()` heuristic (5min same-cluster, 10min "multiple", 20min cross-cluster). This works for curated Kelowna where a human tagged clusters. It does **not** generalize to Foursquare-sourced venues in an arbitrary city, which arrive with lat/lng but no cluster.

**Recommendation:** replace cluster-string proximity with a real geo layer:
- Enable **PostGIS** (or `earthdistance`/`cube`) so radius + nearest-neighbor filtering happens in-query instead of the current in-memory haversine pass. The code comment in `places-filter.ts` explicitly notes PostGIS "isn't enabled" — enabling it is the unlock.
- Compute pairwise stop distance with haversine (already implemented), and gate on a **max-hop budget** derived from `drive_tolerance_min`. Straight-line haversine × ~1.4 detour factor is a good-enough drive proxy for an interactive product; a real routing API (Mapbox Directions — Mapbox is already a dependency) is a Phase-2 refinement only if eval shows it's needed.
- Keep `drive_cluster` as an *optional boost* for curated cities, not a *requirement*.

### Structured output: use tool-use, not free-text JSON parsing

The current writing pass (`prompt.ts`) asks Claude for raw JSON and then defends against it: strips ``` fences, `JSON.parse` in a try/catch, retries once, falls back to deterministic copy, and validates `what_to_do` length. This works but is fragile.

**Recommendation:** migrate the writing pass to **Anthropic tool-use forced output** (`tool_choice: {type: "tool", name: "emit_itineraries"}` with a JSON-schema `input_schema`). This guarantees schema-valid output, removes the fence-stripping/parse-retry code, and lets you assert the exact `stops[].what_to_do` shape at the API boundary. Keep the deterministic fallback for empty `what_to_do` (good defense-in-depth). [Confidence: HIGH — tool-use structured output is a stable, documented Anthropic capability in 2026.]

Because the model only emits copy keyed by `template_id` + `place_id` (never the place list), schema validation is cheap and the blast radius of a bad generation is one text field, not a hallucinated venue.

---

## Constraint Enforcement: proximity / hours / budget / pacing

**Strategy: hybrid, weighted toward code. Model proposes nothing structural; code owns every hard constraint; the model only writes prose. Where the model COULD help (vibe nuance), it advises scoring, it does not decide feasibility.**

| Constraint | Enforcement today | Recommended v2.0 | Mechanism |
|---|---|---|---|
| **Proximity** | `drive_cluster` label + flat `estimateDriveMin` | PostGIS + haversine max-hop gate from `drive_tolerance_min` | **Code, hard.** Reject any plan with a hop over budget; repair by swapping the far stop for the nearest in-slot candidate. |
| **Opening hours** | `isOpenAt(slotStart)` filters candidates pre-pick; relaxed-mode fallback skips it | Keep; add hard post-validation that re-checks every final stop against its computed `start_time` | **Code, hard.** Null hours = "unknown" → currently passes; flag null-hours stops as `feasibility: unverified` rather than silently trusting. |
| **Pacing / sequence** | Template slot order + `fixAdjacency` + editorial `sequence_rules` | Keep; templates already encode drinks→dinner→activity | **Code, hard (template) + soft (adjacency swap).** |
| **Budget** | Per-plan ceiling `max(budget×1.3, $50)`; reject+retry over | Keep; expose per-stop cost so "make it cheaper" can target stops | **Code, hard.** |
| **Vibe match** | Soft scoring bonus (+1.5/overlap); no hard floor | Keep soft — correctly a preference, not a gate | **Code, soft (scoring).** |
| **Time-of-day validity** | `effectiveStartAt` from `time_of_day`/`start_at`; hours filter | Keep | **Code, hard.** |
| **Copy quality / hook** | LLM writing pass + length floor + retry + fallback | Migrate to tool-use; add to eval rubric | **LLM, validated by code + eval.** |

**The rule:** in-prompt constraints are advisory only (the model is told the budget so its *copy* can lean into "punches above its price"). Every constraint that, if violated, makes the date *wrong* is enforced in code as **pre-filter (exclude infeasible candidates) + post-validate (re-check the assembled plan) + repair (swap one stop)**. The model never gets the chance to violate proximity/hours/budget because it never picks places. This is the single most important design property and it must be preserved.

**The honest weak spot:** "always pass on null" is the right default for keeping curated generation alive, but it is a silent quality leak on cold/on-the-fly cities where lat/lng or hours are missing. Make "unverified" a first-class signal the eval scores against (see harness), not an invisible pass.

---

## Customize / Improve Loop

Two interaction shapes, both should reuse the same machinery:

### A. Swap a single stop (hold the rest)
The user says "swap this stop" or rejects stop *i*. Do **not** regenerate the whole itinerary.

**Pattern: constrained re-pick of one slot.**
1. Take the original candidate pool + template slot *i*'s constraints (type, price tier, hours at stop *i*'s `start_time`).
2. Exclude the current pick + all other stops in the plan (`usedInPlan`) so you don't return the same place or a duplicate.
3. Run the existing `scorePlace` ranking, stochastic top-K pick → one new place.
4. Re-validate proximity against neighbors *i-1* and *i+1* (the new stop must still be near them). If it fails, widen to next candidate.
5. Recompute `start_time`/`drive_to_next_min` for stop *i* and ripple downstream times.
6. **One cheap LLM call** to rewrite just that stop's `what_to_do` (and optionally nudge `why_it_works` so the narrative still flows). Use **Haiku** here — it's one stop of copy.
7. Persist via the existing `update_itinerary_stops(p_itinerary, p_stops, ...)` RPC, which already validates shape, clamps ≤12 stops, and recomputes `total_cost_pp`/`total_duration_min` server-side. **This RPC is the write boundary — the customize loop should call it, not invent a new path.**

This is mostly deterministic; the LLM touches one text field. Fast, cheap, coherent.

### B. Natural-language tweak ("cheaper", "more romantic", "later")
The user types a free-text directive against the whole plan.

**Pattern: parse intent → adjust filter/scoring knobs → re-assemble, NOT free-form LLM rewrite.**
- **"cheaper"** → drop `budget_per_person`, re-run pipeline (or greedily swap the most expensive stop for a cheaper in-slot candidate). Deterministic.
- **"later" / "make it an evening thing"** → shift `time_of_day`/`start_at`, re-run the hours filter, re-assemble. Deterministic.
- **"more romantic" / "more adventurous"** → map the phrase to `vibe` tags + `intent` + possibly an editorial pack, re-score. A **single Haiku call** can do the phrase→knobs mapping (free-text → `{vibe: [...], intent: ..., budget_delta: ...}` via tool-use); code then re-runs the deterministic pipeline with the new knobs. The LLM classifies the wish; code grants it.

**Coherence after a swap:** because times/costs/totals are always recomputed deterministically (and the `update_itinerary_stops` RPC re-derives totals), the plan never drifts into an inconsistent state. The only thing that can go stale is the prose `why_it_works` referencing a stop that changed — so any structural change should trigger a cheap copy-refresh of `why_it_works` + the changed stop's `what_to_do`.

**Build note:** the deterministic edit transforms already exist (`apps/web/lib/itinerary/edit.ts`: `reorderStops`, `patchStop`, `removeStop`, `validateStopsForSave`) and mirror the server RPC. The customize loop layers AI-assisted *selection* on top of these existing pure edit functions — it does not replace them.

---

## Model Choice + Cost / Latency

Verified against Anthropic docs/pricing 2026-06-05. Current models and per-MTok pricing:

| Model | ID | Input / Output ($/MTok) | Latency | Use for |
|---|---|---|---|---|
| Opus 4.8 | `claude-opus-4-8` | $5 / $25 | Moderate | **Not for generation.** Reserve for offline eval-judge or hard one-off authoring. |
| Sonnet 4.6 | `claude-sonnet-4-6` | $3 / $15 | Fast | **Main copy-writing pass** (3 itineraries at once). Current default — keep. |
| Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | Fastest | **Single-stop rewrite, NL-tweak intent parsing, the improve loop.** |

**Per-generation cost estimate (the main 3-itinerary writing pass):**
- Input: system prompt (~800 tokens, **prompt-cached** via `cache_control: ephemeral` — already done in `prompt.ts`) + user message with 3 assembled itineraries (~1,500–2,500 tokens). Effective uncached input ~2,500 tok; cached reads are 90% cheaper.
- Output: 3 itineraries of copy ~1,500–2,500 tokens.
- **Sonnet 4.6 cost ≈ $0.008–$0.012 per generation** (≈ 2.5k in × $3/M + 2.5k out × $15/M ≈ $0.0075–$0.045 worst case; with caching, typically ~1¢). Negligible. The Google/Foursquare API calls and DB work dominate, not the LLM.
- **Latency:** one Sonnet call, 4096 max_tokens, ~2–4s typical. Acceptable for a "generate a date" tap *if* the candidate pre-filter + assembly (pure Postgres + JS) stays sub-second. The on-the-fly warm path (5 parallel Foursquare text searches) is the latency risk on cold cities — that's already gated behind `COLD_THRESHOLD` so warm cities skip it.

**Improve-loop cost:** single-stop rewrite on Haiku ≈ **<$0.001 and <1s**. Effectively free.

**Recommendation:**
- **Generation copy pass:** `claude-sonnet-4-6` (keep current default in `index.ts` env `ANTHROPIC_MODEL`).
- **Improve loop / single-stop / NL-tweak parse:** `claude-haiku-4-5`.
- **Eval judge (offline/CI only):** `claude-opus-4-8` — judge quality matters more than cost since it runs on a fixed golden set, not per-user. Sonnet 4.6 is an acceptable cheaper judge if Opus budget is a concern; use Opus for the canonical scoring run.
- Do **not** use Opus in the interactive path. Sonnet is fast and the task (writing copy over fixed structure) does not need frontier reasoning.

Keep `prompt_caching` on the system prompt (already implemented) and consider the **Batch API (50% off)** for the eval harness, which scores many itineraries non-interactively.

---

## EVAL HARNESS DESIGN (the critical section)

**Goal:** measure "would a real human go on this date?" as a repeatable, CI-runnable score. The eval is the product's actual test. It has two layers: **deterministic checks (hard, must-pass)** and **LLM-as-judge rubric (graded, the desirability signal)**. Plus a **golden set** and a **CI gate**.

### Layer 1 — Deterministic checks (hard pass/fail, no LLM)

Run against every generated itinerary's `stops` jsonb. These are invariants; any failure is a bug, not a taste call. Implement as a pure TS module (`eval/deterministic.ts`) reusing the existing `haversineKm`, `isOpenAt`, `toMinutes` helpers.

| Check | Assertion | Fail = |
|---|---|---|
| **Proximity** | Every consecutive hop ≤ `drive_tolerance_min` (via haversine × 1.4 / assumed speed). | hard fail |
| **Hours-open** | For every stop, venue is open at the stop's `start_time` (handle wraparound). Null hours → `unverified`, counted separately. | hard fail (known hours) / warn (unverified) |
| **Schedule monotonic** | `start_time[i] + duration + drive ≤ start_time[i+1]`; no overlaps, no time travel. | hard fail |
| **Budget sum** | `Σ estimated_cost_pp ≤ budget × 1.3` (matches pipeline ceiling). | hard fail |
| **Pacing/adjacency** | No two same-category-group stops back-to-back; ≥1 food and a sane drinks/dessert rhythm. | warn |
| **Shape validity** | Every stop has `place_id`, `place_name`, `start_time`, non-empty `what_to_do`, non-negative cost/duration. Mirrors `update_itinerary_stops` server checks. | hard fail |
| **No-hallucination** | Every `place_id` exists in `places` for that city (LLM didn't fabricate). | hard fail |

**Key insight:** because code assembles, these should almost always pass for curated cities — the eval's job there is *regression detection*. Their real teeth are on **on-the-fly cities**, where they catch the null-coords/null-hours silent-pass degradation. Report `unverified_rate` (% stops with unknown hours/geo) as a first-class metric per city.

### Layer 2 — LLM-as-judge rubric (the desirability signal)

For each itinerary, an Opus-4.8 judge scores 5 dimensions 1–5 with a one-line justification, via **tool-use forced output** (so scores are schema-valid and machine-parseable). Feed the judge the full assembled plan (names, types, neighborhoods, times, costs, the written copy) — NOT raw lat/lng (judge proximity deterministically in Layer 1; ask the judge about *experience*).

| Dimension | Question the judge answers | Why it matters |
|---|---|---|
| **Coherence** | Do the stops tell one story (a → b → c builds), or is it a random list? | The "someone with taste planned this" test. |
| **Desirability / hook** | Reading this, would a real person say "yes, I want THAT"? Is the hook specific, not generic AI praise? | The product's whole bet. |
| **Feasibility realism** | Does the pacing/timing feel humanly doable (not 4 stops in 90 min)? Soft cross-check of Layer 1. | Catches "technically valid but exhausting." |
| **Budget realism** | Does the cost feel honest for what's described (not a $200 night labeled $40)? | Trust. |
| **Local specificity** | Does it feel grounded in a real place, or could it be any city? (Reuses the prompt's anti-slop rules.) | The moat — generic = commodity. |

**Judge guardrails (from the verification literature — LLM judges are biased):**
- Force a **rubric with anchored examples** per score (1 = "generic list, no story"; 5 = "I'd screenshot this"). Anchors cut judge variance.
- **Randomize/blind** any A/B ordering to avoid position bias.
- Use **Opus 4.8** as judge (`adaptive thinking` on) — the judge needs more reasoning headroom than the generator.
- Calibrate the judge once against ~20 human-rated itineraries; track judge-vs-human correlation. If correlation drops, the judge drifted.
- Composite "would-go" score = pass Layer 1 (hard gate) AND mean(Layer 2) ≥ threshold (e.g. 3.5/5), with desirability ≥ 4 weighted highest.

### Golden / reference set

- **Golden inputs:** ~25–40 frozen `PlanInputs` covering the matrix: occasion × budget tier × vibe × time_of_day × {tonight, future} × {curated city (Kelowna), on-the-fly city}. Include adversarial cases: tiny budget, "free," 9am start, niche vibe combos, must_includes that strain the pool.
- **Golden venue snapshot:** pin a fixed `places` snapshot (seed fixture) so generation is reproducible run-to-run. Without a frozen corpus the eval is non-deterministic and CI flakes.
- **Reference itineraries:** for ~10 inputs, hand-author the "this is the date we'd be proud of" plan. Use these to (a) calibrate the judge and (b) spot regressions (did the new pipeline stop finding the obvious-great combo?).
- Store under `eval/golden/` as JSON; treat changes to golden expectations as reviewed commits.

### How it runs in CI

```
pnpm eval:generate   # run pipeline over golden inputs against the pinned places fixture
pnpm eval:check      # Layer 1 deterministic — FAILS the build on any hard violation
pnpm eval:judge      # Layer 2 Opus judge (Batch API, 50% off) → scores.json
pnpm eval:report     # aggregate: pass-rate, mean desirability, unverified_rate per city,
                     #            regressions vs last green run
```

- **CI gate (blocking):** Layer 1 hard checks must be 100% pass. This is cheap, deterministic, no API key needed for the asserts (only generation needs the LLM) — run on every PR touching `generate-plan/`.
- **CI gate (advisory → blocking once stable):** Layer 2 mean desirability must not regress > 0.3 vs the last green baseline. Run on a schedule or on `generate-plan/` changes (costs a few cents via Batch API).
- **Per-city dashboard:** track `unverified_rate` and judge scores split by curated vs on-the-fly — this is how you know whether the quality bar holds in new markets *before* users find out.
- Reuse the existing `audit_log` / `sharedLog` the pipeline already emits (candidate_pool_size, adjacency_fixes, what_to_do_fallbacks, photos_scrubbed) as eval inputs — the pipeline is already instrumented for this.

**This is concrete enough to build now:** deterministic module reuses shipped helpers; judge is one tool-use call per itinerary; golden set is JSON fixtures; CI is npm scripts. No new infra.

---

## Assessment of Existing Repo Generation Code: KEEP / REFACTOR / REPLACE

**Verdict: KEEP the architecture, REFACTOR three seams, REPLACE nothing.** The existing `supabase/functions/generate-plan/` is a genuine asset — it already embodies the correct constraint-first hybrid that this research independently recommends.

| Component | Verdict | Action |
|---|---|---|
| `index.ts` (handler, Zod input, rate-limit, city resolve, provider seam) | **KEEP** | Solid. Provider seam (`selectProvider`) is good extensibility. |
| `providers/pipeline.ts` (filter→template→score→validate→LLM→scrub) | **KEEP** | This is the crown jewel. The "LLM never picks places" invariant is exactly right. |
| `places-filter.ts` (Postgres candidate filter + JS haversine) | **REFACTOR** | Enable PostGIS; move radius/nearest into the query. Keep the filter logic. |
| `scoring.ts` (`buildItineraryFromTemplate`, `isOpenAt`, scoring, delighter) | **KEEP + extend** | Reuse `isOpenAt`/`haversine`/`toMinutes` directly in the eval harness. Add real drive-time. |
| `prompt.ts` (LLM writing pass, JSON parse, retry, fallback) | **REFACTOR** | Migrate raw-JSON parsing → tool-use structured output. Keep the prompt voice + fallback + caching. |
| `providers/onthefly.ts` (Google warm + pipeline) | **REFACTOR (data source)** | **Swap Google Places for Foursquare** per the legal constraint (Google 2026 ToS forbids feeding Maps Content to an LLM). The warm-then-pipeline shape stays; only the source API + `googleResultToPlaceRow` mapping change. The whole `google-places.ts` module and its `passesQualityFloor`/`googleResultToPlaceRow` need a Foursquare equivalent. |
| `drive_cluster` proximity model | **REFACTOR** | Demote from requirement to optional curated-city boost; add lat/lng haversine hop-gate as the real proximity check. |
| Customize/improve loop | **BUILD (new)** | Does not exist as AI-assisted flow. Layer single-stop re-pick + NL-tweak intent parse on top of existing `update_itinerary_stops` RPC + `lib/itinerary/edit.ts` pure transforms. |
| Eval harness | **BUILD (new)** | Does not exist. This is the biggest net-new deliverable. |

**Critical legal note carried from the venue-data research:** `onthefly.ts` and `google-places.ts` currently call **Google Places** to warm cold cities. Feeding Google Maps Content into Claude violates Google's 2026 ToS. The pipeline shape is reusable, but the data source MUST move to Foursquare (or own data) before on-the-fly generation in new cities ships. Curated/own-data cities (Kelowna) are unaffected. [Confidence: HIGH on the architectural seam; the ToS specifics come from the parallel venue-data research, treat as its finding.]

---

## Risks / Pitfalls

### Critical

**1. Proximity/feasibility silent degradation on on-the-fly cities (THE biggest risk).**
The deterministic guards return `true` (pass) on null lat/lng (`withinRadius`) and null hours (`isOpenAt`). Curated Kelowna has these fields hand-filled; Foursquare-warmed venues in a cold city often won't. So the guards that make generation trustworthy quietly become no-ops exactly where the corpus is weakest. *Mitigation:* make `unverified` a first-class state, surface `unverified_rate` per city in the eval, and require eval to run on on-the-fly cities — not just Kelowna.

**2. The eval certifies the wrong city.** If the golden set is Kelowna-only (the mature, curated corpus), the eval will read green while new-market quality is poor. *Mitigation:* golden set MUST include an on-the-fly city with a pinned Foursquare-style fixture.

**3. Legal data boundary.** Google Places content into Claude = ToS violation. *Mitigation:* Foursquare migration is a hard prerequisite for new-city on-the-fly generation, not a nice-to-have.

### Moderate

**4. LLM-judge drift / bias.** Judges have position bias, verbosity bias, and self-consistency drift. *Mitigation:* anchored rubric, blinded ordering, periodic human calibration, track judge-vs-human correlation.

**5. Non-deterministic eval flakes.** Stochastic top-K scoring + live venue data make runs vary. *Mitigation:* pin a places fixture; seed the RNG for eval runs (the scorer uses `Math.random()` — inject a seedable RNG in eval mode).

**6. Copy references a swapped stop.** After single-stop swap, `why_it_works` can name a venue no longer in the plan. *Mitigation:* any structural change triggers a cheap Haiku refresh of `why_it_works` + the changed `what_to_do`.

**7. Cold-city latency.** On-the-fly warm = 5 parallel external API calls before the LLM. *Mitigation:* already gated by `COLD_THRESHOLD`; consider async warm + "generating…" state for first-ever generation in a brand-new city.

### Minor

**8. Free-text JSON parsing fragility** in the current writing pass — solved by the tool-use migration.
**9. Budget "feels cheap" heuristic** is curated-data-dependent (`perceived_value`, `friction_score` are hand-tagged); won't exist on Foursquare venues. Degrades gracefully (those scoring bonuses just don't fire) but the "free dates that feel expensive" angle weakens in new cities.

---

## Sources

- Codebase (HIGH — direct read): `supabase/functions/generate-plan/{index,providers/pipeline,providers/onthefly,places-filter,scoring,prompt,types}.ts`; `supabase/migrations/20260419193959_initial_schema.sql` (itineraries.stops jsonb); `supabase/migrations/20260602140000_m3_update_itinerary_stops.sql`; `apps/web/lib/itinerary/edit.ts`; `.planning/PROJECT.md`.
- [Claude Models overview — Anthropic docs](https://platform.claude.com/docs/en/about-claude/models/overview) (HIGH — model IDs, latency, context, tool-use): `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`.
- [Claude API Pricing — Anthropic docs](https://platform.claude.com/docs/en/about-claude/pricing) (HIGH): Opus 4.8 $5/$25, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5 per MTok; Batch 50% off; prompt caching 90% off cached input.

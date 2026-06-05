# Phase 9: Trustworthy Generation + Eval Harness - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning
**Mode:** mvp — harden the EXISTING generate-plan engine + add the improve loop + eval + vibe-matched sound; do not rebuild.

<domain>
## Phase Boundary

Make AI date generation genuinely good and provably so. Four requirements:
- **PLAN-01** — one-tap coherent multi-stop date for the user's city from real venues, hardened: tool-use structured output + a real haversine hop-gate (not the drive_cluster string).
- **PLAN-02** — the customize/improve loop: swap a single stop + natural-language tweaks ("cheaper/more romantic/later"), itinerary stays coherent.
- **EVAL-01** — an eval harness (deterministic checks + Opus-4.8 LLM-judge) over a golden set that includes a cold on-the-fly city, surfacing unverified_rate per city, gated in CI — the product's actual test.
- **SOUND-01** — more ambient tracks + a generated date auto-gets a vibe-matched sound (vibe_tags overlap; sound↔cover cohere via shared vibe).

**In scope:** the generation quality + improve UX + eval + sound layers of generate-plan. NOT making generation the primary night-creation path / retiring the legacy funnel (Phase 10). NOT the Foursquare live cutover (Phase 8, key-gated).

**Builds + tests against curated Kelowna + fixtures** — does NOT need the live Foursquare key (the cold-city golden case is fixture-seeded).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Generation hardening (PLAN-01)
- Migrate the LLM copy pass (`prompt.ts` raw-JSON `parseLLMResponse` ~line 327-335) to Anthropic **tool-use** — a forced tool call emitting the itinerary-copy schema (title/hook/why_it_works/per-stop what_to_do), eliminating the fragile fence-strip + JSON.parse.
- Replace the `scoring.ts` `drive_cluster` string adjacency gate (~line 105-106) with a real **haversine hop-gate**: consecutive stops must be within a configurable max-hop distance (the radius filter at `places-filter.ts:115` already uses haversine — reuse `haversineKm`). The `drive_cluster` column stays for display/back-compat but no longer gates adjacency.
- Generation copy model: **claude-sonnet-4-6** (~1¢, 2-4s interactive).
- Hop threshold: a named, tunable constant (~2 km — walkable / short drive). Claude's discretion on the exact value + whether to weight by stop type.

### Area 2 — Improve loop (PLAN-02)
- Swap a single stop: deterministic re-pick of just that slot (re-run the slot's candidate selection holding the other stops fixed) + a cheap **claude-haiku-4-5** copy rewrite for only that stop.
- NL tweaks: **claude-haiku-4-5** parses free text ("cheaper", "more romantic", "later") into scoring knobs (budget cap, vibe weight, time shift), then re-runs the pipeline with those knobs.
- Persist via the existing `update_itinerary_stops` RPC.
- After any swap/tweak, re-validate proximity (hop-gate) + budget + hours; if the change breaks coherence, surface it rather than silently shipping an incoherent date.

### Area 3 — Eval harness (EVAL-01)
- Deterministic hard checks: proximity hops within threshold · every stop open at its slot time (using the fail-loud isOpenAt) · schedule monotonic (times increase) · budget sum ≤ stated · NO hallucinated venues (every place_id resolves in `places`).
- LLM-judge: **claude-opus-4-8**, OFFLINE only, rubric = coherence + desirability/hook + feasibility + budget realism + local specificity (scored, with reasons).
- Golden set: a pinned fixture set including a COLD on-the-fly city (fixture-seeded `places` rows so it runs with NO live key) AND curated Kelowna; the harness reports `unverified_rate` per city (the Phase-8 signal) as a first-class metric.
- CI gating: deterministic checks **hard-fail** the build; the Opus LLM-judge produces a scored report with a warn-threshold (does NOT hard-fail CI — avoids flaky-judge breakage; a regression below the bar warns + is reviewed).

### Area 4 — Vibe-matched sound (SOUND-01) + improve-loop UI
- Generate ~6-10 additional ambient loops (ElevenLabs Sound Effects API, mirror the v1.0 recipe: loop:true, 15s, mono m4a, upload to the `ambient-sounds` bucket) covering the vibe taxonomy; tag each with `vibe_tags`.
- On generation/persist, the date auto-gets the best `vibe_tags &&`-overlap active ambient sound (reuse the feed's existing overlap pick at `browse_feed_for_viewer`'s ambient lateral) set as its `ambient_sound_id`. Sound↔cover cohere because both derive from the night's vibe.
- Improve-loop UI lives in the existing `/create` generate flow (per-stop "tweak" affordance + an NL tweak input). Barbiecore, mobile-first. Detailed visual contract → the ui-phase UI-SPEC (runs next).

### Claude's Discretion
- Exact hop-km, the NL-tweak knob mapping, the eval rubric weights + warn-threshold, the number of new sounds + their vibe coverage, and the tool schema shape — within secure-by-default + the design system.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/functions/generate-plan/prompt.ts` — the LLM copy pass (`client.messages.create` ~line 131, `parseLLMResponse` ~327) to migrate to tool-use. Model is already a param.
- `scoring.ts` (drive_cluster adjacency ~105-106; the fail-loud isOpenAt from Phase 8) + `places-filter.ts` (`haversineKm` ~118 to reuse for the hop-gate).
- `providers/{pipeline,select,onthefly,kelowna}.ts` — the pipeline the improve-loop re-runs with knobs.
- `update_itinerary_stops` RPC — the improve-loop persist path (already used by the v1.0 LockDetail/PlanTimeline).
- m4 ambient system: `ambient_sounds` table (vibe_tags, sort_order, is_active), the feed's `vibe_tags &&` lateral pick, post_night's `p_ambient_sound_id`. v1.0 ElevenLabs recipe (memory: loop:true, mono m4a, ambient-sounds bucket, service_role JWT for upload).
- `apps/web/app/create/` (CreateFlow, CreateChooser, generate/, PublishToFeedButton) — where the improve UI lands.

### Established Patterns
- Anthropic tool-use / structured output (models: opus-4-8, sonnet-4-6, haiku-4-5). Deno edge fn imports `npm:@anthropic-ai/sdk` (the local test gap — eval/tests run under node_modules or fixture-mock the client).
- Secure-by-default + gated-prod-apply; visual-verify @420px; stop-slop Barbiecore copy.
- v1.0 eval precedent: `packages/date-quality/` exists (grep it — there may be reusable eval scaffolding).

### Integration Points
- generate-plan edge fn (the corpus is Phase-8 Foursquare once cutover; Phase 9 works on whatever's in `places` = Kelowna + fixtures).
- The improve loop calls back into the pipeline + update_itinerary_stops.
- The eval harness is a CI-gated test target (deno + vitest), with an offline Opus judge step.
</code_context>

<specifics>
## Specific Ideas
- The eval harness is the product's actual test — design it concrete + CI-runnable, and it MUST include a cold-city fixture so it can't read green while new-market quality is poor (the Phase-8 silent-collapse risk).
- All new copy lowercase/dry/Barbiecore (the generated hooks + the improve-loop affordances).
</specifics>

<deferred>
## Deferred Ideas
- Making generation the primary create path + retiring legacy /create (Phase 10).
- The Foursquare live cutover (Phase 8, key-gated).
- Cover-image → audio ML matching (vibe-tag matching only).
- Richer chemistry/compatibility ranking (out of v2.0 scope).
</deferred>

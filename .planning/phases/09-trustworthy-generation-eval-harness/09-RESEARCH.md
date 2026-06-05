# Phase 9: Trustworthy Generation + Eval Harness - Research

**Researched:** 2026-06-05
**Domain:** AI date-itinerary generation hardening + offline eval harness + vibe-matched ambient sound
**Confidence:** HIGH (codebase-grounded direct read; Anthropic SDK version pinned in-tree; GENERATION.md decision research carried forward)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Generation hardening (PLAN-01)**
- Migrate the LLM copy pass (`prompt.ts` raw-JSON `parseLLMResponse` ~line 327-335) to Anthropic **tool-use** — a forced tool call emitting the itinerary-copy schema (title/hook/why_it_works/per-stop what_to_do), eliminating the fragile fence-strip + JSON.parse.
- Replace the `scoring.ts` `drive_cluster` string adjacency gate (~line 102-112, `clusterCompatible`) with a real **haversine hop-gate**: consecutive stops within a configurable max-hop distance. Reuse `haversineKm`. `drive_cluster` column stays for display/back-compat but no longer gates adjacency.
- Generation copy model: **claude-sonnet-4-6** (~1¢, 2-4s interactive). Already the default.
- Hop threshold: a named, tunable constant (~2 km — walkable / short drive). Claude's discretion on exact value + whether to weight by stop type.

**Area 2 — Improve loop (PLAN-02)**
- Swap a single stop: deterministic re-pick of just that slot (re-run the slot's candidate selection holding the other stops fixed) + a cheap **claude-haiku-4-5** copy rewrite for only that stop.
- NL tweaks: **claude-haiku-4-5** parses free text ("cheaper", "more romantic", "later") into scoring knobs (budget cap, vibe weight, time shift), then re-runs the pipeline with those knobs.
- Persist via the existing `update_itinerary_stops` RPC.
- After any swap/tweak, re-validate proximity (hop-gate) + budget + hours; if the change breaks coherence, surface it rather than silently shipping an incoherent date.

**Area 3 — Eval harness (EVAL-01)**
- Deterministic hard checks: proximity hops within threshold · every stop open at its slot time (fail-loud `isOpenAt`) · schedule monotonic (times increase) · budget sum ≤ stated · NO hallucinated venues (every place_id resolves in `places`).
- LLM-judge: **claude-opus-4-8**, OFFLINE only, rubric = coherence + desirability/hook + feasibility + budget realism + local specificity (scored, with reasons).
- Golden set: pinned fixtures including a COLD on-the-fly city (fixture-seeded `places` rows, NO live key) AND curated Kelowna; reports `unverified_rate` per city as a first-class metric.
- CI gating: deterministic checks **hard-fail** the build; Opus LLM-judge produces a scored report with a warn-threshold (does NOT hard-fail CI).

**Area 4 — Vibe-matched sound (SOUND-01) + improve-loop UI**
- Generate ~6-10 additional ambient loops (ElevenLabs Sound Effects API, mirror v1.0 recipe: loop:true, 15s, mono m4a, upload to `ambient-sounds` bucket) covering the vibe taxonomy; tag each with `vibe_tags`.
- On generation/persist, the date auto-gets the best `vibe_tags &&`-overlap active ambient sound (reuse the feed's existing overlap pick at `browse_feed_for_viewer`'s ambient lateral) set as `ambient_sound_id`.
- Improve-loop UI lives in the existing `/create` generate flow. Barbiecore, mobile-first. Detailed visual contract → the ui-phase UI-SPEC.

### Claude's Discretion
Exact hop-km, the NL-tweak knob mapping, the eval rubric weights + warn-threshold, the number of new sounds + their vibe coverage, and the tool schema shape — within secure-by-default + the design system.

### Deferred Ideas (OUT OF SCOPE)
- Making generation the primary create path + retiring legacy /create (Phase 10).
- The Foursquare live cutover (Phase 8, key-gated).
- Cover-image → audio ML matching (vibe-tag matching only).
- Richer chemistry/compatibility ranking (out of v2.0 scope).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAN-01 | Hardened one-tap coherent multi-stop date: tool-use structured output + real haversine hop-gate | §Tool-use migration; §Haversine hop-gate; SDK 0.40.1 verified in-tree |
| PLAN-02 | Customize/improve loop: single-stop swap + NL tweaks, itinerary stays coherent | §Improve loop; `buildItineraryFromTemplate` is the reusable slot re-pick; `update_itinerary_stops` is the write boundary |
| EVAL-01 | Eval harness (deterministic + Opus judge) over golden set incl. cold city, unverified_rate per city, CI-gated | §date-quality assessment (EXTEND, not rebuild); §Validation Architecture; cold-city fixture gap is the work |
| SOUND-01 | More ambient tracks + generated date auto-gets vibe-matched sound | §SOUND-01; m4 ambient infra + ElevenLabs recipe both exist and are reusable |
</phase_requirements>

---

## Summary

**The single most important finding: `packages/date-quality/` is a mature, well-tested eval package — EXTEND it, do not rebuild or duplicate it.** It already ships 30 Kelowna fixtures, 19 deterministic gates (including a haversine `travel_pacing` gate, `open_at_arrival`, `budget_realism`, `category_variety`, schedule-adjacent checks), a real `claude-opus`-style LLM-judge with a 6-dimension rubric and an injected-LLM seam (so it never imports an SDK and mocks deterministically), a baseline-diff regression engine with thresholds, dry-mode (fully offline, zero-network), a CLI entry (`scripts/eval-dategen.ts`) that exits nonzero on regression, and a committed baseline. **EVAL-01's net-new work is narrow and specific:** (1) add a few *itinerary-structure* deterministic checks the package lacks (schedule monotonicity, no-hallucinated-venue resolution against a `places` snapshot, an explicit consecutive-hop gate aligned to the new PLAN-01 threshold) — note proximity/hours/budget gates already exist but read a fixture, not live generation output; (2) seed a **cold-city fixture set** (the package today is Kelowna-only with hand-filled lat/lng/hours — the exact blind spot GENERATION.md flags); (3) surface `unverified_rate` per city as a report field (the production pipeline *already computes* it via `computeUnverifiedRate`, but the eval report shape does not carry it); (4) wire CI (there is **no `.github/workflows/` directory yet** — this is genuinely net-new). The harness invokes generation deterministically via the existing **dry mode + the injected `InvokeLLM` seam** — no live Anthropic key needed for the hard checks; a `--live` flag exists for the Opus judge run.

The other three requirements are surgical refactors of the production `generate-plan` edge function. PLAN-01's tool-use migration replaces `parseLLMResponse` (raw-JSON + fence-strip + retry) with a forced `tool_choice` call against `@anthropic-ai/sdk@0.40.1` (verified in-tree). The haversine hop-gate replaces `clusterCompatible` (`scoring.ts:102`) reusing the haversine math already present in `places-filter.ts` (currently module-private — must be exported or duplicated). PLAN-02's improve loop reuses `buildItineraryFromTemplate` (exported) for single-slot re-pick and the `update_itinerary_stops` RPC (which already re-derives totals server-side) as the write boundary. SOUND-01 is the lightest: the m4 ambient system, the ElevenLabs recipe, and the `vibe_tags &&` lateral auto-pick **all already exist** — SOUND-01 generates more loops and wires the same lateral into the generation/persist path to set `ambient_sound_id`.

**Primary recommendation:** Treat EVAL-01 as "extend `@after5/date-quality` + add a cold-city fixture + wire CI" — NOT a new harness. Treat PLAN-01/02 as targeted refactors that preserve the "LLM never picks places" invariant. The biggest implementation risk is the **eval reading green on the cold city while quality is actually poor** because the existing deterministic gates *skip pairs/stops with null coords/hours* (`travelPacing` and `openAtArrival` both `continue` on missing data) — so a cold-city fixture with thin data will *pass* the structural gates vacuously unless the harness treats `unverified_rate` as a first-class scored signal with its own threshold.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Place selection (deterministic) | Edge Function (`scoring.ts`/`pipeline.ts`) | — | "LLM never picks places" invariant; arithmetic + scoring, not judgment |
| Proximity hop-gate | Edge Function (`scoring.ts`) | — | Haversine is deterministic geo math; must run pre-LLM and on every improve-loop swap |
| Copy writing | Edge Function → Anthropic (Sonnet) | — | The only thing the LLM does; tool-use forces schema validity |
| Improve-loop slot re-pick | Edge Function (`buildItineraryFromTemplate`) | Anthropic (Haiku, copy refresh) | Re-pick is deterministic; one stop's copy is a cheap Haiku call |
| NL-tweak intent parse | Anthropic (Haiku, tool-use) | Edge Function (re-run pipeline with knobs) | LLM classifies the wish; code grants it via scoring knobs |
| Itinerary persist | Database RPC (`update_itinerary_stops`) | — | Single validated write path; re-derives totals + clamps server-side |
| Eval deterministic checks | Node package (`@after5/date-quality`) | — | Pure TS, offline, CI-gated; reuses `isOpenAt`/`haversineKm` math |
| Eval LLM-judge | Node package → Anthropic (Opus, offline) | — | Runs on fixed golden set, not per-user; quality > cost |
| Ambient sound auto-pick | Database (`vibe_tags &&` lateral) | Edge Function (set `ambient_sound_id` on persist) | Reuses the exact feed lateral; sound↔cover cohere via shared vibe |
| Ambient sound generation | External (ElevenLabs) → Storage (`ambient-sounds` bucket) | — | One-time content generation, service_role upload |

---

## date-quality Assessment: KEEP / REFACTOR / EXTEND (lead finding)

**Verdict: KEEP the package wholesale. EXTEND with 4 narrow additions. REBUILD nothing.**

The package (`packages/date-quality/`, `@after5/date-quality`, v0.0.1, ESM, vitest-tested) is far more complete than CONTEXT.md's "there may be reusable eval scaffolding" hedge implies. It is a finished v0 eval. Here is what exists and the exact disposition for EVAL-01.

### What it judges today

| Module | Responsibility | Disposition |
|--------|---------------|-------------|
| `types.ts` | `Fixture` (inputs + frozen stops + per-place `PlaceFacts` fact-bank), `WrittenDate`/`WrittenStop` (mirror generator output), `GateResult`/`GateSeverity` (critical/major/minor → score caps 40/55/70), `JudgeScores` (6 dims), `WEIGHTS` (sum 1.0) | KEEP. Extend `FixtureStop` only if a new check needs a field (it has `lat/lng/opens/closes/vibe_tags/pairing_tags/quality_score` already). |
| `writingPass.ts` | Offline wrapper around the generator writing pass; **injected `InvokeLLM` seam** (`{system,user}=>Promise<string>`); local prompt re-implementation; deterministic fallback for empty `what_to_do` | KEEP. The seam is the mock point. Documents the `npm:@anthropic-ai/sdk` Deno gap explicitly (lines 5-29) — see Pitfall below. |
| `gates.ts` | **19 deterministic gates**, pure `(fixture, date) => GateResult` | KEEP all + ADD 2-3 (see below). |
| `judge.ts` | LLM-judge: 6-dim rubric (desirability/arc/vibe_coherence/city_context_fit/specificity_taste/hook), 1-5 each + required evidence, strict JSON parse-or-throw, injected LLM, Kelowna-bounded knowledge | KEEP. Map the CONTEXT rubric (coherence/desirability/feasibility/budget/local-specificity) onto these existing dims — they already cover it. Make `JUDGE_CITY` a param (currently hard-coded `'Kelowna, BC'`) so the cold-city fixture judges against its own locale. |
| `score.ts` | `computeScore(judge) → gradient`, `finalScore(gradient, failedGates)` cap logic | KEEP. |
| `runEval.ts` | Orchestrates writing→gates→judge(only if no critical gate failed)→score→baseline-diff→JSON+MD render; **dry mode** (deterministic house-writer + judge, zero network); `compareToBaseline` with `MEAN_DROP_THRESHOLD=3`, `FIXTURE_DROP_THRESHOLD=10` | KEEP. EXTEND `EvalReport`/`FixtureResult` with `unverified_rate` + per-city grouping. |
| `scripts/eval-dategen.ts` | CLI: load fixtures → runEval (dry default) → diff baseline → write `eval-results/` → **exit 1 on regression**, `--update-baseline`, `--live` | KEEP. This is the CI entry. |
| `fixtures/dategen/kelowna-v0/` | **30 fixtures**: 4 golden, 8 adversarial, 18 normal. All have full lat/lng + opens/closes + fact-bank | KEEP. ADD a cold-city sibling dir. |
| `baselines/dategen/baseline-v0.json` | Committed baseline for regression diff | KEEP; regenerate after adding checks/fixtures. |
| `__tests__/` | `gates.test.ts`, `runEval.test.ts`, `score.test.ts` + `helpers.ts` factories | KEEP; add tests for the new checks. |

### Gate inventory (already present — do NOT duplicate)

The CONTEXT "deterministic hard checks" list maps almost entirely onto gates that **already exist**:

| CONTEXT-requested check | Existing gate | Status |
|--------------------------|---------------|--------|
| proximity hop within threshold | `travelPacing` (gate 17) — haversine, `MAX_DRIVE_MIN=25`, `AVG_KMH=30`, **skips pairs missing coords** | EXISTS. ALIGN threshold to PLAN-01's hop-km; add explicit hard hop-distance variant. |
| every stop open at slot time | `openAtArrival` (gate 15) — wraparound-aware, **skips stops missing hours** | EXISTS. |
| budget sum ≤ stated | `budgetRealism` (gate 13) — total ≤ budget × 1.10 | EXISTS. |
| schedule monotonic (times increase) | **MISSING** | ADD. No gate currently asserts `start_time[i] + duration + drive ≤ start_time[i+1]`. |
| NO hallucinated venues (place_id in `places`) | **MISSING** (gates read the fixture's own frozen stops; there is no live-`places` resolution) | ADD for live mode (see below). |

### The 4 EXTEND tasks for EVAL-01

1. **Add `scheduleMonotonic` gate (critical):** assert each stop's `start_time` strictly increases and that `start_time[i] + duration_min[i] + drive[i→i+1] ≤ start_time[i+1]` (no overlap, no time travel). Reuse the existing `parseTime` helper in `gates.ts`. Pure, no new deps.

2. **Add `noHallucinatedVenue` check (critical, live-mode):** in **dry mode** the fixture *is* the ground truth (no hallucination possible — the writer only writes copy over frozen place_ids). The real teeth are in `--live` mode where generation runs against a real/seeded `places` snapshot: assert every emitted `place_id` resolves in the pinned `places` fixture/snapshot for that city. This is the anti-fabrication gate; it belongs in the live runner, not the pure gate set.

3. **Cold-city fixture set + `unverified_rate` reporting:** create `fixtures/dategen/coldcity-v0/` with fixtures that mirror a Foursquare-warmed cold city — **deliberately thin**: some stops with `lat/lng: null` and/or `opens/closes: null`. Add `unverified_rate` to `FixtureResult`/`EvalReport` (% of stops with null coords/hours). Production already computes this exact metric (`computeUnverifiedRate` in `pipeline.ts:62`, module `unverified-rate.ts`) — **reuse that function's logic** so the eval metric and the production metric are identical. Add a `UNVERIFIED_RATE_THRESHOLD` regression check so the cold city can't read green while half its stops are unverifiable.

4. **CI wiring (net-new):** there is **no `.github/workflows/`**. Add one. The deterministic layer (`pnpm --filter @after5/date-quality eval`, dry mode) needs **no API key** and hard-fails on regression — run on every PR touching `generate-plan/` or `date-quality/`. The Opus judge (`--live`) is a separate, advisory, warn-threshold step (scheduled or label-gated) so a flaky judge never blocks a merge.

### How the harness invokes generation deterministically for a fixture city

**Use the existing dry mode + injected `InvokeLLM` seam — do NOT mock the Anthropic SDK and do NOT call deno.**

- **Hard checks (CI-blocking):** run in **dry mode**. `runEval` with no LLMs synthesizes a deterministic house-writer (`buildDryWritten`) and a fixed judge (`dryJudgeLLM`). The gates run against the fixture's *frozen* stops — fully reproducible, zero network, no key. This is what CI runs.
- **Live judge (advisory):** pass a real `judgeLLM: InvokeLLM` backed by Anthropic (Opus). The seam is `{system,user}=>Promise<string>`; a thin adapter calls `client.messages.create` and returns the text. The package itself **never imports the SDK** (deliberate — see `writingPass.ts:30-32`), so the adapter lives in the script/CI layer, in Node, against the **node** `@anthropic-ai/sdk` (NOT the Deno `npm:` specifier).
- **The `@anthropic-ai/sdk` local-test gap (Phase 8 hit this):** `prompt.ts` does `import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0'` — the `npm:` prefix is **Deno-only and will not resolve under Node/vitest**. The eval therefore **cannot import `prompt.ts` directly**. `writingPass.ts` already documents this and re-implements an equivalent prompt locally. **Do not try to import the Deno edge module into the Node package.** For `--live` generation against the real writing pass, either (a) keep using the re-implemented prompt in `writingPass.ts`, or (b) execute the actual generation via the deployed/served edge function and feed its output into the gates. Recorded-fixture (pinned `writtenSample`) is the cleanest for regression — the package already supports `fixture.writtenSample` (graded verbatim in dry mode).

---

## Standard Stack

### Core (all already installed — no new packages)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | **0.40.1** (verified in-tree at `.deno/@anthropic-ai+sdk@0.40.1`) | Tool-use copy pass (Sonnet), improve-loop (Haiku), eval judge (Opus) | Already the project's LLM client; edge imports `npm:@anthropic-ai/sdk@^0.40.0` |
| `vitest` | 2.1.8 | date-quality unit tests + gates | Project standard runner; package already uses it |
| `vite-node` | ^2.1.9 | eval CLI execution (`scripts/eval-dategen.ts`) | Already wired in `package.json` `eval` script |
| `zod` | 3.23.8 | edge-fn input validation (improve-loop endpoint) | Project standard; `generate-plan/index.ts` already uses it |

### Model split (verified against GENERATION.md, Anthropic docs 2026-06-05)
| Model | ID | Use | Cost |
|-------|-----|-----|------|
| Sonnet 4.6 | `claude-sonnet-4-6` | Generation copy pass (3 itineraries) | ~1¢/gen `[CITED: GENERATION.md]` |
| Haiku 4.5 | `claude-haiku-4-5` | Single-stop rewrite, NL-tweak parse | <$0.001/call `[CITED: GENERATION.md]` |
| Opus 4.8 | `claude-opus-4-8` | Eval judge, OFFLINE only | $5/$25 per MTok `[CITED: GENERATION.md]` |

**No `npm install` required.** Every dependency this phase needs is already in the lockfile. If a tool-use helper or a richer assertion lib is proposed, gate it behind `checkpoint:human-verify`.

---

## Package Legitimacy Audit

> No external packages are installed in this phase. All dependencies (`@anthropic-ai/sdk@0.40.1`, `vitest`, `vite-node`, `zod`) already exist in the lockfile and were installed in prior phases.

| Package | Registry | Disposition |
|---------|----------|-------------|
| `@anthropic-ai/sdk` | npm | Already present (0.40.1 in-tree, edge pins `^0.40.0`) — no new install |
| (none new) | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs).
**Packages flagged as suspicious [SUS]:** none.

*slopcheck not run — there is nothing to install. If the planner introduces a tool-use schema helper or ElevenLabs SDK, gate it behind `checkpoint:human-verify` and run the legitimacy gate then.*

---

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────── PLAN-01 (generate-plan edge fn) ────────────┐
 user taps "generate" ──► filterPlaces (Postgres + JS haversine radius)             │
                          ──► selectTopTemplates                                      │
                          ──► buildItineraryFromTemplate  ◄── HOP-GATE replaces      │
                          │     (per slot: match→score→top-K pick)   clusterCompatible│
                          ──► injectDelighter / fixAdjacency / sequence rules         │
                          ──► writeItineraries ──► Anthropic TOOL-USE (Sonnet)        │
                          │       forced tool_choice → schema-valid copy              │
                          ──► photo scrub                                             │
                          ──► persist (itineraries.stops jsonb)                       │
                          │     └─► SOUND-01: vibe_tags && lateral → ambient_sound_id │
                          └─────────────────────────────────────────────────────────┘
                                              │
   PLAN-02 improve loop ◄──────────────────── persisted itinerary
     ├─ swap stop i:  buildItineraryFromTemplate (hold others, exclude used)
     │                 → re-validate hop/hours/budget → Haiku rewrites stop i copy
     ├─ NL tweak:     Haiku tool-use parses text → {budget,vibe,time} knobs
     │                 → re-run pipeline with knobs → re-validate
     └─ persist:      update_itinerary_stops RPC (re-derives totals, clamps ≤12)

   EVAL-01 (offline, @after5/date-quality, Node/vitest — NEVER deno) ───────────────┐
     fixtures (kelowna-v0 + coldcity-v0) ──► runEval                                  │
       ├─ writing pass (dry: house-writer | live: InvokeLLM seam)                     │
       ├─ DETERMINISTIC GATES (hard-fail): travelPacing, openAtArrival,               │
       │    budgetRealism, +scheduleMonotonic(NEW), +noHallucinatedVenue(NEW,live)    │
       ├─ LLM JUDGE (Opus, advisory warn-threshold): 6-dim rubric                     │
       ├─ unverified_rate per city (NEW, reuse computeUnverifiedRate)                 │
       └─ baseline diff → exit 1 on regression  ◄── CI gate (.github/workflows, NEW)  │
                                                                                       ┘
```

### Pattern 1: Anthropic tool-use forced output (PLAN-01)
**What:** Replace `parseLLMResponse` (fence-strip + `JSON.parse` + retry) with a forced tool call. The model emits structured args validated by the API, not free text.
**When to use:** The `writeItineraries` copy pass in `prompt.ts`.
**Verified shape (@anthropic-ai/sdk 0.40.1, `client.messages.create`):**
```typescript
// Source: @anthropic-ai/sdk 0.40.1 (in-tree) + prompt.ts current call site (lines 131-145)
const response = await client.messages.create({
  model,                    // claude-sonnet-4-6
  max_tokens: 4096,
  temperature: 0.7,
  system: [{ type: 'text', text: buildSystemPrompt(city), cache_control: { type: 'ephemeral' } }],
  tools: [{
    name: 'emit_itineraries',
    description: 'Emit the written copy for each assembled itinerary. Never change place_id values.',
    input_schema: {
      type: 'object',
      properties: {
        itineraries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              template_id: { type: 'string' },
              title: { type: 'string' },          // 8 words max — enforce in gate, not schema
              hook: { type: 'string' },           // 12 words max
              why_it_works: { type: 'string' },   // 3 sentences max
              stops: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    place_id: { type: 'string' },
                    what_to_do: { type: 'string' },
                  },
                  required: ['place_id', 'what_to_do'],
                },
              },
            },
            required: ['template_id', 'title', 'hook', 'why_it_works', 'stops'],
          },
        },
      },
      required: ['itineraries'],
    },
  }],
  tool_choice: { type: 'tool', name: 'emit_itineraries' },   // FORCED
  messages: [{ role: 'user', content: buildUserMessage(input) }],
});

// Extract the tool_use block instead of parsing text:
const toolUse = response.content.find((b) => b.type === 'tool_use');
if (!toolUse || toolUse.type !== 'tool_use') { /* keep the deterministic fallback */ }
const written = (toolUse.input as { itineraries: LLMItineraryWriting[] }).itineraries;
```
**Keep:** `mergeWriting`, `patchEmptyStops`, `buildFallbackWhatToDo`, the `cache_control` ephemeral system prompt, and the empty-`what_to_do` fallback (defense-in-depth — tool-use guarantees shape, not non-emptiness). **Delete:** `parseLLMResponse` and the fence-strip logic. `[ASSUMED]` length-as-schema is unenforceable — keep length checks in the eval gates (`titleLength` etc. already exist).

### Pattern 2: Haversine hop-gate (PLAN-01)
**What:** Replace the `drive_cluster` string-equality adjacency check with a real consecutive-stop distance gate.
**Current code (`scoring.ts:102-112`):**
```typescript
function clusterCompatible(picked: Place[], candidate: Place): boolean {
  if (picked.length === 0) return true;
  const clusters = new Set(picked.map((p) => p.drive_cluster));
  if (candidate.drive_cluster === 'multiple') return true;
  for (const c of clusters) { if (c === candidate.drive_cluster) return true; if (c === 'multiple') return true; }
  return false;
}
// used at scoring.ts:141:  if (!clusterCompatible(alreadyPicked, p)) score -= 5;
```
**Target:** a hop-distance predicate on the *previous picked stop* (consecutive), gating against a named constant.
```typescript
// reuse haversine — NOTE: haversineKm in places-filter.ts is MODULE-PRIVATE (line 118).
// Either export it there, or add an exported helper. withinRadius IS exported (line 107).
const MAX_HOP_KM = 2.0;   // tunable, named constant (CONTEXT: ~2km walkable/short drive)
function withinHop(prev: Place | undefined, cand: Place, maxKm = MAX_HOP_KM): boolean {
  if (!prev) return true;
  if (prev.lat == null || prev.lng == null || cand.lat == null || cand.lng == null) {
    return false;  // DATA-03 fail-loud: unknown coords must NOT silently pass (matches withinRadius:114)
  }
  return haversineKm(prev.lat, prev.lng, cand.lat, cand.lng) <= maxKm;
}
```
**Back-compat:** `drive_cluster` column stays for display; `estimateDriveMin` (`scoring.ts:354`, uses drive_cluster for drive-time labels) MAY stay as a display estimate but should be reconciled with the hop-gate so the displayed drive time and the gate agree. **Decision point (Claude's discretion):** whether the hop-gate is a hard reject in the pick loop (return early, like `clusterCompatible` could) or a strong score penalty + post-validation reject. GENERATION.md recommends **pre-filter + post-validate + repair** — reject any plan with a hop over budget, repair by swapping the far stop. Mirror the fail-loud `withinRadius` convention: null coords = excluded, not passed.

### Pattern 3: Improve-loop single-slot re-pick (PLAN-02)
**What:** Re-pick one stop holding the rest fixed; rewrite only that stop's copy.
**Reusable machinery:** `buildItineraryFromTemplate` (`scoring.ts:242`, exported) already does per-slot match→score→top-K pick and accepts `usedAcrossBatch: Set<string>` for exclusion. For a single-slot re-pick, drive the same scorer for slot *i* with the *other stops' place_ids* in the exclusion set, then re-validate the new stop against neighbors *i-1*/*i+1* via the hop-gate. **Persist via `update_itinerary_stops`** (`m3` migration) — it re-derives `total_cost_pp`/`total_duration_min`, clamps ≤12 stops, validates each stop has `place_name`/`start_time`/non-negative cost+duration, and checks ownership (`user_id = auth.uid()`). **This RPC is the only write path — do not invent another.**
**Copy refresh:** one Haiku tool-use call rewrites the swapped stop's `what_to_do` (and optionally nudges `why_it_works` so it doesn't name a stop that's gone — see Pitfall 4).

### Pattern 4: NL-tweak intent → scoring knobs (PLAN-02)
**What:** Haiku parses free text into a knob delta; code re-runs the pipeline.
**Mapping (Claude's discretion on exact knobs):**
| Phrase class | Knob | Mechanism |
|--------------|------|-----------|
| "cheaper" | `budget_per_person ↓` (or greedy-swap most expensive stop) | re-run pipeline / single-swap, deterministic |
| "later" / "evening" | `time_of_day` / `start_at` shift → re-run hours filter | deterministic, `effectiveStartAt` already derives from `time_of_day` |
| "more romantic" / "adventurous" | map phrase → `vibe[]` tags + `intent` → re-score | one Haiku tool-use call: text → `{vibe, intent, budget_delta}`; code re-runs |
**The rule (from GENERATION.md):** the LLM classifies the wish; code grants it. Never let the LLM free-form rewrite structure.

### Pattern 5: Vibe-matched ambient auto-pick (SOUND-01)
**What:** On generation/persist, set `ambient_sound_id` to the best vibe-overlapping active sound.
**Reuse the EXACT feed lateral** (`browse_feed_for_viewer`, m4 migration, lines 40-51):
```sql
-- the proven overlap pick, already live in the feed:
select s.id from ambient_sounds s
where s.is_active = true and s.vibe_tags && <itinerary.vibe_tags>
order by s.sort_order desc, s.id
limit 1
```
On persist, run this against the itinerary's `vibe_tags` and write the result to `date_instances.ambient_sound_id` (column exists, m4 `date_instances_ambient` migration). Sound↔cover cohere because both derive from the night's vibe. **No new pick logic — lift the lateral.**

### Pattern 6: New ambient loop generation (SOUND-01)
**What:** Generate 6-10 more loops via ElevenLabs Sound Effects, upload to `ambient-sounds` bucket, seed rows.
**Mirror the proven v1.0 recipe** (m4 `ambient_sounds_real_paths` migration header + MEMORY): `loop:true`, 15s, mono **m4a (AAC)**, path `<vibe>/<slug>.m4a` in the public `ambient-sounds` bucket. Upload requires **service_role JWT** (the bucket has no authenticated write policy; only RLS-bypass writes — m4 `ambient_sounds.sql:22`). Seed rows are **upsert-on-name** (`ambient_sounds_name_key` unique index) so re-running is idempotent. `duration_sec` must be 5-120 (table check). The 10 base vibes already exist (cozy/nightlife/romantic/adventurous/art/late-night/chill/foodie/outdoorsy/classy) — new loops should fill gaps in the itinerary `vibe_tags` taxonomy, not duplicate.

### Anti-Patterns to Avoid
- **Importing the Deno edge module into the Node eval.** `prompt.ts`'s `npm:@anthropic-ai/sdk` import will not resolve under vitest. Use the `writingPass.ts` seam or recorded `writtenSample`.
- **Letting the LLM pick or reorder places.** Preserve the invariant. Tool-use writes copy over frozen `place_id`s only.
- **A new write path for the improve loop.** `update_itinerary_stops` is the boundary.
- **Re-implementing the ambient pick.** Lift the feed lateral verbatim.
- **Treating null coords/hours as "pass" in the cold-city eval.** Surface as `unverified_rate`, gate on it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Eval harness | A new eval package | EXTEND `@after5/date-quality` | 19 gates, judge, baseline-diff, dry mode, CLI all exist |
| JSON-schema output parsing | Fence-strip + try/catch JSON.parse | Anthropic tool-use forced `tool_choice` | API guarantees schema-valid args |
| Itinerary persist + total recompute | New UPDATE path | `update_itinerary_stops` RPC | Validates shape, clamps, re-derives totals, checks ownership |
| Ambient vibe pick | New overlap query | The `browse_feed_for_viewer` lateral | Proven live; sound↔cover cohere by shared vibe |
| Haversine distance | New geo math | `haversineKm` (places-filter.ts / gates.ts both have it) | Already implemented twice; export one |
| `unverified_rate` | New metric calc | `computeUnverifiedRate` (`unverified-rate.ts`) | Production already computes the exact metric |
| Deterministic test invocation | Mocking the Anthropic SDK | dry mode + injected `InvokeLLM` seam | Zero network, reproducible, no key |

**Key insight:** Nearly every piece EVAL-01 and SOUND-01 "need" already exists in the repo. The phase's real net-new code is: a tool-use call shape, a hop-gate predicate, a single-slot re-pick wrapper, an NL-knob parser, 1 cold-city fixture set, 2 new gates, `unverified_rate` plumbing, a CI workflow file, and N ambient loops. Everything else is reuse.

---

## Runtime State Inventory

> This phase is mostly additive (new code + new fixtures + new sound rows), but `drive_cluster` demotion and the ambient seed touch stored/registered state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `places.drive_cluster` column (hand-authored Kelowna labels) — **demoted from gate to display, NOT dropped**. No data migration needed; column stays. `date_instances.ambient_sound_id` — newly auto-set on generation (was host-pick / null before). | Code edit only (gate logic); no DDL drop. New rows get auto-picked sound; existing rows unaffected unless backfilled (out of scope). |
| Live service config | None — generation is edge-fn code, no external service config embeds Phase-9 strings. | None — verified: SOUND-01 uses the existing `ambient-sounds` bucket + table, no new bucket/service. |
| OS-registered state | None. | None — verified: no cron/task changes. |
| Secrets/env vars | `ANTHROPIC_API_KEY` (already set, used by generate-plan). Eval `--live` judge needs it in CI as a secret (advisory step only). ElevenLabs key for one-time sound generation (local/manual, not runtime). | Add `ANTHROPIC_API_KEY` as a CI secret for the advisory judge step only; hard-check CI needs no key. |
| Build artifacts | `packages/date-quality/baselines/dategen/baseline-v0.json` — regenerated after adding gates/fixtures (the regression diff is against it). `eval-results/` — gitignored run output. | Regenerate baseline via `eval:update` after the new checks/fixtures land; commit it. |

**Ambient sound storage:** new loops are new objects in the existing `ambient-sounds` bucket + new `ambient_sounds` rows (upsert-on-name) — uploaded once with a service_role JWT, not at runtime. This is the only "registered state" addition and it is idempotent.

---

## Common Pitfalls

### Pitfall 1: The cold-city eval reads green vacuously (THE biggest risk)
**What goes wrong:** The existing structural gates **skip missing data** — `travelPacing` (`gates.ts:737-744`) `continue`s on null coords; `openAtArrival` (line 651) `continue`s on null hours. A cold-city fixture built from thin Foursquare-style data will have null fields, so those gates pass without checking anything. The eval certifies a quality bar the product doesn't hit in new markets.
**Why it happens:** "pass on null" is correct for keeping curated generation alive, but it's a silent quality leak exactly where the corpus is weakest.
**How to avoid:** Make `unverified_rate` a first-class scored signal with its own regression threshold. Reuse `computeUnverifiedRate`. The cold-city fixture must FAIL the suite if its unverified_rate exceeds the threshold, not pass because the gates skipped. Mirror the production fail-loud convention (`withinRadius`/the hop-gate exclude null coords rather than pass them).
**Warning signs:** Cold-city fixtures showing 0 failed gates AND a high unverified_rate.

### Pitfall 2: The `npm:@anthropic-ai/sdk` Deno/Node split (Phase 8 hit this)
**What goes wrong:** `prompt.ts` imports `npm:@anthropic-ai/sdk@^0.40.0` (Deno specifier). Any attempt to import `prompt.ts` from the Node eval package (vitest/vite-node) fails to resolve.
**Why it happens:** `npm:` is Deno-only; the eval runs under Node.
**How to avoid:** Never import the edge module into the eval. Use `writingPass.ts`'s local prompt + injected seam, or pin a recorded `writtenSample` per fixture. For the tool-use migration in `prompt.ts` itself (which runs in Deno), the SDK call is fine — it's only the *cross-runtime import* that breaks. Keep the eval's prompt re-implementation in sync manually (documented TODO in `writingPass.ts`).
**Warning signs:** `Cannot find module 'npm:...'` under vitest.

### Pitfall 3: Tool-use schema drift vs the merge logic
**What goes wrong:** `mergeWriting`/`patchEmptyStops` match LLM output to source itineraries by `template_id` and stops by index-or-`place_id`. If the tool schema renames or restructures, the merge silently drops copy and everything falls back to deterministic.
**Why it happens:** The schema and the merge are two sources of truth.
**How to avoid:** Keep the tool `input_schema` field names **identical** to `LLMItineraryWriting` (`template_id`/`title`/`hook`/`why_it_works`/`stops[].place_id`/`what_to_do`). Add a test asserting a tool-use response merges cleanly. The eval's `what_to_do_quality` gate (critical) catches mass-fallback regressions.
**Warning signs:** `fallback_count` spikes after the migration; eval `whatToDoQuality` fails.

### Pitfall 4: Improve-loop incoherence — stale copy after a swap
**What goes wrong:** After swapping stop *i*, `why_it_works` still names the old venue, or the new stop breaks the hop-gate / pushes the budget over.
**Why it happens:** Copy and structure drift apart; the swap doesn't re-validate.
**How to avoid:** After any swap/tweak, **re-run the hop-gate + budget sum + hours check** (CONTEXT requires this). If it fails, surface it ("this swap puts you 8km from the next stop") rather than persisting. Trigger a Haiku refresh of `why_it_works` + the changed `what_to_do` so prose doesn't name a removed venue. The `update_itinerary_stops` RPC re-derives totals deterministically, so cost/time never silently drift — only prose can.
**Warning signs:** `why_it_works` references a venue not in `stops`.

### Pitfall 5: Judge flakiness/cost in CI
**What goes wrong:** The Opus judge is stochastic and costs money; running it as a blocking CI gate causes flaky failures and bills per PR.
**Why it happens:** LLM judges have position/verbosity bias and run-to-run variance.
**How to avoid:** CONTEXT locks this: deterministic gates **hard-fail**, the judge is **advisory warn-threshold only**. Run the judge on a schedule or label, not every PR. Use the baseline-diff's `MEAN_DROP_THRESHOLD` so only a real regression warns. The judge rubric already has anchored 1-5 examples (`judge.ts` SYSTEM_PROMPT) which cuts variance.
**Warning signs:** Judge scores swinging >0.5 between identical runs.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.8 (Node env for `packages/*`, per `vitest.workspace.ts`) |
| Config file | `vitest.config.ts` + `vitest.workspace.ts` (root); `packages/date-quality/package.json` test script |
| Quick run command | `pnpm --filter @after5/date-quality test` (gate unit tests) |
| Eval run command | `pnpm --filter @after5/date-quality eval` (dry, exits 1 on regression) |
| Full suite command | `pnpm test` (root vitest) + `pnpm typecheck` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAN-01 | tool-use returns schema-valid copy that merges cleanly | unit (mock SDK response) | `pnpm --filter @after5/date-quality test` (add merge test) | ❌ Wave 0 (new test) |
| PLAN-01 | hop-gate rejects >2km consecutive hops, passes ≤2km, excludes null coords | unit | new test in `generate-plan` deno tests | ❌ Wave 0 |
| PLAN-02 | single-slot re-pick holds other stops, excludes used, re-validates hop/budget/hours | unit | deno test | ❌ Wave 0 |
| PLAN-02 | NL-tweak parse maps phrases → knobs | unit (mock Haiku) | deno test | ❌ Wave 0 |
| EVAL-01 | scheduleMonotonic gate catches time-travel/overlap | unit | `pnpm --filter @after5/date-quality test` | ❌ Wave 0 (new gate test) |
| EVAL-01 | cold-city fixture surfaces unverified_rate + fails on threshold | integration | `pnpm --filter @after5/date-quality eval` | ❌ Wave 0 (new fixtures + report field) |
| EVAL-01 | deterministic suite exits 1 on regression (CI gate) | CI | `.github/workflows/*.yml` | ❌ Wave 0 (no workflows dir) |
| SOUND-01 | generation auto-sets ambient_sound_id by vibe overlap | integration | deno/RPC test against the lateral | ❌ Wave 0 |
| SOUND-01 | new ambient rows upsert idempotently on name | sql | `pnpm db:test` (sql test) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @after5/date-quality test` (fast, gate units) + relevant deno test.
- **Per wave merge:** `pnpm --filter @after5/date-quality eval` (dry, full fixture suite + baseline diff) + `pnpm typecheck`.
- **Phase gate:** Full `pnpm test` green + eval dry-mode PASS (no regressions) before `/gsd:verify-work`. Advisory Opus judge run reviewed, not blocking.

### Wave 0 Gaps
- [ ] `.github/workflows/eval.yml` — deterministic eval on PRs touching `generate-plan/` or `date-quality/` (dry, no key, hard-fail). **No `.github/workflows/` directory exists.**
- [ ] `packages/date-quality/src/gates.ts` — add `scheduleMonotonic` (critical) + register in `GATES`.
- [ ] `packages/date-quality/src/runEval.ts` — add `unverified_rate` to `FixtureResult`/`EvalReport` + per-city grouping + `UNVERIFIED_RATE_THRESHOLD` regression check.
- [ ] `packages/date-quality/fixtures/dategen/coldcity-v0/` — cold-city fixtures with deliberately thin (null coord/hours) stops.
- [ ] `packages/date-quality/src/judge.ts` — make `JUDGE_CITY` a per-fixture param.
- [ ] Live `noHallucinatedVenue` resolution against a pinned `places` snapshot (live runner, not pure gate).
- [ ] `packages/date-quality/baselines/dategen/baseline-v0.json` — regenerate via `eval:update` after the above.
- [ ] generate-plan deno tests for hop-gate, single-slot re-pick, NL-knob parse, tool-use merge.

---

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `update_itinerary_stops` re-checks `auth.uid()` + ownership (`user_id = v_actor`); improve-loop endpoint must too |
| V3 Session Management | no (reuses existing Supabase session) | — |
| V4 Access Control | yes | RLS on `itineraries`/`date_instances`; `ambient_sounds` write = service_role only; improve-loop RPC gated to owner |
| V5 Input Validation | yes | zod on improve-loop edge input; `update_itinerary_stops` validates stop shape; NL-tweak text length-capped before Haiku |
| V6 Cryptography | no | — |

### Known Threat Patterns for generate-plan + eval
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via NL-tweak free text | Tampering | Haiku output is constrained to a knob schema (tool-use), never executed as instructions; code grants only known knobs |
| Improve-loop edits another user's itinerary | Elevation of Privilege | `update_itinerary_stops` ownership check (`42501` if not owner) |
| Hallucinated venue persisted | Tampering | `noHallucinatedVenue` check (place_id must resolve in `places`); LLM never picks places |
| Ambient bucket public-write | Tampering | No authenticated write policy; service_role (RLS-bypass) only (m4 migration) |
| `ANTHROPIC_API_KEY` leak in CI | Info Disclosure | Hard-check CI needs no key; judge step uses a CI secret, advisory only |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw-JSON + fence-strip + `JSON.parse` retry | Anthropic tool-use forced `tool_choice` | This phase (PLAN-01) | Schema-valid output; deletes fragile parse code |
| `drive_cluster` string adjacency | Haversine consecutive-hop gate | This phase (PLAN-01) | Generalizes to non-curated cities; real proximity |
| No improve loop (full regen only) | Single-slot re-pick + NL-knob tweaks | This phase (PLAN-02) | Fast, cheap, coherent customization |
| Kelowna-only eval (would read green in new markets) | + cold-city fixture + unverified_rate | This phase (EVAL-01) | Catches the silent cold-city collapse |
| Host-pick-or-null ambient | Auto vibe-matched ambient on generation | This phase (SOUND-01) | Every generated date gets coherent sound |

**Deprecated/outdated:**
- `parseLLMResponse` (`prompt.ts:327`) — replaced by tool-use extraction.
- `clusterCompatible` (`scoring.ts:102`) as an adjacency *gate* — demoted; `drive_cluster` survives for display only.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@anthropic-ai/sdk@0.40.1` tool-use shape (`tools`/`tool_choice`/`input_schema`/`content.find(type==='tool_use')`) matches the documented 0.40.x API | Tool-use migration | Medium — verify the exact `tool_use` block extraction against the installed SDK's TS types before coding; the call site otherwise mirrors the existing `messages.create` |
| A2 | Model IDs `claude-sonnet-4-6`/`claude-haiku-4-5`/`claude-opus-4-8` are current and tool-use-capable | Model split | Low — carried from GENERATION.md (verified 2026-06-05); confirm in env `ANTHROPIC_MODEL` |
| A3 | `haversineKm` in `places-filter.ts:118` is module-private and must be exported (or duplicated) to reuse in the hop-gate | Hop-gate | Low — verified by grep (only `withinRadius` is exported); a duplicate already exists in `gates.ts` |
| A4 | Schema-level string length (8-word title etc.) is NOT enforceable by JSON-schema; length stays in eval gates | Tool-use migration | Low — eval already has `titleLength`/`hookLength` gates |
| A5 | Tunable hop threshold ~2km; exact value + per-type weighting is Claude's discretion | Hop-gate | Low — CONTEXT explicitly grants discretion |

---

## Open Questions

1. **Hard-reject vs penalty for the hop-gate in the pick loop.**
   - What we know: `clusterCompatible` is currently a soft `-5` score penalty (`scoring.ts:141`), not a hard reject; GENERATION.md recommends pre-filter + post-validate + repair.
   - What's unclear: whether PLAN-01 should make the hop a hard reject in `buildItineraryFromTemplate` (risking "no valid plan" on thin pools) or keep a strong penalty + post-validation reject-and-repair.
   - Recommendation: post-validate + repair (swap the far stop for the nearest in-slot candidate) — preserves plan availability while guaranteeing the final plan passes the gate. Decide in planning.

2. **Cold-city fixture realism — how thin is realistic?**
   - What we know: Foursquare-warmed venues arrive with lat/lng but often no hours; curated Kelowna has both.
   - What's unclear: the exact null-field distribution to seed so the fixture is a faithful cold-city proxy, not a strawman.
   - Recommendation: model it on the Phase-8 Foursquare mapping (some stops full, some null-hours, few null-coords); set the `UNVERIFIED_RATE_THRESHOLD` from what a genuinely usable cold city should clear.

3. **Live `noHallucinatedVenue` source of truth.**
   - What we know: dry mode can't hallucinate (writer only writes copy over frozen ids). The check has teeth only in `--live` against a real `places` snapshot.
   - What's unclear: whether to pin a JSON `places` snapshot in the fixture dir or query a seeded local DB.
   - Recommendation: pin a JSON snapshot per city fixture set — keeps the eval offline and reproducible.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@anthropic-ai/sdk` | tool-use, improve loop, judge | ✓ (in-tree) | 0.40.1 | — |
| vitest / vite-node | eval + gate tests | ✓ | 2.1.8 / ^2.1.9 | — |
| `ANTHROPIC_API_KEY` | `--live` judge + real generation | ✓ (set, used by edge fn) | — | dry mode (no key) for hard checks |
| ElevenLabs Sound Effects | SOUND-01 loop generation | ✗ (manual/one-time, key not in repo) | — | reuse existing 10 loops; new loops are a manual content task |
| Supabase local stack | SOUND-01 seed test, RPC tests | ✓ (project standard) | PG17 | — |
| `.github/workflows/` | EVAL-01 CI gate | ✗ (directory does not exist) | — | none — must create |

**Missing dependencies with no fallback:**
- `.github/workflows/` — net-new; EVAL-01's CI gating requires creating it.

**Missing dependencies with fallback:**
- ElevenLabs key — new ambient loop generation is a one-time manual content task (not runtime). If unavailable at execution time, ship the auto-pick logic against the existing 10 loops and add new loops later.

---

## Sources

### Primary (HIGH confidence — direct codebase read)
- `packages/date-quality/src/{types,index,runEval,gates,judge,writingPass,score}.ts` + `scripts/eval-dategen.ts` + `__tests__/helpers.ts` — the existing eval package (assessed for keep/extend).
- `packages/date-quality/fixtures/dategen/kelowna-v0/` (30 fixtures, Kelowna-only) + `baselines/dategen/baseline-v0.json`.
- `supabase/functions/generate-plan/prompt.ts` (writing pass, `parseLLMResponse:327`, `messages.create:131`), `scoring.ts` (`clusterCompatible:102`, `isOpenAt:59`, `buildItineraryFromTemplate:242`, `estimateDriveMin:354`), `places-filter.ts` (`withinRadius:107`, private `haversineKm:118`), `providers/pipeline.ts` (`runPipeline:29`, `computeUnverifiedRate:62`).
- `supabase/migrations/`: `20260602140000_m3_update_itinerary_stops.sql`, `20260602120000_m4_ambient_sounds.sql`, `20260602120400_m4_browse_feed_ambient.sql` (the vibe lateral), `20260605121000_m4_ambient_sounds_real_paths.sql` (ElevenLabs recipe).
- `@anthropic-ai/sdk@0.40.1` package.json in-tree (`.deno/@anthropic-ai+sdk@0.40.1`); edge pins `npm:@anthropic-ai/sdk@^0.40.0`.
- `CLAUDE.md` (project constraints), `09-CONTEXT.md` (locked decisions).

### Secondary (decision-level, carried forward)
- `.planning/research/GENERATION.md` — constraint-first hybrid, tool-use recommendation, model split + pricing (verified against Anthropic docs 2026-06-05), the cold-city silent-degradation risk, improve-loop patterns.

### Tertiary (LOW confidence — needs validation at code time)
- Exact `@anthropic-ai/sdk@0.40.1` tool_use TS types (A1) — confirm against installed types before coding.

## Metadata

**Confidence breakdown:**
- date-quality assessment: HIGH — direct read of the full package; disposition is concrete.
- Tool-use migration: MEDIUM-HIGH — call shape verified against in-tree SDK + existing call site; exact `tool_use` extraction needs a types check (A1).
- Hop-gate: HIGH — both haversine impls and the target `clusterCompatible` read directly.
- Improve loop: HIGH — `buildItineraryFromTemplate` + `update_itinerary_stops` signatures confirmed.
- SOUND-01: HIGH — m4 infra, lateral, and ElevenLabs recipe all exist and are read.
- Pitfalls: HIGH — derived from observed skip-on-null gate behavior + the documented Deno/Node SDK gap.

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (stable; re-verify the SDK tool-use types if `@anthropic-ai/sdk` is bumped)

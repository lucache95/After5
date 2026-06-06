---
plan: 09-06
phase: 09-trustworthy-generation-eval-harness
status: partial
autonomous: false
requirements: [PLAN-01, PLAN-02, EVAL-01, SOUND-01]
tasks_total: 3
tasks_complete: 1
blocked_on: FOURSQUARE_API_KEY (cutover bundles with Phase 8) + ELEVENLABS audio gen
---

# Plan 09-06 Summary — Phase Gate (local-green DONE; prod cutover + visual-verify bundled into the Phase-8 key-gated cutover)

Orchestrator-owned checkpoint. Local verification complete + green; the prod-bound steps
defer into the single Phase-8 Foursquare-key-gated cutover (the `generate-plan` edge-fn deploy
carries BOTH phases' code, so they ship together).

## Task 1 — Local-green gate — DONE (green)
- `supabase db reset` replays all migrations incl. `20260606160000_sound01_ambient_loops_seed` — clean.
- **70 deno tests** (generate-plan tool-use/hop-gate/improve + foursquare + process-jobs) + **90 date-quality** unit + **593 web vitest** (incl. ImproveControls 6/6) + `pnpm typecheck` 6/6.
- **Eval dry-run PASSES the deterministic hard gate** (`pnpm --filter @after5/date-quality eval` → "PASS: no regressions", exit 0) — proximity/hours/schedule-monotonic/budget/no-hallucination + the cold-city `unverified_rate` threshold all hold over the gate-v0 golden set incl. the usable cold city.
- SQL tests green: `sound01_vibe_auto_pick` (the existing vibe-overlap lateral auto-picks a NEW track), `data01_places_fsq_source`.
- Gate sequencing note: `deno test --node-modules-dir=auto` clobbers the pnpm root node_modules — always `pnpm install --frozen-lockfile` before vitest (done here).

## Task 2 — Visual-verify @420px (improve UI) — DEFERRED into the cutover
The improve-loop UI (`ImproveControls` per-stop tweak + NL input in `/create`) renders only behind
a generated date; full @420px visual-verify happens when the live improve flow renders at the
bundled cutover. Behavior is unit-covered (ImproveControls 6/6) + built to DESIGN-SYSTEM (Barbiecore,
lowercase/dry, ≥44px taps).

## Task 3 — GATED PROD-APPLY + audio — DEFERRED (bundled with Phase 8's key-gated cutover)
Prod-bound Phase-9 changes ship together with Phase 8 once `FOURSQUARE_API_KEY` lands (the
`generate-plan` edge deploy carries Phase-8 Foursquare + Phase-9 tool-use/hop-gate/improve):
- apply `20260606160000_sound01_ambient_loops_seed` (8 new ambient rows),
- deploy `generate-plan` + `process-jobs` edge fns,
- generate + upload the 8 new ambient audio loops (ElevenLabs recipe in `docs/superpowers/SOUND-GENERATION.md`; service_role JWT to the `ambient-sounds` bucket) — needs the ElevenLabs key,
- wire the CI eval gate's optional advisory live-judge (`ANTHROPIC_API_KEY` repo secret),
- prod advisor + spot-check + the live @420px visual-verify of the improve flow.
Tracked in `.planning/todos/pending/phase8-prod-cutover-and-preseed-wiring.md` (extended for Phase 9).

## Net: Phase 9 BUILD complete + locally green (PLAN-01/02, EVAL-01 done; SOUND-01 rows + verify done, audio gated). Prod cutover bundled with Phase 8.

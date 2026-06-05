# Phase 9 — Validation Map

**nyquist_compliant: true** — every `<verify>` carries an `<automated>` command. The eval harness (`@after5/date-quality`, dry mode) is itself much of the validation: it grades generation output with 20 deterministic gates + the cold-city unverified_rate threshold + a baseline regression diff, and is wired as a CI hard-gate. The plans below add the missing structural checks and the cold-city teeth, so passing the eval IS the proof that PLAN-01/EVAL-01 hold.

**Mode:** MVP (surgical refactors + narrow eval additions). Workflow: `tdd_mode=false` (task-level `tdd="true"` used opportunistically on code-producing tasks), `human_verify_mode=end-of-phase` (visual-verify folded into the phase gate as a `checkpoint:human-verify`; one in-plan `<human-check>` on the UI task), `security_enforcement=true` (threat_model on every plan).

## Per-Task Verify Map

| Plan | Task | REQ | Automated verify | Hard-fail? |
|------|------|-----|------------------|-----------|
| 09-01 | tool-use copy pass | PLAN-01 | `deno test prompt.test.ts` | yes (deno + CI) |
| 09-01 | haversine hop-gate + repair | PLAN-01 | `deno test scoring.test.ts places-filter.test.ts` | yes |
| 09-02 | ambient seed migration | SOUND-01 | `supabase db reset` + advisor | yes (gate) |
| 09-02 | vibe-match auto-pick on persist | SOUND-01 | `deno test persist.test.ts` | yes |
| 09-03 | scheduleMonotonic gate | EVAL-01 | `pnpm --filter @after5/date-quality test -- gates` | yes (CI) |
| 09-03 | cold-city fixtures + unverified_rate | EVAL-01 | `pnpm --filter @after5/date-quality test -- runEval` | yes (CI) |
| 09-04 | JUDGE_CITY param + live noHallucinatedVenue | EVAL-01 | `pnpm --filter @after5/date-quality test -- judge` | yes |
| 09-04 | baseline regen + CI workflow | EVAL-01 | `pnpm --filter @after5/date-quality eval` + `.github/workflows/eval.yml` exists | yes (CI gate itself) |
| 09-05 | single-slot re-pick + NL-knob + re-validate | PLAN-02 | `deno test improve.test.ts` | yes |
| 09-05 | improve UI in /create | PLAN-02 / Area 4 | `pnpm --filter web test -- ImproveControls` + `typecheck`; `<human-check>` @420px | yes (test); visual at gate |
| 09-06 | local-green full suite + eval | all | `pnpm typecheck && pnpm test && pnpm --filter @after5/date-quality eval && supabase db reset` | yes (gate) |
| 09-06 | visual-verify @420px | PLAN-02 / Area 4 | `checkpoint:human-verify` | blocking |
| 09-06 | gated prod-apply + audio upload | SOUND-01 | `checkpoint:human-action` (prod migration + advisor + service_role upload) | blocking |

## Lead-Risk Validation (THE biggest risk — cold-city vacuous green)

The explicit must-have + test: a deliberately-thin cold-city fixture (≥half its stops null-coord/null-hours) MUST flag an `unverified_rate` regression and FAIL the suite — it must NOT pass with 0 failed gates because `travelPacing`/`openAtArrival` `continue` on null data. Proven by:
- `09-03` runEval test: thin fixture → unverified_rate regression; usable cold city → clears `UNVERIFIED_RATE_THRESHOLD`.
- `09-03` parity test: eval unverified_rate == production `computeUnverifiedRate` for the same stops.
- `09-06` gate: confirms the thin cold-city regression is present in the dry eval run.

## Cross-Runtime Note (Pitfall 2)

The eval package (Node/vitest/vite-node) NEVER imports the Deno edge module (`prompt.ts` uses `npm:@anthropic-ai/sdk`, Deno-only). Edge tests run under `deno test`; package tests run under `pnpm --filter @after5/date-quality test`. The live Opus judge adapter lives in the script/CI layer (Node, node SDK, via the InvokeLLM seam). The two prompt re-implementations are kept in sync manually.

## Sampling Rate

- Per task: the task's `<automated>` command.
- Per wave: `pnpm --filter @after5/date-quality eval` (dry, full fixtures + baseline diff) + `pnpm typecheck`.
- Phase gate (09-06): full `pnpm test` + dry eval PASS + visual-verify @420px + gated prod-apply. Advisory Opus judge reviewed, not blocking.

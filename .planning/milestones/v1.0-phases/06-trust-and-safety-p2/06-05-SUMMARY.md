---
plan: 06-05
phase: 06-trust-and-safety-p2
status: complete
autonomous: false
requirements: [REQ-E17, REQ-E18, REQ-E19]
tasks_total: 3
tasks_complete: 3
prod_applied: 2026-06-05
---

# Plan 06-05 Summary — Phase Gate (local apply + visual-verify + gated prod-apply)

Checkpoint plan; orchestrator-owned. All 3 tasks complete.

## Task 1 — [BLOCKING] local apply + advisor + full suite + SQL/E2E — DONE
- `supabase db reset` replayed all migrations in order. Caught + fixed two real issues the local-apply gate exists for:
  - **Migration version collision:** the phase-6 migrations were authored at `20260605120000/120100`, colliding with existing `e11_targeting_cols`/`e12_queue` (duplicate `schema_migrations` key). Renumbered to a unique post-e16 block `20260606130000/130100/130200` (commit `fix(06): renumber…`).
  - **reliability_score overflow:** `numeric(4,2)` (max 99.99) couldn't hold the 0-100 score; widened to `numeric(5,2)` via drop+recreate of the dependent `public_profile_card` view (commit `fix(06-05): widen reliability_score…`).
  - **safety_checkin gap:** `dispatch_safety_checkin` guarded on `lst <> 'active'`, dropping post-date check-ins after the lock completes; fixed to cover active+completed, drain only on cancelled/no_show (commit `fix(06-05): safety check-in also fires for completed dates`).
- Types regenerated from the local schema (`packages/types/src/database.ts`).
- All 4 SQL assertion scripts green: `e17_recompute_reliability` (no_show→0, 3 showed_up→100.00, <3→NULL, idempotent), `e18_chat_rls_denies_nonparty`, `e19_producers` (both lock RPCs enqueue both jobs incl. reciprocal), `e19_safety_handlers` (both dispatch, poison-loop drain, no-ack no-auto-cancel).
- Unit 118/118; `tsc --noEmit` clean; e18 nav-edges e2e 3/3; lock-RPC regression (5b-happy-path + reveal-ceremony) 4/4. Three e18-spec test-only fixes (service-role fallback, pre-lock fixture offer status, banner-scoped heading selector) committed.

## Task 2 — Visual-verify @420px — DONE (PASS)
Orchestrator captured 5 PNGs (CAPTURE_VISUAL-guarded `apps/web/e2e/06-visual-capture.spec.ts`) and critiqued each vs 06-UI-SPEC:
- reliability badge — established (`✓ 94% · reliable`, secondary, no red) — PASS
- reliability badge — new (`new here` blush + `no rated dates yet`, encouraging) — PASS
- reconfirm card (`still on?` soft, `yep, still on`/`gotta bail`, no red, no auto-cancel) — PASS
- check-in card (`all good?` + quiet `something's wrong`, warm) — PASS
- chat nav edges (two quiet right-slot icon controls, reveal-gated) — PASS
PNGs in `__visual__/`.

## Task 3 — GATED PROD-APPLY — DONE (2026-06-05, explicit human approval)
Applied to prod `ufufmcpnysvwtutpbian` via MCP, after verifying prod was at the expected pre-phase-6 baseline (reliability_score numeric(4,2), only the badge view depends on it, lock RPCs at e16 state, new RPCs absent, enums present):
- e17 `recompute_reliability` + close_rating_window hook + reliability_score widen → prod ledger `20260605155607`
- e19 `dispatch_date_reconfirm` + `dispatch_safety_checkin` → `20260605155803`
- e19 lock-RPC producers (both RPCs re-CREATEd + safety enqueues) → `20260605155857`

**Post-apply verified:** reliability_score `numeric(5,2)`; recompute + 2 dispatch RPCs exist + not client-executable; close_rating_window hooks recompute; both lock RPCs carry day_of_reconfirm + safety_checkin + new_match + identity_revealed (reciprocal uses p_chosen_instance); safety_checkin covers completed; lock-RPC `authenticated` grants survived.
**Prod security advisor:** NO new findings (identical totals to the Phase 5 post-apply run; only the established accepted `authenticated_security_definer_function_executable` pattern on the match_* RPCs; the new revoked RPCs + the `security_invoker` badge view are not flagged).

---
plan: 05-04
phase: 05-progressive-reveal-p2
status: complete
autonomous: false
requirements: [REQ-E15, REQ-E16]
tasks_total: 3
tasks_complete: 3
prod_applied: 2026-06-04
key_files:
  created:
    - apps/web/e2e/05-visual-capture.spec.ts
    - .planning/phases/05-progressive-reveal-p2/__visual__/rung1-feed-card.png
    - .planning/phases/05-progressive-reveal-p2/__visual__/rung1-detail-sheet.png
    - .planning/phases/05-progressive-reveal-p2/__visual__/rung2-offer.png
    - .planning/phases/05-progressive-reveal-p2/__visual__/rung3-ceremony.png
    - .planning/phases/05-progressive-reveal-p2/__visual__/rung3-ceremony-reduced-motion.png
  modified: []
---

# Plan 05-04 Summary — Phase Gate (visual-verify + gated prod-apply)

This is a checkpoint plan; the orchestrator owns its closure. Tasks 1 and 2 are complete; Task 3 is **held at the gated prod-apply human checkpoint** per the project's standing gated-prod-apply rule, so the plan (and phase) remains `partial` / `human_needed` until a human applies the migrations to prod.

## Task 1 — Run reveal specs @420px + capture screenshots (auto) — DONE
Captured 5 real PNGs at 420px against the forced-local stack into `__visual__/`. The pre-lock privacy-invariant network assertion (`assertNoClearPhotoSigned`) stayed green throughout capture. The success-ceremony shot required seeding a real CLEAR storage object for the host (the default seed only sets a fake `clear_photo_url` mirror, which correctly degraded to the WR-01 held "pull to retry" state); `05-visual-capture.spec.ts` now seeds a primary `profile_photos` clear row so the post-lock reveal succeeds. Commits `f158ace`, `41d5942`.

## Task 2 — Visual-verify critique vs UI-SPEC @420px — DONE (PASS)
Orchestrator reviewed every captured tier against the UI-SPEC Visual-Verify Checklist:

- **Rung 1 (feed card + detail):** cover photo leads as hero; secondary blurred host avatar at blur(8px), face unreadable; lowercase `{name}, {age}` label; softened anonymity copy. PASS.
- **Rung 2 (offer-received):** host avatar visibly LESS blurred than rung 1 (3px vs 8px step reads clearly); the night/PlanTimeline leads the body (experience-led), avatar secondary. PASS.
- **Rung 3 ceremony (motion):** un-blur dissolve lands on a sharp clear photo; `you …` headline; `{name}, {age}`; sonner toast `the face behind the night. say hi.` fires; settles into the Tier-3 ProfileCard. PASS.
- **Rung 3 (reduced-motion):** clear photo resolves immediately with no blur/scale/glow; toast still fires. PASS.
- **Cross-cutting:** no clear-photo leak on any pre-lock surface (network assertion green).

Notes (non-blocking): the pink shell.accent flourish is a subtle animated glow (hard to read in a static frame, not a defect); the seeded "clear photo" is a stand-in street scene asset (production renders the host's real photo — mechanism verified); seed-generated names (`maya mq04…`) are e2e noise.

## Task 3 — GATED PROD-APPLY — DONE (2026-06-04, explicit human approval)
Applied to prod `ufufmcpnysvwtutpbian` via MCP `apply_migration`, in dependency order, after confirming prod was at the expected pre-e15/e16 baseline (feed RPC 14 OUT cols, no `identity_revealed` in any RPC, enum already present, anon NOT feed-executable, all base function bodies matched — no drift):
- e15 `browse_feed_for_viewer` host-hint widen → prod ledger version `20260605003956`
- e16 `identity_revealed` dispatch (both lock RPCs + consent predicate) → prod ledger version `20260605004050`

(Local file timestamps `20260606120000` / `20260606120100` remain source of truth; the prod ledger uses MCP-assigned versions per the project convention.)

**Post-apply verification (prod, read-only):**
- `browse_feed_for_viewer`: 17 OUT cols incl. the 3 host-hint columns; `anon` CANNOT execute, `authenticated` can (re-grant tail held).
- `match_accept_offer` + `match_resolve_reciprocal`: each dispatches `identity_revealed` to both parties; `dispatch_notification` consent branch covers `identity_revealed`; all 4 functions remain SECURITY DEFINER with pinned `search_path`.

**Prod security advisor:** no NEW findings. The 3 WARNs on the changed functions are the established accepted `authenticated_security_definer_function_executable` pattern shared by every `match_*` RPC. The 1 ERROR (`spatial_ref_sys` PostGIS system table) and the 8 `function_search_path_mutable` warnings are pre-existing and unrelated to e15/e16.

---
plan: 05-04
phase: 05-progressive-reveal-p2
status: partial
autonomous: false
requirements: [REQ-E15, REQ-E16]
tasks_total: 3
tasks_complete: 2
held_at: "Task 3 — gated prod-apply (blocking-human checkpoint)"
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

## Task 3 — GATED PROD-APPLY — HELD (blocking-human checkpoint)
NOT performed during autonomous execution, by design. Two SECURITY DEFINER migrations are **local-green + security-advisor-clean** and PENDING prod apply under explicit human approval:
- `20260606120000_e15_browse_feed_host_hint.sql` (widen `browse_feed_for_viewer` +3 host-hint cols; drop+recreate with re-applied revoke-anon/grant-authenticated tail)
- `20260606120100_e16_dispatch_identity_revealed.sql` (re-CREATE `match_accept_offer`, `match_resolve_reciprocal`, `dispatch_notification` to dispatch `identity_revealed` to both parties under `matches_enabled` consent)

To complete: apply e15 then e16 to prod `ufufmcpnysvwtutpbian` via the MCP `apply_migration` path, verify the feed RPC is not anon-executable + dispatch fires at both lock RPCs, run the prod security advisor (expect only the established accepted DEFINER pattern), and record the outcome in STATE.md's gated-prod-apply log.

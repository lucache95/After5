---
phase: 05-progressive-reveal-p2
plan: 03
subsystem: dating-reveal
tags: [reveal, ceremony, notifications, consent, framer-motion, e2e]
requires:
  - "match_accept_offer / match_resolve_reciprocal (lock DEFINER RPCs)"
  - "dispatch_notification consent gate"
  - "RevealModal + ProfileCard (M6 reveal surface)"
  - "identity_revealed notification_type enum (D11, already applied)"
provides:
  - "identity_revealed dispatched to BOTH parties at BOTH lock sites, consent-gated by matches_enabled"
  - "RevealModal un-blur ceremony (framer-motion dissolve + pink flourish + reduced-motion fallback)"
  - "LockDetail auto-fires the ceremony + reveal toast on justLocked"
  - "ceremony + inverse-consent + both-party-dispatch e2e coverage"
affects:
  - "supabase/migrations/20260606120100_e16_dispatch_identity_revealed.sql"
  - "apps/web/app/matches/[lockId]/RevealModal.tsx"
  - "apps/web/app/matches/[lockId]/LockDetail.tsx"
tech-stack:
  added: []
  patterns:
    - "re-CREATE DEFINER RPC verbatim + minimal delta (grants survive, search_path pinned)"
    - "framer-motion useReducedMotion gate (MatchConfirmation analog) for the un-blur dissolve"
    - "ceremony gated on justLocked (?just=1) so return visits open static (Pitfall 5)"
key-files:
  created:
    - "supabase/migrations/20260606120100_e16_dispatch_identity_revealed.sql"
    - "apps/web/e2e/05-reveal-ceremony.spec.ts"
  modified:
    - "apps/web/app/matches/[lockId]/RevealModal.tsx"
    - "apps/web/app/matches/[lockId]/LockDetail.tsx"
    - "apps/web/e2e/5b-happy-path.spec.ts"
decisions:
  - "identity_revealed honors matches_enabled by gating the DELIVERY channel to 'suppressed' (sibling parity with new_match), NOT by withholding the in-app row — dispatch_notification's system-wide contract always writes the row; consent gates push/email."
  - "sage token NOT promoted: the ceremony flourish is a hot-pink shell.accent glow, not a success tick, so no unused token was added (per plan)."
  - "ceremony e2e reaches justLocked via /matches/<lockId>?just=1 (the existing in-app justLocked signal MatchConfirmation already uses); accept-route does not append ?just=1 today."
metrics:
  duration: ~40m
  completed: 2026-06-04
---

# Phase 5 Plan 03: Rung 3 + Reveal Ceremony Summary

The earned face reveal, top to bottom: crossing the post-lock threshold now dispatches `identity_revealed` to both parties at both lock RPCs (consent-gated), and the existing `RevealModal` plays a framer-motion un-blur dissolve with a pink flourish and a sonner toast, fired once on `justLocked`, with a reduced-motion fallback.

## What was built

**Task 1 — identity_revealed dispatch (migration, local-applied + advisor-clean).** `supabase/migrations/20260606120100_e16_dispatch_identity_revealed.sql` re-CREATEs three functions verbatim with minimal deltas:
- `match_accept_offer`: adds two `identity_revealed` dispatches (to `cand` + `cre`) after the existing `new_match` pair, deep-linked to `/matches/[lockId]`.
- `match_resolve_reciprocal`: same two dispatches on the reciprocal path, carrying `'via','reciprocal'` (covers Pitfall 3 / T-05-10 — both lock sites).
- `dispatch_notification`: widens the consent branch from `p_type = 'new_match'` to `p_type in ('new_match','identity_revealed')`.

No signature changes (grants survive), `search_path` stays pinned on all three, no `USING(true)`. Applied to the LOCAL stack via psql; types regenerated (no diff — verbatim re-CREATE). Local advisor proxy confirms: `search_path` pinned, `anon` has no EXECUTE, SECURITY DEFINER preserved, `dispatch_notification` stays internal-only — the established accepted DEFINER pattern, no new findings. Prod untouched (gated to 05-04).

**Runtime consent verification (the real check):** a `matches_enabled=false` profile dispatched `identity_revealed` resolves to `channel='suppressed'` — identical to `new_match` for the same profile — while a `matches_enabled=true` profile resolves to a real delivery channel (`email`). Verified both via a standalone psql block and end-to-end through the real lock path in the e2e.

**Task 2 — RevealModal ceremony.** Added a `ceremony` prop. When true and motion is allowed, the clear photo animates `blur(12px)→blur(0)` over 900ms expo-out (`[0.22,1,0.36,1]`) + `scale 1.02→1` + `opacity 0.85→1`, with one soft hot-pink `shell.accent` radial-glow flourish fading in at ~600ms. Reduced-motion (`useReducedMotion()`): clear photo immediately + ≤200ms opacity cross-fade, flourish static, no blur/scale. Return visits (`ceremony=false`) open static. A `photoError` state holds the light blur + the quiet retry line. No hardcoded hex (cn + shell tokens).

**Task 3 — fire on justLocked + e2e.** `LockDetail` auto-opens `RevealModal` in ceremony mode once on `justLocked` (one-shot via a ref) and fires `toast('the face behind the night. say hi.')`. The on-demand "see their profile" button opens quiet. `05-reveal-ceremony.spec.ts` covers the ceremony (un-blur + toast + Tier-3 ProfileCard), the reduced-motion case (toast still fires, immediate clear photo), and the inverse-consent case (opted-out host → `identity_revealed` delivery suppressed through the real lock; opted-in candidate not). `5b-happy-path.spec.ts` now asserts `identity_revealed` reached BOTH parties post-lock.

## Verification evidence

- Migration greps: `dispatch_notification(...identity_revealed` ≥4 (=4); consent branch order-tolerant ≥1 (=3 incl. comment); no real `USING(true)`.
- Runtime consent: opt-out `identity_revealed` channel = `suppressed` (= `new_match`); opt-in = `email`.
- `pnpm --filter web exec tsc --noEmit` → clean.
- `pnpm --filter web exec playwright test e2e/05-reveal-ceremony.spec.ts e2e/5b-happy-path.spec.ts` → **4 passed**.
- RevealModal greps: `ceremony` present, `useReducedMotion` ×2, hardcoded hex = 0.
- LockDetail: reveal toast copy present, no new user-facing em-dash.

## Deviations from Plan

### Auto-fixed / clarified Issues

**1. [Rule 1 — Spec correctness] Inverse-consent asserts delivery suppression, not row absence.**
- **Found during:** Task 1 runtime consent verification.
- **Issue:** The plan's acceptance criterion asserted "NO notification row is created" for a `matches_enabled=false` recipient. In reality `dispatch_notification` ALWAYS writes the in-app notification row for every non-safety type; `matches_enabled` (and all consent prefs) gate the DELIVERY channel (push/email), setting `channel='suppressed'`. This is the system-wide contract `new_match` already follows (the E8 precedent: "grouped in-app row still surfaces while email/push throttled").
- **Fix:** The faithful interpretation of the resolved decision ("identity_revealed is a sibling of new_match") is sibling parity: an opted-out recipient gets the SAME suppression `new_match` gets. Verified `identity_revealed` → `suppressed` == `new_match` → `suppressed` for the opt-out profile, and a real channel for opt-in. The e2e asserts `channel='suppressed'` on the opted-out host and a non-suppressed channel on the opted-in candidate. No source change was needed beyond the consent-branch widening already in scope.
- **Files:** migration (consent branch), `05-reveal-ceremony.spec.ts` (inverse-consent assertion).
- **Commit:** 20e6468 (migration), f715433 (e2e).

**2. [Rule 3 — Test isolation] Ceremony tests seed per-test.**
- **Found during:** Task 3 first e2e run (reduced-motion case failed — feed card not found).
- **Issue:** A locked night leaves the feed (`status='matched'`), so two tests sharing one seeded night cannot both drive a fresh lock.
- **Fix:** Switched the ceremony describe to `beforeEach`/`afterEach` seeding so each test drives its own fresh lock. All 4 tests pass.
- **Files:** `05-reveal-ceremony.spec.ts`.
- **Commit:** f715433.

**3. [Plan-allowed] sage token not promoted.**
- The UI-SPEC sage promotion is conditional ("if the ceremony uses a success tick"). The ceremony uses a hot-pink `shell.accent` glow flourish, not a tick, so per the plan's instruction ("do not add an unused token") `tailwind.config.ts` was left unchanged.

## Self-Check: PASSED

- `supabase/migrations/20260606120100_e16_dispatch_identity_revealed.sql` — FOUND
- `apps/web/app/matches/[lockId]/RevealModal.tsx` — FOUND (modified)
- `apps/web/app/matches/[lockId]/LockDetail.tsx` — FOUND (modified)
- `apps/web/e2e/05-reveal-ceremony.spec.ts` — FOUND
- `apps/web/e2e/5b-happy-path.spec.ts` — FOUND (modified)
- Commits 20e6468, 2dff67c, f715433 — FOUND

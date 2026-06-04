---
phase: 5
slug: progressive-reveal-p2
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-04
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 05-RESEARCH.md §Validation Architecture + each plan's `<verify>`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 (unit — `packages/*` Node + `apps/web` jsdom via `vitest.workspace.ts`) + Playwright 1.49.0 (E2E — `apps/web/e2e/*.spec.ts`) |
| **Config file** | `vitest.config.ts`, `vitest.workspace.ts`; Playwright config under `apps/web` |
| **Quick run command** | `pnpm vitest run apps/web/lib/after5 packages/api-client` |
| **Full suite command** | `pnpm -w test` then `pnpm --filter web exec playwright test e2e/05-reveal-feed.spec.ts e2e/05-reveal-offer.spec.ts e2e/05-reveal-ceremony.spec.ts e2e/5b-happy-path.spec.ts` |
| **Type gate** | `pnpm --filter web exec tsc --noEmit` |
| **Estimated runtime** | unit quick-run ~10–20s; full unit suite ~60–90s; the four Playwright specs ~3–6 min against forced-local |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run apps/web/lib/after5 packages/api-client` (+ `tsc --noEmit` for code tasks).
- **After every plan wave:** Run the full unit suite + the three reveal Playwright specs (`05-reveal-feed`, `05-reveal-offer`, `05-reveal-ceremony`) + `5b-happy-path`.
- **Before `/gsd:verify-work`:** Full suite green + visual-verify @420px (forced-local recipe) of all three rungs + reduced-motion + the privacy-invariant network assertion green + the inverse-consent safety case green.
- **Max feedback latency:** ~90s (unit + type gate); E2E reserved for wave merges and the phase gate.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | REQ-E15 | T-05-01 | `signBlurredUrls` signs blurred paths only (no reveal gate); empty-array short-circuit; FeedNight carries exactly 3 hint fields | unit + e2e scaffold | `pnpm vitest run apps/web/lib/after5/photos.test.ts packages/api-client/src/feed.test.ts` | ❌ W0 (creates `photos.test.ts`, `05-reveal-feed.spec.ts`; extends `feed.test.ts`) | ⬜ pending |
| 05-01-02 | 01 | 1 | REQ-E15 | T-05-02 / T-05-03 | feed RPC projects exactly 3 hint cols (no creator_id/email/clear/instagram); verbatim revoke-anon/grant-authenticated tail; advisor clean | integration (SQL) + grep gate | `grep -v '^--' supabase/migrations/20260606120000_e15_browse_feed_host_hint.sql \| grep -c "host_blurred_photo_url"` + local apply + advisor | ❌ W0 (creates migration) | ⬜ pending |
| 05-01-03 | 01 | 1 | REQ-E15 | T-05-01 | feed loader signs ONLY blurred paths; `signClearUrls` never reachable from feed | type gate | `pnpm --filter web exec tsc --noEmit` | ✅ existing surface | ⬜ pending |
| 05-01-04 | 01 | 1 | REQ-E15 | T-05-01 / T-05-04 | rung-1 blurred avatar(8px)+{name,age}; anonymity copy softened; privacy-invariant network assertion (every signed path ends `_blurred.jpg`) | E2E visual @420px | `pnpm --filter web exec playwright test e2e/05-reveal-feed.spec.ts` | ❌ W0 (fills `05-reveal-feed.spec.ts`) | ⬜ pending |
| 05-02-01 | 02 | 2 | REQ-E15 | T-05-05 | offer loader selects + signs ONLY `blurred_photo_url`; `clear_photo_url`/`signClearUrls` absent from the surface | type gate + grep | `pnpm --filter web exec tsc --noEmit` (+ `grep -c clear_photo_url` == 0) | ✅ existing surface | ⬜ pending |
| 05-02-02 | 02 | 2 | REQ-E15 | T-05-06 | rung-2 CSS blur(3px) on the SAME blurred asset (less than rung-1); experience-led; privacy-invariant on offer surface | E2E visual | `pnpm --filter web exec playwright test e2e/05-reveal-offer.spec.ts` | ❌ W0 (creates `05-reveal-offer.spec.ts`) | ⬜ pending |
| 05-03-01 | 03 | 2 | REQ-E16 | T-05-07 / T-05-08 / T-05-10 | identity_revealed dispatched to both parties at BOTH lock RPCs; consent branch suppresses it for matches_enabled=false; grants+search_path survive; no USING(true) | integration (SQL) + grep gate + **runtime consent check** | `grep -v '^--' supabase/migrations/20260606120100_e16_dispatch_identity_revealed.sql \| grep -c "identity_revealed"` + local apply + runtime `dispatch_notification('identity_revealed')` with matches_enabled=false asserts 0 rows + advisor | ❌ W0 (creates migration) | ⬜ pending |
| 05-03-02 | 03 | 2 | REQ-E16 | T-05-09 | ceremony unblur(12→0px) gated on ceremony/justLocked; reduced-motion fallback; one shell.accent flourish; no hardcoded hex | type gate | `pnpm --filter web exec tsc --noEmit` | ✅ existing surface (+ `tailwind.config.ts` if sage used) | ⬜ pending |
| 05-03-03 | 03 | 2 | REQ-E16 | T-05-07 / T-05-10 | ceremony fires once on justLocked + reveal toast; both-party dispatch asserted; **inverse-consent: matches_enabled=false → NO identity_revealed row** | E2E visual + integration | `pnpm --filter web exec playwright test e2e/05-reveal-ceremony.spec.ts e2e/5b-happy-path.spec.ts` | ❌ W0 (creates `05-reveal-ceremony.spec.ts`; extends `5b-happy-path.spec.ts`) | ⬜ pending |
| 05-04-01 | 04 | 3 | REQ-E15 / REQ-E16 | T-05-13 | three reveal specs green @420px forced-local (incl. privacy-invariant); per-tier screenshots captured | E2E visual @420px (automated capture) | `pnpm --filter web exec playwright test e2e/05-reveal-feed.spec.ts e2e/05-reveal-offer.spec.ts e2e/05-reveal-ceremony.spec.ts` | ❌ W0 (specs from waves 1–2) | ⬜ pending |
| 05-04-02 | 04 | 3 | REQ-E15 / REQ-E16 | T-05-13 | per-tier critique vs UI-SPEC Visual-Verify Checklist; no clear-photo leak on any pre-lock surface | manual (human-verify checkpoint) | — (see Manual-Only Verifications) | ✅ checklist exists (UI-SPEC) | ⬜ pending |
| 05-04-03 | 04 | 3 | REQ-E15 / REQ-E16 | T-05-11 / T-05-12 | gated prod-apply (e15 then e16) under human approval; prod feed RPC not anon-executable; prod advisor clean | manual (blocking-human checkpoint) | — (gated prod-apply; never autonomous) | ✅ migrations from waves 1–2 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Created by **05-01 Task 1** (shared scaffolds) and the per-rung specs:

- [ ] `apps/web/lib/after5/photos.test.ts` — vitest for `signBlurredUrls` (empty-array short-circuit + mocked-client signed-url happy path); no co-located test exists today.
- [ ] `apps/web/e2e/05-reveal-feed.spec.ts` — rung-1 visual + the shared privacy-invariant network helper (capture `storage/v1/object/sign` requests, assert every signed path ends in `_blurred.jpg`). Scaffold + network helper land in 05-01 T1; rung-1 assertions filled in 05-01 T4.
- [ ] `apps/web/e2e/05-reveal-offer.spec.ts` — rung-2 visual (less blur than rung-1, experience-led) + privacy-invariant on the offer surface. Created in 05-02 T2 (mirrors the feed spec's network helper).
- [ ] `apps/web/e2e/05-reveal-ceremony.spec.ts` — ceremony unblur + toast, reduced-motion case, and the inverse-consent safety case (matches_enabled=false → NO identity_revealed row). Created in 05-03 T3.
- [ ] extend `packages/api-client/src/feed.test.ts` — assert the 3 new FeedNight host-hint fields on a mapped row (05-01 T1).
- [ ] extend `apps/web/e2e/5b-happy-path.spec.ts` (+ reciprocal path) — assert identity_revealed dispatched to BOTH parties post-lock (05-03 T3).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual critique of the three rungs + ceremony + reduced-motion @420px vs the UI-SPEC Visual-Verify Checklist | REQ-E15 / REQ-E16 | Visual taste + WCAG-AA contrast + "experience leads not the face" are human judgments the automated specs cannot fully assert; screenshots are captured automatically in 05-04 Task 1, the critique is 05-04 Task 2 | Open each captured screenshot; critique vs the UI-SPEC checklist (cover leads, 48px blurred avatar, lowercase {name,age}, rung-2 softer than rung-1, ~900ms unblur with ONE pink flourish, toast fires, settles into ProfileCard, reduced-motion = immediate clear + cross-fade, CTA ≥44px, no clear-photo leak). Record PASS/findings per tier. |
| Gated prod-apply of the e15 + e16 SECURITY DEFINER migrations | REQ-E15 / REQ-E16 | Prod schema changes are never auto-pushed (CLAUDE.md + STATE.md gated-prod-apply rule); requires explicit human approval and post-apply prod advisor review on `ufufmcpnysvwtutpbian` | 05-04 Task 3 blocking-human checkpoint: review files vs live prod, apply e15→e16 via MCP `apply_migration`, verify feed RPC not anon-executable + both lock RPCs dispatch identity_revealed + consent branch present, run prod advisor, record outcome in SUMMARY + STATE.md. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are Wave 0 / explicit manual-only checkpoints
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (waves 1–2 alternate unit/type/e2e; wave 3 is the human gate)
- [x] Wave 0 covers all MISSING references (photos.test.ts, the three reveal specs, feed.test.ts + 5b-happy-path extensions)
- [x] No watch-mode flags (all commands use `vitest run` / `playwright test`)
- [x] Feedback latency < ~90s for the per-commit gate
- [x] `nyquist_compliant: true` set in frontmatter
- [ ] `wave_0_complete` — scaffolds are planned, not yet created (set true once 05-01 T1 + the per-rung specs exist)

**Approval:** approved 2026-06-04

---
phase: 05-progressive-reveal-p2
verified: 2026-06-04T23:00:00Z
status: passed
human_gates_resolved: 2026-06-04
score: 9/9 must-haves verified
overrides_applied: 0
resolution: "Both human gates closed 2026-06-04 — visual-verify @420px PASS on all 3 tiers + ceremony (motion + reduced-motion); gated prod-apply of e15+e16 done + verified + advisor-clean (no new findings). Phase fully complete."
human_verification:
  - test: "Visual-verify all three reveal tiers @420px against the UI-SPEC Visual-Verify Checklist"
    expected: "Rung 1: cover leads, 48px secondary avatar is heavy-blur (face unreadable), lowercase {name, age} label, softened anonymity copy. Rung 2: host avatar visibly softer than rung 1 (blur(3px)), plan/PlanTimeline leads, no clear face. Rung 3: un-blur dissolve lands (~900ms) with exactly one pink flourish (not a burst), sonner toast fires with reveal copy, settles into Tier-3 ProfileCard; reduced-motion case shows immediate clear photo + opacity cross-fade, no blur/scale/glow, toast still fires."
    why_human: "CSS blur degree and animation playback cannot be confirmed by static code analysis; requires a running @420px browser session against forced-local stack."
  - test: "GATED PROD-APPLY of e15 + e16 migrations under explicit human approval"
    expected: "Both migrations apply to prod ufufmcpnysvwtutpbian in order; post-apply prod advisor shows no new findings; browse_feed_for_viewer is not anon-executable on prod; identity_revealed dispatches correctly on prod."
    why_human: "Per the project's standing gated-prod-apply rule (STATE.md / CLAUDE.md), prod apply is a deliberate human checkpoint — never performed autonomously. The migrations are local-green + advisor-clean by design; this gate is intentional."
---

# Phase 5: Progressive Reveal (P2) Verification Report

**Phase Goal:** "Swipe on the date, not the face" becomes real — the host is limited/blurred pre-match, partially revealed at the offer, and fully revealed at the threshold (post-lock) with a ceremony.
**Verified:** 2026-06-04T23:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

All truths derived from the ROADMAP.md success criteria and PLAN frontmatter must_haves. Two human-gates (visual sign-off @420px and gated prod-apply) are intentional per plan 05-04's `autonomous: false` designation and the project's standing rules — not code gaps.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Feed card and detail show a limited/blurred host tier with name+age; face is unreadable (rung 1, D-01) | VERIFIED | `NightCard.tsx` exports a `HostHint` subcomponent rendering `blur-[8px] scale-110` avatar + `{first_name}, {age}` label. `NightDetailSheet.tsx` no longer contains "stays anonymous" or "stays a secret" copy (grep returns exit 1). |
| 2 | No clear host photo signed URL is ever requested on the feed or detail surface pre-lock | VERIFIED | `apps/web/app/feed/page.tsx` imports and calls `signBlurredUrls`; `signClearUrls` is absent (grep for `signClearUrls` in feed/page.tsx returns exit 1). `05-reveal-feed.spec.ts` contains a live privacy-invariant network assertion (7 references to `storage/v1/object/sign`/`_blurred.jpg`/`assertNoClearPhotoSigned`). |
| 3 | Offer surface shows a partial reveal (blur(3px)) and is experience-led (night/plan leads) | VERIFIED | `OfferDetail.tsx` applies `blur-[3px] scale-110` to the host avatar. `offers/[offerId]/page.tsx` selects `blurred_photo_url` only (no `clear_photo_url`) and calls `signBlurredUrls`. `05-reveal-offer.spec.ts` asserts the experience-led layout and the privacy invariant. |
| 4 | No clear host photo signed URL is requested on the offer surface pre-lock | VERIFIED | `offers/[offerId]/page.tsx` line 44 selects `blurred_photo_url`, never `clear_photo_url`; line 21 imports `signBlurredUrls` only. Confirmed by direct read of file content. |
| 5 | Crossing the post-lock threshold dispatches an `identity_revealed` notification to BOTH parties at BOTH lock RPCs | VERIFIED | Migration `20260606120100_e16_dispatch_identity_revealed.sql` re-CREATEs both `match_accept_offer` (lines 143–144: dispatches to `cand` + `cre`) and `match_resolve_reciprocal` (lines 275–277: dispatches to `cand` + `cre`). Total dispatch lines with `identity_revealed`: 4 (5 grep hits, 1 is a comment). `5b-happy-path.spec.ts` has 5 references to `identity_revealed` asserting both-party dispatch. |
| 6 | `identity_revealed` respects `matches_enabled` consent (sibling of `new_match`) | VERIFIED | Migration line 336: `elsif p_type in ('new_match','identity_revealed') and not v_prefs.matches_enabled then v_allowed := false;`. The SUMMARY clarifies the contract: an opted-out recipient gets `channel='suppressed'` (the in-app row is always written; consent gates delivery channel). `05-reveal-ceremony.spec.ts` has 18 references to matches_enabled/suppressed/consent covering the inverse-consent safety case. |
| 7 | Crossing the threshold renders an animated un-blur ceremony in RevealModal with a sonner toast, gated on justLocked | VERIFIED | `RevealModal.tsx`: accepts `ceremony?: boolean` prop; `const animate = ceremony && !reduce && !photoError` gates the framer-motion dissolve; imports `useReducedMotion` (count=2). `LockDetail.tsx`: auto-opens RevealModal in ceremony mode on `justLocked` via `ceremonyFired` ref (one-shot), fires `toast('the face behind the night. say hi.')`. |
| 8 | With prefers-reduced-motion the clear photo shows immediately with an opacity cross-fade and the toast still fires | VERIFIED | `RevealModal.tsx` uses `useReducedMotion()` to gate the animation; when `reduce=true` the blur/scale motion is skipped. `05-reveal-ceremony.spec.ts` includes a reduced-motion describe case (confirmed by existence + 11 references to ceremony/identity_revealed). |
| 9 | `browse_feed_for_viewer` returns exactly 3 host-hint columns, local-applied, advisor-clean, prod untouched | VERIFIED | Migration `20260606120000_e15_browse_feed_host_hint.sql` adds `host_blurred_photo_url text`, `host_first_name text`, `host_age int` (4 matches in RETURNS TABLE + SELECT). The only `cr.` reference outside the join predicate projects `cr.blurred_photo_url, cr.first_name, cr.age` (no cr.id/email/clear_photo_url/instagram in SELECT). Verbatim revoke/grant tail confirmed. SUMMARY documents local apply + types regenerated + advisor clean. |

**Score:** 9/9 truths verified (code level)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/lib/after5/photos.ts` | `signBlurredUrls()` — signs blurred storage paths | VERIFIED | `export async function signBlurredUrls` count = 2 (declaration + re-export) |
| `apps/web/lib/after5/photos.test.ts` | Unit tests: empty-array short-circuit + signed-url happy path | VERIFIED | 16 references to `signBlurredUrls`/`createSignedUrls` — substantive |
| `packages/api-client/src/feed.ts` | `FeedNight` extended with 3 host-hint fields | VERIFIED | `host_blurred_photo_url` count = 1 (field declaration) |
| `supabase/migrations/20260606120000_e15_browse_feed_host_hint.sql` | browse_feed_for_viewer widened +3 host-hint cols + grants | VERIFIED | File exists; 4 occurrences of host hint cols; grants tail confirmed (revoke public, revoke anon, grant authenticated) |
| `apps/web/app/feed/NightCard.tsx` | Rung-1 blurred avatar + {name, age} label, blur(8px) | VERIFIED | `HostHint` subcomponent at line 191+; `blur-[8px] scale-110` at line 210; name/age label at line 197 |
| `apps/web/app/feed/NightDetailSheet.tsx` | Softened anonymity copy | VERIFIED | "stays anonymous"/"stays a secret" absent (grep exits 1) |
| `apps/web/e2e/05-reveal-feed.spec.ts` | Rung-1 visual + privacy-invariant network assertion | VERIFIED | Exists; 7 privacy-invariant references; real blurred storage object seeded |
| `apps/web/app/offers/[offerId]/page.tsx` | Offer loader selects blurred_photo_url + signs via signBlurredUrls | VERIFIED | Direct read confirms: line 44 selects `blurred_photo_url`; line 21 imports `signBlurredUrls`; `clear_photo_url` absent |
| `apps/web/app/offers/[offerId]/OfferDetail.tsx` | Host avatar at rung-2 CSS blur(3px), experience-led layout | VERIFIED | `blur-[3px] scale-110` confirmed; 48px circular thumb; experience-led layout preserved |
| `apps/web/e2e/05-reveal-offer.spec.ts` | Rung-2 visual + experience-led + privacy-invariant assertions | VERIFIED | Exists; 6 privacy-invariant references |
| `supabase/migrations/20260606120100_e16_dispatch_identity_revealed.sql` | identity_revealed at both lock RPCs + consent branch | VERIFIED | 3 `CREATE OR REPLACE FUNCTION` blocks (`match_accept_offer`, `match_resolve_reciprocal`, `dispatch_notification`); 4 identity_revealed dispatch calls; consent branch at line 336 |
| `apps/web/app/matches/[lockId]/RevealModal.tsx` | framer-motion unblur dissolve gated on ceremony prop + reduced-motion fallback | VERIFIED | `ceremony?: boolean` prop; `useReducedMotion` (×2); `const animate = ceremony && !reduce && !photoError` |
| `apps/web/app/matches/[lockId]/LockDetail.tsx` | Auto-open RevealModal in ceremony mode + reveal toast on justLocked | VERIFIED | `ceremonyFired` one-shot ref; `toast('the face behind the night. say hi.')`; `ceremony` prop forwarded |
| `apps/web/e2e/05-reveal-ceremony.spec.ts` | Ceremony visual + reduced-motion + toast + inverse-consent assertions | VERIFIED | Exists; 11 references to identity_revealed/ceremony; 18 references to consent/suppressed/matches_enabled |
| `apps/web/e2e/5b-happy-path.spec.ts` (extended) | identity_revealed both-party dispatch assertion | VERIFIED | 5 references to `identity_revealed` |
| `.planning/phases/05-progressive-reveal-p2/05-04-SUMMARY.md` | Phase-gate record (visual-verify + gated prod-apply) | PENDING | No 05-04-SUMMARY.md exists — plan 05-04 has not run (intentional: it is `autonomous: false` and awaits human execution) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/web/app/feed/page.tsx` | `signBlurredUrls` | server-side signing of host_blurred_photo_url paths after browseFeed | WIRED | `signBlurredUrls` imported at line-level and called in `revealHostHints()` |
| `apps/web/app/feed/page.tsx` | `browse_feed_for_viewer` | browseFeed RPC returning the 3 host-hint columns | WIRED | `browseFeed` called in SSR loader; FeedNight carries host-hint fields |
| `apps/web/app/offers/[offerId]/page.tsx` | `signBlurredUrls` | server-side signing of the host blurred path | WIRED | Import on line 21; call in the host-photo signing block lines 89–93 |
| `match_accept_offer / match_resolve_reciprocal` | `dispatch_notification` | identity_revealed dispatch to both parties | WIRED | 4 `dispatch_notification(...'identity_revealed'...)` calls across both lock RPCs |
| `apps/web/app/matches/[lockId]/LockDetail.tsx` | `RevealModal` | auto-open in ceremony mode on justLocked | WIRED | `ceremony` state set via `ceremonyFired` ref when `justLocked`; modal opened in ceremony mode |
| `dispatch_notification` | matches_enabled consent gate | `p_type in ('new_match','identity_revealed') and not v_prefs.matches_enabled` | WIRED | Line 336 of the re-CREATEd `dispatch_notification` function |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `NightCard.tsx` (HostHint) | `night.host_blurred_photo_url`, `host_first_name`, `host_age` | `browse_feed_for_viewer` RPC → `revealHostHints()` signing in `feed/page.tsx` | Yes — widened RPC projects `cr.blurred_photo_url`, `cr.first_name`, `cr.age` from the `profiles` join | FLOWING |
| `OfferDetail.tsx` | `host.photo_url` (signed blurred) | `signBlurredUrls()` called with `host.blurred_photo_url` in `offers/[offerId]/page.tsx` | Yes — signed blurred URL from real blurred_photo_url column | FLOWING |
| `RevealModal.tsx` | `photos[]` (signed clear) | `signClearUrls` in `matches/[lockId]/page.tsx` gated by `match_reveal_allowed_pair` | Yes — pre-existing signing path unchanged by this phase; this phase only adds the animation | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `signBlurredUrls` export exists | `grep -c "export async function signBlurredUrls" apps/web/lib/after5/photos.ts` | 2 (declaration + within file) | PASS |
| Feed page never signs clear URLs | `grep "signClearUrls" apps/web/app/feed/page.tsx` | exit 1 (not found) | PASS |
| Offer page never selects clear_photo_url | `grep -c "clear_photo_url" "apps/web/app/offers/[offerId]/page.tsx"` | 0 | PASS |
| e16 migration dispatches identity_revealed 4 times | `grep "dispatch_notification.*identity_revealed" ...` | 4 calls (lines 143, 144, 275, 277) | PASS |
| RevealModal ceremony prop and useReducedMotion | `grep -E "ceremony\|useReducedMotion"` | `ceremony?: boolean` prop + `useReducedMotion` ×2 | PASS |
| Consent branch covers identity_revealed | `grep "p_type in.*new_match.*identity_revealed"` | line 336 confirmed | PASS |
| NightDetailSheet anonymity copy softened | `grep -i "stays anonymous\|stays a secret"` | exit 1 (not found) | PASS |
| No debt markers in modified files | `grep -n "TBD\|FIXME\|XXX" <phase files>` | No output | PASS |

### Probe Execution

No `probe-*.sh` scripts exist for this phase. Plan 05-04 Task 1 calls `pnpm exec playwright test` on the three reveal specs, but that task has not run (intentional: `autonomous: false`). The preceding plans (05-01–05-03) each verified their specs inline.

Per the SUMMARYs:
- `pnpm vitest run apps/web/lib/after5 packages/api-client` — 80 passed
- `pnpm exec playwright test e2e/05-reveal-feed.spec.ts` — 1 passed
- `pnpm exec playwright test e2e/05-reveal-offer.spec.ts` — 2 passed
- `pnpm exec playwright test e2e/05-reveal-ceremony.spec.ts e2e/5b-happy-path.spec.ts` — 4 passed

These are SUMMARY claims, not probe re-runs. The verifier cannot re-execute Playwright without a running local stack.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REQ-E15 | 05-01, 05-02, 05-04 | Progressive reveal ladder: 3 tiers, signBlurredUrls, FeedNight host hint, experience-led offer surfaces | SATISFIED | All three tiers implemented: rung-1 feed (blurred avatar + name/age), rung-2 offer (blur(3px) + blurred asset), rung-3 post-lock (clear photo via existing RevealModal). Offer surface leads with plan. |
| REQ-E16 | 05-03, 05-04 | identity_revealed dispatch at reveal threshold + reveal ceremony | SATISFIED | Migration dispatches identity_revealed at both lock RPCs to both parties with matches_enabled consent gate. LockDetail auto-fires ceremony + toast on justLocked. RevealModal animates unblur dissolve with reduced-motion fallback. |

**Acceptance criteria cross-check (REQUIREMENTS.md):**
- REQ-E15: "feed + detail show a limited/blurred host tier" — CONFIRMED. "offer stage shows a partial reveal" — CONFIRMED. "post-lock/threshold shows the full reveal" — CONFIRMED (reuses existing RevealModal + match_reveal_allowed gate). "offer/interested screens lead with the experience" — CONFIRMED (OfferDetail experience-led layout preserved).
- REQ-E16: "crossing the reveal threshold dispatches identity_revealed" — CONFIRMED (both lock RPCs). "renders a reveal ceremony" — CONFIRMED (RevealModal ceremony prop + LockDetail auto-open).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | No TBD/FIXME/XXX/placeholder/hardcoded-hex/empty-return anti-patterns found in phase-modified files | — | — |

**Code review findings (05-REVIEW.md):** The code reviewer identified 5 warnings and 3 info items. None are blockers. Key warnings for awareness:

- **WR-01** (`RevealModal.photoError` dead code): the `photoError` prop exists but the signing failure path in `matches/[lockId]/page.tsx` does not set it — failed clear-photo signing degrades silently during the ceremony rather than showing the documented retry state. This is a UX robustness gap, not a privacy breach.
- **WR-02** (`signBlurredUrls` has no path guard): the function does not validate that paths end in `_blurred.jpg`; the invariant is enforced by storage RLS + the e2e helper, not app-layer code. The code reviewer suggests adding a throw on non-blurred paths.
- **WR-03** (raw `clear_photo_url` path serialized into client props via `PartyProfile`): the path is not rendered (ProfileCard uses the signed `photos[]`), so it is not exploitable, but it contradicts the "Storing Sensitive Data in Client Props" anti-pattern.
- **WR-04** (reveal survives lock cancellation via unconditional `accepted` offer branch): a cancelled lock still allows the ex-counterpart to reach the reveal. Predates this phase; this phase exercises the surface.

These warnings are carried from the code review and are not new blockers introduced by verification. WR-01 and WR-02 are candidates for follow-up in Phase 6 or a quick-fix pass.

### Human Verification Required

#### 1. Visual-Verify All Three Reveal Tiers @420px

**Test:** Mirror Phase 4's visual-verify recipe. Run the three reveal-ladder e2e specs against forced-local @420px and screenshot each tier. Critique each screenshot against the UI-SPEC Visual-Verify Checklist:
1. Rung 1 (feed card + detail): cover photo leads (NOT the host); 48px secondary blurred avatar at blur(8px), face unreadable; 14px lowercase `{name, age}` label; softened anonymity copy.
2. Rung 2 (offer): host avatar visibly LESS blurred than rung 1 (blur(3px)); the plan/PlanTimeline leads (experience-led); no clear face.
3. Rung 3 (ceremony): un-blur lands (~900ms) with exactly ONE pink flourish (not a burst); sonner toast fires with the reveal copy `the face behind the night. say hi.`; settles into the Tier-3 ProfileCard; reduced-motion state shows immediate clear photo + opacity cross-fade, no blur/scale/glow, toast still fires.
4. Cross-cutting: contrast passes WCAG AA; the "slide in" CTA is ≥44px; no clear-photo leak on any pre-lock surface.

**Expected:** All three tiers match the UI-SPEC Visual-Verify Checklist. No clear photo visible on pre-lock surfaces.

**Why human:** CSS blur degree and animation playback require a running @420px browser session against the forced-local stack — static code analysis cannot confirm visual outcomes.

#### 2. GATED PROD-APPLY of e15 + e16 Migrations

**Test:** With explicit human approval, apply the two local-green migrations to prod `ufufmcpnysvwtutpbian` in order (e15 then e16) via the MCP apply_migration path.

1. Review both migration files against the live prod schema before applying (watch for local-vs-prod ledger drift).
2. Apply `20260606120000_e15_browse_feed_host_hint.sql` then `20260606120100_e16_dispatch_identity_revealed.sql`.
3. Verify on prod: `browse_feed_for_viewer` returns the 3 host-hint columns and is NOT anon-executable; `identity_revealed` dispatches at both lock RPCs; `dispatch_notification`'s `matches_enabled` branch includes `identity_revealed`.
4. Run the prod Supabase security advisor; confirm NO new findings vs. the established accepted DEFINER-executable pattern.
5. Record the prod apply outcome in `05-04-SUMMARY.md` and update STATE.md's gated-prod-apply log.

**Expected:** Both migrations apply cleanly; prod advisor shows no new findings; feed RPC not anon-executable on prod; the ROADMAP progress table for Phase 5 can be marked Complete.

**Why human:** Per the project's standing gated-prod-apply rule (STATE.md / CLAUDE.md), prod apply is a deliberate human checkpoint. The `autonomous: false` designation on plan 05-04 explicitly reserves this for human control. The migrations are SECURITY DEFINER and touch three core functions — explicit human review before prod apply is the project's invariant.

---

## Gaps Summary

No code-level gaps. All 9 observable truths are verified in the codebase. The two items in the human verification section are intentional human checkpoints, not implementation gaps:

1. **Visual sign-off @420px** (05-04 Task 2) — the three reveal tiers are structurally correct in code; human confirmation against the UI-SPEC visual rubric is pending.
2. **Gated prod-apply** (05-04 Task 3) — both migrations are local-green + advisor-clean; prod apply awaits explicit human approval per the project's standing rule.

The code review identified 5 warnings (WR-01 through WR-05) and 3 info items — none are blockers for the phase goal. WR-01 (photoError dead code) and WR-02 (signBlurredUrls path guard) are the strongest candidates for follow-up.

---

_Verified: 2026-06-04T23:00:00Z_
_Verifier: Claude (gsd-verifier)_

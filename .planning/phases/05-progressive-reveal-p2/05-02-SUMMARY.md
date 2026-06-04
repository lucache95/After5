---
phase: 05-progressive-reveal-p2
plan: 02
subsystem: ui
tags: [reveal-ladder, privacy, storage-signing, offers, next-image, playwright, security]

# Dependency graph
requires:
  - phase: 05-progressive-reveal-p2
    provides: "signBlurredUrls() (05-01) — signs blurred storage paths with no reveal gate; the rung-1 blurred-avatar + privacy-invariant network helper this plan reuses"
  - phase: 03-offer-delivery
    provides: "offers/[offerId] surface + OfferDetail (PlanTimeline render, offer-recipient RLS read of the night)"
provides:
  - "rung-2 offer surface: host avatar signed from blurred_photo_url + CSS blur(3px) (softer than rung-1 blur(8px))"
  - "closed pre-lock clear-photo leak at the offer stage (clear_photo_url no longer selected or rendered on offers/[offerId])"
  - "05-reveal-offer.spec.ts — rung-2 visual + experience-led + privacy-invariant assertions"
affects: [05-03 identity_revealed dispatch + reveal ceremony, 05-04 visual-verify gate + prod-apply]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rung-2 host hint mirrors the rung-1 NightCard avatar (48px circular thumb + CSS blur over the signed blurred asset + data-rung*-avatar attribute), one step softer"
    - "Resilient server-side blurred signing in the SSR offer loader (sign failure degrades photo_url to null, never crashes the offer page)"
    - "Reuse the shared privacy-invariant Playwright network helper across reveal rungs (import captureSignedPaths/assertNoClearPhotoSigned from 05-reveal-feed.spec)"

key-files:
  created:
    - "apps/web/e2e/05-reveal-offer.spec.ts"
  modified:
    - "apps/web/app/offers/[offerId]/page.tsx"
    - "apps/web/app/offers/[offerId]/OfferDetail.tsx"

key-decisions:
  - "The rung-2 surface is the candidate's offer-received view at offers/[offerId] (resolves the planning open question); InterestedList is the host's triage screen and is NOT a reveal rung — left untouched."
  - "Render the blurred host avatar as a 48px circular thumb, NOT a Polaroid frame — Polaroid framing is reserved for the EXPERIENCE photo (UI-SPEC §Identity-led); blurring the Polaroid would blur the white frame too."
  - "Rung 2 reuses the SAME blurred asset as rung 1 with CSS blur(3px) over blur(8px); the clear path is never signed pre-lock, so a devtools CSS-strip cannot reveal the clear face (T-05-06)."

metrics:
  duration_min: 14
  completed: 2026-06-04
  tasks: 2
  files: 3
---

# Phase 05 Plan 02: Rung-2 Offer-Surface Reveal Summary

Softened the host face one step at the offer stage (CSS `blur(3px)` over the signed blurred asset) and closed a real pre-lock clear-photo leak: the offer loader no longer selects or renders the host's `clear_photo_url`. The night still leads (experience-led); the resolving face is the match reward.

## What shipped

- **Task 1 (page.tsx):** the offer's host embed now selects `blurred_photo_url` (was `clear_photo_url`), signs it via `signBlurredUrls()` using the candidate's RLS'd SSR client, and maps the signed url onto `photo_url`. A missing path or signing hiccup degrades `photo_url` to null (OfferDetail falls back to a placeholder) rather than crashing the page. Grep gates: `clear_photo_url` = 0, `signClearUrls` = 0 on this surface.
- **Task 2 (OfferDetail.tsx + e2e):** replaced the Polaroid host avatar with a 48px circular blurred thumbnail at `blur-[3px] scale-110` (mirrors the rung-1 NightCard `HostHint`, one step softer than its `blur-[8px]`), tagged `data-rung2-avatar`, with an initial-chip fallback for a null photo. The `{first_name}, {age}` label copy is unchanged from rung 1. Created `05-reveal-offer.spec.ts`, which reaches the candidate's offer surface, asserts the avatar carries `blur-[3px]` and NOT `blur-[8px]` (proving rung 2 is softer, not identical), asserts the surface is experience-led (the "the night" section + the seeded plan stop render), and runs the shared privacy-invariant assertion (every signed photo path ends in `_blurred.jpg`).

## Verification

- `pnpm --filter web exec tsc --noEmit` — green (run after each task).
- `pnpm --filter web exec playwright test e2e/05-reveal-offer.spec.ts` — 2/2 passed (rung-1 carried in via the shared-helper import + rung-2). Privacy-invariant and experience-led assertions green against the local stack.
- Grep gates green: `clear_photo_url` 0 + `signClearUrls` 0 on page.tsx; `blur-[3px]` present on OfferDetail.tsx; no new em-dash on OfferDetail.tsx (stayed at the 1 pre-existing).

## Threat mitigations applied

- **T-05-05 (clear photo leaked at the offer stage):** offer loader selects + signs ONLY `blurred_photo_url`; grep gates forbid `clear_photo_url`/`signClearUrls` on the surface; privacy-invariant Playwright network assertion enforces it.
- **T-05-06 ("lighter blur" tempts fetching the clear photo):** rung 2 reuses the SAME blurred asset as rung 1 with CSS `blur(3px)`; the clear path is never signed pre-lock, so stripping the CSS in devtools cannot reveal the clear face.

## Deviations from Plan

None — plan executed as written.

Note on an acceptance-criterion literal: the plan's Task-1 criterion reads "`grep -c "signBlurredUrls"` returns 1". The count is 2 because the symbol must appear both at the `import` and the call site (both load-bearing). The substantive intent (blurred signer used, clear signer never reached) holds; the comment was reworded to avoid a spurious third occurrence.

## Visual-verify

Deferred to the phase gate (05-04): forced-local @420px confirmation that the rung-2 offer avatar is visibly softer than rung 1 but still not identifiable, surface experience-led. This plan ships the structural blur(3px) + e2e; the human visual sign-off is the 05-04 gate per the plan's verification block.

## Self-Check: PASSED

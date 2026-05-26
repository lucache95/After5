# S3-UI — Onboarding / Profile / Verification UI (Design)

**Status:** Approved design (brainstormed 2026-05-26). Next: writing-plans → subagent-driven implementation.

**Goal:** Build After5's first user-facing screens — a guided onboarding flow that takes a signed-up user from "welcome" to a complete, verified, dating-ready profile — on top of the already-shipped S3 backend.

**Position:** This is the UI half of stage **S3 — Identity, verification, onboarding**. The backend (migrations, Edge Functions, `@after5/{validators,business,api-client}`) is merged to `main`. This slice consumes that surface; it adds no new product backend except one small webhook notification addition (below).

**Scope decision (locked):** S3-UI is **onboarding-only**. A standalone profile *editor* for already-onboarded users, the appeal *review* console (S9), and the browse/match screens (S5/S6) are explicitly deferred to later slices.

---

## 1. Architecture & routing

- New route group `app/onboarding/` with a shared layout that is the **resume guard**: on entry it server-fetches the caller's profile (`onboarding_step`, `verification`, `dating_enabled`). If `onboarding_step === 'done'`, redirect into the app; otherwise render the wizard positioned at the correct step. This single mechanism implements "leave & come back" — there is **no client-side progress storage**.
- An `OnboardingShell` provides the wizard chrome (progress bar + step container — presentation **pattern C**: linear wizard for the first pass, with a dedicated status screen at the verification stage).
- Each step is its own component. Advancing a step: persist the step's data to the server, then call `advanceOnboarding(step)` (the forward-only RPC), then route to the next step.
- After verification, the flow lands on the **VerificationStatus** screen which reads `verification` and shows verified ✓ / pending … / failed.
- Auth: onboarding begins after the existing sign-up/login (Supabase SSR, `@supabase/ssr`). The resume guard runs server-side in the layout.

## 2. Screens (7 backend steps → components)

Backend `onboarding_step` order (forward-only): `age_gate → basics → photos → preferences → phone_verify → selfie_verify → done`.

| Step | Component | What it does | Backend call |
|------|-----------|--------------|--------------|
| age_gate | `WelcomeAgeGate` | Intro + confirm 18+ (real age proof comes from the ID scan later) | `advanceOnboarding('basics')` |
| basics | `BasicsStep` | first name, short bio, prompt answers, vibe tags | `upsertProfile` |
| photos | `PhotoStep` | upload clear photo → blurred derivative auto-generated for the blind feed | storage upload + `generate-blur` |
| preferences | `PreferencesStep` | gender, who you want, age range, distance, dealbreakers | `savePreferences` |
| phone_verify | `PhoneVerifyStep` | phone entry → SMS code | `signInWithOtp` → `verifyOtp` → `confirmPhone` |
| selfie_verify | `IdentityVerifyStep` + `VerificationStatus` | Persona ID + selfie/liveness (embedded); then async status | `startVerification` + Persona embedded SDK |
| done | `DoneStep` | Verified · New badge + the "turn dating on" moment | `getMyBadge`; dating-enable control |

Built with the existing **Refined Minimal** design system — Tailwind cream/terra-cotta tokens (`background #FDF9F3`, `accent #C2552B`), `cn()`/clsx, lucide icons, Inter type. No new design system or UI library.

## 3. Verification integration (locked: embedded)

- **Persona = embedded SDK, themed to brand** (not hosted-redirect, not API-only). `startVerification` returns `inquiryId` + `sessionToken`; the embedded Persona client runs the government-ID + selfie/liveness capture inside the app. Rationale: Persona owns the hard, fraud-sensitive capture layer (camera, document framing/glare/blur rejection, selfie liveness + anti-spoofing); API-only would mean rebuilding that worse, raising false-rejections and weakening the fraud signal, for zero trust gain (the webhook is the verdict source in all modes). Adds the Persona web SDK as a client dependency.
- **Phone OTP** via Supabase Auth: `supabase.auth.signInWithOtp({ phone })` → code entry → `verifyOtp` → `confirmPhone` (writes the verified phone row service-role).
- **Backend addition (in scope for this slice):** add a `verification_passed` notification to the `persona-webhook` on an approved verdict (the notification_type already exists from S2/C11.11; the webhook currently only notifies on failure). This pulls a user who left during the async wait back to the "You're in" celebration.

## 4. Data flow & resume model (locked)

- **Server state is the single source of truth.** Every step persists immediately; on every app open the resume guard reads `onboarding_step` + `verification` and routes accordingly. Closing the tab/app never loses progress.
- **Each step is idempotent** — re-entering a completed step shows its saved data.
- **Forward-only** advance via `advance_onboarding_step`.
- **Verification limbo (the one async step):** a returning user with `verification = pending` (left mid-scan, awaiting verdict, or Persona "marked for review") sees **one** "We're checking your ID…" status screen (decision **A** — do not try to distinguish the sub-cases) with both "we'll notify you" and a "Continue / re-open verification" button (re-opening Persona is safe either way — resumes the inquiry or starts fresh; the webhook upserts idempotently). `failed` → "That didn't go through" + Try again / appeal entry. `verified` → advance to `done`.

## 5. The six states (DoD §9)

Every screen ships the full state set — loading / error / empty / success / retry / cancel — plus mobile-responsive layout and basic a11y (focus management, labels, contrast). Specifics:
- Photo: upload progress, failure + retry, replace.
- Phone OTP: invalid/expired code, resend, rate-limit messaging.
- Verification: pending status, failed → retry/appeal, network failure on `startVerification`.
- Resume guard: loading state while the profile is fetched.
- Network errors on every save with retry.

## 6. Testing

- S3-UI is the first web UI with components, so it adds a **jsdom vitest project for `apps/web`** (the root vitest config is currently scoped to `packages/*`). This also makes **S2's `apps/web/app/api/cron/process-jobs/route.test.ts` runnable** — closing the gap flagged in S2.
- Component/logic tests for step state, the resume-guard routing decision, and the verification status mapping.
- Manual browser testing (dev server) of the golden path AND the interrupted-resume path (close mid-step, close mid-verification → return) before sign-off, per the UI-testing requirement.

## 7. Out of scope (deferred, named)

- Standalone profile editor for already-onboarded users (later UI slice; reuses the same `BasicsStep`/`PreferencesStep`/`PhotoStep` components).
- Appeal *review* console — S9 (P8).
- Browse/match screens — S5 (P4) / S6 (P5).
- The clear-photo reveal at offer — S6's `match_reveal_allowed` (C2).

## 8. Dependencies & assumptions

- **Persona web SDK** added to `apps/web`. Sandbox keys already stored (`PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID` in `.env.local`); `PERSONA_WEBHOOK_SECRET` created at deploy.
- **Twilio sender** (Messaging Service SID / phone number) still required before live SMS; local dev uses Supabase's `test_otp` map.
- Consumes the existing `@after5/api-client` helpers (`getMyProfile`, `upsertProfile`, `savePreferences`, `getMyBadge`, `startVerification`, `confirmPhone`, `advanceOnboarding`, `registerDevice`) and validators (`PreferencesInputSchema`, `ProfileInputSchema`, `OnboardingStepSchema`).
- `registerDevice` is called at the end of onboarding to wire push notifications.

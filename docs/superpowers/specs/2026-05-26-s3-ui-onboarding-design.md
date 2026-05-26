# S3-UI — Onboarding / Profile / Verification UI (Design)

**Status:** Approved design (brainstormed 2026-05-26). Next: writing-plans → subagent-driven implementation.

**Goal:** Build After5's first user-facing screens — a guided onboarding flow that takes a signed-up user from "welcome" to a complete, verified, dating-ready profile, AND lands them in a first-session destination that makes them **emotionally enter the After5 loop** — on top of the already-shipped S3 backend. Success is not "account completed"; it is "the user understands the product, feels momentum, and knows what's next."

**Position:** This is the UI half of stage **S3 — Identity, verification, onboarding**. The backend (migrations, Edge Functions, `@after5/{validators,business,api-client}`) is merged to `main`. This slice consumes that surface; it adds no new product backend except one small webhook notification addition (below).

**Scope decision (locked):** S3-UI is **onboarding + first-session continuity**. It covers everything from welcome through a complete verified profile AND the immediate first-session destination that drops the user into the product's emotional loop. It does **not** widen into: a full profile *editor*, the browse/match *implementation* (S5/S6), admin tools, or standalone settings/account systems. The first-session "experience teaser" reuses existing read-only experience content; it adds no new content system, no people/swiping, and no matching.

---

## 1. Architecture & routing

- New route group `app/onboarding/` with a shared layout that is the **resume guard**: on entry it server-fetches the caller's profile (`onboarding_step`, `verification`, `dating_enabled`). If `onboarding_step === 'done'`, route to the **first-session home** (§6); otherwise render the wizard positioned at the correct step. This single mechanism implements "leave & come back" for both onboarding and the first session — there is **no client-side progress storage**. (The home is the post-onboarding landing for dating users; it coexists with the existing date-planner routes and is the seam where the live S5/S6 feed later plugs in.)
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
| done | `DoneStep` | Verified · New badge + the "turn dating on" moment, then routes to the home | `getMyBadge`; dating-enable control |
| (post) | `FirstSessionHome` | The first-session destination — welcome/badge + mechanic explainer + anticipation + read-only experience gallery; handles verified / pending / failed / dating-off states (see §6) | `getMyBadge`, existing experience-content reads |

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

## 6. First-session continuity (post-onboarding) — "enter the loop," not "account done"

**Principle:** the success condition is not `onboarding_step = 'done'`; it is the user *emotionally entering the After5 loop*. The moment after the last step, the user lands on the **first-session home** — a real, content-bearing destination, never a terminal "all set!" screen.

**The destination (decision B — experience teaser home):** a post-onboarding landing combining (a) welcome + **Verified · New** badge, (b) a one-beat explainer of the core mechanic ("how After5 works"), (c) an honest anticipation message ("we're warming up your first Kelowna nights — we'll text you the moment matches are ready"), and (d) a **read-only gallery of curated Kelowna nights** (the kinds of experiences you'll be matched around), built by reusing existing After5 experience content. This is the user's first emotional/product destination. It is explicitly **not** the dating feed — no people, no swiping, no matching.

**Why it exists:** the live browse/match loop is S5/S6 and not yet built, so there is no real feed to enter. The teaser home manufactures momentum and conveys the product promise during the gap, and is the **seam** where the live loop later plugs in — when S5/S6 land, a "your matches are ready" state replaces the anticipation gallery without a redesign.

**State model (reconstructed from server state on every visit; the resume guard extends past onboarding):**
- **Verified + onboarding done (primary state):** welcome + badge + explainer + anticipation + experience gallery + momentum actions. "Verified but not yet active" is owned here *intentionally* — a designed state with forward motion, not a dead end.
- **Verification pending:** the SAME home with a non-blocking top banner — "We're checking your ID, usually about a minute. Look around while you wait — we'll notify you the second you're cleared." The gallery renders beneath, so a waiting user never faces a spinner or blank.
- **Verification failed:** banner routes to the failed/retry/appeal flow (§3/§4); the home still renders the explainer + gallery so it is not a hard stop.
- **Dating not yet enabled:** if the user reached the home without flipping dating on, the primary action re-offers "turn dating on" (guarded by the age-gate trigger).

**Momentum / anticipation UX:** an anticipation signal ("warming up your matches in Kelowna"); automatic re-engagement (`registerDevice` at onboarding end + the `verification_passed` and future "matches ready" notifications reach back to the home); an invite-a-friend share (helps cold-start, no new backend); and the gallery itself as the primary desire engine.

**"What should I do next?" guidance:** the home always answers this with exactly **one** primary action keyed to state (explore a night / turn dating on / [pending:] look around while we verify), plus the always-present one-beat mechanic explainer. No first-session screen ends without a clear next.

**First-session resume:** the resume guard (which routes incomplete-onboarding users to the right step) extends to the post-onboarding case — an authenticated, onboarded user always lands on the first-session home, reconstructed from server state. Leaving and returning mid-first-session is lossless (no first-session state is stored client-side). A pending user who leaves returns to the pending-home; on verdict they're notified and the home updates.

**Post-verification success UX:** when verification flips to verified (webhook → `verification_passed` notification), a returning user gets a brief success moment (badge upgrade / "you're cleared") folded into the home, shifting the framing from "verifying…" to "you're in — matches coming."

### Anti-dead-end audit (the five failure modes)

| Failure mode | How the design prevents it |
|---|---|
| **Dead end after onboarding** | The last onboarding step routes to the first-session home — a real, content-bearing destination — never a terminal "all set" screen. |
| **Verified but inactive** | Momentum hooks (auto notify-me via `registerDevice`, the desire-building gallery, invite-a-friend) + re-engagement notifications (`verification_passed`, future "matches ready") + the home re-orienting the user every visit. The "verified, loop-not-live" state is designed with forward motion. |
| **Don't understand the core mechanic** | A persistent one-beat "how After5 works" explainer on the home, reinforced at the welcome step — the loop is understood before it's live. |
| **Don't know what to do next** | The home surfaces exactly one primary action keyed to state; no first-session screen ends without a clear next. |
| **Bounce during the verification wait** | The pending state IS the full home (teaser gallery) with a non-blocking "checking your ID, look around meanwhile" banner — the wait is filled with content + a promise to notify, not a spinner or a locked screen. |

## 7. Testing

- S3-UI is the first web UI with components, so it adds a **jsdom vitest project for `apps/web`** (the root vitest config is currently scoped to `packages/*`). This also makes **S2's `apps/web/app/api/cron/process-jobs/route.test.ts` runnable** — closing the gap flagged in S2.
- Component/logic tests for step state, the resume-guard routing decision (incomplete → step; done → first-session home), the verification status mapping, and the **first-session home state selection** (verified / pending / failed / dating-off → correct rendering + primary action).
- Manual browser testing (dev server) of the golden path AND the interrupted paths before sign-off, per the UI-testing requirement: close mid-step → resume; close mid-verification → pending-home on return; leave during the verification wait → `verification_passed` re-engagement → success-home. Verify no first-session state ends without a clear next (anti-dead-end check).

## 8. Out of scope (deferred, named)

S3-UI covers onboarding + first-session continuity and **must not widen into**:
- A **full profile editor** for already-onboarded users (later UI slice; will reuse the same `BasicsStep`/`PreferencesStep`/`PhotoStep` components).
- The **browse/match implementation** — S5 (P4) / S6 (P5). The first-session experience gallery is a **read-only reuse of existing content** — no people, no swiping, no matching, no new content/feed system.
- **Admin tools** (the appeal *review* console is S9/P8; any moderation/ops UI is out).
- **Standalone settings / account systems** (notification preferences UI, account management, deletion flows — later/other slices).
- The clear-photo reveal at offer — S6's `match_reveal_allowed` (C2).

## 9. Dependencies & assumptions

- The first-session home **reuses existing After5 experience content** (curated itineraries/nights from the date-planner side) read-only as the anticipation gallery — no new content backend. It is built forward-compatible so the live S5/S6 loop can replace the anticipation state later.
- **Persona web SDK** added to `apps/web`. Sandbox keys already stored (`PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID` in `.env.local`); `PERSONA_WEBHOOK_SECRET` created at deploy.
- **Twilio sender** (Messaging Service SID / phone number) still required before live SMS; local dev uses Supabase's `test_otp` map.
- Consumes the existing `@after5/api-client` helpers (`getMyProfile`, `upsertProfile`, `savePreferences`, `getMyBadge`, `startVerification`, `confirmPhone`, `advanceOnboarding`, `registerDevice`) and validators (`PreferencesInputSchema`, `ProfileInputSchema`, `OnboardingStepSchema`).
- `registerDevice` is called at the end of onboarding to wire push notifications.

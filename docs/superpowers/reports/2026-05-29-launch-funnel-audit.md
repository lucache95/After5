# Launch Funnel Audit — Signup → Match (Kelowna tester cohort)

**Date:** 2026-05-29
**Scope:** Read-only. Web (`apps/web`) + prod Supabase (`ufufmcpnysvwtutpbian`, read-only).
**Question:** Where does a real new Kelowna user get stuck between "lands on the site" and "can match"?

## Headline

Nobody can match today. Prod has **27 profiles, 0 verified, 0 dating_enabled, 0 match-ready**. The funnel has two hard structural walls (phone SMS provider, and zero swipeable content) plus an identity-verification dependency (Persona), and a very leaky top (25/27 users abandon at step 1 before clicking "let's go").

To enter the matching loop a user must satisfy `deriveGateReason` (`apps/web/app/offers/[offerId]/gate.ts`) and the feed gate (`apps/web/app/feed/page.tsx:15`):
`dating_enabled = true` AND `verification = 'verified'` AND `account_state = 'active'`.

## Funnel table

| # | Step | Route / component | Requirement | Status | What clears it |
|---|------|-------------------|-------------|--------|----------------|
| 0 | Land | `/`, `/login` | — | PASS | — |
| 1 | Sign in | `/login` `LoginForm.tsx` | Google OAuth or email magic-link (OTP). No `/signup` route (confirmed). | PASS | Both methods route through `/auth/callback?next=`. |
| 2 | Age gate | `/onboarding/welcome` `WelcomeAgeGate.tsx` (`onboarding_step='age_gate'`) | Tick "I'm 18+", click "let's go" → `advanceOnboarding('basics')` | PASS (works) / **LEAK** | 25/27 prod users sit here and never advance — pure drop-off, not a code blocker. |
| 3 | Basics | `/onboarding/basics` (`basics`) | Name/gender/prefs/city | PASS | — |
| 4 | Photos | `/onboarding/photo` (`photos`) | Upload + crop photo | PASS (1 user here) | — |
| 5 | Preferences | `/onboarding/preferences` (`preferences`) | Match prefs | PASS | — |
| 6 | **Phone verify** | `/onboarding/phone` `PhoneVerifyStep.tsx` (`phone_verify`) | `updateUser({phone})` → SMS OTP → `verifyOtp({type:'phone_change'})` → `confirm-phone` writes `verifications(kind=phone, verified)` | **BLOCKER (hard wall)** | No SMS provider wired. See below. |
| 7 | Identity verify | `/onboarding/verify` `IdentityVerifyStep.tsx` (`selfie_verify`) | `start-verification` mints a Persona inquiry → ID+selfie → `persona-webhook` writes `verifications(age,selfie)` → rollup sets `verification='verified'` | **BLOCKER (dependency)** | Needs `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET` set + webhook registered. Cannot reach this step anyway until #6 clears. |
| 8 | Done / flip dating on | `/onboarding/done` `DoneStep.tsx` (`done`) | Client `update profiles set dating_enabled=true`; DB `enforce_age_gate` trigger requires a `profiles_private.birthdate` (written by Persona webhook) and 18+ | BLOCKER (transitive) | 0 birthdates on prod → trigger would `raise exception 'birthdate required'`. Birthdate only arrives via the Persona webhook (#7). |
| 9 | Feed / swipe | `/feed` → `browse_feed_for_viewer` | Approved, future, mutually-compatible `date_instances` in viewer's city | **BLOCKER (no content)** | Prod has 504 itineraries but **0 `date_instances`** → feed is empty even for a verified user. |

## The phone block, precisely

- **How it's wired:** Custom flow, NOT Twilio-via-edge-function. The client calls Supabase Auth directly: `auth.updateUser({phone})` to send the OTP, then `auth.verifyOtp({type:'phone_change'})`. The `confirm-phone` edge function only trusts the resulting `phone_confirmed_at` JWT claim and writes the verified row — it does not send SMS. So SMS delivery depends entirely on **Supabase Auth's SMS provider**.
- **What's missing:** `supabase/config.toml` has `[auth.sms.twilio] enabled = false` (and `account_sid`/`message_service_sid` empty). No `test_otp` map is committed. No `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`. Prod auth has never sent an SMS: **0 `auth.users` with a phone, 0 `phone_confirmed_at`, 0 `verifications` rows** at all.
- **Error a user hits:** On "text me a code", `updateUser({phone})` returns an Auth error (no SMS provider configured / `sms_provider` error). `PhoneVerifyStep.friendly()` surfaces the raw message; they never receive a code and cannot advance. The lone `phone_verify` user is stuck exactly here.

## Identity-verify status

Edge functions `start-verification`, `confirm-phone`, `persona-webhook` are all **ACTIVE on prod** (deployed). Code is correct (HMAC fail-closed, idempotent upserts, rollup trigger present). Unknown/likely-missing: Persona secrets and webhook registration. Moot for now — no user can reach step 7 because step 6 blocks first, and 0 inquiries exist.

## Prod `onboarding_step` distribution (27 users)

| step | count | meaning |
|------|-------|---------|
| age_gate | 25 | Signed in, never clicked "let's go" (top-of-funnel leak) |
| photos | 1 | Mid-onboarding |
| phone_verify | 1 | At the SMS wall |
| done | 0 | — |

Supporting: `dating_enabled_true=0`, `verified=0`, `match_ready=0`, `phone_confirmed_users=0`, `verification_rows=0`, `profiles_with_birthdate=0`, `date_instances=0`, `cities=1 (Kelowna)`.

## Ordered blockers (signup → match)

1. **Phone OTP — no SMS provider on prod auth.** Hard wall at step 6; nobody verifies a phone.
2. **Identity verify — Persona secrets/webhook unconfirmed.** Step 7; also the only source of `birthdate`, which the age-gate trigger needs at step 8.
3. **`dating_enabled` flip blocked transitively** — `enforce_age_gate` needs a birthdate that only Persona writes; 0 birthdates exist.
4. **Empty feed — 0 `date_instances` in Kelowna.** Even a fully verified user sees nothing to swipe (504 itineraries are not posted as swipeable nights).
5. **Top-of-funnel leak — 25/27 abandon at the age gate** (not a code bug; a content/motivation gap, made worse because there's nothing behind the wall yet).

## Minimum changes to let a real Kelowna tester go signup → match

Two real testers must each clear phone + identity + have someone to match with. Cheapest path:

1. **Unblock phone (pick one):**
   - **(a) Real provider:** enable Twilio in Supabase Auth (dashboard SMS provider; set `account_sid` + messaging service + auth token). Lets any real number verify. ~$ per SMS, real-world-accurate.
   - **(b) Tester bypass (cheapest):** add an uncommitted `[auth.sms.test_otp]` mapping for the testers' numbers (fixed code, e.g. `123456`) on prod auth — exercises the real verifyOtp path with no SMS spend. **Note the in-code warning that a fixed OTP must never reach prod;** acceptable only for a closed cohort, revert after.
   - **(c) Manual flag:** service-role insert `verifications(kind=phone, state=verified)` for known tester uids; the rollup recomputes. Skips the UI entirely.
2. **Unblock identity + birthdate (cheapest = manual flag):** service-role upsert `verifications(kind=age, state=verified)` and `(kind=selfie, verified)` for the testers, and `profiles_private.birthdate` (a valid 18+ date). Rollup → `verification='verified'`; birthdate satisfies the age-gate trigger. (Real path: configure Persona secrets + register the webhook.)
3. **Flip dating on:** with birthdate present, the tester clicks "flip dating on" at `/onboarding/done`, or service-role `update profiles set dating_enabled=true`.
4. **Seed swipeable content:** create approved, future `date_instances` in Kelowna for at least one verified creator so `browse_feed_for_viewer` returns nights. Without this the feed is empty regardless of verification. Two testers posting nights for each other is the minimum mutual-match setup.

**Single cheapest cohort unblock:** for the handful of known tester uids, service-role-flag `verifications` (phone+age+selfie=verified) + `profiles_private.birthdate` + `dating_enabled=true`, then seed a few approved future Kelowna `date_instances`. This sidesteps Twilio and Persona entirely and gets testers into the matching loop today; wire the real providers before opening to the public.

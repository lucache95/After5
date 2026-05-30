# After5 Reality Audit — User Journey + Trust-but-Verify

Date: 2026-05-30 · READ-ONLY · Authority: implementation > tests > migrations > types > routes > edge-fns > docs > plans.

## Ground truth (verified this run)

- **Prod DB** (`ufufmcpnysvwtutpbian`): 28 auth users / 28 profiles; **0 verified** (all `verification='unverified'`); **0 date_instances**, 0 swipes, 0 offers, 0 locks, 0 ratings; 0 jobs, 0 notifications, 0 reports. `match_v2_enabled = false`.
- **Edge functions: ALL 13 dating fns ARE deployed to prod** (match-shortlist/make-offer/accept/pass/withdraw/cancel-lock/resolve-reciprocal/demand-hint, start-verification, confirm-phone, persona-webhook, generate-blur, process-jobs). Prior "edge fns unwired" claim is STALE — they are live, just never exercised (0 rows).
- **Vercel: prod is live and the dating UI IS deployed**, but the deployed commit is `d350ab58` (5b-smoke fixes). HEAD `2107c82` (reveal hardening) + `bf1ebe8` (tester-cohort SQL) are **committed to main but NOT deployed**. So prod reveal predicates lack the latest expiry-gate/anon-revoke hardening.
- **process-jobs cron** wired in `apps/web/vercel.json` at `* * * * *` (Pro plan). Fires, but 0 jobs to process.
- **Web tests**: 220/223 pass; **3 fail** — all `PhotoStep.test.tsx` (stale test, see below).
- **Core DB tests** (psql direct): offer_invariant, lock_overlap, accept_lock, reveal_predicate, revealed_rls_negative, reveal_expiry, reciprocal, chat_core — **8/8 pass** locally. (`_all_5b.sh` runner is broken: it runs vitest first under `set -e`, so the PhotoStep failure aborts before any SQL/Deno test runs.)
- **chat_threads table EXISTS on prod** (DB layer present) but the matches UI ships `Phase7Placeholder` ("messages coming with phase 7" — tells users to swap numbers off-platform). Chat is DB-only, no UI, no edge fn.
- **Twilio**: `confirm-phone` only *records* a verified phone after the client calls `auth.verifyOtp` (Supabase phone auth). No Twilio account verified → OTP send blocked → phone step un-passable on prod.
- **Persona**: `start-verification` calls real Persona API gated on `PERSONA_API_KEY`/`PERSONA_TEMPLATE_ID` env. No prod inquiries exist; secrets/template unconfirmed → identity step unproven.

## Phase 2 — User Journey

| Transition | Route | State owner | Backend owner | DB owner | Notif owner | Tested? | Manually-proven? | Prod-ready? | BREAK? |
|---|---|---|---|---|---|---|---|---|---|
| Visitor→Signup | `/`, `/login`, `/auth/callback` | LoginForm | Supabase auth (PKCE) | auth.users | email | unit (callback) | yes (28 users) | **yes** | none |
| Signup→Onboarding | `/onboarding/*` | OnboardingShell | advanceOnboarding RPC | profiles.onboarding_* | — | unit | partial | mostly | none (flow exists) |
| Onboarding: Basics/Prefs | `/onboarding/basics,preferences` | step cmpts | RPC | profiles, profiles_private | — | unit | partial | yes | none |
| Onboarding: Photo | `/onboarding/photo` | PhotoStep+Cropper | generate-blur edge fn | profiles.blurred_photo_url | — | **RED (3 tests fail, stale)** | no | yellow | **BREAK: tests stale vs cropper; blur fn never run on prod** |
| Onboarding: Phone verify | `/onboarding/phone` | PhoneVerifyStep | confirm-phone + Supabase OTP | verification | sms | unit | **no** | **no** | **BREAK: Twilio not verified → no OTP send** |
| Verification: Identity | `/onboarding/verify` | IdentityVerifyStep/PersonaEmbed | start-verification + persona-webhook | verification | — | unit | **no** | **no** | **BREAK: Persona secrets/template unproven; 0 inquiries** |
| Verification→Dating-Ready | `/home` | HomeStateBanner, EnableDatingButton | dating-gate | profiles.verification | — | unit | **no** | **no** | **BREAK: 0 users ever reached verified** |
| Create Date | `/nights/new` | PostNightForm | record/post-night RPC | date_instances | — | unit | local-only | yellow | **BREAK: 0 date_instances on prod; needs verified user** |
| Browse / Feed | `/feed` | SwipeDeck | browse_feed_blind RPC | swipes | — | unit | local E2E | yellow | **BREAK: match_v2 OFF + 0 swipeable instances** |
| Match (swipe→shortlist) | `/feed` | SwipeDeck | match-shortlist, s5_swipe_hook | swipes, queue_entries | — | SQL+unit | local E2E | yellow | **BREAK: gated on match_v2_enabled=false** |
| Offer | `/dates/[slug]/interested`, `/offers/[id]` | MakeOfferModal, OfferDetail | match-make-offer | offers (one-active invariant) | notif enqueue | SQL+unit | local E2E | yellow | gated on match_v2; never on prod |
| Lock | `/matches/[lockId]` | LockDetail | match-accept-offer | locks, lock_participants (GiST no-overlap) | notif | SQL+unit | local E2E | yellow | never on prod |
| Reveal | `/matches/[lockId]` | RevealModal | reveal predicates (match_reveal_allowed_pair) | profiles RLS | — | SQL+unit | local E2E | yellow | **latest reveal-hardening NOT deployed to prod** |
| Communicate (chat) | `/matches/[lockId]` | **Phase7Placeholder** | **none** | chat_threads (orphan) | — | DB test only | **no** | **no** | **BREAK: chat NOT built — placeholder only** |
| Complete Date | `/matches/[lockId]` | LockDetail | match-complete / process-jobs | locks.status, jobs | notif | SQL+unit | local | yellow | never on prod |
| Rate | `/matches/[lockId]/rate` | RatingForm | rating RPC | match_ratings | — | SQL+unit | local | yellow | never on prod |
| Return | `/home`, `/matches` | MatchesList | — | — | — | unit | no | yellow | gated on whole loop |

## Phase 6 — Subsystem RAG

| Subsystem | Code? | Tests? | Meaningful? | Browser? | Mobile? | Integration? | Prod? | RAG | Justification |
|---|---|---|---|---|---|---|---|---|---|
| Onboarding | yes | yes | mostly | partial | yes(resp) | partial | partial | **YELLOW** | flow built+tested but PhotoStep tests stale-red; never completed end-to-end on prod |
| Verification | yes (edge fns deployed) | unit | mock-only | no | n/a | **no** | **no** | **RED** | Twilio unverified + Persona secrets unproven; 0 verified users |
| Feed | yes | unit+SQL | yes | local E2E | yes | local | **no** | **YELLOW** | real RPC + tests; gated off (match_v2=false), 0 instances on prod |
| Matching | yes | SQL+unit | yes | local E2E | n/a | local | **no** | **YELLOW** | swipe→shortlist proven locally; never on prod, flag off |
| Offers | yes | SQL+unit | yes (invariant tested) | local E2E | yes | local | **no** | **YELLOW** | one-active-offer invariant proven; not prod-exercised |
| Locks | yes | SQL+unit | yes (GiST overlap tested) | local E2E | yes | local | **no** | **YELLOW** | no-overlap exclusion proven; not prod |
| Reveal | yes | SQL+unit | yes | local E2E | yes | local | **no** | **YELLOW** | predicates proven locally; latest hardening undeployed to prod |
| Chat | DB table only | DB test | **no UI/fn** | **no** | no | no | **no** | **RED** | UI is Phase7Placeholder; no edge fn; chat_threads orphaned |
| Notifications | yes (dispatch RPC, process-jobs) | SQL+unit | yes | no | n/a | local | **no** | **YELLOW** | enqueue/dispatch tested; 0 notifications ever sent on prod; SMS path needs Twilio |
| Reports | yes (schema+RLS) | SQL | yes | no | no | no | **no** | **RED** | tables+policies exist; no UI surface, 0 reports, untested in app |
| Moderation | partial (blocks, admin_alerts, audit_log) | SQL | partial | admin only | no | no | **no** | **RED** | blocks/audit schema exists; no moderation UI/workflow proven |
| Date-Generation | yes (generate-plan v39) | — | yes (live) | yes | yes | yes | **yes** | **GREEN** | legacy planner live on prod, real generations; the working wedge |
| Admin | yes (eval/venues/insiders/feedback) | unit (API) | partial | yes | partial | partial | partial | **YELLOW** | admin dashboards deployed+working; dating-admin surfaces unexercised |
| Analytics | yes (analytics_events, PostHog) | SQL | partial | yes | n/a | partial | partial | **YELLOW** | event schema + PostHog wired; dating funnel has no data yet |

## Verdict

**Working on prod today**: signup/auth + the legacy date-*generation* planner (GREEN). Everything in the dating *match loop* is built and locally-proven but has never run on prod (match_v2 OFF, 0 verified users, 0 instances).

The journey hard-stops at **phone verification** (Twilio not verified) and **identity verification** (Persona secrets unproven). No user can pass these gates, so nobody reaches Dating-Ready, so the entire create→browse→match→reveal→rate loop has zero real traffic regardless of how well it tests locally.

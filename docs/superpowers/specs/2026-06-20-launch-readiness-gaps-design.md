# Launch-Readiness Gaps — Design

**Date:** 2026-06-20
**Status:** Proposed (awaiting approval)
**Author:** Lucas + Claude

## Context

Mapping Chris Raroque's "things I always do before launching" checklist against After5
surfaced three gaps. After5 is already live (v1.0, web-first Next.js + Supabase + Vercel),
so this is post-launch hardening, not pre-launch setup.

| Checklist item | After5 today | Gap |
| --- | --- | --- |
| In-app analytics | PostHog wired but inactive (no key) + planner-only events | Activate + cover the dating loop |
| Email sequences | Resend transactional + 1 weekly broadcast | No multi-step onboarding drip |
| Feedback (upvotable) | Private admin inbox (`user_feedback`) | No public feature-request board |

This spec covers all three as independent workstreams that share existing infrastructure.
They can ship in any order; recommended order is 1 → 2 → 3 (ascending effort).

Decisions locked with the user:
- Drip targets **signed-up users only**, **5 emails over 14 days**.
- Public board: **admin approves → public**, **logged-in users only** can vote.

---

## Workstream 1 — Activate PostHog + expand event taxonomy

### Goal
Get real funnel/churn data flowing the moment we launch, covering the actual dating loop
(not just the AI planner).

### What exists
`apps/web/app/PostHogProvider.tsx` initialises PostHog (cookieless localStorage,
autocapture off, session recording off) and no-ops gracefully when
`NEXT_PUBLIC_POSTHOG_KEY` is unset. A typed `track` helper exposes 6 planner events only.

### Changes

1. **Fix env example bug.** `.env.local.example` lists
   `NEXT_PUBLIC_POSTHOG_HOST=https://us.posthog.com`. Ingestion must target
   `https://us.i.posthog.com` (the code default is already correct). Update the example so a
   copy-paste into Vercel doesn't silently drop all events.

2. **Identify users.** On authenticated session, call `posthog.identify(userId)` with the
   Supabase auth UUID only (no email/PII) so funnels can follow a person across sessions.
   Add a `track.identify(userId)` / `track.reset()` pair; call `reset()` on logout.

3. **Expand the `track` helper** with dating-loop events (props are non-PII ids/enums):
   - `signup_completed`, `onboarding_completed`
   - `verification_started`, `verification_completed` (Persona)
   - `offer_sent`, `offer_received`, `offer_accepted`, `offer_declined`, `offer_expired`
   - `match_created`
   - `photos_revealed`
   - `chat_opened`, `message_sent`
   - `date_rated`

4. **Wire call sites.** Add the new `track.*` calls at the existing points in the loop
   (auth callback / onboarding completion, Persona webhook-driven UI, offer accept/decline
   actions, reveal screen, chat, close-loop rating). Exact files identified during planning;
   each call is one line, mirroring the existing planner instrumentation.

5. **Manual steps (Lucas, ~5 min):** create a free PostHog project → copy Project API key →
   set `NEXT_PUBLIC_POSTHOG_KEY` (and confirm `NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com`)
   in Vercel Production + Preview. Documented in the plan.

### Privacy
Keeps the current posture: cookieless, autocapture off, recording off, identify by UUID only.
No new consent banner needed. Consistent with the deferred-compliance stance in
`.planning/backlog.md` (no new PII surface).

### Out of scope
Session recording, feature flags, A/B experiments (PostHog supports them later; not now).

---

## Workstream 2 — Onboarding email drip

### Goal
Lift early retention by teaching lesser-known features over a new user's first two weeks
(Chris's highest-leverage email tactic).

### What exists
- `lib/email/resend.ts` — best-effort send wrapper (no-ops without keys).
- `ensureWelcomeSent` — idempotent welcome via `subscribers.welcome_sent_at`.
- `/api/cron/post-date-feedback` — the template: daily cron, find-by-date-window,
  send-if-not-sent, set flag. Auth via `CRON_SECRET`.
- `lib/email/unsubscribe-token.ts` — HMAC one-click unsubscribe; `subscribers.email_opt_out`.

### Design

**Audience gate:** subscribers where `welcome_sent_at IS NOT NULL` (= reached auth callback,
i.e. a real signed-up user) AND `email_opt_out = false`. Day 0 welcome is unchanged; the drip
is steps 1–5.

**Schedule (days after `welcome_sent_at`):**

| Step | Day | Topic (final copy drafted in plan) |
| --- | --- | --- |
| 1 | 2 | What the AI date planner can really do (power features) |
| 2 | 4 | How nights-first matching & offers work |
| 3 | 7 | Verification & safety — why After5 feels different |
| 4 | 11 | A power move (reuse a past night as a draft / share-to-vote) |
| 5 | 14 | Nudge: create or accept your first date + invite feedback |

Topics are placeholders pinned to real After5 features; copy is written during planning
(may use the `copywriting`/`emails` skill).

**State tracking:** new migration adds to `subscribers`:
- `drip_step int NOT NULL DEFAULT 0` (named `drip_step`, NOT `onboarding_step` — the
  `profiles` table already has an unrelated `onboarding_step` text enum for the signup wizard;
  avoid the collision)
- `drip_last_sent_at timestamptz`

**Cron `/api/cron/onboarding-drip` (daily):** for each step S (1→5) with day-offset D,
find rows where `welcome_sent_at <= now() - D days`, `drip_step = S-1`,
`email_opt_out = false`; send step S; **advance `drip_step` to S only on send success**
(a failed send leaves the step, so the next daily run retries — strictly better than the
post-date-feedback "mark regardless" approach for a multi-step sequence). One step max per
user per run. Supports `?dry_run=true` and `?secret=` like the other crons. Add entry to
`vercel.json` crons.

**Templates:** 5 new files in `lib/email/` using `layout.ts`, each with an unsubscribe link.

### Edge cases
- User unsubscribes mid-sequence → `email_opt_out=true` excludes them from all remaining steps.
- User signed up before this ships → backfill: a one-time decision to either start them at
  step 0 (they get the full drip late) or mark them complete. **Recommend:** set existing
  users' `drip_step` to 5 in the migration so only *new* signups get the drip.
- Welcome not yet sent → not in audience (correct).

### Out of scope
Behavioral/triggered emails (e.g. "inactive 7 days"); this is a time-based drip only.

---

## Workstream 3 — Public upvote board for feature requests

### Goal
Surface real demand via upvotes (the signal Chris says repeatedly beat his own guesses),
turning the private inbox into a public, prioritisable board.

### What exists
- `user_feedback` table: `kind ('bug'|'place_suggestion'|'feature'|'other')`, `subject`,
  `body`, `email`, `user_id`, `status ('open' default)`, RLS (public insert, public read).
- `/tell-us` submission form; `/admin/feedback` inbox.
- Voting precedent: `vote_sessions` / `plan_votes` (pattern reference for a votes table).

### Design

**Submission:** unchanged — users keep using `/tell-us` (`kind='feature'`). No new
submission UI. Bugs and place suggestions never go public.

**Curation (admin approves):** extend `user_feedback`:
- `is_public boolean NOT NULL DEFAULT false`
- `published_at timestamptz`
- `public_title text` (clean, public-facing title the admin sets)

Extend `/admin/feedback` with a "Publish to board" action (sets `is_public`, `published_at`,
`public_title`) and an "Unpublish" toggle. New server action / API route guarded by the
existing admin check.

**Status for the board (lightweight roadmap feel):** extend the `status` values used for
public items to `open → planned → shipped`, rendered as badges. Admin sets these from the
inbox. Private items keep `open`/`closed` as today.

**Voting (logged-in only):**
- New table `feature_votes (id uuid pk, feedback_id uuid → user_feedback, user_id uuid →
  auth.users, created_at timestamptz, UNIQUE(feedback_id, user_id))`.
- RLS: authenticated users insert/delete **their own** vote; anyone reads.
- Denormalised `user_feedback.vote_count int NOT NULL DEFAULT 0`, maintained by a trigger on
  `feature_votes` insert/delete (avoids N count queries on the board).
- `POST /api/ideas/[id]/vote` — auth required; toggles the caller's vote; returns new count
  and the caller's voted state. No rate-limiting needed (auth-gated + unique constraint).

**Public page `/ideas`:**
- Lists `is_public = true` feature requests ordered by `vote_count DESC, published_at DESC`.
- Each row: `public_title`, status badge, vote count, upvote button (toggles; prompts
  login if logged out).
- Header links to `/tell-us` ("got an idea? tell us") so the board feeds itself.
- Public read (no auth wall to browse); voting requires login.

### Edge cases
- Logged-out vote attempt → redirect to login, return to `/ideas` after.
- Shipped items stay visible (celebrates responsiveness) but sort below open/planned, or
  filter into a "shipped" section. **Recommend:** separate "recently shipped" section.
- Duplicate requests → admin merges by publishing one and closing the rest privately.

### Out of scope
Comments/threads on ideas, third-party tools (Canny/UserJot), email-on-status-change
notifications (could reuse Workstream 2 infra later).

---

## Testing strategy

- **W1:** unit-test the expanded `track` helper no-ops without a key; verify `identify`/`reset`
  guarded by `ensureInit`. Manual: confirm events land in PostHog after key is set.
- **W2:** unit-test the cron's selection logic (step gating, opt-out exclusion, success-only
  advance) with a mocked admin client, mirroring an existing cron test (e.g.
  `app/api/cron/process-jobs/route.test.ts` or `offer-expiring`). Dry-run in prod before
  first live send. (Note: `.env.local.example` lives at the **repo root**, not under `apps/web/`.)
- **W3:** unit-test the vote toggle (insert then delete restores count), the count trigger,
  and RLS (a user can't delete another's vote). E2E: publish from admin → appears on `/ideas`
  → logged-in upvote increments → logout hides the upvote affordance.

## Rollout order
1. Workstream 1 (lowest effort, highest regret-if-missing — do first so launch data is captured).
2. Workstream 2.
3. Workstream 3.

Each ships behind its own branch/PR off `main` (current branch is unrelated feature work).

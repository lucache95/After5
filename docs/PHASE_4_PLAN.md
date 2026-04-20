# Phase 4 — Save + Feedback Loop

> The data flywheel. Until users save plans + give feedback, we have no signal. After this phase, every used date makes the next stranger's search result better.

## Goal

A user who generates a plan can save it (email gate), get a follow-up email 24h after the date's start time, click into a feedback form, and have that feedback adjust the per-place quality score. By end of Phase 4, three plans have full feedback in the DB.

## Architecture

```
                 ┌──────────────────────────────────────────────┐
                 │  Supabase                                    │
                 │                                              │
   Plan flow ───►│  itineraries (user_id set on save)           │
                 │  feedback (one row per submission)           │
                 │  places.feedback_score (++ on loved, -- skip)│
                 │  pairings (place_a, place_b co-occurrence)   │
                 │                                              │
                 │  pg_cron: hourly job → enqueue follow-ups    │
                 │  Edge Function: send-followups (Resend)      │
                 │  Edge Function: submit-feedback              │
                 └──────────────────────────────────────────────┘
                                   │
                                   ▼
                          Resend (email transport)
```

## Prerequisites (block until done)

| # | Thing | Where |
|---|---|---|
| 1 | Resend account + API key | resend.com → API Keys |
| 2 | `RESEND_API_KEY` set in `.env.local` AND as Edge Function secret | `supabase secrets set` |
| 3 | Sender domain (start with `onboarding@resend.dev`, upgrade to `hello@after5.app` once domain is live) | Resend dashboard |
| 4 | Decide auth flow — magic link only (recommended) vs magic link + OAuth | Decision in this doc |

## Decisions to lock before coding

- **Auth**: magic link only for v1. No password, no OAuth. Lower friction, smaller blast radius. Add Google later if email conversion lags.
- **Save UX**: anonymous generation stays free. The save button gates email. After magic-link click, we redirect back to the plan they were saving.
- **When to send the follow-up email**: if user provided `start_at`, fire 24h after it. If not, fire 48h after generation (assume they used it the next evening). Skip if they delete the plan.
- **What feedback we collect**: 3 questions per itinerary. NEVER thumbs up/down. See Question Schema below.
- **Anonymity**: feedback rows store `user_id` for analysis, but display in the public library only shows aggregate love counts.

## Tasks (in order)

### 4.1 Auth setup

| # | Task | Acceptance |
|---|---|---|
| 1 | Configure Supabase Auth: enable email magic link, disable password | Dashboard → Auth → Providers shows Email enabled, password disabled |
| 2 | Set magic link redirect URL to `http://localhost:3000/auth/callback` (dev) and `https://after5.app/auth/callback` (prod, added later) | Supabase Auth settings |
| 3 | Build `/app/auth/callback/route.ts` — exchanges code for session | Hitting the callback URL with a valid code logs the user in |
| 4 | Build `/components/SignInModal.tsx` — single email input + "Send link" button | Magic link arrives, click → user is logged in |
| 5 | Add `useUser()` hook in `lib/supabase/use-user.ts` | Components can read auth state |
| 6 | Add Supabase auth middleware (`middleware.ts`) for session refresh on every request | Server components see fresh user across navigations |

### 4.2 Save plan flow

| # | Task | Acceptance |
|---|---|---|
| 1 | Add `user_id` association: when generate-plan is called by an authed user, set `user_id` on the inserted itinerary | Verify via SQL: itineraries.user_id = auth.uid() for new auth'd generations |
| 2 | Add "Save plan" button to `/plan` results panel | Button visible on each result card |
| 3 | If user is anonymous, clicking "Save" opens `SignInModal` and stashes the plan ID in sessionStorage. After magic-link auth, run `claim-plan` to set user_id on the stashed plan | Anonymous user clicks save → email → magic link → returns to /plan/i/[id] showing it's saved |
| 4 | Build Edge Function `claim-plan` — sets user_id on a given itinerary if it has none. Idempotent. | curl test passes |
| 5 | Build `/app/saved/page.tsx` — server component listing user's itineraries | Authed user sees their saved plans, anonymous users get a sign-in prompt |
| 6 | Add nav link to "Saved" when authed | Visible in sticky nav after sign-in |

### 4.3 Follow-up email (24h after the date)

| # | Task | Acceptance |
|---|---|---|
| 1 | Migration: add `followup_sent_at timestamptz` and `followup_scheduled_at timestamptz` to itineraries | Schema applied |
| 2 | When generate-plan saves an itinerary, set `followup_scheduled_at = COALESCE(start_at, now()) + interval '24 hours'` | Verify via SQL |
| 3 | Build Edge Function `send-followups` — finds itineraries where followup_scheduled_at < now() AND followup_sent_at IS NULL AND user_id IS NOT NULL. For each, sends an email via Resend, sets followup_sent_at | curl test fires emails for due plans |
| 4 | Set up `pg_cron` to run `select net.http_post('https://[ref].functions.supabase.co/send-followups', ...)` every hour | Cron job listed in dashboard |
| 5 | Email body: subject "How was last night?", short preheader, single CTA "Tell us what worked" linking to `/feedback/[itinerary_id]` | Real email received in inbox |
| 6 | Email design: Refined Minimal — off-white bg, off-black text, single sienna CTA, no logos beyond After5 wordmark, no images | Visual review |

### 4.4 Feedback form

| # | Task | Acceptance |
|---|---|---|
| 1 | Build `/app/feedback/[id]/page.tsx` — server component, reads itinerary, shows feedback form | Page renders for any valid id |
| 2 | Form fields (3 questions, never thumbs up/down): Q1 "Which stop did you love most?" (radio of stops), Q2 "Which would you skip?" (radio of stops + "none"), Q3 "Was the timing right?" (radio: too rushed / perfect / too much downtime). Optional Q4 free text. | Form submits |
| 3 | Edge Function `submit-feedback` — Zod-validate, insert into feedback table | curl test inserts row |
| 4 | After submit: increment `places.feedback_score` and `places.total_loved` for loved_place_id; decrement feedback_score and increment total_skipped for skipped_place_id | Verify via SQL after submit |
| 5 | Update `pairings` table — for each adjacent pair in the itinerary, increment `appearances`, increment `loved` if both not skipped, increment `skipped` if either skipped | Verify via SQL |
| 6 | After submit, redirect to a "Thanks" page with one CTA: "Plan another date" | Visual review |

### 4.5 Per-place + pairing math

Triggered inside `submit-feedback`:

```
on insert into feedback:
  if loved_place_id:
    update places set
      feedback_score = feedback_score + 0.3,
      total_loved = total_loved + 1
    where id = loved_place_id
  
  if skipped_place_id:
    update places set
      feedback_score = feedback_score - 0.4,
      total_skipped = total_skipped + 1
    where id = skipped_place_id

  for each adjacent pair (a, b) in itinerary.stops:
    insert into pairings (place_a, place_b, appearances, loved, skipped)
    values (a, b, 1, <0 or 1>, <0 or 1>)
    on conflict (place_a, place_b) do update set
      appearances = pairings.appearances + 1,
      loved = pairings.loved + EXCLUDED.loved,
      skipped = pairings.skipped + EXCLUDED.skipped
```

### 4.6 Quality guardrails

| # | Task |
|---|---|
| 1 | Rate-limit feedback submission: 1 per (user_id, itinerary_id) per 7 days |
| 2 | Negative feedback weighted lighter than positive (+0.3 loved vs -0.4 skipped) — gives benefit of the doubt to places with sparse data |
| 3 | Manual review queue: any place dropping > 1.5 in feedback_score in 7 days surfaces in the admin dashboard (Phase 6) |

## Schema changes

```sql
-- 4.1
alter table itineraries
  add column followup_scheduled_at timestamptz,
  add column followup_sent_at timestamptz,
  add column saved_at timestamptz;

create index idx_itineraries_followup_due
  on itineraries (followup_scheduled_at)
  where followup_sent_at is null
    and user_id is not null;

-- 4.2 — pairings table already exists from initial migration
-- but add a check that place_a < place_b to dedupe (a,b) vs (b,a)
alter table pairings
  add constraint pairings_ordered check (place_a < place_b);
```

## New env vars

```
# .env.local — local dev
RESEND_API_KEY=re_***
RESEND_FROM_EMAIL=onboarding@resend.dev   # upgrade to hello@after5.app once domain verifies

# Edge Function secrets (supabase secrets set)
RESEND_API_KEY=re_***
RESEND_FROM_EMAIL=onboarding@resend.dev
APP_BASE_URL=http://localhost:3000        # for email link generation; flip to https://after5.app for prod
```

## Cost

- Resend free tier: 3000 emails/mo, 100/day. Plenty for first thousand users.
- pg_cron: free on all Supabase tiers.
- Auth: free up to 50,000 monthly active users on Supabase.

## Acceptance for the whole phase

```bash
# After full phase:
# 1. A user can complete the auth flow
# 2. Save 3 different plans
# 3. Receive a follow-up email 24h later (test by manually setting start_at to 25h ago)
# 4. Click email link, submit feedback for all 3
# 5. Verify in DB:
psql $DB -c "select count(*) from feedback where user_id = '$UID'"   # → 3
psql $DB -c "select id, feedback_score, total_loved from places where total_loved > 0"
# Should show non-zero feedback_score on places they loved
```

## Risks

- **Magic link UX is friction.** Some users will type the email and bounce. Mitigation: only gate the FIRST save in a session (let them generate freely), make the email flow as fast as possible.
- **Email goes to spam.** Mitigation: use Resend's default reputation initially, set up SPF/DKIM/DMARC when we move to hello@after5.app.
- **Users don't return for feedback.** Mitigation: subject line A/B (test "How was last night?" vs "Did the plan land?"). Add a 7-day reminder if no response to first email (later optimization).
- **Bot signups via magic link.** Mitigation: rate-limit magic link sends per IP. Supabase has this built-in.

## Estimated time

- 4.1 Auth: 4 hr
- 4.2 Save flow: 3 hr
- 4.3 Follow-up email: 5 hr (cron + email design)
- 4.4 Feedback form: 4 hr
- 4.5 Math + guardrails: 2 hr
- **Total: ~18 hr** (~2-3 work days)

## What this unlocks

- The data that powers the **library quality gate** in Phase 5 (auto-promote itineraries with `loved_count >= 3`)
- The signal for **per-place ranking** that improves every generation from this point onward
- The **return user mechanic** (save → email → come back to generate again)
- A **subscription paywall** trigger (when a user hits their 2nd save in a month, prompt for Plus)

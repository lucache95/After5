# Waitlist Landing Page + Referral Loop — Implementation Plan

**Date:** 2026-06-20
**Status:** Proposed (awaiting go)
**Serves:** Phase 0 of `.planning/2026-06-20-kelowna-launch-plan.md` — the owned-channel
engine every influencer/radio push funnels into.

## Locked decisions
- **Referral loop** (not just email capture) — each signup gets a shareable code + "move up the line."
- **Hard countdown to Sept 8, 2026.**
- **Real app screenshots inside an iPhone frame** (CSS frame, not the PNG).
- Beachhead copy: Kelowna **young professionals 25–35**.

## Scope

### 1. Data (migration)
Extend `subscribers` (already holds email + welcome/opt-out):
- `referral_code text UNIQUE` — short code minted on insert (e.g. 6-char base32).
- `referred_by text NULL` — the code that referred them (FK-ish, soft).
- `joined_at timestamptz DEFAULT now()` — for "position in line" ordering.
- `source text NULL` — utm/influencer attribution.
- View/RPC `waitlist_position(code)` → rank by `joined_at` minus a credit per confirmed
  referral (referrals pull you up the line). Position = `row_number() - referral_credits`.
- `referral_count` computed via `count(*) where referred_by = code`.

RLS: insert open (like existing feedback), no public select of emails; position lookup via
a SECURITY DEFINER RPC that returns only the caller's own position + count by code.

### 2. API
- `POST /api/waitlist` — `{ email, referred_by?, source? }` → upsert subscriber, mint code,
  fire welcome (reuse `ensureWelcomeSent`), return `{ code, position, referral_count }`.
  Rate-limited per IP (reuse the feedback-route limiter pattern). Idempotent on email.
- `GET /api/waitlist/[code]` — returns `{ position, referral_count }` for the share page.

### 3. Page — public `/` (logged-out), redirect authed users away
**Separation of concerns (founder note 2026-06-20):** all *marketing/explainer* content
lives ONLY on the public page. The authed `/home` currently re-pitches the product
("how it works") to people who already signed up — that copy moves here. A logged-in user
who hits `/` is **redirected immediately to `/feed`** (founder 2026-06-20) — the feed is the
value surface; signed-in users never see the marketing/waitlist pitch.

Sections (Barbiecore, mobile-first, `DESIGN-SYSTEM.md`):
1. **Hero** — Kelowna 25–35 hook + the countdown + email form above the fold.
2. **iPhone-frame showcase** — `<PhoneFrame>` (CSS) wrapping real screenshots; 2–3 frames
   (feed, a night detail, the reveal) in a slight scatter/tilt (polaroid energy).
3. **How it works** — 3 steps (browse nights → match on the plan → show up).
4. **Why join now** — founding-member framing + the verified/safety trust angle.
5. **Post-signup state** — replaces the form with: your position, your share link, referral
   count, and "share to move up" (native share + copy). This is the viral loop.

### 4. Components
- `PhoneFrame` (CSS iPhone shell, themeable, holds a screenshot or live node).
- `CountdownToLaunch` (client; ticks to 2026-09-08; degrades to "launching soon" past date).
- `WaitlistForm` (client; posts to API; renders the post-signup share state).
- `ShareCard` (copy link + native `navigator.share`, with referral code embedded).

### 5. Screenshots
- Now: capture **public** screens (`/`, `/dates`, `/dates/[slug]`) at iPhone viewport via
  Playwright against the running app; store under `public/screens/`.
- Later: seed a verified `dating_enabled` user locally, capture offer/reveal/chat.
- `PhoneFrame` references `public/screens/*` so swaps are a file drop, no code change.

### 6. Analytics (uses the new `track` infra)
- `waitlist_joined` (with `referred: boolean`), `referral_link_shared`, `waitlist_viewed`.
- Add these helpers to the `track` object in `PostHogProvider.tsx`.

## Out of scope (v1)
- Influencer-specific per-code dashboards (use `source` field + PostHog for now).
- Email drip to waitlisters who haven't signed up (that's Workstream 2, post-launch).
- Deep-loop screenshots until a seeded session exists.

## Build order
1. Migration + `/api/waitlist` (+ tests) — the functional core.
2. `PhoneFrame` + `CountdownToLaunch` + `WaitlistForm` + `ShareCard`.
3. Assemble `/waitlist` page + copy.
4. Capture public screenshots, drop into frames.
5. Wire analytics. Typecheck + tests + visual check.

## Verification
- API: unit tests (insert, idempotent re-signup, referral attribution, position math).
- Page: renders, form posts, post-signup share state appears, countdown ticks.
- Visual: Playwright screenshot at 420px + critique vs DESIGN-SYSTEM before "done".

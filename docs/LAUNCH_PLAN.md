# Launch Plan — Polish, Vercel, Domain, Real Users

> Get After5 live at after5.app, polished enough that the first 100 users have a memorable experience and tell a friend. This is the work that matters between "it works on localhost" and "it's a real product."

## Goal

after5.app is live, on a custom domain, with all core flows polished, analytics + error monitoring wired, the concierge cohort invited, and a public launch post live on r/kelowna. Within 7 days of launch, 100 real users complete a generation.

## Architecture (no new pieces — just hardening)

```
Cloudflare DNS
   │
   ├─► Vercel (apps/web, auto-deploys from main, PR previews)
   │     ├─ NEXT_PUBLIC_SUPABASE_URL
   │     ├─ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   │     └─ NEXT_PUBLIC_POSTHOG_KEY
   │
   └─► Supabase (already live)
         ├─ Production schema (frozen for v1; migrations via PR)
         ├─ Edge Function: generate-plan (live)
         ├─ Edge Function: send-followups (Phase 4)
         ├─ Edge Function: submit-feedback (Phase 4)
         └─ pg_cron: hourly auto-promote (Phase 5)

PostHog (analytics, web SDK)
Sentry (errors, web + edge)
Resend (transactional email, Phase 4)
```

## Prerequisites

| # | Thing | Where |
|---|---|---|
| 1 | Phase 4 complete (Save + Feedback) | TECH_PLAN |
| 2 | Phase 5 complete (Public Library + SEO infrastructure) | TECH_PLAN |
| 3 | Domain decided + purchased | Cloudflare or Namecheap (~$15-30/yr for `.app`) |
| 4 | PostHog account + project key | posthog.com (free up to 1M events/mo) |
| 5 | Sentry account (optional but recommended) | sentry.io (free up to 5k errors/mo) |
| 6 | Concierge cohort list — the 50 people from week 1 hand-planned dates | docs/concierge-log.md |

## Decisions to lock

- **Domain**: `after5.app` is the priority. Backups: `after5.co`, `getafter5.com`, `after5kelowna.com`. Buy `.app` (most premium feel, native HTTPS via TLD policy).
- **Vercel plan**: free tier covers MVP (100GB bandwidth/mo, 100k function invocations). Upgrade to Pro ($20/mo) when bandwidth approaches limit.
- **Cloudflare for DNS, NOT for routing**: keep the request path Vercel direct. Use Cloudflare for DNS only (free, fast, native DNSSEC).
- **Analytics**: PostHog only for v1. No Google Analytics (slower, less useful). Consider Plausible later if EU regs become a concern.
- **Cookie banner**: NOT required for v1. PostHog can be configured cookieless (uses localStorage, no cross-site tracking). Add banner only if/when we ship retargeting pixels.
- **Privacy policy + terms**: required by Apple/Google later. Generate via [Termageddon](https://termageddon.com) or hand-write a 1-pager. v1 minimum: "We use Supabase, PostHog, Resend. We don't sell your data. Email lucas@after5.app to delete your data."

## Tasks (in order)

### L.1 Polish — error states, empty states, perf

| # | Task |
|---|---|
| 1 | Add a 404 page (`app/not-found.tsx`) — Refined Minimal, brand-on-voice ("That page is somewhere else.") |
| 2 | Add an error boundary (`app/error.tsx`) — handle generation failures gracefully |
| 3 | Add empty state to `/saved` — "No plans saved yet. Try one." |
| 4 | Loading skeletons consistent across the app (currently /plan has skeletons, /saved doesn't yet) |
| 5 | Verify all images have explicit width/height to avoid CLS |
| 6 | Audit contrast against WCAG AA — text-muted on bg-surface should pass at 4.5:1 |
| 7 | Keyboard nav — verify Tab order through the 5-step plan flow is sensible |
| 8 | Mobile QA — open on actual iPhone Safari at 390px, verify hero, plan flow, and detail page all work |
| 9 | Performance — Lighthouse on the landing page. Targets: LCP <2s, CLS <0.1, no console errors |

### L.2 Vercel deploy

| # | Task | Acceptance |
|---|---|---|
| 1 | Go to vercel.com/new → Import Git Repository → select `lucache95/After5` | Project created |
| 2 | Configure: Root directory = `apps/web`, Framework = Next.js (auto), Build command = `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @after5/web build`, Install command = empty | Settings saved |
| 3 | Add env vars in Vercel dashboard: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Deploy succeeds |
| 4 | Trigger first deploy. Verify the Vercel-assigned URL serves the landing page correctly | curl HTTP 200, full page renders |
| 5 | Verify the generate-plan flow works against production Supabase | manually generate a plan from the Vercel URL |

### L.3 Domain

| # | Task | Acceptance |
|---|---|---|
| 1 | Buy `after5.app` via Cloudflare or Namecheap | Domain in account |
| 2 | Add DNS to Cloudflare: A record pointing to Vercel's IP, AAAA for IPv6, plus the verification CNAME Vercel asks for | DNS propagates |
| 3 | Add `after5.app` to the Vercel project (Settings → Domains) | Vercel detects DNS, issues SSL via Let's Encrypt |
| 4 | Update Supabase Auth allowed redirect URLs: add `https://after5.app/auth/callback` | Magic link works in prod |
| 5 | Update Edge Function CORS: tighten from `*` to `https://after5.app` | curl from another origin fails 403 |
| 6 | Update `metadataBase` in `app/layout.tsx` to `https://after5.app` | OG card preview tools show correct URL |
| 7 | Update `RESEND_FROM_EMAIL` to `hello@after5.app` (after Resend domain verifies) | Test email arrives from hello@after5.app |

### L.4 Analytics + monitoring

| # | Task | Acceptance |
|---|---|---|
| 1 | Install PostHog: `pnpm add posthog-js` in `apps/web`. Wire `app/PostHogProvider.tsx` (client component) and wrap children. | Events flow to PostHog dashboard |
| 2 | Define event taxonomy: `landing_viewed`, `plan_started`, `plan_step_advanced` (with step number), `plan_generated` (with template_id, vibe), `plan_saved`, `plan_shared`, `feedback_submitted` | All events visible in PostHog Events |
| 3 | Set up PostHog funnel: landing → plan_started → plan_generated → plan_saved | Funnel chart renders |
| 4 | Install Sentry: `pnpm add @sentry/nextjs`. Wire via `next.config.mjs`. Add the source maps upload step. | Sentry dashboard shows test event |
| 5 | Wrap Edge Function in try/catch with Sentry capture | Test by forcing a failure → appears in Sentry |

### L.5 Privacy policy + minimal compliance

| # | Task |
|---|---|
| 1 | Write `app/privacy/page.tsx` — 200-word policy: what we collect, why, how to delete |
| 2 | Write `app/terms/page.tsx` — 200-word terms: usage, no warranty, BC jurisdiction |
| 3 | Add footer links to /privacy and /terms |
| 4 | Add `<meta name="rating" content="general">` for completeness |

### L.6 Concierge cohort invite

| # | Task |
|---|---|
| 1 | Compile concierge-log.md emails into a list of ~50 |
| 2 | Send personal message via Instagram DM (preferred) or email — "Remember the date plan I sent you? I built it as an app. You're getting access first. Would mean a lot if you tried it: after5.app" |
| 3 | Track who tries it via PostHog (UTM tag the message: `?utm_source=concierge&utm_medium=dm`) |
| 4 | Follow up after 3 days with the people who didn't try it |

### L.7 Public launch

| # | Task | Day |
|---|---|---|
| 1 | Final visual QA on after5.app | Launch day -1 |
| 2 | Write Reddit r/kelowna post: "Built a date planner specifically for Kelowna. Free, no signup." Genuine, no marketing-speak. | Launch day |
| 3 | Post to Kelowna Facebook groups (Real Kelowna, Kelowna 30s, etc.) | Launch day |
| 4 | Instagram launch carousel — 10 posts: hero, 3 sample plans, 3 user testimonials (from concierge cohort), 1 "how it works" carousel, 1 founder story | Launch day |
| 5 | TikTok: "I built an app that plans your Kelowna date in 30 seconds. Watch me test it on a real date." Show the flow → execute the date → show how it went. | Launch week |
| 6 | Pitch Tourism Kelowna for a blog placement | Launch week +1 |
| 7 | Email lucas@after5.app set up + watched | Always |

### L.8 First-week monitoring

| # | Watch | Action threshold |
|---|---|---|
| 1 | PostHog landing → plan_started funnel | <30% conversion → fix landing copy |
| 2 | PostHog plan_started → plan_generated | <70% completion → simplify a step |
| 3 | Sentry error rate | >2% → halt feature work, fix |
| 4 | Vercel bandwidth | >50% of free tier → upgrade plan |
| 5 | Anthropic API spend | >$5/day → tighten prompt cache, lower output tokens |
| 6 | Supabase egress | >50% of free tier → optimize images/queries |

## Schema changes

None for launch itself. All schema is locked from Phases 0-5.

## New env vars (production, set in Vercel dashboard)

```
NEXT_PUBLIC_SUPABASE_URL=https://ufufmcpnysvwtutpbian.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_***
NEXT_PUBLIC_POSTHOG_KEY=phc_***
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
NEXT_PUBLIC_SENTRY_DSN=https://***@***.ingest.sentry.io/***
NEXT_PUBLIC_APP_URL=https://after5.app
```

## Cost (annualized)

| Service | Cost |
|---|---|
| Domain (after5.app) | ~$20/yr |
| Vercel free tier | $0 |
| Supabase free tier (Phase 0-1) → Pro ($25/mo) when MAU hits 50k | $0–300/yr |
| Anthropic — projected at 1k generations/mo | ~$30/mo = $360/yr |
| Resend free tier (3k emails/mo) | $0 |
| PostHog free tier (1M events/mo) | $0 |
| Sentry free tier | $0 |
| **Year-1 total at MVP scale** | **~$400** |

## Acceptance for launch

```bash
# All pass on launch day:
curl -sI https://after5.app | grep -E 'HTTP|content-type'
# → HTTP/2 200, content-type: text/html

# Landing page Lighthouse:
# Performance >= 90, Accessibility >= 95, SEO >= 100, Best Practices >= 100

# A real user can:
# 1. Land on after5.app
# 2. Generate a plan in <30s of input
# 3. Open in Maps successfully
# 4. Share the URL — link preview shows OG image correctly

# 7-day metrics:
# - 100+ generations completed
# - 25%+ save rate (saved / generated)
# - 0 P0 errors in Sentry
# - At least 3 inbound emails to lucas@after5.app
```

## Risks

- **Vercel build fails on monorepo**: pnpm + Turborepo + Next.js root-directory edge case. Mitigation: have Railway as fallback (already linked).
- **Supabase free-tier rate limit**: hit if a pillar page goes viral. Mitigation: Vercel ISR caches everything for 1hr, so the DB barely sees traffic. Still — bump to Pro at first sign of throttling.
- **Domain misconfig delays launch**: DNS propagation can take 24h. Mitigation: do DNS work 48h before launch.
- **Edge Function CORS too tight kills dev**: when tightening to `https://after5.app`, dev environment breaks. Mitigation: use `Vary: Origin` and conditional logic — allow `localhost:3000` always, prod URL in prod.
- **Bot abuse on generate-plan**: someone scripts 1000 calls. Mitigation: Supabase Edge Function rate-limits per IP (built in). Add captcha if abuse spikes.

## Estimated time

- L.1 Polish: 6 hr
- L.2 Vercel: 1 hr
- L.3 Domain: 2 hr (mostly waiting on DNS)
- L.4 Analytics + Sentry: 3 hr
- L.5 Privacy/Terms: 1 hr
- L.6 Concierge invites: 3 hr (writing personal messages)
- L.7 Public launch posts: 4 hr
- **Total: ~20 hr** plus DNS wait time → 1 week to be fully launched, conservatively

## What this unlocks

- **A real product real Kelowna users can try.** No more "it works on localhost."
- **Conversion data** that tells us what to build next.
- **A public URL** to put on Instagram, TikTok, business cards.
- **The compounding loop**: people use it → loved itineraries become public → SEO ranks → strangers find them → loop.
- **Investor / partner conversations** become possible. "We have N users in Kelowna" beats "we're building."

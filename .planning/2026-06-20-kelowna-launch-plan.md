# After5 — Kelowna Launch Plan

**Date:** 2026-06-20
**Owner:** Lucas
**Status:** Proposed

## The strategic frame

After5 is a **two-sided local dating marketplace**, not a typical SaaS. The binding
constraint is **cold-start liquidity in one geography**: signups must arrive dense in
*place* (Kelowna) and *time* (launch week) or the feed feels empty and users churn.
Global launch tactics (Product Hunt, HN, broad social) are low-value — a non-Kelowna
signup can't date here. **Everything optimizes for local density.**

### Locked inputs (2026-06-20)
- **Traction:** <25 friendly testers. True first launch.
- **Model:** Waitlist now → full launch when v2.0 (AI planner) ships.
- **Beachhead:** Young professionals 25–35 (income for real date nights; value curated
  experiences; trust/safety matters; aligns with venue-sponsor + older-media halo).
- **Budget:** $1k–$5k.

### Keystone: launch date = **week of Sept 8, 2026** (post-Labour-Day)
Build the waitlist all summer (patio season = best content + energy); launch into the
**cuffing-season** dating-intent ramp. Fallback: late Sept if v2.0 slips past mid-August.

### Liquidity trigger (go/no-go)
Flip the live app on only at **~400–600 Kelowna 25–35 waitlist signups** with reasonable
gender balance. Tracked in PostHog. Below threshold → hold; above → green-light.

---

## Channel plan (ORB framework)

**Owned (the destination — everything funnels here):**
- Reworked landing page + **waitlist** (email capture via existing `subscribers` table + Resend).
- Email: welcome + the onboarding drip (Workstream 5) + launch-day blast.
- Referral loop on the waitlist ("move up the line / unlock founding-member perk").

**Rented (drive traffic to owned):**
- IG + TikTok, **Kelowna-local**. Founder-led behind-the-scenes + date-night content.
- Geo-targeted IG/TikTok ads to 25–35 Kelowna (small spend, retarget waitlist visitors).

**Borrowed (instant local credibility → funnel to waitlist):**
- **Local micro-influencers (3–5):** Kelowna lifestyle creators, 5–30k *local* followers.
  Gift the experience (comp a real After5 date night) — not cash. Each gets a referral code.
  Audience *geography* > audience *size*.
- **Media connector (the 70-yo):** radio + local sponsors. Build the pipeline NOW; **fire
  radio at launch week**, not before (spikes only convert against a ready funnel). Halo =
  trust/credibility (key for a dating app) + venue-sponsor relationships (dates happen at
  venues) + reaches an underserved older-dating segment. Pair with influencers for core demo.

---

## Timeline & workstreams

Six workstreams mapped to four phases. "Me" = Claude can build/draft; "Lucas" = founder action.

### Phase 0 — Foundation (now → ~Jul 4) — *prerequisites for collecting signups*
| # | Workstream | Owner | Notes |
|---|---|---|---|
| 1 | **Turn on PostHog** | Lucas + Me | Me: fix env-host bug, expand dating-loop events. Lucas: create project, set key in Vercel. *Do first — it measures everything incl. the liquidity trigger.* |
| 2 | **Brand kit** | Me + Lucas | Formalize Barbiecore `DESIGN-SYSTEM.md` into shareable assets: logo lockups, color/type tokens, voice & tone, social templates, **app screenshots** for landing + influencers. Feeds the landing page. |
| 3 | **Landing page rework + waitlist** | Me | Hero w/ real screenshots, Kelowna 25–35 copy, email capture → `subscribers`, launch-date countdown, **referral mechanic** (viral waitlist loop), founding-member framing (exclusivity). Uses brand kit. |

### Phase 1 — Waitlist build (Jul → Aug) — *accumulate to liquidity while finishing v2.0*
| # | Workstream | Owner | Notes |
|---|---|---|---|
| 4 | **v2.0 AI planner** | Lucas (existing roadmap) | The launch gate. Plan tracks its ETA; launch date keys off it. |
| 5 | **Onboarding email drip** | Me | 5 emails/14 days. Ready to fire the moment users convert from waitlist → app. |
| — | **Influencer outreach** | Lucas | Line up 3–5 Kelowna creators; gift date nights; schedule posts to cluster near launch week. |
| — | **Sponsor/radio pipeline** | Lucas + connector | Warm relationships now; lock radio spots + sponsor commitments for launch week. |
| — | **Founder-led social** | Lucas | Build IG/TikTok presence; document the build; patio/date-night content. |

### Phase 2 — Launch week (~Sept 8) — *fire everything at once for density*
| # | Action | Owner |
|---|---|---|
| 6 | **Public upvote board** | Me — live before launch so day-one users shape the roadmap |
| — | Flip app on for waitlist (batched or all-at-once) | Lucas |
| — | Influencer posts go live (clustered same week) | Creators |
| — | **Radio + local sponsor push** (connector) | Lucas + connector |
| — | Launch email blast to waitlist | Me (build) / Lucas (send) |
| — | Optional: small launch event at a sponsor venue | Lucas |

### Phase 3 — Post-launch — *convert & retain*
- Drip running; weekly digest already exists; upvote board collecting signal.
- Watch PostHog funnel (signup → verify → first offer → match → date → rating); fix the
  biggest drop-off.
- Follow up with every engaged lead; convert borrowed attention → owned (email).

---

## What's NOT in this launch (deliberately)
- Product Hunt / HN / broad national social — wrong audience geography for a local marketplace.
- Native mobile apps — parked (web-first; PWA covers add-to-homescreen).
- Paid acquisition at scale — budget goes to gifting + a little geo-retargeting, not cold scale.

## Immediate next actions (this week)
1. Turn on PostHog (Lucas: 5 min) + Me: env fix + dating-loop events.
2. Start the brand kit (screenshots + asset pack).
3. Rework landing page with waitlist + referral.
(The 3 eng-readiness items — PostHog, drip, upvote board — are specced & reviewer-approved
in `docs/superpowers/specs/2026-06-20-launch-readiness-gaps-design.md`.)
```

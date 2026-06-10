# Onboarding Funnel Audit — 2026-06-09

Demand-side companion to the corpus/feed work: supply is now on the shelf
(11 varied upcoming nights), so the question is whether browsers can get to it.
Grounded in live prod data (`ufufmcpnysvwtutpbian`) + a code walk of the
onboarding wizard and its gates. **Findings only — no fixes applied.**

---

## The funnel (prod, real users only — seed hosts excluded)

| Stage | Users | % of signups |
|---|---|---|
| Signups (auth.users with profile) | **37** | 100% |
| Completed onboarding (`done`) | **5** | 13.5% |
| Verified (Persona) | 4 | 10.8% |
| Has clear photo | 2 | 5.4% |
| **`dating_enabled` (can browse the feed)** | **2** | **5.4%** |
| Active in last 7 days | 4 | — |

### Where they stall

| `onboarding_step` | Users | Of which signed up ≤14d |
|---|---|---|
| `age_gate` (step 1) | **28** | 5 |
| `done` | 5 | 5 |
| `photos` | 2 | 2 |
| `basics` | 1 | 1 |
| `phone_verify` | 1 | 0 |

### Two cohorts, two stories

- **Old cohort (24 accounts, >14 days):** essentially 0% completion. All 28
  `age_gate` users have **no birthdate at all** — they never completed the
  first input. 10 of the 28 own claimed itineraries: they're **planner users**,
  not failed daters. Most of this cohort likely predates the current wizard
  (subscriber/planner era debris).
- **Recent cohort (13 signups, ≤14 days):** **5 of 13 completed (38%)** — every
  single completion is recent. The current wizard converts acceptably for a
  pre-launch product once people actually want dating. The recent stalls:
  2 at `photos`, 1 at `basics`, 5 at `age_gate`.

**Net:** only **2 humans in the world can currently browse the feed.** The new
11-night supply has an audience of two.

---

## Findings (ranked)

### F1 — CRITICAL: the feed is invisible until full onboarding + ID verification

`apps/web/app/feed/page.tsx:18` — `if (!dating_enabled || verification !== 'verified') redirect('/onboarding')`.

A curious signup must finish **all six steps — including a Persona ID-selfie
scan, the highest-friction action in the product — before seeing a single
night.** The core promise ("swipe on the date, not the face") is unviewable
pre-commitment. This is the classic two-sided cold-start mistake: demand can't
window-shop.

**Recommendation:** a read-only **teaser feed** pre-verification (the product
already has a photo-blur system and the feed is already host-blind by design —
nights contain venue photos, not faces). Gate the *offer/swipe action* on
verification instead of the *browse*. "See 11 real nights happening this week"
is the onboarding motivation, not its reward.

### F2 — HIGH: zero re-engagement; 28 stalled accounts, 10 of them warm

No onboarding nudge/reminder email exists (`lib/email/` has offer-expiring,
spotlights, plan-PDF — nothing for incomplete onboarding). The 10
planner-claimers are *warm leads with a generated date plan already in hand* —
the natural email is "your night is ready to go live — post it and get
matched," not "finish your dating profile." Resend infra + best-effort wrapper
already exist.

### F3 — HIGH: 3 of the 5 completers still can't browse (and 2 are a data bug)

Of 5 `done` users: 1 is unverified (legitimately gated), but **2 have
`onboarding_step='done'` with no clear photo** — the photos step has no skip,
so 'done with no photo' shouldn't be reachable. Either an older flow version,
photo deletion post-onboarding, or a step-pointer bug. Worth a repro: these two
users hit the `canEnableDating` wall on /home with no obvious path to fix their
state ("add a photo" flow from the gate message).

### F4 — MEDIUM: the planner→dating bridge is hostile

Auth callback claims itineraries then sends users to `/home`; `/home:32`
force-redirects anyone not-`done` into the dating wizard. The wizard's only
escape, "not now," links to `/` — the **logged-out marketing landing page** —
not to the user's plans. A planner user who came to claim an itinerary is
funneled into "confirm you're 18+ to date" with no "just show me my plan" path.
They bounce (the data: 10/28 stalled accounts own itineraries).

**Recommendation:** "not now" → `/my-nights` (or the claimed plan itself), and
a soft bridge on the plan page: "post this night → get matched" as the dating
on-ramp framed around what they already made.

### F5 — LOW: the wizard itself is reasonably built

Step order is friction-ascending (checkbox → basics → photos → prefs → SMS →
ID-selfie) — correct design. Step 1 is a single checkbox; the 28 stalls there
are intent mismatch, not UI friction. Recent-cohort completion (38%) is
acceptable pre-launch. The Persona webhook evidently works (4 verified users) —
CLAUDE.md's `PERSONA_WEBHOOK_SECRET` caveat appears resolved in practice,
though unconfirmed in config.

### F6 — NOTE: old-cohort cleanup/win-back

24 pre-wizard accounts are funnel debris. Once F1/F2 land, one win-back email
("After5 is live in Kelowna — here's what's happening this week") either
revives or retires them; their presence currently distorts any funnel metric.

---

## Suggested order of attack (if/when fixes are commissioned)

1. **F1 teaser feed** — converts the new supply into an acquisition asset;
   biggest lever on signup→browse.
2. **F2 nudge email** (planner-claimers first — warmest 10 accounts).
3. **F3 repro + fix** the done-without-photo state and its recovery path.
4. **F4 "not now" → /my-nights** + plan-page dating bridge (small change,
   stops actively burning planner users).
5. F6 win-back blast last, after the above make returning worthwhile.

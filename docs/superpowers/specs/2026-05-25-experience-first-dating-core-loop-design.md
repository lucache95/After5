# After5 — Experience-First Dating: Core Loop Design

**Date:** 2026-05-25
**Status:** Draft v2 — core consumer dating mechanic (create → browse → match → lock → rate). v2 folds in the 2026-05-25 Codex pre-build audit (state machine, reveal-on-offer-only, pre-lock privacy, double-booking, reciprocal pairs, structured ratings + enforcement).
**Author:** Lucas Senechal (w/ Claude)
**Related specs:**
- `2026-04-23-date-engine-v2-architecture-design.md` — platform architecture, schema, multi-city scaffolding. This doc builds on it.
- `2026-04-23-date-plan-generator-deep-dive.md` — the generation pipeline that produces a date's "first draft."
- `2026-04-23-matching-mechanic-walkthrough.md` — earlier matching flow; this doc supersedes its matching states (see §13 changelog) and inherits its safety primitives.

---

## 1. Executive Summary

After5's content object is a date plan, and its long-term form is a dating app where people swipe on **nights, not faces**. This document specifies the **core consumer loop**: how a user creates a date, how others discover and express interest experience-first (blind to the creator), how the creator selects, how a match resolves into a single locked night, and how trust is maintained through verification and reliability ratings.

North star / one-liner: **"Choose the night. Meet the person after."**

Scope note: this spec covers product mechanics and the states they imply. It does **not** re-specify the generation pipeline (see generator deep-dive) or the full platform schema (see date-engine-v2). Where it touches matching states, it is authoritative and supersedes the older walkthrough.

---

## 2. Thesis & Design Pillars

**The format is the problem.** A conventional dating app reduces a human to a photo and asks for a half-second judgment. That single choice — *the photo as the unit* — cascades into every failure mode: photogenic beats compatible; snap judgments replace evaluation; free matches are hoarded and never acted on; a "match" dumps two strangers into an empty chat. Ghosting, flaking, burnout are the predictable output.

After5 inverts the unit: **you swipe on the night.** Pillars that constrain every downstream decision:

1. **Experience-first.** The date is the profile. The creator's face/name is revealed only when a person becomes the active lock candidate — *not* to the whole pending pool (see §7.2).
2. **Symmetric marketplace.** Everyone both creates and swipes — every user is supply and demand. (Necessary but not sufficient for liquidity; see §9.)
3. **AI sets the floor; the human sets the ceiling.** Generation guarantees a competent baseline; personalization is the courtship.
4. **A match is a plan, not a chat.** A "match" exists only once a single, *scheduled*, off-market night is locked. (Evergreen ideas are not matches; see §4.)
5. **Kind by design.** Non-selection reads as "the night filled up," never "you weren't attractive enough."
6. **Safe by structure, not just by trust.** Public vetted venues + verified identities + behavior-based reliability + report/block at every state + pre-lock location privacy.
7. **The planner is the wedge.** The single-player planner builds the audience, taste data, venue DB, and per-city density the dating layer requires.

---

## 3. The Core Loop

```
Create → Publish → Browse (blind, pre-filtered) → Shortlist → Offer (#1 only: reveal + chat)
       → Lock (scheduled, off-market) → The Night → Rate
                         �‚ pass/expire → next standby   ↳ cancel(reason) → safe roll
```

States are formalized in §7. Plain-language: you design a night; others browse it blind; the creator shortlists responders into a ranked queue; the **top candidate** (and only them at a time) gets a time-boxed lock offer with identity reveal + chat; confirmation locks a *scheduled* night and pulls it off the market; both rate afterward.

---

## 4. Date Object Model

Two related forms:

- **Evergreen date idea (template).** Browsable, low-effort, builds a library. **Evergreen ideas generate *interest*, not matches.** They cannot be locked directly.
- **Scheduled instance.** A specific dated night with `scheduled_for`. **Only scheduled instances can enter the lock flow.** (Resolves the v1 contradiction between "always matchable" evergreen and "a match is a scheduled plan.")

**Evergreen → scheduled conversion (required before reveal/offer).** When a creator wants to act on interest in an evergreen idea, they (or the flow) convert it to a scheduled instance with a concrete date/time/venue *before* any offer or identity reveal. Interest carries over; the offer is always against a dated night.

Fields on a date:
- **Venues** — from the vetted DB only (LLM never invents places; see generator deep-dive).
- **Vibe/theme**, the **"why" note**, an **opener**, a **place photo**, an **ambient sound**.
- **Pay setting** — `I pay` / `they pay` / `50-50`. An *expectation, not a binding transaction*; renegotiable/cancellable post-lock without penalty (see §8). Payment-related reports are tracked.
- **Capacity** — 1 seat (1-on-1) for v1.

**Pre-lock location privacy.** Browsers of a scheduled instance see **neighborhood/category + a time window** (e.g., "Downtown, Friday evening"), **not** the exact venue name or precise time. Exact logistics reveal **only after lock**. (Prevents a stalking vector where non-selected users learn where/when the creator will be.)

**Live-events (scheduled instances).** Primary source Ticketmaster Discovery API. Before a live-event date enters the lock flow it must pass an **availability check** (not sold out, within cancellation window) and define **ticket/reservation ownership** and a **cutoff time**; if availability fails, the instance cannot be locked and auto-roll is suspended. Kelowna-local sourcing/licensing is open (§11).

---

## 5. Browsing & Interest (experience-first)

- A feed of open dates; each plays its **ambient sound**; the **creator's identity is hidden** (no face, no name).
- The browser sees the night: vibe, the "why," place photo, ambient sound, pay setting, and (for scheduled) neighborhood + time window.
- **Swipe right** = "I want this night." **Swipe left** = pass.

**Blindness ≠ no filtering.** The feed is **pre-filtered server-side by mutual basic compatibility** — orientation, age range, distance, and hard preferences — so a user only sees nights from people who *could* be a match, **without revealing who they are**. Blindness is about the face, not about removing compatibility/safety filtering. (Settles the "fully blind vs hinted" question: **fully blind on identity, fully filtered on compatibility.**)

---

## 6. Creator Shortlist & Selection

- The creator sees everyone who swiped right on their night: each shows **profile + reliability score + verified badge**.
- Intentional asymmetry: the *browser* judged the night blind; the *creator* vets responders — mirroring real life (you float a plan, people show interest, you choose).
- The creator right-swipes responders into a **ranked pending queue**.

**Ranking rules.** Rank is creator-set and editable **while no offer is active**. Once the #1 holds an active offer, that slot is **frozen** until the offer resolves (confirm/pass/expire); reordering applies only to positions ≥2. Users **do not see their own rank**. All reorderings and transitions are written to an **audit log**.

---

## 7. Match Lifecycle (state machine)

This is the heart of v2. One ordered queue, one explicit lifecycle.

### 7.1 States & transitions

Per (date_instance, candidate):
`interested` → `shortlisted` → `offer_active` → { `locked` | `offer_passed` | `offer_expired` } ; non-selected shortlisted/offer-lapsed candidates sit in `standby` (ordered). A `locked` pair then → { `completed` | `cancelled` | `no_show/ghosted` }.

Each transition records **owner, timestamp, and reason** and drives notifications. DB constraints enforce: at most **one `offer_active` per date instance** and (per §7.4) at most **one `offer_active` or `locked` per user per overlapping time window**.

### 7.2 Reveal & chat — active offer-holder ONLY

The privacy fix from the audit. Identity reveal and chat do **not** open to the whole pending pool. Only the candidate currently in `offer_active` gets:
- the creator's **full profile reveal**, and
- an **open chat** (with block/report).

Pending/standby candidates see only a **limited, non-identifying preview** (the night, their queue status, and a **bucketed** demand hint — see below) with **no photo, name, or contact**, and reveal is **auto-revoked** if their offer passes/expires.

**Demand signal (de-risked).** Show a **bucketed** hint ("a few people are interested") rather than an exact `N`; the pending **queue size is capped**; counts weight only **trusted, currently-available** users; suspicious shortlist inflation is audited. Withdrawal from any queue is **explicit and one-tap**. We **drop** the v1 framing of "demand stops people bailing" — the signal is honest social proof only, never a retention lever.

### 7.3 The lock offer & standby

- The **#1** receives a **time-boxed exclusive offer** ("confirm by [T]"; window length is an open question, default 24–48h). Confirm → **`locked`**, night comes off the market. Pass/expire → auto-roll to the next `standby`.
- **Creator inaction has consequences:** offers and pending interest **expire** (inherit the older spec's ~30-day pending cap); stale scheduled dates **auto-close**; chronic non-action **degrades the creator's reliability** and **suppresses them from feeds**.

### 7.4 Double-booking / availability

A global per-user availability model prevents conflicts:
- At most **one `offer_active` per overlapping time window** per user, and at most **one `locked` date per window**.
- Accepting/locking a date **auto-withdraws** the user from conflicting offers/standbys.
- When a creator locks one scheduled instance, **overlapping scheduled instances they own auto-close**.

### 7.5 Reciprocal creators

If A likes B's date **and** B likes A's date, detect the **reciprocal pending pair** and merge into a single **chooser**: *"You both liked each other's nights — pick one to lock."* Prevents duplicate/competing matches between the same two people.

### 7.6 Cancellation & safe auto-roll

- Cancellation **requires a reason code** (schedule conflict, venue issue, changed mind, **safety/harassment**, misconduct).
- Auto-roll to the next standby happens **only on benign reasons**, with **reconfirmation of both** the creator and the next candidate.
- **No rollover within a short cutoff window** before the night, and **rollover freezes entirely** once any safety report is filed on that date/pair.

---

## 8. Trust, Safety & Ratings

**Identity verification (day one).** Phone + a selfie matched to the profile — establishes a real, accountable person and blocks throwaways made after a bad review. New users show **"Verified · New."** Inherit SIM-swap/device protections and photo-revocation rules from the related safety docs.

**Report/block everywhere.** Block and report available at **every state** (browse, offer, chat, post-night), with reveal-suppression for blocked users.

**Locked-date safety.** A **day-of reconfirmation** and a **check-in** (e.g., 30 min after start) for locked dates; optional **emergency contact** share. Venue-anchoring (public, vetted venues; never a residence for first meets) is the structural baseline.

**Structured reliability rating (not desirability).** After a locked night's scheduled time passes, **both** parties submit structured outcomes — `showed_up`, `on_time`, `cancelled_with_notice`, `unsafe_or_disrespectful` — **plus a private report flow**. Never attractiveness or "how good a date." Anti-retaliation: ratings are **blind until both submit or the window closes**, use **confidence weighting** (min volume before a score counts; recent-weighted), and route serious flags to **dispute moderation**.

**Enforcement ladder (no-shows/ghosting).** Scores alone are too slow in a thin market. Escalate: warning → offer cooldown → lower queue priority → mandatory day-of reconfirmation → temporary lock-ban → suspension.

---

## 9. Strategy & Go-to-Market Risks

- **Planner-as-wedge sequencing.** Ship the single-player planner first (instant value, no liquidity dependency). Enable the dating layer per-city only once density gates are met.
- **Build multi-city-capable, launch single-city.** Key data by city; concentrate density in one market. Splitting scarce early users creates N dead rooms.
- **Liquidity gates (define before enabling dating in a city):** active daters/city, scheduled dates published/week, eligible feed impressions/user/day, **median time-to-lock**, **standby→lock conversion**, and **date completion rate**. Note the queue can *reduce* effective liquidity by parking many users in standby for one seat — monitor standby abandonment.
- **Existential risk: cold-start liquidity.** The hardest problem in consumer tech, against funded incumbents. Open question whether Kelowna metro (~150–220k) is dense enough for the dating layer to ignite, or whether Kelowna proves the *mechanic* while a denser market ignites the *network*.
- **Heavier ops than the planner:** trust & safety, moderation, real-world-meeting liability.

---

## 10. Mobile / Multi-Platform Considerations

After5 is built backend-first (Supabase) with platform-agnostic shared packages (`api-client`, `business`, `types`, `validators`), so this loop is **client-agnostic by construction** — the same states, queries, and rules serve web today and native iOS/Android later (the repo already scaffolds `apps/mobile` on Expo). Several mechanics here, however, impose **hard requirements that native satisfies far better than the mobile web**, and are reasons the dating layer should be **native-first**:

- **Push notifications are load-bearing, not optional.** The time-boxed lock offer (§7.3), standby auto-roll (§7.6), day-of reconfirmation, and the post-start safety check-in (§8) all depend on reliable real-time push. Native APNs/FCM is effectively required; web push is too weak to anchor the lock mechanic. Define notification triggers platform-agnostically so web and native share them.
- **Ambient-sound autoplay (§5)** is restricted on mobile web (iOS Safari blocks autoplay-with-sound); native plays it cleanly. The "feel the night while you scroll" experience effectively requires native.
- **Identity verification selfie (§8)** and the **distance/location pre-filter + pre-lock location privacy (§4/§5)** want native camera and location permissions for a smooth, trustworthy flow.
- **Keep all loop logic in shared/back-end packages**, never a web-only layer, so the native client is a thin UI over the same `business`/`api-client` code. (Web today fetches via React Server Components; the dating loop should fetch through `api-client` so the logic is reused on native, not rewritten.)

The native build itself is out of scope here (§12); this section only flags the requirements the loop imposes on it.

---

## 11. Open Questions

1. **Lock-offer window** length (default 24–48h) — tune via testing.
2. **Liquidity threshold** values that gate enabling dating per city (which metrics from §9, at what levels).
3. **Live-events** — confirm Ticketmaster Discovery integration; identify a Kelowna-local source + licensing; define reservation/ticket ownership.
4. **Capacity** — stay 1-on-1, or add group/double-dates later?
5. **Premium model** — custom ambient sound, "who's interested," boosts (spec separately).
6. **Pre-filter preference depth** — how many hard filters (orientation, age, distance, dealbreakers) before feeds get too thin.

---

## 12. Out of Scope (this spec)

- Generation pipeline internals — see generator deep-dive.
- Full platform schema and multi-city infrastructure — see date-engine-v2.
- Monetization design, growth/marketing strategy, native mobile build.

---

## 13. Analytics (instrument before build)

Emit an event for **every lifecycle transition** in §7.1, plus: swipe-right rate, shortlist rate, **offer acceptance / expiry**, **standby acceptance**, **queue abandonment**, **reveal-to-withdraw**, time-to-lock, and date completion. Without these the queue cannot be tuned safely.

---

## 14. Glossary & Terminology

Reserve **"match"** for a **`locked`** (confirmed, scheduled) night only. Pre-lock stages are **`interested` / `shortlisted` / `offer` / `standby`** — never "match." This aligns with the existing `matches.state='confirmed'` model.

- **Night / date** — the content object users swipe on.
- **Evergreen idea** — undated, browsable template; generates interest, not matches.
- **Scheduled instance** — a dated night; the only form that can be locked.
- **Pending queue** — creator-ordered list of shortlisted candidates awaiting an offer.
- **Offer** — the exclusive, time-boxed lock invitation held by the #1 candidate (the only state with identity reveal + chat).
- **Standby** — ordered non-selected candidates, auto-filled if the seat opens (benign cancellations only).
- **Lock** — mutual confirmation; takes the night off-market and is the *only* thing called a match.
- **Reliability score** — structured behavior outcomes (showed up, on time, conduct, safety); never desirability.
- **Experience-first** — users evaluate the night before/instead of the person's face; compatibility is still filtered server-side.

---

## Changelog

- **v2 (2026-05-25):** Folded in Codex pre-build audit. Added formal state machine (§7.1); restricted identity reveal + chat to the active offer-holder only (§7.2); bucketed/capped the demand signal and removed its retention framing; added pre-lock venue/time privacy (§4); added double-booking/availability rules (§7.4); reciprocal-pair chooser (§7.5); reason-coded, safety-gated cancellation/auto-roll (§7.6); evergreen→scheduled conversion requirement (§4); structured anti-retaliation ratings + enforcement ladder + report/block/check-in (§8); server-side compatibility pre-filter resolving blind-vs-hinted (§5); ranking-rule mutability + audit log (§6); liquidity gates (§9); analytics events (§12); reserved "match" for locked only (§13); live-event availability gating (§4).
- **v2.1 (2026-05-25):** Added §10 Mobile / multi-platform considerations — push-notification dependency for the lock/standby/check-in flow, ambient-sound autoplay limits on mobile web, native camera/location for verification + pre-filter, and keeping loop logic in shared packages for native reuse. Renumbered subsequent sections.
- **v1 (2026-05-25):** Initial core-loop design from brainstorm.

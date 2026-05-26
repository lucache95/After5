# Experience-First Dating — Implementation Roadmap

> **For agentic workers:** This is a **roadmap of sub-plans**, not a directly-executable task list. The core-loop spec spans many subsystems; per the writing-plans scope check it is decomposed below into dependency-ordered phases. **Each phase must get its own detailed `superpowers:writing-plans` pass (TDD, bite-sized tasks, real code) before execution.** Do not execute from this document directly.

**Goal:** Sequence every gap from the 2026-05-25 production-readiness audit into a buildable, dependency-ordered set of phases that take the experience-first dating core loop from a product spec to a shippable, safe product.

**Architecture:** Backend-first on Supabase (Postgres + RLS + Edge Functions) with platform-agnostic shared packages, fronted today by Next.js and later by Expo (native). Reconcile all schema with the existing `date-engine-v2` architecture spec rather than inventing parallel tables. The matching loop's invariants are enforced in the database (transactions + constraints), not application code.

**Tech Stack:** Supabase (Postgres, RLS, Realtime, Edge Functions/Deno), PostGIS (distance), a job/worker layer (scheduled functions or a jobs table + runner), push (APNs/FCM via Expo), an identity-verification vendor (Persona/Stripe Identity/Onfido), a moderation queue, analytics events.

**Source documents:**
- Spec: `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md`
- Audit: 2026-05-25 production-readiness audit (this roadmap maps every finding below)
- Architecture/schema to reconcile with: `docs/superpowers/specs/2026-04-23-date-engine-v2-architecture-design.md`

---

## How to read this

- Phases are ordered by **hard dependency**. A phase cannot start until its dependencies land.
- Each phase lists: **Delivers**, **Closes (audit findings)**, **Depends on**, and whether it is **🚫 launch-blocking** (cannot ship to real users without it) or **post-launch**.
- The **Traceability Matrix** at the end proves every audit finding maps to a phase.

---

## Phase 0 — Data model & invariants (FOUNDATION)

**Delivers:** The full relational schema reconciled with `date-engine-v2`: `profiles`, `dates` (evergreen), `date_instances` (scheduled, **with `starts_at` + `duration`** so "overlapping window" is definable), `swipes`, `queue_entries` (shortlist + rank + standby order), `offers`, `locks`, `chats`/`messages`, `ratings`, `reports`, `blocks`, `verifications`, `availability`, `venues`, `events`, `notifications`, `jobs`, `audit_log`. Plus: unique **partial indexes** enforcing *one active offer per date instance* and *one active lock per user per time window*; transactional state transitions; **field-level RLS / curated views** so blind browsing never leaks creator identity; PostGIS for distance.

**Closes:** Critical #1 (no data model), Critical #2 (no API → contracts derive from schema), "overlapping window undefined / dates have no duration", "no concurrency strategy", "field-level auth for blind browsing", "two competing orderings (rank vs standby)", "reliability score lifecycle → backed by an events table", "audit log / event sourcing".

**Depends on:** nothing. **🚫 Launch-blocking. Everything depends on this — build it first.**

---

## Phase 1 — Identity, profile & onboarding

**Delivers:** The **profile** object (the thing revealed at offer — photos, name, age, bio, prompts), onboarding, and **preferences** (orientation, age range, distance, dealbreakers) that feed the compatibility pre-filter. Identity **verification** (phone OTP + selfie/liveness vendor) and a real **age gate**. Verification states (`pending`/`verified`/`failed`/`appeal`) + "Verified · New" badge.

**Closes:** Critical #4 (profile black hole), Critical #6 (verification named-not-built), "selfie ≠ age verification / minors", "pre-filter inputs undefined", dead "Verified · New" badge.

**Depends on:** Phase 0. **🚫 Launch-blocking.**

---

## Phase 2 — Async backbone: scheduler + notifications

**Delivers:** A **job/worker layer** driving every timer the mechanic relies on: offer expiry, standby auto-roll, ~30-day pending expiry, stale-date auto-close, day-of reconfirmation, 30-min safety check-in. **Push** (Expo/APNs/FCM) + notification **preferences/consent** + **rate limiting** (anti notification-storm).

**Closes:** Critical #3 (no scheduler — mechanic is inert without it), "no scheduled-job system", "no push service / consent / rate limiting", mobile push dependency (spec §10).

**Depends on:** Phase 0. **🚫 Launch-blocking** (the lock/standby/check-in flow does not function without it).

---

## Phase 3 — Date creation & content pipeline

**Delivers:** Create flows for evergreen ideas and scheduled instances (incl. the **evergreen→scheduled conversion** step and re-collecting availability at conversion). Integrate the existing generator (first draft). A **media pipeline** for place photos and ambient audio (upload, transcode, CDN, moderation hook, licensing) and/or a **curated ambient-sound library**.

**Closes:** dead "ambient sound" UI + missing sound source/licensing, "no media pipeline", "evergreen→scheduled availability mismatch" (re-collect availability at conversion), UGC ingestion point for moderation (Phase 8).

**Depends on:** Phase 0. Post-launch-blocking only in that browse (Phase 4) needs *some* content; can ship with library-only audio.

---

## Phase 4 — Browse & interest (experience-first feed)

**Delivers:** The blind feed served via field-level auth (no identity leak), **compatibility pre-filter** (PostGIS + Phase-1 preferences), swipe right/left, ambient playback (native-first; graceful no-audio fallback on web), and a **cold-start / empty-feed strategy** for a thin market.

**Closes:** "blind but pre-filtered" (filter quality = trust dependency), "empty feed at launch", RLS identity-leak risk, dead ambient-on-web (explicit fallback).

**Depends on:** Phases 0, 1, 3. **🚫 Launch-blocking.**

---

## Phase 5 — Matching state machine (THE CORE LOOP)

**Delivers:** Shortlist + creator ranking; **consent/disclosure that swiping reveals the swiper's profile to the (anonymous) creator** (mitigates the "honeypot date" harvest); the time-boxed **exclusive offer** with **reveal + chat opening only to the active offer-holder**; **bucketed/capped demand hint** (presence-backed); transactional **lock** (DB-enforced invariants); ordered **standby**; **double-booking/availability** conflict resolution incl. cascade-withdrawal throttling; **reciprocal-pair chooser**; reason-coded **cancellation** + safety-gated **auto-roll**; immutable transition writes to `audit_log`.

**Closes:** the bulk of STATE & DATA FLOW PROBLEMS, "honeypot dates" privacy attack, "cascading auto-withdrawals", "offer-expiry race / idempotency", "reveal revocation is fiction" (define screenshot reality + chat retention vs privacy), "standby order ambiguity", reciprocal pairs, double-booking.

**Depends on:** Phases 0, 2, 4. **🚫 Launch-blocking.**

---

## Phase 6 — Chat

**Delivers:** Messaging backend (Realtime transport, storage, retention policy, media handling, read state), opens at offer; **block propagation** and in-thread report; decision + design for the **"locked near-strangers with little rapport"** tension (e.g., minimum chat before a lock can be confirmed, or pre-lock structured prompts).

**Closes:** Critical #7 (chat is a subsystem), "locked strangers / no rapport" UX cliff + safety tension.

**Depends on:** Phases 0, 5. **🚫 Launch-blocking.**

---

## Phase 7 — Trust, safety & ratings (+ proof of attendance)

**Delivers:** Structured ratings (`showed_up`/`on_time`/`cancelled_with_notice`/`unsafe_or_disrespectful`), **blind-until-both-submit**, confidence weighting + decay; the **enforcement ladder**; a **proof-of-attendance mechanism (geofenced check-in)** so no-show penalties aren't pure self-report; report/block flows with full propagation; emergency-contact + check-in **escalation policy** (not just UI); a user-facing safety center.

**Closes:** Critical #5 (no-show has no proof — enforcement is fiction without this), "ratings lifecycle/retaliation", fake safety UI (check-in/emergency contact without backend), dead block/report buttons.

**Depends on:** Phases 0, 2, 5, 6. **🚫 Launch-blocking** (cannot ship a meet-strangers product without it).

---

## Phase 8 — Moderation, admin tooling & anti-abuse

**Delivers:** A T&S/admin console: report triage queue, dispute resolution, verification review, **UGC moderation** of dates (the "why" note, photos, audio), suspension tools, audit-log viewer; **anti-abuse** (device fingerprinting, velocity limits, fraud scoring, fake-account + swipe-farm + honeypot defenses).

**Closes:** Critical #8 (no moderation/admin system to operate the safety machinery), "no anti-abuse layer", swipe farms / fake accounts.

**Depends on:** Phases 0, 5, 7. **🚫 Launch-blocking** (someone must be able to action reports on day one).

---

## Phase 9 — Account lifecycle & compliance

**Delivers:** Account deletion / suspension / pause; **anonymization + retention/legal-hold** (retain banned users' report history); orphan-handling for in-flight offers/locks/standby/chats/ratings when a user disappears.

**Closes:** "account deletion mid-flow → orphaned locks", GDPR/CCPA, soft-delete regret.

**Depends on:** Phases 0, 5, 6, 7. **🚫 Launch-blocking** (legal requirement + avoids orphaned state).

---

## Phase 10 — Payments decision (DECISION GATE → optional build)

**Delivers:** A decision: either (a) build holds/escrow so "who pays" is real, or (b) **relabel the pay setting as a non-binding social convention in UI copy** and remove the implied guarantee. If a future premium tier ships, billing lands here.

**Closes:** Critical #5 (payments integrity gap), "pay setting can create abuse/expectation problems".

**Depends on:** Phase 0. Can run in parallel; **launch-blocking only as a copy/expectation fix** (option b is cheap and removes the integrity gap immediately).

---

## Phase 11 — Cross-cutting polish: states, a11y, mobile, analytics, scale

**Delivers:** Loading/error/empty states on every async action; accessibility (non-audio equivalent for ambient sound, accessible swipe + countdown, pink-on-dark contrast, screen-reader feed semantics); mobile responsiveness; **analytics events for every state transition** + experimentation/flagging (to tune the offer window); scalability (indexes, presence fan-out, notification batching, timezone/DST correctness).

**Closes:** missing loading/error/empty states, accessibility gaps, mobile responsiveness, analytics (spec §13), "tune offer window", timezone/DST, scalability concerns.

**Depends on:** woven through all phases; finalized last. **Partly launch-blocking** (error/empty states and analytics for the core loop) / partly post-launch (scale).

---

## Dependency graph

```
P0 ─┬─ P1 ─┐
    ├─ P2 ─┼─ P4 ── P5 ─┬─ P6 ─┐
    ├─ P3 ─┘            ├─ P7 ─┼─ P8
    └─ P10 (parallel)   └──────┴─ P9
                                   └─ P11 (woven, finalized last)
```

**Critical path to a safe MVP:** P0 → (P1, P2, P3) → P4 → P5 → (P6, P7) → (P8, P9) → P11. P10 option (b) is a cheap copy fix anytime.

---

## Audit-finding → phase traceability

| Audit finding | Phase |
|---|---|
| No data model / schema | P0 |
| No API surface | P0 (contracts) + per-phase |
| No scheduler/job system | P2 |
| Profile never defined | P1 |
| Payments undefined / pay-setting integrity | P10 |
| Identity verification named-not-built | P1 |
| No age gate | P1 |
| Chat is a subsystem | P6 |
| No moderation/admin tooling | P8 |
| Availability/calendar + date duration | P0 (model) + P5 (logic) |
| Pay selector = dead UI | P10 |
| Ambient sound source/licensing/web-autoplay | P3 (pipeline) + P4 (fallback) |
| Reliability score / "Verified·New" empty at launch | P1 + P7 |
| Demand hint = fake number | P5 (presence-backed) |
| "Similar nights" consolation has no query | P4/P5 (reco) |
| Block/report = fake buttons | P7 |
| Emergency contact / check-in fake safety | P7 |
| Account deletion mid-flow / orphans / GDPR | P9 |
| Venue closes / event sold out before the night | P3 (availability) + P5 (re-plan) |
| No-show has no proof | P7 (geofenced check-in) |
| Timezones / DST | P11 + P0 (storage) |
| Honeypot-date profile harvest | P5 (consent on shortlist reveal) |
| Cascading auto-withdrawals collapse queues | P5 (throttle) |
| Creator deletes date pre-lock | P5 |
| Offer-expiry race / idempotency / concurrency | P0 (constraints) + P5 |
| Off-platform escape | P6 (detection) + P7 (policy) |
| Empty feed / cold-start | P4 |
| Notification storms / consent | P2 |
| Field-level RLS for blind browsing | P0 |
| Standby vs creator-rank ambiguity | P0 + P5 |
| Reveal revocation fiction / chat retention vs privacy | P5 + P6 |
| Locked strangers / no rapport | P6 |
| Late-reveal vs safety contradiction | P5/P6/P7 (design decision) |
| Symmetric-vs-asymmetric power | product decision (revisit in P5) |
| Anti-abuse / fake accounts / swipe farms | P8 |
| Geospatial distance filter | P0 (PostGIS) + P4 |
| Media pipeline | P3 |
| Loading/error/empty states | P11 |
| Accessibility | P11 |
| Mobile responsiveness / push | P2 + P11 |
| Analytics / experimentation | P11 |
| Scalability | P11 |
| Audit log / event sourcing | P0 |

---

## Self-review notes

- **Coverage:** every line in the audit's CRITICAL / DEAD UI / EDGE CASES / STATE / BACKEND / CONTRADICTIONS / REGRET / SCREENS sections maps to a phase in the matrix above. Gaps found: none unmapped.
- **Decomposition rationale:** this is intentionally a roadmap, not a TDD task list, because foundational types (schema, profile, API) are undecided — concrete code/tests would be fabricated placeholders, which writing-plans forbids. Each phase becomes its own detailed plan once its predecessor lands.
- **Launch-blocking set:** P0, P1, P2, P4, P5, P6, P7, P8, P9, plus the launch-relevant slice of P11 and P10-option-(b). P3 can ship library-only; P10-(a) and P11-scale are post-launch.

# After5 — Experience-First Dating Marketplace

## What This Is

After5 is a two-sided dating marketplace built on the premise **"swipe on the date, not the face."** Instead of matching on photos, users browse *nights* (real, planned experiences with venues, timing, and vibe), match around the experience, and the host's identity progressively reveals as the connection deepens — so every match already has a concrete plan attached. An AI date-planner generates and customizes these nights and is the product's moat. It's a Next.js 15 / Supabase monorepo, live on Vercel + Supabase Cloud.

## Core Value

A user can browse a real planned night, express interest, get matched, and **end up on an actual date with a real plan attached — the full loop closes and never traps the user.** If everything else fails, the browse → match → reveal → plan → date → review loop must work end-to-end.

## Requirements

### Validated

<!-- Inferred from existing, shipped, working code (codebase map + 2026-06-03 MVP audit Section A + live-nav verify). These are built and relied upon. -->

- ✓ Auth + verification + `dating_enabled` gating on the feed — existing
- ✓ Feed / browse: framer-motion `SwipeDeck`, photo-led `NightCard`, ambient-audio crossfade deck, swipe persistence (`record_swipe`), `browse_feed_for_viewer` RPC — existing
- ✓ Blind-safe night detail (`get_night_detail`): hero, chip facts, per-stop photo timeline, blind contract enforced end-to-end — existing
- ✓ Binary post-match identity reveal (RLS `match_reveal_allowed`/`_pair`; `/matches/[lockId]` → RevealModal → ProfileCard; offer-screen pre-lock reveal) — existing
- ✓ Host marketplace happy path: interested → shortlist (draggable, realtime) → make-offer → candidate accept/pass/withdraw → lock; reciprocal double-host resolution; auto-roll standby promotion — existing
- ✓ AI planner + two creation doors: Door 1 "build it for me" (`/create/generate` → AI funnel), Door 2 "start from scratch" (`create_blank_itinerary` → `ItineraryEditor`); `post_night` forks itinerary to host-owned night; `/nights/new` PostNightForm — existing
- ✓ Venues as first-class content: `/places/[slug]`, `/places` catalog, Google enrichment, custom-venue submission queue + admin QA — existing
- ✓ Chat engine: unified `/inbox`, threads, `Conversation` (optimistic send, realtime, mark-read, report-message), combined unread badge — existing (Phase 7 chat shipped)
- ✓ Profile editor (`/account/profile`), notification prefs (`/account/notifications`), account hub (`/account`), onboarding preferences capture — existing
- ✓ Forward state machine: night seeking → matched → cancelled; queue interested→shortlisted→offer_active→locked; offer single-active invariant; rating capture write path (`match_ratings`) — existing
- ✓ Brand sweep, image pipeline, unified inbox + nav, create chooser, 4 mobile-UX redesigns, audio + ownership fixes, SEO assets, open-city (typed-city) — shipped & live this cycle

### Active

<!-- The MVP gaps that close the loop and complete the marketplace. Sourced from the MVP-AUDIT Section E (E1–E25, P0→P3) and live-nav verification. These become the milestone roadmap (built in /gsd:ingest-docs). Hypotheses until shipped. -->

**P0 — MVP blockers (the loop must close and never trap the user)**
- [ ] Universal nav chrome (back + bottom nav / contextual header) on every deep route and guard/error terminal (E1)
- [ ] Fix bottom-nav semantics: profile tab → real profile hub; dates tab → user's matched dates; fix `/account`→`/plan/i/` dead link (E2)
- [ ] Profile hub (ISSUE #15): aggregate identity + dating profile + self-VIEW + links to edit/preferences/notifications; strip marketing teaser from profile destination (E3)
- [ ] Editable dating preferences (age/distance/gender/dealbreakers + dating on/off) reachable from profile (E4)
- [ ] Lock `completed` transition + expiry sweep for past-dated seeking nights (E5)
- [ ] Host pre-match cancel/unpublish/delete: `cancel_night` RPC + UI (E6)
- [ ] Host edit of a posted night: `update_night` RPC + edit UI (E7)
- [ ] `interest_received` notification dispatched to host on right-swipe (E8)
- [ ] Remove poison-loop risk: implement or remove dead job handlers/RPCs before scheduling new jobs (E9)

**P1 — Core marketplace (discoverability, creator completeness, host triage)**
- [ ] Real feed filters + targeting data: `profiles.feed_filters` + per-date columns; `browse_feed_for_viewer` hard filters + soft sort; real `FilterSheet`; keyset pagination (E10)
- [ ] Creator controls: who-pays, vibe-tags, radius, cover upload, scheduling; Door-2 publish CTA; converge `PublishToFeedButton` ↔ `/nights/new` (E11)
- [ ] Host reject/dismiss candidate: `reject_candidate` RPC + decline action; surface offer outcome + withdraw on interested list (E12)
- [ ] Surface the plan/itinerary on `/matches/[lockId]` and `/offers/[offerId]` (E13)
- [ ] Offer delivery reliability: server-runtime RESEND email and/or guaranteed in-app notification to reach `/offers/[id]` (E14)

**P2 — Trust & reveal (the headline mechanic)**
- [ ] Progressive reveal ladder: pre-match limited/blurred host on feed + detail (`signBlurredUrls()`, limited host hint in `FeedNight`), match-partial at offer, threshold-full post-lock; make offer/interested screens experience-led not photo-led (E15)
- [ ] `identity_revealed` reveal moment: dispatch gated notification + reveal ceremony UI (E16)
- [ ] Ratings → reliability aggregation: compute `reliability_score` from `match_ratings`; reachable `no_show` outcome (E17)
- [ ] Chat ↔ profile ↔ night wiring (E18)
- [ ] Safety flows: implement + enqueue `day_of_reconfirm` and `safety_checkin` (E19)

**P3 — Enhancements**
- [ ] Real static map + route in detail sheet (E20)
- [ ] Venue pages into the dating loop; `/places` nav decision (E21)
- [ ] Relevance ranking (compatibility/vibe) over chronological (E22)
- [ ] Human city label + real proximity (E23)
- [ ] Standby/waitlist UI + withdraw-pending-interest (E24)
- [ ] Feed/detail hero consistency, skeleton refresh, archive/draft state, typing/read receipts, business-ownership model (E25)

### Out of Scope

- Native mobile apps — parked (web-first; explicitly deferred per project state)
- Legacy AI-planner-as-standalone-product framing — the planner is now the moat/wedge inside the dating marketplace, not a separate product
- Re-fixing already-shipped feed issues (dark title, missing tags, poor audio) — genuinely FIXED in current code; do not re-queue (audit Synthesis note)
- Business-ownership / merchant claim model beyond a stub — deferred to P3+ (not core to the dating loop MVP)
- Full 8-state night lifecycle as originally specced — current 3-state machine is intentional; only the back half (completed → reviewed → reliability) is in scope (P0 E5 + P2 E17)

## Context

- **Existing, mostly-built app.** The happy-path machinery (browse → swipe → interest → shortlist → offer → accept → lock) is real and well-built. The gaps are the *surrounding marketplace*: discoverability, host correction tools, the progressive reveal ladder, the back half of the loop (date-happened → reviewed → trust), and the navigation graph that connects screens into a product. The thesis: built **feature-first, not experience-first** — a collection of strong screens, not a complete marketplace.
- **Audit-driven milestone.** Scope comes from three committed artifacts (2026-06-03): `docs/superpowers/reports/2026-06-03-MVP-AUDIT.md` (Sections A–F, the E1–E25 P0→P3 queue), `docs/superpowers/reports/2026-06-03-LIVE-NAV-VERIFY.md` (Playwright live verification: 19 CONFIRMED, 2 WORSE, 1 NOT_REPRO, 7 UNREACHED + 6 new issues), and `.planning/inbox/2026-06-03-chatgpt-mvp-reconciliation-audit.md` (the brief + ISSUE #15).
- **Top 3 critical gaps:** (1) progressive reveal doesn't exist — binary gate; blur pipeline orphaned; feed has no host presence. (2) The loop never closes — locks never reach `completed`; ratings compute nothing. (3) Match screen shows the person but not the plan, and hosts get no notification on right-swipe.
- **Genuinely-missing marketplace RPCs:** `reject_candidate`, `update_night`, `cancel_night` (absent from the running DB per live verify).
- **ISSUE #15 is cheap:** `/account` is already a real, well-built host hub — it's just nav-orphaned. E3 is largely a nav-repoint + profile-view, not a from-scratch build.
- **Standing rule:** every UI change is visually verified — render → screenshot (Playwright) → critique against a visual rubric — before it's "done." Agents are blind; compile-clean ≠ good UX. All UI follows `docs/superpowers/DESIGN-SYSTEM.md` (Barbiecore, three-tier color, gesture motion, real display font; framer-motion/vaul/sonner in use). User-facing copy gets the stop-slop treatment.

## Constraints

- **Tech stack**: Next.js 15.1 (App Router) / React 19 / TypeScript 5.6 / pnpm + Turbo monorepo; Supabase Cloud (Postgres 17, auth, edge functions, storage, realtime, RLS); Vercel hosting + Vercel Cron. Node ≥ 22.
- **Security**: secure-by-default RLS — reusable patterns, never `USING(true)` on update/delete, run the Supabase security advisor after every DDL, review live migrations before prod apply.
- **Schema/data integrity**: verify against reality not guesses; minimal faithful migrations; gated prod-apply (local-green before batched prod apply); watch local-vs-prod drift.
- **Prod is live**: prod ref `ufufmcpnysvwtutpbian`. Some audit findings ran against the LOCAL stack — verify prod application state before building (see Key Decisions).
- **Integrations**: Supabase (DB/auth/edge/RLS), Resend (email — note RESEND key set in Vercel server runtime, blank on edge/local), Twilio (SMS), Persona (ID verification — `PERSONA_WEBHOOK_SECRET` state to confirm), Anthropic (AI planner). 

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Roadmap is sequenced by the audit's P0→P3 E-queue (E1–E25), not re-derived from scratch | The audit already ordered items so each is independently shippable with deps noted; re-prioritizing risks re-queuing shipped work | — Pending (built in /gsd:ingest-docs) |
| Re-check Door 2 + typed-city against PROD, do not rebuild | `create_blank_itinerary` (migration `20260603120100`) + the generate-plan edge were applied/deployed to PROD; the live-nav verify ran LOCAL where they were unapplied — so C12/D2 "Door 2 dead-end" and the typed-city issue are local-only artifacts | — Pending |
| Progressive reveal (E15) is the single highest-leverage vision item | "Swipe on the date, not the face" is not even partially representable today; the blur pipeline already exists but is orphaned | — Pending |
| ISSUE #15 / E3 = nav-repoint + profile-view of existing `/account` hub | Live verify found `/account` is already a real hub; building from scratch would duplicate working code | — Pending |
| Treat UNREACHED audit items (C2/C3/C5/C6/C9/D13/D16) as assertions, not verified facts | Guard/error/lifecycle/safety states a happy-path walk can't trigger; confirm in code before queuing fixes | — Pending |
| Gated/not-applied work stays gated until batched prod-apply | Inbox notification-type DISPATCH wiring (enums applied, dispatch sites not wired); #77 venue photos; #78 per-vibe ambient; #86 cover-consistency are parked/gated | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-03 after initialization*

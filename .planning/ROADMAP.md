# Roadmap: After5 — Experience-First Dating Marketplace

## Overview

After5 is an existing, mostly-built Next.js 15 / Supabase dating marketplace
whose happy-path machinery (browse → swipe → interest → shortlist → offer →
accept → lock) is real and well-built, but which was built feature-first, not
experience-first — a collection of strong screens, not a complete marketplace.
The v1.0 milestone closed that gap by walking the 2026-06-03 MVP audit's P0→P3
E-queue (E1–E25) in order: make the loop never trap the user, complete the
marketplace, build the headline mechanic (progressive reveal + trust + safety),
then polish. Each E-item shipped as an independently-shippable vertical slice.

## Shipped Milestones

- **v1.0 — MVP (P0→P3, E1–E25)** — completed 2026-06-05. 7 phases, 39 plans,
  25/25 requirements. The full blind dating loop closes end-to-end and is proven
  on prod: browse (blind) → swipe → offer (plan-on-match) → lock → reveal
  ceremony → chat → date → rating → archive, with progressive reveal, trust &
  safety (reliability + safety check-ins), discoverability (targeting + filters +
  ranking), and venues-into-the-loop (maps + post-match `/places` + standby).
  Audit: **PASSED** (integration clean, blind contract intact).
  → Full detail: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md) ·
  [`milestones/v1.0-REQUIREMENTS.md`](milestones/v1.0-REQUIREMENTS.md) ·
  [`v1.0-MILESTONE-AUDIT.md`](v1.0-MILESTONE-AUDIT.md)

## Next Milestone

Start the next milestone with `/gsd:new-milestone` (questioning → research →
fresh REQUIREMENTS.md → roadmap). Candidate themes carried out of v1.0 as
explicit deferrals: the AI date-planner moat (generate/customize nights), E25
draft-state + typing indicators + read receipts, business-ownership/claim,
richer compatibility ranking, automatic standby promotion, multi-city expansion,
and the Phase-5 WR-04 cancelled-lock reveal.

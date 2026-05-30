# After5 — Executive Reality Report (2026-05-30)

Full-repository reality reconciliation. Audit-only. Implementation reality is authority; all prior summaries (including this session's earlier audits) treated as claims to verify. Synthesized from 5 parallel read-only audits:
- `2026-05-30-reality-inventory.md` (Phase 1)
- `2026-05-30-reality-journey-trust.md` (Phases 2, 6)
- `2026-05-30-reality-dategen-legacy-deadui.md` (Phases 3, 4, 7)
- `2026-05-30-reality-plan-reconciliation.md` (Phase 5)
- `2026-05-30-reality-web-mvp.md` (Phase 8)

---

## What After5 actually is today

A **planner web app (live, in use) with a fully-built but never-used dating marketplace bolted on behind an off switch.** The only populated data is planner content (182 places, 504 itineraries). Every dating table — swipes, offers, locks, date_instances — has **0 rows on prod**. 28 user profiles exist; **0 are verified, 0 are dating-enabled.** The dating loop is deployed at the schema/RPC/edge-function level and passed one *local* E2E, but has handled **zero real traffic** and **no real user can currently enter it** (verification is unwired).

## What actually works (GREEN — verified)
- **Planner generation loop**: `/plan` → `generate-plan` edge fn → `itineraries` → `/plan/i/[id]`. Live, the canonical (and only live) generator.
- **Dating backend**: S1/S2 schema, the full `match_*` RPC suite, 8 match edge functions — all on prod, security-passed (no RED), flag OFF.
- **The planner→dating bridge**: `post_night` RPC (RLS-gated on verified+dating_enabled) turns an itinerary into a swipeable `date_instance`. Clean, single write-path — no dangerous planner→dating leak.
- **The matching UI** (D/E/F/G-in-app) renders correctly and the loop passed a local two-context Playwright E2E.

## What only appears to work (the dangerous illusions)
1. **"The matching loop is done/tested."** It's deployed + unit/E2E-tested but has run **zero real traffic**; its only proof is one local run with `supabase functions serve`. Deployed+tested ≠ working.
2. **"The web app is shipped."** Edge functions are current on prod (deployed directly via MCP). The **Next web app is NOT** — `main` is ~70+ commits ahead of `origin`; Vercel serves a **pre-5b-UI commit**. The new dating UI + reveal hardening + rebrand are not on the live site.
3. **Ratings exist.** F's RatingForm inserts a row with **zero downstream** — no reliability score, no enforcement, no consequence. A dead-end.
4. **Notifications work.** 20 enum types; **only 5 are ever dispatched**; in-app delivery is **Realtime-only** (needs an open tab) — proven against mocks, not live.
5. **Chat.** The `/matches/[lockId]` "messages coming with phase 7" is a placeholder telling users to swap numbers off-platform.

## What is untested / unproven
- **No one has traversed signup→match on prod** — both verification gates (Twilio phone, Persona ID) are unwired/unproven.
- **6 dormant job types** dispatch to RPCs that don't exist (verified absent in pg_proc) — latent poison-loop, no dead-letter guard.
- **Live job chain** (rating_window on every accept; bulk_withdraw) never E2E'd through cron→process-jobs→RPC.
- **Cohort-unblock scripts** dry-run locally only, never against real prod data.
- **Rebranded auth emails** are HTML-only — never rendered, not wired in config.toml.
- **3 PhotoStep tests RED** (stale selector: test clicks "next", impl now needs the PhotoCropper "looks good" confirm).

## What is legacy
- ~20 planner routes (`/plan`, `/dates`, `/places`, `/vibes`, `/types`, `/vote`, `/templates`, `/wow`, `/neighborhoods`) + ~14 unused planner tables (0 rows) + planner API routes.
- `generate-plan` (v39), `generate-cover`, `classify-photos` edge fns (latter two unused, no callers).
- Orphaned RPCs (admin_force_*, match_next_standby, requeue_stuck_jobs, prune_idempotency_ledger).
- `temp_race` leftover test table on prod.
- Eval system (date-engine-v2, contextual-bandits, good-date-standard) = **specs only, zero code wiring.**

## What is dangerous
- **Dual post-login dashboard**: `/home` (dating-aware, routes into onboarding/feed) vs `/account` (legacy planner "home", no path into the dating loop). The auth callback was just fixed to default `/home`, but `/account` still exists as a dead-end for the dating journey.
- **8 stale plans** (all 2026-05-25, zero post-5b awareness) + **7 contract drifts**. Executing p6–p11 / S7–S11 verbatim would re-build shipped work (p7 vs F's RatingForm), target phantom columns (`bio`/`photos[]`/`expectations[]`), and code against a `make_offer`/reciprocal contract that no longer exists. **The plans are a trap.**
- The notification urgency mechanic ("23h to accept") can't reach a closed-tab user — **no web-push, no SW, no email/SMS fallback.**

## What is missing
S7 chat (the "Communicate" step), S8 trust&safety + ratings *consequences*, S9 dating moderation/admin, S10 account lifecycle, S11 payments framing, the G email half, PWA (manifest/SW/icons/push), and a wired verification funnel.

---

## PHASE 9 — What should happen next

**Verdict: STOP BUILDING & TEST BEFORE BUILDING — and DELETE/RE-BASELINE before any new phase.**

NOT "safe to continue." Rationale: a sophisticated matching loop sits on top of a funnel no real user can pass, deployed to a Vercel that doesn't serve it, planned by documents that predate it. Building S7 chat now adds a feature on top of a loop that has never run once in production.

Ordered:
1. **DELETE/RE-BASELINE FIRST (cheap, prevents future error):** re-baseline the INTEGRATION-CONTRACT + master roadmap against prod reality (jsonb return, reciprocal-commit, real columns, notification set); kill or hard-redirect the `/account` dating dead-end; archive the 8 stale plans so they can't mislead.
2. **FIX the funnel to reachable:** push `main`→Vercel (live UI), run the cohort-unblock scripts with *real* tester UUIDs + seed Kelowna nights, add the dead-letter job guard. (Bypasses Twilio/Persona for the cohort.)
3. **TEST ON PROD:** one human (or attended) full traversal signup→match→reveal→rate on prod — the thing that has never happened.
4. **CLOSE the urgency gap:** minimal PWA (manifest + SW) + web-push **with email fallback** for the offer prompt — or the time-boxed mechanic can't be demonstrated to an unattended cohort.
5. THEN, and only then, build S7 chat (re-specced against current reality) and S8 ratings consequences.

---

## PHASE 10 — Confidence scores (ruthless, 1-10)

| Dimension | Score | Why |
|---|---|---|
| **Reality Confidence** (do we now know the truth?) | **9** | Just did deep live prod introspection; corrected even this session's own stale audits. |
| **Architecture Confidence** | **7** | Backend is sound + security-passed; dragged by dual-dashboard, legacy coexistence, eval-as-vaporware. |
| **Plan Confidence** | **2** | 8 stale plans, 7 contract drifts; forward plans actively dangerous to execute. |
| **Web MVP Readiness** | **5** | Responsive loop renders well; PWA absent, push/urgency mechanic undeliverable to closed tabs. |
| **Tester-Cohort Readiness** | **4** | Tooling exists but unrun on prod; web app unpushed; verification + notification delivery unsolved. |
| **Launch Readiness (public)** | **2** | No verification, no chat, no moderation, ratings dead-end, no payments framing, no PWA. |

**One-sentence truth:** After5 is a live planner with a *well-built, well-tested, completely unexercised* dating engine behind it — the gap to value is not more building, it's making the loop **reachable, deployed, and proven once in production.**

# After5 — Consolidated Summary (2026-05-30)

One document tying together everything from today: the build → launch sprint → the ruthless reality + infrastructure audits → the cross-AI (ChatGPT) strategy review → the date-generation eval-harness design. Use this as the index; each section points at the detailed report.

---

## 0. TL;DR

**After5 is a live planner web app with a fully-built, security-passed, but completely unexercised dating engine behind an off switch.** Today proved the engine works in a *local* E2E, then a series of audits established that the gap to value is **not more features — it's reachability, deployment truth, observability, and one production proof.** Both audits and ChatGPT independently converged on the same mandate: **stop building, re-baseline against reality, make the loop reachable + observable, prove it once on prod, then continue.**

Headline numbers:
- Prod dating data: **0 verified users, 0 dating-enabled, 0 swipes/offers/locks/date_instances.**
- Vercel production = commit **d350ab5** (2026-05-28 smoke commit), **78 commits behind** `main` HEAD `2107c82`. **The dating match UI + rebrand are NOT deployed.**
- Reality verdict: re-baseline before any S7+ work. Infra verdict: **🔴 RED** (not safe for real users yet).

---

## 1. What we did today (the arc)

1. **Built + verified the 5b matching UI tier** — sub-projects D (host), E (candidate), F (locked/reveal/ratings), G-in-app (notifications), H (E2E+CI). All on `main`, browser-verified; the full two-context happy-path Playwright E2E (swipe→shortlist→offer→accept→reveal) + 3 negatives **passed locally**.
2. **Launch sprint** — prod-applied 7 remediation migrations (reciprocal wire, job RPCs, 3 RLS policies, reveal hardening), deployed edge fns (fixed a live `process-jobs` cron 404), rebranded the entry funnel to dating, built cohort-unblock tooling, ran a security pass (no RED). Flag stayed OFF.
3. **Then: ruthless audits** (this is the meat of today) — a full-product reality audit and a full-infrastructure audit, run as read-only agent swarms, treating *all prior summaries (including our own) as claims to verify.*
4. **Cross-AI review** — fed the audit reports to ChatGPT; it endorsed the posture, proposed an R0–R5 re-baseline roadmap, flagged two internal contradictions (which we resolved with ground truth), and separately designed a date-generation quality eval harness.

---

## 2. Reality Audit (10-phase, full product)
*Detail: `2026-05-30-reality-audit/EXECUTIVE-REALITY-REPORT.md` + 5 sub-reports.*

**Confidence scores (0–10):** Reality 9 · Architecture 7 · **Plan 2** · Web-MVP 5 · Tester-Cohort 4 · **Launch 2.**

Key truths:
- **The match loop is deployed + tested but has handled ZERO real traffic** — "deployed+tested" was being mistaken for "working."
- **8 forward plans (p6–p11 + master + roadmap, all dated 2026-05-25) are stale and dangerous** — they predate 5b and encode a contract that shipped differently. **Even our own 2026-05-29 coherency audit drifted** (it says `make_offer` raises P5008; reality: it returns a discriminated jsonb and *commits* the reciprocal pair). Implementation is authority.
- **Ratings are a dead-end** — F's RatingForm inserts a row with no reliability/enforcement downstream.
- **Dual-dashboard split-brain:** `/home` (dating-aware, the intended home) vs `/account` (legacy planner "your home" — a dead-end for the dating journey).
- **Date generation feeds the dating loop** via the `post_night` RPC (planner itinerary → swipeable `date_instance`). The eval/bandit specs (`date-engine-v2`, `good-date-standard`) are **spec-only, zero code wiring.**
- Everything past matching — **S7 chat, S8 trust&safety consequences, S9 moderation, S10 lifecycle, S11 payments — is NOT started.**

**Verdict: STOP BUILDING. Re-baseline → reach → prove → then build.**

---

## 3. Infrastructure Audit (12-section)
*Detail: `2026-05-30-infra-audit/EXECUTIVE-INFRA-REPORT.md` + 4 sub-reports.*

**Verdict: 🔴 RED.** The data plane is well-built (RLS, SECURITY DEFINER hardening, grants, webhook auth all solid — persona-webhook verifies HMAC + fails closed; process-jobs is secret-gated; match-* bind `p_actor` to the JWT). The **operational envelope around it is not safe for real users.**

**Scores (0–10):** local-reproducibility 3 · deployment-safety 3 · database-safety 6 · secret-hygiene 6 · **webhook-safety 8** · async/jobs 4 · **observability 2** · security/privacy 5 · CI 3 · production-readiness 3.

Hard blockers even for a tester cohort:
1. **Safety is invisible** — `admin_alerts` has **zero readers** (no UI/query/RLS-select) and the ops-email sink returns `ok:false`. Abuse/safety events page no one.
2. **Offers expire unseen** — notifications are Realtime-only (open tab); web-push/email/ops are all `*_not_wired` stubs; the `devices` token table is written by nothing. The time-boxed offer mechanic is undeliverable on web.
3. **Live build isn't deployed + CI is red** — `main` 78 ahead of origin; CI fails every PR on 3 PhotoStep tests; no lint/typecheck/`next build` gate.

Pre-public also: no staging tier; `.env.local` points at **prod** with a service-role key; no sandbox/live provider split (local hits real Persona/Twilio/Resend); **GDPR delete/export absent**; `profiles.email` leaks to revealed counterparts (Y3); **silent-complete dormant jobs** (a future `deletion_process`/`chat_purge` would report success while no-op'ing); prod-dangerous seed scripts with no env guard; no error reporting; no secret-rotation doc.

Clean: no committed secrets; sensitive PII (phone/DOB/IG/emergency-contact) correctly owner-locked on `profiles_private`; real dead-letter backoff; strong migration runbook with rollback SQL.

---

## 4. Deployment truth (two contradictions, resolved with ground truth)

The reality reports disagreed; we settled both from the source:

| Fact | Truth |
|---|---|
| Vercel PRODUCTION commit | **d350ab5** ("fix(5b-smoke): RUN-LOG corrections", 2026-05-28) — confirmed via Vercel API (latest READY prod deploy) |
| `main` HEAD | `2107c82` (reveal hardening) |
| `origin/main` | `d350ab5` (= Vercel; main is **78 commits ahead, unpushed**) |
| Dating MATCH UI (D/E/F/G) live? | **NO** — all built this session, every commit is *after* d350ab5 |
| Rebrand / reveal-hardening live? | **NO** — unpushed |

→ The executive report was right; the journey report's "2 commits behind" was wrong. **Production is essentially the planner app + pre-5b baseline; there is no dating loop on the live site.** Deploy urgency is higher than "2 commits" implied.

**`/home` vs `/account`** (settled from the route headers): `/home` = *"FirstSessionHome — post-onboarding destination, never a dead end"* (dating-aware, **keep**). `/account` = *"the 'your home' page after signing in… polaroid grid of saved plans"* (legacy planner split-brain, **redirect/convert to settings-only**).

---

## 5. ChatGPT's strategic input — the R0→R5 re-baseline (endorsed, with amendments)

ChatGPT reviewed the audits and **agreed: don't build S7, don't execute p6–p11 as written, re-baseline first.** Its proposed roadmap (we endorse it):

- **R0 — Reality re-baseline:** rewrite INTEGRATION-CONTRACT + master plan against prod reality; archive stale p6–p11; record deployment truth; resolve `/home` vs `/account`; backfill prod-only `126850`; add a job-runner guard for missing RPCs.
- **R1 — Reachability:** push `main`→Vercel; confirm edge fns/envs; cohort-unblock real testers + seed Kelowna nights; enable matching for the cohort; remove the dating dead-ends.
- **R2 — Production proof:** one attended signup→match→lock→reveal→rate traversal on prod, with DB/log/job/audit evidence. (This has never happened.)
- **R3 — Unattended tester readiness:** PWA (manifest/SW/icons) + web-push + **email fallback** for offer/offer-expiring; permission prompt post-onboarding.
- **R4 — Re-specced S7 chat** (against current lock/chat reality, not stale p6).
- **R5 — Ratings consequences / trust / moderation.**

**Our two amendments before running it:**
1. **R0/R1 must absorb the infra blockers**, not just product/contract: make CI green + add `next build`/typecheck/lint gates; give `admin_alerts` a reader; guard the prod-dangerous seed scripts (env assertion).
2. **Factual correction to its prompt:** the deploy status is *not live (78 behind)* — skip the "is the UI live?" verification, treat "deploy the intended commit" as a definite R1 task gated behind CI going green.

The contract re-baseline must record the shipped realities: `match_make_offer` returns jsonb discriminated union (not scalar uuid); reciprocal commits+returns (doesn't raise P5008); `idem_key` is uuid; notification_type has 20 values (subset dispatched); the cancel_reason accepted set; error-envelope `code` (string) vs `errcode`; the 6 real reveal fields (no `bio`/`photos[]`/`expectations[]`); `chat_lock_ready` is a true-stub; the browse_feed account-state creator filter gap.

---

## 6. Date-generation eval harness (ChatGPT design + our grounding reality check)

ChatGPT designed an offline CLI eval harness for the live `/plan → generate-plan → itineraries` path (the *only* live generator). **Strong design, correctly grounded** in our reports: gates-first then LLM-judge then score then baseline-diff; **truthfulness/grounding as a hard gate** (fake specifics worse than generic copy); **score selection separately from writing** (matches the real generate-plan: deterministic place-pick, then LLM writes only); score the 3-option **portfolio**; **don't refit weights** on absent signal.

**Our reality check (the part ChatGPT couldn't do — no repo access):** its flagship gates assume `places` metadata that **doesn't exist.**
- **Buildable today** from real columns: pacing (`typical_duration_min`), open-at-arrival (`opens`/`closes`/`hours_week`), budget (`price_tier`/`typical_per_person`), drive (`drive_cluster`/lat/lng), time/weather, reservation — the whole logistics/pacing gate family is real.
- **Does NOT exist:** `allowed_claims`/`signature_facts`/`setting_tags`/`sensory_tags` (only free-text `local_insight`/`notes`/`llm_summary`/`reviews`), a clean `experience_category` taxonomy, per-stop `role`.
- **Consequence:** the *most important* gate (truthfulness) has a **hidden prerequisite — a structured place-affordance/fact-bank enrichment** — a real metadata project, not "a CLI harness." A grounded v0 can start by treating existing free-text as the (imperfect) grounding source (catches rooftop/live-jazz/truffle-fries hallucinations) and schedule the enrichment as gate-zero.

**Sequencing caveat:** this is a **planner-wedge quality track**, NOT on the R0/R1 critical path. The planner is the live thing real users touch and it feeds the loop via `post_night`, so it's not worthless — but better date *copy* doesn't move "two real testers complete the loop on prod." Run it parallel/after, not instead of the re-baseline.

---

## 7. The agreed mandate (what everyone converged on)

> **Stop building features. Re-baseline against reality. Make the loop reachable, deployed, and observable. Prove it once in production. Then continue.**

Success metric: **can two real testers complete the dating loop in production without an engineer hand-waving any step?**

Recommended next session = run the **R0 re-baseline** (ChatGPT's paste-ready prompt + our two amendments), which produces one trustworthy forward plan and stops every future session inheriting stale assumptions.

---

## 8. Report index (everything produced today/this week)

- **This summary:** `docs/superpowers/reports/2026-05-30-CONSOLIDATED-SUMMARY.md`
- **Reality audit:** `2026-05-30-reality-audit/` — `EXECUTIVE-REALITY-REPORT.md` + `reality-{inventory, journey-trust, dategen-legacy-deadui, plan-reconciliation, web-mvp}.md`
- **Infra audit:** `2026-05-30-infra-audit/` — `EXECUTIVE-INFRA-REPORT.md` + `{env-secrets-deploy, db-data-privacy, edge-jobs-webhooks, observability-ci-mobileweb}.md`
- **Gameplan audits (earlier today):** `2026-05-30-roadmap-status-audit.md`, `2026-05-30-verification-gaps-audit.md`
- **Launch sprint (2026-05-29):** `2026-05-29-launch-{funnel,deploy,branding}-audit.md`, `2026-05-29-security-pass.md`, `2026-05-29-5b-{coherency,tech-debt}-audit.md`
- **Migration runbook:** `docs/superpowers/plans/5b-prod-migration-rollout.md`

## 9. Open task snapshot (from the session task list)
- 🔴 #29 dead-letter guard for 6 dormant job types · #18 cohort rollout (yours) · #25-tooling done (run with real testers)
- 🟡 #21 empty-img-src guard · #22 G email transport (Resend+templates) · #23 PhotoStep tests · #30 live job-chain E2E · #31 migration-history reconcile · #27/#28 done (reveal hardening)
- Re-baseline (R0) + the infra blockers (CI green, admin_alerts reader, seed guards) — **not yet tasked; the next session's job.**
- Parked: #12 native mobile · the date-gen eval harness (planner-wedge track).

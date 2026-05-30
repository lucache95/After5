# Roadmap Phase-Status Audit — After5 (entire gameplan)

**Date:** 2026-05-30
**Scope:** Read-only. Cross-checked the canonical `2026-05-25-RECONCILED-MASTER-PLAN.md` (S1–S12) and the `2026-05-27-5b-master-roadmap.md` against **prod** (Supabase ref `ufufmcpnysvwtutpbian` — migrations, tables, functions, edge fns, enums) and **code** (`apps/web/app/**`, `supabase/migrations/**`, `supabase/functions/**`, `apps/web/lib/**`).
**Verdict legend:** SHIPPED = on prod + code, working · PARTIAL = some built, gaps · NOT STARTED.

> **Naming note:** the master plan uses S1–S12; the original 12 plans use P0–P11; 5b (Match & Lock) = the S5/S6 + chat-core slice, decomposed into sub-projects Z/A–H. They're cross-referenced below.

---

## Headline state

- **Schema spine (S1) and async/notify/chat-core spine (S2) are fully on prod** — all tables, enums, and infra RPCs exist (`jobs`, `notifications`, `devices`, `feature_config`, `analytics_events`, `admin_alerts`, `chat_threads`, `can_enter_lock_flow`, the full S1 enum set incl. `report_status`, `standing_state`, `account_lifecycle`, `cancel_reason`).
- **5b (Match & Lock) backend (Z/A/B/C) is SHIPPED to prod**: all `match_*` RPCs + 8 `match-*` edge functions ACTIVE, behind `feature_config.match_v2_enabled` (default **false**). Prod smoke-test (Task 10 Step 1) passed the full chain once, then restored baseline.
- **5b UI (D/E/F/G) + E2E/CI (H) are BUILT and on `main`** — the routes the 2026-05-29 coherency audit reported as "unbuilt" now all exist (`dates/[slug]/interested`, `offers/[offerId]`, `matches/**`, `reciprocal/[pairId]`, `account/notifications`, `api/notifications`, `e2e/5b-*.spec.ts`, `.github/workflows/5b-tests.yml`). **`main` is ahead of origin by 78 commits → NOT pushed → NOT on Vercel.**
- **Everything past matching (S7 chat, S8 trust&safety enforcement, S9 moderation/admin, S10 lifecycle, S11 payments, S12 finalization) is NOT STARTED on the backend.** The S1 schema reserves enums for them, but no RPCs exist.

---

## Phase-status table

| Phase | Covers | Status | What remains |
|---|---|---|---|
| **S1** schema spine (P0) | dating tables, reports/disputes/blocks, standing+account_state enums, fixtures | ✅ SHIPPED | — (all P0 + lifecycle/standing enums on prod) |
| **S2** async/notify/chat-core (P2 + C11.7) | jobs+runner, notifications+devices+prefs, feature_config, analytics_events, admin_alerts, can_enter_lock_flow, chat-core thread fns | ✅ SHIPPED | runner cron live (`process-jobs` + Vercel cron); chat-core present |
| **S3** identity/verification/onboarding (P1) | profile, prefs, onboarding step machine, Persona age-verify, phone OTP | 🟡 PARTIAL | Onboarding routes + `start-verification`/`confirm-phone`/`persona-webhook` edge fns all built & deployed, but **provider secrets (Persona API key/template, Twilio) + webhook config not confirmed live** — Twilio blocked smoke Step 2 earlier. Real path exists in code; needs prod credentials + a verified live run. |
| **S4** creation + media pipeline (P3) | evergreen/scheduled nights, generator, signed-URL media, transcode, sounds, moderation_status | 🟡 PARTIAL | `date_instances` feed columns + post-night + `generate-blur` + classify/cover fns shipped (5a loop). Full media-serving/transcode/sounds-library + UGC `moderation_status` queue per P3 not verified as complete. |
| **S5** browse & interest (P4) | compat pre-filter, swipe, ambient, cold-start concierge, `browse_feed_for_viewer` | ✅ SHIPPED | `record_swipe`, `browse_feed_for_viewer`, feed UI all on prod + code (5a loop merged). Cold-start/concierge seed-handling depth not re-verified. |
| **S6** matching loop = **5b A/B/Z** | full C2 `match_*` API, chat-core hooks, reciprocal, auto-roll, cancel taxonomy, demand hint | ✅ SHIPPED (flag OFF) | Backend on prod; flag `match_v2_enabled=false`. Rollout Task 10 Steps 2–3 (tester cohort, global flip) pending. |
| **5b C** extras + edge | 8 edge fns, feature flag, admin force-expire/cancel, idempotency prune | ✅ SHIPPED | All 8 `match-*` edge fns ACTIVE; flag row present |
| **5b D/E/F/G** UI surfaces | host shortlist, candidate offer, locked+reveal+rating, notifications | 🟡 PARTIAL | Built + on `main` + unit/a11y tested, but **NOT pushed to Vercel** (origin -78). Known coherency RED items (offer-return shape, errcode keying, reciprocal-pair entry) per 2026-05-29 audit may need reconcile before flag-on. |
| **5b H** E2E + CI | run-all, Playwright happy+negatives, GitHub Actions | 🟡 PARTIAL | Built + on `main`; jsdom/local-green only — **not browser-verified end-to-end on a deployed env**; CI workflow added but PR-run not confirmed. |
| **S7** chat messaging + rapport-gate (P6) | message persistence, Realtime channels, composer UI, retention, off-platform detection, redefine `chat_lock_ready` | ⬜ NOT STARTED | No `messages`/`chat_messages` table on prod; no send RPC. F ships `Phase7Placeholder` ("messages coming with phase 7"). `chat_lock_ready` returns true unconditionally. This is the deferred no-rapport-gate window. |
| **S8** trust & safety + ratings (P7) | rating submit→reliability formula, enforcement ladder writing `standing`, check-in, dispute, block propagation, safety center | ⬜ NOT STARTED (backend) | `match_ratings` table + `close_rating_window(p_lock)` exist; **F's RatingForm writes match_ratings via direct RLS insert — no reliability recompute, no enforcement ladder, no standing writes.** No `file_report`/`block_user`/reliability/check-in RPCs on prod. `reports`/`disputes`/`blocks` tables empty + unwired. |
| **S9** moderation & admin (P8) | admin console on real queues, report/dispute resolution, suspension, appeal+notify | ⬜ NOT STARTED | Existing `/admin/*` is **legacy planner** (dates/venues/insiders/eval/feedback) only — no dating moderation queue, no report/dispute resolution, no appeal flow, no admin standing-writes. |
| **S10** account lifecycle (P9) | pause/delete `account_state`, auth.users deletion + re-signup defense, GDPR export, legal-hold | ⬜ NOT STARTED | `account_lifecycle` enum + column on prod, but no deletion/pause/export RPCs; no `deletion_process` consumer wired. |
| **S11** payments framing (P10) | disclaimer on every pay surface, canonical labels, payment_dispute reports | ⬜ NOT STARTED | No Stripe/payment code. `payment_dispute` is only an unused `report_reason_category` enum value. (P10 is framing/disclaimer, not real billing — still unbuilt.) |
| **S12** polish & finalization (P11) | `browse_feed` finalization (133000), full state-set wiring, a11y, analytics relay, all transition events, feature flags | 🟡 PARTIAL | 5a UI a11y/state polish + feature flags partially done; `browse_feed` finalization migration (band 133000) NOT applied; `analytics_relay` job handler not built (events written, never drained — MD5). |

---

## Outstanding beyond 5b — specific findings

- **Phase 7 chat (S7):** NOT STARTED. No message table/RPC/Realtime channel anywhere. F renders a placeholder. `chat_lock_ready` is a forward-compatible stub returning true. This is the single biggest gap and the documented "close immediately after 5b" item (roadmap Task 11).
- **Ratings/trust&safety (S8):** Backend essentially NOT STARTED despite F's RatingForm. Rating is a raw RLS insert into `match_ratings` (idempotent on 23505 unique) with **zero downstream**: no reliability score, no `standing` mutation, no enforcement ladder, no admin alert. `close_rating_window` exists but nothing computes reliability from the ratings. Safety reporting, blocks, disputes: tables exist, **no `file_report`/`block_user`/dispute RPCs** — block propagation (DU5) and safety escalation (DU6) unbuilt.
- **Moderation/admin (S9):** NOT STARTED for dating. Admin app is legacy planner tooling only.
- **Payments (S11):** NOT STARTED. No billing; `payment_dispute` enum value unused.
- **Account lifecycle (S10):** NOT STARTED. Enum/column reserved; no deletion/pause/export/legal-hold logic.
- **Polish (S12):** PARTIAL. `browse_feed` finalization migration and `analytics_relay` drain are the notable carry-forwards.
- **Notifications email half (G):** PARTIAL. In-app center + prefs + `api/notifications` + `lib/email/resend.ts` exist; **Resend domain verification (DKIM/SPF/DMARC for the dating domain) + a deployed `notification-dispatcher` were the G Step 1 gate and are not confirmed live.**
- **Onboarding providers (S3):** PARTIAL. Persona + Twilio edge fns are real (not stubs) but need prod secrets + verified live runs (Twilio previously blocked the smoke test).
- **Docs-assume-done-but-not-on-prod:** prod-only migration `20260527126850_p5_cancel_reason_extend` has **no local file** (clean `db reset` won't reproduce prod's `cancel_reason` enum). Migration version-key vs filename divergence persists (history-reconciliation gap). `browse_feed` finalization assumed by S12 not yet applied.

---

## Ordered outstanding-phases list (after 5b ships)

Dependency-ordered. "Size" is rough (S = days, M = 1–2 wks, L = multi-wk).

1. **Push `main` → Vercel + flip-on rollout (Task 10 Steps 2–3).** Size S. Deps: reconcile the 3 coherency RED items (offer-return shape, errcode keying, reciprocal-pair entry) + backfill migration `126850` locally. **Blocks everything** — 5b is invisible to users until deployed.
2. **S3/G finalization — provider + email go-live.** Size S–M. Persona/Twilio secrets + verified verification run; Resend domain verify + deploy `notification-dispatcher`. Deps: prod credentials + DNS. Needed for real onboarding + offer/match emails.
3. **S7 — Phase 7 chat messaging + rapport-gate.** Size L. Deps: 5b live (Z chat-core already shipped). Highest-priority feature gap; redefines `chat_lock_ready`, replaces `Phase7Placeholder`. Roadmap Task 11.
4. **S8 — trust & safety + ratings backend.** Size L. Deps: 5b (locks/ratings flow). Reliability formula from `match_ratings`, enforcement ladder writing `standing` (gate already wired in S2/S6), `file_report`/`block_user` + propagation, check-in/dispute, safety center. Wires F's already-built RatingForm into real consequences.
5. **S9 — moderation & admin.** Size L. Deps: S8 (reads `reports`/`disputes`/standing it produces). Admin console on real queues, resolution recompute, suspension, appeals.
6. **S10 — account lifecycle.** Size M. Deps: S8/S9 (orphan handling via C2 API). Pause/delete, auth.users deletion + re-signup defense, GDPR export, legal-hold.
7. **S11 — payments framing.** Size S. Deps: none hard (UI surfaces from S5/S6). Disclaimer + canonical "who pays" labels on every surface; thread `payment_dispute`.
8. **S12 — polish & finalization.** Size M. Deps: S5–S10 screens exist. `browse_feed` finalization migration (band 133000), `analytics_relay` drain, full state-set/a11y pass, transition-event coverage. Runs last by design.

**Plus a one-off cleanup (do early, low cost):** migration-history reconciliation — backfill prod-only `126850` to a local file and reconcile version-key vs filename drift, so `db reset`/CI reflect prod.

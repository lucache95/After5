> ⚠️ STALE / DO NOT EXECUTE — superseded by docs/after5-current-implementation-plan.md and docs/INTEGRATION-CONTRACT.md (2026-05-30). Kept for history only. May reference phantom columns, scalar return shapes, and wrong ownership.

# Reconciled Master Implementation Plan — After5 Dating

**Date:** 2026-05-25
**Authority:** `INTEGRATION-CONTRACT.md` (v2, incl. C11) is the governing source of truth. This document is the reconciled build order subordinate to it. The original 12 phase plans (P0–P11) are **inputs**, not authority; where they conflict with the contract or this plan, they lose.
**Basis:** the 12 per-plan audits + `CONSOLIDATED-INTEGRATION-AUDIT.md` (I1–I13) + `INTEGRATION-CONTRACT-audit.md`.

---

## 1. Contract Violations

Conflicts against the contract that must be removed from the plans:

- **CV1 (P2 vs C1):** P2 ships `enqueue_job(job_type ENUM…)` but consumers call `enqueue(kind text…)`. Plans P5/P6/P7/P9 violate C1 — must adopt `enqueue_job`/`cancel_jobs` + the C1 `job_type` enum (extended to all kinds).
- **CV2 (P5 names vs C2):** callers use `cancel_lock`/`expire_offer`/`withdraw_from_queue`/`confirm_lock`/`p5_promote_standby`. Only the C2 `match_*` names are legal. `match_withdraw` replaces `withdraw_from_queue`.
- **CV3 (account state vs C3/C11.5):** P8 `suspensions`/`account_active()` and P9 `account_status='suspended'` are gates → violation. Gate is `profiles.standing` (P7) + `account_state` (P9, no `suspended`). P8 suspensions = audit log only.
- **CV4 (browse_feed vs C4/C11.3):** P0/P3/P4/P8 each `create or replace browse_feed` → violation (and a build break). One drop+create finalization migration owns it; others `alter table` only. Must include the `account_state='active'` + `standing` filter.
- **CV5 (reports vs C5/C11.6):** P8 renames/drops `actioned`/`reviewing` (P7 reads them) → violation. Status stays 4-value; richer lifecycle via `resolution_code`.
- **CV6 (reveal vs C2):** P1's `offer_reveal` competes with `match_reveal_allowed` → delete P1's.
- **CV7 (demand hint vs C2):** P11's `demand_hint`/`bucket_demand` duplicate `match_demand_hint` → delete P11's.
- **CV8 (offer window vs C11.1):** P5 hardcodes 24h → must use `offer_expires_at()` reading `feature_config`.
- **CV9 (auth vs C10):** P5/P8 RPCs authorize passed `p_actor` & don't revoke helper grants → must authorize `auth.uid()` + `revoke execute from authenticated` on internal helpers.
- **CV10 (vitest vs C12):** P3/P6/P8/P10/P11 each bootstrap vitest → delete; P1 owns the root config.
- **CV11 (fixtures vs C8):** P0/P5/P7 psql fixtures don't seed `auth.users` (and violate `itineraries` NOT-NULL) → all use `mk_user()`/`mk_itinerary()`.
- **CV12 (FK cascade vs C9):** P6 `on delete cascade` on chat sender/threads violates P9 legal-hold → tombstone + `revoked_at`.

## 2. Cross-Plan Contradictions

- **CC1:** Chat model — P5 stateless `match_reveal_allowed` vs P6 stateful threads + rapport gate. Resolved: C9 stateful threads win; P5 calls chat-core hooks.
- **CC2:** Three suspension models (P7 `standing`, P8 `suspensions`, P9 `account_status`). Resolved by C3/C11.5.
- **CC3:** `browse_feed` column sets disagree across P0/P3/P4/P8 and the client RPC omits P3's sound fields. Resolved by C11.3 (one projection; RPC returns all).
- **CC4:** Reveal grain — P1 keys on creator-profile, P5 on date-instance; P1's self-destructs at lock. Resolved: P5 authoritative.
- **CC5:** Pay labels — P4 feed renders `i_pay`→"They treat" vs P10 "I pay". Resolved: P10's labels canonical, applied on every surface.
- **CC6:** Migration timestamps collide (`13xxxx` band shared by P1/P2/P5/P7/P8/P9). Resolved by C6 band map + C11 reslots.
- **CC7:** P7 expects `can_enter_lock_flow` honored on accept; P5 never calls it. Resolved: P5 calls it (S6 depends on S8's signature — see §6/§7).

## 3. Duplicate Systems

- **DS1:** Anti-storm — P11 `notification_batches`/`coalesce_notification` vs P2 rate-limiter. Keep P2's `dispatch_notification`; delete P11's. (C10)
- **DS2:** Demand hint — `match_demand_hint` (P5) vs `demand_hint` view (P11). Keep P5's. (CV7)
- **DS3:** Reveal predicate — `match_reveal_allowed` (P5) vs `offer_reveal` (P1). Keep P5's. (CV6)
- **DS4:** vitest config ×5. Keep P1's root workspace config. (CV10)
- **DS5:** `jobs`/`job_status`/`enqueue` ×3 (P2 real; P5/P9 shims). Keep P2's; shims become test-only `if not exists` and are dropped once S2 lands. (CV1, C11.5)
- **DS6:** UI primitives — P11 `components/loop/*` (SwipeDeck, AmbientPlayer) duplicate P4's. Keep P4's; P11 enhances in place, introduces none orphaned. (I-P11)
- **DS7:** Suspension state ×3 (DS via CC2).

## 4. Missing Dependencies

Things assumed-but-never-built (now owned per contract/this plan):

- **MD1:** `feature_config` + `offer_expires_at()` (C11.1) — P5 assumed; now S2.
- **MD2:** Device-token registration (`devices`/`register_device`) — every notification assumed a token; nothing registered → S2 + S3 wire it.
- **MD3:** Verification "front door" (start Persona inquiry + write `phone` row) — P1 only had the webhook → S3.
- **MD4:** Media serving (signed-URL mint) + transcode invoker — P3 buckets unservable → S4.
- **MD5:** `analytics_events` outbox **drain** (`analytics_relay` job) — written, never drained → S2 (table) + S12 (handler).
- **MD6:** `disputes` table + bidirectional P7↔P8 loop — P7 wrote free-text, P8 never recomputed → C11.6, S8/S9.
- **MD7:** `moderation_status` column placement — P8 moderated an invented column; real UGC queue (`media_assets`) orphaned → C11.8 (S4 column), S9 reads it.
- **MD8:** `auth.users` deletion + re-signup defense — P9 only touched `profiles` → S10.
- **MD9:** Seed-night (concierge) handling across feed→matching — P5 had none → S5 defines, S6 honors.
- **MD10:** Creator-cancels-own-date-pre-lock flow — unowned → S6.
- **MD11:** Appeal flow for suspensions/bans + user notification — P8 had none → S9.
- **MD12:** Admin-alert "fail loud" sink for safety notifications with no device → C11.8, S2.

## 5. Dead UI / Fake Interaction Risks

- **DU1:** Pay-setting badge renders on 1 of ~5 surfaces and is imported by nothing → S11 wires every surface (feed/create/offer/lock/post-date) with canonical labels + disclaimer.
- **DU2:** "Verified · New" badge + verification flow — dead until MD3 builds the front door.
- **DU3:** Cold-start "we'll line you up" confirmation UI promised, not built; seed-night swipe dead-ends → S5/S6 (MD9).
- **DU4:** P11 `AsyncBoundary`/`OfferCountdown`/`LoopActionButton` target screens no phase builds → S6/S7 build the host screens; S12 wires the primitives into them (no orphans).
- **DU5:** Block/Report buttons without propagation → S8 wires `block_user` (revoke offer, cancel lock, revoke chat, `can_rematch=false`) + `file_report`.
- **DU6:** Emergency-contact/check-in UI implying escalation that didn't exist → S8 escalation via `admin_alerts` (C11.8).
- **DU7:** Ambient sound control with no library/serving on web → S4 (sounds + signed URLs) + S5 (web fallback).
- **DU8:** Reliability score display empty at launch (everyone "New") — acceptable, but the shortlist UX must render the "New" state, not a blank → S6 DoD.

## 6. Required Reordering

Original P0→P11 numeric order is **wrong** (consumers precede the shared spine). Corrected dependency order (stages S1–S12 below). Key moves:

- **Shared infra (was inside P2) is pulled forward to S2**, before all consumers (P1/P3/P4/P5/…). Jobs, notifications, devices, `feature_config`, `analytics_events`, `admin_alerts` must exist first.
- **Chat-core primitives (subset of P6) move to S2** (C11.7) so S6 (matching) can call `open_chat_thread`/`chat_lock_ready` in its tests. Rich messaging stays in S7.
- **`can_enter_lock_flow` signature (P7) must exist before S6** — S6 calls it. Either define the function stub in S2 (shared) returning a real check once S8 fills standing, or land S8's gate function before S6. Resolution: the **gate function `can_enter_lock_flow` is defined in S2** (reads `account_state` + `standing`, both columns added in S1), so S6 can depend on it; S8 only adds the *ladder that writes* `standing`.
- **`browse_feed` finalization moves to the very end (S12, band `133000`)** — it depends on columns from S4/S7/S8/S10.
- **`reports`/`disputes` DDL moves to S1** (schema spine), not scattered across P7/P8/P10.

## 7. Canonical Shared Architecture

Single-source definitions (frozen in the contract; restated for build). **Build these in S1–S2 before any consumer.**

- **Schema spine (S1):** all P0 tables + `vibe_tags` on `itineraries`; `reports`+`disputes`+`report_status`/`report_reason_category` (C5/C11.6); `standing_state` + `account_lifecycle` enums + columns (C3/C11.5); RPC-only lifecycle columns (C7); `_fixtures.sql` `mk_user`/`mk_itinerary`/`mk_instance` (C8/C11).
- **Async/config/notify spine (S2):** `jobs`+`job_type`+`job_status`+`enqueue_job`/`cancel_jobs`+runner (C1); `notifications`+`notification_type`+`notification_preferences`+`devices`(C11.2)+`register_device`+`dispatch_notification` (C1); `feature_config`+`offer_expires_at()` (C11.1); `analytics_events` outbox (C11.8); `admin_alerts` + ops sink (C11.8); `can_enter_lock_flow(p_user)` gate (C3); chat-core thread table + `open_chat_thread`/`close_chat_thread`/`promote_chat_thread_to_lock`/`chat_lock_ready` (C11.7).
- **Match API (S6):** the C2 `match_*` functions (incl. `match_withdraw`, `match_resolve_reciprocal`), authorized via `auth.uid()`, helpers grant-revoked, emitting `analytics_events` and `dispatch_notification`, reading `offer_expires_at()`.
- **Feed (S12 finalization):** the single `browse_feed` (C11.3) + `browse_feed_for_viewer()` RPC.
- **Naming/auth/routes:** all SECURITY DEFINER assert `auth.uid()`; admin under `apps/web/app/admin/*` gated by `requireAdminRole()`; one vitest root config (C12); migration bands per C6/C11.

## 8. Reconciled Master Implementation Plan (authoritative staged build order)

Each stage ships working, testable software and **adds no UI that isn't fully functional by stage end**.

- **S1 — Schema spine & fixtures.** P0 (corrected: `vibe_tags`, RPC-only lifecycle, no `browse_feed` here beyond a minimal early stub) + `reports`/`disputes`/standing/account_state enums + `_fixtures.sql`. *Ships:* a migrating, test-passing schema with both flagship invariants proven via `mk_user` fixtures.
- **S2 — Async/config/notify/chat-core spine.** Jobs+runner, notifications+devices+preferences+`register_device`+`dispatch_notification`, `feature_config`+`offer_expires_at()`, `analytics_events`, `admin_alerts`, `can_enter_lock_flow`, chat-core primitives. *Ships:* a working scheduler+notification backbone with safety "fail-loud", testable end-to-end.
- **S3 — Identity, verification, onboarding.** Profile, preferences (feed the pre-filter), **verification front door** (start Persona inquiry + phone OTP write), DOB age gate, blurred-photo generation, `register_device` wired, onboarding step machine. *Ships:* a user can sign up, verify (real path), and reach a complete profile.
- **S4 — Creation & content pipeline.** Evergreen + scheduled (+ availability-gated conversion), generator integration, **media pipeline with real signed-URL serving + transcode invoker + moderation_status**, sounds library, anonymous-draft claim. *Ships:* a user can create/personalize a publishable night with working media + sound.
- **S5 — Browse & interest.** Compat pre-filter (PostGIS + prefs), swipe (idempotent), ambient (native + web fallback), cold-start concierge nights with defined seed-handling + the "you're in line" UI, pagination + `starts_at>now()`. *Ships:* a user can browse blind and swipe; feed never leaks identity.
- **S6 — Matching loop.** Full C2 API; calls chat-core + `can_enter_lock_flow` + `offer_expires_at()`; creator-cancel-pre-lock; reciprocal chooser; safe auto-roll; demand hint; emits analytics + notifications. *Ships:* end-to-end create→swipe→shortlist→offer→lock with proven concurrency.
- **S7 — Chat (rich).** Messaging/retention/media/read-state/off-platform-detection on chat-core; block propagation; report. *Ships:* matched parties chat with the rapport gate enforced.
- **S8 — Trust & safety.** Ratings, reliability formula, enforcement ladder writing `standing` (gate already wired in S2/S6), geofenced check-in + dispute→`disputes`, emergency-contact escalation via `admin_alerts`, safety center. *Ships:* no-show/abuse have real consequences; safety check-ins fire.
- **S9 — Moderation & admin.** Admin console reading real queues (`reports`+`media_assets`), report/dispute resolution (recomputes reliability), suspension writing `standing`, appeal flow + notify, anti-abuse. *Ships:* ops can action everything on day one.
- **S10 — Account lifecycle.** `account_state` (pause/delete), `auth.users` deletion + re-signup defense, orphan handling via C2 API, GDPR export, legal-hold. *Ships:* compliant offboarding without orphaned state.
- **S11 — Payments framing.** Disclaimer on every pay surface, canonical labels, `file_report` threads `payment_dispute`. *Ships:* the "who pays" expectation is honest everywhere.
- **S12 — Polish & finalization.** `browse_feed` finalization migration (C11.3), loading/error/empty/success states wired into real S5/S6/S7 screens, a11y, analytics relay + all transition events, feature flags. *Ships:* production-grade states, a11y, and observability across the loop.

## 9. Definition of Done Per Stage

A stage is **not done** unless ALL hold:
- Every migration applies cleanly in a full `supabase db reset` (cumulative), and `pnpm db:types` regenerates without error.
- Every psql/Deno/vitest test for the stage passes; the stage's flagship invariants/behaviors are *exercised* (not skipped by broken fixtures).
- Every new RPC: authorizes `auth.uid()`, has RLS, has an idempotency story where it mutates, and is called by a real consumer in this or a named later stage (no orphan functions).
- Every new screen/route: has a real route, real data source, real permissions, and the full state set — **loading, error, empty, success, retry, cancel** — plus mobile-responsive layout and basic a11y (focus, labels, contrast). No placeholder screens (unless tagged `// SCAFFOLD:` and removed by S12).
- Every button maps to a defined action → state change and/or RPC/API → DB table or external service. No dead buttons.
- Cross-stage hooks it provides are named in the contract; hooks it consumes already exist (or are stubbed in S2 with the final signature).
- Analytics events for the stage's transitions emit to `analytics_events`; user-facing transitions fire `dispatch_notification`.
- `typecheck` + `lint` pass.

## 10. Final Build Rules (non-negotiable)

1. **Contract first.** `INTEGRATION-CONTRACT.md` (incl. C11) is authoritative; never deviate silently — if reality forces a change, update the contract in the same change.
2. **Shared before dependent.** Never build a consumer before its shared dependency (S1→S2→…). If you need something not yet built, stub it in S2 with the *final* signature, never inline a divergent copy.
3. **One definition per shared object.** No second `jobs`/`browse_feed`/reveal/demand/vitest/state-model. Reference, don't recreate.
4. **DB-enforced invariants.** Offer-uniqueness, no-overlap, and lifecycle transitions live in constraints + SECURITY DEFINER RPCs, not app code; RLS never grants direct writes to lifecycle columns.
5. **`auth.uid()` always.** Every RPC authorizes the real caller; internal helpers `revoke execute from public, authenticated`.
6. **No dead UI.** A component is only introduced when its data source, permissions, state behavior, and backend all exist. Every flow ships all six states.
7. **Tests must run.** All fixtures via `mk_user`/`mk_itinerary`; a passing test that never executed its assertion is a failure.
8. **Safety fails loud.** Safety notifications with no delivery channel hit `admin_alerts` + ops email — never silently drop.
9. **Migrations are banded.** Use the C6/C11 timestamp map; `browse_feed` only at `133000` via drop+create.
10. **No politeness preservation.** Follow this re-staged order, not the original P0–P11 numbering.

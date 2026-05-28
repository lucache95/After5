# 5b Architecture Overview — Design Spec

**Status:** Design — awaiting user review
**Owner:** This is a NORTH-STAR overview spec. Each sub-project (Z, A-H) gets its own brainstorm → spec → plan cycle. The overview's "plan" is to execute those sub-projects in dependency order; that master roadmap is the writing-plans deliverable that follows this spec.
**Last revised:** 2026-05-27

---

## Goal

Define the architecture, sub-project decomposition, state machines, contract surface, error model, testing strategy, and known risks for **Phase 5b — Match & Lock**: the experience-first dating core loop that turns a swipe-right on a posted date into a locked match with a revealed counterpart profile.

Deliver this in **9 sub-projects** (Z, A, B, C, D, E, F, G, H) executable in dependency order so each chunk has a focused spec + plan + reviewable PR. No single mega-spec; no corner-cutting on the parts that matter.

## Architecture (1-paragraph summary)

5b extends the shipped 5a swipe → post-night loop with the matching state machine designed in P5 (2026-05-25) — **adopted verbatim** for the contract surface, with one MVP-marginal tighten (`match_demand_hint` stubbed to a swipe-count heuristic until presence infra exists in a later phase). Every match transition is a `SECURITY DEFINER` PL/pgSQL function with `pg_advisory_xact_lock` + idempotency-ledger writes, audited via `analytics_events`, async-notified via S2's `dispatch_notification`, async-scheduled via S2's `jobs` queue. The chat-core thread primitives (`open_chat_thread`, `chat_lock_ready`, `promote_chat_thread_to_lock`, `close_chat_thread`) ship as a standalone pre-A sub-project (Z); messaging UI proper waits for Phase 7. UI is mobile-first Next.js 15 App Router against shipped 5a tokens (warm cream + pink accent + polaroid). Realtime channels surface live state-changes for matching UX (queue_entries, locks, notifications). The whole stack ships behind `feature_config.match_v2_enabled` for safe progressive rollout.

## Tech stack (consumed by reference)

- **Postgres 15** (Supabase) — PL/pgSQL `SECURITY DEFINER`, `pg_advisory_xact_lock`, GiST exclusion constraints, partial unique indexes, RLS
- **Deno Edge Functions** — thin transport (JWT verify → call RPC → map errcode to HTTP); 8 user-facing endpoints
- **Supabase Realtime** — Postgres-changes subscriptions on `notifications`, `locks`, `queue_entries`
- **Next.js 15 App Router** — RSC + client components against shipped 5a token system
- **framer-motion** — gesture + animation for swipe + drag-rank + match confirmation
- **Resend** — transactional email transport (5b notification surface)
- **Vitest + React Testing Library + Playwright** — unit + E2E test stack
- **GitHub Actions** — CI gate (introduced in sub-project H)

## Source docs consumed by reference (canonical, not duplicated)

- `docs/superpowers/plans/2026-05-25-p5-matching-state-machine.md` — P5 plan, 2172 lines (C2 API surface and SQL bodies)
- `docs/superpowers/plans/2026-05-25-INTEGRATION-CONTRACT.md` — IC v2 (contract IDs C1-C11)
- `docs/superpowers/plans/2026-05-25-RECONCILED-MASTER-PLAN.md` — stage map (S1-S12)
- `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` — original roadmap
- `docs/superpowers/DESIGN-SYSTEM.md` — branding tokens (warm-filmic + pink accent + polaroid)

This spec **does not redefine** any function signature, table column, or invariant present in the above. It maps them onto sub-project boundaries.

---

## Section 1 — Sub-project decomposition + dependency graph

**9 sub-projects.**

### Z — Chat-core primitives
**Goal:** Provide the four thread-state functions A consumes (`open_chat_thread`, `chat_lock_ready`, `promote_chat_thread_to_lock`, `close_chat_thread`) and the `chat_threads` table they read/write. Chat-core already shipped in S2 band 124500 (`20260525124500_p2_chat_core`); Z's 5b deliverables are amendments only.

**Deliverables (Z is amendment-only — see `docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md`):**
- `chat_threads` table — exact as-built shape on prod: `id uuid PK, offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE UNIQUE, lock_id uuid NULL REFERENCES locks(id) ON DELETE SET NULL, state text NOT NULL CHECK in ('open','promoted','closed') DEFAULT 'open', both_ready bool DEFAULT false, legal_hold bool DEFAULT false, revoked_at timestamptz, promoted_at timestamptz (Z.2), created_at, updated_at`. Structural 1:1 with offers via `offer_id UNIQUE`. `state` uses text+CHECK rather than an enum — functionally equivalent; an enum upgrade is **deferred to Phase 7** if needed.
- `chat_lock_ready(thread uuid) returns bool` (Z.1 5b amendment) — returns `state='open'` (true while thread is open, false after promote/close, false for missing thread). Phase 7 redefines internally by adding AND-conditions for rapport, without changing the signature.
- `promote_chat_thread_to_lock(offer, lock)` (Z.2 hardening) — UPDATE filtered by `AND state='open'` so concurrent close-then-promote can never produce partial state; distinguishes "no thread for offer" vs "thread is not open" in its RAISE for caller translation.
- `promoted_at` timestamptz column (Z.2 add) — set by `promote_chat_thread_to_lock`; supports 5b analytics + Phase 7 rapport-to-promotion latency metrics.
- Migrations in **S2 band 124500** (NOT P5 band — chat-core is canonically S2).
- RLS on `chat_threads`: enabled with **zero policies** (default-deny). Only SECURITY DEFINER paths (Z's RPCs called by A's match_* RPCs) can read/write. Participant-read policy is **Phase 7's responsibility** (referenced inline in the original migration's source comments).
- Auth model: Z's functions are NOT public RPCs (`REVOKE EXECUTE FROM public, authenticated`); invariant §2.5 #7 (`auth.uid()=p_actor`) is enforced one layer up at A's match_* RPCs. Negative-authz test verifies the REVOKE via `has_function_privilege()` metadata check (a direct SET ROLE + REVOKE'd function call crashes the local PG build — known quirk).
- Tests: in-place updates to `supabase/tests/p2_chat_core.sql` (4-combo lock_ready + promoted_at + state-filter + negative-authz + negative-RLS) + new `supabase/tests/z_chat_thread_races.sh` (two-session bash race harness).

**Phase 7 expansions (NOT 5b):** participants column (if join-overhead becomes a hot path), enum upgrade for state, separate `closed_at`/`promoted_at` (if `revoked_at` semantics get muddier), `'ready'` substate between open and promoted (gated by rapport — chat_lock_ready redefined to AND-include the rapport check), participant-read RLS policy.

**Depends on:** S1 schema spine + S2 chat-core baseline (`20260525124500_p2_chat_core`) already on prod.

### A — Backend happy path
**Goal:** Ship the matching RPCs that drive shortlist → offer → accept → lock + the reveal predicate + supporting infrastructure.

**Deliverables:**
- `transition_idempotency` ledger table + helpers (P5 band 126100).
- Advisory-lock key helpers `match_instance_lock_key`, `match_pair_lock_key` (P5 band 126000) + two-session race harness (`supabase/tests/p5_concurrency_lib.sh`).
- `match_shortlist(actor, instance, candidate, rank)` — carries rank in one call; freezes rank=1 while an offer is active.
- `match_make_offer(actor, instance, candidate, idem_key) → offer_uuid` — checks `can_enter_lock_flow(candidate)`, sets `expires_at = offer_expires_at()`, enqueues `offer_expiry` job, calls `Z.open_chat_thread(offer_id)`. **Detects reciprocal-pair as side effect**: if candidate has an active offer to actor on a different instance, raises `P5008 reciprocal_pending` and emits `reciprocal_detected` notification to both creators (B owns the resolution flow).
- `match_accept_offer(actor, offer, idem_key) → lock_uuid` — checks `Z.chat_lock_ready(thread)` + `can_enter_lock_flow(actor)`, advisory-locks instance, creates lock row, off-market-cascades counterparties on overlapping instances to `standby` via deferred `standby_roll` jobs (B's path), calls `Z.promote_chat_thread_to_lock`, cancels `offer_expiry` job.
- `match_reveal_allowed(viewer, instance) → bool` — predicate; derivation pinned in §2.6.
- `profiles_select_revealed` RLS policy on `profiles` (A's migration band 126xxx) — uses `match_reveal_allowed` to gate read access. Cross-band ownership; explicit header note in the migration explains why A modifies S1's table policies.
- `match_ingest_interest(swiper, instance)` internal helper called from S5's swipe path on direction=right; inserts `interested` row into queue_entries.

**Emits notifications:** `offer_received`, `new_match`, `reciprocal_detected`.
**Enqueues jobs:** `offer_expiry`.
**Depends on:** Z, S2 (jobs+notify+config+gate), S5 (swipes).

### B — Backend resolution
**Goal:** Ship every state-machine transition that isn't on the happy path.

**Deliverables:**
- `match_pass_offer(actor, offer)` — closes thread, calls `match_auto_roll`.
- `match_expire_offer(offer)` — idempotent; fired by `offer_expiry` job; closes thread, calls `match_auto_roll`.
- `match_auto_roll(instance)` — enqueues a SINGLE `standby_roll` job for the instance (never sync cascade); the job calls `_match_make_offer` service variant for the next-rank standby.
- `match_next_standby(instance) → uuid` — **internal-only for 5b**; no Edge Function (A5 audit decision); single source of standby ordering for `standby_roll`.
- `match_withdraw(actor, instance)` — candidate exits queue from any state (interested, shortlisted, offer_active); deletes queue_entries row; if it was offer_active, also cancels offer + closes thread.
- `match_resolve_reciprocal(actor, pair_id, chosen_instance, idem_key)` — creator-facing chooser; advisory-locks the pair (order-independent via `match_pair_lock_key`).
- `match_cancel_lock(actor, lock, reason, idem_key)` — benign reasons (`schedule_conflict`, `venue_issue`, `changed_mind`, `account_closed`) → safe auto-roll; safety/misconduct → freeze the canceller (`profiles.standing` update + `admin_alerts` insert atomically). Pre-lock variant (MD10) supported when creator cancels their own date before any offer is locked.

**Emits notifications:** `offer_passed`, `offer_expired`, `standby_promoted`, `offer_withdrawn`, `lock_cancelled_frozen`, `lock_cancelled_rolled`.
**Enqueues jobs:** `standby_roll`, `reconfirm_timeout`, `bulk_withdraw`, `rating_window` (audit A2 — enqueued from `match_accept_offer`'s lock-creation path with `run_after = lock.time_range_end`; fires the rating notification post-date).
**Depends on:** A (calls A's `_match_make_offer` service helper for auto-roll).

### C — Backend extras + edge transport
**Goal:** Ship the deferred extras, the public Edge Function transport, the feature flag, the admin tooling, and the centralized grants.

**Deliverables:**
- `match_demand_hint(instance) → text` — **stubbed**: returns one of `'quiet'`, `'warming_up'`, `'filling_up'`, `'almost_full'` based on count of right-swipes on the instance in the last hour. No presence dependency. Real presence-backed hint lands when presence infra ships (post-5b).
- **8 Deno Edge Functions** (audit A1) — one per public RPC: `match-shortlist`, `match-make-offer`, `match-accept-offer`, `match-pass-offer`, `match-withdraw`, `match-cancel-lock`, `match-resolve-reciprocal`, `match-demand-hint`. NOT exposed: `match-reveal-allowed` (RLS handles), `match-expire-offer`/`match-auto-roll`/`match-next-standby` (job-runner internal).
- **Shared Edge Function library** in `supabase/functions/_shared/` — JWT verify helper, errcode-to-HTTP mapper, **idempotency-key generator** (UUID v4 + 5-minute in-memory cache against client retries), structured logging.
- `feature_config.match_v2_enabled` row (default `false`) + migration `_p5_feature_flag.sql`. Every C2 RPC checks `feature_enabled('match_v2')` at entry; raises `P5000 feature_disabled` when off. Flippable without code deploy.
- **Admin tooling** (SECURITY DEFINER, `revoke execute from public, authenticated`, grant to `service_role`): `admin_force_expire_offer(actor, offer)`, `admin_force_cancel_lock(actor, lock)` for op'ing stale-active rows when a job permanently fails.
- **Idempotency-ledger prune cron** (audit R8): deletes `transition_idempotency` rows older than 30 days where the action settled. Scheduled via S2's pg_cron pattern; owned here because admin tooling tier.
- Centralized grants migration (P5 band 126900): `grant execute … to authenticated, service_role` on the 8 public RPCs; `revoke execute … from public, authenticated; grant to service_role` on every internal helper.
- Regenerated TypeScript types via `supabase gen types typescript --local` after all 5b migrations apply.

**Depends on:** A, B (calls their RPCs).

### D — UI host surface
**Goal:** Ship every screen the host (date creator) sees in the matching loop.

**Deliverables:**
- `/dates/[instanceId]/interested` route — InterestedList showing right-swipers' Tier-3 neutral profile previews (revealed per `swipes_visible` RLS in S1). Drag-to-rank shortlist via `framer-motion` `Reorder.Group`; each drop fires `match_shortlist(rank=newIndex+1)`.
- Make-offer CTA on the rank=1 candidate; confirmation modal showing offer expiry preview.
- Withdraw + cancel-with-reason picker (uses `B.match_withdraw` for candidates the host wants off their queue pre-offer; uses `B.match_cancel_lock` for post-lock cancellation).
- Reciprocal-chooser screen — rendered when host's session has an unresolved `reciprocal_pending` flag; lets host pick which instance to keep. **Ships AFTER B lands** (depends partially on B).
- **Realtime subscription** scoped to user-id (NOT device-id, audit A9): subscribes to `queue_entries` table where `creator_id=auth.uid()` so InterestedList updates live as new right-swipes arrive.

**Depends on:** A (shortlist, make_offer); B (withdraw, cancel, reciprocal — partial); G (in-app notification updates).

### E — UI candidate surface
**Goal:** Ship every screen the candidate (offer recipient) sees.

**Deliverables:**
- `/offers/[offerId]` route — offer-received screen showing host's Tier-3 profile preview (post-disclosure), the date_instance details, expectations[], and a live expiry countdown (client-side timer + `offers.expires_at`).
- Accept / pass / withdraw buttons calling `A.match_accept_offer`, `B.match_pass_offer`, `B.match_withdraw`.
- Account-gate fallback: if RPC raises `P5002 account_gated`, render gate state with reason (verify / cooldown / suspended) + link to remediate.
- No Realtime subscription needed (countdown is client-side; accept/pass fires sync; expiry notifications come via G).

**Depends on:** A, B (RPC calls).

### F — UI locked + reveal + ratings
**Goal:** Ship every screen after a lock fires.

**Deliverables:**
- `/matches` route — list of active + completed locks for the user.
- `/matches/[lockId]` route — Tier-3 neutral reveal modal of the locked counterpart (per Barbiecore §1 Tier-3 tokens: warm cream surface, soft ink text, polaroid avatar, no vibePalette intrusion); shows `first_name, age, photos[], bio, city, expectations[]` from the matched date_instance.
- **Phase 7 placeholder section** (audit A10): `<section role="region" aria-label="messages">` containing Caprasimo headline "messages coming with phase 7" + Fredoka body "matched users will get chat here. for now, swap numbers off-platform if you want to coordinate." Honest about the 5b boundary.
- MatchConfirmation overlay — confetti animation triggered when this user's lock just fired (subscribed via Realtime on `locks` inserts where `lock_id IN (...participant locks...)`).
- `/matches/[lockId]/rate` route — post-date rating UI; reads `match_ratings` table; rendering enabled only after `rating_window` job has fired (visible via a `rating_visible_at` column derived from `date_instances.time_range`).
- **Realtime subscription** scoped to user-id: subscribes to `locks` inserts where viewer is a participant.

**Depends on:** A (reveal predicate + RLS), Z (thread record exists for the placeholder UI).

### G — Notification surfaces
**Goal:** Ship the in-app notification center + email transport.

**Deliverables:**
- In-app notification center component (bottom-tab badge, dropdown list, mark-read, archive).
- Toast on receive (sonner) using existing 5a token system.
- `/api/notifications` Next.js route handlers: GET (paginated), POST (mark-read).
- **Resend email transport** — Server-side sender for `offer_received`, `new_match`, `offer_expiring`, `lock_cancelled_frozen`. Template per notification_type; HTML + plaintext fallback.
- `notification_preferences` UI on `/account/notifications`: per-channel-per-type toggles + quiet-hours configuration.
- Respect `notification_preferences` + quiet-hours when dispatching (already in S2/C1 logic; G just wires it up).
- **First task before any coding** (audit R6): verify Resend sender domain `tryafter5.app` has DKIM + SPF + DMARC records configured.
- **Realtime subscription** scoped to user-id: subscribes to `notifications` inserts where `user_id=auth.uid()` so badge + toast update without polling.

**Depends on:** A, B (event sources); CODE work can parallel D, E, F, but E2E tests need B live.

### H — E2E test track + CI integration
**Goal:** Verify the full swipe → reveal flow works as a system; gate every PR.

**Deliverables:**
- `supabase/tests/_all_5b.sh` master runner: stack-up + Z (psql + races) → A (psql + races) → B (psql + races) → C (Deno + edge function tests) → (D, E, F, G Vitest in parallel) → H (Playwright E2E). Non-zero exit on any failure; `set -euo pipefail` discipline.
- **Playwright E2E test** following the 5a audit recipe: two browser contexts (host + candidate), authed PKCE flow, host posts a night → candidate swipes right → host shortlists + offers → candidate accepts → both see MatchConfirmation + reveal modal renders.
- `.github/workflows/5b-tests.yml` — GitHub Actions workflow running `_all_5b.sh` against a CI-spun Supabase stack on every PR to main. Skips on docs-only changes.
- Negative-path E2E tests: expired offer → candidate sees "expired" state; account-gated user → make_offer raises P5002; concurrent accept on same offer → second loser sees `time_conflict`.

**Depends on:** A through G (all behavior must exist to test E2E).

### Dependency graph

```
        Z ────► A ────┬──► B ──┐
                      ├──► C ──┤
                      ├──► D ──┼──► H  (E2E + CI; runs after all)
                      ├──► E ──┤
                      ├──► F ──┤
                      └──► G ──┘
```

- **Z first** (independent — S2 chat-core).
- **A second** (depends on Z).
- **B, C, D, E, F, G in parallel** once A's contracts are frozen — though D's reciprocal-chooser sub-screen ships after B, and G's E2E tests need B live.
- **H last** (depends on everything).

Rough scope estimate (for sequencing, not commitment): Z ≈ 1-2 weeks; A ≈ 2-3 weeks (race tests are the long pole); B ≈ 2 weeks; C ≈ 1-2 weeks; D, E, F ≈ 1-2 weeks each; G ≈ 1-2 weeks; H ≈ 1 week. With parallelism: ~8-12 calendar weeks end-to-end.

---

## Section 2 — State machines

### 2.1 — `queue_entries.status` (central lifecycle)

```
                       S5.record_swipe (direction=right)               D.UI calls
   (no row)  ────────────────────────────────────────────►  interested  ──────────────► shortlisted
                                                                            ▲│   [A.match_shortlist(rank)]
                                                                            ││
                                                              candidate     ││
                                                              [B.match_withdraw  → row deleted]
                                                                            ││
                                                                            │▼ rank-1 picked
                                                                            │  [A.match_make_offer]
                                                                            │
                                                                       offer_active ◄────┐
                                                                            │              │
                ┌───────────────────┬──────────────────────────┬────────────┤              │ B.match_auto_roll
                │                   │                          │            │              │ promotes next-rank
                │ E.UI calls        │ async job fires          │ candidate  │ E.UI accepts │ standby to offer
                │ [B.match_pass]    │ [B.match_expire_offer]   │ [B.match_  │ [A.match_    │ (deferred via
                ▼                   ▼                          │  withdraw] │  accept]     │  standby_roll job)
          offer_passed         offer_expired                   ▼            ▼              │
                │                   │                  (row deleted)     locked            │
                │ B.match_auto_roll │ B.match_auto_roll                     │              │
                └──►───────────────►┘                                       │              │
                          │                                                 │              │
                          ▼                                                 │              │
                     enqueues standby_roll job                              │              │
                          │                                                 │              │
                          ▼                                                 │              │
                     [_match_make_offer service variant on next-rank shortlisted]──────────┘
                                                                            │
                                                                            │ post-date
                                                                            │ [B enqueued rating_window;
                                                                            │  F renders rating UI]
                                                                            ▼
                                                                       (terminal)


  Side effect on `locked`: counterparties' queue_entries on overlapping date_instances
  flip from any state to `standby`, deferred via `standby_roll` jobs (off-market cascade).
  Cascade is asynchronous to prevent transaction storms.
```

`standby` is reached from two paths: (a) on initial shortlist if a higher-rank candidate is already offer_active, or (b) via off-market cascade from a lock on an overlapping instance. Standby ordering is `match_next_standby(instance) → uuid` (internal helper; lowest-rank shortlisted).

### 2.2 — `offers.status`

```
   (no row)  ──►  active  ─┬─►  accepted    (A.match_accept_offer  →  Z.promote_chat_thread_to_lock)
                           ├─►  passed      (B.match_pass_offer    →  Z.close_chat_thread)
                           └─►  expired     (B.match_expire_offer  →  Z.close_chat_thread)
                                            (fired by offer_expiry job)
```

Structural invariant: **one active offer per `date_instance_id`** (partial unique index `offers_one_active_per_instance` on `offers(date_instance_id) WHERE status='active'`). Concurrent offers fail loudly with `unique_violation`, translated to `P5003 offer_already_active`.

### 2.3 — `locks.status`

```
   (no row)  ──►  active  ─┬─►  cancelled   (B.match_cancel_lock + reason
                           │                  → auto-roll if benign / freeze if safety|misconduct)
                           └─►  completed   (post-date; lock_completion mechanism TBD in B's spec —
                                             likely time-based at time_range_end + grace window)
```

Structural invariant: **no participant double-booked across overlapping time windows**:
```sql
ALTER TABLE lock_participants ADD CONSTRAINT lock_participants_no_overlap
  EXCLUDE USING gist (user_id WITH =, time_range WITH &&) WHERE (active);
```
Kept in sync by `sync_lock_participants` trigger on `locks` insert/update. Exclusion violation → `P5004 time_conflict`.

### 2.4 — `chat_threads.state` (Z owns)

```
   (no row)  ──►  open  ──────►  promoted   (Z.promote_chat_thread_to_lock,
                                              called by A.match_accept_offer)
                   │
                   │  Phase 7 expansion: `open ──► ready ──► promoted`
                   │  introduces an explicit `ready` substate gated by rapport
                   │  (N messages exchanged + M minutes elapsed). Add a value
                   │  to the chat_thread_state enum via ALTER TYPE; A's call
                   │  site `Z.chat_lock_ready(thread)` is unchanged.
                   │
                   └───►  closed       (Z.close_chat_thread, called by B.pass/expire)
```

At 5b launch: `Z.chat_lock_ready(thread uuid) returns bool` returns `state='open'` (true). Phase 7 redefines internally without touching A's call.

### 2.5 — Cross-machine invariants

**Structurally enforced (DB raises on violation — A/B catch and translate):**

1. `offers_one_active_per_instance` partial unique index — single active offer per date.
2. `lock_participants_no_overlap` GiST exclusion — no participant double-booked.
3. `locks.date_instance_id UNIQUE` — exactly one lock per date.
4. `chat_threads.offer_id UNIQUE` — exactly one thread per offer (Z's 1:1 FK).
5. `transition_idempotency(actor, action, idempotency_key)` PK — replay attempts cached.
6. `queue_entries.status` and `locks.status` are RPC-only (C7 — no direct-write RLS).

**Transactionally enforced (A's & B's RPC bodies, inside `pg_advisory_xact_lock`):**

7. `auth.uid() = p_actor` — every public RPC re-checks (C10).
8. `feature_enabled('match_v2')` — every C2 RPC checks at entry (C-owned flag); raises `P5000 feature_disabled` when off.
9. `can_enter_lock_flow(candidate)` (in `match_make_offer`) and `can_enter_lock_flow(actor)` (in `match_accept_offer`).
10. `Z.chat_lock_ready(thread)` before lock creation (always true at 5b launch; Phase 7 makes meaningful).
11. **Cancel atomicity (B):** `match_cancel_lock(reason='safety')` atomically (a) marks lock cancelled, (b) updates `profiles.standing`, (c) inserts to `admin_alerts`, (d) enqueues `bulk_withdraw` job. All-or-nothing in one transaction.
12. **Reciprocal-pair atomicity (A):** `match_make_offer` detects reciprocal pair inside the advisory-locked transaction; if detected, the offer insert rolls back and `P5008 reciprocal_pending` is raised with the pair_id surfaced. No partial-state.
13. **`blocks` check (A — audit §5 item 6):** `match_make_offer` raises if `(actor, candidate)` or `(candidate, actor)` appears in `blocks`.
14. **`dating_enabled` check (A):** `match_make_offer` raises `P5002 account_gated` if `profiles.dating_enabled = false` for either party. Symmetric for `match_accept_offer`.

### 2.6 — `match_reveal_allowed(viewer uuid, instance uuid) → bool` derivation

```sql
-- Pseudocode; pinned by A's migration. Returns true iff:
viewer = (select creator_id from date_instances where id = instance)
OR
viewer IN (
  -- Anyone who has or had an offer relationship on this instance:
  select candidate_id from offers
    where date_instance_id = instance
      and status IN ('active','accepted')
)
OR
viewer IN (
  -- Either party of a lock on this instance:
  select user_id from lock_participants lp
    join locks l on l.id = lp.lock_id
    where l.date_instance_id = instance
      and l.status IN ('active','completed')
)
```

A's RLS policy `profiles_select_revealed` uses this predicate to gate `profiles` reads beyond the public preview (S1's existing blind-feed policy). F's reveal modal reads `profiles` directly; RLS does the gating. A's tests include explicit negative cases (un-revealed user cannot read `last_name`, `birthdate`, `phone`).

---

## Section 3 — Contract surface (what each sub-project exports + consumes)

| Sub-project | Exports (public) | Consumes (by reference) | Notif types emitted | Job types enqueued |
|---|---|---|---|---|
| **Z** chat-core | `open_chat_thread`, `chat_lock_ready`, `promote_chat_thread_to_lock`, `close_chat_thread`, `chat_threads` table (read-only RLS) | S1 schema (offers, locks IDs) | — | — |
| **A** happy path | `match_shortlist`, `match_make_offer→uuid`, `match_accept_offer→uuid`, `match_reveal_allowed→bool`, `profiles_select_revealed` RLS policy, `transition_idempotency` ledger, `match_instance_lock_key`/`match_pair_lock_key`, `match_ingest_interest` (called from S5 swipe path) | Z, S2 jobs+notify+config+gate, S5 swipes | `offer_received`, `new_match`, `reciprocal_detected` | `offer_expiry` |
| **B** resolution | `match_pass_offer`, `match_expire_offer`, `match_auto_roll`, `match_next_standby→uuid` (internal), `match_withdraw`, `match_resolve_reciprocal`, `match_cancel_lock` | A, S2 jobs+notify, A's `_match_*` service helpers | `offer_passed`, `offer_expired`, `standby_promoted`, `offer_withdrawn`, `lock_cancelled_frozen`, `lock_cancelled_rolled` | `standby_roll`, `reconfirm_timeout`, `bulk_withdraw`, `rating_window` |
| **C** extras+edge | `match_demand_hint→text` (swipe-count stub), **8 Deno Edge Functions**, shared `_shared/` library (JWT verify + errcode mapper + idem-key generator), `feature_config.match_v2_enabled` row + `_p5_feature_flag.sql`, `admin_force_expire_offer`, `admin_force_cancel_lock`, idempotency-ledger prune cron, centralized grants migration, regenerated TS types | A, B (all RPCs), S5 swipes (heuristic) | — | — |
| **D** UI host | `/dates/[id]/interested` (InterestedList), make-offer flow, withdraw, cancel-with-reason, reciprocal-chooser UI (ships after B); Realtime sub on `queue_entries` (user-id scope) | A + B Edge Functions, S5 swipes (post-disclosure profile read), G's in-app updates | — | — |
| **E** UI candidate | `/offers/[id]` (offer-received + countdown + accept/pass + withdraw), account-gate fallback render | A, B Edge Functions, `notifications` rows for offer_received | — | — |
| **F** UI locked+reveal | `/matches` list, `/matches/[lockId]` (Tier-3 reveal + Phase 7 placeholder), MatchConfirmation overlay, `/matches/[lockId]/rate`; Realtime sub on `locks` (user-id scope) | A.match_reveal_allowed (via RLS), S1 profiles (post-reveal), S1 match_ratings | — | — |
| **G** notif surfaces | In-app notif center + bottom-tab badge + toast, `/api/notifications` (read/mark-read), Resend email transport, `notification_preferences` UI; Realtime sub on `notifications` (user-id scope) | S2 notifications, S2 notification_preferences, Resend API | — | — |
| **H** E2E + CI | `_all_5b.sh` master runner, Playwright happy-path + negative-path E2E, `.github/workflows/5b-tests.yml` | A through G (all behavior) | — | — |

### New env vars (5b-introduced)

- `RESEND_API_KEY` — Resend transactional email
- `RESEND_FROM_ADDRESS` — sender (e.g. `noreply@tryafter5.app`)
- `FEATURE_MATCH_V2_ENABLED` — optional client-side hint (server reads `feature_config` table; this just lets the UI render a "matching launches soon" coming-soon state pre-rollout)

### Tier-3 reveal data shape (A↔F boundary)

- A's `match_reveal_allowed(viewer, instance) → bool` is purely a predicate.
- F's modal reads profile data via RLS. Once `match_reveal_allowed=true`, the `profiles_select_revealed` policy unlocks: `first_name, age (derived from birthdate), photos[], bio, city`. The matched date's `expectations[]` comes from `date_instances` (separate query).
- NOT revealed: `last_name, phone, email, raw birthdate, exact location coordinates`.
- Policy owned by A's migration band (cross-band header note explains why A touches S1's profiles policies).

### Edge Function naming convention (C owns)

`supabase/functions/match-shortlist/`, `match-make-offer/`, `match-accept-offer/`, `match-pass-offer/`, `match-withdraw/`, `match-cancel-lock/`, `match-resolve-reciprocal/`, `match-demand-hint/`. **Total 8.** Each is a thin transport: `index.ts` (JWT verify → call RPC → map errcode to HTTP) + `index.test.ts` (Deno tests against running local stack).

### Idempotent replay semantics (every C2 RPC accepting `idem_key`)

When the same `(actor, action, idem_key)` is replayed: the RPC returns the originally-computed result (same uuid) with HTTP 200, no observable side effects on the second call. The Edge Functions in C generate `idem_key` automatically (UUID v4 + 5-minute cache); UI never sees or sets it. NOT an error — explicitly documented behavior.

---

## Section 4 — Error handling + testing strategy

### 4.1 — Errcode surface (DB exception → HTTP → UI)

Each `match_*` RPC `RAISE EXCEPTION USING ERRCODE='P5xxx', MESSAGE=<code>` on contract violations. C's Edge Functions map errcodes to HTTP + a stable UI-facing string. UI never sees raw SQL errors.

| Errcode | Cause | HTTP | UI string | UI behavior |
|---|---|---|---|---|
| `P5000` | `feature_enabled('match_v2')=false` | 503 | `feature_disabled` | render "matching launches soon" coming-soon state |
| `P5001` | `auth.uid() != p_actor` | 401 | `auth_mismatch` | toast "sign in again"; redirect `/login` |
| `P5002` | `can_enter_lock_flow=false` OR `dating_enabled=false` OR blocked | 409 | `account_gated` | render gate state with reason (verify/cooldown/suspended/blocked) |
| `P5003` | `offers_one_active_per_instance` violated | 409 | `offer_already_active` | toast "someone's already in the offer slot"; refresh feed |
| `P5004` | GiST exclusion (double-book) | 409 | `time_conflict` | toast "you're already locked at that time"; refresh `/matches` |
| `P5005` | `chat_lock_ready=false` | 425 | `chat_not_ready` | banner "keep chatting first" (Phase 7 only; 5b never raises) |
| `P5007` | offer expired between fetch and accept | 410 | `offer_expired` | toast "that offer expired"; navigate `/feed` |
| `P5008` | reciprocal-pair detected, must resolve first | 409 | `reciprocal_pending` | redirect to D's reciprocal-chooser screen |
| `P5009` | both reciprocal instances cancelled | 409 | `reciprocal_stale` | toast + refresh |
| `unknown` | unhandled | 500 | `server_error` | fail-loud toast + admin_alerts insert |

Edge Function template (Deno) catches `PostgrestError`, maps via errcode lookup, returns `{ ok: false, code, message }` with the HTTP status.

### 4.2 — Job failure handling

`offer_expiry`, `standby_roll`, `reconfirm_timeout`, `bulk_withdraw`, `rating_window` jobs run via S2's job runner.

- **Transient (network/timeout):** S2 job runner retries with exponential backoff.
- **Permanent (bad payload, missing row):** S2 marks job `failed`, inserts to `admin_alerts`. Operator triages.
- **Stuck job (>15 min in `running`):** S2 stuck-job sweeper unsticks; admin_alerts row written.

**UI fallback for permanently-failed `offer_expiry`:** D/E/F treat `offers.expires_at < now() - interval '1 hour'` as visually-expired even if `status='active'`. Hides zombie offers in the UI; C's `admin_force_expire_offer` resolves the DB row.

### 4.3 — Testing strategy per sub-project

| Sub-project | Test surface | Tooling |
|---|---|---|
| **Z** chat-core | psql single-session (state transitions), psql two-session race (concurrent open/close on same offer), RLS denial tests | `supabase/tests/z_chat_*.sql`, `_fixtures.sql`, two-session helper from A |
| **A** happy path | psql per-RPC happy path + each errcode; two-session race (concurrent accepts on same offer); idempotency replay; negative RLS tests on `profiles_select_revealed` (real PII boundary) | `supabase/tests/a_*.sql` + `.sh` race scripts |
| **B** resolution | psql for pass/expire/withdraw/reciprocal/cancel; two-session race (expiry-vs-accept); cascade test (accept on X triggers async standby_roll on overlapping Y, NOT inline cascade); cancel atomicity test (safety reason atomically updates standing + admin_alerts) | `supabase/tests/b_*.sql` + `.sh` |
| **C** extras+edge | Deno tests per Edge Function (JWT verify, errcode mapping, idem_key generation, feature-flag-off rejection); demand_hint heuristic test against seeded swipes; admin_force_* permission tests (anon/auth user CANNOT call) | `supabase/functions/match-*/*.test.ts`, `supabase/tests/c_*.sql` |
| **D, E, F** UI | Vitest + RTL per-component happy path + error-state rendering + interaction (drag-rank in InterestedList, expiry countdown, reveal modal a11y via axe-core per 5a pattern, account-gate fallback render) | `apps/web/**/*.test.tsx` |
| **G** notifs | Vitest for notif-center component + toast; Resend integration test against test-mode key (no real sends); preferences round-trip test; Realtime subscription test | `apps/web/**/*.test.tsx`, `supabase/tests/g_notif_preferences.sql` |
| **H** E2E + CI | Playwright two-context happy path (host + candidate → swipe → shortlist → offer → accept → reveal); negative E2E (expired offer, account-gated user, concurrent accept); CI workflow validation | `apps/web/e2e/5b-*.spec.ts`, `.github/workflows/5b-tests.yml` |

### 4.4 — Run-all gate

H ships `supabase/tests/_all_5b.sh` with `set -euo pipefail`. Execution order:

```
1. supabase start (ensure stack up)
2. supabase db reset (clean slate; applies Z + A + B + C migrations)
3. psql Z tests (state transitions, races, RLS)
4. psql A tests (per-RPC + races + idempotency + RLS negative)
5. psql B tests (per-RPC + races + cancel atomicity)
6. Deno C tests (8 Edge Functions + admin tooling)
7. Vitest D + E + F + G in parallel (`pnpm -r --filter ./apps/web test`)
8. Playwright H E2E (happy path + negatives)
```

GitHub Actions workflow `.github/workflows/5b-tests.yml` runs the script against a CI-spun Supabase stack on every PR to main. Skips on docs-only changes (paths-filter).

---

## Section 5 — Risks + open seams

### 5.1 — Open seams to resolve in sub-project specs

| # | Seam | Owner spec |
|---|---|---|
| 1 | Exact `chat_threads` column shape (already sketched in §1 Z brief, but final form lives in Z spec) | Z |
| 2 | Atomic ordering of `match_reveal_allowed` function creation vs `profiles_select_revealed` RLS policy in A's band | A |
| 3 | `match_make_offer` MUST consult `blocks` (S1) — easy SQL `not exists` check, flagged for visibility | A |
| 4 | UX edge case: candidate in-lock receives a new offer (`can_enter_lock_flow=false` → A raises P5002; D visually mutes already-locked candidates in InterestedList) | A, D |
| 5 | Multi-device session sync — Realtime channel scope MUST be user-id (verify `subscribe()` calls in D/F/G) | D, F, G |
| 6 | `chat_lock_ready` Phase 7 redefinition path (forward-compat signature) | Z |
| 7 | Lock-completion definition (when does a lock move to `completed`? Time-based at `time_range_end + grace`, or both-rated, or manual confirm?) | B |
| 8 | Post-shortlist rank collision policy (if host calls `match_shortlist(rank=1)` twice with different candidates — second wins? Or first gets bumped to rank=2?) | A |
| 9 | `dating_enabled=false` gate enforcement in `match_make_offer` + `match_accept_offer` (explicit pre-check) | A |
| 10 | Profile-change-between-shortlist-and-accept (reveal modal reads live profile — accepted as correct behavior, but documented to avoid surprise) | F |
| 11 | Resend deliverability — `tryafter5.app` DKIM/SPF/DMARC verification BEFORE first send | G |
| 12 | Pre-flight prod schema check: `profiles.account_state` + `profiles.standing` columns exist before any 5b migration applies (folded into R1's runbook) | H runbook |
| 13 | Notification-type enum gap check: verify `lock_cancelled_rolled`, `standby_promoted`, `offer_withdrawn` are in S2's C1 `notification_type` enum; missing values are contract-amendments to S2 | A, B (pre-launch check) |

### 5.2 — Real risks

**R1 — Migration sequencing complexity on prod.** Z + A + B + C migrations are 10+ files spanning S2 band 124500 + P5 band 126xxx. Per memory `feedback_schema-data-integrity-rigor.md` + `schema-drift-prod-triggers.md`: never bulk-push; per-migration only with security-advisor review between each. **Mitigation:** H owns a `docs/superpowers/plans/5b-prod-migration-rollout.md` runbook that sequences every migration with verification steps + rollback SQL + the pre-flight column check (seam 12). Estimated 2-3 hours of careful prod time to land Z+A; B+C can land in tighter sequences. D-G are app-deploys via Vercel (no schema risk).

**R2 — Race-test infrastructure novelty.** P5's `p5_concurrency_lib.sh` (two-session psql) is described but not yet built. **Mitigation:** A's brainstorm includes building this harness as Task 0 before any RPC race tests. A's spec calls it out.

**R3 — Realtime fan-out at scale.** If a popular instance gets 50+ right-swipes in a minute, the host's D screen subscribes to 50 `queue_entries` inserts. Real but not 5b-critical at tester scale. **Mitigation:** D paginates InterestedList; subscription only listens to "new since last view." Defer optimization to D's brainstorm.

**R4 — Feature flag failure UX.** If `match_v2_enabled=false` and someone calls `match_make_offer`, they get `P5000 feature_disabled`. UI must handle gracefully (coming-soon banner). **Mitigation:** D/E/F specs include feature-disabled rendering as a required state; H's E2E tests include a flag-off scenario.

**R5 — `chat_lock_ready=true` permanence at 5b launch.** Until Phase 7 ships, every offer can be accepted immediately with no rapport gate. Product risk: ghosting rates higher than designed. **Mitigation:** Phase 7 committed as the immediate next sprint after 5b lands; the chat_thread state enum is forward-extensible without P5 RPC changes.

**R6 — Resend sender domain.** Without verified DKIM/SPF/DMARC for `tryafter5.app`, no emails go out (or land in spam). **Mitigation:** G's first task is domain verification, not coding. Test-send to self before first real send.

**R7 — Phase 7 chat handoff shape.** Phase 7 inherits Z's `chat_threads` table. If Phase 7 wants additional fields (`last_message_at`, `unread_count`), they get added via migration — but Z's table needs to NOT precommit shapes that conflict. **Mitigation:** Z's brainstorm reviews RECONCILED-MASTER-PLAN S7 shape requirements before locking the table.

**R8 — Idempotency ledger row growth.** `transition_idempotency` grows unboundedly. **Mitigation:** C owns a prune cron deleting rows older than 30 days where the action settled. Scheduled via S2's pg_cron pattern.

**R9 — Cancel-storm cascade.** Safety-reason cancel on a popular lock triggers auto-roll + notifications to 50+ standby + counterparty. Risk: job-runner backup + notification spam + dispatch_notification rate-limit. **Mitigation:** B uses `bulk_withdraw` job type (already in C1) to batch notifications instead of looping.

**R10 — Privacy on reveal-RLS failure.** If `profiles_select_revealed` has a bug, viewers could read un-revealed PII (`last_name`, `birthdate`, `phone`). Real privacy incident risk. **Mitigation:** A's tests include explicit negative RLS tests proving the un-revealed user CANNOT read each protected field. Tests fail loudly if any field leaks.

**R11 — Edge Function JWT bypass.** Per IC v2 C10, every RPC asserts `p_actor = auth.uid()`. If an Edge Function misconfigures JWT verify, attacker passes arbitrary `p_actor` and impersonates anyone. **Mitigation:** C's shared `_shared/` library enforces JWT verify in a single audited helper; A's RPC tests include "p_actor ≠ auth.uid() → raises P5001."

**R12 — Edge Function cold starts (deferred from §5.1).** Deno Edge Functions cold-start ~500ms-2s. First-offer-of-the-day may feel sluggish. **Mitigation:** Accept for MVP; revisit if tester feedback complains. No keep-warm cron in 5b scope.

### 5.3 — Out-of-scope reminders (explicitly NOT in 5b)

- **Chat messaging UI / message persistence / Realtime message channels** → Phase 7
- **Push notifications (FCM/APNs)** → Phase 7+
- **Real presence infrastructure (`presence_heartbeats` writer)** → future phase
- **Off-platform contact detection / chat moderation** → Phase 7+
- **Native mobile app (iOS/Android)** → not in current roadmap
- **Analytics relay to PostHog/Datadog (analytics_events outbox drain)** → Phase 11 / S12
- **Demand-hint with real presence backing** → future phase (5b stubs to swipe-count heuristic)

---

## Self-review check

- **Placeholder scan:** No TBD, no TODO. Lock-completion mechanism is flagged as a B-spec seam, not a placeholder.
- **Internal consistency:** Sub-project count = 9 throughout. Dependency graph matches Section 3 consumes column. Errcodes in §4.1 cross-checked against RPC list in §3. Notification types in §3 summed to 9 — verify against S2 enum at pre-launch (§5.1 seam 13).
- **Scope check:** This is an OVERVIEW spec, not an implementation spec. Each sub-project (Z, A-H) gets its own brainstorm → spec → plan cycle. Decomposition is explicit; no sub-project tries to do another's work.
- **Ambiguity check:** Chose verbatim P5 adoption with one MVP-marginal tighten (demand_hint). Chose strict 5b chat boundary (no messaging UI; Phase 7 lands next). Chose in-app + email notification surfaces (no push). All choices logged in the brainstorm trail.

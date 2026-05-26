# Consolidated Integration Audit — Dating Plans P0–P11

**Date:** 2026-05-25
**Inputs:** the 12 per-plan paranoid audits in this folder.
**Verdict:** **Do not execute or begin coding against the plan set as written.** The individual plans are well-engineered components (sound TDD, good concurrency, sensible product decisions — every auditor said so), but they were authored fully in parallel, blind to each other, and the **integration layer is systematically broken.** Each plan invented its own version of shared contracts that conflict at execution.

## Scores

| Plan | Score | Internals | Integration |
|---|---|---|---|
| P0 data-model | 3/10 | strong invariants | view/fixture/RLS bugs |
| P1 identity | 2.5/10 | good | no verification front door |
| P2 scheduler | 3/10 | runner well-built | seam wrong every dimension |
| P3 creation | 3.1/10 | good | feed/media broken |
| P4 browse | 5.5/10 | strong blind contract | UUID/feed/pagination |
| P5 matching | 6.5/10 | excellent | "integrates with nothing" |
| P6 chat | 3.5/10 | good | invoked by nothing |
| P7 safety | 5/10 | good math | ladder enforces nothing |
| P8 moderation | 4/10 | good RLS | enforcement wired to nothing |
| P9 lifecycle | 3.8/10 | good intent | P5 names false |
| P10 payments | 5/10 | right decision | taxonomy fractured |
| P11 polish | 4/10 | good in isolation | orphaned/duplicated |

## Root cause

Parallel authoring produced 12 good designs and **zero shared contracts**. Every cross-phase boundary was independently guessed, so they disagree on names, types, table shapes, enum values, and migration order.

---

## Integration defects (shared-surface conflicts) — must fix centrally

**I1. The async jobs / enqueue / notify interface.** P2 owns `jobs(job_type ENUM, run_after, dedup_key)` + `enqueue_job()` + `dispatch_notification()`. P5/P6/P7/P9 all call `enqueue(kind text, run_at, dedupe_key)` / `notify()` / `cancel_jobs()` — different names, arity, column names, and types. P2's frozen 6-value enum can't represent the ~dozen kinds consumers enqueue. Three incompatible `jobs` tables + two `job_status` enums collide at identical timestamps and hard-fail on `create type`. **Fix:** one canonical jobs/notify contract (table, enum covering all kinds, enqueue/cancel/notify signatures); P2 owns it; all consumers conform.

**I2. The P5 transition API.** Canonical names are `match_make_offer / match_accept_offer / match_cancel_lock / match_expire_offer / match_next_standby / match_auto_roll`. Callers use wrong names/args: P9 (`cancel_lock`/`expire_offer`/`withdraw_from_queue`), P6 (`confirm_lock` + chat hooks), P2 (`p5_promote_standby`/`p5_reap_pending`), P7 (`can_enter_lock_flow` never called). **Fix:** freeze P5's signatures as the API; rewrite callers; P5 must invoke P6's chat-open + P7's `can_enter_lock_flow` + check account state.

**I3. One account/standing state model.** Three exist: P7 `profiles.standing`, P8 `suspensions`/`account_active()`, P9 `account_status`. P5 checks none → bans/cooldowns/suspensions are all inert. **Fix:** one model (recommend P7's `standing` as the live gate); P5 accept/create checks it; P8 suspend and P9 pause/suspend write it; delete the duplicates.

**I4. `browse_feed`.** P0/P3/P4/P8 each `create or replace` it with divergent columns; Postgres forbids the reorder/drop → `db reset` fails; ordering drops P8's moderation filter (re-publishes removed UGC) and P4's `is_seed`; P0 selects a nonexistent `itineraries.vibe_tags`; the client reads P4's RPC which omits P3's sound fields. **Fix:** single owner, one final column set (incl. `vibe_tags`, sound, `is_seed`, moderation filter, `starts_at > now()`), layered additively with correct timestamps; the viewer RPC returns every surfaced field.

**I5. The `reports` table + taxonomy.** Edited by P0/P7/P8/P10. P8's status enum rewrite drops `'actioned'`/`'reviewing'` that P7 reads/writes at runtime → breaks the enforcement ladder and throws on SOS inserts. P10's `payment_dispute` is invisible to P8 triage. P3's `media_assets` UGC queue is orphaned (P8 moderates an invented column). **Fix:** one reports schema + status lifecycle + reason taxonomy; `file_report()` threads `reason_category`; P8 triage reads the real queues (reports + media_assets) and branches on category.

**I6. Migration timestamp collisions.** P1/P2/P5/P7/P8/P9 all crowd the `2026052513xxxx` band; P3 sorts after P4 for `browse_feed`. **Fix:** a single allocated timestamp map across all phases (e.g., P1=1301xx, P2=1302xx, … P11=1311xx), respecting dependency order.

**I7. Device-token registration is missing everywhere.** No phase registers an Expo/web push token, so `devices` is always empty → every notification (including **safety check-ins**) falls to an unwired email stub. The safety guarantee is silently false at launch. **Fix:** add device registration (P1 onboarding + native), and make safety notifications fail loud, not silent.

**I8. Chat model contradiction.** P5 chose a stateless `match_reveal_allowed`; P6 built stateful threads + a min-rapport gate P5 never calls. **Fix:** pick one (recommend P6's threads, since reveal + retention + reporting need state); P5 calls `open_chat_thread` at offer and `chat_lock_ready` before lock.

**I9. FK cascade vs legal-hold.** `chat_messages.sender_id` / `chat_threads.*` are `on delete cascade`, but P9 legal-hold needs envelopes/threads to survive a profile delete; P7 writes `chat_threads.revoked_at` which P6 doesn't define. **Fix:** tombstone (not cascade) on held entities; add `revoked_at`.

**I10. Auth pattern (privilege escalation).** P5 and P8 RPCs authorize a passed `p_actor` and don't `revoke execute from authenticated`, exposing internal helpers and admin actions. **Fix:** all SECURITY DEFINER RPCs authorize `auth.uid()`, internal helpers `revoke execute from public/authenticated`.

**I11. Shared test fixtures.** Across P0/P5/P7 (and others) psql fixtures insert into `profiles`/`itineraries` without seeding `auth.users` and violate `itineraries` NOT-NULL — so the invariant tests **never run**. **Fix:** one `supabase/tests/_fixtures.sql` (`mk_user()` seeds `auth.users`+`profiles`; `mk_itinerary()` satisfies NOT-NULLs); all tests use it.

**I12. vitest harness.** Bootstrapped 5× (P1/P3/P6/P10/P11) with conflicting config. **Fix:** P1 owns the single root workspace config; others assume it.

**I13. Analytics drain + demand-hint duplication.** P11's `analytics_events` outbox has no P2 job type/handler (never drains); P11's `demand_hint` duplicates P5's `match_demand_hint` with different buckets; the "tunable offer window" is decorative (P5 hardcodes 24h). **Fix:** add the relay job to the I1 enum; P5 emits all transitions to the outbox and reads `feature_config` for the window; delete P11's duplicate demand hint.

## Intra-plan critical bugs (fix in place)

- **P0:** add `vibe_tags` to `itineraries`/`date_instances`; fix fixtures (I11); restrict `queue_entries`/`locks` lifecycle columns to RPC-only (creator can currently forge `status='locked'`).
- **P1:** add the verification *front door* (start a Persona inquiry + write the `phone` row) or no one ever verifies; use Persona's parsed DOB for the age gate; advance `onboarding_step`; generate the blurred photo; drop `first_name` from the public card; drop P1's `offer_reveal` in favor of P5's `match_reveal_allowed`.
- **P3:** real media serving (signed-URL minting) + real transcode + an invoker for `process-media`; anonymous-draft claim step.
- **P4:** fix the invalid concierge UUID (blocks `db reset`); real pagination + `starts_at > now()` filter; define seed-night handling across P4→P5.
- **P7:** geofence dispute must recompute reliability (today a serial no-show defeats every claim at zero cost); wire the P7↔P8 dispute loop both ways.
- **P9:** delete `auth.users` (not just `profiles`) + re-signup defense; reconcile to the I3 state model.
- **P10:** render the non-binding disclaimer on all pay surfaces; fix P4's contradictory pay labels.

---

## Reconciliation strategy (recommended)

1. **Write a single `INTEGRATION-CONTRACT.md`** that freezes I1–I13 (the jobs/notify API, the P5 transition API, the one account-state model, the final `browse_feed`, the `reports` schema/taxonomy, the migration-timestamp map, device registration, the chat model, the auth pattern, the shared fixtures, the vitest owner, the analytics relay). This is the source of truth; where any phase plan conflicts, the contract wins.
2. **Rewrite the conforming tasks** in each phase plan to the contract (or append a "reconciliation task set" per plan).
3. **Fix the intra-plan critical bugs** in place.
4. **Re-run a lighter integration check** (or targeted re-audit of P2/P5 which carry the most seams) before execution.

This is a real integration pass, not a quick stitch — the conflicts are structural (incompatible tables/enums), not just renames. The contract is the highest-leverage step; it resolves every shared-surface defect in one place and unblocks the rest.

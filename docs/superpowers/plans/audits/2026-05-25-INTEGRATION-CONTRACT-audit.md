# Integration Contract — Paranoid Pre-Build Audit

**Subject:** `docs/superpowers/plans/2026-05-25-INTEGRATION-CONTRACT.md`
**Auditor stance:** 3am-pager engineer. The contract is the single source of truth 12 plans reconcile to. Every hole here is inherited 12×.
**Verdict up front:** The contract is a genuine, high-leverage step and is *directionally* correct on all 13 defects. But it is a **one-page freeze that leaves ~8 referenced objects unowned, ships at least 3 statements that will not compile/apply as written, and introduces 2–3 new contradictions** (notably the C4 feed filter dropping P9's account-state exclusion, and C6's own admitted P4-vs-P8 ordering fudge). It is **not yet safe to reconcile against without the additions below.**

---

# CRITICAL MISSING SYSTEMS

These are referenced by the contract or by a consumer the contract blesses, but **no phase nor the contract owns the actual DDL/handler.** Each is an orphan that will surface as a "does not exist" at `db reset` or a silent no-op at runtime.

1. **`feature_config` table — UNOWNED in the contract.** C2 (`offer_expires_at()` reads offer-window from `feature_config`), C10 ("`feature_config` row is the source of truth"), and the P5 reconciliation line all *consume* it, but **no C-section creates it and no owner is named.** Grep shows it exists only in P11's plan (`20260525130100_p11_feature_config.sql`). So P5's `match_make_offer` (P5 band 126xxx) calls `offer_expires_at()` which reads `feature_config` — a table created in **P11's band (132xxx), six bands later.** On a clean `db reset`, P5's migration and tests run before the table exists. The contract must (a) name P11 (or better, P0) as owner, (b) move it to an **early** band, and (c) seed a default offer-window row, or every P5 offer test fails. **This is the single most load-bearing orphan.**

2. **`offer_expires_at()` / DST function — UNOWNED.** C2 says `match_make_offer` "sets `expires_at` from `feature_config` offer-window via `offer_expires_at()`" and C10 says it is "DST-safe." **No section defines its signature, owner, or band.** P11's plan has `addOfferWindow`/`formatInZone` *TS* utilities and a `feature_config` table, but there is no SQL `offer_expires_at()` function anywhere. P5 must call it from inside a SECURITY DEFINER SQL function — a TS util is unreachable there. Contract must specify: signature (`offer_expires_at(p_now timestamptz, p_city uuid) returns timestamptz`?), that it resolves against `cities.timezone`, its owner, and a band **before P5's**.

3. **`analytics_events` schema + retention — owner implied (P11) but schema NOT frozen, retention UNSPECIFIED.** C1 names the `analytics_relay` *job* and says "P11 ships the handler"; C8/the spec require "every transition." But the contract never freezes the `analytics_events` **columns** (P11 uses `event/entity/entity_id/distinct_id/props/forwarded_at`) nor a **retention/purge policy.** An append-only outbox with no purge job grows unbounded; there is no `analytics_purge` job kind in C1's `job_type` enum. Also: C2 says "every transition emits its analytics event," but the actual write mechanism is P11's `enqueue_analytics_event()` *trigger* on `offers/locks/queue_entries` — meaning P5 does **not** emit; the trigger does. The contract conflates "P5 emits" (reconciliation P5 line: "emit analytics") with "P11's trigger captures." Pick one path or you get **double-counted events** (P5 RPC inserts + P11 trigger fires on the same status change).

4. **`disputes` table — split-brain ownership.** C5 says "P7 writes a `disputes` row on a contested no-show; P8 resolution calls back." But **only P8 creates a `disputes` table** (`20260525130400_p8_disputes.sql`); P7's plan does *not* create it and instead opens a `reports` row with `reason='disputed_no_show'`. The contract asserts a bidirectional loop over a table P7 cannot write to (P8's band 129xxx lands after P7's 128xxx, so the table exists by then — OK on ordering — but P7's plan as written never inserts into `disputes`, it inserts into `reports`). The contract must freeze the `disputes` schema, name P8 as owner, and explicitly rewrite P7's `adjudicate_no_show` to write `disputes`, not a free-text `reports.reason`.

5. **`moderation_status` column — ownership/placement contradiction.** C4 says the feed filters `moderation_status='approved'` and lists it as a base-table column added by P8. C6 says place the feed at `129900` "after P8's `moderation_status`." But P8's plan puts `moderation_status` on **`itineraries`**, not `date_instances`, and the C4 projection is built from `date_instances` joined to `itineraries`. The contract never states **which table** carries `moderation_status`. If a reconciler adds it to `date_instances` (plausible from C4's "base tables" wording) while P8's RPC `set_ugc_moderation` updates `itineraries`, the feed filter reads a column the moderation RPC never writes → **removed UGC re-surfaces.** Freeze the table explicitly.

6. **Consent / quiet-hours / notification-preferences tables — UNOWNED.** C1's `dispatch_notification` order is "consent → quiet-hours → rate-limit → channel." **No section creates a consent table, a quiet-hours table, or `notification_preferences`.** P2's plan has `20260525130300_p2_notification_preferences.sql`, but the contract neither names it nor freezes its shape, and the C1 spec implies fields (per-type consent, quiet-hours window, timezone) that P2's plan may not match. Without freezing this, `dispatch_notification` reads columns that may not exist → every non-safety notification throws or silently passes. Name P2 as owner and freeze the columns the dispatch order reads.

7. **Web-push VAPID key management — UNOWNED.** C1 stores `devices.web_push_sub jsonb` and the channel order is "push→web→email." Web Push requires **VAPID keypair + subscription endpoint signing**; nothing owns key storage, key rotation, or the `web-push` send path config. P2's plan mentions VAPID as "best-effort fallback" but the contract freezes the *column* without freezing *how* a web push is actually sent or where the VAPID secret lives (env? secret manager?). At minimum flag this as out-of-scope-but-required so it isn't silently assumed working.

8. **The `notify` job kind's payload contract — UNDEFINED.** C1's enum includes `'notify'` as a job type, and `dispatch_notification` is a function. But nothing says how the *generic* `notify` job's payload maps to `dispatch_notification(p_user, p_type, p_payload)`. A consumer enqueuing `enqueue_job('notify', …)` has no frozen payload schema, so the runner's `notify` handler is undefined. Freeze the payload shape (`{user, type, payload}`).

---

# DEAD UI / FAKE INTERACTIONS

The contract is backend-only, so "dead UI" maps to **interfaces the contract blesses that have no real wiring**:

1. **Safety notifications still route to nothing if `devices` is empty — the contract's "fail loud" is half-specified.** C1 says safety types "MUST fail loud (log + enqueue `moderation_action`/admin alert)." But `moderation_action` is a **notification_type**, not a `job_type` — you cannot `enqueue_job('moderation_action', …)` (it's not in the `job_type` enum). And "admin alert" has no channel: there is no admin-device registry, no admin email list wired into `dispatch_notification`, and `moderation_action` notifications would themselves need a device row. The escalation path the contract promises **terminates in another empty channel.** This is the I7 defect re-incarnated one layer up: the loud failure is itself silent.

2. **Demand hint: contract says P11 "deletes its duplicate," but the two implementations have different bucket semantics.** C2 freezes `match_demand_hint(p_instance) returns text` as "the only demand hint." P11's `presence_demand_hint` is a **view** backed by Supabase Realtime presence (currently-online weighting). P5's `match_demand_hint` is a live 3-table count. The contract picks P5's, but the spec (§7.2) requires "counts weight only **trusted, currently-available** users" — which is the *presence* logic P11 had and P5's count does **not** implement. Deleting P11's version **drops the availability weighting the spec mandates.** The UI shows an honest-looking bucket that is actually just a raw shortlist count → fake social proof, the exact thing §7.2 says to avoid.

---

# MISSING EDGE CASES

1. **Paused user with an active lock vs. the C3 gate (the prompt's flagged gap — confirmed real).** C3's `can_enter_lock_flow` requires `account_state='active'`. P9's plan is explicit: "A paused user with an **active lock keeps that lock**." But C3 only gates **entering** the flow; it says nothing about **acting on an existing lock** while paused — day-of reconfirm, safety check-in, cancellation, rating. If P2's `day_of_reconfirm`/`safety_checkin` jobs or P7's rating RPCs silently check `account_state='active'`, a paused user's confirmed real-world date loses its safety check-in. The contract must state that **lock-servicing actions (reconfirm, check-in, cancel, rate) are exempt from the `account_state` gate** for an already-active lock. Today this is undefined → either over-blocks (strands a safe date) or under-blocks.

2. **`deletion_pending` is missing from the `can_enter_lock_flow` reasoning.** C3 lists `account_lifecycle` values `active,paused,deletion_pending,deleted`. The gate is `account_state='active'` so `deletion_pending` correctly cannot enter new flows. But P9 treats `deletion_pending` "like paused" — same active-lock-survival question (above) applies, **plus** the grace-window: if a user requests deletion while holding a lock, then the worker fires, the other party must be freed via `match_cancel_lock(account_closed)`. The contract's reconciliation P9 line lists this, but C3 never states the **interaction**: can a `deletion_pending` user still rate/check-in during the grace window? Undefined.

3. **`suspended` standing vs. `paused` account_state — both gate, but the user-facing reason differs and the contract never says which wins.** A user can be `standing='suspended'` AND `account_state='paused'` simultaneously (two orthogonal fields, by C3's design). When they try to resume (P9 `resume_account` flips `account_state→active`), they're still `standing='suspended'` → still gated by `can_enter_lock_flow`. Correct behavior, but P9's `resume_account` UX ("Resume is one tap, no data loss") will silently fail to restore function. The contract created the orthogonality but **never specified the precedence/messaging**, so the user resumes into a still-broken account with no explanation. This is a real "clean split creates a gap" the prompt anticipated.

4. **Reciprocal-pair chooser is entirely absent from the frozen API.** Spec §7.5 mandates the reciprocal-pair chooser; P5's plan implements `match_resolve_reciprocal`. The contract's C2 table **omits it entirely.** A spec-mandated transition is not in the "only names callers may use" list → either it's unfrozen (drift returns) or a reconciler deletes it as non-conforming. Add it to C2.

5. **Seed-night handling (`is_seed`) crosses P4→P5 but no transition is frozen.** C4 surfaces `is_seed` in the feed; the consolidated audit flagged "define seed-night handling across P4→P5." The contract carries `is_seed` into the projection but **freezes no rule** for what happens when someone swipes/offers on a seed (concierge/system-owned) night — can a seed night enter the lock flow? Who is the "creator" for `can_enter_lock_flow`? The invalid concierge UUID bug (P4) means the seed creator may not be a real `auth.users`/`profiles` row, so `can_enter_lock_flow(seed_creator)` may throw. Undefined.

6. **Re-signup after deletion / `auth.users` deletion.** Reconciliation P9 line mentions "delete `auth.users` + re-signup defense," but the contract never freezes **how a deleted user's accountability skeleton survives an `auth.users` delete** given P0's FKs. `verifications.user_id`, `devices.user_id`, `swipes.swiper_id` etc. cascade from `profiles`, but `profiles.id` references `auth.users` only in some paths. The tombstone strategy (C9 covers chat) is not generalized to `reports`/`match_ratings`/`audit_log` subject rows. If `auth.users` is deleted and `profiles` is cascade-deleted, the accountability rows P9 wants to keep vanish. The contract gestures at this in C9 (chat only) but doesn't own the general deletion-FK matrix.

---

# STATE & DATA FLOW PROBLEMS

1. **C6 timestamp map is internally inconsistent and self-admittedly fudged.** The band table assigns P4=`125xxx`. The prose then says the feed view "actually moves to a P8-or-later band: place the final `browse_feed` migration at `129900`, owned by P4's spec but timestamped after P8's." So the **single most-contested object (browse_feed) is owned by P4 but lives in a number outside P4's band**, inside the gap between P8 (129xxx) and P9 (130xxx). This is workable but fragile: (a) it violates the contract's own "each phase owns a 100-slot band" rule; (b) `129900` is inside P8's `129000–1299xx` band, so it's actually a **P8-band slot owned by P4** — a cross-phase ownership the migration tooling and reconcilers will fight over; (c) P9 *also* needs to alter the feed for account-state (see below), and P9 is `130xxx`, *after* `129900`, so P9 cannot be a no-op — yet C4 says "No other phase may `create or replace` it." **Contradiction:** C4 forbids P9 from touching the view, but P9's required account-state filter can only be applied by editing the view, and it must sort after the canonical definition. Either the canonical view must include the account-state filter (it doesn't — see DEAD UI / next item) or P9 must be allowed to re-replace it. The contract resolves neither.

2. **C4's frozen feed projection DROPS the account-state exclusion P9 requires.** C4's filter is exactly `status='seeking' AND starts_at > now() AND moderation_status='approved'`. **There is no `creator.account_state='active'` clause.** P9's plan explicitly rebuilds the view to add `cr.account_status='active'` so paused/suspended/deleting creators' nights leave the feed. Because C4 forbids other phases from touching the view and omits this filter, **a paused or suspended creator's nights remain browsable** — a privacy + safety regression (a suspended creator keeps receiving swipes). This is a NEW contradiction the contract introduced by freezing an incomplete projection. The canonical `browse_feed` MUST join `profiles` and filter on the C3 `account_state` (and arguably `standing NOT IN (...)`).

3. **`devices` primary key won't compile as written.** C1: `primary key (user_id, coalesce(expo_push_token, ''))`. **Postgres does not allow an expression in a `PRIMARY KEY` (or any table constraint) column list** — only plain column names. This will raise `syntax error at or near "("`. You need either a generated column (`token_key text generated always as (coalesce(expo_push_token,'')) stored` then PK on `(user_id, token_key)`) or a unique index on the expression plus a surrogate PK. As frozen, **C1 does not apply.** (P2's own plan uses a different, working `unique(user_id, token)` shape — so the contract is *less* buildable than the plan it's freezing.)

4. **Two `job_status` enums still collide across plans, and the contract's reconciliation doesn't catch P9's.** C1 freezes `job_status as enum ('pending','running','done','failed','cancelled')`. P9's plan independently does `create type job_status as enum ('queued','running','done','failed')` at `20260525130000`. The contract's P9 reconciliation line says "C1 job names" but does **not** explicitly tell P9 to delete its `create type job_status`. If a reconciler reads the line narrowly, the duplicate `create type job_status` survives → `db reset` hard-fails on the second `create type`. Make the reconciliation line explicit: "delete P9's `jobs`/`job_status`/`enqueue` re-definitions entirely."

5. **`jobs` table loses the typed FK columns consumers rely on.** C1's frozen `jobs` table has only `payload jsonb`. P2's actual table has typed FK columns (`date_instance_id`, `offer_id`, `lock_id`, `queue_entry_id`) **with `on delete cascade`** — which is how a job auto-cancels when its target is deleted (e.g., delete a lock → its `safety_checkin` job cascades away). C1's `payload`-only design **loses cascade cleanup**: a `safety_checkin` job whose lock is cancelled/deleted now has its target id buried in JSONB with no FK, so it fires against a dead lock. The contract traded P2's safer schema for a thinner one without addressing orphan-job cleanup. Either restore typed FK columns or freeze an explicit "runner must re-validate target exists and no-op if gone" rule (P5 does this for `offer_expiry`, but not all kinds).

6. **`cancel_jobs(p_type, p_dedup_key)` arity vs. P5's actual `cancel_jobs(p_kind text, p_dedupe_key text)`.** Contract freezes enum-typed `p_type job_type`. P5 calls `cancel_jobs('offer_expiry', 'offer_expiry:'||offer_id)` — a **text literal** which Postgres will implicitly cast to `job_type`, so this happens to work. But P5's *shim* defines `cancel_jobs(p_kind text, …)` with a **text** first param. When P2's real enum-typed version lands at a different band, there will be **two overloaded `cancel_jobs`** (text and enum signatures) unless the shim is dropped. Contract's P5 reconciliation says "remove `p5_*` stubs" but the shim is named `p5_p2_shim` and defines `enqueue`/`cancel_jobs`/`notify` under **non-prefixed** names — the cleanup instruction may miss them. Be explicit: drop the shim's `enqueue`/`cancel_jobs`/`notify`/`jobs`.

7. **`enqueue_job` signature mismatch will silently fork.** Contract: `enqueue_job(p_type, p_run_after, p_payload default '{}', p_dedup_key default null)` (4 args). P2 plan: `enqueue_job(p_job_type, p_run_after, p_date_instance_id, p_offer_id, p_lock_id, p_queue_entry_id, p_payload, p_dedup_key)` (8 args). P5 shim: `enqueue(kind, run_at, payload, dedupe_key)`. These are **three different functions.** A reconciler must rewrite every call site; the contract should include a one-line "every enqueue call site passes only `(type, run_after, payload, dedup_key)`; target ids go in `payload`." Without that explicit instruction the 8-arg P2 version and 4-arg contract version coexist as overloads and consumers bind to the wrong one.

---

# BACKEND/API GAPS

1. **`reports` schema is described in a SQL comment, not frozen DDL — and the `disputed`/`reviewing` story is incomplete.** C5 gives the `reports` columns as a `-- comment`, not a `create table`. It lists `resolution_code` but P8's plan uses `report_resolution` (a separate enum) and a `status_v2` migration column. The contract freezes the **enum** (`open/reviewing/actioned/dismissed`) but P8's plan freezes a *different* 6-value enum (`open/triaged/investigating/escalated/resolved/dismissed`). The contract says "keep `actioned` and `reviewing`" — but P8's plan **actively renames them** (`reviewing→investigating`, `actioned→resolved+resolution='actioned'`). The contract NAMES the resolution but does not give P8 a concrete migration to write; a reconciler faces a hard choice between the contract's 4-value enum and P8's richer 6-value lifecycle. **This is the I5 defect only half-resolved:** the contract picked the simpler enum P7 needs, but didn't reconcile P8's richer state machine into it (where do `triaged`/`investigating`/`escalated` go? are they dropped, losing P8's triage workflow?). Freeze the actual `create table reports` and the actual enum, and state explicitly what happens to P8's intermediate states.

2. **`file_report` signature vs. P7's reality.** C5: `file_report(p_actor, p_target_type text, p_target_id uuid, p_reason_category report_reason_category, p_detail text, p_pay_setting_snapshot jsonb)`. P7's `adjudicate_no_show` inserts directly into `reports` with `reason='disputed_no_show'` (free text), **not** via `file_report` and **not** with a `reason_category`. `'no_show_dispute'` is in the C5 `report_reason_category` enum, so the mapping exists — but P7's plan doesn't call `file_report` and doesn't use the enum. The contract's reconciliation P7 line ("bidirectional dispute loop") doesn't say "route disputed-no-show through `file_report` with `reason_category='no_show_dispute'`." Gap: P7 will keep writing free-text `reason` into a table whose canonical writer expects the enum, and the `reports.reason` (text) vs `reason_category` (enum) column duality is never resolved — **does `reports` have both a `reason text` (P0/P7) and a `reason_category` enum (C5)?** The contract's comment lists only `reason_category`, implying P0's `reason text NOT NULL` column is dropped, which would break P7's existing inserts.

3. **`match_make_offer` does too much for one frozen transaction — `open_chat_thread` + `can_enter_lock_flow` + `enqueue_job` + `offer_expires_at` all inline.** C2 says `match_make_offer` "calls `open_chat_thread(offer_id)`" — but `open_chat_thread(p_offer uuid)` (C9) takes an offer id that **doesn't exist until `match_make_offer` has inserted the offer.** The ordering inside the function is critical and unspecified: insert offer → get id → open thread → enqueue expiry → return. If `open_chat_thread` is `SECURITY DEFINER` and P6's band (127xxx) is **after** P5's (126xxx), then at `db reset` P5's migration references a function that doesn't yet exist. plpgsql late-binds bodies so it compiles, but **P5's tests run before P6 lands** → `match_make_offer` test calls a missing `open_chat_thread` → fail. The contract's band order (P5 before P6) **breaks P5's own test suite.** Either P6's chat-hook stubs must land in an earlier band, or P5 must tolerate a missing thread function.

4. **`chat_lock_ready` gate has no defined "mutual override."** C2 `match_accept_offer` "requires `chat_lock_ready(thread)` true (**or mutual override**)." The "mutual override" mechanism is never defined — what records mutual consent to skip the rapport gate? No column, no RPC. This is a dangling clause that a reconciler cannot implement.

5. **`admin_has_role()` is referenced (C10) but its signature/owner is only in P8.** C10 says "admin RPCs check `admin_has_role()`." P8 owns it as `admin_has_role(p_user uuid, p_role admin_role)`. Fine — but C1's safety-failure path enqueues an "admin alert" with no admin-notification mechanism, and the contract never freezes `admin_role` (it's a P8 enum). Any non-P8 admin RPC (e.g., a P9 forced-deletion admin action) calling `admin_has_role` depends on P8's band (129xxx) landing first; P9 is 130xxx so OK, but P5/P7 admin paths (if any) predate it. Flag the dependency.

6. **No frozen `standing_state` / `account_lifecycle` enum DDL.** C3 names the **values** of `standing_state` and `account_lifecycle` in prose but provides **no `create type`**. P7 owns `standing` (enum values match), P9 owns `account_state` but P9's plan calls its enum `account_status` with values `active,paused,suspended,deletion_pending,deleted` — note **P9 still has `suspended` in the lifecycle enum**, which C3 explicitly forbids (suspended belongs to `standing`, not lifecycle). The contract says "P9: `account_state` field (not a 3rd suspended)" but P9's actual enum literally includes `suspended`. The contract must freeze the exact `create type account_lifecycle as enum ('active','paused','deletion_pending','deleted')` (no `suspended`) and `create type standing_state as enum (...)`, and rename P9's `account_status`→`account_state` / drop `suspended`. As-is, **two enums (`standing_state` value `suspended` and `account_lifecycle` value `suspended`) both contain `suspended`** if P9 isn't fully rewritten → the orthogonality C3 promises collapses.

---

# UX CONTRADICTIONS

1. **"Reveal only to active offer-holder" vs. the feed's `venue_neighborhood` + coarse time.** Not contract-introduced, but the contract's C4 projection surfaces `venue_neighborhood` + hour-truncated time + `vibe_tags` + `why_note` + `sound_title`. Combined with a small market (Kelowna), these quasi-identifiers can deanonymize a creator (the spec's own stalking-vector concern). The contract froze the projection without a k-anonymity / min-pool guard. Not a blocker, but the "blind" guarantee is weaker than the spec implies and nobody owns the guard.

2. **Demand hint honesty regression (see DEAD UI #2):** picking P5's count over P11's presence-weighted view contradicts spec §7.2's "weight only trusted, currently-available users."

3. **Paused-resume silent failure (see MISSING EDGE CASES #3):** "one tap resume, no data loss" UX promise contradicts the still-`suspended` standing gate.

---

# WHAT ENGINEERS WILL REGRET LATER

1. **`feature_config` as an unowned, late-band table** will be discovered at the first `db reset` after P5 lands and will block P5 entirely. This is the #1 regret-in-waiting.
2. **The `129900`-owned-by-P4 cross-band migration** will confuse every future migration author and break the "each phase owns a band" mental model the contract sells. The first person to add a P8 migration at `1299xx` risks sorting after the feed view and silently shadowing it.
3. **No analytics retention** → the `analytics_events` outbox becomes the largest table in the DB within months; adding a purge job later requires a new `job_type` enum value (an `ALTER TYPE ... ADD VALUE` that cannot run in a transaction with other DDL in some PG versions) — painful to retrofit. Add `analytics_purge` to the enum **now**.
4. **The `jobs` table losing typed FK + cascade** means every handler must defensively re-check its target exists; the day someone forgets, a job acts on a deleted lock/offer. P2's original cascade design was safer; the contract regressed it for brevity.
5. **`dispatch_notification` channel order push→web→email with no per-type override** means high-stakes `safety_alert` and low-stakes `account` notifications share one policy; the contract's "safety bypasses consent/quiet/rate" is the only carve-out, but there's no "email-always for `rating_request`" etc. Fine for v1, but the single-policy design will be re-litigated.
6. **`match_*` doing chat + analytics + jobs + config reads inline** makes `match_make_offer`/`match_accept_offer` enormous SECURITY DEFINER functions with cross-phase late-bound calls — fragile to test in isolation and a nightmare to debug at 3am when one of five sub-calls silently no-ops.

---

# REQUIRED ADDITIONAL SCREENS / COMPONENTS

(Contract is backend; these are the backend objects/owners that must be added to the contract before reconciliation.)

1. **`C11 — feature_config & offer-window` section:** freeze `feature_config(key text pk, value jsonb)` (or typed columns), name owner **P0** (so it lands early), seed the default offer-window, and freeze `offer_expires_at(p_now timestamptz, p_city_id uuid) returns timestamptz` (DST via `cities.timezone`) with owner + early band.
2. **`C12 — analytics_events & retention`:** freeze the table columns, the single write path (trigger XOR RPC — not both), add `analytics_purge` to `job_type`, freeze a retention window.
3. **`C13 — consent/quiet-hours/notification_preferences`:** freeze the table(s) `dispatch_notification` reads, name P2 owner.
4. **`C14 — disputes`:** freeze the table, name P8 owner, rewrite P7's `adjudicate_no_show` to write it (not free-text `reports`).
5. **Explicit enum DDL in C3:** `create type standing_state`, `create type account_lifecycle` (no `suspended`), with the P9 rename instruction.
6. **Explicit `create table reports`** in C5 (not a comment), resolving `reason text` vs `reason_category` and P8's intermediate statuses.
7. **`browse_feed` canonical definition must include the C3 account-state (and standing) creator filter** and a frozen `moderation_status` table placement.
8. **Admin notification channel** (how C1's "admin alert" on safety-no-device actually reaches a human).

---

# PRODUCTION READINESS SCORE

**Contract readiness: 5.5 / 10.**

- It correctly identifies and *directionally* resolves all 13 defects — a real improvement over the 12 conflicting plans (which averaged ~3.9).
- But it is a one-page freeze that (a) leaves ~8 referenced objects unowned (`feature_config`, `offer_expires_at()`, `analytics_events` schema+retention, `disputes` write path, `moderation_status` placement, consent/quiet-hours, VAPID, `notify` payload), (b) ships at least 3 non-compiling/under-specified statements (`devices` PK expression, the C4 feed filter missing account-state, the `match_make_offer`→`open_chat_thread` band-order test break), and (c) introduces 2–3 new contradictions (C6 cross-band feed ownership vs. C4 "no other phase touches it"; orthogonal-fields gap on paused-with-suspended; demand-hint presence-weighting loss).
- A reconciler following this contract literally would produce a migration set that **fails `db reset`** (devices PK, duplicate `job_status` from P9 if not explicitly deleted) and a feed that **leaks paused/suspended creators' nights.**

It is the right artifact and ~70% there, but **not safe to reconcile against until the C11–C14 additions and the buildability fixes land.**

---

# PRIORITY FIX ORDER

**P0 — must fix or `db reset` / core flows break:**
1. **Own `feature_config` + `offer_expires_at()` and move them to an early band (P0/P1).** Without this P5 cannot apply or test. (#1 critical missing system.)
2. **Fix the `devices` PRIMARY KEY** — replace the `coalesce()` expression with a generated column + PK, or unique index. As written it does not compile.
3. **Add the creator `account_state='active'` (and `standing NOT IN(...)`) filter to the canonical `browse_feed`,** and resolve the C4-vs-C6-vs-P9 "who may touch the view" contradiction. Otherwise suspended/paused creators stay browsable.
4. **Explicitly instruct P9 to delete its `job_status`/`jobs`/`enqueue` redefinitions and rename `account_status`→`account_state` dropping `suspended`.** Otherwise duplicate `create type` hard-fails `db reset` and the two-`suspended` collapse defeats C3.

**P1 — must fix or runtime is silently wrong:**
5. **Resolve the `reports` enum + `reason`/`reason_category` duality and P8's 6-state lifecycle vs. the contract's 4-value enum;** freeze `create table reports` and the `disputes` table + P7 write path. (I5 is only half-resolved.)
6. **Fix the `match_make_offer` → `open_chat_thread` band-order so P5 tests pass** (stub P6 hooks in an early band, or relax the call). Define the `chat_lock_ready` "mutual override."
7. **Specify lock-servicing exemption from the `account_state` gate** (paused/deletion_pending users keep reconfirm/check-in/cancel/rate on existing locks).
8. **Make the safety "fail loud" path terminate in a real channel** (`moderation_action` is a notification_type, not a job_type; define the admin alert path).

**P2 — fix before scale / regret:**
9. **Freeze `analytics_events` schema, pick ONE write path (trigger XOR P5-emit, not both), add `analytics_purge` to `job_type` and a retention policy.**
10. **Restore typed FK + cascade on `jobs` (or freeze a mandatory target-revalidation rule).**
11. **Add `match_resolve_reciprocal` to the C2 frozen API** (spec §7.5 mandated, currently omitted).
12. **Reconcile the demand-hint to preserve §7.2 availability-weighting** (don't just delete P11's presence view in favor of P5's raw count).
13. **Freeze consent/quiet-hours/notification_preferences columns + VAPID ownership; freeze the generic `notify` job payload.**

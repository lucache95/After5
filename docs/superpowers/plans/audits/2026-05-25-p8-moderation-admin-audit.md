# P8 — Moderation, Admin Tooling & Anti-Abuse — Pre-Build Audit

Audited file: `docs/superpowers/plans/2026-05-25-p8-moderation-admin.md`
Cross-referenced: spec `…/specs/2026-05-25-experience-first-dating-core-loop-design.md`; roadmap `…/plans/2026-05-25-experience-first-dating-implementation-roadmap.md`; P0 `…/p0-data-model.md`; P3 `…/p3-creation-content-pipeline.md`; P5 `…/p5-matching-state-machine.md`; P7 `…/p7-trust-safety-ratings.md`; P9 `…/p9-account-lifecycle.md`; P10 `…/p10-payments.md`; `apps/web/lib/auth/require-admin.ts`, `apps/web/lib/supabase/admin.ts`, `apps/web/app/admin/*`, `apps/web/app/api/admin/insiders/route.ts`, `supabase/migrations/20260522110000_rate_limits.sql`.

**Verdict: this plan does NOT yield working end-to-end moderation/enforcement.** It builds a self-consistent island that compiles and passes its own psql/vitest tests, but the load-bearing claim — *"someone can suspend bad actors on day one"* — is FALSE because P8's enforcement state (`suspensions` / `account_active()`) is wired to zero callers, while the live loop (P5) gates on a *different* state owned by P7 (`profiles.standing`). The plan also collides catastrophically with P7 and P9 on migration timestamps and on the `reports` status enum, and it moderates the wrong UGC table (ignores P3's `media_assets` queue that was explicitly built as P8's ingestion point).

---

## 1. Executive Summary & Score

**Score: 4/10 (NOT READY — significant rework required before execution).**

The plan is well-written, follows P0 conventions, and the *intra-plan* engineering (RLS, SECURITY DEFINER RPCs, append-only action log, transition guards, noisy-OR fraud parity TS↔SQL) is genuinely good. But P8 is the convergence point of three launch-blocking phases (P7 ratings/enforcement, P9 lifecycle, P10 payments) and a content phase (P3), and the plan's seam analysis is wrong on every one of those edges:

- It declares `suspensions` "the single source of truth for can this account act" — but **nothing reads it.** P5's offer-accept/lock RPCs do not call `account_active()`; P7's `evaluate_standing` and P9's `account_status` define their own `suspended` state. A moderator can ban someone in P8 and that person keeps swiping. The headline capability is non-functional.
- It owns the `reports.status` text→enum conversion but **breaks P7's `evaluate_standing`** (which reads `status = 'actioned'`, a value P8 deletes) and **ignores P10's `reason_category`** (payment disputes never surface in triage).
- Its migration timestamps `20260525130000`–`20260525131000` are a **byte-for-byte collision** with P7 and P9, including three plans all claiming `…130000`.
- Its UGC moderation console moderates a column P8 invents (`itineraries.moderation_status`) instead of P3's `media_assets.moderation_state` table — the queue P3 explicitly built "for P8 to read." Photos/audio are `media_assets` rows; the console will show approve/hide buttons over content that isn't where it thinks.

The intra-plan quality (~7/10) is dragged down to 4 by the cross-phase reality that this is the *operational layer* meant to drive the whole safety machinery and it drives almost none of it.

**Issue counts:** Critical (blocker): **7** · Major: **9** · Minor: **6**.

---

## 2. Critical Issues (ship-blockers)

**C1 — `suspensions`/`account_active()` is enforced by NOTHING; the core deliverable does not work.**
Plan §Architecture and Self-Review key decision #3 assert `suspensions` is "the single source of truth for can this account act." Grep across P2/P5/P6/P7/P9/P11 returns **zero** references to `account_active(` or `suspensions`. P5's loop transition RPCs (`match_accept_offer`, `match_make_offer`, etc.) gate on report-freeze/cutoff/block guards and (per P7) `profiles.standing`. So `impose_suspension(actor,user,'ban',…)` flips a row that no swipe/offer/lock/create path consults. **A banned user continues to swipe, accept offers, lock dates, and create dates.** This is the single most important promised capability ("suspend bad actors on day one") and it is inert. The plan must either (a) make P5's accept/create RPCs call `account_active()`, or (b) make `impose_suspension` write `profiles.standing='suspended'` (P7's gate) — but it does neither and does not even name the integration point. As written, P8 ships a dead "Suspend" button.

**C2 — Three competing "suspended/can't-act" state machines; P8 picks the orphaned one.**
- P7: `profiles.standing user_standing` enum includes `'suspended'`, `'locked_ban'`, `'cooldown'`; `evaluate_standing()` + `user_sanctions`; this is what the loop reads.
- P9: `profiles.account_status` enum includes `'suspended'`; lifecycle teardown.
- P8: `suspensions` table + `account_active()`.
Three sources of truth for the same concept, no reconciliation. The spec (§8) describes ONE enforcement ladder. P8 says "P7 owns automated escalation; P8 owns the suspension state" — but P7 *already owns* the suspension state (`standing='suspended'`), and P8 builds a parallel one. An admin lifting a P8 `suspension` does not clear `profiles.standing='suspended'`, so the user stays locked out by P7's gate. Must collapse to one model.

**C3 — Migration timestamp collision with P7 and P9 (`20260525130000`–`131000`).**
P8 uses `20260525130000_p8_admin_users.sql` … `20260525131000`. **P7 uses the identical band** (`…130000_p7_match_ratings_reveal.sql` … `…131000_p7_jobs_bridge.sql`). **P9 also uses `…130000_p9_account_status.sql`.** Three plans claim `…130000`; P7 and P8 fully overlap `…130100`–`…131000`. Supabase applies in lexical filename order, so the de-facto order at each shared timestamp is p7 < p8 < p9 alphabetically — which the plans never designed for. This is not a style nit: it directly produces C4 (P8 converts `reports.status` *after* P7's `…130000`/`…130100` insert reports with the old text values, and *before* P7's `…130600_p7_standing.sql` defines `evaluate_standing` reading `'actioned'`). The three plans must be re-timestamped onto disjoint bands (e.g. P7 `1300xx`, P8 `1310xx`, P9 `1320xx`) before ANY of them executes.

**C4 — P8's `reports.status` enum conversion silently breaks P7's enforcement ladder.**
P8 Task 3 drops the old text `status` (values `open|reviewing|actioned|dismissed`) and creates `report_status` with values `open|triaged|investigating|escalated|resolved|dismissed` — **`'actioned'` is deleted** (remapped to `resolved` + `resolution='actioned'`). But P7's `evaluate_standing()` (migration `…130600_p7_standing.sql`) runs, at call time:
```sql
select count(*) … from reports where … status = 'actioned' …
```
After P8's migration applies, `'actioned'` is no longer a valid `report_status` label, so this comparison raises `invalid input value for enum report_status: "actioned"` at runtime — i.e., every `submit_rating`/`file_report` that triggers `evaluate_standing` will throw, or (if P7 sorts before P8 and the function body is never re-evaluated against the new enum until called) the entire enforcement ladder's "2 upheld safety reports → suspended" rung silently matches zero rows forever. Either way the **data-driven enforcement ladder is broken by P8's schema change**, and the plan's Self-Review claims this conversion is "safe" without ever cross-checking P7's consumers. P8 must migrate P7's `evaluate_standing` query to read `status='resolved' AND resolution='actioned'`, or keep an `actioned` concept P7 can read.

**C5 — UGC console moderates the wrong store; P3's `media_assets` queue is orphaned.**
P3 builds `media_assets` (Task 3) with `moderation_state pending|approved|rejected|flagged` and states verbatim: *"This table is the queue P8's moderation console reads."* Place photos and ambient-audio clips are **`media_assets` rows**; an itinerary references an approved asset via `ambient_sound_url`. P8 instead invents `itineraries.moderation_status` (Task 6) and the console (Task 16) renders `<img>`/`<audio>` off itinerary columns and writes `moderate_date()` to `itineraries`. Result: (1) the actual UGC moderation queue (`media_assets` flagged/pending) is **never surfaced** — a dead-end queue with no console; (2) hiding the *itinerary* does not change the underlying asset's `moderation_state`, so a rejected photo can still be served via signed URL elsewhere; (3) two moderation states (`media_assets.moderation_state` vs `itineraries.moderation_status`) with no reconciliation. P8 must read/triage `media_assets`, not a parallel itinerary flag (or explicitly own both with a defined relationship).

**C6 — Payment-dispute reports (P10) are invisible in triage.**
P10 extends `reports` with `reason_category report_reason_category` (incl. `'payment_dispute'`) + `pay_setting_snapshot` + a CHECK that payment disputes reference a date/lock target. The P8 triage queue (`ReportRow`, Task 13) selects `reason, detail, status, priority, …` but **not `reason_category` or `pay_setting_snapshot`.** Payment disputes therefore appear as generic rows with no category filter and no pay-setting context — the moderator can't triage them as the distinct class P10 built. The roadmap explicitly routes `payment_dispute` "to moderation (P8)"; P8 doesn't consume it. (Also: P8's `reports.status drop column` drops `reports_status_idx`; P8 recreates a status index, fine — but verify P10's CHECK and any P10 index survive the drop/rename.)

**C7 — `requireAdmin()` return-type widening is asserted backward-compatible but unverified against real callers, and the bootstrap write is unsafe under concurrency / RLS.**
Task 12 changes `requireAdmin()` from `{ email }` to `{ userId, email, role }` and claims "all existing callers stay valid." The plan names `/admin/insiders`, `/admin/feedback`, `/admin/venues`, `/admin/eval`, `/api/admin/*` but the real tree also contains `/admin/dates/[id]` and `/admin/places` (nav item exists). None were read to confirm they don't, e.g., type the return or pass it onward. More serious: the bootstrap `upsert({user_id, role:'super_admin'})` runs on **every** `requireAdmin()` call for an allowlist user (every admin page load + every API call) — an extra service-role round-trip per request, and it will **silently re-promote** a super_admin who was intentionally demoted to `ts_admin` in `admin_users` (the `maybeSingle()` returns their `ts_admin` row, so `!role` is false and bootstrap is skipped — actually OK — but if a super_admin row is *deleted* to revoke access while they remain on `ADMIN_EMAILS`, they are silently re-granted super_admin). The allowlist→DB precedence is "allowlist wins," which makes `admin_users` demotion of an allowlisted user impossible — an enforcement gap for the very role model being added.

---

## 3. Moderation Flow Completeness (intake → triage → action → appeal → audit)

| Stage | Status | Finding |
|---|---|---|
| **Intake** | Partial | Reports created by P0 (user insert), P7 (`file_report`, `submit_rating` auto-open on `unsafe`), P10 (payment_dispute), P3 (media flags?). P8 reads them — but does NOT read `media_assets` (C5) or `reason_category` (C6). No intake from `fraud_scores band='block'` into the report queue (fraud is a separate orphaned screen, see M-series). |
| **Triage** | OK-ish | State machine `open→triaged→investigating→escalated→resolved/dismissed` + guard trigger is solid. But **no SLA / aging / priority auto-bump** for `critical` (spec §8 implies safety reports escalate immediately; P7 sets some reports as serious but P8 never reads a severity to set `priority`). |
| **Action** | Broken | Resolve/dismiss work; **suspend is inert (C1); UGC action targets wrong table (C5).** `rule_dispute` overturns nothing downstream — see §6. |
| **Appeal** | **MISSING** | There is **no appeal flow for a suspension/ban.** A banned user has no path to contest. The spec §8 enforcement ladder and basic T&S practice require an appeal channel. `disputes` covers *no-show/rating* contests (P7 outcomes) but NOT moderation actions (suspensions, content removals). A user told "you're banned" (notification is out of scope, see §9) has nowhere to go. This is a genuine moderation-flow dead end. |
| **Audit** | OK | `moderation_actions` (append-only) + merged `audit_log` viewer is good. But P8 adds a *second* `after insert or update` audit trigger on `reports` (`audit_reports`) calling `log_status_transition()` — P0 put no trigger on `reports`, so no double-fire, but confirm `log_status_transition` handles `reports` (it casts `new.status::text` — fine for enum). |

Net: intake leaks two sources, action is half-dead, **appeal is entirely absent.**

---

## 4. Admin Console / API Coverage (dead screens, actions with no backend, orphans)

- **`fraud_scores` / `fraud_signals` / `device_fingerprints` have NO admin screen.** Task 8 builds the tables (admin-read RLS), Task 19 records signals, Task 10 recomputes scores — but no page renders them and no action consumes a `band='block'`. The suspensions page (Task 17 Step 1) merely "surfaces that user's `fraud_scores.band` for context." So the entire fraud-scoring subsystem is **write-only / no operator surface**: scores accumulate and nothing happens. A `band='block'` user is never auto-reported, never queued, never blocked. Dead-end data.
- **`honeypot_candidates` view** is referenced by the Moderate page (Task 16) "honeypot watch tab," but the view has `revoke all … from anon, authenticated` and `security_invoker=true` with NO grant to anyone — the console uses the service-role client (bypasses RLS/grants), so it works, but the comment "admin-only via grant" is misleading (there is no grant; it relies solely on service-role). Minor but the security story is muddled.
- **"Ban reporter target" / "suspend creator" shortcuts** (Tasks 13, 16) POST to `/api/admin/suspensions` — which calls `impose_suspension` — which is inert (C1). So these shortcut buttons are **fake buttons** end-to-end.
- **Client component markup is unwritten** for all six pages (Tasks 13–18 say "mirror `insiders-admin.tsx`," return `null`). That is acceptable as a contract IF the data/action seams were sound — but several seams are broken (C1/C5/C6), so "mirror the existing style" will faithfully reproduce a non-functional flow. The plan's "placeholder scan" calls this load-bearing-complete; it is not, given the broken backends.
- **`/admin/moderate` Step 1** offers "all `seeking` instances for spot-checks" with no pagination/limit — at queue volume this is an unbounded scan (see §10).
- **Nav** adds 6 items; layout already has `Venues/Places/Dates/Inbox/Insiders/Eval`. No conflict, but `/admin/places` page existence wasn't confirmed (pre-existing nav item with possibly no page — out of P8 scope, noted).

---

## 5. Data Model, Relationships & RLS

- `disputes.report_id`? No — `suspensions.report_id uuid` has **no FK** ("optional link to originating report"). Soft reference; acceptable but means a deleted report orphans the link silently. `moderation_actions.target_id uuid` also has no FK (by design, polymorphic). Fine, but there is **no integrity tying a `suspension` back to the `dispute`/`report` that justified it** beyond a nullable uuid — audit defensibility is weaker than claimed.
- **`disputes` ↔ P7 reconciliation gap.** P8 Task 5 builds `disputes` for "contested no-show/rating outcomes from P7." But P7 *already* has its own dispute mechanic: `adjudicate_no_show()` sets `match_ratings.disputed=true` and **auto-opens a `report` with `reason='disputed_no_show'`** routed to moderation. So a disputed no-show becomes a *report* (P7's path) AND P8 expects it as a *dispute* (separate table). Two representations of the same event, no bridge. Which does the admin resolve? If they resolve the P7 report, the P8 `disputes` row (if any) is untouched, and vice-versa. Nobody creates `disputes` rows from P7 — P8 only adds an *insert RLS policy for the opener* (user self-service), but no P7/P5 code opens a dispute. **The `disputes` table may sit empty** while real contests flow through `reports`.
- `disputes` FKs `lock_id→locks`, `rating_id→match_ratings` (P0 tables, dependency-safe). Good. Partial unique index "one open per (lock, opener)" is correct.
- RLS: tables are read-by-admin, write-via-RPC — consistent and correct. `is_admin()`/`admin_has_role()` fail-closed — good.
- **`moderation_actions` append-only** via `forbid_mutation()` trigger. Function name `forbid_mutation` is generic and ungranted-namespaced; confirm no collision with other phases (none found in P7/P9, but P11/P6 not exhaustively grepped). Minor.
- `account_active()` excludes `'warning'` (correct) but **`offer_cooldown` blocks ALL action** (`kind in ('ban','temp_suspend','offer_cooldown')`) — yet P7's `cooldown` standing means only "cannot create/accept a new lock," not "cannot read/swipe." P8's `account_active()` is coarser than P7's intended cooldown semantics, so even if it were wired in, a cooldown would over-block. Semantic mismatch with the ladder it claims to terminate.

---

## 6. Cross-Phase Seams (the heart of the audit)

**S1 (P7, CRITICAL):** `reports.status='actioned'` deletion breaks `evaluate_standing` — see C4.

**S2 (P7, CRITICAL):** `suspensions` vs `profiles.standing` — see C1/C2. P8's terminal-rung claim is fiction; P7 already owns `suspended`/`locked_ban`.

**S3 (P7, MAJOR):** `rule_dispute(outcome='overturned')` is a **dead end downstream.** P7 §75 says an overturned no-show means "do not apply the no-show penalty … B's score unaffected pending resolution," and reliability is "re-derived." But P8's `rule_dispute` only updates the `disputes` row + logs an action — it does **not** call `recompute_reliability()`, does not flip `match_ratings.disputed`, does not clear `locks` no-show. So "overturned" changes nothing in the reliability/standing data. The ruling is cosmetic. Must call P7's recompute / clear the contested signal.

**S4 (P7, MAJOR):** `submit_rating`/`adjudicate_no_show` open reports with free-text reasons (`unsafe_or_disrespectful`, `disputed_no_show`) and `status='open'`. After P8's enum conversion, `'open'` is a valid label (OK), but these reasons have no `reason_category` (P10's column is nullable, OK) and no `priority` set — they enter P8's queue as `priority='normal'` despite being safety-critical. P8 never elevates safety reports to `critical`. Triage ordering is wrong for the most dangerous reports.

**S5 (P9, MAJOR):** Timestamp collision (C3) + **`account_status='suspended'` (P9) vs `suspensions`/`standing`.** P9 also defines `suspended`. P9 "drives the loop via P5 transition functions" and never reads `suspensions`. A P8 ban does not set `account_status`, so P9's lifecycle worker has no idea the user is banned. Three-way divergence.

**S6 (P3, CRITICAL):** `media_assets` is the real UGC queue; P8 ignores it — see C5.

**S7 (P10, CRITICAL):** `reason_category`/`payment_dispute` invisible in triage — see C6.

**S8 (P5, MAJOR):** P8 honeypot defense leans on "P5's reveal-on-shortlist consent." P5 delivers "consent/disclosure that swiping reveals the swiper's profile to the creator." Good — but P8's `honeypot_candidates` view counts `swipes.direction='right'` as "swipers_attracted" and `offers`/`locks` as advancement. P5's actual funnel has a `queue_entries`/shortlist stage *between* swipe and offer; a legit creator with a long shortlist but slow offers will show low `advancement_ratio` and be falsely flagged. The heuristic ignores the shortlist stage P5 owns. Tuning/false-positive risk on a launch-blocking screen.

**S9 (P2, MAJOR):** Notifications are "out of scope (P2)" — but there is **no contract/stub** telling P2 *what* moderation events to notify (suspension imposed, appeal needed, content removed, verification rejected). P8 logs `moderation_actions` but enqueues no job and defines no notification kinds. P2 will have nothing to hook. Compare P5/P7, which ship explicit `enqueue()`/jobs-bridge stubs. P8 ships none, so "user told of suspension" never happens and no later phase is set up to make it happen.

**S10 (P2, MINOR):** `recompute_fraud_score` is "called by P2 scheduler in bulk" — but no jobs-bridge stub, no `kind` defined, no cron contract. Same gap as S9 for fraud.

---

## 7. Impossible / Undefined States & Concurrency

- **Concurrent moderators on one report:** No optimistic-concurrency / assignment lock. Two admins both open report X; both click Resolve. `resolve_report` is `update … where id=? and status not in ('resolved','dismissed')` — the second update matches zero rows (idempotent), but still **inserts a second `moderation_actions` row** ("report_resolved") and returns success, so the audit log shows two resolvers with possibly different resolution codes while only the first took effect. Misleading audit. No "claim/assign before act" gate (assignment exists but isn't enforced as a precondition).
- **Moderator acting on a deleted user (P9):** `impose_suspension(actor, user, …)` has `user_id references profiles(id) on delete cascade`. If P9 hard-deleted the user, the FK insert fails (raises) → 400 with `rpc_failed`, opaque to the admin. If P9 *tombstoned* (kept the profiles row), it works but suspends a tombstone. Undefined/unhandled either way.
- **Self-moderation:** Nothing prevents an admin from resolving a report *they filed*, ruling a dispute they are a party to, or suspending themselves / another admin. No conflict-of-interest guard. `moderate`/`suspend` on an `admin_user` target is allowed (target_type includes `admin_user` in `moderation_actions` but no guard).
- **Lifting a ban that was auto-imposed by anti-abuse:** `lift_suspension` sets `status='lifted'` but does NOT clear the `fraud_signals`/`fraud_scores` that may re-trigger an auto-suspension on the next recompute — a user can be re-banned immediately in a loop. No "cleared/whitelisted" state.
- **`expired` status is never set.** `suspension_status` has `'expired'` but `account_active()` relies on `expires_at > now()` and nothing flips `active→expired`. The `'expired'` enum value is dead; temp suspensions stay `active` forever in the row (functionally fine via the time check, but the status column lies, and any UI filtering on `status='active'` shows stale "active" bans).

---

## 8. Auth / Permission Model

- `verification_reviewer` can ONLY do verifications (correct), but `requireAdminRole('/admin/verify','verification_reviewer')` **redirects on the page** and the route returns 403 — yet the **nav (Task 13) shows all 6 items to everyone**, including `ts_admin`-only screens to a `verification_reviewer` and vice-versa. Visible-but-forbidden links everywhere; clicking bounces. Acceptable UX-wise but the plan claims role-gating; nav is ungated.
- **Allowlist precedence makes role demotion impossible** for allowlisted users — see C7. An allowlisted email is always `super_admin`, so you cannot create an allowlisted `verification_reviewer`-only operator. The role model is partially defeated by its own bootstrap.
- `is_admin()`/`admin_has_role()` are `security definer` reading `admin_users` — correct and fail-closed. Good.
- Route handlers re-check `requireAdmin()`/`requireAdminRole()` then call RPCs that re-check `admin_has_role(p_actor)` — defense in depth is correct. But the RPC trusts `p_actor` passed by the route (`ctx.userId`); since only the service-role client can call these and the route verified identity, that's acceptable. Document that these RPCs must NEVER be exposed to `authenticated` (the plan does `security definer` but does not `revoke execute … from public / authenticated` on the moderator RPCs — P7 explicitly does `revoke all … from public`. **P8 omits the revoke**, so if any RPC is reachable via PostgREST with an `authenticated` JWT, the role check is the only gate — and it IS a gate, but the `p_actor` is attacker-supplied. An authenticated non-admin could call `resolve_report(some_admin_uuid, …)` and pass the `admin_has_role(some_admin_uuid)` check using a *different* admin's id.** This is a real privilege-escalation hole: the RPC authorizes the *passed* actor, not the *calling* role. MAJOR. Must `revoke execute from authenticated, anon` on every moderator RPC (service-role only), or check `auth.uid()` inside instead of trusting `p_actor`.

---

## 9. Notifications, Data Lifecycle & Abuse/Evasion

- **Notifications: entirely deferred with no seam (S9).** User is never told of suspension, ban, appeal availability, content removal, verification rejection. No job kinds, no contract for P2. The spec implies enforcement is communicated. As planned, enforcement is silent.
- **Ban evasion / fingerprint reset:** `device_fingerprints` records signals but **a banned user simply creates a new account** — nothing checks, at signup, whether the new account's fingerprint/IP matches an existing `ban` suspension. The `shared_device` signal needs ≥3 users and only fires a *score*, which (per §4) drives no action. So the headline "fake accounts / ban evasion" defense is detection-only with no enforcement loop. The `velocity_limits.signup` cap exists but nothing in P8 wires `recordDevice`/signup to the suspension/fraud check (Task 19 helpers exist; no endpoint calls them — P1/P5 "invoke them," but those plans don't reference these helpers, so they're orphaned integration points).
- **Report-bombing:** `VELOCITY_LIMITS.report=20/hr` exists, but `checkVelocity` (Task 19) is never called by any report-intake path in P8 (intake is P0/P7). So the anti-report-bomb cap is unenforced unless P7/P0 adopt it — not coordinated.
- **Fraud signal `weight` is operator-set/heuristic** with no provenance or decay; `report_density` signal kind exists but no code computes it. Several `fraud_signal_kind` values (`no_completion_ratio`, `report_density`, `disposable_email`, `velocity_*`) have **no producer** — only `shared_device` (Task 19) and `honeypot_creator` (implied) are ever inserted. Half the signal vocabulary is dead.
- **Data lifecycle:** No retention policy on `device_fingerprints`/`fraud_signals` (PII: IP, UA). No purge. Interacts with P9 GDPR erasure — a deleted user's fingerprints/IPs persist (may be defensible for ban-evasion, but undefined and unmentioned; P9's "anonymize" doesn't know these tables exist).

---

## 10. Scalability, Testing & Minor Issues

**Scalability:**
- `reports/page.tsx` `.limit(300)` and audit viewer `.limit(200)` with no pagination/cursor — fine early, but the queue is the operator's primary surface; at volume, 300 newest (not 300 *open*) means resolved spam can bury open safety reports. Order should prioritize open+critical, not raw `created_at`.
- `/admin/moderate` "all seeking instances for spot-checks" — unbounded; at feed scale this is a full `date_instances` scan rendered with `<img>`/`<audio>` per row.
- `honeypot_candidates` view: per-creator `GROUP BY` over **all** `swipes`/`offers`/`locks`/`date_instances` with no time bound — recomputed live on every Moderate page load. O(table) aggregation; needs a materialized view or time window at any real volume.
- `recompute_fraud_score` per-user is fine; the "bulk recompute" (S10) has no batching strategy.

**Testing:**
- psql tests insert directly into `profiles` (bypassing `auth.users`) and never exercise RLS under a real `auth.uid()` — so **none of the RLS policies are actually tested**; the "admin-read / default-deny" claims are unverified by the suite (plan admits this in Risk note 3 but ships no integration test to cover it).
- No test asserts a suspended user is blocked from the loop (because, per C1, they aren't — the missing test would expose the missing wiring).
- No test for the P7/P8/P10 `reports` seam (the conversion test only checks P8's own happy path, not P7's `evaluate_standing` or P10's columns surviving).
- Fraud TS↔SQL parity is asserted by separate tests but no single parity test feeds identical inputs to both (P7 does this properly with `reliability_parity.sql`; P8 should mirror).

**Minor:**
- Self-Review claims "P5/P7 detailed plans do not exist yet" — **both exist** (`…-p5-…md`, `…-p7-…md`) and contradict P8's assumptions. The plan was written against an imagined P7, not the real one. (This is the root cause of most criticals.)
- `moderate_date` logs `target_type='date_instance'` but passes a `p_itinerary` id (it updates `itineraries`). The action log's `target_id` is an itinerary id labeled as a date_instance — wrong target_type, breaks the audit join/filter.
- `set_report_status` builds action name `'report_status_'||p_status` (e.g. `report_status_triaged`) — free-form action strings, not in any closed set; harder to filter/report on.
- `requireAdmin` does a service-role DB read on **every** admin request (latency + bypasses the user's own session for the role lookup; acceptable but unmemoized).
- `device_fingerprints.upsert(onConflict:'user_id,fingerprint_hash')` — composite onConflict via supabase-js string; verify the unique index name/columns match exactly or the upsert silently inserts dupes.
- Nav shows admin-only screens to verification_reviewer (already noted §8).

---

### Top 3 must-fix (in order)
1. **C1/C2 — wire enforcement to one source of truth.** `account_active()`/`suspensions` is read by nothing; collapse P7 `standing` / P8 `suspensions` / P9 `account_status` into one model and make P5's accept/create RPCs gate on it. Until then, "suspend a bad actor" does not work.
2. **C3/C4/C6/S6 — fix the `reports`+migration seams.** Re-timestamp P7/P8/P9 onto disjoint bands; migrate P7's `evaluate_standing` off the deleted `'actioned'` label; have triage read P10's `reason_category` and P3's `media_assets` queue (not the invented `itineraries.moderation_status`).
3. **§8 RPC privilege-escalation + missing appeal flow.** `revoke execute … from authenticated, anon` on every moderator RPC (or check `auth.uid()` not the passed `p_actor`), and add a suspension/ban **appeal** path — currently a banned user has no recourse and a non-admin can pass a forged `p_actor`.

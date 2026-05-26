# P0 — Data Model & Invariants — Pre-Build Audit

Audited plan: `docs/superpowers/plans/2026-05-25-p0-data-model.md`
Cross-referenced: core-loop spec, roadmap, sibling plans P1/P4/P5, and the **actual** existing schema in `supabase/migrations/` (`20260419193959_initial_schema.sql`, `20260522100000_capture_full_schema.sql`).

Verdict up front: **this plan does not apply cleanly.** Two issues each independently break `supabase db reset` (the plan's own pass criterion). Several "tests" pass structurally while the thing they guard is non-functional. Detailed below.

---

# CRITICAL MISSING SYSTEMS

### C1 — `browse_feed` references a column that does not exist → migration + `db reset` FAILS (build-breaker)
Task 11 creates the view selecting `i.vibe_tags` from `itineraries i`:
```
i.vibe_tags,
```
But **`itineraries` has no `vibe_tags` column.** I verified every itineraries column: the initial schema (`20260419193959`) and the schema-capture migration (`20260522100000`) define title/hook/why_it_works/stops/inputs/etc.; P0 Task 4 adds only `city_id, is_evergreen, match_status, pay_setting, ambient_sound_url, why_note`. `vibe_tags` exists only on `places` and (newly) on `profiles`. `CREATE VIEW browse_feed` will raise `column i.vibe_tags does not exist`, aborting migration 12 and therefore the whole reset. **Every later P0 task (12, 13) and the P4 plan (which re-creates the same view with the same `i.vibe_tags` line, P4 Task 3) inherit this break.** This is the single highest-severity item: the plan cannot reach "PASS" on its own loop.

Root design gap behind the bug: **the night object has no vibe-tag home.** The spec (§4 "Vibe/theme", §5 feed shows "vibe") requires the *night* to carry vibe tags. P0 put `vibe_tags` on the *person* (`profiles`), not on `itineraries`/`date_instances`. P4 then assumes the feed returns the night's `vibe_tags` (`vibe_tags: z.array(z.string())`, P4 Task 1). Fix requires adding `vibe_tags text[]` to `itineraries` (or `date_instances`) in Task 4.

### C2 — Test fixtures violate the `profiles → auth.users` FK → Tasks 7, 8, 12 tests FAIL (the invariants are never actually proven)
The "known issue" is real and worse than framed. `profiles.id` is `REFERENCES auth.users(id) ON DELETE CASCADE` (`20260522100000` line 38). The fixtures in Task 7 / Task 8 / Task 12 do:
```
insert into profiles (id, first_name) values (gen_random_uuid(),'cre') ...
```
There is no matching `auth.users` row (no seed inserts into `auth.users`; the config's `seed.sql` does not exist, and the only seed migration seeds `places`/`templates`). The very first fixture insert raises `insert or update on table "profiles" violates foreign key constraint "profiles_id_fkey"`. The test `DO $$ … END $$;` block aborts before reaching the invariant assertion, so the harness reports FAIL — but **for the wrong reason**, and the offer/lock-overlap/audit invariants are **never exercised at all.** The plan's Self-Review "Risk note" (line 924) is incorrect: it claims this works "because dating-loop FKs point at `profiles`, not `auth.users`." That is irrelevant — the failing insert is into `profiles` itself, whose own PK FKs to `auth.users`. Additionally the fixtures `insert into itineraries (id, user_id) values (…, cre)` and `itineraries.user_id REFERENCES auth.users(id)` — same violation. Fix: seed real `auth.users` rows in each fixture (`insert into auth.users (id, …) …` with the minimal required columns), or have fixtures create users via a helper.

### C3 — No `dates`/scheduled-conversion linkage is modeled; `date_instances` ↔ `itineraries` is the wrong cardinality for the spec
Spec §4 distinguishes **evergreen idea (template)** from **scheduled instance**, and requires an explicit **evergreen→scheduled conversion** that carries interest over. P0 models this as `date_instances.itinerary_id → itineraries.id` with `itineraries.is_evergreen` default `true`. But nothing prevents (a) a `date_instance` pointing at a non-evergreen itinerary, (b) multiple instances of the same idea competing, or (c) the spec's rule that interest on the evergreen carries to the scheduled instance. More importantly, **`swipes`/`queue_entries` are keyed only to `date_instance_id`** — there is no way to express "swiped on the evergreen idea before it was scheduled," which is the entire point of evergreen browsing (§5). As written, you cannot browse/swipe an evergreen at all (the feed filters `di.status='seeking'`, i.e. only instances). Either the feed must surface evergreen itineraries too, or the spec's evergreen-browsing pillar is silently dropped. This is a design-intent vs. tasks gap that P3/P4 will trip over.

### C4 — `match_status` on `itineraries` is an orphan field with no owner or transitions
Task 4 adds `itineraries.match_status date_match_status default 'none'` **and** `date_instances.status date_match_status default 'seeking'` — two columns of the same enum on two tables. Nothing in P0 (or, by inspection, P5) ever writes `itineraries.match_status`; all logic uses `date_instances.status`. It will sit at `'none'` forever — dead schema that invites a future engineer to read the wrong column. Drop it or document it as reserved.

---

# DEAD UI / FAKE INTERACTIONS

(P0 has no UI; "dead interactions" here = surfaces the plan presents as usable that yield nothing.)

### D1 — `browse_feed` view is a dead surface for everyone except creators
Task 11 grants `select on browse_feed to anon, authenticated` and Task 4's comment says "browsers … read the blind feed view (Task 11)." But the view is `security_invoker = true`, so it runs under the caller's RLS. The **only** SELECT policy on `date_instances` is `date_instances_creator_all (creator_id = auth.uid())`. Therefore: a browser (anyone who is not the creator) selecting from `browse_feed` gets **zero rows**; `anon` gets zero rows. The "blind feed browsers read" returns nothing to browsers. It is salvaged later only because **P4 ignores the view and reads `date_instances` directly inside a SECURITY DEFINER RPC** (`browse_feed_for_viewer`, P4 Task 4, line 420). So the P0 view is effectively decorative. The P0 test (`p0_feed_blind.sql`) only checks `information_schema.columns` — it will PASS on an unusable view, masking the dead surface. Decide: either (a) add a public-read RLS policy on `date_instances` limited to `status='seeking'` (and rely on the view's column-stripping for blindness), or (b) drop the `anon/authenticated` grant and document the view as "DEFINER-RPC source only," so no one builds against a feed that returns nothing.

### D2 — `swipes` insert policy lets a user swipe a date they can never see
`swipes_swiper_insert` only checks `swiper_id = auth.uid()`. There is no check that the `date_instance_id` is actually `seeking`, not the swiper's own date, not on a blocked creator, and that the swiper is dating-enabled/verified. P0 says writes belong to P5 RPCs, but the policy as written allows arbitrary direct inserts (self-swipe, swipe on cancelled/locked instances, swipe despite a `blocks` row). At minimum the policy should exclude `swiper_id = creator_id` and the spec's block-suppression (§8 "report/block at every state … reveal-suppression for blocked users"). Right now blocks have zero effect on swipes/feed in P0.

---

# MISSING EDGE CASES

### E1 — Account deletion cascades silently destroy locked-date history and audit integrity
Every dating FK is `ON DELETE CASCADE` to `profiles(id)`, and `profiles.id` cascades from `auth.users`. So deleting an auth user **hard-deletes** their `locks`, `offers`, `swipes`, `queue_entries`, `match_ratings`, `verifications`, and `lock_participants`. Consequences the plan ignores: (1) the *other* party in a `lock` loses the record of a real-world commitment with no notice; (2) `audit_log` rows survive but their `entity_id` now dangles (audit_log is not FK'd, good — but it references a row that no longer exists, so "immutable event sourcing" becomes unreadable); (3) `reports.reporter_id` is `ON DELETE SET NULL` (good) but `reports.target_id` is a bare `uuid` with no FK, so a banned user's reported evidence can't be reliably joined after deletion; (4) P9 (account lifecycle) is explicitly required to "retain banned users' report history" and handle "orphaned locks" — the P0 cascades **actively fight** P9's mandate. P0 should at least use `ON DELETE SET NULL` or a soft-delete/anonymization-friendly FK strategy on `locks`, `match_ratings`, and `reports` so P9 has something to work with. Decide now; it's far cheaper than a data-retention retrofit.

### E2 — `lock_participants` exclusion only covers `active`; cancelled/completed re-lock not handled
The GiST exclusion is `where (active)`. The `sync_lock_participants` UPDATE branch sets `active = (new.status='active')`. Good for the happy path. But: when a lock is `cancelled`, both participant rows go `active=false`, freeing the window — yet **`date_instances.status` is not reset** by P0 (P5 owns transitions, but P0's own audit-log test does `update locks set status='completed'` leaving `date_instances.status='matched'` permanently). There is no P0-level guarantee that a cancelled lock returns the instance to `seeking`. More subtly: nothing prevents inserting a `lock_participants` row whose `time_range` does not match the instance's `time_range` — the trigger sets it, but a direct insert (service role, tests) can desync the range from `date_instances.time_range`, silently weakening the double-booking guarantee. Consider deriving the range in the exclusion via a trigger-enforced invariant or a CHECK that ties it back.

### E3 — No guard against a lock whose instance is already `cancelled`/`completed`, or a creator locking with themselves
`locks` has FKs and a `unique(date_instance_id)` but no check that `matched_user_id <> creator_id`, no check that the instance is in a lockable state, and no check that the matched user actually had an `offer` (`accepted`). A service-role bug or P5 regression could create a self-lock or lock an already-completed night. `blocks` has `check (blocker_id <> blocked_id)`; `locks` deserves the analogous `check (creator_id <> matched_user_id)`.

### E4 — `offers.expires_at` has no lower-bound or instance-time relationship
`expires_at timestamptz not null` with no check that `expires_at > created_at` or `expires_at <= starts_at`. An offer can be created already-expired, or expiring after the night has happened (spec §7.3 "confirm by [T]" with a 24–48h window must be bounded by the night). P0 is the right place for a CHECK; P5 should not have to enforce time-sanity it can't see at the DB layer.

### E5 — Reciprocal-pair detection has no supporting structure in P0
Spec §7.5 requires detecting "A liked B's date AND B liked A's date" and merging into one chooser. P5 (line 36) says it "adds … reciprocal-pair tracking." Fine that the *logic* is P5 — but P0 provides no index to make the detection query non-pathological (e.g., a covering index on `swipes(swiper_id, creator_id) where direction='right'`). `swipes_instance_idx` is `(date_instance_id) where direction='right'` — useless for "did creator X right-swipe any of user Y's instances." This will be a seq-scan-at-scale footgun P5 inherits. Add the reciprocal-support index in P0 where the table is defined.

### E6 — Verification gating is modeled but never enforced anywhere in P0
`profiles.verification` and the `verifications` table exist, but nothing ties "must be verified to swipe/create/lock." Spec §8 ("identity verification day one") and the feed (§5 "trusted, currently-available users") imply gates. P0 punts all of this; acceptable only if P1/P4/P5 actually wire it — but there is no P0 column/policy that *prevents* an unverified user from doing anything. Flag for the seam owners.

### E7 — DST / timezone correctness of `time_range` is assumed, not tested
`time_range` is `tstzrange(starts_at, starts_at + make_interval(mins => duration_min))`. `timestamptz` arithmetic is UTC-instant-based, so a 150-min date across a DST boundary spans the correct *instant* range — but the *displayed* local window (and the feed's `date_trunc('hour', starts_at)`, which truncates in the **session** timezone, not the city's) can be wrong. `cities.timezone` exists but is never used in `time_range` or the feed truncation. The "Friday evening" coarse window can render in the server's TZ, not Kelowna's. No test covers this; roadmap defers DST to P11 but the storage decision is made here.

---

# STATE & DATA FLOW PROBLEMS

### S1 — Two `status`-typed columns, ambiguous source of truth (see C4)
`itineraries.match_status` vs `date_instances.status`, both `date_match_status`. The feed and all logic use `date_instances.status`. The enum reuse also means `itineraries.match_status='seeking'` is *expressible* but meaningless. Pick one owner.

### S2 — `queue_entries.status` duplicates information already in `offers`/`locks` with no enforced consistency
A candidate can be `queue_entries.status='offer_active'` while the corresponding `offers` row is `expired`, or `status='locked'` with no `locks` row, because P0 has no trigger keeping them in sync (P5 RPCs are supposed to, but P0 ships the columns with no integrity link). The audit-log triggers fire on each independently, so the event stream can show contradictory transitions. At minimum document that `queue_entries.status` is a *projection* owned solely by P5 RPCs and must never be written directly — and ideally lock it down with a policy that blocks direct candidate writes (the candidate has only a SELECT policy today, good; but the creator's `queue_creator_all` FOR ALL lets a creator set `status='locked'` by hand, bypassing the lock invariant entirely).

### S3 — Creator can forge queue state via `queue_creator_all`
`queue_creator_all` is `FOR ALL using (creator_id = auth.uid())`. A creator can directly `update queue_entries set status='locked'` or insert a `shortlisted` row for any `candidate_id` — there is no check the candidate ever swiped right. This contradicts spec §6 ("creator sees everyone who swiped right … right-swipes responders into the queue"). The write side must be RPC-only or constrained to candidates with an existing right-swipe. As shipped, the queue is creator-writable fiction.

### S4 — `audit_log.actor` will be NULL for the actual actor in nearly every loop transition
The transition trigger records `actor = auth.uid()`. But P0 itself states offers/locks transitions happen via **SECURITY DEFINER** functions (P5), which run as the function owner; `auth.uid()` inside a DEFINER context is still the JWT subject, so this *may* be fine — **but** worker-driven transitions (offer expiry, auto-roll, P2 jobs) have **no `auth.uid()`** (service role / no JWT), so every system-initiated transition logs `actor = NULL` with no way to distinguish "system" from "unknown." The audit trail can't answer "did the user or the timer expire this offer?" — which the spec (§7.1 "records owner, timestamp, and reason") explicitly demands. The trigger also captures **no reason** (`cancel_reason`, `offer_passed` vs `offer_expired` cause), only old/new status. Spec §7.1/§7.6 require reason on every transition. Add `actor_kind` and `reason` to `audit_log` now.

### S5 — `match_ratings` has no link to the night's time → "rate after the scheduled time passes" can't be enforced
Spec §8: ratings open "after a locked night's scheduled time passes." `match_ratings` references `lock_id` but has no copy of the time and no state machine. Whether a rating is allowed depends on `date_instances.time_range` (joined via `locks`), and the "blind until both submit or window closes" rule needs a window deadline that lives nowhere in P0. The insert policy (`rater_id = auth.uid()`) lets a rater submit **before** the date, or for a `cancelled` lock. Punted to P7, but P0 should at least carry the join path and a `not before` notion or P7 inherits an un-anchored table.

---

# BACKEND/API GAPS

### B1 — Writes for `offers`, `locks`, `verifications` are "service-role only (no policy)" but P0 ships no DEFINER functions or service path
Multiple tables comment "writes are service-role only … no insert/update policy" (offers, verifications) deferring to P5. That's a legitimate phasing choice, but it means **P0 delivers tables that cannot be exercised end-to-end by anything in P0** except the tests (which themselves fail per C2). There is no P0 smoke test that a service-role insert into `offers`/`locks` actually succeeds through the triggers (`sync_lock_participants`, `log_status_transition`) in a realistic auth context. The first time these triggers run under real RLS/`auth.uid()=NULL` is in P5 — bugs in the DEFINER trigger search_path / NULL-actor handling surface late.

### B2 — `reports.target_id` is an untyped, unconstrained uuid
`target_type text check (… 'user'|'date_instance'|'message'|'lock')` + `target_id uuid` with **no FK and no polymorphic integrity**. A report can reference a non-existent target; moderation (P8) cannot reliably join; on target deletion the report dangles (see E1). This is the standard polymorphic-FK trap. At minimum add nullable typed FK columns (`target_user_id`, `target_instance_id`, `target_lock_id`) or document the join strategy P8 must use. Also `message` is a valid `target_type` but `chat_messages` doesn't exist until P6 — a report against a message can be filed against nothing.

### B3 — No RLS read path for the data moderation/admin (P8) will need
`reports`, `audit_log`, `match_ratings` (raw rows), `verifications` (writes) are all "admin/service-role only — no select policy = default deny." Fine for RLS, but P8 must operate via service-role/admin client. P0 provides **no admin role, no `is_admin` predicate, no admin-readable view**. Every later admin surface will hand-roll service-role access with no consistent authorization boundary. Decide the admin auth model in P0 (even just a documented convention) so P7/P8 don't each invent one.

### B4 — `cities` is the multi-city key but `date_instances.city_id`/`itineraries.city_id` can disagree
`date_instances.city_id` is `not null`; `itineraries.city_id` is nullable. Nothing enforces that an instance's `city_id` matches its itinerary's (or its venue's) city. A "Kelowna" instance can point at a Vancouver venue/itinerary. The whole multi-city density strategy (§9) depends on correct city attribution; P0 should add a trigger/check tying `date_instances.city_id` to the venue's city or the itinerary's city.

### B5 — `swipes.creator_id` is denormalized with no trigger keeping it true
`swipes.creator_id` "-- denormalized" must equal `date_instances.creator_id`. No trigger or generated mechanism enforces it; the insert policy doesn't check it. A client (or buggy RPC) can write a swipe whose `creator_id` doesn't match the instance, breaking both the creator-read RLS (`direction='right' and creator_id = auth.uid()`) and reciprocal detection. Either make it a generated/trigger-set column or check it in the policy.

---

# UX CONTRADICTIONS

### U1 — "Blind browsing" view vs. the demand/queue privacy rules aren't reconcilable in P0
Spec §7.2 says pending/standby candidates see "their queue status" and a **bucketed** demand hint, with **no** other-candidate visibility. P0's `queue_candidate_read_own` lets a candidate read **their own full row including `rank`** — but spec §6 says "Users **do not see their own rank**." The RLS exposes `rank` to the candidate. Either strip `rank` from candidate reads (needs a column-limited view, which P0 doesn't build) or the spec's "no self-rank" rule is violated on day one.

### U2 — Pre-lock location privacy is only half-enforced
The view exposes `venue_neighborhood` (good) and `date_trunc('hour', starts_at)` as a "coarse" window — but `date_trunc('hour')` is **not coarse**: it reveals the exact hour (e.g., 7pm vs "Friday evening"). Spec §4 wants "neighborhood/category + a time window (e.g., 'Downtown, Friday evening')." Hour-precision plus neighborhood, repeated across a creator's instances, can re-triangulate. And the DEFINER RPC (P4) joins exact `geo` server-side for distance — the *creator* never sees who's near, but the precision stored is exact. The "coarse" claim in the test name (`p0_feed_blind`) is aspirational, not verified.

### U3 — `pay_setting` lives on `itineraries` (the evergreen idea) not `date_instances`
Pay setting is on the itinerary, so every scheduled instance of an idea inherits the same pay setting and a creator can't set "I pay" for one night and "split" for another instance of the same template. Spec treats pay as a property of the date being offered. Minor, but it's a modeling choice that constrains P3's create flow.

---

# WHAT ENGINEERS WILL REGRET LATER

1. **The `ON DELETE CASCADE` web (E1).** Cascading from `auth.users` through `profiles` through every loop table will silently delete real-world commitment history and gut the "immutable audit_log" promise. This is the kind of decision that's a one-line FK now and a multi-week GDPR/retention migration after launch (P9 explicitly needs the opposite).

2. **Two status columns + RLS-writable projections (C4, S2, S3).** `itineraries.match_status` is dead, and `queue_entries.status`/`rank` are directly writable by the creator, so the "DB enforces the invariants" thesis is false for the queue. The first creator who scripts the API can forge `locked` state. Lock writes to RPC-only now or the state machine is decorative.

3. **Tests that pass while guarding nothing (C2, D1, U2).** The offer/lock/audit invariant tests can't run (FK), the feed-blind test checks columns on a view that returns zero rows, and "coarse time" is hour-exact. The plan's green checkmarks will create false confidence that the two flagship invariants are proven when they are not.

4. **`browse_feed` shipped twice (P0 + P4) with the same broken `vibe_tags` reference (C1).** Whoever fixes it must remember to fix it in both, and add the column. A view recreated in a later phase that duplicates an upstream view's column list is a maintenance trap.

5. **Polymorphic `reports.target_id` with no FK (B2).** Moderation tooling (P8) will be built on un-joinable, dangling references and someone will spend a sprint reconstructing what a report pointed at.

6. **No admin authorization primitive (B3).** Every safety/moderation phase will reinvent "how does an admin read this," guaranteeing inconsistency and an eventual security review finding.

---

# REQUIRED ADDITIONAL SCREENS / COMPONENTS

P0 is schema-only, so this section is about **schema/contract artifacts P0 must add (or explicitly hand off) for the product to function**, not literal screens:

- **`itineraries.vibe_tags text[]` (or on `date_instances`)** — required by the feed and spec; without it the night has no vibe and Task 11/P4 don't compile. (C1)
- **Real `auth.users` fixture helper** for `supabase/tests/` so invariant tests can create users — without it no P0 (or P5) DB test that needs a profile can run. (C2)
- **`audit_log.actor_kind` + `audit_log.reason`** columns — spec §7.1/§7.6 require owner *and reason* per transition. (S4)
- **Reciprocal-support index** on `swipes(swiper_id, creator_id) where direction='right'`. (E5)
- **Typed report-target columns / FKs** (`target_user_id`, `target_instance_id`, etc.) replacing bare `target_id`. (B2)
- **A documented admin-authorization predicate/role** (e.g., `profiles.is_admin` or a `claims` convention) and an admin-read path for `reports`/`audit_log`/`verifications`. (B3)
- **A public-read RLS policy on `date_instances` for `status='seeking'`** OR removal of the `anon/authenticated` grant on `browse_feed` with a comment that it's DEFINER-RPC-only. (D1)
- **CHECK constraints:** `locks (creator_id <> matched_user_id)`; `offers (expires_at > created_at)`; city-consistency trigger between `date_instances.city_id`, venue, and itinerary. (E3, E4, B4)
- **Decision on evergreen browsing/swiping** — either model swipes/queue against the evergreen idea or accept that evergreen ideas are not browsable (contradicting §5). (C3)

---

# PRODUCTION READINESS SCORE

**3 / 10.**

Rationale: the architecture is genuinely strong — the two flagship invariants (partial-unique active-offer, GiST overlap-exclusion) are modeled correctly and idiomatically, RLS-on-everything and append-only audit are the right instincts, and the reconciliation with the existing planner schema is mostly sound. **But the plan as written does not apply:** `browse_feed` references a non-existent column (C1) and the invariant tests violate the `profiles→auth.users` FK (C2), so `supabase db reset` fails and the two headline invariants are never actually proven. Layered on top are RLS holes that let creators forge queue/lock state (S3), a cascade strategy that fights the mandated retention phase (E1), a polymorphic report FK trap (B2), and several "passing" tests that guard nothing (D1, U2). These are all fixable in P0 and most are one-to-few lines — but until C1/C2 are fixed the foundation does not stand up, and until S3/E1/B2/S4 are fixed the "invariants live in the DB" promise is partly fiction. Foundational phase, so a low score here is high-leverage to fix now.

# PRIORITY FIX ORDER

1. **C1 — Add `vibe_tags` to the night object and fix the `browse_feed` view.** Unblocks `db reset`/migration. (Also fixes the duplicated break in P4 Task 3.)
2. **C2 — Make test fixtures create real `auth.users` rows (shared helper).** Until this lands, the offer-invariant, lock-overlap, and audit tests cannot run — i.e., the two flagship invariants are unproven. Update the false "Risk note" in Self-Review.
3. **S3 + S2 — Close the `queue_entries` write hole (creator-forgeable `status='locked'`/`rank`).** Make queue/lock state RPC-only or constrain creator writes; otherwise the "DB enforces the lifecycle" thesis is false.
4. **E1 — Replace `ON DELETE CASCADE` on `locks`/`match_ratings`/`reports` (and the audit path) with retention-friendly FKs.** Cheap now, multi-week migration after launch; P9 depends on it.
5. **S4 — Add `actor_kind` + `reason` to `audit_log` and the transition trigger.** Spec §7.1/§7.6 require reason+owner; worker transitions currently log `actor=NULL` indistinguishably.
6. **B2 — Replace polymorphic `reports.target_id` with typed FK columns.** Unblocks P8 moderation joins and survives deletions.
7. **D1 + U2 — Decide the `browse_feed` access model (RLS vs DEFINER-only) and make "coarse time" actually coarse.** Remove the false-confidence in the blind-feed test.
8. **E3/E4/B4/E5 — Add the cheap guards** (`locks` self-lock check, `offers.expires_at` sanity, city-consistency, reciprocal index) while the tables are first being written.
9. **C3/C4 — Resolve evergreen-swipe modeling and drop/justify `itineraries.match_status`.** Prevents P3/P4 building on the wrong column / a non-browsable evergreen.

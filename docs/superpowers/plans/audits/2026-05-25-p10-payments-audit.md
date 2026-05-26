# P10 Payments — Pre-Build Audit

**Auditor stance:** paranoid principal engineer. Plan read in full; cross-referenced spec §4/§8, P0 (`reports`, `browse_feed`), P8 (reports enum/state machine), P7 (`file_report`), P1/P3/P4 (vitest + pay rendering), roadmap. Verdict up front: the plan is *internally* clean and TDD-honest, but it is built on **incorrect assumptions about the cross-phase world it plugs into**, and those assumptions break at execution time. The decision (Option b) is correct. The implementation as written will not compose with P4/P7/P8.

**Score: 5/10** — coherent decision, faithful to spec, but multiple hard SEAM breaks (enum collision, migration ordering, file_report ignorance, contradictory UI copy that the plan's own "single source of truth" claim is supposed to prevent) mean executing it as written produces an inconsistent product. Fixable, but not as drafted.

Issue counts: **3 BLOCKER, 6 MAJOR, 7 MINOR, 4 NIT.**

---

## 1. Dead UI / Buttons With No Backend

- **MAJOR — The `payment_dispute` report category is a button with no wired backend in P10, and the wiring it depends on (P7 `file_report`) cannot write it.** Task 6 Step 1 says "the report sheet offers the `payment_dispute` category … (Task 4 schema)." But P10 ships no API route, no Edge Function, no RPC that inserts a report carrying `reason_category`. The only report-writing path in the whole system is P7's `file_report(p_reporter, p_target_type, p_target_id, p_reason, p_detail)` (P7 line ~1219) — its signature has **no `reason_category` and no `pay_setting_snapshot` parameter**. So a `payment_dispute` filed through the real path lands with `reason_category = NULL`. P10's DB CHECK (`reason_category is distinct from 'payment_dispute' OR target_type in (...)`) is *vacuously satisfied* by NULL, so the "must target a date/lock" invariant never fires for the actual app. The category is functionally dead: the schema (Task 4) and the column (Task 1) exist, but nothing in the running product sets them.

- **MAJOR — `PaySettingBadge` is built but wired by *documentation only*.** Task 6 is "integration notes for P4/P5" with "No new product code." That is acceptable IF the consuming phases honor it — but P4 is **already written and does not** (see §9). A tested component nobody imports is dead UI until P4/P5 are *edited*, and P10 schedules no such edit and lists no dependency back-pressure on P4.

- **NIT — `isBinding: false` literal** is exported but never read by any shipped surface. Harmless forward-hook, but it is dead today.

---

## 2. Missing DB Relationships / Integrity

- **MAJOR — `pay_setting_snapshot` and `target_id` are unenforced free pointers.** `reports.target_id` is a bare `uuid` with no FK (P0 design — `target_type` discriminates across `user`/`date_instance`/`message`/`lock`). P10 adds a CHECK that a `payment_dispute` must have `target_type in ('date_instance','lock')` but **nothing guarantees `target_id` actually exists** in `date_instances` or `locks`, nor that `pay_setting_snapshot` matches the snapshotted night's real `pay_setting`. A client can post `target_type='date_instance', target_id=<random>, pay_setting_snapshot='i_pay'` against a night that was actually `split`. The "snapshot so a later edit can't rewrite history" guarantee (migration comment) is only as honest as the unvalidated client that wrote it. Since there is no server RPC that derives the snapshot from the DB, the snapshot is attacker-controlled.

- **MINOR — `target_type='lock'` ambiguity.** A `payment_dispute` may target a `lock`, but the dispute is between *two* parties; `target_id=lock_id` does not encode *whom* the reporter accuses. P8/P7 will need the accused user to action it (suspend, dispute). The plan never resolves "report references a lock, but the enforcement ladder acts on a *user*." Adjudication target is undefined.

---

## 3. Incomplete Flows

- **BLOCKER — No end-to-end "file a payment dispute" flow exists after P10.** The user journey the plan promises ("they said they'd pay and bailed on the bill" → tracked → routed to moderation/P8 → feeds the P7 ladder) has a hole at every joint: no UI to file it (deferred to P7/P8), no API that sets `reason_category` (P7's RPC can't), and P8's enforcement (§4 below) doesn't recognize the category. P10 closes the *integrity* gap (stop implying a guarantee) but **does not** close the "abuse/expectation problems → trackable & moderatable" half of its own stated goal (roadmap "Closes: pay-setting abuse/expectation problems"). The DB column is necessary but radically insufficient; the plan's Self-Review claims this half is "✅ closed (Tasks 1, 4)" — that is overclaiming.

- **MINOR — "disclosure at publish time" (P3 create flow) is also doc-only.** Task 6 Step 1 says the creator sees `PAY_SETTING_DISCLAIMER` beneath the selector. P3 (already written) `personalize_itinerary` sets `pay_setting` but P3's UI has no disclaimer (not referenced). So the "neither side can claim they were promised payment" guarantee has a missing leg at creation.

---

## 4. Cross-Phase SEAMS (the worst section)

- **BLOCKER — Migration ordering inverts the enum dependency.** P10's migration is `20260525121300`. P8's `reports` state-machine migration is `20260525130200`. **P10 runs BEFORE P8.** That is *fine* for P10 alone (it only touches P0's `reports`, which is `…120900`). BUT the plan's framing ("P8 converts to an enum — does P8's state machine know about payment_dispute?") exposes the real problem: **P8 rewrites `reports.status` to a `report_status` enum and adds a transition guard, but P8 has no knowledge of `reason_category` at all.** P8's `guard_report_transition()` and its moderator RPCs (`set_report_status`, `resolve_report`) never read, branch on, or preserve `reason_category`. A `payment_dispute` is indistinguishable from `harassment` in the P8 console/queue — there is no priority, no routing, no filter by category. The seam "compiles" (no SQL error) but is **semantically broken**: P10 invents a triage dimension P8's triage machine ignores.

- **BLOCKER — `report_reason_category` enum is defined twice across phases and they will diverge.** P10 creates `report_reason_category` with 8 labels including `no_show`, `impersonation`, `spam`. Meanwhile P7's `file_report` writes free-text `reason` values like `'harassment'`, `'safety_sos'`, `'unsafe_or_disrespectful'`, `'threat'`, `'assault'`, `'disputed_no_show'`, `'safety'` (P7 lines 1228, 985–987, 1104). **None of these strings are in P10's enum** (`harassment` matches; `safety` matches; but `safety_sos`, `unsafe_or_disrespectful`, `threat`, `assault`, `disputed_no_show` do NOT). Two parallel taxonomies now exist: a `reason text` vocabulary (P7, load-bearing for `evaluate_standing` and `can_rematch`) and a `reason_category` enum (P10, load-bearing for nothing yet). The Zod `ReportReasonCategorySchema` (Task 4) is a *third* copy. The plan's headline claim — "single source of truth … never duplicated" — is violated for the report taxonomy itself. When P8/P7 eventually try to unify, P10's enum will be missing the safety classes and will need an `ALTER TYPE ADD VALUE` migration nobody has planned.

- **MAJOR — `pay_setting_snapshot payment_preference`: P10 assumes P0's enum is named `payment_preference`.** Confirmed correct (P0 line 132). Good — but the column add is *unconditional* `create type report_reason_category` (NOT `if not exists` — Postgres `CREATE TYPE` has no `IF NOT EXISTS`). If any re-run or a future phase also defines it, `supabase db reset` is fine (fresh DB) but a partial/repeated apply throws `type already exists`. Low probability under `db reset`, but the plan's own "idempotent" convention (stated in Conventions block) is broken here — the column adds are idempotent, the type create is not, and the CHECK constraint add (`add constraint reports_payment_dispute_targets_date`) is **not** guarded and will throw `already exists` on any re-apply.

- **MINOR — P4 also re-introduces vitest at repo root; P1 *owns* it; P10 introduces it a third way (per-package).** See §10. This is a three-way seam on test tooling.

---

## 5. Undefined Edge Cases (the heart of "infer the consequences")

- **MAJOR — "Renegotiable/cancellable post-lock without penalty" (spec §4) has no surface or rule in P10.** The spec explicitly says the pay setting can be *renegotiated after lock*. P10's disclaimer ("sort the bill out together in person") gestures at this but the product has **no place to record a renegotiation**, and worse: the `pay_setting_snapshot` freezes "what was advertised at report time" — so if two people lock under "I pay," then mutually agree to split in person (a *legitimate, spec-blessed* renegotiation), and one later files a `payment_dispute`, the snapshot shows `i_pay` and frames the other as bad-faith when both consented to change it. **The snapshot weaponizes a spec-sanctioned renegotiation into evidence of abuse.** Undefined and actively misleading.

- **MAJOR — Pay-bait abuse is named in the goal but not defended.** The stated problem (line 5): "publish 'I pay,' lock a night, then not pay." Option (b) explicitly accepts non-enforcement — fine. But the *only* deterrent is a `payment_dispute` report that (per §1/§4) goes nowhere actionable. There is no link from a `payment_dispute` to P7's reliability score (`evaluate_standing` reads only `reason in ('unsafe_or_disrespectful','safety_sos','harassment')`), so a serial pay-baiter accrues disputes with **zero reliability/standing consequence**. The "feeds the enforcement ladder (P7)" claim (line 48, 717) is false against the actual P7 code. Pay-bait remains fully unpunished and the plan asserts otherwise.

- **MINOR — "One party claims the other didn't pay" with no money system to adjudicate.** Correctly out of scope for Option (b), but the dispute lands in P8's queue with no resolution playbook, no `dispute_outcome` that maps to "money," and `dispute_kind` enum (P8 line 521: `no_show|rating|conduct_flag|other`) has **no `payment` kind**. A moderator can only file it under `other`. Undefined resolution path.

- **MINOR — `split` / "50-50" disputes are nonsensical to track.** "They didn't pay their half" is a he-said/she-said with no proof artifact (no check-in equivalent for bills). The plan tracks it identically to a broken "I pay" promise. No differentiation.

- **NIT — Null/unset pay setting on a published night.** P3 leaves `pay_setting` nullable and "creator chooses during personalization" (P3 line 1088). A night can be browsed (P4) and locked (P5) with `pay_setting = NULL`. `PaySettingBadge` renders nothing (correct), but then **no disclaimer appears anywhere** for a NULL-pay night — which is fine, except the create flow never forces a choice, so the "expectation honesty" framing silently vanishes for nights with no setting. Acceptable, but undocumented.

---

## 6. Loading / Error / Empty States

- **MINOR — `PaySettingBadge` has only an empty state (null → renders nothing).** No loading/error states needed (pure prop render) — acceptable. But the *report* side (file payment dispute) has zero error/loading/success UX defined because the flow itself is deferred. When P7/P8 build it, there's no spec for "dispute filed" confirmation, "you already disputed this night" (dedupe), or rate-limit feedback (P8 rate-limits `report: 20/hr`).

- **NIT — No empty/"no disputes" state** defined for the (future) moderator view of payment disputes. Deferred to P8, but P8 doesn't know the category exists (§4).

---

## 7. State Ownership / Auth

- **MAJOR — Who owns writing `reason_category`?** P10 says validators (client) + "API" enforce it ("nullable for backward-compat … new writes set it (enforced in validators/API)"). But there is **no API in P10**, and the real write path (P7 `file_report`, a `SECURITY DEFINER` RPC) is the *only* thing allowed to insert into `reports` under P0/P7 RLS (reporter-insert policy exists, but P7 routes through the definer function). Ownership is claimed by a layer that doesn't exist. Either P10 must extend `file_report`'s signature (cross-phase edit it doesn't schedule) or add its own RPC. Unowned write = the column stays NULL in production (§1).

- **MINOR — RLS read of `payment_dispute` reports.** P0/P8: reports are default-deny select (admin/service-role only). Correct for moderation. But the *reporter* cannot see their own filed dispute or its status — P8 note defers "reporter-read of own report" to P7/P9. So a user files a pay dispute into a black hole with no status visibility. Consistent with current design, but worth flagging as a trust gap for a *payment* grievance specifically.

---

## 8. Inconsistent Business Rules / "Non-Binding Framing Everywhere?"

- **MAJOR — The disclaimer does NOT appear everywhere `pay_setting` renders. It appears in exactly one component that exactly one (unwritten) integration will use.** The audit prompt's specific test — "does the non-binding framing actually appear everywhere pay_setting renders — feed, creation, offer, lock, post-date?" — fails:
  - **Feed (P4):** renders its OWN inline string (P4 line 1081), no disclaimer, and *contradictory labels* (§9). Does not import `PaySettingBadge`.
  - **Creation (P3):** sets `pay_setting`, no disclaimer in UI.
  - **Offer/reveal (P5):** P5 has **zero** `pay_setting` references at all (grep found none) — the highest-intent moment shows nothing about pay, disclaimer or otherwise.
  - **Lock / post-date:** no pay rendering defined anywhere.
  So the disclaimer lives in 1 of ~5 surfaces, and that 1 is not yet wired. The plan's Self-Review "✅ every pay-setting surface now carries an explicit non-binding disclaimer" is **false**.

---

## 9. Contradictions (vs spec §4, vs sibling plans)

- **BLOCKER-adjacent / MAJOR — P4 and P10 ship *contradictory pay labels*, and P10's whole thesis is "single source of truth so framing never drifts."** P10: `i_pay → "I pay"`, `they_pay → "They pay"`, `split → "50-50"` (from the creator's POV, matching spec §4 verbatim). P4 feed card (line 1081): `i_pay → "They treat"`, `they_pay → "Your treat"` (browser's POV) , `split → "50-50"`. These are **opposite mappings** (P4 flips `i_pay`/`they_pay` because the browser is the counterparty). Neither is "wrong" in isolation — but they coexist, contradict the spec's literal strings, and **prove the copy module is already not the single source of truth.** A `PaySettingBadge` dropped into P4's card (as Task 6 instructs) would render "I pay" right next to/replacing P4's "They treat" — directly conflicting, confusing the browser about who pays. P10 never reconciles creator-POV vs browser-POV labeling; this is a genuine product correctness bug, not just style.

- **MINOR — Spec §4 says "Payment-related reports are tracked"; P10 satisfies the *letter* (a column exists) but not the *intent* (tracked → reviewed → consequence). See §4/§5.** Defensible scoping, but the plan claims full fidelity.

- **NIT — Disclaimer copy uses a curly apostrophe (`doesn’t`) in `PAY_SETTING_DISCLAIMER`** while the test matches `/isn't binding/` with a straight apostrophe in one branch. Not a bug (different words), but mixed quote styles in load-bearing copy invite future mismatch.

---

## 10. Tooling / vitest Duplication / Design-Intent-vs-Tasks Gaps

- **BLOCKER — vitest is "introduced here" in P10, but P1 already owns and establishes the root vitest harness, and P4 also (re)wires it.** P10 line 11/198: "vitest (introduced here — the repo has no test runner yet)." **False if P1 ran first** — P1 Task 0 line 80: "P1 owns the JS/TS test runner … This task adds vitest at the workspace root." P4 Task 1 also wires vitest. Three plans each believe they introduce vitest:
  - **P1:** root `vitest.config.ts` (workspace projects, discovers `src/**/*.test.ts`).
  - **P4:** root `vitest.config.ts` "(repo root, only if missing)" + per-package `test` scripts.
  - **P10:** **per-package** `vitest.config.ts` in `packages/business`, `packages/validators`, `apps/web` with `include: ['test/**/*.test.ts']`.
  Conflicts: (a) P1's root config discovers `src/**/*.test.ts`; P10 puts business/validators tests in `test/**` (sibling to `src`) — **P1's harness will not find P10's tests** and P10's per-package config will *shadow/compete* with the root one. (b) P10 pins `vitest ^2.1` independently; P1/P4 may pin differently → lockfile churn / peer conflicts. (c) P10's web tests live in `components/**/*.test.tsx`; P1's root config likely won't include `apps/web` jsdom env. **If P1 lands first, P10 Task 2 is wrong; if P10 lands first, P1/P4 collide with it.** The plan must detect-and-extend, not "introduce."

- **MAJOR — Migration filename band collision across P4/P7/P8 (context for P10's ordering claim).** P10 correctly uses `…121300` (after P0's `…1211xx`). But note for whoever sequences: **P4, P7, and P8 ALL start at `20260525130000`** (`p4_date_instance_geo`, `p7_match_ratings_reveal`, `p8_admin_users` — identical timestamp prefixes). Supabase applies migrations in lexicographic filename order; three files cannot share `20260525130000_*` cleanly and the band overlaps (P4 `1300xx–1303xx`, P7/P8 `1300xx–1309xx`). P10 is *not* the collision source, but its "Conventions" claim to be a well-ordered citizen is undermined by a roadmap whose later phases are not orderable. Flag so P10's reviewer doesn't assume the broader migration timeline is sound.

- **MINOR — `apps/web/typecheck` script assumed to exist** (Task 5 Step 5, Task 6 Step 4: `pnpm --filter @after5/web typecheck`). Plan never verifies the script exists; if absent, the step errors. Same for `pnpm db:types` (Task 6 Step 5) — assumed present (P0 references it, plausible) but unverified here.

- **MINOR — Smoke-test file created then `rm`'d (Task 2 Step 4)** is fine, but if committed-before-delete fails midway the repo has a stray test. Trivial.

- **NIT — `@testing-library/react ^16` + React 19 + `@vitejs/plugin-react ^4.3`** peer ranges are plausible but unpinned-against-lockfile; the Self-Review even pre-acknowledges possible peer conflict. Acceptable risk, called out honestly.

---

## TOP 3 MUST-FIX (blockers)

1. **Unify the report taxonomy or P10's enum is dead-on-arrival.** Reconcile P10's `report_reason_category` with P7's free-text `reason` vocabulary and P8's state machine *before* building. Either (a) P7's `file_report` and P8's RPCs must learn `reason_category` (so writes set it and triage reads it), or (b) P10 must defer the enum until P8 owns a unified category model. As drafted, three taxonomies diverge and P8 can't see `payment_dispute`.

2. **Provide a real write path + integrity for `payment_dispute`, or scope the goal down honestly.** No shipped RPC/API sets `reason_category`/`pay_setting_snapshot`, `target_id` has no FK, and the snapshot is attacker-controlled and weaponizes spec-blessed renegotiation. Either extend `file_report` (server-derived snapshot, validated target) and link disputes to P7 standing, or remove the "tracked/moderatable/feeds the ladder" claims from the goal and Self-Review.

3. **Make the disclaimer actually appear everywhere — and reconcile the contradictory P4 labels.** Today the framing renders in 1 of ~5 surfaces; P4 ships opposite labels ("They treat"/"Your treat") that conflict with P10's spec-literal labels, and P5 shows no pay info at all. Resolve creator-POV vs browser-POV labeling in the single source-of-truth module, and turn Task 6 from "documentation" into scheduled edits to P3/P4/P5 (with tests), or the "single source of truth / non-binding everywhere" thesis is false.

**Also fix before merge (vitest seam, BLOCKER #4-equivalent):** P10 must *extend* P1's existing root vitest harness, not "introduce" a competing per-package one with a `test/**` include P1's config won't discover.

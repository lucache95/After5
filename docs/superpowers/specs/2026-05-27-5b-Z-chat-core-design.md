# Sub-project Z — Chat-core primitives (5b) — Design

**Sub-project:** Phase 5b § Z (overview spec `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md` §1 Z, §2.4)

**Status:** Brainstorm complete. This spec is the contract that Z's implementation plan executes against. Phase 5b prereq for sub-project A.

**Date:** 2026-05-27.

---

## 1. Context & scope reduction

Task 0 verification (`docs/superpowers/plans/5b-prod-migration-rollout.md` § Step 2) surfaced that `20260525124500_p2_chat_core` already shipped during the S2 cutover. **All four primitive RPCs and the `chat_threads` table are already on prod.** Z's scope is therefore an amendment + test-completion job, not a fresh build.

**What already exists on prod (`ufufmcpnysvwtutpbian`):**

- Table `chat_threads(id uuid PK, offer_id uuid NOT NULL UNIQUE FK→offers, lock_id uuid NULL FK→locks, state text CHECK in 'open'|'promoted'|'closed' default 'open', both_ready bool default false, legal_hold bool default false, revoked_at timestamptz, created_at, updated_at)`.
- RLS enabled with **zero policies** (default-deny — only SECURITY DEFINER paths can read/write).
- Function `open_chat_thread(p_offer uuid) → uuid` — idempotent on `offer_id` via `ON CONFLICT … DO UPDATE SET updated_at=now()`.
- Function `chat_lock_ready(p_thread uuid) → boolean` — currently `coalesce(both_ready, false)`. Returns **false** by default at 5b launch. **This is the blocking gap Z fixes.**
- Function `promote_chat_thread_to_lock(p_offer uuid, p_lock uuid) → void` — atomic, fail-loud on `row_count=0`.
- Function `close_chat_thread(p_offer uuid) → void` — `WHERE state='open' AND NOT legal_hold` (no-op on already-closed, no-op on promoted, no-op on held).
- Trigger `chat_threads_block_held_delete` — blocks delete when `legal_hold=true` (C9 retention).
- All four RPCs are `SECURITY DEFINER` + `REVOKE EXECUTE FROM public, authenticated`.
- Test file `supabase/tests/p2_chat_core.sql` covers 8 functional behaviors (idempotency, gate semantics, promote+missing-row raise, close-state-guard, close-revoked_at, legal-hold delete-block).

**What the overview spec § Z prescribed but prod does NOT have:**

- `participants uuid[2] NOT NULL` column — prod derives participants via `offer_id → offers.creator_id + offers.candidate_id`.
- `chat_thread_state` enum type — prod uses `text + CHECK`.
- Separate `closed_at` and `promoted_at` columns — prod uses `revoked_at` (on close) + generic `updated_at`.
- Participant-SELECT RLS policy — prod has RLS-enabled-with-zero-policies (default-deny).

**Reconciliation decision (brainstorm Q1, "Hybrid"):** accept prod's shape as the canonical 5b shape. Amend the overview spec § Z deliverables list to match prod. Add **only the column 5b's analytics actually needs** (`promoted_at`). Defer enum upgrade, `participants[2]` column, and participant-read RLS policy to Phase 7 (or never — they may not be needed).

**Resulting Z scope (3 migrations + test updates + spec amendment):**

1. **Z.1** — amend `chat_lock_ready` body to state-based predicate.
2. **Z.2** — add `chat_threads.promoted_at` column + amend `promote_chat_thread_to_lock` to set it.
3. **Z.3** — race-test harness (bash, two-session) for concurrent open/close.
4. **Z.tests** — update `supabase/tests/p2_chat_core.sql` to reflect new `chat_lock_ready` semantics + add negative-RLS DO block + add `auth.uid()`-revocation test.
5. **Z.spec-amend** — update `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md` § Z deliverables to match the as-built prod shape (no more lying about `participants[2]` etc.).

---

## 2. Architecture & components

### 2.1 — Table shape (final, post-Z)

```sql
chat_threads(
  id            uuid PK default gen_random_uuid(),
  offer_id      uuid NOT NULL UNIQUE FK→offers(id) ON DELETE CASCADE,
  lock_id       uuid NULL FK→locks(id) ON DELETE SET NULL,
  state         text NOT NULL CHECK (state IN ('open','promoted','closed')) DEFAULT 'open',
  both_ready    bool NOT NULL DEFAULT false,       -- rapport gate (Phase 7 wires real semantics)
  legal_hold    bool NOT NULL DEFAULT false,       -- C9 retention guard
  revoked_at    timestamptz NULL,                  -- C9 tombstone, set on close
  promoted_at   timestamptz NULL,                  -- NEW in Z.2 — set when state→'promoted'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now() -- bumped by set_updated_at trigger
)
```

Indexes (unchanged from existing): `chat_threads_offer_uniq UNIQUE (offer_id)`, `chat_threads_lock_idx (lock_id)`.

### 2.2 — State machine (canonical, post-Z)

```
   (no row)  ──open_chat_thread──►  open  ──promote_chat_thread_to_lock──►  promoted
                                     │
                                     └──close_chat_thread──►  closed
```

Invariants:

- **Idempotency**: `open_chat_thread(p_offer)` called twice returns the same `chat_threads.id` (UNIQUE on `offer_id` + `ON CONFLICT DO UPDATE`).
- **State guards**:
  - `promote_chat_thread_to_lock` only succeeds when a row exists for `p_offer`; raises if no row (preserves A's correctness contract — A must call `open_chat_thread` first).
  - `close_chat_thread` no-ops on `promoted` (state guard via `WHERE state='open'`) — accepted offers must NEVER lose their thread record.
  - `close_chat_thread` no-ops on `closed` (idempotent re-close).
  - `close_chat_thread` no-ops on `legal_hold=true` (C9 retention).
- **Legal-hold guard**: trigger blocks `DELETE` when `legal_hold=true`. Profile-deletion cascades via `offer_id → offers → profiles` would otherwise silently destroy held threads; the trigger raises.

### 2.3 — `chat_lock_ready` semantics (Z.1 amendment, Option C from brainstorm)

**Before Z.1** (current prod, returns false at launch):

```sql
CREATE OR REPLACE FUNCTION chat_lock_ready(p_thread uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT both_ready FROM chat_threads WHERE id = p_thread), false);
$$;
```

**After Z.1** (returns true while thread is open, false after promote/close, false for missing thread):

```sql
CREATE OR REPLACE FUNCTION chat_lock_ready(p_thread uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT state = 'open' FROM chat_threads WHERE id = p_thread), false);
$$;
```

**Why Option C (state-based predicate) over Options A/B from the runbook:**

- **vs. Option A (`SELECT TRUE`)**: Option C retains the safety check for missing threads (a typo'd UUID in A's accept path returns false, fails the gate, raises P5005 — fail-loud). Option A would return true for any UUID, including non-existent ones.
- **vs. Option B (data-flip `both_ready=true` on open)**: Option C avoids leaving a misleading column (`both_ready=true` for every thread at launch); Phase 7 doesn't have to untangle data state to redefine semantics.
- **Forward-compat with Phase 7**: Phase 7 adds a real rapport gate via single `CREATE OR REPLACE`:
  ```sql
  SELECT coalesce((
    SELECT state = 'open' AND both_ready  -- both_ready becomes meaningful in Phase 7
    FROM chat_threads WHERE id = p_thread
  ), false);
  ```
  No data migration. No signature change. A's call site (`Z.chat_lock_ready(thread_id)`) is unchanged.

**Tested with all four state combos**:
- `state='open'` → true
- `state='promoted'` → false
- `state='closed'` → false
- no row → false

### 2.4 — `promoted_at` column + promote state-filter hardening (Z.2)

Add a nullable `timestamptz` column AND tighten promote's UPDATE with a `state='open'` filter (closes a real partial-state race surfaced during spec review — see § 7.1 R-Z4):

```sql
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS promoted_at timestamptz;
-- Backfill on prod: none needed (zero rows currently).
-- Local: any thread already in state='promoted' from test runs gets coalesce(updated_at).
UPDATE chat_threads SET promoted_at = updated_at WHERE state='promoted' AND promoted_at IS NULL;

CREATE OR REPLACE FUNCTION promote_chat_thread_to_lock(p_offer uuid, p_lock uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_n int;
BEGIN
  UPDATE chat_threads
     SET lock_id = p_lock,
         state = 'promoted',
         promoted_at = coalesce(promoted_at, now()),
         updated_at = now()
   WHERE offer_id = p_offer
     AND state = 'open';                -- NEW guard: refuses promote on closed/already-promoted
  GET DIAGNOSTICS v_n = row_count;
  IF v_n = 0 THEN
    -- Distinguish missing thread vs wrong-state thread for caller's translation
    IF NOT EXISTS (SELECT 1 FROM chat_threads WHERE offer_id = p_offer) THEN
      RAISE EXCEPTION 'promote_chat_thread_to_lock: no chat thread for offer %', p_offer;
    ELSE
      RAISE EXCEPTION 'promote_chat_thread_to_lock: thread for offer % is not open', p_offer;
    END IF;
  END IF;
END $fn$;
REVOKE EXECUTE ON FUNCTION promote_chat_thread_to_lock(uuid, uuid) FROM public, authenticated;
```

Why include `promoted_at`:

- 5b's analytics events (`analytics_events`) need a per-promotion timestamp distinct from `updated_at` (which is bumped by any state change, including close). Easier to read `promoted_at IS NOT NULL` than to reconstruct from event log.
- Phase 7 will likely need it for rapport-to-promotion latency metrics.
- Cost is one column + a backfill UPDATE; no risk surface.

Why the state filter:

- Without `AND state = 'open'`, a `close_chat_thread` running between A's `chat_lock_ready` check and A's `promote` call would set `state='closed', revoked_at=now()`; then promote would blindly overwrite `state='promoted'` while leaving `revoked_at` set — partial state. With the filter, promote's UPDATE matches zero rows and raises; A catches and translates to an offer-expired errcode (B's `match_expire_offer` would be the close caller).
- Distinguishing "no thread" from "thread not open" lets A's match_accept_offer translate appropriately: the first is a programmer bug (should never happen), the second is a legitimate race losing.

### 2.5 — Auth model (clarification, no code change)

Z's functions are **NOT public**. They are `SECURITY DEFINER` with `REVOKE EXECUTE FROM public, authenticated`. The only callers are A's `SECURITY DEFINER` match_* RPCs, which themselves check `auth.uid() = p_actor` per invariant §2.5 #7.

**Z does NOT take a `p_actor` parameter. Z does NOT call `auth.uid()`.**

This contradicts the master-roadmap Task 1 acceptance criterion that said "All four functions check `auth.uid()=p_actor` per C10." The acceptance criterion is wrong for Z's design — invariant §2.5 #7 says "every **public** RPC re-checks," and Z's RPCs are not public. The roadmap acceptance criterion will be amended to match (see § 5 amendment list).

Z's defense-in-depth instead consists of:
1. `REVOKE EXECUTE … FROM public, authenticated` ensures no client (anon, authenticated, service_role-spoofing) can call directly.
2. `SECURITY DEFINER` runs as the function owner (postgres/supabase), bypassing RLS for the callers' benefit — but the caller must itself be trusted (only A's RPCs).
3. Negative test verifies the REVOKE: `SET ROLE authenticated; SELECT open_chat_thread(...)` MUST raise `permission denied` (catch via `EXCEPTION WHEN insufficient_privilege`).

### 2.6 — Tests (Z's deliverable, post-Z.1+Z.2)

**Update `supabase/tests/p2_chat_core.sql` in place** (per brainstorm Q3):

- Drop the `update chat_threads set both_ready = true` lines — no longer needed.
- Change assertion "lock gate should be closed before rapport" → "lock gate is open until promote/close."
- Add assertions for all 4 state combos of `chat_lock_ready`: open=true, promoted=false, closed=false, missing=false.
- Add a negative-authz DO block: `SET LOCAL ROLE authenticated;` then `BEGIN; PERFORM open_chat_thread(uuid); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;` — must catch.
- Add a negative-RLS DO block: as `authenticated`, `SELECT * FROM chat_threads` MUST return 0 rows even if rows exist (default-deny via RLS-enabled-no-policies).
- Add a `promoted_at` assertion: post-promote, `promoted_at IS NOT NULL` and `promoted_at >= created_at`.

**Add new file `supabase/tests/z_chat_thread_races.sh`** (bash, two-session race harness):

- Spawn two concurrent `psql` sessions against the local Supabase DB.
- **Race 1 (concurrent open):** both sessions call `open_chat_thread(same_offer)` simultaneously. Expected: both return the same UUID (one inserts, the other hits `ON CONFLICT DO UPDATE`).
- **Race 2 (concurrent promote-vs-close):** one session calls `promote_chat_thread_to_lock(offer, lock)`, the other calls `close_chat_thread(offer)`, started near-simultaneously. With Z.2's state-filter hardening, the outcome is deterministic: whichever statement acquires the row lock first wins. If promote wins → state='promoted' and close's WHERE filter (`state='open'`) matches 0 rows → close no-ops. If close wins → state='closed', revoked_at set, then promote's WHERE filter (`state='open'`) matches 0 rows → promote raises `thread for offer % is not open`. **No partial state in either ordering.** Test asserts: final state is one of {'promoted', 'closed'} (never anything else); `revoked_at IS NULL` iff state='promoted'.
- **Race 3 (concurrent close-on-promoted):** seed a promoted thread, run two concurrent close calls. Expected: both no-op (state guard).

Race harness is bash because PostgreSQL single-session can't simulate true concurrency for advisory locks / row-level locks. Pattern lifted from S5 (and reused by A's `p5_concurrency_lib.sh`). File naming follows the `*.sh` convention.

### 2.7 — Overview spec amendment (Z.spec-amend)

After Z.1 + Z.2 + tests land, amend `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md` § Z deliverables list:

- Strike: `participants uuid[2] NOT NULL`, `chat_thread_state` enum, separate `closed_at`/`promoted_at` (replace with single `promoted_at` + retain `revoked_at` for close).
- Strike: "participants can SELECT their own threads."
- Add: `both_ready`, `legal_hold`, `revoked_at` columns (already on prod, owned by C9 retention).
- Add: "RLS-enabled-with-zero-policies (default-deny). Participant-read policy is Phase 7's responsibility."

This amendment is a documentation-only commit. No prod impact.

---

## 3. Data flow (Z's seam-to-A contract)

```
A.match_make_offer(actor, instance, candidate, idem_key)
  └─► Z.open_chat_thread(offer_id)
        └─► returns thread_uuid  ─────────────► A stores nothing; reads via offer→thread join

A.match_accept_offer(actor, offer, idem_key)
  ├─► Z.chat_lock_ready(thread_uuid)
  │     └─► returns true (state='open') ──────► A proceeds to lock creation
  │                                              (Z's predicate enforces "thread exists + still open")
  ├─► create lock row (GiST exclusion gate)
  └─► Z.promote_chat_thread_to_lock(offer, lock)
        └─► sets state='promoted', lock_id, promoted_at ───► returns void

B.match_pass_offer / B.match_expire_offer (on a still-open offer)
  └─► Z.close_chat_thread(offer)
        └─► sets state='closed', revoked_at ───► returns void
```

**No A→Z return data beyond what's shown.** Z holds the canonical thread state; A consumers join `offers→chat_threads` for reads.

---

## 4. Error handling

Z's functions raise on contract violations:

| Function | Error condition | Raise | A's translation |
|---|---|---|---|
| `open_chat_thread` | invalid `offer_id` FK | foreign_key_violation | A wraps in P5001-equivalent (shouldn't happen — A creates the offer first in the same transaction) |
| `promote_chat_thread_to_lock` | no row for `p_offer` | `RAISE EXCEPTION 'promote_chat_thread_to_lock: no chat thread for offer %'` | Bubbles up — A's accept path should never call promote without first opening; failure is a programmer bug, not user input |
| `close_chat_thread` | n/a (silent no-op on all guard paths) | — | — |
| `chat_lock_ready` | n/a (predicate never raises; returns false for missing/promoted/closed) | — | A treats `false` as `P5005 chat_not_ready` |

Z does NOT emit P5xxx errcodes itself — Z is below the P5 error surface. A's match_accept_offer translates `chat_lock_ready=false` into `P5005 chat_not_ready`.

**Legal-hold delete attempt** (P9/S10 territory, not 5b): trigger raises `chat_thread % is under legal hold and cannot be deleted`. Not Z's responsibility to translate; S10's deletion path catches.

---

## 5. Testing strategy & acceptance criteria

### 5.1 — Test files

| File | Scope | Run via |
|---|---|---|
| `supabase/tests/p2_chat_core.sql` (UPDATED) | Functional + negative-authz + negative-RLS + state-machine + promoted_at + all 4 lock-ready combos | `psql -f` (single-session) |
| `supabase/tests/z_chat_thread_races.sh` (NEW) | Concurrent open / promote-vs-close / close-on-promoted | `bash` (multi-session) |

### 5.2 — Acceptance criteria (replaces roadmap Task 1 acceptance criteria)

The master roadmap's Task 1 acceptance criteria assumed Z was a fresh build. They are amended here (a separate commit will update the roadmap to point at this spec instead of re-listing):

1. **Table shape final**: `chat_threads` has the exact columns listed in §2.1, including new `promoted_at`. Verified via `information_schema.columns`.
2. **`chat_lock_ready` semantics**: returns true iff `state='open'`. Tested with all 4 state combos + missing-row.
3. **Idempotency**: `open_chat_thread` called twice on same offer returns same uuid; no second row inserted.
4. **Promote atomicity + fail-loud**: `promote_chat_thread_to_lock` sets `state='promoted', lock_id, promoted_at` atomically. Raises if no row exists for offer.
5. **Close state guard**: `close_chat_thread` no-ops on `state IN ('promoted','closed')` and on `legal_hold=true`. Sets `state='closed', revoked_at` only on `state='open' AND NOT legal_hold`.
6. **Auth boundary**: SECURITY DEFINER + REVOKE FROM public,authenticated. Negative test confirms `authenticated` role gets `insufficient_privilege` on direct call. **Z does not check `auth.uid()=p_actor`** — that's A's contract upstream (invariant §2.5 #7 applies to public RPCs only).
7. **RLS default-deny**: `authenticated` role SELECT on `chat_threads` returns 0 rows (RLS enabled, no policies). Participant-read policy is **out of scope for Z**; deferred to Phase 7.
8. **Race correctness**: `z_chat_thread_races.sh` exits 0. Concurrent open → same uuid; concurrent promote-vs-close → deterministic final state; concurrent close-on-promoted → both no-op.
9. **Migrations applied to prod**: Z.1 + Z.2 applied via runbook's per-migration discipline; security advisor GREEN; runbook "Applied to prod" log updated.
10. **Overview spec amended**: § Z deliverables match prod shape; old bullets (participants[2], enum, separate closed_at, participant-read RLS) struck or moved to "Phase 7 expansion."

### 5.3 — Run-all integration (foreshadowing H)

H's `_all_5b.sh` will include:

```bash
psql ... -f supabase/tests/p2_chat_core.sql || exit 1
bash supabase/tests/z_chat_thread_races.sh || exit 1
```

Both must exit 0 on every CI run.

---

## 6. Deliverables summary

| ID | Type | Path / scope |
|---|---|---|
| Z.1 | Migration | `supabase/migrations/20260527124551_z_chat_lock_ready_5b_launch.sql` |
| Z.2 | Migration | `supabase/migrations/20260527124552_z_chat_threads_promoted_at.sql` |
| Z.tests-a | Test update | `supabase/tests/p2_chat_core.sql` (drop both_ready manip + 4-combo lock_ready + negative-authz + negative-RLS + promoted_at) |
| Z.tests-b | New test | `supabase/tests/z_chat_thread_races.sh` (bash two-session race harness) |
| Z.runbook-log | Apply log update | `docs/superpowers/plans/5b-prod-migration-rollout.md` "Applied to prod" log (two entries) |
| Z.spec-amend | Doc amendment | `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md` § Z deliverables list |
| Z.roadmap-amend | Doc amendment | `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md` Task 1 acceptance criteria (point at this spec) |

Total: 2 migration files, 2 test files (1 updated + 1 new), 3 doc updates.

---

## 7. Risks & out-of-scope

### 7.1 — Z's risks

- **R-Z1 (low)**: spec amendment (§7) is one commit but touches an upstream document; downstream sub-projects already brainstormed against the old § Z text would see a different deliverable list. Mitigation: spec amendment is just a list strike; the contract surface in overview spec §3 (Z row) is unchanged.
- **R-Z2 (low)**: existing test in `p2_chat_core.sql` runs as part of S2's test pass on CI today (if CI runs all tests). Updating it in-place will break CI for one commit if the migration hasn't applied locally. Mitigation: order Z's commits as `Z.1 → Z.2 → tests-a → tests-b`; each commit leaves CI green.
- **R-Z3 (low)**: race test in bash may flake under heavy local CPU pressure. Mitigation: use `psql --set ON_ERROR_STOP=1` + explicit `BEGIN; SELECT pg_sleep(0.05); ...; COMMIT;` style + retry-once-on-flake (NOT retry-forever) inside the harness. If still flaky, mark as `@flaky` and route to manual verification.
- **R-Z4 (was latent in prod, fixed by Z.2)**: the existing `promote_chat_thread_to_lock` had no state filter on its UPDATE. Concurrent close-then-promote produced partial state (`state='promoted'` overwriting close's UPDATE while `revoked_at` remained set). Z.2's state-filter UPDATE closes this. Race test Race-2 (§2.6) verifies. Discovered during this spec's self-review.

### 7.2 — Out-of-scope (defer to Phase 7 or never)

- `participants uuid[2]` column — defer (derived path works fine).
- Enum type for `state` — defer (text+CHECK is functionally equivalent).
- Separate `closed_at` column — defer (`revoked_at` handles it).
- Participant-read RLS policy — Phase 7's job (per the source comment in existing `20260525124500_p2_chat_core.sql`).
- Adding `'ready'` substate to the state machine — Phase 7's job; Z's predicate body is the only thing it has to amend.
- `both_ready` semantic redefinition — Phase 7's job.
- Chat messaging UI / message persistence / Realtime channels — Phase 7's job (out-of-scope per overview spec §5.3).

---

## 8. Open questions

None. All brainstorm questions resolved:

- **Q1 (shape reconcile)** → Hybrid (this spec).
- **Q2 (chat_lock_ready body)** → Option C (state-based predicate, §2.3).
- **Q3 (test layout)** → Update existing in place + new race file (§2.6, §5.1).
- **Q4 (RLS policy)** → Defer to Phase 7. Default-deny via RLS-enabled-no-policies satisfies acceptance criterion §5.2 #7.
- **Q5 (`p_actor` parameter)** → Not added at Z layer (§2.5). A's RPCs enforce auth one level up.
- **Q6 (promoted_at)** → Ship (§2.4). Analytics benefit + Phase 7 readiness.

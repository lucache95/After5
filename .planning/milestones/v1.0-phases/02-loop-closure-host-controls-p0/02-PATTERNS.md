# Phase 2: Loop Closure & Host Controls (P0) - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 16 (new migrations + modified edge handlers/tests + notif-map + UI + api-client + cron route)
**Analogs found:** 16 / 16 (every surface has a verified in-repo analog — this is a copy-not-invent phase)

> **Read first (executor):** every excerpt below is from the LIVE codebase with exact line numbers. The canonical DEFINER exemplar is `match_make_offer` (`supabase/migrations/20260527126300_p5_make_offer.sql`). Copy its skeleton verbatim and trim steps you don't need. All migrations apply to LOCAL only this phase; regen types (`pnpm db:types`), run `mcp__supabase__get_advisors type=security`, PROD APPLY STAYS GATED.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `…_e5_loop_completion.sql` (sweep RPC + no_show RPC + `date_match_status` 'expired' + `notification_type` additive) | migration / RPC | batch + event-driven | `match_make_offer` (DEFINER) + `close_rating_window` (service-role stale-tolerant sweep) + `gated_inbox_notification_types` (additive enum) | exact (composed) |
| `…_e6_cancel_night.sql` (`cancel_night` DEFINER) | migration / RPC | request-response + event-driven (notify) | `match_make_offer` | exact |
| `…_e7_update_night.sql` (`update_night` DEFINER) | migration / RPC | request-response + event-driven | `match_make_offer` (DEFINER skeleton) + `post_night` (field validators) | exact (composed) |
| `…_e8_interest_dispatch.sql` (`CREATE OR REPLACE match_ingest_interest`) | migration / RPC | event-driven (dispatch) | existing `match_ingest_interest` body + `match_make_offer` dispatch line | exact |
| `supabase/functions/process-jobs/handlers.ts` (E9 delete 6 handlers) | edge / dispatch-table | event-driven | self (delete entries) | exact (in-place) |
| `supabase/functions/process-jobs/handlers_test.ts` (prune `ALL_TYPES`) | test (Deno) | — | self | exact (in-place) |
| `supabase/functions/process-jobs/handlers_rpc_fail_closed_test.ts` (delete 4 reject cases) | test (Deno) | — | self | exact (in-place) |
| `apps/web/lib/after5/notif-map.ts` (interest_received href + new types meta) | utility (render map) | transform | self (`GATED_NOTIF_META` block, lines 76-79) | exact (in-place) |
| `supabase/tests/e5_loop_completion.sql` | test (psql) | — | `supabase/tests/b_job_rpcs.sql` + `_fixtures.sql` | role-match |
| `supabase/tests/e6_cancel_night.sql` | test (psql) | — | `supabase/tests/b_job_rpcs.sql` | role-match |
| `supabase/tests/e7_update_night.sql` | test (psql) | — | `supabase/tests/b_job_rpcs.sql` | role-match |
| `supabase/tests/e8_interest_dispatch.sql` | test (psql) | — | `supabase/tests/b_job_rpcs.sql` | role-match |
| `apps/web/app/api/cron/close-loop/route.ts` (E5 sweep trigger) | route (cron) | batch | `apps/web/app/api/cron/offer-expiring/route.ts` (admin-client sweep) + `process-jobs/route.ts` (auth) | exact |
| `apps/web/vercel.json` (add close-loop cron entry) | config | — | self (lines 7-24, `offer-expiring` entry) | exact (in-place) |
| `packages/api-client/src/feed.ts` (cancel/update client wrappers) | api-client | request-response | `postNight` (lines 19-30) | exact (in-place) |
| `apps/web/app/my-nights/page.tsx` + interested list (cancel/edit affordances) | component | request-response | self (`NightCard`, lines 53-123) + DESIGN-SYSTEM.md | exact (in-place) |

---

## Pattern Assignments

### `cancel_night` — E6 (DEFINER RPC, request-response + notify)

**Analog:** `match_make_offer` — `supabase/migrations/20260527126300_p5_make_offer.sql`

**DEFINER signature + boilerplate** (make_offer lines 25-31, 41-56):
```sql
create or replace function cancel_night(p_actor uuid, p_instance uuid, p_idem_key uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid; st date_match_status; rec record; prior jsonb;
begin
  -- 1. auth re-check (make_offer line 42-44)
  if p_actor is distinct from auth.uid() then raise exception 'auth_mismatch' using errcode='P5001'; end if;
  -- 2. idempotency replay (make_offer line 52-53)
  prior := match_idem_lookup(p_actor, 'cancel_night', p_idem_key);
  if prior is not null then return; end if;
  -- 3. serialize this instance (make_offer line 56)
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  -- 4. load + creator-only ownership check (make_offer lines 73-76)
  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;
  if st <> 'seeking' then raise exception 'not_cancellable' using errcode='P0001'; end if;  -- pre-match only (D-04)
```

**SOFT-unpublish mutation** (D-04 — flip status, keep the row; `set_updated_at` trigger already on table):
```sql
  update date_instances set status='cancelled', updated_at=now() where id=p_instance;
```

**Notify interested candidates** (dispatch line copied from make_offer lines 130-131; loop over queue_entries):
```sql
  for rec in select candidate_id from queue_entries
              where date_instance_id=p_instance and status in ('interested','shortlisted','standby')
  loop
    perform dispatch_notification(rec.candidate_id, 'night_cancelled',  -- new enum value (D-09), added in E5/E6 migration
      jsonb_build_object('date_instance_id', p_instance, 'dedup_key', 'night_cancelled:'||p_instance::text||':'||rec.candidate_id::text));
  end loop;
```

**Analytics + idempotency store + grants** (make_offer lines 134-139, 142):
```sql
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('night_cancelled', p_actor, 'date_instance', p_instance, jsonb_build_object());
  perform match_idem_store(p_actor, 'cancel_night', p_idem_key, jsonb_build_object('ok', true));
end $fn$;
revoke execute on function cancel_night(uuid, uuid, uuid) from public, anon;
grant  execute on function cancel_night(uuid, uuid, uuid) to authenticated;  -- public C2: auth enforced inside
```

---

### `update_night` — E7 (DEFINER RPC, request-response + conditional notify)

**Analogs:** `match_make_offer` (DEFINER skeleton, above) + `post_night` — `supabase/migrations/20260602120300_m4_post_night_ambient.sql` (validators)

**Field validators to copy verbatim** (post_night lines 32-45). Re-use ONLY the clauses for fields the host may change:
```sql
  -- curated-venue gate (post_night lines 32-37)
  if p_venue is not null then
    select (approval_status = 'live' and is_active) into v_venue_ok from places where id = p_venue;
    if not coalesce(v_venue_ok,false) then
      raise exception 'venue must be a reviewed (live) place to host a dating meetup' using errcode='P0001';
    end if;
  end if;
  -- ambient-active gate (post_night lines 40-45)
  if p_ambient_sound_id is not null then
    perform 1 from ambient_sounds where id = p_ambient_sound_id and is_active = true;
    if not found then raise exception 'ambient sound not found or inactive' using errcode='P0001'; end if;
  end if;
```

**CRITICAL — `time_range` is GENERATED** (`20260525120300_p0_date_instances.sql`): write only `starts_at`/`duration_min`; never write `time_range`. `duration_min` is bounded 30..1440 by the table CHECK. Ambient column is `date_instances.ambient_sound_id uuid` (FK), NOT a text URL.

**Material-change conditional notify** (D-05 — only when `starts_at` OR `venue_id` changed AND interested candidates exist; dispatch line as in cancel_night, type `night_changed`):
```sql
  if (p_starts_at is not null and p_starts_at <> old_starts_at)
     or (p_venue is not null and p_venue is distinct from old_venue) then
    for rec in select candidate_id from queue_entries
                where date_instance_id=p_instance and status in ('interested','shortlisted','standby')
    loop
      perform dispatch_notification(rec.candidate_id, 'night_changed',
        jsonb_build_object('date_instance_id', p_instance, 'dedup_key', 'night_changed:'||p_instance::text||':'||rec.candidate_id::text));
    end loop;
  end if;
```
Wrap in the same `auth.uid()` + idempotency + `pg_advisory_xact_lock` + creator-only skeleton as `cancel_night`. Same `revoke … from public, anon` / `grant … to authenticated`.

---

### `sweep_loop_terminus` — E5 (service-role-only DEFINER, batch sweep)

**Analog:** `close_rating_window` — `supabase/migrations/20260527127200_p5_job_rpcs_backfill.sql` lines 79-94 (service-role-only, idempotent, stale-tolerant).

**Service-role REVOKE pattern** (backfill line 99-100):
```sql
revoke all on function sweep_loop_terminus() from public, anon, authenticated;  -- runner/cron only
```

**Stale-tolerant idempotent body** (mirrors close_rating_window's "stamp only when unset, no raise on missing"). Grace anchor = `upper(time_range) + grace` per the `accept_lock` rating-window convention (`20260527126400` uses `upper(rng) + interval '2 hours'`):
```sql
create or replace function sweep_loop_terminus()
returns int language plpgsql security definer set search_path=public as $fn$
declare n int := 0;
begin
  -- completion (D-01): active locks whose night ended + grace → completed (both tables)
  with done as (
    update locks set status='completed', updated_at=now()
     where status='active'
       and upper((select time_range from date_instances d where d.id=locks.date_instance_id)) + interval '3 hours' < now()
    returning date_instance_id)
  update date_instances set status='completed', updated_at=now()
   where id in (select date_instance_id from done) and status='matched';
  -- expiry (D-02): past-dated seeking nights → 'expired' (NOT 'completed' — D-10)
  update date_instances set status='expired', updated_at=now()
   where status='seeking' and lower(time_range) + interval '3 hours' < now();
  get diagnostics n = row_count;
  return n;
end $fn$;
```

**No-show RPC — DIFFERENT auth predicate (Pitfall 5).** D-01 says EITHER party flags no-show, so authorize membership, not creator-only:
```sql
  -- load lock; auth.uid() must be a MEMBER (not just creator)
  select creator_id, matched_user_id into cre, matched from locks where id=p_lock for update;
  if auth.uid() not in (cre, matched) then raise exception 'not_member' using errcode='42501'; end if;
  update locks set status='no_show', updated_at=now() where id=p_lock;  -- no_show is LOCK-level only
```
> **Two-status-model rule (Pitfall 1):** `lock_status` has `no_show`; `date_match_status` does NOT. A no-show sets `locks.status='no_show'` while `date_instances.status` stays `completed`. Never set `date_instances.status='no_show'` — it throws `invalid input value for enum`.

**Additive enum migrations** (D-09, D-10) — same idempotent convention as `gated_inbox_notification_types.sql` line 22-23:
```sql
alter type date_match_status add value if not exists 'expired';      -- D-10 (seeking sweep terminus)
alter type notification_type add value if not exists 'night_cancelled';  -- D-09
alter type notification_type add value if not exists 'night_changed';    -- D-09
```
> Postgres requires `ALTER TYPE … ADD VALUE` to run OUTSIDE a transaction-with-later-use of the value in older PG, but on PG17 `add value if not exists` then using it in a later statement of the SAME migration is fine only if separated by a `COMMIT`. Match the proven layout: put bare enum-add statements in their own migration file (as `gated_inbox_notification_types.sql` does) ahead of any RPC that references the new value.

---

### `match_ingest_interest` (E8 — CREATE OR REPLACE, add dispatch)

**Analog:** existing body `supabase/migrations/20260527126200_p5_shortlist.sql` lines 25-39 + `match_make_offer` dispatch line.

Keep the body verbatim; after `get diagnostics n = row_count;` (line 38) add the `n > 0` guard (Pitfall 4 — only notify on a genuinely NEW candidate; re-ingest returns n=0):
```sql
  get diagnostics n = row_count;
  if n > 0 and cre is not null then
    perform dispatch_notification(cre, 'interest_received',
      jsonb_build_object(
        'date_instance_id', p_instance,   -- the inbox group key (inbox-activity.ts expects this)
        'new_count', n,
        'dedup_key', 'interest_received:'||p_instance::text));  -- coarse: collapses email spam; in-app per-instance row
  end if;
  return n;
```
> `interest_received` is ALREADY a valid `notification_type` (shipped in `20260603120000_gated_inbox_notification_types.sql`). No enum migration needed for E8. `dispatch_notification` has NO consent branch for it → falls through permissive (in-app always fires), which matches D-07. Grants on `match_ingest_interest` stay `revoke`d from public (it's called by `record_swipe`). Do NOT add a grant.

---

### `notif-map.ts` (E8 deep-link + E6/E7 new types) — Pitfall 3

**Analog:** self — `apps/web/lib/after5/notif-map.ts` lines 34-37 (href helpers), 76-79 (`GATED_NOTIF_META`).

Add an instance-href helper alongside `offerHref`/`lockHref` (lines 34-35) and fix the `interest_received` entry (currently `() => '/my-nights'`, line 77):
```ts
const interestedHref = (p: Payload) => { const id = str(p, 'date_instance_id'); return id ? `/dates/${id}/interested` : '/my-nights'; };
// in GATED_NOTIF_META (line 77), replace hrefFor:
interest_received: { label: "someone's into your night", Icon: Flame, category: 'matches', hrefFor: interestedHref },
```
When the E5/E6 enum migration applies and `pnpm db:types` regenerates the enum, `night_cancelled`/`night_changed` move into the enum-exhaustive `NOTIF_META` (lines 39-60), each with a `label`, `Icon` (e.g. `CalendarX`/`RefreshCw` already imported, lines 9-10), `category: 'reminders'`, and an instance/feed `hrefFor`. The route `[slug]` carries the instance id (`/dates/[slug]/interested`).

---

### E9 — delete 6 dead handlers (handlers.ts + 2 test files in lockstep)

**Analog:** self — `supabase/functions/process-jobs/handlers.ts`. Delete these 6 keys from `HANDLERS` (lines 73, 75, 76, 77, 78, 83):
`stale_date_close`, `pending_expiry`, `day_of_reconfirm`, `safety_checkin`, `reconfirm_timeout`, `deletion_process`.
Also delete the now-orphan `notifyLockParties` helper (lines 50-58 — only `day_of_reconfirm`/`safety_checkin` used it).

**LEAVE** `chat_purge` (line 81) and `analytics_relay` (line 84) — dead but owned by P6/P11 (D-11, Pitfall 2). Do NOT drop `job_type` enum values (`20260525123000_p2_jobs.sql` lines 9-13) — destructive in Postgres; orphan values are harmless (nothing enqueues them; runner fails closed).

**Lockstep test edits (or the Deno suite goes red):**
- `handlers_test.ts` lines 5-9: prune `ALL_TYPES` to drop the 6 removed types (keep `chat_purge`, `analytics_relay`, `notify`, the working handlers).
- `handlers_rpc_fail_closed_test.ts`: delete the `assertRejects` cases for the 4 removed RPC handlers — `deletion_process` (lines 87-99), `stale_date_close` (101-111), `pending_expiry` (113-123), `reconfirm_timeout` (125-135). KEEP the `chat_purge` (137-147) and `analytics_relay` (149-159) cases.

---

### E5 cron route + vercel.json

**Analog:** `apps/web/app/api/cron/offer-expiring/route.ts` (admin-client time sweep) + `process-jobs/route.ts` (auth shape).

**Auth block — copy verbatim** (offer-expiring lines 28-39):
```ts
const expected = process.env.CRON_SECRET;
if (!expected) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
const url = new URL(request.url);
const authHeader = request.headers.get('authorization');
const querySecret = url.searchParams.get('secret');
const ok = authHeader === `Bearer ${expected}` || querySecret === expected;
if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
```
Then `const admin = createAdminClient();` (offer-expiring line 18, 45) and `await admin.rpc('sweep_loop_terminus')`. `export const dynamic = 'force-dynamic';` + `maxDuration`. No new secrets (reuses `CRON_SECRET`).

**vercel.json** — add a crons entry mirroring the `offer-expiring` block (lines 20-23):
```json
{ "path": "/api/cron/close-loop", "schedule": "*/15 * * * *" }
```

---

### api-client wrappers + my-nights UI

**Analog (wrappers):** `packages/api-client/src/feed.ts` `postNight` (lines 19-30) — `client.rpc(<fn>, { p_… })`, `if (error) throw error`. Add `cancelNight(client, { instance_id, idem_key })` and `updateNight(client, {...})` in the same shape. Generate `p_idem_key` client-side (UUID) per the idempotency-ledger contract.

**Analog (UI):** `apps/web/app/my-nights/page.tsx` `NightCard` (lines 53-123). The cancel/edit affordances are small client-leaf actions on the host's own surface. Reuse `cn()`, `shell.*` tokens, `font-heading`/`font-body`, `rounded-3xl`, `shadow-fun`, ≥44px tap targets, `focus-visible:ring-shell-accent/40`, `motion-reduce:*` — all already in this file. Use `vaul` for a bottom-sheet confirm + `sonner` toast on success (per DESIGN-SYSTEM.md). A `CancelWithReasonPicker` pattern already exists under `apps/web/app/dates/[slug]/interested/` (per research) — reuse it.

---

## Shared Patterns

### SECURITY DEFINER skeleton (E5 no-show, E6, E7)
**Source:** `supabase/migrations/20260527126300_p5_make_offer.sql` lines 31-56, 134-142
**Apply to:** every new mutating RPC.
```sql
... language plpgsql security definer set search_path=public as $fn$
-- 1. if p_actor is distinct from auth.uid() then raise 'auth_mismatch' P5001
-- 2. prior := match_idem_lookup(p_actor,'<action>',p_idem_key); if prior is not null then return ...
-- 3. perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
-- 4. load row FOR UPDATE; null-check (P0002); ownership-check (42501); state-check (P0001)
-- ... mutate; perform dispatch_notification(...); insert analytics_events ...
-- 5. perform match_idem_store(p_actor,'<action>',p_idem_key, jsonb_build_object(...));
```
Idempotency helpers: `match_idem_lookup` / `match_idem_store` / `match_instance_lock_key` — `supabase/migrations/20260527126100_p5_idempotency.sql`. Pass a `p_idem_key uuid`.

### Notification dispatch
**Source:** `supabase/migrations/20260525123600_p2_dispatch_notification.sql` (signature line 16-18; revoked line 135)
**Apply to:** E5 cancel-notify, E6, E7, E8.
`dispatch_notification(p_user uuid, p_type notification_type, p_payload jsonb)` — `revoke`d from public; only `perform` it inside a DEFINER RPC. Payload carries `{title, body, data, dedup_key}`; `dedup_key` short-circuits on a duplicate `(type, dedup_key)` (lines 32-38, 108) — this is the E8/cancel throttle lever.

### Service-role-only sweep RPC
**Source:** `supabase/migrations/20260527127200_p5_job_rpcs_backfill.sql` lines 79-100 (`close_rating_window`)
**Apply to:** `sweep_loop_terminus`. Idempotent + stale-tolerant (return cleanly, never raise — a raise re-poisons the loop). `revoke all … from public, anon, authenticated`.

### Additive enum migration
**Source:** `supabase/migrations/20260603120000_gated_inbox_notification_types.sql` lines 22-23
**Apply to:** `date_match_status` `'expired'`, `notification_type` `'night_cancelled'`/`'night_changed'`.
`alter type <enum> add value if not exists '<value>';` — additive, idempotent, non-destructive. Put bare enum-adds in their own statement/file ahead of RPCs that use the value.

### psql-assertion SQL test
**Source:** `supabase/tests/b_job_rpcs.sql` + `supabase/tests/_fixtures.sql` (NOT pgTAP)
**Apply to:** all 4 new `supabase/tests/e[5-8]_*.sql`.
`\i supabase/tests/_fixtures.sql` provides `mk_user` / `mk_itinerary` / `mk_instance(itin, creator, starts_at)`. `DO $$ … RAISE EXCEPTION on failed assert … $$;`. For PAST-dated sweep data, insert via the fixture (which sets `status='seeking'`, `duration_min=150`) — NOT via `post_night` (its `starts_at > now()` guard rejects past data). Run: `psql $DB_URL -v ON_ERROR_STOP=1 -f <file>`.

### Cron route auth
**Source:** `apps/web/app/api/cron/process-jobs/route.ts` lines 11-19 / `offer-expiring/route.ts` lines 28-39
**Apply to:** `close-loop/route.ts`. `Bearer ${CRON_SECRET}` or `?secret=`; `force-dynamic`; reuse existing secrets.

### api-client RPC wrapper
**Source:** `packages/api-client/src/feed.ts` `postNight` lines 19-30
**Apply to:** `cancelNight` / `updateNight` wrappers — `client.rpc(fn, { p_… })`, `if (error) throw error`.

---

## No Analog Found

None. Every E5–E9 surface maps to a verified in-repo analog. (The research's "copy-not-invent" framing holds: this phase is composition + deletion.)

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/functions/process-jobs/`, `supabase/tests/`, `apps/web/app/api/cron/`, `apps/web/app/my-nights/`, `apps/web/lib/after5/`, `packages/api-client/src/`
**Files read this session:** `20260527126300_p5_make_offer.sql`, `20260527126200_p5_shortlist.sql`, `20260525123600_p2_dispatch_notification.sql`, `20260603120000_gated_inbox_notification_types.sql`, `20260602120300_m4_post_night_ambient.sql`, `20260527127200_p5_job_rpcs_backfill.sql`, `20260527126100_p5_idempotency.sql`, `20260525123000_p2_jobs.sql` (head), `process-jobs/{handlers.ts, handlers_test.ts, handlers_rpc_fail_closed_test.ts}`, `cron/process-jobs/route.ts`, `cron/offer-expiring/route.ts`, `vercel.json`, `notif-map.ts`, `my-nights/page.tsx`, `feed.ts`
**Pattern extraction date:** 2026-06-03
</content>
</invoke>

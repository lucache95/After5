# Phase 7 — In-app chat messaging with rapport-gate — Implementation Plan

**Date:** 2026-05-31
**Author:** plan only (do NOT build from this header — execute task-by-task)
**Predecessor specs:** `docs/superpowers/specs/2026-05-27-5b-Z-chat-core-design.md` (chat-core primitives, already on prod), `docs/superpowers/DESIGN-SYSTEM.md` (Barbiecore brand, governs all dating UI).

---

## 0. Open questions / decisions for the human (READ FIRST)

These shape the build. Defaults are chosen so the plan is executable as written; flag any you want changed before an implementer starts.

1. **What is the rapport-gate, exactly?** The codebase already encodes the intent: `chat_threads.both_ready` is the rapport flag, and `chat_lock_ready(p_thread)` is the gate the offer→lock flow checks (today it returns `state='open'`; the Z spec §2.3 explicitly leaves `AND both_ready` for "Phase 7"). **There are two distinct gates and the spec conflates them. This plan separates them:**
   - **Gate A — "can these two people chat at all?"** Proposed default: **a chat thread is messageable while `state IN ('open','promoted')` and `revoked_at IS NULL`.** That means chat opens the moment an offer is made (`open_chat_thread` runs inside `match_make_offer`), and survives the promote-to-lock. This is the "rapport BEFORE the lock" reading — chat is the wedge that builds rapport, then you lock. **DECISION NEEDED: do we want chat available pre-lock (on an open offer), or only post-lock (after `match_accept_offer`)?** The whole "rapport-gate" framing only makes sense if chat is pre-lock. This plan assumes **pre-lock chat on an open/promoted thread**. If product wants post-lock-only, change `chat_thread_messageable` in Task 3 to require `state='promoted'`.
   - **Gate B — "does enough rapport exist to LOCK?"** This is `both_ready`. Proposed default: **`both_ready` flips true once each party has sent ≥1 message in the thread** (a mutual signal — both showed up). Phase 7 wires `chat_lock_ready` to `state='open' AND both_ready`, closing the gap the Z spec foreshadowed. **DECISION NEEDED: is "1 message each" the right rapport bar, or do we want N messages, or a time floor, or an explicit "I'm ready to lock" tap?** This plan uses **1-message-each** (cheapest meaningful mutual signal) and isolates it in one function (`chat_recompute_both_ready`) so the bar is trivial to retune.

2. **Does turning on `chat_lock_ready = state='open' AND both_ready` break the live offer→lock flow?** Today `match_accept_offer` calls `chat_lock_ready`; with the current body it returns true for any open thread, so accept always passes the gate. If Phase 7 adds `AND both_ready`, **a candidate who accepts an offer without anyone having messaged would be blocked (P5005 chat_not_ready).** That is the intended rapport-gate behavior, but it is a **behavior change to a shipped flow**. DECISION NEEDED: confirm we want accept to require rapport. Mitigation if not: keep `chat_lock_ready` as-is and treat `both_ready` purely as a UI affordance ("ready to lock") rather than a hard gate. This plan implements the **hard gate** (Task 5) but gates it behind the `match_v2_enabled` cohort flag already in use, and includes a rollback migration.

3. **Realtime mechanism.** The repo already uses Supabase `postgres_changes` (see `apps/web/lib/after5/realtime.ts`: queue, notifications, locks). This plan reuses that exact pattern (a `postgres_changes` INSERT subscription on `messages` filtered by `thread_id`, RLS-gated) rather than Realtime Broadcast. DECISION NEEDED only if you want Broadcast for lower latency / no DB round-trip — not recommended given the established pattern and that we want messages persisted anyway.

4. **Message retention / moderation.** `chat_threads` already carries `legal_hold` + `revoked_at` for C9 retention (S10's job). This plan adds messages with `ON DELETE CASCADE` from the thread, but the thread's existing legal-hold delete-block trigger protects held conversations. Full moderation (report a message, block from chat) is **out of scope** here and flagged in §8. DECISION NEEDED: is a minimal "report" affordance required for launch, or can it wait?

5. **`offer_id` is NOT NULL and UNIQUE on `chat_threads`.** A thread is keyed to an offer, not a lock. Two people who match on multiple nights get multiple offers → multiple threads. DECISION NEEDED: should the messages tab collapse multiple threads with the same counterpart into one conversation, or show one row per offer/night? This plan shows **one row per thread (per offer/night)**, labeled by the date, which matches the data model and the "swipe on the date, not the guy" brand. Revisit if it feels noisy.

---

## Goal

Ship real two-party chat for matched users, replacing the `Phase7Placeholder`. Two people connected by an offer can exchange messages; the conversation is the "rapport" that gates locking in. Deliver: a `messages` thread-list tab, a per-thread conversation view with a composer, live delivery via Supabase Realtime, an in-app `new_message` notification, and the server-side rapport-gate (`both_ready`) wired into the existing offer→lock flow. All party-scoped and deny-by-default at the database.

## Architecture

```
match_make_offer (existing)
  └─ open_chat_thread(offer)            ── thread row exists, state='open', both_ready=false
        │
        ▼  (either party opens /messages/[threadId])
  ┌─────────────────────────────────────────────────────────────┐
  │  CONVERSATION VIEW (client)                                    │
  │   • initial load: select messages via RLS (chat_messages_party)│
  │   • subscribe: postgres_changes INSERT on messages, thread filter
  │   • send: edge fn `chat-send-message` → RPC chat_send_message   │
  └─────────────────────────────────────────────────────────────┘
        │
        ▼
  chat_send_message(p_actor, p_thread, p_body, p_idem_key)  [SECURITY DEFINER]
     1. assert actor is a party (offer.creator_id | offer.candidate_id)
     2. assert chat_thread_messageable(thread)   ← Gate A (open|promoted, not revoked)
     3. insert into messages
     4. chat_recompute_both_ready(thread)         ← flips both_ready when each party sent ≥1
     5. dispatch_notification(other_party, 'new_message', {...})
     6. return discriminated jsonb { kind:'message', message_id, both_ready }
        │
        ▼
  match_accept_offer (existing) → chat_lock_ready(thread)  ← Gate B now = state='open' AND both_ready
```

- **Reads** go directly through the browser Supabase client under RLS (no edge fn) — same as `match_ratings` reads. **Writes** go through an edge function → SECURITY DEFINER RPC, matching every other mutating dating action (`apps/web/lib/after5/match.ts`).
- **Delivery** is `postgres_changes` on `messages`, RLS-gated, one channel per thread. Identical mechanics to `subscribeNotifications` / `subscribeLockInserts`.
- **Read state** is per-message `read_at` set by a lightweight RPC the conversation view calls on mount/focus; unread counts are derived (`read_at IS NULL AND sender_id <> me`).

## Tech Stack (all already in the repo — verified)

- **DB:** Postgres (Supabase, prod ref `ufufmcpnysvwtutpbian`). Migrations in `supabase/migrations/` (timestamp-band naming; latest band `20260531190000`). SQL tests in `supabase/tests/*.sql`, run by `pnpm db:test` (root `package.json`).
- **Edge:** Deno functions in `supabase/functions/`, shared scaffolding in `supabase/functions/_shared/match.ts` + `errcode.ts`. Tests are `index.test.ts` next to each function (Deno).
- **Web:** Next.js App Router (`apps/web/app`), Supabase SSR clients (`apps/web/lib/supabase/server.ts` + `client.ts`, and the dating-scoped `apps/web/lib/after5/client.ts`). Realtime helpers live in `apps/web/lib/after5/realtime.ts`. Types are generated into `packages/types/src/database.ts` via `pnpm db:types` (`supabase gen types typescript --local`). Component tests are Vitest + Testing Library (`*.test.tsx`), config `apps/web/vitest.config.ts`.
- **Design:** Tailwind tokens `shell.base/accent/ink/pink`, fonts `font-heading` (Caprasimo) / `font-body` (Fredoka), `framer-motion`, `sonner` (toast), `lucide-react` icons. Governed by `docs/superpowers/DESIGN-SYSTEM.md`. Lowercase, dry copy. Phone-width `max-w-[420px]`.

## What already exists (do not rebuild — verified against prod + repo)

- **Table `chat_threads`** — on prod AND in `supabase/migrations/20260525124500_p2_chat_core.sql` (+ Z amendments `20260527124551`, `20260527124552`). Columns: `id, offer_id (NOT NULL UNIQUE FK→offers ON DELETE CASCADE), lock_id (FK→locks ON DELETE SET NULL), state ('open'|'promoted'|'closed'), both_ready bool, legal_hold bool, revoked_at, promoted_at, created_at, updated_at`. **RLS enabled, ZERO policies (default-deny).** It is NOT orphaned — `match_make_offer` calls `open_chat_thread`, `match_accept_offer` calls `chat_lock_ready` + `promote_chat_thread_to_lock`, pass/expire call `close_chat_thread`.
- **RPCs** `open_chat_thread`, `chat_lock_ready`, `promote_chat_thread_to_lock`, `close_chat_thread` (all SECURITY DEFINER, REVOKE from public/authenticated). Phase 7 may only **amend `chat_lock_ready`** (Task 5) — do not touch the others.
- **`notification_type` enum already has `new_message`** (verified on prod). `notification_preferences.messages_enabled` exists and `dispatch_notification` already honors it (`elsif p_type = 'new_message' and not v_prefs.messages_enabled then v_allowed := false`). No enum migration needed.
- **`dispatch_notification(p_user uuid, p_type notification_type, p_payload jsonb)`** — SECURITY DEFINER, handles consent/quiet-hours/rate-limit/channel/dedup, inserts into `notifications`. Call it; do not reimplement.
- **`messages` table does NOT exist** (only `chat_threads`). This plan creates it (named `messages`).
- **Edge envelope + error keying:** success `{ ok:true, data }`; failure `{ ok:false, code, message, detail?, errcode? }`. PG `RAISE ... USING errcode='P5xxx'` maps via `errcode.ts`. Client wrapper throws `MatchError` keyed on string `code`.
- **Realtime pattern:** `apps/web/lib/after5/realtime.ts` — `client.channel(\`x:${id}:${crypto.randomUUID()}\`).on('postgres_changes', {...}).subscribe()`, return `() => client.removeChannel(ch)`.
- **Placeholder to replace:** `apps/web/app/matches/[lockId]/Phase7Placeholder.tsx` (rendered by `LockDetail.tsx` line 75); the `messages` tab is a dry-toast stub in `apps/web/components/BottomTabShell.tsx` lines 21, 80-98.

---

## File Structure (new + touched)

```
supabase/
  migrations/
    20260601100000_p7_messages_table.sql              NEW  messages table + indexes + trigger
    20260601100100_p7_chat_rls_party_read.sql         NEW  RLS policies: chat_threads + messages party-read
    20260601100200_p7_chat_send_rpc.sql               NEW  chat_send_message, chat_recompute_both_ready, chat_mark_read RPCs
    20260601100300_p7_chat_lock_ready_rapport.sql      NEW  amend chat_lock_ready to AND both_ready (Gate B)  [+ rollback file]
    20260601100400_p7_chat_lock_ready_rollback.sql     NEW  rollback for the above (kept, not applied)
    20260601100500_p7_messages_realtime_publication.sql NEW  add messages to supabase_realtime publication
  tests/
    p7_chat_rls.sql                                    NEW  RLS party-read + deny-by-default
    p7_chat_send.sql                                   NEW  send RPC, both_ready recompute, gate, idempotency, mark_read
    p7_chat_lock_ready.sql                             NEW  Gate B combos
  functions/
    chat-send-message/
      index.ts                                         NEW
      index.test.ts                                    NEW

packages/types/src/database.ts                          REGENERATED (messages table + RPCs)

apps/web/
  lib/after5/
    realtime.ts                                        TOUCH  add subscribeThreadMessages
    chat.ts                                            NEW    typed client wrapper (sendMessage, markThreadRead, fetch helpers)
    __tests__/chat.test.ts                             NEW
    __tests__/realtime.chat.test.ts                    NEW
  app/messages/
    page.tsx                                           NEW    thread-list (the `messages` tab)
    ThreadList.tsx                                     NEW
    thread-view.ts                                     NEW    server-safe pure helpers (sort, unread, preview)
    __tests__/thread-view.test.ts                      NEW
    __tests__/ThreadList.test.tsx                      NEW
    [threadId]/
      page.tsx                                         NEW    conversation server entry
      Conversation.tsx                                 NEW    client: list + realtime + composer
      Composer.tsx                                     NEW
      __tests__/Conversation.test.tsx                  NEW
      __tests__/Composer.test.tsx                      NEW
  components/
    BottomTabShell.tsx                                 TOUCH  messages tab: soon → live (/messages) + unread dot
  app/matches/[lockId]/
    LockDetail.tsx                                     TOUCH  replace <Phase7Placeholder/> with a "message [name]" link
    Phase7Placeholder.tsx                              DELETE (after LockDetail updated)
    __tests__/Phase7Placeholder.test.tsx               DELETE
```

---

## Tasks

> Conventions for every task: write the test first (TDD), watch it fail, implement, watch it pass. SQL tests run via `pnpm db:test` against the local stack (`supabase start` must be running). Regenerate types with `pnpm db:types` after any DDL. Migrations are applied to prod LAST, per the runbook discipline (`docs/superpowers/plans/5b-prod-migration-rollout.md`) — never `apply_migration` to prod from this plan without the human's go-ahead. Run `mcp__supabase__get_advisors` (security) after DDL.

---

### Task 1 — `messages` table (DDL)

**File:** `supabase/migrations/20260601100000_p7_messages_table.sql`

Create the message store. Keyed to a thread; cascades when the thread is deleted (and the thread itself is delete-blocked under legal hold, so held conversations survive). `sender_id` FK→profiles. `read_at` is per-message; the recipient's mark-read RPC sets it.

```sql
-- supabase/migrations/20260601100000_p7_messages_table.sql
-- Phase 7 message store. One row per chat message. Belongs to a chat_thread
-- (which is keyed to an offer). RLS enabled here, ZERO policies in this file —
-- policies land in 100100 (same default-deny posture chat_threads ships with).
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references chat_threads(id) on delete cascade,
  sender_id   uuid not null references profiles(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  read_at     timestamptz,                     -- set by chat_mark_read for the recipient
  created_at  timestamptz not null default now()
);
-- Conversation load is "messages for a thread, oldest→newest"; unread is
-- "thread, read_at null, sender <> me". Both covered by this composite.
create index if not exists messages_thread_created_idx on messages (thread_id, created_at);
create index if not exists messages_unread_idx on messages (thread_id, read_at) where read_at is null;

alter table messages enable row level security;
-- NO policies in this migration: RLS-enabled-with-zero-policies = default-deny,
-- the same posture chat_threads uses. Party-read policy is added in 100100.
```

**Test:** `supabase/tests/p7_chat_rls.sql` (start the file here; Task 2 adds policy assertions). Assert table + columns + the body length check + default-deny.

```sql
-- supabase/tests/p7_chat_rls.sql
\set ON_ERROR_STOP on
begin;
-- shape
do $$ begin
  assert (select count(*) from information_schema.columns
          where table_name='messages' and column_name in ('id','thread_id','sender_id','body','read_at','created_at')) = 6,
    'messages must have the 6 expected columns';
end $$;
-- body length check rejects empty + >2000
do $$ declare ok boolean := false; begin
  begin
    insert into messages(thread_id, sender_id, body)
    values (gen_random_uuid(), gen_random_uuid(), '   ');
  exception when check_violation or foreign_key_violation then ok := true; end;
  assert ok, 'blank body or bad fk must be rejected';
end $$;
rollback;
```

**Run:** `pnpm db:test` (local stack up). Then `pnpm db:types` to regenerate `packages/types/src/database.ts`; confirm `messages` appears under `Database['public']['Tables']`.

---

### Task 2 — RLS policies: party-read for `chat_threads` and `messages`

**File:** `supabase/migrations/20260601100100_p7_chat_rls_party_read.sql`

This is the policy the Z spec explicitly deferred to Phase 7 (§7.2 "Participant-read RLS policy — Phase 7's job"). Parties are derived through `offer_id → offers.creator_id + offers.candidate_id` (there is no `participants[2]` column — confirmed). Mirror the existing party-read shape (`offers_party_read`, `locks_party_read` use `auth.uid()` equality). **SELECT-only policies — no client INSERT/UPDATE/DELETE** (writes go through the SECURITY DEFINER RPC, which bypasses RLS as owner). This keeps the deny-by-default secure posture (never `USING(true)`).

```sql
-- supabase/migrations/20260601100100_p7_chat_rls_party_read.sql
-- Phase 7 participant-read RLS (deferred here by Z spec §7.2). Parties derive
-- from offer.creator_id + offer.candidate_id. SELECT-only; all writes are via
-- SECURITY DEFINER RPCs (chat_send_message / chat_mark_read), so no client
-- INSERT/UPDATE/DELETE policy exists -> those verbs stay default-denied.

-- A SECURITY INVOKER helper so the policy expression is readable + reused by both
-- tables. STABLE + invoker means it evaluates under the caller's RLS, but it only
-- reads offers (which itself is party-readable) so a party can confirm membership.
create or replace function chat_thread_party(p_thread uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chat_threads t join offers o on o.id = t.offer_id
    where t.id = p_thread and (o.creator_id = p_uid or o.candidate_id = p_uid)
  );
$$;
revoke execute on function chat_thread_party(uuid, uuid) from public;
grant execute on function chat_thread_party(uuid, uuid) to authenticated;

-- chat_threads: a party may read their own thread row.
drop policy if exists chat_threads_party_read on chat_threads;
create policy chat_threads_party_read on chat_threads for select to authenticated
  using (chat_thread_party(id, auth.uid()));

-- messages: a party may read messages in a thread they belong to.
drop policy if exists messages_party_read on messages;
create policy messages_party_read on messages for select to authenticated
  using (chat_thread_party(thread_id, auth.uid()));
```

> Note on the helper: it is SECURITY DEFINER so the policy can join `offers` even though `chat_threads`'s own policy is what we're defining (avoids a recursive RLS evaluation on `chat_threads`). It only returns a boolean membership check — no row data leaks. Run the security advisor after applying; if it flags the definer function, the fallback is to inline the `EXISTS` directly into each policy `USING` (the `offers` join is fine inline because `offers` is independently party-readable). Keep whichever the advisor is happy with; the test in this task is the source of truth.

**Test:** extend `supabase/tests/p7_chat_rls.sql` with party-read + deny. Use `set local role authenticated` + `set local request.jwt.claims` to simulate two users (the existing tests under `supabase/tests/` do this — copy the pattern from `a_revealed_rls_negative.sql`). Seed via `_fixtures.sql` helpers: two profiles, a date_instance, an offer, then `open_chat_thread(offer)`.

Assertions:
- Creator (auth.uid = creator) SELECTs the thread → 1 row.
- Candidate → 1 row.
- A third unrelated user → 0 rows (deny-by-default).
- Same three for `messages` after inserting one as service role.
- A direct `INSERT INTO messages` as `authenticated` → `insufficient_privilege`/0-rows-affected (no write policy).

**Run:** `pnpm db:test`; then `mcp__supabase__get_advisors` with `type:'security'` and confirm no new ERROR-level findings on `messages`/`chat_threads`.

---

### Task 3 — Gate A predicate + `chat_send_message` + `chat_recompute_both_ready` + `chat_mark_read` (RPCs)

**File:** `supabase/migrations/20260601100200_p7_chat_send_rpc.sql`

The write path. All SECURITY DEFINER, all `REVOKE EXECUTE FROM public, authenticated` (only the edge function's service-role/authed client calls them via `client.rpc`, and the RPC re-checks `auth.uid() = p_actor` — the §2.5 invariant for public-facing RPCs, matching `match_*`). Errors use the P5xxx convention so `errcode.ts` maps them; add two new codes.

```sql
-- supabase/migrations/20260601100200_p7_chat_send_rpc.sql
-- Phase 7 chat write path. SECURITY DEFINER; re-checks auth.uid()=p_actor.
-- New errcodes: P5010 chat_not_party, P5011 chat_closed.

-- Gate A: is this thread messageable? Open or promoted, never revoked/closed.
-- (Per plan §0 Q1 default: chat is available pre-lock and survives the lock.)
create or replace function chat_thread_messageable(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select state in ('open','promoted') and revoked_at is null
    from chat_threads where id = p_thread
  ), false);
$$;

-- both_ready (Gate B input): true once EACH party has sent >= 1 message.
-- Isolated so the rapport bar is trivial to retune (plan §0 Q1).
create or replace function chat_recompute_both_ready(p_thread uuid) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_creator uuid; v_candidate uuid; v_ready boolean;
begin
  select o.creator_id, o.candidate_id into v_creator, v_candidate
    from chat_threads t join offers o on o.id = t.offer_id where t.id = p_thread;
  v_ready := exists(select 1 from messages where thread_id = p_thread and sender_id = v_creator)
         and exists(select 1 from messages where thread_id = p_thread and sender_id = v_candidate);
  update chat_threads set both_ready = v_ready, updated_at = now()
    where id = p_thread and both_ready is distinct from v_ready;
  return v_ready;
end $fn$;

-- send a message. Asserts actor, party membership, Gate A; inserts; recomputes
-- both_ready; dispatches new_message to the OTHER party. Idempotent on p_idem_key.
create or replace function chat_send_message(
  p_actor uuid, p_thread uuid, p_body text, p_idem_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_creator uuid; v_candidate uuid; v_other uuid;
  v_msg_id uuid; v_ready boolean; v_existing uuid;
begin
  if p_actor <> auth.uid() then
    raise exception 'auth mismatch' using errcode = 'P5001';
  end if;
  -- idempotency: a retried send with the same key returns the first result.
  -- Reuse the match_idem store (action namespaced to avoid collision).
  v_existing := (match_idem_lookup(p_actor, 'chat_send', p_idem_key)->>'message_id')::uuid;
  if v_existing is not null then
    return jsonb_build_object('kind','message','message_id',v_existing,'idempotent',true);
  end if;

  select o.creator_id, o.candidate_id into v_creator, v_candidate
    from chat_threads t join offers o on o.id = t.offer_id where t.id = p_thread;
  if v_creator is null then
    raise exception 'no such thread' using errcode = 'P5010';
  end if;
  if p_actor <> v_creator and p_actor <> v_candidate then
    raise exception 'not a party to this thread' using errcode = 'P5010';
  end if;
  if not chat_thread_messageable(p_thread) then
    raise exception 'chat thread is closed' using errcode = 'P5011';
  end if;

  insert into messages(thread_id, sender_id, body)
    values (p_thread, p_actor, btrim(p_body)) returning id into v_msg_id;

  v_ready := chat_recompute_both_ready(p_thread);
  v_other := case when p_actor = v_creator then v_candidate else v_creator end;

  perform dispatch_notification(v_other, 'new_message',
    jsonb_build_object('thread_id', p_thread, 'message_id', v_msg_id, 'from', p_actor));

  perform match_idem_store(p_actor, 'chat_send', p_idem_key,
    jsonb_build_object('message_id', v_msg_id));

  return jsonb_build_object('kind','message','message_id',v_msg_id,'both_ready',v_ready);
end $fn$;

-- recipient marks all unread messages in a thread as read. Returns count.
create or replace function chat_mark_read(p_actor uuid, p_thread uuid) returns integer
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if p_actor <> auth.uid() then raise exception 'auth mismatch' using errcode = 'P5001'; end if;
  if not chat_thread_party(p_thread, p_actor) then
    raise exception 'not a party to this thread' using errcode = 'P5010';
  end if;
  update messages set read_at = now()
    where thread_id = p_thread and sender_id <> p_actor and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke execute on function chat_thread_messageable(uuid) from public, authenticated;
revoke execute on function chat_recompute_both_ready(uuid) from public, authenticated;
revoke execute on function chat_send_message(uuid, uuid, text, uuid) from public, authenticated;
revoke execute on function chat_mark_read(uuid, uuid) from public, authenticated;
```

> **Verify before writing:** `match_idem_lookup(p_actor, p_action, p_key)` and `match_idem_store(p_actor, p_action, p_key, p_result)` exist (confirmed in pg_proc). Confirm `match_idem_lookup` returns `jsonb`/`json` and the stored result is readable via `->>'message_id'`; if its shape differs, adapt the idempotency block (read its definition with `pg_get_functiondef('match_idem_lookup(uuid,text,uuid)'::regprocedure)`). If reuse is awkward, fall back to a unique partial index `messages(thread_id, sender_id, <idem>)` — but reuse is preferred for consistency.

Then add the two new errcodes to the edge mapper.

**File:** `supabase/functions/_shared/errcode.ts` — add to `P5ErrorCode`, `MAP`:
```ts
  | 'P5010'  // chat_not_party  → 403
  | 'P5011'  // chat_closed     → 409
// ...
  P5010: { status: 403, code: 'chat_not_party', message: "this conversation isn't yours." },
  P5011: { status: 409, code: 'chat_closed',    message: 'this chat is closed.' },
```
And add `'chat_not_party' | 'chat_closed'` to `MatchErrorName` + dry copy in `MESSAGES` in `apps/web/lib/after5/match.ts` (or the new `chat.ts` — see Task 7). Copy: `chat_not_party: "this conversation isn't yours."`, `chat_closed: 'this chat is closed.'`.

**Test:** `supabase/tests/p7_chat_send.sql`. Seed two profiles + offer + thread. As service role (or by `set role` to the definer owner — copy the calling pattern used by `b_*` tests that exercise SECURITY DEFINER RPCs):
- send from creator → returns `kind=message`, `both_ready=false` (only one party has sent).
- send from candidate → `both_ready=true` (mutual signal). Assert `chat_threads.both_ready` is now true.
- re-send with the SAME idem_key → returns `idempotent=true`, no second row.
- send to a closed thread (`update chat_threads set state='closed'`) → raises `P5011`.
- send as a non-party actor → raises `P5010`.
- `chat_mark_read` by candidate marks the creator's message read; second call returns 0.
- assert a `notifications` row of type `new_message` exists for the recipient with `payload->>'thread_id'`.

**Run:** `pnpm db:test`; `pnpm db:types`; `mcp__supabase__get_advisors type:security`.

---

### Task 4 — add `messages` to the Realtime publication

**File:** `supabase/migrations/20260601100500_p7_messages_realtime_publication.sql`

`postgres_changes` only streams tables in the `supabase_realtime` publication. `notifications` and `locks` are already in it (that's why their subscriptions work). Add `messages`. RLS still gates which rows each socket receives.

```sql
-- supabase/migrations/20260601100500_p7_messages_realtime_publication.sql
-- Stream message inserts to subscribed clients. RLS (messages_party_read) gates
-- delivery so a socket only receives messages in the viewer's own threads.
do $$ begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null; end $$;
```

> **Verify:** the publication is named `supabase_realtime` and already contains `notifications`/`locks` — confirm with `select tablename from pg_publication_tables where pubname='supabase_realtime';` before/after. Replica identity: INSERT payloads carry the full new row by default; no `REPLICA IDENTITY FULL` needed for inserts (only matters for UPDATE/DELETE old-row). We only subscribe to INSERT.

**Test:** add to `p7_chat_send.sql`:
```sql
do $$ begin
  assert exists(select 1 from pg_publication_tables
                where pubname='supabase_realtime' and tablename='messages'),
    'messages must be in the realtime publication';
end $$;
```

---

### Task 5 — wire the rapport-gate into lock (amend `chat_lock_ready`) + rollback

**File:** `supabase/migrations/20260601100300_p7_chat_lock_ready_rapport.sql`

This is **Gate B** and the behavior change flagged in §0 Q2. Today `match_accept_offer` → `chat_lock_ready` returns `state='open'`. Phase 7 adds `AND both_ready` so locking requires mutual rapport. Signature unchanged; A's call site untouched (exactly the forward-compat path the Z spec §2.3 described).

```sql
-- supabase/migrations/20260601100300_p7_chat_lock_ready_rapport.sql
-- Phase 7 Gate B: lock requires rapport. both_ready is set by chat_recompute_both_ready
-- (each party sent >= 1 message). Signature + call sites unchanged (Z spec §2.3).
create or replace function chat_lock_ready(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select state = 'open' and both_ready from chat_threads where id = p_thread
  ), false);
$$;
revoke execute on function chat_lock_ready(uuid) from public, authenticated;
```

**Rollback file (keep, do NOT apply):** `supabase/migrations/20260601100400_p7_chat_lock_ready_rollback.sql` — restores `state='open'` body verbatim, so prod can revert the gate without a code deploy if accept-flow breakage shows up.

**Test:** `supabase/tests/p7_chat_lock_ready.sql` — seed a thread, assert all combos:
- `state='open', both_ready=false` → false (was true pre-Phase-7; this is the new gate).
- `state='open', both_ready=true` → true.
- `state='promoted'` → false. `state='closed'` → false. missing → false.
- Integration sanity: an offer with no messages, candidate calls `match_accept_offer` → expect `P5005 chat_not_ready` (the gate now bites). Then send one message each, accept again → succeeds. **Only run this integration assertion if §0 Q2 is confirmed "hard gate".** If not confirmed, skip this migration entirely and keep `both_ready` UI-only.

**Run:** `pnpm db:test`. Note in the runbook that 100300 is feature-gated by `match_v2_enabled` cohort at the app layer (the accept flow is already cohort-gated), so the blast radius on prod is the allowlisted cohort only.

---

### Task 6 — edge function `chat-send-message`

**Files:** `supabase/functions/chat-send-message/index.ts` + `index.test.ts`. Copy `match-accept-offer/index.ts` exactly — it is the minimal template (`withMatchHandler` + `callRpcAndRespond`).

```ts
// supabase/functions/chat-send-message/index.ts
// Wraps public.chat_send_message. Args: { thread, body, idem_key? }.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, mintIdemKey, type MatchHandler } from '../_shared/match.ts';

export const matchHandler: MatchHandler = async ({ user, body, client }) => {
  const { thread, body: text, idem_key } = body as { thread?: string; body?: string; idem_key?: string };
  if (!thread || !text || !text.trim()) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'thread and body required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'chat_send_message', {
    p_actor: user.id,
    p_thread: thread,
    p_body: text,
    p_idem_key: idem_key ?? mintIdemKey(),
  });
};

export const handler = withMatchHandler(matchHandler);
if (import.meta.main) serve(handler);
```

**Test:** `supabase/functions/chat-send-message/index.test.ts` — mirror `match-accept-offer/index.test.ts` (uses `_shared/_test_supabase_stub.ts`). Assert: missing `thread`/`body` → 400 `bad_request`; valid body calls `chat_send_message` with the four `p_*` args and returns the RPC's jsonb in `data`; a stubbed PG error `{code:'P5011'}` maps to 409 `chat_closed`.

**Run:** the function test command the other `match-*` functions use (check `supabase/functions/_shared/_test_import_map.json`; typically `deno test --allow-env --import-map=supabase/functions/_shared/_test_import_map.json supabase/functions/chat-send-message/index.test.ts`). Mark `verify_jwt` in the function config the same way the `match-*` functions are configured (they verify in-handler; replicate `supabase/config.toml` entry if one exists per function).

---

### Task 7 — client wrapper `lib/after5/chat.ts`

**Files:** `apps/web/lib/after5/chat.ts` + `__tests__/chat.test.ts`. Follow `match.ts` style: discriminated results, `MatchError` reuse (import it) or a thin `ChatError`. Reads go direct through the browser client; the send goes through the edge function.

```ts
// apps/web/lib/after5/chat.ts
'use client';
import { browserAfter5Client } from '@/lib/after5/client';
import { MatchError, type MatchErrorName } from '@/lib/after5/match';
import type { Database } from '@after5/types';

export type MessageRow = Database['public']['Tables']['messages']['Row'];
export type SendResult = { kind: 'message'; message_id: string; both_ready?: boolean; idempotent?: boolean };

type Envelope<T> = { ok: boolean; data?: T; code?: string; errcode?: string; detail?: string };

export async function sendMessage(threadId: string, body: string): Promise<SendResult> {
  const { data } = await browserAfter5Client().functions.invoke<Envelope<SendResult>>('chat-send-message', {
    body: { thread: threadId, body, idem_key: crypto.randomUUID() },
  });
  if (!data) throw new MatchError('unknown' as MatchErrorName);
  if (data.ok === false) throw new MatchError((data.code as MatchErrorName) ?? 'unknown', data.errcode, data.detail);
  return data.data as SendResult;
}

// initial conversation load, oldest -> newest, RLS-gated.
export async function fetchMessages(threadId: string): Promise<MessageRow[]> {
  const { data, error } = await browserAfter5Client()
    .from('messages').select('*').eq('thread_id', threadId).order('created_at', { ascending: true });
  if (error) throw new MatchError('server_error', error.code, error.message);
  return (data ?? []) as MessageRow[];
}

export async function markThreadRead(threadId: string): Promise<number> {
  const { data, error } = await browserAfter5Client().rpc('chat_mark_read' as never, { p_actor: undefined as never, p_thread: threadId } as never);
  // NOTE: chat_mark_read re-checks auth.uid()=p_actor. The browser client cannot pass
  // a trusted p_actor. DECISION: either (a) add a tiny chat-mark-read edge fn that
  // injects user.id (preferred, matches send), or (b) drop p_actor from chat_mark_read
  // and derive auth.uid() inside. Implementer: pick (b) — simpler — and make
  // chat_mark_read take only (p_thread uuid), using auth.uid() internally + the
  // chat_thread_party check. Update Task 3 RPC + test accordingly.
  if (error) throw new MatchError('server_error', error.code, error.message);
  return (data as number) ?? 0;
}
```

> **Resolve during Task 3/7:** `chat_mark_read` should take only `(p_thread uuid)` and use `auth.uid()` internally (a SELECT/UPDATE RPC the authenticated client may call directly, like the `notifications_recipient_mark_read` RLS pattern). `chat_send_message` must keep `p_actor` because it runs SECURITY DEFINER through the edge fn with a service path; it re-checks `auth.uid()=p_actor`. Make `chat_mark_read` callable by `authenticated` (grant execute) since it only mutates the caller's own read state and is guarded by `chat_thread_party`. Adjust the Task 3 migration + the `revoke` line for `chat_mark_read` to `grant execute ... to authenticated` instead.

**Test:** `apps/web/lib/after5/__tests__/chat.test.ts` (Vitest). Mock `browserAfter5Client`. Assert `sendMessage` posts the right body and unwraps `data`; an `ok:false` envelope throws `MatchError` with the right `code`; `fetchMessages` orders by `created_at`.

**Run:** `pnpm --filter @after5/web test -- chat.test` (or the repo's vitest invocation — see `apps/web/package.json`).

---

### Task 8 — realtime subscription `subscribeThreadMessages`

**File:** `apps/web/lib/after5/realtime.ts` — append, mirroring `subscribeNotifications` exactly.

```ts
export type MessageRow = Database['public']['Tables']['messages']['Row'];

// Phase 7 conversation view. Per-thread channel. RLS (messages_party_read) gates
// which inserts the socket delivers; we add an explicit thread_id filter as belt.
export function subscribeThreadMessages(
  threadId: string,
  onInsert: (row: MessageRow) => void,
): () => void {
  const client = browserAfter5Client();
  const ch = client
    .channel(`chat:${threadId}:${crypto.randomUUID()}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
      (payload: { new: MessageRow }) => onInsert(payload.new))
    .subscribe();
  return () => { client.removeChannel(ch); };
}
```

**Test:** `apps/web/lib/after5/__tests__/realtime.chat.test.ts` — copy `realtime.notif.test.ts`. Assert channel name pattern `chat:<threadId>:`, the `postgres_changes` INSERT config with the `thread_id` filter, that `onInsert` fires with `payload.new`, and that the returned disposer calls `removeChannel`.

**Run:** vitest as above (`realtime.chat.test`).

---

### Task 9 — thread-view pure helpers

**File:** `apps/web/app/messages/thread-view.ts` (server-safe, NO `'use client'` — same rule as `lock-view.ts`). Pure functions the page + components import.

```ts
// apps/web/app/messages/thread-view.ts
import type { Database } from '@after5/types';
type MessageRow = Database['public']['Tables']['messages']['Row'];

export interface ThreadSummary {
  threadId: string;
  counterpartName: string | null;
  counterpartPhotoUrl: string | null;
  dateLabel: string;            // e.g. "pottery night · fri"
  lastMessage: string | null;
  lastAt: string | null;
  unread: number;
  messageable: boolean;
}

export function unreadCount(messages: MessageRow[], viewerId: string): number {
  return messages.filter((m) => m.sender_id !== viewerId && m.read_at == null).length;
}
export function lastMessagePreview(messages: MessageRow[]): { body: string; at: string } | null {
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1];
  return { body: last.body.length > 64 ? `${last.body.slice(0, 63)}…` : last.body, at: last.created_at };
}
export function sortThreadsByRecency(threads: ThreadSummary[]): ThreadSummary[] {
  return [...threads].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
}
```

**Test:** `apps/web/app/messages/__tests__/thread-view.test.ts` — assert unread excludes own + read messages; preview truncates at 64; empty → null; sort puts most-recent first, null `lastAt` last.

**Run:** vitest (`thread-view.test`).

---

### Task 10 — thread-list page (the `messages` tab)

**Files:** `apps/web/app/messages/page.tsx` (server entry), `ThreadList.tsx` (client), `__tests__/ThreadList.test.tsx`.

`page.tsx` (server, `force-dynamic`): get user; gate on `isMatchEnabledForViewer` (reuse `@/lib/match/flag`, like `matches/[lockId]/page.tsx`); load the viewer's threads + counterpart profile + last message + unread in one query. Threads come from `chat_threads` (RLS already scopes to the viewer's threads after Task 2) joined to `offers` for the counterpart + to the date for the label. Build `ThreadSummary[]` via `thread-view.ts`, render `ThreadList`. Empty state in brand voice ("no chats yet. lock eyes first." — keep it dry, not helpful).

```tsx
// apps/web/app/messages/page.tsx  (sketch — implementer fills the exact select)
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { isMatchEnabledForViewer } from '@/lib/match/flag';
import { ThreadList } from './ThreadList';
import { sortThreadsByRecency, type ThreadSummary } from './thread-view';

export const dynamic = 'force-dynamic';

export default async function MessagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/messages');
  if (!(await isMatchEnabledForViewer(supabase))) return <ComingSoonBanner />;

  // chat_threads RLS scopes to the viewer; embed offer→counterpart + date for the label.
  const { data: rows } = await supabase
    .from('chat_threads')
    .select(`id, state, revoked_at,
      offer:offers!chat_threads_offer_id_fkey (
        creator_id, candidate_id,
        creator:profiles!offers_creator_id_fkey ( id, first_name, clear_photo_url ),
        candidate:profiles!offers_candidate_id_fkey ( id, first_name, clear_photo_url ),
        instance:date_instances ( id, starts_at )
      )`);
  // implementer: derive counterpart (the party that ISN'T user.id), last message +
  // unread (one extra select on messages, or an aggregated view — keep it 1-2 queries),
  // map to ThreadSummary[], then sortThreadsByRecency(...).
  const threads: ThreadSummary[] = sortThreadsByRecency(/* mapped */ []);
  return <ThreadList threads={threads} />;
}
```

> **Verify FK hint names** before writing the select: the lock page uses `profiles!locks_creator_id_fkey`. Confirm the analogous `offers_creator_id_fkey` / `offers_candidate_id_fkey` / `chat_threads_offer_id_fkey` constraint names with `select conname from pg_constraint where conrelid='offers'::regclass;` and adjust the embed hints. Unread per thread: cheapest is a second query `select thread_id, count(*) from messages where read_at is null and sender_id <> <me> group by thread_id` then merge.

`ThreadList.tsx` (client): map rows to tappable cards (`Link` to `/messages/[threadId]`). Barbiecore: `max-w-[420px]`, `rounded-3xl`, `font-heading` lowercase title "messages", each row = counterpart photo (Polaroid-ish or round avatar), `font-body` name + `dateLabel`, last-message preview muted, an unread dot (`bg-shell-accent`) when `unread>0`, ≥44px tap target. Use `lucide-react`. Empty state component, dry copy.

**Test:** `__tests__/ThreadList.test.tsx` (Vitest + Testing Library) — renders a row per thread with name + preview; shows unread dot only when `unread>0`; empty array renders the empty-state copy; each row links to `/messages/<id>`; a11y: list has an accessible name, links have discernible text.

**Run:** vitest (`ThreadList.test`).

---

### Task 11 — conversation view + composer

**Files:** `apps/web/app/messages/[threadId]/page.tsx` (server), `Conversation.tsx` (client), `Composer.tsx` (client), `__tests__/Conversation.test.tsx`, `__tests__/Composer.test.tsx`.

`page.tsx` (server): get user; gate; load the thread (RLS confirms membership — if not a party, the row is null → render "not your conversation"); derive counterpart; pass `threadId`, `counterpart`, `viewerId`, `messageable` (from `state`/`revoked_at`) and the initial messages to `Conversation`.

`Conversation.tsx` (client):
- Seed state with the server's initial messages.
- `useEffect`: `subscribeThreadMessages(threadId, (m) => append if not already present)`; dispose on unmount. Dedupe by `id` (the sender also gets their own insert echoed back; the optimistic append + realtime insert must not double-render — key by `id`).
- On mount + on window focus: call `markThreadRead(threadId)` (Task 7) so the unread dot clears.
- Render messages as bubbles: own messages right-aligned `bg-shell-accent text-white`, counterpart left-aligned `bg-shell-pink text-shell-ink`, `rounded-3xl`, `font-body`, timestamps muted. `role="log"` `aria-live="polite"` on the list so SR users hear new messages. Auto-scroll to bottom on new message (respect `prefers-reduced-motion`).
- If `!messageable`, hide the composer and show "this chat is closed" (dry).

`Composer.tsx` (client): a textarea (`max 2000`, mirrors the DB check) + send button (`bg-shell-accent`, lowercase "send it" per brand verbs). On submit: optimistic append (temp id), call `sendMessage`; on success reconcile (the realtime insert replaces the optimistic row by matching `message_id`); on `MatchError` show `sonner` toast with `messageForCode(err.code)` and roll back the optimistic row. Disable while sending; ≥44px tap target; Enter-to-send with Shift+Enter newline.

```tsx
// apps/web/app/messages/[threadId]/Composer.tsx (sketch)
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { sendMessage } from '@/lib/after5/chat';
import { messageForCode } from '@/lib/after5/match';

export function Composer({ threadId, onOptimistic, onSettled }: {
  threadId: string;
  onOptimistic: (tempId: string, body: string) => void;
  onSettled: (tempId: string, messageId: string | null) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    const tempId = crypto.randomUUID();
    setBusy(true); onOptimistic(tempId, body); setText('');
    try {
      const r = await sendMessage(threadId, body);
      onSettled(tempId, r.message_id);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? 'server_error';
      toast(messageForCode(code)); onSettled(tempId, null);
    } finally { setBusy(false); }
  }
  // ...textarea + button, lowercase "send it", 44px, Enter-to-send
}
```

**Tests:**
- `Composer.test.tsx`: typing + send calls `sendMessage` with trimmed body; empty/whitespace does nothing; on thrown `MatchError('chat_closed')` shows the toast and calls `onSettled(tempId, null)`; disabled while busy.
- `Conversation.test.tsx`: renders initial messages as bubbles (own vs counterpart alignment via a testable class/role); a realtime insert (mock `subscribeThreadMessages` to invoke its callback) appends a new bubble and does NOT duplicate one already present by `id`; calls `markThreadRead` on mount; hides composer when `messageable=false`; list is `role="log"` `aria-live="polite"`.

**Run:** vitest (`Composer.test`, `Conversation.test`).

---

### Task 12 — wire navigation: BottomTabShell + LockDetail; remove placeholder

**File:** `apps/web/components/BottomTabShell.tsx` — change the `messages` tab from `{ kind: 'soon' }` to `{ kind: 'live', href: '/messages' }`. Optionally surface a small unread dot on the icon driven by `subscribeNotifications` filtered to `new_message` (or a count passed from a server layout). Keep the change minimal: flip to live + route to `/messages`. Remove the dry-toast branch only if no other tab uses `kind:'soon'` (it may still be needed — keep the `SoonTab` type).

**File:** `apps/web/app/matches/[lockId]/LockDetail.tsx` — replace `<Phase7Placeholder />` (line 75) with a primary CTA linking to the thread for this match. The lock has `creator_id`/`matched_user_id` but the thread is keyed by `offer_id`; resolve the thread id by querying `chat_threads` for the offer that produced this lock (the lock row carries `date_instance_id` + the two parties; find the promoted thread via `chat_threads.lock_id = lock.id`). Simplest: in `matches/[lockId]/page.tsx`, also select `chat_threads!chat_threads_lock_id_fkey ( id )` and pass `threadId` into `LockDetail`, then render `<Link href={\`/messages/${threadId}\`}>message {counterpart.first_name}</Link>` styled as a `bg-shell-accent` pill ("slide in" or "message {name}", lowercase). If no thread (shouldn't happen post-lock), fall back to a quiet note.

**Files to delete (after the above compiles):** `apps/web/app/matches/[lockId]/Phase7Placeholder.tsx` and `apps/web/app/matches/[lockId]/__tests__/Phase7Placeholder.test.tsx`.

**Test:** update/replace `LockDetail.test.tsx` — assert it now renders a link to `/messages/<threadId>` with discernible lowercase text and NOT the "coming with phase 7" copy. Update `BottomTabShell` test (if one exists) to assert `messages` is a `Link` to `/messages` with `aria-current` behavior, not a button.

**Run:** vitest for the touched component tests + `pnpm --filter @after5/web build` to confirm no type errors after the type regen.

---

### Task 13 — full verification gate

Run, in order, and paste evidence into the PR/runbook:

1. `supabase start` (local stack).
2. `pnpm db:test` — all SQL tests green, including the three new `p7_*.sql`.
3. `pnpm db:types` — diff shows `messages` + new RPCs; commit the regenerated `packages/types/src/database.ts`.
4. Deno function tests for `chat-send-message`.
5. `pnpm --filter @after5/web test` — all vitest green (chat, realtime.chat, thread-view, ThreadList, Conversation, Composer, updated LockDetail).
6. `pnpm --filter @after5/web build` — typechecks.
7. `mcp__supabase__get_advisors type:security` against local (or a preview branch) — no new ERROR findings; `messages` + `chat_threads` show RLS-enabled-with-policies (not the "RLS enabled no policy" advisory).
8. **Prod apply (human-gated):** apply the six migrations in band order via the runbook's per-migration discipline; re-run the security advisor on prod; deploy `chat-send-message`; deploy web. Confirm `match_v2_enabled` cohort still controls exposure (the gate change in Task 5 only bites for the cohort). Keep the Task 5 rollback migration handy.

---

## 8. Out of scope (flag for a later phase)

- **Moderation / reporting** of individual messages, block-from-chat, profanity filtering. `legal_hold` + `revoked_at` plumbing exists for retention but there's no in-chat report affordance here (§0 Q4).
- **Attachments / images / read receipts UI** beyond the unread dot. `read_at` is stored; surfacing "seen" is deferred.
- **Typing indicators / presence** (would use Realtime Presence, not `postgres_changes`).
- **Push delivery** of `new_message` beyond what `dispatch_notification` already routes (the device/push pipeline is owned elsewhere; this plan only dispatches the notification).
- **Collapsing multiple threads per counterpart** into one conversation (§0 Q5 — currently one thread per offer/night).
- **`participants[2]` column / `chat_thread_state` enum** upgrades the Z spec deferred — still deferred; the derived-party path works.

## 9. Risks

- **R1 (medium):** Task 5 changes a shipped flow (accept now needs rapport). Mitigated by the cohort flag + the kept rollback migration + the integration test. Confirm §0 Q2 before applying 100300 to prod.
- **R2 (low):** SECURITY DEFINER policy helper (`chat_thread_party`) — if the security advisor objects to a definer function in a policy, inline the `EXISTS` (the `offers` join is independently party-readable). The Task 2 test is the contract either way.
- **R3 (low):** realtime echo dedup — the sender receives their own insert; the conversation view must key by `id` so the optimistic row and the realtime row don't double-render (covered by the Conversation test).
- **R4 (low):** `match_idem_lookup`/`store` reuse for chat idempotency — verify shape first; fall back to a unique index if awkward.
```

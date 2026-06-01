# Phase 7 Chat — Adversarial Security Audit

> **✅ REMEDIATION (2026-06-01, post-audit):** HIGH-1 (`chat_send_message`/`report_message` REVOKEd from `authenticated`, breaking all sends/reports) was independently caught by a live prod write-path test and **fixed** via migration `20260601100600_p7_grant_chat_write_rpcs.sql` — grant EXECUTE to `authenticated`, mirroring the `match_*` pattern; the in-body `auth.uid()=p_actor` + party + Gate-A checks preserve safety. Applied to prod and verified: a real r2host→r2cand message sends end-to-end (row inserted + `new_message` notification dispatched). The LOW finding is documented/accepted. No open security items remain.

- **Date:** 2026-06-01
- **Auditor:** read-only adversarial review (isolated worktree `worktree-agent-adb0923a92e85f48e`)
- **Scope:** migrations `20260601100000`–`20260601100500` (messages table, party RLS, `chat_send_message` / `chat_recompute_both_ready` / `chat_thread_messageable` / `chat_mark_read`, `message_reports` + `report_message`, realtime publication); edge fns `chat-send-message` + `chat-report-message`; client `apps/web/lib/after5/chat.ts` + `/messages` UI.
- **Method:** read code; ran read-only + simulated-role SQL against the LOCAL stack (`set local role` + `set local request.jwt.claims` to impersonate four users across two threads); read PROD schema, grants, advisors, and edge-function registry read-only via MCP. No app/DB code modified; no prod mutation. Local test fixtures were seeded (4 users / 2 offers / 2 threads) and left in place.
- **Fixtures:** Thread A parties `{11111111…(creator), 22222222…(candidate)}`; Thread B parties `{33333333…(creator), 44444444…(candidate)}`.

---

## Verdict summary

| # | Vector | Verdict |
|---|--------|---------|
| 1 | Cross-thread / tier RLS leakage (messages, chat_threads, realtime) | **PASS** |
| 2 | RPC abuse — direct call, forged actor, non-party, closed/revoked (Gate A) | **PASS (posture) — but see HIGH-1: edge invocation contract is broken** |
| 3 | `chat_mark_read` cross-thread mutation/probe | **PASS** |
| 4 | Report abuse — own message / non-party / forge / flood / report leakage | **PASS** |
| 5 | Injection / body bounds / trimming / XSS | **PASS** |
| 6 | search_path / SECURITY DEFINER hygiene + advisors | **PASS** |
| — | Edge invocation contract (`authenticated` role calls a REVOKEd-from-`authenticated` RPC) | **FINDING — HIGH-1** |

**No CRITICAL data-exposure or privilege-escalation finding.** The default-deny RLS posture and the `auth.uid() = p_actor` re-check are correct and were verified by simulation. The one substantive finding (HIGH-1) is a broken invocation contract: the chat write path as wired cannot execute, and on the local Postgres build the failed call segfaults the backend (a self-inflicted availability/DoS surface).

---

## Vector 1 — Cross-thread / tier RLS leakage — PASS

`messages` and `chat_threads` are RLS-enabled with a single SELECT policy for `authenticated`, gated by `chat_thread_party(thread_id, auth.uid())`, which is `SECURITY DEFINER` (so the policy can join `offers` without recursing into `chat_threads` RLS) and returns only a boolean. No INSERT/UPDATE/DELETE policy exists → those verbs are default-denied for clients.

Simulated reads (local):

- **Party reads own thread only.** As `22222222…` (Thread A candidate), `SELECT * FROM messages` returned only the Thread A row. PASS.
- **Non-party reads nothing cross-thread.** As `44444444…` (Thread B candidate), `SELECT … WHERE thread_id = <Thread A>` → **0 rows**; unfiltered `SELECT * FROM messages` → only the Thread B row. PASS.
- **chat_threads scoped.** As `44444444…`, `SELECT * FROM chat_threads` → only Thread B. PASS.
- **anon sees nothing.** As `anon`, `SELECT count(*) FROM messages` → **0**. PASS.

**Realtime:** the publication adds `messages` to `supabase_realtime` (`20260601100500`). Realtime postgres_changes delivery is gated per-subscriber by `messages_party_read` (the subscriber's JWT is evaluated against the policy), the same proven pattern already shipped for `locks` and `notifications`. The client-supplied `filter: thread_id=eq.<id>` in `subscribeThreadMessages` is an optimization, **not** the security boundary; even if an attacker subscribes with another user's `thread_id`, RLS denies delivery (verified that a non-party's RLS read of that thread returns 0 rows, which is the same predicate Realtime applies). PASS. *(Note: this assumes Realtime authorization/RLS remains enabled on the project — consistent with the existing locks/notifications channels. A live two-socket test was out of scope for a read-only audit.)*

---

## Vector 2 — RPC abuse — PASS on posture; HIGH-1 on invocation

**Grants (verified identical on LOCAL and PROD):**

| function | authenticated EXEC | anon EXEC | service_role EXEC |
|---|---|---|---|
| `chat_send_message(uuid,uuid,text,uuid)` | **f** | f | t |
| `report_message(uuid,uuid,text)` | **f** | f | t |
| `chat_thread_messageable(uuid)` | f | f | t |
| `chat_recompute_both_ready(uuid)` | f | f | t |
| `chat_mark_read(uuid)` | t | f | t |
| `chat_thread_party(uuid,uuid)` | t | f | t |

- **Direct PostgREST call denied.** `has_function_privilege('authenticated', 'chat_send_message(uuid,uuid,text,uuid)', 'execute') = f`. A logged-in user hitting `/rest/v1/rpc/chat_send_message` is rejected (no EXECUTE). PASS.
- **Forged `p_actor` rejected.** Simulating the edge path as `service_role` with `auth.uid()=22222222…` but `p_actor=11111111…` → `P5001 auth mismatch` (`chat_send_message` line 7: `if p_actor is distinct from (select auth.uid())`). PASS.
- **Non-party send rejected.** `auth.uid()=p_actor=44444444…` sending into Thread A → `P5010 not a party`. PASS.
- **Gate A — closed thread.** Thread set `state='closed'`, party sends → `P5011 chat thread is closed`. PASS.
- **Gate A — revoked thread.** `revoked_at=now()`, party sends → `P5011`. PASS. (`chat_thread_messageable` requires `state IN ('open','promoted') AND revoked_at IS NULL`.)

> Posture is correct: the RPC re-checks the actor, party membership, and Gate A, and is unreachable by `authenticated`/`anon` directly. **But the write path cannot actually execute as wired — see HIGH-1.**

---

## HIGH-1 (HIGH) — Chat write edge functions invoke a REVOKEd-from-`authenticated` RPC through the `authenticated`-role client → every send/report fails (and crashes the DB backend on the local build)

**Severity: HIGH** (functional break on the just-shipped surface + self-inflicted availability/DoS surface).

**Evidence.**

1. `chat_send_message` and `report_message` are `REVOKE EXECUTE … FROM public, anon, authenticated` (migration `20260601100200` lines 100–102; `20260601100250` line 51). Confirmed live: `authenticated` EXEC = **f** on both LOCAL and PROD.
2. The edge functions call the RPC through the **authed** client, not the service client:
   - `chat-send-message/index.ts:9,20` → `async ({ user, body, client }) => … callRpcAndRespond(client, 'chat_send_message', {…})`
   - `chat-report-message/index.ts:9,16` → `callRpcAndRespond(client, 'report_message', {…})`
   - `_shared/match.ts:49–51` builds `client` as `createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })`. A request through this client carries the **user JWT**, so PostgREST executes the RPC as the **`authenticated`** role — which has no EXECUTE. `serviceClient` (service_role, which *does* have EXECUTE) is built (`match.ts:68`) but **never passed** to the chat RPCs.
3. **This diverges from the working `match-*` template.** Every shipped `match_*` RPC keeps `authenticated` EXECUTE (`auth_exec = t` for `match_make_offer`, `match_accept_offer`, `match_pass_offer`, `match_shortlist`, `match_withdraw`, `match_cancel_lock`, `match_resolve_reciprocal`), so the identical `callRpcAndRespond(client, …)` template works for them. The chat functions copied the template verbatim but then REVOKEd `authenticated`, breaking the contract.
4. **The plan itself states the intended path was service-role.** `docs/superpowers/plans/2026-05-31-phase7-chat-messaging.md:260`: *"only the edge function's **service-role**/authed client calls them via `client.rpc`, and the RPC re-checks `auth.uid() = p_actor`."* The re-check exists precisely so the RPC can safely run with elevated privilege — but the elevated (service) client was never wired in.
5. **Reproduced on the local build:** calling `chat_send_message` while `set local role authenticated` terminated the backend with **`signal 11: Segmentation fault`** (Postgres log, PID 3137 and 3217; ~1s auto-recovery) — the documented "missing-EXECUTE SELECT crashes this Supabase build" quirk (see migration comment `20260527126650_p5_revoke_internals_from_anon.sql:20`). The same RPC as `service_role` with a valid party succeeds and returns `{"kind":"message",…}`.

**Impact.**
- **Functional:** the chat send + report buttons do not work end-to-end. On a standard PG build the user gets a `42501 permission denied` mapped to a 500 (`server_error`); on the build used by the local stack the call **segfaults the DB backend**.
- **Availability / DoS:** where the segfault behavior is present, a single authenticated user repeatedly pressing "send" repeatedly crashes a DB backend (forced recovery each time) — a trivial, unauthenticated-beyond-login DoS. On managed prod the failure mode is more likely a clean permission-denied 500, but that must be confirmed against the prod build before relying on it; the functional break is certain regardless.

**Recommended fix (pick one, in preference order):**
1. **Pass the service client to the chat write RPCs** (matches the plan's stated contract and keeps the RPC unreachable by clients): in `chat-send-message/index.ts` and `chat-report-message/index.ts`, destructure `serviceClient` and call `callRpcAndRespond(serviceClient, 'chat_send_message'/'report_message', {… p_actor: user.id …})`. The in-RPC `auth.uid() = p_actor` check still binds the action to the verified caller — but note `auth.uid()` is null under a bare service-role client, so prefer fix (2) if going this route, OR pass the actor explicitly and drop the `auth.uid()` re-check in favor of trusting the edge-verified `user.id` (the edge already verified the JWT via `client.auth.getUser()`).
2. **Grant EXECUTE to `authenticated`** on `chat_send_message` / `report_message` (mirroring every `match_*` RPC) and keep calling via the authed `client`. The `auth.uid() = p_actor` re-check then remains meaningful (it runs as the real user), and the existing template works unchanged. This is the smallest, most consistent change and preserves the actor re-check semantics.

Either way, add an end-to-end (non-mocked) test that exercises the deployed edge function against a real DB — the current `index.test.ts` files mock the RPC and therefore never caught this.

---

## Vector 3 — `chat_mark_read` cross-thread — PASS

`chat_mark_read(p_thread)` is `authenticated`-callable by design (derives the actor from `auth.uid()`, mutates only the caller's own read state). Guards verified:

- **Non-party rejected.** As `44444444…` calling `chat_mark_read(<Thread A>)` → `P5010 not a party` (guarded by `chat_thread_party`). PASS.
- **Nonexistent thread rejected.** As a real user calling on a random UUID → `P5010`. PASS (no information leak; same error as not-a-party).
- **Valid party works.** As `22222222…` (recipient) → marked count `1`. PASS.
- **Blast radius is bounded** even if the guard were bypassed: the UPDATE is `WHERE thread_id = p_thread AND sender_id <> v_uid AND read_at IS NULL`, so a caller can never alter their *own* sent messages' read state or write to a different thread. PASS.

---

## Vector 4 — Report abuse — PASS

`report_message` is `SECURITY DEFINER`, REVOKEd from public/anon/authenticated, re-checks `auth.uid() = p_actor`, then asserts party membership and not-own-message. `message_reports` is RLS-enabled with **zero policies** (deny-by-default; no client read/write).

- **Report own message → `P5012`** (line 14: `if p_actor = v_sender`). PASS.
- **Report from non-party → `P5012`** (line 17, `chat_thread_party`). PASS.
- **Forged actor → `P5001`** (`auth.uid()` mismatch). PASS.
- **Flood / idempotency:** `unique (message_id, reporter_id)` + `ON CONFLICT … DO UPDATE`. Two reports by the same reporter on the same message returned the **same `report_id`** and left exactly **1** row (reason updated to the latest non-null). PASS — no report flooding.
- **Report-table leakage:** as an authenticated party, `SELECT count(*) FROM message_reports` (with a seeded report) → **0** (RLS deny-by-default, no SELECT policy). PASS. Advisor flags this as INFO `rls_enabled_no_policy` — intentional.

*(HIGH-1 applies here too: `report_message` is wired through the authed `client` and is REVOKEd from `authenticated`, so the report edge fn has the same broken invocation contract. Same fix.)*

---

## Vector 5 — Injection / body bounds / trimming / XSS — PASS

- **Check constraint** `char_length(btrim(body)) between 1 and 2000` (migration `20260601100000:9`). Verified: whitespace-only body → `messages_body_check` violation; 2001 chars → violation; 2000 chars → OK.
- **Trimming:** `chat_send_message` inserts `btrim(p_body)`. Verified: `'   hello   '` stored as `'hello'` (length 5). The edge fn additionally rejects empty/whitespace bodies before the RPC (`!text.trim()`). PASS.
- **SQL injection:** none. All values are parameter-bound (plpgsql variables / typed RPC args); no dynamic SQL anywhere in the chat path.
- **Stored XSS:** body is stored as raw text (correct — escaping is a render concern). The conversation view renders `{message.body}` as a JSX text node (`apps/web/app/messages/[threadId]/Conversation.tsx:55`), which React auto-escapes; **no `dangerouslySetInnerHTML`** anywhere in the `/messages` UI. PASS.

---

## Vector 6 — search_path / SECURITY DEFINER hygiene + advisors — PASS

- **All six new functions** (`chat_send_message`, `report_message`, `chat_mark_read`, `chat_thread_party`, `chat_thread_messageable`, `chat_recompute_both_ready`) are `SECURITY DEFINER` with **`search_path = public` pinned** — confirmed live on PROD via `pg_proc.proconfig`.
- **Grants** are least-privilege: write/internal RPCs → service_role only; `chat_mark_read` + `chat_thread_party` → authenticated (intentional, see below); none executable by `anon`.
- **PROD security advisor** (read-only via MCP): 59 lints — 43 WARN, 15 INFO, **1 ERROR**. The single ERROR is `rls_disabled_in_public` on `public.spatial_ref_sys` (PostGIS-owned, pre-existing, **not** introduced by Phase 7). Phase 7 introduced **no new ERROR**.
  - `message_reports` → INFO `rls_enabled_no_policy` — intentional deny-by-default.
  - `chat_mark_read` and `chat_thread_party` → WARN `authenticated_security_definer_function_executable`. Both are intentional and defensible: `chat_thread_party` returns only a boolean (no row data) and `chat_mark_read` derives the actor from `auth.uid()` and self-guards. Acceptable; document the intent so the WARN isn't mistaken for a regression. (LOW.)

---

## Findings by severity

- **CRITICAL:** 0
- **HIGH:** 1 — HIGH-1 (broken edge invocation contract; functional break + segfault/DoS on the local build).
- **MED:** 0
- **LOW:** 1 — two SECURITY DEFINER functions are `authenticated`-executable (advisor WARN); intentional, document the rationale.

## Overall verdict

**The security posture is sound: no cross-thread/tier data leakage, no privilege escalation, default-deny RLS everywhere, correct actor re-checks, bounded/trimmed input, escaped rendering, pinned search_paths, and no new advisor ERROR.** Every threat-model vector for *unauthorized access* tested PASS under live role simulation.

The one substantive finding is **not** an exposure but a **broken write path**: the send/report edge functions call RPCs that are REVOKEd from the `authenticated` role through the `authenticated`-role client, so the calls cannot execute — and on the local Postgres build they segfault the backend, which is a self-inflicted availability/DoS surface. This needs to be fixed before chat is considered functionally live, and confirmed against the prod Postgres build (clean 500 vs. crash).

## Prioritized fix list

1. **HIGH-1 — fix the chat write invocation contract.** Either (a) grant `EXECUTE` on `chat_send_message` + `report_message` to `authenticated` (mirrors every `match_*` RPC; keeps the `auth.uid()=p_actor` re-check meaningful; smallest change), or (b) route both edge fns through `serviceClient` (matches the plan's stated contract; if chosen, reconcile the `auth.uid()` re-check since it is null under a bare service client). Add a non-mocked end-to-end test of the deployed edge functions against a real DB.
2. **(Verify) prod failure mode.** Confirm whether the missing-EXECUTE call on the managed prod Postgres build returns a clean `42501` (500) or crashes the backend like the local build; if it can crash, treat HIGH-1 as CRITICAL until fixed.
3. **LOW — document** the intentional `authenticated`-executable SECURITY DEFINER functions (`chat_mark_read`, `chat_thread_party`) so the advisor WARN is not mistaken for a regression in future audits.

# Sub-project G — notification surfaces, in-app half (design)

Date: 2026-05-29
Status: design, pre-implementation
Roadmap: `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md` Task 8
Overview: `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md`

G's roadmap covers two halves: in-app surfaces and email transport. **This spec is the in-app half ONLY.** The email half (Resend SDK wrapper, React Email templates, a `notification-dispatcher` edge function) is **DEFERRED** — see §9 for the explicit out-of-scope list and the clean seam. The in-app center reads and renders the `notifications` table that the backend already writes via the `dispatch_notification` SQL function. G adds no new backend writers and no new tables.

All reads and writes run under the viewer's RLS-bound client (SSR `createClient()` server-side, `browserAfter5Client()` client-side). This spec records schema facts verified against the live local DB (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) so the plan is correct, not guessed.

---

## 1. Verified facts (live DB, `127.0.0.1:54322`)

### 1.1 `notifications` table

Columns (exact):

```
id              uuid    PK   default gen_random_uuid()
user_id         uuid    not null   FK → profiles(id) ON DELETE CASCADE
type            notification_type   not null
payload         jsonb   not null   default '{}'
dedup_key       text    null
channel         notification_channel   null
delivered       boolean not null   default false
delivery_error  text    null
read_at         timestamptz  null
created_at      timestamptz  not null   default now()
```

Index `notifications_user_idx` btree `(user_id, created_at DESC)` — the list query orders by `created_at desc` and is index-covered.

The generated `packages/types/src/database.ts` `notifications` Row (lines 1246–1298) **matches the live table** — no stale-type problem here (verified). Row fields: `channel | null`, `created_at`, `dedup_key | null`, `delivered`, `delivery_error | null`, `id`, `payload (Json)`, `read_at | null`, `type`, `user_id`. No regen needed for G.

Columns the in-app surfaces SELECT: `id, type, payload, read_at, created_at`. We do NOT select `channel`, `delivered`, `delivery_error`, `dedup_key` — those are transport-side concerns owned by the deferred email/push half. (Bug class 2: select only columns that exist; we go further and select only what we render.)

**RLS policies (verified):**

```
notifications_recipient_read   FOR SELECT   USING (user_id = auth.uid())
notifications_recipient_mark_read  FOR UPDATE  USING (user_id = auth.uid())  WITH CHECK (user_id = auth.uid())
```

There is **NO INSERT policy and NO DELETE policy.** Inserts only happen via `dispatch_notification` (SECURITY DEFINER, bypasses RLS). This is correct for G: the viewer reads their own rows and may update their own rows. The center never inserts or deletes.

### 1.2 The mark-read UPDATE policy — RED RLS risk (see §8)

`notifications_recipient_mark_read` gates UPDATE on `user_id = auth.uid()` in both USING and WITH CHECK, **but it does not column-restrict the update.** A user can update ANY column of their own notification row — including `type`, `payload`, `delivered`, `channel`, `delivery_error`. Postgres RLS UPDATE policies cannot restrict columns; column-level grants are the only DB-level mechanism, and none are in place. G's client only ever sets `read_at`, but the policy permits more. Flagged RED in §8 with a proposed column-grant + trigger fix for the reviewer to apply before execution. **G ships correctly without the fix** (our code only writes `read_at`); the fix is defense-in-depth against a hostile client.

### 1.3 `notification_preferences` table

Columns (exact):

```
user_id            uuid    PK   FK → profiles(id) ON DELETE CASCADE
push_enabled       boolean not null default true
email_enabled      boolean not null default true
offers_enabled     boolean not null default true
matches_enabled    boolean not null default true
messages_enabled   boolean not null default true
reminders_enabled  boolean not null default true
account_enabled    boolean not null default true
quiet_hours_start  time   null
quiet_hours_end    time   null
created_at         timestamptz not null default now()
updated_at         timestamptz not null default now()
```

This is **per-CATEGORY + per-CHANNEL**, not per-type. Two transport channels (`push_enabled`, `email_enabled`) and five content categories (`offers`, `matches`, `messages`, `reminders`, `account`). Quiet hours are two nullable `time` columns (no date, no tz — the tz comes from the user's city, see §1.5). The preferences UI mirrors exactly these columns; it does NOT invent per-type toggles. (Bug class 2.)

**RLS (verified):** one policy `notif_prefs_owner_all` `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())` covering ALL commands (SELECT/INSERT/UPDATE/DELETE). The owner can read, create, and update their own row. So the preferences page can upsert the viewer's row directly.

**Trigger:** `set_notification_preferences_updated_at BEFORE UPDATE` keeps `updated_at` fresh. There is **NO auto-create (on signup) trigger** — a brand-new user may have NO preferences row. `dispatch_notification` treats a missing row as permissive defaults (verified in its body: `if v_prefs.user_id is not null then …`). So the preferences page must handle the row-absent case: read returns null → render the all-on defaults → first save is an INSERT (upsert on `user_id`). (Bug class 2 / missing-row handling.)

### 1.4 `dispatch_notification` signature (the deferred backend's writer — reference only)

```
dispatch_notification(p_user uuid, p_type notification_type, p_payload jsonb default '{}') RETURNS json
SECURITY DEFINER
```

It applies: dedup short-circuit (`payload.dedup_key`), consent gate (the category/channel booleans above), quiet-hours gate (in the user's city tz), rate-limit gate, then channel pick (push_ios → push_android → web_push → email → suppressed). Safety types (`safety_checkin`, `safety_alert`) bypass all gates. **G does not call this** — it is the existing backend writer. G renders the rows it produces. Listed here only to document the payload keys per type (§4) and the preferences semantics (§6).

### 1.5 Category→preference mapping (from `dispatch_notification`, drives the per-type map)

Verified gate logic maps each type to a category column:

- `offers_enabled`: `offer_received`, `offer_expiring`, `offer_withdrawn`, `standby_promoted`
- `matches_enabled`: `new_match`
- `messages_enabled`: `new_message`
- `reminders_enabled`: `date_reconfirm`, `rating_request`
- `account_enabled`: `account`, `moderation_action`, `verification_passed`, `verification_failed`, `appeal_resolved`
- **No category gate** (always sent when consent/rate allow): `offer_passed`, `offer_expired`, `reciprocal_detected`, `lock_cancelled_frozen`, `lock_cancelled_rolled`, `safety_checkin`, `safety_alert` — note safety types bypass ALL gates.

The preferences UI surfaces only the five category toggles + two channel toggles + quiet hours; it does not claim to gate the no-category types (it can't, and the backend doesn't).

---

## 2. The 20 `notification_type` values (verified)

```
account                appeal_resolved        date_reconfirm
lock_cancelled_frozen  lock_cancelled_rolled  moderation_action
new_match              new_message            offer_expired
offer_expiring         offer_passed           offer_received
offer_withdrawn        rating_request         reciprocal_detected
safety_alert           safety_checkin         standby_promoted
verification_failed    verification_passed
```

`notification_channel` enum (reference): `push_ios, push_android, web_push, email, admin_alert, suppressed`.

---

## 3. Architecture — component responsibilities

Pure-helper / boundary discipline (bug class 5): the per-type rendering map and the deeplink builder are **plain `.ts`** with no `'use client'` and no React import, so both server components (badge count, center SSR seed) and client components (toast, center list) import them.

| Module | Path | Kind | Responsibility |
| --- | --- | --- | --- |
| per-type map | `apps/web/lib/after5/notif-map.ts` | plain `.ts` | `NOTIF_META: Record<notification_type, {label, Icon, category, hrefFor(payload)}>`. Pure. Maps each of the 20 types → lowercase label, lucide icon, category, and a deeplink builder reading `payload`. |
| realtime sub | `apps/web/lib/after5/realtime.ts` (extend) | `'use client'` | add `subscribeNotifications(userId, onInsert)` mirroring `subscribeLockInserts`. User-scoped channel `notif:<userId>`; RLS gates delivery. |
| API route | `apps/web/app/api/notifications/route.ts` | route handler | `GET` paginated list + unread count; `PATCH`/`POST` mark-read (one id or all). Auth via SSR `createClient()`. |
| badge | `apps/web/components/NotificationBadge.tsx` | `'use client'` | unread-count pill on the bottom tab. Seeds from SSR count, subscribes to realtime to increment, listens for a "read" event to decrement/clear. |
| toast | `apps/web/components/NotificationToast.tsx` | `'use client'` | mounts the realtime sub once; on a new row fires a sonner toast (title = label, action = deeplink). No visible DOM. |
| center | `apps/web/components/NotificationCenter.tsx` | `'use client'` | vaul `Drawer` sheet. Paginated list (cursor by `created_at`), per-row label/icon/relative-time/unread-dot/deeplink, mark-one-read on open of a row, mark-all-read action. |
| preferences page | `apps/web/app/account/notifications/page.tsx` | server component | SSR-reads the viewer's prefs row (or null), renders `PreferencesForm`. |
| preferences form | `apps/web/app/account/notifications/PreferencesForm.tsx` | `'use client'` | five category switches + two channel switches + quiet-hours start/end time inputs. Save → upsert via browser client. |

The badge, toast, and center mount inside the existing `BottomTabShell` region (or a sibling provider in the authed layout). The badge renders on the existing `profile`/`discover` shell; the center opens from a bell affordance added to the shell header or a fifth element. (Decision G-1, §7.)

---

## 4. Per-type rendering map (20 types → label / icon / deeplink)

Deeplink targets verified to exist: `/matches/[lockId]`, `/reciprocal/[pairId]`, `/offers/[offerId]`, `/dates/[slug]`. Payload keys verified from the `dispatch_notification` callers in `supabase/migrations/`. Where a payload lacks the key a route needs (e.g. `new_message` has no thread route yet — chat is Phase 7), the deeplink falls back to a safe in-app surface and never to an empty string (bug class 6 analog for hrefs).

| type | label (lowercase, stop-slop) | lucide icon | category | payload keys (verified) | deeplink |
| --- | --- | --- | --- | --- | --- |
| `offer_received` | a date wants you in | `Heart` | offers | `instance`, `offer_id`, `expires_at` | `/offers/{offer_id}` |
| `offer_expiring` | an offer's about to lapse | `Clock` | offers | `offer_id`, `instance` | `/offers/{offer_id}` |
| `offer_passed` | they passed this time | `X` | (none) | `offer_id`, `instance` | `/feed` |
| `offer_expired` | an offer ran out | `Clock` | (none) | `offer_id`, `instance` | `/feed` |
| `offer_withdrawn` | a host pulled an offer | `Undo2` | offers | `offer_id`, `instance` | `/feed` |
| `standby_promoted` | you're up next | `ArrowUp` | offers | `instance`, `offer_id` | `/offers/{offer_id}` |
| `new_match` | it's a match | `Sparkles` | matches | `instance`, `lock_id` | `/matches/{lock_id}` |
| `reciprocal_detected` | you both said yes | `HeartHandshake` | (none) | `pair_id`, `pair_offer_id`, `my_pending_instance` | `/reciprocal/{pair_id}` |
| `new_message` | new message | `MessageCircle` | messages | (varies; chat is Phase 7) | `/matches` (fallback; no thread route yet) |
| `date_reconfirm` | confirm you're still on | `CalendarCheck` | reminders | `lock_id`? | `/matches/{lock_id}` else `/matches` |
| `rating_request` | how was the date? | `Star` | reminders | `lock_id` | `/matches/{lock_id}` |
| `lock_cancelled_frozen` | a date was cancelled | `CalendarX` | (none) | `lock_id`, `instance` | `/matches/{lock_id}` else `/matches` |
| `lock_cancelled_rolled` | a date rolled to standby | `RefreshCw` | (none) | `lock_id`, `instance` | `/matches/{lock_id}` else `/matches` |
| `safety_checkin` | checking you got home ok | `ShieldCheck` | (none, bypasses gates) | `lock_id`? | `/matches/{lock_id}` else `/account` |
| `safety_alert` | safety alert | `ShieldAlert` | (none, bypasses gates) | varies | `/account` |
| `account` | account update | `User` | account | varies | `/account` |
| `moderation_action` | a moderation update | `Gavel` | account | varies | `/account` |
| `verification_passed` | you're verified | `BadgeCheck` | account | varies | `/account` |
| `verification_failed` | verification needs another look | `BadgeAlert` | account | varies | `/account` |
| `appeal_resolved` | your appeal was reviewed | `Scale` | account | varies | `/account` |

`hrefFor(payload)` reads keys defensively: `typeof payload === 'object' && payload && 'offer_id' in payload ? \`/offers/${payload.offer_id}\` : '/feed'`. Never returns `''`. (Payload is `Json`; the helper narrows.)

---

## 5. Flows

### 5.1 Read flow (list)

`GET /api/notifications?cursor=<iso>&limit=20` → SSR `createClient()` → `auth.getUser()` (401 if absent) → `from('notifications').select('id,type,payload,read_at,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).lt('created_at', cursor?).limit(limit+1)`. The `eq('user_id', user.id)` is belt-and-suspenders on top of RLS (the SELECT policy already scopes it). Returns `{ items, nextCursor, unreadCount }` where `unreadCount` is a separate `head: true, count: 'exact'` query with `.is('read_at', null)`. The center seeds page 1 from SSR (or from this GET on open) and pages by passing the last item's `created_at` as `cursor`.

### 5.2 Mark-read flow

`POST /api/notifications` body `{ ids: string[] }` OR `{ all: true }` → SSR client → `auth.getUser()` (401) → `from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null).in('id', ids)` (or no `.in` for all) — RLS `notifications_recipient_mark_read` scopes to the viewer; we additionally `eq('user_id', user.id)`. We set ONLY `read_at` (despite the policy permitting more — §1.2 / §8). Returns `{ updated: <count> }`. On success the client emits a window `CustomEvent('notif:read', { detail })` the badge listens for to decrement.

### 5.3 Preferences flow

Server page reads `from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle()`. Null → render defaults (all booleans true, quiet hours empty). Form save → browser client `from('notification_preferences').upsert({ user_id, push_enabled, email_enabled, offers_enabled, matches_enabled, messages_enabled, reminders_enabled, account_enabled, quiet_hours_start, quiet_hours_end }, { onConflict: 'user_id' })`. RLS `notif_prefs_owner_all` permits insert+update. Quiet-hours inputs are `<input type="time">` → `'HH:MM'` strings (Postgres `time`), or null when cleared. Both-or-neither: the form requires both quiet-hours fields set together or both empty (the backend gate only fires when BOTH are non-null). (Decision G-2, §7.)

---

## 6. Quiet hours in preferences

Stored as two `time` columns, interpreted in the user's city tz by the backend (`dispatch_notification` joins `profiles → cities.timezone`; G does not re-implement this). The UI presents them as "pause notifications from [start] to [end]" with two time inputs, a clear button, and helper copy that the window is in the user's local city time. Wrap-past-midnight (start > end) is valid and the backend handles it; the UI states "overnight windows are fine."

---

## 7. Autonomous decisions

- **G-1 (center entry point):** The bell/center opens from the authed shell. Since `BottomTabShell` has four fixed tabs and a "coming soon" pattern, the bell is added as a header affordance in the authed layout (top-right), NOT a fifth bottom tab, to avoid restyling the verified 4-tab nav. The unread badge renders on the bell. If the reviewer prefers the badge on the `profile` tab, that's a one-line target swap.
- **G-2 (quiet-hours both-or-neither):** enforce both fields together client-side because the backend gate requires both non-null; a single set field is silently ignored, which would confuse users.
- **G-3 (mark-read on row interaction):** opening/clicking a row marks just that row read (single-id POST) and navigates the deeplink; a "mark all read" button does the bulk path. No auto-mark-all-on-open (preserves the unread affordance).
- **G-4 (no `channel`/`delivered` in UI):** those are transport columns owned by the deferred half; the in-app center treats a row as "exists ⇒ show it." Read state is `read_at`, full stop.
- **G-5 (toast respects nothing extra):** the toast fires on every realtime insert the viewer's RLS lets through; gating already happened in `dispatch_notification` before the row was written, so any row that reaches the client is meant to be seen.

---

## 8. RED RLS risk + proposed policy

**RED-G1 — mark-read UPDATE is not column-restricted.** `notifications_recipient_mark_read` lets a user UPDATE any column of their own rows (`type`, `payload`, `delivered`, `channel`, `delivery_error`), not just `read_at`. RLS cannot restrict columns; this needs column grants or a trigger. G's own code only writes `read_at`, so the product is correct, but a hostile client could rewrite their notification history. **Not a blocker for G**, but flagged for the reviewer (like E-R1) to fix before/independent of execution.

Proposed fix (reviewer applies; G does not author backend code):

```sql
-- Defense-in-depth: only read_at is user-writable on notifications.
-- Revoke broad UPDATE, grant column-level UPDATE on read_at only.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
-- The RLS policy still scopes WHICH rows (user_id = auth.uid()); the grant
-- scopes WHICH columns. Belt: a trigger could also pin all non-read_at columns
-- to OLD on UPDATE for authenticated, but the column grant is sufficient.
```

After applying, run the Supabase security advisor (per the secure-by-default-DB feedback). Verify the center's `update({ read_at })` still succeeds and an attempted `update({ type })` is rejected.

---

## 9. DEFERRED — email half (explicit out-of-scope) + the clean seam

NOT built in G's in-app sub-project:

- **Resend SDK wrapper** (`apps/web/lib/email/resend.ts` or equivalent) — deferred: Resend domain not verified yet.
- **React Email templates** (per-type email bodies) — deferred: must wait for the rebrand (roadmap Task 11) to be on-brand.
- **`notification-dispatcher` edge function** — deferred: it would consume rows / channel picks and send via Resend.

**The seam is the `notifications` table itself.** `dispatch_notification` already writes rows and computes a `channel` (incl. `email`). The deferred email worker will read rows where `channel = 'email' and delivered = false`, send via Resend, and set `delivered`/`delivery_error`. The in-app surfaces in G ignore `channel`/`delivered` entirely (§G-4), so when the email worker ships it can flip `delivered` without touching anything G built. No in-app code change is needed to add email later. The per-type label/copy map (§4) is the natural source for email subject lines too, so the deferred templates can import `NOTIF_META` rather than duplicate copy.

---

## 10. Testing + browser-verify

Unit (vitest/jsdom): `notif-map.ts` — every one of the 20 types has a label, icon, category, and a non-empty href for representative payloads (table-driven); `hrefFor` never returns `''` and tolerates `{}`/null payload. `subscribeNotifications` — channel name `notif:<userId>`, INSERT handler wiring, unsubscribe cleanup (mirror `realtime.lock.test.ts`). API route — 401 unauth, paginated shape, mark-read sets only `read_at`, mark-all path. Components — badge count render + decrement on `notif:read`, center list render + empty state, preferences form defaults when row absent, both-or-neither quiet hours.

**Browser-verify (REQUIRED; jsdom misses the D/E/F bug classes):** with the local QA authed session (`reference_local-qa-browser-login`), seed a row via `select dispatch_notification('<qa-uuid>','new_match', '{"lock_id":"…"}')` against local DB, confirm: badge increments live (realtime), toast fires, center opens (vaul sheet, no overlay/focus regressions), row deeplinks to `/matches/[lockId]`, mark-read clears the dot and decrements the badge, `/account/notifications` loads with no route collision, toggles+quiet-hours save and re-read. Confirm no Next/image empty-src warnings (icons only, no photos — bug class 6 N/A but verify console clean). Confirm `/account/notifications` and `/api/notifications` do not collide with existing segments (verified at design time: neither exists; `account/saved` is the only account child).

---

## 11. Self-review (against requirements)

- Scope honored: in-app only; email half deferred with a named seam (§9). ✔
- Bug class 1 (route collisions): verified `app/account/notifications` and `app/api/notifications` don't exist; only `account/saved` and the listed api routes exist. ✔
- Bug class 2 (real columns): every selected/written column verified against `\d` and `database.ts`; missing-prefs-row handled; per-CATEGORY not per-type. ✔
- Bug class 3 (RLS user-context reads): SELECT + UPDATE policies confirmed; mark-read writes only `read_at`; RED-G1 flagged with a fix. ✔
- Bug class 4 (FK embeds): G uses NO embeds — it selects scalar columns from `notifications` and reads `payload` JSON for ids; deeplinks navigate to pages that do their own RLS reads. No PGRST201 surface. ✔
- Bug class 5 (server/client boundary): `notif-map.ts` is plain `.ts`, importable by server + client. ✔
- Bug class 6 (next/image empty src): notifications render lucide icons, no `<Image src>` — N/A, but console-clean check retained. ✔
- Reuse: realtime mirrors `subscribeLockInserts`; vaul/sonner/`cn()`/Barbiecore tokens reused; SSR `createClient()` + `browserAfter5Client()` per existing api routes. ✔

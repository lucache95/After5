# Unified Inbox — Design Spec (2026-06-03)

**Goal:** Collapse the separate `messages` bottom-tab and the header notification bell into one TikTok-style **inbox**: a single tab where activity (someone's into your night, a swipe matched, an offer landed/accepted, an identity revealed, a rate-your-date nudge) lives up top as grouped rows, and your message threads live below. One place to check "what happened since I was last here," tuned for mobile and built API-first so the future native app reuses the same feed query.

**Status:** Design proposal (owner review, 2026-06-03). Task #84. NOT yet built. Companion to the date-settings spec (same architecture posture).

---

## North star
After5 already has two notification surfaces that don't talk to each other: the **bell** (`NotificationCenter`, a vaul sheet over the `notifications` table) and the **messages tab** (`ThreadList` over `chat_threads`). A user who opens the app has to check both to know what happened. Instagram, TikTok, and Hinge all converged on a single **inbox/activity** surface for exactly this reason. The governing principle: **one tab answers "what's new," activity on top, conversation below — and nothing requires a second tap to discover it exists.**

This is consolidation, not new capability. The `notifications` table, its RLS, the dispatch path, web push (#50), and the chat thread list all already exist and stay. The inbox is a new **read surface** over data we already write.

## What exists today (grounded)
- **`notifications` table** (`20260525123400_p2_notifications.sql`): append-only log, `user_id`, `type` (the `notification_type` enum — 20 values incl. `offer_received`, `new_match`, `reciprocal_detected`, `new_message`, `rating_request`, `date_reconfirm`, `lock_cancelled_*`, `verification_*`, `account`, …), `payload jsonb` (deep-link entity ids), `read_at`, `created_at`. RLS: recipient-read + recipient-can-only-write-`read_at` (column grant revokes everything else). Indexed `(user_id, created_at desc)`.
- **Bell surface**: `NotificationBell` (server, seeds unread count) → `NotificationCenter` (vaul sheet, cursor-paginated via `GET /api/notifications`, per-row mark-read + "mark all read" via `POST`), `NotificationBadge` (live bump via `subscribeNotifications` realtime), `NotificationToast`. Per-type label/icon/deep-link in `lib/after5/notif-map.ts` (`NOTIF_META`, `hrefForNotification`). The bell is mounted as a **header affordance** on `/home`, `/my-nights`, `/account` (decision G-1: not a 5th tab).
- **Messages tab**: `BottomTabShell` tab `messages → /messages`. `messages/page.tsx` reads `chat_threads` (RLS `chat_threads_party_read` scopes to the viewer), folds in last-message + unread per thread via `thread-view` helpers, renders `ThreadList` (one row per offer/night: counterpart polaroid, night date, last-message preview, unread dot, link to `/messages/[threadId]`).
- **`chat_threads`** (`20260525124500_p2_chat_core.sql`): one per offer, `state` (`open`/`promoted`/`closed`), `revoked_at`, party-read RLS. `messages` table + realtime publication exist (Phase 7 chat shipped).
- **Bottom nav**: discover (`/feed`) · dates (`/my-nights`) · messages (`/messages`) · profile (`/home`). 4 tabs, phone-width, lowercase, pink active bar.

So: two read surfaces, two data sources, both already RLS-safe, both already cursor-paginated or thread-grouped. The inbox merges their **presentation**, not their storage.

---

## 1. Information architecture

**The inbox is one scrollable tab, two zones:**

```
┌─────────────────────────────┐
│  inbox            [⚙ filter] │   ← lowercase Caprasimo title
├─────────────────────────────┤
│  ✨ activity                 │   ← zone 1: grouped activity rows
│  ┌─────────────────────────┐ │
│  │ 🔥 3 people are into     │ │   ← GROUPED row (collapses N events)
│  │    your taco night       │ │
│  ├─────────────────────────┤ │
│  │ 💞 you + maya matched    │ │   ← single high-signal row
│  ├─────────────────────────┤ │
│  │ 💌 a date wants you in   │ │
│  └─────────────────────────┘ │
│  see all activity →          │   ← if truncated
├─────────────────────────────┤
│  💬 messages                 │   ← zone 2: chat threads (today's ThreadList)
│  ┌─────────────────────────┐ │
│  │ [polaroid] maya · fri 7  │ │
│  │  "wait that bar looks…"  │ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

- **Zone 1 — activity**: grouped rows from the `notifications` table. Newest first. The top **3–5** show inline; the rest behind "see all activity →" (full-height list, same rows). High-signal events (match, offer received, offer accepted) never collapse; low-signal repeated events (multiple people interested in the same night) **group** into one row with a count.
- **Zone 2 — messages**: today's `ThreadList`, verbatim. Recency-sorted, unread dot, last-message preview. Tapping a thread → `/inbox/[threadId]` (the existing thread view, re-homed).
- **Empty state** (both zones empty): one dry message, not two. "quiet in here. go lock eyes on a night." + a `browse dates` CTA (reuse the `ThreadList` empty-state copy/structure).

### Bottom-nav change
- **Rename + repoint the `messages` tab → `inbox`** (`/inbox`), icon `Inbox` (lucide) or keep `MessageCircle`. The tab keeps its slot (3rd of 4) so muscle memory holds.
- **Retire the header bell.** `NotificationBell` stops mounting on `/home`, `/my-nights`, `/account`. All notification reading moves into the inbox tab.
- The **unread badge** moves from the bell to the inbox **tab icon** — one count = unread activity + unread threads (or two stacked dots; see open decision D3). `BottomTabShell` gains a small badge slot on the inbox tab (reuse `NotificationBadge` logic, re-pointed at a combined count).

This is the §2A "+" companion: the date-settings spec wires a **create** "+" entry; this spec consolidates the **consume** surfaces. Together the nav reads: discover · dates · **+** · inbox · profile (final tab order is an open decision shared with the create-paths spec — see D1).

---

## 2. Data model

**No new tables.** The inbox is a read view over `notifications` + `chat_threads` (+ `messages`), both already present and RLS-scoped.

### Activity rows map to existing `notification_type` values
Activity rows are a **curated projection** of the enum — not every type is an activity row (system/account types stay quieter). Mapping:

| activity row | notification_type(s) | group? |
| --- | --- | --- |
| someone's into your night | *(needs a new type — see below)* | yes, by `date_instance_id` |
| you matched | `new_match`, `reciprocal_detected` | no (high signal) |
| a date wants you in | `offer_received` | no |
| you're locked in | accept emits `new_match`/lock notif (via `promote_chat_thread_to_lock`) | no |
| identity revealed | *(needs a new type — see below)* | no |
| rate your date | `rating_request` | no |
| reminders | `date_reconfirm`, `offer_expiring`, `standby_promoted` | no |
| quieter (account/system) | `verification_*`, `moderation_action`, `account`, `offer_passed`, `offer_expired`, `lock_cancelled_*` | rolled into "see all activity" only, never the top 5 |

`new_message` is **excluded** from zone 1 — message activity belongs in zone 2's thread rows, not duplicated as an activity row (avoids the "you have a notification AND a thread for the same message" double-count that plagues other apps).

### Two new `notification_type` values (additive, the one schema change)
Today's enum has no "someone swiped interested in my night" or "identity revealed" notification. These are the two headline activity rows the brief calls for, so add (idempotent, matching established convention):
- `interest_received` — emitted when a searcher swipes interested on a host's posted night (the "someone's into your night" group). Payload carries `date_instance_id` (the group key) + the swiper count is derived, not stored.
- `identity_revealed` — emitted when a match crosses the reveal threshold and a counterpart's Tier-3 profile unlocks. Payload carries `lock_id`/`offer_id` for the deep-link.

```sql
alter type notification_type add value if not exists 'interest_received';
alter type notification_type add value if not exists 'identity_revealed';
```
Both get `NOTIF_META` entries (label/icon/category/`hrefFor`) in `notif-map.ts`. Whoever already dispatches on interest/reveal (the swipe RPC / reveal path) gains a `dispatch_notification` call — **flag: confirm these dispatch sites exist before building** (see D5). If a type isn't dispatched yet, the row simply never appears — no breakage.

### Grouping is computed, not stored
"3 people are into your taco night" is a **read-time aggregation** of `interest_received` rows sharing a `payload->>'date_instance_id'`, within the unread/recent window. No `notification_groups` table — grouping logic lives in the feed query (see §4). This keeps writes append-only (dispatch stays dumb) and lets the grouping rule evolve without a migration.

### Read/unread model
- **Activity**: reuse `notifications.read_at` exactly as today. A grouped row is "unread" if **any** member is unread; tapping it marks **all** members read (one `POST /api/inbox/activity/read` with the group's ids, reusing the existing read-only-`read_at` path). "mark all read" stays.
- **Messages**: reuse the existing per-thread unread (`messages` + `thread-view.unreadCount`). Unchanged.
- **Combined tab badge**: `unread activity count + unread thread count`. Both already computable under RLS (the bell already counts unread notifications; `ThreadList` already sums thread unread).

### RLS / security (self-only — non-negotiable)
- `notifications`: existing policies hold — recipient-read, recipient-writes-only-`read_at` (column grant). The inbox adds **no new write surface**; mark-read still only touches `read_at`.
- `chat_threads` / `messages`: existing party-read RLS holds.
- The inbox feed RPC (§4) is `security definer` only if it must join across tables the caller can't directly read; **prefer plain RLS-bound selects** (the caller can already read both tables under their own policies, so the RPC can run as `invoker` and inherit RLS — safest). Run the Supabase **security advisor after any DDL** (the two enum values). No `USING(true)` anywhere.

---

## 3. The inbox surface (UX, Barbiecore)

- **Tier-1 shell**: `bg-shell-base`, phone-width `max-w-[420px]`, lowercase `font-heading` "inbox" title, `font-body` rows. Pink (`shell.accent`) only for the unread dot, active filter chip, and CTAs.
- **Activity rows**: per-type icon (from `NOTIF_META`), lowercase label, relative time, unread dot — the `NotificationCenter` row, lifted into the page (no longer in a sheet). Grouped rows show a small **avatar stack or count chip** ("3") + the night's title. Tap → `hrefForNotification(type, payload)` (existing deep-link map; grouped interest-rows deep-link to the host's interested-list for that night).
- **Message rows**: today's `ThreadList` `Row` verbatim (counterpart polaroid, night date, preview, unread dot).
- **Motion**: rows stagger-in on load (framer-motion, gentle). New live-arriving activity slides in at the top (realtime insert → prepend). Reduced-motion respected.
- **Section affordance**: small lowercase section labels ("activity" / "messages") with the emoji-paired treatment the design system already uses; not heavy headers.
- **Filter (optional, light)**: a small chip row or a `⚙` opening a vaul sheet to filter activity by category (`offers`/`matches`/`reminders`) — reuses `NotifCategory` already in `notif-map.ts`. **MVP can ship without it** (see phasing). Empty/loading/error states per design-system §7 (skeletons, dry copy, retry).

---

## 4. API-first feed query (mobile-fast)

The inbox is **two lean reads**, both already cursor-friendly:

1. **Activity feed** — extend the existing `GET /api/notifications` into `GET /api/inbox/activity` (or add a `grouped=true` param) that:
   - selects the viewer's notifications (RLS-bound) `order by created_at desc`, keyset-paginated (the route already does `lt('created_at', cursor)` — reuse verbatim);
   - **groups** consecutive `interest_received` rows by `payload->>'date_instance_id'` server-side into `{ kind:'group', type, date_instance_id, count, latest_at, any_unread, ids:[] }`, leaving all other types as single rows;
   - returns `{ items, nextCursor, unreadCount }` — **lean**: id(s), type, minimal payload (entity ids + a denormalized title for groups), `read_at`, `created_at`. No joins to heavy rows; the client deep-links on tap and the target page fetches detail.
   - The grouping can be done in the **route handler** (TS) over the already-paginated page for MVP, or pushed into a **Postgres RPC** (`inbox_activity_feed(p_cursor, p_limit)`) returning pre-grouped rows for the native app. **Recommendation: ship the TS grouping first (zero migration), promote to an RPC in phase 3** so native reuses it — the brief's API-first rule is satisfied because the *grouping contract* is stable either way and the heavy lifting (RLS, keyset) is already in Postgres.

2. **Thread list** — the existing `messages/page.tsx` query (RLS-bound `chat_threads` select + one `messages` pass), unchanged. For native, wrap it in a `inbox_threads()` RPC later; for web it stays an RSC fetch.

**Perf:** both reads are indexed (`notifications (user_id, created_at desc)`; `chat_threads` party + `messages (thread_id)`). Payloads are id-only + denormalized titles, so a phone pulls KB not MB. Cursor pagination (keyset) stays. Realtime: `subscribeNotifications` already bumps the badge; the inbox subscribes the same channel to prepend new activity rows live.

---

## 5. Phased build (each its own plan)

1. **Inbox page shell** — new `/inbox` route + tab rename/repoint in `BottomTabShell`; render zone 1 (lift `NotificationCenter` rows out of the vaul sheet into a page section) + zone 2 (mount today's `ThreadList`). Retire the header bell mounts. Combined unread badge on the tab. *No schema change yet — activity = today's notification types, ungrouped.* This alone ships the consolidation.
2. **Grouping + two new types** — add `interest_received` + `identity_revealed` enum values (gated migration, security advisor after), `NOTIF_META` entries, dispatch calls at the swipe/reveal sites (confirm sites first — D5), and the read-time grouping in `/api/inbox/activity`. "see all activity" full list.
3. **API-first hardening** — promote activity grouping + thread list to Postgres RPCs (`inbox_activity_feed`, `inbox_threads`) for native reuse; optional category filter sheet.

MVP = phase 1 (pure consolidation, highest bang-for-buck, zero migration). Phases 2–3 add the headline grouped rows and native-readiness.

---

## 6. Testing
- **DB** (phase 2+): pgTAP that the two enum values exist; `interest_received`/`identity_revealed` dispatch under service-role only; RLS still self-only on `notifications` (no cross-user read); mark-read still writes only `read_at`.
- **Route/unit**: `/api/inbox/activity` groups `interest_received` by `date_instance_id`, leaves other types single, excludes `new_message`, keyset cursor stable; combined unread count = activity + threads.
- **Web (vitest)**: inbox renders both zones; grouped row shows count + marks all members read on tap; empty state is one message; tab badge sums correctly.
- **E2E (Playwright/Chromium)**: host posts a night → two searchers swipe interested → host's inbox shows one grouped "2 people are into…" row → tap marks it read and lands on the interested-list; a message arrives → thread row shows unread → badge reflects both.

---

## 7. Open decisions (owner)
- **D1 — final bottom-nav order.** This spec renames `messages`→`inbox`; the create-paths spec (#85) adds a `+`. Combined options: (a) discover · dates · **+** · inbox · profile (5 slots, center `+` raised — TikTok pattern); (b) keep 4 tabs + a floating `+` FAB. **Recommendation: (a), center-raised `+`** — most native-feeling, and both specs already assume the `+` exists. Shared decision; settle once across both specs.
- **D2 — does the inbox fully replace the `messages` tab, or sit alongside?** **Recommendation: fully replace** (rename + repoint the existing slot). A separate messages tab + an inbox tab re-creates the two-surface problem this spec exists to kill. Threads live as zone 2.
- **D3 — one combined unread badge, or two?** One number (activity + threads) is simplest; two stacked dots distinguish "someone messaged" from "something happened." **Recommendation: one number for MVP**, revisit if users conflate them.
- **D4 — which events become activity rows (the curation in §2).** Proposed set is the brief's list + reminders; account/system types roll into "see all" only. Owner to confirm `offer_passed`/`offer_expired` stay quiet (they're slightly deflating to surface prominently).
- **D5 — do `interest_received` / `identity_revealed` dispatch sites exist?** The swipe-interest RPC and the reveal path must call `dispatch_notification` for these rows to populate. **Action before phase 2:** confirm; if absent, phase 2 adds the dispatch call (small, additive). Until then those rows simply don't appear — no regression.
- **D6 — grouping window.** Group `interest_received` by night across "all unread" or a rolling window (e.g. 7 days)? **Recommendation: all-unread + the most recent N read**, so a night you've already cleared doesn't keep regrouping.

## 8. Out of scope (YAGNI v1)
- Cross-device read-state sync beyond what `read_at` already gives (it's server-side, so it already syncs).
- In-inbox reply (tapping a thread still opens the thread view).
- Activity for `new_message` as a separate row (deliberately excluded — lives in zone 2).
- A `notification_groups` table (grouping is computed; promote to materialized only if the feed query ever shows up in slow-query logs).

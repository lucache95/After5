# Sub-project F — UI locked + reveal + ratings (design)

Date: 2026-05-29
Status: design, pre-implementation
Roadmap: `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md` Task 7
Overview: `docs/superpowers/specs/2026-05-27-5b-architecture-overview-design.md` §1 "F"

F is every screen after a lock fires: the viewer's list of locked dates, the locked-date detail (Tier-3 reveal of the counterpart + Phase-7 chat placeholder + post-lock cancel), the lock-fired confetti moment, and the post-date rating form. No new backend. All reads run under the viewer's RLS-bound SSR client. This spec records the schema facts verified against the live local DB so the plan is correct, not guessed.

---

## 1. Verified facts (live DB, `127.0.0.1:54322`)

### 1.1 `locks` table
Columns: `id, date_instance_id, creator_id, matched_user_id, status (lock_status), locked_at, cancelled_by, cancel_reason (cancel_reason), updated_at, rating_closed_at`.

- The two parties are **`creator_id`** (host) and **`matched_user_id`** (candidate). Both are FK to `profiles(id)`. There is no separate "host/guest" role column on locks; the viewer is one of these two.
- `lock_status` enum drives list bucketing (active vs completed/cancelled — confirm values in plan Task 0; expected `active | completed | cancelled`).
- `rating_closed_at` is **nullable** and was added in migration `127200`. **The generated `packages/types/src/database.ts` `locks` Row is STALE — it does NOT yet include `rating_closed_at`** (verified: lines 992–1025 have no such field). The plan regenerates types (Task 0) OR types the column locally; do not `select('rating_closed_at')` against the stale type without a regen.

**FK names for PostgREST embeds (bug class 4 — pin every embed):**
- `locks_creator_id_fkey` → `profiles`
- `locks_matched_user_id_fkey` → `profiles`
- `locks_date_instance_id_fkey` → `date_instances`
- `locks_cancelled_by_fkey` → `profiles`

`locks` has THREE FKs into `profiles`. An unhinted `profiles(...)` embed errors PGRST201 and renders empty. Every embed below is hinted.

### 1.2 `match_ratings` table
Columns: `id, lock_id, rater_id, ratee_id, showed_up (bool), on_time (bool), cancelled_with_notice (bool), unsafe_or_disrespectful (bool), submitted_at`.

- The rating is FOUR nullable booleans — not a numeric score. The form is four yes/no questions.
- Unique constraint `match_ratings_lock_id_rater_id_key` ⇒ one rating per rater per lock. A resubmit raises `23505`; the UI treats "already rated" as a terminal success state, not an error.
- Check `rater_id <> ratee_id`.
- **There is NO rating RPC.** Searched migrations for `match_rate` / `submit_rating` — none exists. Ratings are a **direct table insert under RLS** (policy `match_ratings_rater_insert`, below). So `match.ts`'s rating wrapper is a thin `.from('match_ratings').insert(...)` against the browser client, NOT a `functions.invoke`. (Decision F-3, §7.)

**`match_ratings` FK names:** `match_ratings_lock_id_fkey`, `match_ratings_rater_id_fkey`, `match_ratings_ratee_id_fkey` (all → as expected). The rating form does not embed; it reads the counterpart from the parent lock page.

### 1.3 How the counterpart is found
Given the viewer `user.id` and a lock row: `counterpartId = lock.creator_id === user.id ? lock.matched_user_id : lock.creator_id`. The viewer must be one of the two (gate, §4.2). To render counterpart name/photo in ONE query, embed BOTH party profiles FK-hinted and pick the one that isn't the viewer:

```
.from('locks')
.select(`
  id, status, locked_at, rating_closed_at, cancel_reason, cancelled_by,
  creator_id, matched_user_id, date_instance_id,
  creator:profiles!locks_creator_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
  matched:profiles!locks_matched_user_id_fkey ( id, first_name, age, city, neighborhood, clear_photo_url, vibe_tags ),
  instance:date_instances!locks_date_instance_id_fkey ( id, starts_at, time_range )
`)
.eq('id', lockId)
.maybeSingle()
```

Then in a pure helper (server-safe `.ts`, bug class 5): `counterpart = lock.creator_id === viewerId ? lock.matched : lock.creator`.

### 1.4 Tier-3 profile columns (bug class 2 — verified against `\d profiles`)
`profiles` has **NO `bio`** column (E hit this). The Tier-3 reveal shape is:
`first_name (text), age (int), city (text), neighborhood (text), clear_photo_url (text), vibe_tags (text[] NOT NULL default '{}')`.

The overview spec §1-F lists `photos[], bio, expectations[]` — **those columns do not exist** on `profiles`. Divergence F-D1 (§9): reveal renders `first_name, age, city/neighborhood, clear_photo_url, vibe_tags`. No bio, no photo array (single `clear_photo_url`), no expectations array. This matches what D/E already shipped (`offers/[offerId]/page.tsx` sets `bio: null` with the comment "profiles has no bio column").

### 1.5 Reveal gating (`match_reveal_allowed`, migration 126500)
`match_reveal_allowed(viewer, instance)` returns true for Case 3: viewer is a `lock_participants` row on a lock for that instance with status in `('active','completed')`. The **RLS policy `profiles_select_revealed`** (migration 126600) opens the counterpart's `profiles` row to the viewer when the predicate passes. Because a lock exists and the viewer is a participant, **the counterpart's Tier-3 profile is readable post-lock under the viewer's own RLS client** — no service role. Verified RLS reasoning, §6.

Important: 126600 documents a **residual column-leak risk** — the policy grants ROW access, so a malicious peer could `select email`. F's mitigation is the canonical one named in that migration: **the reveal modal SELECTs only Tier-3 columns** (§1.4). F adds no new exposure.

### 1.6 Rating-window mechanism (migrations 126400 + 127200)
On `match_accept_offer` (126400) the lock fires and a job is enqueued:
```
lock_end := upper(rng) + interval '2 hours';   -- rng = date_instances.time_range
perform enqueue_job('rating_window', lock_end, {lock_id, instance}, 'rating:'||lid);
```
When that job runs, `close_rating_window(p_lock)` stamps `locks.rating_closed_at = now()` (idempotent).

**There is NO `rating_visible_at` column.** The overview spec's phrasing ("a `rating_visible_at` column derived from `date_instances.time_range`") was aspirational. F **derives** the open time, it does not read a column:

```
ratingOpensAt = date_instances.time_range.upper + 2 hours   ≡ starts_at + duration_min(min) + 120min
ratingIsOpen  = now() >= ratingOpensAt
```

`time_range` is `tstzrange` (`generated always as tstzrange_from_start_duration(starts_at, duration_min)`). Server reads `time_range` AND `starts_at`; the pure helper parses the upper bound. If `time_range` is null (shouldn't be, it's generated) fall back to `starts_at + 150min + 120min`.

Interpretation of `rating_closed_at` (decision F-4, §7): the `rating_window` job firing CLOSES the window administratively (kicks off reliability scoring in a future phase) but the `match_ratings` RLS insert policy has **no time predicate** — a late insert still succeeds at the DB. F therefore:
- Hides the rating form until `ratingIsOpen` (the date hasn't happened + grace).
- Once open, shows the form regardless of `rating_closed_at` (lets stragglers rate; the window-closed timestamp is informational only, surfaced as a soft note, never a hard block). This avoids a race where the cron stamps `rating_closed_at` minutes after open and locks honest users out.

### 1.7 `date_instances` read post-lock (migration 127500 — E-R1's fix)
Policy `date_instances_select_offer_recipient` calls `match_offer_recipient_can_see_instance` which has a **lock-stage branch**: viewer is a `lock_participants` row on an active/completed lock for that instance. So **the locked date row is readable by either party under their own RLS client**. F embeds `date_instances` via `locks_date_instance_id_fkey` and it resolves (no degrade needed, unlike E's offer stage). Verified, §6.

### 1.8 Route / segment facts
- No `apps/web/app/matches/` directory exists today (verified `find`). `matches/[lockId]` is a fresh top-level dynamic segment with no sibling param ⇒ no Next.js collision (bug class 1 clear).
- Reuse `dynamic = 'force-dynamic'` on every server page (auth-scoped, no static cache) — same as D/E.

### 1.9 Reusable primitives confirmed present
`framer-motion ^12.40.0`, `vaul ^1.1.2`, `sonner ^2.0.7` in `apps/web/package.json`. **`canvas-confetti` is NOT installed** — MatchConfirmation uses framer-motion + CSS particles, not a confetti lib (decision F-5). `Polaroid` (`apps/web/components/Polaroid.tsx`, `tone="dating"`), `cn` (`@/lib/cn`), `browserAfter5Client` (`@/lib/after5/client`), `createClient` (`@/lib/supabase/server`), `subscribeQueueInserts` pattern (`@/lib/after5/realtime.ts`) all exist and are reused.

---

## 2. Architecture & file map

Server/client split mirrors D (`dates/[slug]/interested/`) and E (`offers/[offerId]/`): server pages do auth + flag + RLS reads + gating, hand plain data to `'use client'` children, pure helpers live in non-client `.ts`.

| File | kind | responsibility |
| --- | --- | --- |
| `apps/web/app/matches/page.tsx` | server | auth → `match_v2_enabled` flag → list the viewer's locks (active + completed/cancelled) with counterpart preview embed; hand to `MatchesList`. |
| `apps/web/app/matches/MatchesList.tsx` | client | renders two buckets (active, past) of lock cards (Polaroid + counterpart name + date time + status pill); links to `/matches/[lockId]`; empty state. |
| `apps/web/app/matches/lock-view.ts` | **plain .ts** (server-safe) | pure helpers: `pickCounterpart(lock, viewerId)`, `bucketLocks(rows)`, `ratingOpensAt(instance)`, `isRatingOpen(instance, now)`, `lockStatusLabel(status)`. No `'use client'` (bug class 5). |
| `apps/web/app/matches/[lockId]/page.tsx` | server | auth → flag → load lock (FK-hinted embed) → gate to participants → derive counterpart + rating state → render `LockDetail`. |
| `apps/web/app/matches/[lockId]/LockDetail.tsx` | client | composes `RevealModal` trigger + reveal card, `Phase7Placeholder`, cancel action (mounts D's `CancelWithReasonPicker` in a vaul drawer), and the rate CTA when open. Owns `cancelLock` call + error→toast + nav. |
| `apps/web/app/matches/[lockId]/RevealModal.tsx` | client | accessible modal (vaul Drawer or focus-trapped dialog) showing the Tier-3 neutral profile; warm-cream surface, soft ink, Polaroid avatar, no vibePalette intrusion. trap-focus + escape-to-close. |
| `apps/web/app/matches/[lockId]/Phase7Placeholder.tsx` | client | exact A10 placeholder copy (§3). |
| `apps/web/app/matches/[lockId]/MatchConfirmation.tsx` | client | confetti/overlay shown once when this viewer's lock just fired (Realtime INSERT on `locks` where viewer participates, OR a `?just=1` nav hint from accept). respects `useReducedMotion`. |
| `apps/web/app/matches/[lockId]/rate/page.tsx` | server | auth → flag → load lock + instance → gate to participants → if `!isRatingOpen` redirect/short-circuit to a "not yet" state → render `RatingForm` (or "already rated" if a row exists). |
| `apps/web/app/matches/[lockId]/rate/RatingForm.tsx` | client | four boolean questions → `submitRating(...)` → success → toast + back to `/matches/[lockId]`. |
| `apps/web/app/matches/lib realtime` | reuse | new `subscribeLockInserts(userId, onInsert)` added to `apps/web/lib/after5/realtime.ts`. |
| `__tests__/*.test.tsx` per component + `a11y.test.tsx` | test | RTL + jest-axe. |

Foundation in `apps/web/lib/after5/match.ts`: add `submitRating(...)` (direct RLS insert, §1.2/F-3) and `subscribeLockInserts` lives in `realtime.ts`. `cancelLock` already exists and is reused as-is; its reason union exactly matches `CancelWithReasonPicker`'s `CancelReason` (`mutual | no_show | creator_pre_lock | safety`) — verified, no adapter needed.

---

## 3. Phase-7 placeholder copy (audit A10 — exact)

```tsx
<section role="region" aria-label="messages">
  <h2 className="font-heading ...">messages coming with phase 7</h2>
  <p className="font-body ...">
    matched users will get chat here. for now, swap numbers off-platform if you want to coordinate.
  </p>
</section>
```

- Headline font = Caprasimo (the dating heading face, `font-heading`), body = Fredoka (`font-body`). Lowercase, stop-slop (no filler, no em-dashes).
- The placeholder is honest about the 5b boundary. A `chat_threads` row exists post-lock (`chat_threads.lock_id` FK) but F renders no live chat.

---

## 4. Flows

### 4.1 Matches list (`/matches`)
1. `createClient()` → `getUser()`; no user → `redirect('/login?next=/matches')`.
2. Read `feature_config` `match_v2_enabled`; off → `<ComingSoonBanner />` (same as D/E).
3. Query locks where viewer participates. RLS `locks_party_read` already restricts to `creator_id = auth.uid() OR matched_user_id = auth.uid()`, so a plain `select` returns only the viewer's locks — no extra `.or()` filter required (but adding `.or('creator_id.eq.<id>,matched_user_id.eq.<id>')` is harmless and explicit). Order by `locked_at desc`.
4. `bucketLocks` splits into `active` and `past` (completed + cancelled). `MatchesList` renders each bucket; empty state: "no locked dates yet." with a `/feed` link.

### 4.2 Lock detail (`/matches/[lockId]`)
1. auth + flag (as above).
2. Load the lock with the FK-hinted embed (§1.3). `maybeSingle()`.
3. **Gate (bug class 3):** if `!lock` OR `lock.creator_id !== user.id && lock.matched_user_id !== user.id` → render a "not your match" full-screen state (mirrors E's "not your offer"). RLS already hides non-participant rows, so `!lock` is the common denial path; the explicit id check is defense-in-depth.
4. Derive `counterpart = pickCounterpart(lock, user.id)`, `ratingState = isRatingOpen(lock.instance, now)`.
5. Render `LockDetail` with: counterpart Tier-3 props, lock status, `lockId`, `ratingOpen`, `ratingClosedAt`, `instanceStartsAt`, and a `justLocked` flag from `searchParams.just === '1'`.
6. `LockDetail` shows: a reveal card (Polaroid + first_name, age, city/neighborhood) that opens `RevealModal` for the full Tier-3 view; `Phase7Placeholder`; a "rate this date" CTA → `/matches/[lockId]/rate` only when `ratingOpen` and status not cancelled; a "cancel this date" action (active locks only) that opens the vaul drawer with `CancelWithReasonPicker`.

### 4.3 Reveal modal
- Tier-3 neutral profile: Polaroid avatar (`clear_photo_url`, `tone="dating"`, fallback handled by Polaroid), `first_name`, `age`, `city`/`neighborhood`, `vibe_tags` rendered as soft chips. NO bio/expectations (don't exist). Warm-cream `bg-shell-base`/surface, `text-shell-ink`, no `vibePalette` (the per-night accent palette) intrusion — neutral brand only.
- a11y: `role="dialog"` + `aria-modal="true"` + `aria-label`, focus trapped on open, Escape closes, focus returns to the trigger. If implemented via vaul `Drawer`, vaul provides focus trap + escape; otherwise a small focus-trap. Acceptance criterion: axe GREEN + manual trap/escape check.

### 4.4 MatchConfirmation (confetti)
- Trigger: `justLocked` (from `?just=1`, set when E's accept navigates here) OR a Realtime INSERT on `locks` delivered to this viewer (`subscribeLockInserts`). The overlay shows once, then a dismiss/auto-dismiss.
- Realtime channel scoped by user id (mirrors `realtime.ts`): `client.channel(\`locks:${userId}\`).on('postgres_changes', { event:'INSERT', schema:'public', table:'locks' }, …)`. RLS gates delivered rows to the viewer's locks. Filter client-side that the new row's id is relevant (or that viewer is a party).
- **`useReducedMotion` (framer-motion):** when reduced motion is preferred, render NO particle animation — show a static celebratory card ("you matched with {name}") with no transform/opacity keyframes. The confetti is purely decorative (`aria-hidden`); the announcement text is a `role="status"` live region so screen readers hear the match either way.
- No `canvas-confetti` dependency (decision F-5): particles are a handful of framer-motion `motion.span` elements with randomized but deterministic-per-mount offsets, gated entirely behind `!shouldReduceMotion`.

### 4.5 Rating (`/matches/[lockId]/rate`)
1. auth + flag + load lock + instance + participant gate (same as detail).
2. Compute `isRatingOpen(instance, now)`. If not open → render a "not yet" state: "you can rate this once the date's done. check back after {ratingOpensAt}." with a back link. (Hard gate at the route, not just hidden CTA — defense for direct nav.)
3. Check if the viewer already rated: `select id from match_ratings where lock_id=eq.<lockId> and rater_id=eq.<user.id> maybeSingle()` (RLS `match_ratings_rater_read_own` allows reading own). If a row exists → render "you already rated this date." terminal state.
4. Otherwise render `RatingForm` with `lockId`, `rateeId = counterpart.id`.
5. `RatingForm`: four yes/no toggles (`showed_up`, `on_time`, `cancelled_with_notice`, `unsafe_or_disrespectful`) — unanswered = `null` (column is nullable). Submit → `submitRating({ lockId, rateeId, showed_up, on_time, cancelled_with_notice, unsafe_or_disrespectful })`. On `23505` unique violation treat as "already rated" success. On other error → toast. On success → `toast('thanks — that helps keep things safe.')` → `router.push('/matches/' + lockId)`.

Copy note: `unsafe_or_disrespectful = true` is the negative signal; phrase the question carefully ("did they make you feel unsafe or disrespected?") so a "yes" maps to `true`. Stop-slop, lowercase.

---

## 5. `submitRating` wrapper (foundation)

Because there is no RPC (§1.2), the wrapper is a direct RLS insert via the browser client — it does NOT go through `call()`/`functions.invoke`. Signature:

```ts
export interface RatingInput {
  lockId: string;
  rateeId: string;
  showed_up: boolean | null;
  on_time: boolean | null;
  cancelled_with_notice: boolean | null;
  unsafe_or_disrespectful: boolean | null;
}

// Returns 'ok' on insert, 'already_rated' on unique-violation (23505), throws MatchError otherwise.
export async function submitRating(input: RatingInput): Promise<'ok' | 'already_rated'>;
```

`rater_id` is NOT passed — it must equal `auth.uid()` per the RLS WITH CHECK; supply it from the session (`(await browserAfter5Client().auth.getUser()).data.user.id`) or rely on a DB default? There is no default on `rater_id`, so the client must set it = the authed uid. The RLS policy verifies `rater_id = auth.uid()` AND the lock pairing. The wrapper reads the uid from the browser client session and inserts. `23505` → `'already_rated'`; any other PostgREST error → `throw new MatchError('server_error', err.code, err.message)` so the form's catch maps it via `messageForCode`.

---

## 6. RLS verification (per the participant viewer — bug class 3)

Verified the policies that the participant viewer relies on; each PASSES under the viewer's own RLS client, no service role:

| read | policy | result |
| --- | --- | --- |
| own `locks` row(s) | `locks_party_read` USING `creator_id = auth.uid() OR matched_user_id = auth.uid()` | PASS — list + detail both work. |
| counterpart `profiles` (Tier-3) | `profiles_select_revealed` via `match_reveal_allowed` Case 3 (lock participant, active/completed) | PASS — counterpart readable post-lock. |
| the locked `date_instances` | `date_instances_select_offer_recipient` via `match_offer_recipient_can_see_instance` lock-stage branch (127500) | PASS — date row readable post-lock by either party. |
| own `match_ratings` (already-rated check) | `match_ratings_rater_read_own` USING `rater_id = auth.uid()` | PASS. |
| insert `match_ratings` | `match_ratings_rater_insert` WITH CHECK `rater_id = auth.uid()` AND lock pairing matches ratee | PASS for a valid (lockId, counterpart) pair. |
| `lock_participants` (only if F queries it) | `lock_participants_self_read` USING `user_id = auth.uid()` | PASS for own rows. F does NOT need this — counterpart comes from the embedded lock parties, not from lock_participants. |

### RED risk
**No RED RLS gap found for F's read/insert paths.** A and E already shipped the two policies F depends on (`profiles_select_revealed` in 126600, `date_instances_select_offer_recipient` lock-stage branch in 127500). F adds no new table reads that lack a policy.

One YELLOW (documented, accepted in 126600, not a blocker): the column-leak on `profiles_select_revealed` — a peer could read non-Tier-3 columns. F's mitigation is the named one: the reveal modal selects ONLY Tier-3 columns. No new policy proposed; do not regress by selecting `email`/etc.

One YELLOW (types, not RLS): `database.ts` `locks` Row is missing `rating_closed_at` (§1.1). Plan Task 0 regenerates types or casts locally. Not a RED because reads still work; it's a type-safety gap only.

If, during execution, the participant CANNOT read the counterpart profile or the date instance (predicate regression), the fix mirrors E-R1: a migration adding/repairing the lock-stage branch — but verification says both already pass, so this is a contingency, not a planned migration.

---

## 7. Decisions (autonomous)

- **F-2 (given):** mount D's `CancelWithReasonPicker` on `/matches/[lockId]`; `onConfirm → cancelLock(lockId, reason)`. Reason union matches exactly; no adapter.
- **F-3:** ratings have NO RPC → `submitRating` is a direct RLS insert (not `functions.invoke`). Wrapper handles `23505` as `already_rated`.
- **F-4:** rating visibility derived (`time_range.upper + 2h`), not a column. `rating_closed_at` is informational; a late insert is still allowed (RLS has no time predicate), so the form stays open after the cron closes the window to avoid locking honest users out of a just-opened window.
- **F-5:** no `canvas-confetti` dependency; MatchConfirmation uses framer-motion + CSS particles, fully gated behind `!useReducedMotion`.
- **F-6:** `justLocked` comes from `?just=1` (E's accept already navigates to `/matches/${lockId}`; F documents the contract that accept SHOULD append `?just=1`, and also subscribes to Realtime as a fallback so the moment fires even on a cold load).
- **F-7:** lock buckets = `active` vs `past` (completed + cancelled). Cancelled locks show a muted state, no rate CTA.

## 8. Testing & browser verification

- RTL + jest-axe per component: `MatchesList` (buckets + empty), `LockDetail` (reveal trigger, cancel drawer, rate CTA gating), `RevealModal` (renders Tier-3 fields, no bio, trap/escape via testing-library), `Phase7Placeholder` (exact copy + region role), `MatchConfirmation` (renders static card when `useReducedMotion` mocked true; particles `aria-hidden`; `role=status` announcement present), `RatingForm` (toggles, submit→wrapper, already_rated terminal, error→toast). Pure helpers in `lock-view.ts` get a plain unit test (`pickCounterpart`, `bucketLocks`, `isRatingOpen` boundary at exactly `+2h`).
- **jsdom misses (hard lessons): every embed FK-hint, every selected column, the participant RLS paths, the server/client boundary, and Realtime delivery are NOT exercised by Vitest.** These MUST be browser-verified per the 5a Playwright recipe (`reference_local-qa-browser-login`): two authed contexts, candidate accepts an offer, both land on `/matches/[lockId]`, confetti fires (or static card under reduced-motion), reveal modal renders the counterpart's real Tier-3 data (proving the embed hints + reveal RLS), a non-participant third context gets "not your match" on the same `lockId` (proving RLS denial), and after fast-forwarding the clock past `starts_at + duration + 2h` the rate form appears and a submitted rating persists.
- axe GREEN required; specifically confirm reveal modal trap-focus + escape-to-close in the browser, not just jsdom.

## 9. Divergences from overview spec §1-F

- **F-D1:** reveal shows `first_name, age, city/neighborhood, clear_photo_url, vibe_tags` — NOT `photos[], bio, expectations[]` (those columns don't exist on `profiles`; same reality E/D already encoded).
- **F-D2:** no `rating_visible_at` column — derived (§1.6). The spec's column reference was aspirational.
- **F-D3:** no `canvas-confetti` — framer-motion particles (F-5).
- **F-D4:** ratings are not an RPC — direct RLS insert (F-3).

## 10. Self-review

- Embeds: all three `locks→profiles` FKs disambiguated by `_fkey` hint; `date_instances` hinted. ✓ (bug class 4)
- Columns: every selected `profiles` column exists (`first_name, age, city, neighborhood, clear_photo_url, vibe_tags`); NO bio. `locks` `rating_closed_at` flagged as stale-in-types. ✓ (bug class 2)
- Server/client: pure helpers in `lock-view.ts` (no `'use client'`), imported by server pages. ✓ (bug class 5)
- Routes: `matches/[lockId]` is the only dynamic segment under `matches`; no collision. ✓ (bug class 1)
- RLS: every read/insert mapped to a passing policy under the viewer's client; no service role; no RED gap. ✓ (bug class 3)
- Rating gating: derived open time, late-insert tolerant, terminal already-rated state. ✓
- a11y: reveal modal trap/escape, reduced-motion confetti, `role=status` announcement, Phase-7 `role=region`. ✓

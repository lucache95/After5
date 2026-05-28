# Sub-project D — UI Host Surface (5b) — Design Spec

**Date:** 2026-05-28
**Sub-project:** D (overview spec §1 "D — UI host surface")
**Depends on:** A + B + C (all merged + live on prod). Backend RPCs/edge functions complete and tested.
**Status:** Design — awaiting user review before `writing-plans`.

---

## 1. Goal

Ship every screen the **host** (date creator) sees in the matching loop:
- `/dates/[instanceId]/interested` — InterestedList with drag-rank shortlist + make-offer + post-lock cancel.
- `/reciprocal/[pairId]` — reciprocal chooser (host picks which of two instances to keep).

App-only deploy (no schema). Vercel-deployable. Ships behind `match_v2_enabled` (renders coming-soon when off).

---

## 2. Coherence findings (divergences from the overview spec — backend is the source of truth)

Two places where the overview spec language does not match the shipped backend. Resolved here in favor of backend reality.

**F-1: `match_withdraw` is candidate-side, not a host tool.**
Overview spec §1 D says D "uses `B.match_withdraw` for candidates the host wants off their queue pre-offer." But the shipped signature is `match_withdraw(p_actor, p_instance)` and the body operates on `candidate_id = p_actor` — i.e. it withdraws **the caller's own** participation. There is no host-removes-a-specific-candidate RPC in 5b (and conceptually you can't un-swipe someone else).
**Resolution:** D does NOT call `match_withdraw`. The host's only pre-offer "remove" action is **demoting a candidate out of the shortlist** (un-rank: set `status` back to `interested`, clear rank) — a client-side reorder persisted via `match_shortlist`. Candidate self-withdraw lives in **sub-project E** (candidate surface). This is flagged for the roadmap.

**F-2: cancel-lock overlaps D and F.**
`match_cancel_lock(p_actor, p_lock, p_reason, p_idem_key)` is keyed by **lock id**, and the locked-match detail screen `/matches/[lockId]` is owned by **F** (Task 7). The host-facing cancel naturally belongs where the lock is shown.
**Resolution:** D ships the **`CancelWithReasonPicker` component** (reusable, the reason taxonomy + confirmation UX), but D's *route* (`interested`) only surfaces pre-offer host actions. The picker is consumed by F's `/matches/[lockId]` for actual post-lock cancellation. D owns the component; F wires it to a lock. This keeps the component with its sibling host UI while respecting F's route ownership. (If we'd rather D not own a component F mounts, the alternative is to move the picker entirely to F — calling this out for the review.)

---

## 3. Routes & component architecture

```
apps/web/app/dates/[instanceId]/interested/
  page.tsx              server: auth + host check + flag check + initial fetch
  InterestedList.tsx    client: Reorder.Group drag-rank + sections + Realtime
  MakeOfferModal.tsx    client: vaul sheet, expiry preview, confirm → make-offer
  CancelWithReasonPicker.tsx  client: 4-reason picker (consumed by F for post-lock)
apps/web/app/reciprocal/[pairId]/
  page.tsx              server: auth + pair membership + fetch both instances
  ReciprocalChooser.tsx client: pick instance → resolve-reciprocal
apps/web/lib/after5/
  match.ts              client wrapper over the 8 edge functions (typed)
  realtime.ts           user-id-scoped Realtime subscription helpers
```

Each `page.tsx` is a server component (`export const dynamic = 'force-dynamic'`), following the 5a `feed/page.tsx` pattern: `await createClient()` → `auth.getUser()` → gate → fetch → pass props to a `'use client'` child. Client RPC calls go through `lib/after5/match.ts`, which uses `browserAfter5Client().functions.invoke('match-*', { body })`.

---

## 4. Screen designs

### 4.1 `/dates/[instanceId]/interested` — page.tsx (server)
1. `getUser()`; if no user → redirect `/login`.
2. Load instance; if `creator_id !== user.id` → **403** (not the host). Render a minimal "not your date" state.
3. Read `match_v2_enabled` from `feature_config`. If `false` → render `<ComingSoonBanner />` ("matching launches soon", Barbiecore styling) and stop.
4. Fetch the queue: `queue_entries` for this instance (RLS-scoped to creator) joined to **Tier-3** candidate fields via `profiles_select_revealed` (first_name, age, photos[0], city). Also fetch current active `offer` (if any) and any `locks` for mute state.
5. Pass `{ instance, candidates, activeOffer }` to `<InterestedList />`.

### 4.2 InterestedList.tsx (client)
- **Two sections:**
  - **Shortlist** (`status='shortlisted'`, ordered by `rank`) — a `framer-motion` `Reorder.Group` (vertical). Each item is a candidate row: `<Polaroid tone="dating">` avatar + first_name + age + city, a rank pill, and a drag handle. `stickerRotation(candidate.id)` for playful tilt.
  - **New interest** (`status='interested'`) — non-draggable cards with an "add to shortlist" button (calls `match_shortlist` with `rank = shortlist.length + 1`).
- **Drag-rank persistence:** on drop, optimistically apply the new order, then persist by calling `match_shortlist(instance, candidateId, newIndex+1)` for **each item whose index changed**, sequentially. On any error: roll the list back to the pre-drag order and `toast.error`. (Tester scale ≤ ~20 items; backend uses set-rank + frozen-slot, no per-rank UNIQUE — divergence A documented.)
- **Frozen slot:** when `activeOffer` exists, the rank-1 candidate is **non-draggable** and shows a "offer out" lock badge (matches A's frozen-slot rule; reordering rank-1 would be rejected).
- **Make-offer CTA:** shown on the **rank-1** candidate only (per overview spec). Opens `<MakeOfferModal candidate={rank1} />`. Hidden while an offer is already active.
- **Seam 4 — locked-candidate mute:** candidates already in a lock elsewhere (`can_enter_lock_flow=false`) render greyed/disabled; tapping shows `toast("they're already booked")`. (We detect this from a `locks`/eligibility flag passed from the server; if not cheaply available, fall back to handling the `P5002` at offer time.)
- **Realtime (Seam 5):** subscribe via `lib/after5/realtime.ts` to `queue_entries` inserts where `creator_id = auth.uid()` (**user-id scope, not device**). New right-swipes append to "new interest" live. **Pagination (R3):** initial fetch caps at 20; "load more" button; the subscription only prepends genuinely-new rows.

### 4.3 MakeOfferModal.tsx (client)
- `vaul` bottom sheet. Shows the rank-1 candidate Tier-3 preview + **expiry preview**: read `offer_window_hours` from `feature_config` (default 24, clamp 12–72) and render "they'll have **24 hours** to accept" + the absolute deadline.
- Confirm → `match.makeOffer(instance, candidate)` (mints idem_key client-side for retry-coalescing). On success: `toast.success`, optimistically set candidate `status='offer_active'`, freeze rank-1, close sheet.
- **Error mapping** (from `lib/after5/match.ts`): `P5008 reciprocal_pending` → `router.push('/reciprocal/' + detail.pair_id)`; `P5002 account_gated` → toast "this person can't be offered right now"; `P5000` → coming-soon toast; `P5003 offer_already_active` → toast "you already have an offer out"; `P5004 time_conflict` → toast "that time overlaps another locked date".

### 4.4 CancelWithReasonPicker.tsx (client, consumed by F)
- A controlled picker over the 4 backend reasons: `mutual`, `no_show`, `creator_pre_lock`, `safety`, each with human copy (stop-slop, lowercase headings). `safety` shows a confirmation emphasizing it's reported.
- `onConfirm(reason)` → caller passes a handler that calls `match.cancelLock(lockId, reason)`. D exports the component; **F** mounts it on `/matches/[lockId]`. (See F-2.)

### 4.5 `/reciprocal/[pairId]` — page.tsx + ReciprocalChooser.tsx
- Server: `getUser`; load `reciprocal_pairs` row (RLS self-read); if user not a party → 403. Load both `date_instances` (the two competing nights) with their itinerary preview.
- Client: present the two instances side by side (Polaroid cover + title + time). Host picks one → `match.resolveReciprocal(pairId, chosenInstance)`. On success → toast + redirect to the chosen instance's `/dates/[id]/interested`. Handle `P5009 reciprocal_stale` → toast "both dates were cancelled" + redirect home.

---

## 5. `lib/after5/match.ts` (client wrapper)

Typed thin wrapper, one function per edge function D uses: `shortlist`, `makeOffer`, `withdraw`(unused by D, exported for E), `cancelLock`, `resolveReciprocal`, `demandHint`. Each: `invoke('match-*', { body })`, returns `{ ok, data } | throws MatchError(code, detail)`. Centralizes the P5000–P5009 → message mapping so screens map errors uniformly. Mints `idem_key` (crypto.randomUUID) for the mutating calls that accept it (make-offer, cancel-lock, resolve-reciprocal).

## 6. `lib/after5/realtime.ts`

`subscribeQueueInserts(userId, instanceId, onInsert)` → Supabase Realtime channel `queue:${userId}` filtered to `queue_entries` inserts (postgres_changes), **scoped by user id**. Returns an unsubscribe cleanup for the effect. Used by InterestedList.

---

## 7. Testing (Vitest + RTL + jest-axe)

- **Add dep:** `@testing-library/jest-axe` (only missing test dep; framer-motion/vaul/sonner/RTL present).
- `InterestedList.test.tsx`: renders sections; drag reorder fires `match_shortlist` with correct `rank`; rollback on error; rank-1 frozen when offer active; locked candidate muted.
- `MakeOfferModal.test.tsx`: expiry preview from `offer_window_hours`; confirm calls `makeOffer`; P5008 routes to reciprocal; each errcode maps to its toast.
- `CancelWithReasonPicker.test.tsx`: lists 4 reasons; safety confirmation; onConfirm passes reason.
- `ReciprocalChooser.test.tsx`: renders both instances; pick fires `resolveReciprocal`; P5009 handled.
- **axe** GREEN (no Critical/Important) on every component — focus-trap + escape-to-close on the vaul sheet; 44px tap targets; pink-on-pink contrast ≥ 4.5:1.

---

## 8. Acceptance criteria (from roadmap Task 5, adjusted per §2)

- `/dates/[instanceId]/interested` renders InterestedList for the host; non-host → 403.
- Drag-rank updates rank via `match_shortlist` with optimistic UI + rollback on error.
- Make-offer modal shows expiry preview (from `feature_config.offer_window_hours`).
- Reciprocal chooser route works (B's `match_resolve_reciprocal`).
- Realtime receives new `queue_entries` inserts (user-id scope) and appends live.
- Feature-flag-disabled renders coming-soon banner.
- a11y audit GREEN.
- `CancelWithReasonPicker` component shipped (post-lock cancel wired by F).
- D merged to `main`.
- **Adjusted:** host pre-offer "remove" = un-shortlist (not `match_withdraw`); candidate self-withdraw deferred to E (F-1).

---

## 9. Out of scope

Candidate-facing screens (E), locked/reveal/ratings screens (F), notification surfaces (G). The offer-accept path and reveal are F. D never reads PII beyond Tier-3.

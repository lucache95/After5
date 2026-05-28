# Phase 5a — Post & Browse (Experience-First Loop, part 1 of 2) — Design Spec

**Date:** 2026-05-27
**Authority:** Subordinate to `INTEGRATION-CONTRACT.md` (v2.1) and `RECONCILED-MASTER-PLAN.md`. Where this conflicts with either, they win. This spec is the execution slice for **S5 — Browse & interest** (master plan §8), plus a deliberate minimal sliver of S4 (post-a-night) required for a *real* two-person match.
**Inputs (reference, not authority):** `2026-05-25-p4-browse-feed.md` (S5), `2026-05-25-experience-first-dating-core-loop-design.md` (§4 privacy, §5 browse, §10 native-first).

---

## 1. Why this phase, why now

S1/S2/S3 are on prod: schema spine, async/notify/chat-core, and identity/onboarding. But the dating loop is empty on both sides — **0 `date_instances`, 0 dating-onboarded users** — while the legacy planner holds **492 itineraries** (268 public). The product's unvalidated bet is the thesis itself: *do two real people want to match around a real plan?* Nothing built so far tests it, and onboarding alone is a dead-end.

The full loop (create → browse → swipe → shortlist → offer → accept → lock) is too large for one coherent spec. It splits at the S5/S6 seam:

- **5a (this spec) — Post & Browse:** a real user posts a night from the real plan library; compatible users browse it **blind** and swipe. Validates the discovery half and produces the swipe data 5b consumes.
- **5b (next spec) — Match & Lock:** shortlist → offer → accept → lock + reveal + notifications, built on 5a's swipes. Completes the real two-person date.

A real match needs a **real creator**, so post-a-night (a minimal slice of S4) is in scope; concierge/seed nights only thicken the cold-start feed, they cannot produce a real date.

## 2. Goal

A dating-onboarded, verified user posts a night (an existing plan + a date/time); other *compatible* users see it in a blind, pre-filtered feed and swipe right/left — and at no point before a future lock (5b) does a browser learn who posted a night.

**Done when:** posting a night writes a `date_instances` row gated by RLS to the creator; `browse_feed_for_viewer` returns only compatible, future, approved, not-yet-swiped, non-self nights with **no creator identity**, proven by a psql leak test; `record_swipe` is idempotent; `/feed` and `/nights/new` ship all six states; the golden path works in a browser across two real accounts; typecheck + lint + tests green; migrations apply.

## 3. Architecture

API-first and DB-enforced. The compatibility pre-filter and the blind projection live in **`SECURITY DEFINER` RPCs**, fronted by typed helpers in `packages/api-client` so web today and native later call identical code. Identity-blindness is enforced **in the database** (the RPC never returns `creator_id`), not by client-side hiding. Cold-start tiering is a **pure function in `packages/business`**. Auth follows C10: RPCs derive/verify the actor from `auth.uid()` (the existing `advance_onboarding_step` pattern) — **no Edge Functions this phase**; the authenticated `supabase-js` client calls RPCs directly. Web renders React Server Components that fetch through `api-client`; the swipe action and the post form are thin client components.

## 4. Components (each a small, independently testable unit)

### 4.1 Minimal columns added to `date_instances`
`date_instances` today has only: `id, itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, time_range, status, created_at, updated_at`. 5a adds two small columns the feed needs:
- **`moderation_status`** (enum `'pending'|'approved'|'rejected'`, **default `'approved'`**) — the one S4-owned column the feed filter requires (Contract C11.8). Seed/concierge and these first real nights are non-UGC-photo posts, so default-approved is correct; the full moderation pipeline (UGC media review) stays deferred to S4/S9. Column + default only; no review queue.
- **`is_seed`** (`boolean not null default false`) — flags concierge/seed nights so the feed can label them and analytics can separate them. Part of the C4 projection. Real posted nights are `false`.

### 4.2 Post-a-night
A dating-onboarded user creates a `date_instances` row from a plan they own (`saved_plans`/`itineraries.user_id = auth.uid()`) **or** a public itinerary (`is_public = true`), with a chosen `starts_at` (future), optional `venue_id`, `duration_min` (default 150), `status='seeking'`, `city_id` from the creator's `primary_city_id`. `creator_id = auth.uid()`.
- **Enforcement:** RLS `INSERT WITH CHECK (creator_id = auth.uid())` plus a lightweight `post_night(p_itinerary uuid, p_starts_at timestamptz, p_venue uuid default null, p_duration_min int default 150)` `SECURITY DEFINER` RPC that validates the itinerary is the caller's or public, that `starts_at > now()`, and that the caller is dating-enabled + verified (reuses `can_enter_lock_flow`-style gating / `canEnableDating`), then inserts. RPC returns the new `date_instance` id.
- **Lifecycle columns are RPC-only** (Contract C7): `status` is not directly RLS-writable; created via this RPC, transitioned later by 5b/C2.

### 4.3 `browse_feed_for_viewer(p_viewer uuid default auth.uid(), p_point geography default null)` RPC
Returns the **blind** feed. Projection (identity-stripped — Contract C4/C11.3): `date_instance_id, city_id, time_window_start` (hour-truncated from `starts_at`), `itinerary_id, pay_setting, vibe_tags, why_note, cover_image_url, title, venue_neighborhood, is_seed, distance_m`. **No `creator_id`, no creator name/photo.**
- **Column sources** (the RPC joins, projecting only these): `vibe_tags, why_note, cover_image_url, title, pay_setting` come from the linked **`itineraries`** row (all confirmed present there); `venue_neighborhood` from **`places.neighborhood`** via `date_instances.venue_id` (left join — `venue_id` is nullable; the `places` table is the venue table, there is no `venues` table); `time_window_start, city_id, is_seed, date_instance_id` from `date_instances`; `distance_m` computed.
- **Filter (mandatory):** `status='seeking' AND starts_at > now() AND moderation_status='approved'` AND creator `account_state='active' AND standing NOT IN ('suspended','locked_ban')`.
- **Mutual compatibility pre-filter** (server-side, reads viewer + creator `profiles`): orientation/`gender` ↔ `gender_preferences` both directions; viewer `age` in creator `age_pref` and vice-versa; distance via PostGIS `ST_DWithin(creator_point, viewer_point, distance_pref_km)` using `cities.centroid` (viewer point = `p_point` or the viewer city centroid), honoring the tighter of the two `distance_pref_km`.
- **Excludes:** the viewer's own nights (`creator_id = p_viewer`), and instances already in `swipes` for this viewer. **Keyset-paginated** by `(starts_at, date_instance_id)`.

### 4.4 `record_swipe(p_instance uuid, p_direction swipe_direction)` RPC
Idempotent insert into `swipes (swiper_id=auth.uid(), date_instance_id, creator_id, direction)` with `ON CONFLICT (swiper_id, date_instance_id) DO NOTHING` (a swipe is final; re-swiping is a no-op, not an update). `creator_id` is read from the instance server-side (the swiper never sees it). Returns nothing/ok.

### 4.5 Cold-start
- **Pure function** `feedColdStartTier(...)` in `packages/business`: given counts (compatible-open-nights, total-nights), returns a tier driving the empty/thin-feed UX (`live | thin | empty`).
- **Concierge seed (optional, ride-along):** a backend seed script creates `date_instances` from curated public itineraries under one or two "host" seed accounts to thicken the feed during cold-start. These exercise browse/swipe but are **not** a path to a real date (that needs a real creator, 5b). `is_seed=true` so the UI can label them.

### 4.6 Web
- **`/nights/new`** — post-a-night: reuses the existing plan/itinerary picker, a date/time picker, optional venue; calls `post_night`. Gated: redirect to onboarding if not dating-enabled/verified.
- **`/feed`** — blind swipe deck: RSC fetches the first page via `api-client`; a thin client component renders the card (cover, vibe, the "why", neighborhood, coarse time, pay setting) and the right/left swipe action calling `record_swipe`; paginates on exhaustion.
- Both ship **all six states** (loading / error / empty / success / retry / cancel). Empty feed → cold-start copy ("we're lining up Kelowna nights") + any `is_seed` nights.
- Home (`/home`) gains a minimal entry point to `/feed` and `/nights/new` for dating-enabled users (the only new link into the loop; legacy planner UI unchanged).

## 5. Privacy / the blind contract

Enforced in the DB: `browse_feed_for_viewer` selects only the projection columns above and never `creator_id`; the RPC is the sole feed path the client uses. A psql **leak test** asserts the result set for a viewer contains no column that could identify a creator, and that a viewer cannot read `date_instances`/`profiles` rows directly via RLS to back-derive identity. Reveal happens only at lock (5b, `match_reveal_allowed`).

## 6. Auth model

All RPCs are `SECURITY DEFINER` and derive the actor from `auth.uid()`; internal helpers `revoke execute from public, authenticated` (C10). No `p_actor` parameters in 5a (none of these are in the C2 frozen set — `post_night`/`browse_feed_for_viewer`/`record_swipe` are S5-owned). Direct `supabase-js` `.rpc()` calls from the authenticated client; no Edge Functions.

## 7. Testing

- **psql (Contract C8 fixtures `mk_user`/`mk_itinerary`/`mk_instance`):** feed leak test (no identity columns; RLS can't back-derive); mutual-compatibility correctness (A sees B iff both prefs match + in distance); future/approved/seeking filter; excludes self + already-swiped; `record_swipe` idempotency; `post_night` rejects past `starts_at`, non-owned non-public itineraries, and non-verified callers.
- **vitest:** `feedColdStartTier` pure function; `/feed` card + swipe component (mocked client); `/nights/new` form validation.
- **Manual browser E2E:** account A posts a night → account B (compatible) sees it blind in `/feed` and swipes right → swipe persists, night leaves B's feed; B never sees A's identity.

## 8. Dependencies

**Exists (consume, don't recreate):** S1 — `date_instances`, `swipes` (unique `(swiper_id,date_instance_id)`, `creator_id` denormalized), `cities.centroid`, PostGIS + `btree_gist`, `itineraries.vibe_tags`/`cover_image_url`/`why_note`, `_fixtures.sql`. S3 — `profiles` prefs (`gender`, `gender_preferences`, `age`, `age_pref`, `distance_pref_km`, `primary_city_id`, `dating_enabled`, `verification`). C7 RPC-only lifecycle columns; C8 fixtures; root vitest config.
**Adds:** `moderation_status` + `is_seed` columns on `date_instances` (§4.1); `post_night`, `browse_feed_for_viewer`, `record_swipe` RPCs; `feedColdStartTier`; `/feed`, `/nights/new`; home entry point; optional concierge seed script.

## 9. Out of scope (deferred)

All of 5b (shortlist/offer/accept/lock/reveal/notifications); rich chat (S7); ratings/safety (S8); the full S4 media/moderation pipeline and UGC review; payments framing + pay-setting labels canonicalization (S11 — `itineraries.pay_setting` exists and 5a surfaces its raw value; canonical labels/disclaimer land in S11); the S12 `browse_feed` *view* finalization (5a uses the RPC directly; the view lands at band 133000 in S12); ambient sound (5a omits the audio control — add with S4 sounds); native app.

## 10. Open items handed to 5b / later

- `pay_setting` source + canonical labels (CC5/S11) — 5a surfaces whatever the column holds; labels finalized in S11.
- The creator-facing "who's interested in my night" view + shortlist/offer/accept/lock are 5b.
- Migration-history reconciliation (squash baselines vs prod granular) must be resolved before `db push`/`db reset` are safe — does not block 5a (apply via the established per-migration path), flagged for ops.

## 11. Migration banding

S5 objects land in band `125xxx` per Contract C6 (after S1 `120xxx`, before S6 `126xxx`). `moderation_status` is logically S4 (`124xxx`) but is added here as the minimal column; place it in an early `124xxx`-or-`125xxx` migration that the feed migration depends on. No phase uses `create or replace browse_feed` (C11.3) — 5a ships no view.

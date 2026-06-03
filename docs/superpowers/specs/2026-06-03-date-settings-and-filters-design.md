# Two-Sided Date Settings & Filters — Design Spec (2026-06-03)

**Goal:** Let a host reshape the AI-generated night into exactly what they want (a mobile-native customization canvas — §2A) and set the parameters of each date (who it's for, who pays, price, reach, time), and let searchers filter the feed for the kind of date they want — in a way that feels curated and alive, not like a database query, and that runs fast on web today and a native app later.

**Status:** Design approved in brainstorm (owner, 2026-06-03). Next: implementation plan via writing-plans. NOT yet built.

---

## North star
After5 matches on the **night**, not on a photo or a database query. So the governing principle: **filters remove dealbreakers, then get out of the way.** Over-filtering empties feeds and kills two-sided marketplaces — every decision below is biased toward keeping the feed liquid and the experience serendipitous.

## Locked decisions (from brainstorm)
1. **Per-date targeting is the source of truth.** Each date carries its own target (gender, age, logistics). Profile prefs (`gender`, `gender_preferences`, `age_pref`) become **defaults that pre-fill** the per-date form — they stop being the matching gate.
2. **Searcher-filters-only feed.** A date's target never hard-hides it from the feed. It is (a) a **label** on the card, (b) the host's **interested-list curation** tool, and (c) a **soft boost** signal (see UX upgrades). The searcher's own filters gate/sort the feed.
3. **Hybrid filter strictness.** Hard filters (HIDE): host gender, max price, max distance. Soft filters (SORT, never hide): vibe, who-pays, time-of-day.
4. **Tiered placement.** `/create` (anon free-try funnel) gains only **radius** + **who-pays** on top of vibe/budget/time/city. The **full** set (target gender/age, exact schedule, the why) lives in the in-app host post/customize flow.
5. **Four experience upgrades are in scope** (all four selected): soft-boost + "looking for someone like you", reach preview for hosts, inclusive defaults + friendly empty state, light filters + attainability + "post again".
6. **API-first / mobile-fast architecture** (see §6) — all logic in RPC/edge, lean payloads, server-side filter state, indexed queries.

---

## 1. Data model

### Per-date targeting — new columns on `date_instances`
- `target_genders text[]` — e.g. `{woman}`, `{man,woman,nonbinary}`. Default: all genders ("open to everyone").
- `target_age_range int4range` — default unbounded-ish (e.g. `[18,100)`).
- `search_radius_km numeric` — the reach of this date's venue search / how far a searcher can be. Default = city `default_radius_km`.

### Already per-date (on the itinerary fork that `post_night` deep-copies)
- `pay_setting` (who pays — `i_pay`/`they_pay`/`split`) — **column exists, needs a setter UI.**
- `total_cost_pp` (price — computed from stops).
- vibe tags, stops.
- `why_note` — exists, **needs a setter** (add to `update_itinerary_stops`).

### Profile — now defaults only
- `gender`, `gender_preferences`, `age_pref` pre-fill the per-date form. No longer the gate.

### Searcher filters — new `profiles.feed_filters jsonb` (server-side, syncs web+native)
```jsonc
{
  "max_price": 100,            // hard
  "max_distance_km": 25,       // hard (needs origin — see §5)
  "host_genders": ["man"],     // hard
  "host_age_range": [25, 40],  // soft
  "vibes": ["romantic","chill"], // soft
  "who_pays": ["i_pay","split"], // soft
  "time_buckets": ["this_weekend","weeknights"] // soft, coarse (not exact time)
}
```
Sticky across sessions; editable from the filter sheet anytime.

### RPC / contract changes (API-first)
- **`post_night`** — additive params: `p_target_genders text[]`, `p_target_age_range int4range`, `p_search_radius_km numeric`, `p_pay_setting`, (existing) `p_starts_at`, `p_ambient_sound_id`. Backward-compatible (defaults), existing callers unaffected. **Revoke `anon` EXECUTE** on the new overload.
- **`update_itinerary_stops`** — add `p_pay_setting`, `p_why_note` setters.
- **`browse_feed_for_viewer`** — accepts the viewer's `feed_filters` (or reads them from the profile), applies **hard filters in `WHERE`**, computes a **soft match-score + soft-boost in `ORDER BY`**, returns **cursor-paginated** lean blind-safe rows + a per-card `fit` flag (for the "looking for someone like you" hint). Stays blind-contract-safe (no itinerary_id/creator_id/venue_id, scrubbed reservation_url, hour-truncated time).
- **`reach_preview(target..., city, radius)`** — new lightweight RPC returning an approximate count of profiles matching a prospective date's targeting (for the host's pre-post nudge).

### Indexes (so it's fast)
- PostGIS `geography` + **GIST index** for distance (origin = searcher location, see §5).
- btree on price, time/starts_at; GIN on `target_genders`/vibe arrays as needed.
- Soft-sort score computed in SQL, not the client.

### RLS / security
- Reuse secure-by-default patterns: never `USING(true)` on writes; column-level grants so identity-gating holds. Run the Supabase security advisor after every DDL. `feed_filters` is self-read/self-write only.

---

## 2. Host UX — tiered

### `/create` (anon free-try, stays light)
Add **radius** + **who-pays** to vibe/budget/time/city. Nothing else. (Reconcile with the open-city free-text city work the fleet is building into `CreateFlow.tsx` — see §7.)

### In-app post/customize (full set)
`PostNightForm` + plan editor gain a **"who's this for?"** section — target gender(s), target age range, who pays, radius, exact date/time — **pre-filled from profile**, overridable per date. Plus a new **"the why"** field. Framing is inclusive: default **"open to everyone"**; never reads as an exclusion filter.

### Host upgrades
- **Reach preview** before posting: "~N people match this in <city>" + nudge to loosen if low (calls `reach_preview`).
- **"Post again"**: one-tap repost of a prior date, profile/prev-date pre-fills targeting (~10s to post).
- **Interested list sorted by fit**: the date's targeting becomes a soft ranking of who swiped — fast curation. Targeting also shows as a **card label** ("looking for: women 25–35 · i'll pay").

---

## 2A. Date customization — the canvas (host editing flow)

**Decision (owner, 2026-06-03):** after the AI generates a night, the host customizes it on a **mobile-native "itinerary canvas"** — the chosen paradigm (option A) over swipe-stack (B) / studio-rail (C). Picked for most-bang-for-buck (M3's `ItineraryEditor`/`EditableStopCard` already implement most of it — this is a mobile-native reorg, not a rebuild), best legibility (whole night at a glance), and clean future expansion.

**The canvas is a superset of today's M3 editor — all existing edits are RETAINED:**
- **Cover image** — pick/change (from stop photos today).
- **Swap a place/activity** — today: remove + add a real venue via Google Places search; **upgraded to one-tap "swap / ↻ regenerate this stop"** (the new magic).
- **Add / remove stops** — "＋" between cards.
- **Reorder** — drag grip to resequence.
- **Per-stop details** — name, time, duration, cost-per-person, "what to do" note.
- **Title** + **"the why"** (new setter, via `update_itinerary_stops`).
- **Ambient soundtrack** pick (existing post-step control).

**The only NEW build: per-stop regenerate/swap.** One tap → AI proposes a different venue for that single slot, everything else unchanged. Requires a small additive `generate-plan` capability to rebuild ONE slot (vs. the whole night). *Gated edge change.*

**Entry point — the "+" (TikTok analogy):** MVP wires a bottom-nav **"+"** that opens the existing generate flow (vibe/budget/when/where) → generate → land on the **canvas** → post. Plants the "this is where you create" mental model now; familiar when the native app arrives.

**Expands without changing the flow** — the canvas is just `[stop-cards] + post bar`, so future richness is additive: tap-a-card → swipe-focus drilldown (paradigm B) later; a studio quick-action rail (paradigm C) later; the §2 targeting/who-pays settings ride as a "who's this for" card at the top of the same canvas. None of these rearrange the shipped flow.

---

## 3. Searcher UX

- **Filter sheet** on the feed (`vaul` bottom-sheet, Barbiecore): 3 quick chips (budget · distance · who pays) + a "more" drawer (host gender/age, vibe, time buckets). Persists to `feed_filters`.
- **Hybrid application** (in `browse_feed_for_viewer`): hard → `WHERE`; soft → `ORDER BY` match-score.
- **Soft-boost**: dates whose target fits the searcher float higher + a **"they're looking for someone like you ✨"** hint on the card (`fit` flag).
- **Attainability at a glance**: "10 min away · fri 7pm"; filter by **coarse time buckets** (this weekend / weeknights / daytime), not exact time.
- **Self-selection without rejection**: the target label lets people opt in/out themselves and sets money expectations up front.
- **Friendly empty state**: if hard filters clear the feed → "no dates match — loosen a filter" + one-tap reset.

---

## 4. Experience upgrades (all in scope)
1. **Soft-boost + "looking for someone like you"** — mutual-match dopamine without hard-hiding. (Core.)
2. **Reach preview for hosts** — liquidity protection, no posting into a void. (Core.)
3. **Inclusive defaults + friendly empty state** — anti-cold-start guardrail.
4. **Light filters + attainability + "post again"** — lower effort both sides.

---

## 5. Open question — distance origin
Distance filtering needs a lat/lng origin for the searcher. **Default: searcher's city centroid** (coarse, no permission prompt, zero friction). **Later: optional browser/native geolocation** for precise "X min away." Spec assumes city-centroid v1; geolocation is a fast-follow behind a permission prompt.

---

## 6. API-first / mobile-fast (load-bearing constraint)
The eventual native app must reuse the same backend with no rework:
- **All logic in Postgres RPC + edge functions** — feed gating, soft-sort score, soft-boost, reach preview. **Nothing business-critical in React server components.**
- **Lean payloads** — `browse_feed_for_viewer` returns only card fields (blind-safe); full detail via `get_night_detail` on open. No over-fetch.
- **Cursor pagination** (keyset), not offset — cheap, stable under inserts.
- **Indexed hard filters** (GIST distance, btree price/time, GIN arrays) so filtered queries stay sub-100ms.
- **Server-side filter state** (`feed_filters` jsonb on profile) — syncs across web + native; no localStorage divergence.
- **CDN-sized images** — store/serve sized variants so a phone isn't pulling full-res.

---

## 7. Phasing (each its own spec→plan→build) + fleet overlap
1. **DB foundation** — columns, `feed_filters`, `post_night`/`update_itinerary_stops`/`browse_feed_for_viewer` signature changes, `reach_preview`, indexes, RLS, backfill. *(Gated prod migration; security advisor after DDL.)*
2. **Host settings UI** — `/create` (+radius/who-pays) and the in-app full set + reach preview + "post again". **⚠ Overlaps the open-city scaffold the fleet is currently building into `CreateFlow.tsx`** — reconcile AFTER the fleet lands; do not double-edit concurrently.
3. **Date-customization canvas (§2A)** — mobile-native reorg of M3's editor into the itinerary canvas + "+" entry point + per-stop **regenerate/swap** (incl. the additive single-slot `generate-plan` capability — *gated edge change*). Retains all M3 edits (cover/swap/add/reorder/details/title/why/soundtrack).
4. **Searcher filter sheet + feed query** — hybrid hard/soft, soft-boost, empty state, time buckets, cursor pagination.
5. **Card labels + interested-list curation** — surface targeting + fit ranking.

MVP-first ordering within this arc: the §2A canvas + per-stop regenerate is the highest bang-for-buck (mostly reuse + the one magic add) and a strong standalone MVP; the §2 targeting/§3 filters layer on without reworking it.

## 8. Testing
- DB: pgTAP/SQL tests for RLS (self-only `feed_filters`), `post_night`/`browse_feed_for_viewer` contract, soft-sort ordering, reach_preview counts, anon-EXECUTE revoked.
- Web: vitest for filter-sheet state, card label/hint rendering.
- E2E (Chromium/Playwright): host posts a targeted date → searcher with matching filters sees it boosted with the hint → non-matching hard filter hides it → "loosen a filter" empty state recovers. Anon `/create` radius/who-pays render.

## 9. Out of scope (YAGNI for v1)
- Precise geolocation (city-centroid v1).
- Native app build itself (architecture is prepared, app is task #12, parked).
- Paid/boosted placement, advanced ML ranking (soft-sort is deterministic SQL score v1).

# Phase 04: Discoverability — Feed Filters & Targeting (P1) - Research

**Researched:** 2026-06-04
**Domain:** Postgres RPC extension (hard/soft feed filtering, soft-boost ranking, cursor pagination) + jsonb filter-state persistence + vaul FilterSheet UI + a reach-count RPC. Supabase Postgres 17 / Next.js 15.1 / React 19.
**Confidence:** HIGH (architecture is pre-locked by the design spec and verified against the live codebase; every contract below has file:line evidence).

## Summary

Phase 4 is almost entirely a **server-side extension of one existing RPC** (`browse_feed_for_viewer`), plus one **new lean count RPC** (`reach_preview`), one **additive column** (`profiles.feed_filters jsonb`), and **three frontend wirings** (FilterSheet stub → real, fit pill on NightCard, active-recovery EmptyDeck, reach line on PostNightForm). The hard architecture is fixed by `docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md` — research did not re-derive it, it extracted the concrete contracts and pinned them to live code.

The single highest-risk landmine is the **`{everyone}` normalization** (ROADMAP carry-forward #1, STATE.md). Verified live: `PostNightForm.tsx:69,98–101` initializes and writes the literal `['everyone']`, and the 8-arg `post_night` (`20260605120200_e11_post_night_targeting.sql:147`) stores it verbatim (`coalesce(p_target_genders,'{}')` only catches NULL, not the literal `{everyone}`). Both `fit`/boost AND `reach_preview` MUST treat `{everyone}` and `{}` identically as "no restriction" or every open night drops out of matching.

The infrastructure is favorable: the feed query is already blind-safe, cursor-shaped (keyset on `(starts_at, id)`), and `SECURITY DEFINER set search_path`; the `profiles_owner_all` RLS policy already covers a new column with no policy change; pgTAP + forced-local Playwright harnesses already exist with directly-reusable patterns (`s5_browse_feed_blind.sql`, `e11_targeting.sql`, `p1_preferences.sql`).

**Primary recommendation:** Extend `browse_feed_for_viewer` in place (drop+recreate, preserve the exact 13-column blind return + keyset cursor, add `fit boolean` as the 14th column), read `feed_filters` inside the RPC via `auth.uid()` (do NOT add a param), normalize `{everyone}`→`{}` at the query boundary in BOTH RPCs, and add one composite index for the new hard-filter predicates. Build the UI by extending the four named stubs, not rebuilding them.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Reach preview (host pre-post nudge):** Passive + encouraging. Show `~N people match this in <city>` as a quiet live-updating line under the targeting fields on the post-night form. Low count framed positively ("a focused crowd, widen anytime"). MUST NEVER block, gate, or discourage posting. Backed by the new `reach_preview` RPC.
- **D-02 — Empty feed (hard filters hide everything):** Active recovery + "post your own". Name the most-restrictive HARD filter, offer a one-tap loosen (e.g. "widen distance to 50km?"), PLUS a "post your own night" nudge. Do NOT auto-relax silently.
- **D-03 — "Looking for someone like you" fit hint:** Subtle pill, strong matches only. Pill appears ONLY on cards where the date's targeting genuinely matches the searcher (the `fit` flag). Combined with soft-sort. Never a score/percentage.
- **D-04 — Filter defaults & weight:** Open inclusive defaults (brand-new searcher has NOTHING filtered, max liquidity). Surface a light 3-chip quick-filter (distance / price / vibe) on the feed; tapping opens the full vaul FilterSheet. Do NOT push the full sheet up front.

### Claude's Discretion
- **`target_genders = {everyone}` normalization** — fit/boost AND `reach_preview` MUST treat `{everyone}` and `{}` as "no gender restriction". Normalize at the query boundary OR fix `post_night`/`PostNightForm` to write `{}` (planner's call — recommendation below in Pitfall 1).
- Exact `feed_filters` jsonb key set, index strategy, cursor design, soft match-score formula — follow spec §1/§5/§6; refine here.
- FilterSheet layout, chip set, copy — follow DESIGN-SYSTEM.md + 04-UI-SPEC.md.
- Sub-100ms hard-filtered query target (SC-4): indexing + cursor pagination is the planner's to design.

### Deferred Ideas (OUT OF SCOPE)
- None scoped here. The post-night "why"-edit-mutates-source-plan coupling (ROADMAP carry-forward #2) is recorded as a flagged note for when re-post/re-target is built; it is NOT Phase-4 feed work.
- Out of phase entirely (own phases): progressive reveal / experience-led offer screens (E15/Phase 5); chat↔profile↔night cross-links (E18/Phase 6); precise geolocation (city-centroid v1 only); targeting FIELD creation (shipped Phase 3 — Phase 4 only CONSUMES the columns).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-E10 | Add `profiles.feed_filters jsonb` + wire `browse_feed_for_viewer` to apply HARD filters (host gender / max price / max distance) in WHERE and SOFT sort (vibe / who-pays / time-of-day) in ORDER BY; return cursor-paginated lean blind-safe rows + per-card `fit`. Build real FilterSheet (vaul; 3 quick chips + "more" drawer). Add keyset pagination. New `reach_preview` RPC for host pre-post nudge. | §"Standard Stack", §"Architecture Patterns", §"Common Pitfalls", §"Code Examples", §"Validation Architecture" below — all four SC mapped to concrete RPC/column/UI contracts with file:line evidence. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Hard-filter feed gating (gender/price/distance) | Database / RPC | — | Spec §6 "all logic in Postgres RPC, nothing business-critical in RSC". WHERE clauses in `browse_feed_for_viewer`. Native must reuse the same RPC. |
| Soft-sort score + `fit` flag | Database / RPC | — | Spec §6 "soft-sort score computed in SQL, not the client". Deterministic SQL expression in ORDER BY + a boolean projection. |
| `{everyone}`→open normalization | Database / RPC | — | Must apply identically in feed and reach RPC; centralize in SQL so web + native share it (a client-side normalize would diverge). |
| Reach count | Database / RPC | — | New `reach_preview` RPC; cheap COUNT against `profiles`. |
| Filter-state persistence | Database (column) | API / Backend (direct PostgREST write) | `profiles.feed_filters jsonb`, self-read/self-write via existing `profiles_owner_all` RLS. Written by the client via `client.from('profiles').update(...)` (E4 pattern), read inside the RPC. |
| FilterSheet UI + quick chips | Browser / Client | Frontend Server (SSR seed) | `'use client'` vaul drawer; feed page (SSR) seeds the first page + the persisted filters. |
| Fit pill render | Browser / Client | — | Pure presentation driven by the `fit` flag in the RPC payload. |
| Reach line render + debounced call | Browser / Client | Database / RPC | Client debounces, RPC counts. UI never computes the count. |
| Empty-state branching (filtered vs genuine) | Browser / Client | — | Client knows whether a hard filter is active; chooses recovery copy vs the funny `EmptyDeck`. |

## Project Constraints (from CLAUDE.md)

- **Secure-by-default RLS:** never `USING(true)` on update/delete; reusable patterns; run the Supabase **security advisor after every DDL**; review live migrations before prod apply.
- **Schema/data integrity:** minimal faithful migrations; **gated prod-apply** (local-green → advisor → batched prod apply); watch local-vs-prod drift. Prod ref `ufufmcpnysvwtutpbian`.
- **Blind contract:** feed payloads stay lean + blind-safe (NO `itinerary_id`/`creator_id`/`venue_id`, scrubbed `reservation_url`, hour-truncated time). The extended RPC MUST preserve this.
- **RPC discipline:** SECURITY DEFINER RPCs pin `search_path`; re-check `auth.uid()`; **re-emit the grant trio** (revoke public + revoke anon + grant authenticated) on every re-emitted signature — Supabase auto-grants EXECUTE to `anon` on new public functions (`20260605120200` Pitfall 2 note).
- **Design:** dating vertical uses Barbiecore Tier-1/Tier-2 tokens from `docs/superpowers/DESIGN-SYSTEM.md`; no new fonts/hex/shadcn; vaul/sonner/framer-motion/lucide-react only.
- **Copy:** lowercase, dry, stop-slop, **no em-dashes** (use ` · ` or a period). Known existing violation at `PostNightForm.tsx:315` — do NOT introduce new em-dashes in the reach line landing in the same file.
- **Named exports only; files <500 lines; explicit return types on exported functions.**

## Standard Stack

This phase introduces **zero new packages**. Everything is already in `package.json` (verified in CLAUDE.md dependency manifest).

### Core (all already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vaul` | 1.1.2 | The FilterSheet bottom-sheet (already used by the `FilterSheet.tsx` stub + `NightDetailSheet`) | Project-standard drawer; the stub already imports `Drawer` from it. |
| `sonner` | 2.0.7 | Filter-save / feed-reload error toasts (`that didn't save. try again?`) | Project-standard toast; mirrors the existing swipe-error toast. |
| `framer-motion` | 12.40.0 | Chip/pill micro-motion (respecting `motion-reduce:`) | Project-standard motion lib. |
| `lucide-react` | 0.460.0 | `SlidersHorizontal` (gear, already wired), chip icons | Project icon set. |
| `@supabase/supabase-js` | 2.45.0 | `client.rpc('browse_feed_for_viewer'|'reach_preview')` + `client.from('profiles').update()` | The data path; RPC + PostgREST write. |
| `@after5/api-client` | workspace:* | `browseFeed`, `postNight` wrappers + new `reachPreview` + `saveFeedFilters` | Where the new RPC/column wrappers land (`packages/api-client/src/feed.ts` + `profile.ts`). |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@after5/business` | workspace:* | `feedColdStartTier` (already used by feed page); `vibePalette` for card tier-2 | Cold-start tiering + per-vibe card palette; reused as-is. |
| `zod` (`@after5/validators`) | 3.23.8 | Optional: validate the `feed_filters` shape before write | If the planner wants a client-side guard on the jsonb shape before persisting. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reading `feed_filters` inside the RPC via `auth.uid()` | Passing `feed_filters` as an RPC param | Param is more testable in isolation and lets the client send unsaved filters without a round-trip, BUT it diverges from the existing `browse_feed_for_viewer` design (which reads the viewer's profile internally via the `me` CTE) and adds a wide jsonb param. **Recommendation: read inside the RPC** (mirror the existing `me` CTE that already reads `gender_preferences`, `age_pref`, `distance_pref_km` from the profile) — it keeps web/native consistent and matches spec §6 "server-side filter state". The client persists-then-requeries.
| One mega-RPC | Separate `reach_preview` RPC | Spec §"RPC contract changes" mandates a separate lightweight `reach_preview` — keep it separate (different caller, different cost profile, called live/debounced from the post form). |
| Auto-relax empty feed | D-02 active recovery | Auto-relax breaks user trust that filters work (D-02 rationale) — DO NOT. |

**Installation:** None. No `npm install`. (Package Legitimacy Audit therefore N/A — see below.)

## Package Legitimacy Audit

**N/A — this phase installs no external packages.** All UI and data libraries are already present in `package.json` (CLAUDE.md manifest verified). No registry pull, no slopcheck needed.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
  SEARCHER (feed)        │  feed/page.tsx (SSR, force-dynamic)          │
  ───────────────        │   • auth.getUser → gate (dating_enabled,     │
                         │     verification)                            │
                         │   • browseFeed(client,{limit,after…})  ──────┼──┐
                         └─────────────────────────────────────────────┘  │
                                                                            ▼
   ┌──────────────────┐   persist (PostgREST)        ┌──────────────────────────────────┐
   │ FilterSheet.tsx  │──client.from('profiles')────▶│ profiles.feed_filters jsonb      │
   │ (vaul, client)   │   .update({feed_filters})    │  (self read/write: profiles_     │
   │ + 3 quick chips  │◀──re-query on apply──────────│   owner_all RLS, no new policy)   │
   └──────────────────┘                              └──────────────────────────────────┘
            │                                                        │ read via auth.uid()
            │ feed re-renders                                        ▼
            ▼                                  ┌─────────────────────────────────────────┐
   ┌──────────────────┐                        │ browse_feed_for_viewer(...)  DEFINER    │
   │ SwipeDeck.tsx    │◀───rows + `fit`────────│  me CTE: profile prefs + feed_filters   │
   │  • NightCard     │                        │  WHERE  : existing blind gates          │
   │    (fit pill on  │                        │         + HARD filters (gender/price/   │
   │     fit===true)  │                        │           distance) [normalize everyone]│
   │  • EmptyDeck     │                        │  ORDER BY: soft score DESC, keyset      │
   │    (filtered vs  │                        │  SELECT : 13 blind cols + fit boolean   │
   │     genuine)     │                        │  cursor : (starts_at,id) keyset, limit  │
   └──────────────────┘                        └─────────────────────────────────────────┘

  HOST (post night)      ┌─────────────────────────────────────────────┐
  ───────────────        │ nights/new/PostNightForm.tsx (client)       │
                         │  • targeting fieldset (gender/age/radius)    │
                         │  • reach line (debounced) ──reachPreview()──┐│
                         │  • postNight() on publish                   ││
                         └─────────────────────────────────────────────┘│
                                                                         ▼
                              ┌──────────────────────────────────────────────────┐
                              │ reach_preview(target_genders, target_age_range,   │
                              │   city, radius[, max_price?])  DEFINER, cheap     │
                              │  COUNT(*) profiles matching [normalize everyone]  │
                              └──────────────────────────────────────────────────┘
```
Trace the searcher use case: open feed → SSR seeds rows+fit → adjust filters in sheet → persist to profile → re-query → hard filters hide, soft sort + fit pill surface; empty → recovery copy.

### Recommended Project Structure (touch points, not new dirs)
```
supabase/migrations/
├── <ts>_e10_feed_filters_column.sql        # profiles.feed_filters jsonb (+ optional CHECK), no new RLS
├── <ts>_e10_browse_feed_filters.sql        # drop+recreate browse_feed_for_viewer w/ hard/soft/fit
├── <ts>_e10_reach_preview.sql              # new reach_preview RPC + grant trio
└── <ts>_e10_feed_indexes.sql               # composite index for new hard-filter predicates
supabase/tests/
├── e10_browse_feed_filters.sql             # hard hide, soft order, fit threshold, {everyone} norm
└── e10_reach_preview.sql                   # counts + {everyone} + anon revoke
packages/api-client/src/
├── feed.ts                                 # extend FeedNight (+fit); add reachPreview()
└── profile.ts                              # add saveFeedFilters() (mirror savePreferences)
apps/web/app/feed/
├── FilterSheet.tsx                         # stub → real (2 groups, persist, re-query)
├── SwipeDeck.tsx                           # 3 quick chips + EmptyDeck branch (filtered/genuine)
└── NightCard.tsx                           # fit pill on fit===true
apps/web/app/nights/new/PostNightForm.tsx   # reach line under radius (~line 495)
apps/web/e2e/
└── e10-feed-filters.spec.ts                # forced-local: post→filter→boost→hide→recover
```

### Pattern 1: Extend a SECURITY DEFINER RPC in place (drop+recreate, preserve contract)
**What:** Postgres keys a function by name + arg-type list. Adding params or changing the return shape creates a NEW overload and risks PGRST203 "function is not unique" 500s. The established project pattern (every `browse_feed`/`post_night` migration) is **drop the prior signature, recreate, re-emit the grant trio**.
**When to use:** Every change to `browse_feed_for_viewer` and `reach_preview`.
**Example:**
```sql
-- Source: supabase/migrations/20260602120400_m4_browse_feed_ambient.sql:10,22,68-69 (live)
drop function if exists browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int);
create or replace function browse_feed_for_viewer(
  p_viewer uuid default auth.uid(), p_point geography default null,
  p_after_starts timestamptz default null, p_after_id uuid default null, p_limit int default 20
) returns table (
  date_instance_id uuid, city_id uuid, time_window_start timestamptz,
  pay_setting text, vibe_tags text[], why_note text,
  cover_image_url text, title text, venue_neighborhood text, is_seed boolean, distance_m double precision,
  ambient_sound_path text, ambient_sound_name text,
  fit boolean                                       -- E10: 14th column, additive
) language sql security definer set search_path = public, extensions as $fn$ ... $fn$;
revoke execute on function browse_feed_for_viewer(...) from public;
grant  execute on function browse_feed_for_viewer(...) to authenticated;
```
**Note:** keep the param signature stable if possible (the 5 existing params suffice — read `feed_filters` from the profile inside the `me` CTE). Adding `fit` to the RETURN TABLE changes the return type but not the call signature, so the api-client `browseFeed` call (`feed.ts:browseFeed`) needs no param change, only the `FeedNight` interface gains `fit`.

### Pattern 2: Read `feed_filters` in the `me` CTE (no new param)
**What:** The live RPC already has a `me` CTE that reads viewer prefs from `profiles` (`...ambient.sql:23–27`). Extend it to also pull `feed_filters` and unpack the jsonb keys.
**Example:**
```sql
-- extends the existing `me` CTE (Source: ...ambient.sql:23-27)
with me as (
  select gender, gender_preferences, age, age_pref, distance_pref_km,
         coalesce(p_point, (select centroid from cities c where c.id = pr.primary_city_id)) as pt,
         coalesce(pr.feed_filters, '{}'::jsonb) as ff
  from profiles pr where pr.id = p_viewer
),
f as (  -- unpack jsonb once
  select
    (ff->>'max_price')::numeric                            as max_price,
    (ff->>'max_distance_km')::numeric                      as max_distance_km,
    case when ff ? 'host_genders' then array(select jsonb_array_elements_text(ff->'host_genders')) end as host_genders,
    case when ff ? 'host_age_range' then int4range((ff->'host_age_range'->>0)::int, (ff->'host_age_range'->>1)::int, '[]') end as host_age_range,
    case when ff ? 'vibes' then array(select jsonb_array_elements_text(ff->'vibes')) end as vibes,
    case when ff ? 'who_pays' then array(select jsonb_array_elements_text(ff->'who_pays')) end as who_pays,
    case when ff ? 'time_buckets' then array(select jsonb_array_elements_text(ff->'time_buckets')) end as time_buckets
  from me
)
```

### Pattern 3: Hard filters in WHERE (only when set; inclusive default)
**What:** Each hard filter applies ONLY when present in `feed_filters` (open inclusive default, D-04). NULL/absent = no constraint.
**Example:**
```sql
-- HARD: host gender (the host's own gender vs searcher's host_genders filter)
and (f.host_genders is null or cr.gender = any(f.host_genders))
-- HARD: max price (itinerary total_cost_pp)
and (f.max_price is null or it.total_cost_pp <= f.max_price)
-- HARD: max distance (searcher origin -> date city centroid)
and (f.max_distance_km is null or st_dwithin(cc.centroid, me.pt, f.max_distance_km * 1000))
```
Note: the **existing** distance gate (`...ambient.sql:63`, `least(me.distance_pref_km, cr.distance_pref_km)`) stays — the new `max_distance_km` is an additional, tighter searcher cap layered on top.

### Pattern 4: Soft score + `fit` in ORDER BY / SELECT (deterministic SQL, no hide)
**What:** Soft fields never hide; they add to a score used in ORDER BY and threshold the `fit` boolean. **The date's own targeting** (`di.target_genders`, `di.target_age_range`) drives `fit` (does THIS night look for someone like the viewer); **the searcher's soft filters** (`vibes`/`who_pays`/`time_buckets`) add preference boost.
**Example:** see §"Code Examples" Soft-Sort Formula. Keep it a single arithmetic expression so it lives in ORDER BY without a subquery per row.

### Anti-Patterns to Avoid
- **Filtering for a literal `'everyone'` row value** — drops every open night (Pitfall 1). Normalize first.
- **Adding the viewer's `feed_filters` as a wide jsonb param** when the RPC already reads the profile — diverges from the established `me`-CTE pattern (Pattern 2).
- **Breaking keyset order by sorting on score before `(starts_at,id)` in the cursor comparison** — the cursor predicate `(di.starts_at, di.id) > (p_after_starts, p_after_id)` (`...ambient.sql:64`) and the `ORDER BY` must stay consistent or pagination skips/dupes rows (Pitfall 3).
- **Adding a new RLS policy for `feed_filters`** — unnecessary; `profiles_owner_all` already covers it (Pitfall 2). A redundant policy is noise and an advisor risk.
- **Restyling the feed wholesale / introducing shadcn** — 04-UI-SPEC.md forbids it; extend the four stubs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filter-state RLS | A custom `feed_filters` read/write policy | The existing `profiles_owner_all` policy (`capture_full_schema.sql:51`, `FOR ALL USING(id=auth.uid()) WITH CHECK(id=auth.uid())`) | It already grants self-read/self-write to any profile column; a jsonb column inherits it. Adding a policy is redundant + an advisor surface. |
| Persisting the filter | A bespoke save RPC | `client.from('profiles').update({feed_filters}).eq('id', userId)` — the E4 pattern (`profile.ts:savePreferences`, `upsertProfile`) | RLS gates it; no DEFINER RPC needed for a self-owned column write. |
| Distance math | Haversine in JS | PostGIS `st_dwithin` / `st_distance` on `cities.centroid geography` (already in the query, `...ambient.sql:32,63`) | Indexed, correct, server-side. Origin = searcher city centroid (spec §5 v1). |
| Cursor pagination | OFFSET paging | Keyset on `(starts_at, id)` — already implemented (`...ambient.sql:64–65`) | Cheap + stable under inserts (spec §6). |
| Cold-start empty detection | A new query | `feedColdStartTier` from `@after5/business` (already called in `feed/page.tsx`) | Distinguishes thin vs healthy feed for the genuine-empty copy. |
| Bottom sheet | Custom modal | `vaul` `Drawer` (FilterSheet stub already uses it) | Project standard; gesture + a11y handled. |

**Key insight:** Phase 4 is a consume-and-extend phase. The DB, RLS, cursor, blind contract, and design tokens already exist. The new code is one column, two RPC bodies, one index, and four UI extensions — anything beyond that is over-building.

## Runtime State Inventory

> This is a feature-extension phase, not a rename/refactor. A light inventory because it touches stored data shape and an existing prod RPC.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `date_instances.target_genders` already holds the literal `{everyone}` on prod for open nights (STATE.md line 46 confirms targeting cols applied to prod; PostNightForm writes `['everyone']`). New `profiles.feed_filters` starts empty (`{}`/null) — inclusive default, zero backfill. | (1) Normalize `{everyone}` in BOTH new RPCs (code, no data migration needed if normalized at read). (2) OPTIONALLY a one-line data migration `update date_instances set target_genders='{}' where target_genders='{everyone}'` if the planner chooses the "fix at source" path (Pitfall 1) — but normalize-at-read is still required for safety. |
| Live service config | None — no external service stores these strings. | None. |
| OS-registered state | None. | None — verified (no scheduler/cron references targeting). |
| Secrets/env vars | None new. Forced-local test keys already in `playwright.config.ts`. | None. |
| Build artifacts | `apps/web/.next/**` contains stale `feed_filters` references from the FilterSheet stub build (grep hit). Harmless; regenerated on build. | None — verified stale build cache only, not source. |

**Prod-apply note:** prod uses MCP-assigned migration versions (drift vs local filenames — STATE.md line 46). Local files remain source of truth. The four new migrations land local-green → security advisor → batched gated prod-apply.

## Common Pitfalls

### Pitfall 1: The `{everyone}` literal silently empties the matched/boosted set
**What goes wrong:** Any `fit`/boost or `reach_preview` predicate that matches the viewer's gender against `di.target_genders` literally (e.g. `viewer.gender = any(di.target_genders)`) fails for every open night, because open nights store `{everyone}` (or could store `{}`), neither of which contains a real gender value. Result: NO open night ever shows the fit pill, and `reach_preview` undercounts to ~0 for open targeting.
**Why it happens:** `PostNightForm.tsx:69` initializes `useState(['everyone'])` and `:98–101` always falls back to `['everyone']` for the open case; `post_night` (`20260605120200:147`) stores `coalesce(p_target_genders,'{}')` — the coalesce only neutralizes NULL, the literal `{everyone}` passes through untouched. Confirmed live in STATE.md (`post_night stored {everyone}`).
**How to avoid — normalize at the query boundary (RECOMMENDED) + a defensive data fix:**
```sql
-- treat {everyone} and {} identically as "no gender restriction"
-- a date matches the viewer's gender iff it's open OR explicitly lists the viewer's gender
case
  when di.target_genders = '{}' or di.target_genders = array['everyone'] then true
  else me.gender = any(di.target_genders)
end as gender_fits
```
**Recommendation (planner's call, with tradeoffs):**
- **Normalize-at-read (primary, REQUIRED):** centralize the `{everyone}|{}` → open check in both RPCs. Robust regardless of what's already stored on prod; web + native share it. **Do this.**
- **Also fix-at-source (optional, defense-in-depth):** change `PostNightForm` to send `[]` for open and/or have `post_night` map `{everyone}`→`{}`, plus a one-line backfill `update date_instances set target_genders='{}' where target_genders=array['everyone']`. Cleaner stored data, but NOT a substitute for normalize-at-read (a stale client could still send `{everyone}`). If chosen, it's an additive migration + a 1-line PostNightForm change — keep it small and DON'T let it expand into the carry-forward #2 source-mutation rework (out of scope).
**Warning signs:** the `e10` pgTAP test posts an open night and asserts a matching-gender viewer gets `fit=true` and `reach_preview ≥ 1`; if it returns 0, this pitfall is live.

### Pitfall 2: Supabase auto-grants EXECUTE to `anon` on new public functions
**What goes wrong:** `reach_preview` (and any re-emitted `browse_feed_for_viewer` signature) becomes anon-executable, leaking a count/feed RPC to unauthenticated callers.
**Why it happens:** Postgres `PUBLIC` default-grant on new functions; Supabase exposes `anon`. Documented in `20260605120200:11–12` and the precedent `20260602120600_m4_revoke_anon_execute.sql`.
**How to avoid:** every re-emitted signature re-emits the **grant trio**: `revoke execute ... from public; revoke execute ... from anon; grant execute ... to authenticated;` and run the **security advisor after DDL** (CLAUDE.md). The existing pattern's `revoke from public` already implies anon, but the e11 migration adds an explicit `revoke from anon` for clarity — match it.

### Pitfall 3: Soft-sort breaks keyset pagination
**What goes wrong:** If `ORDER BY` becomes `soft_score DESC, starts_at, id` but the cursor predicate stays `(starts_at,id) > (after_starts,after_id)`, the keyset comparison no longer matches the sort order — pages skip or duplicate rows under the score reordering.
**Why it happens:** keyset pagination requires the cursor columns to be a prefix of (or identical to) the ORDER BY, in the same direction.
**How to avoid:** keep the **cursor keyed on the stable `(starts_at, id)`** and treat soft-score as a *within-window* tiebreak, OR page by a composite stable key. **Recommended v1:** `ORDER BY soft_score DESC, di.starts_at ASC, di.id ASC` with the cursor still gating on `(starts_at,id)` is unsafe; instead keep the primary sort stable: `ORDER BY di.starts_at ASC, di.id ASC` and apply soft-boost as a **bounded time-bucket reordering inside the page** is over-engineering for v1. Simplest correct v1: **sort `ORDER BY soft_score DESC, starts_at ASC, id ASC` and paginate by `(starts_at,id)` ONLY when soft filters are absent; when soft filters re-sort, page size is the full first window (limit ≤ 50)** — the feed is a swipe deck loading ~20 at a time, so the pragmatic v1 is: keep keyset on `(starts_at,id)` as the cursor and let soft-score influence order WITHIN the fetched window client-agnostically. **Flag for the planner:** decide cursor-vs-score precedence explicitly; the safe default that preserves the shipped cursor is to keep `(starts_at,id)` as the keyset and add soft-score as the LEADING order key only for the in-memory window, documented as "soft-sort is best-effort within the cursor window v1" (matches spec §9 "soft-sort is deterministic SQL score v1", not a global ranking).
**Warning signs:** pgTAP/e2e fetches two pages and asserts no `date_instance_id` appears twice and none is skipped.

### Pitfall 4: Em-dash regression in the reach line
**What goes wrong:** The reach line lands in `PostNightForm.tsx`, which already has a known stop-slop em-dash violation at line 315 (STATE.md, 04-UI-SPEC §Copywriting). Easy to copy the offending style.
**How to avoid:** reach-line copy uses ` · ` or a period only (04-UI-SPEC copy table). Optionally fix line 315 in the same touch (1-line), but do NOT introduce a new one.

### Pitfall 5: Breaking the blind contract when adding columns
**What goes wrong:** Adding `fit` or joining new tables tempts leaking `itinerary_id`/`creator_id`/`venue_id` or an unscrubbed `reservation_url` into the projection.
**How to avoid:** the new `fit` is a computed boolean — it carries no identity. Keep the SELECT list to the existing 13 columns + `fit`. The `s5_browse_feed_blind.sql` pgTAP test (already in the suite) asserts no identity columns leak — extend it to cover the new return shape.

## Code Examples

### Soft-Sort + `fit` formula (deterministic SQL)
```sql
-- Source: derived from spec §3 (soft-boost) + §1 (feed_filters keys), pinned to live columns.
-- `fit` = the DATE's targeting genuinely matches the viewer (drives the pill, D-03).
-- soft_score = `fit` weight + the SEARCHER's soft-filter matches (vibe/who-pays/time).
-- All [VERIFIED: live columns] di.target_genders, di.target_age_range on date_instances
-- (20260605120000_e11_targeting_cols.sql:14-17); it.vibe_tags, it.pay_setting on itineraries.

, scored as (
  select di.id,
    -- DATE-fits-viewer (normalize {everyone}|{}):
    ( (di.target_genders = '{}' or di.target_genders = array['everyone']
         or me.gender = any(di.target_genders))
      and (di.target_age_range is null or me.age <@ di.target_age_range)
    ) as date_fits_viewer,
    -- viewer soft-filter matches (each absent filter contributes 0):
    (case when f.vibes is null then 0
          when it.vibe_tags && f.vibes then 1 else 0 end)                      as vibe_pts,
    (case when f.who_pays is null then 0
          when it.pay_setting::text = any(f.who_pays) then 1 else 0 end)        as pay_pts,
    (case when f.time_buckets is null then 0
          when time_bucket_of(di.starts_at) = any(f.time_buckets) then 1 else 0 end) as time_pts
  from date_instances di ... cross join me, f
)
-- ORDER BY (see Pitfall 3 for cursor interaction):
--   (date_fits_viewer::int * 4 + vibe_pts + pay_pts + time_pts) desc,
--   di.starts_at asc, di.id asc
-- fit (the pill): strong-match threshold — date_fits_viewer AND at least one soft match,
--   e.g.  (date_fits_viewer and (vibe_pts + pay_pts + time_pts) >= 1)  as fit
```
`time_bucket_of(timestamptz)` is a small IMMUTABLE helper mapping a start time to `this_weekend`/`weeknights`/`daytime` (spec §3 coarse buckets) — define it in the same migration. Keep weights simple and documented (spec §9: deterministic v1, not ML).

### `reach_preview` RPC (lean count, host pre-post)
```sql
-- Source: spec §"RPC contract changes" reach_preview(target..., city, radius).
-- Cheap COUNT of profiles who would match this prospective date's targeting.
-- DEFINER (reads all profiles' gender/age/city which a searcher can't normally see),
-- search_path pinned, grant trio, {everyone} normalized.
drop function if exists reach_preview(text[], int4range, uuid, numeric);
create or replace function reach_preview(
  p_target_genders text[] default '{}',
  p_target_age_range int4range default null,
  p_city uuid default null,
  p_radius_km numeric default null
) returns integer language sql security definer set search_path = public, extensions as $fn$
  with c as (select centroid from cities where id = p_city)
  select count(*)::int
  from profiles pr, c
  where pr.dating_enabled = true and pr.verification = 'verified'
    and pr.id <> auth.uid()
    -- gender: open targeting ({everyone}|{}) matches everyone
    and ( p_target_genders = '{}' or p_target_genders = array['everyone']
          or pr.gender = any(p_target_genders) )
    and ( p_target_age_range is null or pr.age <@ p_target_age_range )
    and ( p_radius_km is null or p_city is null
          or st_dwithin(
               (select centroid from cities where id = pr.primary_city_id),
               c.centroid, p_radius_km * 1000) );
$fn$;
revoke execute on function reach_preview(text[], int4range, uuid, numeric) from public;
revoke execute on function reach_preview(text[], int4range, uuid, numeric) from anon;
grant  execute on function reach_preview(text[], int4range, uuid, numeric) to authenticated;
```
Stays cheap: COUNT over `profiles` with the existing `idx`/city centroid GIST; called debounced (D-01 live update). DEFINER is required (a searcher cannot read other profiles' gender/age under RLS) — this is the same accepted DEFINER pattern as all `match_*` RPCs (STATE.md advisor note: DEFINER-executable warnings are the app's established accepted pattern). The function returns ONLY an aggregate count, no row identity, so it leaks nothing about individuals.

### `feed_filters` column migration (no new RLS)
```sql
-- profiles.feed_filters jsonb — inclusive default = empty object (D-04). Self read/write
-- already covered by profiles_owner_all (capture_full_schema.sql:51). NO new policy.
alter table profiles
  add column if not exists feed_filters jsonb not null default '{}'::jsonb;
-- optional shape guard (cheap, additive):
-- alter table profiles add constraint feed_filters_is_object
--   check (jsonb_typeof(feed_filters) = 'object') not valid;  -- validate later if desired
```

### Persisting filters from the client (E4 pattern)
```typescript
// Source: mirrors packages/api-client/src/profile.ts:savePreferences (line ~50).
// New wrapper in profile.ts. RLS (profiles_owner_all) gates it; no RPC needed.
export async function saveFeedFilters(
  client: After5Client, userId: string, filters: FeedFilters,
): Promise<void> {
  const { error } = await client.from('profiles')
    .update({ feed_filters: filters as unknown as Json }).eq('id', userId);
  if (error) throw error;
}
```

### `FeedNight` + `reachPreview` api-client extension
```typescript
// Source: packages/api-client/src/feed.ts (FeedNight interface ~line 4; browseFeed ~end).
export interface FeedNight {
  /* …existing 13 fields… */
  fit: boolean;            // E10: strong-match hint flag (D-03)
}
export async function reachPreview(client: After5Client, input: {
  target_genders?: string[]; target_age_range?: string | null;
  city: string; radius_km?: number | null;
}): Promise<number> {
  const { data, error } = await client.rpc('reach_preview', {
    p_target_genders: input.target_genders ?? undefined,
    p_target_age_range: input.target_age_range ?? undefined,
    p_city: input.city, p_radius_km: input.radius_km ?? undefined,
  } as never);
  if (error) throw error;
  return (data as number) ?? 0;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Profile prefs (`gender_preferences`, `age_pref`, `distance_pref_km`) are the matching GATE in `browse_feed_for_viewer` | Per-date targeting is source of truth; profile prefs become defaults; **searcher `feed_filters` gate/sort the feed** | Spec 2026-06-03 (this phase implements it) | The existing mutual-preference WHERE (`...ambient.sql:60–63`) STAYS as a baseline blind gate; `feed_filters` hard filters layer ON TOP (a searcher's `max_distance_km` is a tighter cap than `distance_pref_km`). Do not remove the existing gates. |
| `FilterSheet.tsx` placeholder ("coming soon, everyone everywhere") | Real two-group sheet persisting `feed_filters` | This phase | The stub's shell (vaul Root/Overlay/Content, grabber, title, CTA) is kept; only the body + persistence are added. |
| Targeting columns existed but unconsumed | Feed reads `target_genders`/`target_age_range` for `fit`/boost; `search_radius_km` informs reach | This phase | Phase 3 created the columns (already on prod); Phase 4 is the first consumer. |

**Deprecated/outdated:** none. No library deprecations relevant.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Reading `feed_filters` inside the RPC (vs param) is the better fit | Stack / Pattern 2 | Low — both work; param is the fallback. Planner can flip without rework cost. |
| A2 | Soft-sort as "best-effort within the cursor window v1" satisfies SC-2 (soft only re-sorts) | Pitfall 3 | Medium — if a global score ranking is required, cursor design needs a composite score-keyset. Flagged for explicit planner decision. Spec §9 ("deterministic score v1") supports the simpler reading. |
| A3 | `reach_preview` over `profiles` with city-centroid distance is cheap enough for live/debounced calls | Code Examples | Low-Medium — `profiles` row count is small at MVP scale; add a partial index on `(dating_enabled, verification)` if the advisor or EXPLAIN flags it. |
| A4 | `max_price` filters on `it.total_cost_pp` (itinerary fork) | Pattern 3 | Low — `total_cost_pp` is the price field on the forked itinerary (`post_night` copies it, `20260605120200:136–137`); confirm the column is non-null for posted nights in the pgTAP test. |
| A5 | Soft-sort weights (fit×4, +1 each soft match) are reasonable v1 | Code Examples | Low — weights are a product-tuning knob, not a correctness issue; documented as tunable. |
| A6 | The "fix-at-source" `{everyone}`→`{}` change stays a 1-line PostNightForm + 1-line backfill and does NOT pull in carry-forward #2 | Pitfall 1 | Medium — scope creep risk; planner must fence it. Normalize-at-read alone satisfies REQ-E10. |

## Open Questions

1. **Cursor vs soft-score precedence (v1 ranking semantics).**
   - What we know: keyset is on `(starts_at,id)` (`...ambient.sql:64`); spec §9 says soft-sort is a deterministic SQL score v1, not global ML ranking.
   - What's unclear: whether SC-2 ("soft filters only re-sort") demands a *global* re-sort across all pages or a within-page best-effort boost.
   - Recommendation: v1 = keep `(starts_at,id)` keyset stable, apply soft-score as the leading ORDER BY key, document as "best-effort within the fetched window"; revisit if product wants global ranking (would need a score-inclusive composite cursor). Decide explicitly in the plan.

2. **Fix `{everyone}` at source too, or normalize-at-read only?**
   - What we know: normalize-at-read is REQUIRED and sufficient for REQ-E10.
   - What's unclear: whether the team wants clean stored data (a backfill + PostNightForm `[]` change).
   - Recommendation: ship normalize-at-read; treat the source fix as an optional small companion task, fenced from carry-forward #2.

3. **Distance origin for the searcher.**
   - What we know: spec §5 — v1 = searcher city centroid (`primary_city_id` → `cities.centroid`), already used by the live query. Geolocation is a parked fast-follow.
   - Recommendation: use city centroid; do not add a permission prompt this phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase local stack (Postgres 17) | pgTAP tests, forced-local e2e | ✓ (project standard; `supabase` CLI, ports 54321/54322 per `config.toml`) | PG17 | — |
| `psql` | `db:test` script (`package.json:21`) | ✓ assumed (project test runner uses it) | — | — |
| PostGIS / `geography` + `st_dwithin` | distance hard filter + reach | ✓ extensions enabled (`20260525120000_p0_extensions_and_cities.sql`; `cities.centroid geography(Point,4326)`) | — | — |
| Playwright + Chromium | e2e feed-filter flow | ✓ (`apps/web/playwright.config.ts`, 11 existing specs) | 1.49.0 | — |
| vaul/sonner/framer-motion/lucide-react | FilterSheet/pill/toasts | ✓ in `package.json` | per manifest | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

> nyquist_validation: assumed ENABLED (no `.planning/config.json` override read disabling it).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pgTAP-style SQL (psql `ON_ERROR_STOP`, `RAISE EXCEPTION` on assert, `ROLLBACK`) + Vitest 2.1.8 (jsdom for `apps/web`) + Playwright 1.49.0 (Chromium e2e) |
| Config file | `package.json:21` `db:test`; `vitest.workspace.ts`; `apps/web/playwright.config.ts` (forced-local) |
| Quick run command | `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/e10_browse_feed_filters.sql` |
| Full suite command | `pnpm db:test` (all `supabase/tests/*.sql`) · `pnpm -C apps/web test` (vitest) · `pnpm -C apps/web exec playwright test e10-feed-filters.spec.ts` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|--------------|
| E10 SC-1 | Host targets a date; matching searcher gets `fit=true` + boosted order | SQL (RPC) | `psql ... -f supabase/tests/e10_browse_feed_filters.sql` | ❌ Wave 0 |
| E10 SC-1 | `{everyone}`/`{}` open night → matching-gender viewer gets `fit=true` (Pitfall 1) | SQL (RPC) | same | ❌ Wave 0 |
| E10 SC-2 | Hard host-gender / max-price / max-distance HIDE non-matching nights (WHERE) | SQL (RPC) | same | ❌ Wave 0 |
| E10 SC-2 | Soft filters (vibe/who-pays/time) only RE-SORT (a soft-mismatched night still appears) | SQL (RPC) | same | ❌ Wave 0 |
| E10 SC-2 | Soft-sort order: a fit+soft-matched night ranks above a non-matching one | SQL (RPC) | same | ❌ Wave 0 |
| E10 SC-4 | Keyset cursor: two pages, no dup, no skip (Pitfall 3) | SQL (RPC) | same | ❌ Wave 0 |
| E10 SC-4 | Blind contract preserved (no creator/itinerary/venue id; `fit` carries no identity) | SQL (RPC) | extend `supabase/tests/s5_browse_feed_blind.sql` | ⚠️ extend existing |
| E10 D-01 | `reach_preview` counts matching profiles; `{everyone}` counts everyone; open targeting ≥ specific | SQL (RPC) | `psql ... -f supabase/tests/e10_reach_preview.sql` | ❌ Wave 0 |
| E10 sec | `reach_preview` + re-emitted feed signature: anon EXECUTE revoked, authenticated granted | SQL (RPC) | same (mirror `e11_targeting.sql` anon-revoke assertions) | ❌ Wave 0 |
| E10 sec | `feed_filters` self-write only (another user cannot write mine) | SQL (RLS) | `supabase/tests/e10_feed_filters_rls.sql` (mirror `p1_preferences.sql`) | ❌ Wave 0 |
| E10 SC-1/2/3 | E2E: post targeted date → matching searcher sees boost+pill → hard filter hides → loosen recovers | Playwright | `playwright test e10-feed-filters.spec.ts` (forced-local seed) | ❌ Wave 0 |
| E10 D-04 | FilterSheet persists `feed_filters`, re-queries; chip→sheet; reset clears | component/e2e | vitest `FilterSheet.test.tsx` + the e2e above | ❌ Wave 0 |
| E10 D-03 | Fit pill renders only on `fit===true` cards | component | vitest `NightCard.test.tsx` | ❌ Wave 0 |
| E10 D-02 | Empty state branches filtered (recovery copy) vs genuine (`EmptyDeck`) | component | vitest `SwipeDeck`/`EmptyDeck` test | ❌ Wave 0 |
| E10 D-01 | Reach line renders normal/low/zero/loading; never disables publish CTA | component | vitest `PostNightForm` test (mock `reachPreview`) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the single relevant `supabase/tests/e10_*.sql` (or the touched vitest file) — fast, < 30s.
- **Per wave merge:** `pnpm db:test` + `pnpm -C apps/web test`.
- **Phase gate:** full SQL suite + vitest + the `e10-feed-filters.spec.ts` Playwright run green, then security advisor after each DDL migration, before `/gsd:verify-work` and before any gated prod-apply.

### Forced-local constraint (load-bearing)
`.env.local` points at PROD. Tests MUST force the local Supabase URL/keys:
- Playwright already does this: `playwright.config.ts:5,59–64` injects `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` + `LOCAL_PUBLISHABLE_KEY` + `LOCAL_SECRET_KEY` into the spawned Next `webServer.env`; seed helper (`e2e/_helpers/seed.ts:5`) uses `SUPABASE_URL ?? 'http://127.0.0.1:54321'` with the service role key. New `e10-feed-filters.spec.ts` reuses this harness + `mk_user`/`mk_itinerary`/`mk_instance` fixtures (`supabase/tests/_fixtures.sql`).
- SQL tests run against `127.0.0.1:54322` directly (`package.json:21`) — inherently local, no PROD risk.

### Wave 0 Gaps
- [ ] `supabase/tests/e10_browse_feed_filters.sql` — hard hide, soft re-sort/order, fit threshold, `{everyone}` norm, keyset no-dup/no-skip (model on `s5_browse_feed_blind.sql` + `e11_targeting.sql`)
- [ ] `supabase/tests/e10_reach_preview.sql` — counts, `{everyone}` normalization, anon-revoke (model on `e11_targeting.sql`)
- [ ] `supabase/tests/e10_feed_filters_rls.sql` — self-write only (model on `p1_preferences.sql`)
- [ ] Extend `supabase/tests/s5_browse_feed_blind.sql` — assert the new `fit` column + still no identity leak
- [ ] `apps/web/e2e/e10-feed-filters.spec.ts` — full forced-local flow
- [ ] vitest: `FilterSheet.test.tsx`, `NightCard` fit-pill test, `EmptyDeck` branch test, `PostNightForm` reach-line test
- [ ] Framework install: none — pgTAP-via-psql + vitest + Playwright all present.

## Security Domain

> security_enforcement: assumed enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | RPCs re-check `auth.uid()`; `browse_feed_for_viewer` defaults `p_viewer := auth.uid()`; gated by verified+dating_enabled in `feed/page.tsx`. |
| V3 Session Management | no (handled by Supabase SSR cookie middleware) | — |
| V4 Access Control | yes | `profiles_owner_all` RLS for `feed_filters` (self read/write); DEFINER RPCs return only blind/aggregate data; **anon EXECUTE revoked** on both new/re-emitted functions (Pitfall 2). |
| V5 Input Validation | yes | `feed_filters` jsonb shape — optional CHECK `jsonb_typeof='object'`; numeric/range casts in the RPC are defensive; RPC params typed (`text[]`, `int4range`, `numeric`). Optionally zod-guard the client write. |
| V6 Cryptography | no | — |

### Known Threat Patterns for Postgres-RPC + jsonb-filter feed
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| anon-executable count/feed RPC leaks data to unauthenticated callers | Information Disclosure | grant trio (revoke public + anon, grant authenticated) + advisor after DDL (Pitfall 2). |
| Blind-contract leak via new projection columns | Information Disclosure | keep SELECT to 13 blind cols + computed `fit`; extend `s5_browse_feed_blind.sql` to assert no identity leak (Pitfall 5). |
| `reach_preview` DEFINER reads all profiles | Information Disclosure | return ONLY an aggregate `count(*)::int` — never row identity; same accepted DEFINER pattern as `match_*` (STATE.md advisor note). |
| Cross-user filter tampering (writing another user's `feed_filters`) | Tampering / EoP | `profiles_owner_all` `WITH CHECK (id = auth.uid())`; covered by `e10_feed_filters_rls.sql`. |
| jsonb injection / malformed filter crashing the RPC | DoS / Tampering | guarded casts + optional object CHECK; absent keys treated as "no filter". |

## Sources

### Primary (HIGH confidence — live codebase, file:line verified)
- `supabase/migrations/20260602120400_m4_browse_feed_ambient.sql` — current `browse_feed_for_viewer` signature, 13-col blind return, `me` CTE, WHERE gates, keyset cursor, grant trio.
- `supabase/migrations/20260605120200_e11_post_night_targeting.sql` — 8-arg `post_night`, `coalesce(p_target_genders,'{}')` (the `{everyone}` passthrough), fork copy of `total_cost_pp`, drop-old-overload + grant-trio pattern, anon-grant pitfall note.
- `supabase/migrations/20260605120000_e11_targeting_cols.sql` — `target_genders/target_age_range/search_radius_km` columns + defaults.
- `supabase/migrations/20260525120300_p0_date_instances.sql` + `20260527120000_s4_date_instances_feed_columns.sql` — indexes (`date_instances_city_status_idx`, `date_instances_feed_idx (status,starts_at) WHERE seeking+approved`, `date_instances_range_gist`), `date_instances_creator_all` RLS.
- `supabase/migrations/20260522100000_capture_full_schema.sql:51` — `profiles_owner_all` self read/write policy (covers `feed_filters`).
- `supabase/migrations/20260525120000_p0_extensions_and_cities.sql` — PostGIS extension + `cities.centroid geography`.
- `apps/web/app/nights/new/PostNightForm.tsx:45,67–101,263–270` — `['everyone']` init/fallback + `postNight` call (confirms `{everyone}` source); reach line lands ~line 495.
- `apps/web/app/feed/{page.tsx,FilterSheet.tsx,SwipeDeck.tsx,NightCard.tsx}` — SSR feed seed, stub sheet, quick-chip trigger/EmptyDeck/`remaining` live region, card.
- `packages/api-client/src/feed.ts` — `FeedNight`, `browseFeed`, `postNight` wrappers.
- `packages/api-client/src/profile.ts:20–60` — `upsertProfile`/`savePreferences` (the `feed_filters` write pattern).
- `supabase/tests/{s5_browse_feed_blind.sql,e11_targeting.sql,p1_preferences.sql,_fixtures.sql}` + `package.json:21` `db:test`; `apps/web/playwright.config.ts:5,59–64` + `e2e/_helpers/seed.ts:5` — test harness patterns.
- `.planning/STATE.md:42,46` — prod-apply ledger (targeting cols on prod; `{everyone}` confirmed live; `PostNightForm.tsx:315` em-dash; MCP version drift).
- `docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md` §1/§3/§5/§6/§8/§9 — locked data model, hybrid strictness, distance origin, API-first constraint, testing, YAGNI.
- `.planning/phases/04-discoverability-feed-filters-targeting-p1/{04-CONTEXT.md,04-UI-SPEC.md}` — locked decisions D-01..D-04 + visual/copy contract.
- `.planning/ROADMAP.md` Phase 4 — 4 success criteria + carry-forward notes.

### Secondary (MEDIUM)
- CLAUDE.md / ARCHITECTURE sections — RLS-first, DEFINER RPC, blind-feed, gated-prod-apply conventions.

### Tertiary (LOW)
- None required — the architecture is locked by the spec and verified against live code; no unverified web findings.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new packages; all libs verified in `package.json` manifest.
- Architecture: HIGH — pre-locked by the design spec, every contract pinned to live file:line.
- Pitfalls: HIGH — `{everyone}` confirmed live (STATE.md + PostNightForm + post_night); keyset/blind/anon-grant patterns all evidenced in existing migrations and tests.
- Soft-sort ranking semantics: MEDIUM — v1 simplification flagged as an explicit planner decision (Open Question 1).

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (stable — internal architecture, no fast-moving external deps). Re-verify prod schema state (`ufufmcpnysvwtutpbian`) immediately before any gated prod-apply.

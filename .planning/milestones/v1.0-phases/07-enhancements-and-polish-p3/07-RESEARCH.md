# Phase 7: Enhancements & Polish (P3) - Research

**Researched:** 2026-06-05
**Domain:** Next.js 15 / Supabase dating app — WIRING + tuning over existing infra (E20–E25)
**Confidence:** HIGH (codebase-verified against the live files for every must-specify item)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (E21): Link post-match, no global nav, retire the /create funnel.** Matched-night stops link to `/places/[slug]` (venue identity post-lock). Do NOT add `/places` to the dating app's global nav. Retire the legacy "build a date here" → `/create` CTA on venue pages. Graceful degrade: a stop whose place_id isn't in the catalog renders inline (no broken /places link / 404).
- **D-02 (E25): Ship ONLY the detail-sheet skeleton + the archive view.** Defer draft-state, typing-indicators, read-receipts, business-ownership stub, /plan/i legacy cleanup. (E25a hero consistency already holds.)
- **D-03 (E22): Tune the existing e10 soft-score, do not rebuild.** Keep the `browse_feed_for_viewer` ORDER BY shape (targeting×4 + soft filters + (starts_at,id) keyset). Weight vibe-overlap by the COUNT of matched vibe tags (not boolean), add a light mutual-compatibility nudge. Keyset cursor stays stable.

### Claude's Discretion
- **E20 map:** Mapbox static image (token + `ItineraryMap.tsx`/`RadiusMap.tsx` exist). Prefer a lightweight static map in the detail sheet over a heavy GL canvas. Per-stop coords come from the stop's place_id → places.lat/lng; prefer `get_night_detail` adding lat/lng per stop.
- **E23 distance/label:** add `c.name as city_name` to `browse_feed_for_viewer` (re-CREATE preserves the e10/e15 contract incl. host-hint cols + re-grant tail). "Finer than city-centroid": use the night's first-stop/venue coords for distance when available, else fall back to city-centroid; keep NightCard distance UI as-is.
- **E24 standby:** surface the candidate's existing `queue_entries` rank/status (read path) as "you're next in line" / position; the withdraw-pending-interest path removes a plain `interested` row (a DEFINER RPC mirroring existing withdraw patterns, secure-by-default). Do NOT auto-create standby on offer-expiry. Re-swipe-after-withdraw allowed (planner's call: simplest is delete the interest).
- **Secure-by-default + gated-prod-apply:** any RPC re-CREATE / new RPC pins search_path, no USING(true), re-applies grants; advisor after DDL; local-green → gated prod-apply (NOT auto-pushed; prod `ufufmcpnysvwtutpbian`).
- **Visual-verify @420px** every changed surface against DESIGN-SYSTEM.md.

### Deferred Ideas (OUT OF SCOPE)
E25d draft state; E25e typing indicators + read receipts; E25f business-ownership/claim stub; E25g legacy /plan/i dead-link cleanup. E22 richer compatibility/chemistry ranking model. E24 automatic standby promotion (offer-expiry → standby). E21 /places global nav; multi-city expansion. Phase 5 WR-04 (cancelled-lock reveal).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-E20 | Real Mapbox map in night detail sheet + per-stop coord deep-links | `get_night_detail` re-CREATE adds per-stop `lat`/`lng` (join `places` via stop's place_id); reuse `ItineraryMap` static-PNG pattern; `PlanTimeline` map href → `query={lat},{lng}` |
| REQ-E21 | Matched-night stops → `/places/[slug]`; retire `/create` CTA on venue pages; no `/places` nav | `PlanTimeline` opt-in `linkSlugs` prop (default off, on for `LockDetail`); slug from `places.slug` (surface `place_slug` in detail stops); retire CTAs at `places/[slug]/page.tsx:263-269` + `:459-465` |
| REQ-E22 | Tune e10 soft-score (vibe COUNT + mutual-compat nudge) | One feed-RPC re-CREATE built on e15 body; change ORDER BY only; keyset tail unchanged |
| REQ-E23 | Return `city_name` + finer distance | Same re-CREATE adds `c.name as city_name`; distance from first-stop/venue coords else city-centroid; `NightCard.tsx:55` slot already wired |
| REQ-E24 | Candidate standby view (rank/status) + withdraw-pending-interest | Candidate read of own `queue_entries` row (RLS `queue_candidate_read_own` exists); new DEFINER `withdraw_interest(p_actor, p_instance)` RPC mirroring `match_withdraw` |
| REQ-E25 | Detail-sheet skeleton + archive view | In-sheet shimmer mirroring `feed/loading.tsx` while `get_night_detail` pends; `/my-nights` upcoming/archive toggle on `date_instances.status` |
</phase_requirements>

## Summary

Phase 7 is the P3 round-out: six thin, mostly wiring slices over infra that already exists. Every must-specify integration point is codebase-verified. The DB work is three migrations: re-CREATE `get_night_detail` (add per-stop `lat`/`lng` + `place_slug`), re-CREATE `browse_feed_for_viewer` (add `city_name`, tune soft-score, finer distance — built on the e15 body), and a new `withdraw_interest` DEFINER RPC. All are gated-prod-apply.

The frontend work reuses existing patterns wholesale: the static-Mapbox `ItineraryMap.tsx` already implements the exact pattern E20 needs (static PNG, lightbox, no WebGL) — it just hardcodes the planner terracotta and reads a different `Stop` shape, so the dating-sheet variant needs the Barbiecore pink + the `NightDetailStop` shape. `PlanTimeline` is a single shared component used blind (feed/offer) and revealed (LockDetail), so the E21 slug link MUST be a per-call opt-in prop to preserve the blind contract. The E24 standby card, E25 skeleton, and archive toggle are all net-new but reuse the `feed/loading.tsx` shimmer, the `LockDetail` vaul cancel pattern, and the `my-nights` row treatment.

**Primary recommendation:** Three gated migrations (detail-RPC coords, feed-RPC city+tune, withdraw-interest RPC) + opt-in slug prop on `PlanTimeline` + a pink/`NightDetailStop` variant of the static map. Preserve the blind contract on every shared surface: the feed `NightDetailSheet` and offer timelines must NEVER render slug links or host identity. The feed-RPC re-CREATE is a DROP+CREATE (return shape changes) and MUST re-emit the verbatim revoke/grant tail and keep all 14 e10 cols + 3 e15 host-hint cols.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-stop coords for map (E20) | Database (RPC) | Frontend (render) | Coords live in `places`; the DEFINER RPC is the blind-safe boundary that already scrubs identity — add `lat`/`lng` there, not via a client-side `places` query that could leak |
| Static map render (E20) | Frontend (client) | CDN (Mapbox Static API) | Mapbox renders the PNG server-side; the app just builds the URL + `<Image unoptimized>` |
| Coord deep-links (E20) | Frontend (PlanTimeline) | — | Pure href construction from stop coords |
| Venue slug links (E21) | Frontend (PlanTimeline opt-in) | Database (RPC surfaces `place_slug`) | Link rendering is UI; the slug must be returned by the detail RPC (post-match path) |
| Soft-score ranking (E22) | Database (RPC ORDER BY) | — | Ordering is server-side keyset; no UI change |
| City label + finer distance (E23) | Database (RPC) | Frontend (existing slot) | RPC returns `city_name` + distance; `NightCard` already reads both |
| Standby read (E24) | Database (RLS read) | Frontend (card) | `queue_entries` RLS already lets a candidate read their own row |
| Withdraw interest (E24) | Database (DEFINER RPC) | Frontend (vaul confirm) | Mutation crosses the security boundary; must re-check `auth.uid()` |
| Detail skeleton (E25) | Frontend (client) | — | Pure loading state inside the open drawer |
| Archive toggle (E25) | Frontend (SSR + segment) | Database (status filter) | `date_instances.status` bucketing; SSR read already exists |

## Standard Stack

All libraries are already installed and in active use. No new dependencies for this phase.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mapbox-gl / Static Images API | 3.22.0 | Static route PNG (no WebGL) | `ItineraryMap.tsx` already uses the Static Images API; token in `NEXT_PUBLIC_MAPBOX_TOKEN` [VERIFIED: codebase `apps/web/components/itinerary/ItineraryMap.tsx:62`] |
| next/image | 15.1.0 | `<Image unoptimized>` for the Mapbox PNG | Existing pattern, `unoptimized` avoids re-proxying Mapbox [VERIFIED: codebase] |
| vaul | 1.1.2 | Bottom-sheet confirm (withdraw) | `LockDetail` cancel sheet uses this exact pattern [VERIFIED: codebase `LockDetail.tsx:269-279`] |
| sonner | 2.0.7 | Toasts (withdraw success/error) | Project-standard toast [VERIFIED: codebase] |
| @supabase/supabase-js | 2.45.0 | RPC invocation, RLS reads | All loop reads/mutations [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 0.460.0 | `MapPin`, `Maximize2`, `X` icons | Map button, deep-link, lightbox |
| framer-motion | 12.40.0 | (not required this phase — skeletons use CSS) | Avoid; skeletons are pure `animate-pulse` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Static Mapbox PNG | Interactive Mapbox GL canvas | REJECTED — `ItineraryMap` doc comment notes interactive map "was failing for users with WebGL disabled". Static is reduced-motion-friendly and matches UI-SPEC §E20 |
| New DEFINER `withdraw_interest` | Reuse `match_withdraw` | REJECTED — `match_withdraw` is gated by `match_v2_enabled`, advisory-locks, resolves offers, and sets `status='offer_passed'` (not delete). Plain-interest withdraw is a distinct, lighter action [VERIFIED: codebase `20260527126800_p5_pass_expire_withdraw.sql:87-118`] |

**Installation:** None — all packages present (verified in CLAUDE.md STACK section + `package.json`).

## Package Legitimacy Audit

> Not applicable — this phase installs ZERO external packages. All libraries (mapbox-gl, next/image, vaul, sonner, supabase-js, lucide-react) are already present in the committed `pnpm-lock.yaml` and in production use. No registry fetch, no `npm install`, no slopcheck run required.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
  swipe right ──────────▶│ record_swipe (DEFINER) → match_ingest_interest│
                         │   inserts queue_entries(status='interested')  │
                         └─────────────────────────────────────────────┘
                                            │
   ┌────────────────────────────────────────┼───────────────────────────────────┐
   │                                         │                                     │
   ▼ (E22/E23)                               ▼ (E24 read)                          ▼ (E24 write)
┌──────────────────────┐        ┌──────────────────────────┐      ┌────────────────────────────┐
│ browse_feed_for_viewer│        │ queue_entries RLS         │      │ withdraw_interest (NEW DEFINER)│
│  +city_name           │        │  candidate reads own row  │      │  delete own 'interested' row  │
│  +tuned soft-score     │        │  (rank, status)           │      │  auth.uid() check, no v2 gate │
│  +finer distance       │        └──────────────────────────┘      └────────────────────────────┘
└──────────┬───────────┘                     │                                     │
           ▼                                  ▼                                     ▼
   ┌───────────────┐               ┌──────────────────┐               ┌────────────────────┐
   │ NightCard      │               │ Standby card      │◀──confirm────│ vaul sheet + sonner │
   │  city_name slot│               │ "you're next..."  │               └────────────────────┘
   └───────────────┘               └──────────────────┘

  tap feed card ───▶ get_night_detail (DEFINER, re-CREATE: +per-stop lat/lng +place_slug)
                          │
        ┌─────────────────┼──────────────────────────────────────┐
        ▼                 ▼                                        ▼
  ┌─────────────┐  ┌──────────────────────┐            ┌────────────────────────┐
  │ skeleton (E25)│  │ PlanTimeline (shared) │            │ static Mapbox map (E20) │
  │ while pending │  │  map href={lat},{lng} │            │  pins+route, pink E0218A│
  └─────────────┘  │  linkSlugs? (E21 opt-in)│            │  click→lightbox         │
                    └──────────┬───────────┘            └────────────────────────┘
                               │  linkSlugs=false (feed/offer — BLIND)
                               │  linkSlugs=true  (LockDetail — REVEALED → /places/[slug])
                               ▼
                         ┌──────────────────────┐
                         │ /places/[slug] page    │  (retire /create CTAs at :263, :459)
                         └──────────────────────┘
```

### Recommended Project Structure
No new directories. Touch points:
```
apps/web/
├── components/
│   ├── PlanTimeline.tsx          # E20 coord href + E21 opt-in linkSlugs prop
│   └── itinerary/RouteMap.tsx    # NEW: pink/NightDetailStop variant of ItineraryMap (or param the existing one)
├── app/
│   ├── feed/
│   │   ├── NightDetailSheet.tsx  # E20 swap placeholder :264-287 → map; E25 skeleton while pending :83-97
│   │   └── NightCard.tsx         # E23 city slot already at :55 (no change beyond RPC return)
│   ├── matches/[lockId]/LockDetail.tsx   # E21 pass linkSlugs; E24 vaul confirm reference :269-279
│   ├── places/[slug]/page.tsx    # E21 retire /create CTAs at :263-269 and :459-465
│   ├── my-nights/page.tsx        # E25 upcoming/archive segment + status bucketing
│   └── dates/[slug]/ or matches/ # E24 candidate standby card surface (trace: see Open Questions Q1)
packages/api-client/src/feed.ts  # E20 add place_slug/lat already present in NightDetailStop:229-230; E23 add city_name to FeedNight
supabase/migrations/
├── 20260606140000_e20_get_night_detail_coords.sql      # re-CREATE get_night_detail
├── 20260606140100_e23_browse_feed_city_and_tune.sql    # DROP+CREATE browse_feed_for_viewer
└── 20260606140200_e24_withdraw_interest.sql            # NEW DEFINER RPC
```

### Pattern 1: Static Mapbox URL (E20)
**What:** Server-rendered PNG with numbered pins + encoded-polyline route line.
**When to use:** The detail sheet "the route" block, replacing the placeholder at `NightDetailSheet.tsx:264-287`.
**Example:**
```typescript
// Source: VERIFIED codebase apps/web/components/itinerary/ItineraryMap.tsx:45-63
// Adapt for the dating sheet: ACCENT = 'E0218A' (Barbiecore pink, bare hex — Mapbox
// static overlays take hex WITHOUT '#'), base style stays mapbox/light-v11.
const ACCENT = 'E0218A';  // UI-SPEC §Color "Map color note": pink not terracotta C2552B
// pins:  pin-s-{n}+E0218A(lng,lat)   route: path-3+E0218A-0.85(<encodedPolyline>)
// url: https://api.mapbox.com/styles/v1/mapbox/light-v11/static/{overlays}/auto/{dims}
//        ?access_token={NEXT_PUBLIC_MAPBOX_TOKEN}&padding={...}
// Render only when ≥1 stop has lat/lng; else fall back to the "short hop apart" placeholder tone.
```
Note: the existing `ItineraryMap` reads a `Stop` (`lat?: number | null`, `lng?: number | null` from `lib/itinerary-types.ts:18-19`) and `place_id`. The detail sheet stops are `NightDetailStop` (which ALREADY declares `lat: number | null; lng: number | null` at `feed.ts:229-230` but the RPC currently never populates them). Build a thin `RouteMap` variant that takes `NightDetailStop[]` + pink accent, OR parametrize `ItineraryMap` with `{ accent, stops: {lat,lng}[] }`. Prefer a small dedicated component to avoid coupling the planner `Stop` shape into the dating sheet.

### Pattern 2: Coord deep-link in PlanTimeline (E20)
**What:** Per-stop "map" link href switches from name text-search to coordinate query.
**Example:**
```typescript
// Source: VERIFIED codebase apps/web/components/PlanTimeline.tsx:46 (current name-search)
//   const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
// E20 change: prefer coords when present, else keep the name fallback.
const directions = (stop.lat != null && stop.lng != null)
  ? `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
// Label/icon (MapPin + "map") and target="_blank" rel="noopener noreferrer" UNCHANGED (:111-118).
```

### Pattern 3: PlanTimeline opt-in slug prop (E21) — BLIND CONTRACT CRITICAL
**What:** `PlanTimeline` is shared by the blind feed sheet, offer timelines, AND the revealed `LockDetail`. The slug link MUST be a per-call prop defaulting OFF so it can NEVER appear on a blind surface.
**Example:**
```typescript
// Source: VERIFIED codebase apps/web/components/PlanTimeline.tsx:134-156 (current signature)
//   export function PlanTimeline({ stops, accent, vibeTags }: {...})
// E21 add (default false):
export function PlanTimeline({ stops, accent, vibeTags, linkSlugs = false }: {
  stops: NightDetailStop[]; accent: string; vibeTags: string[] | null; linkSlugs?: boolean;
}) { ... }
// In StopRow: render the stop name as a <Link href={`/places/${stop.place_slug}`}> ONLY when
// linkSlugs === true AND stop.place_slug is non-empty; else plain <p> (graceful degrade, D-01).
// LockDetail (post-lock, REVEALED) passes linkSlugs; NightDetailSheet (feed) and any offer
// timeline pass nothing (stays false). PlanTimeline's existing doc comment already warns NOT to
// swap in StopCard.tsx because it links /places/[slug] — honor that: the link is opt-in, not default.
```
**REQUIRED:** `NightDetailStop` must carry `place_slug`. It currently does NOT (`feed.ts:219-232`). The `get_night_detail` re-CREATE (E20) must surface `place_slug` per stop (join `places` by the stop's place_id), and `normalizeNightDetailStops` (`feed.ts:260+`) must read it. This is safe POST-MATCH only — `get_night_detail` is the blind pre-swipe RPC, so the SLUG itself stays in the payload but the LINK is gated by `linkSlugs` (UI), and the blind sheet never sets `linkSlugs`. (Alternatively, LockDetail loads stops via its own loader that already runs `normalizeNightDetailStops`; confirm that loader carries `place_slug` — see Open Questions Q2.)

### Pattern 4: Withdraw-interest DEFINER RPC (E24)
**What:** Delete the candidate's own plain `interested` queue row. Secure-by-default, mirrors the `auth.uid()` gate of existing withdraw RPCs but is lighter (no v2 gate, no advisory lock, no offer resolution).
**Example:**
```sql
-- Source: VERIFIED pattern from 20260527126800_p5_pass_expire_withdraw.sql:87-118 (match_withdraw)
-- and 20260527120100_s5_record_swipe.sql (auth.uid() + errcode style).
create or replace function withdraw_interest(p_actor uuid default auth.uid(), p_instance uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  -- delete ONLY the actor's own plain interest (never shortlisted/offer/standby/locked).
  delete from queue_entries
   where date_instance_id = p_instance
     and candidate_id = p_actor
     and status = 'interested';
  -- Re-swipe allowed (D — Claude's discretion): optionally also clear the swipe so the
  -- night can reappear in the feed. Planner's call; simplest MVP is delete interest only.
end $fn$;
revoke execute on function withdraw_interest(uuid, uuid) from public, anon;
grant  execute on function withdraw_interest(uuid, uuid) to authenticated;
```
Note: `queue_entries` has NO insert/update/delete RLS policy (default-deny; `20260525120500_p0_queue_entries.sql:23-26` documents this — only DEFINER RPCs mutate). A DEFINER RPC is therefore the ONLY correct way to delete the row. The `auth.uid()` check is the security boundary, not RLS.

### Anti-Patterns to Avoid
- **Linking slugs on the blind feed.** `PlanTimeline` is shared. A naive "always link the name" change leaks venue identity onto the pre-match feed/offer surfaces and breaks the blind contract (CLAUDE.md / D-01). The slug link MUST be opt-in.
- **`CREATE OR REPLACE` on the feed RPC when the return shape changes.** Adding `city_name` changes the `RETURNS TABLE` signature → Postgres requires DROP+CREATE, which RESETS privileges. You MUST re-emit the verbatim `revoke public / revoke anon / grant authenticated` tail (the e15 migration documents this as "Pitfall 2 / T-05-03").
- **Client-side `places` query for coords.** Reading `places.lat/lng` in the browser bypasses the blind-safe RPC boundary and risks correlating a stop to a host. Add coords inside the DEFINER RPC.
- **Reusing `match_withdraw` for plain interest.** It is v2-gated, advisory-locked, and sets `offer_passed` instead of deleting — wrong semantics for a pre-offer interest.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Static map render | Custom canvas/SVG route | `ItineraryMap` static-PNG pattern (Mapbox Static Images API) | Already solves WebGL-disabled fallback, lightbox, polyline encoding [VERIFIED `ItineraryMap.tsx`] |
| Polyline encoding | New encoder | The `encodePolyline` already in `ItineraryMap.tsx:21-43` | Compact Google-polyline algo, dependency-free, tested in prod |
| Loading skeleton | New shimmer system | Mirror `feed/loading.tsx` exactly (`animate-pulse` + `motion-reduce:animate-none`) | Reduced-motion-correct, token-correct [VERIFIED `feed/loading.tsx`] |
| Withdraw confirm sheet | New modal | `LockDetail` vaul cancel pattern (`:269-279`) | Overlay `bg-black/40`, `rounded-t-3xl bg-shell-base`, grab handle — UI-SPEC mandates mirroring it |
| Queue-row mutation | Direct table write / RLS update policy | DEFINER `withdraw_interest` RPC | `queue_entries` is default-deny on write by design (C7) |

**Key insight:** Almost every E20–E25 building block already exists in a sibling surface. The phase is wiring + a small contract widening, not new systems.

## Runtime State Inventory

> This is a wiring/tuning phase (RPC re-CREATEs + UI), not a rename/migration. Most categories are N/A, but the RPC re-CREATEs DO touch live function privileges and ALL must be gated-prod-applied.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no data rewrite. `queue_entries` rows are deleted by the new RPC at runtime, not migrated. | None |
| Live service config | `browse_feed_for_viewer` and `get_night_detail` are LIVE on prod `ufufmcpnysvwtutpbian` (last re-CREATEd by e15/m5). Re-CREATE replaces the live function body. | Gated-prod-apply all 3 migrations; run security advisor after DDL |
| OS-registered state | None | None — verified, no scheduler/cron involvement |
| Secrets/env vars | `NEXT_PUBLIC_MAPBOX_TOKEN` already present in `apps/web/.env.local` (and must be in Vercel for prod render). No new secrets. | Verify token present in Vercel prod env before E20 ships |
| Build artifacts | `@after5/api-client` exports `FeedNight`/`NightDetailStop` — adding `city_name`/`place_slug` to those types requires a package rebuild + (optionally) Supabase type regen for `Database`. | `pnpm build` the api-client package; regen types if RPC signatures are typed |

**Canonical question — after every file is updated, what runtime state still holds the old shape?** The two re-CREATEd RPCs on prod. They are replaced atomically by the migration, but anon must remain non-executable (re-grant tail) and the host-hint columns must survive — see Validation Architecture for the regression assertion.

## Common Pitfalls

### Pitfall 1: Feed-RPC re-CREATE drops the host-hint privilege/column contract
**What goes wrong:** A new `browse_feed_for_viewer` that forgets the 3 e15 host-hint cols, or the verbatim revoke/grant tail, silently breaks the feed host hint or re-exposes the RPC to anon.
**Why it happens:** Each phase re-CREATEs this RPC (e10 → e15 → now e23). It's easy to copy an older body.
**How to avoid:** Build the E23 migration on the CURRENT e15 body (`20260606120000_e15_browse_feed_host_hint.sql`). Keep all 14 e10 cols + `host_blurred_photo_url, host_first_name, host_age` + add `city_name`. Re-emit the revoke/grant tail verbatim. DROP+CREATE (not CREATE OR REPLACE) because the return shape changes.
**Warning signs:** Feed host avatar/name disappears; anon can execute the RPC; `pg_proc` shows missing columns.

### Pitfall 2: Migration timestamp collision / out-of-order
**What goes wrong:** A migration timestamped before the latest applied one won't run in order (Phase-6 collision lesson).
**Why it happens:** Latest applied migrations are `20260606130200_e19_lock_rpc_producers.sql` (verified `ls`).
**How to avoid:** Timestamp the 3 new migrations AFTER `20260606130200` with unique prefixes (e.g. `20260606140000` / `140100` / `140200`).
**Warning signs:** `supabase db push` reports out-of-order or skipped migrations.

### Pitfall 3: Keyset cursor instability from the E22 tune
**What goes wrong:** Changing the soft-score score expression changes the leading ORDER BY key; if the `(starts_at, id)` tail is removed or reordered, the keyset cursor (`p_after_starts`/`p_after_id`) breaks pagination.
**Why it happens:** Tuning the score block tempts a reorder.
**How to avoid:** Change ONLY the score expression inside the existing `order by (<score>) desc, di.starts_at asc, di.id asc` (e15 lines 107-118). Keep the `(starts_at,id)` keyset tail byte-identical. D-03 mandates this.
**Warning signs:** Duplicate or skipped cards on scroll; e2e feed pagination flakes.

### Pitfall 4: Slug link leaking onto the blind feed (E21)
**What goes wrong:** `PlanTimeline` linking names by default exposes venue identity pre-match.
**How to avoid:** `linkSlugs` defaults false; only `LockDetail` sets it true. (See Pattern 3.)
**Warning signs:** `/places/[slug]` link visible in the feed `NightDetailSheet` DOM.

### Pitfall 5: Mapbox accent hex with a leading `#`
**What goes wrong:** Mapbox static overlays take a BARE hex; `#E0218A` produces a broken/ignored overlay.
**How to avoid:** Use `'E0218A'` (no `#`), exactly as the existing `ACCENT = 'C2552B'` does (`ItineraryMap.tsx:18`).

## Code Examples

### E23 feed-RPC tune + city_name (the score block delta only)
```sql
-- Source: VERIFIED build-on e15 body 20260606120000_e15_browse_feed_host_hint.sql:107-118
-- RETURNS TABLE: append `city_name text` after host_age. SELECT: add `cc.name as city_name`
-- (the `cities cc` join already exists at e15 line 72 — no new join needed for the label).
-- ORDER BY score (D-03): vibe overlap becomes a COUNT, plus a light mutual-compat nudge.
order by (
    ( ( ( di.target_genders = '{}' or di.target_genders = array['everyone']
          or me.gender = any(di.target_genders) )
        and ( di.target_age_range is null or me.age <@ di.target_age_range )
      )::int * 4 )
    -- E22: weight vibe overlap by COUNT of matched tags (was boolean 0/1)
    + coalesce(cardinality(array(
        select unnest(it.vibe_tags) intersect select unnest(f.vibes)
      )), 0)                         -- when f.vibes is null this yields 0
    + (case when f.who_pays     is null then 0 when it.pay_setting::text = any(f.who_pays)     then 1 else 0 end)
    + (case when f.time_buckets is null then 0 when time_bucket_of(di.starts_at) = any(f.time_buckets) then 1 else 0 end)
    -- E22: light mutual-compat nudge — reward when both sides' gender prefs align beyond the hard gate.
    -- (the hard gates already filter; this nudge ranks a fuller mutual fit slightly higher)
    + (case when me.gender = any(cr.gender_preferences) and cr.gender = any(me.gender_preferences) then 1 else 0 end)
  ) desc,
  di.starts_at asc, di.id asc   -- KEYSET TAIL UNCHANGED (D-03)
```
Note on "finer distance" (E23): the current `distance_m` is `st_distance(cc.centroid, me.pt)` (e15 line 57 — city-centroid). For finer distance, prefer the night's venue coords when present: `st_distance(coalesce(case when pl.lat is not null and pl.lng is not null then st_point(pl.lng, pl.lat)::geography end, cc.centroid), me.pt)`. `pl` is the existing `left join places pl on pl.id = di.venue_id` (e15 line 73). Keep the city-centroid fallback. `NightCard` calls `formatDistanceAway(night.distance_m)` unchanged.

### E20 get_night_detail per-stop lat/lng + place_slug
```sql
-- Source: VERIFIED re-CREATE of 20260601210000_m5_get_night_detail.sql:64-69 (the stops jsonb)
-- Today the stops jsonb is `it.stops` (with reservation_url scrubbed). place_id/lat/lng/slug
-- come from the curated places catalog. Enrich each stop by joining places on the stop's
-- place_id and merging lat/lng/slug into the jsonb element. Stays CREATE OR REPLACE
-- (return SHAPE unchanged — `stops jsonb` is the same column; only its contents widen),
-- so the revoke/grant tail can stay but re-emit it anyway for safety.
case when jsonb_typeof(it.stops) = 'array' then coalesce((
  select jsonb_agg(
    (s - 'reservation_url')
    || jsonb_build_object('lat', pj.lat, 'lng', pj.lng, 'place_slug', pj.slug)
  )
  from jsonb_array_elements(it.stops) as s
  left join places pj on pj.id = (s->>'place_id')::uuid
), '[]'::jsonb) else '[]'::jsonb end as stops
-- NOTE: confirm the stop json key is 'place_id' (rich shape) — see Open Questions Q3.
-- normalizeNightDetailStops (feed.ts:260+) already maps lat/lng; ADD place_slug mapping there.
```

### E24 candidate standby read (RLS — no RPC needed for the read)
```typescript
// Source: VERIFIED RLS policy 20260525120500_p0_queue_entries.sql:33-35 queue_candidate_read_own
// A candidate can SELECT their own queue_entries row directly via the RLS client.
const { data } = await supabase
  .from('queue_entries')
  .select('status, rank')
  .eq('date_instance_id', instanceId)
  .eq('candidate_id', userId)   // RLS also enforces candidate_id = auth.uid()
  .maybeSingle();
// rank null until shortlisted; copy: rank===1 → "you're next in line", rank>1 → "you're #{rank} in line".
```

### E25 archive bucket (my-nights)
```typescript
// Source: VERIFIED apps/web/app/my-nights/page.tsx:48-54 lifecycleLabel + :166 status select
// status values seen: 'seeking','matched','active','completed','expired','cancelled'.
// upcoming = ['seeking','matched','active']; archive = ['completed','expired','cancelled'].
// Add a two-segment client toggle; filter the already-fetched nights by bucket.
// Reuse the existing row treatment + lifecycleLabel corner chip (no new card).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Interactive Mapbox GL canvas | Static Images API PNG | Pre-existing (`ItineraryMap` comment) | Works with WebGL disabled; reduced-motion friendly |
| Name text-search map links | Coordinate deep-links | This phase (E20) | Accurate pin instead of fuzzy name search |
| city-centroid distance | venue/first-stop coords when present | This phase (E23) | Finer per-night distance |
| boolean vibe overlap (0/1) | COUNT of matched vibe tags | This phase (E22) | Stronger relevance ranking |

**Deprecated/outdated:** The `NightDetailSheet.tsx:264-287` placeholder route viz (fake CSS pins) is replaced by the real static map (E20).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The stop json element key for the catalog id is `place_id` (used in the E20 `s->>'place_id'` join). | Code Examples / E20 | If the key differs (e.g. nested under a rich shape), the places join returns no coords → map silently falls back to placeholder. Verify against a real `itineraries.stops` row before writing the RPC. |
| A2 | The light mutual-compat nudge (both-sides gender-pref align) is an acceptable interpretation of D-03's "light mutual-compatibility nudge". | Code Examples / E22 | If the user meant a different compat signal, ranking nudge is wrong-but-harmless (still keyset-stable). Confirm in plan review. |
| A3 | E24 candidate standby card renders on a candidate-facing surface (not yet definitively traced). | Open Questions Q1 | Wrong placement = rework. Trace before planning the UI task. |

## Open Questions (RESOLVED)

1. **Where does the E24 candidate standby card render?**
   - What we know: `dates/[slug]/interested/InterestedList.tsx` is the HOST-side triage view (CONTEXT confirms). `queue_entries` candidate-read RLS exists. The candidate's own interest currently has no dedicated surface traced.
   - What's unclear: whether the candidate sees their standby on `/dates/[slug]` (candidate view), in `/matches`, or a new mini-surface.
   - Recommendation: planner traces the candidate's post-swipe surface (likely `dates/[slug]/page.tsx` candidate branch or the inbox/matches area) in Wave 0; the card is a Tier-1 shell component reusable wherever it lands.

2. **Does `LockDetail`'s stop loader already carry `place_slug`?**
   - What we know: `LockDetail.tsx:39` runs `normalizeNightDetailStops` BEFORE passing to `PlanTimeline`. `NightDetailStop` lacks `place_slug` today.
   - Recommendation: add `place_slug` to `NightDetailStop` + the normalizer, and ensure LockDetail's loader selects it (whether via `get_night_detail` or its own itinerary read). Confirm LockDetail's loader source during planning.

3. **Confirm the `itineraries.stops` json shape key for the catalog id (A1).**
   - Recommendation: query one prod/local `itineraries.stops` row (`select stops->0 from itineraries limit 1`) before writing the E20 RPC join.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Mapbox Static Images API token | E20 map render | ✓ | `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env.local` (CONTEXT-confirmed) | Map falls back to "short hop apart" placeholder (no broken tile) |
| mapbox-gl pkg | E20 (polyline helper reuse) | ✓ | 3.22.0 | — |
| Supabase local stack | All migrations (local-green before gated prod-apply) | ✓ | Postgres 17 | — |
| vaul / sonner | E24 confirm + toast | ✓ | 1.1.2 / 2.0.7 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Mapbox token in Vercel PROD env — if absent at prod-apply time, E20 degrades to the placeholder (no crash). Verify present before shipping E20.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 (unit/integration, jsdom for `apps/web`), Playwright 1.49.0 (e2e), pgTAP-style `.sql` tests in `supabase/tests/` |
| Config file | `vitest.config.ts` + `vitest.workspace.ts`; Playwright in `apps/web`; SQL tests run via `supabase/tests/_all_5b.sh` harness |
| Quick run command | `pnpm vitest run <file>` / `psql -f supabase/tests/<file>.sql` against local stack |
| Full suite command | `pnpm test && pnpm typecheck` + the supabase SQL test set + targeted Playwright spec |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| E20 | `get_night_detail` returns per-stop `lat`/`lng`/`place_slug` when the stop's place is in the catalog | SQL | `psql -f supabase/tests/e20_night_detail_coords.sql` | ❌ Wave 0 |
| E20 | Map URL builds from ≥1 coord; falls back to placeholder at 0 coords | unit | `pnpm vitest run apps/web/components/itinerary/__tests__/RouteMap.test.tsx` | ❌ Wave 0 |
| E20 | PlanTimeline map href = `query={lat},{lng}` when coords present, name fallback otherwise | unit | `pnpm vitest run apps/web/components/__tests__/PlanTimeline.test.tsx` | ❌ Wave 0 (extend if exists) |
| E21 | PlanTimeline renders `/places/[slug]` link ONLY when `linkSlugs===true` AND slug present; plain text otherwise | unit | same PlanTimeline test (linkSlugs cases) | ❌ Wave 0 |
| E21 | `/create` CTAs removed from `places/[slug]/page.tsx` | unit/grep | `pnpm vitest run` + assertion no `href="/create"` in the page | ❌ Wave 0 (or snapshot) |
| E22/E23 | feed RPC still returns EXACTLY the 14 e10 cols + 3 host-hint cols + new `city_name`; anon NOT executable | SQL | `psql -f supabase/tests/e23_feed_contract.sql` | ❌ Wave 0 |
| E22 | soft-score keyset stays stable: paginating with `(p_after_starts,p_after_id)` yields no dup/skip | SQL | same e23 contract test (keyset assertion) | ❌ Wave 0 |
| E23 | `city_name` = `cities.name` for a known seed | SQL | same e23 contract test | ❌ Wave 0 |
| E24 | `withdraw_interest` deletes ONLY the actor's own `interested` row; non-owner call raises `auth_mismatch`; shortlisted/offer rows untouched | SQL | `psql -f supabase/tests/e24_withdraw_interest.sql` | ❌ Wave 0 |
| E24 | candidate reads own `queue_entries` rank/status; cannot read another candidate's | SQL | same e24 test (RLS deny-non-owner) | ❌ Wave 0 |
| E25 | skeleton renders while `get_night_detail` pending; real detail replaces it on resolve | unit | `pnpm vitest run apps/web/app/feed/__tests__/NightDetailSheet.test.tsx` | ❌ Wave 0 |
| E25 | archive bucket filters `completed/expired/cancelled`; upcoming filters `seeking/matched/active` | unit | `pnpm vitest run apps/web/app/my-nights/__tests__/*` (extend) | ❌ Wave 0 (dir exists) |
| All UI | visual-verify @420px each changed surface vs DESIGN-SYSTEM.md | Playwright + screenshot | targeted spec + screenshot critique | manual recipe |

### Sampling Rate
- **Per task commit:** the surface's vitest file or its SQL test (`< 30s`).
- **Per wave merge:** `pnpm test && pnpm typecheck` + the new SQL tests.
- **Phase gate:** full suite green → gated prod-apply (migrations) → re-run SQL contract tests against prod read paths → `/gsd:verify-work` → visual-verify @420px.

### Wave 0 Gaps
- [ ] `supabase/tests/e20_night_detail_coords.sql` — per-stop lat/lng/place_slug present; non-catalog stop degrades (null coords, no row error)
- [ ] `supabase/tests/e23_feed_contract.sql` — REGRESSION: assert column set = 14 e10 + 3 host-hint + city_name; anon EXECUTE denied; keyset pagination stable; city_name correct
- [ ] `supabase/tests/e24_withdraw_interest.sql` — deletes only own `interested`; non-owner → P5001; other statuses untouched; candidate-read RLS deny-non-owner
- [ ] `apps/web/components/itinerary/__tests__/RouteMap.test.tsx` — URL build + 0-coord fallback
- [ ] `apps/web/components/__tests__/PlanTimeline.test.tsx` — coord-href + name-fallback + linkSlugs on/off + missing-slug degrade
- [ ] `apps/web/app/feed/__tests__/NightDetailSheet.test.tsx` — skeleton-while-pending
- [ ] extend `apps/web/app/my-nights/__tests__/` — upcoming/archive bucket filter
- [ ] Playwright visual-verify recipe @420px for the 6 surfaces (reuse the forced-local visual-verify recipe from prior phases)

> **The feed-RPC re-CREATE regression check (e23_feed_contract.sql) is the single most important new test:** it locks the privacy/host-hint contract so the E22/E23 re-CREATE cannot silently drop a host-hint column, re-grant anon, or destabilize the keyset.

## Security Domain

> `security_enforcement` enabled (no `false` in config). This phase touches DEFINER RPCs and RLS read paths — security is load-bearing.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `auth.uid()` re-check in `withdraw_interest` (mirrors `match_withdraw` `p_actor is distinct from auth.uid()` → P5001) |
| V3 Session Management | no | Supabase session cookie handled by existing middleware |
| V4 Access Control | yes | `queue_entries` default-deny on write (DEFINER-only); candidate-read RLS `queue_candidate_read_own`; feed RPC re-grant tail (anon revoked) |
| V5 Input Validation | yes | RPC args are uuids (Postgres-typed); zod on any new client payload |
| V6 Cryptography | no | None introduced |

### Known Threat Patterns for Next.js 15 / Supabase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Withdraw another user's interest | Elevation of Privilege | `auth.uid()` gate + `candidate_id = p_actor` predicate in the DELETE |
| Anon executes feed/detail RPC after re-CREATE | Information Disclosure | Re-emit verbatim `revoke public/anon; grant authenticated` tail; SQL test asserts anon denied |
| Venue identity leaks onto blind feed (E21) | Information Disclosure | `linkSlugs` opt-in (default off); blind sheet never sets it; PlanTimeline unit test covers it |
| Host de-anonymization via client `places` query for coords | Information Disclosure | Coords added inside the DEFINER RPC, not fetched client-side |
| Search_path injection on DEFINER RPC | Tampering | `set search_path = public` (existing convention) on the new RPC |
| Security advisor drift after DDL | — | Run Supabase security advisor after each migration (CLAUDE.md mandate) |

## Sources

### Primary (HIGH confidence — codebase-verified this session)
- `supabase/migrations/20260606120000_e15_browse_feed_host_hint.sql` — current feed RPC body, column contract, revoke/grant tail, score block (lines 53-123)
- `supabase/migrations/20260601210000_m5_get_night_detail.sql` — detail RPC stop shape + scrub logic (lines 26-90)
- `supabase/migrations/20260525120500_p0_queue_entries.sql` — queue_entries schema, RLS read policies, default-deny-write (C7)
- `supabase/migrations/20260527126800_p5_pass_expire_withdraw.sql` — `match_withdraw` auth pattern (lines 87-118)
- `supabase/migrations/20260527120100_s5_record_swipe.sql` + `20260604124000_e8_interest_dispatch.sql` — how `interested` queue rows are created
- `apps/web/components/PlanTimeline.tsx` — shared timeline, current name-search href (line 46), signature (134-156)
- `apps/web/components/itinerary/ItineraryMap.tsx` — static Mapbox URL builder, polyline encoder, lightbox, ACCENT hex (lines 17-122)
- `apps/web/app/feed/NightDetailSheet.tsx` — detail load (83-97), placeholder route viz (264-287)
- `apps/web/app/feed/NightCard.tsx` — city_name slot (line 55), distance call (53)
- `apps/web/app/feed/loading.tsx` — skeleton pattern to mirror
- `apps/web/app/matches/[lockId]/LockDetail.tsx` — vaul cancel pattern (250-279), PlanTimeline usage (244)
- `apps/web/app/places/[slug]/page.tsx` — `/create` CTAs to retire (lines 263-269, 459-465)
- `apps/web/app/my-nights/page.tsx` — lifecycleLabel + status values (48-54, 166)
- `packages/api-client/src/feed.ts` — FeedNight (4), NightDetailStop (219-232, already has lat/lng), normalizer (260+)
- `supabase/migrations/20260419193959_initial_schema.sql` — places.slug (33), places.lat/lng decimal(9,6) (37-38)
- `ls supabase/migrations/` — latest applied = `20260606130200_e19_lock_rpc_producers.sql` (timestamp ordering)

### Secondary (MEDIUM)
- `07-CONTEXT.md`, `07-UI-SPEC.md`, `CLAUDE.md` (project constraints)

### Tertiary (LOW)
- None — all claims codebase-verified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages present, patterns in active prod use.
- Architecture: HIGH — every integration point read directly from source.
- Pitfalls: HIGH — derived from documented prior-phase lessons (e15 Pitfall 2, Phase-6 ordering) and the actual RPC bodies.
- Open questions: 3 MEDIUM items (stop json key A1, LockDetail slug loader Q2, standby surface Q1) — resolvable in Wave 0 with one query + one grep each.

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (stable infra; re-verify if any feed/detail RPC is re-CREATEd by an interleaving phase)

# After5 — Date Experience Milestone: consolidated plan & decisions

**Date:** 2026-06-01
**Source:** 4 parallel research passes (M1 generation seam, M2 date-first landing, M3 customization, M4 ambient audio) + the date-generator audit (`2026-06-01-date-generator-flow-audit.md`) + M5 from that audit.
**Frame:** the product owner is building a separate **Railway generation engine**; we build to a seam and ship a light stopgap until it plugs in.

---

## Corrected facts the research surfaced (these change the plan)

1. **A `cities` table + PostGIS already exist** (`20260525120000_p0_extensions_and_cities.sql`), Kelowna seeded, with `centroid`, `default_radius_km`, `timezone`. Generation just doesn't use them — `filterPlaces` still hardcodes the Kelowna centroid. So multi-city infra is partly built.
2. **`places` has NO `city_id`** and `approval_status` is an enum `(draft|live|rejected)` — no `'auto'`. Multi-city needs `places.city_id` + a `source` marker + (recommended) an `'auto'` enum value (its own non-transactional migration).
3. **The generation pipeline extracts cleanly into a `KelownaProvider`**; the stopgap is just a **cache-warmer** (Google Places Text Search → map to `places` rows via the mappers already written in `scripts/discover-places.mjs` → reuse the entire existing template+LLM pipeline). The Railway provider is a thin HTTP adapter returning the same `Itinerary[]`.
4. **Owner UPDATE on itineraries is already allowed by RLS** (`itineraries_owner_all`) — the customization gap is purely missing RPC/UI, not permissions.
5. **The feed reads title/cover/why/vibe from the *itinerary*, not `date_instances`** — so editing a published night in place would retroactively change what swipers saw and could bleed across instances. → **fork-on-post** for published-night edits.
6. **A stray `itineraries.ambient_sound_url` already exists** but is wrong-shaped; the per-date pick belongs on `date_instances.ambient_sound_id` + a curated `ambient_sounds` library table.
7. **Blur-gate must be server-enforced** — never ship gated fields to an anon DOM. Cleanest: a new `/api/create-plan` Next route returns a teaser projection for anon (no edit to the frozen `generate-plan` contract).
8. **IP-detect is free on Vercel** via `x-vercel-ip-city` headers — prefill + always-editable (datacenter-city inaccuracy).
9. **Conflict:** `ItineraryView.tsx`/`StopCard.tsx` are touched by BOTH the M2 brand-unify and M3 editing → sequence M2 before M3; put edit affordances in a new `EditableStopCard`, not threaded props.
10. **Prod schema drift caveat:** verify `date_instances`/`itineraries`/`places` columns on prod (`ufufmcpnysvwtutpbian`) before any DDL — the feed RPC references columns not in the base migrations.

---

## The seam (the linchpin, given the Railway engine)

`DateGenerationProvider` interface at the `generate-plan` boundary; frontend→`generate-plan` contract frozen. Providers: `KelownaProvider` (current pipeline, extracted), `OnTheFlyProvider` (warm-then-reuse-pipeline, stopgap), `RailwayProvider` (HTTP adapter, later). Selection via a `feature_config` per-city map (`{"kelowna":"kelowna","_default":"onthefly","vancouver":"railway"}`) — runtime flip, no redeploy. Shared `persist.ts` so all providers write `itineraries` identically.

---

## Workstreams & recommended sequence

**Phase 1 — parallel (isolated, run in worktrees):**
- **M1** generation seam + on-the-fly stopgap (backend edge fn). Unblocks multi-city.
- **M5** `get_night_detail` RPC + wire `NightDetailSheet` (P0: swiper can finally see the date). Independent.
- **M4** ambient audio: `ambient_sounds` table + `date_instances.ambient_sound_id` + public `ambient-sounds` bucket + host picker w/ preview (`PostNightForm`) + `useAmbientDeck` Web-Audio crossfade in `SwipeDeck` (default-muted, tap-to-unmute). Independent.

**Phase 2:**
- **M2** date-first landing `/create` (Barbiecore) + server-enforced blur-gate (`/api/create-plan`) + email→PDF (server-render `PlanPDFDocument` + Resend) + publish-to-feed gating + **brand-unify** the lifted planner components. Depends on M1's frozen contract for multi-city; touches `ItineraryView`/`StopCard`.

**Phase 3:**
- **M3** customization: owner-scoped `update_itinerary_stops` RPC + edit-mode UI (reuse the `Reorder` pattern from `InterestedList`) for swap/reorder/time/add/remove + cover-photo picker + custom venue via a server Places proxy (`/api/places/search`) as an **inline stop** + host per-night authoring (override columns on `date_instances` + fork-on-post for stop edits). Sequenced after M2 (shared components).

---

## Decisions for the owner

**Defaulting these (will proceed unless told otherwise):** route `/create`; IP prefill+editable; provider selection via `feature_config`; add `'auto'` to the enum; pass `city_slug` from the client; pre-publish edits via a validating RPC; cover from stop-photos/Places photo first (no upload bucket yet); ambient reduced-motion = hard-cut (still audible); drip v1 = welcome + PDF email only; Pixabay as the ambient source.

**Genuinely the owner's calls (with my recommendation):**
1. **Dating safety — restrict published (real-world meetup) dates to curated/reviewed venues only?** Auto-scraped + custom venues are fine for solo planning + the landing, but blocked from becoming a *dating meetup* until vetted. **Recommend YES** (this is why the `'auto'` vs `'live'` distinction matters).
2. **Blur-gate aggressiveness:** hero + stop 1 visible, stops 2–3 silhouetted (type+photo, no name), `why`/map/insights locked. **Recommend this middle setting** (trust vs capture).
3. **Email the FULL plan PDF vs a teaser PDF.** **Recommend full** — it's the carrot; the conversion email does the dating push.
4. **Published-night edits: fork-on-post vs mutate canonical.** **Recommend fork** (don't retroactively change what swipers saw).
5. **Custom venue: inline stop + admin promotion queue vs auto-add to `places`.** **Recommend inline + queue** (protects the curated-supply moat/safety).
6. **Ambient when host doesn't pick: vibe-auto fallback vs silence vs require pick.** **Recommend optional pick + vibe-auto fallback.**

**Coordination note for the Railway engine:** have it return the existing `Itinerary[]` shape (`generate-plan/types.ts`) so `RailwayProvider` is a pass-through adapter, not a rewrite.

---

## Per-workstream touchpoints
See the four research threads (summarized inline above); key files: `supabase/functions/generate-plan/{index,prompt,places-filter,scoring}.ts` + new `providers/*`; `apps/web/app/plan/page.tsx` (EmailGate/LoadingView to lift); `apps/web/components/itinerary/{ItineraryView,StopCard,PlanPDFDocument}.tsx`; `apps/web/app/nights/new/PostNightForm.tsx`; `apps/web/app/feed/{SwipeDeck,NightDetailSheet}.tsx`; `packages/api-client/src/feed.ts`; migrations for `places.city_id`/`source`/`'auto'`, `cities.centroid_lat/lng`, `ambient_sounds` + `date_instances.ambient_sound_id`, `date_instances` authoring columns, `update_itinerary_stops` RPC.

# Phase 04: Discoverability — Feed Filters & Targeting (P1) - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver REQ-E10: real two-sided discoverability. Searchers filter the feed (hard filters HIDE dealbreakers, soft filters only RE-SORT), hosts see the reach of a targeted night, and matching is surfaced as a gentle per-card hint — all while keeping the feed liquid and serendipitous. The per-date targeting COLUMNS already shipped in Phase 3 (`target_genders`, `target_age_range`, `search_radius_km` on `date_instances`); Phase 4 builds the **feed-side application** (query + sort + fit), the **searcher filter state** (`profiles.feed_filters jsonb`), the **FilterSheet UI**, the **reach preview** for hosts, and the **friendly empty state**.

**In scope:** `profiles.feed_filters jsonb` (server-side, self-read/write); extend `browse_feed_for_viewer` (hard filters in WHERE, soft match-score + boost in ORDER BY, per-card `fit` flag, cursor-paginated, blind-contract-safe); new lightweight `reach_preview` RPC; the real FilterSheet (vaul); the "looking for someone like you" hint; inclusive defaults + friendly/attainable empty state; the host reach-preview nudge on the post form (the Phase-3 D-11 deferral lands here).

**Out of scope (own phases):** progressive reveal / experience-led offer screens (E15/Phase 5); chat↔profile↔night cross-links (E18/Phase 6). Targeting FIELD CREATION (the columns + post-form inputs) already shipped in Phase 3 (E11) — Phase 4 only CONSUMES them.

</domain>

<decisions>
## Implementation Decisions

These four are the product-taste calls; the **architecture is locked by the design spec** (see Canonical References) and is NOT re-decided here.

### Reach preview (host pre-post nudge — resolves Phase-3 D-11 deferral)
- **D-01:** **Passive + encouraging.** Show `~N people match this in <city>` as a quiet line under the targeting fields on the post-night form, updating live as the host adjusts targeting. If the count is low, frame it positively ("a focused crowd — widen anytime"). It MUST NEVER block, gate, or discourage posting (per the spec's governing principle: keep the feed liquid; never make a host feel their night won't land). Backed by the new `reach_preview` RPC.

### Empty feed (searcher's hard filters hide everything)
- **D-02:** **Active recovery + "post your own".** Name the most-restrictive hard filter and offer a one-tap loosen (e.g. "widen distance to 50km?"), PLUS a "post your own night" attainability nudge. Turn the dead end into two concrete recoveries rather than a passive message. Do NOT auto-relax silently (keeps the searcher in control; preserves trust that filters work).

### "Looking for someone like you" fit hint (per-card soft-boost signal)
- **D-03:** **Subtle pill, strong matches only.** A small "looks for someone like you" pill appears ONLY on cards where the date's targeting genuinely matches the searcher (driven by the `fit` flag). Not on every card. Combined with soft-sort ranking. Quiet and flattering — keeps the feed feeling curated, not algorithm-sorted; avoids making non-matching cards feel rejected.

### Filter defaults & weight (new searcher, no filters set)
- **D-04:** **Open inclusive defaults + light chips.** A brand-new searcher has NOTHING filtered (maximum liquidity, inclusive-by-default). Surface a light 3-chip quick-filter on the feed (e.g. distance / price / vibe); tapping opens the full vaul FilterSheet. Chips follow `docs/superpowers/DESIGN-SYSTEM.md` tokens (Barbiecore). Do NOT push the full sheet up front (avoids day-one over-filtering the spec warns against).

### Claude's Discretion (implementation — planner/researcher decide)
- **`target_genders = {everyone}` normalization** (Phase-3 QA finding): `post_night` writes the literal `{everyone}` (not `{}`) when the host leaves "open to everyone". The fit/boost computation AND `reach_preview` MUST treat both `{everyone}` and `{}` as "no gender restriction" — never match a literal `'everyone'` row value, or every open night drops out. Normalize at the query boundary (or fix `post_night`/`PostNightForm` to write `{}` for the open case — planner's call). See ROADMAP Phase-4 carry-forward note #1.
- Exact `feed_filters` jsonb key set, index strategy, cursor design, and the soft match-score formula — follow the spec's §5/§6 architecture; planner/researcher refine.
- FilterSheet layout, chip set selection, and copy — follow DESIGN-SYSTEM.md + the spec's UX-upgrade section.
- Sub-100ms hard-filtered query target (SC-4): indexing + cursor pagination approach is the planner's to design.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design spec (PRIMARY — read first)
- `docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md` — THE authoritative design for E10/E11. Locks: searcher-filters-only feed (a date's target never hard-hides — it's a label + interested-list curation tool + soft-boost only); hybrid strictness (HARD/HIDE: host gender, max price, max distance; SOFT/SORT: vibe, who-pays, time-of-day, host age range); the `profiles.feed_filters jsonb` shape (§38–50); `browse_feed_for_viewer` contract — hard in WHERE, soft score + boost in ORDER BY, per-card `fit` flag, cursor-paginated, blind-contract-safe (§55); the new `reach_preview(target…, city, radius)` RPC (§56); the four in-scope experience upgrades (§17); API-first/mobile-fast/server-side-filter-state architecture (§6); secure-by-default (`feed_filters` self-read/self-write only, security advisor after DDL, §64).

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — REQ-E10 (lines 103–109): the canonical requirement text.
- `.planning/ROADMAP.md` §"Phase 4" — the 4 success criteria + the **Carry-forward notes** block (target_genders `{everyone}`; post-night "why" mutates source plan).
- `docs/superpowers/reports/2026-06-03-MVP-AUDIT.md` §E (E10) — audit origin of the requirement.

### Prior-phase decisions that constrain this phase
- `.planning/phases/03-marketplace-completeness-p1/03-CONTEXT.md` — D-03b (targeting columns are per-DATE on `date_instances`, net-new, now on prod), D-10 (creator-field homes: `pay_setting`/`why_note`/`vibe_tags`/`cover_image_url` on `itineraries`; targeting cols on `date_instances`), D-11 (reach preview deferred to Phase 4 — lands here).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/app/feed/FilterSheet.tsx` — a FilterSheet stub/component already exists; extend rather than build new.
- `apps/web/app/feed/page.tsx`, `SwipeDeck.tsx`, `NightCard.tsx`, `NightDetailSheet.tsx` — the feed surfaces that consume the RPC output + render cards (the `fit` pill lands on `NightCard`).
- `browse_feed_for_viewer` RPC — current signature `(uuid, geography, timestamptz, uuid, int)` in `supabase/migrations/20260602120400_m4_browse_feed_ambient.sql`; this is the function to extend (add filter application + fit flag). Already blind-safe + cursor-shaped.
- `date_instances` targeting columns (`target_genders text[]`, `target_age_range int4range`, `search_radius_km numeric`) — shipped Phase 3, applied to prod; the inputs the feed query now reads.
- `apps/web/lib/after5/photos.ts` storage pattern, `vaul` bottom sheets, `sonner` toasts, `docs/superpowers/DESIGN-SYSTEM.md` chips/tokens — for the FilterSheet + chips.
- `apps/web/components/DatesFilter.tsx` — a planner-surface filter (warm-token vertical); reference for chip patterns, NOT a direct reuse (different brand tier).

### Established Patterns
- **Server-side filter persistence:** Phase 1 (E4) established the preferences server-side persistence pattern; mirror it for `profiles.feed_filters` (self-read/self-write RLS, no `USING(true)`).
- **Blind-contract:** feed payloads stay lean + blind-safe (no `itinerary_id`/`creator_id`/`venue_id`, scrubbed `reservation_url`, hour-truncated time). The extended RPC MUST preserve this.
- **Secure-by-default DDL:** column-level grants, run Supabase security advisor after every migration (per CLAUDE.md + secure-by-default rule).
- **Gated prod-apply:** new migrations land LOCAL-green first, then batched gated prod-apply (consistent with Phases 1–3).

### Integration Points
- `browse_feed_for_viewer` ← reads `profiles.feed_filters` (or accepts as param) + `date_instances` targeting cols → returns rows + `fit`.
- New `reach_preview` RPC ← called from the post-night form (`apps/web/app/nights/new/PostNightForm.tsx`) for D-01.
- FilterSheet ← writes `profiles.feed_filters`; feed page re-queries on change.

</code_context>

<specifics>
## Specific Ideas

- Governing principle (from the spec, drives every decision): **"filters remove dealbreakers, then get out of the way."** Over-filtering empties feeds and kills two-sided marketplaces — bias every call toward keeping the feed liquid and serendipitous.
- The four chosen experience upgrades (all in scope): soft-boost + "looking for someone like you" (D-03), reach preview for hosts (D-01), inclusive defaults + friendly empty state (D-02/D-04), light filters + attainability + "post again" (D-02/D-04).
- Tone for all copy: lowercase, dry, Barbiecore, stop-slop (no em-dashes — a live-QA finding this milestone). Reach-preview and empty-state copy must never read as discouraging.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (The post-night "why"-edit-mutates-source-plan coupling, ROADMAP carry-forward note #2, is an E11/data-flow concern recorded for a conscious decision when re-posting/re-targeting is built; it is not Phase-4 feed work and is left as a flagged note, not scoped here.)

</deferred>

---

*Phase: 04-discoverability-feed-filters-targeting-p1*
*Context gathered: 2026-06-04*

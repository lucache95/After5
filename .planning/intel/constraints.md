# Constraints Intel

> Synthesized 2026-06-03 by gsd-doc-synthesizer.
> Constraints are drawn from the two SPEC-typed docs (MVP-AUDIT,
> date-settings-and-filters-design) plus the project-level constraints in
> PROJECT.md. Each carries a type: api-contract | schema | nfr | protocol.
> The date-settings SPEC backs E10 (filters) + E11 (creator controls); its
> RPC signatures are the api-contracts those requirements must satisfy.

---

## CON-data-model-targeting (schema)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §1
- type: schema
- content: New columns on `date_instances`: `target_genders text[]` (default all genders, "open to everyone"); `target_age_range int4range` (default ~`[18,100)`); `search_radius_km numeric` (default = city `default_radius_km`). Already per-date on the itinerary fork: `pay_setting` (`i_pay`/`they_pay`/`split`, needs setter UI), `total_cost_pp` (computed from stops), vibe tags, stops, `why_note` (needs setter). Profile `gender`/`gender_preferences`/`age_pref` become PRE-FILL DEFAULTS only — no longer the matching gate.

## CON-feed-filters-jsonb (schema)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §1
- type: schema
- content: New `profiles.feed_filters jsonb`, server-side, syncs web+native, sticky across sessions. Shape: `max_price` (hard), `max_distance_km` (hard, needs origin), `host_genders` (hard), `host_age_range` (soft), `vibes` (soft), `who_pays` (soft), `time_buckets` (soft, coarse not exact time). RLS: self-read/self-write only.

## CON-post-night-signature (api-contract)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §1
- type: api-contract
- content: `post_night` gains additive params `p_target_genders text[]`, `p_target_age_range int4range`, `p_search_radius_km numeric`, `p_pay_setting`, plus existing `p_starts_at`, `p_ambient_sound_id`. Backward-compatible (defaults); existing callers unaffected. REVOKE `anon` EXECUTE on the new overload.

## CON-update-itinerary-stops-setters (api-contract)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §1
- type: api-contract
- content: `update_itinerary_stops` adds `p_pay_setting` and `p_why_note` setters.

## CON-browse-feed-contract (api-contract)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §1/§3/§6
- type: api-contract
- content: `browse_feed_for_viewer` accepts the viewer's `feed_filters` (or reads from profile), applies HARD filters in `WHERE` (host gender / max price / max distance), computes a SOFT match-score + soft-boost in `ORDER BY` (vibe / who-pays / time), returns CURSOR-PAGINATED (keyset) lean blind-safe rows + a per-card `fit` flag. MUST stay blind-contract-safe: no `itinerary_id`/`creator_id`/`venue_id`, scrubbed `reservation_url`, hour-truncated time. Soft-sort score computed in SQL, not the client.

## CON-reach-preview-rpc (api-contract)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §1/§2
- type: api-contract
- content: New `reach_preview(target..., city, radius)` RPC returning an approximate count of profiles matching a prospective date's targeting (for the host's pre-post nudge: "~N people match this in <city>").

## CON-per-stop-regenerate-edge (api-contract)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §2A/§7
- type: api-contract
- content: Additive `generate-plan` edge capability to rebuild ONE slot (vs. the whole night) — the per-stop regenerate/swap "magic". GATED edge change.

## CON-blind-contract (protocol)
- source: MVP-AUDIT Section A (Date detail); date-settings SPEC §1
- type: protocol
- content: The blind contract MUST hold end-to-end: the feed/detail RPCs scrub identity + `reservation_url`, are authenticated-only, exclude own/unapproved nights, hour-truncate time, and omit `itinerary_id`/`creator_id`/`venue_id`/`place_slug`. Progressive reveal (E15) layers limited/partial/full tiers ON TOP of this contract without breaking it. NOTE: B#33 flags there is no column-level PII projection at the reveal gate today (relies on the UI voluntarily selecting Tier-3 columns) — E15 should tighten this.

## CON-indexes-sub-100ms (nfr)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §1/§6
- type: nfr
- content: Hard-filtered feed queries must stay sub-100ms via: PostGIS `geography` + GIST index for distance, btree on price + time/`starts_at`, GIN on `target_genders`/vibe arrays. Cursor (keyset) pagination, not offset — cheap and stable under inserts. CDN-sized image variants so phones do not pull full-res.

## CON-api-first-mobile (nfr)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §6 (load-bearing)
- type: nfr
- content: All business-critical logic in Postgres RPC + edge functions — NOTHING business-critical in React server components. Lean blind-safe payloads (`browse_feed_for_viewer` returns only card fields; full detail via `get_night_detail` on open; no over-fetch). Server-side filter state (`feed_filters` jsonb on profile); no localStorage divergence. The eventual native app reuses the same backend with no rework.

## CON-distance-origin (protocol)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §5
- type: protocol
- content: Distance filtering needs a lat/lng origin. v1 = searcher's CITY CENTROID (coarse, no permission prompt, zero friction). Later = optional browser/native geolocation behind a permission prompt (fast-follow). Spec assumes city-centroid v1.

## CON-secure-by-default-rls (protocol)
- source: PROJECT.md Constraints; date-settings SPEC §1; user memory (secure-by-default DB)
- type: protocol
- content: Secure-by-default RLS — reusable patterns, NEVER `USING(true)` on update/delete, column-level grants so identity-gating holds, run the Supabase security advisor after EVERY DDL, review live migrations before prod apply. `feed_filters` is self-read/self-write only. New `post_night` overload revokes `anon` EXECUTE.

## CON-gated-prod-apply (protocol)
- source: PROJECT.md Constraints/Key Decisions; date-settings SPEC §7; user memory (schema rigor)
- type: protocol
- content: Schema/data-integrity rigor — verify against reality not guesses; minimal faithful migrations; gated prod-apply (local-green before batched prod apply); watch local-vs-prod drift. Prod ref `ufufmcpnysvwtutpbian`. SOME audit findings ran against the LOCAL stack — verify prod application state before building. Specifically: `create_blank_itinerary` (20260603120100) + generate-plan edge ARE applied on prod (re-check, do not rebuild); `reject_candidate`/`update_night`/`cancel_night` are absent on prod too (real build work).

## CON-tech-stack (nfr)
- source: PROJECT.md Constraints
- type: nfr
- content: Next.js 15.1 (App Router) / React 19 / TypeScript 5.6 / pnpm + Turbo monorepo; Supabase Cloud (Postgres 17, auth, edge functions, storage, realtime, RLS); Vercel hosting + Vercel Cron. Node ≥ 22.

## CON-integrations (protocol)
- source: PROJECT.md Constraints
- type: protocol
- content: Supabase (DB/auth/edge/RLS), Resend (email — RESEND key set in Vercel server runtime, BLANK on edge/local; drives E14 offer-delivery), Twilio (SMS), Persona (ID verification — `PERSONA_WEBHOOK_SECRET` state to confirm), Anthropic (AI planner). E14 requires RESEND from a server runtime, not edge.

## CON-design-system-and-visual-verify (protocol)
- source: PROJECT.md Context; user memory (crafted mobile-first design, visual-verify)
- type: protocol
- content: All UI follows `docs/superpowers/DESIGN-SYSTEM.md` (Barbiecore, three-tier color, gesture motion, real display font; framer-motion/vaul/sonner in use). The filter sheet is a `vaul` bottom-sheet. EVERY UI change is visually verified — render → screenshot (Playwright) → critique against a visual rubric — before it's "done"; compile-clean ≠ good UX. User-facing copy gets the stop-slop treatment.

## CON-testing-matrix (nfr)
- source: docs/superpowers/specs/2026-06-03-date-settings-and-filters-design.md §8
- type: nfr
- content: DB: pgTAP/SQL tests for RLS (self-only `feed_filters`), `post_night`/`browse_feed_for_viewer` contract, soft-sort ordering, `reach_preview` counts, anon-EXECUTE revoked. Web: vitest for filter-sheet state + card label/hint rendering. E2E (Chromium/Playwright): host posts a targeted date → matching searcher sees it boosted with the hint → non-matching hard filter hides it → "loosen a filter" empty state recovers → anon `/create` radius/who-pays render.

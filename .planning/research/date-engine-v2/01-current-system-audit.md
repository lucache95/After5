# Current Date Generator — Audit

> Deep audit of the existing generate-plan pipeline. Goal: catalog every limitation so we can design v2.

## Executive summary

After5 v1 is a **Kelowna-only, hand-curated** date planner. It generates 3 itineraries via a hybrid pipeline: deterministic SQL filter → template scoring → stochastic slot-fill → LLM writing pass.

**The good:** Hallucination is *structurally impossible* — the LLM never picks places, only writes prose around fixed place IDs.

**The bad:**
- **Single-city hardcoded** — lat/lng, drive clusters, templates, seed data, LLM prompt, cover image prompt all assume Kelowna. Expansion is a 4–6 week project, not a parameter flip.
- **~170 places, all manual** — seeded via SQL migration, no dynamic discovery.
- **~80% of places have NULL photo_url** — biggest credibility gap; frontend falls back to type-icons.
- **Hours often null** — treated as "always open", causing occasional weird recommendations.
- **No real-time vetting** — no check for closed businesses, no reservation availability.
- **Feedback loop built but not consumed** — tables (feedback, pairings, plan_feedback) exist, quality_score is computed, but generate-plan doesn't read from them yet.
- **Schema drift** — generate-plan writes fields (slug, season, intent, modifier_id, claim_email, generation_log) that aren't in initial migration; reality lives in auto-generated database.ts.

## Pipeline (generate-plan/index.ts)

1. **Validate** (Zod) — inputs: occasion, duration, budget, vibe[], must_includes[], drive_tolerance, radius, effort, pronouns, intent, time_of_day, note, when, claim_email
2. **Filter places** (places-filter.ts) — SQL: is_active + approval_status=live + at_home + price_tier + seasonality; then client-side Haversine from Kelowna centroid (49.888, -119.496); then must-include coverage check
3. **Load + score templates** (templates.ts) — SQL by occasion; score = vibe_overlap × 2 + duration_fit (up to 3); top 3
4. **Slot-fill per template** (scoring.ts) — score places against each slot (quality + feedback + vibe + pairing bonuses; penalties for reuse, type-clustering, cluster-hopping, tonight friction, tight-budget overprice, try_something_new bias); weighted-random pick from top 5
5. **Retry** — 3 strict passes, 1 relaxed (skip hours) if needed
6. **Adjacency fix** — swap back-to-back food/drink/sweet stops
7. **Pick modifiers** — "wow-factor" enhancement per itinerary
8. **LLM writing pass** — Claude Sonnet 4.6, temp 0.7, max 4096 tokens. Writes title, hook, why_it_works, per-stop what_to_do. Hard rule: never invent places, never use "perfect/amazing/unforgettable"
9. **Photo scrub** — null out photo_url if season/time-of-day mismatch
10. **Quality score** — cost_realism (0.4) + type_diversity (0.35) + has_wow (0.15) + feels_cheap (0.1)
11. **Persist** — insert itineraries row with full generation_log audit; update slug after insert
12. **Return** — 3 itineraries + generated_at

## Data model

- **places** — master venue data (~170 rows). Fields: name, slug, address, neighborhood, drive_cluster, type (enum), lat/lng, vibe_tags[], pairing_tags[], effort, energy, time_of_day[], weather_dependent, seasonality[], typical_duration_min, price_tier, typical_per_person, opens/closes, closed_days[], reservation_required, reservation_url, quality_score, feedback_score, photo_url, local_insight, notes, is_active. Plus post-launch additions: at_home, approval_status, friction_score, perceived_value, photo_time_of_day, photo_season, photo_has_snow.
- **templates** — text id PK; slots jsonb (types[], duration_min, time_of_day?, effort?, price_tier?, prefers_pairing_tags?); suitable_for[], vibe[], selection_weight
- **itineraries** — uuid PK; template_id FK; stops jsonb (fully hydrated, no FKs); title/hook/why_it_works from LLM; inputs jsonb; is_public default true; generation_log jsonb audit; claim_email for anon→user attachment
- **Secondary** — feedback, pairings, plan_feedback, plan_votes, vote_sessions, modifiers, place_reviews, itinerary_reviews, place_vibe_images, user_preferences, profiles, saved_plans, subscribers

## Personalization today

**Used in scoring/filtering:**
- budget_per_person → price_tier filter + exceeds_price bonus if tight
- vibe → +1.5/place/match, +2/template/match
- when=tonight → friction_score bonus/penalty
- intent=try_something_new → +2 to low-feedback places
- effort, time_of_day, reservation_required → hard filters

**Used only as LLM tone hints:**
- pronouns, intent enum, free-text note (LLM told note is "single most important context")

**Stored but NOT consumed:**
- user_preferences (vibe_weights, type_weights, cluster_weights)
- pairings analytics
- feedback history

## Kelowna lock-in (exact hardcodes)

1. `KELOWNA_LAT = 49.888`, `KELOWNA_LNG = -119.496` (places-filter.ts:74-75)
2. Drive clusters enum: downtown, west_kelowna, lower_mission, south_east_kelowna, pandosy, glenmore, peachland, rutland, multiple
3. Distance blurbs in UI ("Downtown + just outside the core", "Reaches Vernon", "Full Okanagan")
4. LLM system prompt: "Kelowna locals", "lake light", "bridge", "Okanagan specificity"
5. Cover image FLUX prompt: forced "Kelowna British Columbia"
6. Templates assume Kelowna geography (lake views, winery-heavy)
7. Seed SQL: every row is in Kelowna
8. No `city_id` column anywhere

## Critical quality issues (prioritized)

1. **Photo gap** (~80% NULL) — directly hurts credibility, social sharing, intent to execute
2. **Kelowna hardcoding** — blocks any multi-city growth
3. **Stale hours data** — many NULL, treated as always-open
4. **Feedback loop unwired** — all users see identical scoring as user #1
5. **No reservation availability** — reservation_url exists but no seat-check
6. **Schema drift** — migrations don't match production; risky for new envs
7. **Template scoring thin** — only vibe + duration; ignores pool coverage, seasonal fit, feedback history
8. **LLM fallback basic** — placeholder copy if Claude fails

## Key invariant to preserve in v2

> "The LLM never picks places. Place IDs are fixed before the LLM is called. This makes hallucination structurally impossible."

Any v2 must keep this property. The LLM's job is *voice*, not *selection*.

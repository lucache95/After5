# After5 — Date Generator Flow Audit (product + technical)

**Date:** 2026-06-01
**Scope:** How a date plan is generated, what the user experiences, what is/isn't customizable, the vision-vs-reality gap, and an assessment of the proposed "date-first landing page" concept.
**Method:** 4 parallel code/doc audits (generation engine, UX journey, customization/editing, product vision). All claims are grounded in the code/docs cited.

---

## TL;DR

1. **Generation is genuinely strong and the real moat.** `generate-plan` (Supabase edge fn) uses a **deterministic place-selection + LLM-writing-pass** architecture: the LLM *never picks venues*, so hallucination is structurally impossible. It returns **3 itineraries** built from a curated `places` table, with anti-slop prompting and real variety machinery. Model: `claude-sonnet-4-6`.
2. **"Create with AI, then customize any aspect" is ~90% false today.** The product is **generate → pick 1 of 3 → use as-is**. There is **no in-place editing** of a generated plan anywhere — no swap-a-venue, no reorder, no edit-time/title/note, no add/remove stop. "Customizing" = changing wizard inputs and regenerating 3 brand-new plans.
3. **The planner and the dating-host flow are two disconnected worlds, in two different design systems.** The legacy planner (`/plan`) is the rich AI experience but is **old-brand (terracotta, Inter, sentence-case, desktop-width)**. The dating host flow (`/nights/new`) is **Barbiecore (hot-pink, Caprasimo, lowercase, phone-width)** but does **zero generation** — it only re-attaches an itinerary you already made in `/plan`.
4. **The single biggest product gap:** the swiper **cannot actually see the date** they're swiping on (feed shows only a blind summary; the rich itinerary never reaches the feed). This contradicts the core "swipe on the night, not the person" promise.
5. **The generator is single-city (Kelowna only).** Hardcoded centroid, ~170 curated places, no live Google Places at runtime. Any "enter your city / auto-detect city" feature collides with this directly.

---

## 1. How we currently generate the date plan (technical)

**Architecture (the moat):** `supabase/functions/generate-plan/index.ts` — *"the LLM never picks places. Place IDs are fixed before the LLM is called. This makes hallucination structurally impossible."* The pipeline:

1. Zod-validate inputs → service-role client → rate-limit (10/hr anon by IP, 20/hr authed).
2. `filterPlaces()` — deterministic query of the curated `places` table (active, live, price tier, seasonality, in-memory haversine radius from the **Kelowna centroid 49.888,-119.496** — PostGIS is off).
3. Select templates, apply taste logic (negative-space penalties, recency boost, editorial packs), build itineraries from templates, inject "delighters", fix adjacency.
4. **LLM writing pass** (`prompt.ts`): `claude-sonnet-4-6`, `max_tokens 4096`, `temp 0.7`, system prompt cached. The LLM only writes **copy** (title ≤8 words, hook ≤12, why-it-works ≤3 sentences, per-stop `what_to_do`) over fixed real places. Strong anti-slop rules (banned words, no emoji, Okanagan specificity). Plain JSON-in-text (no tool-use/JSON mode) — fences stripped manually.
5. Photo scrub → inline quality score → near-twin de-dup → insert 3 rows into `itineraries` → return.

**Inputs:** occasion, duration, budget/pp, vibe (1-3), must-includes, radius, location (out/home), effort, start time, pronouns, intent, time-of-day, free-text `note` (weighted as "the single most important context"), `when` (tonight/future).

**Venues:** curated Postgres `places` table (~170, Kelowna). Google Places API is used **only offline** in ingestion scripts (`scripts/discover-places.mjs` etc.) — never at runtime.

**Persistence:** `itineraries` table; `stops` is a **jsonb array** (place_id, name, slug, type, start_time, duration, cost, drive_to_next, photo, address, neighborhood, lat/lng, local_insight, reservation_url + LLM `what_to_do`). Rich `generation_log` jsonb audit per row. `is_public=true` by default (SEO).

**`@after5/date-quality` package:** a well-built 19-gate + LLM-judge quality framework — **but it is orphaned**: it runs only offline/CI, is **never wired into the live generation path**, and its gates depend on a fact-bank that doesn't exist on the prod `places` table. So **no request-time quality gating** — a banned-word/ungrounded plan can ship.

### Technical risks & gaps
- **date-quality eval is orphaned** (offline only); no runtime gating.
- **No timeout/abort** on the Anthropic call; retry can double exposure.
- **Single-city hardcoding** (Kelowna centroid, JUDGE_CITY); PostGIS disabled.
- **No structured output mode** — brittle JSON parse degrades to generic fallback copy.
- **Unverified JWT** decode for user_id (mitigated by RLS).
- **Rate-limiter JS fallback is non-atomic** under concurrency.
- **DB-insert failures are swallowed** — user sees plans that were never saved (no slug/SEO page).

---

## 2. What the user experiences (UX journey)

**Two entry worlds:**
- **Legacy planner** `/plan` (landing "or just plan a night" + planner-wedge section).
- **Dating host** `/nights/new` (home "post a night", reached only when `dating_enabled && verified`).

**Legacy `/plan` (the rich AI experience — but old-brand):** a 5-step wizard (occasion+context → time/duration → vibe → budget/effort/where/radius → must-includes+note), plus "surprise me" and theme presets. The **generate moment is the best screen in the app** — a fanned polaroid stack + a 9-step narrated "thinking" feed calibrated to ~15s ("Pulling 200+ vetted Kelowna spots"… "Writing why each plan works for you"), final step holds at ∞ so it never finishes early. Then (for anon users) a **3-step EmailGate** (email → city → first name → magic link) **sits between generation and seeing results**, then `ResultsView`: personalized header, `ChooserCards` ("most ambitious / best value / quickest"), full `ItineraryView` (gallery hero, story, modifier wow-card, map, stop timeline, sticky price rail), and a feedback widget. Genuinely well-crafted — but it's a single **1865-line** component and almost entirely **old brand** (terracotta/Inter/sentence-case/1200px).

**Dating host `/nights/new` (Barbiecore — but no generation):** a short form: pick an existing itinerary (radiogroup) + a `datetime-local`, hit "post it" → toast → `/home`. **No generation, no anticipation, no reveal, no authoring** (title/note/photo all inherited verbatim). A brand-new verified user who taps "post a night" hits an **empty state and is bounced into the old-brand `/plan` flow** — crossing a hard brand boundary mid-journey.

**Brand whiplash** is the dominant UX problem: the thing most worth showing off (generation) lives entirely in the un-migrated old brand; the on-brand surface (host) does the least.

---

## 3. Customize "any aspect"? — the blunt reality

**You CAN:**
- Pre-generation: control all wizard inputs + themes + surprise-me; regenerate to get 3 new plans.
- Post-generation: pick 1 of 3; save/unsave (`saved_plans` is a join row, not an editable copy); share / PDF / calendar / maps-export; or discard and fully regenerate.

**You CANNOT (none of these exist):**
- Swap a venue, regenerate a single stop, change a stop's time/duration, reorder stops, add/remove a stop, edit the title/hook/why-it-works, change the modifier, or change budget without a full regenerate.
- Host-side: edit anything about a posted night except its start time (no per-night title, note-to-candidates, photo, or stop edits — `post_night` attaches the itinerary verbatim).

**Data model:** `itineraries.stops` is effectively **insert-only**. An owner *could* UPDATE the row (RLS `itineraries_owner_all`), but **no RPC/route/UI ever patches plan content** — the only updates touch ownership/attribution columns. Closing the gap needs new update RPCs + edit UI in `ItineraryView`/`StopCard` + a per-night editable copy for hosts.

**Note:** the documented vision (generator deep-dive §14.2) deliberately deferred per-stop editing to "v2.1 if users ask" and scoped v1 to "regenerate all 3". So the *absence of editing is on-plan, not a regression* — but it means the "customize any aspect" mental model is not what's built or even currently planned.

---

## 4. Vision vs reality (from the docs)

- **Vision is sharp and the moat is real.** Pitch: *"The AI plans the date. You pick who to share it with… 3 custom date plans in 12 seconds… hallucination-proof by design."* Core-loop spec Pillar 7: *"The planner is the wedge."* Pillar 3: *"AI sets the floor; the human sets the ceiling."* The hallucination-proof architecture is genuinely shipped.
- **Biggest divergence:** the swiper can't see the date. The feed card + the new `NightDetailSheet` show only the **blind summary** (cover, title, why-note, ≤4 vibe tags, hour-bucket, neighborhood, distance) — *no stops, no venues, no cost, no itinerary*. The detail sheet is blocked on an unbuilt `get_night_detail` RPC. The rich `ItineraryView` exists but never reaches the feed. **"Swipe on the night" is not yet deliverable.**
- **Generator is thinner than spec.** The deep-dive's "pre-launch must-haves" (Bayesian smoothing, plan-level MMR diversity, archetype arcs, NER fact-check) are spec-only; the live engine is "deterministic select + LLM copy"; the eval harness (R4) is unbuilt.
- **Personalization/"courtship" surface missing:** no profile-edit UI for dating fields (partially addressed since by FW2); `instagram_handle` written by nothing (also addressed in FW2).
- **The loop has never run in prod by a real human** (per CURRENT-PROD-REALITY at audit time; note: R2 loop has since been proven on prod — see project memory).

---

## 5. Proposed "date-first landing page" concept (new direction)

**The idea (as briefed):** a separate landing page focused on the *date-planning* side. A visitor quickly walks through creating a date (enter city / or IP-autodetect), sees a generated plan, and — if not signed in — gets a partial reveal with **blurred premium details** + a fast **"email me the plan as a PDF"** lead-capture (the email then does conversion work toward the dating app). Every created date offers **"publish to the dating feed"** (gated: can't publish without a profile).

**This is strategically right** — it's the planner-as-wedge thesis made concrete: lead with the single-player magic, capture the email, convert to the dating loop. And ~70% of the plumbing already exists.

### What already exists and is reusable
- The whole **generate-plan** engine + 3-plan output + `ItineraryView`.
- An **EmailGate** (email → city → first-name → magic-link) already sits in the planner — exactly the capture mechanic, just needs reframing as the "email me the PDF" moment.
- **PDF export** (`components/itinerary/PlanPDFDocument.tsx`) already exists.
- The **`post_night` seam** already turns an itinerary into a published dating night.
- The polaroid-stack **generate-moment** animation is built.

### What's genuinely new to build
1. **A dedicated, Barbiecore date-first landing route** (e.g. `/tonight` or `/create`) — on-brand, mobile-first, distinct from the dating landing.
2. **Blur-gate reveal**: show the plan's shape (hero, first stop, vibe) but blur stops 2-3 / venue names / the "why" / map until sign-up or email. (New UI pattern; the data already exists client-side, so blurring must be enforced server-side or via a deliberately partial payload to avoid a trivial DOM bypass.)
3. **"Email me the PDF" as the primary anon CTA** + a **conversion email** (Resend) that pushes the dating app — partly exists (welcome email), needs a dedicated drip.
4. **"Publish to the dating feed" affordance on the result** — calls `post_night`, gated behind `dating_enabled && verified` (prompt to create a profile if not).
5. **City handling** — see the hard decision below.

### The hard constraint: the generator is Kelowna-only
"Enter your city / auto-detect by IP" implies multi-city, but generation only works for Kelowna (~170 curated places, hardcoded centroid). Three honest options:
- **(A) Kelowna-only beta, city as waitlist signal.** Auto-detect/ask city; if not Kelowna, still capture the email + show a teaser/sample plan and "we're coming to {city} — you're on the list." Lowest effort, honest, feeds the city-density strategy. **Recommended for now.**
- **(B) Fake-it generic plans for other cities.** Risky — breaks the hallucination-proof moat (no curated venues elsewhere); would generate ungrounded plans. **Not recommended.**
- **(C) Invest in multi-city ingestion** (run the offline Google Places pipeline per city + curation). The real long-term unlock, but a substantial project and gated on curation quality.

---

## 6. Recommended sequencing (if we proceed)

1. **Decide the city strategy** (A/B/C above) — this gates everything.
2. **Brand-unify the generation experience** — migrate `/plan` (or a new `/create`) to Barbiecore; this is the prerequisite for any new landing that shows off generation.
3. **Build the date-first landing** with the blur-gate + email-PDF capture (reuse EmailGate + PDF + generate-plan).
4. **Add "publish to feed" on the result** (reuse `post_night`, gate on profile).
5. **Close the swiper-can't-see-the-date gap** (`get_night_detail` RPC) — independent but essential to the whole "swipe on the night" promise the landing will advertise.
6. (Later) per-stop customization + wire the date-quality eval into runtime.

---

## Appendix — key files & docs
- Engine: `supabase/functions/generate-plan/{index,prompt,places-filter,scoring,templates,editorial-packs,types}.ts`
- Planner UX: `apps/web/app/plan/page.tsx` (1865 lines); `apps/web/components/itinerary/{ItineraryView,StopCard,ChooserCards,ModifierCard,SavePlanButton,PlanPDFDocument}.tsx`
- Host: `apps/web/app/nights/new/{page.tsx,PostNightForm.tsx}`; `packages/api-client/src/feed.ts` (`postNight`, `FeedNight`)
- Feed/blind: `apps/web/app/feed/{NightCard,SwipeDeck,NightDetailSheet}.tsx`
- Quality (orphaned): `packages/date-quality/src/{index,gates,judge,score,types}.ts`
- Docs: `.planning/pitch/2026-04-23-investor-pitch-deck.md`; `docs/superpowers/specs/2026-04-23-date-plan-generator-deep-dive.md`; `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md`; `docs/superpowers/DESIGN-SYSTEM.md`; `docs/after5-current-implementation-plan.md`; `docs/superpowers/reports/2026-06-01-feature-gap-audit.md`

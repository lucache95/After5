# The Kelowna Outing Planner — Founder Plan

> Working name. Final naming candidates in Part 12.
> Built: 2026-04-19 · Founder: Lucas Senechal · Launch city: Kelowna, BC

---

## Part 1 — Deep Competitive Research

### Category A: AI Travel Planners (Wonderplan, iPlan.ai, Trip Planner AI, GuideGeek, Vacay, Mindtrip, Layla, Roam Around)

**What they do well**
- Convert vague intent into a structured multi-day plan in under a minute.
- Decent at major international destinations where Wikipedia + TripAdvisor are dense.
- Wonderplan does live budget tracking as you build.
- Mindtrip / Layla integrate booking flows.

**Where they fail (verified from reviews)**
- **Wonderplan**: "underwhelmed once it generated an itinerary… unbalanced and generic… site descriptions didn't match the headers."
- **iPlan.ai**: customer service ghosted a paying user for 3 weeks; UI bugs (X button does nothing, scroll loses position); "doesn't seem like it accurately recommends based on your selections — gave the same itinerary when adjusting selections."
- **All of them**: hallucinate places. Phantom Eiffel Tower in Beijing. Imagined canyon in Peru. "Hidden gems" that turned out to be private residences. Couples stranded waiting for ropeways that haven't run in years.
- Default to top-10 tourist suggestions (Haleakala, Wailea Beach for Maui — what every blog already says).
- No live calendar awareness — recommend places that are closed, seasonal, or booked out.
- Travel time estimates routinely wrong; itineraries chain stops with absurd drive segments.

**The deepest fault**: they're built for the *trip* (multi-day, vacation, unfamiliar city). They are useless for the use case I care about: a Wednesday night date in your own city.

### Category B: Traditional Itinerary Apps (Wanderlog, TripIt, Roadtrippers)

**What they do well**
- Wanderlog is the standard for collaborative trip planning, map view, expense tracking.
- TripIt parses confirmation emails into a single trip view.
- Roadtrippers is good for finding stops along a known route.

**Where they fail**
- Wanderlog: "doesn't help shape ideas — start from a blank map and manually add every place." Slow at 20+ places. Gates PDF export and budget tracking behind $40/yr Pro.
- Roadtrippers: paywalled features, road-trip-only, only 4 countries.
- All three are *organizers*, not *deciders*. The user still has to know what they want.

### Category C: Big-Tech AI Planning (Expedia, Booking, Kayak, Agoda, Canva)

**What they do well**: distribution. Plugged into existing booking funnels.

**Where they fail**: every output is a thinly-veiled funnel into their own inventory. Agoda recommends Agoda hotels. Expedia recommends Expedia properties. Trust is low. They can't recommend your friend's winery or that one bakery on Bernard.

### Category D: Date-Specific Apps (DateAI, SoulPlan, DUO, 4Lovebirds, Lovewick, Couply)

**What they do well**
- DUO has expert-curated date ideas, swipeable.
- Lovewick has 750+ crowdsourced romantic ideas.
- AI Date Night / 4Lovebirds generate ideas via LLM.

**Where they fail (this is critical because it's the closest category)**
- **They generate IDEAS, not PLANS.** "Go bowling together" is not a plan. A plan is "6:30 dinner at X, 8:00 walk along Y, 9:30 dessert at Z, here's the route."
- Generic. Not city-specific. "Have a picnic" works in San Diego, San Francisco, and Saskatoon — which means it's useless everywhere.
- No logistics: no timing, no driving order, no cost estimate.
- Most are subscription-walled before you've experienced quality.

### Category E: Local Discovery (Yelp, Google Maps, Atlas Obscura, Infatuation, Resy, TimeOut, Eater)

**What they do well**: deep databases of individual places with reviews.

**Where they fail**: they recommend *one place at a time*. Yelp tells you "this restaurant is 4.5 stars." It does not tell you "here's a 4-hour evening that goes restaurant → walk → dessert and feels like a date." That synthesis is the missing layer.

### Category F: General LLMs (ChatGPT, Claude, Gemini, Perplexity)

**What they do well**: ~14% of travelers already use ChatGPT to plan. Free, conversational, flexible.

**Where they fail**
- Hallucinate Kelowna places half the time.
- No memory across sessions.
- No structured output you can act on.
- Require good prompting — most people don't know how.
- No feedback loop, no personalization.
- Quality is wildly inconsistent.

### The Single Biggest Gap

**Nobody is building a "great local night planner."** The entire AI planning industry is pointed at multi-day vacations. The date-app industry generates ideas, not itineraries. Local discovery apps recommend places, not flows. And generic LLMs hallucinate.

There is a clean, unclaimed wedge: **end-to-end local outings, 2–6 hours, with logistics, taste, and pairing built in, for the city you actually live in.**

### Why someone would choose this app over the alternatives
- Faster than ChatGPT (no prompting required).
- More specific than DateAI (real Kelowna places, not generic ideas).
- More opinionated than Wanderlog (no blank map; the plan IS the product).
- More trustworthy than Expedia (not selling inventory).
- More logistically sane than Wonderplan (drive flow + timing baked in).

### What will make this app 10x better
1. **Real Kelowna places, hand-vetted.** Not scraped Yelp data. Curated.
2. **Pairing intelligence.** Knowing that Knox Mountain at 6:30 → Frind at 8:00 is great, but Knox at 6:30 → Mission Hill at 8:00 is a 30-minute drive in the wrong direction.
3. **Quality bar.** Every itinerary feels like a local with taste planned it.
4. **Feedback loop that compounds.** Each user makes the next user's plan better.
5. **Output that feels finished.** Title, story, timeline, cost, drive flow, "why this works" — done.

### What will kill this app
- Hallucinated places. Recommend a closed restaurant once and the user is gone forever.
- Generic output that feels like ChatGPT.
- Trying to launch in 30 cities at once with shallow data.
- Ad/affiliate placements visible in the output before trust is built.
- Asking too many questions in onboarding.

### Honest verdict

**Worth building.** The market is proven (people pay for Wonderplan, DUO, Lovewick), the problem is real ("what should we do tonight" is universal), and the gap is genuine. The risk is execution quality, not market existence. The strongest angle: **dates, in Kelowna, with a quality bar so high the first 100 users tell their friends.**

---

## Part 2 — Positioning & Wedge

**Sharpest 1-line value prop**:
> Plan the perfect Kelowna date in 30 seconds.

**Best niche to start with**: dates.
- Highest emotional stakes (don't want to look bad).
- Highest willingness to pay ($5–10 to not screw up a 3rd date is nothing).
- Built-in viral mechanic (you tell your partner where you're going; they ask how you found it).
- Strongest social media angle (date content performs on TikTok and IG Reels).
- Cleanest filtering (couples = 2 people, predictable budget bands, predictable vibes).

**Ideal first user in Kelowna**:
- 24–38 years old
- Lives in Kelowna or West Kelowna
- In a relationship (newly dating → 5 years in) OR actively dating
- Spends $80–$250 on a typical date out
- Already on Instagram, knows the obvious spots (Mission Hill, Frind, Bouchons), wants to look thoughtful without doing research
- Pain: "I always go to the same 3 places. I want to surprise her/him but I don't have time to plan."

**The magic moment**: opens app → 30 seconds of inputs → reads the first itinerary → screenshots it and texts it to their partner. That screenshot is the viral loop.

**3 concept tagline options**
1. "Plan the perfect Kelowna date in 30 seconds."
2. "Date nights, designed by locals."
3. "Your Kelowna date, planned."

Recommend #1 for the landing page (specificity sells).

---

## Part 3 — MVP Scope

### Features in v1
- Single-screen onboarding (5 questions max)
- Generate 3 itineraries
- Each itinerary card: title, hero image, vibe tag, total cost, total time, stop-by-stop timeline, drive flow, "why this works", backup option
- Simple feedback collection (3 actionable questions per itinerary)
- Anonymous use — no account required for first generation
- Email-gated saved plans (this is the only friction, and it's earned)

### Features explicitly EXCLUDED from v1 (fight for these)
- ❌ User accounts / login (until they want to save)
- ❌ Maps view (link to Google Maps for navigation; don't rebuild Maps)
- ❌ Reviews and ratings (no UGC, no moderation problems)
- ❌ Social features (no sharing inside the app, sharing happens via screenshot)
- ❌ Booking/reservations (link out to OpenTable; don't be a booking platform)
- ❌ Multi-day trip support
- ❌ Other cities
- ❌ Photo uploads
- ❌ Comments
- ❌ Push notifications
- ❌ Native mobile app (web-first, mobile-responsive)
- ❌ Calendar integration
- ❌ Group planning / shared editing

**Argument for ruthless exclusion**: every excluded feature is a place where you can fail. The only thing that has to be 10/10 in v1 is the quality of the generated itinerary. Everything else can be a v2 problem.

### Onboarding flow (screen-by-screen)

**Screen 1 — landing**
- Big headline, two example itinerary previews, primary CTA: "Plan my date"
- Secondary CTA: "See sample plans"

**Screen 2 — occasion**
- "Who's this for?" — Date / Solo / Friends (Date pre-selected, the others greyed for v1.5)

**Screen 3 — when & how long**
- "When?" — Tonight / This weekend / Pick a date
- "How long?" — 2 hrs / 3-4 hrs / Half day / Full day

**Screen 4 — vibe & budget**
- "What's the vibe?" (pick up to 2) — Romantic, Chill, Adventurous, Boujee, Spontaneous, Cozy
- "Budget per person?" — $ / $$ / $$$ ($30 / $30–80 / $80+)

**Screen 5 — must-haves**
- "What should it include?" (pick any) — Food, Drinks, Walk, View, Activity, Dessert, Hidden Gem, Lake, Outdoors, Indoors

**Screen 6 — generate**
- Loading screen with copy that builds anticipation: "Pulling together places that pair well…"
- Takes 8–15 seconds (LLM call). Show progress: "Found 23 spots → grouping by area → checking timing → writing your plans."

**Total: 5 actual decision screens. No login. No address entry. No account creation.**

### Output screen (screen-by-screen)

**Screen 7 — three itinerary cards**
- Swipeable horizontally on mobile, side-by-side on desktop
- Each card shows: title + hook line, vibe pills, total cost & duration, 3–4 stop names with times
- Tap to expand

**Screen 8 — expanded itinerary**
- Hero: title + "why this works" paragraph (3 sentences)
- Timeline view: each stop with time, name, address, what to do/order, drive time to next
- Total cost band, total duration, weather note if relevant
- Buttons: "Open in Maps" (route), "Reserve" (links to OpenTable where applicable), "Save plan" (gates email), "Try a different one"

**Screen 9 — feedback (after the date)**
- Triggered the morning after via email if they saved the plan
- 3 questions: which stop did you love most? which would you skip? did the timing feel right?
- This is the data goldmine.

---

## Part 4 — The Hybrid Generation System (THE CORE)

### Principle
Curated structured data is the moat. The LLM is a writer and a remixer, not a discoverer. Every place in an itinerary must come from the database — never from the LLM's training data. This is what kills hallucination.

### A) Place Database Schema

```
PLACES table
─────────────────────────────────────────
id                    uuid
name                  text
slug                  text
address               text
neighborhood          enum (downtown, pandosy, lower_mission, lakeshore, glenmore,
                            rutland, north_glenmore, west_kelowna, lake_country,
                            peachland, summerland, naramata, oyama)
drive_cluster         enum  -- coarser grouping for "stays in the same area" logic
lat                   decimal
lng                   decimal

type                  enum (restaurant, cafe, winery, brewery, cocktail_bar,
                            dessert, ice_cream, bakery, hike, viewpoint, beach,
                            park, garden, activity, gallery, market, shop,
                            sunset_spot, walk)
cuisine               text[]   -- nullable, for food only

vibe_tags             text[]   (romantic, chill, adventurous, boujee, cozy,
                                spontaneous, lively, intimate, casual, lively)
effort                enum (low, moderate, high)   -- physical effort
energy                enum (low, medium, high)     -- pacing/intensity

time_of_day           text[] (morning, midday, afternoon, sunset, evening, late)
weather_dependent     bool
weather_works_in      enum (any, dry_only, indoor_friendly)
seasonality           text[] (spring, summer, fall, winter, year_round)
typical_duration_min  int
opens                 time
closes                time
closed_days           int[]    -- 0=sun

price_tier            enum ($, $$, $$$)
typical_per_person    decimal  -- realistic estimate
reservation_required  bool
reservation_url       text

pairing_tags          text[]
  -- examples: "good_before_dinner", "good_after_dinner", "sunset_spot",
  --   "long_walk_after", "needs_wine_legs", "date_anchor", "quick_stop",
  --   "first_date_safe", "third_date_plus", "winter_indoor", "summer_only"

photo_url             text
booking_required      bool
quality_score         decimal default 7.0    -- founder-set baseline 0–10
feedback_score        decimal default 0      -- adjusted by user feedback
total_appearances     int default 0
total_kept            int default 0
total_skipped         int default 0
total_loved           int default 0

notes                 text   -- internal: what to order, what to skip, etc.
local_insight         text   -- one line shown to user: "ask for the patio"
created_at, updated_at
```

### B) Itinerary Template System

Templates are *patterns*, not full plans. Each template defines a sequence of slot types with constraints.

```yaml
templates:
  - id: sunset_wine_dinner
    name: "Sunset + Wine + Dinner"
    duration: 240
    suitable_for: [date]
    vibe: [romantic, boujee]
    slots:
      - type: viewpoint | hike
        time_of_day: sunset
        duration: 60
        effort: low | moderate
      - type: winery | cocktail_bar
        time_of_day: evening
        duration: 90
        pairing_required: needs_wine_legs OR sunset_spot
      - type: restaurant
        time_of_day: evening
        duration: 90
        price_tier: $$ | $$$
    geographic_rule: same_drive_cluster OR adjacent
    energy_curve: medium → low → low

  - id: walk_drink_dessert
    name: "Walk + Drink + Dessert"
    duration: 150
    suitable_for: [date]
    vibe: [chill, cozy, spontaneous]
    slots:
      - type: walk | park | garden
        duration: 45
        effort: low
      - type: cocktail_bar | brewery | wine_bar
        duration: 60
      - type: dessert | ice_cream
        duration: 30
    geographic_rule: walking_distance OR same_drive_cluster

  - id: activity_food_view
    name: "Activity + Food + View"
    duration: 300
    vibe: [adventurous, spontaneous]
    slots:
      - type: activity
        effort: moderate | high
        duration: 120
      - type: restaurant
        price_tier: $ | $$
      - type: viewpoint | sunset_spot
        time_of_day: sunset
```

I'd seed with **8–12 templates** to cover the realistic combinations.

### C) Generation Pipeline (step-by-step)

```
INPUT: occasion, time_window, vibe[], budget, must_includes[], drive_tolerance

STEP 1 — DETERMINISTIC FILTER
  Query PLACES where:
    - vibe_tags intersects user vibe[]
    - price_tier ≤ user budget
    - opens/closes covers user time_window
    - closed_days does not include today
    - seasonality includes current_season
    - weather_dependent AND bad_weather → exclude
    - any user must_includes maps to type → must have at least one of each

STEP 2 — TEMPLATE SELECTION
  Score templates against user inputs (vibe match, duration fit,
    must_includes compatibility). Pick top 3 distinct templates.

STEP 3 — CANDIDATE ASSEMBLY (per template)
  For each template:
    For each slot:
      Find all places that match slot constraints
      Filter by drive_cluster compatibility with already-chosen slots
      Rank by: quality_score + feedback_score - recent_appearance_penalty
      Take top 3 candidates per slot
    Generate combinations (cap at 50 per template)
    Score each combination:
      + base sum of place quality
      + pairing bonus (matching pairing_tags between adjacent slots)
      + geographic compactness (penalize drive time > drive_tolerance)
      + energy curve match
      + variety vs other 2 itineraries (diversity penalty)

STEP 4 — TOP-3 SELECTION
  Pick best combination from each of the 3 templates.
  If two are too similar, swap one for the next-best from a different template.

STEP 5 — LLM WRITING PASS
  For each of the 3 itineraries, send LLM:
    - the structured place data (name, what to order, local_insight, address)
    - the timeline (already computed)
    - the vibe and user inputs
  Ask LLM ONLY to:
    - write the title (8 words max)
    - write the "why this works" paragraph (3 sentences max)
    - write a one-line hook
    - write a per-stop suggestion ("share the squash carpaccio and a glass of pet-nat")

  LLM is a writer. It does not pick places. It does not invent details.
```

**What's deterministic vs LLM**:
- Deterministic: filtering, template selection, place selection, scoring, timing, drive routing.
- LLM: titles, narrative, per-stop suggestions, "why this works" reasoning.

This is the entire trick. The LLM cannot hallucinate a place because the place IDs are fixed in the prompt and the response is parsed against them.

### D) Quality Guardrails

Hard rules that fire BEFORE the LLM is called:
- **Drive cap**: max 25 min between adjacent stops (configurable by user).
- **No backtracking**: stops must form a roughly monotonic geographic path.
- **Pacing**: no 3 consecutive sit-down stops; no 3 consecutive high-effort stops.
- **Budget**: sum of typical_per_person ≤ user budget × 1.2 (20% tolerance).
- **Vibe consistency**: ≥ 70% of stops must match at least one user-selected vibe.
- **Reservations**: if any stop requires reservation and start is < 3 hours away, swap or warn.
- **Open hours**: every stop's hours must cover the proposed start time.

**The "would a local actually do this?" sanity layer**: a config-driven set of negative rules I add as I observe failures. E.g., "don't put two wineries back-to-back without food between them," "don't start a date at a busy lunch spot at 7pm."

### E) Feedback Loop Architecture

**What to ask (NOT thumbs up/down)**:

After the date (24h delayed email):
1. "Which stop did you love most?" → tap one
2. "Which would you skip?" → tap one (or "none")
3. "Was the timing right?" → too rushed / perfect / too much downtime
4. (optional) "Anything we should know?" → free text

**Per-place adjustments**:
```
on each itinerary completed:
  total_appearances += 1
  if loved:    total_loved += 1,    feedback_score += 0.3
  if kept:     total_kept += 1,     feedback_score += 0.05
  if skipped:  total_skipped += 1,  feedback_score -= 0.4

normalized_score = quality_score + clamp(feedback_score, -3, +3)
```

**Per-pairing adjustments**:
- Track pairings (place A → place B in adjacent slots) in a separate table.
- Each pairing has a count and a love rate.
- High-love pairings get a +0.5 boost in scoring.
- Low-love pairings get a -1.0 penalty.

**Per-template adjustments**:
- Same logic. Templates that consistently produce "skipped" stops drop in selection probability.

**User preference vector** (after 3+ generated plans):
- Stored as a sparse vector across vibe tags, drive_cluster preferences, price_tier history, type frequency.
- Biases candidate scoring at generation time (boost places matching the user's historical positives).
- Decays over 90 days to allow for taste change.

**Cold-start strategy**:
- New users get plans biased toward globally top-loved places + safe templates ("walk + drink + dessert" is a high-floor bet).
- After their first feedback, switch to personalized ranking.

**"Top 1% plans" emergence**:
- Track full itinerary fingerprints (template + sequence of place IDs).
- Itineraries that get a "loved everything" rating from 3+ couples become **featured plans** in a separate "Locally Loved" section.
- This is real social proof, not made-up reviews.

**Anti-gaming**:
- One feedback per generated plan.
- Negative feedback weighted less than positive (people complain more easily).
- Manual review queue for any place dropping > 1.5 in feedback_score in a week.

### F) Personalization

**User preference vector schema**:
```
user_preferences {
  user_id
  vibe_weights: { romantic: 0.7, chill: 0.5, adventurous: -0.2, ... }
  type_weights: { winery: 0.8, hike: -0.3, dessert: 0.6, ... }
  cluster_weights: { downtown: 0.4, lakeshore: 0.7, west_kelowna: -0.1, ... }
  price_tier_actual: $$
  drive_tolerance_actual: 20min
  last_updated
}
```

**Anti-boredom rule**: at generation time, penalize places the user has seen in their last 5 itineraries (even if they loved them). Never recommend the same exact place twice in a 30-day window unless they specifically ask.

---

## Part 5 — Kelowna Launch Database

### Categories to seed (in priority order)

| Category | Target count | Why |
|---|---|---|
| Wineries (with food) | 12 | Date anchor for romantic vibe |
| Restaurants $$ | 18 | Most common dinner slot |
| Restaurants $$$ | 8 | Boujee and special occasion |
| Restaurants $ | 8 | Casual / chill vibes |
| Cocktail bars | 10 | Pre-dinner drinks |
| Craft breweries | 6 | Casual chill vibe, friend hangs |
| Cafés (date-able) | 6 | Daytime dates, dessert alts |
| Dessert / ice cream | 8 | Closing the loop on the night |
| Bakeries / pastry | 4 | Morning dates |
| Hikes (easy/moderate) | 6 | Adventurous + "what should we do outside" |
| Sunset viewpoints | 6 | Critical anchor for romantic vibe |
| Beaches | 5 | Summer must-have |
| Parks / gardens | 6 | Walk slots |
| Activities | 10 | Axe throwing, escape rooms, mini golf, paddleboards, etc. |
| Markets / shops (date-able) | 4 | Daytime browse |
| Galleries / cultural | 4 | Rainy day, indoor |
| **TOTAL** | **~120** | |

**Minimum to launch and feel non-empty**: 75 high-quality places.
**Comfortable launch**: 100.
**Strong launch**: 120.

### Area Clusters (Kelowna)

Use these as hard geographic groupings — itineraries should mostly stay within one cluster or step into an adjacent one.

1. **Downtown** — Bernard Ave corridor, Cultural District, Waterfront Park, Knox Mountain
2. **Pandosy / Mission** — Pandosy Village, Kinsmen Park, Boyce-Gyro Beach
3. **Lower Mission** — South Pandosy, CedarCreek, Sarsons Beach, Cedar Creek Park
4. **Lakeshore** — Lakeshore Rd corridor, Frind, Rotary Beach, Eldorado
5. **Glenmore / North Glenmore** — Glenmore valley, Knox backside
6. **Rutland / Black Mountain** — Black Mountain park, eastside food
7. **West Kelowna** — Westbank, Westside Wine Trail, Mission Hill, Quails' Gate
8. **Lake Country** — Wood Lake, Kalamalka, Pelican Pier, 50th Parallel
9. **Peachland / Summerland** — south lake drive
10. **Naramata Bench** — wineries, expanded "weekend trip" cluster

**Inter-cluster drive times** (real, not Google's optimistic estimates):
- Downtown ↔ West Kelowna: 18–25 min
- Downtown ↔ Lower Mission: 12–18 min
- Downtown ↔ Lake Country: 25–35 min
- Downtown ↔ Naramata: 50–70 min (this is a "weekend trip" not a Tuesday date)

### 50 Specific Real Kelowna-Area Places (with proposed tags)

Format: **Name** — type — cluster — vibe tags — pairing notes

**Wineries**
1. **Mission Hill Family Estate** — winery — west_kelowna — romantic, boujee — sunset_spot, date_anchor, third_date_plus, dramatic architecture
2. **CedarCreek Estate Winery (Home Block)** — winery — lower_mission — romantic, boujee — sunset_spot, lake_view, date_anchor
3. **Quails' Gate** — winery — west_kelowna — romantic, chill — patio, vineyard_view, dinner_capable
4. **Old Vines Restaurant (at Quails' Gate)** — restaurant — west_kelowna — romantic, boujee — fine_dining, vineyard_view
5. **Frind Estate Winery** — winery — west_kelowna — chill, romantic — lakefront, sunset_spot, casual_winery
6. **Indigenous World Winery** — winery — west_kelowna — chill, cultural — patio, food_pairing
7. **Tantalus Vineyards** — winery — south_east_kelowna — chill, cozy — quieter, less_touristy
8. **The Vibrant Vine** — winery — south_east_kelowna — spontaneous, chill — 3D_glasses_gimmick, fun
9. **Sandhill Wines** — winery — downtown — chill — urban_winery, walkable
10. **Grizzli Winery (31 Charkay)** — winery+restaurant — west_kelowna — boujee, romantic — share_plates, newer

**Restaurants**
11. **Bouchons Bistro** — restaurant ($$$) — downtown — romantic, boujee — French, intimate, third_date_plus
12. **RauDZ Regional Table** — restaurant ($$$) — downtown — chill, boujee — local_focused, walkable
13. **Krafty Kitchen + Bar** — restaurant ($$) — downtown — chill — lively, casual_date, drinks_capable
14. **Salted Brick** — restaurant ($$) — downtown — chill, intimate — small, cozy, charcuterie
15. **Waterfront Wines** — restaurant ($$$) — downtown — romantic — wine_focused, intimate
16. **Frankie We Salute You!** — restaurant ($$) — downtown — chill, lively — casual, lively
17. **The Modest Butcher** — restaurant ($$) — west_kelowna — chill, casual — neighborhood_gem
18. **Earls Kitchen + Bar (rooftop)** — restaurant ($$) — downtown — chill — rooftop_patio, lake_view, date_safe
19. **Bernie's Supper Club** — restaurant+activity ($$) — downtown — spontaneous — dinner_and_movie, unique
20. **Naked Café** — café — downtown — chill — daytime_date, brunch

**Cocktail bars / drinks**
21. **Skinny Duke's** — cocktail_bar — downtown — boujee, chill — craft_cocktails, intimate, pre_dinner
22. **Micro Bar & Bites** — cocktail_bar — downtown — boujee — wine_bar, small_plates, intimate
23. **Born to Shake** — cocktail_bar — downtown — chill, boujee — tapas, local_makers
24. **Friends of Dorothy Lounge** — cocktail_bar — downtown — lively, fun — LGBTQ+, drag_brunch
25. **BNA Brewing Co.** — brewery — downtown — chill, lively — own_brews, casual
26. **Hello Darlin' (above BNA)** — bar — downtown — spontaneous, lively — speakeasy, line_dancing
27. **Tree Brewing Beer Institute** — brewery — downtown — chill — pub_fare, flights
28. **CRAFT Beer Market** — brewery+restaurant — downtown — chill — rooftop_view, wide_selection

**Dessert / ice cream / bakery**
29. **Sandrine French Pastry & Chocolate** — dessert — downtown — boujee, romantic — macarons, post_dinner
30. **Parlour Ice Cream** — ice_cream — pandosy — chill, casual — small_batch, walkable
31. **Bright Jenny Coffee Roasters** — café — multiple — chill — daytime_date
32. **Komorebi Cafe & Healing Art Studio** — café — downtown — cozy, unique — matcha, vegan_options
33. **Deville Coffee** — café — downtown/lakeshore — chill — cronuts, pastries
34. **CeCe's Coffee** — café — downtown — boujee, chill — newer, curated
35. **Moo-Lix** — ice_cream — pandosy — casual, fun — 40_flavors, waffle_cones

**Hikes / viewpoints**
36. **Knox Mountain (Apex Trail)** — hike — downtown — adventurous, romantic — sunset_spot, the_one_hike, 60_min_loop
37. **Lochview Trail (Knox)** — hike — glenmore — adventurous, hidden_gem — quieter, lake_view
38. **Pincushion Mountain** — hike — peachland — adventurous — challenging, panoramic
39. **Black Mountain Regional Park** — hike — rutland — adventurous, chill — moderate, viewpoints
40. **Hardy Falls Regional Park** — walk — peachland — chill, cozy — easy, waterfall, 2km
41. **Kalamoir Regional Park** — viewpoint — west_kelowna — romantic, chill — sunset_spot, lake_view
42. **Woodhaven Regional Park** — walk — lower_mission — chill, hidden_gem — short_loops, four_climates

**Parks / gardens / beaches**
43. **Kasugai Gardens** — garden — downtown — cozy, hidden_gem — Japanese, koi_pond, quick_stop
44. **Waterfront Park & Tugboat Beach** — walk+beach — downtown — chill, romantic — boardwalk, sunset_walk
45. **Cedar Creek Park** — beach — lower_mission — chill — local_favorite, off_leash
46. **Kinsmen Park** — park — pandosy — chill — picnic, walkable
47. **Rotary Beach** — beach — lakeshore — chill, casual — paddleboard_rentals, sunset

**Activities**
48. **Axe Monkeys (Stremel Rd)** — activity — rutland — adventurous, spontaneous, fun — date_safe, 60_min
49. **Exit Kelowna (escape rooms)** — activity — downtown — adventurous, spontaneous — 60_min, group_friendly
50. **Okanagan Beach Rentals (paddleboards)** — activity — lakeshore — adventurous, summer_only — sunset_spot, lake

**Add when you have capacity** (next 50): more wineries on the Westside Wine Trail, more Pandosy/Mission restaurants, Big White (winter), Myra Canyon (Kettle Valley trestles), Summerhill Pyramid Winery, Spierhead, 50th Parallel, Sparkling Hill, Manteo Resort spa, Brodo Kitchen, Yamas Taverna, OEB Breakfast, Rooster's Coffee, Fixx Café, more in Naramata Bench, Lake Country wineries.

---

## Part 6 — 10 Example Kelowna Itineraries

### 1. "The Westside Sunset Classic"
**Vibe**: romantic, boujee · **Budget**: $$$ · **Duration**: 4 hrs · **For**: dates 3+

- **5:30** — **Mission Hill Family Estate**, West Kelowna · architecture tour + glass on the terrace · 90 min · $30/pp
- **7:00** — **Quails' Gate** (Old Vines Restaurant) · dinner with vineyard view · 90 min · $90/pp
- **9:00** — **Frind Estate Winery** · last drink lakeside as the sun finishes · 45 min · $20/pp

**Drive flow**: all West Kelowna, no backtracking · 8 min between stops · 20 min back downtown
**Total**: ~$140/pp · 4 hrs
**Why it works**: Three of the most striking spots on the Westside, sequenced so the architecture wow → dinner → lake unwind hits the right emotional curve. You're never rushing.
**Backup for stop 2**: 31 Charkay at Grizzli (newer, share-plates).

---

### 2. "First Date Downtown"
**Vibe**: chill, intimate · **Budget**: $$ · **Duration**: 3 hrs · **For**: first/second date

- **6:30** — **Skinny Duke's** · craft cocktail, low-stakes intro · 60 min · $25/pp
- **7:45** — **Salted Brick** · charcuterie + small plates, 4-min walk · 75 min · $50/pp
- **9:15** — **Sandrine French Pastry** · grab a macaron + walk to Waterfront Park · 30 min · $10/pp

**Drive flow**: zero driving — three stops in walking distance
**Total**: ~$85/pp · 3 hrs
**Why it works**: walkable means no awkward "okay, where to next?" moment. Each spot is small enough to talk, big enough to feel intentional. Salted Brick gives you something to share, which builds rapport faster than two entrees.

---

### 3. "Adventure Date"
**Vibe**: adventurous, spontaneous · **Budget**: $$ · **Duration**: 4 hrs · **For**: 3rd+ date, fit couples

- **5:00** — **Knox Mountain Apex Trail** · summit hike for sunset · 75 min · free
- **6:45** — **BNA Brewing Co.** · post-hike beers + share plates · 75 min · $40/pp
- **8:15** — **Parlour Ice Cream** · walk over for the close · 20 min · $8/pp

**Drive flow**: Knox → downtown, 6 min · all walkable from there
**Total**: ~$50/pp · 3.5 hrs
**Why it works**: shared physical effort is a documented bonding shortcut. You earn the beer. You earn the ice cream. Cheap, memorable, and ends well.
**Backup for stop 1**: Lochview Trail (quieter, slightly longer).

---

### 4. "The Boujee Day"
**Vibe**: boujee, romantic · **Budget**: $$$ · **Duration**: full day · **For**: anniversary, special

- **11:00** — **Sandrine** · pastries + coffee to start · 30 min · $15/pp
- **12:00** — **Mission Hill** · tour + tasting flight · 90 min · $40/pp
- **2:00** — **Quails' Gate** patio · light lunch · 90 min · $50/pp
- **4:30** — **Kalamoir Regional Park** · digestive walk on the bluffs · 45 min · free
- **6:30** — **CedarCreek Home Block** · sunset dinner over the lake · 2 hrs · $120/pp
- **9:00** — **Skinny Duke's** · downtown nightcap · 45 min · $25/pp

**Drive flow**: West Kelowna day → cross to Lower Mission for sunset → downtown to close
**Total**: ~$250/pp · 10 hrs
**Why it works**: paces a long day so the energy peaks at dinner instead of crashing at 4pm. Walking at Kalamoir is the unsung move — most all-day winery dates skip the palate cleanse and feel sluggish by dinner.

---

### 5. "Cozy Rainy Night"
**Vibe**: cozy, intimate · **Budget**: $$ · **Duration**: 3 hrs · **For**: any date, indoor

- **6:00** — **Komorebi Cafe & Healing Art Studio** · matcha + slow start · 45 min · $15/pp
- **7:00** — **Bouchons Bistro** · French dinner, candlelit · 2 hrs · $80/pp
- **9:15** — **Micro Bar & Bites** · one cocktail to close · 45 min · $20/pp

**Drive flow**: all downtown, all walkable
**Total**: ~$115/pp · 3 hrs
**Why it works**: the rain becomes a feature instead of a problem. Three indoor spots within 5 minutes, each with its own character — Japanese cozy → French intimate → modern cocktail.

---

### 6. "The 'I Forgot To Plan' Save"
**Vibe**: chill, spontaneous · **Budget**: $$ · **Duration**: 2 hrs · **For**: weeknight, low effort

- **7:00** — **Frankie We Salute You!** · pizza + drinks, no reservation needed · 75 min · $35/pp
- **8:30** — **Parlour Ice Cream** · 5-min walk for dessert · 20 min · $8/pp
- **9:00** — **Waterfront Park sunset walk** · 25 min · free

**Drive flow**: zero driving
**Total**: ~$45/pp · 2 hrs
**Why it works**: this is the "it's 6:45pm and I haven't planned anything" plan. No reservations. Walkable. Still feels like a date because of the closing walk. Better than ordering UberEats and watching Netflix for the third time this week.

---

### 7. "Solo Sunday Reset"
**Vibe**: chill, cozy · **Budget**: $ · **Duration**: half day · **For**: solo

- **9:30** — **Bright Jenny Coffee** · long coffee + book · 60 min · $8
- **11:00** — **Knox Mountain (Paul's Tomb)** · shaded lakeside hike · 90 min · free
- **1:00** — **Krafty Kitchen** · solo lunch at the bar · 60 min · $30
- **2:30** — **Kasugai Gardens** · 20 min sit + walk back · free
- **3:30** — **Naked Café** · pastry + journal · 30 min · $8

**Total**: ~$50 · 6 hrs
**Why it works**: no driving, structured but not over-scheduled, mixes movement / food / quiet. The Kasugai stop is the trick — most solo days skip the "sit and do nothing" piece.

---

### 8. "Friends Hangout — Active"
**Vibe**: adventurous, lively · **Budget**: $$ · **Duration**: 5 hrs · **For**: 3–6 friends

- **2:00** — **Axe Monkeys** · 60 min session · $30/pp
- **3:30** — **BNA Brewing** · flight + share plates · 90 min · $35/pp
- **5:30** — **Waterfront Park walk** · digest + photos · 30 min · free
- **6:30** — **Frankie We Salute You!** · group dinner · 90 min · $35/pp

**Total**: ~$100/pp · 5 hrs
**Why it works**: starts with an icebreaker activity (axe throwing makes every group louder), settles into casual drinks, walks off the beer, ends with food everyone agrees on.

---

### 9. "Lake Country Day Trip"
**Vibe**: chill, romantic · **Budget**: $$ · **Duration**: half day · **For**: dates wanting to escape town

- **11:30** — **Bright Jenny (Glenmore)** · coffee for the drive · 20 min · $8/pp
- **12:30** — **50th Parallel Estate Winery** · tasting · 75 min · $25/pp
- **2:15** — **Kalamalka Lake Lookout** · the famous turquoise view · 30 min · free
- **3:15** — **Sparkling Hill** spa terrace OR lakeside walk at Kal Beach · 90 min · varies
- **5:30** — drive back, dinner downtown of choice

**Drive flow**: downtown → Lake Country (25 min) → loop home
**Why it works**: gets you out of Kelowna proper without committing to a full Naramata day. Kal Lake is one of the most photographed spots in BC and tourists overlook it — locals know.

---

### 10. "Winter Cozy Night"
**Vibe**: cozy, romantic · **Budget**: $$ · **Duration**: 3.5 hrs · **For**: dates, Nov–Mar

- **5:30** — **Sandrine** · hot chocolate + macaron pickup · 30 min · $12/pp
- **6:30** — **Bernie's Supper Club** · dinner-and-a-movie experience · 2.5 hrs · $80/pp
- **9:30** — **Hello Darlin'** (above BNA) · slow speakeasy nightcap · 45 min · $20/pp

**Total**: ~$115/pp · 3.5 hrs
**Why it works**: zero outdoor exposure (winter constraint solved). Bernie's makes dinner feel like an event, not a transaction. Hello Darlin' is a quieter close than BNA proper.

---

## Part 7 — Tech Stack & Build Spec

### Architectural principle: one backend, two clients

Web ships first. Mobile (React Native + Expo) ships when retention is proven. **They share a single backend** so we never duplicate business logic, auth, or data access. This rules out putting business logic in Next.js API routes — instead, the generation pipeline lives in Supabase Edge Functions and both clients call the same endpoint.

**Build-once guarantee**: schema, auth, RLS policies, generation pipeline, LLM prompts, scoring logic, storage rules, email triggers, and analytics taxonomy are all built once and shared identically between web and mobile. Adding the React Native client later is purely a frontend project — the backend doesn't change.

### Repo structure: monorepo from day one

To extend the build-once footprint beyond the backend (so types, validators, and API-client wrappers don't drift between clients), the project is a **Turborepo + pnpm monorepo**:

```
after5/
├── apps/
│   ├── web/                ← Next.js 15 (now)
│   └── mobile/             ← Expo + React Native (month 4+)
├── packages/
│   ├── types/              ← shared TS types (Place, Itinerary, Feedback)
│   ├── api-client/         ← Supabase client wrappers, query/mutation helpers
│   ├── validators/         ← Zod schemas for inputs/outputs
│   └── business/           ← pure logic (scoring helpers, prompt builders, formatters)
├── supabase/
│   ├── migrations/         ← schema as code (versioned)
│   ├── functions/          ← Edge Functions (Deno)
│   └── seed.sql            ← seed places + templates
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

Schema changes happen in `supabase/migrations/`, types regenerate into `packages/types/`, both `apps/*` get the new types on next build. No drift, no copy-paste.

### Recommended stack (locked)

**Backend (the one that matters)**

| Layer | Choice | Why |
|---|---|---|
| Database | **Supabase Postgres** | Real SQL + relations. Portable if we ever leave. |
| Auth | **Supabase Auth** | Email + magic link + Apple/Google Sign-In. Same SDK on web and React Native. |
| Business logic | **Supabase Edge Functions (Deno)** | Generation pipeline lives here. Web + mobile POST to `/functions/v1/generate-plan`. Anthropic key never on client. |
| Security | **Postgres Row-Level Security** | Enforced in DB regardless of client. Set up day one. |
| Storage | **Supabase Storage** | Place images, user avatars (later) |
| LLM | **Claude Sonnet 4.6 via Anthropic API** | Best instruction-following at the price. Prompt caching mandatory. |
| Email | **Resend** | Feedback follow-up emails |

**Web (now)**

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + Tailwind + shadcn/ui** | SSR for SEO on every page (see Part 14). |
| Hosting | **Vercel** | Free tier covers MVP. CI baked in. ISR for itinerary pages. |
| Data access | **`@supabase/supabase-js`** | Direct calls to Supabase. No custom API layer in Next. |

**Mobile (later — month 4+)**

| Layer | Choice | Why |
|---|---|---|
| Framework | **React Native + Expo** | Same TS skills. Single codebase iOS + Android. |
| Data access | **`@supabase/supabase-js`** | Same SDK as web. |
| Build | **EAS Build** | Hosted build/sign. No Mac required. |

**Cross-cutting**

| Layer | Choice | Why |
|---|---|---|
| Analytics | **PostHog** | Web JS + RN SDK. One project, both clients. |
| Errors | **Sentry** | Same — works on both. |
| Admin | **Supabase Studio** (+ Retool later) | Don't build a custom admin. Edit places/templates/scores directly in the dashboard. |
| Maps | **Google Maps deep links** | Don't render a map. `https://www.google.com/maps/dir/?api=1&...` |
| Domain | **Cloudflare** | Free DNS, free SSL, free CDN. |

### Generation call flow (the key diagram)

```
Web (Next.js)        ─┐
                      ├──→  POST /functions/v1/generate-plan  ──→  Edge Function (Deno)
Mobile (RN, later)   ─┘                                              ├─ Verify JWT (Supabase auth)
                                                                     ├─ Query places (filter + score)
                                                                     ├─ Match templates
                                                                     ├─ Call Anthropic (writing pass)
                                                                     ├─ INSERT itinerary
                                                                     └─ Return 3 plans
```

Both clients hit the same endpoint, get the same JSON, render their own UI. Zero duplicated logic.

### What we are NOT using (and why)

- **Custom Node/Express on a VPS** — DevOps overhead Supabase already absorbs.
- **Firebase** — document DB is wrong shape for joins on places + tags + pairings.
- **Convex** — great DX, vendor-locked. Postgres is portable.
- **Next.js API routes for business logic** — couples backend to web app, blocks mobile.
- **tRPC** — nice for web-only. Adds friction once mobile is in the picture.
- **Custom map rendering** — Google Maps deep links are free and what users prefer anyway.

### Web-first sequencing rationale

- No app store approval delay.
- SEO compounds (see Part 14) — the public web pages ARE the marketing.
- Mobile Safari covers the experience 100%.
- PWA wrapper for "add to home screen" buys us time before native is needed.
- Native is a v2 problem when retention is proven.

### Database schema (SQL)

```sql
-- Places
create table places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  address text,
  neighborhood text not null,
  drive_cluster text not null,
  lat decimal,
  lng decimal,
  type text not null,
  cuisine text[],
  vibe_tags text[] not null default '{}',
  effort text default 'low',
  energy text default 'medium',
  time_of_day text[] default '{}',
  weather_dependent boolean default false,
  weather_works_in text default 'any',
  seasonality text[] default '{year_round}',
  typical_duration_min int default 60,
  opens time,
  closes time,
  closed_days int[] default '{}',
  price_tier text default '$$',
  typical_per_person decimal,
  reservation_required boolean default false,
  reservation_url text,
  pairing_tags text[] default '{}',
  photo_url text,
  quality_score decimal default 7.0,
  feedback_score decimal default 0,
  total_appearances int default 0,
  total_kept int default 0,
  total_skipped int default 0,
  total_loved int default 0,
  notes text,
  local_insight text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_places_active on places (is_active);
create index idx_places_type_cluster on places (type, drive_cluster) where is_active;

-- Templates
create table templates (
  id text primary key,
  name text not null,
  duration_min int not null,
  suitable_for text[] not null,
  vibe text[] not null,
  slots jsonb not null,
  geographic_rule text,
  energy_curve text,
  selection_weight decimal default 1.0,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Generated itineraries
create table itineraries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  template_id text references templates(id),
  inputs jsonb not null,
  stops jsonb not null,
  title text,
  hook text,
  why_it_works text,
  total_cost_pp decimal,
  total_duration_min int,
  generated_at timestamptz default now()
);

-- Feedback
create table feedback (
  id uuid primary key default gen_random_uuid(),
  itinerary_id uuid references itineraries(id),
  user_id uuid references users(id),
  loved_place_id uuid references places(id),
  skipped_place_id uuid references places(id),
  pacing_rating text,
  free_text text,
  created_at timestamptz default now()
);

-- Pairings (derived analytics table, populated by trigger or job)
create table pairings (
  place_a uuid references places(id),
  place_b uuid references places(id),
  appearances int default 0,
  loved int default 0,
  skipped int default 0,
  primary key (place_a, place_b)
);

-- User preferences
create table user_preferences (
  user_id uuid primary key references users(id),
  vibe_weights jsonb default '{}',
  type_weights jsonb default '{}',
  cluster_weights jsonb default '{}',
  price_tier_actual text,
  drive_tolerance_min int,
  updated_at timestamptz default now()
);

-- Lightweight users (email-only)
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz default now()
);
```

### API endpoints

```
POST  /api/generate          → takes inputs, runs pipeline, returns 3 itineraries
POST  /api/save              → saves itinerary, requires email
POST  /api/feedback          → posts feedback for an itinerary
GET   /api/itinerary/:id     → renders a saved/shared plan
GET   /api/sample-plans      → returns 3 hard-coded killer itineraries for the landing
```

### Page list

```
/                     — landing (hero + 3 sample cards + CTA)
/plan                 — generation flow (5 steps)
/plan/result          — 3 itinerary cards
/plan/[id]            — single itinerary detail
/saved                — list of saved plans (email gate)
/feedback/[id]        — post-date feedback form (linked from email)
/about                — short founder note + city coverage
/places               — (admin) browse all places
```

### Cost estimates

**Per generation** (Sonnet 4.6 with prompt caching):
- ~3000 input tokens (cached after first call: ~$0.0009)
- ~2000 output tokens (~$0.030)
- Effective cost per generation: **~$0.03**

**Monthly infra at scale**:
| Users | Generations/mo | LLM | Vercel | Supabase | Total |
|---|---|---|---|---|---|
| 100 | ~300 | $9 | $0 | $0 | **~$9** |
| 1,000 | ~3,000 | $90 | $20 | $25 | **~$135** |
| 10,000 | ~30,000 | $900 | $50 | $25 | **~$975** |

At $5/mo subscription with 5% conversion you cover infra at ~30 paying users. The unit economics are fine.

---

## Part 8 — Validation Before Build

**Don't write the app yet.** Run this in order:

### Week 0 (3 days): Concierge MVP
- Set up an Instagram account: `@kelownadates` or similar.
- Post the 10 itineraries from Part 6 as carousels.
- DM offer in bio: "Tell me your vibe, budget, and time — I'll plan your date free."
- Manually plan 10 dates for real people.
- **Success metric**: do 5+ people actually use the plan and tell you it was good?

### Week 1: Landing page test
- Single page, the headline, 3 sample plans, email signup.
- Spend $50 on Instagram ads targeting Kelowna 24–38 in-relationship.
- **Success metric**: ≥ 5% click → email signup conversion.

### Week 2: Typeform + manual generation
- Real intake form with the 5 questions.
- You + Claude in a Google Doc generate the plans manually.
- Email back within 30 minutes.
- **Success metric**: ≥ 30% of users come back for a second plan within 14 days.

If the metrics don't hit, the idea isn't validated and no amount of code fixes that. If they do hit, you build the app knowing demand is real.

---

## Part 9 — Monetization

### Recommendation: **Freemium subscription with a hard quality floor.**

- **Free**: 2 generated plans per month, all features, no asterisks.
- **Plus** ($6.99/mo or $49/yr): unlimited plans, save plans, "surprise me" mode, weekend trip plans (Naramata, Lake Country), early access to new cities.
- **Date Pass** (one-time, $4.99): unlimited plans for 7 days. Captures the "I just need this for an anniversary" user without the subscription friction.

### Why this and not the alternatives

- **Pure pay-per-plan**: kills exploration. People won't try variants if each costs money.
- **Affiliate / restaurant kickbacks**: do this LATER, never in v1. The moment users smell paid placements, trust dies. This is the lesson from Wonderplan and Expedia AI — both lost credibility for this reason.
- **Local business partnerships**: viable in v2 once you have audience. Featured "Locally Loved" placements paid for by venues, but gated by quality score (you can't buy your way in if your feedback score is low).

### What NOT to monetize
- Sponsored stops in the itinerary (trust killer).
- Selling user data (obvious).
- Charging for filters (boujee budget gate, etc. — feels nickel-and-dimed).

### Paywall introduction
- Don't paywall until 30+ days of operation.
- First 100 users get free Plus for life — they're your founder cohort.
- Track: generation → save → return rate. Only paywall once 25% of generations are coming from repeat users.

---

## Part 10 — 30-Day Execution Roadmap

### Week 1 — Validate (no code)
- Day 1–2: build Instagram + landing page (Carrd or Framer, no engineering).
- Day 3–4: post 10 itineraries from Part 6 as IG carousels.
- Day 5: launch concierge offer ("free custom date plans, DM me").
- Day 6–7: hand-plan 10 real dates. Take notes on what people ask for.

### Week 2 — Build the database
- Day 8–10: enter 75–100 Kelowna places into Supabase by hand. This is the moat. Don't outsource.
- Day 11–12: write 8–12 templates.
- Day 13–14: build the deterministic pipeline (filter → template → assemble → score) in a Node script. Test with the Part 6 itineraries as ground truth — your code should produce something close to them.

### Week 3 — Build the app shell
- Day 15–17: Next.js scaffold, Tailwind, the 5-step flow, basic styling.
- Day 18–19: wire `/api/generate` to call the pipeline + Claude.
- Day 20–21: itinerary card UI, expanded detail, "save plan" with email gate.

### Week 4 — Launch
- Day 22–23: feedback email flow + form.
- Day 24–25: PostHog analytics, error monitoring, prompt-cache verification.
- Day 26–27: invite the 50 people from your concierge cohort.
- Day 28: public launch — Instagram, r/kelowna, Kelowna Facebook groups, Tourism Kelowna pitch.
- Day 29–30: respond to every single piece of feedback by hand.

---

## Part 11 — Landing Page Copy

```
─────────────────────────────────────────────────────────
HEADLINE        Plan the perfect Kelowna date in 30 seconds.

SUBHEADLINE     Curated date itineraries built for your vibe,
                budget, and time — by people who actually live here.

BENEFIT 1       ☀️  Real Kelowna spots, not generic AI guesses.
BENEFIT 2       🗺️  Full timeline, drive flow, and costs — done.
BENEFIT 3       💡  Three options every time. Pick your night.

PRIMARY CTA     [ Plan my date — free → ]
SECONDARY CTA   See sample plans

EXAMPLE CARDS   • The Westside Sunset Classic  · $$$  · 4 hr  · romantic
                • First Date Downtown          · $$   · 3 hr  · chill
                • Adventure Date               · $$   · 4 hr  · adventurous

SOCIAL PROOF    "It planned a better date than I would have."
                — early user, Pandosy
                
                (start collecting these from concierge week)

FOOTER          Built in Kelowna. Coming to Kamloops, Vernon, Penticton.
─────────────────────────────────────────────────────────
```

---

## Part 12 — Naming

**Final name: After5.**

Why it works: "after 5" is the universal shorthand for when work ends and life starts. Every date, every solo reset, every friend hangout this app plans happens after 5. The name does the positioning work — no explanation needed. It's short, brandable, easy to say on the phone, easy to type. Verb-able too: "let me after-five it."

**Domains to grab immediately**: after5.app, after5.co, getafter5.com, tryafter5.com, after5kelowna.com.

**Handles**: @after5.kelowna (IG), @after5app (Twitter/X), @after5 (TikTok if available).

---

### Naming process (for reference)

The 20 candidates that were considered before landing on After5:

| # | Name | Read | Notes |
|---|---|---|---|
| 1 | **Plotline** | "your date has a plotline" | strong, memorable, available .com unlikely |
| 2 | **Curated** | premium feel | likely taken |
| 3 | **Tonight** | direct, strong | likely premium domain |
| 4 | **Outly** | short invented | clean, .com may be open |
| 5 | **Localish** | hints at locality | warm |
| 6 | **Datepath** | descriptive | available likely |
| 7 | **Kindred** | romantic, abstract | likely taken |
| 8 | **Sundown** | sunset-forward, romantic | poetic |
| 9 | **Outingly** | descriptive | meh |
| 10 | **Pairing** | references the pairing logic | strong concept |
| 11 | **Knot** | tying things together | short, brandable |
| 12 | **Lark** | spontaneous date energy | available .app likely |
| 13 | **Wandr** | trendy spelling | overused trope |
| 14 | **Tonio** | invented short | ok |
| 15 | **Plotted** | playful nod to "I have it plotted" | strong |
| 16 | **Datewise** | descriptive | functional |
| 17 | **Nightcraft** | crafted nights | premium feel |
| 18 | **Setlist** | plan = setlist of stops | musical, distinctive |
| 19 | **Rounds** | "what are the rounds tonight?" | local-feeling |
| 20 | **Plottable** | nerdy charm | niche |

**Top picks at the time**: 1) Setlist, 2) Plotline, 3) Lark, 4) Pairing, 5) Sundown.

**Final decision (after candidate review): After5.** It beat all 20 candidates because it solves the positioning question in the name itself — every other name required explaining what the app does. After5 doesn't.

---

## Part 13 — Content, SEO, and AI Retrieval Strategy

The app is one surface. The library and pillar pages are two more. All three pull from the same Supabase backend. This converts every dollar spent on quality into compounding free traffic — and gives retrieval-based AI (Perplexity, ChatGPT Search, Google AI Overviews, Claude with web search) a reason to cite us.

### The principle

> Static training data won't pick us up for years. Live retrieval will — if we look like the cleanest structured answer on the internet for "best date in Kelowna" and its variants.

Optimize for **retrieval**, not for "AI." The retrievers all use the same signals as Google.

### The hard risk: Helpful Content Update

Programmatic SEO got destroyed by Google's HCU in 2024–2025. Sites that mass-generated thin pages lost 50–80% of organic traffic. **We cannot ship junk.** The fix is built into the architecture: a public page is only ever a real itinerary that real users have already validated.

### Three surfaces, one backend

```
                         ┌─────────────────┐
                         │ Supabase        │
                         │ places +        │
                         │ itineraries +   │
                         │ feedback        │
                         └────────┬────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       │                          │                          │
       ▼                          ▼                          ▼
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  THE APP     │         │ THE LIBRARY  │         │ PILLAR PAGES │
│  /plan flow  │         │ /kelowna/    │         │ /best-...    │
│  Interactive │         │ itinerary/   │         │ Hand-written │
│  Generation  │         │ [slug]       │         │ SEO articles │
│              │         │ Indexed when │         │ 20-30 total  │
│              │         │ loved 3+x    │         │              │
└──────────────┘         └──────────────┘         └──────────────┘
```

### Surface 1 — The App
Already specified in Parts 3, 4, 7. Drives generation, retention, monetization.

### Surface 2 — The Library (the moat)

Every saved itinerary lives at a clean URL: `/kelowna/itinerary/[slug]`.

**Quality gate**:
- New itineraries: `noindex, nofollow` by default. Not in sitemap.
- Promoted to `index, follow` when they cross the threshold: 3+ users marked the itinerary as "loved" in feedback.
- Demoted back to `noindex` if love rate drops below 50% over a 30-day window.
- Monthly automated audit: any indexed page with no traffic + no recent feedback gets re-evaluated.

This solves HCU risk by definition. The public library cannot contain garbage because garbage cannot accumulate "loved" ratings.

**Page structure** (every library page):
- H1: itinerary title
- Hero: hook line + total cost + duration + vibe pills
- Timeline: each stop with time, place, address, what to do, drive to next
- "Why this works" paragraph
- Map embed (or static map image with `Open in Google Maps` deep link)
- Total cost breakdown
- Backup options
- "Generate your own custom plan" CTA → into the app
- JSON-LD: `TouristTrip` + nested `LocalBusiness` for each stop

### Surface 3 — Pillar Pages

20–30 hand-crafted articles targeting high-intent queries. Each is a curated landing page that surfaces 5–10 public library itineraries + a primary CTA into the app.

**Initial 25 pillar pages**:

```
/kelowna/best-date-ideas
/kelowna/romantic-dates-under-100
/kelowna/things-to-do-tonight
/kelowna/rainy-day-dates
/kelowna/sunset-date-ideas
/kelowna/anniversary-dates
/kelowna/first-date-ideas
/kelowna/winter-date-ideas
/kelowna/cheap-dates-under-50
/kelowna/winery-tour-day-trips
/kelowna/things-to-do-this-weekend
/kelowna/west-kelowna-date-ideas
/kelowna/downtown-kelowna-date-ideas
/kelowna/lake-country-day-trips
/kelowna/naramata-day-trips
/kelowna/proposal-spots
/kelowna/birthday-date-ideas
/kelowna/double-date-ideas
/kelowna/best-restaurants-for-a-date
/kelowna/best-wineries-for-couples
/kelowna/best-sunset-spots
/kelowna/things-to-do-with-friends
/kelowna/solo-day-out
/kelowna/visiting-kelowna-perfect-day
/kelowna/spring-date-ideas (rotates: spring/summer/fall/winter)
```

**Page structure** (every pillar page):
- H1: the search query, mostly verbatim
- 3-paragraph intro that actually answers (no SEO fluff)
- 5–10 library itinerary cards, each linking to its `/kelowna/itinerary/[slug]`
- A "design your own" generator widget embedded mid-page
- FAQ section with `FAQPage` JSON-LD
- Last-updated date (auto, on any underlying itinerary update)

**Maintenance**: pillar pages auto-refresh their itinerary list weekly via ISR — best-loved itineraries bubble up. So pages stay fresh without us touching them.

### Technical execution

**On every public page**:
1. **JSON-LD structured data** — `TouristTrip` for itineraries, `LocalBusiness` for places, `ItemList` for pillar pages, `FAQPage` for FAQs, `Article` for pillar bodies.
2. **Server-rendered HTML** — Next.js SSR/ISR. No client-only content. Retrievers and Google see the full page on first request.
3. **Clean semantic HTML** — proper H1/H2/H3 hierarchy, real `<time>`, `<address>`, `<ol>` for timelines.
4. **Open Graph + Twitter cards** — every page renders a social card so screenshots and link previews look intentional.

**At the root**:
1. **`/sitemap.xml`** — auto-generated nightly. Includes only indexed pages.
2. **`/robots.txt`** — allow everything by default; explicit `Allow: /kelowna/`.
3. **`/llms.txt`** — emerging standard, machine-readable index of best content for LLM crawlers. Lists pillar pages + top 50 itineraries with one-line summaries.
4. **`/llms-full.txt`** — full-text dump of pillar pages for LLM training/retrieval.

### The flywheel

```
User generates plan in app
  → uses it on a real date
  → marks stops as "loved" in post-date feedback
  → if 3+ users love same itinerary → auto-promoted to public library
  → page added to sitemap, indexed by Google
  → Google sends a stranger searching "romantic Kelowna date under $100"
  → stranger lands on the public itinerary page
  → CTA: "generate your own custom plan"
  → stranger generates → uses → feedback → loop
```

This is the actual moat. Not the AI. The compounding loop where every used date makes the next stranger's search result better.

### Unit-economics impact

If 30% of generations come from organic search instead of paid social:
- Paid CAC for a date-planning user: estimated $4–8
- Organic CAC for same user: ~$0
- Blended CAC drops by ~25%
- Path to profitability shortens by months

This is the strategic reason to invest in content from day one. It's not a "nice to have" — it's the difference between needing funding and not.

### Sequencing (when to build which surface)

| Phase | Build | Why |
|---|---|---|
| Concierge MVP (week 1–2) | Manual itineraries → Instagram carousels | Test demand. Carousels also become library content later. |
| App MVP (week 3–4) | Generator + private saved itineraries | Get the engine running. |
| Library opens (month 2) | Public itinerary pages with quality gate | Once you have ~50 generations and ~10 pieces of feedback. |
| Pillar pages (month 3) | Hand-write 5 pillar pages, watch ranking | Don't write 25 at once. 5 → measure → 5 more → measure. |
| llms.txt + JSON-LD audit (month 3) | Lock down structured data | Easier with content already in place. |
| Scale pillars (month 4–6) | Expand to 25 pillar pages, add seasonal rotations | Compounds organically. |

### What to NOT do

- Don't auto-publish generated itineraries before quality validation. HCU will eat us.
- Don't write listicle filler ("10 things to do in Kelowna" with no actual recommendations).
- Don't keyword-stuff. Write for the human; the AI follows.
- Don't build a separate CMS. Itineraries and pillars live in Postgres + Markdown files in the repo.
- Don't try to game LLM training. We're optimizing for live retrieval, not training data.

---

## Part 14 — Final Opinionated Verdict

**The single sharpest version of this product to build**: a web app called **After5** that does exactly one thing — generate three perfect Kelowna date itineraries in 30 seconds, with real local places, real pairing logic, and a feedback loop that compounds. Launch with 100 hand-curated places, 10 templates, and a quality bar so high that the first 50 users feel compelled to text the screenshot to their partner.

**What will make or break it**: the *quality of the first 10 itineraries a user sees*. If they feel like they were written by a thoughtful local — not by ChatGPT — you have a product. If they feel like a Yelp list with timestamps, you don't. The hybrid system (curated DB + constrained LLM + pairing logic) exists entirely to defend that quality bar. Don't compromise on it for speed.

**The one thing to do tomorrow**: open a Google Doc, write the Part 6 itineraries from scratch in your own voice (don't copy mine — yours will be sharper because you live there). Post one as an Instagram carousel. DM the first three people who comment with "want me to plan one for you?". You don't need code yet. You need to know if real Kelowna couples will use this — and the only way to find out is to plan ten dates by hand this week.

---

## Appendix — Sources

**Competitor research**
- [5 Best AI Trip Planners Compared in 2025](https://www.sigmabrowser.com/blog/5-best-ai-trip-planners-compared-in-2025-whats-worth-your-time)
- [Wonderplan reviews](https://www.producthunt.com/products/wonderplan/reviews)
- [iPlan AI reviews](https://justuseapp.com/en/app/1611716564/iplan-ai-ai-travel-planner/reviews)
- [Wanderlog vs Roadtrippers comparison](https://www.wandrly.app/comparisons/wanderlog-vs-roadtrippers)
- [Wanderlog vs iMean](https://www.imean.ai/blog/articles/wanderlog-vs-imean-ai-travel-planner-comparison-2026-features-pros-cons/)
- [Dangers of AI travel planners (Copyleaks)](https://copyleaks.com/blog/the-dangers-of-using-ai-travel-planner)
- [The perils of using AI for travel planning (Rick Steves)](https://community.ricksteves.com/travel-forum/tech-tips/the-perils-of-using-ai-for-travel-planning)
- [HuffPost: AI travel fails](https://www.huffpost.com/entry/chatgpt-travel-plans-itinerary-trip_l_687107c9e4b00de383c0cf1f)
- [DUO date planner review (TheEverygirl)](https://theeverygirl.com/duo-app-review/)
- [Lovewick date night planner](https://lovewick.com/date-night-planner-app/)

**Kelowna places**
- [Tourism Kelowna — hidden gems](https://www.tourismkelowna.com/blog/stories/post/must-visit-hidden-gems-in-kelowna/)
- [Westside Wine Trail — date spots](https://www.thewestsidewinetrail.com/blog/fun-date-night-spots-in-west-kelowna)
- [Foodie Town — date night Kelowna](https://foodietown.ca/date-night-in-kelowna/)
- [Best hikes in Kelowna](https://explorethemap.com/best-hikes-kelowna/)
- [Kelowna nightlife guide](https://kelownaguide.com/kelowna-nightlife-bars/)
- [Best cocktail bars in downtown Kelowna](https://www.kelownarealestate.com/blog-posts/best-cocktail-bars-in-downtown-kelowna-a-locals-guide)
- [Top dessert spots in Kelowna](https://kelowna.com/articles/the-sweet-side-of-kelowna-top-dessert-spots-and-bakeries/)
- [Tourism Kelowna — paddleboards & rentals](https://www.tourismkelowna.com/experiences/active-outdoors/lake-activities/non-motorized-rentals/)

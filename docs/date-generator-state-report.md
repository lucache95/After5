# After5 — Date Generator: State of Reality (2026-06-08)

Written by Claude after live recon against the prod database, the deployed edge functions, and
the repo at `origin/main`. This is what the generator **actually is today**, not the roadmap.
Intended to be shared with ChatGPT for the strategy discussion.

---

## TL;DR

1. **The generator already exists, is live on prod, and is genuinely good — for Kelowna.** It is a
   constraint-first hybrid (code picks the venues, Claude only writes the words). 59 curated,
   active Kelowna venues + editorial "packs" (sunset date, classic-done-right, etc.).
2. **"Any city" does not work yet.** As of today the web UI silently returns a *Kelowna* date no
   matter what city you type. It's a one-line contract bug (details below), not a data problem.
3. **There is no events layer at all.** No Ticketmaster, Eventbrite, Yelp, OpenTable, Meetup,
   Viator. The generator only knows *permanent venues* + at-home templates.
4. **Weather and sunset are not live signals.** Venues carry a static `weather_dependent` flag and
   a `sunset_spot` category, but nothing fetches tonight's forecast or sunset time.
5. **⚠️ Correction to the ChatGPT plan: do NOT make Google Places the primary source.** Google's
   2026 Maps Platform ToS forbids storing Google content and feeding it to an LLM. That's the
   entire reason After5 just migrated to Foursquare. Google can only be a *live, display-only*
   layer. More below — this one matters legally.
6. **The marketplace loop is the part that's already shipped and proven.** v1.0 (create → browse →
   interest → match → chat → reveal → date) is live on prod and tagged. This strongly supports the
   "marketplace is the hero, Kelowna-only, good-enough dates" MVP instinct.

---

## 1. How the generator actually works

It is **not** "AI writes a date." It's a pipeline where the AI is the *last* layer — which is
exactly the architecture ChatGPT sketched, and it's already built this way:

```
Postgres pre-filter (geo / category / hours / price / season)   ← places-filter.ts
        ↓
Deterministic assembly + stochastic scoring                     ← scoring.ts
   (proximity hop-gate, quality_score, feedback_score, vibe match, season)
        ↓
Code validators (proximity / adjacency / budget / hours)        ← scoring.ts
        ↓
Claude writes ONLY the copy over FROZEN venue picks             ← prompt.ts (tool-use)
   (title, hook, why_it_works, what_to_do — never the places)
```

The important property: **the LLM never chooses venues.** It receives a locked set of place_ids and
writes prose. That's what makes the output trustworthy and cheap (~1¢, 2–4s on Sonnet 4.6). This is
the right design and it's done.

**Providers** (how a city's candidate venues are sourced):
- `kelowna` — the curated corpus (hand-filled hours/price/vibe). High quality.
- `onthefly` — warms a cold city from **Foursquare** on demand (live as of today).
- `fsq-seed` — background pre-seed of a city.
- `railway`, `pipeline`, `select` — orchestration/selection plumbing.

---

## 2. Data sources — what's wired vs. aspirational

| Layer | ChatGPT's model | After5 reality today |
|---|---|---|
| **Permanent venues** | Google + Foursquare + Yelp + OpenTable | **Foursquare = live, compliant corpus** (just cut over + validated against the live API). 59 curated Kelowna venues. Google = **relabeled `google_legacy` and EXCLUDED** from the LLM pool as of today (compliance). No Yelp, no OpenTable. |
| **Events** | Ticketmaster, Eventbrite, Meetup, FB Events | **None. Zero.** Biggest greenfield. The generator cannot put "live comedy show" or "wine tasting tonight" into a date because it has no event inventory. |
| **Activity providers** | Viator, GetYourGuide, Airbnb Exp, tourism APIs | **None.** |
| **Contextual data** | Weather, sunset, holidays | **Partial / static only.** `weather_dependent` is a per-venue boolean (no live forecast). `sunset_spot` is a venue *type* and there's a "sunset date" editorial pack, but **no live sunset-time API**. Season is derived from the current month. No holiday calendar. |
| **Proprietary interaction data** | saves / matches / completions / feedback | **Partially instrumented already** via the v1.0 marketplace: `date_instances`, `match_ratings`, reliability scoring, feed save signals all exist. The flywheel data ChatGPT describes is *already being captured* — it's not hypothetical. |

**Takeaway:** the generator is strong on permanent-venue selection for a curated city, has the moat
data plumbing started, and is completely empty on events + live context. Events is the single
highest-leverage thing missing if the goal is "dates a local would actually recommend."

---

## 3. ⚠️ The Google compliance landmine (read this before following the 5-layer plan)

ChatGPT's advice — *"Google Places… Must have… should probably become your primary source"* — is
**backwards for an LLM product**, and this is the most important correction in this document.

- Google's **2026 Maps Platform ToS (§3.2.3)** forbids: (a) storing Google Maps Content beyond a
  bare `place_id`, and (b) feeding Google Maps Content into an LLM or generating content from it.
- After5's *entire* v2.0 venue-data effort exists to get **off** Google as the stored/LLM-fed
  corpus. **Foursquare's license explicitly permits** fetch + store-forever + LLM-input + display.
- Google is still usable — but only as a **live, display-only layer** keyed by `google_place_id`
  (show a rating/photo at view time, never cache it, never send it to the model).

So the corrected Layer 1 is: **Foursquare = primary stored/LLM corpus. Google = optional live
display only. Yelp/OpenTable = check their LLM-licensing terms before storing anything.** Making
Google primary would re-introduce the exact legal exposure we just spent a milestone removing.

---

## 4. Coverage outside Kelowna — the honest answer

**It doesn't work yet, and here's the precise reason** (found today during the Foursquare cutover
smoke test):

- The web create flow (`CreateFlow.tsx`) sends `city_query: "Portland, Oregon"` but **no
  `city_slug`**.
- The edge function defaults `city_slug` to `'kelowna'`, finds the Kelowna row, and takes the
  curated branch — **`city_query` is never read** (`index.ts:196`).
- Result: typing any city returns a Kelowna date. Kelowna works *by accident* (its slug is the
  default). A live test for Portland returned 200 OK, wrote **0 Foursquare rows**, and produced a
  Kelowna itinerary ("Okanagan Beach Rentals", "Exit Kelowna").

Second, smaller issue: even once routing is fixed, the open-city **geocode still calls Google**
(`open-city.ts`), not Foursquare — a residual compliance gap. Foursquare's `geocodeCity` is already
written and ready to drop in.

Both are **wiring bugs, not capability gaps.** The Foursquare corpus, scoring, validators, and
copy-writing all work. The city portability is ~2 small fixes + a test away from real. So:
"any city" is closer than it looks, but it is **not true today** — anyone who says the generator
works nationally right now is wrong.

---

## 5. What's genuinely good right now

- **Kelowna generation is real and high-quality.** Curated venues, editorial packs, proximity
  hop-gating so stops are actually walkable/drivable, season awareness, sunset-spot theming.
- **The architecture is correct** (AI as the final layer, never the selector). No rebuild needed.
- **An eval harness exists** — deterministic quality gates + an Opus judge over a golden set,
  including a *cold-city* fixture, with `unverified_rate` surfaced per city, CI-gated. This is
  unusually mature for an MVP-stage generator.
- **Improve loop works** — single-stop swap + natural-language tweaks (Haiku) in the create UI.
- **Fail-loud guards** — the data-quality guards now error on missing hours/coords instead of
  silently passing (so a thin cold-city corpus can't fake a green result).

---

## 6. On the strategic fork (generator-as-hero vs marketplace-as-hero)

The code reality lands hard on **one** side of this, and it agrees with ChatGPT's instinct:

- **The marketplace loop is the part that's finished and proven on prod** (v1.0, tagged). Create →
  browse → interest → match → chat → progressive reveal → date all work, with trust/safety
  (reliability, reports, no-show handling) shipped.
- **The generator's "amazing dates anywhere" ambition is the half-wired part** (events missing,
  any-city bug, no live context).

So "spend 60 days on the loop, not the generator" is not just a strategy preference — it's the path
of *least* remaining work, because the loop is already done and the generator-as-universal is the
thing that would eat 6 months. For an MVP you do **not** need amazing dates in every city; you need
**good-enough dates in Kelowna**, which you already have.

**Concrete recommendation for MVP:**
1. **Kelowna only.** Use the curated generator (it's good) + allow human/curated nights. Don't gate
   on "the generator is amazing everywhere."
2. **Fix the two any-city wiring bugs anyway** — they're cheap, and they unlock "type any city →
   get *something*" as a soft capability without committing to quality everywhere. But don't
   *market* national coverage until the cold-city eval is green.
3. **Defer events (Ticketmaster/Eventbrite) to post-traction.** They're the best *upgrade*, but they
   don't change the MVP hypothesis ("will people match around experiences?").
4. **Let the loop generate the moat data.** Saves/matches/completions are already captured; that's
   the dataset that eventually makes the generator hard to copy — and you only get it by running
   the marketplace, exactly as ChatGPT said.

**Sequencing the 5 layers, corrected for reality:**
- *Have:* Foursquare venues (compliant), Kelowna curation, season, proprietary loop data (started).
- *Tier 1 next (cheap, high impact):* live **weather** + **sunset** APIs (turn the static flags
  into real context), and finish **any-city** routing.
- *Tier 2 (the real upgrade, post-traction):* **Eventbrite** then **Ticketmaster** — this is what
  makes a date a *happening* instead of two restaurants.
- *Tier 3:* OpenTable (reservation availability), tourism APIs.
- *Moat:* completion-rate-by-combination from the loop data you're already collecting.

---

## 7. One-paragraph version for ChatGPT

The generator is a constraint-first hybrid (code picks venues, AI writes copy) that's live and
genuinely good for Kelowna, just migrated onto Foursquare as a license-compliant corpus, with a
real eval harness — but it has **no events/weather/sunset live data** and its "any city" path is
currently broken by a one-line contract bug (the UI returns Kelowna for every city). The
marketplace loop, by contrast, is fully shipped and proven on prod. So the MVP move is clearly
"marketplace-as-hero, Kelowna-only, good-enough dates," with events as the marquee post-traction
upgrade — and one hard correction: **Google cannot be the primary source** (2026 Maps ToS forbids
storing it / feeding it to an LLM), which is why Foursquare is primary and Google is display-only.

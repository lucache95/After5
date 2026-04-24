# Venue Ingestion & Vetting Pipeline — External Research

> External research (April 2026) on data sources, vetting patterns, imagery, and multi-city scaling. Pricing assumes ±10%; re-verify before signing.

## 1. Data sources (compared)

### Google Places API (New) — the enrichment backbone, NOT the seed

**SKU-tiered pricing** (per 1,000 requests):

| SKU | Free/mo | Base | At 5M+ |
|---|---|---|---|
| Place Details Essentials | 10k | $5.00 | $0.38 |
| Place Details Pro | 5k | $17.00 | $1.28 |
| Place Details Enterprise | 1k | $20.00 | $1.51 |
| Place Details Ent+Atmosphere (rating, hours, price) | 1k | $25.00 | $2.28 |
| Nearby Search Pro | 0 | $32.00 | $2.40 |
| Text Search Ent+Atmosphere | 0 | $40.00 | $3.40 |
| Place Photos | 0 | $7.00 | $0.53 |

**Tier determined by requested fields, not a plan.** Asking for `displayName + location + types` = Essentials. Add `rating` or `regularOpeningHours` = Enterprise on the whole call.

**Legal critical:**
- `place_id` is the **only** field exempt from caching restrictions. Store indefinitely as your canonical join key.
- Everything else (hours, photos, reviews, ratings): **no pre-fetch, no long-term cache**. Re-fetch before display.
- Photos: `photoUri` **expires**, cannot be cached/downloaded/re-hosted. Fetch per display. Must show `authorAttributions` when present.
- $200/mo universal credit **ended Feb 28, 2025**.

**Implication**: Google Places = live-fetch enrichment layer, NOT a licensable seed dataset.

### Foursquare OS Places — free bulk seed

- Apache 2.0 licensed, 100M global POIs, monthly refresh.
- GeoParquet on S3, queryable with DuckDB.
- Core attrs only: name, coords, categories, address. **No photos, hours, reviews.**
- Best-in-class free seed for new cities.

### Overture Maps Places — legally clean bulk seed

- Backed by Meta/MS/Amazon/TomTom. CDLA Permissive v2.0 (no share-alike).
- ~59M POIs, monthly releases. Multilingual, confidence scores, source provenance.
- No photos, hours, prices — pure entity layer.
- **Pair with Foursquare OS for dedupe + coverage**.

### Foursquare Places API (live)

- Pro endpoints: 10k free/mo drops to **500 free/mo on June 1, 2026**, then $15/CPM down to $1.25 at 5M+.
- Premium (Photos/Tips/Hours): **no free tier**, $18.75/CPM.

### Yelp — skip

- Free ended 2019. Now $7.99–$14.99 per 1k calls, 5k free during 30-day trial only.
- Image/review redisplay restricted, aggressive TOS enforcement.
- Only useful as dedupe/quality cross-check signal.

### TripAdvisor Content API

- 5k/mo free, pay-as-you-go beyond. Credit card at signup.
- 7.5M locations, 1B reviews. Attribution badge + link-back **required**.
- Strong for attractions/hotels; weak for indie bars/cocktail lounges.

### OSM + Overpass

- Free, ODbL (attribution on display).
- Great for parks, trails, viewpoints, benches. Sparse for indie/hours/photos.
- Self-host Overpass for production use (public endpoint rate-limits aggressively).

### Events layer

- **Ticketmaster Discovery API** — 5k/day free, sane rate limits. Best events API. **Use this.**
- **SeatGeek** — free with key. Complements Ticketmaster (different inventory tilt).
- **Eventbrite public search** — shut down Feb 2020. Retrieval-only now (need to know organizer).
- **Meetup** — free GraphQL, declining volume. Nice-to-have.

### Bookings — deep-link only

- **OpenTable** — partner API gated (weeks-months of approval).
- **Resy** — enterprise sales only, no public docs.
- **Pragmatic**: deep-link to opentable.com/r/... and resy.com/cities/... . Zero API friction, affiliate revenue available.

### Niche

- **AllTrails** — no API, DataDome-protected, scraping legally risky. Let users link URLs manually.
- **Atlas Obscura** — no API. Scrape metadata (legal) but don't copy prose/images.
- **City open data portals** — NYC, Chicago, SF, LA, Austin, Seattle, Boston all have Socrata SODA APIs. Restaurant grades, inspection scores, permits = great trust/dedupe signal.
- **Tourism boards** — most will send you a curated "best of" spreadsheet on request. Visit Philly, VisitNC, LA Tourism actively distribute.

### Recommended stack

1. **Seed**: Overture + Foursquare OS (free, ~100M POIs deduped)
2. **Enrich**: Google Places at display-time (photos, hours, rating) for top-N per city
3. **Events**: Ticketmaster + SeatGeek
4. **Bookings**: deep-link OpenTable/Resy
5. **Supplement**: OSM for parks/trails/viewpoints

## 2. Vetting patterns

### Detecting closed businesses

**Primary: Google Places `business_status`** — `OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY`. Weekly batch refresh, changes flip `needs_review` flag.

**Stacked signals (composite staleness score):**
1. Website HTTP status (HEAD request; 4xx/5xx for 14+ days = signal)
2. Last-review recency (>180d bars/restaurants, >365d attractions)
3. Review sentiment drift (spike in "closed/boarded/out of business" keywords)
4. Social activity (IG 404, no posts 90+ days)
5. Phone disconnect (Twilio lookup)
6. Domain WHOIS expiry

Production apps require **2+ bad signals** before auto-closing (avoids false positives from seasonal/rebrand).

### Deduplication

**Canonical IDs:**
- **Placekey** (free, SafeGraph) — universal POI identifier from name+address+coords. Purpose-built for this.
- Google `place_id` — strong secondary but Google warns same place may have multiple, IDs may change.

**Fuzzy matching stack:**
- Block by H3 cell resolution 9 (~170m)
- Name: RapidFuzz token_set_ratio (strip "The/Bar/Restaurant"), threshold ~85
- Coords: Haversine < 50m
- Address: libpostal normalize + Levenshtein
- Phone: last-10 digits
- Composite: 0.4·name + 0.3·address + 0.2·coords + 0.1·phone
- Auto-merge >0.92; human queue 0.7–0.92; drop <0.7

**Library**: Python `dedupe` (dedupeio) — probabilistic, active-learning, ~10 labeled pairs to train.

### Human-in-the-loop review

Pattern:
1. Ingest + auto-detected changes feed queue
2. LLM classifier tags each (auto-approve / needs-review / reject) with confidence
3. Queue UI: task-assigned per reviewer, batches of 8, keyboard shortcuts
4. Decisions feed active learning

**Tools:**
- **Retool / Appsmith** — review queue UI in an afternoon against Supabase
- **Argilla** (OSS) — purpose-built for LLM-labeled data review
- Early: filtered Supabase table + Studio is enough

## 3. Image sourcing + legality

### Google Places Photos

- Enterprise SKU, $7/1k
- **Cannot cache `photoUri`** (expires), cannot download + re-host
- **Must re-fetch** from Place Details each display
- `authorAttributions` mandatory when present
- 100k DAUs × 3 photo views/day ≈ 9M calls/mo ≈ ~$1,200/mo

### Unsplash — attribution required via API

- General license: no attribution needed
- **API License stricter**: photographer name + profile link + Unsplash credit mandatory
- Must fire download tracking endpoint when photo used
- Demo: 50/hr; Production (approved): 5k/hr

### Pexels — simpler

- Free commercial, **no attribution required**
- 200/hr, 20k/month default
- Smaller catalog (~1M vs Unsplash ~5M)

### Pinterest — skip

- API is ads/marketers-only, own-account pins only
- TOS explicitly forbid scraping
- Skip entirely.

### Instagram — effectively off

- **Basic Display API shut down Dec 4, 2024**
- Graph API = Business/Creator accounts that authorized your app only
- Realistic: venue owner connects their IG Business → you pull their posts. Per-venue manual onboarding.
- Not viable for mass ingestion.

### Scraping venue websites for og:image — viable

- US legal: scraping public content is lawful (hiQ v. LinkedIn, Meta v. BrandTotal)
- og:image is **designed for redisplay** — iMessage/Slack use it for previews
- Respect robots.txt, labeled User-Agent, rate-limit
- Hot-link (safer) vs proxy+cache (faster). Middle: proxy w/ `Cache-Control: public, max-age=86400`, attribute source domain.
- **Firecrawl or Playwright** can pull og:image + og:description in bulk.

### AI generation (FLUX on Replicate)

**Usage policy:**
- **Never** represent a *specific* business with AI imagery (users detect, trust craters).
- **Do** use AI for:
  - Collection/vibe covers ("Cozy wine bars in the West Village")
  - Placeholder while real photos queue
  - Scene setters ("Dinner + jazz")
  - Category thumbnails
- FLUX.2 now available on Replicate — consider migration for cover realism.
- EU AI Act Article 50 disclosure: add discreet "AI-generated" metadata.

## 4. Multi-city scaling

### How incumbents do it

- **The Infatuation**: 2–3 local editors/city, ~30-spot Hit List → 300–500 reviews over 12mo. Quality gate so high coverage stays narrow.
- **Resy**: Editorial + reservation graph. Flagship partners sign up → content franchises populate. Backed by Amex.
- **TimeOut**: 333 cities, local editors per city, top-down editorial. Deliberate market selection.
- **Atlas Obscura**: UGC with editorial moderation. Each submission requires sources + licensed photos.

### The After5 hybrid playbook

**Week -1 (pre-launch):**
- Pull Overture + FSQ OS for metro bounding box. Dedupe → typically 10k–40k POIs per major US city.
- Auto-categorize with LLM pass (vibe, date-tier) from OSM tags + name.
- Email city tourism board for their curated best-of list.
- Hire 1 local part-time curator ($20–40/hr, ~10hrs/wk).

**Day 0:**
- Top 50 "hit list" editorialized + cover imagery done.

**Week 1:**
- Top 200 enriched with Google Places (hours, photos, ratings).

**Week 2:**
- Ticketmaster + SeatGeek events integrated, city-scoped.

**Month 1:**
- Curator adds 100/week. Staleness loop running weekly.

**Month 3:**
- User submissions + UGC photos dominant for top venues.

## 5. Tech stack recommendations

### Scraping

- **Firecrawl** — $16–$333/mo, $0.0008/page at scale. JSON-schema-to-output. Best for: venue-website → structured data.
- **Apify** — compute-unit pricing. Best for: pre-built actors (AllTrails, Yelp, AO scrapers exist).
- **Exa** — $49/8k credits. Best for: semantic discovery queries ("weekend-only cocktail bars with Japanese whisky in Brooklyn").

**Recommend**: Firecrawl for scrape, Exa for occasional discovery.

### Orchestration

- **Inngest** — event-driven step functions, TS-native. Best fit for After5 given Supabase + Deno. Steps independently retryable (great for flaky Google Places). Cron + events.
- **Trigger.dev v3** — serverless TS, no timeout limits. Also good.
- **Temporal** — overkill for current scale.

**Recommend**: **Inngest**. Ingest is event-shaped, integrates cleanly with Supabase functions.

### Semantic search

- **pgvector on Supabase** — you already have Postgres
- Embed venue doc (name + categories + description + review-summary + vibe tags) with OpenAI `text-embedding-3-small` ($0.02/1M tokens)
- Query: "cozy wine bar" → embed → `ORDER BY embedding <=> query_embedding LIMIT 20`
- Hybrid: structured filters (`WHERE city_id = ? AND price_level <= 2`) + semantic rank
- **Cohere Rerank** for top-20 refinement (+50ms, big quality boost for vibe queries)

**Two-vector pattern:**
- `venue_embedding` — what kind of place
- `date_context_embedding` — what kind of date (first-date, impress-the-parents, rowdy)
- Average with weights at query time

## Key decisions

1. **Data**: Overture + FSQ OS (seed, free) → Google Places (enrichment, live-fetch, `place_id` as canonical) → Ticketmaster (events) → UGC (long-term). **Skip Yelp.**
2. **Photos**: Google Places at display-time + Unsplash/Pexels fallback + FLUX for collection covers + UGC long-term. **Drop Pinterest/Instagram plans.**
3. **Freshness**: Weekly `business_status` cron → LLM triage → human queue. Composite staleness score drives priority.
4. **Dedupe**: Placekey canonical, Google `place_id` secondary, `dedupe` library for probabilistic.
5. **Orchestration**: Inngest.
6. **Semantic search**: pgvector + OpenAI embeddings + Cohere Rerank when quality matters.
7. **New-city playbook**: Bulk seed → tourism board → 1 curator → top-200 enriched → UGC loop. 4–6 weeks per city.

# Backlog

Future ideas worth doing — but not yet. Each entry: what, why later not now, questions to resolve when picking it up.

---

## Affiliate add-ons (Amazon Creators API + others)

**What**: Optionally recommend a product that fits the itinerary naturally. Picnic date → blanket. Stargazing → thermos. Journaling date → journal. Affiliate revenue, secondary monetization, framed as "optional add-on" / "nice touch" — never as advertising.

**Why later, not v1**: A bad itinerary is survivable. A good itinerary that feels like an ad is not. Trust is the most fragile thing about the app. Don't ship affiliate links until the core itinerary quality is undeniable AND the matching layer is genuinely good.

**Why this could work for After5 specifically**:
- Date plans naturally have "moments" that pair with objects (picnic blanket, journal, portable speaker, instant camera)
- The user is already in a planning mindset — receptive to a small enhancement
- Single optional add-on per itinerary keeps the noise floor low
- Amazon Associates is the lowest-friction starting point (and CRA's CASL allows clear disclosure)

**Compliance non-negotiables** (from Amazon Associates terms):
- Use API-returned URLs verbatim — never edit affiliate URL parameters
- Display "As an Amazon Associate I earn from qualifying purchases" near the affiliate area
- Tag affiliate links with `rel="sponsored nofollow"` per Google guidelines
- Use Canadian Associates account + Canadian marketplace links (.ca) for Canadian users
- "Paid link" or "#ad" disclosure inline next to the link

**Important context for whoever builds this**:
- Amazon's old Product Advertising API 5.0 deprecates **April 30, 2026** — already past. Use **Creators API** (newer, Amazon-recommended successor).
- Affiliate access is marketplace-specific (.ca for Canada vs .com for US). Most After5 users will be Canadian for years.
- Commissions on most categories are 1–4%. Modest revenue. Don't lean on this as primary monetization — keep subscription as the moneymaker.

**When to pick this up**: not before Phase 5 (public library + SEO). Once we have:
- 100+ generated plans living publicly with real users using them
- Feedback loop showing which itineraries get loved most
- Clear sense of which "moments" within itineraries get the most engagement

Then we can identify the 3–5 itinerary patterns where add-ons would actually feel useful, build the matching layer for those, and ship narrow.

**Architecture sketch (when we build it)**:

```
products
  id, asin (Amazon), source ('amazon_ca' | 'amazon_com' | 'rei' | ...),
  title, description, image_url, affiliate_url,
  price_low, price_high, last_checked_at, last_seen_in_stock,
  tags text[]   -- e.g. {picnic, blanket, outdoor, summer}

itinerary_product_matches
  itinerary_id (or template_id), product_id, fit_score,
  reasoning, displayed_count, click_count, conversion_count
```

Match rules: a product is shown only if (a) at least 2 user tags overlap with product tags, (b) product price < itinerary total cost × 0.5 (so it doesn't feel disproportionate), (c) at most 1 add-on per itinerary, (d) add-on appears in a clearly-labelled secondary surface — never inline in the timeline.

UX label options: "Optional add-on", "Bring this along", "Nice touch". Never "Buy now", "Sponsored", "Recommended product".

**The 10 questions for Claude to answer when we pick this up**:
1. Best UX surface (where in the itinerary card? sidebar? after-feedback email?)
2. Show-vs-don't-show heuristic specifics
3. Best product categories to start with (mapped to which itinerary patterns)
4. Tag taxonomy that maps cleanly between itinerary tags and product tags
5. How user feedback (loved / skipped the add-on) tunes future matching
6. Monetization without trust damage — when does an add-on cross from helpful to spammy?
7. UX labelling — A/B candidates and what we test first
8. Risks of overuse (concrete failure modes, not abstract)
9. Multi-affiliate architecture from day one (Amazon → REI / MEC / local outdoors gear)
10. Lightweight schema (above is a sketch — refine when ready)

**Captured**: 2026-04-19 (during Phase 2 scaffold, parked for later)

---

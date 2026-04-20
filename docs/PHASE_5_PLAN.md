# Phase 5 — Public Library + SEO

> The compounding traffic engine. Every plan that gets loved 3+ times becomes a public, SEO-indexed page. Every pillar page surfaces those plans. Strangers search "romantic Kelowna date under $100" → land on a real validated plan → generate their own → loop.

## Goal

A user searching Google or Perplexity for "best Kelowna date ideas" lands on After5. Within 3 months of launch, organic search drives 30%+ of new generations.

## Architecture

```
                    ┌──────────────────────────────────────┐
                    │  itineraries.is_public flag          │
                    │  ───────────────────────────────────  │
                    │  pg_cron job (hourly):               │
                    │    set is_public = true              │
                    │    where loved_count >= 3            │
                    │      and total_skipped < loved_count │
                    │      and (manual_override is not 'block') │
                    └──────────┬───────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────────┐
        │                      │                          │
        ▼                      ▼                          ▼
 /sitemap.xml          /kelowna/itinerary/[slug]      /kelowna/[pillar]
 lists every is_public  ISR-rendered, JSON-LD,         hand-crafted SEO
 itinerary + pillar     OG image per plan, full       articles surfacing
 page                   timeline, CTA to /plan         5-10 library plans
                                                          + CTA to /plan
```

## Prerequisites

| # | Thing | Status |
|---|---|---|
| 1 | Phase 4 complete (need feedback data flowing in to drive `loved_count`) | blocking |
| 2 | At least 30 days of generations + feedback to seed library | timing |
| 3 | Decision on URL structure: `/kelowna/itinerary/[slug]` vs `/i/[slug]` | recommend `/kelowna/itinerary/[slug]` for SEO keyword density |
| 4 | Decision on slug strategy: title-derived (`/kelowna/itinerary/sunset-wine-and-bistro`) vs UUID (`/i/[uuid]`) | recommend slug for shareability + SEO |

## Decisions to lock

- **Quality gate**: itineraries auto-promote when `loved_count >= 3 AND loved_count > skipped_count`. Demote if love rate falls below 50% over 30 days.
- **URL structure**: `/kelowna/itinerary/[slug]` for indexed plans. The existing `/plan/i/[uuid]` route stays for fresh/private shareable links (noindex).
- **Slug**: `slugify(title)` + UUID suffix to avoid collisions: `/kelowna/itinerary/sunset-wine-and-bistro-a3f1`.
- **Public library landing**: `/kelowna` is the index, surfaces top 30 by loved_count. Pillar pages are subpages of `/kelowna`.
- **Pillar page count for v1**: ship 5, watch ranking, then expand to 25 over month 4-6.
- **OG images**: dynamic per itinerary using Next.js OG image API. Title + first stop name + sienna accent.

## Tasks (in order)

### 5.1 Data model + auto-promotion

| # | Task | Acceptance |
|---|---|---|
| 1 | Migration: add `slug text unique` to itineraries; add `loved_count int default 0`, `skipped_count int default 0` if not already there; add `manual_override text check ('boost', 'block', null)` | Schema applied |
| 2 | Trigger or app-side: on submit-feedback, recompute `loved_count = (select count(*) from feedback where itinerary_id = ... and loved_place_id is not null)`. Same for skipped_count. | Verify SQL after submit |
| 3 | pg_cron job `auto_promote_itineraries`: hourly, sets `is_public = true` where loved_count >= 3 AND loved_count > skipped_count AND manual_override IS NOT 'block' | Cron lists job |
| 4 | pg_cron job `auto_demote_itineraries`: daily, sets `is_public = false` where 30-day love rate < 50% | Cron lists job |
| 5 | When auto-promoting, generate slug if not set: `slug = slugify(title) || '-' || substr(id, 0, 4)` | Verify SQL |

### 5.2 Public itinerary route (replaces noindex on /plan/i)

| # | Task | Acceptance |
|---|---|---|
| 1 | Build `/app/kelowna/itinerary/[slug]/page.tsx` — server component with ISR (`revalidate = 3600`) | Page renders with full SSR HTML |
| 2 | Page sets `metadata.robots = { index: true, follow: true }` ONLY if `is_public = true`; else `noindex` | curl + grep robots meta |
| 3 | Build `app/kelowna/itinerary/[slug]/opengraph-image.tsx` — Next.js dynamic OG image. Renders title + first stop + sienna accent on off-white | Hitting `/kelowna/itinerary/[slug]/opengraph-image` returns 1200x630 PNG |
| 4 | Add JSON-LD `TouristTrip` script tag with nested `LocalBusiness` for each stop. Use `application/ld+json` script. | Run through Google's Rich Results Test → passes |
| 5 | Update `/plan/i/[id]/page.tsx` — if itinerary is public, 308 redirect to `/kelowna/itinerary/[slug]` | curl follows redirect |

### 5.3 Pillar pages

| # | Task |
|---|---|
| 1 | Build `app/kelowna/page.tsx` — library index showing top 30 public itineraries by loved_count. Hero: "Plans Kelowna couples actually loved." 6-column dense grid with vibe filter pills. |
| 2 | Build `app/kelowna/[pillar]/page.tsx` — dynamic pillar page route. Pillar metadata stored in `pillars.ts` (hand-curated). Each page: SEO H1, 3-paragraph intro, 8-10 surfaced library plans matching the pillar's filters, FAQ section with FAQPage JSON-LD, embedded /plan generator widget mid-page. |
| 3 | Write 5 starter pillar files in `app/kelowna/_pillars/`: best-date-ideas, romantic-dates-under-100, free-date-ideas, sunset-date-ideas, rainy-day-dates |
| 4 | Each pillar surfaces plans via filters: vibe overlap, price tier, season, weather. |

### 5.4 SEO infra

| # | Task | Acceptance |
|---|---|---|
| 1 | `app/sitemap.ts` — auto-generate from is_public itineraries + pillar pages | Hit `/sitemap.xml` → valid XML, only public URLs |
| 2 | `public/robots.txt` — allow all under `/kelowna/`, disallow `/plan/` | File present |
| 3 | `app/llms.txt` — emerging standard, lists the brand + top 50 itineraries with one-line summaries for LLM crawlers | Validates against the spec |
| 4 | `app/llms-full.txt` — full text dump of pillar pages for retrieval AI | File present |
| 5 | Submit sitemap to Google Search Console + Bing Webmaster Tools | GSC dashboard shows "Discovered" |
| 6 | Add canonical link tags on all `/kelowna/*` pages | View source confirms |

### 5.5 Pillar template structure

```
/kelowna/[pillar]/
  ├── H1: query as written ("Best date ideas in Kelowna")
  ├── Intro: 3 paragraphs, ~200 words, answers the search intent
  ├── 5-10 surfaced library cards (filters applied)
  ├── Embedded /plan widget — "Or generate a custom one"
  ├── 4-question FAQ (with FAQPage JSON-LD)
  ├── Last-updated timestamp (auto, on any underlying itinerary update via ISR)
```

## Schema changes

```sql
-- 5.1
alter table itineraries
  add column slug text,
  add column loved_count int default 0,
  add column skipped_count int default 0,
  add column manual_override text check (manual_override in ('boost', 'block')),
  add column promoted_at timestamptz,
  add column demoted_at timestamptz;

create unique index uq_itineraries_slug on itineraries (slug) where slug is not null;
create index idx_itineraries_public_loved on itineraries (loved_count desc) where is_public = true;

-- 5.1 cron job (run via supabase functions or pg_cron)
create or replace function promote_loved_itineraries() returns void
language plpgsql as $$
begin
  update itineraries
  set is_public = true,
      promoted_at = now(),
      slug = coalesce(slug, regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g') || '-' || substr(id::text, 1, 4))
  where loved_count >= 3
    and loved_count > skipped_count
    and (manual_override is null or manual_override = 'boost')
    and is_public = false;
end;
$$;

select cron.schedule('promote-loved', '0 * * * *', $$select promote_loved_itineraries()$$);
```

## Cost

- pg_cron: free
- ISR + sitemap: free on Vercel up to 100k unique pages/mo
- Dynamic OG images: ~free, first 100k/mo on Vercel
- No new external services

## Acceptance for the whole phase

```bash
# After full phase + 30 days of real usage:
curl -sI https://after5.app/sitemap.xml | grep -E 'HTTP|Content-Type'
# → HTTP/2 200, Content-Type: application/xml

# At least 5 indexed itineraries:
curl -sS https://after5.app/sitemap.xml | grep -c '<url>'
# → at least 10 (5 pillars + 5+ public itineraries)

# Pillar pages return JSON-LD:
curl -sS https://after5.app/kelowna/best-date-ideas | grep -c 'application/ld+json'
# → at least 2 (Article + FAQPage)

# Google Rich Results Test passes for a public itinerary
# Google Search Console shows: at least 1 page indexed
```

## Risks

- **Helpful Content Update**: if any auto-promoted itinerary is mediocre, it tanks our domain authority. Mitigation: 3+ loved gate is high; manual_override='block' lets us yank any bad one.
- **Slow indexing**: Google takes 2-8 weeks to fully index a new domain. Mitigation: GSC submission + backlinks from r/kelowna + Tourism Kelowna.
- **Pillar page cannibalization**: too many pillar pages targeting overlapping queries. Mitigation: 5 to start, each with distinct primary keyword. Watch GSC clicks before adding more.
- **Stale public pages**: a place closes, pages become wrong. Mitigation: ISR revalidates hourly; admin can mark places `is_active = false` and the auto-job will demote affected itineraries.

## Estimated time

- 5.1 Auto-promotion: 4 hr
- 5.2 Public route + JSON-LD + OG images: 6 hr
- 5.3 Pillar pages (5 of them): 8 hr (1.5 hr each + shared template)
- 5.4 SEO infra: 4 hr
- **Total: ~22 hr** (~3 work days)

## What this unlocks

- **Free traffic that compounds.** Each plan loved 3+ times becomes a permanent SEO asset.
- **Trust signals.** "Real plans real Kelowna couples actually used" beats generic listicles.
- **Retrieval-AI citations.** With JSON-LD + llms.txt, Perplexity/Claude/ChatGPT-Search start citing us instead of genericlists.
- **Organic CAC reduction.** When 30% of traffic is organic, blended CAC drops ~25% — the path to profitability shortens by months.

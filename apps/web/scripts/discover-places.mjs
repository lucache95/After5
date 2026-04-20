// Discover Kelowna places via Google Places (New) + LLM augmentation.
//
// Workflow:
//   1. For each predefined search query, hit Places searchText
//   2. Skip results we already have (by google_place_id)
//   3. Pull full Place Details (photos, reviews, hours, etc.)
//   4. Map Google fields → our schema
//   5. Ask Claude (haiku — fast + cheap) to write the subjective fields:
//      vibe_tags, pairing_tags, local_insight, typical_duration_min, etc.
//   6. Insert as approval_status='draft'
//   7. Print a CSV summary for human review
//
// Run: node scripts/discover-places.mjs
// Then review drafts via /admin/places (or SQL) and run promote-drafts.mjs.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET || !GOOGLE_KEY || !ANTHROPIC_KEY) {
  console.error('Missing one of: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, GOOGLE_PLACES_API_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

// Search queries grouped by intent. Limit per query keeps costs in check
// and prevents one category from dominating the catalog.
const QUERIES = [
  // Already-strong categories (top-up)
  { q: 'restaurant Kelowna BC',          limit: 5 },
  { q: 'cafe Kelowna BC',                limit: 5 },
  { q: 'cocktail bar Kelowna BC',        limit: 5 },
  { q: 'craft brewery Kelowna BC',       limit: 5 },
  { q: 'winery Kelowna BC',              limit: 5 },
  { q: 'bakery Kelowna BC',              limit: 4 },
  { q: 'dessert shop Kelowna BC',        limit: 3 },
  // Outdoor / view
  { q: 'hike Kelowna BC',                limit: 5 },
  { q: 'beach Kelowna BC',               limit: 5 },
  { q: 'viewpoint Kelowna BC',           limit: 4 },
  { q: 'park Kelowna BC',                limit: 4 },
  { q: 'garden Kelowna BC',              limit: 3 },
  // Experiences (the big gap)
  { q: 'escape room Kelowna BC',         limit: 4 },
  { q: 'axe throwing Kelowna BC',        limit: 3 },
  { q: 'pottery class Kelowna BC',       limit: 3 },
  { q: 'paint and sip Kelowna BC',       limit: 3 },
  { q: 'mini golf Kelowna BC',           limit: 3 },
  { q: 'bowling Kelowna BC',             limit: 3 },
  { q: 'arcade Kelowna BC',              limit: 3 },
  { q: 'VR experience Kelowna BC',       limit: 3 },
  { q: 'rock climbing gym Kelowna BC',   limit: 3 },
  { q: 'kayak rental Kelowna BC',        limit: 3 },
  { q: 'paddleboard rental Kelowna BC',  limit: 3 },
  { q: 'horseback riding Kelowna BC',    limit: 3 },
  { q: 'art gallery Kelowna BC',         limit: 4 },
  { q: 'museum Kelowna BC',              limit: 3 },
  { q: 'live theater Kelowna BC',        limit: 3 },
  { q: 'comedy club Kelowna BC',         limit: 2 },
  { q: 'karaoke Kelowna BC',             limit: 3 },
  { q: 'spa Kelowna BC',                 limit: 4 },
  { q: 'cooking class Kelowna BC',       limit: 3 },
  { q: 'distillery Kelowna BC',          limit: 3 },
  { q: 'cidery Kelowna BC',              limit: 2 },
  { q: 'lavender farm Kelowna BC',       limit: 2 },
  { q: 'fruit picking Kelowna BC',       limit: 3 },
  { q: 'farmers market Kelowna BC',      limit: 2 },
  { q: 'food truck Kelowna BC',          limit: 3 },
  { q: 'live music venue Kelowna BC',    limit: 3 },
  { q: 'ice skating Kelowna BC',         limit: 2 },
  { q: 'paintball Kelowna BC',           limit: 2 },
];

// Google's primary types (varies wildly) → our `place_type` enum.
// First match wins. Anything unmatched falls back to 'activity' as a catch-all.
function mapGoogleTypes(googleTypes) {
  const set = new Set(googleTypes);
  const rules = [
    { ours: 'winery',        match: ['winery'] },
    { ours: 'brewery',       match: ['brewery'] },
    { ours: 'cocktail_bar',  match: ['bar', 'night_club'] },
    { ours: 'cafe',          match: ['cafe', 'coffee_shop'] },
    { ours: 'bakery',        match: ['bakery'] },
    { ours: 'ice_cream',     match: ['ice_cream_shop'] },
    { ours: 'dessert',       match: ['dessert_shop', 'dessert_restaurant'] },
    { ours: 'restaurant',    match: ['restaurant', 'meal_takeaway', 'meal_delivery', 'food'] },
    { ours: 'gallery',       match: ['art_gallery'] },
    { ours: 'beach',         match: ['beach'] },
    { ours: 'park',          match: ['park', 'national_park'] },
    { ours: 'garden',        match: ['botanical_garden'] },
    { ours: 'hike',          match: ['hiking_area', 'trail'] },
    { ours: 'viewpoint',     match: ['scenic_lookout', 'observation_deck'] },
    { ours: 'sunset_spot',   match: [] }, // human-tagged
    { ours: 'walk',          match: ['promenade'] },
    { ours: 'market',        match: ['market', 'farmers_market'] },
    { ours: 'shop',          match: ['store', 'clothing_store', 'gift_shop'] },
    { ours: 'activity',      match: ['amusement_park', 'bowling_alley', 'spa', 'tourist_attraction', 'museum'] },
  ];
  for (const r of rules) {
    if (r.match.some((t) => set.has(t))) return r.ours;
  }
  return 'activity';
}

function priceLevelToTier(level) {
  // Google: PRICE_LEVEL_FREE=0, INEXPENSIVE=1, MODERATE=2, EXPENSIVE=3, VERY_EXPENSIVE=4
  if (level === 'PRICE_LEVEL_FREE' || level === 'PRICE_LEVEL_INEXPENSIVE') return '$';
  if (level === 'PRICE_LEVEL_MODERATE') return '$$';
  if (level === 'PRICE_LEVEL_EXPENSIVE' || level === 'PRICE_LEVEL_VERY_EXPENSIVE') return '$$$';
  return '$$';
}

// Rough neighborhood bucketing from lat/lng. Real geocoding would be cleaner
// but Kelowna's small enough that bbox per neighborhood works fine.
function neighborhoodFromLatLng(lat, lng) {
  if (!lat || !lng) return 'multiple';
  if (lng < -119.55) return 'west_kelowna';
  if (lat > 50.0) return 'lake_country';
  if (lat < 49.78) return 'peachland';
  if (lat < 49.82 && lng > -119.46) return 'south_east_kelowna';
  if (lat < 49.85) return 'lower_mission';
  if (lat > 49.91 && lng > -119.45) return 'rutland';
  if (lat > 49.91) return 'glenmore';
  return 'downtown';
}

function driveClusterFromNeighborhood(n) {
  if (['downtown', 'lakeshore'].includes(n)) return 'downtown';
  if (['lower_mission', 'pandosy', 'south_east_kelowna'].includes(n)) return 'mission';
  if (['rutland', 'glenmore'].includes(n)) return 'north_east';
  if (n === 'west_kelowna') return 'west';
  if (n === 'lake_country') return 'lake_country';
  if (n === 'peachland') return 'peachland';
  return 'multiple';
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function googleSearchText(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.priceLevel,places.rating,places.userRatingCount,places.photos,places.regularOpeningHours,places.websiteUri,places.reviews',
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      locationBias: {
        circle: {
          center: { latitude: 49.888, longitude: -119.496 },
          radius: 40000, // 40 km — Kelowna metro + Lake Country + West K + Peachland
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Google searchText ${res.status}: ${await res.text()}`);
  return (await res.json()).places ?? [];
}

function buildPhotoUrl(photoResource) {
  return `https://places.googleapis.com/v1/${photoResource}/media?maxWidthPx=1200&key=${GOOGLE_KEY}`;
}

function pickHours(opening) {
  if (!opening?.weekdayDescriptions) return { opens: null, closes: null };
  // Try Wednesday (a typical day) — first time range we can parse.
  // Format: "Wednesday: 11:00 AM – 10:00 PM"
  const wed = opening.weekdayDescriptions.find((d) => d.startsWith('Wednesday')) ?? opening.weekdayDescriptions[2];
  if (!wed) return { opens: null, closes: null };
  const m = wed.match(/(\d{1,2}):?(\d{2})?\s?(AM|PM)\s*[–-]\s*(\d{1,2}):?(\d{2})?\s?(AM|PM)/i);
  if (!m) return { opens: null, closes: null };
  const to24 = (h, mm, ap) => {
    let hour = parseInt(h, 10) % 12;
    if (ap.toUpperCase() === 'PM') hour += 12;
    return `${String(hour).padStart(2, '0')}:${(mm ?? '00').padStart(2, '0')}`;
  };
  return { opens: to24(m[1], m[2], m[3]), closes: to24(m[4], m[5], m[6]) };
}

async function llmAugment({ name, type, neighborhood, reviewSnippets }) {
  const prompt = `You are tagging a Kelowna spot for a date-planning app. Return ONLY JSON, no prose.

Place: ${name}
Type: ${type}
Neighborhood: ${neighborhood}
Recent reviews (snippets):
${reviewSnippets.slice(0, 5).map((r, i) => `${i + 1}. "${r.slice(0, 200)}"`).join('\n')}

Return a JSON object with:
{
  "vibe_tags": [array of 1-3 vibes from: romantic, chill, adventurous, boujee, cozy, spontaneous, lively, intimate, casual, fun, unique, cultural],
  "pairing_tags": [array of 0-3 from: hidden_gem, good_for_first_date, good_for_anniversary, group_friendly, kid_unfriendly, photo_worthy, view_focused, food_focused, drink_focused],
  "effort": "low" | "moderate" | "high",
  "energy": "low" | "medium" | "high",
  "time_of_day": [array of: morning, afternoon, evening, late_night],
  "typical_duration_min": integer (15-180),
  "typical_per_person": number (estimated CAD per person, 0 if free),
  "reservation_required": boolean,
  "weather_dependent": boolean,
  "local_insight": "one short sentence: a specific tip a local friend would tell you (what to order, where to sit, when to go). Be concrete, no marketing-speak.",
  "summary": "one short sentence describing what this place is, plain and factual."
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      temperature: 0.4,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(cleaned);
}

async function main() {
  // Pull existing google_place_ids so we don't re-process
  const { data: existing } = await supabase.from('places').select('google_place_id');
  const known = new Set((existing ?? []).map((r) => r.google_place_id).filter(Boolean));
  console.log(`Already have ${known.size} places with google_place_id; will skip those.\n`);

  const drafts = [];
  let queriesRun = 0;
  let totalGoogleCalls = 0;
  let llmCalls = 0;

  for (const { q, limit } of QUERIES) {
    queriesRun++;
    console.log(`[${queriesRun}/${QUERIES.length}] ${q}`);
    let results;
    try {
      results = await googleSearchText(q);
      totalGoogleCalls++;
    } catch (e) {
      console.log(`  ! ${e.message}`);
      continue;
    }

    let added = 0;
    for (const r of results) {
      if (added >= limit) break;
      if (known.has(r.id)) {
        // Already in our DB; skip silently.
        continue;
      }
      known.add(r.id); // dedupe across queries within this run

      const lat = r.location?.latitude ?? null;
      const lng = r.location?.longitude ?? null;
      const neighborhood = neighborhoodFromLatLng(lat, lng);
      const type = mapGoogleTypes(r.types ?? []);
      const photoResource = r.photos?.[0]?.name;
      const photoUrl = photoResource ? buildPhotoUrl(photoResource) : null;
      const hours = pickHours(r.regularOpeningHours);
      const reviewSnippets = (r.reviews ?? []).map((rv) => rv.text?.text ?? rv.originalText?.text ?? '').filter(Boolean);

      let llm;
      try {
        llm = await llmAugment({
          name: r.displayName?.text ?? 'Unknown',
          type,
          neighborhood,
          reviewSnippets,
        });
        llmCalls++;
      } catch (e) {
        console.log(`  ! LLM failed for ${r.displayName?.text}: ${e.message}`);
        continue;
      }

      const draft = {
        name: r.displayName?.text ?? 'Unknown',
        slug: slugify(r.displayName?.text ?? r.id),
        address: r.formattedAddress ?? null,
        neighborhood,
        drive_cluster: driveClusterFromNeighborhood(neighborhood),
        type,
        vibe_tags: llm.vibe_tags ?? [],
        pairing_tags: llm.pairing_tags ?? [],
        effort: llm.effort ?? 'low',
        energy: llm.energy ?? 'medium',
        time_of_day: llm.time_of_day ?? [],
        weather_dependent: llm.weather_dependent ?? false,
        seasonality: ['year_round'],
        typical_duration_min: llm.typical_duration_min ?? 60,
        opens: hours.opens,
        closes: hours.closes,
        price_tier: priceLevelToTier(r.priceLevel),
        typical_per_person: llm.typical_per_person ?? null,
        reservation_required: llm.reservation_required ?? false,
        reservation_url: r.websiteUri ?? null,
        photo_url: photoUrl,
        google_place_id: r.id,
        lat,
        lng,
        quality_score: r.rating ? Math.min(10, Math.round(r.rating * 2)) : 7,
        feedback_score: 0,
        local_insight: llm.local_insight ?? null,
        notes: null,
        llm_summary: llm.summary ?? null,
        is_active: true,
        approval_status: 'draft',
        source_query: q,
        discovered_at: new Date().toISOString(),
      };

      // Slug must be unique. If we collide, suffix the google_place_id tail.
      draft.slug = `${draft.slug}-${r.id.slice(-6).toLowerCase()}`;

      const { error } = await supabase.from('places').insert(draft);
      if (error) {
        console.log(`  ! insert failed for ${draft.name}: ${error.message}`);
        continue;
      }
      drafts.push(draft);
      added++;
      console.log(`  + ${draft.name} (${draft.type}, ${draft.neighborhood})`);
    }
    // Be polite to Google / Anthropic between queries.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nDiscovery complete.`);
  console.log(`  Queries run:   ${queriesRun}`);
  console.log(`  Google calls:  ${totalGoogleCalls}`);
  console.log(`  LLM calls:     ${llmCalls}`);
  console.log(`  Drafts saved:  ${drafts.length}`);

  // CSV summary for review
  const csvPath = join(__dirname, `discovered-${Date.now()}.csv`);
  const cols = ['name', 'type', 'neighborhood', 'price_tier', 'quality_score', 'vibe_tags', 'local_insight', 'source_query', 'address'];
  const lines = [cols.join(',')];
  for (const d of drafts) {
    lines.push(cols.map((c) => {
      const v = d[c];
      const s = Array.isArray(v) ? v.join('|') : (v ?? '');
      return `"${String(s).replace(/"/g, '""')}"`;
    }).join(','));
  }
  writeFileSync(csvPath, lines.join('\n'));
  console.log(`\nReview CSV: ${csvPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

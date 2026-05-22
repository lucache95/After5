// Mine Google Places reviews via Claude to generate local_insight text.
//
// For each venue missing a local_insight, this script:
//   1. Checks the DB `reviews` column (populated by enrich-places.mjs).
//      If empty, fetches fresh reviews from Google Places API.
//   2. Sends up to 20 reviews to Claude with an extraction prompt.
//   3. Writes the resulting 2-4 sentence insight back to `local_insight`.
//
// Cost: ~$0.002/venue (Haiku). 170 venues ~ $0.35.
//
// Run: node scripts/mine-reviews.mjs                   # only missing
//      node scripts/mine-reviews.mjs --force           # re-mine all
//      node scripts/mine-reviews.mjs --limit 10        # cap at 10
//      node scripts/mine-reviews.mjs --dry-run         # preview, no writes

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET || !ANTHROPIC_KEY) {
  console.error('Missing env: need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

// ── CLI flags ──────────────────────────────────────────────────
const limitIdx = process.argv.indexOf('--limit');
const cap = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const PACE_MS = 1000;

// ── Google Places API ──────────────────────────────────────────
async function fetchGoogleReviews(googlePlaceId) {
  if (!GOOGLE_KEY) return [];
  const res = await fetch(`https://places.googleapis.com/v1/places/${googlePlaceId}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'reviews',
    },
  });
  if (!res.ok) {
    console.warn(`    Google API ${res.status} for ${googlePlaceId}`);
    return [];
  }
  const data = await res.json();
  return (data.reviews ?? []).map((r) => ({
    text: r.text?.text ?? r.originalText?.text ?? '',
    rating: r.rating ?? null,
  }));
}

// ── Claude extraction ──────────────────────────────────────────
async function extractInsight(venueName, venueType, reviews) {
  const reviewBlock = reviews
    .slice(0, 20)
    .map((r, i) => `${i + 1}. [${r.rating ?? '?'}/5] "${r.text}"`)
    .join('\n');

  const prompt = `You are reading Google reviews for "${venueName}" (a ${venueType} in Kelowna, BC).

Extract specific, sensory details about this venue that would help someone planning a date. Focus on:
- Atmosphere and ambiance (lighting, noise level, vibe)
- Best seating (patio, corner booth, bar, window)
- Best time to visit (day of week, time of day, season)
- What makes it special or unique
- Any warnings (loud weekends, long waits, limited parking)
- Good for what kind of date (first date, anniversary, casual Tuesday)

Reviews:
${reviewBlock}

Output 2-4 sentences. Be specific and vivid, not generic. Write like a local friend giving a tip, not a travel blog. Never use words like "embark" or "journey." No bullet points — just flowing sentences.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
  return text.trim();
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  // Pull candidates: active places, optionally only those missing local_insight.
  let q = supabase
    .from('places')
    .select('id, name, type, google_place_id, local_insight, reviews')
    .eq('is_active', true)
    .order('name');

  if (!FORCE) {
    q = q.or('local_insight.is.null,local_insight.eq.');
  }

  const { data: places, error } = await q;
  if (error) throw error;

  const targets = places.slice(0, cap);
  console.log(`${places.length} candidates, processing ${targets.length} (force=${FORCE}, dry-run=${DRY_RUN})\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const t0 = Date.now();

  for (const [i, place] of targets.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));

    const idx = `${String(i + 1).padStart(3)}/${targets.length}`;
    const name = (place.name ?? '').slice(0, 50);

    // Gather reviews: prefer cached DB reviews, fall back to Google API.
    let reviews = [];
    const dbReviews = Array.isArray(place.reviews) ? place.reviews : [];
    if (dbReviews.length > 0) {
      reviews = dbReviews.map((r) => ({
        text: typeof r === 'string' ? r : (r.text ?? ''),
        rating: typeof r === 'object' ? (r.rating ?? null) : null,
      })).filter((r) => r.text.length > 10);
    }

    // If no cached reviews and we have a google_place_id, fetch from API.
    if (reviews.length === 0 && place.google_place_id && GOOGLE_KEY) {
      reviews = (await fetchGoogleReviews(place.google_place_id))
        .filter((r) => r.text.length > 10);
    }

    if (reviews.length === 0) {
      skipped++;
      console.log(`  ${idx}  -  skipped (no reviews)  ${name}`);
      continue;
    }

    if (DRY_RUN) {
      ok++;
      console.log(`  ${idx}  ~  would mine (${reviews.length} reviews)  ${name}`);
      continue;
    }

    try {
      const insight = await extractInsight(place.name, place.type, reviews);
      if (!insight) {
        failed++;
        console.log(`  ${idx}  x  empty response  ${name}`);
        continue;
      }

      const { error: updateErr } = await supabase
        .from('places')
        .update({
          local_insight: insight,
          last_ai_review_at: new Date().toISOString(),
        })
        .eq('id', place.id);

      if (updateErr) {
        failed++;
        console.log(`  ${idx}  x  db: ${updateErr.message}  ${name}`);
        continue;
      }

      ok++;
      console.log(`  ${idx}  +  ${name}  (${reviews.length} reviews)`);
      console.log(`         "${insight.slice(0, 120)}${insight.length > 120 ? '...' : ''}"`);
    } catch (e) {
      failed++;
      console.log(`  ${idx}  x  ${e.message.slice(0, 100)}  ${name}`);
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${secs}s. Mined ${ok}, skipped ${skipped}, failed ${failed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

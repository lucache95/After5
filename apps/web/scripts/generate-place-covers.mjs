// Generate AI covers for places that have NO usable Google photo.
//
// Uses Gemini 2.5 Flash Image (same pipeline as backfill-covers.mjs for
// itineraries) to produce venue-specific editorial images. The prompt
// references the place type, name, and local_insight to keep each cover
// distinctive.
//
// Uploads to Supabase Storage `place-covers` bucket.
// Writes the public URL to `generated_photo_url` on the places table.
//
// Cost: ~$0.04/image. If ~130 places need covers ≈ $5.
//
// Run: node scripts/generate-place-covers.mjs                  # only missing
//      node scripts/generate-place-covers.mjs --force           # regenerate all
//      node scripts/generate-place-covers.mjs --limit 5         # cap
//      node scripts/generate-place-covers.mjs --dry-run         # preview only

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
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET || !GEMINI_KEY) {
  console.error('Missing env: need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, GEMINI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

const limitIdx = process.argv.indexOf('--limit');
const cap = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const STORAGE_BUCKET = 'place-covers';
const PACE_MS = 1500;

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`;

// Venue-type action prompts — same editorial Pinterest mood as itinerary covers.
const PROMPT_BY_TYPE = {
  restaurant:   'A warmly-lit restaurant interior with a candlelit table set for two, wine glasses catching soft amber light, intimate evening atmosphere',
  cafe:         'A sunlit cafe interior with a window table, two ceramic coffee cups, soft morning shadows, plants on the windowsill',
  cocktail_bar: 'A moody cocktail bar interior, warm copper-pendant lighting, dark wood bar top with two elegant cocktail glasses',
  brewery:      'A craft brewery taproom with exposed wood beams, two pints of golden beer on a rustic table, warm afternoon light',
  winery:       'A sun-drenched vineyard tasting room overlooking rows of vines, two wine glasses on a barrel table at golden hour',
  bakery:       'A charming bakery counter with fresh pastries in morning light, warm wood shelves, the smell almost visible in golden tones',
  dessert:      'An intimate dessert bar with a beautifully plated dessert for two under soft pendant lighting',
  ice_cream:    'A cheerful ice cream shop with colorful gelato display, a waffle cone held up against a soft sunset sky through the window',

  hike:         'A sunlit hiking trail winding above Okanagan Lake at golden hour, wildflowers along the path, the lake shimmering below',
  viewpoint:    'A panoramic hilltop viewpoint at sunset, Okanagan Lake glowing warm below, soft clouds streaked across the sky',
  sunset_spot:  'A serene sunset viewpoint with warm golden light spilling across the Okanagan hills, the sky painted in peach and amber',
  beach:        'A quiet Okanagan lakeshore at golden hour, gentle waves on pebble beach, mountains reflected in calm water',
  park:         'A tree-lined park path at golden hour with dappled light, a wooden bench under a canopy of green leaves',
  garden:       'A lush garden path with soft pastel flowers, sunlight filtering through arbors, a stone pathway winding ahead',
  walk:         'A wooden lakefront boardwalk at golden hour, calm water alongside, mountains in the soft distance',

  activity:     'An inviting activity venue interior with warm lighting, gear neatly arranged, ready for a fun evening',
  gallery:      'A sunlit art gallery with a striking framed piece on a white wall, natural light streaming through a skylight',
  market:       'A colorful farmers market stall with crates of fresh produce, warm late-afternoon light, artisan goods on display',
  shop:         'A curated boutique interior with warm pendant lights, carefully arranged displays, inviting and browsable',
};

const STYLE_SUFFIX = 'editorial Pinterest-style photograph, film-grain texture, warm cream and terra-cotta color palette, golden-hour atmosphere, soft natural light, shallow depth of field, magazine-quality composition, 4:5 aspect ratio, no text, no logos, no signs visible, no people.';

function buildPrompt(place) {
  const type = place.type ?? '';
  const action = PROMPT_BY_TYPE[type] ?? 'A peaceful Okanagan Valley scene with warm cream and terra-cotta palette';
  const nameHint = place.name ? ` (inspired by: ${place.name})` : '';
  const insightHint = place.local_insight ? ` Context: ${place.local_insight.slice(0, 120)}` : '';
  return `Generate an image: ${action}${nameHint}.${insightHint} ${STYLE_SUFFIX}`;
}

async function callGemini(place) {
  const prompt = buildPrompt(place);
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const resp = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (resp.status === 429) {
      const back = attempt * 8000;
      console.log(`    429 — backing off ${back / 1000}s`);
      await new Promise((r) => setTimeout(r, back));
      continue;
    }
    if (!resp.ok) return { error: `${resp.status} ${(await resp.text()).slice(0, 100)}` };

    const data = await resp.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const inlinePart = parts.find((p) => p.inlineData || p.inline_data);
    const inline = inlinePart?.inlineData ?? inlinePart?.inline_data;
    if (!inline?.data) {
      const textPart = parts.find((p) => p.text);
      return { error: `no_image (got: ${textPart?.text?.slice(0, 80) ?? 'nothing'})` };
    }
    return { bytes: Buffer.from(inline.data, 'base64'), prompt };
  }
  return { error: 'exhausted retries' };
}

async function uploadCover(placeId, bytes) {
  const path = `${placeId}.png`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: 'image/png', upsert: true });
  if (error) return { error: error.message };
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

async function main() {
  // Target: active places with no Google photo AND no existing generated cover.
  let q = supabase
    .from('places')
    .select('id, name, type, neighborhood, local_insight, photo_url, generated_photo_url')
    .eq('is_active', true)
    .order('name');

  const { data: allPlaces, error } = await q;
  if (error) throw error;

  const targets = (FORCE
    ? allPlaces.filter((p) => !p.photo_url) // --force: regenerate all photo-less places
    : allPlaces.filter((p) => !p.photo_url && !p.generated_photo_url)
  ).slice(0, cap);

  console.log(`${allPlaces.length} total places · ${targets.length} need covers · dry-run=${DRY_RUN} · force=${FORCE}\n`);

  let ok = 0, failed = 0;
  const t0 = Date.now();

  for (const [i, place] of targets.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));

    const idx = `${(i + 1).toString().padStart(3)}/${targets.length}`;

    if (DRY_RUN) {
      console.log(`  ${idx}  ~  ${place.name} [${place.type}] — would generate`);
      ok++;
      continue;
    }

    const result = await callGemini(place);
    if (result.error) {
      failed++;
      console.log(`  ${idx}  ✗  ${place.name}: ${result.error}`);
      continue;
    }

    const upload = await uploadCover(place.id, result.bytes);
    if (upload.error) {
      failed++;
      console.log(`  ${idx}  ✗  upload ${place.name}: ${upload.error}`);
      continue;
    }

    const { error: updateErr } = await supabase
      .from('places')
      .update({ generated_photo_url: upload.url })
      .eq('id', place.id);
    if (updateErr) {
      failed++;
      console.log(`  ${idx}  ✗  db ${place.name}: ${updateErr.message}`);
      continue;
    }

    ok++;
    console.log(`  ${idx}  ✓  ${place.name} [${place.type}]`);
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n--- Summary ---`);
  console.log(`  Generated: ${ok}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Time:      ${mins}m`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

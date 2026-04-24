// Backfill cover images directly — no Edge Function involved.
// Local script: build prompt → POST Replicate (Prefer:wait, no polling) →
// download → upload to Supabase storage → update row. Throttled to one
// Replicate call every 5s so we never trip the 429 rate limit.
//
// Run: node scripts/backfill-covers.mjs                # all
//      node scripts/backfill-covers.mjs --limit 20     # cap
//      node scripts/backfill-covers.mjs --resume       # skip rows that already have covers (default)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const limitIdx = process.argv.indexOf('--limit');
const cap = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

const STORAGE_BUCKET = 'itinerary-covers';
const REPLICATE_MODEL = 'black-forest-labs/flux-schnell';
const PACE_MS = 5000;

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

function buildPrompt(it) {
  const stops = Array.isArray(it.stops) ? it.stops : [];
  const types = stops.map((s) => s.place_type).filter(Boolean).slice(0, 3);
  const neighborhoods = Array.from(new Set(stops.map((s) => s.neighborhood).filter(Boolean))).slice(0, 2);
  const vibe = (it.inputs?.vibe ?? []).slice(0, 2).join(', ');
  const season = it.season || 'spring';

  // Pool ALL relevant scene options, then deterministically pick one based
  // on itinerary id. Mirror of supabase/functions/generate-cover/index.ts —
  // keep the two in sync.
  const scenes = [];

  if (types.includes('activity') || types.includes('gallery')) {
    scenes.push(
      'a wooden axe-throwing target with chalk score marks',
      'a moody dim-lit escape-room hallway with vintage props',
      'a quiet downtown art studio with soft lamps and brushes on a table',
      'an arcade neon sign reflecting on a polished bartop',
    );
  }
  if (types.includes('hike') || types.includes('viewpoint') || types.includes('sunset_spot')) {
    scenes.push(
      'a winding bunchgrass trail above Okanagan Lake at golden hour',
      'a sage-and-pine ridgeline overlooking Kelowna with distant blue mountains',
      'an empty wooden bench at a hilltop viewpoint, warm dusk light',
    );
  }
  if (types.includes('beach') || types.includes('park') || types.includes('walk') || types.includes('garden')) {
    scenes.push(
      'a quiet wooden boardwalk along the Okanagan lakefront',
      'soft evening light across a small public garden in spring',
      'an empty pier with two beach chairs at golden hour',
    );
  }
  if (types.includes('market') || types.includes('shop')) {
    scenes.push(
      'a colorful farmers market stall with crates of fresh produce in afternoon light',
      'a vintage record-shop window backlit by warm interior lamps',
    );
  }
  if (types.includes('dessert') || types.includes('ice_cream') || types.includes('bakery')) {
    scenes.push(
      'two ice-cream cones held against a soft sunset sky',
      'a window-lit pastry counter with croissants and tarts',
      'a candlelit dessert plate with a single fork on a marble counter',
    );
  }
  if (types.includes('cafe')) {
    scenes.push(
      'a steaming espresso on a warm wooden cafe table with a folded book',
      'a sunlit cafe corner with a single ceramic cup and morning shadows',
    );
  }
  if (types.includes('restaurant')) {
    scenes.push(
      'a candlelit bistro table for two with linen napkins',
      'warm pendant lights through a restaurant window at dusk',
      'an intimate corner table with bread and butter and a single tealight',
    );
  }
  if (types.includes('winery')) {
    scenes.push(
      'a sunlit vineyard row with grape leaves catching golden light',
      'a wine barrel and a single glass on a stone patio',
    );
  }
  if (types.includes('cocktail_bar')) {
    scenes.push(
      'a copper-pendant-lit cocktail bar with two coupes on dark wood',
      'a single negroni glowing under a vintage Edison bulb',
    );
  }
  if (types.includes('brewery')) {
    scenes.push(
      'two pints on a sunlit patio table with green leaves above',
      'a dim brewery taproom with rows of taps in soft focus',
    );
  }

  if (scenes.length === 0) {
    scenes.push(
      'a quiet Okanagan vineyard at golden hour',
      'a soft pastel sunset over Okanagan Lake from a hilltop',
    );
  }

  const seed = (it.id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const scene = scenes[seed % scenes.length];

  const seasonHint =
    season === 'winter' ? 'crisp winter light, bare trees, soft snow on distant mountains' :
    season === 'summer' ? 'lush green vineyards, warm summer dusk light' :
    season === 'fall'   ? 'golden autumn vines, amber leaves, soft afternoon haze' :
                          'fresh spring foliage, light blue lake, gentle pink sunset';

  return [
    'Editorial Pinterest-style photograph,',
    scene + ',',
    `Kelowna British Columbia, ${neighborhoods.length ? neighborhoods.join(' / ') + ', ' : ''}${vibe ? vibe + ' mood,' : ''}`,
    `${seasonHint},`,
    'cinematic golden-hour atmosphere, warm cream and terra-cotta color palette,',
    'shallow depth of field, soft natural light, magazine-quality composition,',
    'no people visible, no text, no logos, square format',
  ].join(' ');
}

async function callReplicate(prompt) {
  const r = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({
      input: { prompt, aspect_ratio: '1:1', output_format: 'webp', output_quality: 85, num_inference_steps: 4, go_fast: true },
    }),
  });
  if (r.status === 429) return { rate_limited: true };
  if (!r.ok) return { error: `${r.status} ${(await r.text()).slice(0, 80)}` };
  const data = await r.json();
  if (data.error) return { error: String(data.error).slice(0, 80) };
  const out = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!out) return { error: 'no_output' };
  return { url: out };
}

async function uploadToStorage(imageUrl, itineraryId) {
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) return { error: `download ${imgResp.status}` };
  const bytes = new Uint8Array(await imgResp.arrayBuffer());
  const path = `${itineraryId}.webp`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: 'image/webp', upsert: true });
  if (error) return { error: error.message };
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

const { data, error } = await supabase
  .from('itineraries')
  .select('id, slug, title, hook, template_id, stops, inputs, season')
  .eq('is_public', true)
  .not('title', 'is', null)
  .is('cover_image_url', null)
  .order('generated_at', { ascending: false });
if (error) throw error;

const targets = data.slice(0, cap);
console.log(`${data.length} itineraries need covers · processing ${targets.length} · pacing ${PACE_MS}ms`);

let ok = 0;
let failed = 0;
const t0 = Date.now();

for (const [i, it] of targets.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));

  const idx = `${(i + 1).toString().padStart(3)}/${targets.length}`;
  const title = (it.title ?? '').slice(0, 50);
  const prompt = buildPrompt(it);

  // 3 attempts: handle 429 by waiting longer.
  let pred = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await callReplicate(prompt);
    if (res.url) { pred = res.url; break; }
    if (res.rate_limited) {
      const back = attempt * 6000;
      console.log(`  ${idx}  ⏸  429, backing off ${back / 1000}s (attempt ${attempt})`);
      await new Promise((r) => setTimeout(r, back));
      continue;
    }
    failed += 1;
    console.log(`  ${idx}  ✗  ${res.error ?? 'unknown'}  · ${title}`);
    pred = null;
    break;
  }
  if (!pred) continue;

  const upload = await uploadToStorage(pred, it.id);
  if (upload.error) {
    failed += 1;
    console.log(`  ${idx}  ✗  upload: ${upload.error}  · ${title}`);
    continue;
  }

  const { error: updateErr } = await supabase
    .from('itineraries')
    .update({
      cover_image_url: upload.url,
      cover_image_generated_at: new Date().toISOString(),
      cover_image_prompt: prompt,
    })
    .eq('id', it.id);
  if (updateErr) {
    failed += 1;
    console.log(`  ${idx}  ✗  db: ${updateErr.message}  · ${title}`);
    continue;
  }

  ok += 1;
  console.log(`  ${idx}  ✓  ${title}`);
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\ndone in ${mins}m · ok=${ok} failed=${failed}`);

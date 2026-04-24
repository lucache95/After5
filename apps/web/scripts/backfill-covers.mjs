// Backfill cover images via Gemini 2.5 Flash Image ("Nano Banana").
//
// Strategy:
// 1. Pick the FIRST stop with a real photo URL (Google Places, etc.) as the
//    source image. Fall back to the second stop, etc., if the first is a
//    placeholder /places/* path.
// 2. Build an action-specific prompt for the stop's place_type — POV hands
//    for activities/sweets, couple-from-behind for outdoor, couple-at-table
//    for sit-down. See PROMPT_BY_TYPE below.
// 3. Call Gemini with photo + prompt → editorial restyle preserving venue.
// 4. Upload PNG to Supabase storage; write back cover_image_url.
//
// Cost: ~$0.04/image. 304 plans ≈ $12.
// Pacing: Gemini's free tier handles 60 RPM comfortably; we throttle 1.5s
// between calls to stay polite.
//
// Run: node scripts/backfill-covers.mjs                   # only missing
//      node scripts/backfill-covers.mjs --force           # all of them
//      node scripts/backfill-covers.mjs --limit 5         # cap

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    .split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const limitIdx = process.argv.indexOf('--limit');
const cap = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;
const FORCE = process.argv.includes('--force');

const STORAGE_BUCKET = 'itinerary-covers';
const GEMINI_KEY = env.GEMINI_API_KEY ?? 'AIzaSyDIzNmTIFj1XmCKozI5Ilp86AAI8MOqWpg';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_KEY}`;
const PACE_MS = 1500;

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// Action prompts per stop type. Match the candid Pinterest-editorial mood:
// real couples doing real things, or POV-style hands when faces would be
// unreliable. Style suffix is added by buildPrompt below.
const PROMPT_BY_TYPE = {
  restaurant:   'A young couple seated across from each other at a candlelit restaurant table, mid-laugh, two glasses of wine on the table',
  cafe:         'A young couple at a sunlit cafe window, one holding a ceramic coffee cup, soft morning shadows on the table',
  cocktail_bar: 'Two cocktail coupes clinked together over a dark wood bar, copper-pendant lighting, hands holding the glasses',
  brewery:      'Two pints raised together on a sunlit patio table, a couple\'s hands wrapped around the glasses, blurred green leaves overhead',
  winery:       'A young couple walking through a sunlit vineyard row at golden hour, viewed from behind, holding wine glasses',
  bakery:       'POV two hands gently breaking a pain-au-chocolat in half above a marble cafe table, a single espresso cup beside it, warm morning light',
  dessert:      'POV two hands holding a single dessert plate with two forks, candlelight beside, intimate framing',
  ice_cream:    'POV two ice-cream cones held up against a soft sunset sky, the lake blurred behind',

  hike:         'A young couple holding hands walking up a sunlit dirt trail above Okanagan Lake, viewed from behind, casual hiking outfits, golden-hour light spilling onto the lake ahead',
  viewpoint:    'A young couple silhouetted at a panoramic hilltop viewpoint at sunset, viewed from behind, the lake glowing warm in front of them',
  sunset_spot:  'A young couple silhouetted on a hilltop at sunset, viewed from behind, soft warm clouds across the sky',
  beach:        'A young couple walking barefoot along a quiet Okanagan lakeshore at golden hour, viewed from behind',
  park:         'A young couple strolling on a tree-lined park path at golden hour, viewed from behind, dappled light',
  garden:       'A young couple walking through a sunlit garden path, viewed from behind, soft pastel flowers around them',
  walk:         'A young couple strolling along a wooden lakefront boardwalk at golden hour, viewed from behind',

  activity:     'POV-style shot of two hands holding the activity\'s gear (axes, paddles, controllers) crossed in front of the camera, the venue visible in soft-focus background, candid lifestyle Instagram framing',
  gallery:      'POV looking at a framed artwork on a sunlit gallery wall, a couple\'s shoulders softly visible at the edges of the frame',
  market:       'POV browsing a colorful market stall with crates of fresh produce, a hand reaching toward the goods, late-afternoon light',
  shop:         'POV looking at a curated vintage shop interior with warm pendant lights, a hand holding up a piece of clothing',
};

const STYLE_SUFFIX = 'editorial Pinterest-style candid photograph, film-grain texture, warm cream and terra-cotta color palette, golden-hour atmosphere, soft natural light, shallow depth of field, magazine-quality composition, square format, no text, no logos, no signs visible. Preserve the venue identity from the source photo (architecture, interior, landscape).';

function buildPrompt(stop) {
  const type = stop?.place_type ?? '';
  const action = PROMPT_BY_TYPE[type] ?? 'A peaceful Okanagan Valley scene with warm cream and terra-cotta palette';
  return `Generate an image: re-shoot this exact venue as a ${STYLE_SUFFIX} ${action}.`;
}

// Pick the first stop that has a fetchable real photo (not the /places/*
// generic fallback we ship with the site).
function pickSourceStop(stops) {
  if (!Array.isArray(stops)) return null;
  for (const s of stops) {
    const url = s?.photo_url;
    if (typeof url === 'string' && url.startsWith('http')) return s;
  }
  return null;
}

async function fetchImageBase64(url) {
  const r = await fetch(url);
  if (!r.ok) return { error: `fetch ${r.status}` };
  const buf = Buffer.from(await r.arrayBuffer());
  // Basic sanity check — Gemini wants jpg/png. Most Google photos are jpg.
  return { mime: 'image/jpeg', b64: buf.toString('base64') };
}

async function callGemini(stop) {
  const photo = await fetchImageBase64(stop.photo_url);
  if (photo.error) return { error: `photo: ${photo.error}` };

  const prompt = buildPrompt(stop);
  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: photo.mime, data: photo.b64 } }] }],
    }),
  });

  if (resp.status === 429) return { rate_limited: true };
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

async function uploadCover(itineraryId, bytes) {
  const path = `${itineraryId}.png`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: 'image/png', upsert: true });
  if (error) return { error: error.message };
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

// ── Pull targets ───────────────────────────────────────────
let q = supabase
  .from('itineraries')
  .select('id, slug, title, stops, season, inputs')
  .eq('is_public', true)
  .not('title', 'is', null)
  .order('generated_at', { ascending: false });
if (!FORCE) q = q.is('cover_image_url', null);
const { data, error } = await q;
if (error) throw error;

const targets = data.slice(0, cap);
console.log(`${data.length} candidates · processing ${targets.length} · pacing ${PACE_MS}ms · force=${FORCE}`);

let ok = 0;
let failed = 0;
const t0 = Date.now();

for (const [i, it] of targets.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, PACE_MS));

  const idx = `${(i + 1).toString().padStart(3)}/${targets.length}`;
  const title = (it.title ?? '').slice(0, 50);

  const stop = pickSourceStop(it.stops);
  if (!stop) {
    failed += 1;
    console.log(`  ${idx}  ✗  no_source_photo  · ${title}`);
    continue;
  }

  // 3 attempts on rate limit / transient
  let result = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await callGemini(stop);
    if (r.bytes) { result = r; break; }
    if (r.rate_limited) {
      const back = attempt * 8000;
      console.log(`  ${idx}  ⏸  429, backing off ${back / 1000}s`);
      await new Promise((res) => setTimeout(res, back));
      continue;
    }
    failed += 1;
    console.log(`  ${idx}  ✗  ${r.error}  · ${title}`);
    result = null;
    break;
  }
  if (!result) continue;

  const upload = await uploadCover(it.id, result.bytes);
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
      cover_image_prompt: result.prompt,
    })
    .eq('id', it.id);
  if (updateErr) {
    failed += 1;
    console.log(`  ${idx}  ✗  db: ${updateErr.message}  · ${title}`);
    continue;
  }

  ok += 1;
  console.log(`  ${idx}  ✓  ${title}  [${stop.place_type}]`);
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\ndone in ${mins}m · ok=${ok} failed=${failed}`);

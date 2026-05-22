// Classify photo quality for places that already have a Google photo.
//
// Uses Gemini 2.5 Flash vision to score each photo on a 1–5 scale:
//   1 = unusable (blurry, dark, irrelevant)
//   2 = poor (bad angle, too dark, prominent people blocking venue)
//   3 = acceptable (shows venue but not inviting)
//   4 = good (well-lit, inviting, shows venue atmosphere)
//   5 = excellent (magazine-quality, would look great on a polaroid card)
//
// Writes `photo_quality` (text "1"–"5") and `photo_review_notes` to the
// places table. Flags photos scoring < 3 for replacement.
//
// Run: node scripts/classify-photos.mjs
//      node scripts/classify-photos.mjs --limit 10
//      node scripts/classify-photos.mjs --dry-run
//      node scripts/classify-photos.mjs --force   # re-score already-scored

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
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const PACE_MS = 1500; // Stay within Gemini free-tier RPM.

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

const CLASSIFY_PROMPT = `You are a photo quality reviewer for a date-planning app. Score this venue photo on a 1–5 scale.

Criteria (weight each equally):
1. LIGHTING — Is it well-lit? Natural light preferred. Dim/dark photos score lower.
2. VENUE VISIBILITY — Does it clearly show the venue (exterior, interior, or atmosphere)? Close-ups of food-only or unrelated shots score lower.
3. APPEAL — Is it appetizing/inviting? Would it make someone want to visit on a date?
4. CARD FIT — Would it look good cropped into a polaroid-style card (4:5 aspect)?
5. COMPOSITION — Good framing? No prominent people blocking the view? Landscape orientation preferred.

Respond with EXACTLY this JSON format, nothing else:
{"score": <1-5>, "notes": "<one sentence explanation>"}`;

async function classifyOne(place) {
  // Fetch photo as base64 for Gemini vision.
  let photoB64, mime;
  try {
    const res = await fetch(place.photo_url);
    if (!res.ok) return { error: `fetch ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    photoB64 = buf.toString('base64');
    mime = res.headers.get('content-type') || 'image/jpeg';
  } catch (e) {
    return { error: `photo fetch: ${e.message}` };
  }

  const body = {
    contents: [{
      parts: [
        { text: `${CLASSIFY_PROMPT}\n\nVenue: ${place.name} (${place.type}, ${place.neighborhood})` },
        { inline_data: { mime_type: mime, data: photoB64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 200,
    },
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
    if (!resp.ok) return { error: `gemini ${resp.status}: ${(await resp.text()).slice(0, 100)}` };

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    // Parse JSON from response (may be wrapped in ```json ... ```)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { error: `no JSON in response: ${text.slice(0, 80)}` };
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const score = parseInt(parsed.score, 10);
      if (score < 1 || score > 5) return { error: `invalid score: ${parsed.score}` };
      return { score, notes: parsed.notes || '' };
    } catch (e) {
      return { error: `JSON parse: ${e.message}` };
    }
  }
  return { error: 'exhausted retries' };
}

async function main() {
  let q = supabase
    .from('places')
    .select('id, name, type, neighborhood, photo_url, photo_quality')
    .eq('is_active', true)
    .not('photo_url', 'is', null)
    .order('name');

  const { data: places, error } = await q;
  if (error) throw error;

  // Filter to un-scored (unless --force).
  const targets = (FORCE ? places : places.filter((p) => !p.photo_quality)).slice(0, cap);
  console.log(`Classifying ${targets.length} photos (${places.length} total with photos) · dry-run=${DRY_RUN} · force=${FORCE}\n`);

  const results = { scored: 0, low: 0, failed: 0 };

  for (const [i, place] of targets.entries()) {
    const idx = `${(i + 1).toString().padStart(3)}/${targets.length}`;

    const r = await classifyOne(place);
    if (r.error) {
      results.failed++;
      console.log(`  ${idx}  ✗  ${place.name}: ${r.error}`);
    } else {
      const flag = r.score < 3 ? ' ⚠ LOW' : '';
      console.log(`  ${idx}  ${r.score}/5  ${place.name}  ${r.notes}${flag}`);

      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from('places')
          .update({
            photo_quality: String(r.score),
            photo_review_notes: r.notes,
          })
          .eq('id', place.id);
        if (updateErr) {
          console.log(`         ✗  DB update failed: ${updateErr.message}`);
          results.failed++;
          continue;
        }
      }

      results.scored++;
      if (r.score < 3) results.low++;
    }

    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, PACE_MS));
  }

  console.log('\n--- Summary ---');
  console.log(`  Scored:           ${results.scored}`);
  console.log(`  Low quality (<3): ${results.low}`);
  console.log(`  Failed:           ${results.failed}`);
  if (results.low > 0) {
    console.log(`\nRun with --dry-run removed to write scores. Low-quality photos should be`);
    console.log(`replaced via generate-place-covers.mjs or manual curation.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

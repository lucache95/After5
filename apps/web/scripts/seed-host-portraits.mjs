// Generate real portrait photos for the 3 seed hosts (Maya / Liam / Ava) via
// Replicate FLUX schnell, blur them the SAME way generate-blur does for real
// users (64px longest-side downscale + tiny-resize round-trip "gaussian"),
// upload BOTH variants to the profile-photos bucket using the real-user path
// convention (<uid>/<id>.jpg + <uid>/<id>_blurred.jpg), insert the matching
// profile_photos primary row, and point profiles.clear_photo_url /
// blurred_photo_url at the STORAGE PATHS the feed signer expects.
//
//   node scripts/seed-host-portraits.mjs
//
// Why: the old seed paths ('/places/place-walk.jpg') are public-asset paths,
// not storage paths — signBlurredUrls THROWS on non-'_blurred.jpg' paths and
// the feed's catch then drops the avatar for EVERY card, so all hosts fell
// back to letter monograms.
//
// SAFETY: every prod write is scoped to user ids resolved from the
// '*@after5.seed' auth emails. Real user rows are never touched.
// Idempotent: re-running replaces the seed hosts' photos (old storage objects
// in their folders are removed first).
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (prod service role) +
// REPLICATE_API_TOKEN from apps/web/.env.local.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SECRET_KEY;
const REPLICATE = env.REPLICATE_API_TOKEN;
if (!URL_ || !SERVICE || !REPLICATE) throw new Error('missing prod url / service key / REPLICATE_API_TOKEN in apps/web/.env.local');
const sb = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const BUCKET = 'profile-photos';
const REPLICATE_MODEL = 'black-forest-labs/flux-schnell';

// Distinct, tasteful, dating-profile-plausible portraits. Candid > studio.
const HOSTS = [
  {
    email: 'seed-host-1@after5.seed', name: 'Maya',
    prompt: 'Candid dating-profile photograph of a woman in her early 30s with shoulder-length dark wavy hair, warm genuine smile, olive complexion, wearing a rust-colored knit sweater, sitting on a patio at golden hour with soft bokeh string lights behind her, natural skin texture, shot on 50mm lens, shallow depth of field, warm natural light, photorealistic, no text, no watermark',
  },
  {
    email: 'seed-host-2@after5.seed', name: 'Liam',
    prompt: 'Candid dating-profile photograph of a man in his mid 30s with short brown hair and a light well-kept beard, relaxed friendly expression, wearing a casual olive jacket over a t-shirt, standing on a lakeside boardwalk in late-afternoon light, slight off-camera glance and easy smile, natural skin texture, shot on 50mm lens, shallow depth of field, photorealistic, no text, no watermark',
  },
  {
    email: 'seed-host-5@after5.seed', name: 'Ava',
    prompt: 'Candid dating-profile photograph of a woman in her late 20s with long auburn hair, bright laugh caught mid-moment, light freckles, wearing a cream linen shirt, seated by a sunlit cafe window with a coffee cup in soft focus, warm morning light across her face, natural skin texture, shot on 50mm lens, shallow depth of field, photorealistic, no text, no watermark',
  },
];

// Mirror of generate-blur/index.ts blurParams(): longest side -> 64px,
// blurRadius proportional. Reproduced exactly so seed blurs look identical
// to real-user blurs.
function blurParams(width, height) {
  const MAX = 64;
  const scale = Math.min(1, MAX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { width: w, height: h, blurRadius: Math.max(2, Math.round(Math.max(w, h) / 8)) };
}

// Same softening as the edge fn: downscale to a tiny intermediate (size driven
// by blurRadius), upscale back to the 64px target, JPEG q70.
async function makeBlurred(clearJpeg) {
  const meta = await sharp(clearJpeg).metadata();
  const p = blurParams(meta.width, meta.height);
  const tinyW = Math.max(1, Math.round(p.width / p.blurRadius));
  const tinyH = Math.max(1, Math.round(p.height / p.blurRadius));
  const tiny = await sharp(clearJpeg).resize(tinyW, tinyH, { fit: 'fill' }).toBuffer();
  return sharp(tiny).resize(p.width, p.height, { fit: 'fill' }).jpeg({ quality: 70 }).toBuffer();
}

// Replicate FLUX schnell, portrait aspect, jpg out (same create+poll pattern
// as supabase/functions/generate-cover).
async function generatePortrait(prompt, attempt = 1) {
  const create = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REPLICATE}`, 'Content-Type': 'application/json', Prefer: 'wait=30' },
    body: JSON.stringify({
      input: { prompt, aspect_ratio: '3:4', output_format: 'jpg', output_quality: 92, num_inference_steps: 4, go_fast: true },
    }),
  });
  // Low-credit accounts get throttled to 6 predictions/min, burst 1 — back off
  // and retry instead of failing the host.
  if (create.status === 429 && attempt < 5) {
    console.log(`  … replicate 429, retrying in 30s (attempt ${attempt + 1}/5)`);
    await new Promise((r) => setTimeout(r, 30_000));
    return generatePortrait(prompt, attempt + 1);
  }
  if (!create.ok) throw new Error(`replicate create ${create.status}: ${(await create.text()).slice(0, 160)}`);
  let pred = await create.json();
  if (pred.error) throw new Error(`replicate: ${pred.error}`);
  const pollUrl = pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`;
  for (let i = 0; i < 60 && !(pred.status === 'succeeded' && pred.output); i++) {
    if (pred.status === 'failed' || pred.status === 'canceled') throw new Error(`replicate ${pred.status}: ${pred.error}`);
    await new Promise((r) => setTimeout(r, 1000));
    const r = await fetch(pollUrl, { headers: { Authorization: `Bearer ${REPLICATE}` } });
    if (!r.ok) throw new Error(`replicate poll ${r.status}`);
    pred = await r.json();
  }
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!out) throw new Error('replicate poll timeout');
  const img = await fetch(out);
  if (!img.ok) throw new Error(`image fetch ${img.status}`);
  // Re-encode through sharp so the stored clear object is a plain baseline JPEG.
  return sharp(Buffer.from(await img.arrayBuffer())).jpeg({ quality: 92 }).toBuffer();
}

async function seedUserIdByEmail() {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return Object.fromEntries(
    data.users.filter((u) => (u.email ?? '').endsWith('@after5.seed')).map((u) => [u.email, u.id]),
  );
}

async function clearOldPhotos(uid) {
  // Remove prior profile_photos rows + storage objects in this seed user's folder.
  await sb.from('profile_photos').delete().eq('user_id', uid);
  const { data: objs } = await sb.storage.from(BUCKET).list(uid, { limit: 100 });
  const names = (objs ?? []).map((o) => `${uid}/${o.name}`);
  if (names.length) await sb.storage.from(BUCKET).remove(names);
}

async function main() {
  const byEmail = await seedUserIdByEmail();
  const written = [];

  for (const h of HOSTS) {
    const uid = byEmail[h.email];
    if (!uid) { console.log(`✗ ${h.name}: ${h.email} not found on prod — skipping`); continue; }

    console.log(`${h.name} (${uid}) — generating portrait…`);
    // Replicate low-credit throttle: 6 predictions/min, burst 1 — pace hard.
    await new Promise((r) => setTimeout(r, 12_000));
    const clear = await generatePortrait(h.prompt);
    const blurred = await makeBlurred(clear);

    await clearOldPhotos(uid);

    const photoId = randomUUID();
    const clearPath = `${uid}/${photoId}.jpg`;
    const blurredPath = `${uid}/${photoId}_blurred.jpg`;

    let r = await sb.storage.from(BUCKET).upload(clearPath, clear, { contentType: 'image/jpeg', upsert: true });
    if (r.error) throw new Error(`upload clear ${h.name}: ${r.error.message}`);
    r = await sb.storage.from(BUCKET).upload(blurredPath, blurred, { contentType: 'image/jpeg', upsert: true });
    if (r.error) throw new Error(`upload blurred ${h.name}: ${r.error.message}`);

    // Gallery row (the reveal surface + clear-read storage policy key off it).
    r = await sb.from('profile_photos').insert({
      id: photoId, user_id: uid, clear_path: clearPath, blurred_path: blurredPath,
      sort_order: 0, is_primary: true,
    });
    if (r.error) throw new Error(`profile_photos ${h.name}: ${r.error.message}`);

    // Denormalized primary mirror — STORAGE PATHS, exactly what the feed signs.
    r = await sb.from('profiles').update({ clear_photo_url: clearPath, blurred_photo_url: blurredPath }).eq('id', uid);
    if (r.error) throw new Error(`profiles ${h.name}: ${r.error.message}`);

    console.log(`  ✓ clear=${clearPath} (${clear.length}b)  blurred=${blurredPath} (${blurred.length}b)`);
    written.push({ name: h.name, uid, clearPath, blurredPath });
  }

  // Verify: exercise the signer for each blurred path and download the object.
  console.log('\nsigner check:');
  for (const w of written) {
    const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrl(w.blurredPath, 600);
    if (error || !signed?.signedUrl) throw new Error(`sign FAILED ${w.name}: ${error?.message}`);
    const resp = await fetch(signed.signedUrl);
    const bytes = resp.ok ? (await resp.arrayBuffer()).byteLength : 0;
    if (!resp.ok || bytes === 0) throw new Error(`download FAILED ${w.name}: http ${resp.status}, ${bytes}b`);
    console.log(`  ✓ ${w.name}: signed + downloaded ${bytes}b from ${w.blurredPath}`);
  }
  console.log(`\nDONE: ${written.length}/${HOSTS.length} seed-host portraits live`);
}

main().catch((e) => { console.error('PORTRAITS FAILED:', e.message); process.exit(1); });

// One-off: upload pre-rendered polaroid PNGs to Supabase storage so
// welcome-email previews resolve before the assets are deployed to prod.
//
// Run: node scripts/upload-email-assets.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const BUCKET = 'itinerary-covers'; // public bucket we already have

const files = [
  { local: 'polaroid-west-kelowna.png', remote: 'email/polaroid-west-kelowna.png' },
  { local: 'polaroid-lakeside.png', remote: 'email/polaroid-lakeside.png' },
];

for (const f of files) {
  const path = join(__dirname, '..', 'public', 'email', f.local);
  const bytes = readFileSync(path);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(f.remote, bytes, { contentType: 'image/png', upsert: true });
  if (error) {
    console.error(f.remote, error.message);
    continue;
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(f.remote);
  console.log(f.remote, '→', data.publicUrl);
}

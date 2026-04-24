// One-time cleanup: hide near-duplicate public itineraries by setting
// is_public=false on all but the OLDEST in each cluster.
//
// Cluster definition: same template_id + ≥70% stop place_id overlap.
//
// Run: node scripts/dedupe-itineraries.mjs --dry   (preview)
//      node scripts/dedupe-itineraries.mjs         (commit)

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

const DRY = process.argv.includes('--dry');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { data, error } = await supabase
  .from('itineraries')
  .select('id, title, template_id, stops, generated_at')
  .eq('is_public', true)
  .not('title', 'is', null)
  .order('generated_at', { ascending: true });
if (error) throw error;

console.log(`scanning ${data.length} public titled itineraries`);

// Group by template_id
const byTpl = new Map();
for (const row of data) {
  if (!row.template_id) continue;
  const ids = (Array.isArray(row.stops) ? row.stops : [])
    .map((s) => s.place_id)
    .filter(Boolean);
  if (ids.length === 0) continue;
  if (!byTpl.has(row.template_id)) byTpl.set(row.template_id, []);
  byTpl.get(row.template_id).push({ id: row.id, title: row.title, stopIds: ids, generated_at: row.generated_at });
}

// For each template, greedily cluster: walk in age-ascending order, the
// first one in any cluster is the survivor; subsequent rows that share
// ≥70% stops with the survivor get marked as duplicates.
const toHide = [];
const survivors = [];

for (const [tpl, rows] of byTpl.entries()) {
  // rows already sorted by generated_at asc (from query)
  const clusters = []; // each cluster: { survivor: row, dupes: row[] }
  for (const row of rows) {
    let placed = false;
    for (const cluster of clusters) {
      const overlap = row.stopIds.filter((id) => cluster.survivor.stopIds.includes(id)).length;
      const ratio = overlap / Math.max(row.stopIds.length, cluster.survivor.stopIds.length);
      if (ratio >= 0.7) {
        cluster.dupes.push(row);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ survivor: row, dupes: [] });
    }
  }
  for (const c of clusters) {
    survivors.push(c.survivor);
    if (c.dupes.length > 0) {
      console.log(`\n[${tpl.slice(0, 12)}…]  KEEP: ${c.survivor.title} (${c.survivor.generated_at.slice(0, 10)})`);
      for (const d of c.dupes) {
        console.log(`              HIDE: ${d.title} (${d.generated_at.slice(0, 10)})`);
        toHide.push(d.id);
      }
    }
  }
}

console.log(`\n--- summary ---`);
console.log(`  templates with clusters: ${byTpl.size}`);
console.log(`  survivors (kept public): ${survivors.length}`);
console.log(`  duplicates (to hide):    ${toHide.length}`);

if (DRY) {
  console.log('\n[DRY RUN] no rows updated. Re-run without --dry to commit.');
  process.exit(0);
}

if (toHide.length === 0) {
  console.log('\nnothing to hide.');
  process.exit(0);
}

// Update in chunks of 100 to stay under PostgREST limits
const CHUNK = 100;
let updated = 0;
for (let i = 0; i < toHide.length; i += CHUNK) {
  const ids = toHide.slice(i, i + CHUNK);
  const { error: upErr } = await supabase
    .from('itineraries')
    .update({ is_public: false })
    .in('id', ids);
  if (upErr) {
    console.error(`chunk ${i / CHUNK} failed:`, upErr.message);
    continue;
  }
  updated += ids.length;
  console.log(`hid ${updated}/${toHide.length}`);
}

console.log(`\ndone. ${updated} duplicates hidden.`);

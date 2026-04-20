// Move discovered drafts to live status.
//
//   node scripts/promote-drafts.mjs --all
//     → promotes every approval_status='draft' to 'live'
//
//   node scripts/promote-drafts.mjs --reject "name pattern"
//     → marks any draft whose name matches the pattern as 'rejected' instead
//
//   node scripts/promote-drafts.mjs --list
//     → prints a table of pending drafts (no changes)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

const args = process.argv.slice(2);
const mode = args[0];

async function listDrafts() {
  const { data } = await supabase
    .from('places')
    .select('id, name, type, neighborhood, price_tier, vibe_tags, local_insight, source_query')
    .eq('approval_status', 'draft')
    .order('source_query');
  console.table(
    (data ?? []).map((p) => ({
      name: p.name.slice(0, 36),
      type: p.type,
      area: p.neighborhood,
      $: p.price_tier,
      vibe: (p.vibe_tags ?? []).join('|'),
      insight: (p.local_insight ?? '').slice(0, 60),
    })),
  );
  console.log(`\n${data?.length ?? 0} drafts pending.`);
}

async function promoteAll() {
  const { data, error } = await supabase
    .from('places')
    .update({ approval_status: 'live' })
    .eq('approval_status', 'draft')
    .select('name');
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`Promoted ${data?.length ?? 0} drafts to live.`);
}

async function rejectByPattern(pattern) {
  const { data, error } = await supabase
    .from('places')
    .update({ approval_status: 'rejected' })
    .eq('approval_status', 'draft')
    .ilike('name', `%${pattern}%`)
    .select('name');
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`Rejected ${data?.length ?? 0} drafts matching "${pattern}":`);
  for (const r of data ?? []) console.log(`  - ${r.name}`);
}

async function main() {
  if (mode === '--list') {
    await listDrafts();
  } else if (mode === '--all') {
    await promoteAll();
  } else if (mode === '--reject') {
    const pattern = args[1];
    if (!pattern) {
      console.error('Usage: --reject "pattern"');
      process.exit(1);
    }
    await rejectByPattern(pattern);
  } else {
    console.log('Usage:');
    console.log('  node scripts/promote-drafts.mjs --list');
    console.log('  node scripts/promote-drafts.mjs --all');
    console.log('  node scripts/promote-drafts.mjs --reject "pattern"');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

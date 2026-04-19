// Reads places/seed.json + templates/templates.yaml and writes a Supabase
// migration that idempotently seeds both tables.
//
// Usage:
//   node scripts/generate-seed-sql.mjs
//
// Output:
//   supabase/migrations/<timestamp>_seed_places_and_templates.sql

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const NEIGHBORHOOD_FALLBACK = (cluster) => cluster; // we use cluster as neighborhood for the MVP

// ─── Helpers ──────────────────────────────────────────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function sqlString(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNum(value) {
  if (value === null || value === undefined) return 'null';
  return String(value);
}

function sqlBool(value) {
  return value ? 'true' : 'false';
}

function sqlTextArray(arr) {
  if (!arr || arr.length === 0) return `'{}'`;
  const escaped = arr.map((s) => String(s).replace(/"/g, '\\"')).map((s) => `"${s}"`);
  return `'{${escaped.join(',')}}'`;
}

function sqlEnum(value, fallback) {
  return sqlString(value ?? fallback);
}

// ─── Places ───────────────────────────────────────────────────────────

const placesData = JSON.parse(readFileSync(join(ROOT, 'places/seed.json'), 'utf8'));

const placeRows = placesData.places.map((p) => {
  const name = p.name;
  const slug = slugify(name);
  const type = p.type;
  const driveCluster = p.drive_cluster;
  const neighborhood = p.neighborhood ?? NEIGHBORHOOD_FALLBACK(driveCluster);
  const vibeTags = p.vibe_tags ?? [];
  const pairingTags = p.pairing_tags ?? [];
  const cuisine = p.cuisine ?? [];
  const timeOfDay = p.time_of_day ?? [];
  const seasonality = p.seasonality ?? ['year_round'];
  const closedDays = p.closed_days ?? [];

  return `
  (${sqlString(name)},
   ${sqlString(slug)},
   ${sqlString(neighborhood)},
   ${sqlString(driveCluster)},
   ${sqlString(type)}::place_type,
   ${sqlTextArray(cuisine)}::text[],
   ${sqlTextArray(vibeTags)}::text[],
   ${sqlEnum(p.effort, 'low')}::effort_level,
   ${sqlEnum(p.energy, 'medium')}::energy_level,
   ${sqlTextArray(pairingTags)}::text[],
   ${sqlTextArray(timeOfDay)}::text[],
   ${sqlBool(p.weather_dependent)},
   ${sqlEnum(p.weather_works_in, 'any')}::weather_works_in,
   ${sqlTextArray(seasonality)}::text[],
   ${sqlNum(p.typical_duration_min ?? 60)},
   ${sqlString(p.price_tier ?? '$$')}::price_tier,
   ${sqlNum(p.typical_per_person)},
   ${sqlBool(p.reservation_required)},
   ${sqlNum(p.quality_score ?? 7.0)},
   ${sqlString(p.local_insight ?? null)},
   ${sqlString(p.notes ?? null)})`;
});

const placesInsert = `
insert into places (
  name, slug, neighborhood, drive_cluster, type,
  cuisine, vibe_tags, effort, energy, pairing_tags,
  time_of_day, weather_dependent, weather_works_in, seasonality,
  typical_duration_min, price_tier, typical_per_person,
  reservation_required, quality_score, local_insight, notes
) values${placeRows.join(',')}
on conflict (slug) do update set
  name              = excluded.name,
  neighborhood      = excluded.neighborhood,
  drive_cluster     = excluded.drive_cluster,
  type              = excluded.type,
  cuisine           = excluded.cuisine,
  vibe_tags         = excluded.vibe_tags,
  effort            = excluded.effort,
  energy            = excluded.energy,
  pairing_tags      = excluded.pairing_tags,
  time_of_day       = excluded.time_of_day,
  weather_dependent = excluded.weather_dependent,
  weather_works_in  = excluded.weather_works_in,
  seasonality       = excluded.seasonality,
  typical_duration_min = excluded.typical_duration_min,
  price_tier        = excluded.price_tier,
  typical_per_person = excluded.typical_per_person,
  reservation_required = excluded.reservation_required,
  quality_score     = excluded.quality_score,
  local_insight     = excluded.local_insight,
  notes             = excluded.notes,
  updated_at        = now();
`;

// ─── Templates (hand-crafted, simpler than parsing YAML) ──────────────

const templates = [
  {
    id: 'sunset_wine_dinner',
    name: 'Sunset + Wine + Dinner',
    duration_min: 240,
    suitable_for: ['date'],
    vibe: ['romantic', 'boujee'],
    geographic_rule: 'same_drive_cluster_or_adjacent',
    energy_curve: 'medium-low-low',
    slots: [
      { types: ['viewpoint', 'hike'], time_of_day: ['sunset'], duration_min: 60, effort: ['low', 'moderate'] },
      { types: ['winery', 'cocktail_bar'], time_of_day: ['evening'], duration_min: 90, prefers_pairing_tags: ['sunset_spot', 'needs_wine_legs'] },
      { types: ['restaurant'], time_of_day: ['evening'], duration_min: 90, price_tier: ['$$', '$$$'] },
    ],
  },
  {
    id: 'walk_drink_dessert',
    name: 'Walk + Drink + Dessert',
    duration_min: 150,
    suitable_for: ['date'],
    vibe: ['chill', 'cozy', 'spontaneous'],
    geographic_rule: 'walking_distance_or_same_cluster',
    energy_curve: 'low-low-low',
    slots: [
      { types: ['walk', 'park', 'garden'], duration_min: 45, effort: ['low'] },
      { types: ['cocktail_bar', 'brewery'], duration_min: 60 },
      { types: ['dessert', 'ice_cream', 'bakery'], duration_min: 30 },
    ],
  },
  {
    id: 'activity_food_view',
    name: 'Activity + Food + View',
    duration_min: 300,
    suitable_for: ['date', 'friends'],
    vibe: ['adventurous', 'spontaneous'],
    geographic_rule: 'same_drive_cluster_or_adjacent',
    energy_curve: 'high-medium-low',
    slots: [
      { types: ['activity', 'hike'], effort: ['moderate', 'high'], duration_min: 120 },
      { types: ['restaurant', 'brewery'], duration_min: 90, price_tier: ['$', '$$'] },
      { types: ['viewpoint', 'sunset_spot', 'beach'], time_of_day: ['sunset'], duration_min: 30 },
    ],
  },
  {
    id: 'drinks_dinner_nightcap',
    name: 'Drinks + Dinner + Nightcap',
    duration_min: 210,
    suitable_for: ['date'],
    vibe: ['boujee', 'intimate', 'chill'],
    geographic_rule: 'walking_distance',
    energy_curve: 'low-low-low',
    slots: [
      { types: ['cocktail_bar'], duration_min: 60, prefers_pairing_tags: ['pre_dinner', 'intimate'] },
      { types: ['restaurant'], time_of_day: ['evening'], duration_min: 105, price_tier: ['$$', '$$$'], reservation_required: true },
      { types: ['cocktail_bar', 'dessert'], time_of_day: ['late'], duration_min: 45 },
    ],
  },
  {
    id: 'cozy_indoor_night',
    name: 'Cozy Indoor Night',
    duration_min: 210,
    suitable_for: ['date'],
    vibe: ['cozy', 'intimate'],
    geographic_rule: 'walking_distance_or_same_cluster',
    energy_curve: 'low-low-low',
    slots: [
      { types: ['cafe', 'bakery'], duration_min: 45, prefers_pairing_tags: ['winter_indoor', 'cozy'] },
      { types: ['restaurant'], duration_min: 105, prefers_pairing_tags: ['intimate', 'winter_indoor'] },
      { types: ['cocktail_bar'], duration_min: 60 },
    ],
  },
  {
    id: 'weekend_winery_day',
    name: 'Weekend Winery Day',
    duration_min: 360,
    suitable_for: ['date', 'friends'],
    vibe: ['romantic', 'boujee', 'chill'],
    geographic_rule: 'same_drive_cluster',
    energy_curve: 'low-low-low-low',
    slots: [
      { types: ['cafe', 'bakery'], duration_min: 30 },
      { types: ['winery'], duration_min: 90 },
      { types: ['winery'], duration_min: 90 },
      { types: ['restaurant', 'winery'], time_of_day: ['evening'], duration_min: 120, price_tier: ['$$', '$$$'] },
    ],
  },
  {
    id: 'spontaneous_save',
    name: "The 'I Forgot To Plan' Save",
    duration_min: 120,
    suitable_for: ['date'],
    vibe: ['chill', 'spontaneous'],
    geographic_rule: 'walking_distance',
    energy_curve: 'low-low',
    slots: [
      { types: ['restaurant'], duration_min: 75, reservation_required: false, prefers_pairing_tags: ['no_reservation_needed'] },
      { types: ['dessert', 'ice_cream', 'walk'], duration_min: 30 },
    ],
  },
  {
    id: 'morning_date',
    name: 'Morning Date',
    duration_min: 180,
    suitable_for: ['date'],
    vibe: ['chill', 'cozy'],
    geographic_rule: 'walking_distance_or_same_cluster',
    energy_curve: 'low-medium-low',
    slots: [
      { types: ['cafe', 'bakery'], time_of_day: ['morning'], duration_min: 45 },
      { types: ['walk', 'park', 'garden'], duration_min: 75 },
      { types: ['cafe', 'bakery'], duration_min: 45 },
    ],
  },
  {
    id: 'solo_reset',
    name: 'Solo Reset',
    duration_min: 360,
    suitable_for: ['solo'],
    vibe: ['chill', 'cozy'],
    geographic_rule: 'same_drive_cluster',
    energy_curve: 'low-medium-low-low-low',
    slots: [
      { types: ['cafe'], duration_min: 60 },
      { types: ['hike', 'walk'], duration_min: 90 },
      { types: ['restaurant'], duration_min: 60, price_tier: ['$', '$$'] },
      { types: ['garden', 'park'], duration_min: 30 },
      { types: ['cafe', 'bakery'], duration_min: 30 },
    ],
  },
  {
    id: 'friends_active',
    name: 'Friends Hangout — Active',
    duration_min: 300,
    suitable_for: ['friends'],
    vibe: ['adventurous', 'lively'],
    geographic_rule: 'same_drive_cluster',
    energy_curve: 'high-medium-low-low',
    slots: [
      { types: ['activity'], duration_min: 60 },
      { types: ['brewery', 'cocktail_bar'], duration_min: 90 },
      { types: ['walk', 'park'], duration_min: 30 },
      { types: ['restaurant'], duration_min: 90, price_tier: ['$', '$$'] },
    ],
  },
];

const templateRows = templates.map((t) => `
  (${sqlString(t.id)},
   ${sqlString(t.name)},
   ${sqlNum(t.duration_min)},
   ${sqlTextArray(t.suitable_for)}::occasion[],
   ${sqlTextArray(t.vibe)}::text[],
   ${sqlString(JSON.stringify(t.slots))}::jsonb,
   ${sqlString(t.geographic_rule)},
   ${sqlString(t.energy_curve)})`);

const templatesInsert = `
insert into templates (
  id, name, duration_min, suitable_for, vibe, slots, geographic_rule, energy_curve
) values${templateRows.join(',')}
on conflict (id) do update set
  name           = excluded.name,
  duration_min   = excluded.duration_min,
  suitable_for   = excluded.suitable_for,
  vibe           = excluded.vibe,
  slots          = excluded.slots,
  geographic_rule = excluded.geographic_rule,
  energy_curve   = excluded.energy_curve;
`;

// ─── Write migration ──────────────────────────────────────────────────

const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const filename = `${stamp}_seed_places_and_templates.sql`;
const path = join(ROOT, 'supabase/migrations', filename);

const sql = `-- Idempotent seed of Kelowna places + itinerary templates.
-- Generated by scripts/generate-seed-sql.mjs from places/seed.json
-- and templates inline. Re-run the generator anytime data changes.

${placesInsert}
${templatesInsert}
`;

writeFileSync(path, sql);
console.log(`Wrote ${path}`);
console.log(`  Places: ${placesData.places.length}`);
console.log(`  Templates: ${templates.length}`);

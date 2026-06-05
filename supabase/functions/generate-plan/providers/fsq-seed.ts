// supabase/functions/generate-plan/providers/fsq-seed.ts
// The SHARED Foursquare seed primitives used by BOTH the inline cold-start path
// (onthefly.ts) and the async pre-seed handler (process-jobs/seed-city.ts), so the
// two agree row-for-row on category set + quality-floor + dedupe.
//
// Kept in its own SDK-free module (imports only foursquare.ts → google-places.ts,
// no pipeline.ts/prompt.ts/@anthropic-ai/sdk) so process-jobs/handlers_test.ts can
// exercise the seed handler under plain `deno test` with no node_modules.

import { fsqResultToPlaceRow, passesQualityFloor, type FsqResult } from '../foursquare.ts';

// Fixed server-side Foursquare top-level category IDs (08-RESEARCH "Category
// taxonomy"). Seeded across the date-relevant categories; the granular returned
// categories[].name is mapped to our place_type enum in mapFsqCategories.
// [ASSUMED] — long-standing FSQ top-level ids; re-verified at the 08-06 live smoke
// against docs.foursquare.com/data-products/docs/categories (RESEARCH A1).
// A fixed constant (never user input) per the threat model (SQL-injection /
// unbounded-seed control).
export const FSQ_SEED_CATEGORY_IDS = [
  '4d4b7105d754a06374d81259', // Dining and Drinking  → restaurant / cafe / bar / dessert
  '4d4b7104d754a06370d81259', // Arts and Entertainment → activity / gallery
  '4d4b7105d754a06377d81259', // Landscapes and Outdoors → park / beach / hike / viewpoint / walk
  '4d4b7105d754a06378d81259', // Retail → shop / market
].join(',');

// Map raw Foursquare search results → places rows: quality-floor, dedupe by
// fsq_place_id, map via fsqResultToPlaceRow. The arbiter for the downstream
// upsert is fsq_place_id (the full unique index from 08-03).
export function buildWarmRows(
  results: FsqResult[],
  city: { id: string; slug: string },
  key: string,
) {
  const seen = new Set<string>();
  const rows = [];
  for (const r of results) {
    if (!r.fsq_place_id || seen.has(r.fsq_place_id)) continue;
    if (!passesQualityFloor(r)) continue;
    seen.add(r.fsq_place_id);
    rows.push(fsqResultToPlaceRow(r, city, key));
  }
  return rows;
}

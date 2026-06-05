// supabase/functions/process-jobs/seed-city.ts
// DATA-02: the async city pre-seed handler. Enqueued (dedup'd by city_id) after a
// user saves their profile location; this runs the SAME Foursquare fetch→map→
// upsert as the cold-start path (OnTheFlyProvider) and stamps cities.seeded_at so
// generation is fast + full by the time the user plans.
//
// Poison-loop safety (mirrors v1.0 handlers):
//   - dedup_key = city_id (enqueue side) → at most one pending|running seed/city.
//   - This handler THROWS on hard failure (missing city_id, missing key, city not
//     found, search/upsert error) so index.ts fail_job's it with backoff and
//     dead-letters at attempts>=5. It never silently completes a no-op seed.
//
// Bounded fetch (Area 3 / T-08-12): one /places/search per FSQ top-level category
// (the FIXED server-side FSQ_SEED_CATEGORY_IDS constant — never user input), each
// capped at SEED_LIMIT_PER_CATEGORY. Not a whole-city crawl.

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { type Handler, type Job } from "./handlers.ts";
import {
  searchPlaces as realSearchPlaces,
  type FsqResult,
} from "../generate-plan/foursquare.ts";
import {
  FSQ_SEED_CATEGORY_IDS,
  buildWarmRows,
} from "../generate-plan/providers/fsq-seed.ts";

type Db = SupabaseClient;

// Per-category seed cap — same value the cold-start path uses (onthefly.ts).
const SEED_LIMIT_PER_CATEGORY = 30;

// The city row the handler needs: id/slug for mapping + centroid scalars + radius.
// centroid_lat/lng are the M1 (20260601211200) scalar columns derived from the
// PostGIS centroid geography — no ST_Y/ST_X round-trip needed at fetch time.
interface CityRow {
  id: string;
  slug: string;
  name: string | null;
  default_radius_km: number | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
}

// Injectable Foursquare search so the handler is unit-testable without a live key.
export interface SeedCityDeps {
  searchPlaces: typeof realSearchPlaces;
  // Read the FSQ key from edge env (server-side only). Defaulted to the real
  // env read; tests inject a constant so they never touch Deno.env.
  getKey: () => string | undefined;
}

const defaultDeps: SeedCityDeps = {
  searchPlaces: realSearchPlaces,
  getKey: () => {
    try {
      return Deno.env.get("FOURSQUARE_API_KEY") ?? undefined;
    } catch {
      // No --allow-env (CI/unit) — treat as unset rather than crashing.
      return undefined;
    }
  },
};

export function makeSeedCity(deps: SeedCityDeps = defaultDeps): Handler {
  return async (db: Db, job: Job) => {
    const cityId = (job.payload.city_id as string | undefined) ?? null;
    // Fail loud → index.ts retries/backoff. A seed_city job with no city_id is a
    // producer bug; never silently complete it.
    if (!cityId) throw new Error("seed_city: payload.city_id is required");

    const key = deps.getKey();
    if (!key) throw new Error("seed_city: FOURSQUARE_API_KEY is not configured");

    const { data: city, error: cityErr } = await db
      .from("cities")
      .select("id, slug, name, default_radius_km, centroid_lat, centroid_lng")
      .eq("id", cityId)
      .maybeSingle<CityRow>();
    if (cityErr) throw new Error(`seed_city: city load failed: ${cityErr.message}`);
    if (!city) throw new Error(`seed_city: city ${cityId} not found`);
    if (typeof city.centroid_lat !== "number" || typeof city.centroid_lng !== "number") {
      throw new Error(`seed_city: city ${cityId} has no centroid`);
    }

    // One bounded /places/search per top-level category, parallelized. The new API
    // returns hours/photos/price/rating inline (no per-place Details call).
    const categoryIds = FSQ_SEED_CATEGORY_IDS.split(",");
    const radiusKm = city.default_radius_km ?? 40;
    const settled = await Promise.allSettled(categoryIds.map((id) =>
      deps.searchPlaces({
        apiKey: key,
        lat: city.centroid_lat as number,
        lng: city.centroid_lng as number,
        radiusKm,
        categoryIds: id,
        limit: SEED_LIMIT_PER_CATEGORY,
      })
    ));

    const results: FsqResult[] = [];
    const searchErrors: string[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(...s.value);
      else searchErrors.push(String((s.reason as Error)?.message ?? s.reason));
    }
    // If EVERY category search failed, the seed produced nothing usable — throw so
    // the job retries rather than stamping a city we never actually warmed.
    if (results.length === 0 && searchErrors.length === categoryIds.length) {
      throw new Error(`seed_city: all Foursquare searches failed: ${searchErrors.join("; ")}`);
    }

    // Same quality-floor + dedupe-by-fsq_place_id mapping the cold-start path uses,
    // so a seeded city and an inline-warmed city agree row-for-row.
    const rows = buildWarmRows(results, { id: city.id, slug: city.slug }, key);
    if (rows.length > 0) {
      // Idempotent upsert on the FULL unique index places_fsq_place_id_key (08-03).
      const { error: upErr } = await db
        .from("places")
        .upsert(rows, { onConflict: "fsq_place_id", ignoreDuplicates: true });
      if (upErr) throw new Error(`seed_city: places upsert failed: ${upErr.message}`);
    }

    // Stamp the per-city seed marker (cities.seeded_at, 08-03). Only reached after
    // a successful fetch+upsert, so seeded_at means "this city has real rows".
    const { error: stampErr } = await db
      .from("cities")
      .update({ seeded_at: new Date().toISOString() })
      .eq("id", city.id);
    if (stampErr) throw new Error(`seed_city: cities.seeded_at stamp failed: ${stampErr.message}`);
  };
}

// Default handler bound to the real Foursquare client + edge env key.
export const seedCity: Handler = makeSeedCity();

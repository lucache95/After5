# Bug #77 follow-up: real venue photos on generated dates

Status: **documented (not implemented, not deployed).** The bulletproof curated
fallback shipped with bug #77 stands on its own — every date now renders a
tasteful, on-theme image with zero edge changes. This note is the gated path to
add *real* venue photos for FUTURE generated places.

## What already works today (no change needed)

The on-the-fly Google warm path already fetches and stores a real photo:

- `supabase/functions/generate-plan/google-places.ts`
  - `searchText()` requests `places.photos` in the field mask.
  - `googleResultToPlaceRow()` sets `photo_url = buildPhotoUrl(photoResource, googleKey)`
    when Google returns a photo, where `buildPhotoUrl` →
    `https://places.googleapis.com/v1/{photoResource}/media?maxWidthPx=1200&key={GOOGLE_PLACES_API_KEY}`.

So **discovered** places that pass through the warmer DO get a `photo_url`. The
frontend's `imageForStop()` / `coverImageForNight()` already prefer that
`photo_url` over the curated fallback.

## The two real gaps (why dates still showed the pink placeholder)

1. **`itineraries.cover_image_url` is never set during generation.** The blind
   feed (`browse_feed_for_viewer` → `FeedNight.cover_image_url`) and the
   `/my-nights` list read this column directly. It is null on generated/seed
   itineraries, so the hero fell through to the placeholder. The shipped fix
   resolves a fallback client-side; a server-side backfill is still desirable.

2. **Seed places and LLM-authored stops carry no `photo_url`.** Seed rows were
   inserted without photos; LLM stops reference place rows that may predate the
   photo backfill or be home/at-home stops with no venue.

## Gated implementation plan (real photos)

### A. Backfill `cover_image_url` at generation time (edge — gated redeploy)

In `supabase/functions/generate-plan/persist.ts` (where the itinerary row is
written), after the stops are resolved:

1. Pick the cover source in priority order:
   - first stop with a non-null `photo_url`, else
   - the itinerary's leading stop's `photo_url`.
2. Set `cover_image_url` on the itinerary insert/update to that URL.
3. Leave it null when no stop has a photo — the client fallback covers it.

This is a pure data write; no new API calls. Lowest-risk first step.

### B. Fetch a Place Photo for places missing one (edge — gated redeploy)

For place rows that have a `google_place_id` but null `photo_url` (seed rows,
older discovered rows):

1. Call **Place Details (New)** for the place id with field mask `photos`:
   `GET https://places.googleapis.com/v1/places/{google_place_id}`
   header `X-Goog-FieldMask: photos`, `X-Goog-Api-Key: {GOOGLE_PLACES_API_KEY}`.
2. Take `photos[0].name` (the photo resource) and build the media URL with the
   existing `buildPhotoUrl(photoResource, googleKey)`.
3. `UPDATE places SET photo_url = <url> WHERE id = <id>` (and optionally set
   `photo_time_of_day`/`photo_season` later via the existing classify-photos
   pass so the seasonal scrub in `providers/pipeline.ts` can vet it).

Cost note: Place Details + Photo is billable. Gate it to places missing a
photo, and ideally run it as a one-off backfill script (`apps/web/scripts/`)
against prod rather than inline per-generation, to bound spend.

### C. (Optional) Store the photo bytes instead of a key-bearing URL

`buildPhotoUrl` embeds `GOOGLE_PLACES_API_KEY` in a public-facing URL. That key
is referer/usage-restricted, but to avoid leaking it and to stop relying on
Google's media CDN, download the photo bytes and upload to a Supabase Storage
bucket (e.g. `place-photos/{place_id}.jpg`), then store the public Storage URL in
`photo_url` / `cover_image_url`. This makes images permanent and key-free.

## Deploy steps (when approved — currently OUT OF SCOPE)

1. Implement A (and optionally B/C) in `supabase/functions/generate-plan/`.
2. Confirm `GOOGLE_PLACES_API_KEY` is set as an edge secret (it already is —
   read at `index.ts` via `Deno.env.get('GOOGLE_PLACES_API_KEY')`).
3. Local-test the function, then redeploy the edge function (gated):
   `supabase functions deploy generate-plan` — **explicit approval required.**
4. For existing rows, run the one-off backfill script (B/C) against prod, again
   gated.

Until any of the above ships, the curated fallback from bug #77 guarantees no
empty pink placeholders on any surface.

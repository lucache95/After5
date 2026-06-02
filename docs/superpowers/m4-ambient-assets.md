# M4 ambient assets — manual sourcing (Pixabay)

The `ambient_sounds` seed (`supabase/migrations/20260602120500_m4_ambient_sounds_seed.sql`)
ships PLACEHOLDER `storage_path`/`attribution`. Real audio is sourced and uploaded by hand,
then a small follow-up migration replaces the placeholders with the final paths + attribution.
Audio files are NOT committed to git — they live in the public `ambient-sounds` storage bucket.

## Selection criteria (per loop)

- Source: [Pixabay](https://pixabay.com/sound-effects/) — royalty-free, no-attribution-required
  under the Pixabay Content License (we still record attribution as courtesy).
- Length: 15–30 s, seamless loop (no audible seam at the wrap point).
- Encoding: ~96–128 kbps `.m4a` (preferred, AAC) or `.mp3`. Mono is fine; keep files < ~400 KB.
- Tone: ambient/atmospheric bed, no vocals, no abrupt transients (it loops under a feed).

## The 10 seed rows and their vibe keys

Vibe keys MUST come from the tag vocabulary the app actually emits, or the feed's
vibe-auto fallback (`browse_feed_for_viewer`: `s.vibe_tags && it.vibe_tags`) never matches.
Verified sources of real tags:
- `packages/business/src/vibePalette.ts` keyword matches: `nightlife, outdoor, sunset,
  art, craft, pottery, paint, workshop, coffee, cafe, brunch, active, hike, sport, climb,
  jazz, bar, music, beach, picnic`.
- Seeded date instances + date-quality eval affinities: `cozy, chill, nightlife, romantic,
  classy, intimate, outdoorsy, scenic, relaxed, adventurous, active, upscale, casual,
  energetic, local, date-night`.

| name           | vibe_tags                                  | storage_path (final)        |
|----------------|--------------------------------------------|-----------------------------|
| cozy fireplace | cozy, chill, relaxed                       | cozy/<slug>.m4a             |
| lively street  | nightlife, energetic, local                | nightlife/<slug>.m4a        |
| soft romance   | romantic, classy, intimate                 | romantic/<slug>.m4a         |
| open road      | adventurous, outdoorsy, active             | adventurous/<slug>.m4a      |
| gallery hush   | art, classy, relaxed                       | art/<slug>.m4a              |
| night drive    | nightlife, chill, scenic                   | late-night/<slug>.m4a       |
| lo-fi chill    | chill, cozy, casual                        | chill/<slug>.m4a            |
| market buzz    | local, energetic, casual                   | foodie/<slug>.m4a           |
| lakeside calm  | outdoorsy, scenic, relaxed                 | outdoorsy/<slug>.m4a        |
| jazz lounge    | nightlife, classy, romantic, upscale       | classy/<slug>.m4a           |

## Upload (one-time, per asset)

Download into `./tmp/ambient/` then upload into the public bucket under `<vibe>/<slug>.m4a`:

```bash
# Supabase CLI storage cp (experimental); or use the Storage dashboard / a service-role script.
supabase storage cp ./tmp/ambient/cozy-fireplace.m4a \
  ss:///ambient-sounds/cozy/cozy-fireplace.m4a --experimental
```

Record each final `storage_path`, `duration_sec`, and `attribution`.

## Follow-up migration (post-upload, non-blocking)

Once files are in the bucket, add a follow-up migration that updates each row by `name`:

```sql
update ambient_sounds set storage_path = 'cozy/cozy-fireplace.m4a',
  attribution = 'Sound by <artist> on Pixabay', duration_sec = 22
  where name = 'cozy fireplace';
-- … repeat for each row.
```

Until that lands, the picker previews and feed playback 404 on the placeholder paths —
the UI degrades to silence (decode failures are swallowed in `useAmbientDeck`), so this
is safe to ship ahead of the assets.

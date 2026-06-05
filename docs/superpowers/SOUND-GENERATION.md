# SOUND-GENERATION — ambient loop audio (gated manual content task)

> **GATE:** This is the manual, RLS-bypass audio content task for SOUND-01. The row seed
> (`supabase/migrations/20260606160000_sound01_ambient_loops_seed.sql`) ships the 8 NEW
> `ambient_sounds` rows with their final `storage_path`s; the **audio objects themselves**
> are generated + uploaded here. **Run this at the phase gate (Plan 09-05)** alongside the
> batched prod-apply — not during autonomous execution. Audio files are NOT committed to
> git; they live in the public `ambient-sounds` storage bucket.

This supersedes the v0 Pixabay-sourcing recipe (`docs/superpowers/m4-ambient-assets.md`)
for new loops. The 10 base loops use the same v1.0 ElevenLabs recipe (see
`20260605121000_m4_ambient_sounds_real_paths.sql`).

## v1.0 recipe — ElevenLabs Sound Effects

Generate one seamless background bed per row. Match the night's vibe: it loops quietly
under the feed and the night detail, so no vocals, no melody hook, no abrupt transients.

| Setting        | Value                                                              |
|----------------|-------------------------------------------------------------------|
| Tool           | ElevenLabs **Sound Effects** (`POST /v1/sound-generation`)         |
| `loop`         | **true** — produces a seamless wrap (no audible seam)             |
| `duration_seconds` | **15** (must stay within the `duration_sec` 5–120 CHECK)      |
| `prompt_influence` | ~0.3 (atmospheric bed, not a literal one-shot)               |
| Channels       | **mono** (downmix; halves file size, fine for ambient)            |
| Encoding       | **AAC `.m4a`**, ~96–128 kbps (`< ~400 KB`/file)                   |
| Tone           | ambient/atmospheric, no vocals, no transients                     |

Convert the ElevenLabs output (mp3) to mono m4a if needed:

```bash
ffmpeg -i in.mp3 -ac 1 -c:a aac -b:a 112k out.m4a
```

## The 8 NEW SOUND-01 rows (match name → vibe → final path)

These come from `20260606160000_sound01_ambient_loops_seed.sql`. The `storage_path` in the
migration is already final — upload the generated audio to exactly that object path.

| name            | vibe_tags                                  | storage_path                  | prompt seed                       |
|-----------------|--------------------------------------------|-------------------------------|-----------------------------------|
| table for two   | foodie, romantic, date-night, intimate     | foodie/table-for-two.m4a      | warm restaurant murmur, soft clink |
| golden hour     | sunset, scenic, romantic, relaxed          | sunset/golden-hour.m4a        | calm dusk, gentle wind, distant birds |
| corner cafe     | cafe, cozy, casual, chill                  | cafe/corner-cafe.m4a          | quiet cafe hum, espresso machine, low chatter |
| trailhead       | active, outdoorsy, adventurous, scenic     | active/trailhead.m4a          | forest trail, breeze, footsteps on gravel |
| fine dining     | upscale, classy, date-night, intimate      | upscale/fine-dining.m4a       | hushed upscale dining room, soft ambience |
| coastal breeze  | scenic, outdoorsy, relaxed, romantic       | coastal/coastal-breeze.m4a    | gentle waves, sea breeze, calm shore |
| live set        | nightlife, energetic, local, date-night    | live-music/live-set.m4a       | warm live-venue room tone, distant crowd |
| rainy lounge    | cozy, chill, relaxed, intimate             | lounge/rainy-lounge.m4a       | soft rain on window, cozy interior |

## Upload (one-time, per asset) — service_role JWT

The `ambient-sounds` bucket has **no authenticated write policy** — only `service_role`
(RLS-bypass) may write (see `20260602120000_m4_ambient_sounds.sql:22` and threat T-09-04).
Upload to exactly the `storage_path` the row already declares, e.g.:

```bash
# Storage REST upload with the SERVICE_ROLE key (NOT the publishable/anon key).
# Bucket is public-read, service_role-write. Run from a trusted machine; never in client code.
SR="$SUPABASE_SERVICE_ROLE_KEY"   # service_role JWT — keep out of git/logs
BASE="$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/ambient-sounds"

curl -sS -X POST "$BASE/foodie/table-for-two.m4a" \
  -H "Authorization: Bearer $SR" \
  -H "Content-Type: audio/mp4" \
  --data-binary @./tmp/ambient/table-for-two.m4a
# repeat for each of the 8 paths above
```

Or use the Storage dashboard (Studio → Storage → ambient-sounds) under each `<vibe>/`
prefix. After upload, the public URL is `<bucket-base>/ambient-sounds/<vibe>/<slug>.m4a`;
the client prefixes the public base to the `storage_path` the feed RPC returns.

## Verify after upload

1. Each of the 8 paths returns 200 from the public bucket URL.
2. The feed surfaces a vibe-matched loop: `supabase/tests/sound01_vibe_auto_pick.sql`
   already proves the row-level overlap pick; once audio is up, the path resolves to a real
   object (no follow-up migration needed — paths are final in the seed).
3. `duration_sec` in the row matches the actual file (15 s as seeded).

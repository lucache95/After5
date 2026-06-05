-- supabase/migrations/20260606160000_sound01_ambient_loops_seed.sql
-- SOUND-01 (Area 4 — expand the ambient track library). Adds 8 NEW ambient_sounds rows
-- that fill gaps in the itinerary vibe_tags taxonomy NOT well covered by the 10 base
-- loops (20260602120500_m4_ambient_sounds_seed). These widen the vibe-overlap pool the
-- feed/post_night lateral (browse_feed_for_viewer: `s.vibe_tags && it.vibe_tags`) draws
-- from, so a generated date with a given vibe auto-resolves a vibe-matched soundtrack.
--
-- ROWS ONLY — this migration does NOT upload audio. Each storage_path points at
-- <vibe>/<slug>.m4a in the public `ambient-sounds` bucket; the audio objects are
-- generated + uploaded behind a GATED manual step (service_role JWT) — see
-- docs/superpowers/SOUND-GENERATION.md, to run at the phase gate (Plan 09-05).
--
-- Idempotent: upsert on the ambient_sounds_name_key unique index (name). Re-running
-- updates the same rows in place rather than duplicating. New names + sort_orders >100
-- so they never collide with the base 10.
--
-- vibe_tags are drawn from the SAME real tag vocabulary the app emits (vibePalette.ts +
-- seeded date instances / eval affinities): foodie, date-night, sunset, scenic, cafe,
-- relaxed, active, outdoorsy, upscale, classy, intimate, romantic, nightlife, energetic,
-- chill, cozy, casual, local, adventurous. Coverage focus: foodie, date-night, sunset/
-- golden-hour, cafe, active-hike, upscale fine-dining, coastal/beach, live-music — the
-- itinerary vibes the base 10 underserve.
insert into ambient_sounds (name, vibe_tags, storage_path, duration_sec, attribution, sort_order) values
  ('table for two',     array['foodie','romantic','date-night','intimate'],   'foodie/table-for-two.m4a',       15, 'Generated with ElevenLabs', 110),
  ('golden hour',       array['sunset','scenic','romantic','relaxed'],        'sunset/golden-hour.m4a',         15, 'Generated with ElevenLabs', 120),
  ('corner cafe',       array['cafe','cozy','casual','chill'],                'cafe/corner-cafe.m4a',           15, 'Generated with ElevenLabs', 130),
  ('trailhead',         array['active','outdoorsy','adventurous','scenic'],   'active/trailhead.m4a',           15, 'Generated with ElevenLabs', 140),
  ('fine dining',       array['upscale','classy','date-night','intimate'],    'upscale/fine-dining.m4a',        15, 'Generated with ElevenLabs', 150),
  ('coastal breeze',    array['scenic','outdoorsy','relaxed','romantic'],     'coastal/coastal-breeze.m4a',     15, 'Generated with ElevenLabs', 160),
  ('live set',          array['nightlife','energetic','local','date-night'],  'live-music/live-set.m4a',        15, 'Generated with ElevenLabs', 170),
  ('rainy lounge',      array['cozy','chill','relaxed','intimate'],           'lounge/rainy-lounge.m4a',        15, 'Generated with ElevenLabs', 180)
on conflict (name) do update set
  vibe_tags = excluded.vibe_tags, storage_path = excluded.storage_path,
  duration_sec = excluded.duration_sec, attribution = excluded.attribution,
  sort_order = excluded.sort_order, is_active = true;

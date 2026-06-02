-- supabase/migrations/20260602120500_m4_ambient_sounds_seed.sql
-- Curated Pixabay loops. PLACEHOLDER storage_path/attribution — fill after the manual
-- asset upload (see docs/superpowers/m4-ambient-assets.md). Idempotent on name
-- (ambient_sounds_name_key, created in 20260602120000).
--
-- vibe_tags are drawn from the REAL tag vocabulary the app emits so the feed's
-- vibe-auto fallback (browse_feed_for_viewer, vibe_tags && it.vibe_tags) is live:
--  - vibePalette.ts matches: nightlife, outdoor/sunset, art/craft, cafe, active/hike
--  - seeded date instances / eval affinities use: cozy, chill, nightlife, romantic,
--    classy, intimate, outdoorsy, scenic, relaxed, adventurous, active, upscale,
--    casual, energetic, local, date-night
insert into ambient_sounds (name, vibe_tags, storage_path, duration_sec, attribution, sort_order) values
  ('cozy fireplace',  array['cozy','chill','relaxed'],          'cozy/PLACEHOLDER.m4a',       20, 'Pixabay — TODO', 10),
  ('lively street',   array['nightlife','energetic','local'],   'nightlife/PLACEHOLDER.m4a',  20, 'Pixabay — TODO', 20),
  ('soft romance',    array['romantic','classy','intimate'],    'romantic/PLACEHOLDER.m4a',   20, 'Pixabay — TODO', 30),
  ('open road',       array['adventurous','outdoorsy','active'],'adventurous/PLACEHOLDER.m4a',20, 'Pixabay — TODO', 40),
  ('gallery hush',    array['art','classy','relaxed'],          'art/PLACEHOLDER.m4a',        20, 'Pixabay — TODO', 50),
  ('night drive',     array['nightlife','chill','scenic'],      'late-night/PLACEHOLDER.m4a', 20, 'Pixabay — TODO', 60),
  ('lo-fi chill',     array['chill','cozy','casual'],           'chill/PLACEHOLDER.m4a',      20, 'Pixabay — TODO', 70),
  ('market buzz',     array['local','energetic','casual'],      'foodie/PLACEHOLDER.m4a',     20, 'Pixabay — TODO', 80),
  ('lakeside calm',   array['outdoorsy','scenic','relaxed'],    'outdoorsy/PLACEHOLDER.m4a',  20, 'Pixabay — TODO', 90),
  ('jazz lounge',     array['nightlife','classy','romantic','upscale'], 'classy/PLACEHOLDER.m4a', 20, 'Pixabay — TODO', 100)
on conflict (name) do update set
  vibe_tags = excluded.vibe_tags, storage_path = excluded.storage_path,
  duration_sec = excluded.duration_sec, attribution = excluded.attribution,
  sort_order = excluded.sort_order;

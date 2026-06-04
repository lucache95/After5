-- 20260605121000_m4_ambient_sounds_real_paths.sql
-- Replace the PLACEHOLDER ambient storage_paths (20260602120500) with the real uploaded
-- loops. Audio lives in the public `ambient-sounds` bucket at <vibe>/<slug>.m4a (15s mono
-- AAC, seamless background loops). Generated with ElevenLabs Sound Effects (loop=true),
-- one per vibe so the host's create-a-date soundtrack picker offers real variety.
-- Idempotent: matches on name (ambient_sounds_name_key).
update ambient_sounds set storage_path = 'cozy/cozy-fireplace.m4a',        attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'cozy fireplace';
update ambient_sounds set storage_path = 'nightlife/lively-street.m4a',    attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'lively street';
update ambient_sounds set storage_path = 'romantic/soft-romance.m4a',      attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'soft romance';
update ambient_sounds set storage_path = 'adventurous/open-road.m4a',      attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'open road';
update ambient_sounds set storage_path = 'art/gallery-hush.m4a',           attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'gallery hush';
update ambient_sounds set storage_path = 'late-night/night-drive.m4a',     attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'night drive';
update ambient_sounds set storage_path = 'chill/lo-fi-chill.m4a',          attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'lo-fi chill';
update ambient_sounds set storage_path = 'foodie/market-buzz.m4a',         attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'market buzz';
update ambient_sounds set storage_path = 'outdoorsy/lakeside-calm.m4a',    attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'lakeside calm';
update ambient_sounds set storage_path = 'classy/jazz-lounge.m4a',         attribution = 'Generated with ElevenLabs', duration_sec = 15 where name = 'jazz lounge';

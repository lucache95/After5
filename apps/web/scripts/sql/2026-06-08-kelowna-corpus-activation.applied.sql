-- Kelowna corpus activation — PROD data-ops applied 2026-06-08 (ref ufufmcpnysvwtutpbian).
-- Applied via Supabase MCP, recorded here for provenance + reversibility.
-- NOT a migration (data-only, prod-specific) — do not add to supabase/migrations/.
-- Hours/coords backfill + sunset seeding were done by the sibling .mjs scripts.

-- ── WS2/3: reject 4 retail duds, promote completeness-passing drafts ──────────
update places set approval_status='rejected', updated_at=now()
where source='curated' and approval_status='draft'
  and name in ('Spades Tactical: Airsoft Guns, Tactical Gear & Knives.',
               'Art Knapp Kelowna','Okanagan Garden Centres','Rustic Chalk Decor');

update places set approval_status='live', updated_at=now()
where source='curated' and approval_status='draft'
  and photo_url is not null and photo_url<>'' and lat is not null and lng is not null
  and opens is not null and closes is not null and array_length(vibe_tags,1)>=1;
-- → rejected 4, promoted 104.

-- ── WS5a: retype real experiences mis-filed as shop/cocktail_bar -> activity ──
update places set type='activity', updated_at=now()
where source='curated' and approval_status='live'
  and name in ('LakeSUP Paddleboard Company','LakeSurf Premium Rentals',
    'Kelowna Driving Range & Mini Golf Powered by Toptracer','Clayline Pottery Studio',
    'Gneiss Climbing - Hill Security','XPERIENCE Games - Exit Escape Room & VR',
    'Energyplex - Entertainment Centre Kelowna');

-- ── WS5b: is_delighter backfill (was 0 corpus-wide) ──────────────────────────
update places set is_delighter=true, updated_at=now()
where source='curated' and approval_status='live' and (
  type in ('viewpoint','sunset_spot')
  or (type='winery' and name ~* 'Quails|CedarCreek|Mission Hill|Hatch|Tantalus|Volcanic|Spirits|Little Straw')
  or (type='activity' and name ~* 'Laser|Lazer|Axe|Paintball|Karting|Zero Latency|Virtual Rcades|Galaxy|Climb|Crux|Gneiss|Paddle|SUP|LakeSurf|Horse|Pottery|Clayline|Work Of Art|Comedy|Theatre|Mary Irwin|Escape|KF Centre|Lavender|Mini Golf'));

-- ── WS5c/d: revive food_focused / creative vibe tags ─────────────────────────
update places set vibe_tags = array_append(vibe_tags,'food_focused'), updated_at=now()
where source='curated' and approval_status='live'
  and type in ('restaurant','dessert','bakery','ice_cream') and not ('food_focused'=any(vibe_tags));

update places set vibe_tags = array_append(vibe_tags,'creative'), updated_at=now()
where source='curated' and approval_status='live'
  and (type='gallery' or name ~* 'Pottery|Clayline|Work Of Art|Paint|Comedy|Theatre|Mary Irwin|Cookbook|Vision Board|Little Kitchen|Studio On Water|Wine Country Studio')
  and not ('creative'=any(vibe_tags));

-- ── WS4: flag established west-facing sunset beaches as delighters + golden hour
update places set is_delighter=true,
  time_of_day=(select array_agg(distinct t) from unnest(array_append(time_of_day,'evening')) t),
  updated_at=now()
where source='curated' and approval_status='live'
  and name in ('Tugboat Beach','Rotary Beach','Hot Sands Beach','Boyce-Gyro Beach Park','Kelowna City Park','Kalamoir Regional Park');

-- ── REVERSAL (if needed) ──────────────────────────────────────────────────────
-- Promotion/rejection: set approval_status back to 'draft' for the affected rows.
-- Tags: array_remove(vibe_tags,'food_focused' / 'creative'); is_delighter=false.
-- Retypes: restore prior types (shop / cocktail_bar) by name.
-- Sunset seed rows (6): delete from places where source='curated'
--   and name in ('Dilworth Mountain Park','Mount Boucherie Regional Park',
--   'Knox Mountain Apex Lookout','Paul''s Tomb (Knox Mountain)','Sarsons Beach','Bluebird Beach');

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

-- ══ 2026-06-09 POST-AUDIT PASS (applied via Supabase MCP) ════════════════════
-- Audit verified all 2026-06-08 numbers against prod, then closed the gaps.

-- Reject 4 duds among the 12 held drafts that completeness couldn't catch:
-- Viewpoint Drive (a residential street, not a venue), Rutland Arena (hockey
-- rink — events tier), Revelry (nightclub — deprioritized), Little Kitchen
-- Academy (kids' cooking school — not a date venue).
update places set approval_status='rejected', updated_at=now()
where source='curated' and approval_status='draft'
  and name in ('Viewpoint Drive','Rutland Arena','Revelry','Little Kitchen Academy Kelowna');

-- P0: ESTIMATED typical hours for the 8 real booking/seasonal venues Google has
-- no posted hours for (each bookable one carries reservation_url where users
-- confirm), then promote. Balkanagan 11-19, Black Box 19-22:30, Inspire 9-17,
-- Pottery 108 10-21, Lavender 10-17, S&J Paddle 10-19, Wine Country 11-17,
-- Island Stage 17-22 + seasonality={summer}.
-- (per-row updates omitted here for brevity — names + windows above are exact)
update places set approval_status='live', updated_at=now()
where source='curated' and approval_status='draft'
  and photo_url is not null and photo_url<>'' and lat is not null and lng is not null
  and opens is not null and closes is not null and array_length(vibe_tags,1)>=1;
-- → promoted 8. live 169 → 177.

-- Audit fixes: Buffalo Rouge is a brewery; Mission Creek Greenway is a walk route.
update places set type='brewery', updated_at=now()
where source='curated' and name='Buffalo Rouge Brewing Co.' and type='cocktail_bar';
update places set type='walk', updated_at=now()
where source='curated' and name='Mission Creek Greenway Regional Park' and type='park';

-- P1 walks gap (4 → 7, target 6+): seed-walks-fix-photos.mjs added Gellatly Bay
-- Recreational Trail, Rotary Marsh Park Loop, Abbott Street Heritage Walk (live
-- 177 → 180) and set Knox Mountain Park's photo on the 2 photo-less Knox rows.

-- ══ 2026-06-09 GAP-FILL PASS ═════════════════════════════════════════════════
-- seed-gap-fills.mjs added: Mosaic Books (shop), Milkcrate Records (shop),
-- Kelowna Floating Sauna (activity, is_delighter), Rusty's Sports Lounge
-- (activity/billiards). live 180 → 184; ALL 21 supply categories meet target.
--
-- INCIDENT + FIX: the "Kelowna Night Market" searchText resolved to the SAME
-- google_place_id as the existing Farmers' & Crafters' Market row; the upsert
-- overwrote it (name/hours/vibe/insight). Restored via UPDATE (name, market,
-- 08:00–13:00, morning, summer, casual/lively/fun, new insight). Seed scripts
-- now check for an existing google_place_id and SKIP instead of upserting.

-- ── REVERSAL (if needed) ──────────────────────────────────────────────────────
-- Promotion/rejection: set approval_status back to 'draft' for the affected rows.
-- Tags: array_remove(vibe_tags,'food_focused' / 'creative'); is_delighter=false.
-- Retypes: restore prior types (shop / cocktail_bar) by name.
-- Sunset seed rows (6): delete from places where source='curated'
--   and name in ('Dilworth Mountain Park','Mount Boucherie Regional Park',
--   'Knox Mountain Apex Lookout','Paul''s Tomb (Knox Mountain)','Sarsons Beach','Bluebird Beach');

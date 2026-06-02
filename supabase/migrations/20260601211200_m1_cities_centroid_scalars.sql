-- M1: scalar centroid for in-memory radius filtering (filterPlaces is JS
-- haversine, not PostGIS). Derived from the existing centroid geography so
-- providers never touch PostGIS.
alter table cities
  add column if not exists centroid_lat numeric,
  add column if not exists centroid_lng numeric;

update cities
   set centroid_lat = ST_Y(centroid::geometry),
       centroid_lng = ST_X(centroid::geometry)
 where centroid is not null
   and (centroid_lat is null or centroid_lng is null);

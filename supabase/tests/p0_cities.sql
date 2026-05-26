-- supabase/tests/p0_cities.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_extension WHERE extname = 'btree_gist';
  IF NOT FOUND THEN RAISE EXCEPTION 'btree_gist not installed'; END IF;
  PERFORM 1 FROM pg_extension WHERE extname = 'postgis';
  IF NOT FOUND THEN RAISE EXCEPTION 'postgis not installed'; END IF;
  PERFORM 1 FROM cities WHERE slug = 'kelowna';
  IF NOT FOUND THEN RAISE EXCEPTION 'kelowna city seed missing'; END IF;
END $$;

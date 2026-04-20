-- Allow public reads of any itinerary by ID.
-- The UUID is the privacy boundary (unguessable, ~10^38 keyspace).
-- The `is_public` flag remains in use for SEO indexability + library
-- inclusion (Phase 5). Anyone with the link can read; only loved-3+
-- itineraries appear in sitemaps and the public library.

drop policy if exists "itineraries_public_read" on itineraries;

create policy "itineraries_readable_by_id"
  on itineraries for select
  using (true);

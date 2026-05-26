-- BASELINE PARITY (not a new feature): itineraries.is_featured already exists in production
-- but was never captured in a local migration. It is an editorial "spotlight this plan on the
-- homepage" flag read by components/ExploreDatesStrip.tsx (feed of is_public AND is_featured
-- plans). Restored here faithfully from production (boolean NOT NULL default false). Idempotent
-- so it is a safe no-op against environments that already have the column. No data is touched.
alter table itineraries
  add column if not exists is_featured boolean not null default false;

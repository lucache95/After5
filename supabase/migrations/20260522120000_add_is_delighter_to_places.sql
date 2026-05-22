-- Add is_delighter flag to places for the "One Weird Thing" taste rule.
-- Delighters are surprise stops (cheese shop with free samples, rooftop
-- with hidden access, bookstore with a wine bar, etc.) that the generator
-- can inject as a post-selection step to prevent generic-feeling plans.
-- Default false — curators manually tag places as delighters.

alter table places
  add column if not exists is_delighter boolean not null default false;

comment on column places.is_delighter is
  'Surprise stop candidate for the "One Weird Thing" taste rule. Manually curated.';

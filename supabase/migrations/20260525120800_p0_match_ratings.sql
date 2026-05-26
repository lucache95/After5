-- supabase/migrations/20260525120800_p0_match_ratings.sql
create table if not exists match_ratings (
  id uuid primary key default gen_random_uuid(),
  lock_id uuid not null references locks(id) on delete cascade,
  rater_id uuid not null references profiles(id) on delete cascade,
  ratee_id uuid not null references profiles(id) on delete cascade,
  showed_up boolean,
  on_time boolean,
  cancelled_with_notice boolean,
  unsafe_or_disrespectful boolean,
  submitted_at timestamptz not null default now(),
  unique (lock_id, rater_id)         -- one rating per rater per locked date
);
create index if not exists match_ratings_ratee_idx on match_ratings(ratee_id);

alter table match_ratings enable row level security;
do $$ begin
  create policy "match_ratings_rater_insert" on match_ratings for insert
    with check (rater_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  -- raters read only their own submission (blind-until-both is enforced in the read API);
  -- aggregate reliability is exposed via profiles.reliability_score, not raw rows.
  create policy "match_ratings_rater_read_own" on match_ratings for select
    using (rater_id = auth.uid());
exception when duplicate_object then null; end $$;

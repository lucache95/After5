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
  unique (lock_id, rater_id),        -- one rating per rater per locked date
  check (rater_id <> ratee_id)       -- cannot rate yourself
);
create index if not exists match_ratings_ratee_idx on match_ratings(ratee_id);

alter table match_ratings enable row level security;
-- Insert: the rater must be auth.uid() AND must actually have been a participant of the lock,
-- rating the COUNTERPARTY (not an arbitrary lock_id/ratee_id). Without the participation check,
-- a user could stuff ratings against strangers' locks and pollute reliability. (Service-role
-- writers in S8 bypass RLS; the table-level rater<>ratee CHECK still guards those.)
do $$ begin
  create policy "match_ratings_rater_insert" on match_ratings for insert
    with check (
      rater_id = auth.uid()
      and exists (
        select 1 from locks l
        where l.id = lock_id
          and ((l.creator_id = auth.uid() and l.matched_user_id = ratee_id)
            or (l.matched_user_id = auth.uid() and l.creator_id = ratee_id))
      )
    );
exception when duplicate_object then null; end $$;
do $$ begin
  -- raters read only their own submission (blind-until-both is enforced in the read API);
  -- aggregate reliability is exposed via profiles.reliability_score, not raw rows.
  create policy "match_ratings_rater_read_own" on match_ratings for select
    using (rater_id = auth.uid());
exception when duplicate_object then null; end $$;

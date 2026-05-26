-- supabase/migrations/20260525120400_p0_swipes.sql
do $$ begin
  create type swipe_direction as enum ('right','left');
exception when duplicate_object then null; end $$;

create table if not exists swipes (
  id uuid primary key default gen_random_uuid(),
  swiper_id uuid not null references profiles(id) on delete cascade,
  date_instance_id uuid not null references date_instances(id) on delete cascade,
  creator_id uuid not null references profiles(id) on delete cascade, -- denormalized
  direction swipe_direction not null,
  created_at timestamptz not null default now()
);
create unique index if not exists swipes_unique_swiper_instance
  on swipes (swiper_id, date_instance_id);
create index if not exists swipes_instance_idx on swipes(date_instance_id) where direction='right';

alter table swipes enable row level security;
-- Insert: the swiper may only insert their own swipe, AND the denormalized creator_id
-- MUST equal the date instance's real creator. Without the creator_id check, a user could
-- forge creator_id=self on any instance and then use swipes_visible (below) to read every
-- right-swiper's identity on instances they don't own — defeating blind browse. Validating
-- against date_instances closes that leak (date_instances.creator_id is indexed).
do $$ begin
  create policy "swipes_swiper_insert" on swipes for insert
    with check (
      swiper_id = auth.uid()
      and creator_id = (select di.creator_id from date_instances di where di.id = date_instance_id)
    );
exception when duplicate_object then null; end $$;
-- No UPDATE/DELETE policy: swipes are an immutable interest ledger. Swipe retraction (if ever
-- offered) is deferred to S5/S6, which must define its semantics before adding a write policy.
do $$ begin
  -- a swiper may read their own swipes; the creator may read right-swipes on THEIR instances
  create policy "swipes_visible" on swipes for select using (
    swiper_id = auth.uid()
    or (direction='right' and creator_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

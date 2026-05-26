create table if not exists profile_prompts (
  id          text primary key,
  label       text not null,
  placeholder text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table profile_prompts enable row level security;
do $$ begin
  create policy "profile_prompts_public_read" on profile_prompts for select using (is_active = true);
exception when duplicate_object then null; end $$;
insert into profile_prompts (id, label, placeholder, sort_order) values
  ('two_truths',        'Two truths and a lie',     'Make me guess…',                 1),
  ('my_ideal_first_date','My ideal first date is…', 'Keep it real, not Pinterest…',   2),
  ('unusual_skill',     'An unusual skill I have',  'Surprise me…',                   3),
  ('best_kelowna_spot', 'My favourite Kelowna spot','Where would you take me?',       4),
  ('a_perfect_sunday',  'A perfect Sunday looks like','Paint the picture…',           5)
on conflict (id) do nothing;
alter table profiles
  add column if not exists dealbreakers text[] not null default '{}',
  add column if not exists prompt_answers jsonb not null default '[]'::jsonb,
  add column if not exists onboarding_step text not null default 'age_gate'
    check (onboarding_step in ('age_gate','basics','photos','preferences','phone_verify','selfie_verify','done')),
  add column if not exists onboarding_completed_at timestamptz;

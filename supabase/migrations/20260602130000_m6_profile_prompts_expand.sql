-- 20260602130000_m6_profile_prompts_expand.sql
-- M6: broaden the curated prompt set toward the Gen-Z brand voice (DESIGN-SYSTEM §8)
-- and drop the Kelowna-hardcoded prompt (product is multi-city). Additive + idempotent;
-- existing prompt_answers referencing retired ids still render (the answer text is stored
-- on profiles.prompt_answers, the label is looked up best-effort).
update profile_prompts set is_active = false where id = 'best_kelowna_spot';

insert into profile_prompts (id, label, placeholder, sort_order) values
  ('green_flag',        'green flag energy',              'what wins me over…',          4),
  ('the_ick',           'the ick i''d die on',            'be honest…',                  6),
  ('roman_empire',      'my roman empire',                'the thing i think about daily…', 7),
  ('we_vibe_when',      'i''ll know we vibe when…',        'finish it…',                  8),
  ('weekend_plan',      'a perfect day off looks like',   'paint the picture…',          9),
  ('chronically_online','most chronically online thing about me', 'no judgement…',       10)
on conflict (id) do nothing;

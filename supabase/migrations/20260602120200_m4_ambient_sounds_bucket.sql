-- supabase/migrations/20260602120200_m4_ambient_sounds_bucket.sql
-- Public bucket for curated ambient loops (royalty-free, no privacy concern).
-- Public read is implicit for public buckets; writes are admin/service-role only (no write policy).
insert into storage.buckets (id, name, public) values ('ambient-sounds', 'ambient-sounds', true)
on conflict (id) do nothing;

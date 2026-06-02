-- 20260602130200_m6_profile_photos_storage.sql
-- M6 storage reads. Existing profile_photos_owner_write (all ops, owner folder) and
-- profile_photos_blurred_read (right(name,11)='blurred.jpg') stay. Add:
--   (a) per-photo blurred read for the blind feed (names end '_blurred.jpg'),
--   (b) reveal-gated clear read: a viewer may read <owner>/<id>.jpg iff there is a
--       profile_photos row with that clear_path whose owner is reveal-allowed to them.
do $$ begin
  create policy profile_photos_blurred_read_v2 on storage.objects for select
    using (
      bucket_id = 'profile-photos'
      and right(name, 12) = '_blurred.jpg'
      and auth.role() = 'authenticated'
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy profile_photos_clear_reveal_read on storage.objects for select
    to authenticated
    using (
      bucket_id = 'profile-photos'
      and exists (
        select 1 from public.profile_photos pp
        where pp.clear_path = storage.objects.name
          and (pp.user_id = auth.uid() or public.match_reveal_allowed_pair(auth.uid(), pp.user_id))
      )
    );
exception when duplicate_object then null; end $$;

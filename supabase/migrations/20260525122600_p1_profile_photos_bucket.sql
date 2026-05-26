insert into storage.buckets (id, name, public) values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;
do $$ begin
  create policy "profile_photos_owner_write" on storage.objects for all
    using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "profile_photos_blurred_read" on storage.objects for select
    using (bucket_id = 'profile-photos' and right(name, 11) = 'blurred.jpg' and auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

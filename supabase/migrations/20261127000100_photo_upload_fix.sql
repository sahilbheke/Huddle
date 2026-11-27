-- Fix "new row violates row-level security policy" on photo upload.
-- The upload rule now lives in one security-definer function, so it doesn't depend on
-- the uploader's own row-level access to spaces/space_members, and a malformed path
-- simply fails the check instead of raising a uuid cast error. Safe to run more than once.

create or replace function public.can_upload_photo(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_space uuid;
begin
  if auth.uid() is null or array_length(v_parts, 1) <> 3 then return false; end if;
  if lower(v_parts[2]) <> auth.uid()::text then return false; end if;
  begin
    v_space := v_parts[1]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1 from space_members m join spaces s on s.id = m.space_id
    where m.space_id = v_space and m.user_id = auth.uid() and m.left_at is null and s.photos_enabled
  );
end $$;

revoke execute on function public.can_upload_photo(text) from public, anon;
grant execute on function public.can_upload_photo(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "proofs: upload own" on storage.objects;
create policy "proofs: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and public.can_upload_photo(name));

-- Reading back (the upload returns the new row) needs the read rule too; recreate it in case it's missing.
drop policy if exists "proofs: members read" on storage.objects;
create policy "proofs: members read" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and public.is_member(((storage.foldername(name))[1])::uuid));

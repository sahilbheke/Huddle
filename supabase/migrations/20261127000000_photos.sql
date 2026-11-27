-- Photo sharing: photos on chat messages, proof photos on check-ins, and cleanup.
--
-- Photos live in the private 'proofs' bucket at <space_id>/<user_id>/<name>.
-- The app compresses each photo before upload (about 1600 px, JPEG), so a photo
-- is usually 200-500 KB. Supabase Storage blocks deleting files with SQL, so the
-- app removes files through the Storage API: the delete RPCs below return the
-- path(s) it should remove.

-- ---------------------------------------------------------------------------
-- Messages can carry a photo, and a photo message may have no text
-- ---------------------------------------------------------------------------

alter table public.messages add column photo_path text;
alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check check (
  (body is not null and char_length(body) between 1 and 2000)
  or (body is null and photo_path is not null)
);

-- A message may only point at a photo the sender uploaded to this space's folder.
create function public.guard_message_photo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.photo_path is not null and new.photo_path not like new.space_id::text || '/' || new.user_id::text || '/%' then
    raise exception 'photo does not belong to this message';
  end if;
  return new;
end $$;

create trigger messages_guard_photo before insert or update of photo_path on public.messages
  for each row execute function public.guard_message_photo();

-- send_message gains an optional photo. Drop the old two-argument version so calls are not ambiguous.
drop function public.send_message(uuid, text);

create function public.send_message(p_space uuid, p_body text default null, p_photo_path text default null)
returns public.messages language plpgsql security definer set search_path = public as $$
declare v_row messages; v_body text := nullif(trim(coalesce(p_body, '')), '');
begin
  if not is_active_member(p_space) then raise exception 'not a member of this space'; end if;
  if not (select chat_enabled from spaces where id = p_space) then
    raise exception 'chat_off' using hint = 'Only check-ins can be posted in this space.';
  end if;
  if p_photo_path is not null and not (select photos_enabled from spaces where id = p_space) then
    raise exception 'photos are turned off in this space';
  end if;
  if v_body is null and p_photo_path is null then raise exception 'empty message'; end if;
  insert into messages (space_id, user_id, body, photo_path)
  values (p_space, auth.uid(), v_body, p_photo_path) returning * into v_row;
  return v_row;
end $$;

-- The feed now returns message photos too.
create or replace function public.space_feed(p_space uuid, p_before timestamptz default null, p_limit int default 40)
returns table (
  kind text, id uuid, user_id uuid, name text, created_at timestamptz, body text,
  type_label text, type_key text, derive_kind text, vals jsonb, fields jsonb,
  photo_path text, cheers int, cheered boolean
)
language sql stable security definer set search_path = public as $$
  with items as (
    select 'checkin'::text as kind, c.id, c.user_id, c.created_at, c.caption as body,
           t.label as type_label, t.key as type_key, t.derive_kind, c.vals, c.type_id, c.photo_path
    from checkins c join activity_types t on t.id = c.type_id
    where c.space_id = p_space and (p_before is null or c.created_at < p_before)
    union all
    select 'message', m.id, m.user_id, m.created_at, m.body, null, null, null, null, null, m.photo_path
    from messages m
    where m.space_id = p_space and (p_before is null or m.created_at < p_before)
  ),
  page as (
    select * from items order by created_at desc limit least(greatest(p_limit, 1), 100)
  )
  select p.kind, p.id, p.user_id, coalesce(nullif(pr.name, ''), 'Member'), p.created_at, p.body,
         p.type_label, p.type_key, p.derive_kind, p.vals,
         (select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label, 'unit', f.unit, 'kind', f.kind)
                                    order by f.sort), '[]')
            from activity_fields f where f.type_id = p.type_id),
         p.photo_path,
         (select count(*)::int from cheers ch where ch.checkin_id = p.id),
         exists (select 1 from cheers ch where ch.checkin_id = p.id and ch.user_id = auth.uid())
  from page p join profiles pr on pr.id = p.user_id
  where is_member(p_space)
  order by p.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Deleting: the sender (or a space admin) deletes a message; the poster (or an
-- admin) removes the photo from a check-in. Each returns the photo path, if
-- any, so the app can delete the file from Storage.
-- ---------------------------------------------------------------------------

create function public.delete_message(p_message uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_msg messages;
begin
  select * into v_msg from messages where id = p_message;
  if v_msg.id is null then raise exception 'message not found'; end if;
  if v_msg.user_id <> auth.uid() and not is_space_admin(v_msg.space_id) then
    raise exception 'you can only delete your own messages';
  end if;
  delete from messages where id = p_message;
  return v_msg.photo_path;
end $$;

create function public.remove_checkin_photo(p_checkin uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_row checkins;
begin
  select * into v_row from checkins where id = p_checkin;
  if v_row.id is null then raise exception 'check-in not found'; end if;
  if v_row.user_id <> auth.uid() and not is_space_admin(v_row.space_id) then
    raise exception 'you can only remove photos from your own check-ins';
  end if;
  update checkins set photo_path = null where id = p_checkin;
  return v_row.photo_path;
end $$;

-- Every file in a space's folder, for the owner to remove before deleting the space.
create function public.space_photo_paths(p_space uuid)
returns setof text language plpgsql stable security definer set search_path = public, storage as $$
begin
  if not is_space_owner(p_space) then raise exception 'only the owner can delete this space'; end if;
  return query select o.name from storage.objects o
    where o.bucket_id = 'proofs' and o.name like p_space::text || '/%';
end $$;

revoke execute on function public.send_message(uuid, text, text), public.delete_message(uuid),
  public.remove_checkin_photo(uuid), public.space_photo_paths(uuid) from public, anon;
grant execute on function public.send_message(uuid, text, text), public.delete_message(uuid),
  public.remove_checkin_photo(uuid), public.space_photo_paths(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage rules
-- ---------------------------------------------------------------------------

-- Compressed photos are well under 5 MB.
update storage.buckets set file_size_limit = 5242880 where id = 'proofs';

-- Uploading needs active membership (not someone who left) and photos turned on.
drop policy if exists "proofs: upload own" on storage.objects;
create policy "proofs: upload own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_active_member(((storage.foldername(name))[1])::uuid)
    and (select photos_enabled from public.spaces where id = ((storage.foldername(name))[1])::uuid)
  );

-- People delete their own files; space admins and the owner can delete any file in the space.
create policy "proofs: delete own or admin" on storage.objects for delete to authenticated
  using (
    bucket_id = 'proofs'
    and ((storage.foldername(name))[2] = auth.uid()::text
         or public.is_space_admin(((storage.foldername(name))[1])::uuid))
  );

-- Milestone 3: the space feed, check-in photos and live updates.

-- ---------------------------------------------------------------------------
-- Feed: check-ins and messages in one list, newest first
-- ---------------------------------------------------------------------------

create function public.space_feed(p_space uuid, p_before timestamptz default null, p_limit int default 40)
returns table (
  kind text,            -- 'checkin' or 'message'
  id uuid,
  user_id uuid,
  name text,
  created_at timestamptz,
  body text,            -- message text, or check-in caption
  type_label text,
  type_key text,
  derive_kind text,
  vals jsonb,
  fields jsonb,         -- [{key, label, unit, kind}] of the activity type, in order
  photo_path text,
  cheers int,
  cheered boolean
)
language sql stable security definer set search_path = public as $$
  with items as (
    select 'checkin'::text as kind, c.id, c.user_id, c.created_at, c.caption as body,
           t.label as type_label, t.key as type_key, t.derive_kind, c.vals, c.type_id, c.photo_path
    from checkins c join activity_types t on t.id = c.type_id
    where c.space_id = p_space and (p_before is null or c.created_at < p_before)
    union all
    select 'message', m.id, m.user_id, m.created_at, m.body, null, null, null, null, null, null
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

-- Today in numbers: how many members are done today, in the space's time zone.
create function public.space_today(p_space uuid)
returns table (members int, done int, checkins int)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from space_members where space_id = p_space),
         (select count(distinct user_id)::int from checkins c join spaces s on s.id = c.space_id
            where c.space_id = p_space and c.local_date = (now() at time zone s.timezone)::date),
         (select count(*)::int from checkins c join spaces s on s.id = c.space_id
            where c.space_id = p_space and c.local_date = (now() at time zone s.timezone)::date)
  where is_member(p_space);
$$;

-- Cheer or un-cheer a check-in. Returns true when the caller now cheers it.
create function public.toggle_cheer(p_checkin uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select space_id into v_space from checkins where id = p_checkin;
  if v_space is null or not is_member(v_space) then raise exception 'not a member of this space'; end if;
  delete from cheers where checkin_id = p_checkin and user_id = auth.uid();
  if found then return false; end if;
  insert into cheers (checkin_id, user_id) values (p_checkin, auth.uid());
  return true;
end $$;

revoke execute on function public.space_feed(uuid, timestamptz, int), public.space_today(uuid),
  public.toggle_cheer(uuid) from public, anon;
grant execute on function public.space_feed(uuid, timestamptz, int), public.space_today(uuid),
  public.toggle_cheer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof photos: private bucket, files at <space_id>/<user_id>/<name>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "proofs: members read" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and public.is_member(((storage.foldername(name))[1])::uuid));

create policy "proofs: upload own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_member(((storage.foldername(name))[1])::uuid)
    and (select photos_enabled from public.spaces where id = ((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- Live updates: the app listens for new check-ins, messages and cheers
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.checkins, public.messages, public.cheers;

-- A check-in may only point at a photo the poster uploaded to this space's folder.
create function public.guard_checkin_photo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.photo_path is not null and new.photo_path not like new.space_id::text || '/' || new.user_id::text || '/%' then
    raise exception 'photo does not belong to this check-in';
  end if;
  return new;
end $$;

create trigger checkins_guard_photo before insert or update of photo_path on public.checkins
  for each row execute function public.guard_checkin_photo();

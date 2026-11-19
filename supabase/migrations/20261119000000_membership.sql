-- Milestone 8: leaving, deleting and removing members.
-- A member can leave a space but keep seeing its past messages (read-only),
-- then delete it from their list. Owners delete the whole space. Admins can
-- remove a member.

-- A left member keeps their row (so they can still read the history) with
-- left_at set. null = active.
alter table public.space_members add column left_at timestamptz;

-- member_role / is_space_admin / is_space_owner now count only ACTIVE
-- membership, so a member who left has no role and cannot act as one.
create or replace function public.member_role(p_space uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from space_members where space_id = p_space and user_id = auth.uid() and left_at is null
$$;

-- is_member stays "has a row here" (active or left), so reads — the feed,
-- the board, member lists — keep working for someone who has left.
-- is_active_member is the stricter check used for posting and acting.
create or replace function public.is_active_member(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from space_members where space_id = p_space and user_id = auth.uid() and left_at is null)
$$;

-- Posting a check-in requires active membership.
create or replace function public.create_checkin(p_space uuid, p_type uuid, p_vals jsonb,
  p_caption text default null, p_photo_path text default null)
returns public.checkins language plpgsql security definer set search_path = public as $$
declare
  v_space spaces;
  v_type activity_types;
  f activity_fields;
  v_clean jsonb := '{}';
  v_missing text[] := '{}';
  v_raw jsonb;
  v_row checkins;
  v_candidate numeric;
  v_lower_is_better boolean;
  v_primary text;
begin
  if not is_active_member(p_space) then raise exception 'not a member of this space'; end if;
  select * into v_space from spaces where id = p_space;
  select * into v_type from activity_types where id = p_type and space_id = p_space;
  if v_type.id is null or not v_type.enabled then raise exception 'activity type not allowed in this space'; end if;
  if p_photo_path is not null and not v_space.photos_enabled then raise exception 'photos are turned off in this space'; end if;

  for f in select * from activity_fields where type_id = p_type order by sort loop
    if f.state = 'hidden' then continue; end if;
    v_raw := p_vals -> f.key;
    if f.kind = 'number' then
      if jsonb_typeof(v_raw) = 'number' and (v_raw #>> '{}')::numeric > 0 then
        v_clean := v_clean || jsonb_build_object(f.key, v_raw);
      elsif f.state = 'required' then
        v_missing := v_missing || f.label;
      end if;
    else
      if jsonb_typeof(v_raw) = 'string' and char_length(trim(v_raw #>> '{}')) > 0 then
        v_clean := v_clean || jsonb_build_object(f.key, left(trim(v_raw #>> '{}'), 200));
      elsif f.state = 'required' then
        v_missing := v_missing || f.label;
      end if;
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'missing_fields' using
      detail = array_to_string(v_missing, ', '),
      hint = format('%s required for %s in this space.', array_to_string(v_missing, ' and '), v_type.label);
  end if;

  perform assert_under_hourly_limit(p_space, auth.uid());

  insert into checkins (space_id, user_id, type_id, vals, caption, photo_path, local_date)
  values (p_space, auth.uid(), p_type, v_clean, nullif(trim(p_caption), ''), p_photo_path,
          (now() at time zone v_space.timezone)::date)
  returning * into v_row;

  insert into day_status (space_id, user_id, local_date, status)
  values (p_space, auth.uid(), v_row.local_date, 'done')
  on conflict (space_id, user_id, local_date) do update set status = 'done';

  v_candidate := null;
  if v_type.record_kind = 'fastest_5k' and num(v_clean, 'dist') >= 5 and num(v_clean, 'time') > 0 then
    v_candidate := round(num(v_clean, 'time') * 60 / num(v_clean, 'dist') * 5);
    v_lower_is_better := true;
  elsif v_type.record_kind = 'top_score' then
    v_candidate := num(v_clean, 'score'); v_lower_is_better := false;
  elsif v_type.record_kind = 'biggest_deal' then
    v_candidate := num(v_clean, 'amt'); v_lower_is_better := false;
  end if;
  if v_candidate is not null then
    insert into records as r (space_id, kind, user_id, value, checkin_id)
    values (p_space, v_type.record_kind, auth.uid(), v_candidate, v_row.id)
    on conflict (space_id, kind) do update
      set user_id = excluded.user_id, value = excluded.value, checkin_id = excluded.checkin_id, set_at = now()
      where (v_lower_is_better and excluded.value < r.value) or (not v_lower_is_better and excluded.value > r.value);
  end if;

  select key into v_primary from activity_fields where type_id = p_type and is_primary;
  v_candidate := num(v_clean, v_primary);
  if v_candidate is not null then
    insert into records as r (space_id, kind, user_id, value, checkin_id)
    values (p_space, 'best:' || v_type.key, auth.uid(), v_candidate, v_row.id)
    on conflict (space_id, kind) do update
      set user_id = excluded.user_id, value = excluded.value, checkin_id = excluded.checkin_id, set_at = now()
      where excluded.value > r.value;
  end if;

  return v_row;
end $$;

-- Sending a group message requires active membership (and is never rate-limited).
create or replace function public.send_message(p_space uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = public as $$
declare v_row messages;
begin
  if not is_active_member(p_space) then raise exception 'not a member of this space'; end if;
  if not (select chat_enabled from spaces where id = p_space) then
    raise exception 'chat_off' using hint = 'Only check-ins can be posted in this space.';
  end if;
  insert into messages (space_id, user_id, body) values (p_space, auth.uid(), trim(p_body)) returning * into v_row;
  return v_row;
end $$;

-- Cheering requires active membership.
create or replace function public.toggle_cheer(p_checkin uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select space_id into v_space from checkins where id = p_checkin;
  if v_space is null or not is_active_member(v_space) then raise exception 'not a member of this space'; end if;
  delete from cheers where checkin_id = p_checkin and user_id = auth.uid();
  if found then return false; end if;
  insert into cheers (checkin_id, user_id) values (p_checkin, auth.uid());
  return true;
end $$;

-- Rejoining with the invite code clears a previous leave.
create or replace function public.join_space(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into v_space from spaces where invite_code = lower(trim(p_code));
  if v_space is null then raise exception 'invite_not_found' using hint = 'Check the invite link and try again.'; end if;
  insert into space_members (space_id, user_id) values (v_space, auth.uid())
  on conflict (space_id, user_id) do update set left_at = null, last_read_at = now();
  return v_space;
end $$;

-- ---------------------------------------------------------------------------
-- Leave / forget / delete / remove
-- ---------------------------------------------------------------------------

-- Leave a space but keep the row, so the history stays readable. Owners can't
-- leave (they delete the space instead).
create function public.leave_space(p_space uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if is_space_owner(p_space) then
    raise exception 'owner_cannot_leave' using hint = 'As the owner, delete the space instead of leaving.';
  end if;
  if not is_active_member(p_space) then raise exception 'not a member of this space'; end if;
  update space_members set left_at = now() where space_id = p_space and user_id = auth.uid();
end $$;

-- Remove a space from your own list entirely (drops your membership row).
-- Owners can't forget their own space; they delete it.
create function public.forget_space(p_space uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if is_space_owner(p_space) then
    raise exception 'owner_cannot_forget' using hint = 'As the owner, delete the space instead.';
  end if;
  delete from space_members where space_id = p_space and user_id = auth.uid();
end $$;

-- The owner deletes the whole space for everyone.
create function public.delete_space(p_space uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_space_owner(p_space) then raise exception 'only the owner can delete this space'; end if;
  delete from spaces where id = p_space;
end $$;

-- An admin removes another member from the space.
create function public.remove_member(p_space uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_space_admin(p_space) then raise exception 'only an admin can remove members'; end if;
  if p_user = auth.uid() then raise exception 'use leave to remove yourself'; end if;
  if (select role from space_members where space_id = p_space and user_id = p_user) = 'owner' then
    raise exception 'the owner cannot be removed';
  end if;
  delete from space_members where space_id = p_space and user_id = p_user;
end $$;

-- Unread counts skip spaces you have left.
create or replace function public.space_unreads()
returns table (space_id uuid, unread int)
language sql stable security definer set search_path = public as $$
  select sm.space_id,
         (
           (select count(*) from messages m
              where m.space_id = sm.space_id and m.user_id <> sm.user_id and m.created_at > sm.last_read_at)
           +
           (select count(*) from checkins c
              where c.space_id = sm.space_id and c.user_id <> sm.user_id and c.created_at > sm.last_read_at)
         )::int
  from space_members sm
  where sm.user_id = auth.uid() and sm.left_at is null;
$$;

-- The caller's spaces for the list: newest activity first, with unread count
-- and whether they have left. "Last activity" is the most recent message or
-- check-in, falling back to when they joined.
create function public.my_spaces()
returns table (
  id uuid,
  name text,
  template text,
  role text,
  left_at timestamptz,
  last_at timestamptz,
  unread int
)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.template, sm.role, sm.left_at,
         greatest(
           sm.joined_at,
           coalesce((select max(m.created_at) from messages m where m.space_id = s.id), sm.joined_at),
           coalesce((select max(c.created_at) from checkins c where c.space_id = s.id), sm.joined_at)
         ) as last_at,
         case when sm.left_at is not null then 0 else (
           (select count(*) from messages m
              where m.space_id = s.id and m.user_id <> sm.user_id and m.created_at > sm.last_read_at)
           + (select count(*) from checkins c
              where c.space_id = s.id and c.user_id <> sm.user_id and c.created_at > sm.last_read_at)
         ) end::int as unread
  from space_members sm
  join spaces s on s.id = sm.space_id
  where sm.user_id = auth.uid()
  order by last_at desc;
$$;

revoke execute on function public.is_active_member(uuid), public.leave_space(uuid), public.forget_space(uuid),
  public.delete_space(uuid), public.remove_member(uuid, uuid), public.my_spaces() from public, anon;
grant execute on function public.is_active_member(uuid), public.leave_space(uuid), public.forget_space(uuid),
  public.delete_space(uuid), public.remove_member(uuid, uuid), public.my_spaces() to authenticated;

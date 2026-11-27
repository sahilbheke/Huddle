-- Photos are a standard feature: every active member can share photos in any space.
-- The per-space photos_enabled setting no longer gates anything (the column stays,
-- unused, so older app builds keep working). Safe to run more than once.

update public.spaces set photos_enabled = true where not photos_enabled;

-- Upload rule: your own folder, in a space you're an active member of.
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
    select 1 from space_members m
    where m.space_id = v_space and m.user_id = auth.uid() and m.left_at is null
  );
end $$;

create or replace function public.send_message(p_space uuid, p_body text default null, p_photo_path text default null)
returns public.messages language plpgsql security definer set search_path = public as $$
declare v_row messages; v_body text := nullif(trim(coalesce(p_body, '')), '');
begin
  if not is_active_member(p_space) then raise exception 'not a member of this space'; end if;
  if not (select chat_enabled from spaces where id = p_space) then
    raise exception 'chat_off' using hint = 'Only check-ins can be posted in this space.';
  end if;
  if v_body is null and p_photo_path is null then raise exception 'empty message'; end if;
  insert into messages (space_id, user_id, body, photo_path)
  values (p_space, auth.uid(), v_body, p_photo_path) returning * into v_row;
  return v_row;
end $$;

-- Check-ins: same as before, without the photos-off check.
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

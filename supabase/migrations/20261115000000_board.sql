-- Milestone 4+5: the board (last 21 days, records) and admin settings.

-- ---------------------------------------------------------------------------
-- The last-21-days grid: one row per member, a status per day, newest day last.
-- ---------------------------------------------------------------------------

create function public.space_grid(p_space uuid, p_days int default 21)
returns table (user_id uuid, name text, day date, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_space) then raise exception 'not a member of this space'; end if;
  return query
  with bounds as (
    select (now() at time zone s.timezone)::date as today from spaces s where s.id = p_space
  ),
  span as (
    select generate_series(b.today - (least(greatest(p_days, 1), 60) - 1), b.today, interval '1 day')::date as day
    from bounds b
  )
  select sm.user_id, p.name, sp.day,
         coalesce(d.status, case when sp.day = (select today from bounds) then 'today' else 'none' end)
  from space_members sm
  join profiles p on p.id = sm.user_id
  cross join span sp
  left join day_status d on d.space_id = p_space and d.user_id = sm.user_id and d.local_date = sp.day
  order by sm.user_id, sp.day;
end $$;


-- Records (personal bests) with the holder's name and a readable label.
create function public.space_records(p_space uuid)
returns table (kind text, type_label text, record_kind text, value numeric, user_id uuid, name text, set_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.kind, t.label, t.record_kind, r.value, r.user_id, p.name, r.set_at
  from records r
  join profiles p on p.id = r.user_id
  left join activity_types t on t.space_id = r.space_id
    and t.key = case when r.kind like 'best:%' then substring(r.kind from 5) else null end
  where r.space_id = p_space and is_member(p_space)
  order by r.set_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Admin settings: owner or admin may change rules, activity types and fields.
-- (Granting admin access stays owner-only, via set_member_role.)
-- ---------------------------------------------------------------------------

create function public.update_space_rules(
  p_space uuid, p_rest int, p_per_hour int, p_chat boolean, p_photos boolean,
  p_show_board boolean, p_show_heatmap boolean, p_show_records boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_space_admin(p_space) then raise exception 'only an admin can change settings'; end if;
  if p_rest < 0 or p_rest > 6 then raise exception 'rest days must be between 0 and 6'; end if;
  if p_per_hour < 0 or p_per_hour > 20 then raise exception 'posts per hour must be between 0 and 20'; end if;
  update spaces set
    rest_days_per_week = p_rest, posts_per_hour = p_per_hour, chat_enabled = p_chat,
    photos_enabled = p_photos, show_board = p_show_board, show_heatmap = p_show_heatmap,
    show_records = p_show_records
  where id = p_space;
end $$;

create function public.set_type_enabled(p_type uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select space_id into v_space from activity_types where id = p_type;
  if v_space is null or not is_space_admin(v_space) then raise exception 'only an admin can change activities'; end if;
  update activity_types set enabled = p_enabled where id = p_type;
end $$;

-- Set a field required / optional / hidden. The primary field can't be hidden.
create function public.set_field_state(p_field uuid, p_state text)
returns void language plpgsql security definer set search_path = public as $$
declare v_space uuid; v_primary boolean;
begin
  if p_state not in ('required', 'optional', 'hidden') then raise exception 'bad state'; end if;
  select t.space_id, f.is_primary into v_space, v_primary
  from activity_fields f join activity_types t on t.id = f.type_id where f.id = p_field;
  if v_space is null or not is_space_admin(v_space) then raise exception 'only an admin can change fields'; end if;
  if v_primary and p_state = 'hidden' then raise exception 'the main field cannot be hidden'; end if;
  update activity_fields set state = p_state where id = p_field;
end $$;

revoke execute on function public.space_grid(uuid, int), public.space_records(uuid),
  public.update_space_rules(uuid, int, int, boolean, boolean, boolean, boolean, boolean),
  public.set_type_enabled(uuid, boolean), public.set_field_state(uuid, text) from public, anon;
grant execute on function public.space_grid(uuid, int), public.space_records(uuid),
  public.update_space_rules(uuid, int, int, boolean, boolean, boolean, boolean, boolean),
  public.set_type_enabled(uuid, boolean), public.set_field_state(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Close each finished day automatically (rest/missed), so streaks stay honest.
-- Runs hourly via pg_cron when it is available; a no-op where it is not
-- (such as the local test database), so this migration is safe everywhere.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Remove an earlier copy so re-running this migration stays idempotent.
    perform cron.unschedule('huddle_close_days') where exists (select 1 from cron.job where jobname = 'huddle_close_days');
    perform cron.schedule('huddle_close_days', '7 * * * *', 'select public.close_due_days()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end $$;

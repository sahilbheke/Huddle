-- Huddle: core schema, row-level security and the rules engine.
-- Every rule (required fields, hourly limit, rest days, records) is enforced here,
-- so the app cannot bypass it. Writes go through the security-definer functions at the bottom.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 60),
  avatar_url text,
  phone_hash text unique,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  template text not null check (template in ('fitness', 'study', 'work', 'custom')),
  owner_id uuid not null references public.profiles (id),
  timezone text not null default 'Asia/Kolkata',
  rest_days_per_week int not null default 2 check (rest_days_per_week between 0 and 6),
  posts_per_hour int not null default 2 check (posts_per_hour between 0 and 20), -- 0 = no limit
  chat_enabled boolean not null default true,
  photos_enabled boolean not null default true,
  show_board boolean not null default true,
  show_heatmap boolean not null default true,
  show_records boolean not null default true,
  invite_code text not null unique default substr(md5(gen_random_uuid()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table public.space_members (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index on public.space_members (user_id);

create table public.activity_types (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  key text not null,
  label text not null,
  enabled boolean not null default true,
  derive_kind text not null default 'none'
    check (derive_kind in ('none', 'run', 'speed', 'swim', 'per_set', 'accuracy', 'connect_rate')),
  record_kind text check (record_kind in ('fastest_5k', 'top_score', 'biggest_deal')),
  sort int not null default 0,
  unique (space_id, key)
);

create table public.activity_fields (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null references public.activity_types (id) on delete cascade,
  key text not null,
  label text not null,
  unit text not null default '',
  kind text not null default 'number' check (kind in ('number', 'text')),
  state text not null default 'optional' check (state in ('required', 'optional', 'hidden')),
  is_primary boolean not null default false,
  sort int not null default 0,
  unique (type_id, key),
  -- the primary field drives totals and records, so it can never be hidden
  check (not (is_primary and state = 'hidden'))
);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type_id uuid not null references public.activity_types (id),
  vals jsonb not null default '{}',
  caption text check (char_length(caption) <= 500),
  photo_path text,
  local_date date not null,
  created_at timestamptz not null default now()
);
create index on public.checkins (space_id, created_at desc);
create index on public.checkins (space_id, user_id, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.messages (space_id, created_at desc);
create index on public.messages (space_id, user_id, created_at desc);

create table public.day_status (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  status text not null check (status in ('done', 'rest', 'missed')),
  primary key (space_id, user_id, local_date)
);

create table public.records (
  space_id uuid not null references public.spaces (id) on delete cascade,
  kind text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value numeric not null,
  checkin_id uuid references public.checkins (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (space_id, kind)
);

create table public.cheers (
  checkin_id uuid not null references public.checkins (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (checkin_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer so policies can call them without recursion)
-- ---------------------------------------------------------------------------

create function public.member_role(p_space uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from space_members where space_id = p_space and user_id = auth.uid()
$$;

create function public.is_member(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from space_members where space_id = p_space and user_id = auth.uid())
$$;

create function public.is_space_admin(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(p_space) in ('owner', 'admin'), false)
$$;

create function public.is_space_owner(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(p_space) = 'owner', false)
$$;

-- New auth user -> profile row. The phone is kept only as a hash for contact matching.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, phone_hash)
  values (new.id, case when new.phone is null then null
                       else encode(sha256(convert_to(regexp_replace(new.phone, '\D', '', 'g'), 'UTF8')), 'hex') end);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.activity_types enable row level security;
alter table public.activity_fields enable row level security;
alter table public.checkins enable row level security;
alter table public.messages enable row level security;
alter table public.day_status enable row level security;
alter table public.records enable row level security;
alter table public.cheers enable row level security;

-- Profiles: yourself, and anyone you share a space with.
create policy "profiles: read self and space mates" on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from space_members a join space_members b on a.space_id = b.space_id
    where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy "profiles: update self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Spaces: members read; only the owner changes rules. Creation goes through create_space().
create policy "spaces: members read" on public.spaces for select to authenticated
  using (public.is_member(id));
create policy "spaces: owner updates" on public.spaces for update to authenticated
  using (public.is_space_owner(id)) with check (owner_id = auth.uid());

create policy "members: members read" on public.space_members for select to authenticated
  using (public.is_member(space_id));

create policy "types: members read" on public.activity_types for select to authenticated
  using (public.is_member(space_id));
create policy "types: owner updates" on public.activity_types for update to authenticated
  using (public.is_space_owner(space_id)) with check (public.is_space_owner(space_id));

create policy "fields: members read" on public.activity_fields for select to authenticated
  using (exists (select 1 from activity_types t where t.id = type_id and public.is_member(t.space_id)));
create policy "fields: owner updates" on public.activity_fields for update to authenticated
  using (exists (select 1 from activity_types t where t.id = type_id and public.is_space_owner(t.space_id)))
  with check (exists (select 1 from activity_types t where t.id = type_id and public.is_space_owner(t.space_id)));

create policy "checkins: members read" on public.checkins for select to authenticated
  using (public.is_member(space_id));
create policy "messages: members read" on public.messages for select to authenticated
  using (public.is_member(space_id));
create policy "day status: members read" on public.day_status for select to authenticated
  using (public.is_member(space_id));
create policy "records: members read" on public.records for select to authenticated
  using (public.is_member(space_id));

create policy "cheers: members read" on public.cheers for select to authenticated
  using (exists (select 1 from checkins c where c.id = checkin_id and public.is_member(c.space_id)));
create policy "cheers: members add own" on public.cheers for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from checkins c where c.id = checkin_id and public.is_member(c.space_id)));
create policy "cheers: remove own" on public.cheers for delete to authenticated
  using (user_id = auth.uid());

-- Only the owner may change who owns a space or which columns identify it.
create function public.guard_space_update() returns trigger
language plpgsql as $$
begin
  if new.owner_id <> old.owner_id or new.invite_code <> old.invite_code or new.template <> old.template then
    raise exception 'owner, invite code and template cannot be changed here';
  end if;
  return new;
end $$;
create trigger guard_space_update before update on public.spaces
  for each row execute function public.guard_space_update();

-- ---------------------------------------------------------------------------
-- Templates: activity types and their fields
-- ---------------------------------------------------------------------------

create function public.add_type(p_space uuid, p_key text, p_label text, p_derive text, p_record text, p_sort int, p_fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_type uuid;
  f jsonb;
  i int := 0;
begin
  insert into activity_types (space_id, key, label, derive_kind, record_kind, sort)
  values (p_space, p_key, p_label, p_derive, p_record, p_sort)
  returning id into v_type;
  for f in select * from jsonb_array_elements(p_fields) loop
    insert into activity_fields (type_id, key, label, unit, kind, state, is_primary, sort)
    values (v_type, f->>'key', f->>'label', coalesce(f->>'unit', ''), coalesce(f->>'kind', 'number'),
            f->>'state', i = 0, i);
    i := i + 1;
  end loop;
end $$;

create function public.seed_template(p_space uuid, p_template text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_template = 'fitness' then
    perform add_type(p_space, 'run', 'Running', 'run', 'fastest_5k', 0,
      '[{"key":"dist","label":"Distance","unit":"km","state":"required"},{"key":"time","label":"Time","unit":"min","state":"optional"}]');
    perform add_type(p_space, 'cycle', 'Cycling', 'speed', null, 1,
      '[{"key":"dist","label":"Distance","unit":"km","state":"required"},{"key":"time","label":"Time","unit":"min","state":"optional"}]');
    perform add_type(p_space, 'swim', 'Swimming', 'swim', null, 2,
      '[{"key":"dist","label":"Distance","unit":"m","state":"required"},{"key":"time","label":"Time","unit":"min","state":"optional"},{"key":"laps","label":"Laps","unit":"laps","state":"hidden"}]');
    perform add_type(p_space, 'pushup', 'Push-ups', 'per_set', null, 3,
      '[{"key":"reps","label":"Count","unit":"reps","state":"required"},{"key":"sets","label":"Sets","unit":"sets","state":"optional"}]');
    perform add_type(p_space, 'pullup', 'Pull-ups', 'per_set', null, 4,
      '[{"key":"reps","label":"Count","unit":"reps","state":"required"},{"key":"sets","label":"Sets","unit":"sets","state":"optional"}]');
    perform add_type(p_space, 'workout', 'Workout', 'none', null, 5,
      '[{"key":"time","label":"Time","unit":"min","state":"required"},{"key":"what","label":"What you did","kind":"text","state":"optional"}]');
  elsif p_template = 'study' then
    perform add_type(p_space, 'chapters', 'Chapters', 'none', null, 0,
      '[{"key":"ch","label":"Chapters done","unit":"chapters","state":"required"},{"key":"subject","label":"Subject","kind":"text","state":"optional"}]');
    perform add_type(p_space, 'questions', 'Questions', 'accuracy', null, 1,
      '[{"key":"q","label":"Questions solved","unit":"questions","state":"required"},{"key":"correct","label":"Correct","state":"optional"},{"key":"subject","label":"Subject","kind":"text","state":"hidden"}]');
    perform add_type(p_space, 'mock', 'Mock test', 'none', 'top_score', 2,
      '[{"key":"score","label":"Score","unit":"/100","state":"required"},{"key":"subject","label":"Subject","kind":"text","state":"optional"}]');
    perform add_type(p_space, 'time', 'Study time', 'none', null, 3,
      '[{"key":"min","label":"Time","unit":"min","state":"required"},{"key":"subject","label":"Subject","kind":"text","state":"optional"}]');
  elsif p_template = 'work' then
    perform add_type(p_space, 'deal', 'Deal closed', 'none', 'biggest_deal', 0,
      '[{"key":"amt","label":"Amount","unit":"₹ lakh","state":"required"},{"key":"client","label":"Client","kind":"text","state":"required"}]');
    perform add_type(p_space, 'meeting', 'Client meeting', 'none', null, 1,
      '[{"key":"met","label":"Clients met","unit":"clients","state":"required"},{"key":"target","label":"Target client","kind":"text","state":"optional"}]');
    perform add_type(p_space, 'calls', 'Calls', 'connect_rate', null, 2,
      '[{"key":"calls","label":"Calls made","unit":"calls","state":"required"},{"key":"conn","label":"Connected","state":"optional"}]');
  else
    perform add_type(p_space, 'checkin', 'Check-in', 'none', null, 0,
      '[{"key":"note","label":"What you did","kind":"text","state":"required"}]');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Space lifecycle
-- ---------------------------------------------------------------------------

create function public.create_space(p_name text, p_template text, p_rest int default 2,
  p_per_hour int default 2, p_chat boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_space uuid;
  v_tz text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select timezone into v_tz from profiles where id = auth.uid();
  insert into spaces (name, template, owner_id, timezone, rest_days_per_week, posts_per_hour, chat_enabled)
  values (trim(p_name), p_template, auth.uid(), coalesce(v_tz, 'Asia/Kolkata'), p_rest, p_per_hour, p_chat)
  returning id into v_space;
  insert into space_members (space_id, user_id, role) values (v_space, auth.uid(), 'owner');
  perform seed_template(v_space, p_template);
  return v_space;
end $$;

create function public.join_space(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into v_space from spaces where invite_code = lower(trim(p_code));
  if v_space is null then raise exception 'invite_not_found' using hint = 'Check the invite link and try again.'; end if;
  insert into space_members (space_id, user_id) values (v_space, auth.uid()) on conflict do nothing;
  return v_space;
end $$;

create function public.set_member_role(p_space uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_space_owner(p_space) then raise exception 'only the owner can change admin access'; end if;
  if p_role not in ('admin', 'member') then raise exception 'role must be admin or member'; end if;
  update space_members set role = p_role
  where space_id = p_space and user_id = p_user and role <> 'owner';
end $$;

-- ---------------------------------------------------------------------------
-- Rules engine
-- ---------------------------------------------------------------------------

-- Posts (check-ins and messages together) by this user in this space in the last hour.
create function public.assert_under_hourly_limit(p_space uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_limit int;
  v_count int;
  v_oldest timestamptz;
begin
  select posts_per_hour into v_limit from spaces where id = p_space;
  if v_limit = 0 then return; end if;
  select count(*), min(created_at) into v_count, v_oldest from (
    select created_at from checkins where space_id = p_space and user_id = p_user and created_at > now() - interval '1 hour'
    union all
    select created_at from messages where space_id = p_space and user_id = p_user and created_at > now() - interval '1 hour'
  ) recent;
  if v_count >= v_limit then
    raise exception 'hourly_limit' using
      detail = to_char(v_oldest + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      hint = format('This space allows %s posts per hour per person.', v_limit);
  end if;
end $$;

create function public.num(p_vals jsonb, p_key text) returns numeric
language sql immutable as $$
  select case when jsonb_typeof(p_vals -> p_key) = 'number' then (p_vals ->> p_key)::numeric end
$$;

-- Validate fields against the admin's settings, keep only shown fields, insert, then update day status and records.
create function public.create_checkin(p_space uuid, p_type uuid, p_vals jsonb,
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
  if not is_member(p_space) then raise exception 'not a member of this space'; end if;
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

  -- Space records
  v_candidate := null;
  if v_type.record_kind = 'fastest_5k' and num(v_clean, 'dist') >= 5 and num(v_clean, 'time') > 0 then
    v_candidate := round(num(v_clean, 'time') * 60 / num(v_clean, 'dist') * 5); -- seconds
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

  -- Best single check-in per type, by its primary field
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

create function public.send_message(p_space uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = public as $$
declare v_row messages;
begin
  if not is_member(p_space) then raise exception 'not a member of this space'; end if;
  if not (select chat_enabled from spaces where id = p_space) then
    raise exception 'chat_off' using hint = 'Only check-ins can be posted in this space.';
  end if;
  perform assert_under_hourly_limit(p_space, auth.uid());
  insert into messages (space_id, user_id, body) values (p_space, auth.uid(), trim(p_body)) returning * into v_row;
  return v_row;
end $$;

-- Close one local day: members with no check-in get a rest day if they have one left this week, else missed.
-- Weeks start on Monday; rest days used anywhere in that week count. Safe to run more than once.
create function public.close_day(p_space uuid, p_date date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_rest int;
  m record;
  v_used int;
  v_closed int := 0;
begin
  select rest_days_per_week into v_rest from spaces where id = p_space;
  for m in
    select sm.user_id from space_members sm
    where sm.space_id = p_space
      and (sm.joined_at at time zone (select timezone from spaces where id = p_space))::date <= p_date
      and not exists (select 1 from day_status d
                      where d.space_id = p_space and d.user_id = sm.user_id and d.local_date = p_date)
  loop
    select count(*) into v_used from day_status
    where space_id = p_space and user_id = m.user_id and status = 'rest'
      and local_date >= date_trunc('week', p_date)::date
      and local_date < date_trunc('week', p_date)::date + 7 and local_date <> p_date;
    insert into day_status (space_id, user_id, local_date, status)
    values (p_space, m.user_id, p_date, case when v_used < v_rest then 'rest' else 'missed' end);
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end $$;

-- Run hourly (pg_cron): closes yesterday for every space, in each space's own time zone.
create function public.close_due_days()
returns int language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_total int := 0;
begin
  for s in select id, timezone from spaces loop
    v_total := v_total + close_day(s.id, ((now() at time zone s.timezone)::date - 1));
  end loop;
  return v_total;
end $$;

-- Board numbers for every member: streak, consistency, rest days used this week.
create function public.space_board(p_space uuid)
returns table (user_id uuid, name text, role text, streak int, best_streak int,
               kept_pct int, rest_used_week int, done_today boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date;
begin
  if not is_member(p_space) then raise exception 'not a member of this space'; end if;
  select (now() at time zone timezone)::date into v_today from spaces where id = p_space;
  return query
  with days as (
    select d.user_id, d.local_date, d.status from day_status d where d.space_id = p_space
  ),
  kept as (
    select d.user_id, d.local_date,
           d.local_date - (row_number() over (partition by d.user_id order by d.local_date))::int as grp
    from days d where d.status in ('done', 'rest')
  ),
  runs as (
    select k.user_id, count(*)::int as len, max(k.local_date) as last_day from kept k group by k.user_id, k.grp
  )
  select sm.user_id, p.name, sm.role,
    coalesce((select r.len from runs r where r.user_id = sm.user_id and r.last_day >= v_today - 1
              order by r.last_day desc limit 1), 0),
    coalesce((select max(r.len) from runs r where r.user_id = sm.user_id), 0),
    coalesce((select round(100.0 * count(*) filter (where d.status in ('done', 'rest')) / nullif(count(*), 0))::int
              from days d where d.user_id = sm.user_id), 0),
    (select count(*)::int from days d where d.user_id = sm.user_id and d.status = 'rest'
       and d.local_date >= date_trunc('week', v_today)::date),
    exists (select 1 from days d where d.user_id = sm.user_id and d.local_date = v_today and d.status = 'done')
  from space_members sm join profiles p on p.id = sm.user_id
  where sm.space_id = p_space;
end $$;

-- Functions are callable by signed-in users only.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.create_space, public.join_space, public.set_member_role,
  public.create_checkin, public.send_message, public.space_board,
  public.is_member, public.member_role, public.is_space_admin, public.is_space_owner
  to authenticated;

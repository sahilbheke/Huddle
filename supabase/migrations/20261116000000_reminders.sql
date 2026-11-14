-- Milestone 6a: daily reminders (push notifications).

-- Each space has a daily reminder hour in its own time zone (null = reminders off).
alter table public.spaces add column reminder_hour int check (reminder_hour between 0 and 23) default 20;

-- One or more device push tokens per person (a person may sign in on several devices).
create table public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text primary key,
  platform text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;
create policy "push: manage own" on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A record that a reminder was sent, so nobody is nudged twice for the same day.
create table public.reminder_log (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  sent_at timestamptz not null default now(),
  primary key (space_id, user_id, local_date)
);
alter table public.reminder_log enable row level security;  -- no policies: only security-definer functions touch it

-- Save (or refresh) this device's push token.
create function public.register_push_token(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into push_tokens (user_id, token, platform) values (auth.uid(), p_token, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create function public.forget_push_token(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from push_tokens where token = p_token and user_id = auth.uid();
end $$;

-- Admins set the daily reminder time (or turn it off with p_hour = null).
create function public.set_space_reminder(p_space uuid, p_hour int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_space_admin(p_space) then raise exception 'only an admin can change reminders'; end if;
  if p_hour is not null and (p_hour < 0 or p_hour > 23) then raise exception 'hour must be 0 to 23'; end if;
  update spaces set reminder_hour = p_hour where id = p_space;
end $$;

-- Claim the reminders due right now and return who to notify. Called by the backend each hour.
-- "Due" = the space's reminder hour matches the current local hour, the member has not checked in
-- today, and they have not already been reminded today. Inserting into reminder_log here makes it
-- exactly-once even if the sender runs twice. Returns one row per device token.
create function public.claim_due_reminders()
returns table (token text, platform text, user_id uuid, space_id uuid, space_name text, streak int)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select sm.user_id, s.id as space_id, s.name,
           (now() at time zone s.timezone)::date as local_date
    from spaces s
    join space_members sm on sm.space_id = s.id
    where s.reminder_hour is not null
      and extract(hour from now() at time zone s.timezone)::int = s.reminder_hour
      -- not checked in today
      and not exists (
        select 1 from checkins c
        where c.space_id = s.id and c.user_id = sm.user_id
          and c.local_date = (now() at time zone s.timezone)::date)
  ),
  claimed as (
    insert into reminder_log (space_id, user_id, local_date)
    select d.space_id, d.user_id, d.local_date from due d
    on conflict (space_id, user_id, local_date) do nothing
    returning space_id, user_id
  )
  select pt.token, pt.platform, c.user_id, c.space_id, d.name,
         coalesce((select b.streak from space_board(c.space_id) b where b.user_id = c.user_id), 0)
  from claimed c
  join due d on d.space_id = c.space_id and d.user_id = c.user_id
  join push_tokens pt on pt.user_id = c.user_id;
end $$;

-- Let a member send themselves a test reminder now, to confirm notifications work. Returns their tokens.
create function public.my_push_tokens()
returns table (token text, platform text)
language sql stable security definer set search_path = public as $$
  select token, platform from push_tokens where user_id = auth.uid();
$$;

revoke execute on function public.register_push_token(text, text), public.forget_push_token(text),
  public.set_space_reminder(uuid, int), public.claim_due_reminders(), public.my_push_tokens() from public, anon;
grant execute on function public.register_push_token(text, text), public.forget_push_token(text),
  public.set_space_reminder(uuid, int), public.my_push_tokens() to authenticated;
-- claim_due_reminders is called by the backend with the service role, never by a signed-in user.
grant execute on function public.claim_due_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- Live notifications: when someone posts, the other members get a push.
-- The sender's app calls the "notify" edge function, which uses this to find
-- the other members' device tokens (only if the caller is a member).
-- ---------------------------------------------------------------------------
create function public.tokens_to_notify(p_space uuid)
returns table (token text, platform text, user_id uuid)
language sql stable security definer set search_path = public as $$
  select pt.token, pt.platform, pt.user_id
  from push_tokens pt
  join space_members sm on sm.user_id = pt.user_id and sm.space_id = p_space
  where is_member(p_space) and pt.user_id <> auth.uid();
$$;

revoke execute on function public.tokens_to_notify(uuid) from public, anon;
grant execute on function public.tokens_to_notify(uuid) to authenticated;

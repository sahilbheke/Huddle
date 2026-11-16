-- Milestone 7: direct (one-to-one) messages between people who share a space.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One thread per pair of people. The pair is stored ordered (user_lo < user_hi)
-- so a thread is unique regardless of who opened it. Each side keeps its own
-- "last read" time, which is how unread counts are worked out.
create table public.dm_threads (
  id uuid primary key default gen_random_uuid(),
  user_lo uuid not null references public.profiles (id) on delete cascade,
  user_hi uuid not null references public.profiles (id) on delete cascade,
  lo_last_read_at timestamptz not null default 'epoch',
  hi_last_read_at timestamptz not null default 'epoch',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (user_lo < user_hi),
  unique (user_lo, user_hi)
);
create index on public.dm_threads (user_lo, last_message_at desc);
create index on public.dm_threads (user_hi, last_message_at desc);

create table public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.dm_threads (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.dm_messages (thread_id, created_at desc);

alter table public.dm_threads enable row level security;
alter table public.dm_messages enable row level security;

-- A participant may read their own threads and the messages in them. All writes
-- go through the security-definer functions below, so there are no write policies.
create policy "dm threads: read own" on public.dm_threads for select to authenticated
  using (user_lo = auth.uid() or user_hi = auth.uid());
create policy "dm messages: read own" on public.dm_messages for select to authenticated
  using (exists (
    select 1 from dm_threads t
    where t.id = thread_id and (t.user_lo = auth.uid() or t.user_hi = auth.uid())));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True when the caller shares at least one space with the other person.
create function public.shares_space_with(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from space_members a join space_members b on a.space_id = b.space_id
    where a.user_id = auth.uid() and b.user_id = p_other);
$$;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Find or create the thread between the caller and another person, and return its id.
-- Only people who share a space can start a chat.
create function public.dm_open(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_lo uuid; v_hi uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_other = auth.uid() then raise exception 'cannot message yourself'; end if;
  if not shares_space_with(p_other) then raise exception 'you can only message people from your spaces'; end if;
  if auth.uid() < p_other then v_lo := auth.uid(); v_hi := p_other;
  else v_lo := p_other; v_hi := auth.uid(); end if;

  insert into dm_threads (user_lo, user_hi) values (v_lo, v_hi)
  on conflict (user_lo, user_hi) do nothing;
  select id into v_id from dm_threads where user_lo = v_lo and user_hi = v_hi;
  return v_id;
end $$;

-- Send a message in a thread the caller belongs to. Bumps the thread to the top.
create function public.dm_send(p_thread uuid, p_body text)
returns public.dm_messages language plpgsql security definer set search_path = public as $$
declare v_row dm_messages; v_ok boolean;
begin
  select (user_lo = auth.uid() or user_hi = auth.uid()) into v_ok from dm_threads where id = p_thread;
  if v_ok is not true then raise exception 'not your conversation'; end if;
  if char_length(trim(p_body)) = 0 then raise exception 'empty message'; end if;

  insert into dm_messages (thread_id, sender_id, body) values (p_thread, auth.uid(), trim(p_body)) returning * into v_row;
  update dm_threads set last_message_at = v_row.created_at,
    lo_last_read_at = case when user_lo = auth.uid() then v_row.created_at else lo_last_read_at end,
    hi_last_read_at = case when user_hi = auth.uid() then v_row.created_at else hi_last_read_at end
  where id = p_thread;
  return v_row;
end $$;

-- The caller's conversations, most recent first, with the other person and unread count.
create function public.dm_list()
returns table (
  thread_id uuid,
  other_id uuid,
  other_name text,
  last_body text,
  last_at timestamptz,
  unread int
)
language sql stable security definer set search_path = public as $$
  select t.id,
         other.id,
         coalesce(nullif(other.name, ''), 'Member'),
         (select m.body from dm_messages m where m.thread_id = t.id order by m.created_at desc limit 1),
         t.last_message_at,
         (select count(*)::int from dm_messages m
            where m.thread_id = t.id and m.sender_id <> auth.uid()
              and m.created_at > (case when t.user_lo = auth.uid() then t.lo_last_read_at else t.hi_last_read_at end))
  from dm_threads t
  join profiles other on other.id = case when t.user_lo = auth.uid() then t.user_hi else t.user_lo end
  where t.user_lo = auth.uid() or t.user_hi = auth.uid()
  order by t.last_message_at desc;
$$;

-- One page of a conversation, newest first. Only a participant may read it.
create function public.dm_thread_messages(p_thread uuid, p_before timestamptz default null, p_limit int default 40)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.sender_id, m.body, m.created_at
  from dm_messages m
  where m.thread_id = p_thread
    and exists (select 1 from dm_threads t where t.id = p_thread and (t.user_lo = auth.uid() or t.user_hi = auth.uid()))
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Who the other person is, for the conversation header.
create function public.dm_thread_head(p_thread uuid)
returns table (other_id uuid, other_name text)
language sql stable security definer set search_path = public as $$
  select other.id, coalesce(nullif(other.name, ''), 'Member')
  from dm_threads t
  join profiles other on other.id = case when t.user_lo = auth.uid() then t.user_hi else t.user_lo end
  where t.id = p_thread and (t.user_lo = auth.uid() or t.user_hi = auth.uid());
$$;

-- Mark everything in a thread as read up to now.
create function public.dm_mark_read(p_thread uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update dm_threads set
    lo_last_read_at = case when user_lo = auth.uid() then now() else lo_last_read_at end,
    hi_last_read_at = case when user_hi = auth.uid() then now() else hi_last_read_at end
  where id = p_thread and (user_lo = auth.uid() or user_hi = auth.uid());
end $$;

-- People the caller shares a space with and can start a chat with. Deduplicated
-- across spaces, excludes the caller, most recently active spaces' mates first.
create function public.dm_contacts()
returns table (user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, coalesce(nullif(p.name, ''), 'Member')
  from space_members me
  join space_members other on other.space_id = me.space_id and other.user_id <> me.user_id
  join profiles p on p.id = other.user_id
  where me.user_id = auth.uid()
  order by 2;
$$;

-- The other participant's device tokens, for the push when the caller sends a DM.
create function public.dm_tokens_to_notify(p_thread uuid)
returns table (token text, platform text)
language sql stable security definer set search_path = public as $$
  select pt.token, pt.platform
  from dm_threads t
  join push_tokens pt on pt.user_id = case when t.user_lo = auth.uid() then t.user_hi else t.user_lo end
  where t.id = p_thread and (t.user_lo = auth.uid() or t.user_hi = auth.uid());
$$;

revoke execute on function public.shares_space_with(uuid), public.dm_open(uuid), public.dm_send(uuid, text),
  public.dm_list(), public.dm_thread_messages(uuid, timestamptz, int), public.dm_thread_head(uuid),
  public.dm_mark_read(uuid), public.dm_contacts(), public.dm_tokens_to_notify(uuid) from public, anon;
grant execute on function public.shares_space_with(uuid), public.dm_open(uuid), public.dm_send(uuid, text),
  public.dm_list(), public.dm_thread_messages(uuid, timestamptz, int), public.dm_thread_head(uuid),
  public.dm_mark_read(uuid), public.dm_contacts(), public.dm_tokens_to_notify(uuid) to authenticated;

-- Live updates: the app listens for new direct messages.
alter publication supabase_realtime add table public.dm_messages;

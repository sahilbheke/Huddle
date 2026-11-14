-- Milestone 7a: unread indicator for spaces.
-- Each member remembers when they last opened a space; anything posted after
-- that by someone else counts as unread.

alter table public.space_members add column last_read_at timestamptz not null default now();

-- Unread count per space for the caller: messages and check-ins by other people
-- since the caller last opened that space.
create function public.space_unreads()
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
  where sm.user_id = auth.uid();
$$;

-- Mark a space read up to now for the caller.
create function public.mark_space_read(p_space uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update space_members set last_read_at = now()
  where space_id = p_space and user_id = auth.uid();
end $$;

revoke execute on function public.space_unreads(), public.mark_space_read(uuid) from public, anon;
grant execute on function public.space_unreads(), public.mark_space_read(uuid) to authenticated;

-- Milestone 7a: the hourly post limit applies to activity check-ins only.
-- Group chat is always unlimited.

-- Count only check-ins toward the per-hour limit (messages no longer count).
create or replace function public.assert_under_hourly_limit(p_space uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_limit int;
  v_count int;
  v_oldest timestamptz;
begin
  select posts_per_hour into v_limit from spaces where id = p_space;
  if v_limit = 0 then return; end if;
  select count(*), min(created_at) into v_count, v_oldest
  from checkins
  where space_id = p_space and user_id = p_user and created_at > now() - interval '1 hour';
  if v_count >= v_limit then
    raise exception 'hourly_limit' using
      detail = to_char(v_oldest + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      hint = format('This space allows %s activity check-ins per hour per person.', v_limit);
  end if;
end $$;

-- Sending a group message is never rate-limited.
create or replace function public.send_message(p_space uuid, p_body text)
returns public.messages language plpgsql security definer set search_path = public as $$
declare v_row messages;
begin
  if not is_member(p_space) then raise exception 'not a member of this space'; end if;
  if not (select chat_enabled from spaces where id = p_space) then
    raise exception 'chat_off' using hint = 'Only check-ins can be posted in this space.';
  end if;
  insert into messages (space_id, user_id, body) values (p_space, auth.uid(), trim(p_body)) returning * into v_row;
  return v_row;
end $$;

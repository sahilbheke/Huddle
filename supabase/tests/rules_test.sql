-- Rules engine tests. Run with: npm run db:test (plain Postgres 15+, no Supabase needed).
\set ON_ERROR_STOP on

insert into auth.users (id, phone) values
  ('00000000-0000-0000-0000-00000000000a', '+919800000001'),
  ('00000000-0000-0000-0000-00000000000b', '+919800000002'),
  ('00000000-0000-0000-0000-00000000000c', '+919800000003');

create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p, false) $$;
create function pg_temp.expect_error(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error "%" but the statement succeeded: %', p_msg, p_sql;
exception when others then
  if sqlerrm not like '%' || p_msg || '%' then
    raise exception 'expected error "%", got "%"', p_msg, sqlerrm;
  end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

set role authenticated;

-- Profiles are created from auth users, with the phone hashed
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select phone_hash from profiles where id = auth.uid()) = encode(sha256('919800000001'::bytea), 'hex'), 'phone hash';
end $$;
update profiles set name = 'Sahil' where id = auth.uid();

-- Owner creates a fitness space: six activity types are seeded
select set_config('t.space', create_space('Daily Movement', 'fitness', 2, 2, true)::text, false);
select set_config('t.code', (select invite_code from spaces where id = current_setting('t.space')::uuid), false);
do $$ begin
  assert (select count(*) from activity_types where space_id = current_setting('t.space')::uuid) = 6, 'six types';
  assert (select role from space_members where user_id = auth.uid()) = 'owner', 'owner role';
end $$;
select set_config('t.run', (select id::text from activity_types where key = 'run'), false);
select set_config('t.swim', (select id::text from activity_types where key = 'swim'), false);

-- An outsider sees nothing and cannot post
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from spaces) = 0, 'outsider sees no spaces';
  assert (select count(*) from activity_types) = 0, 'outsider sees no types';
end $$;
select pg_temp.expect_error(format($q$select create_checkin(%L, %L, '{"dist":5}')$q$, current_setting('t.space'), current_setting('t.run')), 'not a member');

-- A friend joins with the invite code
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select join_space(current_setting('t.code'));
update profiles set name = 'Priya' where id = auth.uid();
do $$ begin
  assert (select count(*) from spaces) = 1, 'member sees the space';
  assert (select count(*) from profiles) = 2, 'member sees space mates';
end $$;

-- Required field missing: refused, and the message names the field
select pg_temp.expect_error(format($q$select create_checkin(%L, %L, '{"time":30}')$q$, current_setting('t.space'), current_setting('t.run')), 'missing_fields');
select pg_temp.expect_error(format($q$select create_checkin(%L, %L, '{"dist":0}')$q$, current_setting('t.space'), current_setting('t.run')), 'missing_fields');

-- A 5 km run in 24 minutes: accepted, day marked done, fastest 5K = 1440 s
select create_checkin(current_setting('t.space')::uuid, current_setting('t.run')::uuid, '{"dist":5,"time":24,"junk":"x"}', 'Tempo run');
do $$ begin
  assert (select vals from checkins limit 1) = '{"dist":5,"time":24}'::jsonb, 'unknown keys dropped';
  assert (select status from day_status where user_id = auth.uid()) = 'done', 'day done';
  assert (select value from records where kind = 'fastest_5k') = 1440, 'fastest 5k';
  assert (select value from records where kind = 'best:run') = 5, 'longest run';
end $$;

-- Second post (a message) fits the limit of 2; the third is refused
select send_message(current_setting('t.space')::uuid, 'Who is up for Sunday?');
select pg_temp.expect_error(format($q$select send_message(%L, 'again')$q$, current_setting('t.space')), 'hourly_limit');

-- Members cannot change the rules
update spaces set posts_per_hour = 0 where id = current_setting('t.space')::uuid;
do $$ begin
  assert (select posts_per_hour from spaces) = 2, 'member update ignored';
end $$;

-- Owner turns the limit off (0) and hides nothing on swim except laps, which is dropped
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update spaces set posts_per_hour = 0 where id = current_setting('t.space')::uuid;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select send_message(current_setting('t.space')::uuid, 'no limit now');
select create_checkin(current_setting('t.space')::uuid, current_setting('t.swim')::uuid, '{"dist":800,"time":20,"laps":32}');
do $$ begin
  assert (select vals from checkins where type_id = current_setting('t.swim')::uuid) = '{"dist":800,"time":20}'::jsonb, 'hidden field dropped';
end $$;

-- A slower 5K does not replace the record
select create_checkin(current_setting('t.space')::uuid, current_setting('t.run')::uuid, '{"dist":5,"time":30}');
do $$ begin
  assert (select value from records where kind = 'fastest_5k') = 1440, 'record kept';
end $$;

-- Owner chat off: messages refused
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update spaces set chat_enabled = false where id = current_setting('t.space')::uuid;
select pg_temp.expect_error(format($q$select send_message(%L, 'hi')$q$, current_setting('t.space')), 'chat_off');

-- Only the owner grants admin access
select set_member_role(current_setting('t.space')::uuid, '00000000-0000-0000-0000-00000000000b', 'admin');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($q$select set_member_role(%L, %L, 'member')$q$, current_setting('t.space'), '00000000-0000-0000-0000-00000000000a'), 'only the owner');

-- Admin cannot hide the primary field (database constraint)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($q$update activity_fields set state = 'hidden' where is_primary$q$, 'check constraint');

reset role;

-- Closing days: rest days first, then missed. Owner (a) has not posted today.
do $$
declare s uuid := current_setting('t.space')::uuid; d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  update space_members set joined_at = now() - interval '10 days' where space_id = s;
  perform close_day(s, d);
  perform close_day(s, d); -- idempotent
  assert (select status from day_status where user_id = '00000000-0000-0000-0000-00000000000a' and local_date = d) = 'rest', 'first miss uses a rest day';
  assert (select status from day_status where user_id = '00000000-0000-0000-0000-00000000000b' and local_date = d) = 'done', 'done stays done';
  update spaces set rest_days_per_week = 1 where id = s;
  -- a second empty day in the same week has no rest day left
  if extract(isodow from d) > 1 then
    perform close_day(s, d - 1);
    if extract(isodow from d) > 2 then
      perform close_day(s, d - 2);
      assert (select count(*) from day_status where user_id = '00000000-0000-0000-0000-00000000000a'
              and local_date in (d - 1, d - 2) and status = 'missed') >= 1, 'missed after rest days run out';
    end if;
  end if;
end $$;

-- Board numbers
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ declare r record; begin
  select * into r from space_board(current_setting('t.space')::uuid) where name = 'Priya';
  assert r.streak >= 1 and r.done_today and r.kept_pct > 0, format('board for Priya: %s', r);
end $$;
reset role;


-- Feed, today numbers, cheers and photo paths (milestone 3)
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ declare s uuid := current_setting('t.space')::uuid; r record; n int; c uuid; begin
  select count(*) into n from space_feed(s);
  assert n = (select count(*) from checkins where space_id = s) + (select count(*) from messages where space_id = s), 'feed has every item';
  select * into r from space_feed(s) where kind = 'checkin' and type_key = 'run' limit 1;
  assert r.name = 'Priya' and r.type_label = 'Running' and jsonb_array_length(r.fields) = 2 and r.cheers = 0, format('feed check-in row: %s', r);
  assert (select bool_and(a.created_at >= b.created_at) from
           (select created_at, row_number() over () i from space_feed(s)) a
           join (select created_at, row_number() over () i from space_feed(s)) b on b.i = a.i + 1), 'feed newest first';
  assert (select count(*) from space_feed(s, null, 2)) = 2, 'feed limit';
  c := r.id;
  assert toggle_cheer(c) = true, 'cheer on';
  assert (select cheers from space_feed(s) where id = c) = 1 and (select cheered from space_feed(s) where id = c), 'cheer counted';
  assert toggle_cheer(c) = false, 'cheer off';
  assert (select cheers from space_feed(s) where id = c) = 0, 'cheer removed';
  select * into r from space_today(s);
  assert r.members = 2 and r.done >= 1, format('today: %s', r);
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from space_feed(current_setting('t.space')::uuid)) = 0, 'outsider sees no feed';
  assert (select count(*) from space_today(current_setting('t.space')::uuid)) = 0, 'outsider sees no numbers';
end $$;
select pg_temp.expect_error(format($q$select toggle_cheer(%L)$q$, (select id from checkins limit 1)), 'not a member');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($q$select create_checkin(%L, %L, '{"dist":3}', null, 'someone-else/x.jpg')$q$,
  current_setting('t.space'), current_setting('t.run')), 'photo does not belong');
select create_checkin(current_setting('t.space')::uuid, current_setting('t.run')::uuid, '{"dist":3}', null,
  current_setting('t.space') || '/00000000-0000-0000-0000-00000000000b/run.jpg');
reset role;

\echo 'All rules tests passed'

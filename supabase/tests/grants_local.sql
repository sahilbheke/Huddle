-- Supabase grants these by default; plain Postgres needs them spelled out.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Supabase grants these by default; plain Postgres needs them spelled out.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on schema public to service_role;
grant execute on function public.claim_due_reminders() to service_role;

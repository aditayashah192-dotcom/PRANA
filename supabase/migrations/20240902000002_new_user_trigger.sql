-- Phase 0 migration 3: handle_new_user trigger on auth.users.
-- Populates a profiles row (role = field_supervisor, unassigned contractor)
-- for every user created in the auth system, so role resolution via
-- get_my_role() is always available immediately after sign-up.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, role, contractor_id, created_at)
  values (new.id, 'field_supervisor', null, now())
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

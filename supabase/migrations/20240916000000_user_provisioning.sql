-- Phase 7: Secure user provisioning RPCs and audit log.
--
-- Adds role-specific SECURITY DEFINER RPCs for organizational user provisioning:
--   * provision_contractor_admin — govt_auditor only
--   * provision_field_supervisor — contractor_admin only
--
-- Security model:
--   * Caller role is validated server-side via get_my_role().
--   * Target user must be in the default unassigned state (field_supervisor, null contractor_id).
--   * Cross-tenant assignment is prevented.
--   * Role escalation is prevented (cannot create govt_auditor, cannot change existing privileged roles).
--   * Auth user creation is NOT performed by these RPCs; they only update the profiles record.
--     Auth user creation must be done server-side (e.g., via Supabase Admin API in a Next.js API route).
--   * The existing handle_new_user trigger is preserved; it creates a default field_supervisor
--     profile for any new auth user. The provisioning RPCs then promote/assign that profile.

-- ============================================================================
-- 1. user_provisioning_log — append-only audit trail
-- ============================================================================
create table public.user_provisioning_log (
  id                uuid primary key default gen_random_uuid(),
  provisioned_user_id uuid not null references auth.users on delete cascade,
  new_role          text not null
                    check (new_role in ('contractor_admin', 'field_supervisor')),
  contractor_id     uuid references public.contractors on delete set null,
  provisioned_by    uuid not null references auth.users on delete set null,
  created_at        timestamp with time zone default now()
);

create index if not exists idx_user_provisioning_log_user
  on public.user_provisioning_log (provisioned_user_id);
create index if not exists idx_user_provisioning_log_contractor
  on public.user_provisioning_log (contractor_id);
create index if not exists idx_user_provisioning_log_performed_by
  on public.user_provisioning_log (provisioned_by);

alter table public.user_provisioning_log enable row level security;
alter table public.user_provisioning_log force row level security;

create policy "user_provisioning_log_select" on public.user_provisioning_log for select using (
  get_my_role() = 'govt_auditor'
  or contractor_id = get_my_contractor_id()
  or provisioned_by = auth.uid()
);

create policy "user_provisioning_log_insert" on public.user_provisioning_log for insert with check (
  get_my_role() in ('govt_auditor', 'contractor_admin')
);

-- ============================================================================
-- 2. RPC: provision_contractor_admin
--    Caller: govt_auditor
--    Target: existing auth user whose profile is in the default unassigned state
--            (role = field_supervisor, contractor_id = null)
--    Action: update profile to contractor_admin + specified contractor_id
-- ============================================================================
create or replace function public.provision_contractor_admin(
  p_user_id       uuid,
  p_contractor_id uuid,
  p_full_name     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_role text;
  v_current_contractor_id uuid;
  v_full_name text := nullif(trim(p_full_name), '');
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'govt_auditor' then
    raise exception 'unauthorized: govt_auditor role required';
  end if;

  if p_user_id is null or p_contractor_id is null then
    raise exception 'user_id and contractor_id are required';
  end if;

  -- Prevent self-provisioning or role changes on the caller
  if p_user_id = auth.uid() then
    raise exception 'cannot provision yourself';
  end if;

  -- Verify contractor exists
  if not exists (select 1 from public.contractors where id = p_contractor_id) then
    raise exception 'contractor not found';
  end if;

  -- Read current profile state
  select role, contractor_id into v_current_role, v_current_contractor_id
    from public.profiles
   where id = p_user_id;

  if not found then
    raise exception 'user profile not found';
  end if;

  -- Must be in default unassigned state
  if v_current_role <> 'field_supervisor' or v_current_contractor_id is not null then
    raise exception 'user is not in an unassigned state and cannot be provisioned as contractor_admin';
  end if;

  -- Update profile
  update public.profiles
     set role = 'contractor_admin',
         contractor_id = p_contractor_id,
         full_name = v_full_name
   where id = p_user_id;

  -- Audit log
  insert into public.user_provisioning_log (
    provisioned_user_id,
    new_role,
    contractor_id,
    provisioned_by
  ) values (
    p_user_id,
    'contractor_admin',
    p_contractor_id,
    auth.uid()
  );
end;
$$;

grant execute on function public.provision_contractor_admin(uuid, uuid, text) to authenticated;

-- ============================================================================
-- 3. RPC: provision_field_supervisor
--    Caller: contractor_admin
--    Target: existing auth user whose profile is in the default unassigned state
--            (role = field_supervisor, contractor_id = null)
--    Action: update profile to field_supervisor + caller's contractor_id
-- ============================================================================
create or replace function public.provision_field_supervisor(
  p_user_id   uuid,
  p_full_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_role text;
  v_current_contractor_id uuid;
  v_caller_contractor_id uuid;
  v_full_name text := nullif(trim(p_full_name), '');
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'contractor_admin' then
    raise exception 'unauthorized: contractor_admin role required';
  end if;

  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  -- Prevent self-provisioning
  if p_user_id = auth.uid() then
    raise exception 'cannot provision yourself';
  end if;

  -- Resolve caller's contractor
  select contractor_id into v_caller_contractor_id
    from public.profiles
   where id = auth.uid();

  if v_caller_contractor_id is null then
    raise exception 'caller contractor_id is null';
  end if;

  -- Read current profile state
  select role, contractor_id into v_current_role, v_current_contractor_id
    from public.profiles
   where id = p_user_id;

  if not found then
    raise exception 'user profile not found';
  end if;

  -- Must be in default unassigned state
  if v_current_role <> 'field_supervisor' or v_current_contractor_id is not null then
    raise exception 'user is not in an unassigned state and cannot be provisioned as field_supervisor';
  end if;

  -- Update profile
  update public.profiles
     set role = 'field_supervisor',
         contractor_id = v_caller_contractor_id,
         full_name = v_full_name
   where id = p_user_id;

  -- Audit log
  insert into public.user_provisioning_log (
    provisioned_user_id,
    new_role,
    contractor_id,
    provisioned_by
  ) values (
    p_user_id,
    'field_supervisor',
    v_caller_contractor_id,
    auth.uid()
  );
end;
$$;

grant execute on function public.provision_field_supervisor(uuid, text) to authenticated;

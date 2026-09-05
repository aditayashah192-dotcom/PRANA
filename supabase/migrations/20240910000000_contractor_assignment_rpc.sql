-- Phase 4: Contractor admin assignment RPC and minor schema extensions.
--
-- Adds:
--   * profiles.full_name for human-readable supervisor display.
--   * workzone_assignments.updated_by for contractor-side assignment audit.
--   * assign_field_supervisor() SECURITY DEFINER RPC gated to contractor_admin.

-- ============================================================================
-- 1. profiles: add full_name for display purposes
-- ============================================================================
alter table public.profiles
  add column if not exists full_name text;

-- ============================================================================
-- 2. workzone_assignments: add updated_by audit column
-- ============================================================================
alter table public.workzone_assignments
  add column if not exists updated_by uuid references auth.users on delete set null;

-- ============================================================================
-- 3. RPC: assign_field_supervisor
-- ============================================================================
create or replace function public.assign_field_supervisor(
  p_workzone_id uuid,
  p_assigned_staff_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor_id uuid;
  v_staff_contractor_id uuid;
  v_staff_role text;
  v_existing_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'contractor_admin' then
    raise exception 'unauthorized: contractor_admin role required';
  end if;

  if p_workzone_id is null or p_assigned_staff_id is null then
    raise exception 'workzone_id and assigned_staff_id are required';
  end if;

  -- Workzone must belong to caller's contractor.
  select contractor_id into v_contractor_id
    from public.workzones
   where id = p_workzone_id;

  if not found then
    raise exception 'workzone not found';
  end if;

  if v_contractor_id <> get_my_contractor_id() then
    raise exception 'workzone does not belong to your contractor';
  end if;

  -- Target staff must be a field_supervisor in caller's contractor.
  select contractor_id, role into v_staff_contractor_id, v_staff_role
    from public.profiles
   where id = p_assigned_staff_id;

  if not found then
    raise exception 'staff not found';
  end if;

  if v_staff_role <> 'field_supervisor' then
    raise exception 'assigned staff must have role field_supervisor';
  end if;

  if v_staff_contractor_id <> get_my_contractor_id() then
    raise exception 'staff does not belong to your contractor';
  end if;

  -- Upsert assignment.
  select id into v_existing_id
    from public.workzone_assignments
   where workzone_id = p_workzone_id
     and contractor_id = get_my_contractor_id()
   for update;

  if found then
    update public.workzone_assignments
       set assigned_staff_id = p_assigned_staff_id,
           updated_at = now(),
           updated_by = auth.uid()
     where id = v_existing_id;
  else
    insert into public.workzone_assignments (
      workzone_id,
      assigned_staff_id,
      contractor_id,
      updated_by
    ) values (
      p_workzone_id,
      p_assigned_staff_id,
      get_my_contractor_id(),
      auth.uid()
    );
  end if;
end;
$$;

grant execute on function public.assign_field_supervisor(uuid, uuid) to authenticated;

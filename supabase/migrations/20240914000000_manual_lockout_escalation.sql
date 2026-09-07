-- Phase 4 Segment 1: Update apply_manual_lockout to create escalation event
--
-- Extends the existing apply_manual_lockout RPC so that every new manual
-- lockout creates an escalation event. The notification delivery itself is
-- handled by the API layer or by a separate caller; this RPC only records
-- the event for audit and idempotency.

create or replace function public.apply_manual_lockout(
  p_workzone_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
  v_override_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'field_supervisor' then
    raise exception 'unauthorized: field_supervisor role required';
  end if;

  if p_workzone_id is null then
    raise exception 'workzone_id is required';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required';
  end if;

  select id into v_assignment_id
    from public.workzone_assignments
   where workzone_id = p_workzone_id
     and assigned_staff_id = auth.uid()
     and contractor_id = get_my_contractor_id();

  if not found then
    raise exception 'not assigned to this workzone';
  end if;

  insert into public.manual_lockouts (workzone_id, performed_by, reason, active)
  values (p_workzone_id, auth.uid(), p_reason, true);

  begin
    perform public.create_escalation_event(
      p_workzone_id,
      'LOCKOUT_ENTERED',
      'manual_lockout',
      null
    );
  exception when others then
    raise warning 'escalation event creation failed: %', sqlerrm;
  end;
end;
$$;

grant execute on function public.apply_manual_lockout(uuid, text) to authenticated;

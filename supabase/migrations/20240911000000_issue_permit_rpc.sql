-- Phase 5: Secure field supervisor permit issuance RPC.
--
-- Adds:
--   * public.haversine_distance_meters() helper (server-side geofence math).
--   * public.issue_permit() SECURITY DEFINER RPC gated to field_supervisor.

-- ============================================================================
-- 1. Haversine distance helper
-- ============================================================================
create or replace function public.haversine_distance_meters(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
returns double precision
language sql
stable
security definer
set search_path = public
as $$
  select 6371000 * 2 * atan2(
    sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lon2 - lon1) / 2), 2)
    ),
    sqrt(1 - (
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lon2 - lon1) / 2), 2)
    ))
  )
$$;

-- ============================================================================
-- 2. issue_permit RPC
-- ============================================================================
create or replace function public.issue_permit(
  p_workzone_id uuid,
  p_work_order_id uuid,
  p_lat double precision,
  p_lon double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor_id uuid;
  v_target_lat double precision;
  v_target_lon double precision;
  v_assignment_id uuid;
  v_auth_state jsonb;
  v_freshness_state text;
  v_aggregate_state text;
  v_distance_meters double precision;
  v_permit_id uuid;
  v_permit_number text;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'field_supervisor' then
    raise exception 'unauthorized: field_supervisor role required';
  end if;

  if p_workzone_id is null or p_work_order_id is null then
    raise exception 'workzone_id and work_order_id are required';
  end if;

  if p_lat is null or p_lon is null then
    raise exception 'latitude and longitude are required';
  end if;

  -- Verify assignment exists
  select id into v_assignment_id
    from public.workzone_assignments
   where workzone_id = p_workzone_id
     and assigned_staff_id = auth.uid()
     and contractor_id = get_my_contractor_id();

  if not found then
    raise exception 'not assigned to this workzone';
  end if;

  -- Verify work order belongs to workzone and caller's contractor
  select contractor_id into v_contractor_id
    from public.work_orders
   where id = p_work_order_id
     and workzone_id = p_workzone_id
     and contractor_id = get_my_contractor_id();

  if not found then
    raise exception 'work_order does not belong to this workzone or contractor';
  end if;

  -- Get workzone target
  select target_lat, target_lon into v_target_lat, v_target_lon
    from public.workzones
   where id = p_workzone_id;

  if not found or v_target_lat is null or v_target_lon is null then
    raise exception 'workzone target not found';
  end if;

  -- Server-side geofence validation (50m)
  v_distance_meters := public.haversine_distance_meters(p_lat, p_lon, v_target_lat, v_target_lon);
  if v_distance_meters > 50.0 then
    raise exception 'outside geofence: distance_meters=%.1f', v_distance_meters;
  end if;

  -- Obtain authoritative workzone state
  v_auth_state := public.get_workzone_authoritative_state_for_view(p_workzone_id);
  v_freshness_state := v_auth_state->>'freshness_state';
  v_aggregate_state := v_auth_state->>'aggregate_state';

  if v_freshness_state <> 'FRESH' then
    raise exception 'telemetry not fresh: freshness_state=%', v_freshness_state;
  end if;

  -- Project Prana safety policy: require SAFE only.
  -- WARMING is NOT authorized for permit issuance unless the source-of-truth
  -- specification explicitly permits it. Current specification does not.
  if v_aggregate_state <> 'SAFE' then
    raise exception 'workzone not safe: aggregate_state=%', v_aggregate_state;
  end if;

  -- Generate permit number
  v_permit_number := 'PERMIT-' || extract(epoch from now())::text;

  -- Insert permit
  insert into public.permits (
    contractor_id,
    workzone_id,
    work_order_id,
    field_supervisor_id,
    status,
    number
  ) values (
    get_my_contractor_id(),
    p_workzone_id,
    p_work_order_id,
    auth.uid(),
    'ISSUED',
    v_permit_number
  ) returning id into v_permit_id;

  return jsonb_build_object(
    'id', v_permit_id,
    'contractor_id', get_my_contractor_id(),
    'workzone_id', p_workzone_id,
    'work_order_id', p_work_order_id,
    'field_supervisor_id', auth.uid(),
    'status', 'ISSUED',
    'number', v_permit_number,
    'created_at', now()
  );
end;
$$;

grant execute on function public.issue_permit(uuid, uuid, double precision, double precision) to authenticated;

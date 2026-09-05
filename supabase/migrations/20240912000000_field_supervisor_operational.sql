-- Phase 6: Field Supervisor Operational Backend
--
-- Adds:
--   * entrants and work_order_entrants for pre-assigned entrant selection.
--   * manual_lockouts for authoritative manual lockout.
--   * two_person_overrides for dual-auth override.
--   * permit_lifecycle_log for permit state transition audit.
--   * RPCs for all operations.
--   * Extends issue_permit to reject active manual lockouts unless an
--     approved two-person override is in effect.

-- ============================================================================
-- 1. entrants
-- ============================================================================
create table public.entrants (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors on delete cascade,
  full_name     text not null,
  badge_number  text,
  role          text,
  created_at    timestamp with time zone default now()
);

create index if not exists idx_entrants_contractor
  on public.entrants (contractor_id);

alter table public.entrants enable row level security;
alter table public.entrants force row level security;

create policy "entrants_select" on public.entrants for select using (
  get_my_role() = 'govt_auditor'
  or contractor_id = get_my_contractor_id()
);

create policy "entrants_insert" on public.entrants for insert with check (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
);

create policy "entrants_update" on public.entrants for update using (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
) with check (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
);

create policy "entrants_delete" on public.entrants for delete using (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
);

-- ============================================================================
-- 2. work_order_entrants (pre-assignment)
-- ============================================================================
create table public.work_order_entrants (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders on delete cascade,
  entrant_id    uuid not null references public.entrants on delete cascade,
  assigned_by   uuid not null references auth.users on delete set null,
  assigned_at   timestamp with time zone default now(),
  unique(work_order_id, entrant_id)
);

create index if not exists idx_work_order_entrants_work_order
  on public.work_order_entrants (work_order_id);
create index if not exists idx_work_order_entrants_entrant
  on public.work_order_entrants (entrant_id);

alter table public.work_order_entrants enable row level security;
alter table public.work_order_entrants force row level security;

create policy "work_order_entrants_select" on public.work_order_entrants for select using (
  get_my_role() = 'govt_auditor'
  or exists (
    select 1
    from public.work_orders wo
    where wo.id = work_order_entrants.work_order_id
      and wo.contractor_id = get_my_contractor_id()
  )
);

create policy "work_order_entrants_insert" on public.work_order_entrants for insert with check (
  get_my_role() = 'contractor_admin'
  and exists (
    select 1
    from public.work_orders wo
    where wo.id = work_order_entrants.work_order_id
      and wo.contractor_id = get_my_contractor_id()
  )
  and exists (
    select 1
    from public.entrants e
    where e.id = work_order_entrants.entrant_id
      and e.contractor_id = get_my_contractor_id()
  )
);

create policy "work_order_entrants_delete" on public.work_order_entrants for delete using (
  get_my_role() = 'contractor_admin'
  and exists (
    select 1
    from public.work_orders wo
    where wo.id = work_order_entrants.work_order_id
      and wo.contractor_id = get_my_contractor_id()
  )
);

-- ============================================================================
-- 3. manual_lockouts
-- ============================================================================
create table public.manual_lockouts (
  id            uuid primary key default gen_random_uuid(),
  workzone_id   uuid not null references public.workzones on delete cascade,
  performed_by  uuid not null references auth.users on delete set null,
  reason        text not null,
  active        boolean not null default true,
  created_at    timestamp with time zone default now()
);

create index if not exists idx_manual_lockouts_workzone
  on public.manual_lockouts (workzone_id);
create index if not exists idx_manual_lockouts_active
  on public.manual_lockouts (workzone_id, active);

alter table public.manual_lockouts enable row level security;
alter table public.manual_lockouts force row level security;

create policy "manual_lockouts_select" on public.manual_lockouts for select using (
  get_my_role() = 'govt_auditor'
  or exists (
    select 1
    from public.workzone_assignments wa
    where wa.workzone_id = manual_lockouts.workzone_id
      and wa.assigned_staff_id = auth.uid()
  )
  or exists (
    select 1
    from public.workzones wz
    where wz.id = manual_lockouts.workzone_id
      and wz.contractor_id = get_my_contractor_id()
      and get_my_role() = 'contractor_admin'
  )
);

create policy "manual_lockouts_insert" on public.manual_lockouts for insert with check (
  exists (
    select 1
    from public.workzone_assignments wa
    where wa.workzone_id = manual_lockouts.workzone_id
      and wa.assigned_staff_id = auth.uid()
      and wa.contractor_id = get_my_contractor_id()
  )
  and reason is not null and trim(reason) <> ''
);

create policy "manual_lockouts_update" on public.manual_lockouts for update using (
  exists (
    select 1
    from public.workzone_assignments wa
    where wa.workzone_id = manual_lockouts.workzone_id
      and wa.assigned_staff_id = auth.uid()
      and wa.contractor_id = get_my_contractor_id()
  )
) with check (
  exists (
    select 1
    from public.workzone_assignments wa
    where wa.workzone_id = manual_lockouts.workzone_id
      and wa.assigned_staff_id = auth.uid()
      and wa.contractor_id = get_my_contractor_id()
  )
);

-- ============================================================================
-- 4. two_person_overrides
-- ============================================================================
create type public.override_status as enum ('pending', 'approved', 'rejected', 'expired');

create table public.two_person_overrides (
  id            uuid primary key default gen_random_uuid(),
  workzone_id   uuid not null references public.workzones on delete cascade,
  requested_by  uuid not null references auth.users on delete set null,
  approved_by   uuid references auth.users on delete set null,
  reason        text not null,
  request_reason text not null,
  approval_reason text,
  status        public.override_status not null default 'pending',
  expires_at    timestamp with time zone,
  created_at    timestamp with time zone default now(),
  updated_at    timestamp with time zone default now()
);

create index if not exists idx_two_person_overrides_workzone
  on public.two_person_overrides (workzone_id);
create index if not exists idx_two_person_overrides_status
  on public.two_person_overrides (status);

alter table public.two_person_overrides enable row level security;
alter table public.two_person_overrides force row level security;

create policy "two_person_overrides_select" on public.two_person_overrides for select using (
  get_my_role() = 'govt_auditor'
  or exists (
    select 1
    from public.workzone_assignments wa
    where wa.workzone_id = two_person_overrides.workzone_id
      and wa.assigned_staff_id = auth.uid()
      and wa.contractor_id = get_my_contractor_id()
  )
  or (get_my_role() = 'contractor_admin'
      and exists (
        select 1
        from public.workzones wz
        where wz.id = two_person_overrides.workzone_id
          and wz.contractor_id = get_my_contractor_id()
      ))
);

create policy "two_person_overrides_insert" on public.two_person_overrides for insert with check (
  exists (
    select 1
    from public.workzone_assignments wa
    where wa.workzone_id = two_person_overrides.workzone_id
      and wa.assigned_staff_id = auth.uid()
      and wa.contractor_id = get_my_contractor_id()
  )
  and reason is not null and trim(reason) <> ''
);

create policy "two_person_overrides_update" on public.two_person_overrides for update using (
  exists (
    select 1
    from public.workzone_assignments wa
    where wa.workzone_id = two_person_overrides.workzone_id
      and wa.assigned_staff_id = auth.uid()
      and wa.contractor_id = get_my_contractor_id()
  )
) with check (
  exists (
    select 1
    from public.workzone_assignments wa
    where wa.workzone_id = two_person_overrides.workzone_id
      and wa.assigned_staff_id = auth.uid()
      and wa.contractor_id = get_my_contractor_id()
  )
);

-- ============================================================================
-- 5. permit_lifecycle_log
-- ============================================================================
create table public.permit_lifecycle_log (
  id            uuid primary key default gen_random_uuid(),
  permit_id     uuid not null references public.permits on delete cascade,
  previous_status text not null,
  new_status     text not null,
  performed_by  uuid not null references auth.users on delete set null,
  reason        text,
  created_at    timestamp with time zone default now()
);

create index if not exists idx_permit_lifecycle_log_permit
  on public.permit_lifecycle_log (permit_id);

alter table public.permit_lifecycle_log enable row level security;
alter table public.permit_lifecycle_log force row level security;

create policy "permit_lifecycle_log_select" on public.permit_lifecycle_log for select using (
  get_my_role() = 'govt_auditor'
  or exists (
    select 1
    from public.permits p
    where p.id = permit_lifecycle_log.permit_id
      and p.contractor_id = get_my_contractor_id()
  )
  or (get_my_role() = 'field_supervisor'
      and exists (
        select 1
        from public.permits p
        where p.id = permit_lifecycle_log.permit_id
          and p.field_supervisor_id = auth.uid()
      ))
);

create policy "permit_lifecycle_log_insert" on public.permit_lifecycle_log for insert with check (
  exists (
    select 1
    from public.permits p
    where p.id = permit_lifecycle_log.permit_id
      and p.contractor_id = get_my_contractor_id()
  )
);

-- ============================================================================
-- 6. RPC: assign_entrant_to_work_order (contractor_admin)
-- ============================================================================
create or replace function public.assign_entrant_to_work_order(
  p_work_order_id uuid,
  p_entrant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor_id uuid;
  v_entrant_contractor_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'contractor_admin' then
    raise exception 'unauthorized: contractor_admin role required';
  end if;

  if p_work_order_id is null or p_entrant_id is null then
    raise exception 'work_order_id and entrant_id are required';
  end if;

  select contractor_id into v_contractor_id
    from public.work_orders
   where id = p_work_order_id;

  if not found then
    raise exception 'work_order not found';
  end if;

  if v_contractor_id <> get_my_contractor_id() then
    raise exception 'work_order does not belong to your contractor';
  end if;

  select contractor_id into v_entrant_contractor_id
    from public.entrants
   where id = p_entrant_id;

  if not found then
    raise exception 'entrant not found';
  end if;

  if v_entrant_contractor_id <> get_my_contractor_id() then
    raise exception 'entrant does not belong to your contractor';
  end if;

  insert into public.work_order_entrants (work_order_id, entrant_id, assigned_by)
  values (p_work_order_id, p_entrant_id, auth.uid())
  on conflict (work_order_id, entrant_id) do nothing;
end;
$$;

grant execute on function public.assign_entrant_to_work_order(uuid, uuid) to authenticated;

-- ============================================================================
-- 7. RPC: record_entrant_selection (field_supervisor)
-- ============================================================================
create or replace function public.record_entrant_selection(
  p_work_order_id uuid,
  p_entrant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contractor_id uuid;
  v_assignment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'field_supervisor' then
    raise exception 'unauthorized: field_supervisor role required';
  end if;

  if p_work_order_id is null or p_entrant_id is null then
    raise exception 'work_order_id and entrant_id are required';
  end if;

  select wo.contractor_id into v_contractor_id
    from public.work_orders wo
   where wo.id = p_work_order_id;

  if not found then
    raise exception 'work_order not found';
  end if;

  if v_contractor_id <> get_my_contractor_id() then
    raise exception 'work_order does not belong to your contractor';
  end if;

  select id into v_assignment_id
    from public.workzone_assignments
   where workzone_id = (
           select workzone_id
             from public.work_orders
            where id = p_work_order_id
         )
     and assigned_staff_id = auth.uid()
     and contractor_id = get_my_contractor_id();

  if not found then
    raise exception 'not assigned to this workzone';
  end if;

  if not exists (
    select 1
      from public.work_order_entrants woe
     where woe.work_order_id = p_work_order_id
       and woe.entrant_id = p_entrant_id
  ) then
    raise exception 'entrant is not pre-assigned to this work order';
  end if;

  insert into public.work_order_entrants (work_order_id, entrant_id, assigned_by)
  values (p_work_order_id, p_entrant_id, auth.uid())
  on conflict (work_order_id, entrant_id) do update
    set assigned_by = excluded.assigned_by,
        assigned_at = now();
end;
$$;

grant execute on function public.record_entrant_selection(uuid, uuid) to authenticated;

-- ============================================================================
-- 8. RPC: transition_permit (permit lifecycle)
-- ============================================================================
create or replace function public.transition_permit(
  p_permit_id uuid,
  p_new_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_contractor_id uuid;
  v_valid boolean := false;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if p_new_status is null or trim(p_new_status) = '' then
    raise exception 'new_status is required';
  end if;

  select status, contractor_id into v_current_status, v_contractor_id
    from public.permits
   where id = p_permit_id;

  if not found then
    raise exception 'permit not found';
  end if;

  if get_my_role() = 'field_supervisor' then
    if v_contractor_id <> get_my_contractor_id() then
      raise exception 'permit does not belong to your contractor';
    end if;

    if v_current_status = 'ISSUED' and p_new_status = 'ACTIVE' then
      v_valid := true;
    elsif v_current_status = 'ACTIVE' and p_new_status = 'CLOSED' then
      v_valid := true;
    end if;
  elsif get_my_role() = 'contractor_admin' then
    if v_contractor_id <> get_my_contractor_id() then
      raise exception 'permit does not belong to your contractor';
    end if;

    if v_current_status = 'ISSUED' and p_new_status = 'ACTIVE' then
      v_valid := true;
    elsif v_current_status = 'ACTIVE' and p_new_status = 'CLOSED' then
      v_valid := true;
    end if;
  else
    raise exception 'unauthorized: field_supervisor or contractor_admin role required';
  end if;

  if not v_valid then
    raise exception 'invalid transition: %s -> %s', v_current_status, p_new_status;
  end if;

  update public.permits
     set status = p_new_status
   where id = p_permit_id;

  insert into public.permit_lifecycle_log (
    permit_id, previous_status, new_status, performed_by, reason
  ) values (
    p_permit_id, v_current_status, p_new_status, auth.uid(), p_reason
  );
end;
$$;

grant execute on function public.transition_permit(uuid, text, text) to authenticated;

-- ============================================================================
-- 9. RPC: apply_manual_lockout
-- ============================================================================
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
end;
$$;

grant execute on function public.apply_manual_lockout(uuid, text) to authenticated;

-- ============================================================================
-- 10. RPC: release_manual_lockout
-- ============================================================================
create or replace function public.release_manual_lockout(
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
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() not in ('field_supervisor', 'contractor_admin') then
    raise exception 'unauthorized: field_supervisor or contractor_admin role required';
  end if;

  if p_workzone_id is null then
    raise exception 'workzone_id is required';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required';
  end if;

  if get_my_role() = 'field_supervisor' then
    select id into v_assignment_id
      from public.workzone_assignments
     where workzone_id = p_workzone_id
       and assigned_staff_id = auth.uid()
       and contractor_id = get_my_contractor_id();

    if not found then
      raise exception 'not assigned to this workzone';
    end if;
  elsif get_my_role() = 'contractor_admin' then
    select id into v_assignment_id
      from public.workzones
     where id = p_workzone_id
       and contractor_id = get_my_contractor_id();

    if not found then
      raise exception 'workzone does not belong to your contractor';
    end if;
  end if;

  update public.manual_lockouts
     set active = false
   where workzone_id = p_workzone_id
     and active = true;
end;
$$;

grant execute on function public.release_manual_lockout(uuid, text) to authenticated;

-- ============================================================================
-- 11. RPC: request_two_person_override
-- ============================================================================
create or replace function public.request_two_person_override(
  p_workzone_id uuid,
  p_reason text
)
returns uuid
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

  insert into public.two_person_overrides (
    workzone_id, requested_by, reason, request_reason, status
  ) values (
    p_workzone_id, auth.uid(), p_reason, p_reason, 'pending'
  ) returning id into v_override_id;

  return v_override_id;
end;
$$;

grant execute on function public.request_two_person_override(uuid, text) to authenticated;

-- ============================================================================
-- 12. RPC: approve_two_person_override
-- ============================================================================
create or replace function public.approve_two_person_override(
  p_override_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workzone_id uuid;
  v_requested_by uuid;
  v_current_status public.override_status;
  v_assignment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'field_supervisor' then
    raise exception 'unauthorized: field_supervisor role required';
  end if;

  if p_override_id is null then
    raise exception 'override_id is required';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'reason is required';
  end if;

  select workzone_id, requested_by, status into v_workzone_id, v_requested_by, v_current_status
    from public.two_person_overrides
   where id = p_override_id;

  if not found then
    raise exception 'override not found';
  end if;

  if v_current_status <> 'pending' then
    raise exception 'override is not pending';
  end if;

  if v_requested_by = auth.uid() then
    raise exception 'self-approval is not allowed';
  end if;

  select id into v_assignment_id
    from public.workzone_assignments
   where workzone_id = v_workzone_id
     and assigned_staff_id = auth.uid()
     and contractor_id = get_my_contractor_id();

  if not found then
    raise exception 'not assigned to this workzone';
  end if;

  update public.two_person_overrides
     set status = 'approved',
         approved_by = auth.uid(),
         approval_reason = p_reason,
         expires_at = now() + interval '1 hour',
         updated_at = now()
   where id = p_override_id;
end;
$$;

grant execute on function public.approve_two_person_override(uuid, text) to authenticated;

-- ============================================================================
-- 13. Extend issue_permit with lockout and override checks
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
  v_has_lockout boolean;
  v_has_override boolean;
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

  -- Check for active manual lockout
  select exists (
    select 1
      from public.manual_lockouts ml
     where ml.workzone_id = p_workzone_id
       and ml.active = true
  ) into v_has_lockout;

  if v_has_lockout then
    select exists (
      select 1
        from public.two_person_overrides tpo
       where tpo.workzone_id = p_workzone_id
         and tpo.status = 'approved'
         and tpo.expires_at > now()
    ) into v_has_override;

    if not v_has_override then
      raise exception 'workzone is under manual lockout';
    end if;
  end if;

  -- Obtain authoritative workzone state
  v_auth_state := public.get_workzone_authoritative_state_for_view(p_workzone_id);
  v_freshness_state := v_auth_state->>'freshness_state';
  v_aggregate_state := v_auth_state->>'aggregate_state';

  if v_freshness_state <> 'FRESH' then
    raise exception 'telemetry not fresh: freshness_state=%', v_freshness_state;
  end if;

  -- Project Prana safety policy: require SAFE only.
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

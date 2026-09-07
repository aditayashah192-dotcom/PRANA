-- Phase 3E: Government Auditor workzone creation RPC and audit log.

-- ============================================================================
-- 1. Audit log for workzone creation
-- ============================================================================
create table public.workzone_creation_log (
  id               uuid primary key default gen_random_uuid(),
  workzone_id      uuid not null references public.workzones on delete cascade,
  name             text not null,
  target_lat       double precision not null,
  target_lon       double precision not null,
  target_depth_meters double precision not null,
  contractor_id    uuid references public.contractors on delete set null,
  performed_by     uuid not null references auth.users on delete set null,
  reason           text,
  created_at       timestamp with time zone default now()
);

create index if not exists idx_workzone_creation_log_workzone
  on public.workzone_creation_log (workzone_id);

create index if not exists idx_workzone_creation_log_performed_by
  on public.workzone_creation_log (performed_by);

alter table public.workzone_creation_log enable row level security;
alter table public.workzone_creation_log force row level security;

create policy "workzone_creation_log_select" on public.workzone_creation_log for select using (
  get_my_role() = 'govt_auditor'
  or performed_by = auth.uid()
);

create policy "workzone_creation_log_insert" on public.workzone_creation_log for insert with check (
  get_my_role() = 'govt_auditor'
);

-- ============================================================================
-- 2. RPC: create_workzone
-- ============================================================================
create or replace function public.create_workzone(
  p_name                 text,
  p_target_lat           double precision,
  p_target_lon           double precision,
  p_target_depth_meters  double precision,
  p_contractor_id        uuid default null,
  p_reason               text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workzone_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'govt_auditor' then
    raise exception 'unauthorized';
  end if;

  if p_name is null or trim(p_name) = '' then
    raise exception 'workzone name is required';
  end if;

  if p_target_lat is null or p_target_lon is null or p_target_depth_meters is null then
    raise exception 'target coordinates and depth are required';
  end if;

  if not (p_target_lat between -90 and 90) then
    raise exception 'latitude must be between -90 and 90';
  end if;

  if not (p_target_lon between -180 and 180) then
    raise exception 'longitude must be between -180 and 180';
  end if;

  if p_target_depth_meters < 0 then
    raise exception 'target depth must be non-negative';
  end if;

  if p_contractor_id is not null then
    if not exists (select 1 from public.contractors where id = p_contractor_id) then
      raise exception 'contractor not found';
    end if;
    if p_reason is null or trim(p_reason) = '' then
      raise exception 'allocation reason is required when contractor is provided';
    end if;
  end if;

  insert into public.workzones (
    name,
    contractor_id,
    target_lat,
    target_lon,
    target_depth_meters
  ) values (
    trim(p_name),
    p_contractor_id,
    p_target_lat,
    p_target_lon,
    p_target_depth_meters
  )
  returning id into v_workzone_id;

  insert into public.workzone_creation_log (
    workzone_id,
    name,
    target_lat,
    target_lon,
    target_depth_meters,
    contractor_id,
    performed_by,
    reason
  ) values (
    v_workzone_id,
    trim(p_name),
    p_target_lat,
    p_target_lon,
    p_target_depth_meters,
    p_contractor_id,
    auth.uid(),
    case when p_contractor_id is not null then trim(p_reason) else null end
  );

  return v_workzone_id;
end;
$$;

grant execute on function public.create_workzone(text, double precision, double precision, double precision, uuid, text) to authenticated;

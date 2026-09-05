-- Phase 3A2 migration 1: workzone_assignments junction table and permits extension.
-- Adds explicit staff-to-workzone assignment, restricts field supervisor workzone
-- visibility to assigned rows only, and extends permits with work_order_id,
-- field_supervisor_id, and status while preserving tenant isolation.

-- ============================================================================
-- 1. workzone_assignments
-- ============================================================================
create table public.workzone_assignments (
  id               uuid primary key default gen_random_uuid(),
  workzone_id      uuid not null references public.workzones on delete cascade,
  assigned_staff_id uuid not null references auth.users on delete cascade,
  contractor_id    uuid not null references public.contractors on delete cascade,
  created_at       timestamp with time zone default now(),
  updated_at       timestamp with time zone default now(),
  unique(workzone_id, assigned_staff_id)
);

create index if not exists idx_workzone_assignments_workzone
  on public.workzone_assignments (workzone_id);
create index if not exists idx_workzone_assignments_staff
  on public.workzone_assignments (assigned_staff_id);
create index if not exists idx_workzone_assignments_contractor
  on public.workzone_assignments (contractor_id);

alter table public.workzone_assignments enable row level security;
alter table public.workzone_assignments force row level security;

create policy "workzone_assignments_select" on public.workzone_assignments for select using (
  get_my_role() = 'govt_auditor'
  or contractor_id = get_my_contractor_id()
  or assigned_staff_id = auth.uid()
);

create policy "workzone_assignments_insert" on public.workzone_assignments for insert with check (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
  and exists (
    select 1
    from public.workzones
    where workzones.id = workzone_assignments.workzone_id
      and workzones.contractor_id = get_my_contractor_id()
  )
);

create policy "workzone_assignments_update" on public.workzone_assignments for update using (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
  and exists (
    select 1
    from public.workzones
    where workzones.id = workzone_assignments.workzone_id
      and workzones.contractor_id = get_my_contractor_id()
  )
) with check (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
  and exists (
    select 1
    from public.workzones
    where workzones.id = workzone_assignments.workzone_id
      and workzones.contractor_id = get_my_contractor_id()
  )
);

create policy "workzone_assignments_delete" on public.workzone_assignments for delete using (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
);

-- ============================================================================
-- 2. Restrict workzones visibility for field supervisors to assigned rows only
-- ============================================================================
drop policy "workzones_select" on public.workzones;

create policy "workzones_select" on public.workzones for select using (
  get_my_role() = 'govt_auditor'
  or (contractor_id = get_my_contractor_id() and get_my_role() = 'contractor_admin')
  or exists (
    select 1
    from public.workzone_assignments
    where workzone_assignments.workzone_id = workzones.id
      and workzone_assignments.assigned_staff_id = auth.uid()
  )
);

-- ============================================================================
-- 3. Extend permits
-- ============================================================================
alter table public.permits
  add column if not exists work_order_id       uuid references public.work_orders on delete set null,
  add column if not exists field_supervisor_id uuid references auth.users on delete set null,
  add column if not exists status             text not null default 'ISSUED'
                                             check (status in ('ISSUED', 'ACTIVE', 'CLOSED'));

create index if not exists idx_permits_work_order
  on public.permits (work_order_id);
create index if not exists idx_permits_field_supervisor
  on public.permits (field_supervisor_id);

-- ============================================================================
-- 4. Update permits RLS
-- ============================================================================
drop policy "permits_select" on public.permits;
drop policy "permits_insert" on public.permits;
drop policy "permits_update" on public.permits;
drop policy "permits_delete" on public.permits;

create policy "permits_select" on public.permits for select using (
  get_my_role() = 'govt_auditor'
  or (get_my_role() = 'contractor_admin' and contractor_id = get_my_contractor_id())
  or (get_my_role() = 'field_supervisor' and (
    field_supervisor_id = auth.uid()
    or exists (
      select 1
      from public.workzone_assignments
      where workzone_assignments.workzone_id = permits.workzone_id
        and workzone_assignments.assigned_staff_id = auth.uid()
    )
  ))
);

create policy "permits_insert_admin" on public.permits for insert with check (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
  and exists (
    select 1
    from public.workzones
    where workzones.id = permits.workzone_id
      and workzones.contractor_id = get_my_contractor_id()
  )
);

create policy "permits_insert_fs" on public.permits for insert with check (
  get_my_role() = 'field_supervisor'
  and field_supervisor_id = auth.uid()
  and contractor_id = get_my_contractor_id()
  and status = 'ISSUED'
  and work_order_id is not null
  and exists (
    select 1
    from public.workzone_assignments
    where workzone_assignments.workzone_id = permits.workzone_id
      and workzone_assignments.assigned_staff_id = auth.uid()
  )
  and exists (
    select 1
    from public.work_orders
    where work_orders.id = permits.work_order_id
      and work_orders.workzone_id = permits.workzone_id
  )
);

create policy "permits_update" on public.permits for update using (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
) with check (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
);

create policy "permits_delete" on public.permits for delete using (
  get_my_role() = 'contractor_admin'
  and contractor_id = get_my_contractor_id()
);

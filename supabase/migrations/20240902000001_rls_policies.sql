-- Phase 0 migration 2: Row-Level Security policies.
-- FORCE ROW LEVEL SECURITY is enabled on every table so that policies apply
-- even to the table owner. scan_logs is INSERT-only (no UPDATE/DELETE
-- policies for any role). govt_auditor has cross-tenant read access.

-- 1. Enable RLS + FORCE on all tables.
alter table public.contractors    enable row level security;
alter table public.profiles       enable row level security;
alter table public.workzones      enable row level security;
alter table public.work_orders    enable row level security;
alter table public.devices        enable row level security;
alter table public.scan_logs      enable row level security;
alter table public.permits        enable row level security;
alter table public.override_log   enable row level security;

alter table public.contractors    force row level security;
alter table public.profiles       force row level security;
alter table public.workzones      force row level security;
alter table public.work_orders    force row level security;
alter table public.devices        force row level security;
alter table public.scan_logs      force row level security;
alter table public.permits        force row level security;
alter table public.override_log   force row level security;

-- 2. contractors (tenant directory: the "id = get_my_contractor_id()" tenant
-- tenant link is the row's own PK).
create policy "contractors_select" on public.contractors for select using (
  get_my_role() = 'govt_auditor' OR id = get_my_contractor_id()
);
create policy "contractors_insert" on public.contractors for insert with check (
  get_my_role() = 'govt_auditor'
);
create policy "contractors_update" on public.contractors for update using (
  get_my_role() = 'govt_auditor' OR id = get_my_contractor_id()
) with check (
  get_my_role() = 'govt_auditor' OR id = get_my_contractor_id()
);
create policy "contractors_delete" on public.contractors for delete using (
  get_my_role() = 'govt_auditor'
);

-- 3. profiles (extends auth.users). No INSERT policy: the signup trigger owns
-- profile creation. No DELETE policy (managed via the auth lifecycle).
create policy "profiles_select" on public.profiles for select using (
  get_my_role() = 'govt_auditor'
  OR contractor_id = get_my_contractor_id()
  OR id = auth.uid()
);
create policy "profiles_update" on public.profiles for update using (
  get_my_role() = 'govt_auditor'
) with check (
  get_my_role() = 'govt_auditor'
);

-- 4. workzones (tenant-scoped: contractor_id = get_my_contractor_id()).
create policy "workzones_select" on public.workzones for select using (
  get_my_role() = 'govt_auditor' OR contractor_id = get_my_contractor_id()
);
create policy "workzones_insert" on public.workzones for insert with check (
  contractor_id = get_my_contractor_id()
);
create policy "workzones_update" on public.workzones for update using (
  contractor_id = get_my_contractor_id()
) with check (
  contractor_id = get_my_contractor_id()
);
create policy "workzones_delete" on public.workzones for delete using (
  contractor_id = get_my_contractor_id()
);

-- 5. work_orders (tenant-scoped: contractor_id = get_my_contractor_id()).
create policy "work_orders_select" on public.work_orders for select using (
  get_my_role() = 'govt_auditor' OR contractor_id = get_my_contractor_id()
);
create policy "work_orders_insert" on public.work_orders for insert with check (
  contractor_id = get_my_contractor_id()
);
create policy "work_orders_update" on public.work_orders for update using (
  contractor_id = get_my_contractor_id()
) with check (
  contractor_id = get_my_contractor_id()
);
create policy "work_orders_delete" on public.work_orders for delete using (
  contractor_id = get_my_contractor_id()
);

-- 6. devices (tenant-scoped: contractor_id = get_my_contractor_id()).
create policy "devices_select" on public.devices for select using (
  get_my_role() = 'govt_auditor' OR contractor_id = get_my_contractor_id()
);
create policy "devices_insert" on public.devices for insert with check (
  contractor_id = get_my_contractor_id()
);
create policy "devices_update" on public.devices for update using (
  contractor_id = get_my_contractor_id()
) with check (
  contractor_id = get_my_contractor_id()
);
create policy "devices_delete" on public.devices for delete using (
  contractor_id = get_my_contractor_id()
);

-- 7. scan_logs (INSERT-only). Tenant visibility is derived through the
-- related work_order's contractor_id. There are ZERO UPDATE or DELETE
-- policies for any role.
create policy "scan_logs_select" on public.scan_logs for select using (
  get_my_role() = 'govt_auditor'
  OR EXISTS (
    SELECT 1
    FROM public.work_orders
    WHERE work_orders.id = scan_logs.work_order_id
      AND work_orders.contractor_id = get_my_contractor_id()
  )
);
create policy "scan_logs_insert" on public.scan_logs for insert with check (
  EXISTS (
    SELECT 1
    FROM public.work_orders
    WHERE work_orders.id = scan_logs.work_order_id
      AND work_orders.contractor_id = get_my_contractor_id()
  )
);
-- No "scan_logs_update" and no "scan_logs_delete" policies: append-only.

-- 8. permits (tenant-scoped: contractor_id = get_my_contractor_id()).
create policy "permits_select" on public.permits for select using (
  get_my_role() = 'govt_auditor' OR contractor_id = get_my_contractor_id()
);
create policy "permits_insert" on public.permits for insert with check (
  contractor_id = get_my_contractor_id()
);
create policy "permits_update" on public.permits for update using (
  contractor_id = get_my_contractor_id()
) with check (
  contractor_id = get_my_contractor_id()
);
create policy "permits_delete" on public.permits for delete using (
  contractor_id = get_my_contractor_id()
);

-- 9. override_log (immutable audit trail: select + insert only).
create policy "override_log_select" on public.override_log for select using (
  get_my_role() = 'govt_auditor'
  OR performed_by = auth.uid()
);
create policy "override_log_insert" on public.override_log for insert with check (
  performed_by = auth.uid() OR get_my_role() = 'govt_auditor'
);
-- No update / delete policies: audit log is append-only.

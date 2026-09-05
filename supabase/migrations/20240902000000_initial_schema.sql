-- Phase 0 migration 1: base schema and RLS helper functions.
-- Tables: contractors, profiles (extends auth.users), workzones, work_orders,
-- devices, scan_logs, permits, override_log.

create extension if not exists "pgcrypto";

-- contractors: tenant companies. A govt_auditor owns no contractor; every
-- contractor_admin / field_supervisor belongs to exactly one.
create table public.contractors (
  id          uuid primary key default gen_random_uuid(),
  name        text  not null,
  created_at  timestamp with time zone default now()
);

-- profiles: one row per auth.users.id, extending the auth user with a role and
-- a tenant (contractor) link. Created automatically by the handle_new_user
-- trigger upon signup (see migration 3).
create table public.profiles (
  id             uuid primary key references auth.users on delete cascade,
  role           text not null
                  check (role in ('govt_auditor', 'contractor_admin', 'field_supervisor')),
  contractor_id  uuid references public.contractors on delete set null,
  created_at     timestamp with time zone default now()
);

-- workzones: a geographic work area owned by a single contractor.
create table public.workzones (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  contractor_id uuid references public.contractors on delete cascade,
  created_at   timestamp with time zone default now()
);

-- work_orders: a discrete task issued against a workzone.
create table public.work_orders (
  id           uuid primary key default gen_random_uuid(),
  workzone_id  uuid references public.workzones on delete set null,
  contractor_id uuid references public.contractors on delete cascade,
  status       text
                 check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  created_at   timestamp with time zone default now()
);

-- devices: field scanning hardware assigned to a workzone and contractor.
create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  serial_number text not null,
  secret_hash   text not null,
  is_active     boolean not null default true,
  workzone_id   uuid references public.workzones on delete set null,
  contractor_id uuid references public.contractors on delete cascade,
  created_at    timestamp with time zone default now()
);

-- scan_logs: immutable record of a device scan event. INSERT-only by policy
-- (see migration 2). readings is free-form JSONB captured from the device.
create table public.scan_logs (
  id           uuid primary key default gen_random_uuid(),
  work_order_id uuid references public.work_orders on delete set null,
  device_id     uuid references public.devices on delete set null,
  readings     jsonb not null default '{}'::jsonb,
  decision      text,
  prev_hash     text,
  row_hash      text,
  created_at    timestamp with time zone default now()
);

-- permits: authorization documents owned by a contractor and scoped to a
-- workzone.
create table public.permits (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid references public.contractors on delete cascade,
  workzone_id   uuid references public.workzones on delete set null,
  number        text not null,
  created_at    timestamp with time zone default now()
);

-- override_log: immutable audit trail of manual overrides to scan decisions.
create table public.override_log (
  id           uuid primary key default gen_random_uuid(),
  performed_by uuid references public.profiles on delete set null,
  scan_log_id  uuid references public.scan_logs on delete set null,
  reason       text,
  created_at   timestamp with time zone default now()
);

-- Indexes supporting the tenant-scoped queries used by the RLS policies.
create index if not exists idx_workzones_contractor     on public.workzones (contractor_id);
create index if not exists idx_work_orders_contractor    on public.work_orders (contractor_id);
create index if not exists idx_work_orders_workzone     on public.work_orders (workzone_id);
create index if not exists idx_devices_contractor       on public.devices (contractor_id);
create index if not exists idx_devices_workzone         on public.devices (workzone_id);
create index if not exists idx_scan_logs_work_order     on public.scan_logs (work_order_id);
create index if not exists idx_scan_logs_device         on public.scan_logs (device_id);
create index if not exists idx_scan_logs_created_at      on public.scan_logs (created_at);
create index if not exists idx_permits_contractor       on public.permits (contractor_id);
create index if not exists idx_permits_workzone         on public.permits (workzone_id);
create index if not exists idx_override_log_performed_by on public.override_log (performed_by);

-- Tenant isolation helpers, invoked by every tenant-scoped RLS policy.
-- SECURITY DEFINER so the lookup of the caller's own profile row is not
-- blocked by the profiles policy itself (it reads only by auth.uid()).
create or replace function public.get_my_contractor_id()
returns uuid
language sql
stable
security definer
as $$
  select contractor_id
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
as $$
  select role
  from public.profiles
  where id = auth.uid()
$$;

grant execute on function public.get_my_contractor_id(), public.get_my_role() to authenticated;

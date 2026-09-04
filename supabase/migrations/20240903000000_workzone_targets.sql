-- Phase 2C migration: add target coordinates and expected depth to workzones
-- so the compliance engine can evaluate geofence and depth compliance
-- during telemetry ingestion.

alter table public.workzones
  add column if not exists target_lat          double precision not null default 0,
  add column if not exists target_lon          double precision not null default 0,
  add column if not exists target_depth_meters double precision not null default 0;

create index if not exists idx_workzones_target on public.workzones (target_lat, target_lon);
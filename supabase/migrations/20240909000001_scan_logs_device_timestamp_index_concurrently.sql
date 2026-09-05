-- Phase 1.8b: Non-transactional composite index for latest telemetry per device
-- This migration must be run outside a transaction block because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
--
-- Deployment step (run manually or via CI/CD after the transactional
-- 20240909000000 migration has applied):
--   psql -d <database> -f supabase/migrations/20240909000001_scan_logs_device_timestamp_index_concurrently.sql
--
-- Or via Supabase CLI:
--   supabase db execute --file supabase/migrations/20240909000001_scan_logs_device_timestamp_index_concurrently.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_logs_device_timestamp
  ON public.scan_logs (device_id, timestamp DESC NULLS LAST);

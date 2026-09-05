-- Phase 1.5b: Non-transactional index build for telemetry_integrity
-- This migration must be run outside a transaction block because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
--
-- Deployment step (run manually or via CI/CD after the transactional
-- 20240905000000 migration has applied):
--   psql -d <database> -f supabase/migrations/20240905000001_telemetry_integrity_index_concurrently.sql
--
-- Or via Supabase CLI:
--   supabase db execute --file supabase/migrations/20240905000001_telemetry_integrity_index_concurrently.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_logs_timestamp
  ON public.scan_logs (timestamp DESC NULLS LAST);

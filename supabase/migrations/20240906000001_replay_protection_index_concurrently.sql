-- Phase 1.6b: Non-transactional unique index build for replay_protection
-- This migration must be run outside a transaction block because
-- CREATE UNIQUE INDEX CONCURRENTLY cannot run inside a transaction.
--
-- Deployment step (run manually or via CI/CD after the transactional
-- 20240906000000 migration has applied):
--   psql -d <database> -f supabase/migrations/20240906000001_replay_protection_index_concurrently.sql
--
-- Or via Supabase CLI:
--   supabase db execute --file supabase/migrations/20240906000001_replay_protection_index_concurrently.sql

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_logs_device_message
  ON public.scan_logs (device_id, message_id);

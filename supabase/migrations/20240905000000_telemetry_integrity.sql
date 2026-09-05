-- Phase 1.5: Telemetry Integrity Foundation
-- Adds top-level device timestamp and device heartbeat tracking.
--
-- Replay-protection note:
-- The current ingest route computes row_hash server-side from the latest
-- database row's row_hash plus the canonicalized payload. Because the
-- server overwrites prev_hash on every insert, replaying the same payload
-- produces a different row_hash. A UNIQUE(row_hash) constraint would
-- therefore NOT detect replays. Application-level deduplication would also
-- be race-prone without a stable client-committed chain pointer.
-- This gap is reported; no uniqueness constraint is added in this phase.

-- 1. Top-level device timestamp on scan_logs
ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS timestamp timestamptz;

-- 2. Device heartbeat tracking (schema only; protocol gap noted:
--    the ESP32 telemetry payload has no distinct heartbeat signal, so
--    this column is intentionally NOT auto-populated from ordinary
--    ingest in Phase 1.5).
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

-- 3. Index to support the latest-telemetry ordering by device timestamp
-- NOTE: The actual index creation has been moved to a non-transactional
-- migration (20240905000001_telemetry_integrity_index_concurrently.sql)
-- because CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

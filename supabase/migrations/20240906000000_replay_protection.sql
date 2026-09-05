-- Phase 1.6: Telemetry Replay Protection
-- Adds a deterministic message_id derived from the canonicalized signed payload
-- and enforces uniqueness per device to prevent replay attacks.
--
-- Mechanism:
--   message_id = SHA256(canonicalize({device_id, readings, timestamp, work_order_id}))
--
-- This identifier is stable across replays of the same packet but unique per
-- distinct message. The database UNIQUE index on (device_id, message_id)
-- provides race-safe deduplication without relying on row_hash.

-- 1. Add message_id column
ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS message_id text;

-- 2. Enforce uniqueness per device for the same telemetry message
-- NOTE: The actual unique index creation has been moved to a non-transactional
-- migration (20240906000001_replay_protection_index_concurrently.sql)
-- because CREATE UNIQUE INDEX CONCURRENTLY cannot run inside a transaction block.

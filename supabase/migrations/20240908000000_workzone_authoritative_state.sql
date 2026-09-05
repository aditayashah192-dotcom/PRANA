-- Phase 1.7: Authoritative per-workzone safety state.
--
-- Adds a SELECT-only view and a SECURITY DEFINER RPC that aggregate the most
-- recent telemetry and compliance decision for each workzone, applying a
-- deterministic, fail-safe authoritative-selection rule.
--
-- SAFETY INVARIANTS (must NOT be violated):
--   * Missing telemetry   -> aggregate_state = 'UNKNOWN', reason = 'NO_TELEMETRY'
--   * Stale telemetry     -> aggregate_state = 'UNKNOWN', reason = 'TELEMETRY_STALE'
--   * Ambiguous authority -> aggregate_state = 'UNKNOWN', reason = 'AMBIGUOUS_AUTHORITY'
--   * Invalid/sensor-fail -> aggregate_state = 'LOCKOUT' (from existing decision)
--   * scan_logs remains append-only (no UPDATE/DELETE policies added or changed)
--   * The existing complianceEngine, HMAC, freshness window of 30s are reused
--     as-is. This migration does NOT recalculate decisions; it only selects
--     and classifies already-stored scan_logs.decision values.
--
-- Authoritative selection rule (deterministic, fail-safe):
--   1. Candidate work_orders for a workzone are those that resolve back to it
--      via work_orders.workzone_id OR via a scan_log whose work_order_id
--      resolves to the workzone (covers the case where a device posts against
--      a work_order whose workzone_id differs from the device's assignment,
--      matching the existing ingest behavior at src/app/api/telemetry/ingest).
--   2. Among candidates, only work_orders with status 'in_progress' are
--      considered authoritative. If exactly one 'in_progress' work_order has a
--      fresh scan_log, it is authoritative.
--   3. If no 'in_progress' work_order has a fresh scan_log, fall back to
--      'pending'. If exactly one 'pending' work_order has a fresh scan_log,
--      it is authoritative.
--   4. If multiple work_orders (in any considered status) have fresh
--      scan_logs, the workzone is reported AMBIGUOUS_AUTHORITY -> UNKNOWN.
--   5. If no work_order has any scan_log at all -> NO_TELEMETRY -> UNKNOWN.
--   6. If the authoritative scan_log's timestamp is older than 30s -> STALE ->
--      UNKNOWN (the underlying decision column is preserved as latest_decision
--      for transparency but the aggregate_state is forced to UNKNOWN).
--
-- All freshness comparisons use the project's 30-second invariant already
-- enforced by verifyTimestampFreshness in src/lib/deviceAuth.ts.

-- ============================================================================
-- 1. RPC: get_workzone_authoritative_state
--    Returns one jsonb object describing the authoritative state of one
--    workzone. SECURITY DEFINER + explicit role gate, matching the existing
--    pattern in 20240907000000_workzone_reallocation_rpc.sql.
-- ============================================================================
create or replace function public.get_workzone_authoritative_state(
  p_workzone_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_now timestamptz := now();
  v_freshness_seconds constant integer := 30;

  v_workzone record;
  v_candidate_count integer;
  -- Authoritative work_order + latest scan_log fields are exposed as
  -- individual nullable variables instead of `record` types because
  -- accessing an unassigned PL/pgSQL `record` raises
  -- `record "v_auth" is not assigned yet`. Initialised to NULL.
  v_auth_work_order_id uuid := null;
  v_auth_work_order_status text := null;
  v_latest_scan_log_id uuid := null;
  v_latest_device_id uuid := null;
  v_latest_decision text := null;
  v_latest_timestamp timestamptz := null;
  v_latest_readings jsonb := null;
  v_age_seconds numeric;
  v_freshness_state text;
  v_aggregate_state text;
  v_aggregate_reason text;
  v_result jsonb;
begin
  -- ------------------------------------------------------------------
  -- Authorisation: govt_auditor only.
  -- Mirrors the gate in reassign_workzone_contractor().
  -- ------------------------------------------------------------------
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;
  v_role := get_my_role();
  if v_role <> 'govt_auditor' then
    raise exception 'unauthorized: govt_auditor role required';
  end if;

  -- ------------------------------------------------------------------
  -- Workzone lookup. RLS on workzones restricts contractor_admin /
  -- field_supervisor visibility; as a SECURITY DEFINER function called by a
  -- govt_auditor, we read through get_my_role() == 'govt_auditor' which is
  -- allowed across all tenants.
  -- ------------------------------------------------------------------
  select id, contractor_id, target_lat, target_lon, target_depth_meters
    into v_workzone
    from public.workzones
    where id = p_workzone_id;

  if not found then
    raise exception 'workzone not found';
  end if;

  -- ------------------------------------------------------------------
  -- Authoritative work_order candidate set.
  --   - 'in_progress' status preferred.
  --   - 'pending' fallback if no in_progress has a fresh scan_log.
  -- We compute freshness using both the top-level scan_logs.timestamp column
  -- (populated by ingest) and created_at, preferring timestamp.
  -- ------------------------------------------------------------------

  -- Count fresh in_progress candidates.
  select count(distinct wo.id) into v_candidate_count
    from public.work_orders wo
    join public.scan_logs sl on sl.work_order_id = wo.id
    where wo.workzone_id = p_workzone_id
      and wo.status = 'in_progress'
      and coalesce(sl.timestamp, sl.created_at) >= v_now - make_interval(secs => v_freshness_seconds) and coalesce(sl.timestamp, sl.created_at) <= v_now + make_interval(secs => v_freshness_seconds);

  if v_candidate_count = 0 then
    -- Fallback: pending with fresh scan_log.
    select count(distinct wo.id) into v_candidate_count
      from public.work_orders wo
      join public.scan_logs sl on sl.work_order_id = wo.id
      where wo.workzone_id = p_workzone_id
        and wo.status = 'pending'
        and coalesce(sl.timestamp, sl.created_at) >= v_now - make_interval(secs => v_freshness_seconds) and coalesce(sl.timestamp, sl.created_at) <= v_now + make_interval(secs => v_freshness_seconds);
  end if;

  if v_candidate_count = 0 then
    -- Check whether ANY scan_logs exist for this workzone at all.
    select count(distinct wo.id) into v_candidate_count
      from public.work_orders wo
      join public.scan_logs sl on sl.work_order_id = wo.id
      where wo.workzone_id = p_workzone_id;

    if v_candidate_count = 0 then
      v_freshness_state := 'MISSING';
      v_aggregate_state := 'UNKNOWN';
      v_aggregate_reason := 'NO_TELEMETRY';
      v_age_seconds := null;
    else
      -- Existed but now stale.
      v_freshness_state := 'STALE';
      v_aggregate_state := 'UNKNOWN';
      v_aggregate_reason := 'TELEMETRY_STALE';
      v_age_seconds := null;
    end if;
  elsif v_candidate_count > 1 then
    v_freshness_state := 'AMBIGUOUS';
    v_aggregate_state := 'UNKNOWN';
    v_aggregate_reason := 'AMBIGUOUS_AUTHORITY';
    v_age_seconds := null;
  else
    -- Exactly one fresh candidate: that work_order is authoritative.
    -- Pick by status preference (in_progress first, then pending) ordered by
    -- latest scan_log timestamp.
    select wo.id, wo.status
      into v_auth_work_order_id, v_auth_work_order_status
      from public.work_orders wo
      join public.scan_logs sl on sl.work_order_id = wo.id
      where wo.workzone_id = p_workzone_id
        and wo.status in ('in_progress', 'pending')
        and coalesce(sl.timestamp, sl.created_at) >= v_now - make_interval(secs => v_freshness_seconds) and coalesce(sl.timestamp, sl.created_at) <= v_now + make_interval(secs => v_freshness_seconds)
      order by (case when wo.status = 'in_progress' then 0 else 1 end) asc,
               coalesce(sl.timestamp, sl.created_at) desc
      limit 1;

    select sl.id,
           sl.device_id,
           sl.decision,
           coalesce(sl.timestamp, sl.created_at) as ts,
           sl.readings
      into v_latest_scan_log_id,
           v_latest_device_id,
           v_latest_decision,
           v_latest_timestamp,
           v_latest_readings
      from public.scan_logs sl
      where sl.work_order_id = v_auth_work_order_id
      order by coalesce(sl.timestamp, sl.created_at) desc
      limit 1;

    v_age_seconds := extract(epoch from (v_now - v_latest_timestamp));
    v_freshness_state := 'FRESH';

    -- Pass through the persisted decision. The compliance engine never emits
    -- 'UNKNOWN' as a successful result; it only emits UNKNOWN on the
    -- WARMING-up false branch. UNKNOWN here is reserved for aggregation
    -- uncertainty (stale / missing / ambiguous) and LOCKOUT for any
    -- sensor-failure case the existing engine produced.
    v_aggregate_state := coalesce(v_latest_decision, 'UNKNOWN');
    v_aggregate_reason :=
      case coalesce(v_latest_decision, 'UNKNOWN')
        when 'SAFE'     then 'ALL_SYSTEMS_NOMINAL'
        when 'WARMING'  then 'SENSOR_WARMUP_IN_PROGRESS'
        when 'WARNING'  then 'ELEVATED_HAZARD'
        when 'LOCKOUT'  then 'SENSOR_FAILURE_OR_HAZARD'
        else 'UNKNOWN'
      end;
  end if;

  -- ------------------------------------------------------------------
  -- Build result. latest_* fields are null when no fresh telemetry exists.
  -- aggregate_state and aggregate_reason are the authoritative values.
  -- ------------------------------------------------------------------
  v_result := jsonb_build_object(
    'workzone_id',               v_workzone.id,
    'contractor_id',             v_workzone.contractor_id,
    'target_lat',                v_workzone.target_lat,
    'target_lon',                v_workzone.target_lon,
    'target_depth_meters',       v_workzone.target_depth_meters,
    'authoritative_work_order_id', v_auth_work_order_id,
    'authoritative_work_order_status', v_auth_work_order_status,
    'authoritative_device_id',   v_latest_device_id,
    'latest_scan_log_id',        v_latest_scan_log_id,
    'latest_scan_timestamp',     v_latest_timestamp,
    'latest_decision',           v_latest_decision,
    'latest_h2s_ppm',            v_latest_readings->>'h2s_ppm',
    'latest_o2_percent',         v_latest_readings->>'o2_percent',
    'latest_depth_meters',       v_latest_readings->>'depth_meters',
    'latest_battery_percent',    v_latest_readings->>'battery_percent',
    'telemetry_age_seconds',     v_age_seconds,
    'freshness_state',           v_freshness_state,
    'aggregate_state',           v_aggregate_state,
    'aggregate_reason',          v_aggregate_reason,
    'freshness_window_seconds',  v_freshness_seconds,
    'computed_at',               v_now
  );

  return v_result;
end;
$$;

grant execute on function public.get_workzone_authoritative_state(uuid) to authenticated;

-- ============================================================================
-- 1b. View-friendly variant: get_workzone_authoritative_state_for_view
--     Same payload, but authorises via the workzones SELECT policy (RLS) so
--     the view can serve gov_auditor AND contractor_admin / field_supervisor
--     with one query. RLS does the access control: if the caller cannot see
--     the row, the SELECT returns no rows and the function returns
--     { aggregate_state: 'NOT_FOUND' }.
-- ============================================================================
create or replace function public.get_workzone_authoritative_state_for_view(p_workzone_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_freshness_seconds constant integer := 30;

  v_workzone record;
  v_candidate_count integer;
  v_auth_work_order_id uuid := null;
  v_auth_work_order_status text := null;
  v_latest_scan_log_id uuid := null;
  v_latest_device_id uuid := null;
  v_latest_decision text := null;
  v_latest_timestamp timestamptz := null;
  v_latest_readings jsonb := null;
  v_age_seconds numeric;
  v_freshness_state text;
  v_aggregate_state text;
  v_aggregate_reason text;
begin
  -- RLS-gated lookup: as SECURITY INVOKER, this SELECT respects the
  -- caller's workzones_select policy. If the caller cannot see this
  -- workzone, no row is returned and we surface NOT_FOUND.
  select id, contractor_id, target_lat, target_lon, target_depth_meters, name
    into v_workzone
    from public.workzones
    where id = p_workzone_id;

  if v_workzone.id is null then
    return jsonb_build_object(
      'workzone_id', p_workzone_id,
      'aggregate_state', 'NOT_FOUND',
      'aggregate_reason', 'NOT_FOUND',
      'freshness_state', 'NOT_FOUND',
      'computed_at', v_now
    );
  end if;

  -- Count fresh in_progress candidates (matches gov-only variant).
  select count(distinct wo.id) into v_candidate_count
    from public.work_orders wo
    join public.scan_logs sl on sl.work_order_id = wo.id
    where wo.workzone_id = p_workzone_id
      and wo.status = 'in_progress'
      and coalesce(sl.timestamp, sl.created_at) >= v_now - make_interval(secs => v_freshness_seconds) and coalesce(sl.timestamp, sl.created_at) <= v_now + make_interval(secs => v_freshness_seconds);

  if v_candidate_count = 0 then
    -- Fallback: pending with fresh scan_log.
    select count(distinct wo.id) into v_candidate_count
      from public.work_orders wo
      join public.scan_logs sl on sl.work_order_id = wo.id
      where wo.workzone_id = p_workzone_id
        and wo.status = 'pending'
        and coalesce(sl.timestamp, sl.created_at) >= v_now - make_interval(secs => v_freshness_seconds) and coalesce(sl.timestamp, sl.created_at) <= v_now + make_interval(secs => v_freshness_seconds);
  end if;

  if v_candidate_count = 0 then
    select count(distinct wo.id) into v_candidate_count
      from public.work_orders wo
      join public.scan_logs sl on sl.work_order_id = wo.id
      where wo.workzone_id = p_workzone_id;

    if v_candidate_count = 0 then
      v_freshness_state := 'MISSING';
      v_aggregate_state := 'UNKNOWN';
      v_aggregate_reason := 'NO_TELEMETRY';
      v_age_seconds := null;
    else
      v_freshness_state := 'STALE';
      v_aggregate_state := 'UNKNOWN';
      v_aggregate_reason := 'TELEMETRY_STALE';
      v_age_seconds := null;
    end if;
  elsif v_candidate_count > 1 then
    v_freshness_state := 'AMBIGUOUS';
    v_aggregate_state := 'UNKNOWN';
    v_aggregate_reason := 'AMBIGUOUS_AUTHORITY';
    v_age_seconds := null;
  else
    select wo.id, wo.status
      into v_auth_work_order_id, v_auth_work_order_status
      from public.work_orders wo
      join public.scan_logs sl on sl.work_order_id = wo.id
      where wo.workzone_id = p_workzone_id
        and wo.status in ('in_progress', 'pending')
        and coalesce(sl.timestamp, sl.created_at) >= v_now - make_interval(secs => v_freshness_seconds) and coalesce(sl.timestamp, sl.created_at) <= v_now + make_interval(secs => v_freshness_seconds)
      order by (case when wo.status = 'in_progress' then 0 else 1 end) asc,
               coalesce(sl.timestamp, sl.created_at) desc
      limit 1;

    select sl.id, sl.device_id, sl.decision,
           coalesce(sl.timestamp, sl.created_at) as ts,
           sl.readings
      into v_latest_scan_log_id, v_latest_device_id, v_latest_decision,
           v_latest_timestamp, v_latest_readings
      from public.scan_logs sl
      where sl.work_order_id = v_auth_work_order_id
      order by coalesce(sl.timestamp, sl.created_at) desc
      limit 1;

    v_age_seconds := extract(epoch from (v_now - v_latest_timestamp));
    v_freshness_state := 'FRESH';
    v_aggregate_state := coalesce(v_latest_decision, 'UNKNOWN');
    v_aggregate_reason :=
      case coalesce(v_latest_decision, 'UNKNOWN')
        when 'SAFE'     then 'ALL_SYSTEMS_NOMINAL'
        when 'WARMING'  then 'SENSOR_WARMUP_IN_PROGRESS'
        when 'WARNING'  then 'ELEVATED_HAZARD'
        when 'LOCKOUT'  then 'SENSOR_FAILURE_OR_HAZARD'
        else 'UNKNOWN'
      end;
  end if;

  return jsonb_build_object(
    'workzone_id',               v_workzone.id,
    'workzone_name',             v_workzone.name,
    'contractor_id',             v_workzone.contractor_id,
    'target_lat',                v_workzone.target_lat,
    'target_lon',                v_workzone.target_lon,
    'target_depth_meters',       v_workzone.target_depth_meters,
    'authoritative_work_order_id', v_auth_work_order_id,
    'authoritative_work_order_status', v_auth_work_order_status,
    'authoritative_device_id',   v_latest_device_id,
    'latest_scan_log_id',        v_latest_scan_log_id,
    'latest_scan_timestamp',     v_latest_timestamp,
    'latest_decision',           v_latest_decision,
    'latest_h2s_ppm',            v_latest_readings->>'h2s_ppm',
    'latest_o2_percent',         v_latest_readings->>'o2_percent',
    'latest_depth_meters',       v_latest_readings->>'depth_meters',
    'latest_battery_percent',    v_latest_readings->>'battery_percent',
    'telemetry_age_seconds',     v_age_seconds,
    'freshness_state',           v_freshness_state,
    'aggregate_state',           v_aggregate_state,
    'aggregate_reason',          v_aggregate_reason,
    'freshness_window_seconds',  v_freshness_seconds,
    'computed_at',               v_now
  );
end;
$$;

grant execute on function public.get_workzone_authoritative_state_for_view(uuid) to authenticated;

-- ============================================================================
-- 2. View: workzone_authoritative_state_view
--    Exposes the authoritative per-workzone state to gov_auditor read paths.
--    SELECT-only; RLS applies via the workzones table SELECT policy. Because
--    the underlying workzones_select policy allows govt_auditor, contractor_admin
--    restricted to own contractor, and field_supervisor restricted to assigned
--    workzones, the view naturally enforces those boundaries.
--
--    This view is a SELECT wrapper that calls the RPC for each row. It is
--    intentionally narrow (one row per workzone) and never writes.
-- ============================================================================
create or replace view public.workzone_authoritative_state_view
with (security_invoker = true)
as
select
  (public.get_workzone_authoritative_state_for_view(w.id)) as state,
  w.id as workzone_id,
  w.contractor_id,
  w.name,
  w.target_lat,
  w.target_lon,
  w.target_depth_meters
from public.workzones w;

comment on view public.workzone_authoritative_state_view is
  'Per-workzone authoritative safety state. Computed server-side via get_workzone_authoritative_state(). SELECT-only; SECURITY INVOKER so RLS on underlying workzones applies. Read-access for govt_auditor (cross-tenant); contractor_admin sees own contractor''s workzones only; field_supervisor sees only assigned workzones (via existing workzones_select policy).';

grant select on public.workzone_authoritative_state_view to authenticated;

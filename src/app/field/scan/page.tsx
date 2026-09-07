'use client'

import { useEffect, useMemo, useState } from 'react'
import { calculateHaversineDistance } from '@/utils/geoUtils'
import StatusBanner from '@/components/telemetry/StatusBanner'
import TelemetryGauges from '@/components/telemetry/TelemetryGauges'
import { useAuthSession } from '@/lib/auth/useAuthSession'

type SafetyState = 'SAFE' | 'WARMING' | 'UNKNOWN' | 'WARNING' | 'LOCKOUT'
type FreshnessState = 'FRESH' | 'STALE' | 'MISSING' | 'AMBIGUOUS'
type PermitStatus = 'ISSUED' | 'ACTIVE' | 'CLOSED'
type OverrideStatus = 'pending' | 'approved' | 'rejected' | 'expired'

interface AssignmentRow {
  id: string
  workzone_id: string
  contractor_id: string
  workzones: {
    id: string
    name: string
    target_lat: number
    target_lon: number
    target_depth_meters: number
  } | {
    id: string
    name: string
    target_lat: number
    target_lon: number
    target_depth_meters: number
  }[] | null
}

const getWorkzone = (
  a: AssignmentRow
): { id: string; name: string; target_lat: number; target_lon: number; target_depth_meters: number } | null => {
  const w = a?.workzones
  if (!w) return null
  if (Array.isArray(w)) return w[0] ?? null
  return w
}

interface WorkOrderRow {
  id: string
  workzone_id: string
  status: string
  contractor_id: string
}

interface DeviceRow {
  id: string
}

interface TelemetryRow {
  id: string
  device_id: string
  work_order_id: string | null
  readings: Record<string, unknown>
  created_at: string
  decision: string | null
  compliance_reason: string | null
}

interface AuthoritativeState {
  workzone_id: string
  contractor_id: string | null
  name: string
  target_lat: number
  target_lon: number
  target_depth_meters: number
  state: {
    aggregate_state: SafetyState
    aggregate_reason: string
    freshness_state: FreshnessState
    latest_decision: string | null
    latest_scan_timestamp: string | null
    latest_h2s_ppm: string | null
    latest_o2_percent: string | null
    latest_depth_meters: string | null
    latest_battery_percent: string | null
    telemetry_age_seconds: number | null
  }
}

interface EntrantRow {
  id: string
  full_name: string
  badge_number: string | null
  role: string | null
}

interface PermitRow {
  id: string
  number: string
  status: PermitStatus
  created_at: string
  work_order_id: string | null
}

interface ActiveLockoutRow {
  id: string
  workzone_id: string
  performed_by: string
  reason: string
  created_at: string
}

interface OverrideRow {
  id: string
  workzone_id: string
  requested_by: string
  approved_by: string | null
  reason: string
  request_reason: string
  approval_reason: string | null
  status: OverrideStatus
  expires_at: string | null
  created_at: string
}

interface AuditLogEntry {
  id: string
  kind: 'permit_lifecycle' | 'manual_lockout' | 'two_person_override' | 'escalation_event'
  created_at: string
  actor_id: string
  summary: string
  detail: string
}

interface EscalationEventRow {
  id: string
  workzone_id: string
  event_type: string
  aggregate_state: string
  aggregate_reason: string
  trigger_source: string
  previous_state: string | null
  notification_channel: string | null
  notification_status: string
  notification_error: string | null
  created_at: string
}

const POLL_INTERVAL_MS = 15000

export default function FieldScanPage() {
  const { user, isLoading: authLoading, signOut, supabase } = useAuthSession()

  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(true)

  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentRow | null>(null)

  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([])
  const [workOrdersLoading, setWorkOrdersLoading] = useState(false)
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrderRow | null>(null)

  const [deviceId, setDeviceId] = useState<string | null>(null)

  const [gpsPosition, setGpsPosition] = useState<{ lat: number; lon: number } | null>(null)
  const [gpsDistance, setGpsDistance] = useState<number | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)

  const [telemetry, setTelemetry] = useState<TelemetryRow | null>(null)
  const [telemetryLoading, setTelemetryLoading] = useState(false)
  const [telemetryError, setTelemetryError] = useState<string | null>(null)

  const [authState, setAuthState] = useState<AuthoritativeState | null>(null)
  const [authStateLoading, setAuthStateLoading] = useState(false)
  const [authStateError, setAuthStateError] = useState<string | null>(null)

  const [entrants, setEntrants] = useState<EntrantRow[]>([])
  const [entrantsLoading, setEntrantsLoading] = useState(false)
  const [selectedEntrantId, setSelectedEntrantId] = useState<string | null>(null)
  const [entrantSelectionStatus, setEntrantSelectionStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [entrantSelectionError, setEntrantSelectionError] = useState<string | null>(null)

  const [permits, setPermits] = useState<PermitRow[]>([])
  const [permitsLoading, setPermitsLoading] = useState(false)
  const [lifecycleStatus, setLifecycleStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)

  const [activeLockouts, setActiveLockouts] = useState<ActiveLockoutRow[]>([])
  const [lockoutStatus, setLockoutStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [lockoutError, setLockoutError] = useState<string | null>(null)
  const [lockoutReason, setLockoutReason] = useState('')

  const [overrides, setOverrides] = useState<OverrideRow[]>([])
  const [overrideStatus, setOverrideStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [overrideReason, setOverrideReason] = useState('')

  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])
  const [auditLogLoading, setAuditLogLoading] = useState(false)

  const [escalationEvents, setEscalationEvents] = useState<EscalationEventRow[]>([])
  const [escalationLoading, setEscalationLoading] = useState(false)

  const [permitStatus, setPermitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [permitError, setPermitError] = useState<string | null>(null)
  const [permitData, setPermitData] = useState<{ id: string; number: string } | null>(null)

  // Load assignments
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const load = async () => {
      setAssignmentsLoading(true)
      const { data } = await supabase
        .from('workzone_assignments')
        .select('id, workzone_id, contractor_id, workzones(id, name, target_lat, target_lon, target_depth_meters)')
        .eq('assigned_staff_id', user.id)

      if (!cancelled) {
        setAssignments(data ?? [])
        setAssignmentsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [supabase, user])

  // Load work orders when assignment changes
  useEffect(() => {
    if (!selectedAssignment) {
      setWorkOrders([])
      setSelectedWorkOrder(null)
      setDeviceId(null)
      setTelemetry(null)
      setAuthState(null)
      setGpsDistance(null)
      setGpsPosition(null)
      setEntrants([])
      setSelectedEntrantId(null)
      setPermits([])
      setActiveLockouts([])
      setOverrides([])
      setAuditLog([])
      return
    }

    let cancelled = false
    const load = async () => {
      setWorkOrdersLoading(true)
      const { data } = await supabase
        .from('work_orders')
        .select('id, workzone_id, status, contractor_id')
        .eq('workzone_id', selectedAssignment.workzone_id)

      if (!cancelled) {
        setWorkOrders(data ?? [])
        setSelectedWorkOrder(null)
        setDeviceId(null)
        setTelemetry(null)
        setAuthState(null)
        setGpsDistance(null)
        setEntrants([])
        setSelectedEntrantId(null)
        setPermits([])
        setActiveLockouts([])
        setOverrides([])
        setAuditLog([])
        setWorkOrdersLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [supabase, selectedAssignment])

  // Load device for selected workzone
  useEffect(() => {
    if (!selectedAssignment) return
    let cancelled = false
    const load = async () => {
      const { data } = await supabase
        .from('devices')
        .select('id')
        .eq('workzone_id', selectedAssignment.workzone_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (!cancelled) {
        setDeviceId(data?.id ?? null)
      }
    }
    load()
    return () => { cancelled = true }
  }, [supabase, selectedAssignment])

  // Poll telemetry (raw readings only; no safety calculation)
  useEffect(() => {
    if (!deviceId || !selectedAssignment || !selectedWorkOrder) return

    let cancelled = false
    setTelemetryLoading(true)
    setTelemetryError(null)

    const poll = async () => {
      try {
        const res = await fetch(`/api/telemetry/latest?device_id=${encodeURIComponent(deviceId)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        })

        if (!res.ok) {
          const text = await res.text()
          if (!cancelled) {
            setTelemetryError(`Telemetry fetch failed: ${res.status} ${text}`)
            setTelemetryLoading(false)
          }
          return
        }

        const json: TelemetryRow = await res.json()
        if (!cancelled) {
          setTelemetry(json)
          setTelemetryLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setTelemetryError(err instanceof Error ? err.message : 'Unknown telemetry error')
          setTelemetryLoading(false)
        }
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [deviceId, selectedAssignment, selectedWorkOrder])

  // Fetch authoritative workzone state from backend
  useEffect(() => {
    if (!selectedAssignment || !selectedWorkOrder) {
      setAuthState(null)
      setAuthStateError(null)
      return
    }

    let cancelled = false
    const fetchState = async () => {
      setAuthStateLoading(true)
      setAuthStateError(null)
      try {
        const res = await fetch('/api/field/workzone-states', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        })

        if (!res.ok) {
          if (!cancelled) {
            setAuthStateError(`HTTP ${res.status}`)
            setAuthState(null)
          }
          return
        }

        const json = (await res.json()) as { workzones?: AuthoritativeState[] }
        const match = (json.workzones ?? []).find(w => w.workzone_id === selectedAssignment.workzone_id)
        if (!cancelled) {
          setAuthState(match ?? null)
        }
      } catch (err) {
        if (!cancelled) {
          setAuthStateError((err as Error).message)
          setAuthState(null)
        }
      } finally {
        if (!cancelled) {
          setAuthStateLoading(false)
        }
      }
    }

    fetchState()
    const interval = setInterval(fetchState, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [selectedAssignment, selectedWorkOrder])

  // Load pre-assigned entrants for selected work order (READ ONLY — supervisors cannot assign)
  useEffect(() => {
    if (!selectedWorkOrder) {
      setEntrants([])
      setSelectedEntrantId(null)
      setEntrantSelectionStatus('idle')
      setEntrantSelectionError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      setEntrantsLoading(true)
      const { data, error } = await supabase
        .from('work_order_entrants')
        .select('entrants(id, full_name, badge_number, role)')
        .eq('work_order_id', selectedWorkOrder.id)

      if (cancelled) return

      if (error) {
        setEntrants([])
        setEntrantsLoading(false)
        return
      }

      const flat: EntrantRow[] = ((data ?? []) as { entrants: EntrantRow | EntrantRow[] | null }[])
        .map((row) => {
          const e = row.entrants
          if (!e) return null
          return Array.isArray(e) ? (e[0] ?? null) : e
        })
        .filter((e): e is EntrantRow => !!e)

      setEntrants(flat)
      setSelectedEntrantId(null)
      setEntrantSelectionStatus('idle')
      setEntrantSelectionError(null)
      setEntrantsLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [supabase, selectedWorkOrder])

  // Load permits for selected work order (used for lifecycle controls)
  useEffect(() => {
    if (!selectedWorkOrder) {
      setPermits([])
      setLifecycleStatus('idle')
      setLifecycleError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      setPermitsLoading(true)
      const { data, error } = await supabase
        .from('permits')
        .select('id, number, status, created_at, work_order_id')
        .eq('work_order_id', selectedWorkOrder.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (!cancelled) {
        setPermits(((data ?? []) as PermitRow[]).filter((p): p is PermitRow =>
          p.status === 'ISSUED' || p.status === 'ACTIVE' || p.status === 'CLOSED'
        ))
        setPermitsLoading(false)
        if (error) {
          setLifecycleStatus('error')
          setLifecycleError(error.message)
        }
      }
    }
    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [supabase, selectedWorkOrder])

  // Load active manual lockouts for selected workzone
  useEffect(() => {
    if (!selectedAssignment) {
      setActiveLockouts([])
      setLockoutStatus('idle')
      setLockoutError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase
        .from('manual_lockouts')
        .select('id, workzone_id, performed_by, reason, created_at')
        .eq('workzone_id', selectedAssignment.workzone_id)
        .eq('active', true)
        .order('created_at', { ascending: false })

      if (!cancelled) {
        setActiveLockouts(((data ?? []) as ActiveLockoutRow[]))
        if (error) {
          setLockoutStatus('error')
          setLockoutError(error.message)
        }
      }
    }
    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [supabase, selectedAssignment])

  // Load two-person overrides for selected workzone
  useEffect(() => {
    if (!selectedAssignment) {
      setOverrides([])
      setOverrideStatus('idle')
      setOverrideError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase
        .from('two_person_overrides')
        .select('id, workzone_id, requested_by, approved_by, reason, request_reason, approval_reason, status, expires_at, created_at')
        .eq('workzone_id', selectedAssignment.workzone_id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (!cancelled) {
        setOverrides(((data ?? []) as OverrideRow[]))
        if (error) {
          setOverrideStatus('error')
          setOverrideError(error.message)
        }
      }
    }
    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [supabase, selectedAssignment])

  // Load escalation events for selected workzone
  useEffect(() => {
    if (!selectedAssignment) {
      setEscalationEvents([])
      return
    }

    let cancelled = false
    const load = async () => {
      setEscalationLoading(true)
      const { data, error } = await supabase
        .from('escalation_events')
        .select('id, workzone_id, event_type, aggregate_state, aggregate_reason, trigger_source, previous_state, notification_channel, notification_status, notification_error, created_at')
        .eq('workzone_id', selectedAssignment.workzone_id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (!cancelled) {
        setEscalationEvents(((data ?? []) as EscalationEventRow[]))
        setEscalationLoading(false)
      }
    }
    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [supabase, selectedAssignment])

  // Load audit log for selected workzone (lifecycle + lockouts + overrides + escalations)
  useEffect(() => {
    if (!selectedAssignment) {
      setAuditLog([])
      return
    }

    let cancelled = false
    const load = async () => {
      setAuditLogLoading(true)

      const [permitsRes, lockoutsRes, overridesRes, escalationsRes] = await Promise.all([
        supabase
          .from('permit_lifecycle_log')
          .select('id, permit_id, previous_status, new_status, performed_by, reason, created_at')
          .limit(20),
        supabase
          .from('manual_lockouts')
          .select('id, performed_by, reason, active, created_at')
          .eq('workzone_id', selectedAssignment.workzone_id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('two_person_overrides')
          .select('id, requested_by, approved_by, status, reason, approval_reason, created_at')
          .eq('workzone_id', selectedAssignment.workzone_id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('escalation_events')
          .select('id, event_type, aggregate_state, aggregate_reason, trigger_source, notification_status, notification_error, notification_channel, created_at')
          .eq('workzone_id', selectedAssignment.workzone_id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      if (cancelled) return

      const entries: AuditLogEntry[] = []

      const permitNumberById = new Map<string, string>()
      for (const p of permits) {
        permitNumberById.set(p.id, p.number)
      }

      if (permitsRes.data) {
        for (const row of permitsRes.data as Array<{
          id: string
          permit_id: string
          previous_status: string
          new_status: string
          performed_by: string
          reason: string | null
          created_at: string
        }>) {
          const num = permitNumberById.get(row.permit_id) ?? row.permit_id.slice(0, 8)
          entries.push({
            id: row.id,
            kind: 'permit_lifecycle',
            created_at: row.created_at,
            actor_id: row.performed_by,
            summary: `${num}: ${row.previous_status} → ${row.new_status}`,
            detail: row.reason ?? '',
          })
        }
      }

      if (lockoutsRes.data) {
        for (const row of lockoutsRes.data as Array<{
          id: string
          performed_by: string
          reason: string
          active: boolean
          created_at: string
        }>) {
          entries.push({
            id: row.id,
            kind: 'manual_lockout',
            created_at: row.created_at,
            actor_id: row.performed_by,
            summary: row.active ? 'LOCKOUT APPLIED' : 'LOCKOUT RELEASED',
            detail: row.reason,
          })
        }
      }

      if (overridesRes.data) {
        for (const row of overridesRes.data as Array<{
          id: string
          requested_by: string
          approved_by: string | null
          status: string
          reason: string
          approval_reason: string | null
          created_at: string
        }>) {
          entries.push({
            id: row.id,
            kind: 'two_person_override',
            created_at: row.created_at,
            actor_id: row.approved_by ?? row.requested_by,
            summary: `OVERRIDE ${row.status.toUpperCase()}`,
            detail: row.approval_reason ?? row.reason,
          })
        }
      }

      if (escalationsRes.data) {
        for (const row of escalationsRes.data as Array<{
          id: string
          event_type: string
          aggregate_state: string
          aggregate_reason: string
          trigger_source: string
          notification_status: string
          notification_error: string | null
          notification_channel: string | null
          created_at: string
        }>) {
          entries.push({
            id: row.id,
            kind: 'escalation_event',
            created_at: row.created_at,
            actor_id: 'system',
            summary: `ESCALATION ${row.event_type} (${row.aggregate_state})`,
            detail: `channel=${row.notification_channel ?? 'n/a'} status=${row.notification_status}${row.notification_error ? ` error=${row.notification_error}` : ''} source=${row.trigger_source}`,
          })
        }
      }

      entries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      setAuditLog(entries)
      setAuditLogLoading(false)
    }

    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [supabase, selectedAssignment, permits])

  const handleCheckLocation = () => {
    if (!selectedAssignment) return

    setGpsLoading(true)
    setGpsError(null)
    setGpsPosition(null)
    setGpsDistance(null)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lon = pos.coords.longitude
        setGpsPosition({ lat, lon })

        const wz = getWorkzone(selectedAssignment)
        if (!wz) {
          setGpsError('Workzone target unavailable')
          setGpsLoading(false)
          return
        }
        const dist = calculateHaversineDistance(
          lat,
          lon,
          wz.target_lat,
          wz.target_lon
        )
        setGpsDistance(dist)
        setGpsLoading(false)
      },
      (err) => {
        setGpsError(err.message)
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  const handleIssuePermit = async () => {
    if (!user || !selectedAssignment || !selectedWorkOrder || !gpsPosition) return

    setPermitStatus('loading')
    setPermitError(null)
    setPermitData(null)

    const { data, error } = await supabase.rpc('issue_permit', {
      p_workzone_id: selectedAssignment.workzone_id,
      p_work_order_id: selectedWorkOrder.id,
      p_lat: gpsPosition.lat,
      p_lon: gpsPosition.lon,
    })

    if (error) {
      setPermitStatus('error')
      setPermitError(error.message)
    } else if (data) {
      setPermitStatus('success')
      setPermitData({ id: data.id, number: data.number })
    }
  }

  const handleSelectEntrant = async () => {
    if (!selectedEntrantId || !selectedWorkOrder) return
    setEntrantSelectionStatus('loading')
    setEntrantSelectionError(null)

    const { error } = await supabase.rpc('record_entrant_selection', {
      p_work_order_id: selectedWorkOrder.id,
      p_entrant_id: selectedEntrantId,
    })

    if (error) {
      setEntrantSelectionStatus('error')
      setEntrantSelectionError(error.message)
    } else {
      setEntrantSelectionStatus('success')
    }
  }

  const handleTransitionPermit = async (
    permitId: string,
    newStatus: PermitStatus,
    reason: string
  ) => {
    if (!selectedWorkOrder) return
    setLifecycleStatus('loading')
    setLifecycleError(null)

    const { error } = await supabase.rpc('transition_permit', {
      p_permit_id: permitId,
      p_new_status: newStatus,
      p_reason: reason,
    })

    if (error) {
      setLifecycleStatus('error')
      setLifecycleError(error.message)
    } else {
      setLifecycleStatus('success')
    }
  }

  const handleApplyLockout = async () => {
    if (!selectedAssignment) return
    if (!lockoutReason.trim()) {
      setLockoutStatus('error')
      setLockoutError('reason is required')
      return
    }
    setLockoutStatus('loading')
    setLockoutError(null)

    const { error } = await supabase.rpc('apply_manual_lockout', {
      p_workzone_id: selectedAssignment.workzone_id,
      p_reason: lockoutReason.trim(),
    })

    if (error) {
      setLockoutStatus('error')
      setLockoutError(error.message)
    } else {
      setLockoutStatus('success')
      setLockoutReason('')
    }
  }

  const handleReleaseLockout = async () => {
    if (!selectedAssignment) return
    if (!lockoutReason.trim()) {
      setLockoutStatus('error')
      setLockoutError('reason is required')
      return
    }
    setLockoutStatus('loading')
    setLockoutError(null)

    const { error } = await supabase.rpc('release_manual_lockout', {
      p_workzone_id: selectedAssignment.workzone_id,
      p_reason: lockoutReason.trim(),
    })

    if (error) {
      setLockoutStatus('error')
      setLockoutError(error.message)
    } else {
      setLockoutStatus('success')
      setLockoutReason('')
    }
  }

  const handleRequestOverride = async () => {
    if (!selectedAssignment) return
    if (!overrideReason.trim()) {
      setOverrideStatus('error')
      setOverrideError('reason is required')
      return
    }
    setOverrideStatus('loading')
    setOverrideError(null)

    const { error } = await supabase.rpc('request_two_person_override', {
      p_workzone_id: selectedAssignment.workzone_id,
      p_reason: overrideReason.trim(),
    })

    if (error) {
      setOverrideStatus('error')
      setOverrideError(error.message)
    } else {
      setOverrideStatus('success')
      setOverrideReason('')
    }
  }

  const handleApproveOverride = async (overrideId: string, reason: string) => {
    if (!reason.trim()) {
      setOverrideStatus('error')
      setOverrideError('reason is required')
      return
    }
    setOverrideStatus('loading')
    setOverrideError(null)

    const { error } = await supabase.rpc('approve_two_person_override', {
      p_override_id: overrideId,
      p_reason: reason.trim(),
    })

    if (error) {
      setOverrideStatus('error')
      setOverrideError(error.message)
    } else {
      setOverrideStatus('success')
    }
  }

  // UX-only gating; server RPC is authoritative for geofence and safety.
  // The geofence distance is NOT part of this gate — backend issue_permit is
  // authoritative for geofence and must NOT be bypassed or duplicated here.
  const canIssuePermit =
    !!user &&
    !!selectedAssignment &&
    !!selectedWorkOrder &&
    !!gpsPosition &&
    authState?.state.aggregate_state === 'SAFE' &&
    authState?.state.freshness_state === 'FRESH'

  const insideGeofence = gpsDistance !== null && gpsDistance <= 50
  const hasActiveLockout = activeLockouts.length > 0
  const hasApprovedOverride = overrides.some(
    (o) => o.status === 'approved' && o.expires_at !== null && new Date(o.expires_at).getTime() > Date.now()
  )
  const lockoutBlocksPermit = hasActiveLockout && !hasApprovedOverride

  const permitBlockReason = (() => {
    if (!selectedAssignment) return 'Select an assigned workzone.'
    if (!selectedWorkOrder) return 'Select a work order.'
    if (!gpsPosition) return 'Acquire GPS position first.'
    if (!authState) return 'Authoritative state unavailable.'
    if (authState.state.freshness_state !== 'FRESH')
      return `Telemetry not fresh: ${authState.state.freshness_state}.`
    if (authState.state.aggregate_state === 'WARMING')
      return 'State is WARMING — not permit-ready.'
    if (authState.state.aggregate_state !== 'SAFE')
      return `State is ${authState.state.aggregate_state} — ${authState.state.aggregate_reason || 'not permit-ready'}.`
    if (lockoutBlocksPermit)
      return 'Workzone under active manual lockout. An approved two-person override is required.'
    return null
  })()

  const telemetryValues = useMemo(() => {
    if (!telemetry) return null
    const readings = telemetry.readings ?? {}
    const h2s = typeof readings.h2s_ppm === 'number' ? readings.h2s_ppm : null
    const o2 = typeof readings.o2_percent === 'number' ? readings.o2_percent : null
    const depth = typeof readings.depth_meters === 'number' ? readings.depth_meters : null
    const battery = typeof readings.battery_percent === 'number' ? readings.battery_percent : null

    if (h2s === null || o2 === null || depth === null || battery === null) {
      return null
    }

    return {
      h2s,
      o2,
      depth,
      battery,
      targetDepth: (() => {
        const wz = selectedAssignment ? getWorkzone(selectedAssignment) : null
        return wz ? wz.target_depth_meters : 0
      })(),
    }
  }, [telemetry, selectedAssignment])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-lg">
          <div className="border-2 border-zinc-200 rounded-md p-6 bg-white">
            <p className="font-mono text-sm text-slate-700">Authenticating...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-lg">
          <div className="border-2 border-zinc-200 rounded-md p-6 bg-white">
            <p className="font-mono text-sm text-slate-700">Authentication required.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="border-2 border-zinc-200 rounded-md bg-slate-900 px-4 py-3 flex items-center justify-between gap-4">
          <h1 className="text-lg font-bold font-mono uppercase tracking-wider text-slate-100">
            Field Supervisor Scan
          </h1>
          {user && (
            <button
              type="button"
              onClick={signOut}
              className="border-2 border-zinc-200 rounded-md px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-slate-100 bg-slate-800 hover:bg-slate-700"
            >
              Sign Out
            </button>
          )}
        </header>

        {/* Assigned Workzones */}
        <section className="border-2 border-zinc-200 rounded-md bg-white p-4">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
            Assigned Workzone
          </label>
          {assignmentsLoading ? (
            <p className="font-mono text-sm text-slate-700">Loading assignments...</p>
          ) : assignments.length === 0 ? (
            <p className="font-mono text-sm text-slate-700">No assigned workzones.</p>
          ) : (
            <select
              value={selectedAssignment?.id ?? ''}
              onChange={(e) => {
                const found = assignments.find(a => a.id === e.target.value) ?? null
                setSelectedAssignment(found)
              }}
              className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white"
            >
              <option value="">-- select workzone --</option>
              {assignments.map(a => {
                const wz = getWorkzone(a)
                return (
                  <option key={a.id} value={a.id}>{wz ? wz.name : `Workzone ${a.workzone_id.slice(0, 8)}`}</option>
                )
              })}
            </select>
          )}
        </section>

        {/* Work Orders */}
        {selectedAssignment && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              Work Order
            </label>
            {workOrdersLoading ? (
              <p className="font-mono text-sm text-slate-700">Loading work orders...</p>
            ) : workOrders.length === 0 ? (
              <p className="font-mono text-sm text-slate-700">No work orders for this workzone.</p>
            ) : (
              <select
                value={selectedWorkOrder?.id ?? ''}
                onChange={(e) => {
                  const found = workOrders.find(w => w.id === e.target.value) ?? null
                  setSelectedWorkOrder(found)
                }}
                className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white"
              >
                <option value="">-- select work order --</option>
                {workOrders.map(w => (
                  <option key={w.id} value={w.id}>{w.id.slice(0, 8)}... ({w.status})</option>
                ))}
              </select>
            )}
          </section>
        )}

        {/* Authoritative Safety State */}
        {selectedAssignment && selectedWorkOrder && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Authoritative Safety State
            </label>

            {authStateLoading && <p className="font-mono text-sm text-slate-700">Loading authoritative state...</p>}
            {authStateError && <p className="font-mono text-sm text-red-700">State error: {authStateError}</p>}
            {!authStateLoading && !authState && !authStateError && (
              <p className="font-mono text-sm text-slate-700">No authoritative state available.</p>
            )}
            {authState && (
              <>
                <StatusBanner
                  state={authState.state.aggregate_state}
                  reason={authState.state.aggregate_reason}
                />
                <div className="font-mono text-[10px] text-slate-600 space-y-1">
                  <p>Freshness: <span className="font-bold uppercase">{authState.state.freshness_state}</span></p>
                  {authState.state.latest_scan_timestamp && (
                    <p>Updated: {new Date(authState.state.latest_scan_timestamp).toLocaleString()}</p>
                  )}
                  {authState.state.telemetry_age_seconds !== null && (
                    <p>Age: {authState.state.telemetry_age_seconds}s</p>
                  )}
                </div>
                {(authState.state.aggregate_state === 'LOCKOUT' || authState.state.aggregate_state === 'WARNING') && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {authState.state.latest_h2s_ppm !== null && (
                      <div className="border-2 border-zinc-200 rounded-md p-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700">H₂S</p>
                        <p className={`text-sm font-mono font-bold ${Number(authState.state.latest_h2s_ppm) >= 15 ? 'text-red-700' : Number(authState.state.latest_h2s_ppm) >= 10 ? 'text-amber-700' : 'text-slate-900'}`}>{authState.state.latest_h2s_ppm} ppm</p>
                      </div>
                    )}
                    {authState.state.latest_o2_percent !== null && (
                      <div className="border-2 border-zinc-200 rounded-md p-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700">O₂</p>
                        <p className={`text-sm font-mono font-bold ${Number(authState.state.latest_o2_percent) <= 18.5 || Number(authState.state.latest_o2_percent) >= 24 ? 'text-red-700' : Number(authState.state.latest_o2_percent) <= 19.5 || Number(authState.state.latest_o2_percent) >= 23.5 ? 'text-amber-700' : 'text-slate-900'}`}>{authState.state.latest_o2_percent}%</p>
                      </div>
                    )}
                    {authState.state.latest_depth_meters !== null && (
                      <div className="border-2 border-zinc-200 rounded-md p-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700">Depth</p>
                        <p className="text-sm font-mono font-bold text-slate-900">{authState.state.latest_depth_meters} m</p>
                      </div>
                    )}
                    {authState.state.latest_battery_percent !== null && (
                      <div className="border-2 border-zinc-200 rounded-md p-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700">Battery</p>
                        <p className={`text-sm font-mono font-bold ${Number(authState.state.latest_battery_percent) < 10 ? 'text-red-700' : Number(authState.state.latest_battery_percent) < 20 ? 'text-amber-700' : 'text-slate-900'}`}>{authState.state.latest_battery_percent}%</p>
                      </div>
                    )}
                  </div>
                )}
                {authState.state.aggregate_state === 'UNKNOWN' && (
                  <p className="font-mono text-[10px] text-slate-600 mt-1">
                    {authState.state.freshness_state === 'MISSING' && 'No telemetry available for this workzone.'}
                    {authState.state.freshness_state === 'STALE' && 'Telemetry is stale. Last reading exceeds freshness window.'}
                    {authState.state.freshness_state === 'AMBIGUOUS' && 'Multiple active work orders have telemetry. Authority is ambiguous.'}
                    {authState.state.freshness_state === 'FRESH' && 'Telemetry present but decision is unknown.'}
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {/* GPS / Geofence (UX only; backend is authoritative for permit issuance) */}
        {selectedAssignment && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
              GPS Location (UX Only)
            </label>
            <button
              type="button"
              onClick={handleCheckLocation}
              disabled={gpsLoading}
              className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm font-bold uppercase tracking-wider text-slate-900 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {gpsLoading ? 'Acquiring...' : 'Check Location'}
            </button>

            {gpsError && (
              <p className="mt-2 font-mono text-xs text-red-700">GPS Error: {gpsError}</p>
            )}

            {gpsDistance !== null && (
              <div className="mt-3 space-y-1">
                <p className="font-mono text-sm text-slate-700">
                  Distance: <span className="font-bold">{gpsDistance.toFixed(1)}</span> m
                </p>
                <p className="font-mono text-sm">
                  Status:{' '}
                  <span className={`font-bold ${insideGeofence ? 'text-emerald-700' : 'text-red-700'}`}>
                    {insideGeofence ? 'INSIDE GEOFENCE' : 'OUTSIDE GEOFENCE'}
                  </span>
                </p>
              </div>
            )}
          </section>
        )}

        {/* Telemetry & Compliance */}
        {selectedAssignment && selectedWorkOrder && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4 space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Live Telemetry (Raw Readings)
            </label>

            {telemetryLoading && <p className="font-mono text-sm text-slate-700">Loading telemetry...</p>}
            {telemetryError && <p className="font-mono text-sm text-red-700">{telemetryError}</p>}
            {!telemetryLoading && !telemetry && !telemetryError && (
              <p className="font-mono text-sm text-slate-700">No telemetry available.</p>
            )}

            {telemetry && telemetryValues && (
              <>
                <TelemetryGauges
                  h2s={telemetryValues.h2s}
                  o2={telemetryValues.o2}
                  depth={telemetryValues.depth}
                  battery={telemetryValues.battery}
                  targetDepth={telemetryValues.targetDepth}
                />
                <p className="font-mono text-[10px] text-slate-600">
                  Updated: {telemetry.created_at ? new Date(telemetry.created_at).toLocaleString() : '--'}
                </p>
              </>
            )}
          </section>
        )}

        {/* Permit */}
        {selectedAssignment && selectedWorkOrder && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4 space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Safety Permit
            </label>

            {!canIssuePermit && authState && (
              <div className="border-2 border-red-600 rounded-md bg-red-50 p-3">
                <p className="font-mono text-sm font-bold text-red-700">PERMIT BLOCKED</p>
                <p className="font-mono text-xs text-red-700">{permitBlockReason}</p>
              </div>
            )}

            <button
              type="button"
              onClick={handleIssuePermit}
              disabled={!canIssuePermit || permitStatus === 'loading'}
              className="w-full border-2 border-zinc-200 rounded-md px-3 py-3 font-mono text-sm font-bold uppercase tracking-wider text-slate-900 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {permitStatus === 'loading' ? 'Issuing...' : 'Generate Safety Permit'}
            </button>

            {!canIssuePermit && (
              <p className="font-mono text-[10px] text-slate-600">
                Requires: workzone selected, work order selected, GPS coordinates provided, authoritative state SAFE and FRESH.
              </p>
            )}

            {permitStatus === 'success' && permitData && (
              <div className="border-2 border-emerald-600 rounded-md bg-emerald-50 p-3">
                <p className="font-mono text-sm font-bold text-emerald-700">PERMIT ISSUED</p>
                <p className="font-mono text-xs text-emerald-700">ID: {permitData.id}</p>
                <p className="font-mono text-xs text-emerald-700">Number: {permitData.number}</p>
              </div>
            )}

            {permitStatus === 'error' && (
              <div className="border-2 border-red-600 rounded-md bg-red-50 p-3">
                <p className="font-mono text-sm font-bold text-red-700">ISSUE FAILED</p>
                <p className="font-mono text-xs text-red-700">{permitError}</p>
              </div>
            )}
          </section>
        )}

        {/* Entrants — pre-assigned only */}
        {selectedAssignment && selectedWorkOrder && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Pre-Assigned Entrants (Read-Only)
            </label>
            {entrantsLoading ? (
              <p className="font-mono text-sm text-slate-700">Loading entrants...</p>
            ) : entrants.length === 0 ? (
              <p className="font-mono text-sm text-slate-700">
                No entrants pre-assigned to this work order. Field supervisors cannot assign workers.
              </p>
            ) : (
              <>
                <select
                  value={selectedEntrantId ?? ''}
                  onChange={(e) => {
                    setSelectedEntrantId(e.target.value || null)
                    setEntrantSelectionStatus('idle')
                    setEntrantSelectionError(null)
                  }}
                  className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white"
                >
                  <option value="">-- select entrant --</option>
                  {entrants.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}{e.badge_number ? ` (${e.badge_number})` : ''}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleSelectEntrant}
                  disabled={!selectedEntrantId || entrantSelectionStatus === 'loading'}
                  className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm font-bold uppercase tracking-wider text-slate-900 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {entrantSelectionStatus === 'loading' ? 'Recording...' : 'Record Entrant Selection'}
                </button>

                {entrantSelectionStatus === 'success' && (
                  <p className="font-mono text-xs text-emerald-700">ENTRANT SELECTION RECORDED</p>
                )}
                {entrantSelectionStatus === 'error' && (
                  <p className="font-mono text-xs text-red-700">SELECTION FAILED: {entrantSelectionError}</p>
                )}
              </>
            )}
          </section>
        )}

        {/* Permit Lifecycle */}
        {selectedAssignment && selectedWorkOrder && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Permit Lifecycle
            </label>
            {permitsLoading ? (
              <p className="font-mono text-sm text-slate-700">Loading permits...</p>
            ) : permits.length === 0 ? (
              <p className="font-mono text-sm text-slate-700">No permits for this work order.</p>
            ) : (
              <table className="w-full border-2 border-zinc-200 rounded-md font-mono text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="text-left p-2">Number</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Created</th>
                    <th className="text-left p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {permits.map((p) => {
                    const nextStatus: PermitStatus | null =
                      p.status === 'ISSUED' ? 'ACTIVE' : p.status === 'ACTIVE' ? 'CLOSED' : null
                    return (
                      <tr key={p.id} className="border-t border-zinc-200">
                        <td className="p-2">{p.number}</td>
                        <td className="p-2 font-bold uppercase tracking-wider">{p.status}</td>
                        <td className="p-2 text-slate-600">{new Date(p.created_at).toLocaleString()}</td>
                        <td className="p-2">
                          {nextStatus ? (
                            <button
                              type="button"
                              disabled={lifecycleStatus === 'loading'}
                              onClick={() => {
                                const reason = window.prompt(`Reason to transition to ${nextStatus}?`)
                                if (reason && reason.trim()) {
                                  handleTransitionPermit(p.id, nextStatus, reason.trim())
                                }
                              }}
                              className="border-2 border-zinc-200 rounded-md px-2 py-1 font-bold uppercase tracking-wider hover:bg-slate-50 disabled:opacity-50"
                            >
                              → {nextStatus}
                            </button>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {lifecycleStatus === 'error' && (
              <p className="font-mono text-xs text-red-700">LIFECYCLE ERROR: {lifecycleError}</p>
            )}
          </section>
        )}

        {/* Manual Lockout */}
        {selectedAssignment && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Manual Lockout
            </label>

            {hasActiveLockout ? (
              <div className="border-2 border-red-600 rounded-md bg-red-50 p-3">
                <p className="font-mono text-sm font-bold uppercase tracking-wider text-red-700">
                  ACTIVE LOCKOUT
                </p>
                {activeLockouts.map((l) => (
                  <p key={l.id} className="font-mono text-xs text-red-700">
                    {new Date(l.created_at).toLocaleString()} — {l.reason}
                  </p>
                ))}
                {hasApprovedOverride && (
                  <p className="font-mono text-xs text-emerald-700 mt-1">
                    APPROVED TWO-PERSON OVERRIDE IN EFFECT
                  </p>
                )}
              </div>
            ) : (
              <p className="font-mono text-sm text-slate-700">No active manual lockout.</p>
            )}

            <input
              type="text"
              placeholder="Lockout reason"
              value={lockoutReason}
              onChange={(e) => setLockoutReason(e.target.value)}
              className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleApplyLockout}
                disabled={lockoutStatus === 'loading' || !lockoutReason.trim()}
                className="border-2 border-red-600 rounded-md px-3 py-2 font-mono text-sm font-bold uppercase tracking-wider text-red-700 bg-white hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {lockoutStatus === 'loading' ? 'Working...' : 'Apply Lockout'}
              </button>
              <button
                type="button"
                onClick={handleReleaseLockout}
                disabled={lockoutStatus === 'loading' || !hasActiveLockout || !lockoutReason.trim()}
                className="border-2 border-emerald-600 rounded-md px-3 py-2 font-mono text-sm font-bold uppercase tracking-wider text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Release Lockout
              </button>
            </div>

            {lockoutStatus === 'success' && (
              <p className="font-mono text-xs text-emerald-700">LOCKOUT ACTION COMPLETED</p>
            )}
            {lockoutStatus === 'error' && (
              <p className="font-mono text-xs text-red-700">LOCKOUT ERROR: {lockoutError}</p>
            )}
          </section>
        )}

        {/* Two-Person Override */}
        {selectedAssignment && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Two-Person Override
            </label>

            {overrides.length === 0 ? (
              <p className="font-mono text-sm text-slate-700">No override requests.</p>
            ) : (
              <div className="space-y-2">
                {overrides.map((o) => {
                  const canApprove =
                    o.status === 'pending' &&
                    user !== null &&
                    o.requested_by !== user.id
                  const isExpired = o.status === 'approved' && o.expires_at !== null && new Date(o.expires_at).getTime() <= Date.now()
                  return (
                    <div
                      key={o.id}
                      className={`border-2 rounded-md p-3 ${
                        o.status === 'approved' && !isExpired
                          ? 'border-emerald-600 bg-emerald-50'
                          : o.status === 'pending'
                            ? 'border-amber-500 bg-amber-50'
                            : o.status === 'rejected' || o.status === 'expired'
                              ? 'border-red-600 bg-red-50'
                              : 'border-zinc-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          Status
                        </span>
                        <span className={`text-sm font-mono font-bold uppercase tracking-wider ${
                          o.status === 'approved' && !isExpired
                            ? 'text-emerald-700'
                            : o.status === 'pending'
                              ? 'text-amber-700'
                              : 'text-red-700'
                        }`}>
                          {isExpired ? 'EXPIRED' : o.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1 text-xs font-mono text-slate-700">
                        <p>Requested by: {o.requested_by?.slice(0, 8) ?? '—'}…</p>
                        {o.approved_by && <p>Approved by: {o.approved_by.slice(0, 8)}…</p>}
                        <p>Reason: {o.reason || o.request_reason || '—'}</p>
                        {o.approval_reason && <p>Approval reason: {o.approval_reason}</p>}
                        {o.expires_at && <p>Expires: {new Date(o.expires_at).toLocaleString()}</p>}
                      </div>
                      {canApprove && (
                        <div className="mt-3">
                          <button
                            type="button"
                            disabled={overrideStatus === 'loading'}
                            onClick={() => {
                              const reason = window.prompt('Approval reason?')
                              if (reason && reason.trim()) {
                                handleApproveOverride(o.id, reason.trim())
                              }
                            }}
                            className="border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm font-bold uppercase tracking-wider text-slate-900 bg-white hover:bg-slate-50 disabled:opacity-50"
                          >
                            Approve Override
                          </button>
                        </div>
                      )}
                      {o.status === 'pending' && o.requested_by === user?.id && (
                        <p className="mt-2 text-xs font-mono text-amber-700">Awaiting second approver</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <input
              type="text"
              placeholder="Override reason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white"
            />

            <button
              type="button"
              onClick={handleRequestOverride}
              disabled={overrideStatus === 'loading' || !overrideReason.trim()}
              className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm font-bold uppercase tracking-wider text-slate-900 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {overrideStatus === 'loading' ? 'Requesting...' : 'Request Two-Person Override'}
            </button>

            {overrideStatus === 'success' && (
              <p className="font-mono text-xs text-emerald-700">OVERRIDE REQUEST SUBMITTED</p>
            )}
            {overrideStatus === 'error' && (
              <p className="font-mono text-xs text-red-700">OVERRIDE ERROR: {overrideError}</p>
            )}
          </section>
        )}

        {/* Escalation Events */}
        {selectedAssignment && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Escalation Events
            </label>

            {escalationLoading && escalationEvents.length === 0 ? (
              <p className="font-mono text-sm text-slate-700">Loading escalation events...</p>
            ) : escalationEvents.length === 0 ? (
              <p className="font-mono text-sm text-slate-700">No escalation events.</p>
            ) : (
              <div className="space-y-2">
                {escalationEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className={`border-2 rounded-md p-3 ${
                      ev.aggregate_state === 'LOCKOUT'
                        ? 'border-red-600 bg-red-50'
                        : 'border-zinc-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        {ev.event_type}
                      </span>
                      <span className={`text-xs font-mono font-bold uppercase tracking-wider ${
                        ev.notification_status === 'delivered' ? 'text-emerald-700' :
                        ev.notification_status === 'failed' ? 'text-red-700' :
                        'text-amber-700'
                      }`}>
                        {ev.notification_status.toUpperCase()}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1 text-xs font-mono text-slate-700">
                      <p>State: <span className="font-bold uppercase">{ev.aggregate_state}</span></p>
                      <p>Reason: {ev.aggregate_reason.replace(/_/g, ' ')}</p>
                      <p>Trigger: {ev.trigger_source}</p>
                      {ev.notification_channel && (
                        <p>Channel: {ev.notification_channel}</p>
                      )}
                      {ev.notification_error && (
                        <p className="text-red-700">Error: {ev.notification_error}</p>
                      )}
                      <p className="text-slate-600">{new Date(ev.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Audit Log */}
        {selectedAssignment && (
          <section className="border-2 border-zinc-200 rounded-md bg-white p-4 space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Audit Log
            </label>
            {auditLogLoading && auditLog.length === 0 ? (
              <p className="font-mono text-sm text-slate-700">Loading audit log...</p>
            ) : auditLog.length === 0 ? (
              <p className="font-mono text-sm text-slate-700">No audit entries.</p>
            ) : (
              <table className="w-full border-2 border-zinc-200 rounded-md font-mono text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Kind</th>
                    <th className="text-left p-2">Action</th>
                    <th className="text-left p-2">Actor</th>
                    <th className="text-left p-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.slice(0, 20).map((e) => (
                    <tr key={`${e.kind}-${e.id}`} className="border-t border-zinc-200">
                      <td className="p-2 text-slate-600">{new Date(e.created_at).toLocaleString()}</td>
                      <td className={`p-2 uppercase tracking-wider ${
                        e.kind === 'escalation_event' ? 'text-red-700' :
                        e.kind === 'two_person_override' ? 'text-amber-700' :
                        e.kind === 'manual_lockout' ? 'text-red-700' :
                        'text-slate-700'
                      }`}>{e.kind.replace(/_/g, ' ')}</td>
                      <td className="p-2 font-bold">{e.summary}</td>
                      <td className="p-2 text-slate-600">{e.actor_id.slice(0, 8)}…</td>
                      <td className="p-2">{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

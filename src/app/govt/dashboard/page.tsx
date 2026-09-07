'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useAuthSession } from '@/lib/auth/useAuthSession'
import { Panel } from '@/components/govt/Panel'
import { StatusBadge } from '@/components/govt/StatusBadge'
import { MetricTile } from '@/components/govt/MetricTile'
import { DataState } from '@/components/govt/DataState'
import { OpsButton } from '@/components/govt/OpsButton'
import { ScopeCallouts } from '@/components/govt/ScopeCallouts'
import { WorkzoneMapClient } from '@/components/govt/WorkzoneMapClient'
import { MapLegend } from '@/components/govt/MapLegend'
import { WorkzoneDetailPanel } from '@/components/govt/WorkzoneDetailPanel'
import type { WorkzoneState as AuthoritativeWorkzoneState } from '@/components/govt/WorkzoneMap'
import { WorkzoneTable } from '@/components/govt/WorkzoneTable'
import { ContractorPanel } from '@/components/govt/ContractorPanel'
import { ReallocationPanel } from '@/components/govt/ReallocationPanel'
import { CreateWorkzonePanel } from '@/components/govt/CreateWorkzonePanel'
import { PermitsPanel, PermitRowData } from '@/components/govt/PermitsPanel'
import {
  AuditHistoryPanel,
  ReassignmentLogRow,
  OverrideLogRow,
} from '@/components/govt/AuditHistoryPanel'
import {
  TelemetryIntegrityPanel,
  IntegrityRow,
  ChainVerificationResult,
} from '@/components/govt/TelemetryIntegrityPanel'
import { WorkzoneRowData, ContractorRowData, ContractorAllocation } from '@/components/govt/types'

interface RawContractor {
  id: string
  name: string
  created_at: string
}

interface RawWorkzone {
  id: string
  name: string
  target_lat: number
  target_lon: number
  target_depth_meters: number
  contractor_id: string | null
  contractors: { id: string; name: string }[] | { id: string; name: string } | null
}

interface RawPermit {
  id: string
  number: string
  status: string
  work_order_id: string | null
  field_supervisor_id: string | null
  created_at: string
  contractor_id: string | null
  workzones: { id: string; name: string }[] | { id: string; name: string } | null
}

interface RawReassignment {
  id: string
  workzone_id: string
  previous_contractor_id: string
  new_contractor_id: string
  performed_by: string
  reason: string
  created_at: string
  workzones: { id: string; name: string }[] | { id: string; name: string } | null
}

interface RawOverride {
  id: string
  performed_by: string
  scan_log_id: string | null
  reason: string | null
  created_at: string
}

interface RawDevice {
  id: string
  serial_number: string
  last_heartbeat_at: string | null
}

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export default function GovtDashboardPage() {
  const { user, isLoading: authLoading, error: authError, signOut, supabase } = useAuthSession()
  const [roleError, setRoleError] = useState<string | null>(null)

  const [contractors, setContractors] = useState<ContractorRowData[]>([])
  const [contractorsLoading, setContractorsLoading] = useState(true)
  const [contractorsError, setContractorsError] = useState<string | null>(null)

  const [workzones, setWorkzones] = useState<WorkzoneRowData[]>([])
  const [workzonesLoading, setWorkzonesLoading] = useState(true)
  const [workzonesError, setWorkzonesError] = useState<string | null>(null)

  const [permits, setPermits] = useState<PermitRowData[]>([])
  const [permitsLoading, setPermitsLoading] = useState(true)
  const [permitsError, setPermitsError] = useState<string | null>(null)

  const [reassignments, setReassignments] = useState<ReassignmentLogRow[]>([])
  const [reassignmentsLoading, setReassignmentsLoading] = useState(true)
  const [reassignmentsError, setReassignmentsError] = useState<string | null>(null)

  const [overrides, setOverrides] = useState<OverrideLogRow[]>([])
  const [overridesLoading, setOverridesLoading] = useState(true)
  const [overridesError, setOverridesError] = useState<string | null>(null)

  const [devices, setDevices] = useState<IntegrityRow[]>([])
  const [devicesLoading, setDevicesLoading] = useState(true)
  const [devicesError, setDevicesError] = useState<string | null>(null)

  const [reallocSubmitting, setReallocSubmitting] = useState(false)
  const [reallocSuccess, setReallocSuccess] = useState<string | null>(null)
  const [reallocError, setReallocError] = useState<string | null>(null)
  const [prefillWorkzoneId, setPrefillWorkzoneId] = useState<string | null>(null)

  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createSuccess, setCreateSuccess] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  const [refreshKey, setRefreshKey] = useState(0)

  const [authStates, setAuthStates] = useState<AuthoritativeWorkzoneState[]>([])
  const [authStatesLoading, setAuthStatesLoading] = useState(false)
  const [authStatesError, setAuthStatesError] = useState<string | null>(null)
  const [selectedAuthStateId, setSelectedAuthStateId] = useState<string | null>(null)

  const [chainVerification, setChainVerification] = useState<ChainVerificationResult | null>(null)
  const [chainLoading, setChainLoading] = useState(false)
  const [chainError, setChainError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const loadRole = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      if (!cancelled && data) {
        if (data.role !== 'govt_auditor') {
          setRoleError('Unauthorized: govt_auditor role required.')
        }
      }
    }
    loadRole()
    return () => {
      cancelled = true
    }
  }, [supabase, user])

  useEffect(() => {
    if (!user || roleError) return
    let cancelled = false
    const loadContractors = async () => {
      setContractorsLoading(true)
      setContractorsError(null)
      const { data, error } = await supabase
        .from('contractors')
        .select('id, name, created_at')
        .order('name')
        .limit(500)
      if (cancelled) return
      if (error) {
        setContractorsError(error.message)
        setContractors([])
      } else {
        setContractors((data ?? []) as ContractorRowData[])
      }
      setContractorsLoading(false)
    }
    loadContractors()
    return () => {
      cancelled = true
    }
  }, [supabase, user, roleError, refreshKey])

  useEffect(() => {
    if (!user || roleError) return
    let cancelled = false
    const loadWorkzones = async () => {
      setWorkzonesLoading(true)
      setWorkzonesError(null)
      const { data, error } = await supabase
        .from('workzones')
        .select(`
          id,
          name,
          target_lat,
          target_lon,
          target_depth_meters,
          contractor_id,
          contractors (
            id,
            name
          )
        `)
        .order('name')
        .limit(500)
      if (cancelled) return
      if (error) {
        setWorkzonesError(error.message)
        setWorkzones([])
      } else {
        const rows = (data ?? []) as RawWorkzone[]
        const mapped: WorkzoneRowData[] = rows.map((w) => {
          const c = asArray(w.contractors)[0]
          return {
            id: w.id,
            name: w.name,
            target_lat: w.target_lat,
            target_lon: w.target_lon,
            target_depth_meters: w.target_depth_meters,
            contractor_id: w.contractor_id ?? c?.id ?? null,
            contractor_name: c?.name ?? null,
          }
        })
        setWorkzones(mapped)
      }
      setWorkzonesLoading(false)
    }
    loadWorkzones()
    return () => {
      cancelled = true
    }
  }, [supabase, user, roleError, refreshKey])

  useEffect(() => {
    if (!user || roleError) return
    let cancelled = false
    const loadPermits = async () => {
      setPermitsLoading(true)
      setPermitsError(null)
      const { data, error } = await supabase
        .from('permits')
        .select(`
          id,
          number,
          status,
          work_order_id,
          field_supervisor_id,
          created_at,
          contractor_id,
          workzones (
            id,
            name
          )
        `)
        .order('created_at', { ascending: false })
        .limit(100)
      if (cancelled) return
      if (error) {
        setPermitsError(error.message)
        setPermits([])
      } else {
        const contractorMap = new Map(contractors.map((c) => [c.id, c.name]))
        const rows = (data ?? []) as RawPermit[]
        const mapped: PermitRowData[] = rows.map((p) => {
          const wz = asArray(p.workzones)[0]
          return {
            id: p.id,
            number: p.number,
            status: p.status,
            work_order_id: p.work_order_id,
            field_supervisor_id: p.field_supervisor_id,
            created_at: p.created_at,
            workzone_name: wz?.name ?? null,
            contractor_name: p.contractor_id
              ? contractorMap.get(p.contractor_id) ?? null
              : null,
          }
        })
        setPermits(mapped)
      }
      setPermitsLoading(false)
    }
    loadPermits()
    return () => {
      cancelled = true
    }
  }, [supabase, user, roleError, contractors, refreshKey])

  useEffect(() => {
    if (!user || roleError) return
    let cancelled = false
    const loadReassignments = async () => {
      setReassignmentsLoading(true)
      setReassignmentsError(null)
      const { data, error } = await supabase
        .from('contractor_reassignment_log')
        .select(`
          id,
          workzone_id,
          previous_contractor_id,
          new_contractor_id,
          performed_by,
          reason,
          created_at,
          workzones (
            id,
            name
          )
        `)
        .order('created_at', { ascending: false })
        .limit(100)
      if (cancelled) return
      if (error) {
        setReassignmentsError(error.message)
        setReassignments([])
      } else {
        const contractorMap = new Map(contractors.map((c) => [c.id, c.name]))
        const rows = (data ?? []) as RawReassignment[]
        const mapped: ReassignmentLogRow[] = rows.map((r) => {
          const wz = asArray(r.workzones)[0]
          return {
            id: r.id,
            workzone_id: r.workzone_id,
            workzone_name: wz?.name ?? null,
            previous_contractor_name:
              contractorMap.get(r.previous_contractor_id) ?? null,
            new_contractor_name:
              contractorMap.get(r.new_contractor_id) ?? null,
            performed_by: r.performed_by,
            reason: r.reason,
            created_at: r.created_at,
          }
        })
        setReassignments(mapped)
      }
      setReassignmentsLoading(false)
    }
    loadReassignments()
    return () => {
      cancelled = true
    }
  }, [supabase, user, roleError, contractors, refreshKey])

  useEffect(() => {
    if (!user || roleError) return
    let cancelled = false
    const loadOverrides = async () => {
      setOverridesLoading(true)
      setOverridesError(null)
      const { data, error } = await supabase
        .from('override_log')
        .select('id, performed_by, scan_log_id, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(100)
      if (cancelled) return
      if (error) {
        setOverridesError(error.message)
        setOverrides([])
      } else {
        setOverrides((data ?? []) as OverrideLogRow[])
      }
      setOverridesLoading(false)
    }
    loadOverrides()
    return () => {
      cancelled = true
    }
  }, [supabase, user, roleError, refreshKey])

  useEffect(() => {
    if (!user || roleError) return
    let cancelled = false
    const loadDevices = async () => {
      setDevicesLoading(true)
      setDevicesError(null)
      const { data, error } = await supabase
        .from('devices')
        .select('id, serial_number, last_heartbeat_at')
        .order('serial_number')
        .limit(500)
      if (cancelled) return
      if (error) {
        setDevicesError(error.message)
        setDevices([])
      } else {
        const rows = (data ?? []) as RawDevice[]
        setDevices(
          rows.map((d) => ({
            device_id: d.id,
            device_serial: d.serial_number,
            last_heartbeat_at: d.last_heartbeat_at,
          })),
        )
      }
      setDevicesLoading(false)
    }
    loadDevices()
    return () => {
      cancelled = true
    }
  }, [supabase, user, roleError, refreshKey])

  const allocations = useMemo<ContractorAllocation[]>(() => {
    const counts = new Map<string, number>()
    for (const wz of workzones) {
      if (wz.contractor_id) {
        counts.set(wz.contractor_id, (counts.get(wz.contractor_id) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries()).map(([contractorId, workzoneCount]) => ({
      contractorId,
      workzoneCount,
    }))
  }, [workzones])

  const handleReallocateFromMap = useCallback((workzoneId: string) => {
    setSelectedAuthStateId(workzoneId)
    setPrefillWorkzoneId(null)
    requestAnimationFrame(() => setPrefillWorkzoneId(workzoneId))
  }, [])

  const handleReallocateFromTable = useCallback((workzoneId: string) => {
    setSelectedAuthStateId(workzoneId)
    setPrefillWorkzoneId(null)
    requestAnimationFrame(() => setPrefillWorkzoneId(workzoneId))
  }, [])

  // Fetch authoritative per-workzone state from the backend view (RLS-enforced).
  useEffect(() => {
    if (!user || roleError) return
    let cancelled = false
    const run = async () => {
      setAuthStatesLoading(true)
      setAuthStatesError(null)
      try {
        const res = await fetch('/api/govt/workzone-states', {
          method: 'GET',
          credentials: 'same-origin',
        })
        if (!res.ok) {
          if (!cancelled) {
            setAuthStatesError(`HTTP ${res.status}`)
            setAuthStates([])
          }
          return
        }
        const json = (await res.json()) as { workzones?: AuthoritativeWorkzoneState[] }
        if (!cancelled) {
          setAuthStates(json.workzones ?? [])
        }
      } catch (err) {
        if (!cancelled) {
          setAuthStatesError((err as Error).message)
          setAuthStates([])
        }
      } finally {
        if (!cancelled) setAuthStatesLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [user, roleError, refreshKey])

  const handleSubmitReallocation = useCallback(
    async (input: {
      workzoneId: string
      newContractorId: string
      reason: string
    }) => {
      setReallocSubmitting(true)
      setReallocError(null)
      setReallocSuccess(null)
      const { error } = await supabase.rpc('reassign_workzone_contractor', {
        p_workzone_id: input.workzoneId,
        p_new_contractor_id: input.newContractorId,
        p_reassignment_reason: input.reason,
      })
      setReallocSubmitting(false)
      if (error) {
        setReallocError(error.message)
      } else {
        setReallocSuccess('Workzone reassignment recorded.')
        setPrefillWorkzoneId(null)
        setRefreshKey((k) => k + 1)
      }
    },
    [supabase],
  )

  const handleDismissMessages = useCallback(() => {
    setReallocSuccess(null)
    setReallocError(null)
  }, [])

  const handleDismissCreateMessages = useCallback(() => {
    setCreateSuccess(null)
    setCreateError(null)
  }, [])

  const handleSubmitCreateWorkzone = useCallback(
    async (input: {
      name: string
      target_lat: number
      target_lon: number
      target_depth_meters: number
      contractor_id?: string | null
      reason?: string | null
    }) => {
      setCreateSubmitting(true)
      setCreateError(null)
      setCreateSuccess(null)
      const { data, error } = await supabase.rpc('create_workzone', {
        p_name: input.name,
        p_target_lat: input.target_lat,
        p_target_lon: input.target_lon,
        p_target_depth_meters: input.target_depth_meters,
        p_contractor_id: input.contractor_id ?? null,
        p_reason: input.reason ?? null,
      })
      setCreateSubmitting(false)
      if (error) {
        setCreateError(error.message)
      } else {
        setCreateSuccess('Workzone created.')
        setRefreshKey((k) => k + 1)
      }
    },
    [supabase],
  )

  const totalWorkzones = workzones.length
  const assignedCount = workzones.filter((w) => w.contractor_id).length
  const unassignedCount = totalWorkzones - assignedCount
  const activePermitCount = permits.filter((p) => p.status === 'ACTIVE').length
  const issuedPermitCount = permits.filter((p) => p.status === 'ISSUED').length
  const closedPermitCount = permits.filter((p) => p.status === 'CLOSED').length
  const integrityAvailable = true

  const handleVerifyChain = useCallback(async () => {
    setChainLoading(true)
    setChainError(null)
    try {
      const res = await fetch('/api/govt/audit-chain/verify', {
        method: 'GET',
        credentials: 'same-origin',
      })
      if (!res.ok) {
        setChainError(`HTTP ${res.status}`)
        setChainVerification(null)
        return
      }
      const json = (await res.json()) as ChainVerificationResult
      setChainVerification(json)
    } catch (err) {
      setChainError((err as Error).message)
      setChainVerification(null)
    } finally {
      setChainLoading(false)
    }
  }, [])

  // Backend-derived authoritative safety state distribution.
  const safeCount = authStates.filter(
    (w) => w.state.aggregate_state === 'SAFE',
  ).length
  const warmingCount = authStates.filter(
    (w) => w.state.aggregate_state === 'WARMING',
  ).length
  const warningCount = authStates.filter(
    (w) => w.state.aggregate_state === 'WARNING',
  ).length
  const lockoutCount = authStates.filter(
    (w) => w.state.aggregate_state === 'LOCKOUT',
  ).length
  const unknownCount = authStates.filter(
    (w) => w.state.aggregate_state === 'UNKNOWN',
  ).length

  if (authLoading) {
    return (
      <div className="min-h-screen bg-prana-canvas p-4">
        <div className="mx-auto max-w-7xl">
          <div className="border-2 border-zinc-200 rounded-md bg-white p-6">
            <p className="font-mono text-sm uppercase tracking-wider text-slate-700">AUTHENTICATING...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-prana-canvas p-4">
        <div className="mx-auto max-w-7xl">
          <div className="border-2 border-zinc-200 rounded-md bg-white p-6">
            <p className="font-mono text-sm uppercase tracking-wider text-slate-700">AUTHENTICATION_REQUIRED</p>
          </div>
        </div>
      </div>
    )
  }

  if (roleError) {
    return (
      <div className="min-h-screen bg-prana-canvas p-4">
        <div className="mx-auto max-w-7xl">
          <div className="border-2 border-red-600 rounded-md bg-white p-6">
            <p className="font-mono text-sm font-bold uppercase tracking-wider text-red-700">AUTHORIZATION_ERROR</p>
            <p className="font-mono text-sm text-red-700 mt-1">{roleError}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 p-3">
      <div className="mx-auto max-w-7xl space-y-3">
        <header className="border-2 border-zinc-200 rounded-md bg-slate-700 px-4 py-3 flex items-center justify-between gap-4 shadow-panel-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2 h-10 bg-amber-500 rounded-sm shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="font-mono text-lg font-bold uppercase tracking-wider text-slate-50 truncate">
                PROJECT_PRANA
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-wider text-amber-400 mt-0.5 truncate">
                GOVERNMENT_OVERSIGHT_CONSOLE
              </p>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <StatusBadge label="ROLE: GOVT_AUDITOR" tone="amber" />
            <StatusBadge label="OVERSIGHT" tone="emerald" />
            <StatusBadge label="NOT FIELD OPS" tone="zinc" />
            <button
              type="button"
              onClick={signOut}
              className="border-2 border-zinc-200 rounded-md px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-slate-100 bg-slate-600 hover:bg-slate-500"
            >
              Sign Out
            </button>
          </div>
        </header>

        <ScopeCallouts />

        <Panel
          title="SYSTEM_STATUS"
          subtitle="Cross-tenant oversight snapshot"
          actions={
            <OpsButton size="sm" variant="secondary" onClick={() => setRefreshKey((k) => k + 1)}>
              REFRESH
            </OpsButton>
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <MetricTile
              label="WORKZONES"
              value={totalWorkzones}
              tone="inverse"
              loading={workzonesLoading}
            />
            <MetricTile
              label="ASSIGNED"
              value={assignedCount}
              tone="emerald"
              loading={workzonesLoading}
            />
            <MetricTile
              label="UNASSIGNED"
              value={unassignedCount}
              tone={unassignedCount > 0 ? 'amber' : 'default'}
              loading={workzonesLoading}
            />
            <MetricTile
              label="CONTRACTORS"
              value={contractors.length}
              tone="inverse"
              loading={contractorsLoading}
            />
            <MetricTile
              label="ACTIVE PERMITS"
              value={activePermitCount}
              tone={activePermitCount > 0 ? 'emerald' : 'default'}
              loading={permitsLoading}
            />
            <MetricTile
              label="ISSUED PERMITS"
              value={issuedPermitCount}
              tone={issuedPermitCount > 0 ? 'amber' : 'default'}
              loading={permitsLoading}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            <MetricTile
              label="AUTHORITATIVE: SAFE"
              value={safeCount}
              tone={safeCount > 0 ? 'emerald' : 'default'}
              loading={authStatesLoading}
            />
            <MetricTile
              label="AUTHORITATIVE: WARMING"
              value={warmingCount}
              tone={warmingCount > 0 ? 'amber' : 'default'}
              loading={authStatesLoading}
            />
            <MetricTile
              label="AUTHORITATIVE: WARNING"
              value={warningCount}
              tone={warningCount > 0 ? 'amber' : 'default'}
              loading={authStatesLoading}
            />
            <MetricTile
              label="AUTHORITATIVE: LOCKOUT"
              value={lockoutCount}
              tone={lockoutCount > 0 ? 'red' : 'default'}
              loading={authStatesLoading}
            />
            <MetricTile
              label="AUTHORITATIVE: UNKNOWN"
              value={unknownCount}
              tone="inverse"
              loading={authStatesLoading}
            />
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="border-2 border-zinc-200 rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
              <p className="font-bold uppercase tracking-wider text-slate-900">SCOPE</p>
              <p className="mt-1 normal-case tracking-normal">
                Cross-tenant READ. Government auditor CANNOT issue permits,
                override field decisions, or assign field staff.
              </p>
            </div>
            <div className="border-2 border-zinc-200 rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
              <p className="font-bold uppercase tracking-wider text-slate-900">FIELD_OPERATIONS</p>
              <p className="mt-1 normal-case tracking-normal">
                Field permit issuance, scanning, and overrides remain on the
                contractor / field surfaces. The auditor sees their outputs.
              </p>
            </div>
          </div>
        </Panel>

        <Panel
          title="CITY_OPERATIONS_MAP"
          subtitle="Geographic map — backend authoritative safety state per workzone"
          noPadding
        >
          <div className="p-3 space-y-3">
            {authStatesError ? (
              <DataState
                state="error"
                title="BACKEND_ERROR"
                message={`Could not load authoritative workzone state: ${authStatesError}`}
              />
            ) : null}
            {authStates.length === 0 && !authStatesLoading && !authStatesError ? (
              <DataState
                state="empty"
                title="NO_WORKZONES"
                message="No workzones visible to this auditor. Cross-tenant RLS may be filtering all rows, or the workzones table is empty."
              />
            ) : null}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <div className="xl:col-span-2">
                <WorkzoneMapClient
                  workzones={authStates}
                  selectedId={selectedAuthStateId}
                  onSelect={handleReallocateFromMap}
                />
              </div>
              <div className="space-y-3">
                <WorkzoneDetailPanel
                  workzone={
                    authStates.find((w) => w.workzone_id === selectedAuthStateId) ?? null
                  }
                  contractorName={
                    contractors.find(
                      (c) => c.id === authStates.find((w) => w.workzone_id === selectedAuthStateId)?.contractor_id,
                    )?.name ?? null
                  }
                  loading={authStatesLoading}
                  onAction={handleReallocateFromTable}
                />
                <MapLegend />
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="WORKZONE_OVERSIGHT"
          subtitle="All workzones across contractors"
          noPadding
          density="dense"
          actions={
            <OpsButton size="sm" variant="primary" onClick={() => { setCreateSuccess(null); setCreateError(null) }}>
              ADD_WORKZONE
            </OpsButton>
          }
        >
          <div className="p-3">
            <WorkzoneTable
              rows={workzones}
              loading={workzonesLoading}
              errorMessage={workzonesError}
              onReallocate={handleReallocateFromTable}
            />
          </div>
        </Panel>

        <CreateWorkzonePanel
          contractors={contractors}
          submitting={createSubmitting}
          successMessage={createSuccess}
          errorMessage={createError}
          onSubmit={handleSubmitCreateWorkzone}
          onDismissMessages={handleDismissCreateMessages}
        />

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <Panel
            title="CONTRACTOR_OVERVIEW"
            subtitle="Registered contractors and allocation"
            noPadding
            density="dense"
          >
            <div className="p-3">
              <ContractorPanel
                rows={contractors}
                allocations={allocations}
                loading={contractorsLoading}
                errorMessage={contractorsError}
              />
            </div>
          </Panel>

          <Panel
            title="PERMITS_AND_LOCKOUT_OVERVIEW"
            subtitle="System-wide permit registry (read-only)"
            noPadding
            density="dense"
          >
            <div className="p-3">
              <PermitsPanel
                rows={permits}
                loading={permitsLoading}
                errorMessage={permitsError}
              />
              {permits.length === 0 && !permitsLoading ? (
                <div className="mt-3">
                  <DataState
                    state="info"
                    title="NO_PERMITS_TO_INSPECT"
                    message="No permits in the system; lockout decisions are not derivable from this surface."
                  />
                </div>
              ) : null}
              {permits.length > 0 && closedPermitCount === 0 && permitsLoading === false ? (
                <div className="mt-3">
                  <DataState
                    state="info"
                    title="NO_CLOSED_PERMITS"
                    message="No CLOSED permits on record."
                  />
                </div>
              ) : null}
            </div>
          </Panel>
        </div>

        <ReallocationPanel
          workzones={workzones}
          contractors={contractors}
          submitting={reallocSubmitting}
          successMessage={reallocSuccess}
          errorMessage={reallocError}
          onSubmit={handleSubmitReallocation}
          onDismissMessages={handleDismissMessages}
          prefillWorkzoneId={prefillWorkzoneId}
        />

        <Panel
          title="AUDIT_AND_OVERRIDE_HISTORY"
          subtitle="Reassignment + override records"
        >
          <AuditHistoryPanel
            reassignments={reassignments}
            overrides={overrides}
            reassignmentsLoading={reassignmentsLoading}
            overridesLoading={overridesLoading}
            reassignmentsError={reassignmentsError}
            overridesError={overridesError}
          />
        </Panel>

        <Panel
          title="TELEMETRY_INTEGRITY"
          subtitle="Hash chain / HMAC / freshness"
        >
          <TelemetryIntegrityPanel
            integrityAvailable={integrityAvailable}
            chainVerification={chainVerification}
            chainLoading={chainLoading}
            chainError={chainError}
            onVerify={handleVerifyChain}
            rows={devices}
            loading={devicesLoading}
            errorMessage={devicesError}
          />
        </Panel>
      </div>
    </div>
  )
}

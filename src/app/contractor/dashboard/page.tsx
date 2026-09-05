'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Panel } from '@/components/govt/Panel'
import { StatusBadge } from '@/components/govt/StatusBadge'
import { MetricTile } from '@/components/govt/MetricTile'
import { DataState } from '@/components/govt/DataState'
import { OpsButton } from '@/components/govt/OpsButton'
import {
  OPS_EMPTY_ROW,
  OPS_TABLE,
  OPS_TABLE_TD,
  OPS_TABLE_TH,
  OPS_TABLE_TR_HOVER,
  OPS_TABLE_WRAPPER,
} from '@/components/govt/tableStyles'

type WorkzoneRow = {
  id: string
  name: string
  target_depth_meters: number
  contractor_id: string
  workzone_assignments: {
    id: string
    assigned_staff_id: string
    updated_at: string
    updated_by: string | null
  }[]
}

type SupervisorRow = {
  id: string
  role: string
  full_name: string | null
}

type PermitRow = {
  id: string
  number: string
  status: string
  field_supervisor_id: string | null
  created_at: string
}

type ScanLogRow = {
  id: string
  created_at: string
  decision: string | null
  work_order_id: string | null
}

type AuthoritativeState = {
  workzone_id: string
  contractor_id: string | null
  name: string
  target_lat: number
  target_lon: number
  target_depth_meters: number
  state: {
    aggregate_state: 'SAFE' | 'WARMING' | 'WARNING' | 'UNKNOWN' | 'LOCKOUT'
    aggregate_reason: string
    freshness_state: 'FRESH' | 'STALE' | 'MISSING' | 'AMBIGUOUS'
    latest_decision: string | null
    latest_scan_timestamp: string | null
    latest_h2s_ppm: string | null
    latest_o2_percent: string | null
    latest_depth_meters: string | null
    latest_battery_percent: string | null
    telemetry_age_seconds: number | null
  }
}

export default function ContractorDashboardPage() {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [user, setUser] = useState<{ id: string } | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [contractorId, setContractorId] = useState<string | null>(null)

  const [workzones, setWorkzones] = useState<WorkzoneRow[]>([])
  const [workzonesLoading, setWorkzonesLoading] = useState(true)
  const [workzonesError, setWorkzonesError] = useState<string | null>(null)

  const [supervisors, setSupervisors] = useState<SupervisorRow[]>([])
  const [supervisorsLoading, setSupervisorsLoading] = useState(true)
  const [supervisorsError, setSupervisorsError] = useState<string | null>(null)

  const [permits, setPermits] = useState<PermitRow[]>([])
  const [permitsLoading, setPermitsLoading] = useState(true)
  const [permitsError, setPermitsError] = useState<string | null>(null)

  const [scanLogs, setScanLogs] = useState<ScanLogRow[]>([])
  const [scanLogsLoading, setScanLogsLoading] = useState(true)
  const [scanLogsError, setScanLogsError] = useState<string | null>(null)

  const [authStates, setAuthStates] = useState<AuthoritativeState[]>([])
  const [authStatesLoading, setAuthStatesLoading] = useState(false)
  const [authStatesError, setAuthStatesError] = useState<string | null>(null)

  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [selectedStaff, setSelectedStaff] = useState<Record<string, string>>({})
  const [assignError, setAssignError] = useState<string | null>(null)
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null)

  const [workOrderIds, setWorkOrderIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    const getUser = async () => {
      const { data } = await supabase.auth.getUser()
      if (!cancelled) {
        setUser(data.user)
        setAuthLoading(false)
      }
    }
    getUser()
    return () => { cancelled = true }
  }, [supabase])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const loadProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('contractor_id')
        .eq('id', user.id)
        .maybeSingle()

      if (!cancelled && data) {
        setContractorId(data.contractor_id)
      }
    }

    loadProfile()
    return () => { cancelled = true }
  }, [supabase, user])

  useEffect(() => {
    if (!contractorId) return
    let cancelled = false

    const loadWorkzones = async () => {
      setWorkzonesLoading(true)
      setWorkzonesError(null)
      const { data, error } = await supabase
        .from('workzones')
        .select(`
          id,
          name,
          target_depth_meters,
          contractor_id,
          workzone_assignments (
            id,
            assigned_staff_id,
            updated_at,
            updated_by
          )
        `)
        .eq('contractor_id', contractorId)
        .order('name')
        .limit(500)

      if (!cancelled) {
        if (error) {
          setWorkzonesError(error.message)
          setWorkzones([])
        } else {
          setWorkzones((data ?? []) as WorkzoneRow[])
        }
        setWorkzonesLoading(false)
      }
    }

    loadWorkzones()
    return () => { cancelled = true }
  }, [supabase, contractorId])

  useEffect(() => {
    if (!contractorId) return
    let cancelled = false

    const loadSupervisors = async () => {
      setSupervisorsLoading(true)
      setSupervisorsError(null)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, full_name')
        .eq('contractor_id', contractorId)
        .eq('role', 'field_supervisor')
        .order('full_name')
        .limit(500)

      if (!cancelled) {
        if (error) {
          setSupervisorsError(error.message)
          setSupervisors([])
        } else {
          setSupervisors((data ?? []) as SupervisorRow[])
        }
        setSupervisorsLoading(false)
      }
    }

    loadSupervisors()
    return () => { cancelled = true }
  }, [supabase, contractorId])

  useEffect(() => {
    if (!contractorId) return
    let cancelled = false

    const loadPermits = async () => {
      setPermitsLoading(true)
      setPermitsError(null)
      const { data, error } = await supabase
        .from('permits')
        .select('id, number, status, field_supervisor_id, created_at')
        .eq('contractor_id', contractorId)
        .order('created_at', { ascending: false })
        .limit(200)

      if (!cancelled) {
        if (error) {
          setPermitsError(error.message)
          setPermits([])
        } else {
          setPermits((data ?? []) as PermitRow[])
        }
        setPermitsLoading(false)
      }
    }

    loadPermits()
    return () => { cancelled = true }
  }, [supabase, contractorId])

  useEffect(() => {
    if (!contractorId) return
    let cancelled = false

    const loadWorkOrderIds = async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('id')
        .eq('contractor_id', contractorId)
        .limit(500)

      if (!cancelled) {
        if (!error) {
          setWorkOrderIds(new Set((data ?? []).map(wo => wo.id)))
        }
      }
    }

    loadWorkOrderIds()
    return () => { cancelled = true }
  }, [supabase, contractorId])

  useEffect(() => {
    if (!contractorId) return
    let cancelled = false

    const loadScanLogs = async () => {
      setScanLogsLoading(true)
      setScanLogsError(null)
      const workOrderIdArray = Array.from(workOrderIds)
      const { data, error } = await supabase
        .from('scan_logs')
        .select(`
          id,
          created_at,
          decision,
          work_order_id
        `)
        .in('work_order_id', workOrderIdArray)
        .order('created_at', { ascending: false })
        .limit(200)

      if (!cancelled) {
        if (error) {
          setScanLogsError(error.message)
          setScanLogs([])
        } else {
          setScanLogs((data ?? []) as ScanLogRow[])
        }
        setScanLogsLoading(false)
      }
    }

    loadScanLogs()
    return () => { cancelled = true }
  }, [supabase, contractorId, workOrderIds])

  useEffect(() => {
    if (!user || !contractorId) return
    let cancelled = false
    const run = async () => {
      setAuthStatesLoading(true)
      setAuthStatesError(null)
      try {
        const res = await fetch('/api/contractor/workzone-states', {
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
        const json = (await res.json()) as { workzones?: AuthoritativeState[] }
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
  }, [user, contractorId])

  const supervisorMap = useMemo(() => {
    const map = new Map<string, SupervisorRow>()
    for (const s of supervisors) {
      map.set(s.id, s)
    }
    return map
  }, [supervisors])

  const authStateMap = useMemo(() => {
    const map = new Map<string, AuthoritativeState['state']>()
    for (const w of authStates) {
      map.set(w.workzone_id, w.state)
    }
    return map
  }, [authStates])

  const handleAssign = async (workzoneId: string) => {
    const staffId = selectedStaff[workzoneId]
    if (!staffId) return

    setAssigningId(workzoneId)
    setAssignError(null)
    setAssignSuccess(null)

    const { error } = await supabase.rpc('assign_field_supervisor', {
      p_workzone_id: workzoneId,
      p_assigned_staff_id: staffId,
    })

    if (error) {
      setAssignError(error.message)
    } else {
      setAssignSuccess('Assignment updated')
      setWorkzones(prev => prev.map(w => {
        if (w.id !== workzoneId) return w
        return {
          ...w,
          workzone_assignments: [{
            id: 'updated',
            assigned_staff_id: staffId,
            updated_at: new Date().toISOString(),
            updated_by: user!.id,
          }],
        }
      }))
    }

    setAssigningId(null)
    setTimeout(() => {
      setAssignError(null)
      setAssignSuccess(null)
    }, 3000)
  }

  const totalWorkzones = workzones.length
  const assignedCount = workzones.filter(w => w.workzone_assignments?.[0]?.assigned_staff_id).length
  const unassignedCount = totalWorkzones - assignedCount
  const activePermitCount = permits.filter(p => p.status === 'ACTIVE').length
  const issuedPermitCount = permits.filter(p => p.status === 'ISSUED').length

  const safeCount = authStates.filter(w => w.state.aggregate_state === 'SAFE').length
  const warmingCount = authStates.filter(w => w.state.aggregate_state === 'WARMING').length
  const warningCount = authStates.filter(w => w.state.aggregate_state === 'WARNING').length
  const lockoutCount = authStates.filter(w => w.state.aggregate_state === 'LOCKOUT').length
  const unknownCount = authStates.filter(w => w.state.aggregate_state === 'UNKNOWN').length

  const aggregateStateTone = (state: string): 'emerald' | 'amber' | 'red' | 'zinc' | 'inverse' => {
    switch (state) {
      case 'SAFE':
        return 'emerald'
      case 'WARMING':
      case 'WARNING':
        return 'amber'
      case 'LOCKOUT':
        return 'red'
      default:
        return 'inverse'
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-6xl">
          <div className="border-2 border-zinc-200 rounded-md bg-white p-6">
            <p className="font-mono text-sm text-slate-700">AUTHENTICATING...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto max-w-6xl">
          <div className="border-2 border-zinc-200 rounded-md bg-white p-6">
            <p className="font-mono text-sm text-slate-700">AUTHENTICATION_REQUIRED</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-3">
      <div className="mx-auto max-w-6xl space-y-3">
        <header className="border-2 border-zinc-200 rounded-md bg-slate-900 px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2 h-10 bg-amber-500 rounded-sm shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="font-mono text-base font-bold uppercase tracking-wider text-slate-50 truncate">
                PROJECT_PRANA
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-wider text-amber-400 mt-0.5 truncate">
                CONTRACTOR_ADMIN_CONSOLE
              </p>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <StatusBadge label="ROLE: CONTRACTOR_ADMIN" tone="amber" />
          </div>
        </header>

        <Panel
          title="COMPANY_STATUS"
          subtitle="Workzone and permit overview"
          actions={
            <OpsButton size="sm" variant="secondary" onClick={() => {
              setWorkzonesLoading(true)
              setSupervisorsLoading(true)
              setPermitsLoading(true)
              setScanLogsLoading(true)
              setAuthStatesLoading(true)
              setWorkzones([])
              setSupervisors([])
              setPermits([])
              setScanLogs([])
              setAuthStates([])
              setTimeout(() => window.location.reload(), 100)
            }}>
              REFRESH
            </OpsButton>
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <MetricTile label="WORKZONES" value={totalWorkzones} tone="inverse" loading={workzonesLoading} />
            <MetricTile label="ASSIGNED" value={assignedCount} tone="emerald" loading={workzonesLoading} />
            <MetricTile label="UNASSIGNED" value={unassignedCount} tone={unassignedCount > 0 ? 'amber' : 'default'} loading={workzonesLoading} />
            <MetricTile label="ACTIVE PERMITS" value={activePermitCount} tone={activePermitCount > 0 ? 'emerald' : 'default'} loading={permitsLoading} />
            <MetricTile label="ISSUED PERMITS" value={issuedPermitCount} tone={issuedPermitCount > 0 ? 'amber' : 'default'} loading={permitsLoading} />
            <MetricTile label="SUPERVISORS" value={supervisors.length} tone="inverse" loading={supervisorsLoading} />
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2">
            <MetricTile label="AUTH: SAFE" value={safeCount} tone={safeCount > 0 ? 'emerald' : 'default'} loading={authStatesLoading} />
            <MetricTile label="AUTH: WARMING" value={warmingCount} tone={warmingCount > 0 ? 'amber' : 'default'} loading={authStatesLoading} />
            <MetricTile label="AUTH: WARNING" value={warningCount} tone={warningCount > 0 ? 'amber' : 'default'} loading={authStatesLoading} />
            <MetricTile label="AUTH: LOCKOUT" value={lockoutCount} tone={lockoutCount > 0 ? 'red' : 'default'} loading={authStatesLoading} />
            <MetricTile label="AUTH: UNKNOWN" value={unknownCount} tone="inverse" loading={authStatesLoading} />
          </div>
          {authStatesError ? (
            <div className="mt-3">
              <DataState state="error" message={`Authoritative state error: ${authStatesError}`} />
            </div>
          ) : null}
          {authStates.length === 0 && !authStatesLoading && !authStatesError ? (
            <div className="mt-3">
              <DataState state="info" message="No authoritative safety state available for visible workzones." />
            </div>
          ) : null}
        </Panel>

        <Panel
          title="WORKZONE_QUEUE"
          subtitle="Assign field supervisors and view backend-derived safety state"
          noPadding
          density="dense"
        >
          <div className="p-3">
            {workzonesError ? (
              <DataState state="error" message={`Workzones error: ${workzonesError}`} />
            ) : null}
            {!workzonesError && workzones.length === 0 && !workzonesLoading ? (
              <DataState state="empty" message="No workzones found for this company." />
            ) : null}
            {!workzonesError && (
              <div className={OPS_TABLE_WRAPPER}>
                <table className={OPS_TABLE}>
                  <thead>
                    <tr>
                      <th className={OPS_TABLE_TH}>WZ_ID</th>
                      <th className={OPS_TABLE_TH}>NAME</th>
                      <th className={OPS_TABLE_TH}>TARGET_DEPTH</th>
                      <th className={OPS_TABLE_TH}>AUTHORITATIVE_STATE</th>
                      <th className={OPS_TABLE_TH}>ASSIGNED_STAFF</th>
                      <th className={OPS_TABLE_TH}>ASSIGN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workzonesLoading ? (
                      <tr>
                        <td colSpan={6} className={OPS_EMPTY_ROW}>Loading workzones...</td>
                      </tr>
                    ) : (
                      workzones.map(wz => {
                        const assignment = wz.workzone_assignments?.[0]
                        const currentStaffId = assignment?.assigned_staff_id ?? ''
                        const supervisor = supervisorMap.get(currentStaffId)
                        const staffLabel = supervisor?.full_name
                          ? `${supervisor.full_name} (${currentStaffId.slice(0, 8)}...)`
                          : currentStaffId
                            ? `${currentStaffId.slice(0, 8)}...`
                            : '—'
                        const authState = authStateMap.get(wz.id)
                        const isAssigning = assigningId === wz.id

                        return (
                          <tr key={wz.id} className={OPS_TABLE_TR_HOVER}>
                            <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                              {wz.id.slice(0, 8)}…
                            </td>
                            <td className={[OPS_TABLE_TD, 'text-slate-900', 'font-bold', 'max-w-[14rem]', 'break-words'].join(' ')}>
                              {wz.name}
                            </td>
                            <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                              {wz.target_depth_meters.toFixed(2)} m
                            </td>
                            <td className={OPS_TABLE_TD}>
                              {authStatesLoading ? (
                                <span className="font-mono text-[11px] text-slate-700">Loading...</span>
                              ) : authState ? (
                                <StatusBadge
                                  label={authState.aggregate_state}
                                  tone={aggregateStateTone(authState.aggregate_state)}
                                />
                              ) : (
                                <StatusBadge label="UNKNOWN" tone="inverse" />
                              )}
                            </td>
                            <td className={[OPS_TABLE_TD, 'text-slate-700', 'max-w-[12rem]', 'break-words'].join(' ')}>
                              {staffLabel}
                            </td>
                            <td className={OPS_TABLE_TD}>
                              <div className="flex items-center gap-2">
                                <select
                                  value={selectedStaff[wz.id] ?? currentStaffId}
                                  onChange={(e) => setSelectedStaff(prev => ({ ...prev, [wz.id]: e.target.value }))}
                                  disabled={isAssigning || supervisorsLoading}
                                  className="border-2 border-zinc-200 rounded-md px-2 py-1 font-mono text-[11px] text-slate-900 bg-white disabled:opacity-50"
                                >
                                  <option value="">-- select --</option>
                                  {supervisors.map(s => (
                                    <option key={s.id} value={s.id}>
                                      {s.full_name ? `${s.full_name} (${s.id.slice(0, 8)}...)` : s.id.slice(0, 8) + '...'}
                                    </option>
                                  ))}
                                </select>
                                <OpsButton
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleAssign(wz.id)}
                                  disabled={isAssigning || !selectedStaff[wz.id]}
                                >
                                  {isAssigning ? 'Saving...' : assignment ? 'Reassign' : 'Assign'}
                                </OpsButton>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {assignError && (
              <div className="px-3 py-3 border-t-2 border-zinc-200 bg-red-50 mt-0">
                <p className="font-mono text-xs text-red-700">Error: {assignError}</p>
              </div>
            )}
            {assignSuccess && (
              <div className="px-3 py-3 border-t-2 border-zinc-200 bg-emerald-50 mt-0">
                <p className="font-mono text-xs text-emerald-700">{assignSuccess}</p>
              </div>
            )}
          </div>
        </Panel>

        <Panel
          title="AUDIT_AND_PERMIT_LOG"
          subtitle="Read-only historical records"
        >
          <div className="overflow-x-auto">
            <table className={OPS_TABLE}>
              <thead>
                <tr>
                  <th className={OPS_TABLE_TH}>TIMESTAMP</th>
                  <th className={OPS_TABLE_TH}>TYPE</th>
                  <th className={OPS_TABLE_TH}>REFERENCE</th>
                  <th className={OPS_TABLE_TH}>SUPERVISOR_ID</th>
                  <th className={OPS_TABLE_TH}>STATUS</th>
                  <th className={OPS_TABLE_TH}>DECISION</th>
                </tr>
              </thead>
              <tbody>
                {permitsLoading && scanLogsLoading ? (
                  <tr>
                    <td colSpan={6} className={OPS_EMPTY_ROW}>Loading audit log...</td>
                  </tr>
                ) : (
                  <>
                    {permits.map(p => (
                      <tr key={`permit-${p.id}`} className={OPS_TABLE_TR_HOVER}>
                        <td className={OPS_TABLE_TD}>{new Date(p.created_at).toLocaleString()}</td>
                        <td className={OPS_TABLE_TD}>PERMIT</td>
                        <td className={OPS_TABLE_TD}>{p.number}</td>
                        <td className={OPS_TABLE_TD}>
                          {p.field_supervisor_id ? p.field_supervisor_id.slice(0, 8) + '...' : '—'}
                        </td>
                        <td className={OPS_TABLE_TD}>
                          <StatusBadge
                            label={p.status}
                            tone={
                              p.status === 'ISSUED' ? 'amber' :
                              p.status === 'ACTIVE' ? 'emerald' : 'zinc'
                            }
                          />
                        </td>
                        <td className={OPS_TABLE_TD}>—</td>
                      </tr>
                    ))}
                    {scanLogs.map(log => (
                      <tr key={`scan-${log.id}`} className={OPS_TABLE_TR_HOVER}>
                        <td className={OPS_TABLE_TD}>{new Date(log.created_at).toLocaleString()}</td>
                        <td className={OPS_TABLE_TD}>SCAN</td>
                        <td className={OPS_TABLE_TD}>
                          {log.work_order_id ? log.work_order_id.slice(0, 8) + '...' : '—'}
                        </td>
                        <td className={OPS_TABLE_TD}>—</td>
                        <td className={OPS_TABLE_TD}>—</td>
                        <td className={OPS_TABLE_TD}>{log.decision ?? '—'}</td>
                      </tr>
                    ))}
                    {permits.length === 0 && scanLogs.length === 0 && !permitsLoading && !scanLogsLoading && (
                      <tr>
                        <td colSpan={6} className={OPS_EMPTY_ROW}>No audit records found.</td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
          {(permitsError || scanLogsError) && (
            <div className="px-3 py-3 border-t-2 border-zinc-200 bg-red-50">
              <p className="font-mono text-xs text-red-700">
                Error: {permitsError || scanLogsError}
              </p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

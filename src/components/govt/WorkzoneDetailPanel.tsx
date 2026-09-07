'use client'

import { StatusBadge } from './StatusBadge'
import { DataState } from './DataState'
import type { WorkzoneState as WorkzoneStateT } from './WorkzoneMap'
import { OpsButton } from './OpsButton'

export interface WorkzoneDetailPanelProps {
  workzone: WorkzoneStateT | null
  contractorName: string | null
  loading?: boolean
  onAction?: (workzoneId: string) => void
}

const SAFETY_TONE: Record<string, 'emerald' | 'amber' | 'red' | 'slate'> = {
  SAFE: 'emerald',
  WARMING: 'amber',
  WARNING: 'amber',
  LOCKOUT: 'red',
  UNKNOWN: 'slate',
}

function fmt(value: string | number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—'
  return unit ? `${value} ${unit}` : String(value)
}

function fmtTimestamp(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function fmtAge(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${Math.round(seconds)} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}

export const WorkzoneDetailPanel: React.FC<WorkzoneDetailPanelProps> = ({
  workzone,
  contractorName,
  loading = false,
  onAction,
}) => {
  if (loading) {
    return (
      <div className="border-2 border-zinc-200 rounded-md bg-slate-50 p-4 font-mono text-xs uppercase tracking-wider text-slate-700">
        Loading workzone state...
      </div>
    )
  }

  if (!workzone) {
    return (
      <DataState
        state="info"
        title="SELECT_A_WORKZONE"
        message="Click a marker on the map to inspect the authoritative backend safety state for that workzone."
      />
    )
  }

  const unassigned = !workzone.contractor_id
  const safetyTone = SAFETY_TONE[workzone.state.aggregate_state] ?? 'slate'
  const freshnessTone =
    workzone.state.freshness_state === 'FRESH'
      ? 'emerald'
      : workzone.state.freshness_state === 'AMBIGUOUS'
      ? 'amber'
      : 'red'

  return (
    <div className="border-2 border-zinc-200 rounded-md bg-white overflow-hidden shadow-panel">
      <div className="px-3 py-2 border-b-2 border-zinc-200 bg-slate-900 flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-100">
          ZONE_DETAIL
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
          {workzone.workzone_id.slice(0, 8)}…
        </span>
      </div>

      <div className="p-3 space-y-3">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600">NAME</p>
          <p className="font-mono text-sm font-bold text-slate-900 break-words">{workzone.name}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="border-2 border-zinc-200 rounded-md bg-slate-50 p-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">CONTRACTOR</p>
            <p className="font-mono text-sm text-slate-900 break-words">
              {contractorName ?? '—'}
            </p>
            <div className="mt-1">
              <StatusBadge
                label={unassigned ? 'UNASSIGNED' : 'ASSIGNED'}
                tone={unassigned ? 'amber' : 'emerald'}
              />
            </div>
            {onAction && workzone ? (
              <div className="mt-2">
                <OpsButton
                  size="sm"
                  variant={unassigned ? 'primary' : 'secondary'}
                  onClick={() => onAction(workzone.workzone_id)}
                >
                  {unassigned ? 'ALLOCATE CONTRACTOR' : 'REALLOCATE'}
                </OpsButton>
              </div>
            ) : null}
          </div>
          <div
            className={[
              'border-2 rounded-md p-2',
              safetyTone === 'red'
                ? 'border-red-600 bg-red-600 text-red-50'
                : safetyTone === 'emerald'
                ? 'border-emerald-600 bg-emerald-600 text-emerald-50'
                : safetyTone === 'amber'
                ? 'border-amber-500 bg-amber-500 text-amber-50'
                : 'border-zinc-400 bg-zinc-200 text-zinc-800',
            ].join(' ')}
          >
            <p className="font-mono text-[10px] uppercase tracking-wider opacity-90">SAFETY</p>
            <p className="font-mono text-2xl font-bold leading-none">
              {workzone.state.aggregate_state}
            </p>
            <p className="font-mono text-[10px] mt-1 opacity-90 break-words">
              {workzone.state.aggregate_reason}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="border-2 border-zinc-200 rounded-md bg-white p-2 shadow-panel">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">LAT</p>
            <p className="font-mono text-sm text-slate-900">
              {workzone.target_lat.toFixed(6)}
            </p>
          </div>
          <div className="border-2 border-zinc-200 rounded-md bg-white p-2 shadow-panel">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">LON</p>
            <p className="font-mono text-sm text-slate-900">
              {workzone.target_lon.toFixed(6)}
            </p>
          </div>
          <div className="border-2 border-zinc-200 rounded-md bg-white p-2 shadow-panel">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">TARGET_DEPTH</p>
            <p className="font-mono text-sm text-slate-900">
              {fmt(workzone.target_depth_meters, 'm')}
            </p>
          </div>
          <div className="border-2 border-zinc-200 rounded-md bg-white p-2 shadow-panel">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">FRESHNESS</p>
            <div className="mt-1">
              <StatusBadge
                label={workzone.state.freshness_state}
                tone={freshnessTone}
              />
            </div>
          </div>
        </div>

        <div className="border-2 border-zinc-200 rounded-md bg-slate-50 p-3 space-y-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600">
            WORK_ORDER
          </p>
          <p className="font-mono text-[11px] text-slate-900 break-all">
            ID: {fmt(workzone.state.authoritative_work_order_id)}
          </p>
          <p className="font-mono text-[11px] text-slate-900">
            STATUS: {fmt(workzone.state.authoritative_work_order_status)}
          </p>
        </div>

        <div className="border-2 border-zinc-200 rounded-md bg-slate-50 p-3 space-y-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600">DEVICE</p>
          <p className="font-mono text-[11px] text-slate-900 break-all">
            ID: {fmt(workzone.state.authoritative_device_id)}
          </p>
          <p className="font-mono text-[11px] text-slate-900">
            LATEST_SCAN_LOG: {fmt(workzone.state.latest_scan_log_id)}
          </p>
          <p className="font-mono text-[11px] text-slate-900">
            LATEST_SCAN_TS: {fmtTimestamp(workzone.state.latest_scan_timestamp)}
          </p>
          <p className="font-mono text-[11px] text-slate-900">
            AGE: {fmtAge(workzone.state.telemetry_age_seconds)} / WINDOW{' '}
            {workzone.state.freshness_window_seconds}s
          </p>
        </div>

        <div className="border-2 border-zinc-200 rounded-md bg-slate-50 p-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
            TELEMETRY
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">H2S</p>
              <p className="font-mono text-sm text-slate-900">
                {fmt(workzone.state.latest_h2s_ppm, 'ppm')}
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">O2</p>
              <p className="font-mono text-sm text-slate-900">
                {fmt(workzone.state.latest_o2_percent, '%')}
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">DEPTH</p>
              <p className="font-mono text-sm text-slate-900">
                {fmt(workzone.state.latest_depth_meters, 'm')}
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-600">BATTERY</p>
              <p className="font-mono text-sm text-slate-900">
                {fmt(workzone.state.latest_battery_percent, '%')}
              </p>
            </div>
          </div>
        </div>

        <div className="border-2 border-zinc-200 rounded-md bg-slate-50 p-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600">
            COMPUTED_AT
          </p>
          <p className="font-mono text-[11px] text-slate-900">{fmtTimestamp(workzone.state.computed_at)}</p>
        </div>
      </div>
    </div>
  )
}

export default WorkzoneDetailPanel

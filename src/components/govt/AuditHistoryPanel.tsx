import React from 'react'
import { Panel } from './Panel'
import { StatusBadge } from './StatusBadge'
import { DataState } from './DataState'
import {
  OPS_EMPTY_ROW,
  OPS_TABLE,
  OPS_TABLE_TD,
  OPS_TABLE_TH,
  OPS_TABLE_TR_HOVER,
  OPS_TABLE_WRAPPER,
} from './tableStyles'

export interface ReassignmentLogRow {
  id: string
  workzone_id: string
  workzone_name: string | null
  previous_contractor_name: string | null
  new_contractor_name: string | null
  performed_by: string
  reason: string
  created_at: string
}

export interface OverrideLogRow {
  id: string
  performed_by: string
  scan_log_id: string | null
  reason: string | null
  created_at: string
}

export interface AuditHistoryPanelProps {
  reassignments: ReassignmentLogRow[]
  overrides: OverrideLogRow[]
  reassignmentsLoading?: boolean
  overridesLoading?: boolean
  reassignmentsError?: string | null
  overridesError?: string | null
}

export const AuditHistoryPanel: React.FC<AuditHistoryPanelProps> = ({
  reassignments,
  overrides,
  reassignmentsLoading = false,
  overridesLoading = false,
  reassignmentsError,
  overridesError,
}) => {
  return (
    <div className="space-y-4">
      <Panel title="REASSIGNMENT_AUDIT_LOG" subtitle="contractor_reassignment_log">
        {reassignmentsError ? (
          <DataState state="error" message={reassignmentsError} />
        ) : (
          <div className={OPS_TABLE_WRAPPER}>
            <table className={OPS_TABLE}>
              <thead>
                <tr>
                  <th className={OPS_TABLE_TH}>TIMESTAMP</th>
                  <th className={OPS_TABLE_TH}>WORKZONE</th>
                  <th className={OPS_TABLE_TH}>FROM_CONTRACTOR</th>
                  <th className={OPS_TABLE_TH}>TO_CONTRACTOR</th>
                  <th className={OPS_TABLE_TH}>PERFORMED_BY</th>
                  <th className={OPS_TABLE_TH}>REASON</th>
                </tr>
              </thead>
              <tbody>
                {reassignmentsLoading ? (
                  <tr>
                    <td colSpan={6} className={OPS_EMPTY_ROW}>
                      Loading reassignment history...
                    </td>
                  </tr>
                ) : reassignments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={OPS_EMPTY_ROW}>
                      No contractor reassignments on record.
                    </td>
                  </tr>
                ) : (
                  reassignments.map((r) => (
                    <tr key={r.id} className={OPS_TABLE_TR_HOVER}>
                      <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className={[OPS_TABLE_TD, 'text-slate-900', 'max-w-[12rem]', 'break-words'].join(' ')}>
                        {r.workzone_name ?? r.workzone_id.slice(0, 8) + '…'}
                      </td>
                      <td className={[OPS_TABLE_TD, 'text-slate-900', 'max-w-[10rem]', 'break-words'].join(' ')}>
                        {r.previous_contractor_name ?? '—'}
                      </td>
                      <td className={[OPS_TABLE_TD, 'text-slate-900', 'max-w-[10rem]', 'break-words'].join(' ')}>
                        {r.new_contractor_name ?? '—'}
                      </td>
                      <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                        {r.performed_by.slice(0, 8)}…
                      </td>
                      <td className={[OPS_TABLE_TD, 'text-slate-700', 'max-w-[18rem]', 'break-words'].join(' ')}>
                        {r.reason}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="OVERRIDE_LOG" subtitle="override_log (append-only)">
        {overridesError ? (
          <DataState state="error" message={overridesError} />
        ) : (
          <div className={OPS_TABLE_WRAPPER}>
            <table className={OPS_TABLE}>
              <thead>
                <tr>
                  <th className={OPS_TABLE_TH}>TIMESTAMP</th>
                  <th className={OPS_TABLE_TH}>PERFORMED_BY</th>
                  <th className={OPS_TABLE_TH}>SCAN_LOG</th>
                  <th className={OPS_TABLE_TH}>REASON</th>
                </tr>
              </thead>
              <tbody>
                {overridesLoading ? (
                  <tr>
                    <td colSpan={4} className={OPS_EMPTY_ROW}>
                      Loading override log...
                    </td>
                  </tr>
                ) : overrides.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={OPS_EMPTY_ROW}>
                      No overrides on record.
                    </td>
                  </tr>
                ) : (
                  overrides.map((o) => (
                    <tr key={o.id} className={OPS_TABLE_TR_HOVER}>
                      <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                        {new Date(o.created_at).toLocaleString()}
                      </td>
                      <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                        {o.performed_by.slice(0, 8)}…
                      </td>
                      <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                        {o.scan_log_id ? o.scan_log_id.slice(0, 8) + '…' : '—'}
                      </td>
                      <td className={[OPS_TABLE_TD, 'text-slate-700', 'max-w-[22rem]', 'break-words'].join(' ')}>
                        {o.reason ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="SCAN_LOG_NOTE" subtitle="cross-tenant visibility">
        <div className="border-2 border-zinc-200 rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-700 space-y-2">
          <div className="flex items-center gap-2">
            <StatusBadge label="INFO" tone="amber" />
            <span className="font-bold uppercase tracking-wider text-slate-900">
              CROSS_TENANT_SCAN_LOG
            </span>
          </div>
          <p className="normal-case tracking-normal">
            Cross-tenant scan_log rows are accessible via the scan_logs table;
            use the dedicated <span className="font-bold">/api/telemetry/latest</span> endpoint
            for per-device inspection.
          </p>
          <p className="normal-case tracking-normal">
            Scan-level compliance decisions are recorded server-side via the ingest endpoint
            and are not reinterpreted by this UI.
          </p>
        </div>
      </Panel>
    </div>
  )
}

export default AuditHistoryPanel

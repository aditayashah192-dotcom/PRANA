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

export interface IntegrityRow {
  device_id: string
  device_serial: string | null
  last_heartbeat_at: string | null
}

export interface TelemetryIntegrityPanelProps {
  integrityAvailable: boolean
  rows: IntegrityRow[]
  loading?: boolean
  errorMessage?: string | null
}

export const TelemetryIntegrityPanel: React.FC<TelemetryIntegrityPanelProps> = ({
  integrityAvailable,
  rows,
  loading = false,
  errorMessage,
}) => {
  return (
    <div className="space-y-4">
      <Panel
        title="TELEMETRY_INTEGRITY"
        subtitle="hash chain / freshness / HMAC"
        tone={integrityAvailable ? 'default' : 'critical'}
      >
        {integrityAvailable ? (
          <div className="border-2 border-emerald-600 rounded-md bg-emerald-600 p-3 font-mono text-xs text-emerald-50">
            <p className="font-bold uppercase tracking-wider">VERIFIED</p>
            <p className="mt-1 normal-case tracking-normal">
              Backend verification mechanism reports the chain as verified.
            </p>
          </div>
        ) : (
          <div className="border-2 border-red-600 rounded-md bg-red-50 p-3 font-mono text-xs text-red-700">
            <p className="font-bold uppercase tracking-wider">VERIFICATION_UNAVAILABLE</p>
            <p className="mt-1 normal-case tracking-normal">
              Full chain verification requires the existing backend verification
              mechanism. The dashboard cannot independently verify hash-chain
              integrity from client-side data.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="DEVICE_HEARTBEATS" subtitle="devices.last_heartbeat_at">
        {errorMessage ? (
          <DataState state="error" message={errorMessage} />
        ) : (
          <div className={OPS_TABLE_WRAPPER}>
            <table className={OPS_TABLE}>
              <thead>
                <tr>
                  <th className={OPS_TABLE_TH}>DEVICE_ID</th>
                  <th className={OPS_TABLE_TH}>SERIAL</th>
                  <th className={OPS_TABLE_TH}>LAST_HEARTBEAT</th>
                  <th className={OPS_TABLE_TH}>STATE</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className={OPS_EMPTY_ROW}>
                      Loading devices...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={OPS_EMPTY_ROW}>
                      No devices registered.
                    </td>
                  </tr>
                ) : (
                  rows.map((d) => {
                    const tone = d.last_heartbeat_at ? 'emerald' : 'amber'
                    const label = d.last_heartbeat_at ? 'HEARTBEAT' : 'NO_HEARTBEAT'
                    return (
                      <tr key={d.device_id} className={OPS_TABLE_TR_HOVER}>
                        <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                          {d.device_id.slice(0, 8)}…
                        </td>
                        <td className={[OPS_TABLE_TD, 'text-slate-900'].join(' ')}>
                          {d.device_serial ?? '—'}
                        </td>
                        <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                          {d.last_heartbeat_at
                            ? new Date(d.last_heartbeat_at).toLocaleString()
                            : 'NEVER'}
                        </td>
                        <td className={OPS_TABLE_TD}>
                          <StatusBadge label={label} tone={tone} />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

export default TelemetryIntegrityPanel

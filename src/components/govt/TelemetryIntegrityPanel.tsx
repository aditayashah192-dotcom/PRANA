import React from 'react'
import { Panel } from './Panel'
import { StatusBadge } from './StatusBadge'
import { DataState } from './DataState'
import { OpsButton } from './OpsButton'
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

export interface ChainFailure {
  index: number
  recordId: string
  reason: string
  field?: string
  expected?: string
  actual?: string
}

export interface ChainVerificationResult {
  valid: boolean
  status: 'VALID' | 'INVALID'
  recordCount: number
  verifiedCount: number
  verifiedAt: string
  rootValid: boolean
  linkageValid: boolean
  hashesValid: boolean
  messageIdsValid: boolean
  malformedHashes: boolean
  failures: ChainFailure[]
}

export interface TelemetryIntegrityPanelProps {
  integrityAvailable: boolean
  chainVerification: ChainVerificationResult | null
  chainLoading: boolean
  chainError: string | null
  onVerify: () => void
  rows: IntegrityRow[]
  loading?: boolean
  errorMessage?: string | null
}

export const TelemetryIntegrityPanel: React.FC<TelemetryIntegrityPanelProps> = ({
  integrityAvailable,
  chainVerification,
  chainLoading,
  chainError,
  onVerify,
  rows,
  loading = false,
  errorMessage,
}) => {
  const renderChainStatus = (): React.ReactNode => {
    if (chainLoading) {
      return (
        <div className="border-2 border-zinc-300 rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-600">
          <p className="font-bold uppercase tracking-wider">AUDIT CHAIN: VERIFYING</p>
          <p className="mt-1 normal-case tracking-normal">
            Walking the append-only hash chain and recomputing record hashes.
          </p>
        </div>
      )
    }

    if (chainError) {
      return (
        <div className="border-2 border-red-600 rounded-md bg-red-50 p-3 font-mono text-xs text-red-700">
          <p className="font-bold uppercase tracking-wider">AUDIT CHAIN: ERROR</p>
          <p className="mt-1 normal-case tracking-normal break-words">
            {chainError}
          </p>
        </div>
      )
    }

    if (!chainVerification) {
      return (
        <div className="border-2 border-zinc-300 rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-700">
          <p className="font-bold uppercase tracking-wider">AUDIT CHAIN: NOT VERIFIED</p>
          <p className="mt-1 normal-case tracking-normal break-words">
            Run on-demand hash-chain verification to confirm append-only audit integrity.
            The frontend never independently computes chain validity.
          </p>
          <div className="mt-2">
            <OpsButton size="sm" variant="secondary" onClick={onVerify}>
              VERIFY
            </OpsButton>
          </div>
        </div>
      )
    }

    const isInvalid = !chainVerification.valid
    const borderColor = isInvalid ? 'border-red-600' : 'border-emerald-600'
    const bgColor = isInvalid ? 'bg-red-600' : 'bg-emerald-600'
    const textColor = isInvalid ? 'text-red-50' : 'text-emerald-50'

    return (
      <div
        className={`border-2 rounded-md ${borderColor} ${bgColor} p-3 font-mono text-xs ${textColor}`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold uppercase tracking-wider">
            AUDIT CHAIN: {chainVerification.status}
          </p>
          <StatusBadge
            label={isInvalid ? 'FAIL' : 'OK'}
            tone={isInvalid ? 'red' : 'emerald'}
          />
        </div>
        <div className="mt-1 normal-case tracking-normal space-y-1">
          <p>Verified at: {chainVerification.verifiedAt}</p>
          <p>
            Records: {chainVerification.recordCount} | Verified:{' '}
            {chainVerification.verifiedCount}
          </p>
          <div className="flex flex-wrap gap-3 mt-1">
            <span className={isInvalid ? 'text-red-200' : 'text-emerald-200'}>
              ROOT: {chainVerification.rootValid ? 'OK' : 'FAIL'}
            </span>
            <span className={isInvalid ? 'text-red-200' : 'text-emerald-200'}>
              LINKAGE: {chainVerification.linkageValid ? 'OK' : 'FAIL'}
            </span>
            <span className={isInvalid ? 'text-red-200' : 'text-emerald-200'}>
              HASHES: {chainVerification.hashesValid ? 'OK' : 'FAIL'}
            </span>
            <span className={isInvalid ? 'text-red-200' : 'text-emerald-200'}>
              MSG_IDS: {chainVerification.messageIdsValid ? 'OK' : 'FAIL'}
            </span>
          </div>
          {isInvalid && chainVerification.failures.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto">
              <p className="font-bold uppercase tracking-wider mb-1">
                FAILURES ({chainVerification.failures.length})
              </p>
              {chainVerification.failures.map((f, i) => (
                <div
                  key={`${f.recordId}-${i}`}
                  className="border border-current border-opacity-30 rounded bg-current bg-opacity-10 p-2 mb-1 break-words"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      #{i + 1} record={f.recordId.slice(0, 8)}… idx={f.index}
                    </span>
                    <span className="break-normal">
                      {f.field ? `[${f.field}] ` : ''}
                      {f.reason}
                    </span>
                  </div>
                  {f.expected && (
                    <p className="mt-1 opacity-80">
                      expected: {f.expected.slice(0, 32)}…
                    </p>
                  )}
                  {f.actual && (
                    <p className="mt-1 opacity-80">
                      actual: {f.actual.slice(0, 32)}…
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Panel
        title="TELEMETRY_INTEGRITY"
        subtitle="Hash chain / HMAC / freshness"
        actions={
          integrityAvailable && (
            <OpsButton size="sm" variant="secondary" onClick={onVerify} disabled={chainLoading}>
              {chainLoading ? 'VERIFYING' : 'VERIFY'}
            </OpsButton>
          )
        }
      >
        {renderChainStatus()}

        <div className="mt-3 border-t border-zinc-200 pt-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-2">
            VERIFICATION MODEL
          </p>
          <p className="font-mono text-[10px] text-slate-600 normal-case tracking-normal">
            Server-side read-only API endpoint. The frontend sends a verification
            request and renders only the server-computed result. Hash recomputation
            never runs in the browser.
          </p>
          <p className="font-mono text-[10px] text-slate-500 normal-case tracking-normal mt-1">
            Chain order: created_at ASC, id ASC. Genesis: prev_hash must be NULL.
            Hash: SHA-256(prev_hash + canonicalize({'{'}device_id, readings, timestamp, work_order_id{'}'}))
          </p>
        </div>
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

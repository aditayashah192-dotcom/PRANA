import React from 'react'
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

export interface PermitRowData {
  id: string
  number: string
  status: string
  work_order_id: string | null
  field_supervisor_id: string | null
  created_at: string
  workzone_name: string | null
  contractor_name: string | null
}

export interface PermitsPanelProps {
  rows: PermitRowData[]
  loading?: boolean
  errorMessage?: string | null
}

function permitTone(status: string): 'amber' | 'emerald' | 'slate' | 'red' {
  switch (status) {
    case 'ISSUED':
      return 'amber'
    case 'ACTIVE':
      return 'emerald'
    case 'CLOSED':
      return 'slate'
    default:
      return 'slate'
  }
}

export const PermitsPanel: React.FC<PermitsPanelProps> = ({
  rows,
  loading = false,
  errorMessage,
}) => {
  if (errorMessage) {
    return <DataState state="error" message={errorMessage} />
  }

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {(['ISSUED', 'ACTIVE', 'CLOSED'] as const).map((status) => {
          const tone = permitTone(status)
          const accent =
            tone === 'emerald'
              ? 'border-emerald-600 bg-emerald-600 text-emerald-50'
              : tone === 'amber'
              ? 'border-amber-500 bg-amber-500 text-amber-50'
              : 'border-zinc-300 bg-zinc-100 text-zinc-800'
          return (
            <div key={status} className={['border-2', 'rounded-md', 'px-3', 'py-2', accent].join(' ')}>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider opacity-90">
                {status}
              </span>
              <p className="font-mono text-2xl font-bold leading-none">
                {counts[status] ?? 0}
              </p>
            </div>
          )
        })}
      </div>
      <div className={OPS_TABLE_WRAPPER}>
        <table className={OPS_TABLE}>
          <thead>
            <tr>
              <th className={OPS_TABLE_TH}>PERMIT_NO</th>
              <th className={OPS_TABLE_TH}>STATUS</th>
              <th className={OPS_TABLE_TH}>WORKZONE</th>
              <th className={OPS_TABLE_TH}>CONTRACTOR</th>
              <th className={OPS_TABLE_TH}>WORK_ORDER</th>
              <th className={OPS_TABLE_TH}>FIELD_SUPERVISOR</th>
              <th className={OPS_TABLE_TH}>ISSUED</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className={OPS_EMPTY_ROW}>
                  Loading permits...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className={OPS_EMPTY_ROW}>
                  No permits in system.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id} className={OPS_TABLE_TR_HOVER}>
                  <td className={[OPS_TABLE_TD, 'text-slate-900', 'font-bold'].join(' ')}>
                    {p.number}
                  </td>
                  <td className={OPS_TABLE_TD}>
                    <StatusBadge label={p.status} tone={permitTone(p.status)} />
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-slate-900', 'max-w-[12rem]', 'break-words'].join(' ')}>
                    {p.workzone_name ?? '—'}
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-slate-900', 'max-w-[12rem]', 'break-words'].join(' ')}>
                    {p.contractor_name ?? '—'}
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                    {p.work_order_id ? p.work_order_id.slice(0, 8) + '…' : '—'}
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                    {p.field_supervisor_id ? p.field_supervisor_id.slice(0, 8) + '…' : '—'}
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                    {new Date(p.created_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default PermitsPanel

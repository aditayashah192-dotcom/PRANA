import React from 'react'
import { StatusBadge } from './StatusBadge'
import { DataState } from './DataState'
import { ContractorRowData, ContractorAllocation } from './types'
import {
  OPS_EMPTY_ROW,
  OPS_TABLE,
  OPS_TABLE_TD,
  OPS_TABLE_TH,
  OPS_TABLE_TR_HOVER,
  OPS_TABLE_WRAPPER,
} from './tableStyles'

export interface ContractorPanelProps {
  rows: ContractorRowData[]
  allocations: ContractorAllocation[]
  loading?: boolean
  errorMessage?: string | null
}

export const ContractorPanel: React.FC<ContractorPanelProps> = ({
  rows,
  allocations,
  loading = false,
  errorMessage,
}) => {
  if (errorMessage) {
    return <DataState state="error" message={errorMessage} />
  }

  const allocMap = new Map(allocations.map((a) => [a.contractorId, a.workzoneCount]))

  return (
    <div className={OPS_TABLE_WRAPPER}>
      <table className={OPS_TABLE}>
        <thead>
          <tr>
            <th className={OPS_TABLE_TH}>CONTRACTOR_ID</th>
            <th className={OPS_TABLE_TH}>NAME</th>
            <th className={[OPS_TABLE_TH, 'text-right'].join(' ')}>ALLOCATED_WZ</th>
            <th className={OPS_TABLE_TH}>STATUS</th>
            <th className={OPS_TABLE_TH}>REGISTERED</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className={OPS_EMPTY_ROW}>
                Loading contractors...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className={OPS_EMPTY_ROW}>
                No contractors registered.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const count = allocMap.get(row.id) ?? 0
              const tone = count === 0 ? 'amber' : 'emerald'
              return (
                <tr key={row.id} className={OPS_TABLE_TR_HOVER}>
                  <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                    {row.id.slice(0, 8)}…
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-slate-900', 'font-bold', 'max-w-[14rem]', 'break-words'].join(' ')}>
                    {row.name}
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-right', 'text-slate-900', 'font-bold'].join(' ')}>
                    {count}
                  </td>
                  <td className={OPS_TABLE_TD}>
                    <StatusBadge
                      label={count === 0 ? 'NO_ALLOCATION' : 'ACTIVE'}
                      tone={tone}
                    />
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export default ContractorPanel

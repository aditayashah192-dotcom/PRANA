import React from 'react'
import { StatusBadge } from './StatusBadge'
import { DataState } from './DataState'
import { WorkzoneRowData } from './types'
import {
  OPS_EMPTY_ROW,
  OPS_TABLE,
  OPS_TABLE_TD,
  OPS_TABLE_TH,
  OPS_TABLE_TR_HOVER,
  OPS_TABLE_WRAPPER,
} from './tableStyles'
import { OpsButton } from './OpsButton'

export interface WorkzoneTableProps {
  rows: WorkzoneRowData[]
  loading?: boolean
  errorMessage?: string | null
  onReallocate?: (workzoneId: string) => void
}

function deriveAssignmentTone(row: WorkzoneRowData): {
  label: string
  tone: 'emerald' | 'amber' | 'red'
} {
  if (!row.contractor_id) {
    return { label: 'UNASSIGNED', tone: 'amber' }
  }
  return { label: 'ASSIGNED', tone: 'emerald' }
}

export const WorkzoneTable: React.FC<WorkzoneTableProps> = ({
  rows,
  loading = false,
  errorMessage,
  onReallocate,
}) => {
  if (errorMessage) {
    return <DataState state="error" message={errorMessage} />
  }

  return (
    <div className={OPS_TABLE_WRAPPER}>
      <table className={OPS_TABLE}>
        <thead>
          <tr>
            <th className={OPS_TABLE_TH}>WZ_ID</th>
            <th className={OPS_TABLE_TH}>NAME</th>
            <th className={OPS_TABLE_TH}>CONTRACTOR</th>
            <th className={OPS_TABLE_TH}>STATUS</th>
            <th className={[OPS_TABLE_TH, 'text-right'].join(' ')}>LAT</th>
            <th className={[OPS_TABLE_TH, 'text-right'].join(' ')}>LON</th>
            <th className={[OPS_TABLE_TH, 'text-right'].join(' ')}>TARGET_DEPTH</th>
            {onReallocate ? <th className={[OPS_TABLE_TH, 'text-right'].join(' ')}>ACTION</th> : null}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={onReallocate ? 8 : 7} className={OPS_EMPTY_ROW}>
                Loading workzones...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={onReallocate ? 8 : 7} className={OPS_EMPTY_ROW}>
                No workzones found.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const assignment = deriveAssignmentTone(row)
              return (
                <tr key={row.id} className={OPS_TABLE_TR_HOVER}>
                  <td className={[OPS_TABLE_TD, 'text-slate-700'].join(' ')}>
                    {row.id.slice(0, 8)}…
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-slate-900', 'font-bold', 'max-w-[14rem]', 'break-words'].join(' ')}>
                    {row.name}
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-slate-900', 'max-w-[12rem]', 'break-words'].join(' ')}>
                    {row.contractor_name ?? '—'}
                  </td>
                  <td className={OPS_TABLE_TD}>
                    <StatusBadge label={assignment.label} tone={assignment.tone} />
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-right', 'text-slate-700'].join(' ')}>
                    {row.target_lat.toFixed(6)}
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-right', 'text-slate-700'].join(' ')}>
                    {row.target_lon.toFixed(6)}
                  </td>
                  <td className={[OPS_TABLE_TD, 'text-right', 'text-slate-700'].join(' ')}>
                    {row.target_depth_meters.toFixed(2)} m
                  </td>
                  {onReallocate ? (
                    <td className={[OPS_TABLE_TD, 'text-right'].join(' ')}>
                      <OpsButton
                        size="sm"
                        variant="primary"
                        onClick={() => onReallocate(row.id)}
                      >
                        {row.contractor_id ? 'REALLOCATE' : 'ALLOCATE CONTRACTOR'}
                      </OpsButton>
                    </td>
                  ) : null}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export default WorkzoneTable

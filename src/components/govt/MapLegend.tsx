import React from 'react'

const SAFETY_ROWS: Array<{ state: string; color: string; description: string }> = [
  { state: 'SAFE', color: '#059669', description: 'Backend aggregate SAFE' },
  { state: 'WARMING', color: '#D97706', description: 'Sensor warmup in progress' },
  { state: 'WARNING', color: '#D97706', description: 'Marginal sensor reading' },
  { state: 'LOCKOUT', color: '#DC2626', description: 'Geofence/depth/H2S/O2/battery critical' },
  { state: 'UNKNOWN', color: '#6B7280', description: 'Stale / missing / ambiguous telemetry' },
]

export const MapLegend: React.FC = () => {
  return (
    <div className="border-2 border-zinc-200 rounded-md bg-white p-3 shadow-panel">
      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-2">
        MAP_LEGEND
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {SAFETY_ROWS.map((row) => (
          <div key={row.state} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block w-3 h-3 rounded-sm border-2 border-slate-900"
              style={{ background: row.color }}
            />
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-900">
                {row.state}
              </p>
              <p className="font-mono text-[9px] text-slate-600 truncate">
                {row.description}
              </p>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 col-span-2 pt-1 border-t border-zinc-200 mt-1">
          <span
            aria-hidden="true"
            className="inline-block w-3 h-3 rounded-sm border-2 border-amber-500"
            style={{ background: '#0F172A' }}
          />
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-900">
              UNASSIGNED
            </p>
            <p className="font-mono text-[9px] text-slate-600">
              Assignment state, not safety. Renders on top of any safety color.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MapLegend

import React from 'react'
import { StatusBadge } from './StatusBadge'

export interface ScopeCalloutsProps {
  className?: string
}

export const ScopeCallouts: React.FC<ScopeCalloutsProps> = ({ className = '' }) => {
  return (
    <div className={['grid grid-cols-1 md:grid-cols-3 gap-2', className].join(' ')}>
      <div className="border-2 border-zinc-200 rounded-md bg-white px-3 py-2 flex items-center gap-3 shadow-panel hover:shadow-panel-md transition-shadow duration-150">
        <StatusBadge label="SCOPE" tone="amber" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-900">
          OVERSIGHT ONLY
        </span>
      </div>
      <div className="border-2 border-zinc-200 rounded-md bg-white px-3 py-2 flex items-center gap-3 shadow-panel hover:shadow-panel-md transition-shadow duration-150">
        <StatusBadge label="PERMITS" tone="red" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-900">
          CANNOT ISSUE FIELD PERMITS
        </span>
      </div>
      <div className="border-2 border-zinc-200 rounded-md bg-white px-3 py-2 flex items-center gap-3 shadow-panel hover:shadow-panel-md transition-shadow duration-150">
        <StatusBadge label="STAFF" tone="red" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-slate-900">
          CANNOT ASSIGN FIELD STAFF
        </span>
      </div>
    </div>
  )
}

export default ScopeCallouts

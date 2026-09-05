'use client'

import dynamic from 'next/dynamic'
import type { WorkzoneState } from './WorkzoneMap'

const WorkzoneMap = dynamic(() => import('./WorkzoneMap').then((m) => m.WorkzoneMap), {
  ssr: false,
  loading: () => (
    <div className="border-2 border-zinc-200 rounded-md bg-slate-50 p-6 font-mono text-xs uppercase tracking-wider text-slate-700">
      Loading operations map...
    </div>
  ),
})

export interface WorkzoneMapClientProps {
  workzones: WorkzoneState[]
  selectedId: string | null
  onSelect: (workzoneId: string) => void
}

export const WorkzoneMapClient: React.FC<WorkzoneMapClientProps> = (
  props,
) => {
  return <WorkzoneMap {...props} />
}

export default WorkzoneMapClient

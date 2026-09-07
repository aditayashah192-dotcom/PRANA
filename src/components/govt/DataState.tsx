import React from 'react'

export interface DataStateProps {
  state: 'loading' | 'empty' | 'error' | 'info'
  title?: string
  message?: string
  children?: React.ReactNode
}

const TONE: Record<DataStateProps['state'], string> = {
  loading: 'border-zinc-200 bg-slate-50 text-slate-700',
  empty: 'border-zinc-200 bg-slate-50 text-slate-700',
  error: 'border-red-600 bg-red-50 text-red-700',
  info: 'border-amber-500 bg-amber-50 text-amber-700',
}

export const DataState: React.FC<DataStateProps> = ({
  state,
  title,
  message,
  children,
}) => {
  return (
    <div
      className={[
        'border-2',
        'rounded-md',
        'px-3',
        'py-2',
        'font-mono',
        'text-xs',
        'uppercase',
        'tracking-wider',
        'shadow-panel',
        TONE[state],
      ].join(' ')}
    >
      {title ? <p className="font-bold">{title}</p> : null}
      {message ? <p className="mt-1 normal-case tracking-normal">{message}</p> : null}
      {children}
    </div>
  )
}

export default DataState

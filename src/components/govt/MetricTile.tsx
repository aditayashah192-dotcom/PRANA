import React from 'react'

export interface MetricTileProps {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'emerald' | 'amber' | 'red' | 'inverse'
  loading?: boolean
}

const TONE: Record<NonNullable<MetricTileProps['tone']>, { card: string; value: string; label: string }> = {
  default: {
    card: 'border-zinc-200 bg-white',
    value: 'text-slate-900',
    label: 'text-slate-600',
  },
  emerald: {
    card: 'border-emerald-600 bg-emerald-600',
    value: 'text-emerald-50',
    label: 'text-emerald-100',
  },
  amber: {
    card: 'border-amber-500 bg-amber-500',
    value: 'text-amber-50',
    label: 'text-amber-100',
  },
  red: {
    card: 'border-red-600 bg-red-600',
    value: 'text-red-50',
    label: 'text-red-100',
  },
  inverse: {
    card: 'border-slate-900 bg-slate-900',
    value: 'text-slate-50',
    label: 'text-amber-400',
  },
}

export const MetricTile: React.FC<MetricTileProps> = ({
  label,
  value,
  hint,
  tone = 'default',
  loading = false,
}) => {
  const styles = TONE[tone]
  return (
    <div className={['border-2', 'rounded-md', 'px-3', 'py-2', 'flex', 'flex-col', 'gap-1', styles.card].join(' ')}>
      <span className={['font-mono', 'text-[10px]', 'font-bold', 'uppercase', 'tracking-wider', styles.label].join(' ')}>
        {label}
      </span>
      <span className={['font-mono', 'text-2xl', 'font-bold', 'leading-none', styles.value].join(' ')}>
        {loading ? '—' : value}
      </span>
      {hint ? (
        <span className={['font-mono', 'text-[10px]', 'uppercase', 'tracking-wider', styles.label].join(' ')}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export default MetricTile

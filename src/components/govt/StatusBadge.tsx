import React from 'react'

type Tone = 'slate' | 'emerald' | 'amber' | 'red' | 'zinc' | 'inverse'

const TONE_CLASSES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-800 border-slate-300',
  emerald: 'bg-emerald-600 text-emerald-50 border-emerald-700',
  amber: 'bg-amber-500 text-amber-50 border-amber-600',
  red: 'bg-red-600 text-red-50 border-red-700',
  zinc: 'bg-zinc-100 text-zinc-700 border-zinc-300',
  inverse: 'bg-slate-900 text-slate-50 border-slate-900',
}

export interface StatusBadgeProps {
  label: string
  tone?: Tone
  className?: string
  outline?: boolean
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  tone = 'slate',
  className = '',
  outline = false,
}) => {
  const toneClasses = outline
    ? `bg-white text-${tone === 'slate' ? 'slate-700' : tone} border-${tone === 'slate' ? 'zinc-300' : tone}-600`
    : TONE_CLASSES[tone]

  return (
    <span
      className={[
        'inline-flex',
        'items-center',
        'gap-1',
        'px-2',
        'py-0.5',
        'rounded-md',
        'border',
        'transition-colors',
        'duration-150',
        'font-mono',
        'text-[10px]',
        'font-bold',
        'uppercase',
        'tracking-wider',
        'leading-none',
        toneClasses,
        className,
      ].join(' ')}
    >
      {label}
    </span>
  )
}

export default StatusBadge

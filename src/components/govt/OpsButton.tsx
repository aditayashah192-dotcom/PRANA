import React from 'react'

type Variant = 'primary' | 'secondary' | 'safety' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

export interface OpsButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const BASE = [
  'inline-flex',
  'items-center',
  'justify-center',
  'gap-2',
  'font-mono',
  'font-bold',
  'uppercase',
  'tracking-wider',
  'rounded-md',
  'border-2',
  'shadow-panel',
  'hover:shadow-panel-md',
  'active:shadow-none',
  'disabled:cursor-not-allowed',
  'disabled:opacity-50',
  'disabled:shadow-none',
  'select-none',
]

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1 text-[10px]',
  md: 'px-4 py-2 text-xs',
}

const VARIANT: Record<Variant, string> = {
  primary: [
    'bg-slate-900',
    'border-slate-900',
    'text-slate-50',
    'hover:bg-slate-800',
    'hover:border-slate-800',
    'active:bg-black',
    'disabled:bg-slate-700',
    'disabled:border-slate-700',
  ].join(' '),
  secondary: [
    'bg-white',
    'border-zinc-300',
    'text-slate-900',
    'hover:bg-slate-50',
    'hover:border-zinc-400',
    'active:bg-slate-100',
  ].join(' '),
  safety: [
    'bg-amber-600',
    'border-amber-600',
    'text-amber-50',
    'hover:bg-amber-700',
    'hover:border-amber-700',
    'active:bg-amber-800',
  ].join(' '),
  danger: [
    'bg-red-600',
    'border-red-600',
    'text-red-50',
    'hover:bg-red-700',
    'hover:border-red-700',
    'active:bg-red-800',
  ].join(' '),
  ghost: [
    'bg-transparent',
    'border-transparent',
    'text-slate-700',
    'hover:bg-slate-100',
    'active:bg-slate-200',
    'shadow-none',
    'hover:shadow-none',
  ].join(' '),
}

export const OpsButton: React.FC<OpsButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}) => {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={[...BASE, SIZE[size], VARIANT[variant], className].join(' ')}
    >
      {loading ? (
        <span aria-hidden="true" className="inline-block w-2 h-2 rounded-md bg-current animate-pulse" />
      ) : null}
      <span>{children}</span>
    </button>
  )
}

export default OpsButton

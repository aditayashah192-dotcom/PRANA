import React from 'react'

export interface PanelProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  tone?: 'default' | 'critical'
  noPadding?: boolean
  density?: 'normal' | 'dense'
}

export const Panel: React.FC<PanelProps> = ({
  title,
  subtitle,
  actions,
  children,
  className = '',
  tone = 'default',
  noPadding = false,
  density = 'normal',
}) => {
  const border = tone === 'critical' ? 'border-red-600' : 'border-zinc-200'
  const headerBorder = tone === 'critical' ? 'border-red-700' : 'border-zinc-200'
  const headerBg = tone === 'critical' ? 'bg-red-700' : 'bg-slate-700'
  const titleColor = tone === 'critical' ? 'text-red-50' : 'text-slate-100'
  const subtitleColor = tone === 'critical' ? 'text-red-200' : 'text-amber-400'
  const bodyPad = noPadding ? '' : density === 'dense' ? 'p-3' : 'p-4'

  return (
    <section
      className={[
        'border-2',
        border,
        'rounded-md',
        'bg-white',
        'overflow-hidden',
        'shadow-panel',
        'transition-shadow',
        'duration-150',
        'hover:shadow-panel-md',
        className,
      ].join(' ')}
    >
      <header
        className={[
          'flex',
          'items-start',
          'justify-between',
          'gap-3',
          'px-4',
          'py-2',
          'border-b-2',
          headerBorder,
          headerBg,
        ].join(' ')}
      >
        <div className="min-w-0">
          <h2
            className={[
              'font-mono',
              'text-xs',
              'font-bold',
              'uppercase',
              'tracking-wider',
              titleColor,
              'truncate',
            ].join(' ')}
          >
            {title}
          </h2>
          {subtitle ? (
            <p
              className={[
                'font-mono',
                'text-[10px]',
                'uppercase',
                'tracking-wider',
                subtitleColor,
                'mt-0.5',
                'truncate',
              ].join(' ')}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0 flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className={['bg-white', bodyPad].join(' ')}>{children}</div>
    </section>
  )
}

export default Panel

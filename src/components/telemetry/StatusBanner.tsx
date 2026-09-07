import React from 'react';

export type SafetyState = 'SAFE' | 'WARMING' | 'UNKNOWN' | 'WARNING' | 'LOCKOUT';

export interface StatusBannerProps {
  state: SafetyState;
  reason: string;
  className?: string;
}

interface StateStyle {
  bg: string;
  border: string;
  text: string;
  label: string;
  dot: string;
}

const STATE_STYLES: Record<SafetyState, StateStyle> = {
  SAFE: {
    bg: 'bg-emerald-600',
    border: 'border-emerald-700',
    text: 'text-emerald-50',
    label: 'SAFE',
    dot: 'bg-emerald-300',
  },
  WARMING: {
    bg: 'bg-amber-500',
    border: 'border-amber-600',
    text: 'text-amber-50',
    label: 'WARMING',
    dot: 'bg-amber-200',
  },
  WARNING: {
    bg: 'bg-amber-500',
    border: 'border-amber-600',
    text: 'text-amber-50',
    label: 'WARNING',
    dot: 'bg-amber-200',
  },
  UNKNOWN: {
    bg: 'bg-red-600',
    border: 'border-red-700',
    text: 'text-red-50',
    label: 'UNKNOWN',
    dot: 'bg-red-300',
  },
  LOCKOUT: {
    bg: 'bg-red-600',
    border: 'border-red-700',
    text: 'text-red-50',
    label: 'LOCKOUT',
    dot: 'bg-red-300',
  },
};

const formatReason = (reason: string): string => {
  if (!reason) return 'NO_REASON_PROVIDED';
  return reason.replace(/_/g, ' ');
};

export const StatusBanner: React.FC<StatusBannerProps> = ({
  state,
  reason,
  className = '',
}) => {
  const style = STATE_STYLES[state];
  const isLockout = state === 'LOCKOUT';
  const isUnknown = state === 'UNKNOWN';

  const baseClasses = [
    'flex',
    'items-center',
    'justify-between',
    'gap-3',
    'border-2',
    'px-4',
    'py-3',
    'rounded-md',
    'font-mono',
    'uppercase',
    'tracking-wider',
    'select-none',
    'shadow-panel',
    style.bg,
    style.border,
    style.text,
  ];

  if (isLockout || isUnknown) {
    baseClasses.push('animate-pulse');
  }

  if (className) {
    baseClasses.push(className);
  }

  return (
    <div
      role="status"
      aria-live={isLockout || isUnknown ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-state={state}
      className={baseClasses.join(' ')}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          aria-hidden="true"
          className={['inline-block', 'w-3', 'h-3', 'rounded-md', 'shrink-0', style.dot].join(' ')}
        />
        <span className="text-base font-bold truncate">{style.label}</span>
      </div>
      <span className="text-sm font-mono normal-case tracking-normal truncate text-right">
        {formatReason(reason)}
      </span>
    </div>
  );
};

export default StatusBanner;

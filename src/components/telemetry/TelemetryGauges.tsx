import React from 'react';

export interface TelemetryGaugesProps {
  h2s: number;
  o2: number;
  depth: number;
  battery: number;
  targetDepth: number;
}

type Severity = 'nominal' | 'warning' | 'critical';

interface MetricCardProps {
  label: string;
  value: string;
  unit: string;
  severity: Severity;
  hint?: string;
  precision?: number;
}

const H2S_WARN_PPM = 10;
const H2S_CRIT_PPM = 15;

const O2_LOW_WARN_PCT = 19.5;
const O2_HIGH_WARN_PCT = 23.5;
const O2_LOW_CRIT_PCT = 18.5;
const O2_HIGH_CRIT_PCT = 24.0;

const BATTERY_WARN_PCT = 20;
const BATTERY_CRIT_PCT = 10;

const DEPTH_TOLERANCE_M = 0.5;

const formatNumber = (value: number, precision: number): string => {
  if (!Number.isFinite(value)) return '--';
  return value.toFixed(precision);
};

const severityClasses = (severity: Severity): { card: string; value: string; badge: string } => {
  switch (severity) {
    case 'critical':
      return {
        card: 'border-red-600 bg-red-50',
        value: 'text-red-700',
        badge: 'bg-red-600 text-red-50',
      };
    case 'warning':
      return {
        card: 'border-amber-500 bg-amber-50',
        value: 'text-amber-700',
        badge: 'bg-amber-500 text-amber-50',
      };
    case 'nominal':
    default:
      return {
        card: 'border-zinc-200 bg-white',
        value: 'text-slate-900',
        badge: 'bg-emerald-600 text-emerald-50',
      };
  }
};

const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  unit,
  severity,
  hint,
}) => {
  const styles = severityClasses(severity);
  const badgeText =
    severity === 'critical' ? 'CRIT' : severity === 'warning' ? 'WARN' : 'OK';

  return (
    <div
      role="group"
      aria-label={`${label} metric`}
      className={[
        'border-2',
        'rounded-md',
        'p-3',
        'flex',
        'flex-col',
        'gap-2',
        'min-w-0',
        'shadow-panel',
        'transition-shadow',
        'duration-150',
        'hover:shadow-panel-md',
        styles.card,
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-700 truncate">
          {label}
        </span>
        <span
          className={[
            'text-[10px]',
            'font-mono',
            'font-bold',
            'px-2',
            'py-0.5',
            'rounded-md',
            'uppercase',
            'tracking-wider',
            styles.badge,
          ].join(' ')}
        >
          {badgeText}
        </span>
      </div>
      <div className="flex items-baseline gap-1 min-w-0">
        <span className={['text-2xl', 'font-mono', 'font-bold', 'truncate', styles.value].join(' ')}>
          {value}
        </span>
        <span className="text-xs font-mono text-slate-600 shrink-0">{unit}</span>
      </div>
      {hint ? (
        <span className="text-[10px] font-mono text-slate-600 truncate">{hint}</span>
      ) : null}
    </div>
  );
};

const classifyH2s = (h2s: number): Severity => {
  if (!Number.isFinite(h2s)) return 'critical';
  if (h2s >= H2S_CRIT_PPM) return 'critical';
  if (h2s >= H2S_WARN_PPM) return 'warning';
  return 'nominal';
};

const classifyO2 = (o2: number): Severity => {
  if (!Number.isFinite(o2)) return 'critical';
  if (o2 <= O2_LOW_CRIT_PCT || o2 >= O2_HIGH_CRIT_PCT) return 'critical';
  if (o2 <= O2_LOW_WARN_PCT || o2 >= O2_HIGH_WARN_PCT) return 'warning';
  return 'nominal';
};

const classifyBattery = (battery: number): Severity => {
  if (!Number.isFinite(battery)) return 'critical';
  if (battery < BATTERY_CRIT_PCT) return 'critical';
  if (battery < BATTERY_WARN_PCT) return 'warning';
  return 'nominal';
};

const classifyDepth = (depth: number, targetDepth: number): Severity => {
  if (!Number.isFinite(depth) || !Number.isFinite(targetDepth)) return 'critical';
  const delta = Math.abs(depth - targetDepth);
  if (delta > DEPTH_TOLERANCE_M) return 'critical';
  return 'nominal';
};

export const TelemetryGauges: React.FC<TelemetryGaugesProps> = ({
  h2s,
  o2,
  depth,
  battery,
  targetDepth,
}) => {
  const h2sSeverity = classifyH2s(h2s);
  const o2Severity = classifyO2(o2);
  const depthSeverity = classifyDepth(depth, targetDepth);
  const batterySeverity = classifyBattery(battery);

  const depthDelta = Number.isFinite(depth) && Number.isFinite(targetDepth)
    ? depth - targetDepth
    : NaN;

  return (
    <div
      role="region"
      aria-label="Live telemetry gauges"
      className="grid grid-cols-2 gap-3 w-full"
    >
      <MetricCard
        label="H₂S"
        value={formatNumber(h2s, 1)}
        unit="ppm"
        severity={h2sSeverity}
        hint={`limit ${H2S_WARN_PPM}/${H2S_CRIT_PPM} ppm`}
      />
      <MetricCard
        label="O₂"
        value={formatNumber(o2, 1)}
        unit="%"
        severity={o2Severity}
        hint={`safe ${O2_LOW_WARN_PCT}-${O2_HIGH_WARN_PCT}%`}
      />
      <MetricCard
        label="Depth"
        value={formatNumber(depth, 2)}
        unit="m"
        severity={depthSeverity}
        hint={
          Number.isFinite(depthDelta)
            ? `target ${formatNumber(targetDepth, 2)} m (Δ ${depthDelta >= 0 ? '+' : ''}${formatNumber(depthDelta, 2)} m)`
            : `target ${formatNumber(targetDepth, 2)} m`
        }
      />
      <MetricCard
        label="Battery"
        value={formatNumber(battery, 0)}
        unit="%"
        severity={batterySeverity}
        hint={`warn <${BATTERY_WARN_PCT}% / crit <${BATTERY_CRIT_PCT}%`}
      />
    </div>
  );
};

export default TelemetryGauges;

import { calculateHaversineDistance } from '@/utils/geoUtils';

export type SafetyState = 'SAFE' | 'WARMING' | 'UNKNOWN' | 'WARNING' | 'LOCKOUT';

export interface TelemetryPayload {
  h2s_ppm: number;
  o2_percent: number;
  depth_meters: number;
  battery_percent: number;
  is_warming_up?: boolean;
  user_lat: number;
  user_lon: number;
}

export interface WorkzoneTarget {
  target_lat: number;
  target_lon: number;
  target_depth_meters: number;
}

export interface ComplianceResult {
  state: SafetyState;
  reason: string;
  metrics: {
    geofence_distance_m: number;
    depth_delta_m: number;
  };
}

export function evaluate(
  telemetry: TelemetryPayload,
  target: WorkzoneTarget
): ComplianceResult {
  const {
    h2s_ppm,
    o2_percent,
    depth_meters,
    battery_percent,
    is_warming_up,
    user_lat,
    user_lon,
  } = telemetry;
  const { target_lat, target_lon, target_depth_meters } = target;

  const invalid =
    h2s_ppm == null ||
    o2_percent == null ||
    depth_meters == null ||
    battery_percent == null ||
    user_lat == null ||
    user_lon == null ||
    target_lat == null ||
    target_lon == null ||
    target_depth_meters == null ||
    Number.isNaN(h2s_ppm) ||
    Number.isNaN(o2_percent) ||
    Number.isNaN(depth_meters) ||
    Number.isNaN(battery_percent) ||
    Number.isNaN(user_lat) ||
    Number.isNaN(user_lon) ||
    Number.isNaN(target_lat) ||
    Number.isNaN(target_lon) ||
    Number.isNaN(target_depth_meters);

  if (invalid) {
    return {
      state: 'LOCKOUT',
      reason: 'INVALID_OR_MISSING_SENSOR_DATA',
      metrics: {
        geofence_distance_m: 0,
        depth_delta_m: 0,
      },
    };
  }

  if (
    h2s_ppm < 0 ||
    o2_percent < 0 ||
    depth_meters < 0 ||
    battery_percent < 0
  ) {
    return {
      state: 'LOCKOUT',
      reason: 'INVALID_OR_MISSING_SENSOR_DATA',
      metrics: {
        geofence_distance_m: 0,
        depth_delta_m: 0,
      },
    };
  }

  const geofence_distance_m = calculateHaversineDistance(
    user_lat,
    user_lon,
    target_lat,
    target_lon
  );
  const depth_delta_m = Math.abs(depth_meters - target_depth_meters);

  if (geofence_distance_m > 50.0) {
    return {
      state: 'LOCKOUT',
      reason: 'GEOFENCE_BREACH_OUTSIDE_50M',
      metrics: {
        geofence_distance_m,
        depth_delta_m,
      },
    };
  }

  if (depth_delta_m > 0.5) {
    return {
      state: 'LOCKOUT',
      reason: 'DEPTH_MISMATCH_PROBE_NOT_IN_PIT',
      metrics: {
        geofence_distance_m,
        depth_delta_m,
      },
    };
  }

  if (h2s_ppm > 15.0) {
    return {
      state: 'LOCKOUT',
      reason: 'CRITICAL_H2S_TOXICITY',
      metrics: {
        geofence_distance_m,
        depth_delta_m,
      },
    };
  }

  if (o2_percent < 18.5 || o2_percent > 24.0) {
    return {
      state: 'LOCKOUT',
      reason: 'CRITICAL_O2_HAZARD',
      metrics: {
        geofence_distance_m,
        depth_delta_m,
      },
    };
  }

  if (battery_percent < 10.0) {
    return {
      state: 'LOCKOUT',
      reason: 'CRITICAL_BATTERY_EXHAUSTION',
      metrics: {
        geofence_distance_m,
        depth_delta_m,
      },
    };
  }

  if (h2s_ppm > 10.0) {
    return {
      state: 'WARNING',
      reason: 'ELEVATED_H2S_CONCENTRATION',
      metrics: {
        geofence_distance_m,
        depth_delta_m,
      },
    };
  }

  if (
    (o2_percent >= 18.5 && o2_percent < 19.5) ||
    (o2_percent > 23.5 && o2_percent <= 24.0)
  ) {
    return {
      state: 'WARNING',
      reason: 'MARGINAL_O2_LEVELS',
      metrics: {
        geofence_distance_m,
        depth_delta_m,
      },
    };
  }

  if (battery_percent >= 10.0 && battery_percent < 20.0) {
    return {
      state: 'WARNING',
      reason: 'LOW_BATTERY',
      metrics: {
        geofence_distance_m,
        depth_delta_m,
      },
    };
  }

  if (is_warming_up === true) {
    return {
      state: 'WARMING',
      reason: 'SENSOR_WARMUP_IN_PROGRESS',
      metrics: {
        geofence_distance_m,
        depth_delta_m,
      },
    };
  }

  return {
    state: 'SAFE',
    reason: 'ALL_SYSTEMS_NOMINAL',
    metrics: {
      geofence_distance_m,
      depth_delta_m,
    },
  };
}

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unauthorized(message: string): Response {
  return NextResponse.json({ error: message }, { status: 401 })
}
function forbidden(message: string): Response {
  return NextResponse.json({ error: message }, { status: 403 })
}
function serverError(message: string): Response {
  return NextResponse.json({ error: message }, { status: 500 })
}

interface WorkzoneState {
  workzone_id: string
  contractor_id: string | null
  name: string
  target_lat: number
  target_lon: number
  target_depth_meters: number
  state: {
    workzone_id: string
    contractor_id: string | null
    target_lat: number
    target_lon: number
    target_depth_meters: number
    authoritative_work_order_id: string | null
    authoritative_work_order_status: string | null
    authoritative_device_id: string | null
    latest_scan_log_id: string | null
    latest_scan_timestamp: string | null
    latest_decision: string | null
    latest_h2s_ppm: string | null
    latest_o2_percent: string | null
    latest_depth_meters: string | null
    latest_battery_percent: string | null
    telemetry_age_seconds: number | null
    freshness_state: 'FRESH' | 'STALE' | 'MISSING' | 'AMBIGUOUS'
    aggregate_state: 'SAFE' | 'WARMING' | 'WARNING' | 'UNKNOWN' | 'LOCKOUT'
    aggregate_reason: string
    freshness_window_seconds: number
    computed_at: string
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const response = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (!user || userError) {
    return unauthorized('unauthenticated')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError || !profile) {
    return forbidden('profile_lookup_failed')
  }
  if (profile.role !== 'contractor_admin') {
    return forbidden('contractor_admin_role_required')
  }

  const { data, error } = await supabase
    .from('workzone_authoritative_state_view')
    .select(
      'workzone_id, contractor_id, name, target_lat, target_lon, target_depth_meters, state',
    )
    .limit(500)

  if (error) {
    console.error('view_query_failed:', error.message, error.code, error.details)
    return serverError('view_query_failed: ' + (error.message ?? ''))
  }

  const rows: WorkzoneState[] = ((data ?? []) as WorkzoneState[]).filter(
    (r) =>
      typeof r?.target_lat === 'number' &&
      typeof r?.target_lon === 'number' &&
      Number.isFinite(r.target_lat) &&
      Number.isFinite(r.target_lon) &&
      !(r.target_lat === 0 && r.target_lon === 0),
  )

  return NextResponse.json({ workzones: rows })
}

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type LatestTelemetryResponse = {
  id: string
  device_id: string
  work_order_id: string | null
  timestamp: number | null
  h2s: number | null
  o2: number | null
  depth: number | null
  battery: number | null
  created_at: string | null
  decision: string | null
}

function badRequest(message: string): Response {
  return NextResponse.json({ error: message }, { status: 400 })
}

function unauthorized(message: string): Response {
  return NextResponse.json({ error: message }, { status: 401 })
}

function notFound(message: string): Response {
  return NextResponse.json({ error: message }, { status: 404 })
}

function serverError(message: string): Response {
  return NextResponse.json({ error: message }, { status: 500 })
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function GET(request: NextRequest): Promise<Response> {
  const searchParams = request.nextUrl.searchParams
  const deviceId = searchParams.get('device_id')

  if (!deviceId) {
    return badRequest('missing_device_id')
  }

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
    }
  )

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (!user || userError) {
    return unauthorized('unauthenticated')
  }

  const { data: scanLog, error: scanLogError } = await supabase
    .from('scan_logs')
    .select('id, device_id, work_order_id, readings, created_at, timestamp, decision')
    .eq('device_id', deviceId)
    .order('timestamp', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{
      id: string
      device_id: string
      work_order_id: string | null
      readings: Record<string, unknown>
      created_at: string
      timestamp: string | null
      decision: string | null
    }>()

  if (scanLogError) {
    return serverError('scan_log_lookup_failed')
  }

  if (!scanLog) {
    return notFound('no_telemetry')
  }

  const readings = (scanLog.readings ?? {}) as Record<string, unknown>

  const topLevelTimestamp = scanLog.timestamp
    ? new Date(scanLog.timestamp).getTime()
    : toNumber(readings.timestamp ?? null)

  const payload: LatestTelemetryResponse = {
    id: scanLog.id,
    device_id: scanLog.device_id,
    work_order_id: scanLog.work_order_id,
    timestamp: topLevelTimestamp,
    h2s: toNumber(readings.h2s_ppm ?? null),
    o2: toNumber(readings.o2_percent ?? null),
    depth: toNumber(readings.depth_meters ?? null),
    battery: toNumber(readings.battery_percent ?? null),
    created_at: scanLog.created_at,
    decision: scanLog.decision,
  }

  return NextResponse.json(payload)
}

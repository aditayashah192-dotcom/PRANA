import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { verifyDeviceHmac, verifyTimestampFreshness, type JsonValue } from '@/lib/deviceAuth'
import { canonicalize } from '@/lib/canonicalize'
import { evaluate } from '@/lib/complianceEngine'
import { getTestNotificationProvider } from '@/lib/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type IngestPayload = {
  device_id?: unknown
  readings?: unknown
  timestamp?: unknown
  signature?: unknown
  work_order_id?: unknown
}

type DeviceRow = {
  id: string
  is_active: boolean | null
  secret_hash: string | null
  workzone_id: string | null
}

type WorkOrderRow = {
  id: string
  workzone_id: string | null
}

type WorkzoneRow = {
  id: string
  target_lat: number | null
  target_lon: number | null
  target_depth_meters: number | null
}

type ScanLogRow = {
  row_hash: string | null
}

type WorkzoneTarget = {
  target_lat: number
  target_lon: number
  target_depth_meters: number
}

let cachedClient: SupabaseClient | null = null

function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) {
    return cachedClient
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured.')
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.')
  }
  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedClient
}

function isUuid(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeReadings(raw: unknown): JsonValue {
  if (raw === undefined) {
    return {}
  }
  if (raw === null) {
    return null
  }
  if (
    typeof raw === 'string' ||
    typeof raw === 'number' ||
    typeof raw === 'boolean'
  ) {
    return raw
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizeReadings(item)) as JsonValue
  }
  if (typeof raw === 'object') {
    const result: { [key: string]: JsonValue } = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      result[key] = normalizeReadings(value)
    }
    return result
  }
  return null
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function resolveWorkzoneTarget(
  supabase: SupabaseClient,
  workOrderId: string,
  deviceWorkzoneId: string | null
): Promise<WorkzoneTarget | null> {
  const { data: workOrder, error: workOrderError } = await supabase
    .from('work_orders')
    .select('id, workzone_id')
    .eq('id', workOrderId)
    .maybeSingle<WorkOrderRow>()

  if (workOrderError) {
    throw new Error('work_order_lookup_failed')
  }
  if (!workOrder) {
    return null
  }

  const workzoneId = workOrder.workzone_id ?? deviceWorkzoneId
  if (!workzoneId) {
    return null
  }

  const { data: workzone, error: workzoneError } = await supabase
    .from('workzones')
    .select('id, target_lat, target_lon, target_depth_meters')
    .eq('id', workzoneId)
    .maybeSingle<WorkzoneRow>()

  if (workzoneError) {
    throw new Error('workzone_lookup_failed')
  }
  if (!workzone) {
    return null
  }

  if (
    !isFiniteNumber(workzone.target_lat) ||
    !isFiniteNumber(workzone.target_lon) ||
    !isFiniteNumber(workzone.target_depth_meters)
  ) {
    return null
  }

  return {
    target_lat: workzone.target_lat,
    target_lon: workzone.target_lon,
    target_depth_meters: workzone.target_depth_meters,
  }
}

export async function POST(request: Request): Promise<Response> {
  let payload: IngestPayload
  try {
    payload = (await request.json()) as IngestPayload
  } catch {
    return jsonResponse(400, { error: 'invalid_json' })
  }

  const { device_id, readings, timestamp, signature, work_order_id } = payload

  if (!isUuid(device_id)) {
    return jsonResponse(400, { error: 'invalid_device_id' })
  }
  if (!isUuid(work_order_id)) {
    return jsonResponse(400, { error: 'invalid_work_order_id' })
  }
  if (typeof signature !== 'string' || signature.length === 0) {
    return jsonResponse(400, { error: 'missing_signature' })
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return jsonResponse(400, { error: 'invalid_timestamp' })
  }

  const timestampIso = new Date(timestamp).toISOString()

  const normalizedReadings = normalizeReadings(readings)

  if (!verifyTimestampFreshness(timestamp, 30)) {
    return jsonResponse(400, { error: 'stale_timestamp' })
  }

  const supabase = getSupabaseAdmin()

  const { data: device, error: deviceError } = await supabase
    .from('devices')
    .select('id, is_active, secret_hash, workzone_id')
    .eq('id', device_id)
    .maybeSingle<DeviceRow>()

  if (deviceError) {
    return jsonResponse(500, { error: 'device_lookup_failed' })
  }
  if (!device) {
    return jsonResponse(401, { error: 'unknown_device' })
  }
  if (device.is_active === false) {
    return jsonResponse(401, { error: 'device_inactive' })
  }
  if (!device.secret_hash) {
    return jsonResponse(401, { error: 'device_secret_missing' })
  }

  const signedPayload = {
    device_id,
    readings: normalizedReadings,
    timestamp,
    work_order_id,
  }

  const signatureValid = verifyDeviceHmac(
    signedPayload,
    signature,
    device.secret_hash
  )
  if (!signatureValid) {
    return jsonResponse(401, { error: 'invalid_signature' })
  }

  let target: WorkzoneTarget | null
  try {
    target = await resolveWorkzoneTarget(supabase, work_order_id, device.workzone_id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lookup_failed'
    return jsonResponse(500, { error: message })
  }
  if (!target) {
    return jsonResponse(404, { error: 'workzone_target_not_found' })
  }

  const telemetryRecord = (normalizedReadings ?? {}) as Record<string, unknown>
  const h2sRaw = telemetryRecord.h2s_ppm
  const o2Raw = telemetryRecord.o2_percent
  const depthRaw = telemetryRecord.depth_meters
  const batteryRaw = telemetryRecord.battery_percent
  const isWarmingRaw = telemetryRecord.is_warming_up
  const userLatRaw = telemetryRecord.user_lat
  const userLonRaw = telemetryRecord.user_lon

  const h2s = isFiniteNumber(h2sRaw) ? h2sRaw : Number(h2sRaw)
  const o2 = isFiniteNumber(o2Raw) ? o2Raw : Number(o2Raw)
  const depth = isFiniteNumber(depthRaw) ? depthRaw : Number(depthRaw)
  const battery = isFiniteNumber(batteryRaw) ? batteryRaw : Number(batteryRaw)
  const userLat = isFiniteNumber(userLatRaw) ? userLatRaw : Number(userLatRaw)
  const userLon = isFiniteNumber(userLonRaw) ? userLonRaw : Number(userLonRaw)
  const isWarming = typeof isWarmingRaw === 'boolean' ? isWarmingRaw : undefined

  const compliance = evaluate(
    {
      h2s_ppm: h2s,
      o2_percent: o2,
      depth_meters: depth,
      battery_percent: battery,
      is_warming_up: isWarming,
      user_lat: userLat,
      user_lon: userLon,
    },
    target
  )

  const { data: latest, error: latestError } = await supabase
    .from('scan_logs')
    .select('row_hash')
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<ScanLogRow>()

  if (latestError) {
    return jsonResponse(500, { error: 'hash_lookup_failed' })
  }

  const prevHash = latest?.row_hash ?? ''
  const payloadString = canonicalize(signedPayload as JsonValue)
  const rowHash = createHash('sha256')
    .update(prevHash + payloadString, 'utf8')
    .digest('hex')
  const messageId = createHash('sha256')
    .update(payloadString, 'utf8')
    .digest('hex')

  const { error: insertError } = await supabase.from('scan_logs').insert({
    device_id,
    work_order_id,
    readings: normalizedReadings,
    decision: compliance.state,
    prev_hash: prevHash || null,
    row_hash: rowHash,
    timestamp: timestampIso,
    message_id: messageId,
  })

  if (insertError) {
    if (insertError.code === '23505') {
      return jsonResponse(409, { error: 'duplicate_telemetry' })
    }
    return jsonResponse(500, { error: 'insert_failed' })
  }

  if (compliance.state === 'LOCKOUT') {
    try {
      const { data: woRow } = await supabase
        .from('work_orders')
        .select('workzone_id')
        .eq('id', work_order_id)
        .maybeSingle<{ workzone_id: string | null }>()

      const targetWorkzoneId = woRow?.workzone_id ?? device.workzone_id

      if (targetWorkzoneId) {
        const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString()
        const { data: existingEvent } = await supabase
          .from('escalation_events')
          .select('id')
          .eq('workzone_id', targetWorkzoneId)
          .eq('notification_status', 'pending')
          .gt('created_at', oneHourAgo)
          .maybeSingle<{ id: string }>()

        if (!existingEvent) {
          const provider = getTestNotificationProvider()
          const { data: eventData, error: eventError } = await supabase
            .from('escalation_events')
            .insert({
              workzone_id: targetWorkzoneId,
              event_type: 'LOCKOUT_ENTERED',
              aggregate_state: 'LOCKOUT',
              aggregate_reason: compliance.reason,
              trigger_source: 'telemetry',
              previous_state: null,
              notification_status: 'pending',
            })
            .select('id')
            .single<{ id: string }>()

          if (!eventError && eventData) {
            const channels: Array<{ channel: 'buzzer' | 'sms'; send: () => Promise<{ status: string; error?: string }> }> = [
              {
                channel: 'buzzer',
                send: async () => {
                  const res = await provider.sendBuzzerNotification(targetWorkzoneId)
                  return { status: res.status, error: res.error }
                },
              },
              {
                channel: 'sms',
                send: async () => {
                  const res = await provider.sendSmsNotification(targetWorkzoneId, [])
                  return { status: res.status, error: res.error }
                },
              },
            ]

            for (const { channel, send } of channels) {
              let delivery: { status: string; error?: string }
              try {
                const res = await send()
                delivery = { status: res.status, error: res.error }
              } catch (err) {
                delivery = { status: 'failed', error: err instanceof Error ? err.message : 'unknown_error' }
              }

              await supabase
                .from('escalation_events')
                .update({
                  notification_channel: channel,
                  notification_status: delivery.status,
                  notification_error: delivery.error ?? null,
                })
                .eq('id', eventData.id)
            }
          }
        }
      }
    } catch {
      console.error('escalation trigger failed')
    }
  }

  return jsonResponse(200, {
    status: 'ok',
    row_hash: rowHash,
    prev_hash: prevHash,
    decision: compliance.state,
    compliance_reason: compliance.reason,
    compliance_metrics: compliance.metrics,
  })
}
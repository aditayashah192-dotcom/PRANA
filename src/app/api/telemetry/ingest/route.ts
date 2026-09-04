import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import {
  verifyDeviceHmac,
  verifyTimestampFreshness,
  type JsonValue,
} from '@/lib/deviceAuth'

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
}

type ScanLogRow = {
  row_hash: string | null
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

function canonicalize(value: JsonValue): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalize(value[k]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value)
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

  const normalizedReadings = normalizeReadings(readings)

  if (!verifyTimestampFreshness(timestamp, 30)) {
    return jsonResponse(400, { error: 'stale_timestamp' })
  }

  const supabase = getSupabaseAdmin()

  const { data: device, error: deviceError } = await supabase
    .from('devices')
    .select('id, is_active, secret_hash')
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

  const { error: insertError } = await supabase.from('scan_logs').insert({
    device_id,
    work_order_id,
    readings: normalizedReadings,
    prev_hash: prevHash || null,
    row_hash: rowHash,
  })

  if (insertError) {
    return jsonResponse(500, { error: 'insert_failed' })
  }

  return jsonResponse(200, {
    status: 'ok',
    row_hash: rowHash,
    prev_hash: prevHash,
  })
}
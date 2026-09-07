/**
 * Regression test for the cross-tenant work-order authorization check added
 * to /api/telemetry/ingest: a device belonging to one contractor must not be
 * able to post telemetry against a work order belonging to a different
 * contractor, even with a perfectly valid signature.
 */
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'

config({ path: '.env.local' })
config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:3000/api/telemetry/ingest'

if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set in your environment.')
if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in your environment.')

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const results: { name: string; passed: boolean; detail: string }[] = []
const note = (name: string, passed: boolean, detail: string): void => {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

function canonicalize(value: JsonValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}'
  }
  return JSON.stringify(value)
}

function signPayload(payload: object, secret: string): string {
  return createHmac('sha256', secret).update(canonicalize(payload as JsonValue), 'utf8').digest('hex')
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

type Fixture = { contractorId: string; workzoneId: string; workOrderId: string; deviceId: string; secret: string }
const cleanupIds: { contractorIds: string[]; workzoneIds: string[]; workOrderIds: string[]; deviceIds: string[] } = {
  contractorIds: [],
  workzoneIds: [],
  workOrderIds: [],
  deviceIds: [],
}

async function setupTenant(label: string): Promise<Fixture> {
  const { data: contractor, error: cErr } = await admin
    .from('contractors')
    .insert({ name: `CrossTenant-Test-${label}-${Date.now()}` })
    .select('id')
    .single()
  if (cErr) throw cErr
  cleanupIds.contractorIds.push(contractor.id)

  const { data: workzone, error: wzErr } = await admin
    .from('workzones')
    .insert({
      name: `CrossTenant-Test-Workzone-${label}-${Date.now()}`,
      contractor_id: contractor.id,
      target_lat: 28.6139,
      target_lon: 77.209,
      target_depth_meters: 3.0,
    })
    .select('id')
    .single()
  if (wzErr) throw wzErr
  cleanupIds.workzoneIds.push(workzone.id)

  const { data: workOrder, error: woErr } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractor.id, workzone_id: workzone.id, status: 'pending' })
    .select('id')
    .single()
  if (woErr) throw woErr
  cleanupIds.workOrderIds.push(workOrder.id)

  const secret = `cross-tenant-test-secret-${label}-${Date.now()}`
  const { data: device, error: dErr } = await admin
    .from('devices')
    .insert({
      serial_number: `CROSS-TENANT-TEST-${label}-${Date.now()}`,
      contractor_id: contractor.id,
      workzone_id: workzone.id,
      is_active: true,
      secret_hash: secret,
    })
    .select('id')
    .single()
  if (dErr) throw dErr
  cleanupIds.deviceIds.push(device.id)

  return { contractorId: contractor.id, workzoneId: workzone.id, workOrderId: workOrder.id, deviceId: device.id, secret }
}

async function cleanup(): Promise<void> {
  console.log('\n--- Cleaning up test fixtures ---')
  try {
    for (const workOrderId of cleanupIds.workOrderIds) {
      await admin.from('scan_logs').delete().eq('work_order_id', workOrderId)
    }
    for (const workOrderId of cleanupIds.workOrderIds) {
      await admin.from('work_orders').delete().eq('id', workOrderId)
    }
    for (const deviceId of cleanupIds.deviceIds) {
      await admin.from('devices').delete().eq('id', deviceId)
    }
    for (const workzoneId of cleanupIds.workzoneIds) {
      await admin.from('workzones').delete().eq('id', workzoneId)
    }
    for (const contractorId of cleanupIds.contractorIds) {
      await admin.from('contractors').delete().eq('id', contractorId)
    }
  } catch (e) {
    console.warn('Cleanup warning:', (e as Error).message)
  }
}

async function postIngest(body: object): Promise<{ status: number; json: unknown }> {
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* leave json null */
  }
  return { status: res.status, json }
}

async function main(): Promise<void> {
  console.log(`Ingest endpoint: ${INGEST_URL}`)
  const tenantA = await setupTenant('A')
  const tenantB = await setupTenant('B')

  const readings = {
    h2s_ppm: 2.0,
    o2_percent: 20.9,
    depth_meters: 3.0,
    battery_percent: 90.0,
    is_warming_up: false,
    user_lat: 28.6139,
    user_lon: 77.209,
  }

  // ------------------------------------------------------------------
  // Test 1: Device A + Work Order B (different contractors) → expect 403.
  // ------------------------------------------------------------------
  {
    const timestamp = Date.now()
    const signedPayload = {
      device_id: tenantA.deviceId,
      readings,
      timestamp,
      work_order_id: tenantB.workOrderId, // belongs to a different contractor
    }
    const signature = signPayload(signedPayload, tenantA.secret)

    console.log('\n--- Test 1: Device A posting against Contractor B\'s work order ---')
    const { status, json } = await postIngest({ ...signedPayload, signature })
    const errCode = (json as { error?: string } | null)?.error ?? null

    note(
      'device from Contractor A is rejected for Contractor B\'s work order',
      status === 403 && errCode === 'unauthorized_work_order',
      `http=${status} (want 403), error=${errCode ?? 'none'}`
    )
  }

  // ------------------------------------------------------------------
  // Test 2 (control): Device A + Work Order A (same contractor) → expect 200.
  // Confirms the fix doesn't break legitimate same-contractor requests.
  // ------------------------------------------------------------------
  {
    const timestamp = Date.now()
    const signedPayload = {
      device_id: tenantA.deviceId,
      readings,
      timestamp,
      work_order_id: tenantA.workOrderId,
    }
    const signature = signPayload(signedPayload, tenantA.secret)

    console.log('\n--- Test 2 (control): Device A posting against its own work order ---')
    const { status, json } = await postIngest({ ...signedPayload, signature })

    note(
      'device from Contractor A is accepted for its own work order',
      status === 200,
      `http=${status} (want 200), body=${JSON.stringify(json)}`
    )
  }

  await cleanup()

  const failed = results.filter((r) => !r.passed)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch(async (err) => {
  console.error('test failed:', err)
  await cleanup()
  process.exit(1)
})

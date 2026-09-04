import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'

config({ path: '.env.local' })
config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const INGEST_URL =
  process.env.INGEST_URL ?? 'http://localhost:3000/api/telemetry/ingest'

if (!SUPABASE_URL) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set in your environment.')
}
if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in your environment.')
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

type WorkzoneTarget = {
  target_lat: number
  target_lon: number
  target_depth_meters: number
}

type TelemetryPayload = {
  h2s_ppm: number | null
  o2_percent: number | null
  depth_meters: number | null
  battery_percent: number | null
  user_lat: number
  user_lon: number
}

type ComplianceCaseResult = {
  caseName: string;
  expected: 'SAFE' | 'LOCKOUT';
  actualState: string | null;
  actualReason: string | null;
  passed: boolean;
  detail: string;
}

type ComplianceIngestResponse = {
  status?: string
  decision?: string
  compliance_reason?: string
  compliance_metrics?: { geofence_distance_m: number; depth_delta_m: number }
  row_hash?: string
  error?: string
}

type Summary = { name: string; passed: boolean; detail: string }

const results: Summary[] = []

const note = (name: string, passed: boolean, detail: string): void => {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

function signPayload(payload: object, secret: string): string {
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
  return createHmac('sha256', secret)
    .update(canonicalize(payload as JsonValue), 'utf8')
    .digest('hex')
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const cleanup: {
  deviceId?: string
  contractorId?: string
  workzoneId?: string
  workOrderId?: string
} = {}

async function setupFixtures(): Promise<{
  deviceId: string
  workOrderId: string
  target: WorkzoneTarget
  secret: string
}> {
  console.log('\n--- Setting up compliance test fixtures ---')

  const { data: contractor, error: cErr } = await admin
    .from('contractors')
    .insert({ name: `Compliance-Test-Contractor-${Date.now()}` })
    .select('id')
    .single()
  if (cErr) throw cErr
  cleanup.contractorId = contractor.id

  const target: WorkzoneTarget = {
    target_lat: 28.6139,
    target_lon: 77.2090,
    target_depth_meters: 3.0,
  }

  const { data: workzone, error: wzErr } = await admin
    .from('workzones')
    .insert({
      name: `Compliance-Test-Workzone-${Date.now()}`,
      contractor_id: contractor.id,
      target_lat: target.target_lat,
      target_lon: target.target_lon,
      target_depth_meters: target.target_depth_meters,
    })
    .select('id')
    .single()
  if (wzErr) throw wzErr
  cleanup.workzoneId = workzone.id

  const { data: workOrder, error: woErr } = await admin
    .from('work_orders')
    .insert({
      contractor_id: contractor.id,
      workzone_id: workzone.id,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (woErr) throw woErr
  cleanup.workOrderId = workOrder.id

  const secretHash = `compliance-secret-hash-${Date.now()}`

  const { data: device, error: dErr } = await admin
    .from('devices')
    .insert({
      serial_number: `COMPLIANCE-TEST-${Date.now()}`,
      contractor_id: contractor.id,
      workzone_id: workzone.id,
      is_active: true,
      secret_hash: secretHash,
    })
    .select('id')
    .single()
  if (dErr) throw dErr
  cleanup.deviceId = device.id

  console.log(`  contractor:  ${contractor.id}`)
  console.log(`  workzone:    ${workzone.id} (target lat=${target.target_lat}, lon=${target.target_lon}, depth=${target.target_depth_meters}m)`)
  console.log(`  work_order:  ${workOrder.id}`)
  console.log(`  device:      ${device.id}`)

  return { deviceId: device.id, workOrderId: workOrder.id, target, secret: secretHash }
}

async function cleanupFixtures(): Promise<void> {
  console.log('\n--- Cleaning up compliance test fixtures ---')
  try {
    if (cleanup.workOrderId) {
      await admin.from('scan_logs').delete().eq('work_order_id', cleanup.workOrderId)
    }
    if (cleanup.workOrderId) {
      await admin.from('work_orders').delete().eq('id', cleanup.workOrderId)
    }
    if (cleanup.deviceId) {
      await admin.from('devices').delete().eq('id', cleanup.deviceId)
    }
    if (cleanup.workzoneId) {
      await admin.from('workzones').delete().eq('id', cleanup.workzoneId)
    }
    if (cleanup.contractorId) {
      await admin.from('contractors').delete().eq('id', cleanup.contractorId)
    }
  } catch (e) {
    console.warn('Cleanup warning:', (e as Error).message)
  }
}

async function postIngest(body: object): Promise<{ status: number; json: ComplianceIngestResponse | null; text: string }> {
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: ComplianceIngestResponse | null = null
  try {
    json = JSON.parse(text) as ComplianceIngestResponse
  } catch {
    /* leave json null */
  }
  return { status: res.status, json, text }
}

function buildSignedIngest(args: {
  deviceId: string
  workOrderId: string
  secret: string
  telemetry: TelemetryPayload
}): { body: Record<string, unknown>; signature: string } {
  const timestamp = Date.now()
  const signedPayload = {
    device_id: args.deviceId,
    readings: args.telemetry,
    timestamp,
    work_order_id: args.workOrderId,
  }
  const signature = signPayload(signedPayload, args.secret)
  return {
    body: {
      device_id: args.deviceId,
      readings: args.telemetry,
      timestamp,
      work_order_id: args.workOrderId,
      signature,
    },
    signature,
  }
}

async function runCase(
  caseName: string,
  expected: 'SAFE' | 'LOCKOUT',
  telemetry: TelemetryPayload,
  ctx: { deviceId: string; workOrderId: string; target: WorkzoneTarget; secret: string }
): Promise<ComplianceCaseResult> {
  const { body } = buildSignedIngest({
    deviceId: ctx.deviceId,
    workOrderId: ctx.workOrderId,
    secret: ctx.secret,
    telemetry,
  })

  const { status, json } = await postIngest(body)

  if (status !== 200 || !json) {
    return {
      caseName,
      expected,
      actualState: json?.decision ?? null,
      actualReason: json?.compliance_reason ?? json?.error ?? null,
      passed: false,
      detail: `ingest returned non-200: http=${status} body=${JSON.stringify(json)}`,
    }
  }

  const actualState = json.decision ?? null
  const actualReason = json.compliance_reason ?? null
  const stateOk = actualState === expected

  const reasonOk =
    expected === 'SAFE'
      ? actualReason === 'ALL_SYSTEMS_NOMINAL'
      : actualReason !== null && actualReason !== 'ALL_SYSTEMS_NOMINAL'

  const persisted = await admin
    .from('scan_logs')
    .select('id, decision')
    .eq('work_order_id', ctx.workOrderId)
    .eq('device_id', ctx.deviceId)
    .eq('row_hash', json.row_hash ?? '')
    .maybeSingle()

  const persistedOk = !persisted.error && persisted.data?.decision === expected

  return {
    caseName,
    expected,
    actualState,
    actualReason,
    passed: stateOk && reasonOk && persistedOk,
    detail: `expected=${expected} actual=${actualState} reason=${actualReason ?? 'none'} persisted=${persistedOk ? 'yes' : 'no'} metrics=${JSON.stringify(json.compliance_metrics ?? null)}`,
  }
}

async function main(): Promise<void> {
  console.log(`Compliance ingest endpoint: ${INGEST_URL}`)
  const { deviceId, workOrderId, target, secret } = await setupFixtures()

  const ctx = { deviceId, workOrderId, target, secret }

  console.log('\n--- Case 1: all values normal, worker in geofence ---')
  const case1 = await runCase(
    'Case 1: all values normal → SAFE',
    'SAFE',
    {
      h2s_ppm: 2.0,
      o2_percent: 20.9,
      depth_meters: 3.0,
      battery_percent: 85.0,
      user_lat: target.target_lat,
      user_lon: target.target_lon,
    },
    ctx
  )

  console.log('\n--- Case 2: H2S > 15 ppm spike ---')
  const case2 = await runCase(
    'Case 2: H2S spike > 15 ppm → LOCKOUT',
    'LOCKOUT',
    {
      h2s_ppm: 25.0,
      o2_percent: 20.9,
      depth_meters: 3.0,
      battery_percent: 85.0,
      user_lat: target.target_lat,
      user_lon: target.target_lon,
    },
    ctx
  )

  console.log('\n--- Case 3: depth sensor mismatch (probe not inside manhole) ---')
  const case3 = await runCase(
    'Case 3: depth mismatch (>0.5m) → LOCKOUT',
    'LOCKOUT',
    {
      h2s_ppm: 2.0,
      o2_percent: 20.9,
      depth_meters: 5.0,
      battery_percent: 85.0,
      user_lat: target.target_lat,
      user_lon: target.target_lon,
    },
    ctx
  )

  console.log('\n--- Case 4: missing/null sensor reading ---')
  const case4 = await runCase(
    'Case 4: null sensor reading → LOCKOUT',
    'LOCKOUT',
    {
      h2s_ppm: 2.0,
      o2_percent: 20.9,
      depth_meters: 3.0,
      battery_percent: null,
      user_lat: target.target_lat,
      user_lon: target.target_lon,
    },
    ctx
  )

  console.log('\n--- Case 5: telemetry outside 50m Haversine radius ---')
  const case5 = await runCase(
    'Case 5: outside 50m geofence → LOCKOUT',
    'LOCKOUT',
    {
      h2s_ppm: 2.0,
      o2_percent: 20.9,
      depth_meters: 3.0,
      battery_percent: 85.0,
      user_lat: target.target_lat + 0.001,
      user_lon: target.target_lon + 0.001,
    },
    ctx
  )

  const cases: ComplianceCaseResult[] = [case1, case2, case3, case4, case5]

  console.log('\n--- Compliance Case Results ---')
  for (const c of cases) {
    note(c.caseName, c.passed, c.detail)
  }

  const failed = results.filter((r) => !r.passed)
  console.log(
    `\nSummary: ${results.length - failed.length}/${results.length} cases passed, ${failed.length} failed`
  )
  if (failed.length > 0) {
    console.log('FAILED:')
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  }
}

main()
  .catch((err) => {
    console.error('Script error:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanupFixtures()
    const failed = results.filter((r) => !r.passed)
    process.exitCode = failed.length > 0 ? 1 : 0
  })
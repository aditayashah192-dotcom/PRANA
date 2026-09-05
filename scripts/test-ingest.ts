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

type Summary = { name: string; passed: boolean; detail: string }

const results: Summary[] = []

const note = (name: string, passed: boolean, detail: string): void => {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
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

function signPayload(payload: object, secret: string): string {
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
  secret: string
}> {
  console.log('\n--- Setting up test fixtures ---')

  const { data: contractor, error: cErr } = await admin
    .from('contractors')
    .insert({ name: `Ingest-Test-Contractor-${Date.now()}` })
    .select('id')
    .single()
  if (cErr) throw cErr
  cleanup.contractorId = contractor.id

  const { data: workzone, error: wzErr } = await admin
    .from('workzones')
    .insert({
      name: `Ingest-Test-Workzone-${Date.now()}`,
      contractor_id: contractor.id,
    })
    .select('id')
    .single()
  if (wzErr) throw wzErr
  cleanup.workzoneId = workzone.id

  const { data: workOrder, error: woErr } = await admin
    .from('work_orders')
    .insert({
      contractor_id: contractor.id,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (woErr) throw woErr
  cleanup.workOrderId = workOrder.id

  const secretHash = `test-secret-hash-${Date.now()}`

  const { data: device, error: dErr } = await admin
    .from('devices')
    .insert({
      serial_number: `INGEST-TEST-${Date.now()}`,
      contractor_id: contractor.id,
      workzone_id: workzone.id,
      is_active: true,
      secret_hash: secretHash,
    })
    .select('id')
    .single()
  if (dErr) throw dErr
  cleanup.deviceId = device.id

  console.log(`  contractor: ${contractor.id}`)
  console.log(`  workzone:   ${workzone.id}`)
  console.log(`  work_order: ${workOrder.id}`)
  console.log(`  device:     ${device.id}`)

  return { deviceId: device.id, workOrderId: workOrder.id, secret: secretHash }
}

async function cleanupFixtures(): Promise<void> {
  console.log('\n--- Cleaning up test fixtures ---')
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

async function postIngest(body: object): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* leave json null */
  }
  return { status: res.status, json, text }
}

async function main(): Promise<void> {
  console.log(`Ingest endpoint: ${INGEST_URL}`)
  const { deviceId, workOrderId, secret } = await setupFixtures()

  // ------------------------------------------------------------------
  // Test 1: Valid HMAC signature + fresh timestamp → expect HTTP 200
  //         and verify a row was inserted into scan_logs.
  // ------------------------------------------------------------------
  {
    const timestamp = Date.now()
    const readings = {
      temperature: 72.5,
      humidity: 41.2,
      ok: true,
      sensor_id: 'A1',
    }
    const signedPayload = {
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
    }
    const signature = signPayload(signedPayload, secret)

    console.log('\n--- Test 1: valid HMAC + fresh timestamp ---')
    const { status, json } = await postIngest({
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
      signature,
    })

    const rowHash = (json as { row_hash?: string } | null)?.row_hash ?? null

    const { data: rows, error: lookupErr } = await admin
      .from('scan_logs')
      .select('id, row_hash, prev_hash, device_id, work_order_id, readings')
      .eq('work_order_id', workOrderId)
      .eq('device_id', deviceId)

    const insertedRow = rows?.find((r) => r.row_hash === rowHash) ?? null
    const httpOk = status === 200
    const rowOk = !lookupErr && !!insertedRow

    note(
      'valid HMAC + fresh timestamp returns 200 and inserts scan_log row',
      httpOk && rowOk,
      `http=${status} (want 200), lookupErr=${
        lookupErr?.message ?? 'none'
      }, matchedRow=${insertedRow ? insertedRow.id : 'none'}`
    )
  }

  // ------------------------------------------------------------------
  // Test 2: Stale timestamp (>30s old) → expect HTTP 400 rejection.
  // ------------------------------------------------------------------
  {
    const timestamp = Date.now() - 60_000 // 60 seconds in the past
    const readings = { ok: true, note: 'stale-timestamp-test' }
    const signedPayload = {
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
    }
    // Sign anyway — server must reject on freshness before HMAC check.
    const signature = signPayload(signedPayload, secret)

    console.log('\n--- Test 2: stale timestamp (>30s old) ---')
    const { status, json } = await postIngest({
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
      signature,
    })

    const errCode = (json as { error?: string } | null)?.error ?? null
    const rejected = status === 400

    note(
      'stale timestamp (>30s) is rejected with HTTP 400',
      rejected && errCode === 'stale_timestamp',
      `http=${status} (want 400), error=${errCode ?? 'none'}`
    )
  }

  // ------------------------------------------------------------------
  // Test 3: Invalid HMAC signature → expect HTTP 401 rejection.
  // ------------------------------------------------------------------
  {
    const timestamp = Date.now()
    const readings = { ok: false, note: 'bad-signature-test' }
    const signedPayload = {
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
    }
    // Sign with a deliberately wrong secret.
    const signature = signPayload(signedPayload, 'wrong-secret-xyz')

    console.log('\n--- Test 3: invalid HMAC signature ---')
    const { status, json } = await postIngest({
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
      signature,
    })

    const errCode = (json as { error?: string } | null)?.error ?? null
    const rejected = status === 401

    note(
      'invalid HMAC signature is rejected with HTTP 401',
      rejected && errCode === 'invalid_signature',
      `http=${status} (want 401), error=${errCode ?? 'none'}`
    )
  }

  // ------------------------------------------------------------------
  // Test 4: Top-level timestamp is populated on the inserted row.
  // ------------------------------------------------------------------
  {
    const timestamp = Date.now()
    const readings = { note: 'timestamp-test' }
    const signedPayload = {
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
    }
    const signature = signPayload(signedPayload, secret)

    console.log('\n--- Test 4: top-level timestamp populated ---')
    const { status } = await postIngest({
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
      signature,
    })

    const { data: rows, error: lookupErr } = await admin
      .from('scan_logs')
      .select('timestamp')
      .eq('work_order_id', workOrderId)
      .eq('device_id', deviceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const insertedTs = rows?.timestamp ?? null
    const expectedIso = new Date(timestamp).toISOString()
    const httpOk = status === 200
    const insertedMs = insertedTs ? new Date(insertedTs).getTime() : NaN
    const expectedMs = new Date(expectedIso).getTime()
    const tsOk = !lookupErr && insertedMs === expectedMs

    note(
      'top-level timestamp is populated correctly',
      httpOk && tsOk,
      `http=${status}, timestamp=${insertedTs ?? 'null'} (expected ${expectedIso})`
    )
  }

  // ------------------------------------------------------------------
  // Test 5: Re-submitting the exact same packet is rejected as a
  //         duplicate/replay with HTTP 409.
  // ------------------------------------------------------------------
  {
    const timestamp = Date.now()
    const readings = { note: 'replay-test' }
    const signedPayload = {
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
    }
    const signature = signPayload(signedPayload, secret)

    console.log('\n--- Test 5: exact replay rejected ---')
    const { status: status1 } = await postIngest({
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
      signature,
    })

    const { status: status2, json: json2 } = await postIngest({
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
      signature,
    })

    const firstAccepted = status1 === 200
    const secondRejected = status2 === 409
    const errorOk = (json2 as { error?: string } | null)?.error === 'duplicate_telemetry'

    note(
      'exact replay is rejected with HTTP 409',
      firstAccepted && secondRejected && errorOk,
      `first=${status1}, second=${status2}, error=${(json2 as { error?: string } | null)?.error ?? 'none'}`
    )
  }

  // ------------------------------------------------------------------
  // Test 6: Two concurrent submissions of the same packet cannot both
  //         be accepted. Only one should succeed; the other must get 409.
  // ------------------------------------------------------------------
  {
    const timestamp = Date.now()
    const readings = { note: 'concurrent-test' }
    const signedPayload = {
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
    }
    const signature = signPayload(signedPayload, secret)

    console.log('\n--- Test 6: concurrent duplicate rejected ---')
    const [res1, res2] = await Promise.all([
      postIngest({
        device_id: deviceId,
        readings,
        timestamp,
        work_order_id: workOrderId,
        signature,
      }),
      postIngest({
        device_id: deviceId,
        readings,
        timestamp,
        work_order_id: workOrderId,
        signature,
      }),
    ])

    const results = [res1, res2]
    const accepted = results.filter((r) => r.status === 200).length
    const rejected = results.filter((r) => r.status === 409).length
    const raceSafe = accepted === 1 && rejected === 1

    note(
      'concurrent duplicate: exactly one accepted, one rejected',
      raceSafe,
      `accepted=${accepted}, rejected=${rejected}, statuses=[${res1.status},${res2.status}]`
    )
  }

  // ------------------------------------------------------------------
  // Test 7: Two different valid telemetry packets are both accepted.
  // ------------------------------------------------------------------
  {
    const timestamp1 = Date.now()
    const readings1 = { note: 'packet-a', value: 1 }
    const signedPayload1 = {
      device_id: deviceId,
      readings: readings1,
      timestamp: timestamp1,
      work_order_id: workOrderId,
    }
    const signature1 = signPayload(signedPayload1, secret)

    const timestamp2 = timestamp1 + 1
    const readings2 = { note: 'packet-b', value: 2 }
    const signedPayload2 = {
      device_id: deviceId,
      readings: readings2,
      timestamp: timestamp2,
      work_order_id: workOrderId,
    }
    const signature2 = signPayload(signedPayload2, secret)

    console.log('\n--- Test 7: two distinct packets both accepted ---')
    const { status: status1 } = await postIngest({
      device_id: deviceId,
      readings: readings1,
      timestamp: timestamp1,
      work_order_id: workOrderId,
      signature: signature1,
    })

    const { status: status2 } = await postIngest({
      device_id: deviceId,
      readings: readings2,
      timestamp: timestamp2,
      work_order_id: workOrderId,
      signature: signature2,
    })

    const bothAccepted = status1 === 200 && status2 === 200

    note(
      'two distinct packets both accepted',
      bothAccepted,
      `first=${status1}, second=${status2}`
    )
  }

  // ------------------------------------------------------------------
  // Test 8: Hash-chain behavior remains intact after replay rejection.
  // ------------------------------------------------------------------
  {
    const timestamp = Date.now()
    const readings = { note: 'hashchain-test' }
    const signedPayload = {
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
    }
    const signature = signPayload(signedPayload, secret)

    console.log('\n--- Test 8: hash-chain intact after replay rejection ---')
    const { status: status1, json: json1 } = await postIngest({
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
      signature,
    })

    const { status: status2, json: json2 } = await postIngest({
      device_id: deviceId,
      readings,
      timestamp,
      work_order_id: workOrderId,
      signature,
    })

    const firstRowHash = (json1 as { row_hash?: string } | null)?.row_hash ?? null
    const secondRowHash = (json2 as { row_hash?: string } | null)?.row_hash ?? null

    const firstAccepted = status1 === 200 && !!firstRowHash
    const secondRejected = status2 === 409
    const noRowHashOnReject = !secondRowHash
    const hashChainIntact = firstAccepted && secondRejected && noRowHashOnReject

    note(
      'hash-chain intact after replay rejection',
      hashChainIntact,
      `first=${status1} rowHash=${firstRowHash?.slice(0, 16) ?? 'none'}..., second=${status2} rowHash=${secondRowHash ?? 'none'}`
    )
  }

  const failed = results.filter((r) => !r.passed)
  console.log(
    `\nSummary: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`
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
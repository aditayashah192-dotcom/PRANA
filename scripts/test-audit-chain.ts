import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'
import { createHash } from 'crypto'
import { canonicalize, type JsonValue } from '../src/lib/canonicalize'
import {
  verifyAuditChain,
  type ScanLogRow,
  type VerificationResult,
} from '../src/lib/auditChainVerifier'

config({ path: '.env.local' })
config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set.')
if (!ANON_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.')
if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.')

type Summary = { name: string; passed: boolean; detail: string }
const results: Summary[] = []
const note = (name: string, passed: boolean, detail: string): void => {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const cleanup: {
  contractorId?: string
  workzoneId?: string
  workOrderId?: string
  deviceId?: string
} = {}

async function cleanupFixtures(): Promise<void> {
  console.log('\n--- Cleaning up ---')
  try {
    if (cleanup.workOrderId) {
      await admin.from('scan_logs').delete().eq('work_order_id', cleanup.workOrderId)
      await admin.from('work_orders').delete().eq('id', cleanup.workOrderId)
    }
    if (cleanup.deviceId) await admin.from('devices').delete().eq('id', cleanup.deviceId)
    if (cleanup.workzoneId) await admin.from('workzones').delete().eq('id', cleanup.workzoneId)
    if (cleanup.contractorId) await admin.from('contractors').delete().eq('id', cleanup.contractorId)
  } catch (e) {
    console.warn('Cleanup warning:', (e as Error).message)
  }
}

async function setupFixtures(): Promise<{ deviceId: string; workOrderId: string }> {
  console.log('\n--- Setup ---')
  const { data: contractor, error: cErr } = await admin
    .from('contractors').insert({ name: `AC-Test-${Date.now()}` }).select('id').single()
  if (cErr) throw cErr
  cleanup.contractorId = contractor.id

  const { data: workzone, error: wzErr } = await admin
    .from('workzones').insert({ name: `AC-WZ-${Date.now()}`, contractor_id: contractor.id }).select('id').single()
  if (wzErr) throw wzErr
  cleanup.workzoneId = workzone.id

  const { data: workOrder, error: woErr } = await admin
    .from('work_orders').insert({ contractor_id: contractor.id, status: 'pending' }).select('id').single()
  if (woErr) throw woErr
  cleanup.workOrderId = workOrder.id

  const { data: device, error: dErr } = await admin
    .from('devices').insert({
      serial_number: `AC-DEV-${Date.now()}`, contractor_id: contractor.id,
      workzone_id: workzone.id, is_active: true, secret_hash: 'test',
    }).select('id').single()
  if (dErr) throw dErr
  cleanup.deviceId = device.id
  console.log(`  work_order: ${workOrder.id}, device: ${device.id}`)
  return { deviceId: device.id, workOrderId: workOrder.id }
}

function normalizeReadings(raw: unknown): JsonValue {
  if (raw === undefined) return {}
  if (raw === null) return null
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw
  if (Array.isArray(raw)) return raw.map((i) => normalizeReadings(i)) as JsonValue
  if (typeof raw === 'object') {
    const result: { [key: string]: JsonValue } = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      result[k] = normalizeReadings(v)
    }
    return result
  }
  return null
}

interface ChainRecord {
  device_id: string
  work_order_id: string
  readings: unknown
  timestamp: number
  prev_hash: string | null
  row_hash: string
  message_id: string
  timestamp_iso: string
}

function generateChain(deviceId: string, workOrderId: string, count: number, baseTs: number): ChainRecord[] {
  const records: ChainRecord[] = []
  let prevHash = ''
  for (let i = 0; i < count; i++) {
    const timestamp = baseTs + i
    const readings = { note: `rec-${i}`, value: i, active: true }
    const signedPayload = { device_id: deviceId, readings: normalizeReadings(readings), timestamp, work_order_id: workOrderId }
    const payloadString = canonicalize(signedPayload as JsonValue)
    const rowHash = createHash('sha256').update(prevHash + payloadString, 'utf8').digest('hex')
    const messageId = createHash('sha256').update(payloadString, 'utf8').digest('hex')
    records.push({
      device_id: deviceId, work_order_id: workOrderId, readings, timestamp,
      prev_hash: prevHash || null, row_hash: rowHash, message_id: messageId,
      timestamp_iso: new Date(timestamp).toISOString(),
    })
    prevHash = rowHash
  }
  return records
}

async function insertChain(supabase: SupabaseClient, records: ChainRecord[], baseTs: number): Promise<void> {
  const rows = records.map((r, i) => ({
    device_id: r.device_id, work_order_id: r.work_order_id, readings: r.readings,
    decision: 'pass', prev_hash: r.prev_hash, row_hash: r.row_hash,
    timestamp: r.timestamp_iso, message_id: r.message_id,
    created_at: new Date(baseTs + i * 1000).toISOString(),
  }))
  const { error } = await supabase.from('scan_logs').insert(rows)
  if (error) throw error
}

async function fetchChain(supabase: SupabaseClient, workOrderId: string): Promise<ScanLogRow[]> {
  const { data, error } = await supabase
    .from('scan_logs')
    .select('id, device_id, work_order_id, readings, timestamp, prev_hash, row_hash, message_id, created_at')
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    device_id: r.device_id as string,
    work_order_id: r.work_order_id as string | null,
    readings: r.readings as JsonValue,
    timestamp: r.timestamp as string | null,
    prev_hash: r.prev_hash as string | null,
    row_hash: r.row_hash as string | null,
    message_id: r.message_id as string | null,
    created_at: r.created_at as string,
  }))
}

async function deleteAllChain(supabase: SupabaseClient, workOrderId: string): Promise<void> {
  await supabase.from('scan_logs').delete().eq('work_order_id', workOrderId)
}

async function main(): Promise<void> {
  const { deviceId, workOrderId } = await setupFixtures()
  const baseTimestamp = Date.now()

  // Test 1: Valid untouched chain → VALID
  {
    console.log('\n--- Test 1: valid untouched chain ---')
    const chain = generateChain(deviceId, workOrderId, 5, baseTimestamp)
    await insertChain(admin, chain, baseTimestamp)
    const rows = await fetchChain(admin, workOrderId)
    const result = verifyAuditChain(rows)
    const ok = result.valid && result.recordCount === 5
    note('valid untouched chain → VALID', ok,
      `valid=${result.valid}, recordCount=${result.recordCount}, verifiedCount=${result.verifiedCount}, failures=${result.failures.length}`)
  }

  // Test 2: Modified stored hash → INVALID
  {
    console.log('\n--- Test 2: modified stored hash ---')
    const rowsBefore = await fetchChain(admin, workOrderId)
    const target = rowsBefore[1]!
    const originalHash = target.row_hash
    await admin.from('scan_logs').update({ row_hash: '0'.repeat(64) }).eq('id', target.id)
    const rows = await fetchChain(admin, workOrderId)
    const result = verifyAuditChain(rows)
    const detected = !result.valid && !result.hashesValid
    note('modified stored hash → INVALID', detected,
      `valid=${result.valid}, hashesValid=${result.hashesValid}`)
    await admin.from('scan_logs').update({ row_hash: originalHash }).eq('id', target.id)
  }

  // Test 3: Broken previous_hash linkage → INVALID
  {
    console.log('\n--- Test 3: broken prev_hash linkage ---')
    const rowsBefore = await fetchChain(admin, workOrderId)
    const target = rowsBefore[2]!
    const originalPrev = target.prev_hash
    await admin.from('scan_logs').update({ prev_hash: 'b'.repeat(64) }).eq('id', target.id)
    const rows = await fetchChain(admin, workOrderId)
    const result = verifyAuditChain(rows)
    const detected = !result.valid && !result.linkageValid
    note('broken prev_hash linkage → INVALID', detected,
      `valid=${result.valid}, linkageValid=${result.linkageValid}`)
    await admin.from('scan_logs').update({ prev_hash: originalPrev }).eq('id', target.id)
  }

  // Test 4: Missing/interrupted record → INVALID
  {
    console.log('\n--- Test 4: missing/interrupted record ---')
    const rowsBefore = await fetchChain(admin, workOrderId)
    const countBefore = rowsBefore.length
    const victim = rowsBefore[3]!
    const { device_id, work_order_id, readings, prev_hash, row_hash, message_id, created_at, timestamp } = victim
    await admin.from('scan_logs').delete().eq('id', victim.id)
    const rows = await fetchChain(admin, workOrderId)
    const result = verifyAuditChain(rows)
    const detected = !result.valid && !result.linkageValid
    note('missing/interrupted record → INVALID', detected,
      `valid=${result.valid}, countBefore=${countBefore}, countAfter=${rows.length}, linkageValid=${result.linkageValid}`)
    // Re-insert the victim
    await admin.from('scan_logs').insert({
      id: victim.id, device_id, work_order_id, readings, decision: 'pass',
      prev_hash, row_hash, message_id, timestamp, created_at,
    })
  }

  // Test 5: Invalid root (genesis corruption) → INVALID
  {
    console.log('\n--- Test 5: invalid root ---')
    const rowsBefore = await fetchChain(admin, workOrderId)
    const genesis = rowsBefore[0]!
    await admin.from('scan_logs').update({ prev_hash: 'corrupted-root' }).eq('id', genesis.id)
    const rows = await fetchChain(admin, workOrderId)
    const result = verifyAuditChain(rows)
    const detected = !result.valid && !result.rootValid
    note('invalid root (genesis prev_hash corrupted) → INVALID', detected,
      `valid=${result.valid}, rootValid=${result.rootValid}, malformed=${result.malformedHashes}`)
    await admin.from('scan_logs').update({ prev_hash: null }).eq('id', genesis.id)
  }

  // Test 6: Malformed hash → INVALID
  {
    console.log('\n--- Test 6: malformed hash ---')
    const rowsBefore = await fetchChain(admin, workOrderId)
    const target = rowsBefore[1]!
    await admin.from('scan_logs').update({ row_hash: 'not-hex-hash' }).eq('id', target.id)
    const rows = await fetchChain(admin, workOrderId)
    const result = verifyAuditChain(rows)
    const detected = !result.valid && result.malformedHashes
    note('malformed hash → INVALID', detected,
      `valid=${result.valid}, malformedHashes=${result.malformedHashes}`)
    const chain = generateChain(deviceId, workOrderId, 5, baseTimestamp)
    await admin.from('scan_logs').update({ row_hash: chain[1].row_hash }).eq('id', target.id)
  }

  // Test 7: Verifier is read-only (input array not mutated)
  {
    console.log('\n--- Test 7: verifier does not mutate input ---')
    const rows = await fetchChain(admin, workOrderId)
    const snapshot = JSON.parse(JSON.stringify(rows))
    verifyAuditChain(rows)
    const unchanged = JSON.stringify(rows) === JSON.stringify(snapshot)
    note('verifier does not mutate input array', unchanged, `unchanged=${unchanged}`)
  }

  // Test 8: Verifier is read-only (DB not mutated)
  {
    console.log('\n--- Test 8: verifier does not mutate DB ---')
    const rows = await fetchChain(admin, workOrderId)
    const beforeSnapshot = rows.map((r) => ({ id: r.id, row_hash: r.row_hash, prev_hash: r.prev_hash }))
    verifyAuditChain(rows)
    const after = await fetchChain(admin, workOrderId)
    const afterSnapshot = after.map((r) => ({ id: r.id, row_hash: r.row_hash, prev_hash: r.prev_hash }))
    const dbUnchanged = JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)
    note('verifier does not mutate DB records', dbUnchanged, `dbUnchanged=${dbUnchanged}`)
  }

  // Test 9: Chain VALID after all restorations
  {
    console.log('\n--- Test 9: chain valid after restorations ---')
    const rows = await fetchChain(admin, workOrderId)
    const result = verifyAuditChain(rows)
    note('chain VALID after all restorations', result.valid && result.recordCount === 5,
      `valid=${result.valid}, recordCount=${result.recordCount}, failures=${result.failures.length}`)
  }

  // Test 10: Empty chain → VALID (pure function, no DB)
  {
    console.log('\n--- Test 10: empty chain ---')
    const result = verifyAuditChain([])
    note('empty chain → VALID', result.valid && result.recordCount === 0,
      `valid=${result.valid}, recordCount=${result.recordCount}`)
  }

  // Test 11: Single genesis record → VALID
  {
    console.log('\n--- Test 11: single genesis record ---')
    await deleteAllChain(admin, workOrderId)
    const chain = generateChain(deviceId, workOrderId, 1, baseTimestamp + 99999)
    await insertChain(admin, chain, baseTimestamp + 99999)
    const rows = await fetchChain(admin, workOrderId)
    const result = verifyAuditChain(rows)
    note('single genesis record → VALID', result.valid && result.recordCount === 1,
      `valid=${result.valid}, recordCount=${result.recordCount}, rootValid=${result.rootValid}`)
  }

  // Test 12: Single genesis record with non-null prev_hash → INVALID (corrupt root)
  {
    console.log('\n--- Test 12: single record corrupt root ---')
    const rowsBefore = await fetchChain(admin, workOrderId)
    const genesis = rowsBefore[0]!
    await admin.from('scan_logs').update({ prev_hash: 'should-be-null' }).eq('id', genesis.id)
    const rows = await fetchChain(admin, workOrderId)
    const result = verifyAuditChain(rows)
    const detected = !result.valid && !result.rootValid
    note('single genesis with non-null prev_hash → INVALID', detected,
      `valid=${result.valid}, rootValid=${result.rootValid}`)
    await admin.from('scan_logs').update({ prev_hash: null }).eq('id', genesis.id)
  }

  // Restore 5-record chain for final state
  await deleteAllChain(admin, workOrderId)
  const finalChain = generateChain(deviceId, workOrderId, 5, baseTimestamp)
  await insertChain(admin, finalChain, baseTimestamp)

  // ------------------------------------------------------------------
  // Test 13: API endpoint — govt_auditor receives VALID result
  // ------------------------------------------------------------------
  {
    console.log('\n--- Test 13: API endpoint (govt_auditor) ---')
    const baseUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const cookieJar: Record<string, string> = {}
    const browserClient = createBrowserClient(SUPABASE_URL!, ANON_KEY!, {
      cookies: {
        getAll() {
          return Object.entries(cookieJar).map(([name, value]) => ({ name, value }))
        },
        setAll(cookiesToSet: Array<{ name: string; value: string }>) {
          for (const { name, value } of cookiesToSet) {
            if (value) cookieJar[name] = value
            else delete cookieJar[name]
          }
        },
      },
    })
    const { error: signInErr } = await browserClient.auth.signInWithPassword({
      email: 'govt-auditor@prana.test',
      password: 'Prana-Govt-Auditor-2026!',
    })
    if (signInErr) {
      note('API endpoint govt_auditor returns verification', false, `sign-in failed: ${signInErr.message}`)
    } else {
      const cookieHeader = Object.entries(cookieJar)
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join('; ')
      const res = await fetch(`${baseUrl}/api/govt/audit-chain/verify`, {
        method: 'GET',
        headers: { cookie: cookieHeader },
      })
      if (!res.ok) {
        note('API endpoint govt_auditor returns verification', false, `HTTP ${res.status}`)
      } else {
        const json = await res.json() as Record<string, unknown>
        const ok = json.valid === true && json.status === 'VALID'
        note('API endpoint govt_auditor returns VALID', ok,
          `valid=${json.valid}, status=${json.status}, recordCount=${json.recordCount}`)
      }
    }
  }

  // ------------------------------------------------------------------
  // Test 14: API endpoint — unauthenticated access rejected
  // ------------------------------------------------------------------
  {
    console.log('\n--- Test 14: API endpoint (unauthenticated) ---')
    const apiUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const res = await fetch(`${apiUrl}/api/govt/audit-chain/verify`, {
      method: 'GET',
    })
    const blocked = res.status === 401 || res.status === 403
    note('API endpoint rejects unauthenticated', blocked, `status=${res.status}`)
  }

  const failed = results.filter((r) => !r.passed)
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`)
  if (failed.length > 0) {
    console.log('FAILED:')
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  }
}

main()
  .catch((err) => { console.error('Script error:', err); process.exitCode = 1 })
  .finally(async () => { await cleanupFixtures(); process.exitCode = results.filter((r) => !r.passed).length > 0 ? 1 : 0 })

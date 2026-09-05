import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'

config({ path: '.env.local' })
config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const STATE_URL = process.env.STATE_URL ?? 'http://localhost:3000/api/govt/workzone-state'
const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:3000/api/telemetry/ingest'

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Supabase env vars missing.')
}

const PASSWORDS = {
  tenantAField: process.env.PRANA_TEST_TENANT_A_FIELD_PASSWORD ?? `State-A-Field-${Date.now()}`,
  tenantBField: process.env.PRANA_TEST_TENANT_B_FIELD_PASSWORD ?? `State-B-Field-${Date.now()}`,
  gov: process.env.PRANA_TEST_GOV_PASSWORD ?? `State-Gov-${Date.now()}`,
}
const EMAILS = {
  tenantAField: 'state-tenant-a-field@prana.test',
  tenantBField: 'state-tenant-b-field@prana.test',
  gov: 'state-gov@prana.test',
}

type Summary = { name: string; passed: boolean; detail: string }
const results: Summary[] = []
const note = (name: string, passed: boolean, detail: string): void => {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function resetUsers(emails: string[]): Promise<void> {
  const targets = new Set(emails)
  let page = 1
  while (true) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    const list = (data as unknown as { users: Array<{ id: string; email?: string }>; nextPage?: string | null; lastPage?: number })
    for (const u of list.users) {
      if (u.email && targets.has(u.email)) {
        await admin.auth.admin.deleteUser(u.id)
      }
    }
    if (list.nextPage === null || page >= (list.lastPage ?? 0)) break
    page++
  }
}

async function ensureUser(
  email: string,
  password: string,
  role: string,
  contractorId: string | null
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  const id = data.user!.id
  await admin.from('profiles').upsert({ id, role, contractor_id: contractorId })
  return id
}

async function getOrCreateContractor(name: string): Promise<string> {
  const { data } = await admin
    .from('contractors')
    .select('id')
    .eq('name', name)
    .maybeSingle()
  if (data) return data.id
  const { data: created, error } = await admin
    .from('contractors')
    .insert({ name })
    .select('id')
    .single()
  if (error) throw error
  return created!.id
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  if (typeof value === 'object') {
    const keys = Object.keys(value as object).sort()
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(value)
}

function sign(payload: object, secret: string): string {
  return createHmac('sha256', secret)
    .update(canonicalize(payload), 'utf8')
    .digest('hex')
}

interface FreshRow {
  h2s_ppm: number
  o2_percent: number
  depth_meters: number
  battery_percent: number
  is_warming_up?: boolean
  user_lat: number
  user_lon: number
}

async function ingestFresh(args: {
  deviceId: string
  workOrderId: string
  secret: string
  target: { lat: number; lon: number }
  row: FreshRow
}): Promise<void> {
  const ts = Date.now()
  const signedPayload = {
    device_id: args.deviceId,
    readings: args.row,
    timestamp: ts,
    work_order_id: args.workOrderId,
  }
  const signature = sign(signedPayload, args.secret)
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      device_id: args.deviceId,
      readings: args.row,
      timestamp: ts,
      work_order_id: args.workOrderId,
      signature,
    }),
  })
  if (res.status !== 200) {
    const t = await res.text()
    throw new Error(`ingest failed ${res.status}: ${t}`)
  }
}

async function insertBackdatedScanLog(args: {
  workOrderId: string
  deviceId: string
  decision: string
  readings: Record<string, unknown>
  ageSeconds: number
}): Promise<string> {
  const ts = new Date(Date.now() - args.ageSeconds * 1000).toISOString()
  const { data, error } = await admin
    .from('scan_logs')
    .insert({
      work_order_id: args.workOrderId,
      device_id: args.deviceId,
      readings: args.readings,
      decision: args.decision,
      timestamp: ts,
      created_at: ts,
      prev_hash: null,
      row_hash: `backdated-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      message_id: `backdated-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    })
    .select('id')
    .single()
  if (error) throw error
  return data!.id
}

interface StateResponse {
  aggregate_state: string
  aggregate_reason: string
  freshness_state: string
  authoritative_work_order_id: string | null
  authoritative_device_id: string | null
  telemetry_age_seconds: number | null
  latest_decision: string | null
  contractor_id: string
  freshness_window_seconds: number
}

async function signInGetCookies(
  email: string,
  password: string
): Promise<{ client: SupabaseClient; cookieHeader: string }> {
  const { data, error } = await admin.auth.signInWithPassword({ email, password })
  if (error) throw error
  const session = data.session
  if (!session) throw new Error('no session')
  const cookieHeader = `sb-${SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token=${encodeURIComponent(JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: session.user,
  }))}`
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  })
  return { client, cookieHeader }
}

async function fetchState(
  cookieHeader: string,
  workzoneId: string
): Promise<{ status: number; json: StateResponse | null; text: string }> {
  const url = new URL(STATE_URL)
  url.searchParams.set('workzone_id', workzoneId)
  const res = await fetch(url.toString(), { headers: { cookie: cookieHeader } })
  const text = await res.text()
  let json: StateResponse | null = null
  try {
    json = JSON.parse(text) as StateResponse
  } catch {
    /* leave null */
  }
  return { status: res.status, json, text }
}

const cleanup: {
  contractorA?: string
  contractorB?: string
  wzSafe?: string
  wzWarn?: string
  wzLock?: string
  wzMissing?: string
  wzStale?: string
  wzAmbig?: string
  woSafe?: string
  woWarn?: string
  woLock?: string
  woStale?: string
  woAmbigA?: string
  woAmbigB?: string
  devSafe?: string
  devWarn?: string
  devLock?: string
  devStale?: string
  devAmbigA?: string
  devAmbigB?: string
  scanLogIds: string[]
  users: string[]
} = { scanLogIds: [], users: [] }

async function cleanupFn(): Promise<void> {
  try {
    for (const id of cleanup.scanLogIds) await admin.from('scan_logs').delete().eq('id', id)
    for (const woId of [cleanup.woSafe, cleanup.woWarn, cleanup.woLock, cleanup.woStale, cleanup.woAmbigA, cleanup.woAmbigB]) {
      if (woId) await admin.from('work_orders').delete().eq('id', woId)
    }
    for (const wzId of [cleanup.wzSafe, cleanup.wzWarn, cleanup.wzLock, cleanup.wzMissing, cleanup.wzStale, cleanup.wzAmbig]) {
      if (wzId) await admin.from('workzones').delete().eq('id', wzId)
    }
    for (const dId of [cleanup.devSafe, cleanup.devWarn, cleanup.devLock, cleanup.devStale, cleanup.devAmbigA, cleanup.devAmbigB]) {
      if (dId) await admin.from('devices').delete().eq('id', dId)
    }
    for (const uid of cleanup.users) await admin.auth.admin.deleteUser(uid)
    if (cleanup.contractorA) await admin.from('contractors').delete().eq('id', cleanup.contractorA)
    if (cleanup.contractorB) await admin.from('contractors').delete().eq('id', cleanup.contractorB)
  } catch (e) {
    console.warn('cleanup warning:', (e as Error).message)
  }
}

async function createWorkzone(
  contractorId: string,
  name: string,
  target: { lat: number; lon: number; depth: number }
): Promise<string> {
  const { data, error } = await admin
    .from('workzones')
    .insert({
      name,
      contractor_id: contractorId,
      target_lat: target.lat,
      target_lon: target.lon,
      target_depth_meters: target.depth,
    })
    .select('id')
    .single()
  if (error) throw error
  return data!.id
}

async function createWorkOrder(contractorId: string, workzoneId: string, status: string): Promise<string> {
  const { data, error } = await admin
    .from('work_orders')
    .insert({
      contractor_id: contractorId,
      workzone_id: workzoneId,
      status,
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error
  return data!.id
}

async function createDevice(contractorId: string, workzoneId: string, secretHash: string): Promise<string> {
  const { data, error } = await admin
    .from('devices')
    .insert({
      serial_number: `STATE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      contractor_id: contractorId,
      workzone_id: workzoneId,
      is_active: true,
      secret_hash: secretHash,
    })
    .select('id')
    .single()
  if (error) throw error
  return data!.id
}

async function main(): Promise<void> {
  await resetUsers(Object.values(EMAILS))

  const contractorA = await getOrCreateContractor('Prana State Tenant A')
  cleanup.contractorA = contractorA
  const contractorB = await getOrCreateContractor('Prana State Tenant B')
  cleanup.contractorB = contractorB

  const tenantAField = await ensureUser(EMAILS.tenantAField, PASSWORDS.tenantAField, 'field_supervisor', contractorA)
  cleanup.users.push(tenantAField)
  const tenantBField = await ensureUser(EMAILS.tenantBField, PASSWORDS.tenantBField, 'field_supervisor', contractorB)
  cleanup.users.push(tenantBField)
  const gov = await ensureUser(EMAILS.gov, PASSWORDS.gov, 'govt_auditor', null)
  cleanup.users.push(gov)

  const targetA = { lat: 28.6139, lon: 77.2090, depth: 3.0 }

  async function govCookies(): Promise<string> {
    const { cookieHeader } = await signInGetCookies(EMAILS.gov, PASSWORDS.gov)
    return cookieHeader
  }
  async function aFieldCookies(): Promise<string> {
    const { cookieHeader } = await signInGetCookies(EMAILS.tenantAField, PASSWORDS.tenantAField)
    return cookieHeader
  }
  async function bFieldCookies(): Promise<string> {
    const { cookieHeader } = await signInGetCookies(EMAILS.tenantBField, PASSWORDS.tenantBField)
    return cookieHeader
  }

  // Test 1: Fresh SAFE -> SAFE
  {
    const wz = await createWorkzone(contractorA, 'State-WZ-Safe', targetA)
    cleanup.wzSafe = wz
    const wo = await createWorkOrder(contractorA, wz, 'in_progress')
    cleanup.woSafe = wo
    const secret = `secret-safe-${Date.now()}`
    const dev = await createDevice(contractorA, wz, secret)
    cleanup.devSafe = dev
    await ingestFresh({
      deviceId: dev,
      workOrderId: wo,
      secret,
      target: { lat: targetA.lat, lon: targetA.lon },
      row: {
        h2s_ppm: 2.0, o2_percent: 20.9, depth_meters: targetA.depth,
        battery_percent: 85.0, is_warming_up: false,
        user_lat: targetA.lat, user_lon: targetA.lon,
      },
    })
    const { status, json } = await fetchState(await govCookies(), wz)
    const ok = status === 200 && json?.aggregate_state === 'SAFE' && json?.freshness_state === 'FRESH' &&
      json?.authoritative_work_order_id === wo && json?.authoritative_device_id === dev &&
      json?.telemetry_age_seconds !== null && json.telemetry_age_seconds < 30
    note('fresh SAFE telemetry -> SAFE', ok, `status=${status} state=${json?.aggregate_state}`)
  }

  // Test 2: Fresh WARNING -> WARNING
  {
    const wz = await createWorkzone(contractorA, 'State-WZ-Warn', targetA)
    cleanup.wzWarn = wz
    const wo = await createWorkOrder(contractorA, wz, 'in_progress')
    cleanup.woWarn = wo
    const secret = `secret-warn-${Date.now()}`
    const dev = await createDevice(contractorA, wz, secret)
    cleanup.devWarn = dev
    await ingestFresh({
      deviceId: dev, workOrderId: wo, secret,
      target: { lat: targetA.lat, lon: targetA.lon },
      row: {
        h2s_ppm: 12.0, o2_percent: 20.9, depth_meters: targetA.depth,
        battery_percent: 85.0, is_warming_up: false,
        user_lat: targetA.lat, user_lon: targetA.lon,
      },
    })
    const { status, json } = await fetchState(await govCookies(), wz)
    const ok = status === 200 && json?.aggregate_state === 'WARNING' && json?.freshness_state === 'FRESH'
    note('fresh WARNING telemetry -> WARNING', ok, `status=${status} state=${json?.aggregate_state}`)
  }

  // Test 3: Fresh LOCKOUT -> LOCKOUT
  {
    const wz = await createWorkzone(contractorA, 'State-WZ-Lock', targetA)
    cleanup.wzLock = wz
    const wo = await createWorkOrder(contractorA, wz, 'in_progress')
    cleanup.woLock = wo
    const secret = `secret-lock-${Date.now()}`
    const dev = await createDevice(contractorA, wz, secret)
    cleanup.devLock = dev
    await ingestFresh({
      deviceId: dev, workOrderId: wo, secret,
      target: { lat: targetA.lat, lon: targetA.lon },
      row: {
        h2s_ppm: 25.0, o2_percent: 20.9, depth_meters: targetA.depth,
        battery_percent: 85.0, is_warming_up: false,
        user_lat: targetA.lat, user_lon: targetA.lon,
      },
    })
    const { status, json } = await fetchState(await govCookies(), wz)
    const ok = status === 200 && json?.aggregate_state === 'LOCKOUT' && json?.freshness_state === 'FRESH'
    note('fresh LOCKOUT telemetry -> LOCKOUT', ok, `status=${status} state=${json?.aggregate_state}`)
  }

  // Test 4: Missing telemetry -> UNKNOWN
  {
    const wz = await createWorkzone(contractorA, 'State-WZ-Missing', targetA)
    cleanup.wzMissing = wz
    await createWorkOrder(contractorA, wz, 'pending')
    const { status, json } = await fetchState(await govCookies(), wz)
    const ok = status === 200 && json?.aggregate_state === 'UNKNOWN' &&
      json?.aggregate_reason === 'NO_TELEMETRY' && json?.freshness_state === 'MISSING'
    note('missing telemetry -> UNKNOWN (never SAFE)', ok, `status=${status} reason=${json?.aggregate_reason}`)
  }

  // Test 5: Stale telemetry -> UNKNOWN
  {
    const wz = await createWorkzone(contractorA, 'State-WZ-Stale', targetA)
    cleanup.wzStale = wz
    const wo = await createWorkOrder(contractorA, wz, 'in_progress')
    cleanup.woStale = wo
    const dev = await createDevice(contractorA, wz, 'no-secret-stale')
    cleanup.devStale = dev
    cleanup.scanLogIds.push(await insertBackdatedScanLog({
      workOrderId: wo, deviceId: dev, decision: 'SAFE',
      readings: { h2s_ppm: 1.0, o2_percent: 20.9, depth_meters: 3.0, battery_percent: 90.0 },
      ageSeconds: 120,
    }))
    const { status, json } = await fetchState(await govCookies(), wz)
    const ok = status === 200 && json?.aggregate_state === 'UNKNOWN' &&
      json?.aggregate_reason === 'TELEMETRY_STALE' && json?.freshness_state === 'STALE'
    note('stale telemetry (>30s) -> UNKNOWN (never SAFE)', ok, `status=${status} reason=${json?.aggregate_reason}`)
  }

  // Test 6: Invalid telemetry -> LOCKOUT
  {
    const wz = await createWorkzone(contractorA, 'State-WZ-Invalid', targetA)
    const wo = await createWorkOrder(contractorA, wz, 'in_progress')
    const dev = await createDevice(contractorA, wz, 'no-secret-invalid')
    cleanup.scanLogIds.push(await insertBackdatedScanLog({
      workOrderId: wo, deviceId: dev, decision: 'LOCKOUT',
      readings: { reason: 'INVALID_OR_MISSING_SENSOR_DATA' },
      ageSeconds: 1,
    }))
    const { status, json } = await fetchState(await govCookies(), wz)
    const ok = status === 200 && json?.aggregate_state === 'LOCKOUT' && json?.freshness_state === 'FRESH'
    note('invalid telemetry -> aggregate LOCKOUT', ok, `status=${status} state=${json?.aggregate_state}`)
    await admin.from('work_orders').delete().eq('id', wo)
    await admin.from('devices').delete().eq('id', dev)
    await admin.from('workzones').delete().eq('id', wz)
  }

  // Test 7: Multiple in_progress with fresh telemetry -> AMBIGUOUS
  {
    const wz = await createWorkzone(contractorA, 'State-WZ-Ambig', targetA)
    cleanup.wzAmbig = wz
    const woA = await createWorkOrder(contractorA, wz, 'in_progress')
    const woB = await createWorkOrder(contractorA, wz, 'in_progress')
    cleanup.woAmbigA = woA; cleanup.woAmbigB = woB
    const devA = await createDevice(contractorA, wz, 'amb-a')
    const devB = await createDevice(contractorA, wz, 'amb-b')
    cleanup.devAmbigA = devA; cleanup.devAmbigB = devB
    cleanup.scanLogIds.push(await insertBackdatedScanLog({
      workOrderId: woA, deviceId: devA, decision: 'SAFE', readings: { h2s_ppm: 1.0 }, ageSeconds: 1,
    }))
    cleanup.scanLogIds.push(await insertBackdatedScanLog({
      workOrderId: woB, deviceId: devB, decision: 'SAFE', readings: { h2s_ppm: 2.0 }, ageSeconds: 1,
    }))
    const { status, json } = await fetchState(await govCookies(), wz)
    const ok = status === 200 && json?.aggregate_state === 'UNKNOWN' &&
      json?.aggregate_reason === 'AMBIGUOUS_AUTHORITY' && json?.freshness_state === 'AMBIGUOUS'
    note('multiple in_progress fresh candidates -> UNKNOWN AMBIGUOUS', ok, `status=${status} reason=${json?.aggregate_reason}`)
  }

  // Test 8: Cross-tenant contractor blocked at API + RPC
  {
    const wzA = await createWorkzone(contractorA, 'State-WZ-CrossA', targetA)
    const woA = await createWorkOrder(contractorA, wzA, 'in_progress')
    const devA = await createDevice(contractorA, wzA, 'cross-a')
    cleanup.scanLogIds.push(await insertBackdatedScanLog({
      workOrderId: woA, deviceId: devA, decision: 'SAFE',
      readings: { h2s_ppm: 1.0 }, ageSeconds: 1,
    }))

    const { status } = await fetchState(await bFieldCookies(), wzA)
    const apiBlocked = status === 403 || status === 401

    const sb = createClient(SUPABASE_URL, ANON_KEY)
    const { data: signIn } = await sb.auth.signInWithPassword({
      email: EMAILS.tenantAField, password: PASSWORDS.tenantAField,
    })
    const rpcClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } },
    })
    const { error } = await rpcClient.rpc('get_workzone_authoritative_state', { p_workzone_id: wzA })
    const rpcBlocked = !!error

    note('cross-tenant contractor blocked at API + RPC', apiBlocked && rpcBlocked, `api=${status} rpcErr=${rpcBlocked ? error!.message : 'none'}`)

    await admin.from('work_orders').delete().eq('id', woA)
    await admin.from('devices').delete().eq('id', devA)
    await admin.from('workzones').delete().eq('id', wzA)
  }

  // Test 9: govt_auditor can read all contractor states
  {
    const cookies = await govCookies()
    const targets = [cleanup.wzSafe, cleanup.wzWarn, cleanup.wzLock, cleanup.wzMissing, cleanup.wzStale, cleanup.wzAmbig]
      .filter((x): x is string => !!x)
    const statuses: number[] = []
    for (const id of targets) {
      const { status } = await fetchState(cookies, id)
      statuses.push(status)
    }
    const ok = statuses.every((s) => s === 200)
    note('govt_auditor can read all contractor workzone states', ok, `statuses=${JSON.stringify(statuses)}`)
  }

  // Test 10: scan_logs remains append-only
  {
    const backdated = await insertBackdatedScanLog({
      workOrderId: cleanup.woSafe!, deviceId: cleanup.devSafe!,
      decision: 'SAFE', readings: { h2s_ppm: 1.0 }, ageSeconds: 1,
    })
    cleanup.scanLogIds.push(backdated)

    const sb = createClient(SUPABASE_URL, ANON_KEY)
    const { data: signIn } = await sb.auth.signInWithPassword({
      email: EMAILS.tenantAField, password: PASSWORDS.tenantAField,
    })
    const client = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } },
    })
    const upd = await client.from('scan_logs').update({ decision: 'LOCKOUT' }).eq('id', backdated).select('id')
    const updBlocked = !!upd.error || (upd.data?.length ?? 0) === 0
    const del = await client.from('scan_logs').delete().eq('id', backdated).select('id')
    const delBlocked = !!del.error || (del.data?.length ?? 0) === 0

    const { data: still } = await admin.from('scan_logs').select('decision').eq('id', backdated).maybeSingle()
    const unchanged = still?.decision === 'SAFE'

    note('scan_logs remains append-only', updBlocked && delBlocked && unchanged, `updBlocked=${updBlocked} delBlocked=${delBlocked} decision=${still?.decision}`)
  }

  await cleanupFn()
  const failed = results.filter((r) => !r.passed)
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`)
  if (failed.length > 0) {
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
    process.exit(1)
  } else {
    process.exit(0)
  }
}

main().catch(async (err) => {
  console.error('script error:', err)
  await cleanupFn()
  process.exit(1)
})

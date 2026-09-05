import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

config({ path: '.env.local' })
config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set in your environment.')
}
if (!ANON_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set in your environment.')
}
if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in your environment.')
}

const PASSWORDS = {
  tenantAFieldA: 'Prana-TenantA-FieldA-2026!',
  tenantAFieldB: 'Prana-TenantA-FieldB-2026!',
  tenantBField: 'Prana-TenantB-Field-2026!',
  gov: 'Prana-Govt-Auditor-2026!',
}

const EMAILS = {
  tenantAFieldA: 'tenant-a-field-a@prana.test',
  tenantAFieldB: 'tenant-a-field-b@prana.test',
  tenantBField: 'tenant-b-field@prana.test',
  gov: 'govt-auditor@prana.test',
}

const LATEST_URL = new URL('/api/telemetry/latest', 'http://localhost:3000')

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
}

type Summary = { name: string; passed: boolean; detail: string }

const results: Summary[] = []

const note = (name: string, passed: boolean, detail: string): void => {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function resetTestUsers(exactEmails: string[]): Promise<void> {
  let page = 1
  const perPage = 100
  const targets = new Set(exactEmails)
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    for (const u of data.users) {
      if (u.email && targets.has(u.email)) {
        await admin.auth.admin.deleteUser(u.id)
      }
    }
    if (data.nextPage === null || page >= (data.lastPage ?? 0)) break
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
  if (!data.user) throw new Error(`Failed to create user ${email}`)
  const id = data.user.id

  const { error: upsertError } = await admin.from('profiles').upsert({
    id,
    role,
    contractor_id: contractorId ?? null,
  })
  if (upsertError) throw upsertError
  return id
}

async function getOrCreateContractor(name: string): Promise<string> {
  const { data, error } = await admin
    .from('contractors')
    .select('id')
    .eq('name', name)
    .maybeSingle()
  if (error) throw error
  if (data) return data.id

  const { data: created, error: createError } = await admin
    .from('contractors')
    .insert({ name })
    .select('id')
    .single()
  if (createError) throw createError
  if (!created) throw new Error(`Failed to create contractor ${name}`)
  return created.id
}

const cleanup: {
  contractorA?: string
  contractorB?: string
  workzoneA1?: string
  workzoneA2?: string
  workzoneB1?: string
  workOrderA1?: string
  workOrderA2?: string
  workOrderB1?: string
  deviceA1?: string
  deviceA2?: string
  deviceB1?: string
  assignmentA1?: string
  assignmentA2?: string
  assignmentB1?: string
  scanLogOld?: string
  scanLogNew?: string
  scanLogStale?: string
  users: string[]
} = { users: [] }

async function cleanupFn(): Promise<void> {
  try {
    for (const id of [cleanup.scanLogOld, cleanup.scanLogNew, cleanup.scanLogStale].filter(Boolean)) {
      await admin.from('scan_logs').delete().eq('id', id!)
    }
    for (const id of [cleanup.assignmentA1, cleanup.assignmentA2, cleanup.assignmentB1].filter(Boolean)) {
      await admin.from('workzone_assignments').delete().eq('id', id!)
    }
    if (cleanup.workOrderA1) await admin.from('work_orders').delete().eq('id', cleanup.workOrderA1)
    if (cleanup.workOrderA2) await admin.from('work_orders').delete().eq('id', cleanup.workOrderA2)
    if (cleanup.workOrderB1) await admin.from('work_orders').delete().eq('id', cleanup.workOrderB1)
    if (cleanup.workzoneA1) await admin.from('workzones').delete().eq('id', cleanup.workzoneA1)
    if (cleanup.workzoneA2) await admin.from('workzones').delete().eq('id', cleanup.workzoneA2)
    if (cleanup.workzoneB1) await admin.from('workzones').delete().eq('id', cleanup.workzoneB1)
    for (const id of [cleanup.deviceA1, cleanup.deviceA2, cleanup.deviceB1].filter(Boolean)) {
      await admin.from('devices').delete().eq('id', id!)
    }
    for (const uid of cleanup.users) {
      await admin.auth.admin.deleteUser(uid)
    }
    if (cleanup.contractorA) await admin.from('contractors').delete().eq('id', cleanup.contractorA)
    if (cleanup.contractorB) await admin.from('contractors').delete().eq('id', cleanup.contractorB)
  } catch (e) {
    console.warn('Cleanup warning:', (e as Error).message)
  }
}

async function postLatest(params: { cookies: string[]; device_id: string }): Promise<{
  status: number
  json: unknown
  text: string
}> {
  const url = new URL(LATEST_URL.toString())
  url.searchParams.set('device_id', params.device_id)

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      cookie: params.cookies.join('; '),
    },
    redirect: 'follow',
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

async function signInAs(email: string, password: string): Promise<{ client: SupabaseClient; cookieHeader: string }> {
  // Use the same cookie-based mechanism as the browser/@supabase/ssr
  const cookieJar: Record<string, string> = {}

  const browserClient = createBrowserClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll() {
        return Object.entries(cookieJar).map(([name, value]) => ({ name, value }))
      },
      setAll(cookiesToSet: Array<{ name: string; value: string }>) {
        for (const { name, value } of cookiesToSet) {
          if (value) {
            cookieJar[name] = value
          } else {
            delete cookieJar[name]
          }
        }
      },
    },
  })

  const { data, error } = await browserClient.auth.signInWithPassword({ email, password })
  if (error) throw error

  const cookieHeader = Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ')

  return { client: browserClient, cookieHeader }
}

async function main(): Promise<void> {
  await resetTestUsers(Object.values(EMAILS))

  const contractorA = await getOrCreateContractor('Prana Tenant A')
  cleanup.contractorA = contractorA
  const contractorB = await getOrCreateContractor('Prana Tenant B')
  cleanup.contractorB = contractorB

  const tenantAFieldA = await ensureUser(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA, 'field_supervisor', contractorA)
  cleanup.users.push(tenantAFieldA)
  const tenantAFieldB = await ensureUser(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB, 'field_supervisor', contractorA)
  cleanup.users.push(tenantAFieldB)
  const tenantBField = await ensureUser(EMAILS.tenantBField, PASSWORDS.tenantBField, 'field_supervisor', contractorB)
  cleanup.users.push(tenantBField)
  const gov = await ensureUser(EMAILS.gov, PASSWORDS.gov, 'govt_auditor', null)
  cleanup.users.push(gov)

  const { data: wzA1 } = await admin
    .from('workzones')
    .insert({ name: 'TenantA-Workzone-1', contractor_id: contractorA, target_lat: 28.6139, target_lon: 77.2090, target_depth_meters: 3.0 })
    .select('id')
    .single()
  if (!wzA1) throw new Error('failed to create wzA1')
  cleanup.workzoneA1 = wzA1.id

  const { data: wzA2 } = await admin
    .from('workzones')
    .insert({ name: 'TenantA-Workzone-2', contractor_id: contractorA, target_lat: 28.6149, target_lon: 77.2100, target_depth_meters: 4.0 })
    .select('id')
    .single()
  if (!wzA2) throw new Error('failed to create wzA2')
  cleanup.workzoneA2 = wzA2.id

  const { data: wzB1 } = await admin
    .from('workzones')
    .insert({ name: 'TenantB-Workzone-1', contractor_id: contractorB, target_lat: 28.6159, target_lon: 77.2110, target_depth_meters: 5.0 })
    .select('id')
    .single()
  if (!wzB1) throw new Error('failed to create wzB1')
  cleanup.workzoneB1 = wzB1.id

  const { data: woA1 } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorA, workzone_id: wzA1.id, status: 'pending', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (!woA1) throw new Error('failed to create woA1')
  cleanup.workOrderA1 = woA1.id

  const { data: woA2 } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorA, workzone_id: wzA2.id, status: 'pending', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (!woA2) throw new Error('failed to create woA2')
  cleanup.workOrderA2 = woA2.id

  const { data: woB1 } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorB, workzone_id: wzB1.id, status: 'pending', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (!woB1) throw new Error('failed to create woB1')
  cleanup.workOrderB1 = woB1.id

  const { data: deviceA1 } = await admin
    .from('devices')
    .insert({ serial_number: `DEV-A1-${Date.now()}`, contractor_id: contractorA, workzone_id: wzA1.id, is_active: true, secret_hash: 'hash-a1' })
    .select('id')
    .single()
  if (!deviceA1) throw new Error('failed to create deviceA1')
  cleanup.deviceA1 = deviceA1.id

  const { data: deviceA2 } = await admin
    .from('devices')
    .insert({ serial_number: `DEV-A2-${Date.now()}`, contractor_id: contractorA, workzone_id: wzA2.id, is_active: true, secret_hash: 'hash-a2' })
    .select('id')
    .single()
  if (!deviceA2) throw new Error('failed to create deviceA2')
  cleanup.deviceA2 = deviceA2.id

  const { data: deviceB1 } = await admin
    .from('devices')
    .insert({ serial_number: `DEV-B1-${Date.now()}`, contractor_id: contractorB, workzone_id: wzB1.id, is_active: true, secret_hash: 'hash-b1' })
    .select('id')
    .single()
  if (!deviceB1) throw new Error('failed to create deviceB1')
  cleanup.deviceB1 = deviceB1.id

  const { data: assignmentA1 } = await admin
    .from('workzone_assignments')
    .insert({ workzone_id: wzA1.id, assigned_staff_id: tenantAFieldA, contractor_id: contractorA })
    .select('id')
    .single()
  if (!assignmentA1) throw new Error('failed to create assignmentA1')
  cleanup.assignmentA1 = assignmentA1.id

  const { data: assignmentA2 } = await admin
    .from('workzone_assignments')
    .insert({ workzone_id: wzA2.id, assigned_staff_id: tenantAFieldA, contractor_id: contractorA })
    .select('id')
    .single()
  if (!assignmentA2) throw new Error('failed to create assignmentA2')
  cleanup.assignmentA2 = assignmentA2.id

  const { data: assignmentB1 } = await admin
    .from('workzone_assignments')
    .insert({ workzone_id: wzB1.id, assigned_staff_id: tenantBField, contractor_id: contractorB })
    .select('id')
    .single()
  if (!assignmentB1) throw new Error('failed to create assignmentB1')
  cleanup.assignmentB1 = assignmentB1.id

  const oldTimestamp = Date.now() - 60_000
  const newTimestamp = Date.now()

  const { data: scanLogOld } = await admin
    .from('scan_logs')
    .insert({
      work_order_id: woA1.id,
      device_id: deviceA1.id,
      readings: { timestamp: oldTimestamp, h2s_ppm: 1.0, o2_percent: 20.9, depth_meters: 3.0, battery_percent: 80.0 },
      created_at: new Date(oldTimestamp).toISOString(),
      timestamp: new Date(oldTimestamp).toISOString(),
    })
    .select('id')
    .single()
  if (!scanLogOld) throw new Error('failed to create scanLogOld')
  cleanup.scanLogOld = scanLogOld.id

  const { data: scanLogNew } = await admin
    .from('scan_logs')
    .insert({
      work_order_id: woA1.id,
      device_id: deviceA1.id,
      readings: { timestamp: newTimestamp, h2s_ppm: 2.5, o2_percent: 21.0, depth_meters: 3.1, battery_percent: 75.0 },
      created_at: new Date(newTimestamp).toISOString(),
      timestamp: new Date(newTimestamp).toISOString(),
    })
    .select('id')
    .single()
  if (!scanLogNew) throw new Error('failed to create scanLogNew')
  cleanup.scanLogNew = scanLogNew.id

  const staleTimestamp = Date.now() - 120_000
  const { data: scanLogStale } = await admin
    .from('scan_logs')
    .insert({
      work_order_id: woA2.id,
      device_id: deviceA2.id,
      readings: { timestamp: staleTimestamp, h2s_ppm: 3.0, o2_percent: 20.5, depth_meters: 4.0, battery_percent: 60.0 },
      created_at: new Date(staleTimestamp).toISOString(),
      timestamp: new Date(staleTimestamp).toISOString(),
    })
    .select('id')
    .single()
  if (!scanLogStale) throw new Error('failed to create scanLogStale')
  cleanup.scanLogStale = scanLogStale.id

  // ==========================================================================
  // Test 1: authenticated assigned field supervisor can retrieve latest telemetry
  // ==========================================================================
  {
    const { cookieHeader } = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)

    const { status, json } = await postLatest({ device_id: deviceA1.id, cookies: cookieHeader.split('; ') })

    const ok: boolean = status === 200 && !!json && typeof json === 'object'
    const payload = json as LatestTelemetryResponse | null
    const valuesOk: boolean =
      payload?.h2s === 2.5 &&
      payload?.o2 === 21.0 &&
      payload?.depth === 3.1 &&
      payload?.battery === 75.0 &&
      payload?.timestamp === newTimestamp &&
      payload?.device_id === deviceA1.id &&
      payload?.work_order_id === woA1.id

    note('assigned field supervisor can retrieve latest telemetry', ok && valuesOk, `status=${status} h2s=${payload?.h2s} ts=${payload?.timestamp}`)
  }

  // ==========================================================================
  // Test 2: field supervisor cannot retrieve telemetry for unassigned device
  // ==========================================================================
  {
    const { cookieHeader } = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)

    const { status, json } = await postLatest({ device_id: deviceB1.id, cookies: cookieHeader.split('; ') })

    const blocked = status === 404 || status === 401 || status === 403
    note('field supervisor cannot retrieve unassigned device telemetry', blocked, `status=${status} body=${JSON.stringify(json)}`)
  }

  // ==========================================================================
  // Test 3: cross-tenant telemetry cannot be retrieved
  // ==========================================================================
  {
    const { cookieHeader } = await signInAs(EMAILS.tenantBField, PASSWORDS.tenantBField)

    const { status, json } = await postLatest({ device_id: deviceA1.id, cookies: cookieHeader.split('; ') })

    const blocked = status === 404 || status === 401 || status === 403
    note('cross-tenant telemetry blocked', blocked, `status=${status} body=${JSON.stringify(json)}`)
  }

  // ==========================================================================
  // Test 4: latest telemetry is actually returned rather than an older record
  // ==========================================================================
  {
    const { cookieHeader } = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)

    const { status, json } = await postLatest({ device_id: deviceA1.id, cookies: cookieHeader.split('; ') })

    const payload = json as LatestTelemetryResponse | null
    const isLatest: boolean = payload?.timestamp === newTimestamp && payload?.h2s === 2.5
    note('latest telemetry returned, not older record', status === 200 && isLatest, `status=${status} ts=${payload?.timestamp} h2s=${payload?.h2s}`)
  }

  // ==========================================================================
  // Test 5: stale telemetry preserves its real timestamp / is not falsely presented as fresh
  // ==========================================================================
  {
    const { cookieHeader } = await signInAs(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB)

    const { status, json } = await postLatest({ device_id: deviceA2.id, cookies: cookieHeader.split('; ') })

    const payload = json as LatestTelemetryResponse | null
    const stalePreserved: boolean =
      status === 200 &&
      payload?.timestamp === staleTimestamp &&
      payload?.h2s === 3.0 &&
      payload?.o2 === 20.5 &&
      payload?.depth === 4.0 &&
      payload?.battery === 60.0

    note('stale telemetry preserves real timestamp', stalePreserved, `status=${status} ts=${payload?.timestamp} h2s=${payload?.h2s}`)
  }

  // ==========================================================================
  // Test 6: unauthenticated access is rejected
  // ==========================================================================
  {
    const { status } = await postLatest({ device_id: deviceA1.id, cookies: [] })

    const rejected = status === 401 || status === 403
    note('unauthenticated access rejected', rejected, `status=${status}`)
  }

  // ==========================================================================
  // Test 7: govt_auditor can read cross-tenant telemetry
  // ==========================================================================
  {
    const { cookieHeader } = await signInAs(EMAILS.gov, PASSWORDS.gov)

    const { status, json } = await postLatest({ device_id: deviceA1.id, cookies: cookieHeader.split('; ') })

    const payload = json as LatestTelemetryResponse | null
    const ok: boolean = status === 200 && payload?.h2s === 2.5 && payload?.timestamp === newTimestamp
    note('govt_auditor can read cross-tenant telemetry', ok, `status=${status} h2s=${payload?.h2s}`)
  }

  const failed = results.filter((r) => !r.passed)
  console.log(
    `\nSummary: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`
  )
  if (failed.length > 0) {
    console.log('FAILED:')
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
  }

  await cleanupFn()
  if (failed.length > 0) process.exit(1)
  else process.exit(0)
}

main().catch((err) => {
  console.error('Script error:', err)
  process.exitCode = 1
})

import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
  tenantAField: 'Prana-TenantA-Field-2026!',
  tenantBField: 'Prana-TenantB-Field-2026!',
}

const EMAILS = {
  tenantAField: 'tenant-a-field@prana.test',
  tenantBField: 'tenant-b-field@prana.test',
}

type Summary = { name: string; passed: boolean; detail: string }

const results: Summary[] = []

const note = (name: string, passed: boolean, detail: string): void => {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

class MemoryStorage {
  private store: Record<string, string> = {}
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null
  }
  setItem(key: string, value: string): void {
    this.store[key] = value
  }
  removeItem(key: string): void {
    delete this.store[key]
  }
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function authenticatedClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { storage: new MemoryStorage() },
  })
}

async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const client = authenticatedClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

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

async function main(): Promise<void> {
  await resetTestUsers(Object.values(EMAILS))

  const contractorA = await getOrCreateContractor('Prana Tenant A')
  const contractorB = await getOrCreateContractor('Prana Tenant B')

  const tenantAField = await ensureUser(EMAILS.tenantAField, PASSWORDS.tenantAField, 'field_supervisor', contractorA)
  const tenantBField = await ensureUser(EMAILS.tenantBField, PASSWORDS.tenantBField, 'field_supervisor', contractorB)

  const { data: wzA1 } = await admin
    .from('workzones')
    .insert({ name: 'TenantA-Workzone-1', contractor_id: contractorA, target_lat: 28.6139, target_lon: 77.2090, target_depth_meters: 3.0 })
    .select('id')
    .single()
  if (!wzA1) throw new Error('Failed to create wzA1')

  const { data: wzB1 } = await admin
    .from('workzones')
    .insert({ name: 'TenantB-Workzone-1', contractor_id: contractorB, target_lat: 28.6159, target_lon: 77.2110, target_depth_meters: 5.0 })
    .select('id')
    .single()
  if (!wzB1) throw new Error('Failed to create wzB1')

  const { data: woA1 } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorA, workzone_id: wzA1.id, status: 'in_progress', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (!woA1) throw new Error('Failed to create woA1')

  const { data: woA2 } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorA, workzone_id: wzA1.id, status: 'in_progress', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (!woA2) throw new Error('Failed to create woA2')

  const { data: woB1 } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorB, workzone_id: wzB1.id, status: 'in_progress', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (!woB1) throw new Error('Failed to create woB1')

  const { data: deviceA1 } = await admin
    .from('devices')
    .insert({ serial_number: `DEV-${Date.now()}`, secret_hash: 'test-secret', is_active: true, workzone_id: wzA1.id, contractor_id: contractorA })
    .select('id')
    .single()
  if (!deviceA1) throw new Error('Failed to create deviceA1')

  const { data: assignmentA1 } = await admin
    .from('workzone_assignments')
    .insert({ workzone_id: wzA1.id, assigned_staff_id: tenantAField, contractor_id: contractorA })
    .select('id')
    .single()
  if (!assignmentA1) throw new Error('Failed to create assignmentA1')

  // ==========================================================================
  // A. assigned field supervisor can query own workzone state
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)
    const { data, error } = await client
      .rpc('get_workzone_authoritative_state_for_view', { p_workzone_id: wzA1.id })

    const ok = !error && !!data && data.workzone_id === wzA1.id
    note(
      'assigned field supervisor can query own workzone state',
      ok,
      ok ? `state=${data.aggregate_state}` : `error=${error?.message}`
    )
  }

  // ==========================================================================
  // B. field supervisor cannot query another contractor's workzone
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)
    const { data, error } = await client
      .rpc('get_workzone_authoritative_state_for_view', { p_workzone_id: wzB1.id })

    const blocked = !error && data && data.aggregate_state === 'NOT_FOUND'
    note(
      'field supervisor cannot query another contractor workzone',
      blocked,
      `data=${JSON.stringify(data)} err=${error?.message ?? 'none'}`
    )
  }

  // ==========================================================================
  // C. permit issuance succeeds when all conditions pass
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)

    const { error: scanErr } = await admin
      .from('scan_logs')
      .insert({
        work_order_id: woA1.id,
        device_id: deviceA1.id,
        readings: { h2s_ppm: 5, o2_percent: 20.5, depth_meters: 2.5, battery_percent: 80, is_warming_up: false, user_lat: 28.6139, user_lon: 77.2090 },
        decision: 'SAFE',
        prev_hash: 'genesis',
        row_hash: 'h-fresh-safe',
        timestamp: new Date().toISOString(),
      })
    if (scanErr) throw scanErr

    const { data: permit, error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const ok = !error && !!permit && permit.status === 'ISSUED'
    note(
      'permit issuance succeeds with fresh SAFE telemetry inside geofence',
      ok,
      ok ? `permit=${permit.id}` : `error=${error?.message}`
    )
  }

  // ==========================================================================
  // D. stale telemetry rejects permit
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)

    const { error: scanErr } = await admin
      .from('scan_logs')
      .insert({
        work_order_id: woA1.id,
        device_id: deviceA1.id,
        readings: { h2s_ppm: 5, o2_percent: 20.5, depth_meters: 2.5, battery_percent: 80, is_warming_up: false },
        decision: 'SAFE',
        prev_hash: 'genesis',
        row_hash: 'h-stale',
        timestamp: new Date(Date.now() - 31 * 1000).toISOString(),
      })
    if (scanErr) throw scanErr

    const { error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const blocked = !!error && error.message.includes('not fresh')
    note(
      'stale telemetry rejects permit',
      blocked,
      blocked ? `blocked (${error.message})` : `unexpectedly succeeded`
    )
  }

  // ==========================================================================
  // E. missing telemetry rejects permit
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)

    const { error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const blocked = !!error && error.message.includes('not fresh')
    note(
      'missing telemetry rejects permit',
      blocked,
      blocked ? `blocked (${error.message})` : `unexpectedly succeeded`
    )
  }

  // ==========================================================================
  // F. ambiguous authority rejects permit
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)
    await admin.from('scan_logs').delete().eq('work_order_id', woA2.id)
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)

    const now = new Date().toISOString()
    const { error: scan1Err } = await admin
      .from('scan_logs')
      .insert({
        work_order_id: woA1.id,
        device_id: deviceA1.id,
        readings: { h2s_ppm: 5, o2_percent: 20.5, depth_meters: 2.5, battery_percent: 80, is_warming_up: false },
        decision: 'SAFE',
        prev_hash: 'genesis',
        row_hash: 'h-ambig-1',
        timestamp: now,
      })
    if (scan1Err) throw scan1Err

    const { error: scan2Err } = await admin
      .from('scan_logs')
      .insert({
        work_order_id: woA2.id,
        device_id: deviceA1.id,
        readings: { h2s_ppm: 5, o2_percent: 20.5, depth_meters: 2.5, battery_percent: 80, is_warming_up: false },
        decision: 'SAFE',
        prev_hash: 'genesis',
        row_hash: 'h-ambig-2',
        timestamp: now,
      })
    if (scan2Err) throw scan2Err

    const { error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const blocked = !!error && error.message.includes('not fresh')
    note(
      'ambiguous authority rejects permit',
      blocked,
      blocked ? `blocked (${error.message})` : `unexpectedly succeeded`
    )
  }

  // ==========================================================================
  // G. unsafe decision rejects permit
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)
    await admin.from('scan_logs').delete().eq('work_order_id', woA2.id)
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)

    const { error: scanErr } = await admin
      .from('scan_logs')
      .insert({
        work_order_id: woA1.id,
        device_id: deviceA1.id,
        readings: { h2s_ppm: 12, o2_percent: 20.5, depth_meters: 2.5, battery_percent: 80, is_warming_up: false },
        decision: 'WARNING',
        prev_hash: 'genesis',
        row_hash: 'h-unsafe',
        timestamp: new Date().toISOString(),
      })
    if (scanErr) throw scanErr

    const { error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const blocked = !!error && error.message.includes('not safe')
    note(
      'unsafe decision rejects permit',
      blocked,
      blocked ? `blocked (${error.message})` : `unexpectedly succeeded`
    )
  }

  // ==========================================================================
  // H. outside geofence rejects permit
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)

    const { error: scanErr } = await admin
      .from('scan_logs')
      .insert({
        work_order_id: woA1.id,
        device_id: deviceA1.id,
        readings: { h2s_ppm: 5, o2_percent: 20.5, depth_meters: 2.5, battery_percent: 80, is_warming_up: false },
        decision: 'SAFE',
        prev_hash: 'genesis',
        row_hash: 'h-geofence',
        timestamp: new Date().toISOString(),
      })
    if (scanErr) throw scanErr

    const { error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6149,
      p_lon: 77.2100,
    })

    const blocked = !!error && error.message.includes('outside geofence')
    note(
      'outside geofence rejects permit',
      blocked,
      blocked ? `blocked (${error.message})` : `unexpectedly succeeded`
    )
  }

  // ==========================================================================
  // I. unauthorized/unassigned supervisor rejects permit
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)
    await admin.from('workzone_assignments').delete().eq('id', assignmentA1.id)
    const client = await signInAs(EMAILS.tenantBField, PASSWORDS.tenantBField)

    const { error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const blocked = !!error && error.message.includes('not assigned')
    note(
      'unauthorized/unassigned supervisor rejects permit',
      blocked,
      blocked ? `blocked (${error.message})` : `unexpectedly succeeded`
    )
  }

  // ==========================================================================
  // J. crafted client request cannot bypass safety checks
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)
    await admin.from('workzone_assignments').insert({ workzone_id: wzA1.id, assigned_staff_id: tenantAField, contractor_id: contractorA })
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)

    const { error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woB1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const blocked = !!error && error.message.includes('does not belong to this workzone')
    note(
      'crafted client request cannot bypass work_order/workzone check',
      blocked,
      blocked ? `blocked (${error.message})` : `unexpectedly succeeded`
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
    const failed = results.filter((r) => !r.passed)
    if (failed.length > 0) process.exit(1)
    else process.exit(0)
  })

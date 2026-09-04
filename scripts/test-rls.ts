import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'

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
  tenantA: 'Prana-TenantA-Field-2026!',
  tenantB: 'Prana-TenantB-Field-2026!',
  gov: 'Prana-Govt-Auditor-2026!',
}

const EMAILS = {
  tenantA: 'tenant-a-field@prana.test',
  tenantB: 'tenant-b-field@prana.test',
  gov: 'govt-auditor@prana.test',
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
    return Object.prototype.hasOwnProperty.call(this.store, key)
      ? this.store[key]
      : null
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

// The Supabase Auth admin API in this version has no getUserByEmail helper, so
// users are located via paginated listUsers. Only the EXACT test emails this
// script uses are ever targeted for deletion (no broad domain sweeps).

// Delete any existing auth users whose email exactly matches the provided set,
// so each run of this script starts from a clean, deterministic state.
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

async function getWorkOrdersFor(
  client: SupabaseClient,
  contractorId: string
) {
  return client
    .from('work_orders')
    .select('id, workzone_id, contractor_id')
    .eq('contractor_id', contractorId)
}

const createdIds: {
  workOrderA?: string
  workOrderB?: string
  triggerUser?: string
  users: string[]
} = { users: [] }

async function cleanup(): Promise<void> {
  try {
    if (createdIds.workOrderA) {
      await admin.from('scan_logs').delete().eq('work_order_id', createdIds.workOrderA)
    }
    if (createdIds.workOrderA) {
      await admin.from('work_orders').delete().eq('id', createdIds.workOrderA)
    }
    if (createdIds.workOrderB) {
      await admin.from('work_orders').delete().eq('id', createdIds.workOrderB)
    }
    for (const uid of createdIds.users) {
      await admin.auth.admin.deleteUser(uid)
    }
  } catch (e) {
    console.warn('Cleanup warning:', (e as Error).message)
  }
}

async function main(): Promise<void> {
  await resetTestUsers(Object.values(EMAILS))

  const contractorA = await getOrCreateContractor('Prana Tenant A')
  const contractorB = await getOrCreateContractor('Prana Tenant B')

  const workOrderA = await admin
    .from('work_orders')
    .insert({
      contractor_id: contractorA,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (workOrderA.error) throw workOrderA.error
  createdIds.workOrderA = workOrderA.data.id

  const workOrderB = await admin
    .from('work_orders')
    .insert({
      contractor_id: contractorB,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (workOrderB.error) throw workOrderB.error
  createdIds.workOrderB = workOrderB.data.id

  const tenantAField = await ensureUser(
    EMAILS.tenantA,
    PASSWORDS.tenantA,
    'field_supervisor',
    contractorA
  )
  const tenantBField = await ensureUser(
    EMAILS.tenantB,
    PASSWORDS.tenantB,
    'field_supervisor',
    contractorB
  )
  const gov = await ensureUser(EMAILS.gov, PASSWORDS.gov, 'govt_auditor', null)
  createdIds.users.push(tenantAField, tenantBField, gov)

  // Test 0: handle_new_user trigger auto-creates a profile on signup.
  {
    const email = `trigger-${Date.now()}@prana.test`
    const password = 'Prana-Trigger-2026!'
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) throw error
    const newUserId = data.user?.id
    if (!newUserId) throw new Error('trigger user creation failed')
    createdIds.triggerUser = newUserId

    const { data: profile, error: perr } = await admin
      .from('profiles')
      .select('role, contractor_id')
      .eq('id', newUserId)
      .maybeSingle()

    const ok =
      !perr && profile?.role === 'field_supervisor' && profile?.contractor_id === null
    note(
      'handle_new_user trigger',
      ok,
      ok
        ? `profile auto-created with role=${profile?.role}`
        : `no/incorrect profile: ${perr?.message ?? JSON.stringify(profile)}`
    )
  }

  // Test 1: a tenant field supervisor cannot read another tenant's data.
  {
    const client = await signInAs(EMAILS.tenantB, PASSWORDS.tenantB)
    const own = await getWorkOrdersFor(client, contractorB)
    const cross = await getWorkOrdersFor(client, contractorA)
    const ownCount = own.data?.length ?? 0
    const crossCount = cross.data?.length ?? 0
    const blocked = crossCount === 0
    note(
      'cross-tenant read blocked for field supervisor',
      blocked && ownCount >= 1,
      `tenant-B field sees ${ownCount} own work_orders, ${crossCount} tenant-A work_orders (cross must be 0)`
    )
  }

  // Test 2: govt_auditor can read across tenants.
  {
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const cross = await getWorkOrdersFor(client, contractorA)
    const crossCount = cross.data?.length ?? 0
    note(
      'govt_auditor cross-tenant read allowed',
      crossCount >= 1,
      `govt_auditor sees ${crossCount} tenant-A work_orders (expected >= 1)`
    )
  }

  // Test 3: scan_logs is INSERT-only (reads + inserts work; updates/deletes blocked).
  {
    const scanRes = await admin
      .from('scan_logs')
      .insert({
        work_order_id: createdIds.workOrderA,
        readings: { temperature: 42, humidity: 7, ok: true },
        decision: 'pass',
        prev_hash: 'genesis',
        row_hash: 'h-0',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (scanRes.error) throw scanRes.error
    const scanId = scanRes.data.id

    const deviceSecret = `rls-test-secret-${Date.now()}`
    const deviceSecretHash = createHmac('sha256', deviceSecret).digest('hex')

    const deviceRes = await admin
      .from('devices')
      .insert({
        serial_number: `DEV-${Date.now()}`,
        secret_hash: deviceSecretHash,
        is_active: true,
        contractor_id: contractorA,
      })
      .select('id')
      .single()
    if (deviceRes.error) throw deviceRes.error
    const deviceId = deviceRes.data.id

    const client = await signInAs(EMAILS.tenantA, PASSWORDS.tenantA)

    const readRes = await client.from('scan_logs').select('*').eq('id', scanId)
    const canRead = !!readRes.data && readRes.data.length === 1

    const insRes = await client.from('scan_logs').insert({
      work_order_id: createdIds.workOrderA,
      device_id: deviceId,
      readings: { ok: true },
      decision: 'pending',
      prev_hash: 'h-0',
      row_hash: 'h-1',
      created_at: new Date().toISOString(),
    })
    const canInsert = !insRes.error

    const updRes = await client
      .from('scan_logs')
      .update({ decision: 'fail' })
      .eq('id', scanId)
      .select('*')
    const updCount = updRes.count ?? (updRes.data?.length ?? 0)
    const afterUpd = await client
      .from('scan_logs')
      .select('decision')
      .eq('id', scanId)
      .maybeSingle()
    const unchanged = !!afterUpd.data && afterUpd.data.decision === 'pass'
    const updateBlocked = updCount === 0 && unchanged

    const delRes = await client
      .from('scan_logs')
      .delete()
      .eq('id', scanId)
      .select('*')
    const delCount = delRes.count ?? (delRes.data?.length ?? 0)
    const afterDel = await client
      .from('scan_logs')
      .select('id')
      .eq('id', scanId)
      .maybeSingle()
    const rowExistsAfterDel = !!afterDel.data
    const deleteBlocked = delCount === 0 && rowExistsAfterDel

    const passed = canRead && canInsert && updateBlocked && deleteBlocked
    note(
      'scan_logs is INSERT-only',
      passed,
      `read=${canRead}, insert=${canInsert}, updateBlocked=${updateBlocked} (updCount=${updCount}, decisionAfter=${afterUpd.data?.decision}, err=${updRes.error?.code ?? 'none'}), deleteBlocked=${deleteBlocked} (delCount=${delCount}, existsAfter=${rowExistsAfterDel}, err=${delRes.error?.code ?? 'none'})`
    )
  }

  // Test 4: role scoping — a field supervisor cannot create contractors.
  {
    const client = await signInAs(EMAILS.tenantA, PASSWORDS.tenantA)
    const res = await client
      .from('contractors')
      .insert({ name: 'Should-Be-Rejected' })
      .select('id')
      .single()
    const blocked = !!res.error
    note(
      'role scoping: field supervisor cannot create contractors',
      blocked,
      blocked ? `blocked (${res.error?.message})` : 'insert unexpectedly succeeded'
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
    await cleanup()
    const failed = results.filter((r) => !r.passed)
    if (failed.length > 0) process.exitCode = 1
    else process.exitCode = 0
  })

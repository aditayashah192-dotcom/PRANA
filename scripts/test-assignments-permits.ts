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
  tenantAAdmin: 'Prana-TenantA-Admin-2026!',
  tenantAFieldA: 'Prana-TenantA-FieldA-2026!',
  tenantAFieldB: 'Prana-TenantA-FieldB-2026!',
  tenantBField: 'Prana-TenantB-Field-2026!',
  gov: 'Prana-Govt-Auditor-2026!',
}

const EMAILS = {
  tenantAAdmin: 'tenant-a-admin@prana.test',
  tenantAFieldA: 'tenant-a-field-a@prana.test',
  tenantAFieldB: 'tenant-a-field-b@prana.test',
  tenantBField: 'tenant-b-field@prana.test',
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
  assignmentA1?: string
  assignmentA2?: string
  assignmentB1?: string
  permitA1?: string
  permitA2?: string
  permitB1?: string
  users: string[]
} = { users: [] }

async function cleanupFn(): Promise<void> {
  try {
    for (const pid of [cleanup.permitA1, cleanup.permitA2, cleanup.permitB1].filter(Boolean)) {
      await admin.from('permits').delete().eq('id', pid!)
    }
    for (const aid of [cleanup.assignmentA1, cleanup.assignmentA2, cleanup.assignmentB1].filter(Boolean)) {
      await admin.from('workzone_assignments').delete().eq('id', aid!)
    }
    if (cleanup.workOrderA1) await admin.from('work_orders').delete().eq('id', cleanup.workOrderA1)
    if (cleanup.workOrderA2) await admin.from('work_orders').delete().eq('id', cleanup.workOrderA2)
    if (cleanup.workOrderB1) await admin.from('work_orders').delete().eq('id', cleanup.workOrderB1)
    if (cleanup.workzoneA1) await admin.from('workzones').delete().eq('id', cleanup.workzoneA1)
    if (cleanup.workzoneA2) await admin.from('workzones').delete().eq('id', cleanup.workzoneA2)
    if (cleanup.workzoneB1) await admin.from('workzones').delete().eq('id', cleanup.workzoneB1)
    for (const uid of cleanup.users) {
      await admin.auth.admin.deleteUser(uid)
    }
    if (cleanup.contractorA) await admin.from('contractors').delete().eq('id', cleanup.contractorA)
    if (cleanup.contractorB) await admin.from('contractors').delete().eq('id', cleanup.contractorB)
  } catch (e) {
    console.warn('Cleanup warning:', (e as Error).message)
  }
}

async function main(): Promise<void> {
  await resetTestUsers(Object.values(EMAILS))

  const contractorA = await getOrCreateContractor('Prana Tenant A')
  cleanup.contractorA = contractorA
  const contractorB = await getOrCreateContractor('Prana Tenant B')
  cleanup.contractorB = contractorB

  const tenantAAdmin = await ensureUser(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin, 'contractor_admin', contractorA)
  cleanup.users.push(tenantAAdmin)

  const tenantAFieldA = await ensureUser(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA, 'field_supervisor', contractorA)
  cleanup.users.push(tenantAFieldA)
  const tenantAFieldB = await ensureUser(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB, 'field_supervisor', contractorA)
  cleanup.users.push(tenantAFieldB)
  const tenantBField = await ensureUser(EMAILS.tenantBField, PASSWORDS.tenantBField, 'field_supervisor', contractorB)
  cleanup.users.push(tenantBField)
  const gov = await ensureUser(EMAILS.gov, PASSWORDS.gov, 'govt_auditor', null)
  cleanup.users.push(gov)

  const { data: wzA1, error: wzA1Err } = await admin
    .from('workzones')
    .insert({ name: 'TenantA-Workzone-1', contractor_id: contractorA, target_lat: 28.6139, target_lon: 77.2090, target_depth_meters: 3.0 })
    .select('id')
    .single()
  if (wzA1Err) throw wzA1Err
  cleanup.workzoneA1 = wzA1.id

  const { data: wzA2, error: wzA2Err } = await admin
    .from('workzones')
    .insert({ name: 'TenantA-Workzone-2', contractor_id: contractorA, target_lat: 28.6149, target_lon: 77.2100, target_depth_meters: 4.0 })
    .select('id')
    .single()
  if (wzA2Err) throw wzA2Err
  cleanup.workzoneA2 = wzA2.id

  const { data: wzB1, error: wzB1Err } = await admin
    .from('workzones')
    .insert({ name: 'TenantB-Workzone-1', contractor_id: contractorB, target_lat: 28.6159, target_lon: 77.2110, target_depth_meters: 5.0 })
    .select('id')
    .single()
  if (wzB1Err) throw wzB1Err
  cleanup.workzoneB1 = wzB1.id

  const { data: woA1, error: woA1Err } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorA, workzone_id: wzA1.id, status: 'pending', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (woA1Err) throw woA1Err
  cleanup.workOrderA1 = woA1.id

  const { data: woA2, error: woA2Err } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorA, workzone_id: wzA2.id, status: 'pending', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (woA2Err) throw woA2Err
  cleanup.workOrderA2 = woA2.id

  const { data: woB1, error: woB1Err } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorB, workzone_id: wzB1.id, status: 'pending', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (woB1Err) throw woB1Err
  cleanup.workOrderB1 = woB1.id

  // ==========================================================================
  // Assignment tests
  // ==========================================================================

  // Test 1: contractor_admin can create a valid assignment
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data, error } = await client
      .from('workzone_assignments')
      .insert({ workzone_id: wzA1.id, assigned_staff_id: tenantAFieldA, contractor_id: contractorA })
      .select('id')
      .single()

    const ok = !error && !!data
    cleanup.assignmentA1 = data?.id
    note('contractor_admin can create assignment', ok, ok ? `assignment=${data!.id}` : `error=${error?.message}`)
  }

  // Test 2: field_supervisor can read their assigned workzone
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data, error } = await client
      .from('workzones')
      .select('id, name')
      .eq('id', wzA1.id)
      .maybeSingle()

    const ok = !error && !!data
    note('field_supervisor can read assigned workzone', ok, ok ? `workzone=${data!.name}` : `error=${error?.message}`)
  }

  // Test 3: field_supervisor cannot read unassigned workzone in same contractor
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data, error } = await client
      .from('workzones')
      .select('id, name')
      .eq('id', wzA2.id)
      .maybeSingle()

    const blocked = !data && !error
    note('field_supervisor cannot read unassigned workzone', blocked, `data=${JSON.stringify(data)} error=${error?.message}`)
  }

  // Test 4: field_supervisor cannot read another supervisor's assigned workzone
  {
    const client = await signInAs(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB)
    const { data, error } = await client
      .from('workzones')
      .select('id, name')
      .eq('id', wzA1.id)
      .maybeSingle()

    const blocked = !data && !error
    note('field_supervisor cannot read another supervisor workzone', blocked, `data=${JSON.stringify(data)} error=${error?.message}`)
  }

  // Test 5: field_supervisor cannot create assignment
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client
      .from('workzone_assignments')
      .insert({ workzone_id: wzA2.id, assigned_staff_id: tenantAFieldA, contractor_id: contractorA })

    const blocked = !!error
    note('field_supervisor cannot create assignment', blocked, `error=${error?.message}`)
  }

  // Test 6: field_supervisor cannot update assignment
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data, error } = await client
      .from('workzone_assignments')
      .update({ assigned_staff_id: tenantAFieldB })
      .eq('id', cleanup.assignmentA1!)
      .select('id')

    const blocked = !!error || (data?.length ?? 0) === 0
    note('field_supervisor cannot update assignment', blocked, `error=${error?.message} count=${data?.length ?? 0}`)
  }

  // Test 7: field_supervisor cannot delete assignment
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data, error } = await client
      .from('workzone_assignments')
      .delete()
      .eq('id', cleanup.assignmentA1!)
      .select('id')

    const blocked = !!error || (data?.length ?? 0) === 0
    note('field_supervisor cannot delete assignment', blocked, `error=${error?.message} count=${data?.length ?? 0}`)
  }

  // Test 8: contractor_admin can update assignment
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data, error } = await client
      .from('workzone_assignments')
      .update({ assigned_staff_id: tenantAFieldB })
      .eq('id', cleanup.assignmentA1!)
      .select('id, assigned_staff_id')
      .single()

    const row = data as { id: string; assigned_staff_id: string } | null
    const ok = !error && row?.assigned_staff_id === tenantAFieldB
    cleanup.assignmentA2 = row?.id
    note('contractor_admin can update assignment', ok, ok ? `updated staff=${row!.assigned_staff_id}` : `error=${error?.message}`)
  }

  // Test 9: cross-tenant assignment blocked
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client
      .from('workzone_assignments')
      .insert({ workzone_id: wzB1.id, assigned_staff_id: tenantBField, contractor_id: contractorA })

    const blocked = !!error
    note('cross-tenant assignment blocked', blocked, `error=${error?.message}`)
  }

  // Test 10: existing contractor isolation on workzones still works for admin
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data, error } = await client
      .from('workzones')
      .select('id, name')

    const own = data?.filter((r: any) => r.name.startsWith('TenantA-')) ?? []
    const cross = data?.filter((r: any) => r.name.startsWith('TenantB-')) ?? []
    const ok = !error && cross.length === 0 && own.length >= 2
    note('contractor_admin sees only own workzones', ok, `own=${own.length} cross=${cross.length}`)
  }

  // ==========================================================================
  // Permit tests
  // ==========================================================================

  // Ensure assignment exists for tenantAFieldA on wzA2 for permit tests
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data, error } = await client
      .from('workzone_assignments')
      .insert({ workzone_id: wzA2.id, assigned_staff_id: tenantAFieldA, contractor_id: contractorA })
      .select('id')
      .single()

    if (!error && data) {
      cleanup.assignmentA2 = data.id
    }
  }

  // Test 11: field_supervisor can issue permit for assigned workzone + work order
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data, error } = await client
      .from('permits')
      .insert({
        contractor_id: contractorA,
        workzone_id: wzA2.id,
        work_order_id: woA2.id,
        field_supervisor_id: tenantAFieldA,
        status: 'ISSUED',
        number: `PERMIT-${Date.now()}`,
      })
      .select('id')
      .single()

    const ok = !error && !!data
    cleanup.permitA2 = data?.id
    note('field_supervisor can issue permit for assigned workzone', ok, ok ? `permit=${data!.id}` : `error=${error?.message}`)
  }

  // Test 12: field_supervisor cannot issue permit for unassigned workzone
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client
      .from('permits')
      .insert({
        contractor_id: contractorA,
        workzone_id: wzA1.id,
        work_order_id: woA1.id,
        field_supervisor_id: tenantAFieldA,
        status: 'ISSUED',
        number: `PERMIT-${Date.now()}`,
      })

    const blocked = !!error
    note('field_supervisor cannot issue permit for unassigned workzone', blocked, `error=${error?.message}`)
  }

  // Test 13: field_supervisor cannot issue permit with mismatched work_order/workzone
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client
      .from('permits')
      .insert({
        contractor_id: contractorA,
        workzone_id: wzA2.id,
        work_order_id: woA1.id,
        field_supervisor_id: tenantAFieldA,
        status: 'ISSUED',
        number: `PERMIT-${Date.now()}`,
      })

    const blocked = !!error
    note('field_supervisor cannot issue permit with mismatched work order', blocked, `error=${error?.message}`)
  }

  // Test 14: field_supervisor cannot issue permit with wrong contractor_id
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client
      .from('permits')
      .insert({
        contractor_id: contractorB,
        workzone_id: wzB1.id,
        work_order_id: woB1.id,
        field_supervisor_id: tenantAFieldA,
        status: 'ISSUED',
        number: `PERMIT-${Date.now()}`,
      })

    const blocked = !!error
    note('field_supervisor cannot issue permit with wrong contractor', blocked, `error=${error?.message}`)
  }

  // Test 15: field_supervisor cannot issue permit with non-ISSUED status
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client
      .from('permits')
      .insert({
        contractor_id: contractorA,
        workzone_id: wzA2.id,
        work_order_id: woA2.id,
        field_supervisor_id: tenantAFieldA,
        status: 'ACTIVE',
        number: `PERMIT-${Date.now()}`,
      })

    const blocked = !!error
    note('field_supervisor cannot issue permit with non-ISSUED status', blocked, `error=${error?.message}`)
  }

  // Test 16: contractor_admin can create permit
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data, error } = await client
      .from('permits')
      .insert({
        contractor_id: contractorA,
        workzone_id: wzA1.id,
        work_order_id: woA1.id,
        field_supervisor_id: tenantAFieldA,
        status: 'ISSUED',
        number: `PERMIT-${Date.now()}`,
      })
      .select('id')
      .single()

    const ok = !error && !!data
    cleanup.permitA1 = data?.id
    note('contractor_admin can create permit', ok, ok ? `permit=${data!.id}` : `error=${error?.message}`)
  }

  // Test 17: permit tenant isolation - field supervisor cannot see other tenant permit
  {
    const client = await signInAs(EMAILS.tenantBField, PASSWORDS.tenantBField)
    const { data, error } = await client
      .from('permits')
      .select('id')
      .eq('id', cleanup.permitA1!)
      .maybeSingle()

    const blocked = !data && !error
    note('field_supervisor cannot see other tenant permit', blocked, `data=${JSON.stringify(data)} error=${error?.message}`)
  }

  // Test 18: govt_auditor can see all permits
  {
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { data, error } = await client
      .from('permits')
      .select('id')

    const ok = !error && (data?.length ?? 0) >= 2
    note('govt_auditor can see all permits', ok, `count=${data?.length ?? 0}`)
  }

  // Test 19: field_supervisor can see permits for assigned workzone
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data, error } = await client
      .from('permits')
      .select('id')
      .eq('workzone_id', wzA2.id)

    const ok = !error && (data?.length ?? 0) >= 1
    note('field_supervisor can see permits for assigned workzone', ok, `count=${data?.length ?? 0}`)
  }

  // Test 20: field_supervisor cannot see permits for unassigned workzone
  {
    const adminClient = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data: otherPermit } = await adminClient
      .from('permits')
      .insert({
        contractor_id: contractorA,
        workzone_id: wzA1.id,
        work_order_id: woA1.id,
        field_supervisor_id: tenantAFieldB,
        status: 'ISSUED',
        number: `PERMIT-${Date.now()}`,
      })
      .select('id')
      .single()

    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data, error } = await client
      .from('permits')
      .select('id')
      .eq('workzone_id', wzA1.id)
      .neq('field_supervisor_id', tenantAFieldA)

    const blocked = (data?.length ?? 0) === 0 && !error
    note('field_supervisor cannot see permits for unassigned workzone', blocked, `count=${data?.length ?? 0}`)
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

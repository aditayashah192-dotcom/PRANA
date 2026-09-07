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
  permitA1?: string
  users: string[]
} = { users: [] }

async function cleanupFn(): Promise<void> {
  try {
    if (cleanup.permitA1) await admin.from('permits').delete().eq('id', cleanup.permitA1)
    if (cleanup.assignmentA1) await admin.from('workzone_assignments').delete().eq('id', cleanup.assignmentA1)
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
  // 1. Own contractor data visible
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data, error } = await client
      .from('workzones')
      .select('id, name')
      .order('name')

    const own = data?.filter((r: any) => r.name.startsWith('TenantA-')) ?? []
    const cross = data?.filter((r: any) => r.name.startsWith('TenantB-')) ?? []
    const ok = !error && cross.length === 0 && own.length >= 2
    note(
      'contractor_admin sees own contractor workzones',
      ok,
      `own=${own.length} cross=${cross.length} err=${error?.message ?? 'none'}`
    )
  }

  // ==========================================================================
  // 2. Other contractor data invisible
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data, error } = await client
      .from('workzones')
      .select('id, name')
      .eq('id', wzB1.id)

    const blocked = (data?.length ?? 0) === 0 && !error
    note(
      'contractor_admin cannot see other contractor workzones',
      blocked,
      `data=${JSON.stringify(data)} err=${error?.message ?? 'none'}`
    )
  }

  // ==========================================================================
  // 3. Assignment to own field supervisor succeeds via RPC
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client.rpc('assign_field_supervisor', {
      p_workzone_id: wzA1.id,
      p_assigned_staff_id: tenantAFieldA,
    })

    const ok = !error
    note(
      'contractor_admin can assign own field supervisor via RPC',
      ok,
      ok ? 'assignment succeeded' : `error=${error?.message}`
    )
  }

  // Verify assignment was recorded.
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data } = await client
      .from('workzone_assignments')
      .select('id, assigned_staff_id, updated_by')
      .eq('workzone_id', wzA1.id)
      .maybeSingle()

    const ok = !!data && data.assigned_staff_id === tenantAFieldA && data.updated_by === tenantAAdmin
    note(
      'assignment record contains updated_by audit field',
      ok,
      `assignment=${JSON.stringify(data)}`
    )
    if (data?.id) cleanup.assignmentA1 = data.id
  }

  // ==========================================================================
  // 4. Assignment to another contractor's supervisor fails
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client.rpc('assign_field_supervisor', {
      p_workzone_id: wzA2.id,
      p_assigned_staff_id: tenantBField,
    })

    const blocked = !!error
    note(
      'contractor_admin cannot assign another contractor supervisor',
      blocked,
       blocked ? `blocked (${error?.message})` : 'assignment unexpectedly succeeded'
    )
  }

  // ==========================================================================
  // 5. Non-Contractor-Admin cannot call the assignment RPC
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client.rpc('assign_field_supervisor', {
      p_workzone_id: wzA2.id,
      p_assigned_staff_id: tenantAFieldB,
    })

    const blocked = !!error
    note(
      'non-contractor_admin cannot call assign_field_supervisor RPC',
      blocked,
      blocked ? `blocked (${error?.message})` : 'RPC unexpectedly succeeded'
    )
  }

  // ==========================================================================
  // 6. Contractor Admin cannot assign a non-field-supervisor user
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client.rpc('assign_field_supervisor', {
      p_workzone_id: wzA2.id,
      p_assigned_staff_id: gov,
    })

    const blocked = !!error
    note(
      'contractor_admin cannot assign non-field-supervisor user',
      blocked,
      blocked ? `blocked (${error?.message})` : 'assignment unexpectedly succeeded'
    )
  }

  // ==========================================================================
  // 7. Assigned field supervisor sees the workzone via RPC assignment
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data, error } = await client
      .from('workzones')
      .select('id, name')
      .eq('id', wzA1.id)
      .maybeSingle()

    const ok = !error && !!data && data.id === wzA1.id
    note(
      'assigned field supervisor sees assigned workzone via RPC',
      ok,
      ok ? `workzone=${data!.name}` : `data=${JSON.stringify(data)} err=${error?.message ?? 'none'}`
    )
  }

  // ==========================================================================
  // 8. Unassigned field supervisor does not see the workzone
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB)
    const { data, error } = await client
      .from('workzones')
      .select('id, name')
      .eq('id', wzA1.id)
      .maybeSingle()

    const blocked = !data && !error
    note(
      'unassigned field supervisor does not see assigned workzone',
      blocked,
      `data=${JSON.stringify(data)} err=${error?.message ?? 'none'}`
    )
  }

  // ==========================================================================
  // 9. Historical audit remains immutable (scan_logs UPDATE/DELETE blocked)
  // ==========================================================================
  {
    const scanRes = await admin
      .from('scan_logs')
      .insert({
        work_order_id: woA1.id,
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

    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)

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

    const passed = updateBlocked && deleteBlocked
    note(
      'scan_logs immutable for contractor_admin',
      passed,
      `updateBlocked=${updateBlocked} (updCount=${updCount}, decisionAfter=${afterUpd.data?.decision}), deleteBlocked=${deleteBlocked} (delCount=${delCount}, existsAfter=${rowExistsAfterDel})`
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
    await cleanupFn()
    const failed = results.filter((r) => !r.passed)
    if (failed.length > 0) process.exit(1)
    else process.exit(0)
  })

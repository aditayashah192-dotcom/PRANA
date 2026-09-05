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
  tenantAField: 'Prana-TenantA-Field-2026!',
  gov: 'Prana-Govt-Auditor-2026!',
}

const EMAILS = {
  tenantAAdmin: 'tenant-a-admin@prana.test',
  tenantAField: 'tenant-a-field@prana.test',
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
  let page = 1
  const perPage = 100
  let foundId: string | null = null
  while (true) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage })
    const users = (data as { users: Array<{ id: string; email?: string }> }).users
    const found = users.find(u => u.email === email)
    if (found) {
      foundId = found.id
      break
    }
    const pagination = data as { nextPage?: string | null; lastPage?: number }
    if (pagination.nextPage === null || page >= (pagination.lastPage ?? 0)) break
    page++
  }

  if (foundId) {
    await admin.from('profiles').upsert({
      id: foundId,
      role,
      contractor_id: contractorId ?? null,
    })
    return foundId
  }

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
  contractorC?: string
  workzoneA?: string
  users: string[]
} = { users: [] }

async function cleanupFn(): Promise<void> {
  try {
    if (cleanup.workzoneA) await admin.from('workzones').delete().eq('id', cleanup.workzoneA)
    for (const uid of cleanup.users) {
      await admin.auth.admin.deleteUser(uid)
    }
    if (cleanup.contractorA) await admin.from('contractors').delete().eq('id', cleanup.contractorA)
    if (cleanup.contractorB) await admin.from('contractors').delete().eq('id', cleanup.contractorB)
    if (cleanup.contractorC) await admin.from('contractors').delete().eq('id', cleanup.contractorC)
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
  const contractorC = await getOrCreateContractor('Prana Tenant C')
  cleanup.contractorC = contractorC

  const tenantAAdmin = await ensureUser(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin, 'contractor_admin', contractorA)
  cleanup.users.push(tenantAAdmin)

  const tenantAField = await ensureUser(EMAILS.tenantAField, PASSWORDS.tenantAField, 'field_supervisor', contractorA)
  cleanup.users.push(tenantAField)

  const gov = await ensureUser(EMAILS.gov, PASSWORDS.gov, 'govt_auditor', null)
  cleanup.users.push(gov)

  const { data: wz, error: wzErr } = await admin
    .from('workzones')
    .insert({ name: 'Realloc-Test-Workzone', contractor_id: contractorA, target_lat: 28.6139, target_lon: 77.2090, target_depth_meters: 3.0 })
    .select('id')
    .single()
  if (wzErr) throw wzErr
  cleanup.workzoneA = wz.id

  // ==========================================================================
  // Test 1: govt_auditor can successfully reassign a workzone
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { error } = await client.rpc('reassign_workzone_contractor', {
      p_workzone_id: wz.id,
      p_new_contractor_id: contractorB,
      p_reassignment_reason: 'Contractor change for operational review.',
    })

    const ok = !error
    note('govt_auditor can reassign workzone', ok, ok ? 'rpc succeeded' : `error=${error?.message}`)

    if (ok) {
      const { data: updated } = await admin
        .from('workzones')
        .select('contractor_id')
        .eq('id', wz.id)
        .maybeSingle()
      const contractorCorrect = updated?.contractor_id === contractorB
      note('workzone contractor updated', contractorCorrect, `contractor_id=${updated?.contractor_id}`)
    }
  }

  // ==========================================================================
  // Test 2: reassignment reason is stored in the audit trail
  // ==========================================================================
  {
    const { data: log } = await admin
      .from('contractor_reassignment_log')
      .select('reason, previous_contractor_id, new_contractor_id, performed_by')
      .eq('workzone_id', wz.id)
      .maybeSingle()

    const ok = !!log && log.reason === 'Contractor change for operational review.'
    note('reassignment reason stored in audit trail', ok, `reason=${log?.reason}`)
  }

  // ==========================================================================
  // Test 3: previous contractor and new contractor are correctly recorded
  // ==========================================================================
  {
    const { data: log } = await admin
      .from('contractor_reassignment_log')
      .select('previous_contractor_id, new_contractor_id')
      .eq('workzone_id', wz.id)
      .maybeSingle()

    const ok = !!log && log.previous_contractor_id === contractorA && log.new_contractor_id === contractorB
    note('previous and new contractor recorded', ok, `prev=${log?.previous_contractor_id} new=${log?.new_contractor_id}`)
  }

  // ==========================================================================
  // Test 4: contractor_admin cannot call the RPC
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client.rpc('reassign_workzone_contractor', {
      p_workzone_id: wz.id,
      p_new_contractor_id: contractorC,
      p_reassignment_reason: 'Admin trying to reassign.',
    })

    const blocked = !!error
    note('contractor_admin cannot call RPC', blocked, `error=${error?.message}`)
  }

  // ==========================================================================
  // Test 5: field_supervisor cannot call the RPC
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAField, PASSWORDS.tenantAField)
    const { error } = await client.rpc('reassign_workzone_contractor', {
      p_workzone_id: wz.id,
      p_new_contractor_id: contractorC,
      p_reassignment_reason: 'Field supervisor trying to reassign.',
    })

    const blocked = !!error
    note('field_supervisor cannot call RPC', blocked, `error=${error?.message}`)
  }

  // ==========================================================================
  // Test 6: unauthenticated caller cannot call the RPC
  // ==========================================================================
  {
    const client = authenticatedClient()
    const { error } = await client.rpc('reassign_workzone_contractor', {
      p_workzone_id: wz.id,
      p_new_contractor_id: contractorC,
      p_reassignment_reason: 'Unauthenticated trying to reassign.',
    })

    const blocked = !!error
    note('unauthenticated cannot call RPC', blocked, `error=${error?.message}`)
  }

  // ==========================================================================
  // Test 7: missing/blank reason is rejected
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { error } = await client.rpc('reassign_workzone_contractor', {
      p_workzone_id: wz.id,
      p_new_contractor_id: contractorC,
      p_reassignment_reason: '   ',
    })

    const rejected = !!error
    note('blank reason is rejected', rejected, `error=${error?.message}`)
  }

  // ==========================================================================
  // Test 8: nonexistent workzone is rejected
  // ==========================================================================
  {
    const fakeWorkzoneId = '00000000-0000-0000-0000-000000000000'
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { error } = await client.rpc('reassign_workzone_contractor', {
      p_workzone_id: fakeWorkzoneId,
      p_new_contractor_id: contractorC,
      p_reassignment_reason: 'Testing nonexistent workzone.',
    })

    const rejected = !!error
    note('nonexistent workzone is rejected', rejected, `error=${error?.message}`)
  }

  // ==========================================================================
  // Test 9: nonexistent contractor is rejected
  // ==========================================================================
  {
    const fakeContractorId = '00000000-0000-0000-0000-000000000000'
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { error } = await client.rpc('reassign_workzone_contractor', {
      p_workzone_id: wz.id,
      p_new_contractor_id: fakeContractorId,
      p_reassignment_reason: 'Testing nonexistent contractor.',
    })

    const rejected = !!error
    note('nonexistent contractor is rejected', rejected, `error=${error?.message}`)
  }

  // ==========================================================================
  // Test 10: reassigning to the current contractor is rejected
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { data: current } = await admin
      .from('workzones')
      .select('contractor_id')
      .eq('id', wz.id)
      .maybeSingle()

    const { error } = await client.rpc('reassign_workzone_contractor', {
      p_workzone_id: wz.id,
      p_new_contractor_id: current?.contractor_id ?? contractorB,
      p_reassignment_reason: 'Testing same contractor.',
    })

    const rejected = !!error
    note('same contractor reassignment is rejected', rejected, `error=${error?.message}`)
  }

  // ==========================================================================
  // Test 11: failed reassignment does not leave a partial database change
  // ==========================================================================
  {
    const { data: before } = await admin
      .from('workzones')
      .select('contractor_id')
      .eq('id', wz.id)
      .maybeSingle()

    const fakeContractorId = '00000000-0000-0000-0000-000000000000'
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { error } = await client.rpc('reassign_workzone_contractor', {
      p_workzone_id: wz.id,
      p_new_contractor_id: fakeContractorId,
      p_reassignment_reason: 'Testing atomicity.',
    })

    const { data: after } = await admin
      .from('workzones')
      .select('contractor_id')
      .eq('id', wz.id)
      .maybeSingle()

    const unchanged = after?.contractor_id === before?.contractor_id
    note('failed reassignment leaves no partial change', unchanged, `before=${before?.contractor_id} after=${after?.contractor_id}`)
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed out of ${results.length} tests`)
  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('Test runner error:', err)
  process.exitCode = 1
})

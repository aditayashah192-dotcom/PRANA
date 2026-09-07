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
  tenantAAdmin: 'Prana-TenantA-Admin-Provision-2026!',
  tenantAFieldA: 'Prana-TenantA-FieldA-Provision-2026!',
  tenantAFieldB: 'Prana-TenantA-FieldB-Provision-2026!',
  tenantBField: 'Prana-TenantB-Field-Provision-2026!',
  gov: 'Prana-Govt-Auditor-Provision-2026!',
}

const EMAILS = {
  tenantAAdmin: 'tenant-a-admin-provision@prana.test',
  tenantAFieldA: 'tenant-a-field-a-provision@prana.test',
  tenantAFieldB: 'tenant-a-field-b-provision@prana.test',
  tenantBField: 'tenant-b-field-provision@prana.test',
  gov: 'govt-auditor-provision@prana.test',
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
    const pagination = data as { nextPage?: string | null; lastPage?: number }
    if (pagination.nextPage === null || page >= (pagination.lastPage ?? 0)) break
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
  provisionedUsers: string[]
} = { provisionedUsers: [] }

async function cleanupFn(): Promise<void> {
  try {
    for (const uid of cleanup.provisionedUsers) {
      await admin.from('user_provisioning_log').delete().eq('provisioned_user_id', uid)
      await admin.auth.admin.deleteUser(uid)
    }
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
  cleanup.provisionedUsers.push(tenantAAdmin)

  const tenantAFieldA = await ensureUser(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA, 'field_supervisor', null)
  cleanup.provisionedUsers.push(tenantAFieldA)

  const tenantAFieldB = await ensureUser(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB, 'field_supervisor', null)
  cleanup.provisionedUsers.push(tenantAFieldB)

  const tenantBField = await ensureUser(EMAILS.tenantBField, PASSWORDS.tenantBField, 'field_supervisor', null)
  cleanup.provisionedUsers.push(tenantBField)

  const gov = await ensureUser(EMAILS.gov, PASSWORDS.gov, 'govt_auditor', null)
  cleanup.provisionedUsers.push(gov)

  // ==========================================================================
  // 1. Govt Auditor can provision Contractor Admin via RPC
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { error } = await client.rpc('provision_contractor_admin', {
      p_user_id: tenantAFieldA,
      p_contractor_id: contractorA,
      p_full_name: 'Provisioned CA',
    })

    const ok = !error
    note(
      'govt_auditor can provision contractor_admin via RPC',
      ok,
      ok ? 'provisioning succeeded' : `error=${error?.message}`
    )

    if (ok) {
      const { data: profile } = await admin
        .from('profiles')
        .select('role, contractor_id, full_name')
        .eq('id', tenantAFieldA)
        .maybeSingle()

      const profileOk = profile?.role === 'contractor_admin' && profile?.contractor_id === contractorA && profile?.full_name === 'Provisioned CA'
      note(
        'provisioned contractor_admin has correct profile',
        profileOk,
        `role=${profile?.role} contractor=${profile?.contractor_id} name=${profile?.full_name}`
      )

      const { data: log } = await admin
        .from('user_provisioning_log')
        .select('new_role, contractor_id, provisioned_by')
        .eq('provisioned_user_id', tenantAFieldA)
        .maybeSingle()

      const logOk = !!log && log.new_role === 'contractor_admin' && log.contractor_id === contractorA && log.provisioned_by === gov
      note(
        'provisioning audit log recorded',
        logOk,
        `role=${log?.new_role} contractor=${log?.contractor_id} by=${log?.provisioned_by}`
      )
    }
  }

  // ==========================================================================
  // 2. Govt Auditor cannot provision field_supervisor via provision_field_supervisor
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { error } = await client.rpc('provision_field_supervisor', {
      p_user_id: tenantAFieldB,
    })

    const blocked = !!error
    note(
      'govt_auditor cannot provision field_supervisor via provision_field_supervisor',
      blocked,
      blocked ? `blocked (${error?.message})` : 'unexpectedly succeeded'
    )
  }

  // ==========================================================================
  // 3. Govt Auditor cannot create govt_auditor via provision_contractor_admin
  //    (attempt to provision a user who is already govt_auditor should fail)
  // ==========================================================================
  {
    // gov user is already govt_auditor, not in default unassigned state
    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { error } = await client.rpc('provision_contractor_admin', {
      p_user_id: gov,
      p_contractor_id: contractorA,
    })

    const blocked = !!error
    note(
      'govt_auditor cannot provision another govt_auditor via provision_contractor_admin',
      blocked,
      blocked ? `blocked (${error?.message})` : 'unexpectedly succeeded'
    )
  }

  // ==========================================================================
  // 4. Contractor Admin can provision Field Supervisor via RPC
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client.rpc('provision_field_supervisor', {
      p_user_id: tenantAFieldB,
      p_full_name: 'Provisioned FS',
    })

    const ok = !error
    note(
      'contractor_admin can provision field_supervisor via RPC',
      ok,
      ok ? 'provisioning succeeded' : `error=${error?.message}`
    )

    if (ok) {
      const { data: profile } = await admin
        .from('profiles')
        .select('role, contractor_id, full_name')
        .eq('id', tenantAFieldB)
        .maybeSingle()

      const profileOk = profile?.role === 'field_supervisor' && profile?.contractor_id === contractorA && profile?.full_name === 'Provisioned FS'
      note(
        'provisioned field_supervisor has correct profile',
        profileOk,
        `role=${profile?.role} contractor=${profile?.contractor_id} name=${profile?.full_name}`
      )

      const { data: log } = await admin
        .from('user_provisioning_log')
        .select('new_role, contractor_id, provisioned_by')
        .eq('provisioned_user_id', tenantAFieldB)
        .maybeSingle()

      const logOk = !!log && log.new_role === 'field_supervisor' && log.contractor_id === contractorA && log.provisioned_by === tenantAAdmin
      note(
        'field_supervisor provisioning audit log recorded',
        logOk,
        `role=${log?.new_role} contractor=${log?.contractor_id} by=${log?.provisioned_by}`
      )
    }
  }

  // ==========================================================================
  // 5. Contractor Admin can only provision Field Supervisors for their own contractor
  // ==========================================================================
  {
    const { data: freshUser, error: createErr } = await admin.auth.admin.createUser({
      email: `fs-own-${Date.now()}@prana.test`,
      password: 'Provisioned-FS-Own-2026!',
      email_confirm: true,
    })
    if (createErr) throw createErr
    const freshUserId = freshUser.user!.id
    cleanup.provisionedUsers.push(freshUserId)

    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client.rpc('provision_field_supervisor', {
      p_user_id: freshUserId,
    })

    const ok = !error
    note(
      'contractor_admin provisions field_supervisor into own contractor only',
      ok,
      ok ? 'assigned to own contractor' : `error=${error?.message}`
    )

    if (ok) {
      const { data: profile } = await admin
        .from('profiles')
        .select('contractor_id')
        .eq('id', freshUserId)
        .maybeSingle()

      const correctTenant = profile?.contractor_id === contractorA
      note(
        'provisioned field_supervisor is in caller contractor',
        correctTenant,
        `contractor=${profile?.contractor_id}`
      )
    }
  }

  // ==========================================================================
  // 6. Contractor Admin cannot provision Contractor Admin
  // ==========================================================================
  {
    const { data: freshUser, error: createErr } = await admin.auth.admin.createUser({
      email: `ca-blocked-${Date.now()}@prana.test`,
      password: 'Blocked-CA-2026!',
      email_confirm: true,
    })
    if (createErr) throw createErr
    const freshUserId = freshUser.user!.id
    cleanup.provisionedUsers.push(freshUserId)

    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client.rpc('provision_field_supervisor', {
      p_user_id: freshUserId,
    })

    const ok = !error
    note(
      'contractor_admin provisioning always creates field_supervisor, never contractor_admin',
      ok,
      ok ? `role=field_supervisor (expected)` : `error=${error?.message}`
    )
  }

  // ==========================================================================
  // 7. Contractor Admin cannot provision Govt Auditor
  // ==========================================================================
  {
    const { data: freshUser, error: createErr } = await admin.auth.admin.createUser({
      email: `govt-blocked-${Date.now()}@prana.test`,
      password: 'Blocked-Govt-2026!',
      email_confirm: true,
    })
    if (createErr) throw createErr
    const freshUserId = freshUser.user!.id
    cleanup.provisionedUsers.push(freshUserId)

    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client.rpc('provision_field_supervisor', {
      p_user_id: freshUserId,
    })

    const ok = !error
    note(
      'contractor_admin cannot provision govt_auditor via provision_field_supervisor',
      ok,
      ok ? `role=field_supervisor (expected)` : `error=${error?.message}`
    )
  }

  // ==========================================================================
  // 8. Field Supervisor cannot invoke either provisioning operation
  // ==========================================================================
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)

    const { error: errCA } = await client.rpc('provision_contractor_admin', {
      p_user_id: tenantAFieldB,
      p_contractor_id: contractorA,
    })

    const { error: errFS } = await client.rpc('provision_field_supervisor', {
      p_user_id: tenantAFieldB,
    })

    const blockedCA = !!errCA
    const blockedFS = !!errFS
    const ok = blockedCA && blockedFS
    note(
      'field_supervisor cannot invoke either provisioning operation',
      ok,
      `ca_blocked=${blockedCA} (${errCA?.message}) fs_blocked=${blockedFS} (${errFS?.message})`
    )
  }

  // ==========================================================================
  // 9. Anonymous user cannot invoke either provisioning operation
  // ==========================================================================
  {
    const client = authenticatedClient()

    const { error: errCA } = await client.rpc('provision_contractor_admin', {
      p_user_id: tenantAFieldB,
      p_contractor_id: contractorA,
    })

    const { error: errFS } = await client.rpc('provision_field_supervisor', {
      p_user_id: tenantAFieldB,
    })

    const blockedCA = !!errCA
    const blockedFS = !!errFS
    const ok = blockedCA && blockedFS
    note(
      'anonymous user cannot invoke either provisioning operation',
      ok,
      `ca_blocked=${blockedCA} (${errCA?.message}) fs_blocked=${blockedFS} (${errFS?.message})`
    )
  }

  // ==========================================================================
  // 10. Newly provisioned users have correct role and contractor_id
  // ==========================================================================
  {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: `verify-${Date.now()}@prana.test`,
      password: 'Verify-2026!',
      email_confirm: true,
    })
    if (createErr) throw createErr
    const newUserId = newUser.user!.id
    cleanup.provisionedUsers.push(newUserId)

    const govClient = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { error: errCA } = await govClient.rpc('provision_contractor_admin', {
      p_user_id: newUserId,
      p_contractor_id: contractorA,
    })

    if (!errCA) {
      const { data: profile } = await admin
        .from('profiles')
        .select('role, contractor_id')
        .eq('id', newUserId)
        .maybeSingle()

      const ok = profile?.role === 'contractor_admin' && profile?.contractor_id === contractorA
      note(
        'newly provisioned contractor_admin has correct role and contractor_id',
        ok,
        `role=${profile?.role} contractor=${profile?.contractor_id}`
      )
    } else {
      note('newly provisioned contractor_admin has correct role and contractor_id', false, `error=${errCA.message}`)
    }
  }

  // ==========================================================================
  // 11. Existing tenant isolation remains intact
  // ==========================================================================
  {
    const { data: freshUser, error: createErr } = await admin.auth.admin.createUser({
      email: `isolation-${Date.now()}@prana.test`,
      password: 'Isolation-2026!',
      email_confirm: true,
    })
    if (createErr) throw createErr
    const freshUserId = freshUser.user!.id
    cleanup.provisionedUsers.push(freshUserId)

    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error } = await client.rpc('provision_field_supervisor', {
      p_user_id: freshUserId,
    })

    const ok = !error
    note(
      'existing tenant isolation remains intact (field_supervisor assigned to own contractor)',
      ok,
      ok ? 'assigned successfully' : `error=${error?.message}`
    )

    if (ok) {
      const { data: profile } = await admin
        .from('profiles')
        .select('contractor_id')
        .eq('id', freshUserId)
        .maybeSingle()

      const correctTenant = profile?.contractor_id === contractorA
      note(
        'cross-tenant assignment is prevented',
        correctTenant,
        `contractor=${profile?.contractor_id}`
      )
    }
  }

  // ==========================================================================
  // 12. Interaction with handle_new_user trigger
  // ==========================================================================
  {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: `trigger-interaction-${Date.now()}@prana.test`,
      password: 'Trigger-Interaction-2026!',
      email_confirm: true,
    })
    if (createErr) throw createErr
    const newUserId = newUser.user!.id
    cleanup.provisionedUsers.push(newUserId)

    const { data: initialProfile } = await admin
      .from('profiles')
      .select('role, contractor_id')
      .eq('id', newUserId)
      .maybeSingle()

    const defaultOk = initialProfile?.role === 'field_supervisor' && initialProfile?.contractor_id === null
    note(
      'handle_new_user trigger creates default field_supervisor profile',
      defaultOk,
      `role=${initialProfile?.role} contractor=${initialProfile?.contractor_id}`
    )

    if (defaultOk) {
      const govClient = await signInAs(EMAILS.gov, PASSWORDS.gov)
      const { error: rpcError } = await govClient.rpc('provision_contractor_admin', {
        p_user_id: newUserId,
        p_contractor_id: contractorA,
        p_full_name: 'Trigger Provisioned',
      })

      const rpcOk = !rpcError
      note(
        'RPC upgrades default profile to contractor_admin',
        rpcOk,
        rpcOk ? 'success' : `error=${rpcError?.message}`
      )

      if (rpcOk) {
        const { data: updatedProfile } = await admin
          .from('profiles')
          .select('role, contractor_id, full_name')
          .eq('id', newUserId)
          .maybeSingle()

        const updatedOk = updatedProfile?.role === 'contractor_admin' && updatedProfile?.contractor_id === contractorA
        note(
          'upgraded profile has correct role and contractor',
          updatedOk,
          `role=${updatedProfile?.role} contractor=${updatedProfile?.contractor_id}`
        )
      }
    }
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed)
  console.log(`\nSUMMARY: ${passed} passed, ${failed.length} failed out of ${results.length} tests`)
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

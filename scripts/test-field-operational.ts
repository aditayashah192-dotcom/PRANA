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

async function resetWorkzoneData(workzoneId: string): Promise<void> {
  await admin.from('scan_logs').delete().or(
    `work_order_id.in.(select id from work_orders where workzone_id='${workzoneId}')`
  )
  await admin.from('permits').delete().eq('workzone_id', workzoneId)
  await admin.from('permit_lifecycle_log').delete().eq('permit_id', workzoneId)
  await admin.from('manual_lockouts').delete().eq('workzone_id', workzoneId)
  await admin.from('two_person_overrides').delete().eq('workzone_id', workzoneId)
  await admin.from('work_order_entrants').delete().eq('work_order_id', workzoneId)
  await admin.from('work_orders').delete().eq('workzone_id', workzoneId)
  await admin.from('devices').delete().eq('workzone_id', workzoneId)
  await admin.from('workzone_assignments').delete().eq('workzone_id', workzoneId)
}

const cleanup: {
  contractorA?: string
  contractorB?: string
  workzoneA1?: string
  workzoneB1?: string
  users: string[]
} = { users: [] }

async function cleanupFn(): Promise<void> {
  try {
    for (const uid of cleanup.users) {
      await admin.auth.admin.deleteUser(uid)
    }
    if (cleanup.workzoneA1) await resetWorkzoneData(cleanup.workzoneA1)
    if (cleanup.workzoneB1) await resetWorkzoneData(cleanup.workzoneB1)
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

  const { data: wzB1, error: wzB1Err } = await admin
    .from('workzones')
    .insert({ name: 'TenantB-Workzone-1', contractor_id: contractorB, target_lat: 28.6159, target_lon: 77.2110, target_depth_meters: 5.0 })
    .select('id')
    .single()
  if (wzB1Err) throw wzB1Err
  cleanup.workzoneB1 = wzB1.id

  const { data: woA1, error: woA1Err } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorA, workzone_id: wzA1.id, status: 'in_progress', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (woA1Err) throw woA1Err

  const { data: woB1, error: woB1Err } = await admin
    .from('work_orders')
    .insert({ contractor_id: contractorB, workzone_id: wzB1.id, status: 'in_progress', created_at: new Date().toISOString() })
    .select('id')
    .single()
  if (woB1Err) throw woB1Err

  const { data: deviceA1, error: deviceA1Err } = await admin
    .from('devices')
    .insert({ serial_number: `DEV-${Date.now()}`, secret_hash: 'test-secret', is_active: true, workzone_id: wzA1.id, contractor_id: contractorA })
    .select('id')
    .single()
  if (deviceA1Err) throw deviceA1Err

  const { data: assignmentA1, error: assignmentA1Err } = await admin
    .from('workzone_assignments')
    .insert({ workzone_id: wzA1.id, assigned_staff_id: tenantAFieldA, contractor_id: contractorA })
    .select('id')
    .single()
  if (assignmentA1Err) throw assignmentA1Err

  const { data: assignmentA2, error: assignmentA2Err } = await admin
    .from('workzone_assignments')
    .insert({ workzone_id: wzA1.id, assigned_staff_id: tenantAFieldB, contractor_id: contractorA })
    .select('id')
    .single()
  if (assignmentA2Err) throw assignmentA2Err

  // ==========================================================================
  // PHASE 1: PRE-ASSIGNED ENTRANTS
  // ==========================================================================

  // --- A. cross-tenant entrant access blocked ---
  {
    const client = await signInAs(EMAILS.tenantBField, PASSWORDS.tenantBField)
    const { data, error } = await client
      .from('entrants')
      .select('id')

    const blocked = (data?.length ?? 0) === 0 && !error
    note(
      'cross-tenant entrant access blocked',
      blocked,
      `count=${data?.length ?? 0} err=${error?.message ?? 'none'}`
    )
  }

  // --- B. unassigned entrant rejection ---
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data: entrant } = await admin
      .from('entrants')
      .insert({ contractor_id: contractorA, full_name: 'Unassigned Entrant' })
      .select('id')
      .single()
    if (!entrant) throw new Error('Failed to create entrant')

    const { error } = await client.rpc('record_entrant_selection', {
      p_work_order_id: woA1.id,
      p_entrant_id: entrant.id,
    })

    const blocked = !!error
    note(
      'unassigned entrant selection rejected',
      blocked,
      blocked ? `blocked (${error.message})` : 'unexpectedly succeeded'
    )
  }

  // --- C. assigned entrant success ---
  {
    const client = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data: entrant } = await admin
      .from('entrants')
      .insert({ contractor_id: contractorA, full_name: 'Assigned Entrant' })
      .select('id')
      .single()
    if (!entrant) throw new Error('Failed to create entrant')

    const { error: assignErr } = await client.rpc('assign_entrant_to_work_order', {
      p_work_order_id: woA1.id,
      p_entrant_id: entrant.id,
    })
    if (assignErr) throw assignErr

    const fieldClient = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await fieldClient.rpc('record_entrant_selection', {
      p_work_order_id: woA1.id,
      p_entrant_id: entrant.id,
    })

    const ok = !error
    note(
      'assigned entrant selection succeeds',
      ok,
      ok ? 'selection recorded' : `error=${error.message}`
    )
  }

  // ==========================================================================
  // PHASE 2: PERMIT LIFECYCLE
  // ==========================================================================

  // --- D. invalid permit lifecycle transitions ---
  {
    const adminClient = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data: permit, error: permitErr } = await adminClient
      .from('permits')
      .insert({
        contractor_id: contractorA,
        workzone_id: wzA1.id,
        work_order_id: woA1.id,
        field_supervisor_id: tenantAFieldA,
        status: 'ISSUED',
        number: 'PERMIT-LIFECYCLE',
      })
      .select('id')
      .single()
    if (permitErr) throw permitErr

    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client.rpc('transition_permit', {
      p_permit_id: permit.id,
      p_new_status: 'CLOSED',
      p_reason: 'invalid skip',
    })

    const blocked = !!error && error.message.includes('invalid transition')
    note(
      'invalid permit lifecycle transition rejected',
      blocked,
      blocked ? `blocked (${error.message})` : 'unexpectedly succeeded'
    )
  }

  // --- E. unauthorized lifecycle changes ---
  {
    const adminClient = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data: permit, error: permitErr } = await adminClient
      .from('permits')
      .insert({
        contractor_id: contractorA,
        workzone_id: wzA1.id,
        work_order_id: woA1.id,
        field_supervisor_id: tenantAFieldA,
        status: 'ISSUED',
        number: 'PERMIT-UNAUTH',
      })
      .select('id')
      .single()
    if (permitErr) throw permitErr

    const unauthClient = await signInAs(EMAILS.tenantBField, PASSWORDS.tenantBField)
    const { error } = await unauthClient.rpc('transition_permit', {
      p_permit_id: permit.id,
      p_new_status: 'ACTIVE',
      p_reason: 'cross-tenant attempt',
    })

    const blocked = !!error && (error.message.includes('unauthorized') || error.message.includes('does not belong'))
    note(
      'unauthorized permit lifecycle change rejected',
      blocked,
      blocked ? `blocked (${error.message})` : 'unexpectedly succeeded'
    )
  }

  // --- F. valid lifecycle transition + audit record ---
  {
    const adminClient = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { data: permit, error: permitErr } = await adminClient
      .from('permits')
      .insert({
        contractor_id: contractorA,
        workzone_id: wzA1.id,
        work_order_id: woA1.id,
        field_supervisor_id: tenantAFieldA,
        status: 'ISSUED',
        number: 'PERMIT-VALID',
      })
      .select('id')
      .single()
    if (permitErr) throw permitErr

    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client.rpc('transition_permit', {
      p_permit_id: permit.id,
      p_new_status: 'ACTIVE',
      p_reason: 'starting work',
    })

    const ok = !error
    const { data: log } = await admin
      .from('permit_lifecycle_log')
      .select('id')
      .eq('permit_id', permit.id)
      .eq('new_status', 'ACTIVE')
      .maybeSingle()

    note(
      'valid lifecycle transition succeeds with audit record',
      ok && !!log,
      ok ? `transition ok, log=${log?.id}` : `error=${error.message}`
    )
  }

  // ==========================================================================
  // PHASE 3: MANUAL LOCKOUT
  // ==========================================================================

  // --- G. manual lockout authorization ---
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client.rpc('apply_manual_lockout', {
      p_workzone_id: wzA1.id,
      p_reason: 'safety concern',
    })

    const ok = !error
    const { data: lockout } = await admin
      .from('manual_lockouts')
      .select('id')
      .eq('workzone_id', wzA1.id)
      .eq('active', true)
      .maybeSingle()

    note(
      'manual lockout applied by assigned field supervisor',
      ok && !!lockout,
      ok ? `lockout=${lockout?.id}` : `error=${error.message}`
    )
  }

  // --- H. lockout blocks permit issuance ---
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)

    // Ensure fresh SAFE telemetry exists
    await admin.from('scan_logs').insert({
      work_order_id: woA1.id,
      device_id: deviceA1.id,
      readings: { h2s_ppm: 5, o2_percent: 20.5, depth_meters: 2.5, battery_percent: 80, is_warming_up: false },
      decision: 'SAFE',
      prev_hash: 'genesis',
      row_hash: 'h-lockout-block',
      timestamp: new Date().toISOString(),
    })

    const { error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const blocked = !!error && error.message.includes('manual lockout')
    note(
      'manual lockout blocks permit issuance',
      blocked,
      blocked ? `blocked (${error.message})` : 'unexpectedly succeeded'
    )
  }

  // --- I. missing reason rejection ---
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client.rpc('apply_manual_lockout', {
      p_workzone_id: wzA1.id,
      p_reason: '',
    })

    const blocked = !!error && error.message.includes('reason is required')
    note(
      'missing reason rejects manual lockout',
      blocked,
      blocked ? `blocked (${error.message})` : 'unexpectedly succeeded'
    )
  }

  // ==========================================================================
  // PHASE 4: TWO-PERSON OVERRIDE
  // ==========================================================================

  // --- J. two-person override requires two distinct users ---
  {
    const clientA = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data: overrideId, error: requestErr } = await clientA.rpc('request_two_person_override', {
      p_workzone_id: wzA1.id,
      p_reason: 'need access',
    })

    const requestOk = !requestErr && !!overrideId
    const clientB = await signInAs(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB)
    const { error: approveErr } = await clientB.rpc('approve_two_person_override', {
      p_override_id: overrideId,
      p_reason: 'approved',
    })

    const approveOk = !approveErr
    const { data: override } = await admin
      .from('two_person_overrides')
      .select('status, approved_by')
      .eq('id', overrideId)
      .maybeSingle()

    note(
      'two-person override requires two distinct users',
      requestOk && approveOk && override?.status === 'approved' && override?.approved_by === tenantAFieldB,
      `request=${requestOk} approve=${approveOk} status=${override?.status} approver=${override?.approved_by?.slice(0, 8)}`
    )
  }

  // --- K. self-approval rejection ---
  {
    const clientA = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data: overrideId, error: requestErr } = await clientA.rpc('request_two_person_override', {
      p_workzone_id: wzA1.id,
      p_reason: 'self-approval test',
    })

    const requestOk = !requestErr && !!overrideId
    const { error: approveErr } = await clientA.rpc('approve_two_person_override', {
      p_override_id: overrideId,
      p_reason: 'self approve',
    })

    const blocked = !!approveErr && approveErr.message.includes('self-approval')
    note(
      'self-approval rejected',
      requestOk && blocked,
      `request=${requestOk} blocked=${blocked} err=${approveErr?.message}`
    )
  }

  // --- L. approved override allows permit despite lockout ---
  {
    // Ensure lockout is still active
    await admin.from('manual_lockouts').update({ active: true }).eq('workzone_id', wzA1.id)

    const clientA = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data: overrideId } = await clientA.rpc('request_two_person_override', {
      p_workzone_id: wzA1.id,
      p_reason: 'override for test',
    })

    const clientB = await signInAs(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB)
    await clientB.rpc('approve_two_person_override', {
      p_override_id: overrideId,
      p_reason: 'approving',
    })

    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data: permit, error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const ok = !error && !!permit && permit.status === 'ISSUED'
    note(
      'approved two-person override allows permit despite lockout',
      ok,
      ok ? `permit=${permit.id}` : `error=${error?.message}`
    )
  }

  // --- M. audit records are created ---
  {
    const { data: lockoutLog } = await admin
      .from('manual_lockouts')
      .select('id')
      .eq('workzone_id', wzA1.id)
      .eq('performed_by', tenantAFieldA)
      .maybeSingle()

    const { data: overrideLog } = await admin
      .from('two_person_overrides')
      .select('id')
      .eq('workzone_id', wzA1.id)
      .eq('requested_by', tenantAFieldA)
      .eq('status', 'approved')
      .limit(1)

    const overrideExists = !!(overrideLog && overrideLog.length > 0)

    const { data: lifecycleLog } = await admin
      .from('permit_lifecycle_log')
      .select('id')
      .eq('performed_by', tenantAFieldA)
      .maybeSingle()

    note(
      'audit records are created for operational actions',
      !!lockoutLog && overrideExists && !!lifecycleLog,
      `lockout=${!!lockoutLog} override=${overrideExists} lifecycle=${!!lifecycleLog}`
    )
  }

  // --- N. crafted client request cannot bypass controls ---
  {
    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)

    // Try to approve own override
    const { data: ownOverride } = await client.rpc('request_two_person_override', {
      p_workzone_id: wzA1.id,
      p_reason: 'bypass test',
    })

    const { error: selfApproveErr } = await client.rpc('approve_two_person_override', {
      p_override_id: ownOverride,
      p_reason: 'bypass',
    })

    const selfBlocked = !!selfApproveErr && selfApproveErr.message.includes('self-approval')

    // Try to assign cross-tenant entrant
    const { data: crossEntrant } = await admin
      .from('entrants')
      .insert({ contractor_id: contractorB, full_name: 'Cross Tenant Entrant' })
      .select('id')
      .single()
    if (!crossEntrant) throw new Error('Failed to create cross-tenant entrant')

    // Try to assign cross-tenant entrant as contractor_admin
    const adminClient = await signInAs(EMAILS.tenantAAdmin, PASSWORDS.tenantAAdmin)
    const { error: crossEntrantErr } = await adminClient.rpc('assign_entrant_to_work_order', {
      p_work_order_id: woA1.id,
      p_entrant_id: crossEntrant.id,
    })

    const crossBlocked = !!crossEntrantErr && crossEntrantErr.message.includes('does not belong')

    note(
      'crafted client requests cannot bypass controls',
      selfBlocked && crossBlocked,
      `selfApproveBlocked=${selfBlocked} crossEntrantBlocked=${crossBlocked}`
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

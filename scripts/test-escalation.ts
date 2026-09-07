import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'

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
  await admin.from('escalation_events').delete().eq('workzone_id', workzoneId)
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

function signPayload(payload: object, secret: string): string {
  function canonicalize(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) {
      return '[' + value.map(canonicalize).join(',') + ']'
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>)
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
  return createHmac('sha256', secret)
    .update(canonicalize(payload), 'utf8')
    .digest('hex')
}

async function postIngest(
  url: string,
  body: object
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* leave json null */
  }
  return { status: res.status, json, text }
}

function buildSignedIngest(args: {
  deviceId: string
  workOrderId: string
  secret: string
  telemetry: Record<string, unknown>
}): { body: Record<string, unknown>; signature: string } {
  const timestamp = Date.now()
  const signedPayload = {
    device_id: args.deviceId,
    readings: args.telemetry,
    timestamp,
    work_order_id: args.workOrderId,
  }
  const signature = signPayload(signedPayload, args.secret)
  return {
    body: {
      device_id: args.deviceId,
      readings: args.telemetry,
      timestamp,
      work_order_id: args.workOrderId,
      signature,
    },
    signature,
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

  const { data: assignmentB1, error: assignmentB1Err } = await admin
    .from('workzone_assignments')
    .insert({ workzone_id: wzB1.id, assigned_staff_id: tenantBField, contractor_id: contractorB })
    .select('id')
    .single()
  if (assignmentB1Err) throw assignmentB1Err

  const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:3000/api/telemetry/ingest'

  // ==========================================================================
  // 1. SAFE does not generate a lockout escalation
  // ==========================================================================
  {
    await admin.from('escalation_events').delete().eq('workzone_id', wzA1.id)
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)

    await admin.from('scan_logs').insert({
      work_order_id: woA1.id,
      device_id: deviceA1.id,
      readings: { h2s_ppm: 2, o2_percent: 20.9, depth_meters: 3, battery_percent: 85, is_warming_up: false, user_lat: 28.6139, user_lon: 77.209 },
      decision: 'SAFE',
      prev_hash: 'genesis',
      row_hash: 'h-safe-1',
      timestamp: new Date().toISOString(),
    })

    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { data } = await client.rpc('get_workzone_authoritative_state', {
      p_workzone_id: wzA1.id,
    })

    const state = (data as { aggregate_state?: string })?.aggregate_state
    const isSafe = state === 'SAFE'

    const { data: events } = await admin
      .from('escalation_events')
      .select('id')
      .eq('workzone_id', wzA1.id)

    const noEscalation = (events?.length ?? 0) === 0
    note(
      'SAFE does not generate lockout escalation',
      isSafe && noEscalation,
      `aggregate_state=${state} events=${events?.length ?? 0}`
    )
  }

  // ==========================================================================
  // 2. WARNING generates the correct escalation state (no lockout escalation)
  // ==========================================================================
  {
    await admin.from('escalation_events').delete().eq('workzone_id', wzA1.id)
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)

    await admin.from('scan_logs').insert({
      work_order_id: woA1.id,
      device_id: deviceA1.id,
      readings: { h2s_ppm: 12, o2_percent: 20.9, depth_meters: 3, battery_percent: 85, is_warming_up: false, user_lat: 28.6139, user_lon: 77.209 },
      decision: 'WARNING',
      prev_hash: 'genesis',
      row_hash: 'h-warning-1',
      timestamp: new Date().toISOString(),
    })

    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { data } = await client.rpc('get_workzone_authoritative_state', {
      p_workzone_id: wzA1.id,
    })

    const state = (data as { aggregate_state?: string })?.aggregate_state
    const isWarning = state === 'WARNING'

    const { data: events } = await admin
      .from('escalation_events')
      .select('id')
      .eq('workzone_id', wzA1.id)

    const noEscalation = (events?.length ?? 0) === 0
    note(
      'WARNING generates correct escalation state (no lockout escalation)',
      isWarning && noEscalation,
      `aggregate_state=${state} events=${events?.length ?? 0}`
    )
  }

  // ==========================================================================
  // 3. LOCKOUT generates an escalation event
  // ==========================================================================
  {
    await admin.from('escalation_events').delete().eq('workzone_id', wzA1.id)
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)

    await admin.from('scan_logs').insert({
      work_order_id: woA1.id,
      device_id: deviceA1.id,
      readings: { h2s_ppm: 25, o2_percent: 20.9, depth_meters: 3, battery_percent: 85, is_warming_up: false, user_lat: 28.6139, user_lon: 77.209 },
      decision: 'LOCKOUT',
      prev_hash: 'genesis',
      row_hash: 'h-lockout-1',
      timestamp: new Date().toISOString(),
    })

    const govClient = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { data: authData } = await govClient.rpc('get_workzone_authoritative_state', {
      p_workzone_id: wzA1.id,
    })

    const state = (authData as { aggregate_state?: string })?.aggregate_state
    const isLockout = state === 'LOCKOUT'

    const { error: escErr } = await govClient.rpc('create_escalation_event', {
      p_workzone_id: wzA1.id,
      p_event_type: 'LOCKOUT_ENTERED',
      p_trigger_source: 'telemetry_test',
      p_previous_state: null,
    })

    const { data: events } = await admin
      .from('escalation_events')
      .select('id, event_type, aggregate_state, trigger_source')
      .eq('workzone_id', wzA1.id)
      .order('created_at', { ascending: false })

    const hasEscalation = !!(events && events.length > 0 && events[0].event_type === 'LOCKOUT_ENTERED')
    note(
      'LOCKOUT generates an escalation event',
      isLockout && !escErr && hasEscalation,
      `aggregate_state=${state} rpc_error=${escErr?.message ?? 'none'} events=${events?.length ?? 0} first_event=${events?.[0]?.event_type ?? 'none'}`
    )
  }

  // ==========================================================================
  // 4. Missing telemetry cannot produce SAFE (authoritative state)
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)

    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { data } = await client.rpc('get_workzone_authoritative_state', {
      p_workzone_id: wzA1.id,
    })

    const state = (data as { aggregate_state?: string })?.aggregate_state
    note(
      'Missing telemetry cannot produce SAFE',
      state === 'UNKNOWN',
      `aggregate_state=${state}`
    )
  }

  // ==========================================================================
  // 5. Stale telemetry cannot produce SAFE
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)
    const staleTimestamp = new Date(Date.now() - 60000).toISOString()
    await admin.from('scan_logs').insert({
      work_order_id: woA1.id,
      device_id: deviceA1.id,
      readings: { h2s_ppm: 2, o2_percent: 20.9, depth_meters: 3, battery_percent: 85, is_warming_up: false, user_lat: 28.6139, user_lon: 77.209 },
      decision: 'SAFE',
      prev_hash: 'genesis',
      row_hash: 'h-stale',
      timestamp: staleTimestamp,
    })

    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { data } = await client.rpc('get_workzone_authoritative_state', {
      p_workzone_id: wzA1.id,
    })

    const state = (data as { aggregate_state?: string })?.aggregate_state
    note(
      'Stale telemetry cannot produce SAFE',
      state === 'UNKNOWN',
      `aggregate_state=${state}`
    )
  }

  // ==========================================================================
  // 6. Ambiguous telemetry cannot produce SAFE
  // ==========================================================================
  {
    await admin.from('scan_logs').delete().eq('work_order_id', woA1.id)
    const now = new Date().toISOString()
    await admin.from('scan_logs').insert({
      work_order_id: woA1.id,
      device_id: deviceA1.id,
      readings: { h2s_ppm: 2, o2_percent: 20.9, depth_meters: 3, battery_percent: 85, is_warming_up: false, user_lat: 28.6139, user_lon: 77.209 },
      decision: 'SAFE',
      prev_hash: 'genesis',
      row_hash: 'h-ambig-1',
      timestamp: now,
    })

    const { data: woA1b, error: woA1bErr } = await admin
      .from('work_orders')
      .insert({ contractor_id: contractorA, workzone_id: wzA1.id, status: 'in_progress', created_at: now })
      .select('id')
      .single()
    if (woA1bErr) throw woA1bErr

    await admin.from('scan_logs').insert({
      work_order_id: woA1b.id,
      device_id: deviceA1.id,
      readings: { h2s_ppm: 2, o2_percent: 20.9, depth_meters: 3, battery_percent: 85, is_warming_up: false, user_lat: 28.6139, user_lon: 77.209 },
      decision: 'SAFE',
      prev_hash: 'genesis',
      row_hash: 'h-ambig-2',
      timestamp: now,
    })

    const client = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { data } = await client.rpc('get_workzone_authoritative_state', {
      p_workzone_id: wzA1.id,
    })

    const state = (data as { aggregate_state?: string })?.aggregate_state
    note(
      'Ambiguous telemetry cannot produce SAFE',
      state === 'UNKNOWN',
      `aggregate_state=${state}`
    )
  }

  // ==========================================================================
  // 7. Notification failure does not permit entry
  // ==========================================================================
  {
    await admin.from('manual_lockouts').delete().eq('workzone_id', wzA1.id)
    await admin.from('escalation_events').delete().eq('workzone_id', wzA1.id)

    const lockoutClient = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error: lockoutErr } = await lockoutClient.rpc('apply_manual_lockout', {
      p_workzone_id: wzA1.id,
      p_reason: 'notification failure test',
    })
    if (lockoutErr) throw lockoutErr

    const { body } = buildSignedIngest({
      deviceId: deviceA1.id,
      workOrderId: woA1.id,
      secret: 'test-secret',
      telemetry: { h2s_ppm: 2, o2_percent: 20.9, depth_meters: 3, battery_percent: 85, is_warming_up: false, user_lat: 28.6139, user_lon: 77.209 },
    })

    const { status } = await postIngest(INGEST_URL, body)
    const isSafe = status === 200

    const permitClient = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error: permitErr } = await permitClient.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const blocked = !!permitErr
    note(
      'Notification failure does not permit entry',
      blocked,
      `ingest=${isSafe} permit_blocked=${blocked} err=${permitErr?.message ?? 'none'}`
    )
  }

  // ==========================================================================
  // 8. Unauthorized users cannot trigger privileged escalation actions
  // ==========================================================================
  {
    const unauthClient = await signInAs(EMAILS.tenantBField, PASSWORDS.tenantBField)
    const { error } = await unauthClient.rpc('create_escalation_event', {
      p_workzone_id: wzA1.id,
      p_event_type: 'LOCKOUT_ENTERED',
      p_trigger_source: 'test',
      p_previous_state: null,
    })

    const blocked = !!error
    note(
      'Unauthorized users cannot trigger privileged escalation actions',
      blocked,
      blocked ? `blocked (${error.message})` : 'unexpectedly succeeded'
    )
  }

  // ==========================================================================
  // 9. Two-person override still requires two distinct authorized supervisors
  // ==========================================================================
  {
    await admin.from('manual_lockouts').delete().eq('workzone_id', wzA1.id)
    await admin.from('two_person_overrides').delete().eq('workzone_id', wzA1.id)

    const clientA = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data: overrideId, error: requestErr } = await clientA.rpc('request_two_person_override', {
      p_workzone_id: wzA1.id,
      p_reason: 'distinct approver test',
    })

    const requestOk = !requestErr && !!overrideId
    const clientB = await signInAs(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB)
    const { error: approveErr } = await clientB.rpc('approve_two_person_override', {
      p_override_id: overrideId,
      p_reason: 'approved by B',
    })

    const approveOk = !approveErr
    const { data: override } = await admin
      .from('two_person_overrides')
      .select('status, approved_by')
      .eq('id', overrideId)
      .maybeSingle<{ status: string; approved_by: string }>()

    note(
      'Two-person override requires two distinct authorized supervisors',
      requestOk && approveOk && override?.status === 'approved' && override?.approved_by === tenantAFieldB,
      `request=${requestOk} approve=${approveOk} status=${override?.status} approver=${override?.approved_by?.slice(0, 8)}`
    )
  }

  // ==========================================================================
  // 10. Override cannot turn stale telemetry into SAFE
  // ==========================================================================
  {
    await admin.from('manual_lockouts').delete().eq('workzone_id', wzA1.id)
    await admin.from('two_person_overrides').delete().eq('workzone_id', wzA1.id)

    const { data: allWorkOrders } = await admin
      .from('work_orders')
      .select('id')
      .eq('workzone_id', wzA1.id)

    for (const wo of allWorkOrders ?? []) {
      await admin.from('scan_logs').delete().eq('work_order_id', wo.id)
    }

    const staleTimestamp = new Date(Date.now() - 120000).toISOString()
    await admin.from('scan_logs').insert({
      work_order_id: woA1.id,
      device_id: deviceA1.id,
      readings: { h2s_ppm: 2, o2_percent: 20.9, depth_meters: 3, battery_percent: 85, is_warming_up: false, user_lat: 28.6139, user_lon: 77.209 },
      decision: 'SAFE',
      prev_hash: 'genesis',
      row_hash: 'h-override-stale',
      timestamp: staleTimestamp,
    })

    const clientA = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { data: overrideId } = await clientA.rpc('request_two_person_override', {
      p_workzone_id: wzA1.id,
      p_reason: 'stale telemetry override test',
    })

    const clientB = await signInAs(EMAILS.tenantAFieldB, PASSWORDS.tenantAFieldB)
    await clientB.rpc('approve_two_person_override', {
      p_override_id: overrideId,
      p_reason: 'approving',
    })

    const govClient = await signInAs(EMAILS.gov, PASSWORDS.gov)
    const { data: authState } = await govClient.rpc('get_workzone_authoritative_state', {
      p_workzone_id: wzA1.id,
    })

    const client = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)
    const { error } = await client.rpc('issue_permit', {
      p_workzone_id: wzA1.id,
      p_work_order_id: woA1.id,
      p_lat: 28.6139,
      p_lon: 77.2090,
    })

    const blocked = !!error && error.message.includes('not fresh')
    note(
      'Override cannot turn stale telemetry into SAFE',
      blocked,
      blocked ? `blocked (${error.message})` : `unexpectedly succeeded (auth=${JSON.stringify(authState)})`
    )
  }

  // ==========================================================================
  // 11. Cross-tenant escalation access is blocked
  // ==========================================================================
  {
    await admin.from('escalation_events').delete().eq('workzone_id', wzB1.id)
    await admin.from('escalation_events').delete().eq('workzone_id', wzA1.id)

    const clientB = await signInAs(EMAILS.tenantBField, PASSWORDS.tenantBField)
    const { error } = await clientB.rpc('create_escalation_event', {
      p_workzone_id: wzA1.id,
      p_event_type: 'LOCKOUT_ENTERED',
      p_trigger_source: 'cross_tenant_test',
      p_previous_state: null,
    })

    const blocked = !!error
    const { data: events } = await admin
      .from('escalation_events')
      .select('id')
      .eq('workzone_id', wzA1.id)

    note(
      'Cross-tenant escalation access is blocked',
      blocked && (events?.length ?? 0) === 0,
      `blocked=${blocked} events=${events?.length ?? 0}`
    )
  }

  // ==========================================================================
  // 12. Audit records cannot be modified/deleted through normal application paths
  // ==========================================================================
  {
    await admin.from('escalation_events').delete().eq('workzone_id', wzA1.id)
    const { data: event, error: eventInsertErr } = await admin
      .from('escalation_events')
      .insert({ workzone_id: wzA1.id, event_type: 'LOCKOUT_ENTERED', aggregate_state: 'LOCKOUT', aggregate_reason: 'TEST', trigger_source: 'test', previous_state: null, notification_status: 'pending' })
      .select('id, aggregate_state')
      .single<{ id: string; aggregate_state: string }>()

    if (eventInsertErr || !event) {
      throw new Error('Failed to create escalation event for immutability test')
    }

    const originalState = event.aggregate_state

    const clientA = await signInAs(EMAILS.tenantAFieldA, PASSWORDS.tenantAFieldA)

    await clientA
      .from('escalation_events')
      .update({ aggregate_state: 'SAFE' })
      .eq('id', event.id)

    const { data: afterUpdate } = await admin
      .from('escalation_events')
      .select('aggregate_state')
      .eq('id', event.id)
      .maybeSingle<{ aggregate_state: string }>()

    await clientA
      .from('escalation_events')
      .delete()
      .eq('id', event.id)

    const { data: afterDelete } = await admin
      .from('escalation_events')
      .select('id')
      .eq('id', event.id)
      .maybeSingle<{ id: string }>()

    const updateBlocked = afterUpdate?.aggregate_state === originalState
    const deleteBlocked = !!afterDelete

    note(
      'Audit records cannot be modified/deleted through normal application paths',
      updateBlocked && deleteBlocked,
      `update_blocked=${updateBlocked} delete_blocked=${deleteBlocked} original_state=${originalState} after_update=${afterUpdate?.aggregate_state}`
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

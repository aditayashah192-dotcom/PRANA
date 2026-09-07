import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing env vars in .env.local')
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const DEMO_USERS = [
  { email: 'tenant-a-admin@prana.test', password: 'Prana-TenantA-Admin-2026!', role: 'contractor_admin', contractorName: 'Prana Tenant A' },
  { email: 'tenant-a-field-a@prana.test', password: 'Prana-TenantA-FieldA-2026!', role: 'field_supervisor', contractorName: 'Prana Tenant A' },
  { email: 'tenant-a-field-b@prana.test', password: 'Prana-TenantA-FieldB-2026!', role: 'field_supervisor', contractorName: 'Prana Tenant A' },
  { email: 'tenant-b-field@prana.test', password: 'Prana-TenantB-Field-2026!', role: 'field_supervisor', contractorName: 'Prana Tenant B' },
  { email: 'govt-auditor@prana.test', password: 'Prana-Govt-Auditor-2026!', role: 'govt_auditor', contractorName: null },
]

const DEMO_WORKZONES = [
  { name: 'TenantA-Workzone-1', contractorName: 'Prana Tenant A', target_lat: 28.6139, target_lon: 77.2090, target_depth_meters: 3.0 },
  { name: 'TenantA-Workzone-2', contractorName: 'Prana Tenant A', target_lat: 28.6149, target_lon: 77.2100, target_depth_meters: 4.0 },
  { name: 'TenantB-Workzone-1', contractorName: 'Prana Tenant B', target_lat: 28.6159, target_lon: 77.2110, target_depth_meters: 5.0 },
  { name: 'TenantB-Workzone-2', contractorName: 'Prana Tenant B', target_lat: 28.6169, target_lon: 77.2120, target_depth_meters: 6.0 },
]

const DEMO_ENTRANTS = [
  { email: 'tenant-a-field-a@prana.test', fullName: 'Field Supervisor A', badgeNumber: 'FS-A-001', role: 'Field Supervisor' },
  { email: 'tenant-a-field-b@prana.test', fullName: 'Field Supervisor B', badgeNumber: 'FS-B-001', role: 'Field Supervisor' },
  { email: 'tenant-b-field@prana.test', fullName: 'Field Supervisor B-T', badgeNumber: 'FS-B-T-001', role: 'Field Supervisor' },
  { email: 'worker-a@prana.test', fullName: 'Worker A', badgeNumber: 'W-A-001', role: 'Worker' },
]

const DEMO_DEVICES = [
  { serial_number: 'DEV-TENANTA-001', contractorName: 'Prana Tenant A', workzoneName: 'TenantA-Workzone-1' },
  { serial_number: 'DEV-TENANTB-001', contractorName: 'Prana Tenant B', workzoneName: 'TenantB-Workzone-1' },
]

const contractorIdByName = new Map<string, string>()
const workzoneIdByName = new Map<string, string>()
const entrantIdByEmail = new Map<string, string>()
const deviceIdBySerial = new Map<string, string>()

interface SeedResult {
  usersCreated: number
  usersReused: number
  contractorsCreated: number
  contractorsReused: number
  workzonesCreated: number
  workzonesReused: number
  workOrdersCreated: number
  workOrdersReused: number
  entrantsCreated: number
  entrantsReused: number
  devicesCreated: number
  devicesReused: number
  assignmentsCreated: number
  assignmentsReused: number
}

const result: SeedResult = {
  usersCreated: 0,
  usersReused: 0,
  contractorsCreated: 0,
  contractorsReused: 0,
  workzonesCreated: 0,
  workzonesReused: 0,
  workOrdersCreated: 0,
  workOrdersReused: 0,
  entrantsCreated: 0,
  entrantsReused: 0,
  devicesCreated: 0,
  devicesReused: 0,
  assignmentsCreated: 0,
  assignmentsReused: 0,
}

async function getOrCreateContractor(name: string): Promise<string> {
  if (contractorIdByName.has(name)) return contractorIdByName.get(name)!

  const { data: existing } = await admin
    .from('contractors')
    .select('id')
    .eq('name', name)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    contractorIdByName.set(name, existing.id)
    result.contractorsReused++
    return existing.id
  }

  const { data: created, error: createError } = await admin
    .from('contractors')
    .insert({ name })
    .select('id')
    .single()

  if (createError || !created) {
    throw createError ?? new Error(`Failed to create contractor ${name}`)
  }

  contractorIdByName.set(name, created.id)
  result.contractorsCreated++
  console.log(`  created contractor: ${name}`)
  return created.id
}

async function getOrCreateUser(email: string, password: string, role: string, contractorName: string | null): Promise<string> {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existing = list?.users.find((u) => u.email === email)

  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, { password })
    result.usersReused++
    console.log(`  reused existing user: ${email}`)
    return existing.id
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) {
    throw error ?? new Error(`Failed to create user ${email}`)
  }

  result.usersCreated++
  console.log(`  created user: ${email}`)
  return data.user.id
}

async function ensureProfile(userId: string, role: string, contractorId: string | null): Promise<void> {
  const { error } = await admin.from('profiles').upsert({
    id: userId,
    role,
    contractor_id: contractorId,
  })
  if (error) throw error
}

async function getOrCreateWorkzone(name: string, contractorId: string, target_lat: number, target_lon: number, target_depth_meters: number): Promise<string> {
  if (workzoneIdByName.has(name)) return workzoneIdByName.get(name)!

  const { data: existing } = await admin
    .from('workzones')
    .select('id')
    .eq('name', name)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    workzoneIdByName.set(name, existing.id)
    result.workzonesReused++
    return existing.id
  }

  const { data: created, error: createError } = await admin
    .from('workzones')
    .insert({
      name,
      contractor_id: contractorId,
      target_lat,
      target_lon,
      target_depth_meters,
    })
    .select('id')
    .single()

  if (createError || !created) {
    throw createError ?? new Error(`Failed to create workzone ${name}`)
  }

  workzoneIdByName.set(name, created.id)
  result.workzonesCreated++
  console.log(`  created workzone: ${name}`)
  return created.id
}

async function getOrCreateWorkOrder(workzoneId: string, contractorId: string, status: 'pending' | 'in_progress' = 'pending'): Promise<string> {
  const orderName = `${workzoneId}-${status}`
  const { data: existing } = await admin
    .from('work_orders')
    .select('id')
    .eq('workzone_id', workzoneId)
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    result.workOrdersReused++
    return existing.id
  }

  const { data: created, error: createError } = await admin
    .from('work_orders')
    .insert({
      workzone_id: workzoneId,
      contractor_id: contractorId,
      status,
    })
    .select('id')
    .single()

  if (createError || !created) {
    throw createError ?? new Error(`Failed to create work order for ${workzoneId}`)
  }

  result.workOrdersCreated++
  console.log(`  created work order: ${orderName}`)
  return created.id
}

async function getOrCreateEntrant(contractorId: string, fullName: string, badgeNumber: string | null, role: string, emailHint: string | null): Promise<string> {
  const lookupEmail = emailHint ?? `${fullName.toLowerCase().replace(/\s+/g, '.')}@prana.test`

  if (entrantIdByEmail.has(lookupEmail)) {
    return entrantIdByEmail.get(lookupEmail)!
  }

  const { data: existing } = await admin
    .from('entrants')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('full_name', fullName)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    entrantIdByEmail.set(lookupEmail, existing.id)
    result.entrantsReused++
    return existing.id
  }

  const { data: created, error: createError } = await admin
    .from('entrants')
    .insert({
      contractor_id: contractorId,
      full_name: fullName,
      badge_number: badgeNumber,
      role,
    })
    .select('id')
    .single()

  if (createError || !created) {
    throw createError ?? new Error(`Failed to create entrant ${fullName}`)
  }

  entrantIdByEmail.set(lookupEmail, created.id)
  result.entrantsCreated++
  console.log(`  created entrant: ${fullName}`)
  return created.id
}

async function getOrCreateDevice(serial_number: string, contractorId: string, workzoneId: string): Promise<string> {
  if (deviceIdBySerial.has(serial_number)) return deviceIdBySerial.get(serial_number)!

  const { data: existing } = await admin
    .from('devices')
    .select('id')
    .eq('serial_number', serial_number)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    deviceIdBySerial.set(serial_number, existing.id)
    result.devicesReused++
    return existing.id
  }

  const { data: created, error: createError } = await admin
    .from('devices')
    .insert({
      serial_number,
      contractor_id: contractorId,
      workzone_id: workzoneId,
      is_active: true,
      secret_hash: 'demo-secret-hash',
    })
    .select('id')
    .single()

  if (createError || !created) {
    throw createError ?? new Error(`Failed to create device ${serial_number}`)
  }

  deviceIdBySerial.set(serial_number, created.id)
  result.devicesCreated++
  console.log(`  created device: ${serial_number}`)
  return created.id
}

async function getOrCreateAssignment(workzoneId: string, staffId: string, contractorId: string): Promise<void> {
  const { data: existing } = await admin
    .from('workzone_assignments')
    .select('id')
    .eq('workzone_id', workzoneId)
    .eq('assigned_staff_id', staffId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    result.assignmentsReused++
    return
  }

  const { error: insertError } = await admin.from('workzone_assignments').insert({
    workzone_id: workzoneId,
    assigned_staff_id: staffId,
    contractor_id: contractorId,
  })

  if (insertError) throw insertError
  result.assignmentsCreated++
  console.log(`  created assignment: ${staffId} -> ${workzoneId}`)
}

async function main(): Promise<void> {
  console.log('Seeding demo environment...')

  for (const u of DEMO_USERS) {
    const contractorId = u.contractorName ? await getOrCreateContractor(u.contractorName) : null
    const userId = await getOrCreateUser(u.email, u.password, u.role, u.contractorName!)
    await ensureProfile(userId, u.role, contractorId)
  }

  for (const wz of DEMO_WORKZONES) {
    const contractorId = await getOrCreateContractor(wz.contractorName)
    await getOrCreateWorkzone(wz.name, contractorId, wz.target_lat, wz.target_lon, wz.target_depth_meters)
  }

  for (const wz of DEMO_WORKZONES) {
    const contractorId = contractorIdByName.get(wz.contractorName)!
    const workzoneId = workzoneIdByName.get(wz.name)!
    await getOrCreateWorkOrder(workzoneId, contractorId, 'pending')
    await getOrCreateWorkOrder(workzoneId, contractorId, 'in_progress')
  }

  const contractorA = contractorIdByName.get('Prana Tenant A')!
  const contractorB = contractorIdByName.get('Prana Tenant B')!

  const fieldA = (await admin.auth.admin.listUsers({ page: 1, perPage: 200 })).data?.users.find((u) => u.email === 'tenant-a-field-a@prana.test')?.id
  const fieldB = (await admin.auth.admin.listUsers({ page: 1, perPage: 200 })).data?.users.find((u) => u.email === 'tenant-a-field-b@prana.test')?.id
  const fieldBT = (await admin.auth.admin.listUsers({ page: 1, perPage: 200 })).data?.users.find((u) => u.email === 'tenant-b-field@prana.test')?.id

  for (const entrant of DEMO_ENTRANTS) {
    const contractorName = entrant.email === 'worker-a@prana.test' ? 'Prana Tenant A' :
                          entrant.email.includes('tenant-b') ? 'Prana Tenant B' : 'Prana Tenant A'
    const contractorId = contractorIdByName.get(contractorName)!
    await getOrCreateEntrant(contractorId, entrant.fullName, entrant.badgeNumber, entrant.role, entrant.email)
  }

  for (const device of DEMO_DEVICES) {
    const contractorId = contractorIdByName.get(device.contractorName)!
    const workzoneId = workzoneIdByName.get(device.workzoneName)!
    await getOrCreateDevice(device.serial_number, contractorId, workzoneId)
  }

  const wzA1 = workzoneIdByName.get('TenantA-Workzone-1')!
  const wzA2 = workzoneIdByName.get('TenantA-Workzone-2')!
  const wzB1 = workzoneIdByName.get('TenantB-Workzone-1')!
  const wzB2 = workzoneIdByName.get('TenantB-Workzone-2')!

  if (fieldA && wzA1) {
    await getOrCreateAssignment(wzA1, fieldA, contractorA)
  }
  if (fieldB && wzA2) {
    await getOrCreateAssignment(wzA2, fieldB, contractorA)
  }
  if (fieldBT && wzB1) {
    await getOrCreateAssignment(wzB1, fieldBT, contractorB)
  }

  console.log('\nDemo environment ready')
  console.log(`  existing records were reused where present`)
  console.log(`  missing records were created`)
  console.log(`  no database reset/deletion was performed`)
  console.log(`\nSummary:`)
  console.log(`  users:            ${result.usersCreated} created, ${result.usersReused} reused`)
  console.log(`  contractors:      ${result.contractorsCreated} created, ${result.contractorsReused} reused`)
  console.log(`  workzones:        ${result.workzonesCreated} created, ${result.workzonesReused} reused`)
  console.log(`  work orders:      ${result.workOrdersCreated} created, ${result.workOrdersReused} reused`)
  console.log(`  entrants:         ${result.entrantsCreated} created, ${result.entrantsReused} reused`)
  console.log(`  devices:          ${result.devicesCreated} created, ${result.devicesReused} reused`)
  console.log(`  assignments:      ${result.assignmentsCreated} created, ${result.assignmentsReused} reused`)
}

main().catch((err) => {
  console.error('seed-demo failed:', err)
  process.exit(1)
})

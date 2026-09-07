import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing env vars in .env.local')
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const USERS = [
  { email: 'tenant-a-admin@prana.test', password: 'Prana-TenantA-Admin-2026!', role: 'contractor_admin', contractorName: 'Prana Tenant A' },
  { email: 'tenant-a-field-a@prana.test', password: 'Prana-TenantA-FieldA-2026!', role: 'field_supervisor', contractorName: 'Prana Tenant A' },
  { email: 'tenant-a-field-b@prana.test', password: 'Prana-TenantA-FieldB-2026!', role: 'field_supervisor', contractorName: 'Prana Tenant A' },
  { email: 'tenant-b-field@prana.test', password: 'Prana-TenantB-Field-2026!', role: 'field_supervisor', contractorName: 'Prana Tenant B' },
  { email: 'govt-auditor@prana.test', password: 'Prana-Govt-Auditor-2026!', role: 'govt_auditor', contractorName: null },
]

const contractorIdByName = new Map<string, string>()

async function getOrCreateContractor(name: string): Promise<string> {
  if (contractorIdByName.has(name)) return contractorIdByName.get(name)!
  const { data: existing } = await admin.from('contractors').select('id').eq('name', name).maybeSingle()
  if (existing) {
    contractorIdByName.set(name, existing.id)
    return existing.id
  }
  const { data: created, error } = await admin.from('contractors').insert({ name }).select('id').single()
  if (error || !created) throw error ?? new Error('Failed to create contractor')
  contractorIdByName.set(name, created.id)
  return created.id
}

async function ensureUser(email: string, password: string): Promise<string> {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existing = list?.users.find((u) => u.email === email)
  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, { password })
    console.log(`  updated existing user: ${email}`)
    return existing.id
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error('Failed to create user')
  console.log(`  created user: ${email}`)
  return data.user.id
}

async function main() {
  for (const u of USERS) {
    const contractorId = u.contractorName ? await getOrCreateContractor(u.contractorName) : null
    const userId = await ensureUser(u.email, u.password)
    const { error } = await admin.from('profiles').upsert({
      id: userId,
      role: u.role,
      contractor_id: contractorId,
    })
    if (error) throw error
    console.log(`  upserted profile: ${u.email} role=${u.role}`)
  }

  const contractorA = contractorIdByName.get('Prana Tenant A')!
  const fieldA = (await admin.auth.admin.listUsers({ page: 1, perPage: 200 })).data?.users.find((u) => u.email === 'tenant-a-field-a@prana.test')?.id

  const { data: existingWz } = await admin
    .from('workzones')
    .select('id')
    .eq('name', 'TenantA-Workzone-1')
    .maybeSingle()

  let workzoneId = existingWz?.id
  if (!workzoneId) {
    const { data: created, error } = await admin
      .from('workzones')
      .insert({ name: 'TenantA-Workzone-1', contractor_id: contractorA, target_lat: 28.6139, target_lon: 77.2090, target_depth_meters: 3.0 })
      .select('id')
      .single()
    if (error || !created) throw error ?? new Error('Failed to create workzone')
    workzoneId = created.id
    console.log('  created workzone TenantA-Workzone-1')
  }

  if (fieldA && workzoneId) {
    const { error: assignErr } = await admin.from('workzone_assignments').upsert(
      { workzone_id: workzoneId, assigned_staff_id: fieldA, contractor_id: contractorA },
      { onConflict: 'workzone_id,assigned_staff_id' }
    )
    if (assignErr) throw assignErr
    console.log('  assigned tenant-a-field-a to TenantA-Workzone-1')
  }

  console.log('\nSeeded credentials (local Supabase only):')
  console.log('  Field supervisor A:  tenant-a-field-a@prana.test / Prana-TenantA-FieldA-2026!')
  console.log('  Field supervisor B:  tenant-a-field-b@prana.test / Prana-TenantA-FieldB-2026!')
  console.log('  Contractor admin A:  tenant-a-admin@prana.test   / Prana-TenantA-Admin-2026!')
  console.log('  Field supervisor T-B: tenant-b-field@prana.test  / Prana-TenantB-Field-2026!')
  console.log('  Govt auditor:        govt-auditor@prana.test    / Prana-Govt-Auditor-2026!')
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})

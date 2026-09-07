/**
 * Provisions a `devices` row and a `work_orders` row for a physical ESP32
 * probe, and prints the values needed to fill in firmware/esp32_prana.ino's
 * DEVICE_ID / WORK_ORDER_ID / DEVICE_SECRET / PROBE_LAT / PROBE_LON.
 *
 * Usage: npx tsx scripts/provision-device.ts [workzoneName] [serialNumber]
 * Defaults to the workzone created by seed-dev-users.ts.
 */
import { config } from 'dotenv'
import { randomBytes } from 'crypto'
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

const workzoneName = process.argv[2] ?? 'TenantA-Workzone-1'
const serialNumber = process.argv[3] ?? `PRH-${Date.now()}`

async function main() {
  const { data: workzone, error: wzError } = await admin
    .from('workzones')
    .select('id, contractor_id, target_lat, target_lon, target_depth_meters')
    .eq('name', workzoneName)
    .maybeSingle()

  if (wzError) throw wzError
  if (!workzone) throw new Error(`workzone "${workzoneName}" not found — create it first (e.g. via seed-dev-users.ts or the govt dashboard)`)
  if (!workzone.contractor_id) throw new Error(`workzone "${workzoneName}" has no contractor assigned yet`)

  const deviceSecret = randomBytes(32).toString('hex')

  const { data: device, error: deviceError } = await admin
    .from('devices')
    .insert({
      serial_number: serialNumber,
      secret_hash: deviceSecret,
      is_active: true,
      workzone_id: workzone.id,
      contractor_id: workzone.contractor_id,
    })
    .select('id')
    .single()

  if (deviceError || !device) throw deviceError ?? new Error('failed to create device')

  const { data: workOrder, error: woError } = await admin
    .from('work_orders')
    .insert({
      workzone_id: workzone.id,
      contractor_id: workzone.contractor_id,
      status: 'in_progress',
    })
    .select('id')
    .single()

  if (woError || !workOrder) throw woError ?? new Error('failed to create work order')

  console.log('\nProvisioned device + work order:\n')
  console.log(`  workzone:        ${workzoneName} (${workzone.id})`)
  console.log(`  device serial:   ${serialNumber}`)
  console.log()
  console.log('Paste these into firmware/esp32_prana.ino before flashing:\n')
  console.log(`#define DEVICE_ID "${device.id}"`)
  console.log(`#define WORK_ORDER_ID "${workOrder.id}"`)
  console.log(`#define DEVICE_SECRET "${deviceSecret}"`)
  console.log(`#define PROBE_LAT ${workzone.target_lat}`)
  console.log(`#define PROBE_LON ${workzone.target_lon}`)
  console.log(`\n(workzone target depth is ${workzone.target_depth_meters} m — the probe's depth_meters reading must land within 0.5m of this to be SAFE)`)
}

main().catch((err) => {
  console.error('provisioning failed:', err)
  process.exit(1)
})

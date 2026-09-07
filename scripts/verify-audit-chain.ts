import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  verifyAuditChain,
  type ScanLogRow,
  type VerificationResult,
} from '../src/lib/auditChainVerifier'

config({ path: '.env.local' })
config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set in your environment.')
}
if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in your environment.')
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

interface RawScanLogRow {
  id: string
  device_id: string
  work_order_id: string | null
  readings: unknown
  timestamp: string | null
  prev_hash: string | null
  row_hash: string | null
  message_id: string | null
  created_at: string
}

async function fetchAuditChain(supabase: SupabaseClient): Promise<ScanLogRow[]> {
  const { data, error } = await supabase
    .from('scan_logs')
    .select(
      'id, device_id, work_order_id, readings, timestamp, prev_hash, row_hash, message_id, created_at',
    )
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(100000)

  if (error) {
    throw new Error(`Failed to query scan_logs: ${error.message}`)
  }

  return (data ?? []).map((r: RawScanLogRow) => ({
    id: r.id,
    device_id: r.device_id,
    work_order_id: r.work_order_id,
    readings: r.readings as ScanLogRow['readings'],
    timestamp: r.timestamp,
    prev_hash: r.prev_hash,
    row_hash: r.row_hash,
    message_id: r.message_id,
    created_at: r.created_at,
  }))
}

function printResult(result: VerificationResult): void {
  const lines: string[] = []
  lines.push('AUDIT CHAIN VERIFICATION')
  lines.push('='.repeat(40))
  lines.push(`Status:       ${result.status}`)
  lines.push(`Records:      ${result.recordCount}`)
  lines.push(`Verified:     ${result.verifiedCount}`)
  lines.push(`Timestamp:    ${result.verifiedAt}`)
  lines.push(`Root valid:   ${result.rootValid}`)
  lines.push(`Linkage:      ${result.linkageValid}`)
  lines.push(`Hashes:       ${result.hashesValid}`)
  lines.push(`Message IDs:  ${result.messageIdsValid}`)
  lines.push(`Malformed:    ${result.malformedHashes}`)

  if (result.failures.length > 0) {
    lines.push('')
    lines.push(`Failures (${result.failures.length}):`)
    result.failures.forEach((f, i) => {
      lines.push(`  #${i + 1}: record=${f.recordId} (index=${f.index})`)
      lines.push(`      reason:  ${f.reason}`)
      if (f.field) lines.push(`      field:   ${f.field}`)
      if (f.expected) lines.push(`      expected: ${f.expected.slice(0, 32)}...`)
      if (f.actual) lines.push(`      actual:   ${f.actual.slice(0, 32)}...`)
    })
  }

  lines.push('')
  lines.push('Machine-readable:')
  lines.push(JSON.stringify(result))

  console.log(lines.join('\n'))
}

async function main(): Promise<void> {
  const rows = await fetchAuditChain(admin)
  const result = verifyAuditChain(rows)
  printResult(result)
  process.exitCode = result.valid ? 0 : 1
}

main().catch((err) => {
  console.error('Script error:', err)
  process.exitCode = 1
})

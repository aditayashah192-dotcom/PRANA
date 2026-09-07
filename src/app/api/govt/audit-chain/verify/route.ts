import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { JsonValue } from '@/lib/canonicalize'
import {
  verifyAuditChain,
  type ScanLogRow,
  type VerificationResult,
} from '@/lib/auditChainVerifier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function unauthorized(message: string): Response {
  return NextResponse.json({ error: message }, { status: 401 })
}

function forbidden(message: string): Response {
  return NextResponse.json({ error: message }, { status: 403 })
}

function serverError(message: string): Response {
  return NextResponse.json({ error: message }, { status: 500 })
}

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

export async function GET(request: NextRequest): Promise<Response> {
  const response = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (!user || userError) {
    return unauthorized('unauthenticated')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError || !profile) {
    return forbidden('profile_lookup_failed')
  }
  if (profile.role !== 'govt_auditor') {
    return forbidden('govt_auditor_role_required')
  }

  const { data, error } = await supabase
    .from('scan_logs')
    .select(
      'id, device_id, work_order_id, readings, timestamp, prev_hash, row_hash, message_id, created_at',
    )
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(100000)

  if (error) {
    console.error('audit_chain_query_failed:', error.message, error.code, error.details)
    return serverError('query_failed: ' + (error.message ?? ''))
  }

  const rows = (data ?? []) as RawScanLogRow[]

  const scanLogRows: ScanLogRow[] = rows.map((r) => ({
    id: r.id,
    device_id: r.device_id,
    work_order_id: r.work_order_id,
    readings: r.readings as JsonValue,
    timestamp: r.timestamp,
    prev_hash: r.prev_hash,
    row_hash: r.row_hash,
    message_id: r.message_id,
    created_at: r.created_at,
  }))

  const result: VerificationResult = verifyAuditChain(scanLogRows)

  return NextResponse.json(result)
}

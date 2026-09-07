import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function badRequest(message: string): Response {
  return NextResponse.json({ error: message }, { status: 400 })
}
function unauthorized(message: string): Response {
  return NextResponse.json({ error: message }, { status: 401 })
}
function forbidden(message: string): Response {
  return NextResponse.json({ error: message }, { status: 403 })
}
function serverError(message: string): Response {
  return NextResponse.json({ error: message }, { status: 500 })
}

function getServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('server not configured')
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

interface ProvisionBody {
  email: string
  password: string
  full_name?: string
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: ProvisionBody
  try {
    body = (await request.json()) as ProvisionBody
  } catch {
    return badRequest('invalid_json')
  }

  const { email, password, full_name } = body

  if (!email || !password) {
    return badRequest('email and password are required')
  }

  const response = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          for (const cookie of cookiesToSet) {
            response.cookies.set(cookie.name, cookie.value, cookie.options)
          }
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
    .select('role, contractor_id')
    .eq('id', user.id)
    .maybeSingle<{ role: string; contractor_id: string | null }>()

  if (profileError || !profile) {
    return forbidden('profile_lookup_failed')
  }
  if (profile.role !== 'contractor_admin') {
    return forbidden('contractor_admin_role_required')
  }
  if (!profile.contractor_id) {
    return forbidden('caller_contractor_id_is_null')
  }

  const admin = getServiceRoleClient()

  let authUserId: string
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) {
      return serverError('auth_user_creation_failed: ' + error.message)
    }
    if (!data.user) {
      return serverError('auth_user_creation_failed: no user returned')
    }
    authUserId = data.user.id
  } catch (err) {
    return serverError(err instanceof Error ? err.message : 'auth_user_creation_error')
  }

  try {
    const { error: rpcError } = await supabase.rpc('provision_field_supervisor', {
      p_user_id: authUserId,
      p_full_name: full_name ?? null,
    })

    if (rpcError) {
      return NextResponse.json(
        { error: 'provisioning_failed', detail: rpcError.message },
        { status: 400 }
      )
    }
  } catch (err) {
    return serverError(err instanceof Error ? err.message : 'rpc_error')
  }

  return NextResponse.json({
    ok: true,
    user_id: authUserId,
    role: 'field_supervisor',
    contractor_id: profile.contractor_id,
  })
}

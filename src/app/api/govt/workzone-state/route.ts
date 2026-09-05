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

function notFound(message: string): Response {
  return NextResponse.json({ error: message }, { status: 404 })
}

function serverError(message: string): Response {
  return NextResponse.json({ error: message }, { status: 500 })
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export async function GET(request: NextRequest): Promise<Response> {
  const workzoneId = request.nextUrl.searchParams.get('workzone_id')
  if (!isUuid(workzoneId)) {
    return badRequest('missing_or_invalid_workzone_id')
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

  const { data, error } = await supabase.rpc(
    'get_workzone_authoritative_state',
    { p_workzone_id: workzoneId },
  )

  if (error) {
    if (
      typeof error.message === 'string' &&
      (error.message.includes('workzone not found') ||
        error.message.includes('PGRST116'))
    ) {
      return notFound('workzone_not_found')
    }
    if (typeof error.message === 'string' && error.message.includes('unauthorized')) {
      return forbidden(error.message)
    }
    if (typeof error.message === 'string' && error.message.includes('unauthenticated')) {
      return unauthorized(error.message)
    }
    return serverError('rpc_failed')
  }

  return NextResponse.json(data)
}

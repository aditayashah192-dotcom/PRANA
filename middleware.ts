import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_ROUTES = {
  '/govt/': 'govt_auditor',
  '/contractor/': 'contractor_admin',
  '/field/': 'field_supervisor',
} as const

function getRequiredRole(pathname: string): string | null {
  for (const prefix of Object.keys(PROTECTED_ROUTES)) {
    if (pathname.startsWith(prefix)) {
      return PROTECTED_ROUTES[prefix as keyof typeof PROTECTED_ROUTES]
    }
  }
  return null
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const requiredRole = getRequiredRole(pathname)

  if (requiredRole === null) {
    return NextResponse.next()
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
    }
  )

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (!user || userError) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || profileError) {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  if (profile.role !== requiredRole) {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  return response
}

export const config = {
  matcher: ['/govt/:path*', '/contractor/:path*', '/field/:path*'],
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { User, Session } from '@supabase/supabase-js'

interface AuthSession {
  user: User | null
  session: Session | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
  signOut: () => Promise<void>
  supabase: ReturnType<typeof createBrowserClient>
}

export function useAuthSession(): AuthSession {
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  )

  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (cancelled) return

      switch (event) {
        case 'INITIAL_SESSION':
        case 'SIGNED_IN':
        case 'TOKEN_REFRESHED':
          setUser(newSession?.user ?? null)
          setSession(newSession ?? null)
          setError(null)
          setIsLoading(false)
          break
        case 'SIGNED_OUT':
          setUser(null)
          setSession(null)
          setError(null)
          setIsLoading(false)
          break
        default:
          break
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [supabase])

  const signOut = useCallback(async () => {
    setIsLoading(true)
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setError(signOutError.message)
    }
    setUser(null)
    setSession(null)
    setIsLoading(false)
  }, [supabase])

  return {
    user,
    session,
    isLoading,
    isAuthenticated: !!user,
    error,
    signOut,
    supabase,
  }
}

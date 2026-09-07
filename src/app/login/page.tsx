'use client'

import { useMemo, useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function LoginPage() {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [next, setNext] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setNext(params.get('next'))
  }, [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      let destination = '/field/scan'

      if (next && typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('://')) {
        destination = next
      } else {
        const userId = data.user?.id
        if (userId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .maybeSingle()

          if (profile?.role === 'govt_auditor') {
            destination = '/govt/dashboard'
          } else if (profile?.role === 'contractor_admin') {
            destination = '/contractor/dashboard'
          } else if (profile?.role === 'field_supervisor') {
            destination = '/field/scan'
          }
        }
      }

      window.location.href = destination
    }
  }

  return (
    <div className="min-h-screen bg-prana-canvas p-4 flex items-center justify-center">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex items-center gap-2 mb-3 px-1">
          <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full bg-amber-600" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            Project Prana
          </p>
        </div>

        <header className="border-2 border-zinc-200 rounded-md bg-slate-700 px-4 py-3 mb-4 shadow-panel-md">
          <h1 className="text-lg font-bold font-mono uppercase tracking-wider text-slate-100">
            Sign In
          </h1>
        </header>

        <form
          onSubmit={handleSubmit}
          className="border-2 border-zinc-200 rounded-md bg-white p-6 space-y-4 shadow-panel-lg"
        >
          {error && (
            <div className="border-2 border-red-600 rounded-md bg-red-50 p-3 shadow-panel">
              <p className="font-mono text-sm font-bold text-red-700">AUTHENTICATION FAILED</p>
              <p className="font-mono text-xs text-red-700 mt-1">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white focus:outline-none focus:border-slate-900 focus:shadow-panel-md"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border-2 border-zinc-200 rounded-md px-3 py-2 font-mono text-sm text-slate-900 bg-white focus:outline-none focus:border-slate-900 focus:shadow-panel-md"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full border-2 border-zinc-200 rounded-md px-3 py-3 font-mono text-sm font-bold uppercase tracking-wider text-slate-900 bg-white shadow-panel hover:bg-slate-50 hover:border-slate-900 hover:shadow-panel-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

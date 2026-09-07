import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

config({ path: '.env.local' })
config()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
if (!ANON_KEY) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

type Summary = { name: string; passed: boolean; detail: string }
const results: Summary[] = []
const note = (name: string, passed: boolean, detail: string): void => {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

class MemoryStorage {
  private store: Record<string, string> = {}
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null
  }
  setItem(key: string, value: string): void {
    this.store[key] = value
  }
  removeItem(key: string): void {
    delete this.store[key]
  }
}

type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function makeClient(storage: StorageLike): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

const EMAILS = {
  fieldA: 'auth-session-fielda@prana.test',
  fieldB: 'auth-session-fieldb@prana.test',
  govt: 'auth-session-govt@prana.test',
}
const PASSWORDS = {
  fieldA: 'Authtest-A-2026!',
  fieldB: 'Authtest-B-2026!',
  govt: 'Authtest-Govt-2026!',
}

async function resetUser(email: string): Promise<void> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) throw error
  for (const u of data.users ?? []) {
    if (u.email === email) {
      await admin.auth.admin.deleteUser(u.id)
    }
  }
}

async function ensureUser(
  email: string,
  password: string,
  role: string,
  contractorId: string | null
): Promise<string> {
  await resetUser(email)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error(`createUser failed for ${email}`)
  const id = data.user.id
  const { error: upsertError } = await admin.from('profiles').upsert({
    id,
    role,
    contractor_id: contractorId,
  })
  if (upsertError) throw upsertError
  return id
}

async function main(): Promise<void> {
  const cA = (
    await admin.from('contractors').insert({ name: 'auth-test-A' }).select('id').single()
  ).data!.id as string
  const cB = (
    await admin.from('contractors').insert({ name: 'auth-test-B' }).select('id').single()
  ).data!.id as string

  const fieldAId = await ensureUser(EMAILS.fieldA, PASSWORDS.fieldA, 'field_supervisor', cA)
  const fieldBId = await ensureUser(EMAILS.fieldB, PASSWORDS.fieldB, 'field_supervisor', cB)
  const govtId = await ensureUser(EMAILS.govt, PASSWORDS.govt, 'govt_auditor', null)

  if (fieldAId === fieldBId) throw new Error('field supervisors must be distinct users')

  const wA = (
    await admin
      .from('workzones')
      .insert({ name: 'auth-test-WZ-A', contractor_id: cA, target_lat: 1, target_lon: 1, target_depth_meters: 1 })
      .select('id')
      .single()
  ).data!.id as string
  const wB = (
    await admin
      .from('workzones')
      .insert({ name: 'auth-test-WZ-B', contractor_id: cB, target_lat: 2, target_lon: 2, target_depth_meters: 2 })
      .select('id')
      .single()
  ).data!.id as string

  await admin.from('workzone_assignments').insert({
    workzone_id: wA,
    assigned_staff_id: fieldAId,
    contractor_id: cA,
  })

  const sharedStorage = new MemoryStorage()

  try {
    // ------------------------------------------------------------------
    // 1. Session persists across a "refresh" (fresh client, shared storage).
    //    Client A signs in; Client B is created with the SAME storage,
    //    simulating a browser refresh / reopened tab. The session must be
    //    restored WITHOUT signing in again — the persistence contract the
    //    useAuthSession hook relies on (INITIAL_SESSION, no getUser() call).
    // ------------------------------------------------------------------
    const clientA = makeClient(sharedStorage)
    const { error: signInErr } = await clientA.auth.signInWithPassword({
      email: EMAILS.fieldA,
      password: PASSWORDS.fieldA,
    })
    if (signInErr) throw signInErr

    const clientB = makeClient(sharedStorage)
    const {
      data: { session: restoredSession },
      error: restoredErr,
    } = await clientB.auth.getSession()
    const sessionRestored = !restoredErr && !!restoredSession && restoredSession.user?.id === fieldAId
    note(
      'session_persisted_across_refresh',
      sessionRestored,
      sessionRestored
        ? `restored session for fieldA (access_token present=${!!restoredSession?.access_token})`
        : `restored session failed: ${restoredErr?.message ?? 'no session'}`
    )

    // ------------------------------------------------------------------
    // 2. The restored session is AUTHORIZED for protected (RLS) data
    //    without an extra getUser() network verification.
    // ------------------------------------------------------------------
    if (sessionRestored) {
      const { data: workzones, error: wErr } = await clientB
        .from('workzones')
        .select('id, contractor_id')
        .order('name')
      const seesOwnWorkzone =
        !wErr && (workzones ?? []).some((w) => w.id === wA && w.contractor_id === cA)
      const noCrossTenant = !wErr && !(workzones ?? []).some((w) => w.id === wB)
      note(
        'restored_session_authorized_for_own_tenant',
        seesOwnWorkzone && noCrossTenant,
        wErr
          ? `RLS query error: ${wErr.message}`
          : `fieldA sees own workzone ${seesOwnWorkzone ? 'yes' : 'no'}; sees tenant B ${!noCrossTenant ? 'yes' : 'no'}`
      )
    }

    // ------------------------------------------------------------------
    // 3. Anonymous (no session) cannot drive a privileged SECURITY DEFINER
    //    RPC: auth.uid() is null -> 'unauthenticated'.
    // ------------------------------------------------------------------
    const anonClient = makeClient(new MemoryStorage())
    const { error: anonRpcErr } = await anonClient.rpc('get_workzone_authoritative_state', {
      p_workzone_id: wA,
    })
    const anonBlocked = !!anonRpcErr
    note(
      'anonymous_cannot_access_privileged_rpc',
      anonBlocked,
      anonBlocked ? 'anonymous rejected' : 'anonymous unexpectedly succeeded'
    )

    // ------------------------------------------------------------------
    // 4. Role isolation: a restored field_supervisor cannot invoke a
    //    govt_auditor-only RPC (even though the session is valid/restored).
    // ------------------------------------------------------------------
    if (sessionRestored) {
      const { error: roleErr } = await clientB.rpc('get_workzone_authoritative_state', {
        p_workzone_id: wA,
      })
      const roleIsolated =
        !!roleErr && /govt_auditor role required/i.test(roleErr.message)
      note(
        'role_isolation_restored_session_cannot_escalate',
        roleIsolated,
        roleErr ? `rejected: ${roleErr.message}` : 'field supervisor unexpectedly invoked govt RPC'
      )
    }

    // ------------------------------------------------------------------
    // 5. Cross-tenant isolation: fieldB (tenant B) sees only tenant B
    //    workzones, never tenant A's.
    // ------------------------------------------------------------------
    const tenantBStorage = new MemoryStorage()
    const clientBStorage = makeClient(tenantBStorage)
    const { error: bSignInErr } = await clientBStorage.auth.signInWithPassword({
      email: EMAILS.fieldB,
      password: PASSWORDS.fieldB,
    })
    if (bSignInErr) throw bSignInErr
    const { data: bzWorkzones, error: bzErr } = await clientBStorage.from('workzones').select('id')
    const crossTenantBlocked =
      !bzErr && !(bzWorkzones ?? []).some((w) => w.id === wA)
    note(
      'cross_tenant_access_blocked',
      crossTenantBlocked,
      bzErr
        ? `query error: ${bzErr.message}`
        : `tenant B sees tenant A workzone: ${crossTenantBlocked ? 'no' : 'yes (BLOCKED!)'}`
    )

    // ------------------------------------------------------------------
    // 6. Sign-out is durable across clients sharing storage: clearing on
    //    Client B clears Client A's view of the session too (mirrors a
    //    sign-out that must invalidate the persisted session).
    // ------------------------------------------------------------------
    if (sessionRestored) {
      const { error: soErr } = await clientB.auth.signOut()
      const {
        data: { session: afterSession },
      } = await clientA.auth.getSession()
      const cleared = !soErr && !afterSession
      note(
        'signout_clears_persisted_session',
        cleared,
        cleared ? 'sign-out invalidated session across shared storage' : `sign-out did not clear session (${soErr?.message ?? 'session still present'})`
      )
    }
  } finally {
    await resetUser(EMAILS.fieldA)
    await resetUser(EMAILS.fieldB)
    await resetUser(EMAILS.govt)
    await admin.from('workzones').delete().in('id', [wA, wB])
    await admin.from('contractors').delete().in('id', [cA, cB])
  }

  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exitCode = 1
  }
}

void main().catch((err) => {
  console.error('test-auth-session crashed:', err)
  process.exitCode = 1
})

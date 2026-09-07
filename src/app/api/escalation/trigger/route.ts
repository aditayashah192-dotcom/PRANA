import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getTestNotificationProvider, type NotificationResult } from '@/lib/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TriggerPayload {
  workzone_id: string
  trigger_source: string
  previous_state?: string
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

export async function POST(request: NextRequest): Promise<Response> {
  let payload: TriggerPayload
  try {
    payload = (await request.json()) as TriggerPayload
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { workzone_id, trigger_source, previous_state } = payload

  if (!workzone_id || typeof workzone_id !== 'string') {
    return NextResponse.json({ error: 'workzone_id is required' }, { status: 400 })
  }
  if (!trigger_source || typeof trigger_source !== 'string') {
    return NextResponse.json({ error: 'trigger_source is required' }, { status: 400 })
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

  const role = profile.role
  if (role !== 'govt_auditor' && role !== 'field_supervisor' && role !== 'contractor_admin') {
    return forbidden('unauthorized role')
  }

  if (role !== 'govt_auditor') {
    const { data: workzone, error: wzError } = await supabase
      .from('workzones')
      .select('contractor_id')
      .eq('id', workzone_id)
      .maybeSingle<{ contractor_id: string | null }>()

    if (wzError || !workzone || workzone.contractor_id !== profile.contractor_id) {
      return forbidden('workzone does not belong to your contractor')
    }
  }

  let eventId: string | null = null
  try {
    const { data, error } = await supabase.rpc('create_escalation_event', {
      p_workzone_id: workzone_id,
      p_event_type: 'LOCKOUT_ENTERED',
      p_trigger_source: trigger_source,
      p_previous_state: previous_state ?? null,
    })

    if (error) {
      return NextResponse.json(
        { error: 'escalation_event_failed', detail: error.message },
        { status: 409 }
      )
    }

    eventId = data as string | null
    if (!eventId) {
      return serverError('escalation_event_missing')
    }
  } catch (err) {
    return serverError(err instanceof Error ? err.message : 'rpc_error')
  }

  const provider = getTestNotificationProvider()
  const channels: Array<{ channel: 'buzzer' | 'sms'; send: () => Promise<NotificationResult> }> = [
    { channel: 'buzzer', send: () => provider.sendBuzzerNotification(workzone_id) },
    { channel: 'sms', send: () => provider.sendSmsNotification(workzone_id, []) },
  ]

  const admin = getServiceRoleClient()
  const results: Array<{ channel: string; status: string; error?: string }> = []

  for (const { channel, send } of channels) {
    let delivery: NotificationResult
    try {
      delivery = await send()
    } catch (err) {
      delivery = {
        channel,
        status: 'failed',
        error: err instanceof Error ? err.message : 'unknown_error',
      }
    }

    results.push({
      channel: delivery.channel,
      status: delivery.status,
      error: delivery.error,
    })

    try {
      await admin
        .from('escalation_events')
        .update({
          notification_channel: delivery.channel,
          notification_status: delivery.status,
          notification_error: delivery.error ?? null,
        })
        .eq('id', eventId)
    } catch {
      console.error('failed to update escalation event delivery status')
    }
  }

  return NextResponse.json({
    ok: true,
    event_id: eventId,
    deliveries: results,
  })
}

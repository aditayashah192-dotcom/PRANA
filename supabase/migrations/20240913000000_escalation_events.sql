-- Phase 4 Segment 1: Escalation Events and Notification Contract
--
-- Adds:
--   * escalation_events table for append-only escalation audit trail.
--   * create_escalation_event RPC for user-facing escalation recording.
--   * record_notification_delivery RPC for updating delivery status.
--
-- SAFETY INVARIANTS:
--   * escalation_events is append-only (no UPDATE/DELETE policies for roles).
--   * Notification failure never permits entry; events are best-effort.
--   * No notification credentials in browser code.
--   * RLS enforces tenant isolation.

-- ============================================================================
-- 1. escalation_events
-- ============================================================================
create table public.escalation_events (
  id                  uuid primary key default gen_random_uuid(),
  workzone_id         uuid not null references public.workzones on delete cascade,
  event_type          text not null,
  aggregate_state     text not null,
  aggregate_reason    text not null,
  trigger_source      text not null,
  previous_state      text,
  notification_channel text,
  notification_status text not null default 'pending',
  notification_error  text,
  created_at          timestamp with time zone default now()
);

create index if not exists idx_escalation_events_workzone
  on public.escalation_events (workzone_id);
create index if not exists idx_escalation_events_status
  on public.escalation_events (workzone_id, notification_status);
create index if not exists idx_escalation_events_created
  on public.escalation_events (created_at);

alter table public.escalation_events enable row level security;
alter table public.escalation_events force row level security;

create policy "escalation_events_select" on public.escalation_events for select using (
  get_my_role() = 'govt_auditor'
  or exists (
    select 1 from public.workzones wz
    where wz.id = escalation_events.workzone_id
      and wz.contractor_id = get_my_contractor_id()
  )
  or exists (
    select 1 from public.workzone_assignments wa
    where wa.workzone_id = escalation_events.workzone_id
      and wa.assigned_staff_id = auth.uid()
      and wa.contractor_id = get_my_contractor_id()
  )
);

create policy "escalation_events_insert" on public.escalation_events for insert with check (
  get_my_role() in ('govt_auditor', 'field_supervisor', 'contractor_admin')
);

create policy "escalation_events_update" on public.escalation_events for update using (
  get_my_role() = 'govt_auditor'
) with check (
  get_my_role() = 'govt_auditor'
);

-- ============================================================================
-- 2. RPC: create_escalation_event
-- ============================================================================
create or replace function public.create_escalation_event(
  p_workzone_id      uuid,
  p_event_type       text,
  p_trigger_source   text,
  p_previous_state   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_auth_state jsonb;
  v_aggregate_state text;
  v_aggregate_reason text;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if p_workzone_id is null then
    raise exception 'workzone_id is required';
  end if;

  if p_event_type is null or trim(p_event_type) = '' then
    raise exception 'event_type is required';
  end if;

  if p_trigger_source is null or trim(p_trigger_source) = '' then
    raise exception 'trigger_source is required';
  end if;

  if get_my_role() not in ('govt_auditor', 'field_supervisor', 'contractor_admin') then
    raise exception 'unauthorized: govt_auditor, field_supervisor, or contractor_admin role required';
  end if;

  if get_my_role() <> 'govt_auditor' then
    if not exists (
      select 1 from public.workzones wz
      where wz.id = p_workzone_id
        and wz.contractor_id = get_my_contractor_id()
    ) then
      raise exception 'workzone does not belong to your contractor';
    end if;
  end if;

  if exists (
    select 1 from public.escalation_events
    where workzone_id = p_workzone_id
      and notification_status = 'pending'
      and created_at > now() - interval '1 hour'
  ) then
    raise exception 'escalation event already pending for this workzone';
  end if;

  v_auth_state := public.get_workzone_authoritative_state_for_view(p_workzone_id);
  v_aggregate_state := v_auth_state->>'aggregate_state';
  v_aggregate_reason := v_auth_state->>'aggregate_reason';

  insert into public.escalation_events (
    workzone_id, event_type, aggregate_state, aggregate_reason,
    trigger_source, previous_state, notification_status
  ) values (
    p_workzone_id, p_event_type, v_aggregate_state, v_aggregate_reason,
    p_trigger_source, p_previous_state, 'pending'
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

grant execute on function public.create_escalation_event(uuid, text, text, text) to authenticated;

-- ============================================================================
-- 3. RPC: record_notification_delivery
-- ============================================================================
create or replace function public.record_notification_delivery(
  p_event_id    uuid,
  p_channel     text,
  p_status      text,
  p_error       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'govt_auditor' then
    raise exception 'unauthorized: govt_auditor role required';
  end if;

  update public.escalation_events
     set notification_channel = p_channel,
         notification_status = p_status,
         notification_error = p_error
   where id = p_event_id;
end;
$$;

grant execute on function public.record_notification_delivery(uuid, text, text, text) to authenticated;

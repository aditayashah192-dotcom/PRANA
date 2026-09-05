-- Phase 3D: Government workzone contractor reassignment RPC and audit log.

-- ============================================================================
-- 1. Audit log for contractor reassignments
-- ============================================================================
create table public.contractor_reassignment_log (
  id                    uuid primary key default gen_random_uuid(),
  workzone_id           uuid not null references public.workzones on delete cascade,
  previous_contractor_id uuid not null references public.contractors on delete cascade,
  new_contractor_id     uuid not null references public.contractors on delete cascade,
  performed_by          uuid not null references auth.users on delete set null,
  reason                text not null,
  created_at            timestamp with time zone default now()
);

create index if not exists idx_contractor_reassignment_log_workzone
  on public.contractor_reassignment_log (workzone_id);

create index if not exists idx_contractor_reassignment_log_performed_by
  on public.contractor_reassignment_log (performed_by);

alter table public.contractor_reassignment_log enable row level security;
alter table public.contractor_reassignment_log force row level security;

create policy "contractor_reassignment_log_select" on public.contractor_reassignment_log for select using (
  get_my_role() = 'govt_auditor'
  or performed_by = auth.uid()
);

create policy "contractor_reassignment_log_insert" on public.contractor_reassignment_log for insert with check (
  get_my_role() = 'govt_auditor'
);

-- ============================================================================
-- 2. RPC: reassign_workzone_contractor
-- ============================================================================
create or replace function public.reassign_workzone_contractor(
  p_workzone_id uuid,
  p_new_contractor_id uuid,
  p_reassignment_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_contractor_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if get_my_role() <> 'govt_auditor' then
    raise exception 'unauthorized';
  end if;

  if p_reassignment_reason is null or trim(p_reassignment_reason) = '' then
    raise exception 'reassignment reason is required';
  end if;

   select contractor_id into v_previous_contractor_id
   from public.workzones
   where id = p_workzone_id
   for update;

  if not found then
    raise exception 'workzone not found';
  end if;

  if v_previous_contractor_id = p_new_contractor_id then
    raise exception 'workzone is already assigned to the requested contractor';
  end if;

  if not exists (select 1 from public.contractors where id = p_new_contractor_id) then
    raise exception 'contractor not found';
  end if;

  update public.workzones
  set contractor_id = p_new_contractor_id
  where id = p_workzone_id;

  insert into public.contractor_reassignment_log (
    workzone_id,
    previous_contractor_id,
    new_contractor_id,
    performed_by,
    reason
  ) values (
    p_workzone_id,
    v_previous_contractor_id,
    p_new_contractor_id,
    auth.uid(),
    p_reassignment_reason
  );
end;
$$;

grant execute on function public.reassign_workzone_contractor(uuid, uuid, text) to authenticated;

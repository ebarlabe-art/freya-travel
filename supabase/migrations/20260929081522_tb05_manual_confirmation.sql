
create table if not exists public.trip_component_confirmation_operations (
  actor_id uuid not null references auth.users(id),
  operation_id uuid not null,
  handoff_id uuid not null,
  trip_id uuid not null,
  component_id text not null,
  source_kind text not null check (source_kind in ('accommodation','flight','activity')),
  source_id uuid not null,
  confirmation_source text not null default 'user_manual'
    check (confirmation_source = 'user_manual'),
  evidence_document_id uuid,
  evidence_role text,
  request jsonb not null check (octet_length(request::text) <= 32768),
  confirmed_at timestamptz not null default statement_timestamp(),
  primary key (actor_id, operation_id),
  foreign key (handoff_id, trip_id)
    references public.trip_proposal_handoffs(id, trip_id),
  foreign key (trip_id, evidence_document_id)
    references public.travel_documents(trip_id, id),
  check (
    (evidence_document_id is null and evidence_role is null)
    or
    (evidence_document_id is not null and evidence_role is not null)
  )
);

create index if not exists trip_component_confirmation_trip_idx
  on public.trip_component_confirmation_operations(trip_id, component_id, confirmed_at desc);

alter table public.trip_component_confirmation_operations enable row level security;

revoke all on public.trip_component_confirmation_operations
  from public, anon, authenticated, service_role;

grant select on public.trip_component_confirmation_operations to authenticated;

drop policy if exists "trip members can view TB confirmations"
on public.trip_component_confirmation_operations;

create policy "trip members can view TB confirmations"
on public.trip_component_confirmation_operations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and public.is_trip_member(trip_id)
);

drop trigger if exists trip_component_confirmation_immutable
on public.trip_component_confirmation_operations;

create trigger trip_component_confirmation_immutable
before update or delete on public.trip_component_confirmation_operations
for each row execute function proposal_private.handoff_immutable();

create or replace function public.confirm_trip_component_v1(
  p_trip_id uuid,
  p_component_id text,
  p_expected_updated_at timestamptz,
  p_operation_id uuid,
  p_expected_evidence_document_id uuid default null,
  p_evidence_document_id uuid default null,
  p_evidence_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  h public.trip_proposal_handoffs;
  l public.trip_proposal_component_links;
  receipt public.trip_component_confirmation_operations;
  req jsonb;
  source_kind text;
  source_id uuid;
  allowed_role text;
  current_status text;
  current_updated_at timestamptz;
  current_evidence uuid;
  result_updated_at timestamptz;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if p_trip_id is null
     or p_component_id is null
     or p_component_id !~ '^[a-z][a-z0-9_-]{0,63}$'
     or p_expected_updated_at is null
     or p_operation_id is null then
    raise exception 'Invalid confirmation request' using errcode='22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'Trip unavailable' using errcode='42501';
  end if;

  req := jsonb_build_object(
    'trip_id', p_trip_id,
    'component_id', p_component_id,
    'expected_updated_at', p_expected_updated_at,
    'expected_evidence_document_id', p_expected_evidence_document_id,
    'evidence_document_id', p_evidence_document_id,
    'evidence_role', p_evidence_role
  );

  perform pg_advisory_xact_lock(
    hashtextextended('tb05-confirm:' || actor::text || ':' || p_operation_id::text, 0)
  );

  select *
  into receipt
  from public.trip_component_confirmation_operations
  where actor_id = actor
    and operation_id = p_operation_id;

  if found then
    if receipt.request is distinct from req then
      raise exception 'Operation reused with different request' using errcode='22023';
    end if;

    return jsonb_build_object(
      'operation_id', receipt.operation_id,
      'trip_id', receipt.trip_id,
      'component_id', receipt.component_id,
      'source_kind', receipt.source_kind,
      'source_id', receipt.source_id,
      'confirmation_source', receipt.confirmation_source,
      'evidence_document_id', receipt.evidence_document_id,
      'evidence_role', receipt.evidence_role,
      'confirmed_at', receipt.confirmed_at,
      'replayed', true
    );
  end if;

  select h0.*
    into h
  from public.trip_proposal_handoffs h0
  where h0.trip_id = p_trip_id
  limit 1;

  if h.id is null then
    raise exception 'TB handoff unavailable' using errcode='P0002';
  end if;

  select l0.*
    into l
  from public.trip_proposal_component_links l0
  where l0.handoff_id = h.id
    and l0.trip_id = p_trip_id
    and l0.component_id = p_component_id
  limit 1;

  if l.component_id is null then
    raise exception 'TB component unavailable' using errcode='P0002';
  end if;

  if l.accommodation_id is not null then
    source_kind := 'accommodation';
    source_id := l.accommodation_id;
    allowed_role := 'voucher';

    if p_evidence_role is not null and p_evidence_role <> allowed_role then
      raise exception 'Invalid evidence role for component' using errcode='22023';
    end if;

    select a.reservation_status, a.updated_at
      into current_status, current_updated_at
    from public.trip_accommodations a
    where a.trip_id = p_trip_id and a.id = source_id
    for update;

    select d.document_id
      into current_evidence
    from public.trip_accommodation_documents d
    where d.trip_id = p_trip_id
      and d.accommodation_id = source_id
      and d.document_role = allowed_role
    for update;

  elsif l.flight_id is not null then
    source_kind := 'flight';
    source_id := l.flight_id;
    allowed_role := 'booking';

    if p_evidence_role is not null and p_evidence_role <> allowed_role then
      raise exception 'Invalid evidence role for component' using errcode='22023';
    end if;

    select f.flight_status, f.updated_at
      into current_status, current_updated_at
    from public.trip_flights f
    where f.trip_id = p_trip_id and f.id = source_id
    for update;

    select d.document_id
      into current_evidence
    from public.trip_flight_documents d
    where d.trip_id = p_trip_id
      and d.flight_id = source_id
      and d.document_role = allowed_role
    for update;

  else
    source_kind := 'activity';
    source_id := l.activity_id;
    allowed_role := coalesce(p_evidence_role, 'booking');

    if allowed_role not in ('booking','ticket') then
      raise exception 'Invalid evidence role for component' using errcode='22023';
    end if;

    select a.reservation_status, a.updated_at
      into current_status, current_updated_at
    from public.trip_activities a
    where a.trip_id = p_trip_id and a.id = source_id
    for update;

    select d.document_id
      into current_evidence
    from public.trip_activity_documents d
    where d.trip_id = p_trip_id
      and d.activity_id = source_id
      and d.document_role = allowed_role
    for update;
  end if;

  if current_updated_at is null then
    raise exception 'Operational source unavailable' using errcode='P0002';
  end if;

  if current_updated_at is distinct from p_expected_updated_at then
    raise exception 'Component version conflict' using errcode='40001';
  end if;

  if current_status = 'cancelled' then
    raise exception 'Cancelled component cannot be confirmed' using errcode='22023';
  end if;

  if current_evidence is distinct from p_expected_evidence_document_id then
    raise exception 'Evidence version conflict' using errcode='40001';
  end if;

  if p_evidence_document_id is not null then
    if p_evidence_role is null then
      raise exception 'Evidence role required' using errcode='22023';
    end if;

    if not exists (
      select 1
      from public.travel_documents d
      where d.trip_id = p_trip_id
        and d.id = p_evidence_document_id
    ) then
      raise exception 'Evidence document must belong to this trip' using errcode='23503';
    end if;
  elsif p_evidence_role is not null then
    raise exception 'Evidence role requires a document' using errcode='22023';
  end if;

  if source_kind = 'accommodation' then
    if current_status <> 'confirmed' then
      update public.trip_accommodations
      set reservation_status = 'confirmed'
      where trip_id = p_trip_id and id = source_id
      returning updated_at into result_updated_at;
    else
      result_updated_at := current_updated_at;
    end if;

    if p_evidence_document_id is not null then
      insert into public.trip_accommodation_documents(
        trip_id, accommodation_id, document_id, document_role, created_by
      ) values (
        p_trip_id, source_id, p_evidence_document_id, allowed_role, actor
      )
      on conflict (trip_id, accommodation_id, document_role)
      do update set
        document_id = excluded.document_id,
        created_by = excluded.created_by,
        created_at = statement_timestamp();
    end if;

  elsif source_kind = 'flight' then
    if current_status <> 'confirmed' then
      update public.trip_flights
      set flight_status = 'confirmed'
      where trip_id = p_trip_id and id = source_id
      returning updated_at into result_updated_at;
    else
      result_updated_at := current_updated_at;
    end if;

    if p_evidence_document_id is not null then
      insert into public.trip_flight_documents(
        trip_id, flight_id, document_id, document_role, created_by
      ) values (
        p_trip_id, source_id, p_evidence_document_id, allowed_role, actor
      )
      on conflict (trip_id, flight_id, document_role)
      do update set
        document_id = excluded.document_id,
        created_by = excluded.created_by,
        created_at = statement_timestamp();
    end if;

  else
    if current_status <> 'confirmed' then
      update public.trip_activities
      set reservation_status = 'confirmed'
      where trip_id = p_trip_id and id = source_id
      returning updated_at into result_updated_at;
    else
      result_updated_at := current_updated_at;
    end if;

    if p_evidence_document_id is not null then
      insert into public.trip_activity_documents(
        trip_id, activity_id, document_id, document_role, created_by
      ) values (
        p_trip_id, source_id, p_evidence_document_id, allowed_role, actor
      )
      on conflict (trip_id, activity_id, document_role)
      do update set
        document_id = excluded.document_id,
        created_by = excluded.created_by,
        created_at = statement_timestamp();
    end if;
  end if;

  insert into public.trip_component_confirmation_operations(
    actor_id, operation_id, handoff_id, trip_id, component_id,
    source_kind, source_id, confirmation_source,
    evidence_document_id, evidence_role, request
  ) values (
    actor, p_operation_id, h.id, p_trip_id, p_component_id,
    source_kind, source_id, 'user_manual',
    p_evidence_document_id,
    p_evidence_role,
    req
  )
  returning * into receipt;

  return jsonb_build_object(
    'operation_id', receipt.operation_id,
    'trip_id', receipt.trip_id,
    'component_id', receipt.component_id,
    'source_kind', receipt.source_kind,
    'source_id', receipt.source_id,
    'confirmation_source', receipt.confirmation_source,
    'evidence_document_id', receipt.evidence_document_id,
    'evidence_role', receipt.evidence_role,
    'confirmed_at', receipt.confirmed_at,
    'source_updated_at', result_updated_at,
    'replayed', false
  );
end;
$$;

revoke all on function public.confirm_trip_component_v1(
  uuid, text, timestamptz, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.confirm_trip_component_v1(
  uuid, text, timestamptz, uuid, uuid, uuid, text
) to authenticated;

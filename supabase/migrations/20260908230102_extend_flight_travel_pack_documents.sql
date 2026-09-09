alter table public.trip_flight_documents
  drop constraint trip_flight_documents_pkey;

alter table public.trip_flight_documents
  drop constraint trip_flight_documents_role_check;

alter table public.trip_flight_documents
  add constraint trip_flight_documents_role_check
  check (document_role in ('booking', 'boarding_pass', 'baggage_tag'));

alter table public.trip_flight_documents
  add constraint trip_flight_documents_pkey
  primary key (trip_id, flight_id, document_role, document_id);

create unique index trip_flight_documents_one_booking_idx
  on public.trip_flight_documents (trip_id, flight_id)
  where document_role = 'booking';

create or replace function public.sync_trip_flight_document(
  p_trip_id uuid,
  p_flight_id uuid,
  p_document_role text,
  p_expected_flight_updated_at timestamptz,
  p_expected_document_id uuid,
  p_new_document_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_flight_updated_at timestamptz;
  v_current_document_id uuid;
  v_current_count integer;
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio' using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_flight_id is null
     or p_document_role is null
     or p_expected_flight_updated_at is null then
    raise exception 'Falten dades per sincronitzar el document del vol'
      using errcode = '22004';
  end if;

  if p_document_role not in ('booking', 'boarding_pass', 'baggage_tag') then
    raise exception 'Rol documental de vol no valid' using errcode = '22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge' using errcode = '42501';
  end if;

  select flight.updated_at
  into v_flight_updated_at
  from public.trip_flights as flight
  where flight.trip_id = p_trip_id
    and flight.id = p_flight_id
  for update;

  if not found then
    raise exception 'El vol ja no existeix' using errcode = 'P0002';
  end if;

  if v_flight_updated_at is distinct from p_expected_flight_updated_at then
    raise exception 'Conflicte de versio del vol' using errcode = '40001';
  end if;

  perform 1
  from public.trip_flight_documents as relation
  where relation.trip_id = p_trip_id
    and relation.flight_id = p_flight_id
    and relation.document_role = p_document_role
  for update;

  select count(*), (array_agg(relation.document_id order by relation.document_id))[1]
  into v_current_count, v_current_document_id
  from public.trip_flight_documents as relation
  where relation.trip_id = p_trip_id
    and relation.flight_id = p_flight_id
    and relation.document_role = p_document_role;

  if v_current_count > 1 then
    raise exception 'Aquest rol documental conte diversos documents; actualitza Freya'
      using errcode = '40001';
  end if;

  if v_current_document_id is distinct from p_expected_document_id then
    raise exception 'Conflicte de document del vol' using errcode = '40001';
  end if;

  if p_new_document_id is not null
     and not exists (
       select 1
       from public.travel_documents as document
       where document.trip_id = p_trip_id
         and document.id = p_new_document_id
     ) then
    raise exception 'El document no pertany al viatge actiu' using errcode = '23503';
  end if;

  if p_new_document_id is distinct from v_current_document_id then
    delete from public.trip_flight_documents
    where trip_id = p_trip_id
      and flight_id = p_flight_id
      and document_role = p_document_role;

    if p_new_document_id is not null then
      insert into public.trip_flight_documents (
        trip_id, flight_id, document_id, document_role, created_by
      ) values (
        p_trip_id, p_flight_id, p_new_document_id, p_document_role, v_user_id
      );
    end if;
  end if;

  return p_new_document_id;
end;
$$;

revoke all on function public.sync_trip_flight_document(
  uuid, uuid, text, timestamptz, uuid, uuid
) from public, anon;

grant execute on function public.sync_trip_flight_document(
  uuid, uuid, text, timestamptz, uuid, uuid
) to authenticated;

create function public.sync_trip_flight_documents(
  p_trip_id uuid,
  p_flight_id uuid,
  p_document_role text,
  p_expected_flight_updated_at timestamptz,
  p_expected_document_ids uuid[],
  p_new_document_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_flight_updated_at timestamptz;
  v_expected uuid[];
  v_requested uuid[];
  v_current uuid[];
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio' using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_flight_id is null
     or p_document_role is null
     or p_expected_flight_updated_at is null then
    raise exception 'Falten dades per sincronitzar els documents del vol'
      using errcode = '22004';
  end if;

  if p_document_role not in ('boarding_pass', 'baggage_tag') then
    raise exception 'Aquest rol documental no admet multiples documents'
      using errcode = '22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge' using errcode = '42501';
  end if;

  select coalesce(array_agg(value order by value), array[]::uuid[])
  into v_expected
  from (select distinct unnest(coalesce(p_expected_document_ids, array[]::uuid[])) as value) valueset;

  select coalesce(array_agg(value order by value), array[]::uuid[])
  into v_requested
  from (select distinct unnest(coalesce(p_new_document_ids, array[]::uuid[])) as value) valueset;

  select flight.updated_at
  into v_flight_updated_at
  from public.trip_flights as flight
  where flight.trip_id = p_trip_id
    and flight.id = p_flight_id
  for update;

  if not found then
    raise exception 'El vol ja no existeix' using errcode = 'P0002';
  end if;

  if v_flight_updated_at is distinct from p_expected_flight_updated_at then
    raise exception 'Conflicte de versio del vol' using errcode = '40001';
  end if;

  perform 1
  from public.trip_flight_documents as relation
  where relation.trip_id = p_trip_id
    and relation.flight_id = p_flight_id
    and relation.document_role = p_document_role
  for update;

  select coalesce(array_agg(relation.document_id order by relation.document_id), array[]::uuid[])
  into v_current
  from public.trip_flight_documents as relation
  where relation.trip_id = p_trip_id
    and relation.flight_id = p_flight_id
    and relation.document_role = p_document_role;

  if v_current is distinct from v_expected then
    raise exception 'Conflicte de documents del vol' using errcode = '40001';
  end if;

  if exists (
    select 1
    from unnest(v_requested) as requested(document_id)
    where not exists (
      select 1
      from public.travel_documents as document
      where document.trip_id = p_trip_id
        and document.id = requested.document_id
    )
  ) then
    raise exception 'Algun document no pertany al viatge actiu' using errcode = '23503';
  end if;

  delete from public.trip_flight_documents
  where trip_id = p_trip_id
    and flight_id = p_flight_id
    and document_role = p_document_role
    and not (document_id = any(v_requested));

  insert into public.trip_flight_documents (
    trip_id, flight_id, document_id, document_role, created_by
  )
  select p_trip_id, p_flight_id, requested.document_id, p_document_role, v_user_id
  from unnest(v_requested) as requested(document_id)
  on conflict (trip_id, flight_id, document_role, document_id) do nothing;

  return v_requested;
end;
$$;

revoke all on function public.sync_trip_flight_documents(
  uuid, uuid, text, timestamptz, uuid[], uuid[]
) from public, anon;

grant execute on function public.sync_trip_flight_documents(
  uuid, uuid, text, timestamptz, uuid[], uuid[]
) to authenticated;

create function public.set_trip_flight_document_link(
  p_trip_id uuid,
  p_flight_id uuid,
  p_document_role text,
  p_document_id uuid,
  p_expected_flight_updated_at timestamptz,
  p_linked boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_flight_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio' using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_flight_id is null
     or p_document_role is null
     or p_document_id is null
     or p_expected_flight_updated_at is null
     or p_linked is null then
    raise exception 'Falten dades per modificar el document del vol'
      using errcode = '22004';
  end if;

  if p_document_role not in ('boarding_pass', 'baggage_tag') then
    raise exception 'Aquest rol documental no admet aquesta operacio'
      using errcode = '22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge' using errcode = '42501';
  end if;

  select flight.updated_at
  into v_flight_updated_at
  from public.trip_flights as flight
  where flight.trip_id = p_trip_id
    and flight.id = p_flight_id
  for update;

  if not found then
    raise exception 'El vol ja no existeix' using errcode = 'P0002';
  end if;

  if v_flight_updated_at is distinct from p_expected_flight_updated_at then
    raise exception 'Conflicte de versio del vol' using errcode = '40001';
  end if;

  if p_linked then
    if not exists (
      select 1
      from public.travel_documents as document
      where document.trip_id = p_trip_id
        and document.id = p_document_id
    ) then
      raise exception 'El document no pertany al viatge actiu' using errcode = '23503';
    end if;

    insert into public.trip_flight_documents (
      trip_id, flight_id, document_id, document_role, created_by
    ) values (
      p_trip_id, p_flight_id, p_document_id, p_document_role, v_user_id
    )
    on conflict (trip_id, flight_id, document_role, document_id) do nothing;
  else
    delete from public.trip_flight_documents
    where trip_id = p_trip_id
      and flight_id = p_flight_id
      and document_role = p_document_role
      and document_id = p_document_id;
  end if;

  return p_linked;
end;
$$;

revoke all on function public.set_trip_flight_document_link(
  uuid, uuid, text, uuid, timestamptz, boolean
) from public, anon;

grant execute on function public.set_trip_flight_document_link(
  uuid, uuid, text, uuid, timestamptz, boolean
) to authenticated;

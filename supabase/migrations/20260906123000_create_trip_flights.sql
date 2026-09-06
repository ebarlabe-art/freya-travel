create table public.trip_flights (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,

  airline text,
  flight_number text,

  departure_airport_code text,
  departure_airport_name text,
  departure_city text,
  departure_at timestamptz,
  departure_time_zone text,

  arrival_airport_code text,
  arrival_airport_name text,
  arrival_city text,
  arrival_at timestamptz,
  arrival_time_zone text,

  booking_reference text,
  departure_terminal text,
  arrival_terminal text,
  seat text,
  baggage text,
  flight_status text not null default 'planning',
  notes text,

  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trip_flights_trip_id_id_key
    unique (trip_id, id),

  constraint trip_flights_airline_check
    check (
      airline is null
      or (airline = btrim(airline) and char_length(airline) between 1 and 200)
    ),

  constraint trip_flights_flight_number_check
    check (
      flight_number is null
      or (flight_number = btrim(flight_number) and char_length(flight_number) between 1 and 30)
    ),

  constraint trip_flights_departure_airport_code_check
    check (
      departure_airport_code is null
      or (
        departure_airport_code = upper(btrim(departure_airport_code))
        and departure_airport_code ~ '^[A-Z0-9]{3,4}$'
      )
    ),

  constraint trip_flights_arrival_airport_code_check
    check (
      arrival_airport_code is null
      or (
        arrival_airport_code = upper(btrim(arrival_airport_code))
        and arrival_airport_code ~ '^[A-Z0-9]{3,4}$'
      )
    ),

  constraint trip_flights_departure_airport_name_check
    check (
      departure_airport_name is null
      or (
        departure_airport_name = btrim(departure_airport_name)
        and char_length(departure_airport_name) between 1 and 200
      )
    ),

  constraint trip_flights_arrival_airport_name_check
    check (
      arrival_airport_name is null
      or (
        arrival_airport_name = btrim(arrival_airport_name)
        and char_length(arrival_airport_name) between 1 and 200
      )
    ),

  constraint trip_flights_departure_city_check
    check (
      departure_city is null
      or (
        departure_city = btrim(departure_city)
        and char_length(departure_city) between 1 and 200
      )
    ),

  constraint trip_flights_arrival_city_check
    check (
      arrival_city is null
      or (
        arrival_city = btrim(arrival_city)
        and char_length(arrival_city) between 1 and 200
      )
    ),

  constraint trip_flights_departure_time_zone_check
    check (
      departure_time_zone is null
      or (
        departure_time_zone = btrim(departure_time_zone)
        and char_length(departure_time_zone) between 1 and 100
      )
    ),

  constraint trip_flights_departure_time_zone_required_check
    check (
      departure_at is null
      or departure_time_zone is not null
    ),

  constraint trip_flights_arrival_time_zone_check
    check (
      arrival_time_zone is null
      or (
        arrival_time_zone = btrim(arrival_time_zone)
        and char_length(arrival_time_zone) between 1 and 100
      )
    ),

  constraint trip_flights_arrival_time_zone_required_check
    check (
      arrival_at is null
      or arrival_time_zone is not null
    ),

  constraint trip_flights_dates_check
    check (
      departure_at is null
      or arrival_at is null
      or arrival_at > departure_at
    ),

  constraint trip_flights_booking_reference_check
    check (
      booking_reference is null
      or (
        booking_reference = btrim(booking_reference)
        and char_length(booking_reference) between 1 and 200
      )
    ),

  constraint trip_flights_departure_terminal_check
    check (
      departure_terminal is null
      or (
        departure_terminal = btrim(departure_terminal)
        and char_length(departure_terminal) between 1 and 50
      )
    ),

  constraint trip_flights_arrival_terminal_check
    check (
      arrival_terminal is null
      or (
        arrival_terminal = btrim(arrival_terminal)
        and char_length(arrival_terminal) between 1 and 50
      )
    ),

  constraint trip_flights_seat_check
    check (
      seat is null
      or (
        seat = btrim(seat)
        and char_length(seat) between 1 and 100
      )
    ),

  constraint trip_flights_baggage_check
    check (
      baggage is null
      or (
        baggage = btrim(baggage)
        and char_length(baggage) between 1 and 500
      )
    ),

  constraint trip_flights_status_check
    check (flight_status in ('planning', 'confirmed', 'cancelled')),

  constraint trip_flights_notes_check
    check (
      notes is null
      or (
        notes = btrim(notes)
        and char_length(notes) between 1 and 4000
      )
    )
);

create index trip_flights_chronology_idx
  on public.trip_flights (
    trip_id,
    departure_at asc nulls last,
    created_at,
    id
  );

create index trip_flights_created_by_idx
  on public.trip_flights (created_by)
  where created_by is not null;

create index trip_flights_updated_by_idx
  on public.trip_flights (updated_by)
  where updated_by is not null;

create function public.enforce_trip_flight_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if new.departure_time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.departure_time_zone
     ) then
    raise exception 'La zona horaria de sortida no es valida'
      using errcode = '22023';
  end if;

  if new.arrival_time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.arrival_time_zone
     ) then
    raise exception 'La zona horaria d arribada no es valida'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.updated_by := null;
    new.created_at := statement_timestamp();
    new.updated_at := new.created_at;
  else
    if new.id is distinct from old.id
       or new.trip_id is distinct from old.trip_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'No es poden modificar els camps immutables del vol'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_trip_flight_integrity()
  from public, anon, authenticated;

create trigger enforce_trip_flight_integrity_trigger
before insert or update on public.trip_flights
for each row execute function public.enforce_trip_flight_integrity();

create table public.trip_flight_documents (
  trip_id uuid not null,
  flight_id uuid not null,
  document_id uuid not null,
  document_role text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (trip_id, flight_id, document_role),

  constraint trip_flight_documents_role_check
    check (document_role in ('booking', 'boarding_pass')),

  constraint trip_flight_documents_flight_fkey
    foreign key (trip_id, flight_id)
    references public.trip_flights(trip_id, id)
    on delete cascade,

  constraint trip_flight_documents_document_fkey
    foreign key (trip_id, document_id)
    references public.travel_documents(trip_id, id)
    on delete cascade
);

create index trip_flight_documents_document_idx
  on public.trip_flight_documents (trip_id, document_id);

create index trip_flight_documents_created_by_idx
  on public.trip_flight_documents (created_by)
  where created_by is not null;

create function public.enforce_trip_flight_document_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := statement_timestamp();
    return new;
  end if;

  if new.trip_id is distinct from old.trip_id
     or new.flight_id is distinct from old.flight_id
     or new.document_role is distinct from old.document_role then
    raise exception 'No es pot canviar l ambit de l associacio documental'
      using errcode = '42501';
  end if;

  new.created_by := auth.uid();
  new.created_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.enforce_trip_flight_document_integrity()
  from public, anon, authenticated;

create trigger enforce_trip_flight_document_integrity_trigger
before insert or update on public.trip_flight_documents
for each row execute function public.enforce_trip_flight_document_integrity();

create function public.sync_trip_flight_document(
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
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_flight_id is null
     or p_document_role is null
     or p_expected_flight_updated_at is null then
    raise exception 'Falten dades per sincronitzar el document del vol'
      using errcode = '22004';
  end if;

  if p_document_role not in ('booking', 'boarding_pass') then
    raise exception 'Rol documental de vol no valid'
      using errcode = '22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge'
      using errcode = '42501';
  end if;

  select flight.updated_at
  into v_flight_updated_at
  from public.trip_flights as flight
  where flight.trip_id = p_trip_id
    and flight.id = p_flight_id
  for update;

  if not found then
    raise exception 'El vol ja no existeix'
      using errcode = 'P0002';
  end if;

  if v_flight_updated_at is distinct from p_expected_flight_updated_at then
    raise exception 'Conflicte de versio del vol'
      using errcode = '40001';
  end if;

  v_current_document_id := null;

  select relation.document_id
  into v_current_document_id
  from public.trip_flight_documents as relation
  where relation.trip_id = p_trip_id
    and relation.flight_id = p_flight_id
    and relation.document_role = p_document_role
  for update;

  if v_current_document_id is distinct from p_expected_document_id then
    raise exception 'Conflicte de document del vol'
      using errcode = '40001';
  end if;

  if p_new_document_id is not null
     and not exists (
       select 1
       from public.travel_documents as document
       where document.trip_id = p_trip_id
         and document.id = p_new_document_id
     ) then
    raise exception 'El document no pertany al viatge actiu'
      using errcode = '23503';
  end if;

  if p_new_document_id is null then
    delete from public.trip_flight_documents
    where trip_id = p_trip_id
      and flight_id = p_flight_id
      and document_role = p_document_role;

  elsif p_new_document_id is distinct from v_current_document_id then
    insert into public.trip_flight_documents (
      trip_id,
      flight_id,
      document_id,
      document_role,
      created_by
    ) values (
      p_trip_id,
      p_flight_id,
      p_new_document_id,
      p_document_role,
      v_user_id
    )
    on conflict (trip_id, flight_id, document_role)
    do update set
      document_id = excluded.document_id,
      created_by = excluded.created_by;
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

alter table public.trip_flights enable row level security;
alter table public.trip_flight_documents enable row level security;

revoke all on table public.trip_flights
  from public, anon, authenticated;

revoke all on table public.trip_flight_documents
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.trip_flights
  to authenticated;

grant select
  on table public.trip_flight_documents
  to authenticated;

create policy "members can view flights"
on public.trip_flights
for select
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can add flights"
on public.trip_flights
for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can update flights"
on public.trip_flights
for update
to authenticated
using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id));

create policy "members can delete flights"
on public.trip_flights
for delete
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can view flight documents"
on public.trip_flight_documents
for select
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can add flight documents"
on public.trip_flight_documents
for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can update flight documents"
on public.trip_flight_documents
for update
to authenticated
using (public.is_trip_member(trip_id))
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can delete flight documents"
on public.trip_flight_documents
for delete
to authenticated
using (public.is_trip_member(trip_id));

alter table public.trip_flights replica identity full;
alter table public.trip_flight_documents replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_flights'
  ) then
    alter publication supabase_realtime
      add table public.trip_flights;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_flight_documents'
  ) then
    alter publication supabase_realtime
      add table public.trip_flight_documents;
  end if;
end
$$;

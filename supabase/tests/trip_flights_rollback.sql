begin;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.trip_flights'::regclass
      and relreplident = 'f'
  ) then
    raise exception 'trip_flights replica identity is not FULL';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.trip_flight_documents'::regclass
      and relreplident = 'f'
  ) then
    raise exception 'trip_flight_documents replica identity is not FULL';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('trip_flights','trip_flight_documents')
  ) <> 2 then
    raise exception 'flight tables are not both in supabase_realtime';
  end if;

  if has_table_privilege('authenticated','public.trip_flight_documents','INSERT')
     or has_table_privilege('authenticated','public.trip_flight_documents','UPDATE')
     or has_table_privilege('authenticated','public.trip_flight_documents','DELETE') then
    raise exception 'authenticated must not have direct DML on trip_flight_documents';
  end if;

  if not has_table_privilege('authenticated','public.trip_flight_documents','SELECT') then
    raise exception 'authenticated needs SELECT on trip_flight_documents';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.sync_trip_flight_document(uuid,uuid,text,timestamptz,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated lacks EXECUTE on flight document RPC';
  end if;
end;
$$;

create function pg_temp.expect_failure(
  label text,
  command text,
  expected_state text default null
)
returns void
language plpgsql
security invoker
as $$
begin
  begin
    execute command;
  exception when others then
    if expected_state is not null and sqlstate <> expected_state then
      raise exception '% failed with SQLSTATE %, expected %',
        label, sqlstate, expected_state;
    end if;
    return;
  end;

  raise exception '% unexpectedly succeeded', label;
end;
$$;

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
values
(
  '00000000-0000-0000-0000-000000000000',
  '44000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','flight-owner@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
),
(
  '00000000-0000-0000-0000-000000000000',
  '44000000-0000-4000-8000-000000000002',
  'authenticated','authenticated','flight-member@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
),
(
  '00000000-0000-0000-0000-000000000000',
  '44000000-0000-4000-8000-000000000003',
  'authenticated','authenticated','flight-outsider@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
);

insert into public.trips (
  id,name,owner_id,start_date,end_date,time_zone
)
values
(
  '44000000-0000-4000-8000-000000000101',
  'Flight trip A',
  '44000000-0000-4000-8000-000000000001',
  '2027-08-01','2027-08-20','Europe/Madrid'
),
(
  '44000000-0000-4000-8000-000000000102',
  'Flight trip B',
  '44000000-0000-4000-8000-000000000001',
  '2027-09-01','2027-09-20','Asia/Colombo'
);

insert into public.trip_members (trip_id,user_id)
values
(
  '44000000-0000-4000-8000-000000000101',
  '44000000-0000-4000-8000-000000000001'
),
(
  '44000000-0000-4000-8000-000000000101',
  '44000000-0000-4000-8000-000000000002'
),
(
  '44000000-0000-4000-8000-000000000102',
  '44000000-0000-4000-8000-000000000001'
);

insert into public.travel_documents (
  id,trip_id,title,category,file_name,file_path,mime_type,created_by
)
values
(
  '44000000-0000-4000-8000-000000000201',
  '44000000-0000-4000-8000-000000000101',
  'Reserva vol A','Vol','booking-a.pdf',
  '44000000-0000-4000-8000-000000000101/booking-a.pdf',
  'application/pdf',
  '44000000-0000-4000-8000-000000000001'
),
(
  '44000000-0000-4000-8000-000000000202',
  '44000000-0000-4000-8000-000000000101',
  'Boarding pass A','Vol','boarding-a.pdf',
  '44000000-0000-4000-8000-000000000101/boarding-a.pdf',
  'application/pdf',
  '44000000-0000-4000-8000-000000000001'
),
(
  '44000000-0000-4000-8000-000000000203',
  '44000000-0000-4000-8000-000000000102',
  'Reserva altre viatge','Vol','booking-b.pdf',
  '44000000-0000-4000-8000-000000000102/booking-b.pdf',
  'application/pdf',
  '44000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '44000000-0000-4000-8000-000000000001',
  true
);

-- Vol confirmat normal.
insert into public.trip_flights (
  id,trip_id,airline,flight_number,
  departure_airport_code,departure_city,departure_at,departure_time_zone,
  arrival_airport_code,arrival_city,arrival_at,arrival_time_zone,
  booking_reference,flight_status,created_by
)
values (
  '44000000-0000-4000-8000-000000000301',
  '44000000-0000-4000-8000-000000000101',
  'Vueling','VY3500',
  'BCN','Barcelona','2027-08-09 18:40+02','Europe/Madrid',
  'IBZ','Eivissa','2027-08-09 19:45+02','Europe/Madrid',
  'ABC123','confirmed',
  '44000000-0000-4000-8000-000000000001'
);

-- Planificació sense hores ni zones horàries.
insert into public.trip_flights (
  id,trip_id,airline,flight_status,created_by
)
values (
  '44000000-0000-4000-8000-000000000302',
  '44000000-0000-4000-8000-000000000101',
  'Qatar Airways','planning',
  '44000000-0000-4000-8000-000000000001'
);

do $$
begin
  if (
    select count(*)
    from public.trip_flights
    where trip_id = '44000000-0000-4000-8000-000000000101'
  ) <> 2 then
    raise exception 'member cannot see expected flights';
  end if;

  if not exists (
    select 1
    from public.trip_flights
    where id = '44000000-0000-4000-8000-000000000302'
      and departure_at is null
      and departure_time_zone is null
      and arrival_at is null
      and arrival_time_zone is null
  ) then
    raise exception 'planning flight without dates/timezones failed';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'departure timezone required',
  $sql$
    insert into public.trip_flights (
      trip_id,departure_at,arrival_at,arrival_time_zone,created_by
    ) values (
      '44000000-0000-4000-8000-000000000101',
      '2027-08-10 10:00+02',
      '2027-08-10 12:00+02',
      'Europe/Madrid',
      '44000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'invalid IANA timezone',
  $sql$
    insert into public.trip_flights (
      trip_id,departure_at,departure_time_zone,
      arrival_at,arrival_time_zone,created_by
    ) values (
      '44000000-0000-4000-8000-000000000101',
      '2027-08-10 10:00+02','Mars/Olympus',
      '2027-08-10 12:00+02','Europe/Madrid',
      '44000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '22023'
);

select pg_temp.expect_failure(
  'arrival before departure',
  $sql$
    insert into public.trip_flights (
      trip_id,departure_at,departure_time_zone,
      arrival_at,arrival_time_zone,created_by
    ) values (
      '44000000-0000-4000-8000-000000000101',
      '2027-08-10 12:00+02','Europe/Madrid',
      '2027-08-10 10:00+02','Europe/Madrid',
      '44000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'creator spoof',
  $sql$
    insert into public.trip_flights (
      trip_id,airline,created_by
    ) values (
      '44000000-0000-4000-8000-000000000101',
      'Spoof Air',
      '44000000-0000-4000-8000-000000000003'
    )
  $sql$
);

-- DML directe a relacions documentals ha d'estar bloquejat.
select pg_temp.expect_failure(
  'direct document relation insert',
  $sql$
    insert into public.trip_flight_documents (
      trip_id,flight_id,document_id,document_role,created_by
    ) values (
      '44000000-0000-4000-8000-000000000101',
      '44000000-0000-4000-8000-000000000301',
      '44000000-0000-4000-8000-000000000201',
      'booking',
      '44000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '42501'
);

-- Associar reserva mitjançant RPC.
select public.sync_trip_flight_document(
  '44000000-0000-4000-8000-000000000101',
  '44000000-0000-4000-8000-000000000301',
  'booking',
  (
    select updated_at
    from public.trip_flights
    where id = '44000000-0000-4000-8000-000000000301'
  ),
  null,
  '44000000-0000-4000-8000-000000000201'
);

-- Associar boarding pass independentment.
select public.sync_trip_flight_document(
  '44000000-0000-4000-8000-000000000101',
  '44000000-0000-4000-8000-000000000301',
  'boarding_pass',
  (
    select updated_at
    from public.trip_flights
    where id = '44000000-0000-4000-8000-000000000301'
  ),
  null,
  '44000000-0000-4000-8000-000000000202'
);

do $$
begin
  if (
    select count(*)
    from public.trip_flight_documents
    where trip_id = '44000000-0000-4000-8000-000000000101'
      and flight_id = '44000000-0000-4000-8000-000000000301'
  ) <> 2 then
    raise exception 'booking and boarding pass were not associated independently';
  end if;
end;
$$;


-- El mateix document pot servir en dos rols diferents.
select public.sync_trip_flight_document(
  '44000000-0000-4000-8000-000000000101',
  '44000000-0000-4000-8000-000000000301',
  'boarding_pass',
  (
    select updated_at
    from public.trip_flights
    where id = '44000000-0000-4000-8000-000000000301'
  ),
  '44000000-0000-4000-8000-000000000202',
  '44000000-0000-4000-8000-000000000201'
);

do $$
begin
  if (
    select count(*)
    from public.trip_flight_documents
    where trip_id = '44000000-0000-4000-8000-000000000101'
      and flight_id = '44000000-0000-4000-8000-000000000301'
      and document_id = '44000000-0000-4000-8000-000000000201'
  ) <> 2 then
    raise exception 'same document cannot be reused across booking and boarding_pass';
  end if;
end;
$$;

-- Document d'un altre viatge.
select pg_temp.expect_failure(
  'cross-trip document',
  $sql$
    select public.sync_trip_flight_document(
      '44000000-0000-4000-8000-000000000101',
      '44000000-0000-4000-8000-000000000301',
      'booking',
      (
        select updated_at
        from public.trip_flights
        where id = '44000000-0000-4000-8000-000000000301'
      ),
      '44000000-0000-4000-8000-000000000201',
      '44000000-0000-4000-8000-000000000203'
    )
  $sql$,
  '23503'
);

-- Baseline documental obsoleta.
select pg_temp.expect_failure(
  'stale document CAS',
  $sql$
    select public.sync_trip_flight_document(
      '44000000-0000-4000-8000-000000000101',
      '44000000-0000-4000-8000-000000000301',
      'booking',
      (
        select updated_at
        from public.trip_flights
        where id = '44000000-0000-4000-8000-000000000301'
      ),
      null,
      '44000000-0000-4000-8000-000000000202'
    )
  $sql$,
  '40001'
);

-- Canvi del vol invalida una versió antiga.
do $$
declare
  old_updated_at timestamptz;
begin
  select updated_at into old_updated_at
  from public.trip_flights
  where id = '44000000-0000-4000-8000-000000000301';

  perform pg_sleep(0.01);

  update public.trip_flights
  set seat = '12A'
  where id = '44000000-0000-4000-8000-000000000301';

  begin
    perform public.sync_trip_flight_document(
      '44000000-0000-4000-8000-000000000101',
      '44000000-0000-4000-8000-000000000301',
      'booking',
      old_updated_at,
      '44000000-0000-4000-8000-000000000201',
      null
    );

    raise exception 'stale flight version unexpectedly succeeded';
  exception
    when serialization_failure then
      null;
  end;
end;
$$;

-- Un no membre no pot veure ni modificar.
select set_config(
  'request.jwt.claim.sub',
  '44000000-0000-4000-8000-000000000003',
  true
);

do $$
begin
  if exists (
    select 1
    from public.trip_flights
    where trip_id = '44000000-0000-4000-8000-000000000101'
  ) then
    raise exception 'outsider can read flights';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'outsider RPC',
  $sql$
    select public.sync_trip_flight_document(
      '44000000-0000-4000-8000-000000000101',
      '44000000-0000-4000-8000-000000000301',
      'booking',
      statement_timestamp(),
      null,
      null
    )
  $sql$,
  '42501'
);

rollback;

begin;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.sync_trip_flight_documents(uuid,uuid,text,timestamptz,uuid[],uuid[])',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.set_trip_flight_document_link(uuid,uuid,text,uuid,timestamptz,boolean)',
    'EXECUTE'
  ) then
    raise exception 'authenticated lacks flight travel pack RPC access';
  end if;

  if has_function_privilege(
    'anon',
    'public.sync_trip_flight_documents(uuid,uuid,text,timestamptz,uuid[],uuid[])',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.set_trip_flight_document_link(uuid,uuid,text,uuid,timestamptz,boolean)',
    'EXECUTE'
  ) then
    raise exception 'anon unexpectedly has flight travel pack RPC access';
  end if;

  if has_table_privilege('authenticated','public.trip_flight_documents','INSERT')
     or has_table_privilege('authenticated','public.trip_flight_documents','UPDATE')
     or has_table_privilege('authenticated','public.trip_flight_documents','DELETE') then
    raise exception 'flight document relations must remain RPC-only';
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
      raise exception '% failed with SQLSTATE %, expected %', label, sqlstate, expected_state;
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
('00000000-0000-0000-0000-000000000000','47000000-0000-4000-8000-000000000001','authenticated','authenticated','pack-owner@example.invalid','',statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()),
('00000000-0000-0000-0000-000000000000','47000000-0000-4000-8000-000000000002','authenticated','authenticated','pack-member@example.invalid','',statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()),
('00000000-0000-0000-0000-000000000000','47000000-0000-4000-8000-000000000003','authenticated','authenticated','pack-outsider@example.invalid','',statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp());

insert into public.trips (id,name,owner_id,start_date,end_date,time_zone)
values
('47000000-0000-4000-8000-000000000101','Pack trip A','47000000-0000-4000-8000-000000000001','2027-08-01','2027-08-20','Europe/Madrid'),
('47000000-0000-4000-8000-000000000102','Pack trip B','47000000-0000-4000-8000-000000000001','2027-09-01','2027-09-20','Europe/Madrid');

insert into public.trip_members (trip_id,user_id)
values
('47000000-0000-4000-8000-000000000101','47000000-0000-4000-8000-000000000001'),
('47000000-0000-4000-8000-000000000101','47000000-0000-4000-8000-000000000002'),
('47000000-0000-4000-8000-000000000102','47000000-0000-4000-8000-000000000001');

insert into public.travel_documents (
  id,trip_id,title,category,file_name,file_path,mime_type,created_by
)
values
('47000000-0000-4000-8000-000000000201','47000000-0000-4000-8000-000000000101','Boarding A','Vol','a.pdf','47000000-0000-4000-8000-000000000101/a.pdf','application/pdf','47000000-0000-4000-8000-000000000001'),
('47000000-0000-4000-8000-000000000202','47000000-0000-4000-8000-000000000101','Boarding B','Vol','b.pdf','47000000-0000-4000-8000-000000000101/b.pdf','application/pdf','47000000-0000-4000-8000-000000000001'),
('47000000-0000-4000-8000-000000000203','47000000-0000-4000-8000-000000000101','Bag A','baggage_tag','bag-a.jpg','47000000-0000-4000-8000-000000000101/bag-a.jpg','image/jpeg','47000000-0000-4000-8000-000000000001'),
('47000000-0000-4000-8000-000000000204','47000000-0000-4000-8000-000000000102','Wrong trip','Vol','wrong.pdf','47000000-0000-4000-8000-000000000102/wrong.pdf','application/pdf','47000000-0000-4000-8000-000000000001'),
('47000000-0000-4000-8000-000000000205','47000000-0000-4000-8000-000000000101','Boarding C','Vol','c.pdf','47000000-0000-4000-8000-000000000101/c.pdf','application/pdf','47000000-0000-4000-8000-000000000001'),
('47000000-0000-4000-8000-000000000206','47000000-0000-4000-8000-000000000101','Bag B','baggage_tag','bag-b.jpg','47000000-0000-4000-8000-000000000101/bag-b.jpg','image/jpeg','47000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','47000000-0000-4000-8000-000000000001',true);

insert into public.trip_flights (
  id,trip_id,airline,flight_number,flight_status,created_by
)
values (
  '47000000-0000-4000-8000-000000000301',
  '47000000-0000-4000-8000-000000000101',
  'Test Air','TA100','confirmed','47000000-0000-4000-8000-000000000001'
);

select public.sync_trip_flight_documents(
  '47000000-0000-4000-8000-000000000101',
  '47000000-0000-4000-8000-000000000301',
  'boarding_pass',
  (select updated_at from public.trip_flights where id='47000000-0000-4000-8000-000000000301'),
  array[]::uuid[],
  array['47000000-0000-4000-8000-000000000201','47000000-0000-4000-8000-000000000202','47000000-0000-4000-8000-000000000205']::uuid[]
);

select public.set_trip_flight_document_link(
  '47000000-0000-4000-8000-000000000101',
  '47000000-0000-4000-8000-000000000301',
  'baggage_tag',
  '47000000-0000-4000-8000-000000000203',
  (select updated_at from public.trip_flights where id='47000000-0000-4000-8000-000000000301'),
  true
);

select public.set_trip_flight_document_link(
  '47000000-0000-4000-8000-000000000101',
  '47000000-0000-4000-8000-000000000301',
  'baggage_tag',
  '47000000-0000-4000-8000-000000000206',
  (select updated_at from public.trip_flights where id='47000000-0000-4000-8000-000000000301'),
  true
);

-- Repetir una associació individual és idempotent.
select public.set_trip_flight_document_link(
  '47000000-0000-4000-8000-000000000101',
  '47000000-0000-4000-8000-000000000301',
  'baggage_tag',
  '47000000-0000-4000-8000-000000000203',
  (select updated_at from public.trip_flights where id='47000000-0000-4000-8000-000000000301'),
  true
);

do $$
begin
  if (select count(*) from public.trip_flight_documents where flight_id='47000000-0000-4000-8000-000000000301' and document_role='boarding_pass') <> 3 then
    raise exception 'multiple boarding passes were not preserved';
  end if;
  if (select count(*) from public.trip_flight_documents where flight_id='47000000-0000-4000-8000-000000000301' and document_role='baggage_tag') <> 2 then
    raise exception 'idempotent baggage association duplicated a row';
  end if;
end;
$$;

-- Treure una etiqueta concreta no afecta les targetes d'embarcament.
select public.set_trip_flight_document_link(
  '47000000-0000-4000-8000-000000000101',
  '47000000-0000-4000-8000-000000000301',
  'baggage_tag',
  '47000000-0000-4000-8000-000000000203',
  (select updated_at from public.trip_flights where id='47000000-0000-4000-8000-000000000301'),
  false
);

do $$
begin
  if (select count(*) from public.trip_flight_documents where flight_id='47000000-0000-4000-8000-000000000301' and document_role='baggage_tag') <> 1 then
    raise exception 'baggage unlink changed more than one association';
  end if;
  if (select count(*) from public.trip_flight_documents where flight_id='47000000-0000-4000-8000-000000000301' and document_role='boarding_pass') <> 3 then
    raise exception 'baggage unlink changed boarding passes';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'stale association set',
  $sql$
    select public.sync_trip_flight_documents(
      '47000000-0000-4000-8000-000000000101',
      '47000000-0000-4000-8000-000000000301',
      'boarding_pass',
      (select updated_at from public.trip_flights where id='47000000-0000-4000-8000-000000000301'),
      array[]::uuid[],
      array['47000000-0000-4000-8000-000000000201']::uuid[]
    )
  $sql$,
  '40001'
);

select pg_temp.expect_failure(
  'cross-trip document',
  $sql$
    select public.set_trip_flight_document_link(
      '47000000-0000-4000-8000-000000000101',
      '47000000-0000-4000-8000-000000000301',
      'boarding_pass',
      '47000000-0000-4000-8000-000000000204',
      (select updated_at from public.trip_flights where id='47000000-0000-4000-8000-000000000301'),
      true
    )
  $sql$,
  '23503'
);

select set_config('request.jwt.claim.sub','47000000-0000-4000-8000-000000000003',true);

select pg_temp.expect_failure(
  'outsider multiple sync',
  $sql$
    select public.sync_trip_flight_documents(
      '47000000-0000-4000-8000-000000000101',
      '47000000-0000-4000-8000-000000000301',
      'boarding_pass',statement_timestamp(),array[]::uuid[],array[]::uuid[]
    )
  $sql$,
  '42501'
);

rollback;

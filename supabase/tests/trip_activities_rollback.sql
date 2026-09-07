begin;

do $$
declare
  expected_columns text[] := array[
    'id','trip_id','title','activity_type','start_at','end_at','time_zone',
    'venue_name','address','city','latitude','longitude','reservation_status',
    'booking_reference','provider','contact_phone','contact_email','website_url',
    'people_count','amount','currency','notes','created_by','updated_by',
    'created_at','updated_at'
  ];
begin
  if to_regclass('public.trip_activities') is null
     or to_regclass('public.trip_activity_documents') is null then
    raise exception 'activity tables are missing';
  end if;

  if exists (
    select unnest(expected_columns)
    except
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_activities'
  ) or exists (
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_activities'
    except
    select unnest(expected_columns)
  ) then
    raise exception 'trip_activities column set has drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.trip_activities'::regclass
      and conname = 'trip_activities_trip_id_id_key'
      and contype = 'u'
  ) then
    raise exception 'trip_activities lacks composite trip/id uniqueness';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.trip_activity_documents'::regclass
      and conname = 'trip_activity_documents_activity_fkey'
      and contype = 'f'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.trip_activity_documents'::regclass
      and conname = 'trip_activity_documents_document_fkey'
      and contype = 'f'
  ) then
    raise exception 'activity document composite foreign keys are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'trip_activities'
      and indexname = 'trip_activities_chronology_idx'
      and indexdef like '%(trip_id, start_at, created_at, id)%'
  ) then
    raise exception 'activity chronology index is missing or malformed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'trip_activity_documents'
      and indexname = 'trip_activity_documents_document_idx'
  ) then
    raise exception 'activity document lookup index is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.trip_activities'::regclass
      and relrowsecurity
      and relreplident = 'f'
  ) then
    raise exception 'trip_activities RLS or replica identity FULL is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.trip_activity_documents'::regclass
      and relrowsecurity
      and relreplident = 'f'
  ) then
    raise exception 'trip_activity_documents RLS or replica identity FULL is missing';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('trip_activities','trip_activity_documents')
  ) <> 2 then
    raise exception 'activity tables are not both in supabase_realtime';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'trip_activities'
  ) <> 4 then
    raise exception 'trip_activities must have four member policies';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'trip_activity_documents'
  ) <> 4 then
    raise exception 'trip_activity_documents must have four member policies';
  end if;

  if has_table_privilege('anon','public.trip_activities','SELECT')
     or has_table_privilege('anon','public.trip_activities','INSERT')
     or has_table_privilege('anon','public.trip_activity_documents','SELECT') then
    raise exception 'anon unexpectedly has activity table privileges';
  end if;

  if not has_table_privilege('authenticated','public.trip_activities','SELECT')
     or not has_table_privilege('authenticated','public.trip_activities','INSERT')
     or not has_table_privilege('authenticated','public.trip_activities','UPDATE')
     or not has_table_privilege('authenticated','public.trip_activities','DELETE') then
    raise exception 'authenticated lacks activity CRUD privileges';
  end if;

  if not has_table_privilege('authenticated','public.trip_activity_documents','SELECT')
     or has_table_privilege('authenticated','public.trip_activity_documents','INSERT')
     or has_table_privilege('authenticated','public.trip_activity_documents','UPDATE')
     or has_table_privilege('authenticated','public.trip_activity_documents','DELETE') then
    raise exception 'activity document direct privileges are incorrect';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.sync_trip_activity_document(uuid,uuid,text,timestamptz,uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.sync_trip_activity_document(uuid,uuid,text,timestamptz,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'activity document RPC EXECUTE grants are incorrect';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'sync_trip_activity_document'
      and procedure.prosecdef
      and exists (
        select 1
        from unnest(procedure.proconfig) as setting
        where setting = 'search_path=""'
      )
  ) then
    raise exception 'activity document RPC security definer/search_path is incorrect';
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
  '45000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','activity-owner@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
),
(
  '00000000-0000-0000-0000-000000000000',
  '45000000-0000-4000-8000-000000000002',
  'authenticated','authenticated','activity-member@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
),
(
  '00000000-0000-0000-0000-000000000000',
  '45000000-0000-4000-8000-000000000003',
  'authenticated','authenticated','activity-outsider@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
);

insert into public.trips (
  id,name,owner_id,start_date,end_date,time_zone
)
values
(
  '45000000-0000-4000-8000-000000000101',
  'Activity trip A',
  '45000000-0000-4000-8000-000000000001',
  '2027-08-01','2027-08-20','Europe/Madrid'
),
(
  '45000000-0000-4000-8000-000000000102',
  'Activity trip B',
  '45000000-0000-4000-8000-000000000001',
  '2027-09-01','2027-09-20','Asia/Colombo'
);

insert into public.trip_members (trip_id,user_id)
values
(
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000001'
),
(
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000002'
),
(
  '45000000-0000-4000-8000-000000000102',
  '45000000-0000-4000-8000-000000000001'
);

insert into public.travel_documents (
  id,trip_id,title,category,file_name,file_path,mime_type,created_by
)
values
(
  '45000000-0000-4000-8000-000000000201',
  '45000000-0000-4000-8000-000000000101',
  'Reserva activitat A','Reserva','booking-a.pdf',
  '45000000-0000-4000-8000-000000000101/booking-a.pdf',
  'application/pdf',
  '45000000-0000-4000-8000-000000000001'
),
(
  '45000000-0000-4000-8000-000000000202',
  '45000000-0000-4000-8000-000000000101',
  'Entrada activitat A','Entrada','ticket-a.pdf',
  '45000000-0000-4000-8000-000000000101/ticket-a.pdf',
  'application/pdf',
  '45000000-0000-4000-8000-000000000001'
),
(
  '45000000-0000-4000-8000-000000000203',
  '45000000-0000-4000-8000-000000000102',
  'Reserva altre viatge','Reserva','booking-b.pdf',
  '45000000-0000-4000-8000-000000000102/booking-b.pdf',
  'application/pdf',
  '45000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '45000000-0000-4000-8000-000000000001',
  true
);

-- Reserva confirmada amb horari, ubicació i logística completes.
insert into public.trip_activities (
  id,trip_id,title,activity_type,start_at,end_at,time_zone,
  venue_name,address,city,latitude,longitude,reservation_status,
  booking_reference,provider,contact_phone,contact_email,website_url,
  people_count,amount,currency,notes,created_by
)
values (
  '45000000-0000-4000-8000-000000000301',
  '45000000-0000-4000-8000-000000000101',
  'Sopar reservat','restaurant',
  '2027-08-09 20:30+02','2027-08-09 22:30+02','Europe/Madrid',
  'Restaurant de prova','Carrer de prova 1','Ciutat de prova',
  38.980000,1.430000,'confirmed','ABC123','Operador de prova',
  '+34 600 000 000','reserves@example.invalid','https://example.invalid/reserva',
  4,180.00,'EUR','Taula exterior',
  '45000000-0000-4000-8000-000000000001'
);

-- Planificació vàlida sense data, hora ni zona horària exactes.
insert into public.trip_activities (
  id,trip_id,title,activity_type,reservation_status,created_by,
  updated_by,created_at,updated_at
)
values (
  '45000000-0000-4000-8000-000000000302',
  '45000000-0000-4000-8000-000000000101',
  'Dia per planificar','excursion','planning',
  '45000000-0000-4000-8000-000000000001',
  '45000000-0000-4000-8000-000000000003',
  '2000-01-01 00:00+00','2000-01-01 00:00+00'
);

-- Una activitat del segon viatge permet provar l'aïllament RLS real.
insert into public.trip_activities (
  id,trip_id,title,activity_type,reservation_status,created_by
)
values (
  '45000000-0000-4000-8000-000000000304',
  '45000000-0000-4000-8000-000000000102',
  'Activitat viatge B','experience','reserved',
  '45000000-0000-4000-8000-000000000001'
);

-- Tots els tipus mínims i un tipus futur extensible són acceptats.
do $$
declare
  tested_type text;
begin
  foreach tested_type in array array[
    'restaurant','attraction','tour','excursion','museum','show',
    'experience','beach','transport_activity','other','wellness_activity'
  ] loop
    insert into public.trip_activities (
      trip_id,title,activity_type,created_by
    ) values (
      '45000000-0000-4000-8000-000000000101',
      'Type test ' || tested_type,
      tested_type,
      '45000000-0000-4000-8000-000000000001'
    );
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from public.trip_activities
    where id = '45000000-0000-4000-8000-000000000302'
      and start_at is null
      and end_at is null
      and time_zone is null
      and updated_by is null
      and created_at = updated_at
      and created_at <> '2000-01-01 00:00+00'::timestamptz
  ) then
    raise exception 'planning activity or insert audit normalization failed';
  end if;

  if (
    select count(*)
    from public.trip_activities
    where trip_id = '45000000-0000-4000-8000-000000000101'
  ) <> 13 then
    raise exception 'owner cannot see all expected activities';
  end if;

  if (
    select created_by
    from public.trip_activities
    where id = '45000000-0000-4000-8000-000000000301'
  ) <> '45000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'owner creator audit was not preserved';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'datetime timezone required',
  $sql$
    insert into public.trip_activities (
      trip_id,title,start_at,created_by
    ) values (
      '45000000-0000-4000-8000-000000000101',
      'Sense zona','2027-08-10 10:00+02',
      '45000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'invalid IANA timezone',
  $sql$
    insert into public.trip_activities (
      trip_id,title,start_at,time_zone,created_by
    ) values (
      '45000000-0000-4000-8000-000000000101',
      'Zona incorrecta','2027-08-10 10:00+02','Mars/Olympus',
      '45000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '22023'
);

select pg_temp.expect_failure(
  'end without start',
  $sql$
    insert into public.trip_activities (
      trip_id,title,end_at,time_zone,created_by
    ) values (
      '45000000-0000-4000-8000-000000000101',
      'Final sense inici','2027-08-10 12:00+02','Europe/Madrid',
      '45000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'end before start',
  $sql$
    insert into public.trip_activities (
      trip_id,title,start_at,end_at,time_zone,created_by
    ) values (
      '45000000-0000-4000-8000-000000000101',
      'Horari invers','2027-08-10 12:00+02','2027-08-10 10:00+02',
      'Europe/Madrid','45000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'creator spoof',
  $sql$
    insert into public.trip_activities (
      trip_id,title,created_by
    ) values (
      '45000000-0000-4000-8000-000000000101',
      'Intent de suplantacio',
      '45000000-0000-4000-8000-000000000003'
    )
  $sql$
);

select pg_temp.expect_failure(
  'immutable creator update',
  $sql$
    update public.trip_activities
    set created_by = '45000000-0000-4000-8000-000000000003'
    where id = '45000000-0000-4000-8000-000000000301'
  $sql$,
  '42501'
);

select pg_temp.expect_failure(
  'immutable creation timestamp update',
  $sql$
    update public.trip_activities
    set created_at = '2000-01-01 00:00+00'
    where id = '45000000-0000-4000-8000-000000000301'
  $sql$,
  '42501'
);

-- updated_by aportat pel client és ignorat i substituït per auth.uid().
update public.trip_activities
set notes = 'Nota actualitzada',
    updated_by = '45000000-0000-4000-8000-000000000003'
where id = '45000000-0000-4000-8000-000000000301';

do $$
begin
  if (
    select updated_by
    from public.trip_activities
    where id = '45000000-0000-4000-8000-000000000301'
  ) <> '45000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'updated_by spoof was not overwritten';
  end if;
end;
$$;

-- Un membre col·laborador pot veure, crear, editar i eliminar dins del viatge.
select set_config(
  'request.jwt.claim.sub',
  '45000000-0000-4000-8000-000000000002',
  true
);

insert into public.trip_activities (
  id,trip_id,title,activity_type,reservation_status,created_by
)
values (
  '45000000-0000-4000-8000-000000000303',
  '45000000-0000-4000-8000-000000000101',
  'Activitat del membre','tour','reserved',
  '45000000-0000-4000-8000-000000000002'
);

update public.trip_activities
set notes = 'Editat pel membre'
where id = '45000000-0000-4000-8000-000000000301';

delete from public.trip_activities
where id = '45000000-0000-4000-8000-000000000303';

do $$
begin
  if not exists (
    select 1
    from public.trip_activities
    where id = '45000000-0000-4000-8000-000000000301'
      and updated_by = '45000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'member CRUD/audit behavior failed';
  end if;

  if exists (
    select 1
    from public.trip_activities
    where trip_id = '45000000-0000-4000-8000-000000000102'
  ) then
    raise exception 'member of trip A can read activities from trip B';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'member cross-trip activity insert',
  $sql$
    insert into public.trip_activities (
      trip_id,title,created_by
    ) values (
      '45000000-0000-4000-8000-000000000102',
      'Intent entre viatges',
      '45000000-0000-4000-8000-000000000002'
    )
  $sql$
);

select set_config(
  'request.jwt.claim.sub',
  '45000000-0000-4000-8000-000000000001',
  true
);

-- Una baseline de fila obsoleta no pot actualitzar l'activitat.
do $$
declare
  stale_updated_at timestamptz;
  affected_rows integer;
begin
  select updated_at into stale_updated_at
  from public.trip_activities
  where id = '45000000-0000-4000-8000-000000000301';

  perform pg_sleep(0.01);

  update public.trip_activities
  set reservation_status = 'reserved'
  where trip_id = '45000000-0000-4000-8000-000000000101'
    and id = '45000000-0000-4000-8000-000000000301';

  update public.trip_activities
  set notes = 'Escriptura obsoleta'
  where trip_id = '45000000-0000-4000-8000-000000000101'
    and id = '45000000-0000-4000-8000-000000000301'
    and updated_at = stale_updated_at;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'stale activity row CAS unexpectedly updated data';
  end if;
end;
$$;

-- DML directe a relacions documentals ha d'estar bloquejat.
select pg_temp.expect_failure(
  'direct activity document insert',
  $sql$
    insert into public.trip_activity_documents (
      trip_id,activity_id,document_id,document_role,created_by
    ) values (
      '45000000-0000-4000-8000-000000000101',
      '45000000-0000-4000-8000-000000000301',
      '45000000-0000-4000-8000-000000000201',
      'booking',
      '45000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '42501'
);

-- Reserva i entrada s'associen de manera independent via RPC.
select public.sync_trip_activity_document(
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000301',
  'booking',
  (
    select updated_at
    from public.trip_activities
    where id = '45000000-0000-4000-8000-000000000301'
  ),
  null,
  '45000000-0000-4000-8000-000000000201'
);

select public.sync_trip_activity_document(
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000301',
  'ticket',
  (
    select updated_at
    from public.trip_activities
    where id = '45000000-0000-4000-8000-000000000301'
  ),
  null,
  '45000000-0000-4000-8000-000000000202'
);

do $$
begin
  if (
    select count(*)
    from public.trip_activity_documents
    where trip_id = '45000000-0000-4000-8000-000000000101'
      and activity_id = '45000000-0000-4000-8000-000000000301'
  ) <> 2 then
    raise exception 'booking and ticket were not associated independently';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '45000000-0000-4000-8000-000000000002',
  true
);

do $$
begin
  if (
    select count(*)
    from public.trip_activity_documents
    where trip_id = '45000000-0000-4000-8000-000000000101'
      and activity_id = '45000000-0000-4000-8000-000000000301'
  ) <> 2 then
    raise exception 'trip member cannot read activity document relations';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '45000000-0000-4000-8000-000000000001',
  true
);

-- El mateix document pot servir per als dos rols.
select public.sync_trip_activity_document(
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000301',
  'ticket',
  (
    select updated_at
    from public.trip_activities
    where id = '45000000-0000-4000-8000-000000000301'
  ),
  '45000000-0000-4000-8000-000000000202',
  '45000000-0000-4000-8000-000000000201'
);

do $$
begin
  if (
    select count(*)
    from public.trip_activity_documents
    where trip_id = '45000000-0000-4000-8000-000000000101'
      and activity_id = '45000000-0000-4000-8000-000000000301'
      and document_id = '45000000-0000-4000-8000-000000000201'
  ) <> 2 then
    raise exception 'same document cannot be reused for booking and ticket';
  end if;
end;
$$;

-- Document d'un altre viatge: l'RPC ha de rebutjar-lo explícitament.
select pg_temp.expect_failure(
  'cross-trip activity document',
  $sql$
    select public.sync_trip_activity_document(
      '45000000-0000-4000-8000-000000000101',
      '45000000-0000-4000-8000-000000000301',
      'booking',
      (
        select updated_at
        from public.trip_activities
        where id = '45000000-0000-4000-8000-000000000301'
      ),
      '45000000-0000-4000-8000-000000000201',
      '45000000-0000-4000-8000-000000000203'
    )
  $sql$,
  '23503'
);

-- Baseline documental obsoleta per al mateix rol.
select pg_temp.expect_failure(
  'stale activity document CAS',
  $sql$
    select public.sync_trip_activity_document(
      '45000000-0000-4000-8000-000000000101',
      '45000000-0000-4000-8000-000000000301',
      'booking',
      (
        select updated_at
        from public.trip_activities
        where id = '45000000-0000-4000-8000-000000000301'
      ),
      null,
      '45000000-0000-4000-8000-000000000202'
    )
  $sql$,
  '40001'
);

-- Una versió obsoleta de l'activitat invalida també l'associació.
do $$
declare
  old_updated_at timestamptz;
begin
  select updated_at into old_updated_at
  from public.trip_activities
  where id = '45000000-0000-4000-8000-000000000301';

  perform pg_sleep(0.01);

  update public.trip_activities
  set notes = 'Nova versio abans de sincronitzar document'
  where id = '45000000-0000-4000-8000-000000000301';

  begin
    perform public.sync_trip_activity_document(
      '45000000-0000-4000-8000-000000000101',
      '45000000-0000-4000-8000-000000000301',
      'booking',
      old_updated_at,
      '45000000-0000-4000-8000-000000000201',
      null
    );

    raise exception 'stale activity version unexpectedly succeeded';
  exception
    when serialization_failure then
      null;
  end;
end;
$$;

-- Un no membre no pot veure, crear, editar, eliminar ni usar l'RPC.
select set_config(
  'request.jwt.claim.sub',
  '45000000-0000-4000-8000-000000000003',
  true
);

do $$
begin
  if exists (
    select 1
    from public.trip_activities
    where trip_id = '45000000-0000-4000-8000-000000000101'
  ) or exists (
    select 1
    from public.trip_activity_documents
    where trip_id = '45000000-0000-4000-8000-000000000101'
  ) then
    raise exception 'outsider can read activity data';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'outsider activity insert',
  $sql$
    insert into public.trip_activities (
      trip_id,title,created_by
    ) values (
      '45000000-0000-4000-8000-000000000101',
      'Activitat intrusa',
      '45000000-0000-4000-8000-000000000003'
    )
  $sql$
);

do $$
declare
  affected_rows integer;
begin
  update public.trip_activities
  set notes = 'Canvi intrusiu'
  where id = '45000000-0000-4000-8000-000000000301';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'outsider UPDATE affected % rows', affected_rows;
  end if;

  delete from public.trip_activities
  where id = '45000000-0000-4000-8000-000000000301';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'outsider DELETE affected % rows', affected_rows;
  end if;
end;
$$;

select pg_temp.expect_failure(
  'outsider activity RPC',
  $sql$
    select public.sync_trip_activity_document(
      '45000000-0000-4000-8000-000000000101',
      '45000000-0000-4000-8000-000000000301',
      'booking',
      statement_timestamp(),
      null,
      null
    )
  $sql$,
  '42501'
);

-- Totes les dades de prova anteriors queden eliminades per aquesta transacció.
rollback;

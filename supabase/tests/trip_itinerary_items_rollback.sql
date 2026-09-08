begin;

do $$
declare
  expected_columns text[] := array[
    'id','trip_id','title','timing_kind','local_date','starts_at','ends_at',
    'time_zone','daypart','approximate_start_time','approximate_end_time',
    'location_name','address','city','notes','status',
    'is_fixed','is_optional','sort_order','created_by','updated_by',
    'created_at','updated_at'
  ];
  expected_constraints text[] := array[
    'trip_itinerary_items_pkey',
    'trip_itinerary_items_trip_fkey',
    'trip_itinerary_items_created_by_fkey',
    'trip_itinerary_items_updated_by_fkey',
    'trip_itinerary_items_trip_id_id_key',
    'trip_itinerary_items_title_check',
    'trip_itinerary_items_timing_kind_check',
    'trip_itinerary_items_time_zone_check',
    'trip_itinerary_items_daypart_check',
    'trip_itinerary_items_timing_fields_check',
    'trip_itinerary_items_time_order_check',
    'trip_itinerary_items_approximate_time_order_check',
    'trip_itinerary_items_location_name_check',
    'trip_itinerary_items_address_check',
    'trip_itinerary_items_city_check',
    'trip_itinerary_items_notes_check',
    'trip_itinerary_items_status_check'
  ];
begin
  if to_regclass('public.trip_itinerary_items') is null then
    raise exception 'trip_itinerary_items is missing';
  end if;

  if exists (
    select unnest(expected_columns)
    except
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_itinerary_items'
  ) or exists (
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_itinerary_items'
    except
    select unnest(expected_columns)
  ) then
    raise exception 'trip_itinerary_items column set has drifted';
  end if;

  if exists (
    select 1
    from (
      values
        ('id','uuid',true),
        ('trip_id','uuid',true),
        ('title','text',true),
        ('timing_kind','text',true),
        ('local_date','date',false),
        ('starts_at','timestamp with time zone',false),
        ('ends_at','timestamp with time zone',false),
        ('time_zone','text',false),
        ('daypart','text',false),
        ('approximate_start_time','time without time zone',false),
        ('approximate_end_time','time without time zone',false),
        ('location_name','text',false),
        ('address','text',false),
        ('city','text',false),
        ('notes','text',false),
        ('status','text',true),
        ('is_fixed','boolean',true),
        ('is_optional','boolean',true),
        ('sort_order','integer',true),
        ('created_by','uuid',false),
        ('updated_by','uuid',false),
        ('created_at','timestamp with time zone',true),
        ('updated_at','timestamp with time zone',true)
    ) as expected(column_name, data_type, is_not_null)
    left join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = 'public.trip_itinerary_items'::regclass
     and attribute.attname = expected.column_name
     and attribute.attnum > 0
     and not attribute.attisdropped
    where attribute.attname is null
       or pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            is distinct from expected.data_type
       or attribute.attnotnull is distinct from expected.is_not_null
  ) then
    raise exception 'trip_itinerary_items type/nullability contract has drifted';
  end if;

  if exists (
    select unnest(expected_constraints)
    except
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.trip_itinerary_items'::regclass
  ) or exists (
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.trip_itinerary_items'::regclass
    except
    select unnest(expected_constraints)
  ) then
    raise exception 'trip_itinerary_items constraint set has drifted';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'trip_itinerary_items'
      and indexname in (
        'trip_itinerary_items_starts_at_idx',
        'trip_itinerary_items_local_date_idx',
        'trip_itinerary_items_manual_order_idx'
      )
  ) <> 3 then
    raise exception 'trip_itinerary_items query indexes are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.trip_itinerary_items'::regclass
      and relrowsecurity
      and relreplident = 'f'
  ) then
    raise exception 'trip_itinerary_items RLS or replica identity FULL is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_itinerary_items'
  ) then
    raise exception 'trip_itinerary_items is not in supabase_realtime';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'trip_itinerary_items'
      and roles = array['authenticated']::name[]
      and cmd in ('SELECT','INSERT','UPDATE','DELETE')
  ) <> 4 then
    raise exception 'trip_itinerary_items member policies are missing or malformed';
  end if;

  if has_table_privilege('anon','public.trip_itinerary_items','SELECT')
     or has_table_privilege('anon','public.trip_itinerary_items','INSERT')
     or has_table_privilege('anon','public.trip_itinerary_items','UPDATE')
     or has_table_privilege('anon','public.trip_itinerary_items','DELETE') then
    raise exception 'anon unexpectedly has trip_itinerary_items privileges';
  end if;

  if not has_table_privilege('authenticated','public.trip_itinerary_items','SELECT')
     or not has_table_privilege('authenticated','public.trip_itinerary_items','INSERT')
     or not has_table_privilege('authenticated','public.trip_itinerary_items','UPDATE')
     or not has_table_privilege('authenticated','public.trip_itinerary_items','DELETE') then
    raise exception 'authenticated lacks trip_itinerary_items CRUD privileges';
  end if;

  if has_function_privilege(
    'anon',
    'public.enforce_trip_itinerary_item_integrity()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.enforce_trip_itinerary_item_integrity()',
    'EXECUTE'
  ) then
    raise exception 'trigger function is directly executable by API roles';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'enforce_trip_itinerary_item_integrity'
      and not procedure.prosecdef
      and exists (
        select 1
        from unnest(procedure.proconfig) as setting
        where setting = 'search_path=""'
      )
  ) then
    raise exception 'trigger function security invoker/search_path is incorrect';
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
  '46000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','itinerary-owner@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
),
(
  '00000000-0000-0000-0000-000000000000',
  '46000000-0000-4000-8000-000000000002',
  'authenticated','authenticated','itinerary-member@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
),
(
  '00000000-0000-0000-0000-000000000000',
  '46000000-0000-4000-8000-000000000003',
  'authenticated','authenticated','itinerary-outsider@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
);

insert into public.trips (
  id,name,owner_id,start_date,end_date,time_zone
)
values
(
  '46000000-0000-4000-8000-000000000101',
  'Manual itinerary trip A',
  '46000000-0000-4000-8000-000000000001',
  '2027-08-01','2027-08-20','Europe/Madrid'
),
(
  '46000000-0000-4000-8000-000000000102',
  'Manual itinerary trip B',
  '46000000-0000-4000-8000-000000000001',
  '2027-09-01','2027-09-20','Atlantic/Canary'
);

insert into public.trip_members (trip_id,user_id)
values
(
  '46000000-0000-4000-8000-000000000101',
  '46000000-0000-4000-8000-000000000001'
),
(
  '46000000-0000-4000-8000-000000000101',
  '46000000-0000-4000-8000-000000000002'
),
(
  '46000000-0000-4000-8000-000000000102',
  '46000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '46000000-0000-4000-8000-000000000001',
  true
);

-- Exacte: timestamps reals, zona IANA i final posterior.
insert into public.trip_itinerary_items (
  id,trip_id,title,timing_kind,starts_at,ends_at,time_zone,
  location_name,address,city,notes,status,is_fixed,is_optional,sort_order,
  created_by,updated_by,created_at,updated_at
)
values (
  '46000000-0000-4000-8000-000000000201',
  '46000000-0000-4000-8000-000000000101',
  'Passeig amb hora','exact',
  '2027-08-05 10:00+02','2027-08-05 12:00+02','Europe/Madrid',
  'Passeig marítim','Carrer de prova 1','Ciutat de prova','Portar aigua',
  'planned',false,false,10,
  '46000000-0000-4000-8000-000000000001',
  '46000000-0000-4000-8000-000000000003',
  '2000-01-01 00:00+00','2000-01-01 00:00+00'
);

-- Data, tot el dia, franja i sense programar no fabriquen timestamps.
insert into public.trip_itinerary_items (
  id,trip_id,title,timing_kind,local_date,daypart,status,
  is_fixed,is_optional,sort_order,created_by
)
values
(
  '46000000-0000-4000-8000-000000000202',
  '46000000-0000-4000-8000-000000000101',
  'Pla per data','date','2027-08-06',null,'planned',false,false,20,
  '46000000-0000-4000-8000-000000000001'
),
(
  '46000000-0000-4000-8000-000000000203',
  '46000000-0000-4000-8000-000000000101',
  'Dia complet','all_day','2027-08-07',null,'completed',true,false,30,
  '46000000-0000-4000-8000-000000000001'
),
(
  '46000000-0000-4000-8000-000000000204',
  '46000000-0000-4000-8000-000000000101',
  'Pla de matí','daypart','2027-08-08','morning','planned',false,false,40,
  '46000000-0000-4000-8000-000000000001'
);

-- Els defaults de producte i auditoria s'apliquen sense valors del client.
insert into public.trip_itinerary_items (
  id,trip_id,title,timing_kind,created_by
)
values (
  '46000000-0000-4000-8000-000000000211',
  '46000000-0000-4000-8000-000000000101',
  'Element amb defaults','unscheduled',
  '46000000-0000-4000-8000-000000000001'
);

insert into public.trip_itinerary_items (
  id,trip_id,title,timing_kind,status,is_fixed,is_optional,sort_order,created_by
)
values
(
  '46000000-0000-4000-8000-000000000205',
  '46000000-0000-4000-8000-000000000101',
  'Pla sense programar','unscheduled','planned',false,false,50,
  '46000000-0000-4000-8000-000000000001'
),
(
  '46000000-0000-4000-8000-000000000206',
  '46000000-0000-4000-8000-000000000101',
  'Alternativa opcional','unscheduled','planned',false,true,60,
  '46000000-0000-4000-8000-000000000001'
),
(
  '46000000-0000-4000-8000-000000000207',
  '46000000-0000-4000-8000-000000000101',
  'Compromís fix','unscheduled','cancelled',true,false,70,
  '46000000-0000-4000-8000-000000000001'
),
(
  '46000000-0000-4000-8000-000000000208',
  '46000000-0000-4000-8000-000000000101',
  'Pla flexible','unscheduled','completed',false,false,-10,
  '46000000-0000-4000-8000-000000000001'
),
(
  '46000000-0000-4000-8000-000000000209',
  '46000000-0000-4000-8000-000000000102',
  'Element del viatge B','unscheduled','planned',false,false,0,
  '46000000-0000-4000-8000-000000000001'
);

do $$
begin
  if not exists (
    select 1
    from public.trip_itinerary_items
    where id = '46000000-0000-4000-8000-000000000201'
      and updated_by is null
      and created_at = updated_at
      and created_at <> '2000-01-01 00:00+00'::timestamptz
  ) then
    raise exception 'insert audit normalization failed';
  end if;

  if exists (
    select 1
    from public.trip_itinerary_items
    where id in (
      '46000000-0000-4000-8000-000000000202',
      '46000000-0000-4000-8000-000000000203',
      '46000000-0000-4000-8000-000000000204',
      '46000000-0000-4000-8000-000000000205'
    )
      and (starts_at is not null or ends_at is not null)
  ) then
    raise exception 'non-exact timing fabricated timestamps';
  end if;

  if not exists (
    select 1 from public.trip_itinerary_items
    where id = '46000000-0000-4000-8000-000000000206'
      and is_optional and not is_fixed
  ) or not exists (
    select 1 from public.trip_itinerary_items
    where id = '46000000-0000-4000-8000-000000000207'
      and is_fixed and not is_optional and status = 'cancelled'
  ) or not exists (
    select 1 from public.trip_itinerary_items
    where id = '46000000-0000-4000-8000-000000000208'
      and not is_fixed and not is_optional and status = 'completed'
      and sort_order = -10
  ) then
    raise exception 'optional/fixed/flexible/status/sort semantics failed';
  end if;

  if not exists (
    select 1
    from public.trip_itinerary_items
    where id = '46000000-0000-4000-8000-000000000211'
      and status = 'planned'
      and not is_fixed
      and not is_optional
      and sort_order = 0
      and created_by = '46000000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'manual itinerary defaults failed';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'exact without timezone',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,starts_at,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Exacte sense zona','exact','2027-08-10 10:00+02',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'invalid IANA timezone',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,starts_at,time_zone,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Zona incorrecta','exact','2027-08-10 10:00+02','Mars/Olympus',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '22023'
);

select pg_temp.expect_failure(
  'exact end not after start',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,starts_at,ends_at,time_zone,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Horari invers','exact','2027-08-10 12:00+02','2027-08-10 12:00+02',
      'Europe/Madrid','46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'date with timestamp',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,starts_at,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Data amb hora','date','2027-08-10','2027-08-10 10:00+02',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'date without local date',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Data incompleta','date',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'all-day with daypart',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,daypart,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Tot el dia amb franja','all_day','2027-08-10','morning',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'daypart without daypart',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Franja incompleta','daypart','2027-08-10',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'invalid daypart',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,daypart,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Franja incorrecta','daypart','2027-08-10','dawn',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'unscheduled with local date',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Sense programar amb data','unscheduled','2027-08-10',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'invalid status',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,status,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Estat incorrecte','unscheduled','reserved',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'untrimmed title',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      ' Títol amb espais ','unscheduled',
      '46000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'creator spoof',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Intent de suplantació','unscheduled',
      '46000000-0000-4000-8000-000000000003'
    )
  $sql$,
  '42501'
);

select pg_temp.expect_failure(
  'immutable id update',
  $sql$
    update public.trip_itinerary_items
    set id = gen_random_uuid()
    where id = '46000000-0000-4000-8000-000000000201'
  $sql$,
  '42501'
);

select pg_temp.expect_failure(
  'immutable trip update',
  $sql$
    update public.trip_itinerary_items
    set trip_id = '46000000-0000-4000-8000-000000000102'
    where id = '46000000-0000-4000-8000-000000000201'
  $sql$,
  '42501'
);

select pg_temp.expect_failure(
  'immutable creator update',
  $sql$
    update public.trip_itinerary_items
    set created_by = '46000000-0000-4000-8000-000000000003'
    where id = '46000000-0000-4000-8000-000000000201'
  $sql$,
  '42501'
);

select pg_temp.expect_failure(
  'immutable creation timestamp update',
  $sql$
    update public.trip_itinerary_items
    set created_at = '2000-01-01 00:00+00'
    where id = '46000000-0000-4000-8000-000000000201'
  $sql$,
  '42501'
);

-- updated_by aportat pel client s'ignora i updated_at avança al servidor.
do $$
declare
  previous_updated_at timestamptz;
begin
  select updated_at into previous_updated_at
  from public.trip_itinerary_items
  where id = '46000000-0000-4000-8000-000000000201';

  perform pg_sleep(0.01);

  update public.trip_itinerary_items
  set notes = 'Nota actualitzada',
      updated_by = '46000000-0000-4000-8000-000000000003',
      updated_at = '2000-01-01 00:00+00'
  where id = '46000000-0000-4000-8000-000000000201';

  if not exists (
    select 1
    from public.trip_itinerary_items
    where id = '46000000-0000-4000-8000-000000000201'
      and updated_by = '46000000-0000-4000-8000-000000000001'
      and updated_at > previous_updated_at
  ) then
    raise exception 'update audit normalization failed';
  end if;
end;
$$;

-- Un membre pot veure, crear, editar i eliminar dins del viatge A.
select set_config(
  'request.jwt.claim.sub',
  '46000000-0000-4000-8000-000000000002',
  true
);

insert into public.trip_itinerary_items (
  id,trip_id,title,timing_kind,created_by
)
values (
  '46000000-0000-4000-8000-000000000210',
  '46000000-0000-4000-8000-000000000101',
  'Element del membre','unscheduled',
  '46000000-0000-4000-8000-000000000002'
);

update public.trip_itinerary_items
set notes = 'Editat pel membre'
where id = '46000000-0000-4000-8000-000000000201';

delete from public.trip_itinerary_items
where id = '46000000-0000-4000-8000-000000000210';

do $$
begin
  if not exists (
    select 1
    from public.trip_itinerary_items
    where id = '46000000-0000-4000-8000-000000000201'
      and updated_by = '46000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'member CRUD/audit behavior failed';
  end if;

  if exists (
    select 1
    from public.trip_itinerary_items
    where trip_id = '46000000-0000-4000-8000-000000000102'
  ) then
    raise exception 'member of trip A can read trip B itinerary items';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'member cross-trip insert',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,created_by
    ) values (
      '46000000-0000-4000-8000-000000000102',
      'Intent entre viatges','unscheduled',
      '46000000-0000-4000-8000-000000000002'
    )
  $sql$,
  '42501'
);

select set_config(
  'request.jwt.claim.sub',
  '46000000-0000-4000-8000-000000000001',
  true
);

-- CAS: una baseline updated_at obsoleta no pot escriure cap fila.
do $$
declare
  stale_updated_at timestamptz;
  affected_rows integer;
begin
  select updated_at into stale_updated_at
  from public.trip_itinerary_items
  where id = '46000000-0000-4000-8000-000000000201';

  perform pg_sleep(0.01);

  update public.trip_itinerary_items
  set status = 'completed'
  where trip_id = '46000000-0000-4000-8000-000000000101'
    and id = '46000000-0000-4000-8000-000000000201';

  update public.trip_itinerary_items
  set notes = 'Escriptura obsoleta'
  where trip_id = '46000000-0000-4000-8000-000000000101'
    and id = '46000000-0000-4000-8000-000000000201'
    and updated_at = stale_updated_at;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'stale itinerary item CAS unexpectedly updated data';
  end if;
end;
$$;

-- Un no membre no pot veure ni mutar cap element.
select set_config(
  'request.jwt.claim.sub',
  '46000000-0000-4000-8000-000000000003',
  true
);

do $$
begin
  if exists (
    select 1
    from public.trip_itinerary_items
    where trip_id in (
      '46000000-0000-4000-8000-000000000101',
      '46000000-0000-4000-8000-000000000102'
    )
  ) then
    raise exception 'outsider can read manual itinerary data';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'outsider insert',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,created_by
    ) values (
      '46000000-0000-4000-8000-000000000101',
      'Element intrús','unscheduled',
      '46000000-0000-4000-8000-000000000003'
    )
  $sql$,
  '42501'
);

do $$
declare
  affected_rows integer;
begin
  update public.trip_itinerary_items
  set notes = 'Canvi intrusiu'
  where id = '46000000-0000-4000-8000-000000000201';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'outsider UPDATE affected % rows', affected_rows;
  end if;

  delete from public.trip_itinerary_items
  where id = '46000000-0000-4000-8000-000000000201';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'outsider DELETE affected % rows', affected_rows;
  end if;
end;
$$;

-- Totes les dades i usuaris de prova desapareixen amb la transacció.
rollback;

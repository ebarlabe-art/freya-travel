begin;

do $$
declare
  expected_columns text[] := array[
    'id','trip_id','local_date','title','summary','created_by','updated_by',
    'created_at','updated_at'
  ];
  expected_constraints text[] := array[
    'trip_day_metadata_pkey',
    'trip_day_metadata_trip_fkey',
    'trip_day_metadata_created_by_fkey',
    'trip_day_metadata_updated_by_fkey',
    'trip_day_metadata_trip_date_key',
    'trip_day_metadata_title_check',
    'trip_day_metadata_summary_check'
  ];
begin
  if to_regclass('public.trip_day_metadata') is null then
    raise exception 'trip_day_metadata is missing';
  end if;

  if exists (
    select unnest(expected_columns)
    except
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_day_metadata'
  ) or exists (
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_day_metadata'
    except
    select unnest(expected_columns)
  ) then
    raise exception 'trip_day_metadata column set has drifted';
  end if;

  if exists (
    select 1
    from (
      values
        ('id','uuid',true),
        ('trip_id','uuid',true),
        ('local_date','date',true),
        ('title','text',false),
        ('summary','text',false),
        ('created_by','uuid',false),
        ('updated_by','uuid',false),
        ('created_at','timestamp with time zone',true),
        ('updated_at','timestamp with time zone',true)
    ) as expected(column_name, data_type, is_not_null)
    left join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = 'public.trip_day_metadata'::regclass
     and attribute.attname = expected.column_name
     and attribute.attnum > 0
     and not attribute.attisdropped
    where attribute.attname is null
       or pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
            is distinct from expected.data_type
       or attribute.attnotnull is distinct from expected.is_not_null
  ) then
    raise exception 'trip_day_metadata type/nullability contract has drifted';
  end if;

  if exists (
    select unnest(expected_constraints)
    except
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.trip_day_metadata'::regclass
  ) or exists (
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.trip_day_metadata'::regclass
    except
    select unnest(expected_constraints)
  ) then
    raise exception 'trip_day_metadata constraint set has drifted';
  end if;

  if (
    select relreplident
    from pg_catalog.pg_class
    where oid = 'public.trip_day_metadata'::regclass
  ) <> 'f' then
    raise exception 'trip_day_metadata must use replica identity full';
  end if;

  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_day_metadata'
  ) then
    raise exception 'trip_day_metadata is missing from supabase_realtime';
  end if;

  if not has_table_privilege('authenticated','public.trip_day_metadata','select')
     or not has_table_privilege('authenticated','public.trip_day_metadata','insert')
     or not has_table_privilege('authenticated','public.trip_day_metadata','update')
     or not has_table_privilege('authenticated','public.trip_day_metadata','delete')
     or has_table_privilege('anon','public.trip_day_metadata','select')
     or has_table_privilege('anon','public.trip_day_metadata','insert')
     or has_table_privilege('anon','public.trip_day_metadata','update')
     or has_table_privilege('anon','public.trip_day_metadata','delete') then
    raise exception 'trip_day_metadata grants are incorrect';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policy
    where polrelid = 'public.trip_day_metadata'::regclass
      and polname in (
        'members can view trip day metadata',
        'members can add trip day metadata',
        'members can update trip day metadata',
        'members can delete trip day metadata'
      )
  ) <> 4 then
    raise exception 'trip_day_metadata policy set is incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc
    where oid = 'public.enforce_trip_day_metadata_integrity()'::regprocedure
      and not prosecdef
      and exists (
        select 1
        from unnest(proconfig) as setting
        where setting = 'search_path=""'
      )
  ) or has_function_privilege(
    'authenticated','public.enforce_trip_day_metadata_integrity()','execute'
  ) or has_function_privilege(
    'anon','public.enforce_trip_day_metadata_integrity()','execute'
  ) then
    raise exception 'trip_day_metadata trigger function security is incorrect';
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
    '47000000-0000-4000-8000-000000000001',
    'authenticated','authenticated','day-owner@example.invalid','',
    statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '47000000-0000-4000-8000-000000000002',
    'authenticated','authenticated','day-member@example.invalid','',
    statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '47000000-0000-4000-8000-000000000003',
    'authenticated','authenticated','day-outsider@example.invalid','',
    statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
  );

insert into public.trips (
  id,name,owner_id,start_date,end_date,time_zone
)
values
  (
    '47000000-0000-4000-8000-000000000101','Day metadata test',
    '47000000-0000-4000-8000-000000000001',
    '2027-11-01','2027-11-05','Europe/Madrid'
  ),
  (
    '47000000-0000-4000-8000-000000000102','Other day metadata test',
    '47000000-0000-4000-8000-000000000003',
    '2027-12-01','2027-12-05','Europe/Madrid'
  );

insert into public.trip_members (trip_id,user_id)
values
  ('47000000-0000-4000-8000-000000000101','47000000-0000-4000-8000-000000000001'),
  ('47000000-0000-4000-8000-000000000101','47000000-0000-4000-8000-000000000002'),
  ('47000000-0000-4000-8000-000000000102','47000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '47000000-0000-4000-8000-000000000001',
  true
);

insert into public.trip_day_metadata (
  id,trip_id,local_date,title,created_by
)
values (
  '47000000-0000-4000-8000-000000000201',
  '47000000-0000-4000-8000-000000000101','2027-11-01',
  'Primer dia','47000000-0000-4000-8000-000000000001'
);

insert into public.trip_day_metadata (
  id,trip_id,local_date,summary,created_by
)
values (
  '47000000-0000-4000-8000-000000000202',
  '47000000-0000-4000-8000-000000000101','2027-11-02',
  'Un dia tranquil.','47000000-0000-4000-8000-000000000001'
);

insert into public.trip_day_metadata (
  id,trip_id,local_date,title,summary,created_by
)
values (
  '47000000-0000-4000-8000-000000000203',
  '47000000-0000-4000-8000-000000000101','2027-11-03',
  '   ','   ','47000000-0000-4000-8000-000000000001'
);

do $$
begin
  if not exists (
    select 1
    from public.trip_day_metadata
    where id = '47000000-0000-4000-8000-000000000201'
      and title = 'Primer dia'
      and summary is null
      and updated_by is null
  ) or not exists (
    select 1
    from public.trip_day_metadata
    where id = '47000000-0000-4000-8000-000000000202'
      and title is null
      and summary = 'Un dia tranquil.'
  ) or not exists (
    select 1
    from public.trip_day_metadata
    where id = '47000000-0000-4000-8000-000000000203'
      and title is null
      and summary is null
  ) then
    raise exception 'title/summary optionality or normalization failed';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'duplicate trip day',
  $sql$
    insert into public.trip_day_metadata (
      trip_id,local_date,title,created_by
    ) values (
      '47000000-0000-4000-8000-000000000101','2027-11-01','Duplicat',
      '47000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23505'
);

select pg_temp.expect_failure(
  'date outside trip',
  $sql$
    insert into public.trip_day_metadata (
      trip_id,local_date,title,created_by
    ) values (
      '47000000-0000-4000-8000-000000000101','2027-11-09','Fora',
      '47000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '22023'
);

select pg_temp.expect_failure(
  'immutable local date',
  $sql$
    update public.trip_day_metadata
    set local_date = '2027-11-04'
    where id = '47000000-0000-4000-8000-000000000201'
  $sql$,
  '42501'
);

do $$
declare
  baseline timestamptz;
  affected integer;
begin
  select updated_at into baseline
  from public.trip_day_metadata
  where id = '47000000-0000-4000-8000-000000000201';

  perform pg_sleep(0.01);

  update public.trip_day_metadata
  set title = 'Primer dia actualitzat',
      summary = 'Títol i resum funcionen junts.'
  where id = '47000000-0000-4000-8000-000000000201'
    and updated_at = baseline;

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'fresh CAS update did not affect exactly one row';
  end if;

  update public.trip_day_metadata
  set title = 'Actualització obsoleta'
  where id = '47000000-0000-4000-8000-000000000201'
    and updated_at = baseline;

  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'stale CAS update unexpectedly succeeded';
  end if;

  if not exists (
    select 1
    from public.trip_day_metadata
    where id = '47000000-0000-4000-8000-000000000201'
      and title = 'Primer dia actualitzat'
      and summary = 'Títol i resum funcionen junts.'
      and updated_by = '47000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'metadata update audit fields are incorrect';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '47000000-0000-4000-8000-000000000003',
  true
);

do $$
begin
  if exists (
    select 1
    from public.trip_day_metadata
    where trip_id = '47000000-0000-4000-8000-000000000101'
  ) then
    raise exception 'non-member can read another trip metadata';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'non-member insert',
  $sql$
    insert into public.trip_day_metadata (
      trip_id,local_date,title,created_by
    ) values (
      '47000000-0000-4000-8000-000000000101','2027-11-04','Intrús',
      '47000000-0000-4000-8000-000000000003'
    )
  $sql$,
  '42501'
);

do $$
declare
  affected integer;
begin
  update public.trip_day_metadata
  set title = 'Intrús'
  where id = '47000000-0000-4000-8000-000000000201';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'non-member update unexpectedly affected a row';
  end if;

  delete from public.trip_day_metadata
  where id = '47000000-0000-4000-8000-000000000201';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'non-member delete unexpectedly affected a row';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '47000000-0000-4000-8000-000000000002',
  true
);

do $$
declare
  affected integer;
begin
  if not exists (
    select 1
    from public.trip_day_metadata
    where id = '47000000-0000-4000-8000-000000000201'
  ) then
    raise exception 'trip member cannot read metadata';
  end if;

  update public.trip_day_metadata
  set summary = null
  where id = '47000000-0000-4000-8000-000000000201';
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'trip member cannot clear one editorial field';
  end if;
end;
$$;

rollback;

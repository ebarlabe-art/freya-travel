begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_itinerary_items'
      and column_name = 'approximate_start_time'
      and data_type = 'time without time zone'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_itinerary_items'
      and column_name = 'approximate_end_time'
      and data_type = 'time without time zone'
  ) then
    raise exception 'approximate itinerary columns are missing or malformed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.trip_itinerary_items'::regclass
      and conname = 'trip_itinerary_items_approximate_time_order_check'
      and convalidated
  ) then
    raise exception 'approximate itinerary order constraint is missing or unvalidated';
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
values (
  '00000000-0000-0000-0000-000000000000',
  '46100000-0000-4000-8000-000000000001',
  'authenticated','authenticated','approximate-owner@example.invalid','',
  statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()
);

insert into public.trips (
  id,name,owner_id,start_date,end_date,time_zone
)
values (
  '46100000-0000-4000-8000-000000000101',
  'Approximate itinerary test',
  '46100000-0000-4000-8000-000000000001',
  '2027-10-01','2027-10-05','Europe/Madrid'
);

insert into public.trip_members (trip_id,user_id)
values (
  '46100000-0000-4000-8000-000000000101',
  '46100000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '46100000-0000-4000-8000-000000000001',
  true
);

insert into public.trip_itinerary_items (
  id,trip_id,title,timing_kind,local_date,approximate_start_time,
  time_zone,created_by
)
values (
  '46100000-0000-4000-8000-000000000201',
  '46100000-0000-4000-8000-000000000101',
  'Hora aproximada','approximate','2027-10-02','18:15',
  'Europe/Madrid','46100000-0000-4000-8000-000000000001'
);

insert into public.trip_itinerary_items (
  id,trip_id,title,timing_kind,local_date,approximate_start_time,
  approximate_end_time,time_zone,is_optional,created_by
)
values (
  '46100000-0000-4000-8000-000000000202',
  '46100000-0000-4000-8000-000000000101',
  'Rang aproximat','approximate','2027-10-03','15:15','16:00',
  'Europe/Madrid',true,'46100000-0000-4000-8000-000000000001'
);

do $$
begin
  if not exists (
    select 1
    from public.trip_itinerary_items
    where id = '46100000-0000-4000-8000-000000000201'
      and timing_kind = 'approximate'
      and local_date = date '2027-10-02'
      and approximate_start_time = time '18:15'
      and approximate_end_time is null
      and time_zone = 'Europe/Madrid'
      and starts_at is null
      and ends_at is null
      and daypart is null
  ) or not exists (
    select 1
    from public.trip_itinerary_items
    where id = '46100000-0000-4000-8000-000000000202'
      and approximate_start_time = time '15:15'
      and approximate_end_time = time '16:00'
      and is_optional
  ) then
    raise exception 'valid approximate timing was not preserved structurally';
  end if;
end;
$$;

select pg_temp.expect_failure(
  'approximate without date',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,approximate_start_time,time_zone,created_by
    ) values (
      '46100000-0000-4000-8000-000000000101','Sense data',
      'approximate','10:00','Europe/Madrid',
      '46100000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'approximate without start',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,time_zone,created_by
    ) values (
      '46100000-0000-4000-8000-000000000101','Sense hora',
      'approximate','2027-10-02','Europe/Madrid',
      '46100000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'approximate without timezone',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,approximate_start_time,created_by
    ) values (
      '46100000-0000-4000-8000-000000000101','Sense zona',
      'approximate','2027-10-02','10:00',
      '46100000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'approximate invalid timezone',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,approximate_start_time,
      time_zone,created_by
    ) values (
      '46100000-0000-4000-8000-000000000101','Zona incorrecta',
      'approximate','2027-10-02','10:00','Mars/Olympus',
      '46100000-0000-4000-8000-000000000001'
    )
  $sql$,
  '22023'
);

select pg_temp.expect_failure(
  'approximate reversed range',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,approximate_start_time,
      approximate_end_time,time_zone,created_by
    ) values (
      '46100000-0000-4000-8000-000000000101','Rang invers',
      'approximate','2027-10-02','16:00','15:15','Europe/Madrid',
      '46100000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'approximate equal range',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,approximate_start_time,
      approximate_end_time,time_zone,created_by
    ) values (
      '46100000-0000-4000-8000-000000000101','Rang buit',
      'approximate','2027-10-02','16:00','16:00','Europe/Madrid',
      '46100000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'approximate with exact timestamp',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,approximate_start_time,
      starts_at,time_zone,created_by
    ) values (
      '46100000-0000-4000-8000-000000000101','Semàntica barrejada',
      'approximate','2027-10-02','16:00','2027-10-02 16:00+02',
      'Europe/Madrid','46100000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'exact with approximate time',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,starts_at,approximate_start_time,
      time_zone,created_by
    ) values (
      '46100000-0000-4000-8000-000000000101','Exacte contaminat',
      'exact','2027-10-02 16:00+02','16:00','Europe/Madrid',
      '46100000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

select pg_temp.expect_failure(
  'daypart with approximate time',
  $sql$
    insert into public.trip_itinerary_items (
      trip_id,title,timing_kind,local_date,daypart,
      approximate_start_time,created_by
    ) values (
      '46100000-0000-4000-8000-000000000101','Franja contaminada',
      'daypart','2027-10-02','afternoon','16:00',
      '46100000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514'
);

rollback;

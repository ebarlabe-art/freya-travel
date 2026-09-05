begin;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.trip_accommodations'::regclass
      and relreplident = 'f'
  ) then
    raise exception 'trip_accommodations replica identity is not FULL';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.trip_accommodation_documents'::regclass
      and relreplident = 'f'
  ) then
    raise exception 'trip_accommodation_documents replica identity is not FULL';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('trip_accommodations','trip_accommodation_documents')
  ) <> 2 then
    raise exception 'accommodation tables are not both in supabase_realtime';
  end if;
end;
$$;

create function pg_temp.expect_failure(label text, command text, expected_state text default null)
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
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000','33000000-0000-4000-8000-000000000001','authenticated','authenticated','accommodation-owner@example.invalid','',statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000','33000000-0000-4000-8000-000000000002','authenticated','authenticated','accommodation-member@example.invalid','',statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000','33000000-0000-4000-8000-000000000003','authenticated','authenticated','accommodation-outsider@example.invalid','',statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp()),
  ('00000000-0000-0000-0000-000000000000','33000000-0000-4000-8000-000000000004','authenticated','authenticated','accommodation-deleted-member@example.invalid','',statement_timestamp(),'{}','{}',statement_timestamp(),statement_timestamp());

insert into public.trips (id,name,owner_id,start_date,end_date,time_zone)
values
  ('33000000-0000-4000-8000-000000000101','Accommodation trip A','33000000-0000-4000-8000-000000000001','2027-09-01','2027-09-20','Europe/Madrid'),
  ('33000000-0000-4000-8000-000000000102','Accommodation trip B','33000000-0000-4000-8000-000000000001','2027-10-01','2027-10-20','Europe/London');

insert into public.trip_members (trip_id,user_id)
values
  ('33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000002'),
  ('33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000004'),
  ('33000000-0000-4000-8000-000000000102','33000000-0000-4000-8000-000000000001');

insert into public.travel_documents (
  id,trip_id,title,category,file_name,file_path,mime_type,created_by
)
values
  ('33000000-0000-4000-8000-000000000201','33000000-0000-4000-8000-000000000101','Voucher A','Hotel','voucher-a.pdf','33000000-0000-4000-8000-000000000101/voucher-a.pdf','application/pdf','33000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000202','33000000-0000-4000-8000-000000000101','Voucher A2','Altres','voucher-a2.pdf','33000000-0000-4000-8000-000000000101/voucher-a2.pdf','application/pdf','33000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000203','33000000-0000-4000-8000-000000000102','Voucher B','Hotel','voucher-b.pdf','33000000-0000-4000-8000-000000000102/voucher-b.pdf','application/pdf','33000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);

insert into public.trip_accommodations (
  id,trip_id,accommodation_type,name,check_in_at,check_out_at,time_zone,
  reservation_status,created_by
)
values
  ('33000000-0000-4000-8000-000000000301','33000000-0000-4000-8000-000000000101','hotel','Primer hotel','2027-09-02 15:00+02','2027-09-04 11:00+02','Europe/Madrid','confirmed','33000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000302','33000000-0000-4000-8000-000000000101','apartment','Segon allotjament','2027-09-06 16:00+02','2027-09-09 10:00+02','Europe/Madrid','planning','33000000-0000-4000-8000-000000000001'),
  ('33000000-0000-4000-8000-000000000303','33000000-0000-4000-8000-000000000101','house','Allotjament sense dates',null,null,'Europe/Madrid','planning','33000000-0000-4000-8000-000000000001');

do $$
declare
  visible_count integer;
  ordered_ids uuid[];
begin
  select count(*) into visible_count
  from public.trip_accommodations
  where trip_id = '33000000-0000-4000-8000-000000000101';
  if visible_count <> 3 then raise exception 'member SELECT expected 3 rows, got %', visible_count; end if;

  select array_agg(id order by check_in_at asc nulls last,created_at,id)
  into ordered_ids
  from public.trip_accommodations
  where trip_id = '33000000-0000-4000-8000-000000000101';
  if ordered_ids <> array[
    '33000000-0000-4000-8000-000000000301'::uuid,
    '33000000-0000-4000-8000-000000000302'::uuid,
    '33000000-0000-4000-8000-000000000303'::uuid
  ] then raise exception 'chronological ordering is incorrect: %', ordered_ids; end if;
end;
$$;

update public.trip_accommodations
set name = 'Primer hotel editat'
where id = '33000000-0000-4000-8000-000000000301'
  and trip_id = '33000000-0000-4000-8000-000000000101';

do $$
begin
  if not exists (
    select 1 from public.trip_accommodations
    where id = '33000000-0000-4000-8000-000000000301'
      and name = 'Primer hotel editat'
      and updated_by = '33000000-0000-4000-8000-000000000001'
      and updated_at >= created_at
  ) then raise exception 'member UPDATE or audit trigger failed'; end if;
end;
$$;

select pg_temp.expect_failure('creator spoof', $sql$
  insert into public.trip_accommodations (
    trip_id,accommodation_type,name,time_zone,created_by
  ) values (
    '33000000-0000-4000-8000-000000000101','hotel','Spoof','Europe/Madrid',
    '33000000-0000-4000-8000-000000000003'
  )
$sql$);

select pg_temp.expect_failure('trip_id update', $sql$
  update public.trip_accommodations
  set trip_id = '33000000-0000-4000-8000-000000000102'
  where id = '33000000-0000-4000-8000-000000000301'
$sql$);
select pg_temp.expect_failure('created_by update', $sql$
  update public.trip_accommodations
  set created_by = null
  where id = '33000000-0000-4000-8000-000000000301'
$sql$);

select pg_temp.expect_failure('invalid accommodation type', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','castle','Invalid type','Europe/Madrid','33000000-0000-4000-8000-000000000001')
$sql$);
select pg_temp.expect_failure('invalid reservation status', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,time_zone,reservation_status,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel','Invalid status','Europe/Madrid','booked','33000000-0000-4000-8000-000000000001')
$sql$);
select pg_temp.expect_failure('whitespace name', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel','   ','Europe/Madrid','33000000-0000-4000-8000-000000000001')
$sql$);
select pg_temp.expect_failure('excessive name', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel',repeat('n',201),'Europe/Madrid','33000000-0000-4000-8000-000000000001')
$sql$);
select pg_temp.expect_failure('excessive address', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,address,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel','Long address',repeat('x',501),'Europe/Madrid','33000000-0000-4000-8000-000000000001')
$sql$);
select pg_temp.expect_failure('checkout before checkin', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,check_in_at,check_out_at,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel','Bad dates','2027-09-04 12:00+02','2027-09-04 12:00+02','Europe/Madrid','33000000-0000-4000-8000-000000000001')
$sql$);
select pg_temp.expect_failure('incomplete coordinates', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,latitude,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel','Half coordinates',38.9,'Europe/Madrid','33000000-0000-4000-8000-000000000001')
$sql$);
select pg_temp.expect_failure('invalid latitude', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,latitude,longitude,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel','Bad latitude',91,1,'Europe/Madrid','33000000-0000-4000-8000-000000000001')
$sql$);
select pg_temp.expect_failure('invalid longitude', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,latitude,longitude,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel','Bad longitude',40,181,'Europe/Madrid','33000000-0000-4000-8000-000000000001')
$sql$);
select pg_temp.expect_failure('invalid timezone', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel','Bad timezone','Europe/Not-A-Zone','33000000-0000-4000-8000-000000000001')
$sql$);

-- Create mode and an initial same-trip voucher association succeed.
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101',
  '33000000-0000-4000-8000-000000000302',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
  null,
  '33000000-0000-4000-8000-000000000201'
);

select pg_temp.expect_failure('cross-trip document relation', $sql$
  select public.sync_trip_accommodation_voucher(
    '33000000-0000-4000-8000-000000000101',
    '33000000-0000-4000-8000-000000000302',
    (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
    '33000000-0000-4000-8000-000000000201',
    '33000000-0000-4000-8000-000000000203'
  )
$sql$,'23503');

-- The physical relation constraint still rejects a duplicate independently
-- from API privileges.
reset role;
select pg_temp.expect_failure('duplicate relation', $sql$
  insert into public.trip_accommodation_documents (trip_id,accommodation_id,document_id,created_by)
  values (
    '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
    '33000000-0000-4000-8000-000000000201','33000000-0000-4000-8000-000000000001'
  )
$sql$);
set local role authenticated;
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);

-- Accommodation optimistic version: A captures V1, B writes V2, and A's
-- conditional V1 update must affect no rows and preserve B's value.
create temporary table accommodation_test_baselines (
  label text primary key,
  version timestamptz not null
) on commit drop;
insert into accommodation_test_baselines
select 'row-v1',updated_at from public.trip_accommodations
where id = '33000000-0000-4000-8000-000000000302';

select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000002',true);
update public.trip_accommodations
set name = 'Versio de membre B'
where id = '33000000-0000-4000-8000-000000000302';

select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
do $$
declare affected integer;
begin
  update public.trip_accommodations
  set name = 'Intent obsolet de membre A'
  where id = '33000000-0000-4000-8000-000000000302'
    and trip_id = '33000000-0000-4000-8000-000000000101'
    and updated_at = (select version from accommodation_test_baselines where label = 'row-v1');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'stale accommodation update overwrote V2'; end if;
  if not exists (
    select 1 from public.trip_accommodations
    where id = '33000000-0000-4000-8000-000000000302'
      and name = 'Versio de membre B'
  ) then raise exception 'member B accommodation version was not preserved'; end if;
end;
$$;

-- Voucher CAS: X -> Y by B makes A's expectation X conflict.
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000002',true);
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
  '33000000-0000-4000-8000-000000000201','33000000-0000-4000-8000-000000000202'
);
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_failure('stale voucher X after replacement with Y', $sql$
  select public.sync_trip_accommodation_voucher(
    '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
    (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
    '33000000-0000-4000-8000-000000000201','33000000-0000-4000-8000-000000000201'
  )
$sql$,'40001');

-- X/Y -> NULL remains NULL when a stale client expects Y.
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000002',true);
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
  '33000000-0000-4000-8000-000000000202',null
);
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_failure('stale voucher after remote removal', $sql$
  select public.sync_trip_accommodation_voucher(
    '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
    (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
    '33000000-0000-4000-8000-000000000202','33000000-0000-4000-8000-000000000201'
  )
$sql$,'40001');

-- NULL -> Y remains Y when a stale client expects NULL.
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000002',true);
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
  null,'33000000-0000-4000-8000-000000000202'
);
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_failure('stale null voucher after remote addition', $sql$
  select public.sync_trip_accommodation_voucher(
    '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
    (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
    null,'33000000-0000-4000-8000-000000000201'
  )
$sql$,'40001');

do $$
begin
  if not exists (
    select 1 from public.trip_accommodation_documents
    where accommodation_id = '33000000-0000-4000-8000-000000000302'
      and document_id = '33000000-0000-4000-8000-000000000202'
  ) then raise exception 'newer voucher was not preserved'; end if;
end;
$$;

-- A current baseline may replace Y with X normally.
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
  '33000000-0000-4000-8000-000000000202','33000000-0000-4000-8000-000000000201'
);

-- Removing only the relation preserves its document.
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
  '33000000-0000-4000-8000-000000000201',null
);
do $$
begin
  if not exists (select 1 from public.travel_documents where id = '33000000-0000-4000-8000-000000000201') then
    raise exception 'deleting relation deleted its document';
  end if;
end;
$$;

-- Deleting an accommodation removes only its relation.
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000301',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000301'),
  null,'33000000-0000-4000-8000-000000000201'
);
delete from public.trip_accommodations
where id = '33000000-0000-4000-8000-000000000301'
  and trip_id = '33000000-0000-4000-8000-000000000101';
do $$
begin
  if exists (select 1 from public.trip_accommodation_documents where accommodation_id = '33000000-0000-4000-8000-000000000301') then raise exception 'accommodation delete left relation'; end if;
  if not exists (select 1 from public.travel_documents where id = '33000000-0000-4000-8000-000000000201') then raise exception 'accommodation delete removed document'; end if;
end;
$$;

-- Deleting a document removes its relation, then restore X for collaboration tests.
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
  null,'33000000-0000-4000-8000-000000000202'
);
delete from public.travel_documents where id = '33000000-0000-4000-8000-000000000202';
do $$
begin
  if exists (select 1 from public.trip_accommodation_documents where document_id = '33000000-0000-4000-8000-000000000202') then raise exception 'document delete left relation'; end if;
  if not exists (select 1 from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302') then raise exception 'document delete removed accommodation'; end if;
end;
$$;
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302'),
  null,'33000000-0000-4000-8000-000000000201'
);
insert into accommodation_test_baselines
select 'rpc-version-v1',updated_at from public.trip_accommodations
where id = '33000000-0000-4000-8000-000000000302';

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000002',true);
do $$
begin
  if not exists (select 1 from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302') then raise exception 'second member cannot see accommodation'; end if;
  if not exists (select 1 from public.trip_accommodation_documents where accommodation_id = '33000000-0000-4000-8000-000000000302') then raise exception 'second member cannot see voucher relation'; end if;
end;
$$;
do $$
declare affected integer;
declare current_version timestamptz;
begin
  select updated_at into current_version from public.trip_accommodations
  where id = '33000000-0000-4000-8000-000000000302';
  update public.trip_accommodations set room_number = '204'
  where id = '33000000-0000-4000-8000-000000000302'
    and trip_id = '33000000-0000-4000-8000-000000000101'
    and updated_at = current_version;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'current conditional update did not succeed'; end if;
end;
$$;

-- A voucher mutation cannot race past a newer accommodation row version.
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_failure('stale accommodation version blocks voucher mutation', $sql$
  select public.sync_trip_accommodation_voucher(
    '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
    (select version from accommodation_test_baselines where label = 'rpc-version-v1'),
    '33000000-0000-4000-8000-000000000201',null
  )
$sql$,'40001');
do $$
begin
  if not exists (
    select 1 from public.trip_accommodation_documents
    where accommodation_id = '33000000-0000-4000-8000-000000000302'
      and document_id = '33000000-0000-4000-8000-000000000201'
  ) then raise exception 'stale accommodation version changed the voucher'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000002',true);

-- Create mode still succeeds, including initial atomic voucher association.
insert into public.trip_accommodations (id,trip_id,accommodation_type,name,time_zone,created_by)
values ('33000000-0000-4000-8000-000000000304','33000000-0000-4000-8000-000000000101','hostel','Member-created stay','Europe/Madrid','33000000-0000-4000-8000-000000000002');
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000304',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000304'),
  null,'33000000-0000-4000-8000-000000000201'
);
insert into accommodation_test_baselines
select 'remote-delete',updated_at from public.trip_accommodations
where id = '33000000-0000-4000-8000-000000000304';

-- Another member deletes the edited row. A stale save updates zero rows and
-- the voucher RPC reports missing instead of recreating anything.
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
delete from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000304';
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000002',true);
do $$
declare affected integer;
begin
  update public.trip_accommodations set name = 'Must not reappear'
  where id = '33000000-0000-4000-8000-000000000304'
    and trip_id = '33000000-0000-4000-8000-000000000101'
    and updated_at = (select version from accommodation_test_baselines where label = 'remote-delete');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'stale save recreated a deleted accommodation'; end if;
end;
$$;
select pg_temp.expect_failure('voucher sync after remote accommodation delete', $sql$
  select public.sync_trip_accommodation_voucher(
    '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000304',
    (select version from accommodation_test_baselines where label = 'remote-delete'),
    '33000000-0000-4000-8000-000000000201',null
  )
$sql$,'P0002');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000003',true);
do $$
declare affected integer;
begin
  if exists (select 1 from public.trip_accommodations where trip_id = '33000000-0000-4000-8000-000000000101') then raise exception 'non-member SELECT leaked rows'; end if;
  if exists (select 1 from public.trip_accommodation_documents where trip_id = '33000000-0000-4000-8000-000000000101') then raise exception 'non-member SELECT leaked voucher relations'; end if;

  update public.trip_accommodations set name = 'Outsider update' where id = '33000000-0000-4000-8000-000000000302';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'non-member UPDATE affected % rows', affected; end if;

  delete from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000302';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'non-member DELETE affected % rows', affected; end if;

end;
$$;
select pg_temp.expect_failure('non-member insert', $sql$
  insert into public.trip_accommodations (trip_id,accommodation_type,name,time_zone,created_by)
  values ('33000000-0000-4000-8000-000000000101','hotel','Outsider insert','Europe/Madrid','33000000-0000-4000-8000-000000000003')
$sql$);
select pg_temp.expect_failure('non-member voucher RPC', $sql$
  select public.sync_trip_accommodation_voucher(
    '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000302',
    statement_timestamp(),
    '33000000-0000-4000-8000-000000000201',null
  )
$sql$,'42501');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000004',true);
insert into public.trip_accommodations (id,trip_id,accommodation_type,name,time_zone,created_by)
values ('33000000-0000-4000-8000-000000000305','33000000-0000-4000-8000-000000000101','resort','Stay kept after user deletion','Europe/Madrid','33000000-0000-4000-8000-000000000004');
select public.sync_trip_accommodation_voucher(
  '33000000-0000-4000-8000-000000000101','33000000-0000-4000-8000-000000000305',
  (select updated_at from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000305'),
  null,'33000000-0000-4000-8000-000000000201'
);
reset role;
select set_config('request.jwt.claim.sub','',true);
delete from auth.users where id = '33000000-0000-4000-8000-000000000004';

do $$
begin
  if not exists (
    select 1 from public.trip_accommodations
    where id = '33000000-0000-4000-8000-000000000305'
      and created_by is null
  ) then raise exception 'deleting creator deleted accommodation or did not null creator'; end if;
  if not exists (
    select 1 from public.trip_accommodation_documents
    where accommodation_id = '33000000-0000-4000-8000-000000000305'
      and created_by is null
  ) then raise exception 'deleting creator deleted voucher relation or did not null creator'; end if;
end;
$$;

select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000001',true);
insert into public.trip_accommodations (id,trip_id,accommodation_type,name,time_zone,created_by)
values ('33000000-0000-4000-8000-000000000306','33000000-0000-4000-8000-000000000102','hotel','Cascade test','Europe/London','33000000-0000-4000-8000-000000000001');
delete from public.trips where id = '33000000-0000-4000-8000-000000000102';

do $$
begin
  if exists (select 1 from public.trip_accommodations where id = '33000000-0000-4000-8000-000000000306') then raise exception 'trip delete did not cascade'; end if;

  if has_table_privilege('anon','public.trip_accommodations','select')
     or has_table_privilege('anon','public.trip_accommodations','insert')
     or has_table_privilege('anon','public.trip_accommodations','update')
     or has_table_privilege('anon','public.trip_accommodations','delete')
     or has_table_privilege('anon','public.trip_accommodation_documents','select')
     or has_table_privilege('anon','public.trip_accommodation_documents','insert')
     or has_table_privilege('anon','public.trip_accommodation_documents','update')
     or has_table_privilege('anon','public.trip_accommodation_documents','delete') then
    raise exception 'anon unexpectedly has accommodation table privileges';
  end if;

  if has_table_privilege('authenticated','public.trip_accommodation_documents','insert')
     or has_table_privilege('authenticated','public.trip_accommodation_documents','update')
     or has_table_privilege('authenticated','public.trip_accommodation_documents','delete') then
    raise exception 'authenticated can bypass atomic voucher synchronization';
  end if;

  if not has_table_privilege('authenticated','public.trip_accommodation_documents','select')
     or not has_function_privilege(
       'authenticated',
       'public.sync_trip_accommodation_voucher(uuid,uuid,timestamptz,uuid,uuid)',
       'execute'
     ) then
    raise exception 'authenticated lacks voucher read or RPC access';
  end if;

  if has_function_privilege(
       'anon',
       'public.sync_trip_accommodation_voucher(uuid,uuid,timestamptz,uuid,uuid)',
       'execute'
     ) then
    raise exception 'anon unexpectedly has voucher RPC access';
  end if;
end;
$$;

rollback;

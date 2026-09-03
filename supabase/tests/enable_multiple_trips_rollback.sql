begin;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'multi-trip-owner@example.invalid',
    '',
    statement_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '30000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'multi-trip-member@example.invalid',
    '',
    statement_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  );

create temporary table phase3a_created_trips (
  id uuid primary key,
  name text not null,
  invite_code text not null,
  owner_id uuid not null,
  start_date date not null,
  end_date date not null,
  time_zone text not null,
  experience_key text
) on commit drop;

grant select, insert on table phase3a_created_trips to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-4000-8000-000000000001',
  true
);

insert into phase3a_created_trips
select *
from public.create_trip_v2(
  'Primer viatge de prova',
  date '2026-09-09',
  date '2026-09-13',
  'Europe/Madrid'
);

insert into phase3a_created_trips
select *
from public.create_trip_v2(
  'Segon viatge de prova',
  date '2027-02-01',
  date '2027-02-04',
  'Europe/Madrid'
);

do $$
declare
  created_trip_count integer;
  owned_trip_count integer;
  membership_count integer;
  listed_trip_count integer;
  invalid_dates_rejected boolean := false;
  invalid_timezone_rejected boolean := false;
begin
  select count(*) into created_trip_count
  from phase3a_created_trips;

  if created_trip_count <> 2 then
    raise exception 'create_trip_v2 returned % trips, expected 2', created_trip_count;
  end if;

  select count(*) into owned_trip_count
  from public.trips as trip
  join phase3a_created_trips as created on created.id = trip.id
  where trip.owner_id = '30000000-0000-4000-8000-000000000001';

  if owned_trip_count <> 2 then
    raise exception 'owner has % created trips, expected 2', owned_trip_count;
  end if;

  select count(*) into membership_count
  from public.trip_members as membership
  join phase3a_created_trips as created on created.id = membership.trip_id
  where membership.user_id = '30000000-0000-4000-8000-000000000001';

  if membership_count <> 2 then
    raise exception 'owner has % memberships, expected 2', membership_count;
  end if;

  select count(*) into listed_trip_count
  from public.get_my_trips() as trip
  join phase3a_created_trips as created on created.id = trip.id;

  if listed_trip_count <> 2 then
    raise exception 'get_my_trips returned % created trips, expected 2', listed_trip_count;
  end if;

  if not exists (
    select 1
    from public.get_my_trips() as trip
    where trip.name = 'Primer viatge de prova'
      and trip.start_date = date '2026-09-09'
      and trip.end_date = date '2026-09-13'
      and trip.time_zone = 'Europe/Madrid'
      and trip.is_owner
  ) then
    raise exception 'Europe/Madrid trip metadata was not returned correctly';
  end if;

  begin
    perform public.create_trip_v2(
      'Dates invertides',
      date '2026-09-13',
      date '2026-09-09',
      'Europe/Madrid'
    );
  exception when others then
    invalid_dates_rejected := true;
  end;

  if not invalid_dates_rejected then
    raise exception 'create_trip_v2 accepted inverted dates';
  end if;

  begin
    perform public.create_trip_v2(
      'Zona invàlida',
      date '2026-09-09',
      date '2026-09-13',
      'Europe/Not-A-Real-Zone'
    );
  exception when others then
    invalid_timezone_rejected := true;
  end;

  if not invalid_timezone_rejected then
    raise exception 'create_trip_v2 accepted an invalid time zone';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-4000-8000-000000000002',
  true
);

select public.join_trip_v2(created.invite_code)
from phase3a_created_trips as created
where created.name = 'Primer viatge de prova';

select public.join_trip_v2(created.invite_code)
from phase3a_created_trips as created
where created.name = 'Primer viatge de prova';

do $$
declare
  joined_trip_id uuid;
  repeated_membership_count integer;
begin
  select created.id into joined_trip_id
  from phase3a_created_trips as created
  where created.name = 'Primer viatge de prova';

  select count(*) into repeated_membership_count
  from public.trip_members as membership
  where membership.trip_id = joined_trip_id
    and membership.user_id = '30000000-0000-4000-8000-000000000002';

  if repeated_membership_count <> 1 then
    raise exception 'repeated join created % memberships, expected 1', repeated_membership_count;
  end if;

  if to_regprocedure('public.create_trip(text)') is null
     or to_regprocedure('public.get_my_trip()') is null
     or to_regprocedure('public.join_trip(text)') is null then
    raise exception 'one or more legacy RPCs are missing';
  end if;

  raise notice 'enable_multiple_trips rollback test passed';
end;
$$;

rollback;

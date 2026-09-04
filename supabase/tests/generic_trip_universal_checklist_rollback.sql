begin;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.travel_documents'::regclass
      and relation.relreplident = 'f'
  ) then
    raise exception 'travel_documents replica identity is not FULL';
  end if;
end;
$$;

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
    '31000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'generic-checklist-owner@example.invalid',
    '',
    statement_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '31000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'generic-checklist-outsider@example.invalid',
    '',
    statement_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  );

create temporary table created_generic_trip (
  id uuid primary key,
  name text not null,
  invite_code text not null,
  owner_id uuid not null,
  start_date date not null,
  end_date date not null,
  time_zone text not null,
  experience_key text
) on commit drop;

grant select, insert on table created_generic_trip to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '31000000-0000-4000-8000-000000000001',
  true
);

insert into created_generic_trip
select *
from public.create_trip_v2(
  'Viatge genèric amb defaults',
  date '2027-05-01',
  date '2027-05-05',
  'Europe/Madrid'
);

do $$
declare
  invalid_dates_rejected boolean := false;
  invalid_timezone_rejected boolean := false;
begin
  begin
    perform public.create_trip_v2(
      'Dates invertides',
      date '2027-05-05',
      date '2027-05-01',
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
      date '2027-05-01',
      date '2027-05-05',
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

reset role;

do $$
declare
  created_trip_id uuid;
  template_count integer;
  duplicate_rejected boolean := false;
begin
  select trip.id into created_trip_id
  from created_generic_trip as trip;

  select count(*) into template_count
  from public.checklist_items as item
  where item.trip_id = created_trip_id
    and item.template_key is not null;

  if template_count <> 10 then
    raise exception 'create_trip_v2 inserted % template items, expected 10', template_count;
  end if;

  if exists (
    with expected(template_key, category, text) as (
      values
        ('universal-documents-review-personal', 'documents', 'Revisar documentació personal necessària'),
        ('universal-documents-save-copies', 'documents', 'Guardar còpies dels documents importants'),
        ('universal-luggage-prepare', 'luggage', 'Preparar l''equipatge'),
        ('universal-luggage-review-restrictions', 'luggage', 'Revisar les restriccions d''equipatge'),
        ('universal-health-prepare-medication', 'health', 'Preparar medicació personal necessària'),
        ('universal-money-review-payment-methods', 'money', 'Revisar targetes i mitjans de pagament'),
        ('universal-technology-prepare-devices', 'technology', 'Preparar mòbil, carregadors i adaptadors necessaris'),
        ('universal-transport-review-bookings', 'transport', 'Revisar les reserves de transport'),
        ('universal-reservations-review-trip', 'reservations', 'Revisar les reserves del viatge'),
        ('universal-home-prepare-before-leaving', 'home', 'Deixar la casa preparada abans de marxar')
    ), mismatches as (
      (
        select expected.template_key, expected.category, expected.text
        from expected
        except
        select item.template_key, item.category, item.text
        from public.checklist_items as item
        where item.trip_id = created_trip_id
          and item.template_key is not null
          and not item.dismissed
      )
      union all
      (
        select item.template_key, item.category, item.text
        from public.checklist_items as item
        where item.trip_id = created_trip_id
          and item.template_key is not null
          and not item.dismissed
        except
        select expected.template_key, expected.category, expected.text
        from expected
      )
    )
    select 1 from mismatches
  ) then
    raise exception 'universal template tuples do not match the expected baseline';
  end if;

  if exists (
    select 1
    from public.checklist_items as item
    where item.trip_id = created_trip_id
      and (
        item.category not in (
          'documents', 'luggage', 'health', 'money', 'technology',
          'transport', 'reservations', 'home'
        )
        or lower(item.text) similar to '%(piki|ghost|stansted|london|eta|esim|eivissa|formentera)%'
      )
  ) then
    raise exception 'universal template contains an invalid category or contextual text';
  end if;

  if exists (
    select 1
    from public.checklist_items as item
    where item.trip_id = created_trip_id
      and item.category = 'other'
      and item.template_key is not null
  ) then
    raise exception 'universal template unexpectedly inserted an Other item';
  end if;

  begin
    insert into public.checklist_items (
      trip_id, text, category, template_key, created_by
    ) values (
      created_trip_id,
      'Intent de duplicat',
      'documents',
      'universal-documents-review-personal',
      '31000000-0000-4000-8000-000000000001'
    );
  exception when unique_violation then
    duplicate_rejected := true;
  end;

  if not duplicate_rejected then
    raise exception 'database uniqueness did not reject a duplicate template key';
  end if;
end;
$$;

insert into public.trips (
  id, name, owner_id, start_date, end_date, time_zone
) values (
  '31000000-0000-4000-8000-000000000101',
  'Viatge genèric existent',
  '31000000-0000-4000-8000-000000000001',
  date '2027-06-01',
  date '2027-06-04',
  'Europe/Madrid'
);

insert into public.trip_members (trip_id, user_id)
values (
  '31000000-0000-4000-8000-000000000101',
  '31000000-0000-4000-8000-000000000001'
);

insert into public.checklist_items (
  id, trip_id, text, done, created_by
) values (
  '31000000-0000-4000-8000-000000000201',
  '31000000-0000-4000-8000-000000000101',
  'Element creat per la persona usuària',
  true,
  '31000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '31000000-0000-4000-8000-000000000001',
  true
);

select public.initialize_generic_trip_checklist(
  '31000000-0000-4000-8000-000000000101'
);
select public.initialize_generic_trip_checklist(
  '31000000-0000-4000-8000-000000000101'
);

update public.checklist_items
set dismissed = true
where trip_id = '31000000-0000-4000-8000-000000000101'
  and template_key = 'universal-luggage-prepare';

select public.initialize_generic_trip_checklist(
  '31000000-0000-4000-8000-000000000101'
);

reset role;

do $$
declare
  template_count integer;
  visible_template_count integer;
begin
  select count(*) into template_count
  from public.checklist_items as item
  where item.trip_id = '31000000-0000-4000-8000-000000000101'
    and item.template_key is not null;

  if template_count <> 10 then
    raise exception 'repeated initialization left % template items, expected 10', template_count;
  end if;

  select count(*) into visible_template_count
  from public.checklist_items as item
  where item.trip_id = '31000000-0000-4000-8000-000000000101'
    and item.template_key is not null
    and not item.dismissed;

  if visible_template_count <> 9 then
    raise exception 'dismissed template reappeared; visible count was %, expected 9', visible_template_count;
  end if;

  if not exists (
    select 1
    from public.checklist_items as item
    where item.trip_id = '31000000-0000-4000-8000-000000000101'
      and item.template_key = 'universal-luggage-prepare'
      and item.dismissed
  ) then
    raise exception 'explicitly dismissed universal template was not preserved as a tombstone';
  end if;

  if not exists (
    select 1
    from public.checklist_items as item
    where item.id = '31000000-0000-4000-8000-000000000201'
      and item.text = 'Element creat per la persona usuària'
      and item.done
      and item.category is null
      and item.template_key is null
      and not item.dismissed
  ) then
    raise exception 'existing user checklist item was changed or removed';
  end if;
end;
$$;

insert into public.trips (
  id, name, owner_id, start_date, end_date, time_zone, experience_key
) values (
  '31000000-0000-4000-8000-000000000102',
  'London compatibility test',
  '31000000-0000-4000-8000-000000000001',
  date '2027-07-01',
  date '2027-07-04',
  'Europe/London',
  'london-2026'
);

insert into public.trip_members (trip_id, user_id)
values (
  '31000000-0000-4000-8000-000000000102',
  '31000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '31000000-0000-4000-8000-000000000001',
  true
);

do $$
begin
  if public.initialize_generic_trip_checklist(
    '31000000-0000-4000-8000-000000000102'
  ) <> 0 then
    raise exception 'London initializer did not return zero';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '31000000-0000-4000-8000-000000000002',
  true
);

do $$
declare
  nonmember_rejected boolean := false;
begin
  begin
    perform public.initialize_generic_trip_checklist(
      '31000000-0000-4000-8000-000000000101'
    );
  exception when insufficient_privilege then
    nonmember_rejected := true;
  end;

  if not nonmember_rejected then
    raise exception 'non-member was allowed to initialize another trip';
  end if;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.checklist_items as item
    where item.trip_id = '31000000-0000-4000-8000-000000000102'
      and item.template_key is not null
  ) then
    raise exception 'universal defaults were inserted into London';
  end if;

  raise notice 'generic trip universal checklist rollback test passed';
end;
$$;

rollback;

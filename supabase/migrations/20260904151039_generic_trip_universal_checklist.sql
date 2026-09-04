alter table public.checklist_items
  add column category text,
  add column template_key text,
  add column dismissed boolean not null default false,
  add constraint checklist_items_category_not_blank
    check (
      category is null
      or (
        category = btrim(category)
        and char_length(category) between 1 and 50
      )
    ),
  add constraint checklist_items_template_key_not_blank
    check (
      template_key is null
      or (
        template_key = btrim(template_key)
        and char_length(template_key) between 1 and 100
      )
    );

create unique index checklist_items_trip_template_key_idx
  on public.checklist_items (trip_id, template_key)
  where template_key is not null;

-- Required for filtered Postgres Changes DELETE events on documents/photos.
-- With RLS, clients may still receive only the primary key in payload.old, so
-- the frontend deliberately reloads both views when the deleted category is absent.
alter table public.travel_documents replica identity full;

create function public.initialize_generic_trip_checklist(p_trip_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  target_experience_key text;
  inserted_count integer;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.trip_members as membership
    where membership.trip_id = p_trip_id
      and membership.user_id = authenticated_user_id
  ) then
    raise exception 'No formes part d’aquest viatge'
      using errcode = '42501';
  end if;

  select trip.experience_key
  into target_experience_key
  from public.trips as trip
  where trip.id = p_trip_id;

  if target_experience_key = 'london-2026' then
    return 0;
  end if;

  insert into public.checklist_items (
    trip_id,
    text,
    category,
    template_key,
    created_by
  )
  values
    (
      p_trip_id,
      'Revisar documentació personal necessària',
      'documents',
      'universal-documents-review-personal',
      authenticated_user_id
    ),
    (
      p_trip_id,
      'Guardar còpies dels documents importants',
      'documents',
      'universal-documents-save-copies',
      authenticated_user_id
    ),
    (
      p_trip_id,
      'Preparar l''equipatge',
      'luggage',
      'universal-luggage-prepare',
      authenticated_user_id
    ),
    (
      p_trip_id,
      'Revisar les restriccions d''equipatge',
      'luggage',
      'universal-luggage-review-restrictions',
      authenticated_user_id
    ),
    (
      p_trip_id,
      'Preparar medicació personal necessària',
      'health',
      'universal-health-prepare-medication',
      authenticated_user_id
    ),
    (
      p_trip_id,
      'Revisar targetes i mitjans de pagament',
      'money',
      'universal-money-review-payment-methods',
      authenticated_user_id
    ),
    (
      p_trip_id,
      'Preparar mòbil, carregadors i adaptadors necessaris',
      'technology',
      'universal-technology-prepare-devices',
      authenticated_user_id
    ),
    (
      p_trip_id,
      'Revisar les reserves de transport',
      'transport',
      'universal-transport-review-bookings',
      authenticated_user_id
    ),
    (
      p_trip_id,
      'Revisar les reserves del viatge',
      'reservations',
      'universal-reservations-review-trip',
      authenticated_user_id
    ),
    (
      p_trip_id,
      'Deixar la casa preparada abans de marxar',
      'home',
      'universal-home-prepare-before-leaving',
      authenticated_user_id
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.initialize_generic_trip_checklist(uuid)
  from public, anon, authenticated;
grant execute on function public.initialize_generic_trip_checklist(uuid)
  to authenticated;

create or replace function public.create_trip_v2(
  p_name text,
  p_start_date date,
  p_end_date date,
  p_time_zone text
)
returns table (
  id uuid,
  name text,
  invite_code text,
  owner_id uuid,
  start_date date,
  end_date date,
  time_zone text,
  experience_key text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  normalized_name text := btrim(p_name);
  normalized_time_zone text := btrim(p_time_zone);
  created_trip public.trips%rowtype;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 1 and 100 then
    raise exception 'El nom del viatge ha de tenir entre 1 i 100 caràcters';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'Les dates d’inici i fi són obligatòries';
  end if;

  if p_end_date < p_start_date then
    raise exception 'La data de fi no pot ser anterior a la data d’inici';
  end if;

  if normalized_time_zone is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = normalized_time_zone
     ) then
    raise exception 'La zona horària no és una zona IANA vàlida';
  end if;

  insert into public.trips (
    name,
    owner_id,
    start_date,
    end_date,
    time_zone
  )
  values (
    normalized_name,
    authenticated_user_id,
    p_start_date,
    p_end_date,
    normalized_time_zone
  )
  returning * into created_trip;

  insert into public.trip_members (trip_id, user_id)
  values (created_trip.id, authenticated_user_id);

  perform public.initialize_generic_trip_checklist(created_trip.id);

  return query
  select
    created_trip.id,
    created_trip.name,
    created_trip.invite_code,
    created_trip.owner_id,
    created_trip.start_date,
    created_trip.end_date,
    created_trip.time_zone,
    created_trip.experience_key;
end;
$$;

revoke all on function public.create_trip_v2(text, date, date, text)
  from public, anon, authenticated;
grant execute on function public.create_trip_v2(text, date, date, text)
  to authenticated;

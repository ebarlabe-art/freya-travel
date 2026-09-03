alter table public.trips
  add column start_date date,
  add column end_date date,
  add column experience_key text,
  add constraint trips_dates_both_null_or_present
    check (
      (start_date is null and end_date is null)
      or (start_date is not null and end_date is not null)
    ),
  add constraint trips_end_date_not_before_start_date
    check (start_date is null or end_date >= start_date),
  add constraint trips_experience_key_not_blank
    check (
      experience_key is null
      or (
        experience_key = btrim(experience_key)
        and char_length(experience_key) between 1 and 50
      )
    );

create index trip_members_user_id_idx
  on public.trip_members (user_id);

create function public.create_trip_v2(
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

create function public.get_my_trips()
returns table (
  id uuid,
  name text,
  invite_code text,
  owner_id uuid,
  start_date date,
  end_date date,
  time_zone text,
  experience_key text,
  is_owner boolean,
  member_since timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    trip.id,
    trip.name,
    trip.invite_code,
    trip.owner_id,
    trip.start_date,
    trip.end_date,
    trip.time_zone,
    trip.experience_key,
    trip.owner_id = auth.uid() as is_owner,
    membership.created_at as member_since
  from public.trip_members as membership
  join public.trips as trip
    on trip.id = membership.trip_id
  where membership.user_id = auth.uid()
  order by membership.created_at, trip.id;
$$;

create function public.join_trip_v2(p_invite_code text)
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
  normalized_invite_code text := upper(btrim(p_invite_code));
  joined_trip public.trips%rowtype;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió';
  end if;

  if normalized_invite_code is null or normalized_invite_code = '' then
    raise exception 'Escriu un codi d’invitació';
  end if;

  select trip.*
  into joined_trip
  from public.trips as trip
  where trip.invite_code = normalized_invite_code;

  if joined_trip.id is null then
    raise exception 'Codi incorrecte';
  end if;

  insert into public.trip_members (trip_id, user_id)
  values (joined_trip.id, authenticated_user_id)
  on conflict (trip_id, user_id) do nothing;

  return query
  select
    joined_trip.id,
    joined_trip.name,
    joined_trip.invite_code,
    joined_trip.owner_id,
    joined_trip.start_date,
    joined_trip.end_date,
    joined_trip.time_zone,
    joined_trip.experience_key;
end;
$$;

revoke all on function public.create_trip_v2(text, date, date, text)
  from public, anon, authenticated;
revoke all on function public.get_my_trips()
  from public, anon, authenticated;
revoke all on function public.join_trip_v2(text)
  from public, anon, authenticated;

grant execute on function public.create_trip_v2(text, date, date, text)
  to authenticated;
grant execute on function public.get_my_trips()
  to authenticated;
grant execute on function public.join_trip_v2(text)
  to authenticated;

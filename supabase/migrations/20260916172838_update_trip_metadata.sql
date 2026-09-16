-- Trip metadata editing for generic trips.
-- Only the trip owner may edit name, dates and destination time zone.
-- London 2026 keeps its legacy behavior untouched.

drop policy if exists "owners can update generic trips" on public.trips;

create policy "owners can update generic trips"
on public.trips
for update
to authenticated
using (
  (select auth.uid()) = owner_id
  and experience_key is distinct from 'london-2026'
)
with check (
  (select auth.uid()) = owner_id
  and experience_key is distinct from 'london-2026'
);

-- Do not expose unrestricted UPDATE access to authenticated clients.
-- Only these four metadata columns may be changed directly or through
-- SECURITY INVOKER functions.
revoke update on table public.trips from anon, authenticated;

grant update (name, start_date, end_date, time_zone)
on table public.trips
to authenticated;

create or replace function public.update_trip_v1(
  p_trip_id uuid,
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
security invoker
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  normalized_name text := btrim(p_name);
  normalized_time_zone text := btrim(p_time_zone);
  updated_trip public.trips%rowtype;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió'
      using errcode = '42501';
  end if;

  if p_trip_id is null then
    raise exception 'El viatge és obligatori';
  end if;

  if normalized_name is null
     or char_length(normalized_name) not between 1 and 100 then
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

  update public.trips
  set
    name = normalized_name,
    start_date = p_start_date,
    end_date = p_end_date,
    time_zone = normalized_time_zone
  where public.trips.id = p_trip_id
    and public.trips.owner_id = authenticated_user_id
    and public.trips.experience_key is distinct from 'london-2026'
  returning public.trips.*
  into updated_trip;

  if not found then
    raise exception 'Només la persona propietària pot editar aquest viatge'
      using errcode = '42501';
  end if;

  return query
  select
    updated_trip.id,
    updated_trip.name,
    updated_trip.invite_code,
    updated_trip.owner_id,
    updated_trip.start_date,
    updated_trip.end_date,
    updated_trip.time_zone,
    updated_trip.experience_key;
end;
$$;

revoke all on function public.update_trip_v1(uuid, text, date, date, text)
from public, anon, authenticated;

grant execute on function public.update_trip_v1(uuid, text, date, date, text)
to authenticated;

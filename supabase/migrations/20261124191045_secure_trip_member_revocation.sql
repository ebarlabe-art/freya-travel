-- A3.2: atomically revoke access and rotate the invitation for a generic trip.
-- NOT APPLIED. Production schema changes require separate explicit authorization.
-- The current and legacy join RPCs must lock the trip row, preventing old-code
-- joins from racing with revocation of a member.

create or replace function public.join_trip_v2(p_invite_code text)
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
  where trip.invite_code = normalized_invite_code
  for update;

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

create or replace function public.join_trip(p_invite_code text)
returns table(id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  if auth.uid() is null then
    raise exception 'Cal iniciar sessió';
  end if;

  -- Preserve the validation already used by the live legacy RPC.
  if trim(coalesce(p_invite_code, '')) = '' then
    raise exception 'Escriu el codi d’invitació';
  end if;

  if exists (
    select 1 from public.trip_members m
    where m.user_id = auth.uid()
  ) then
    raise exception 'Ja formes part d’un viatge';
  end if;

  select t.*
  into v_trip
  from public.trips t
  where t.invite_code = upper(trim(p_invite_code))
  for update;

  if v_trip.id is null then
    raise exception 'Codi incorrecte';
  end if;

  insert into public.trip_members (trip_id, user_id)
  values (v_trip.id, auth.uid());

  return query
  select v_trip.id, v_trip.name, v_trip.invite_code;
end;
$$;

create function public.revoke_trip_member_v1(p_trip_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  locked_trip public.trips%rowtype;
  removed_id uuid;
  replacement_code text;
begin
  if actor is null then
    raise exception 'Cal iniciar sessió' using errcode='42501';
  end if;
  if p_trip_id is null or p_user_id is null then
    raise exception 'Indica el viatge i el participant' using errcode='22023';
  end if;

  -- Locking order matches join_trip and join_trip_v2, and serializes removal.
  select t.* into locked_trip from public.trips t
    where t.id = p_trip_id for update;
  if locked_trip.id is null or locked_trip.owner_id <> actor then
    raise exception 'Només l’organitzador pot retirar participants' using errcode='42501';
  end if;
  if locked_trip.experience_key = 'london-2026' then
    raise exception 'Aquesta gestió és per a viatges genèrics' using errcode='22023';
  end if;
  if p_user_id = locked_trip.owner_id then
    raise exception 'No es pot retirar la persona organitzadora' using errcode='22023';
  end if;

  delete from public.trip_members
    where trip_id = p_trip_id and user_id = p_user_id
    returning user_id into removed_id;
  if removed_id is null then
    raise exception 'Aquest participant ja no forma part del viatge' using errcode='22023';
  end if;

  -- A fresh random UUID supplies 122 random bits; do not reuse any prior code.
  update public.trips set invite_code = upper(replace(pg_catalog.gen_random_uuid()::text, '-', ''))
    where id = p_trip_id returning invite_code into replacement_code;
  return replacement_code;
end;
$$;

revoke all on function public.revoke_trip_member_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.revoke_trip_member_v1(uuid,uuid) to authenticated;
-- No DELETE on expense/settlement tables. Historical accounting survives.

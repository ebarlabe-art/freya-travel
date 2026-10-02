alter table public.trips
  add column if not exists discarded_at timestamptz,
  add column if not exists discarded_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='trips_discard_pair' and conrelid='public.trips'::regclass
  ) then
    alter table public.trips
      add constraint trips_discard_pair
      check ((discarded_at is null)=(discarded_by is null));
  end if;
end $$;

create or replace function public.get_my_trips()
returns table(id uuid,name text,invite_code text,owner_id uuid,start_date date,end_date date,time_zone text,experience_key text,is_owner boolean,member_since timestamptz)
language sql stable set search_path=''
as $$
  select trip.id,trip.name,trip.invite_code,trip.owner_id,trip.start_date,trip.end_date,trip.time_zone,trip.experience_key,
    trip.owner_id=auth.uid() as is_owner,membership.created_at as member_since
  from public.trip_members membership
  join public.trips trip on trip.id=membership.trip_id
  where membership.user_id=auth.uid()
    and trip.discarded_at is null
  order by membership.created_at,trip.id;
$$;

create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql stable security definer set search_path='public'
as $$
  select exists(
    select 1
    from public.trip_members membership
    join public.trips trip on trip.id=membership.trip_id
    where membership.trip_id=p_trip_id
      and membership.user_id=auth.uid()
      and trip.discarded_at is null
  );
$$;

create or replace function public.discard_construction_trip_v1(p_trip_id uuid)
returns boolean
language plpgsql
set search_path=''
as $$
declare
  authenticated_user_id uuid:=auth.uid();
  affected integer;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió' using errcode='42501';
  end if;

  update public.trips t
  set discarded_at=clock_timestamp(),discarded_by=authenticated_user_id
  where t.id=p_trip_id
    and t.owner_id=authenticated_user_id
    and t.discarded_at is null
    and t.start_date is null
    and t.end_date is null
    and t.experience_key is distinct from 'london-2026'
    and exists(select 1 from public.trip_proposal_handoffs h where h.trip_id=t.id);

  get diagnostics affected=row_count;
  if affected<>1 then
    raise exception 'Aquest viatge no es pot eliminar des d’En construcció' using errcode='42501';
  end if;
  return true;
end;
$$;

revoke all on function public.discard_construction_trip_v1(uuid) from public,anon,authenticated;
grant execute on function public.discard_construction_trip_v1(uuid) to authenticated;

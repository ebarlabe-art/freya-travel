create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create or replace function app_private.discard_construction_trip_v1(p_trip_id uuid)
returns boolean
language plpgsql
security definer
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

revoke all on function app_private.discard_construction_trip_v1(uuid) from public,anon,authenticated;
grant execute on function app_private.discard_construction_trip_v1(uuid) to authenticated;

create or replace function public.discard_construction_trip_v1(p_trip_id uuid)
returns boolean
language sql
security invoker
set search_path=''
as $$
  select app_private.discard_construction_trip_v1(p_trip_id);
$$;

revoke all on function public.discard_construction_trip_v1(uuid) from public,anon,authenticated;
grant execute on function public.discard_construction_trip_v1(uuid) to authenticated;

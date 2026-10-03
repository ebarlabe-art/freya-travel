create or replace function public.ensure_trip_flight_travelers(
  p_trip_id uuid,
  p_flight_ids uuid[],
  p_names text[]
)
returns table(traveler_id uuid,display_name text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_name text;
  v_traveler uuid;
  v_flight uuid;
begin
  if v_user is null or not public.is_trip_member(p_trip_id) then
    raise exception 'No autoritzat' using errcode='42501';
  end if;

  foreach v_name in array coalesce(p_names,array[]::text[]) loop
    v_name:=btrim(v_name);
    if v_name='' then continue; end if;

    select tt.id
      into v_traveler
      from public.trip_travelers as tt
     where tt.trip_id=p_trip_id
       and lower(tt.display_name)=lower(v_name);

    if v_traveler is null then
      insert into public.trip_travelers(trip_id,display_name,created_by)
      values(p_trip_id,v_name,v_user)
      returning id into v_traveler;
    end if;

    foreach v_flight in array coalesce(p_flight_ids,array[]::uuid[]) loop
      if not exists(
        select 1
          from public.trip_flights as tf
         where tf.trip_id=p_trip_id
           and tf.id=v_flight
      ) then
        raise exception 'Vol fora del viatge' using errcode='23503';
      end if;

      insert into public.trip_flight_travelers(trip_id,flight_id,traveler_id,created_by)
      values(p_trip_id,v_flight,v_traveler,v_user)
      on conflict do nothing;
    end loop;

    traveler_id:=v_traveler;
    display_name:=v_name;
    return next;
  end loop;
end $$;

revoke all on function public.ensure_trip_flight_travelers(uuid,uuid[],text[]) from public,anon;
grant execute on function public.ensure_trip_flight_travelers(uuid,uuid[],text[]) to authenticated;

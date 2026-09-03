do $$
declare
  london_trip_id constant uuid := '9035e47f-f16c-4fa3-83fd-873bd98dc221';
  london_experience_key constant text := 'london-2026';
  target_trip_count integer;
  conflicting_trip_count integer;
  updated_trip_count integer;
  verified_trip_count integer;
begin
  select count(*)
  into target_trip_count
  from public.trips as trip
  where trip.id = london_trip_id;

  if target_trip_count <> 1 then
    raise exception
      'London trip precondition failed: expected exactly one target trip, found %',
      target_trip_count;
  end if;

  select count(*)
  into conflicting_trip_count
  from public.trips as trip
  where trip.experience_key = london_experience_key
    and trip.id <> london_trip_id;

  if conflicting_trip_count <> 0 then
    raise exception
      'London trip precondition failed: experience key is already assigned to another trip';
  end if;

  if exists (
    select 1
    from public.trips as trip
    where trip.id = london_trip_id
      and trip.experience_key is not null
      and trip.experience_key <> london_experience_key
  ) then
    raise exception
      'London trip precondition failed: target trip has a different experience key';
  end if;

  update public.trips as trip
  set experience_key = london_experience_key
  where trip.id = london_trip_id;

  get diagnostics updated_trip_count = row_count;

  if updated_trip_count <> 1 then
    raise exception
      'London trip update failed: expected exactly one updated row, found %',
      updated_trip_count;
  end if;

  select count(*)
  into verified_trip_count
  from public.trips as trip
  where trip.id = london_trip_id
    and trip.experience_key = london_experience_key;

  if verified_trip_count <> 1 then
    raise exception
      'London trip verification failed: target trip does not have the expected experience key';
  end if;

  select count(*)
  into verified_trip_count
  from public.trips as trip
  where trip.experience_key = london_experience_key;

  if verified_trip_count <> 1 then
    raise exception
      'London trip verification failed: experience key is not assigned exclusively to the target trip';
  end if;
end;
$$;

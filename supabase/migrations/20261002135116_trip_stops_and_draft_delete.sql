create table public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  position integer not null check (position between 1 and 20),
  label text not null check (label=btrim(label) and char_length(label) between 1 and 120),
  canonical_name text not null check (canonical_name=btrim(canonical_name) and char_length(canonical_name) between 1 and 500),
  administrative_area text check (administrative_area is null or (administrative_area=btrim(administrative_area) and char_length(administrative_area) between 1 and 200)),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  time_zone text not null check (time_zone=btrim(time_zone) and char_length(time_zone) between 1 and 100),
  provider text not null check (provider='geoapify'),
  provider_place_id text not null check (provider_place_id=btrim(provider_place_id) and char_length(provider_place_id) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  unique (trip_id, position),
  unique (trip_id, provider, provider_place_id)
);
create index trip_stops_trip_position_idx on public.trip_stops(trip_id,position);

alter table public.trip_stops enable row level security;
create policy trip_stops_member_read on public.trip_stops for select to authenticated
  using (public.is_trip_member(trip_id));
create policy trip_stops_owner_write on public.trip_stops for all to authenticated
  using (exists(select 1 from public.trips t where t.id=trip_id and t.owner_id=(select auth.uid())))
  with check (exists(select 1 from public.trips t where t.id=trip_id and t.owner_id=(select auth.uid())));
grant select,insert,update,delete on public.trip_stops to authenticated;

create policy brief_owner_delete on public.trip_briefs for delete to authenticated
  using (owner_id=(select auth.uid()) and trip_id is null);
grant delete on public.trip_briefs to authenticated;

create function public.create_trip_with_stops_v1(p_name text,p_start_date date,p_end_date date,p_stops jsonb)
returns table (id uuid,name text,invite_code text,owner_id uuid,start_date date,end_date date,time_zone text,experience_key text)
language plpgsql security definer set search_path='' as $$
declare
  authenticated_user_id uuid := auth.uid();
  stop_count integer; stop_row jsonb; stop_index integer := 0;
  stop_name text; stop_label text; stop_timezone text; stop_provider text; stop_provider_place_id text;
  stop_admin text; stop_country text; stop_lat double precision; stop_lon double precision;
  first_timezone text; created_trip record;
begin
  if authenticated_user_id is null then raise exception 'Cal iniciar sessió' using errcode='42501'; end if;
  if p_stops is null or jsonb_typeof(p_stops)<>'array' then raise exception 'Cal indicar almenys una destinació'; end if;
  stop_count:=jsonb_array_length(p_stops);
  if stop_count not between 1 and 20 then raise exception 'El viatge ha de tenir entre 1 i 20 destinacions'; end if;
  for stop_row in select value from jsonb_array_elements(p_stops) loop
    stop_index:=stop_index+1;
    if jsonb_typeof(stop_row)<>'object' then raise exception 'Destinació no vàlida'; end if;
    stop_label:=btrim(stop_row->>'label'); stop_name:=btrim(stop_row->>'canonical_name');
    stop_timezone:=btrim(stop_row->>'time_zone'); stop_provider:=btrim(stop_row->>'provider');
    stop_provider_place_id:=btrim(stop_row->>'provider_place_id'); stop_admin:=nullif(btrim(stop_row->>'administrative_area'),'');
    stop_country:=nullif(upper(btrim(stop_row->>'country_code')),'');
    begin stop_lat:=(stop_row->>'latitude')::double precision; stop_lon:=(stop_row->>'longitude')::double precision;
    exception when others then raise exception 'Coordenades de destinació no vàlides'; end;
    if stop_label is null or char_length(stop_label) not between 1 and 120
       or stop_name is null or char_length(stop_name) not between 1 and 500
       or stop_provider<>'geoapify'
       or stop_provider_place_id is null or char_length(stop_provider_place_id) not between 1 and 500
       or stop_lat not between -90 and 90 or stop_lon not between -180 and 180
       or (stop_country is not null and stop_country !~ '^[A-Z]{2}$')
       or stop_timezone is null
       or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=stop_timezone)
    then raise exception 'Destinació no vàlida o zona horària no verificable'; end if;
    if stop_index=1 then first_timezone:=stop_timezone; end if;
  end loop;
  select * into created_trip from public.create_trip_v2(p_name,p_start_date,p_end_date,first_timezone);
  stop_index:=0;
  for stop_row in select value from jsonb_array_elements(p_stops) loop
    stop_index:=stop_index+1;
    insert into public.trip_stops(trip_id,position,label,canonical_name,administrative_area,country_code,latitude,longitude,time_zone,provider,provider_place_id)
    values (created_trip.id,stop_index,btrim(stop_row->>'label'),btrim(stop_row->>'canonical_name'),
      nullif(btrim(stop_row->>'administrative_area'),''),nullif(upper(btrim(stop_row->>'country_code')),''),
      (stop_row->>'latitude')::double precision,(stop_row->>'longitude')::double precision,
      btrim(stop_row->>'time_zone'),btrim(stop_row->>'provider'),btrim(stop_row->>'provider_place_id'));
  end loop;
  return query select created_trip.id,created_trip.name,created_trip.invite_code,created_trip.owner_id,
    created_trip.start_date,created_trip.end_date,created_trip.time_zone,created_trip.experience_key;
end; $$;
revoke all on function public.create_trip_with_stops_v1(text,date,date,jsonb) from public,anon,authenticated;
grant execute on function public.create_trip_with_stops_v1(text,date,date,jsonb) to authenticated;

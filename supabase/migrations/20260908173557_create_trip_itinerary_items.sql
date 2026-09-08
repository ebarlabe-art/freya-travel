create table public.trip_itinerary_items (
  id uuid default gen_random_uuid(),
  trip_id uuid not null,

  title text not null,

  timing_kind text not null,
  local_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  time_zone text,
  daypart text,

  location_name text,
  address text,
  city text,
  notes text,

  status text not null default 'planned',
  is_fixed boolean not null default false,
  is_optional boolean not null default false,
  sort_order integer not null default 0,

  created_by uuid default auth.uid(),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trip_itinerary_items_pkey primary key (id),
  constraint trip_itinerary_items_trip_fkey
    foreign key (trip_id) references public.trips(id) on delete cascade,
  constraint trip_itinerary_items_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  constraint trip_itinerary_items_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null,
  constraint trip_itinerary_items_trip_id_id_key unique (trip_id, id),

  constraint trip_itinerary_items_title_check
    check (
      title = btrim(title)
      and char_length(title) between 1 and 200
    ),

  constraint trip_itinerary_items_timing_kind_check
    check (timing_kind in ('exact', 'date', 'all_day', 'daypart', 'unscheduled')),

  constraint trip_itinerary_items_time_zone_check
    check (
      time_zone is null
      or (
        time_zone = btrim(time_zone)
        and char_length(time_zone) between 1 and 100
      )
    ),

  constraint trip_itinerary_items_daypart_check
    check (
      daypart is null
      or daypart in ('morning', 'midday', 'afternoon', 'evening', 'night')
    ),

  constraint trip_itinerary_items_timing_fields_check
    check (
      (
        timing_kind = 'exact'
        and starts_at is not null
        and time_zone is not null
        and local_date is null
        and daypart is null
      )
      or (
        timing_kind in ('date', 'all_day')
        and local_date is not null
        and starts_at is null
        and ends_at is null
        and daypart is null
      )
      or (
        timing_kind = 'daypart'
        and local_date is not null
        and starts_at is null
        and ends_at is null
        and daypart is not null
      )
      or (
        timing_kind = 'unscheduled'
        and local_date is null
        and starts_at is null
        and ends_at is null
        and daypart is null
      )
    ),

  constraint trip_itinerary_items_time_order_check
    check (ends_at is null or ends_at > starts_at),

  constraint trip_itinerary_items_location_name_check
    check (
      location_name is null
      or (
        location_name = btrim(location_name)
        and char_length(location_name) between 1 and 200
      )
    ),

  constraint trip_itinerary_items_address_check
    check (
      address is null
      or (
        address = btrim(address)
        and char_length(address) between 1 and 500
      )
    ),

  constraint trip_itinerary_items_city_check
    check (
      city is null
      or (
        city = btrim(city)
        and char_length(city) between 1 and 200
      )
    ),

  constraint trip_itinerary_items_notes_check
    check (
      notes is null
      or (
        notes = btrim(notes)
        and char_length(notes) between 1 and 4000
      )
    ),

  constraint trip_itinerary_items_status_check
    check (status in ('planned', 'completed', 'cancelled'))
);

create index trip_itinerary_items_starts_at_idx
  on public.trip_itinerary_items (
    trip_id,
    starts_at asc nulls last,
    sort_order,
    id
  );

create index trip_itinerary_items_local_date_idx
  on public.trip_itinerary_items (
    trip_id,
    local_date asc nulls last,
    sort_order,
    id
  );

create index trip_itinerary_items_manual_order_idx
  on public.trip_itinerary_items (
    trip_id,
    sort_order,
    created_at,
    id
  );

create function public.enforce_trip_itinerary_item_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if new.time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.time_zone
     ) then
    raise exception 'La zona horaria de l element d itinerari no es valida'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.updated_by := null;
    new.created_at := statement_timestamp();
    new.updated_at := new.created_at;
  else
    if new.id is distinct from old.id
       or new.trip_id is distinct from old.trip_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'No es poden modificar els camps immutables de l element d itinerari'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_trip_itinerary_item_integrity()
  from public, anon, authenticated;

create trigger enforce_trip_itinerary_item_integrity_trigger
before insert or update on public.trip_itinerary_items
for each row execute function public.enforce_trip_itinerary_item_integrity();

alter table public.trip_itinerary_items enable row level security;

revoke all on table public.trip_itinerary_items
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.trip_itinerary_items
  to authenticated;

create policy "members can view manual itinerary items"
on public.trip_itinerary_items
for select
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can add manual itinerary items"
on public.trip_itinerary_items
for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can update manual itinerary items"
on public.trip_itinerary_items
for update
to authenticated
using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id));

create policy "members can delete manual itinerary items"
on public.trip_itinerary_items
for delete
to authenticated
using (public.is_trip_member(trip_id));

alter table public.trip_itinerary_items replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_itinerary_items'
  ) then
    alter publication supabase_realtime
      add table public.trip_itinerary_items;
  end if;
end;
$$;

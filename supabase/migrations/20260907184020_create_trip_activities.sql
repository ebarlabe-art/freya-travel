create table public.trip_activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,

  title text not null,
  activity_type text not null default 'other',

  start_at timestamptz,
  end_at timestamptz,
  time_zone text,

  venue_name text,
  address text,
  city text,
  latitude double precision,
  longitude double precision,

  reservation_status text not null default 'planning',
  booking_reference text,
  provider text,
  contact_phone text,
  contact_email text,
  website_url text,

  people_count integer,
  amount numeric(12,2),
  currency text,
  notes text,

  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trip_activities_trip_id_id_key
    unique (trip_id, id),

  constraint trip_activities_title_check
    check (
      title = btrim(title)
      and char_length(title) between 1 and 200
    ),

  constraint trip_activities_type_check
    check (
      activity_type = btrim(activity_type)
      and char_length(activity_type) between 1 and 50
      and activity_type ~ '^[a-z][a-z0-9_]*$'
    ),

  constraint trip_activities_time_zone_check
    check (
      time_zone is null
      or (
        time_zone = btrim(time_zone)
        and char_length(time_zone) between 1 and 100
      )
    ),

  constraint trip_activities_time_zone_required_check
    check (
      (start_at is null and end_at is null)
      or time_zone is not null
    ),

  constraint trip_activities_end_requires_start_check
    check (end_at is null or start_at is not null),

  constraint trip_activities_dates_check
    check (
      start_at is null
      or end_at is null
      or end_at > start_at
    ),

  constraint trip_activities_venue_name_check
    check (
      venue_name is null
      or (
        venue_name = btrim(venue_name)
        and char_length(venue_name) between 1 and 200
      )
    ),

  constraint trip_activities_address_check
    check (
      address is null
      or (
        address = btrim(address)
        and char_length(address) between 1 and 500
      )
    ),

  constraint trip_activities_city_check
    check (
      city is null
      or (
        city = btrim(city)
        and char_length(city) between 1 and 200
      )
    ),

  constraint trip_activities_coordinates_pair_check
    check ((latitude is null) = (longitude is null)),

  constraint trip_activities_latitude_check
    check (latitude is null or latitude between -90 and 90),

  constraint trip_activities_longitude_check
    check (longitude is null or longitude between -180 and 180),

  constraint trip_activities_reservation_status_check
    check (reservation_status in ('planning', 'reserved', 'confirmed', 'cancelled')),

  constraint trip_activities_booking_reference_check
    check (
      booking_reference is null
      or (
        booking_reference = btrim(booking_reference)
        and char_length(booking_reference) between 1 and 200
      )
    ),

  constraint trip_activities_provider_check
    check (
      provider is null
      or (
        provider = btrim(provider)
        and char_length(provider) between 1 and 200
      )
    ),

  constraint trip_activities_contact_phone_check
    check (
      contact_phone is null
      or (
        contact_phone = btrim(contact_phone)
        and char_length(contact_phone) between 1 and 50
      )
    ),

  constraint trip_activities_contact_email_check
    check (
      contact_email is null
      or (
        contact_email = btrim(contact_email)
        and char_length(contact_email) between 1 and 254
      )
    ),

  constraint trip_activities_website_url_check
    check (
      website_url is null
      or (
        website_url = btrim(website_url)
        and char_length(website_url) between 1 and 2048
        and website_url ~* '^https?://[^[:space:]]+$'
      )
    ),

  constraint trip_activities_people_count_check
    check (people_count is null or people_count between 1 and 10000),

  constraint trip_activities_amount_check
    check (amount is null or amount >= 0),

  constraint trip_activities_currency_check
    check (
      currency is null
      or (
        currency = upper(btrim(currency))
        and currency ~ '^[A-Z]{3}$'
      )
    ),

  constraint trip_activities_amount_currency_check
    check (amount is null or currency is not null),

  constraint trip_activities_notes_check
    check (
      notes is null
      or (
        notes = btrim(notes)
        and char_length(notes) between 1 and 4000
      )
    )
);

create index trip_activities_chronology_idx
  on public.trip_activities (
    trip_id,
    start_at asc nulls last,
    created_at,
    id
  );

create index trip_activities_created_by_idx
  on public.trip_activities (created_by)
  where created_by is not null;

create index trip_activities_updated_by_idx
  on public.trip_activities (updated_by)
  where updated_by is not null;

create function public.enforce_trip_activity_integrity()
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
    raise exception 'La zona horaria de l activitat no es valida'
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
      raise exception 'No es poden modificar els camps immutables de l activitat'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_trip_activity_integrity()
  from public, anon, authenticated;

create trigger enforce_trip_activity_integrity_trigger
before insert or update on public.trip_activities
for each row execute function public.enforce_trip_activity_integrity();

create table public.trip_activity_documents (
  trip_id uuid not null,
  activity_id uuid not null,
  document_id uuid not null,
  document_role text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  primary key (trip_id, activity_id, document_role),

  constraint trip_activity_documents_role_check
    check (document_role in ('booking', 'ticket')),

  constraint trip_activity_documents_activity_fkey
    foreign key (trip_id, activity_id)
    references public.trip_activities(trip_id, id)
    on delete cascade,

  constraint trip_activity_documents_document_fkey
    foreign key (trip_id, document_id)
    references public.travel_documents(trip_id, id)
    on delete cascade
);

create index trip_activity_documents_document_idx
  on public.trip_activity_documents (trip_id, document_id);

create index trip_activity_documents_created_by_idx
  on public.trip_activity_documents (created_by)
  where created_by is not null;

create function public.enforce_trip_activity_document_integrity()
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

  if tg_op = 'INSERT' then
    new.created_at := statement_timestamp();
    return new;
  end if;

  if new.trip_id is distinct from old.trip_id
     or new.activity_id is distinct from old.activity_id
     or new.document_role is distinct from old.document_role then
    raise exception 'No es pot canviar l ambit de l associacio documental'
      using errcode = '42501';
  end if;

  new.created_by := auth.uid();
  new.created_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.enforce_trip_activity_document_integrity()
  from public, anon, authenticated;

create trigger enforce_trip_activity_document_integrity_trigger
before insert or update on public.trip_activity_documents
for each row execute function public.enforce_trip_activity_document_integrity();

create function public.sync_trip_activity_document(
  p_trip_id uuid,
  p_activity_id uuid,
  p_document_role text,
  p_expected_activity_updated_at timestamptz,
  p_expected_document_id uuid,
  p_new_document_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_activity_updated_at timestamptz;
  v_current_document_id uuid;
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_activity_id is null
     or p_document_role is null
     or p_expected_activity_updated_at is null then
    raise exception 'Falten dades per sincronitzar el document de l activitat'
      using errcode = '22004';
  end if;

  if p_document_role not in ('booking', 'ticket') then
    raise exception 'Rol documental d activitat no valid'
      using errcode = '22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge'
      using errcode = '42501';
  end if;

  select activity.updated_at
  into v_activity_updated_at
  from public.trip_activities as activity
  where activity.trip_id = p_trip_id
    and activity.id = p_activity_id
  for update;

  if not found then
    raise exception 'L activitat ja no existeix'
      using errcode = 'P0002';
  end if;

  if v_activity_updated_at is distinct from p_expected_activity_updated_at then
    raise exception 'Conflicte de versio de l activitat'
      using errcode = '40001';
  end if;

  v_current_document_id := null;

  select relation.document_id
  into v_current_document_id
  from public.trip_activity_documents as relation
  where relation.trip_id = p_trip_id
    and relation.activity_id = p_activity_id
    and relation.document_role = p_document_role
  for update;

  if v_current_document_id is distinct from p_expected_document_id then
    raise exception 'Conflicte de document de l activitat'
      using errcode = '40001';
  end if;

  if p_new_document_id is not null
     and not exists (
       select 1
       from public.travel_documents as document
       where document.trip_id = p_trip_id
         and document.id = p_new_document_id
     ) then
    raise exception 'El document no pertany al viatge actiu'
      using errcode = '23503';
  end if;

  if p_new_document_id is null then
    delete from public.trip_activity_documents
    where trip_id = p_trip_id
      and activity_id = p_activity_id
      and document_role = p_document_role;

  elsif p_new_document_id is distinct from v_current_document_id then
    insert into public.trip_activity_documents (
      trip_id,
      activity_id,
      document_id,
      document_role,
      created_by
    ) values (
      p_trip_id,
      p_activity_id,
      p_new_document_id,
      p_document_role,
      v_user_id
    )
    on conflict (trip_id, activity_id, document_role)
    do update set
      document_id = excluded.document_id,
      created_by = excluded.created_by;
  end if;

  return p_new_document_id;
end;
$$;

revoke all on function public.sync_trip_activity_document(
  uuid, uuid, text, timestamptz, uuid, uuid
) from public, anon;

grant execute on function public.sync_trip_activity_document(
  uuid, uuid, text, timestamptz, uuid, uuid
) to authenticated;

alter table public.trip_activities enable row level security;
alter table public.trip_activity_documents enable row level security;

revoke all on table public.trip_activities
  from public, anon, authenticated;

revoke all on table public.trip_activity_documents
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.trip_activities
  to authenticated;

grant select
  on table public.trip_activity_documents
  to authenticated;

create policy "members can view activities"
on public.trip_activities
for select
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can add activities"
on public.trip_activities
for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can update activities"
on public.trip_activities
for update
to authenticated
using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id));

create policy "members can delete activities"
on public.trip_activities
for delete
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can view activity documents"
on public.trip_activity_documents
for select
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can add activity documents"
on public.trip_activity_documents
for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can update activity documents"
on public.trip_activity_documents
for update
to authenticated
using (public.is_trip_member(trip_id))
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can delete activity documents"
on public.trip_activity_documents
for delete
to authenticated
using (public.is_trip_member(trip_id));

-- Filtered DELETE events need the old trip_id in the WAL record.
alter table public.trip_activities replica identity full;
alter table public.trip_activity_documents replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_activities'
  ) then
    alter publication supabase_realtime
      add table public.trip_activities;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_activity_documents'
  ) then
    alter publication supabase_realtime
      add table public.trip_activity_documents;
  end if;
end
$$;

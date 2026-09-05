create table public.trip_accommodations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  accommodation_type text not null,
  name text not null,
  address text,
  location_text text,
  latitude double precision,
  longitude double precision,
  check_in_at timestamptz,
  check_out_at timestamptz,
  time_zone text not null,
  booking_reference text,
  booking_provider text,
  reservation_status text not null default 'planning',
  phone text,
  email text,
  website_url text,
  room_number text,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_accommodations_trip_id_id_key unique (trip_id, id),
  constraint trip_accommodations_type_check
    check (accommodation_type in ('hotel', 'apartment', 'house', 'hostel', 'resort', 'other')),
  constraint trip_accommodations_name_check
    check (name = btrim(name) and char_length(name) between 1 and 200),
  constraint trip_accommodations_address_check
    check (address is null or (address = btrim(address) and char_length(address) between 1 and 500)),
  constraint trip_accommodations_location_text_check
    check (location_text is null or (location_text = btrim(location_text) and char_length(location_text) between 1 and 200)),
  constraint trip_accommodations_coordinates_pair_check
    check ((latitude is null) = (longitude is null)),
  constraint trip_accommodations_latitude_check
    check (latitude is null or latitude between -90 and 90),
  constraint trip_accommodations_longitude_check
    check (longitude is null or longitude between -180 and 180),
  constraint trip_accommodations_dates_check
    check (check_in_at is null or check_out_at is null or check_out_at > check_in_at),
  constraint trip_accommodations_time_zone_check
    check (time_zone = btrim(time_zone) and char_length(time_zone) between 1 and 100),
  constraint trip_accommodations_booking_reference_check
    check (booking_reference is null or (booking_reference = btrim(booking_reference) and char_length(booking_reference) between 1 and 200)),
  constraint trip_accommodations_booking_provider_check
    check (booking_provider is null or (booking_provider = btrim(booking_provider) and char_length(booking_provider) between 1 and 200)),
  constraint trip_accommodations_reservation_status_check
    check (reservation_status in ('planning', 'confirmed', 'cancelled')),
  constraint trip_accommodations_phone_check
    check (phone is null or (phone = btrim(phone) and char_length(phone) between 1 and 50)),
  constraint trip_accommodations_email_check
    check (email is null or (email = btrim(email) and char_length(email) between 1 and 254)),
  constraint trip_accommodations_website_url_check
    check (
      website_url is null
      or (
        website_url = btrim(website_url)
        and char_length(website_url) between 1 and 2048
        and website_url ~* '^https?://[^[:space:]]+$'
      )
    ),
  constraint trip_accommodations_room_number_check
    check (room_number is null or (room_number = btrim(room_number) and char_length(room_number) between 1 and 100)),
  constraint trip_accommodations_notes_check
    check (notes is null or (notes = btrim(notes) and char_length(notes) between 1 and 4000))
);

create index trip_accommodations_chronology_idx
  on public.trip_accommodations (trip_id, check_in_at asc nulls last, created_at, id);

create index trip_accommodations_created_by_idx
  on public.trip_accommodations (created_by)
  where created_by is not null;

create index trip_accommodations_updated_by_idx
  on public.trip_accommodations (updated_by)
  where updated_by is not null;

create function public.enforce_trip_accommodation_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Allow only recursive FK ON DELETE SET NULL audit cleanups to pass
  -- without a user JWT. Direct client updates enter at trigger depth 1.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names as timezone_record
    where timezone_record.name = new.time_zone
  ) then
    raise exception 'La zona horaria no es una zona IANA valida'
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
      raise exception 'No es poden modificar els camps immutables de l allotjament'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_trip_accommodation_integrity()
  from public, anon, authenticated;

create trigger enforce_trip_accommodation_integrity_trigger
before insert or update on public.trip_accommodations
for each row execute function public.enforce_trip_accommodation_integrity();

alter table public.travel_documents
  add constraint travel_documents_trip_id_id_key unique (trip_id, id);

create table public.trip_accommodation_documents (
  trip_id uuid not null,
  accommodation_id uuid not null,
  document_id uuid not null,
  document_role text not null default 'voucher',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (trip_id, accommodation_id, document_id),
  constraint trip_accommodation_documents_one_role_key
    unique (trip_id, accommodation_id, document_role),
  constraint trip_accommodation_documents_role_check
    check (document_role in ('voucher')),
  constraint trip_accommodation_documents_accommodation_fkey
    foreign key (trip_id, accommodation_id)
    references public.trip_accommodations(trip_id, id)
    on delete cascade,
  constraint trip_accommodation_documents_document_fkey
    foreign key (trip_id, document_id)
    references public.travel_documents(trip_id, id)
    on delete cascade
);

create index trip_accommodation_documents_document_idx
  on public.trip_accommodation_documents (trip_id, document_id);

create index trip_accommodation_documents_created_by_idx
  on public.trip_accommodation_documents (created_by)
  where created_by is not null;

create function public.enforce_trip_accommodation_document_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Same exception for created_by ON DELETE SET NULL on the link row.
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
     or new.accommodation_id is distinct from old.accommodation_id
     or new.document_role is distinct from old.document_role then
    raise exception 'No es pot canviar l ambit de l associacio documental'
      using errcode = '42501';
  end if;

  new.created_by := auth.uid();
  new.created_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.enforce_trip_accommodation_document_integrity()
  from public, anon, authenticated;

create trigger enforce_trip_accommodation_document_integrity_trigger
before insert or update on public.trip_accommodation_documents
for each row execute function public.enforce_trip_accommodation_document_integrity();

create function public.sync_trip_accommodation_voucher(
  p_trip_id uuid,
  p_accommodation_id uuid,
  p_expected_accommodation_updated_at timestamptz,
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
  v_accommodation_updated_at timestamptz;
  v_current_document_id uuid;
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_accommodation_id is null
     or p_expected_accommodation_updated_at is null then
    raise exception 'Falten dades per sincronitzar el voucher'
      using errcode = '22004';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge'
      using errcode = '42501';
  end if;

  select accommodation.updated_at
  into v_accommodation_updated_at
  from public.trip_accommodations as accommodation
  where accommodation.trip_id = p_trip_id
    and accommodation.id = p_accommodation_id
  for update;

  if not found then
    raise exception 'L allotjament ja no existeix'
      using errcode = 'P0002';
  end if;

  if v_accommodation_updated_at is distinct from p_expected_accommodation_updated_at then
    raise exception 'Conflicte de versio de l allotjament'
      using errcode = '40001';
  end if;

  v_current_document_id := null;
  select relation.document_id
  into v_current_document_id
  from public.trip_accommodation_documents as relation
  where relation.trip_id = p_trip_id
    and relation.accommodation_id = p_accommodation_id
    and relation.document_role = 'voucher'
  for update;

  if v_current_document_id is distinct from p_expected_document_id then
    raise exception 'Conflicte de voucher de l allotjament'
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
    delete from public.trip_accommodation_documents
    where trip_id = p_trip_id
      and accommodation_id = p_accommodation_id
      and document_role = 'voucher';
  elsif p_new_document_id is distinct from v_current_document_id then
    insert into public.trip_accommodation_documents (
      trip_id,
      accommodation_id,
      document_id,
      document_role,
      created_by
    ) values (
      p_trip_id,
      p_accommodation_id,
      p_new_document_id,
      'voucher',
      v_user_id
    )
    on conflict (trip_id, accommodation_id, document_role)
    do update set
      document_id = excluded.document_id,
      created_by = excluded.created_by;
  end if;

  return p_new_document_id;
end;
$$;

revoke all on function public.sync_trip_accommodation_voucher(
  uuid, uuid, timestamptz, uuid, uuid
) from public, anon;

grant execute on function public.sync_trip_accommodation_voucher(
  uuid, uuid, timestamptz, uuid, uuid
) to authenticated;

alter table public.trip_accommodations enable row level security;
alter table public.trip_accommodation_documents enable row level security;

revoke all on table public.trip_accommodations from public, anon, authenticated;
revoke all on table public.trip_accommodation_documents from public, anon, authenticated;

grant select, insert, update, delete on table public.trip_accommodations to authenticated;
grant select on table public.trip_accommodation_documents to authenticated;

create policy "members can view accommodations"
on public.trip_accommodations
for select
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can add accommodations"
on public.trip_accommodations
for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can update accommodations"
on public.trip_accommodations
for update
to authenticated
using (public.is_trip_member(trip_id))
with check (public.is_trip_member(trip_id));

create policy "members can delete accommodations"
on public.trip_accommodations
for delete
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can view accommodation documents"
on public.trip_accommodation_documents
for select
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can add accommodation documents"
on public.trip_accommodation_documents
for insert
to authenticated
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

create policy "members can delete accommodation documents"
on public.trip_accommodation_documents
for delete
to authenticated
using (public.is_trip_member(trip_id));

create policy "members can update accommodation documents"
on public.trip_accommodation_documents
for update
to authenticated
using (public.is_trip_member(trip_id))
with check (
  public.is_trip_member(trip_id)
  and created_by = (select auth.uid())
);

-- Filtered DELETE events need the old trip_id in the WAL record.
alter table public.trip_accommodations replica identity full;
alter table public.trip_accommodation_documents replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_accommodations'
  ) then
    alter publication supabase_realtime add table public.trip_accommodations;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_accommodation_documents'
  ) then
    alter publication supabase_realtime add table public.trip_accommodation_documents;
  end if;
end
$$;

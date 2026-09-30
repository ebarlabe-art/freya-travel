-- Car rental module · Supabase migration 20260930164255
create table public.trip_car_rentals (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  provider text,
  booking_reference text,
  pickup_location text,
  pickup_city text,
  pickup_at timestamptz,
  pickup_time_zone text,
  return_location text,
  return_city text,
  return_at timestamptz,
  return_time_zone text,
  vehicle_class text,
  vehicle_model text,
  license_plate text,
  transmission text,
  fuel_policy text,
  pickup_fuel_level text,
  return_fuel_level text,
  pickup_mileage integer,
  return_mileage integer,
  insurance text,
  excess_amount numeric(12,2),
  excess_currency text,
  deposit_amount numeric(12,2),
  deposit_currency text,
  phone text,
  email text,
  website_url text,
  reservation_status text not null default 'planning',
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trip_car_rentals_trip_id_id_key unique (trip_id,id),
  constraint trip_car_rentals_provider_check check (provider is null or (provider=btrim(provider) and char_length(provider) between 1 and 200)),
  constraint trip_car_rentals_booking_reference_check check (booking_reference is null or (booking_reference=btrim(booking_reference) and char_length(booking_reference) between 1 and 200)),
  constraint trip_car_rentals_pickup_location_check check (pickup_location is null or (pickup_location=btrim(pickup_location) and char_length(pickup_location) between 1 and 500)),
  constraint trip_car_rentals_pickup_city_check check (pickup_city is null or (pickup_city=btrim(pickup_city) and char_length(pickup_city) between 1 and 200)),
  constraint trip_car_rentals_return_location_check check (return_location is null or (return_location=btrim(return_location) and char_length(return_location) between 1 and 500)),
  constraint trip_car_rentals_return_city_check check (return_city is null or (return_city=btrim(return_city) and char_length(return_city) between 1 and 200)),
  constraint trip_car_rentals_pickup_time_zone_check check (pickup_time_zone is null or (pickup_time_zone=btrim(pickup_time_zone) and char_length(pickup_time_zone) between 1 and 100)),
  constraint trip_car_rentals_return_time_zone_check check (return_time_zone is null or (return_time_zone=btrim(return_time_zone) and char_length(return_time_zone) between 1 and 100)),
  constraint trip_car_rentals_pickup_zone_required check (pickup_at is null or pickup_time_zone is not null),
  constraint trip_car_rentals_return_zone_required check (return_at is null or return_time_zone is not null),
  constraint trip_car_rentals_dates_check check (pickup_at is null or return_at is null or return_at > pickup_at),
  constraint trip_car_rentals_vehicle_class_check check (vehicle_class is null or (vehicle_class=btrim(vehicle_class) and char_length(vehicle_class) between 1 and 100)),
  constraint trip_car_rentals_vehicle_model_check check (vehicle_model is null or (vehicle_model=btrim(vehicle_model) and char_length(vehicle_model) between 1 and 200)),
  constraint trip_car_rentals_license_plate_check check (license_plate is null or (license_plate=btrim(license_plate) and char_length(license_plate) between 1 and 40)),
  constraint trip_car_rentals_transmission_check check (transmission is null or transmission in ('manual','automatic','unknown')),
  constraint trip_car_rentals_fuel_policy_check check (fuel_policy is null or (fuel_policy=btrim(fuel_policy) and char_length(fuel_policy) between 1 and 200)),
  constraint trip_car_rentals_pickup_fuel_check check (pickup_fuel_level is null or (pickup_fuel_level=btrim(pickup_fuel_level) and char_length(pickup_fuel_level) between 1 and 80)),
  constraint trip_car_rentals_return_fuel_check check (return_fuel_level is null or (return_fuel_level=btrim(return_fuel_level) and char_length(return_fuel_level) between 1 and 80)),
  constraint trip_car_rentals_pickup_mileage_check check (pickup_mileage is null or pickup_mileage >= 0),
  constraint trip_car_rentals_return_mileage_check check (return_mileage is null or return_mileage >= 0),
  constraint trip_car_rentals_mileage_order_check check (pickup_mileage is null or return_mileage is null or return_mileage >= pickup_mileage),
  constraint trip_car_rentals_insurance_check check (insurance is null or (insurance=btrim(insurance) and char_length(insurance) between 1 and 500)),
  constraint trip_car_rentals_excess_amount_check check (excess_amount is null or excess_amount >= 0),
  constraint trip_car_rentals_excess_currency_check check (excess_currency is null or excess_currency ~ '^[A-Z]{3}$'),
  constraint trip_car_rentals_excess_pair_check check ((excess_amount is null) = (excess_currency is null)),
  constraint trip_car_rentals_deposit_amount_check check (deposit_amount is null or deposit_amount >= 0),
  constraint trip_car_rentals_deposit_currency_check check (deposit_currency is null or deposit_currency ~ '^[A-Z]{3}$'),
  constraint trip_car_rentals_deposit_pair_check check ((deposit_amount is null) = (deposit_currency is null)),
  constraint trip_car_rentals_phone_check check (phone is null or (phone=btrim(phone) and char_length(phone) between 1 and 50)),
  constraint trip_car_rentals_email_check check (email is null or (email=btrim(email) and char_length(email) between 1 and 254)),
  constraint trip_car_rentals_website_check check (website_url is null or (website_url=btrim(website_url) and char_length(website_url) between 1 and 2048 and website_url ~* '^https?://[^[:space:]]+$')),
  constraint trip_car_rentals_status_check check (reservation_status in ('planning','reserved','confirmed','cancelled')),
  constraint trip_car_rentals_notes_check check (notes is null or (notes=btrim(notes) and char_length(notes) between 1 and 4000))
);

create index trip_car_rentals_chronology_idx on public.trip_car_rentals (trip_id,pickup_at asc nulls last,created_at,id);
create index trip_car_rentals_created_by_idx on public.trip_car_rentals (created_by) where created_by is not null;
create index trip_car_rentals_updated_by_idx on public.trip_car_rentals (updated_by) where updated_by is not null;

create function public.enforce_trip_car_rental_integrity()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and pg_trigger_depth()>1 then return new; end if;
  if auth.uid() is null then raise exception 'Cal iniciar sessio' using errcode='42501'; end if;
  if new.pickup_time_zone is not null and not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=new.pickup_time_zone) then
    raise exception 'La zona horaria de recollida no es valida' using errcode='22023';
  end if;
  if new.return_time_zone is not null and not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=new.return_time_zone) then
    raise exception 'La zona horaria de devolucio no es valida' using errcode='22023';
  end if;
  if tg_op='INSERT' then
    new.updated_by:=null; new.created_at:=statement_timestamp(); new.updated_at:=new.created_at;
  else
    if new.id is distinct from old.id or new.trip_id is distinct from old.trip_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'No es poden modificar els camps immutables del lloguer' using errcode='42501';
    end if;
    new.updated_by:=auth.uid(); new.updated_at:=statement_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.enforce_trip_car_rental_integrity() from public,anon,authenticated;
create trigger enforce_trip_car_rental_integrity_trigger before insert or update on public.trip_car_rentals
for each row execute function public.enforce_trip_car_rental_integrity();

create table public.trip_car_rental_documents (
  trip_id uuid not null,
  car_rental_id uuid not null,
  document_id uuid not null,
  document_role text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (trip_id,car_rental_id,document_id),
  constraint trip_car_rental_documents_role_check check (document_role in ('reservation','contract','insurance','pickup_photo','return_photo')),
  constraint trip_car_rental_documents_rental_fkey foreign key (trip_id,car_rental_id) references public.trip_car_rentals(trip_id,id) on delete cascade,
  constraint trip_car_rental_documents_document_fkey foreign key (trip_id,document_id) references public.travel_documents(trip_id,id) on delete cascade
);
create index trip_car_rental_documents_document_idx on public.trip_car_rental_documents(trip_id,document_id);
create index trip_car_rental_documents_rental_role_idx on public.trip_car_rental_documents(trip_id,car_rental_id,document_role);
create index trip_car_rental_documents_created_by_idx on public.trip_car_rental_documents(created_by) where created_by is not null;

alter table public.trip_car_rentals enable row level security;
revoke all on public.trip_car_rentals from public,anon,authenticated;
grant select,insert,update,delete on public.trip_car_rentals to authenticated;
create policy "members can view car rentals" on public.trip_car_rentals for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can add car rentals" on public.trip_car_rentals for insert to authenticated with check (public.is_trip_member(trip_id) and created_by=(select auth.uid()));
create policy "members can update car rentals" on public.trip_car_rentals for update to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy "members can delete car rentals" on public.trip_car_rentals for delete to authenticated using (public.is_trip_member(trip_id));

alter table public.trip_car_rental_documents enable row level security;
revoke all on public.trip_car_rental_documents from public,anon,authenticated;
grant select,insert,delete on public.trip_car_rental_documents to authenticated;
create policy "members can view car rental documents" on public.trip_car_rental_documents for select to authenticated using (public.is_trip_member(trip_id));
create policy "members can add car rental documents" on public.trip_car_rental_documents for insert to authenticated with check (public.is_trip_member(trip_id) and created_by=(select auth.uid()));
create policy "members can delete car rental documents" on public.trip_car_rental_documents for delete to authenticated using (public.is_trip_member(trip_id));

alter table public.trip_standalone_component_links drop constraint trip_standalone_component_links_source_kind_check;
alter table public.trip_standalone_component_links add constraint trip_standalone_component_links_source_kind_check check (source_kind in ('accommodation','flight','activity','car_rental'));

alter table public.trip_component_costs drop constraint trip_component_costs_source_kind_check;
alter table public.trip_component_costs add constraint trip_component_costs_source_kind_check check (source_kind in ('accommodation','flight','activity','car_rental'));

create trigger cleanup_standalone_car_rental_budget after delete on public.trip_car_rentals
for each row execute function proposal_private.cleanup_standalone_component_link('car_rental');

create or replace function public.ensure_trip_standalone_component_v1(
  p_trip_id uuid,
  p_source_kind text,
  p_source_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  row_link public.trip_standalone_component_links;
  cid text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_trip_id is null or p_source_id is null or p_source_kind not in ('accommodation','flight','activity','car_rental') then
    raise exception 'Invalid standalone component request' using errcode='22023';
  end if;
  if not public.is_trip_member(p_trip_id) then raise exception 'Trip unavailable' using errcode='42501'; end if;

  if p_source_kind='flight' then
    if not exists(select 1 from public.trip_flights where trip_id=p_trip_id and id=p_source_id) then raise exception 'Flight unavailable' using errcode='P0002'; end if;
  elsif p_source_kind='accommodation' then
    if not exists(select 1 from public.trip_accommodations where trip_id=p_trip_id and id=p_source_id) then raise exception 'Accommodation unavailable' using errcode='P0002'; end if;
  elsif p_source_kind='activity' then
    if not exists(select 1 from public.trip_activities where trip_id=p_trip_id and id=p_source_id) then raise exception 'Activity unavailable' using errcode='P0002'; end if;
  else
    if not exists(select 1 from public.trip_car_rentals where trip_id=p_trip_id and id=p_source_id) then raise exception 'Car rental unavailable' using errcode='P0002'; end if;
  end if;

  select * into row_link from public.trip_standalone_component_links
  where trip_id=p_trip_id and source_kind=p_source_kind and source_id=p_source_id;

  if not found then
    cid := 'standalone_' || p_source_kind || '_' || replace(p_source_id::text,'-','');
    insert into public.trip_standalone_component_links(trip_id,component_id,source_kind,source_id,created_by)
    values(p_trip_id,cid,p_source_kind,p_source_id,actor)
    on conflict (trip_id,source_kind,source_id) do nothing;
    select * into row_link from public.trip_standalone_component_links
    where trip_id=p_trip_id and source_kind=p_source_kind and source_id=p_source_id;
  end if;

  return jsonb_build_object('trip_id',row_link.trip_id,'component_id',row_link.component_id,'source_kind',row_link.source_kind,'source_id',row_link.source_id);
end $$;
revoke all on function public.ensure_trip_standalone_component_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ensure_trip_standalone_component_v1(uuid,text,uuid) to authenticated;

alter table public.trip_car_rentals replica identity full;
alter table public.trip_car_rental_documents replica identity full;
alter publication supabase_realtime add table public.trip_car_rentals;
alter publication supabase_realtime add table public.trip_car_rental_documents;

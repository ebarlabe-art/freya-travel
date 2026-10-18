-- Additive geography on existing itinerary rows; existing trip membership/RLS,
-- deletion, realtime and optimistic updated_at rules continue to apply.
-- No backfill, remote calls, new roles or schedule changes.
begin;
alter table public.trip_itinerary_items add column resolved_location jsonb;
alter table public.trip_activities add column resolved_location jsonb;

create function public.invalidate_itinerary_resolved_location_v27()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.resolved_location is not null and (
  new.resolved_location->>'location_name' is distinct from coalesce(to_jsonb(new)->>'location_name',to_jsonb(new)->>'venue_name') or
  new.resolved_location->>'address' is distinct from new.address or
  new.resolved_location->>'city' is distinct from new.city or
  new.resolved_location->>'title' is distinct from new.title
 ) then new.resolved_location:=null; end if;
 return new;
end $$;
revoke all on function public.invalidate_itinerary_resolved_location_v27() from public,anon,authenticated;
create trigger invalidate_itinerary_resolved_location_v27
 before insert or update on public.trip_itinerary_items
 for each row execute function public.invalidate_itinerary_resolved_location_v27();
alter table public.trip_itinerary_items add constraint itinerary_resolved_location_v27_check check (
 resolved_location is null or coalesce((
  jsonb_typeof(resolved_location)='object' and octet_length(resolved_location::text)<=8192 and
  resolved_location#>>'{place,coordinate_role}'='exact_location' and
  resolved_location#>>'{place,provider}'='geoapify' and
  length(resolved_location#>>'{place,provider_place_id}') between 1 and 500 and
  length(resolved_location#>>'{place,canonical_name}') between 1 and 200 and
  length(resolved_location#>>'{place,attribution}') between 1 and 2000 and
  resolved_location#>>'{place,country_code}' ~ '^[A-Z]{2}$' and
  jsonb_typeof(resolved_location#>'{place,latitude}')='number' and
  jsonb_typeof(resolved_location#>'{place,longitude}')='number' and
  (resolved_location#>>'{place,latitude}')::numeric between -90 and 90 and
  (resolved_location#>>'{place,longitude}')::numeric between -180 and 180
 ),false)
);
create trigger invalidate_activity_resolved_location_v27
 before insert or update on public.trip_activities
 for each row execute function public.invalidate_itinerary_resolved_location_v27();
alter table public.trip_activities add constraint activity_resolved_location_v27_check check (
 resolved_location is null or coalesce((
  jsonb_typeof(resolved_location)='object' and octet_length(resolved_location::text)<=8192 and
  resolved_location#>>'{place,coordinate_role}'='exact_location' and
  resolved_location#>>'{place,provider}'='geoapify' and
  length(resolved_location#>>'{place,provider_place_id}') between 1 and 500 and
  length(resolved_location#>>'{place,canonical_name}') between 1 and 200 and
  length(resolved_location#>>'{place,attribution}') between 1 and 2000 and
  resolved_location#>>'{place,country_code}' ~ '^[A-Z]{2}$' and
  jsonb_typeof(resolved_location#>'{place,latitude}')='number' and
  jsonb_typeof(resolved_location#>'{place,longitude}')='number' and
  (resolved_location#>>'{place,latitude}')::numeric between -90 and 90 and
  (resolved_location#>>'{place,longitude}')::numeric between -180 and 180
 ),false)
);
comment on column public.trip_itinerary_items.resolved_location is
 'Exact geography with source attribution and input snapshot. Invalidated on place/title edits; never changes schedule.';
commit;

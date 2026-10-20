-- Additive only. Existing trip membership policies, updated_at and Realtime apply.
-- No backfill, API calls, schedule edits or new privileges on trip rows.
begin;
alter table public.trip_itinerary_items add column location_points jsonb;
alter table public.trip_activities add column location_points jsonb;
create function public.valid_itinerary_place_points_v1(s jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare p jsonb; g jsonb; ids text[]:='{}';
begin
 if s is null then return true; end if;
 if jsonb_typeof(s)<>'object' or octet_length(s::text)>65536 or s->'version' is distinct from '1'::jsonb or
  jsonb_typeof(s->'input') is distinct from 'object' or jsonb_typeof(s->'points') is distinct from 'array' then return false; end if;
 if jsonb_array_length(s->'points')>12 then return false; end if;
 for p in select value from jsonb_array_elements(s->'points') loop
  if not coalesce(jsonb_typeof(p)='object' and jsonb_typeof(p->'id')='string' and length(p->>'id') between 1 and 100 and
   jsonb_typeof(p->'query')='string' and length(btrim(p->>'query')) between 1 and 500 and
   p->>'status' in ('pending','resolved','approximate'),false) then return false; end if;
  if p->>'id'=any(ids) then return false; end if; ids:=array_append(ids,p->>'id');
  g:=p->'place';
  if p->>'status'='pending' then
   if g is distinct from 'null'::jsonb then return false; end if;
  else
   if not coalesce(jsonb_typeof(g)='object' and g->>'provider'='geoapify' and
    length(g->>'provider_place_id') between 1 and 500 and length(g->>'canonical_name') between 1 and 200 and
    length(g->>'attribution') between 1 and 2000 and g->>'country_code' ~ '^[A-Z]{2}$' and
    g->>'coordinate_role'=case when p->>'status'='resolved' then 'exact_location' else 'representative_point' end and
    jsonb_typeof(g->'latitude')='number' and jsonb_typeof(g->'longitude')='number',false) then return false; end if;
   if not ((g->>'latitude')::numeric between -90 and 90 and (g->>'longitude')::numeric between -180 and 180) then return false; end if;
   if length(g->>'formatted_address')>1000 then return false; end if;
  end if;
 end loop;
 return true;
end $$;
revoke all on function public.valid_itinerary_place_points_v1(jsonb) from public,anon;
grant execute on function public.valid_itinerary_place_points_v1(jsonb) to authenticated;
alter table public.trip_itinerary_items add constraint itinerary_place_points_v1_check check(public.valid_itinerary_place_points_v1(location_points));
alter table public.trip_activities add constraint activity_place_points_v1_check check(public.valid_itinerary_place_points_v1(location_points));
create function public.invalidate_itinerary_place_points_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.location_points is not null and (
  new.location_points#>>'{input,title}' is distinct from new.title or
  new.location_points#>>'{input,location_name}' is distinct from coalesce(to_jsonb(new)->>'location_name',to_jsonb(new)->>'venue_name') or
  new.location_points#>>'{input,address}' is distinct from new.address or
  new.location_points#>>'{input,city}' is distinct from new.city
 ) then new.location_points:=null; end if;
 return new;
end $$;
revoke all on function public.invalidate_itinerary_place_points_v1() from public,anon,authenticated;
create trigger invalidate_itinerary_place_points_v1 before insert or update on public.trip_itinerary_items
 for each row execute function public.invalidate_itinerary_place_points_v1();
create trigger invalidate_activity_place_points_v1 before insert or update on public.trip_activities
 for each row execute function public.invalidate_itinerary_place_points_v1();
-- Fail closed if deployment lacks the established RLS baseline; never enable access implicitly.
do $$ begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('trip_itinerary_items','trip_activities') and not c.relrowsecurity)
 then raise exception 'Existing trip RLS must be enabled before this migration'; end if;
end $$;
comment on column public.trip_itinerary_items.location_points is 'Ordered verified exact/approximate geography and pending queries. Input snapshot invalidates on place/title edits; existing RLS and optimistic revision apply.';
comment on column public.trip_activities.location_points is 'Same ordered geography contract as manual itinerary; no reservation or schedule changes.';
commit;

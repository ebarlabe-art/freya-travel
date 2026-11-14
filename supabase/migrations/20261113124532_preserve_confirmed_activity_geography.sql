-- #228: preserve already confirmed provider identities across descriptive edits.
-- No backfill, new columns, grants, policies, provider calls or schedule changes.
-- An explicit replacement/null/empty selection still wins. Pending-only snapshots
-- retain the old invalidation behavior. Old clients keep the same JSON contract.
begin;
create or replace function public.invalidate_itinerary_place_points_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
declare fingerprint jsonb; previous_fingerprint jsonb; confirmed jsonb;
begin
 fingerprint:=jsonb_build_object('title',new.title,'location_name',coalesce(to_jsonb(new)->>'location_name',to_jsonb(new)->>'venue_name'),'address',new.address,'city',new.city);
 if new.location_points is null then return new; end if;
 if tg_op='UPDATE' then
  previous_fingerprint:=jsonb_build_object('title',old.title,'location_name',coalesce(to_jsonb(old)->>'location_name',to_jsonb(old)->>'venue_name'),'address',old.address,'city',old.city);
  if new.id=old.id and new.trip_id=old.trip_id and new.location_points=old.location_points and old.location_points->'input'=previous_fingerprint then
   select coalesce(jsonb_agg(p order by ord),'[]'::jsonb) into confirmed
   from jsonb_array_elements(old.location_points->'points') with ordinality as x(p,ord)
   where p->>'status' in ('resolved','approximate') and p->'place' is distinct from 'null'::jsonb;
   if fingerprint<>previous_fingerprint and (jsonb_array_length(confirmed)>0 or old.location_points->'points'='[]'::jsonb) then
    new.location_points:=jsonb_set(jsonb_set(new.location_points,'{input}',fingerprint),'{points}',confirmed);
   end if;
  end if;
 end if;
 if new.location_points->'input' is distinct from fingerprint then new.location_points:=null; end if;
 return new;
end $$;
create or replace function public.invalidate_itinerary_resolved_location_v27() returns trigger
language plpgsql security invoker set search_path='' as $$
declare fingerprint jsonb; previous_fingerprint jsonb;
begin
 fingerprint:=jsonb_build_object('title',new.title,'location_name',coalesce(to_jsonb(new)->>'location_name',to_jsonb(new)->>'venue_name'),'address',new.address,'city',new.city);
 if new.resolved_location is null then return new; end if;
 if tg_op='UPDATE' then
  previous_fingerprint:=jsonb_build_object('title',old.title,'location_name',coalesce(to_jsonb(old)->>'location_name',to_jsonb(old)->>'venue_name'),'address',old.address,'city',old.city);
  if new.id=old.id and new.trip_id=old.trip_id and new.resolved_location=old.resolved_location and old.resolved_location-'place'=previous_fingerprint then
   new.resolved_location:=fingerprint||jsonb_build_object('place',old.resolved_location->'place');
  end if;
 end if;
 if new.resolved_location-'place' is distinct from fingerprint then new.resolved_location:=null; end if;
 return new;
end $$;
-- Existing triggers, constraints, RLS and EXECUTE restrictions stay in force.
commit;

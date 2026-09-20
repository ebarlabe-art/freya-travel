-- Only invoked by the disposable LOCAL runner before the new migration.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
insert into public.trip_activities(trip_id,title,activity_type,time_zone,reservation_status,notes)
values ('9035e47f-f16c-4fa3-83fd-873bd98dc221','Before migration','other','UTC','confirmed','Preserve');
insert into public.trip_flights(trip_id,airline,flight_status)
values ('9035e47f-f16c-4fa3-83fd-873bd98dc221','Before migration','confirmed');
insert into public.trip_accommodations(trip_id,name,accommodation_type,time_zone,reservation_status)
values ('9035e47f-f16c-4fa3-83fd-873bd98dc221','Before migration','hotel','UTC','confirmed');
insert into public.trip_itinerary_items(trip_id,title,timing_kind,status,is_optional)
values ('9035e47f-f16c-4fa3-83fd-873bd98dc221','Before migration','unscheduled','completed',true);
create table public.progress_before_snapshot as
select 'activity' as source,to_jsonb(a) as row from public.trip_activities a
union all select 'flight',to_jsonb(f) from public.trip_flights f
union all select 'accommodation',to_jsonb(a) from public.trip_accommodations a
union all select 'manual',to_jsonb(i) from public.trip_itinerary_items i;

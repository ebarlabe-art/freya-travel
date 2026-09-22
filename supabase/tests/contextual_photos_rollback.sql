-- LOCAL/STAGING ONLY: rollback all fixtures. No Storage API calls.
begin;
create temporary table photo_fixture (a uuid default gen_random_uuid(),b uuid default gen_random_uuid(),outsider uuid default gen_random_uuid(),
 t uuid default gen_random_uuid(),other_t uuid default gen_random_uuid(),london uuid default gen_random_uuid(),activity uuid default gen_random_uuid(),manual uuid default gen_random_uuid(),
 doc uuid default gen_random_uuid(),legacy uuid default gen_random_uuid(),batch uuid default gen_random_uuid());
insert into photo_fixture default values;
grant select on photo_fixture to authenticated;
create function pg_temp.assert_photo(ok boolean,description text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',description; end if; end; $$;
do $$ declare f photo_fixture; begin
 select * into f from photo_fixture;
 insert into auth.users(id) values(f.a),(f.b),(f.outsider);
 insert into public.trips(id,name,owner_id,time_zone,experience_key) values(f.t,'Photos test',f.a,'UTC',null),(f.other_t,'Other',f.a,'UTC',null),(f.london,'London',f.a,'UTC','london-2026');
 insert into public.trip_members(trip_id,user_id) values(f.t,f.a),(f.t,f.b),(f.other_t,f.a),(f.london,f.a);
 perform set_config('request.jwt.claim.sub',f.a::text,true);
 insert into public.trip_activities(id,trip_id,title,activity_type,time_zone) values(f.activity,f.t,'Source','other','UTC');
 insert into public.trip_itinerary_items(id,trip_id,title,timing_kind,time_zone) values(f.manual,f.t,'Manual','unscheduled','UTC');
 insert into public.travel_documents(id,trip_id,title,category,file_name,file_path,mime_type,created_by) values(f.legacy,f.t,'Old photo','Foto','old.jpg',f.t||'/photos/old.jpg','image/jpeg',f.a);
 perform pg_temp.assert_photo(not exists(select 1 from public.trip_photo_metadata where document_id=f.legacy),'old photo has no fabricated context');
 perform pg_temp.assert_photo(not has_table_privilege('authenticated','public.trip_photo_metadata','UPDATE'),'direct UPDATE cannot bypass CAS');
 perform pg_temp.assert_photo(not has_function_privilege('anon','public.finalize_trip_photo(uuid,uuid,text,text,text,uuid,integer,date,uuid,uuid)','EXECUTE'),'anon no finalize');
end; $$;
set local role authenticated;
do $$ declare f photo_fixture; r jsonb; retry jsonb; m public.trip_photo_metadata; v timestamptz; begin
 select * into f from photo_fixture;
 r:=public.finalize_trip_photo(f.t,f.doc,'Photo','a.jpg','image/jpeg',f.batch,0,'2026-09-22',f.activity,null);
 retry:=public.finalize_trip_photo(f.t,f.doc,'Ignored retry title','a.jpg','image/jpeg',f.batch,0,null,null,null);
 perform pg_temp.assert_photo(r=retry,'lost finalization response retries without new row or context overwrite');
 perform pg_temp.assert_photo((select count(*)=1 from public.travel_documents where id=f.doc),'one document');
 perform pg_temp.assert_photo((select count(*)=1 from public.trip_photo_metadata where document_id=f.doc),'one metadata');
 begin
   perform public.finalize_trip_photo(f.t,gen_random_uuid(),'Duplicate slot','b.jpg','image/jpeg',f.batch,0,null,null,null);
   raise exception 'duplicate batch position allowed';
 exception when unique_violation then null; end;
 begin
   perform public.finalize_trip_photo(f.other_t,gen_random_uuid(),'Cross trip','c.jpg','image/jpeg',gen_random_uuid(),0,null,f.activity,null);
   raise exception 'cross trip source allowed';
 exception when foreign_key_violation then null; end;
 begin
   perform public.finalize_trip_photo(f.t,gen_random_uuid(),'Two sources','c.jpg','image/jpeg',gen_random_uuid(),0,null,f.activity,f.manual);
   raise exception 'two sources allowed';
 exception when check_violation then null; end;
 begin
   perform public.finalize_trip_photo(f.london,gen_random_uuid(),'London','c.jpg','image/jpeg',gen_random_uuid(),0,null,null,null);
   raise exception 'London accepted';
 exception when insufficient_privilege then null; end;
 v:=(r->'metadata'->>'updated_at')::timestamptz;
 perform set_config('request.jwt.claim.sub',f.b::text,true);
 m:=public.set_trip_photo_context(f.t,f.doc,v,'2026-09-23',null,f.manual);
 perform pg_temp.assert_photo(m.itinerary_item_id=f.manual and m.activity_id is null and m.updated_at>v,'member B context edit authoritative');
 begin
   perform public.set_trip_photo_context(f.t,f.doc,v,null,null,null);
   raise exception 'stale CAS accepted';
 exception when serialization_failure then null; end;
 perform set_config('request.jwt.claim.sub',f.a::text,true);
 retry:=public.finalize_trip_photo(f.t,f.doc,'Retry','a.jpg','image/jpeg',f.batch,0,'2026-09-22',f.activity,null);
 perform pg_temp.assert_photo(retry->'metadata'->>'itinerary_item_id'=f.manual::text,'retry preserves member B correction');
 m:=public.set_trip_photo_context(f.t,f.legacy,null,null,f.activity,null);
 perform pg_temp.assert_photo(m.upload_batch_id is null and m.local_date is null,'legacy context explicit, no invented batch/day');
 delete from public.trip_activities where id=f.activity and trip_id=f.t;
 perform pg_temp.assert_photo((select activity_id is null from public.trip_photo_metadata where document_id=f.legacy),'activity deletion unlinks');
 perform pg_temp.assert_photo(exists(select 1 from public.travel_documents where id=f.legacy),'activity deletion keeps photo');
 delete from public.trip_itinerary_items where id=f.manual and trip_id=f.t;
 perform pg_temp.assert_photo((select itinerary_item_id is null and local_date='2026-09-23' from public.trip_photo_metadata where document_id=f.doc),'planning deletion unlinks, preserves explicit day');
 begin
   update public.travel_documents set category='Altres' where id=f.doc;
   raise exception 'contextual category mutation allowed';
 exception when invalid_parameter_value then null; end;
 perform set_config('request.jwt.claim.sub',f.outsider::text,true);
 perform pg_temp.assert_photo((select count(*)=0 from public.trip_photo_metadata),'outsider SELECT hidden by RLS');
 begin
   perform public.set_trip_photo_context(f.t,f.doc,null,null,null,null);
   raise exception 'outsider RPC allowed';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform public.finalize_trip_photo(f.t,gen_random_uuid(),'No auth','x.jpg','image/jpeg',gen_random_uuid(),0,null,null,null);
   raise exception 'no auth accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',f.a::text,true);
 delete from public.travel_documents where id=f.doc and trip_id=f.t;
 perform pg_temp.assert_photo(not exists(select 1 from public.trip_photo_metadata where document_id=f.doc),'photo deletion cascades metadata');
 perform pg_temp.assert_photo((select title='Old photo' and file_path=f.t||'/photos/old.jpg' from public.travel_documents where id=f.legacy),'legacy photo data unchanged');
end; $$;
reset role;
do $$ declare f photo_fixture; v timestamptz; begin
 select * into f from photo_fixture;
 perform set_config('request.jwt.claim.sub',f.b::text,true);
 select updated_at into v from public.trip_photo_metadata where document_id=f.legacy;
 perform public.set_trip_photo_context(f.t,f.legacy,v,null,null,null);
 delete from auth.users where id=f.b;
 perform pg_temp.assert_photo((select updated_by is null from public.trip_photo_metadata where document_id=f.legacy),'deleting editor account nulls audit ID, preserves photo');
end; $$;
rollback;

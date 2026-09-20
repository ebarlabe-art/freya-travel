-- Local/staging regression suite. Transaction rolls back all fixtures.
begin;
create temporary table progress_fixture (
  user_a uuid default gen_random_uuid(), user_b uuid default gen_random_uuid(), outsider uuid default gen_random_uuid(),
  trip_id uuid default gen_random_uuid(), other_trip uuid default gen_random_uuid(), london_trip uuid default gen_random_uuid(),
  activity uuid default gen_random_uuid(), flight uuid default gen_random_uuid(), stay uuid default gen_random_uuid(),
  manual uuid default gen_random_uuid(), cancelled uuid default gen_random_uuid(), london_activity uuid default gen_random_uuid()
);
insert into progress_fixture default values;
grant select on progress_fixture to authenticated;
create function pg_temp.assert_progress(ok boolean, description text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', description; end if; end;
$$;
do $$
declare f progress_fixture; begin
  select * into f from progress_fixture;
  insert into auth.users(id,email) values (f.user_a,'progress-a@example.invalid'),(f.user_b,'progress-b@example.invalid'),(f.outsider,'progress-outsider@example.invalid');
  insert into public.trips(id,name,owner_id,time_zone,experience_key) values
    (f.trip_id,'Progress test',f.user_a,'Europe/Madrid',null),
    (f.other_trip,'Other test',f.outsider,'UTC',null),
    (f.london_trip,'London test',f.user_a,'Europe/London','london-2026');
  insert into public.trip_members(trip_id,user_id) values (f.trip_id,f.user_a),(f.trip_id,f.user_b),(f.other_trip,f.outsider),(f.london_trip,f.user_a);
  perform set_config('request.jwt.claim.sub',f.user_a::text,true);
  insert into public.trip_activities(id,trip_id,title,activity_type,time_zone,reservation_status,start_at,end_at) values
    (f.activity,f.trip_id,'Activity','other','Europe/Madrid','confirmed',now()+interval '2 days',now()+interval '2 days 1 hour'),
    (f.cancelled,f.trip_id,'Cancelled','other','Europe/Madrid','cancelled',now()+interval '2 days',null),
    (f.london_activity,f.london_trip,'Legacy protection','other','Europe/London','confirmed',null,null);
  insert into public.trip_flights(id,trip_id,airline,flight_status,departure_at,departure_time_zone) values (f.flight,f.trip_id,'Test','confirmed',now()+interval '2 days','Europe/Madrid');
  insert into public.trip_accommodations(id,trip_id,accommodation_type,name,time_zone,reservation_status,check_in_at,check_out_at)
    values(f.stay,f.trip_id,'hotel','Stay','Europe/Madrid','confirmed',now()+interval '2 days',now()+interval '3 days');
  insert into public.trip_itinerary_items(id,trip_id,title,timing_kind,starts_at,ends_at,time_zone,is_optional,is_fixed)
    values(f.manual,f.trip_id,'Optional manual','exact',now()+interval '2 days',now()+interval '2 days 1 hour','Europe/Madrid',true,false);
  insert into public.push_subscriptions(user_id,trip_id,endpoint,p256dh,auth) values(f.user_a,f.trip_id,'https://push.invalid/progress','p256dh','auth');
  perform pg_temp.assert_progress((select completed_at is null from public.trip_activities where id=f.activity),'activity starts NULL');
  perform pg_temp.assert_progress((select completed_at is null from public.trip_flights where id=f.flight),'flight starts NULL');
  perform pg_temp.assert_progress((select check_in_completed_at is null and check_out_completed_at is null from public.trip_accommodations where id=f.stay),'independent stay timestamps start NULL');
  perform pg_temp.assert_progress(not has_function_privilege('anon','public.set_trip_event_completed(uuid,text,uuid,text,boolean,timestamptz)','EXECUTE'),'anon has no RPC access');
  perform pg_temp.assert_progress(has_function_privilege('authenticated','public.set_trip_event_completed(uuid,text,uuid,text,boolean,timestamptz)','EXECUTE'),'member role has RPC access');
  perform pg_temp.assert_progress((select not prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.set_trip_event_completed(uuid,text,uuid,text,boolean,timestamptz)'::regprocedure),'RPC invoker with empty search path');
  perform public.sync_notification_deliveries();
  perform pg_temp.assert_progress((select count(*)=5 from public.trip_reminders where trip_id=f.trip_id and enabled),'five eligible events initially');
end; $$;

set local role authenticated;
do $$
declare f progress_fixture; v timestamptz; result jsonb; same jsonb; begin
  select * into f from progress_fixture;
  select updated_at into v from public.trip_activities where id=f.activity;
  result:=public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',true,v);
  perform pg_temp.assert_progress((result->>'is_completed')::boolean and (result->>'updated_at')::timestamptz>v,'activity completion returns authoritative newer version');
  perform pg_temp.assert_progress(result->'row'->>'reservation_status'='confirmed','reservation untouched');
  perform pg_temp.assert_progress((result->>'completed_at')::timestamptz>=statement_timestamp(),'server completion time');
  perform set_config('request.jwt.claim.sub',f.user_b::text,true);
  same:=public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',true,v);
  perform pg_temp.assert_progress(same=result,'second participant same desired state idempotent');
  begin
    perform public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',false,v);
    raise exception 'stale opposing command accepted';
  exception when serialization_failure then null; end;
  result:=public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',false,(result->>'updated_at')::timestamptz);
  perform pg_temp.assert_progress(not (result->>'is_completed')::boolean and result->>'completed_at' is null,'undo clears progress only');
  result:=public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',true,(result->>'updated_at')::timestamptz);

  select updated_at into v from public.trip_flights where id=f.flight;
  result:=public.set_trip_event_completed(f.trip_id,'flight',f.flight,'departure',true,v);
  perform pg_temp.assert_progress(result->'row'->>'flight_status'='confirmed' and (result->>'is_completed')::boolean,'flight done does not imply operational status');
  select updated_at into v from public.trip_accommodations where id=f.stay;
  result:=public.set_trip_event_completed(f.trip_id,'accommodation',f.stay,'check_in',true,v);
  perform pg_temp.assert_progress(result->'row'->>'check_out_completed_at' is null,'check-in does not complete check-out');
  begin
    perform public.set_trip_event_completed(f.trip_id,'accommodation',f.stay,'check_out',true,v);
    raise exception 'stale sibling-event version accepted';
  exception when serialization_failure then null; end;
  result:=public.set_trip_event_completed(f.trip_id,'accommodation',f.stay,'check_out',true,(result->>'updated_at')::timestamptz);
  result:=public.set_trip_event_completed(f.trip_id,'accommodation',f.stay,'check_in',false,(result->>'updated_at')::timestamptz);
  perform pg_temp.assert_progress(result->'row'->>'check_in_completed_at' is null and result->'row'->>'check_out_completed_at' is not null,'undo check-in preserves check-out');
  result:=public.set_trip_event_completed(f.trip_id,'accommodation',f.stay,'check_in',true,(result->>'updated_at')::timestamptz);
  select updated_at into v from public.trip_itinerary_items where id=f.manual;
  result:=public.set_trip_event_completed(f.trip_id,'manual',f.manual,'manual',true,v);
  perform pg_temp.assert_progress(result->'row'->>'status'='completed' and (result->'row'->>'is_optional')::boolean and not (result->'row'->>'is_fixed')::boolean,'manual completion preserves optional/flexible flags');
  perform pg_temp.assert_progress(result->>'completed_at' is null,'manual does not invent completion timestamp');
  select updated_at into v from public.trip_activities where id=f.cancelled;
  begin perform public.set_trip_event_completed(f.trip_id,'activity',f.cancelled,'start',true,v);raise exception 'cancelled accepted';exception when invalid_parameter_value then null;end;
  begin perform public.set_trip_event_completed(f.trip_id,'activity',f.activity,'arrival',true,v);raise exception 'invalid event accepted';exception when invalid_parameter_value then null;end;
  begin perform public.set_trip_event_completed(f.trip_id,'trip_activities; DROP TABLE trips',f.activity,'start',true,v);raise exception 'invalid source accepted';exception when invalid_parameter_value then null;end;
  begin perform public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',null,v);raise exception 'null desired state accepted';exception when invalid_parameter_value then null;end;
  begin perform public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',false,null);raise exception 'null version accepted';exception when invalid_parameter_value then null;end;
  begin perform public.set_trip_event_completed(f.trip_id,'activity',f.london_activity,'start',true,v);raise exception 'wrong trip source accepted';exception when no_data_found then null;end;
  perform set_config('request.jwt.claim.sub',f.user_a::text,true);
  begin perform public.set_trip_event_completed(f.london_trip,'activity',f.london_activity,'start',true,v);raise exception 'London accepted';exception when insufficient_privilege then null;end;
end; $$;
reset role;
do $$
declare f progress_fixture; begin
  select * into f from progress_fixture;
  perform public.sync_notification_deliveries();
  perform pg_temp.assert_progress((select count(*)=0 from public.trip_reminders where trip_id=f.trip_id and enabled),'all five completed reminders disabled');
  perform pg_temp.assert_progress((select count(*)=5 from public.notification_deliveries d join public.trip_reminders r on r.id=d.reminder_id where r.trip_id=f.trip_id and d.status='missed' and d.last_error_code='reminder-disabled'),'all five pending deliveries retired');
  -- Completing before first sync must not create even a disabled reminder row.
  delete from public.trip_reminders where trip_id=f.trip_id;
  perform public.sync_notification_deliveries();
  perform pg_temp.assert_progress(not exists(select 1 from public.trip_reminders where trip_id=f.trip_id),'no new reminders for done events');
end; $$;
set local role authenticated;
do $$
declare f progress_fixture; source record; v timestamptz; result jsonb; begin
  select * into f from progress_fixture;
  for source in select * from (values ('activity','start','trip_activities',f.activity),('flight','departure','trip_flights',f.flight),('accommodation','check_in','trip_accommodations',f.stay),('accommodation','check_out','trip_accommodations',f.stay),('manual','manual','trip_itinerary_items',f.manual)) as s(kind,event,tablename,id) loop
    execute format('select updated_at from public.%I where id=$1',source.tablename) into v using source.id;
    result:=public.set_trip_event_completed(f.trip_id,source.kind,source.id,source.event,false,v);
    perform pg_temp.assert_progress(not(result->>'is_completed')::boolean,'undo each source/event');
  end loop;
  perform pg_temp.assert_progress((select status='planned' and is_optional from public.trip_itinerary_items where id=f.manual),'manual returns to planned not cancelled');
  update public.trip_activities set completed_at='2000-01-01' where id=f.activity;
  perform pg_temp.assert_progress((select completed_at>=statement_timestamp() from public.trip_activities where id=f.activity),'direct writes cannot supply old completion time');
  update public.trip_activities set completed_at=null,start_at=now()-interval '1 day',end_at=now()-interval '23 hours' where id=f.activity;
  perform pg_temp.assert_progress((select completed_at is null from public.trip_activities where id=f.activity),'passing time does not complete');
  update public.trip_activities set start_at=now()+interval '2 days',end_at=now()+interval '2 days 1 hour' where id=f.activity;
  update public.trip_itinerary_items set status='cancelled' where id=f.manual;
  select updated_at into v from public.trip_itinerary_items where id=f.manual;
  begin perform public.set_trip_event_completed(f.trip_id,'manual',f.manual,'manual',true,v);raise exception 'cancelled manual accepted';exception when invalid_parameter_value then null;end;
  begin update public.trip_itinerary_items set status='completed' where id=f.manual;raise exception 'cancelled direct manual accepted';exception when invalid_parameter_value then null;end;
  update public.trip_itinerary_items set status='planned' where id=f.manual;
  perform set_config('request.jwt.claim.sub',f.outsider::text,true);
  perform pg_temp.assert_progress(not exists(select 1 from public.trip_activities where trip_id=f.trip_id),'RLS hides foreign sources');
  update public.trip_activities set completed_at=now() where id=f.activity;
  perform pg_temp.assert_progress(not found,'RLS denies foreign direct update');
  begin perform public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',true,now());raise exception 'nonmember RPC accepted';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',true,now());raise exception 'unauthenticated RPC accepted';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub',f.user_a::text,true);
end; $$;
reset role;
do $$
declare f progress_fixture; v timestamptz; r jsonb; begin
  select * into f from progress_fixture;
  perform public.sync_notification_deliveries();
  perform pg_temp.assert_progress((select count(*)=5 from public.trip_reminders where trip_id=f.trip_id and enabled),'undo re-enables future reminders');
  update public.notification_deliveries d set status='sent',sent_at=now() from public.trip_reminders r where r.id=d.reminder_id and r.source_id=f.activity;
  select updated_at into v from public.trip_activities where id=f.activity;
  r:=public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',true,v);
  perform public.sync_notification_deliveries();
  perform public.set_trip_event_completed(f.trip_id,'activity',f.activity,'start',false,(r->>'updated_at')::timestamptz);
  perform public.sync_notification_deliveries();
  perform pg_temp.assert_progress((select bool_and(d.status='sent') from public.notification_deliveries d join public.trip_reminders r on r.id=d.reminder_id where r.source_id=f.activity),'undo never resends already sent notification');
  select updated_at into v from public.trip_flights where id=f.flight;
  r:=public.set_trip_event_completed(f.trip_id,'flight',f.flight,'departure',true,v);
  perform public.sync_notification_deliveries();
  perform public.set_trip_event_completed(f.trip_id,'flight',f.flight,'departure',false,(r->>'updated_at')::timestamptz);
  perform public.sync_notification_deliveries();
  perform pg_temp.assert_progress((select bool_and(d.status='pending') from public.notification_deliveries d join public.trip_reminders r on r.id=d.reminder_id where r.source_id=f.flight),'undo re-arms previously disabled pending delivery');
end; $$;
set local role service_role;
select public.sync_notification_deliveries();
reset role;
rollback;

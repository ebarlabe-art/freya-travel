-- RIG-03B. Additive, no backfill. Never call the global reminder synchronizer.
create schema if not exists itinerary_private;
revoke all on schema itinerary_private from public, anon;
grant usage on schema itinerary_private to authenticated;
create table itinerary_private.reconciliations (
 trip_id uuid not null references public.trips(id) on delete cascade,
 operation_id uuid not null, actor uuid not null, document_id uuid not null,
 request jsonb not null, before_items jsonb not null, before_reminders jsonb not null,
 result jsonb not null, created_at timestamptz not null default now(),
 primary key(trip_id,operation_id)
);
alter table itinerary_private.reconciliations enable row level security;
revoke all on itinerary_private.reconciliations from public,anon,authenticated;

-- Counts are server-owned. Currently the only FK from another feature to a
-- manual plan is trip_photo_metadata; fixed plans are protected separately.
create function itinerary_private.reconciliation_snapshot(p_trip_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_trip_member(p_trip_id) then raise sqlstate '42501' using message='RIG_FORBIDDEN'; end if;
 if not exists(select 1 from public.trips where id=p_trip_id and experience_key is distinct from 'london-2026') then raise sqlstate '42501' using message='RIG_UNAVAILABLE'; end if;
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('photo_count',
  (select count(*) from public.trip_photo_metadata m where m.trip_id=i.trip_id and m.itinerary_item_id=i.id),
  'link_count',0) order by i.id),'[]') into result from public.trip_itinerary_items i where i.trip_id=p_trip_id;
 if jsonb_array_length(result)>500 then raise sqlstate '22023' using message='RIG_LIMIT'; end if;
 return result;
end $$;
revoke all on function itinerary_private.reconciliation_snapshot(uuid) from public,anon;
grant execute on function itinerary_private.reconciliation_snapshot(uuid) to authenticated;
create function public.read_itinerary_reconciliation(p_trip_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select itinerary_private.reconciliation_snapshot(p_trip_id)$$;
revoke all on function public.read_itinerary_reconciliation(uuid) from public,anon;
grant execute on function public.read_itinerary_reconciliation(uuid) to authenticated;

create function itinerary_private.commit_reconciliation(p_trip_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_existing jsonb,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); t public.trips; old public.trip_itinerary_items; r public.trip_itinerary_items;
 request jsonb:=jsonb_build_object('document',p_document_id,'expected',p_expected_existing,'changes',p_changes);
 receipt itinerary_private.reconciliations; before_items jsonb; before_reminders jsonb;
 action jsonb; fields jsonb; base jsonb; snapshot jsonb; result jsonb;
 seen uuid[]:='{}'; target uuid; day date; adds integer:=0; updates integer:=0; retires integer:=0;
begin
 if uid is null or not public.is_trip_member(p_trip_id) then raise sqlstate '42501' using message='RIG_FORBIDDEN'; end if;
 if p_operation_id is null or p_document_id is null or jsonb_typeof(p_expected_existing) is distinct from 'array' or jsonb_typeof(p_changes) is distinct from 'array' then raise sqlstate '22023' using message='RIG_INVALID'; end if;
 if jsonb_array_length(p_expected_existing)>500 or jsonb_array_length(p_changes) not between 1 and 700 or octet_length(request::text)>1048576 then raise sqlstate '22023' using message='RIG_LIMIT'; end if;
 if (select count(*) from jsonb_array_elements(p_changes) x where x->>'action' in ('add','update'))>200 then raise sqlstate '22023' using message='RIG_LIMIT'; end if;
 -- Trip row lock also fences concurrent INSERTs through the itinerary FK.
 select * into t from public.trips where id=p_trip_id for update;
 if not found or t.experience_key='london-2026' or not public.is_trip_member(p_trip_id) then raise sqlstate '42501' using message='RIG_FORBIDDEN'; end if;
 select * into receipt from itinerary_private.reconciliations where trip_id=p_trip_id and operation_id=p_operation_id;
 if found then
  if receipt.actor<>uid or receipt.request<>request then raise sqlstate 'PT409' using message='RIG_OPERATION_CONFLICT'; end if;
  return receipt.result;
 end if;
 perform 1 from public.travel_documents where id=p_document_id and trip_id=p_trip_id for share;
 if not found then raise sqlstate '42501' using message='RIG_DOCUMENT_UNAVAILABLE'; end if;
 perform 1 from public.trip_itinerary_items where trip_id=p_trip_id order by id for update;
 snapshot:=itinerary_private.reconciliation_snapshot(p_trip_id);
 if jsonb_array_length(snapshot)<>jsonb_array_length(p_expected_existing) or
  (select count(distinct x->>'id') from jsonb_array_elements(p_expected_existing) x)<>jsonb_array_length(snapshot) then raise sqlstate 'PT409' using message='RIG_STALE'; end if;
 for base in select value from jsonb_array_elements(p_expected_existing) loop
  if not exists(select 1 from jsonb_array_elements(snapshot) x where x->>'id'=base->>'id' and (x->>'updated_at')::timestamptz=(base->>'updated_at')::timestamptz) then raise sqlstate 'PT409' using message='RIG_STALE'; end if;
 end loop;
 select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') into before_items from public.trip_itinerary_items i where trip_id=p_trip_id;
 select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') into before_reminders from public.trip_reminders m where trip_id=p_trip_id and source_kind='itinerary_item';
 for action in select value from jsonb_array_elements(p_changes) loop
  if jsonb_typeof(action) is distinct from 'object' or action-'action'-'id'-'fields'<>'{}' or coalesce(action->>'action','') not in ('add','update','retire') then raise sqlstate '22023' using message='RIG_ACTION'; end if;
  target:=(action->>'id')::uuid;
  if target is null or target=any(seen) then raise sqlstate '22023' using message='RIG_TARGET'; end if;
  seen:=array_append(seen,target);
  if action->>'action'<>'add' then
   select * into old from public.trip_itinerary_items where trip_id=p_trip_id and id=target;
   if not found then raise sqlstate 'PT409' using message='RIG_TARGET'; end if;
   if old.status<>'planned' or old.is_fixed or exists(select 1 from public.trip_photo_metadata where trip_id=p_trip_id and itinerary_item_id=target) then raise sqlstate 'PT409' using message='RIG_PROTECTED'; end if;
  elsif exists(select 1 from public.trip_itinerary_items where id=target) then raise sqlstate 'PT409' using message='RIG_TARGET_EXISTS';
  end if;
  if action->>'action'='retire' then
   if action ? 'fields' then raise sqlstate '22023' using message='RIG_FIELDS'; end if;
   -- Soft retirement preserves identity, original fields and references.
   update public.trip_itinerary_items set status='cancelled' where trip_id=p_trip_id and id=target;
   retires:=retires+1;continue;
  end if;
  fields:=action->'fields';
  if jsonb_typeof(fields) is distinct from 'object' or fields-array['title','timing_kind','local_date','starts_at','ends_at','time_zone','daypart','approximate_start_time','approximate_end_time','location_name','address','city','notes','is_optional','sort_order']<>'{}' then raise sqlstate '22023' using message='RIG_FIELDS'; end if;
  r:=jsonb_populate_record(null::public.trip_itinerary_items,fields);
  if r.title is null or r.title !~ '[[:alpha:]]' or coalesce(r.timing_kind,'') not in ('exact','date','daypart') or r.sort_order is null or r.sort_order not between 0 and 199 or r.is_optional is null then raise sqlstate '22023' using message='RIG_FIELDS'; end if;
  if r.time_zone is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=r.time_zone) then raise sqlstate '22023' using message='RIG_ZONE'; end if;
  day:=case when r.timing_kind='exact' then (r.starts_at at time zone r.time_zone)::date else r.local_date end;
  if day is null or (t.start_date is not null and day<t.start_date) or (t.end_date is not null and day>t.end_date) or (r.ends_at is not null and t.end_date is not null and (r.ends_at at time zone r.time_zone)::date>t.end_date) then raise sqlstate '22023' using message='RIG_DATE'; end if;
  if action->>'action'='add' then
   insert into public.trip_itinerary_items(id,trip_id,created_by,title,timing_kind,local_date,starts_at,ends_at,time_zone,daypart,approximate_start_time,approximate_end_time,location_name,address,city,notes,status,is_fixed,is_optional,sort_order)
   values(target,p_trip_id,uid,r.title,r.timing_kind,r.local_date,r.starts_at,r.ends_at,r.time_zone,r.daypart,r.approximate_start_time,r.approximate_end_time,r.location_name,r.address,r.city,r.notes,'planned',false,r.is_optional,r.sort_order);
   adds:=adds+1;
  else
   -- notes, progress, creator, identity and optional/fixed flags stay canonical.
   update public.trip_itinerary_items set title=r.title,timing_kind=r.timing_kind,local_date=r.local_date,starts_at=r.starts_at,ends_at=r.ends_at,time_zone=r.time_zone,daypart=r.daypart,approximate_start_time=r.approximate_start_time,approximate_end_time=r.approximate_end_time,location_name=r.location_name,address=r.address,city=r.city,sort_order=r.sort_order where trip_id=p_trip_id and id=target;
   updates:=updates+1;
  end if;
 end loop;
 -- Deliberately scoped to touched manual sources; never flight/hotel/activity.
 insert into public.trip_reminders(trip_id,source_kind,source_id,reminder_kind,title,event_at,default_notify_before_minutes,scheduled_for,enabled,source_updated_at)
 select i.trip_id,'itinerary_item',i.id,'itinerary_exact',i.title,i.starts_at,60,i.starts_at-interval '60 minutes',true,i.updated_at
 from public.trip_itinerary_items i where i.trip_id=p_trip_id and i.id=any(seen) and i.status='planned' and i.timing_kind='exact' and i.starts_at>statement_timestamp()
 on conflict(trip_id,source_kind,source_id,reminder_kind) do update set title=excluded.title,event_at=excluded.event_at,scheduled_for=excluded.scheduled_for,default_notify_before_minutes=60,enabled=true,source_updated_at=excluded.source_updated_at,updated_at=statement_timestamp();
 update public.trip_reminders m set enabled=false,updated_at=statement_timestamp() where m.trip_id=p_trip_id and m.source_kind='itinerary_item' and m.source_id=any(seen) and not exists(select 1 from public.trip_itinerary_items i where i.trip_id=p_trip_id and i.id=m.source_id and i.status='planned' and i.timing_kind='exact' and i.starts_at>statement_timestamp());
 result:=jsonb_build_object('operation_id',p_operation_id,'added',adds,'updated',updates,'retired',retires);
 insert into itinerary_private.reconciliations(trip_id,operation_id,actor,document_id,request,before_items,before_reminders,result) values(p_trip_id,p_operation_id,uid,p_document_id,request,before_items,before_reminders,result);
 return result;
end $$;
revoke all on function itinerary_private.commit_reconciliation(uuid,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function itinerary_private.commit_reconciliation(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
create function public.commit_itinerary_reconciliation(p_trip_id uuid,p_operation_id uuid,p_document_id uuid,p_expected_existing jsonb,p_changes jsonb) returns jsonb
language sql security invoker set search_path='' as $$select itinerary_private.commit_reconciliation(p_trip_id,p_operation_id,p_document_id,p_expected_existing,p_changes)$$;
revoke all on function public.commit_itinerary_reconciliation(uuid,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.commit_itinerary_reconciliation(uuid,uuid,uuid,jsonb,jsonb) to authenticated;

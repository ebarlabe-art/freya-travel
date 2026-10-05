-- ALB-03: ingestion boundary. No source mutation, frontend change or automatic purge.
create table app_private.alb03_ingestions (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null, book_id uuid not null,
 asset_id uuid not null unique, source_id uuid not null, source_path text not null, source_token text not null,
 snapshot_id uuid not null, lease_id uuid, lease_until timestamptz, attempts integer not null default 0,
 error_code text check(error_code in ('SOURCE_MISSING','SOURCE_CHANGED','INVALID_IMAGE','LIMIT_EXCEEDED','STORAGE_ERROR','MASTER_MISSING','DERIVATIVE_UNSUPPORTED','DERIVATIVE_CAPACITY','DERIVATIVE_COLOR','DERIVATIVE_FAILED')),
 source_hash text check(source_hash ~ '^[0-9a-f]{64}$'), source_orientation smallint check(source_orientation between 0 and 8),
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(trip_id,book_id,asset_id) references public.travel_book_assets(trip_id,book_id,id) on delete restrict,
 foreign key(trip_id,book_id,snapshot_id) references public.travel_book_source_snapshots(trip_id,book_id,id) on delete restrict,
 unique(book_id,source_id,source_token)
);
create index alb03_ingestions_scope on app_private.alb03_ingestions(trip_id,book_id,snapshot_id);
create table app_private.alb03_requests (
 actor_id uuid not null, operation_id uuid not null, trip_id uuid not null, book_id uuid not null,
 request jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,operation_id), foreign key(trip_id,book_id) references public.travel_books(trip_id,id) on delete restrict
);
create index alb03_requests_scope on app_private.alb03_requests(trip_id,book_id);
create table public.travel_book_asset_variants (
 trip_id uuid not null,book_id uuid not null,asset_id uuid not null,
 kind text not null check(kind in ('original','preview','thumbnail')), pipeline_version integer not null check(pipeline_version=1),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 width_px integer not null check(width_px between 1 and 32768),height_px integer not null check(height_px between 1 and 32768),
 mime_type text not null,
 file_extension text not null,byte_size integer not null check(byte_size between 1 and 33554432),orientation smallint not null check(orientation between 0 and 8),
 check((mime_type,file_extension) in (('image/jpeg','jpg'),('image/png','png'),('image/webp','webp'),('image/heic','heic'),('image/heif','heif'))),
 check(width_px::bigint*height_px<=200000000),
 check(kind='original' or (mime_type='image/png' and orientation=1 and greatest(width_px,height_px)<=1600)),
 storage_bucket text not null check(storage_bucket='travel-book'),
 storage_path text not null check(length(storage_path)<1024 and storage_path !~ '(^/|://|\?|\.\.)'),
 primary key(asset_id,kind), foreign key(trip_id,book_id,asset_id) references public.travel_book_assets(trip_id,book_id,id) on delete restrict,
 check(kind<>'thumbnail' or greatest(width_px,height_px)<=320)
);
create index travel_book_variants_scope on public.travel_book_asset_variants(trip_id,book_id,asset_id);
alter table app_private.alb03_ingestions enable row level security;
alter table app_private.alb03_requests enable row level security;
alter table public.travel_book_asset_variants enable row level security;
revoke all on app_private.alb03_ingestions,app_private.alb03_requests,public.travel_book_asset_variants from public,anon,authenticated,service_role;
grant select on public.travel_book_asset_variants to authenticated;
create policy travel_book_variants_read on public.travel_book_asset_variants for select to authenticated using(public.is_trip_member(trip_id));
create trigger travel_book_variants_immutable before update or delete on public.travel_book_asset_variants for each row execute function app_private.travel_book_reject_mutation();
create trigger alb03_requests_immutable before update or delete on app_private.alb03_requests for each row execute function app_private.travel_book_reject_mutation();

-- Free text must be deliberately reviewed, and obvious credentials/contacts are refused.
-- This is a conservative guard, not a claim that arbitrary text can be classified perfectly.
create function app_private.alb03_text_v1(t text,reviewed boolean) returns text
language plpgsql immutable set search_path='' as $$ begin
 if t is null then return null;end if;
 if reviewed is distinct from true then raise exception 'ALB_TEXT_REVIEW_REQUIRED' using errcode='22023';end if;
 if length(t)>500 or t ~* '(https?://|www\.|@|bearer[[:space:]]|token|password|booking[_ -]?(ref|code)|reserva[[:space:]:#]|[0-9]{6})' then raise exception 'ALB_SENSITIVE_SOURCE' using errcode='22023';end if;
 return nullif(btrim(t),'');
end $$;
create function app_private.alb03_scope_v1(t uuid,b uuid,actor uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 if actor is null then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.trips where id=t and discarded_at is null and experience_key is distinct from 'london-2026' for share;
 if not found then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.trip_members where trip_id=t and user_id=actor for share;
 if not found then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.travel_books where trip_id=t and id=b;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
end $$;
create function app_private.alb03_receipt_v1(t uuid,b uuid,op uuid,req jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ declare r app_private.alb03_requests;begin
 if op is null then raise exception 'ALB_INVALID_OPERATION' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('alb03-op:'||auth.uid()::text||':'||op::text,0));
 perform app_private.alb03_scope_v1(t,b,auth.uid());
 select * into r from app_private.alb03_requests where actor_id=auth.uid() and operation_id=op;
 if found then
  if r.request<>req or r.trip_id<>t or r.book_id<>b then raise exception 'ALB_OPERATION_REUSED' using errcode='22023';end if;
  return r.result;
 end if;return null;
end $$;
create function app_private.capture_travel_book_context_v1(p_trip_id uuid,p_book_id uuid,p_operation_id uuid,p_kind text,p_source_id uuid,p_fields text[],p_text_reviewed boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare req jsonb;r jsonb;captured jsonb:='{}';label text;place text;day date;s uuid;f text;begin
 req:=jsonb_build_object('kind',p_kind,'source_id',p_source_id,'fields',p_fields,'text_reviewed',p_text_reviewed);
 r:=app_private.alb03_receipt_v1(p_trip_id,p_book_id,p_operation_id,req);if r is not null then return r;end if;
 if p_source_id is null or p_fields is null or cardinality(p_fields) not between 1 and 3 or array_position(p_fields,null) is not null or not p_fields<@array['label','local_date','place_label'] then raise exception 'ALB_INVALID_SOURCE_FIELDS' using errcode='22023';end if;
 if p_kind='trip' then
  select name,start_date into label,day from public.trips where id=p_source_id and id=p_trip_id;
 elsif p_kind='photo' then
  select d.title,m.local_date into label,day from public.travel_documents d left join public.trip_photo_metadata m on m.document_id=d.id where d.id=p_source_id and d.trip_id=p_trip_id and d.category='Foto';
 elsif p_kind='activity' then
  select title,venue_name,(start_at at time zone time_zone)::date into label,place,day from public.trip_activities where id=p_source_id and trip_id=p_trip_id;
 elsif p_kind='day' then
  select title,local_date into label,day from public.trip_day_metadata where id=p_source_id and trip_id=p_trip_id;
 else raise exception 'ALB_SOURCE_UNSUPPORTED' using errcode='22023';end if;
 if not found then raise exception 'ALB_SOURCE_MISSING' using errcode='P0002';end if;
 foreach f in array p_fields loop
  if f='label' then captured:=captured||jsonb_strip_nulls(jsonb_build_object(f,app_private.alb03_text_v1(label,p_text_reviewed)));
  elsif f='place_label' then captured:=captured||jsonb_strip_nulls(jsonb_build_object(f,app_private.alb03_text_v1(place,p_text_reviewed)));
  elsif day is not null then captured:=captured||jsonb_build_object(f,day::text);end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('alb03-snapshot:'||p_book_id::text,0));
 select id into s from public.travel_book_source_snapshots where book_id=p_book_id and source_kind=p_kind and source_id=p_source_id and classification='context' and payload=captured limit 1;
 -- Qualify payload: avoid PL/pgSQL name ambiguity and never select arbitrary fields.
 if s is null then
  s:=gen_random_uuid();
  insert into public.travel_book_source_snapshots(id,trip_id,book_id,source_kind,source_id,source_version,classification,origin,availability_at_capture,payload,captured_at,created_by)
   values(s,p_trip_id,p_book_id,p_kind,p_source_id,app_private.travel_book_hash_v1(captured),'context','trip_source','available',captured,clock_timestamp(),auth.uid());
 end if;
 r:=jsonb_build_object('snapshot_id',s);
 insert into app_private.alb03_requests(actor_id,operation_id,trip_id,book_id,request,result) values(auth.uid(),p_operation_id,p_trip_id,p_book_id,req,r);
 return r;
end $$;

create function app_private.request_travel_book_photo_v1(p_trip_id uuid,p_book_id uuid,p_document_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare req jsonb;r jsonb;d public.travel_documents;j app_private.alb03_ingestions;token text;key uuid;v integer;a uuid;s uuid;day date;begin
 req:=jsonb_build_object('document_id',p_document_id);
 r:=app_private.alb03_receipt_v1(p_trip_id,p_book_id,p_operation_id,req);if r is not null then return r;end if;
 perform pg_advisory_xact_lock(hashtextextended('alb03-source:'||p_book_id::text||':'||p_document_id::text,0));
 select * into d from public.travel_documents where id=p_document_id and trip_id=p_trip_id and category='Foto' for share;
 if not found then raise exception 'ALB_SOURCE_MISSING' using errcode='P0002';end if;
 if d.file_path not like p_trip_id::text||'/%' or d.file_path ~ '(:|\?|\.\.)' or d.mime_type not in ('image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif') or d.mime_type is null then raise exception 'ALB_SOURCE_UNSUPPORTED' using errcode='22023';end if;
 select app_private.travel_book_hash_v1(jsonb_build_object('id',o.id,'updated_at',o.updated_at,'path',o.name)) into token from storage.objects o where bucket_id='trip-documents' and name=d.file_path;
 if token is null then raise exception 'ALB_SOURCE_MISSING' using errcode='P0002';end if;
 select * into j from app_private.alb03_ingestions where book_id=p_book_id and source_id=d.id and source_token=token;
 if not found then
  select asset_key into key from public.travel_book_assets where book_id=p_book_id and source_document_id_at_capture=d.id order by version limit 1;
  key:=coalesce(key,gen_random_uuid());
  select coalesce(max(version),0)+1 into v from public.travel_book_assets where book_id=p_book_id and asset_key=key;
  a:=gen_random_uuid();s:=gen_random_uuid();select local_date into day from public.trip_photo_metadata where document_id=d.id;
  insert into public.travel_book_source_snapshots(id,trip_id,book_id,source_kind,source_id,source_version,classification,origin,availability_at_capture,payload,captured_at,created_by)
   values(s,p_trip_id,p_book_id,'photo',d.id,token,'context','trip_source','available',jsonb_strip_nulls(jsonb_build_object('local_date',day::text)),clock_timestamp(),auth.uid());
  insert into public.travel_book_assets(id,trip_id,book_id,asset_key,version,source_document_id,source_document_id_at_capture,created_by,updated_by)
   values(a,p_trip_id,p_book_id,key,v,d.id,d.id,auth.uid(),auth.uid());
  insert into app_private.alb03_ingestions(trip_id,book_id,asset_id,source_id,source_path,source_token,snapshot_id,created_by)
   values(p_trip_id,p_book_id,a,d.id,d.file_path,token,s,auth.uid()) returning * into j;
 end if;
 r:=jsonb_build_object('ingestion_id',j.id,'asset_id',j.asset_id,'snapshot_id',j.snapshot_id);
 insert into app_private.alb03_requests(actor_id,operation_id,trip_id,book_id,request,result) values(auth.uid(),p_operation_id,p_trip_id,p_book_id,req,r);
 return r;
end $$;
create function app_private.get_travel_book_ingestion_v1(p_trip_id uuid,p_book_id uuid,p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare r jsonb;begin
 perform app_private.alb03_scope_v1(p_trip_id,p_book_id,auth.uid());
 select jsonb_build_object('asset',to_jsonb(a),'original_preserved',exists(select 1 from public.travel_book_asset_variants ov where ov.asset_id=a.id and ov.kind='original'),
 'processing_state',case when a.status='ready' then 'ready' when a.status='missing' then 'missing' when exists(select 1 from public.travel_book_asset_variants ov where ov.asset_id=a.id and ov.kind='original') then 'derivative_pending' when j.error_code is not null then 'recoverable_error' else 'pending' end,
 'snapshot_id',j.snapshot_id,'attempts',j.attempts,'error_code',j.error_code,'processing',coalesce(j.lease_until>clock_timestamp(),false),'variants',coalesce((select jsonb_agg(to_jsonb(v) order by kind) from public.travel_book_asset_variants v where v.asset_id=a.id),'[]')) into r
 from public.travel_book_assets a join app_private.alb03_ingestions j on j.asset_id=a.id where a.trip_id=p_trip_id and a.book_id=p_book_id and a.id=p_asset_id;
 if r is null then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;return r;
end $$;

-- Only the authenticated Edge boundary may call worker RPCs with a verified actor.
create function app_private.alb03_claim_v1(p_asset_id uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare j app_private.alb03_ingestions;a public.travel_book_assets;begin
 select * into j from app_private.alb03_ingestions where asset_id=p_asset_id;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 perform app_private.alb03_scope_v1(j.trip_id,j.book_id,p_actor);
 select * into j from app_private.alb03_ingestions where id=j.id for update;
 if j.lease_until>clock_timestamp() then raise exception 'ALB_INGESTION_BUSY' using errcode='55P03';end if;
 select * into a from public.travel_book_assets where id=j.asset_id for update;
 update app_private.alb03_ingestions set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,updated_at=clock_timestamp() where id=j.id returning * into j;
 return jsonb_build_object('job',to_jsonb(j),'asset',to_jsonb(a),'variants',coalesce((select jsonb_agg(to_jsonb(v) order by kind) from public.travel_book_asset_variants v where v.asset_id=a.id),'[]'));
end $$;
create function app_private.alb03_finish_v1(p_asset_id uuid,p_actor uuid,p_lease_id uuid,p_descriptor jsonb,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare j app_private.alb03_ingestions;a public.travel_book_assets;x jsonb;k text;root text;token text;original_exists boolean;complete boolean;old_variant public.travel_book_asset_variants;begin
 select * into j from app_private.alb03_ingestions where asset_id=p_asset_id;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 perform app_private.alb03_scope_v1(j.trip_id,j.book_id,p_actor);
 select * into j from app_private.alb03_ingestions where id=j.id for update;
 if p_lease_id is null or j.lease_id is distinct from p_lease_id or j.lease_until<=clock_timestamp() then raise exception 'ALB_STALE_LEASE' using errcode='40001';end if;
 select * into a from public.travel_book_assets where id=p_asset_id for update;
 if p_error is not null then
  if p_error not in ('SOURCE_MISSING','SOURCE_CHANGED','INVALID_IMAGE','LIMIT_EXCEEDED','STORAGE_ERROR','MASTER_MISSING','DERIVATIVE_UNSUPPORTED','DERIVATIVE_CAPACITY','DERIVATIVE_COLOR','DERIVATIVE_FAILED') then raise exception 'ALB_INVALID_ERROR' using errcode='22023';end if;
  update app_private.alb03_ingestions set error_code=p_error,lease_id=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
  update public.travel_book_assets set status=case when status='ready' or p_error in ('SOURCE_MISSING','MASTER_MISSING') then 'missing' else status end,updated_at=clock_timestamp(),updated_by=p_actor where id=a.id;
  return;
 end if;
 if p_descriptor is null or jsonb_typeof(p_descriptor)<>'object' or not(p_descriptor ? 'original') or p_descriptor-'original'-'preview'-'thumbnail'<>'{}' or (p_descriptor ? 'preview')<>(p_descriptor ? 'thumbnail') then raise exception 'ALB_INVALID_DESCRIPTOR' using errcode='22023';end if;
 complete:=p_descriptor ? 'preview';
 root:=j.trip_id::text||'/'||j.book_id::text||'/'||a.asset_key::text||'/'||a.version::text||'/v1/';
 select exists(select 1 from public.travel_book_asset_variants where asset_id=a.id and kind='original') into original_exists;
 if not original_exists then
  select app_private.travel_book_hash_v1(jsonb_build_object('id',o.id,'updated_at',o.updated_at,'path',o.name)) into token from storage.objects o where bucket_id='trip-documents' and name=j.source_path;
  if token is distinct from j.source_token or not exists(select 1 from public.travel_documents where id=j.source_id and trip_id=j.trip_id and category='Foto' and file_path=j.source_path) then raise exception 'ALB_SOURCE_CHANGED' using errcode='40001';end if;
 end if;
 for k,x in select * from jsonb_each(p_descriptor) loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['hash','width','height','path','mime','ext','byte_size','orientation']) or x-'hash'-'width'-'height'-'path'-'mime'-'ext'-'byte_size'-'orientation'<>'{}'
    or jsonb_typeof(x->'width')<>'number' or jsonb_typeof(x->'height')<>'number' or jsonb_typeof(x->'byte_size')<>'number' or jsonb_typeof(x->'orientation')<>'number'
    or coalesce(x->>'hash','')!~'^[0-9a-f]{64}$' or coalesce(x->>'width','')!~'^[1-9][0-9]{0,4}$' or coalesce(x->>'height','')!~'^[1-9][0-9]{0,4}$' or coalesce(x->>'byte_size','')!~'^[1-9][0-9]{0,7}$' or coalesce(x->>'orientation','')!~'^[0-8]$'
    or coalesce(x->>'ext','') not in ('jpg','png','webp','heic','heif') or coalesce(x->>'path','')<>root||k||'.'||(x->>'ext') then raise exception 'ALB_INVALID_DESCRIPTOR' using errcode='22023';end if;
  select * into old_variant from public.travel_book_asset_variants where asset_id=a.id and kind=k;
  if found then
   if (old_variant.content_hash,old_variant.width_px,old_variant.height_px,old_variant.storage_path,old_variant.mime_type,old_variant.file_extension,old_variant.byte_size,old_variant.orientation)
    is distinct from (x->>'hash',(x->>'width')::int,(x->>'height')::int,x->>'path',x->>'mime',x->>'ext',(x->>'byte_size')::int,(x->>'orientation')::smallint) then raise exception 'ALB_IMMUTABLE' using errcode='55000';end if;
  else
   insert into public.travel_book_asset_variants(trip_id,book_id,asset_id,kind,pipeline_version,content_hash,width_px,height_px,mime_type,storage_bucket,storage_path,file_extension,byte_size,orientation)
    values(j.trip_id,j.book_id,a.id,k,1,x->>'hash',(x->>'width')::int,(x->>'height')::int,x->>'mime','travel-book',x->>'path',x->>'ext',(x->>'byte_size')::int,(x->>'orientation')::smallint);
  end if;
 end loop;
 -- The ALB-02 descriptor remains a web-compatible, immutable editorial rendering.
 -- The authoritative original is an independently immutable variant, including while pending.
 if complete then
  update public.travel_book_assets set status='ready',content_hash=p_descriptor#>>'{preview,hash}',mime_type='image/png',width_px=(p_descriptor#>>'{preview,width}')::int,height_px=(p_descriptor#>>'{preview,height}')::int,
   storage_bucket='travel-book',storage_path=p_descriptor#>>'{preview,path}',verified_at=coalesce(verified_at,clock_timestamp()),updated_at=clock_timestamp(),updated_by=p_actor where id=a.id;
 end if;
 update app_private.alb03_ingestions set source_hash=p_descriptor#>>'{original,hash}',source_orientation=(p_descriptor#>>'{original,orientation}')::smallint,error_code=null,
  lease_id=case when complete then null else lease_id end,lease_until=case when complete then null else lease_until end,updated_at=clock_timestamp() where id=j.id;
end $$;

-- A private bucket independent of the gallery lifecycle. No client writes/deletes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('travel-book','travel-book',false,33554432,array['image/jpeg','image/png','image/webp','image/heic','image/heif']);
create function app_private.alb03_can_read_object_v1(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.travel_book_assets a where a.storage_bucket='travel-book' and a.storage_path=path and a.status='ready' and public.is_trip_member(a.trip_id))
 or exists(select 1 from public.travel_book_asset_variants v join public.travel_book_assets a on a.id=v.asset_id where v.storage_path=path and (v.kind='original' or a.status='ready') and public.is_trip_member(a.trip_id))
$$;
create policy travel_book_objects_read on storage.objects for select to authenticated using(bucket_id='travel-book' and app_private.alb03_can_read_object_v1(name));

create function public.capture_travel_book_context_v1(p_trip_id uuid,p_book_id uuid,p_operation_id uuid,p_kind text,p_source_id uuid,p_fields text[],p_text_reviewed boolean default false) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.capture_travel_book_context_v1(p_trip_id,p_book_id,p_operation_id,p_kind,p_source_id,p_fields,p_text_reviewed) $$;
revoke all on function public.capture_travel_book_context_v1(uuid,uuid,uuid,text,uuid,text[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.capture_travel_book_context_v1(uuid,uuid,uuid,text,uuid,text[],boolean) to authenticated;
revoke all on function app_private.capture_travel_book_context_v1(uuid,uuid,uuid,text,uuid,text[],boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.capture_travel_book_context_v1(uuid,uuid,uuid,text,uuid,text[],boolean) to authenticated;

create function public.request_travel_book_photo_v1(p_trip_id uuid,p_book_id uuid,p_document_id uuid,p_operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.request_travel_book_photo_v1(p_trip_id,p_book_id,p_document_id,p_operation_id) $$;
revoke all on function public.request_travel_book_photo_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_travel_book_photo_v1(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function app_private.request_travel_book_photo_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.request_travel_book_photo_v1(uuid,uuid,uuid,uuid) to authenticated;

create function public.get_travel_book_ingestion_v1(p_trip_id uuid,p_book_id uuid,p_asset_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.get_travel_book_ingestion_v1(p_trip_id,p_book_id,p_asset_id) $$;
revoke all on function public.get_travel_book_ingestion_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_travel_book_ingestion_v1(uuid,uuid,uuid) to authenticated;
revoke all on function app_private.get_travel_book_ingestion_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.get_travel_book_ingestion_v1(uuid,uuid,uuid) to authenticated;

create function public.alb03_claim_v1(p_asset_id uuid,p_actor uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app_private.alb03_claim_v1(p_asset_id,p_actor) $$;
revoke all on function public.alb03_claim_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.alb03_claim_v1(uuid,uuid) to service_role;
revoke all on function app_private.alb03_claim_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.alb03_claim_v1(uuid,uuid) to service_role;

create function public.alb03_finish_v1(p_asset_id uuid,p_actor uuid,p_lease_id uuid,p_descriptor jsonb,p_error text default null) returns void
language sql security invoker set search_path='' as $$ select app_private.alb03_finish_v1(p_asset_id,p_actor,p_lease_id,p_descriptor,p_error) $$;
revoke all on function public.alb03_finish_v1(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.alb03_finish_v1(uuid,uuid,uuid,jsonb,text) to service_role;
revoke all on function app_private.alb03_finish_v1(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function app_private.alb03_finish_v1(uuid,uuid,uuid,jsonb,text) to service_role;
revoke all on function app_private.alb03_text_v1(text,boolean) from public,anon,authenticated,service_role;
revoke all on function app_private.alb03_scope_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.alb03_receipt_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function app_private.alb03_can_read_object_v1(text) from public,anon,authenticated,service_role;
grant execute on function app_private.alb03_can_read_object_v1(text) to authenticated;
grant usage on schema app_private to service_role;

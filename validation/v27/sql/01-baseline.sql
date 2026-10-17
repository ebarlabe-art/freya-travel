-- CANDIDATE baseline for a NEW EMPTY validation project only.

-- Source: read-only catalog snapshot 2026-10-16; source production is never a target.

-- Not a replacement for historical migrations. No personal rows or schedules.

BEGIN;

SET LOCAL check_function_bodies = false;

SET LOCAL search_path = public, extensions, pg_catalog;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname IN ('public','app_private','place_private','proposal_private')) THEN RAISE EXCEPTION 'Target is not empty'; END IF; END $$;

CREATE SCHEMA IF NOT EXISTS "app_private";

REVOKE ALL ON SCHEMA "app_private" FROM PUBLIC, anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS "place_private";

REVOKE ALL ON SCHEMA "place_private" FROM PUBLIC, anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS "proposal_private";

REVOKE ALL ON SCHEMA "proposal_private" FROM PUBLIC, anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS "public";
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO PUBLIC;

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS "pg_jsonschema" WITH SCHEMA extensions;

-- Register empty table row types before functions with composite arguments/returns.
CREATE TABLE "app_private"."alb03_ingestions" ();
CREATE TABLE "app_private"."alb03_requests" ();
CREATE TABLE "place_private"."handoff_receipts" ();
CREATE TABLE "place_private"."operations" ();
CREATE TABLE "place_private"."queries" ();
CREATE TABLE "place_private"."quota" ();
CREATE TABLE "place_private"."settings" ();
CREATE TABLE "public"."checklist_items" ();
CREATE TABLE "public"."itinerary_activities" ();
CREATE TABLE "public"."notification_deliveries" ();
CREATE TABLE "public"."place_bindings" ();
CREATE TABLE "public"."place_versions" ();
CREATE TABLE "public"."places" ();
CREATE TABLE "public"."proposal_generations" ();
CREATE TABLE "public"."proposal_operations" ();
CREATE TABLE "public"."push_subscriptions" ();
CREATE TABLE "public"."travel_book_asset_variants" ();
CREATE TABLE "public"."travel_book_assets" ();
CREATE TABLE "public"."travel_book_composition_versions" ();
CREATE TABLE "public"."travel_book_compositions" ();
CREATE TABLE "public"."travel_book_editions" ();
CREATE TABLE "public"."travel_book_operations" ();
CREATE TABLE "public"."travel_book_pages" ();
CREATE TABLE "public"."travel_book_resource_refs" ();
CREATE TABLE "public"."travel_book_revision_compositions" ();
CREATE TABLE "public"."travel_book_revisions" ();
CREATE TABLE "public"."travel_book_source_snapshots" ();
CREATE TABLE "public"."travel_books" ();
CREATE TABLE "public"."travel_documents" ();
CREATE TABLE "public"."travel_expenses" ();
CREATE TABLE "public"."travel_parking" ();
CREATE TABLE "public"."trip_accommodation_documents" ();
CREATE TABLE "public"."trip_accommodations" ();
CREATE TABLE "public"."trip_activities" ();
CREATE TABLE "public"."trip_activity_documents" ();
CREATE TABLE "public"."trip_brief_operations" ();
CREATE TABLE "public"."trip_briefs" ();
CREATE TABLE "public"."trip_budget_setting_operations" ();
CREATE TABLE "public"."trip_budget_settings" ();
CREATE TABLE "public"."trip_car_rental_documents" ();
CREATE TABLE "public"."trip_car_rentals" ();
CREATE TABLE "public"."trip_component_confirmation_operations" ();
CREATE TABLE "public"."trip_component_cost_operations" ();
CREATE TABLE "public"."trip_component_costs" ();
CREATE TABLE "public"."trip_day_metadata" ();
CREATE TABLE "public"."trip_flight_documents" ();
CREATE TABLE "public"."trip_flight_traveler_documents" ();
CREATE TABLE "public"."trip_flight_travelers" ();
CREATE TABLE "public"."trip_flights" ();
CREATE TABLE "public"."trip_handoff_operations" ();
CREATE TABLE "public"."trip_itinerary_items" ();
CREATE TABLE "public"."trip_members" ();
CREATE TABLE "public"."trip_photo_metadata" ();
CREATE TABLE "public"."trip_place_snapshots" ();
CREATE TABLE "public"."trip_proposal_component_links" ();
CREATE TABLE "public"."trip_proposal_handoffs" ();
CREATE TABLE "public"."trip_proposals" ();
CREATE TABLE "public"."trip_reminders" ();
CREATE TABLE "public"."trip_standalone_component_links" ();
CREATE TABLE "public"."trip_stops" ();
CREATE TABLE "public"."trip_travelers" ();
CREATE TABLE "public"."trips" ();

CREATE OR REPLACE FUNCTION app_private.alb03_can_read_object_v1(path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.travel_book_assets a where a.storage_bucket='travel-book' and a.storage_path=path and a.status='ready' and public.is_trip_member(a.trip_id))
 or exists(select 1 from public.travel_book_asset_variants v join public.travel_book_assets a on a.id=v.asset_id where v.storage_path=path and (v.kind='original' or a.status='ready') and public.is_trip_member(a.trip_id))
$function$
;

CREATE OR REPLACE FUNCTION app_private.alb03_claim_v1(p_asset_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare j app_private.alb03_ingestions;a public.travel_book_assets;begin
 select * into j from app_private.alb03_ingestions where asset_id=p_asset_id;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 perform app_private.alb03_scope_v1(j.trip_id,j.book_id,p_actor);
 select * into j from app_private.alb03_ingestions where id=j.id for update;
 if j.lease_until>clock_timestamp() then raise exception 'ALB_INGESTION_BUSY' using errcode='55P03';end if;
 select * into a from public.travel_book_assets where id=j.asset_id for update;
 update app_private.alb03_ingestions set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,updated_at=clock_timestamp() where id=j.id returning * into j;
 return jsonb_build_object('job',to_jsonb(j),'asset',to_jsonb(a),'variants',coalesce((select jsonb_agg(to_jsonb(v) order by kind) from public.travel_book_asset_variants v where v.asset_id=a.id),'[]'));
end $function$
;

CREATE OR REPLACE FUNCTION app_private.alb03_finish_v1(p_asset_id uuid, p_actor uuid, p_lease_id uuid, p_descriptor jsonb, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j app_private.alb03_ingestions;a public.travel_book_assets;x jsonb;k text;root text;token text;original_exists boolean;complete boolean;old_variant public.travel_book_asset_variants;begin
 select * into j from app_private.alb03_ingestions where asset_id=p_asset_id;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 perform app_private.alb03_scope_v1(j.trip_id,j.book_id,p_actor);
 select * into j from app_private.alb03_ingestions where id=j.id for update;
 if p_lease_id is null or j.lease_id is distinct from p_lease_id or j.lease_until<=clock_timestamp() then raise sqlstate 'PT409' using message='ALB_STALE_LEASE';end if;
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
  if token is distinct from j.source_token or not exists(select 1 from public.travel_documents where id=j.source_id and trip_id=j.trip_id and category='Foto' and file_path=j.source_path) then raise sqlstate 'PT409' using message='ALB_SOURCE_CHANGED';end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION app_private.alb03_receipt_v1(t uuid, b uuid, op uuid, req jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare r app_private.alb03_requests;begin
 if op is null then raise exception 'ALB_INVALID_OPERATION' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('alb03-op:'||auth.uid()::text||':'||op::text,0));
 perform app_private.alb03_scope_v1(t,b,auth.uid());
 select * into r from app_private.alb03_requests where actor_id=auth.uid() and operation_id=op;
 if found then
  if r.request<>req or r.trip_id<>t or r.book_id<>b then raise exception 'ALB_OPERATION_REUSED' using errcode='22023';end if;
  return r.result;
 end if;return null;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.alb03_scope_v1(t uuid, b uuid, actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin
 if actor is null then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.trips where id=t and discarded_at is null and experience_key is distinct from 'london-2026' for share;
 if not found then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.trip_members where trip_id=t and user_id=actor for share;
 if not found then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.travel_books where trip_id=t and id=b;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.alb03_text_v1(t text, reviewed boolean)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$ begin
 if t is null then return null;end if;
 if reviewed is distinct from true then raise exception 'ALB_TEXT_REVIEW_REQUIRED' using errcode='22023';end if;
 if length(t)>500 or t ~* '(https?://|www\.|@|bearer[[:space:]]|token|password|booking[_ -]?(ref|code)|reserva[[:space:]:#]|[0-9]{6})' then raise exception 'ALB_SENSITIVE_SOURCE' using errcode='22023';end if;
 return nullif(btrim(t),'');
end $function$
;

CREATE OR REPLACE FUNCTION app_private.capture_travel_book_context_v1(p_trip_id uuid, p_book_id uuid, p_operation_id uuid, p_kind text, p_source_id uuid, p_fields text[], p_text_reviewed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION app_private.change_travel_book_structure_v1(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_expected_structure_version bigint, p_add jsonb, p_remove uuid[], p_order uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare req jsonb; replay jsonb; ed public.travel_book_editions; a jsonb; cid uuid; pid uuid; pages uuid[]; i integer; pos integer:=0; d jsonb;
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'edition_id',p_edition_id,'expected_structure_version',p_expected_structure_version,'add',p_add,'remove',p_remove,'order',p_order);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'structure',req);if replay is not null then return replay;end if;
 if p_expected_structure_version is null or p_expected_structure_version<1 or p_add is null or jsonb_typeof(p_add)<>'array' or jsonb_array_length(p_add)>100
   or p_remove is null or p_order is null or array_position(p_remove,null) is not null or array_position(p_order,null) is not null
   or cardinality(p_order)>1000 or cardinality(p_remove)>1000
   or cardinality(p_remove)<>(select count(distinct x) from unnest(p_remove) x)
   or cardinality(p_order)<>(select count(distinct x) from unnest(p_order) x) then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
 select * into ed from public.travel_book_editions where id=p_edition_id and book_id=p_book_id and trip_id=p_trip_id for update;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 if ed.structure_version<>p_expected_structure_version then raise exception 'ALB_STRUCTURE_CONFLICT' using errcode='PT409',detail=jsonb_build_object('current_version',ed.structure_version)::text;end if;
 if exists(select 1 from unnest(p_remove) x where not exists(select 1 from public.travel_book_compositions c where c.id=x and c.edition_id=p_edition_id and c.removed_at is null)) then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
 update public.travel_book_compositions set removed_at=clock_timestamp(),removed_by=auth.uid(),updated_at=clock_timestamp(),updated_by=auth.uid() where edition_id=p_edition_id and id=any(p_remove);
 update public.travel_book_pages set position=null where edition_id=p_edition_id and composition_id=any(p_remove);
 for a in select value from jsonb_array_elements(p_add) loop
   if jsonb_typeof(a)<>'object' or a-'id'-'page_ids'<>'{}'::jsonb or not (a ?& array['id','page_ids']) or jsonb_typeof(a->'page_ids')<>'array' or jsonb_array_length(a->'page_ids') not between 1 and 2 then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
   cid:=(a->>'id')::uuid;
   select array_agg(value::uuid order by ordinality) into pages from jsonb_array_elements_text(a->'page_ids') with ordinality;
   if cid is null or array_position(pages,null) is not null or cardinality(pages)<>(select count(distinct x) from unnest(pages) x) then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
   insert into public.travel_book_compositions(id,trip_id,book_id,edition_id,kind,created_by,updated_by)
   values(cid,p_trip_id,p_book_id,p_edition_id,case cardinality(pages) when 1 then 'page' else 'spread' end,auth.uid(),auth.uid());
   i:=0;foreach pid in array pages loop
     insert into public.travel_book_pages(id,trip_id,book_id,edition_id,composition_id,slot,position,created_by) values(pid,p_trip_id,p_book_id,p_edition_id,cid,i,null,auth.uid());i:=i+1;
   end loop;
   d:=jsonb_build_object('schema_version',1,'composition_id',cid,'kind',case cardinality(pages) when 1 then 'page' else 'spread' end,'page_ids',to_jsonb(pages),'canvas',jsonb_build_object('unit','mm','width',null,'height',null),'elements','[]'::jsonb,'locks',jsonb_build_object('layout',false),'metadata',jsonb_build_object('label',null));
   insert into public.travel_book_composition_versions(composition_id,version,trip_id,book_id,edition_id,document,created_by) values(cid,1,p_trip_id,p_book_id,p_edition_id,d,auth.uid());
 end loop;
 if cardinality(p_order)<>(select count(*) from public.travel_book_compositions where edition_id=p_edition_id and removed_at is null)
 or exists(select 1 from unnest(p_order) x where not exists(select 1 from public.travel_book_compositions where id=x and edition_id=p_edition_id and removed_at is null)) then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
 foreach cid in array p_order loop
   for pid in select id from public.travel_book_pages where composition_id=cid order by slot loop
     update public.travel_book_pages set position=pos where id=pid;pos:=pos+1;
   end loop;
 end loop;
 update public.travel_book_editions set structure_version=structure_version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_edition_id returning * into ed;
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'structure',req,jsonb_build_object('edition_id',p_edition_id,'structure_version',ed.structure_version,'composition_order',p_order));
end $function$
;

CREATE OR REPLACE FUNCTION app_private.create_travel_book_edition_v1(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_title text, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare req jsonb; replay jsonb;
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'edition_id',p_edition_id,'title',p_title);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'create_edition',req);if replay is not null then return replay;end if;
 if p_edition_id is null or p_title is null or length(btrim(p_title)) not between 1 and 160 then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 insert into public.travel_book_editions(id,trip_id,book_id,title,created_by,updated_by) values(p_edition_id,p_trip_id,p_book_id,btrim(p_title),auth.uid(),auth.uid());
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'create_edition',req,jsonb_build_object('edition_id',p_edition_id,'structure_version',1));
end $function$
;

CREATE OR REPLACE FUNCTION app_private.create_travel_book_revision_v1(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_revision_id uuid, p_expected_structure_version bigint, p_expected_compositions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare req jsonb; replay jsonb; ed public.travel_book_editions; actual jsonb; manifest jsonb; assets jsonb; snapshots jsonb; r public.travel_book_revisions; item jsonb;
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'edition_id',p_edition_id,'revision_id',p_revision_id,'expected_structure_version',p_expected_structure_version,'expected_compositions',p_expected_compositions);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'revision',req);if replay is not null then return replay;end if;
 if p_revision_id is null or p_expected_structure_version is null or p_expected_structure_version<1 or p_expected_compositions is null or jsonb_typeof(p_expected_compositions)<>'array' or jsonb_array_length(p_expected_compositions)>1000 then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_expected_compositions) loop
   if jsonb_typeof(item)<>'object' or item-'id'-'version'<>'{}'::jsonb or not (item ?& array['id','version']) or jsonb_typeof(item->'version')<>'number' or (item->>'version')!~'^[1-9][0-9]*$' or (item->>'version')::numeric>9007199254740991 then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
   perform (item->>'id')::uuid;
 end loop;
 select * into ed from public.travel_book_editions where id=p_edition_id and book_id=p_book_id and trip_id=p_trip_id for update;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',current_version) order by id),'[]') into actual from public.travel_book_compositions where edition_id=ed.id and removed_at is null;
 if ed.structure_version<>p_expected_structure_version or actual<>(select coalesce(jsonb_agg(value order by value->>'id'),'[]') from jsonb_array_elements(p_expected_compositions)) then raise exception 'ALB_REVISION_CONFLICT' using errcode='PT409',detail=jsonb_build_object('structure_version',ed.structure_version,'compositions',actual)::text;end if;
 -- Future resource finalizers must acquire these same asset row locks before changing availability.
 perform 1 from public.travel_book_assets a where exists(select 1 from public.travel_book_resource_refs ref join public.travel_book_compositions c on c.id=ref.composition_id and c.current_version=ref.composition_version where c.edition_id=ed.id and c.removed_at is null and ref.asset_id=a.id) order by a.id for share;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'asset_key',a.asset_key,'version',a.version,'status',a.status,'content_hash',a.content_hash,'mime_type',a.mime_type,'width_px',a.width_px,'height_px',a.height_px,'storage_bucket',a.storage_bucket,'storage_path',a.storage_path) order by a.id),'[]') into assets
 from public.travel_book_assets a where exists(select 1 from public.travel_book_resource_refs ref join public.travel_book_compositions c on c.id=ref.composition_id and c.current_version=ref.composition_version where c.edition_id=ed.id and c.removed_at is null and ref.asset_id=a.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'schema_version',s.schema_version,'payload_hash',s.payload_hash,'classification',s.classification) order by s.id),'[]') into snapshots
 from public.travel_book_source_snapshots s where exists(select 1 from public.travel_book_resource_refs ref join public.travel_book_compositions c on c.id=ref.composition_id and c.current_version=ref.composition_version where c.edition_id=ed.id and c.removed_at is null and ref.source_snapshot_id=s.id);
 manifest:=jsonb_build_object('schema_version',1,'hash_version',1,'trip_id',p_trip_id,'book_id',p_book_id,'edition_id',ed.id,'structure_version',ed.structure_version,
 'book_title',(select title from public.travel_books where id=p_book_id),'edition_title',ed.title,
 'pages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'composition_id',composition_id,'slot',slot,'position',position) order by position),'[]') from public.travel_book_pages where edition_id=ed.id and position is not null),
 'compositions',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'version',v.version,'document_hash',v.document_hash) order by c.id),'[]') from public.travel_book_compositions c join public.travel_book_composition_versions v on v.composition_id=c.id and v.version=c.current_version where c.edition_id=ed.id and c.removed_at is null),
 'assets',assets,'snapshots',snapshots);
 insert into public.travel_book_revisions(id,trip_id,book_id,edition_id,revision_number,structure_version,manifest,resource_state_at_capture,created_by)
 values(p_revision_id,p_trip_id,p_book_id,ed.id,ed.next_revision_number,ed.structure_version,manifest,case when exists(select 1 from jsonb_array_elements(assets) a where a->>'status'<>'ready') then 'incomplete' else 'complete' end,auth.uid()) returning * into r;
 insert into public.travel_book_revision_compositions(revision_id,composition_id,composition_version,trip_id,book_id,edition_id)
 select r.id,c.id,c.current_version,p_trip_id,p_book_id,ed.id from public.travel_book_compositions c where c.edition_id=ed.id and c.removed_at is null;
 update public.travel_book_editions set next_revision_number=next_revision_number+1 where id=ed.id;
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,ed.id,p_operation_id,'revision',req,jsonb_build_object('revision_id',r.id,'revision_number',r.revision_number,'manifest_hash',r.manifest_hash,'resource_state_at_capture',r.resource_state_at_capture));
end $function$
;

CREATE OR REPLACE FUNCTION app_private.create_travel_book_v1(p_trip_id uuid, p_book_id uuid, p_title text, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare req jsonb; replay jsonb; result jsonb;
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'title',p_title);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,null,p_operation_id,'create_book',req);if replay is not null then return replay;end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 160 then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 insert into public.travel_books(id,trip_id,title,created_by) values(p_book_id,p_trip_id,btrim(p_title),auth.uid());
 result:=jsonb_build_object('book_id',p_book_id,'trip_id',p_trip_id);
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,null,p_operation_id,'create_book',req,result);
end $function$
;

CREATE OR REPLACE FUNCTION app_private.discard_construction_trip_v1(p_trip_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  authenticated_user_id uuid:=auth.uid();
  affected integer;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió' using errcode='42501';
  end if;

  update public.trips t
  set discarded_at=clock_timestamp(),discarded_by=authenticated_user_id
  where t.id=p_trip_id
    and t.owner_id=authenticated_user_id
    and t.discarded_at is null
    and t.start_date is null
    and t.end_date is null
    and t.experience_key is distinct from 'london-2026'
    and exists(select 1 from public.trip_proposal_handoffs h where h.trip_id=t.id);

  get diagnostics affected=row_count;
  if affected<>1 then
    raise exception 'Aquest viatge no es pot eliminar des d’En construcció' using errcode='42501';
  end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.get_travel_book_ingestion_v1(p_trip_id uuid, p_book_id uuid, p_asset_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare r jsonb;begin
 perform app_private.alb03_scope_v1(p_trip_id,p_book_id,auth.uid());
 select jsonb_build_object('asset',to_jsonb(a),'original_preserved',exists(select 1 from public.travel_book_asset_variants ov where ov.asset_id=a.id and ov.kind='original'),
 'processing_state',case when a.status='ready' then 'ready' when a.status='missing' then 'missing' when exists(select 1 from public.travel_book_asset_variants ov where ov.asset_id=a.id and ov.kind='original') then 'derivative_pending' when j.error_code is not null then 'recoverable_error' else 'pending' end,
 'snapshot_id',j.snapshot_id,'attempts',j.attempts,'error_code',j.error_code,'processing',coalesce(j.lease_until>clock_timestamp(),false),'variants',coalesce((select jsonb_agg(to_jsonb(v) order by kind) from public.travel_book_asset_variants v where v.asset_id=a.id),'[]')) into r
 from public.travel_book_assets a join app_private.alb03_ingestions j on j.asset_id=a.id where a.trip_id=p_trip_id and a.book_id=p_book_id and a.id=p_asset_id;
 if r is null then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;return r;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.get_travel_book_operation_v1(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.travel_book_operations;
begin
 if auth.uid() is null then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 select * into r from public.travel_book_operations where actor_id=auth.uid() and operation_id=p_operation_id;
 if not found then return null;end if;
 perform app_private.travel_book_access_v1(r.trip_id);
 return r.result||jsonb_build_object('replayed',true);
end $function$
;

CREATE OR REPLACE FUNCTION app_private.request_travel_book_photo_v1(p_trip_id uuid, p_book_id uuid, p_document_id uuid, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare req jsonb;r jsonb;d public.travel_documents;j app_private.alb03_ingestions;token text;key uuid;v integer;a uuid;s uuid;day date;begin
 req:=jsonb_build_object('document_id',p_document_id);
 r:=app_private.alb03_receipt_v1(p_trip_id,p_book_id,p_operation_id,req);if r is not null then return r;end if;
 perform pg_advisory_xact_lock(hashtextextended('alb03-source:'||p_book_id::text||':'||p_document_id::text,0));
 select * into d from public.travel_documents where id=p_document_id and trip_id=p_trip_id and category='Foto' for share;
 if not found then raise exception 'ALB_SOURCE_MISSING' using errcode='P0002';end if;
 if d.file_path not like p_trip_id::text||'/%'
    or d.file_path ~ '(:|\?)'
    or d.file_path ~ '(^|/)\.\.(/|$)'
    or d.mime_type not in ('image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif')
    or d.mime_type is null
 then raise exception 'ALB_SOURCE_UNSUPPORTED' using errcode='22023';end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION app_private.save_travel_book_compositions_v1(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare req jsonb; replay jsonb; item jsonb; d jsonb; c public.travel_book_compositions; old public.travel_book_composition_versions; expected bigint; pages jsonb; results jsonb:='[]';
begin
 req:=jsonb_build_object('trip_id',p_trip_id,'book_id',p_book_id,'edition_id',p_edition_id,'changes',p_changes);
 replay:=app_private.travel_book_begin_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'save',req);if replay is not null then return replay;end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 100 then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_changes) loop
   if jsonb_typeof(item)<>'object' or item-'expected_version'-'document'<>'{}'::jsonb or not (item ?& array['expected_version','document']) or jsonb_typeof(item->'expected_version')<>'number'
     or (item->>'expected_version')!~'^[1-9][0-9]*$' or (item->>'expected_version')::numeric>9007199254740991
     or not app_private.travel_book_composition_valid_v1(item->'document') then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_changes) x group by x#>>'{document,composition_id}' having count(*)>1) then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 perform 1 from public.travel_book_editions where id=p_edition_id and book_id=p_book_id and trip_id=p_trip_id for share;
 if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 for item in select value from jsonb_array_elements(p_changes) order by value#>>'{document,composition_id}' loop
   d:=item->'document';expected:=(item->>'expected_version')::bigint;
   select * into c from public.travel_book_compositions where id=(d->>'composition_id')::uuid and trip_id=p_trip_id and book_id=p_book_id and edition_id=p_edition_id and removed_at is null for update;
   if not found then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
   if c.current_version<>expected then raise exception 'ALB_COMPOSITION_CONFLICT' using errcode='PT409',detail=jsonb_build_object('composition_id',c.id,'current_version',c.current_version)::text;end if;
   select jsonb_agg(id order by slot) into pages from public.travel_book_pages where composition_id=c.id;
   if d->>'kind'<>c.kind or d->'page_ids'<>pages then raise exception 'ALB_INVALID_STRUCTURE' using errcode='22023';end if;
   if exists(select 1 from app_private.travel_book_refs_v1(d) r where (r.resource_kind='asset' and not exists(select 1 from public.travel_book_assets a where a.id=r.asset_id and a.trip_id=p_trip_id and a.book_id=p_book_id and a.kind='image')) or (r.resource_kind='source_snapshot' and not exists(select 1 from public.travel_book_source_snapshots s where s.id=r.source_snapshot_id and s.trip_id=p_trip_id and s.book_id=p_book_id))) then raise exception 'ALB_RESOURCE_SCOPE_MISMATCH' using errcode='23503';end if;
   select * into old from public.travel_book_composition_versions where composition_id=c.id and version=c.current_version;
   if old.document is distinct from d then
     insert into public.travel_book_composition_versions(composition_id,version,trip_id,book_id,edition_id,document,created_by)
     values(c.id,c.current_version+1,p_trip_id,p_book_id,p_edition_id,d,auth.uid()) returning * into old;
     insert into public.travel_book_resource_refs(composition_id,composition_version,trip_id,book_id,edition_id,ref_key,element_id,resource_kind,asset_id,source_snapshot_id,usage)
     select c.id,old.version,p_trip_id,p_book_id,p_edition_id,r.* from app_private.travel_book_refs_v1(d) r;
     update public.travel_book_compositions set current_version=old.version,updated_at=clock_timestamp(),updated_by=auth.uid() where id=c.id;
   end if;
   results:=results||jsonb_build_array(jsonb_build_object('composition_id',c.id,'version',old.version,'document_hash',old.document_hash));
 end loop;
 return app_private.travel_book_finish_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,'save',req,jsonb_build_object('compositions',results));
end $function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_access_v1(p_trip uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.trips where id=p_trip and discarded_at is null and experience_key is distinct from 'london-2026' for share;
 if not found then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 perform 1 from public.trip_members where trip_id=p_trip and user_id=auth.uid() for share;
 if not found or not public.is_trip_member(p_trip) then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_begin_v1(p_trip uuid, p_book uuid, p_edition uuid, p_operation uuid, p_type text, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.travel_book_operations;
begin
 if auth.uid() is null then raise exception 'ALB_ACCESS_DENIED' using errcode='42501';end if;
 if p_trip is null or p_book is null or p_operation is null or p_request is null or octet_length(p_request::text)>1048576 then raise exception 'ALB_INVALID_DOCUMENT' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('alb02-operation:'||auth.uid()::text||':'||p_operation::text,0));
 perform app_private.travel_book_access_v1(p_trip);
 select * into r from public.travel_book_operations where actor_id=auth.uid() and operation_id=p_operation;
 if found then
   if r.request is distinct from p_request or r.operation_type<>p_type or r.trip_id<>p_trip or r.book_id<>p_book or r.edition_id is distinct from p_edition then
     raise exception 'ALB_OPERATION_REUSED' using errcode='22023';end if;
   return r.result||jsonb_build_object('replayed',true);
 end if;
 if p_type<>'create_book' and not exists(select 1 from public.travel_books where trip_id=p_trip and id=p_book) then raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';end if;
 return null;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_composition_schema_v1()
 RETURNS json
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select $json${"type":"object","properties":{"schema_version":{"const":1},"composition_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"kind":{"enum":["page","spread"]},"page_ids":{"type":"array","items":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"minItems":1,"maxItems":2,"uniqueItems":true},"canvas":{"type":"object","properties":{"unit":{"const":"mm"},"width":{"anyOf":[{"type":"number","exclusiveMinimum":0,"maximum":1000000},{"type":"null"}]},"height":{"anyOf":[{"type":"number","exclusiveMinimum":0,"maximum":1000000},{"type":"null"}]}},"required":["unit","width","height"],"additionalProperties":false},"elements":{"type":"array","maxItems":200,"items":{"oneOf":[{"type":"object","properties":{"id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"geometry":{"type":"object","properties":{"x":{"type":"number","minimum":-1000000,"maximum":1000000},"y":{"type":"number","minimum":-1000000,"maximum":1000000},"width":{"type":"number","exclusiveMinimum":0,"maximum":1000000},"height":{"type":"number","exclusiveMinimum":0,"maximum":1000000},"rotation":{"type":"number","minimum":-360,"maximum":360}},"required":["x","y","width","height","rotation"],"additionalProperties":false},"locks":{"type":"object","properties":{"content":{"type":"boolean"},"geometry":{"type":"boolean"}},"required":["content","geometry"],"additionalProperties":false},"type":{"const":"text"},"role":{"enum":["title","body","caption"]},"text":{"type":"string","maxLength":16000},"source_snapshot_ids":{"type":"array","items":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"maxItems":20,"uniqueItems":true}},"required":["id","geometry","locks","type","role","text","source_snapshot_ids"],"additionalProperties":false},{"type":"object","properties":{"id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"geometry":{"type":"object","properties":{"x":{"type":"number","minimum":-1000000,"maximum":1000000},"y":{"type":"number","minimum":-1000000,"maximum":1000000},"width":{"type":"number","exclusiveMinimum":0,"maximum":1000000},"height":{"type":"number","exclusiveMinimum":0,"maximum":1000000},"rotation":{"type":"number","minimum":-360,"maximum":360}},"required":["x","y","width","height","rotation"],"additionalProperties":false},"locks":{"type":"object","properties":{"content":{"type":"boolean"},"geometry":{"type":"boolean"}},"required":["content","geometry"],"additionalProperties":false},"type":{"const":"image"},"asset_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"crop":{"type":"object","properties":{"x":{"type":"number","minimum":0,"maximum":1},"y":{"type":"number","minimum":0,"maximum":1},"width":{"type":"number","exclusiveMinimum":0,"maximum":1},"height":{"type":"number","exclusiveMinimum":0,"maximum":1}},"required":["x","y","width","height"],"additionalProperties":false}},"required":["id","geometry","locks","type","asset_id","crop"],"additionalProperties":false}]}},"locks":{"type":"object","properties":{"layout":{"type":"boolean"}},"required":["layout"],"additionalProperties":false},"metadata":{"type":"object","properties":{"label":{"anyOf":[{"type":"string","maxLength":160},{"type":"null"}]}},"required":["label"],"additionalProperties":false}},"required":["schema_version","composition_id","kind","page_ids","canvas","elements","locks","metadata"],"additionalProperties":false}$json$::json $function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_composition_valid_v1(d jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 if d is null or octet_length(d::text)>262144 or not extensions.jsonb_matches_schema(app_private.travel_book_composition_schema_v1(),d) then return false; end if;
 if jsonb_array_length(d->'page_ids')<>(case d->>'kind' when 'page' then 1 else 2 end) then return false; end if;
 if (d#>'{canvas,width}'='null'::jsonb)<>(d#>'{canvas,height}'='null'::jsonb) then return false; end if;
 if d#>'{canvas,width}'='null'::jsonb and jsonb_array_length(d->'elements')>0 then return false; end if;
 if exists(select 1 from jsonb_array_elements(d->'elements') e group by e->>'id' having count(*)>1) then return false; end if;
 if exists(select 1 from jsonb_array_elements(d->'elements') e where e->>'type'='image' and
   ((e#>>'{crop,x}')::numeric+(e#>>'{crop,width}')::numeric>1 or (e#>>'{crop,y}')::numeric+(e#>>'{crop,height}')::numeric>1)) then return false; end if;
 return true;
exception when others then return false;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_finish_v1(p_trip uuid, p_book uuid, p_edition uuid, p_operation uuid, p_type text, p_request jsonb, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 insert into public.travel_book_operations(actor_id,operation_id,trip_id,book_id,edition_id,operation_type,request,result)
 values(auth.uid(),p_operation,p_trip,p_book,p_edition,p_type,p_request,p_result);
 return p_result||jsonb_build_object('replayed',false);
end $function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_hash_v1(d jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$ select encode(sha256(convert_to(d::text,'UTF8')),'hex') $function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_protect_master_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if (new.id,new.trip_id,new.book_id,new.asset_key,new.version,new.source_document_id_at_capture,new.created_at,new.created_by)
   is distinct from (old.id,old.trip_id,old.book_id,old.asset_key,old.version,old.source_document_id_at_capture,old.created_at,old.created_by)
   or (new.source_document_id is distinct from old.source_document_id and new.source_document_id is not null) then
   raise exception 'ALB_IMMUTABLE' using errcode='55000';end if;
 if old.content_hash is not null and old.status in ('ready','missing') and
   (new.content_hash,new.mime_type,new.width_px,new.height_px,new.storage_bucket,new.storage_path,new.verified_at)
   is distinct from (old.content_hash,old.mime_type,old.width_px,old.height_px,old.storage_bucket,old.storage_path,old.verified_at) then
   raise exception 'ALB_IMMUTABLE' using errcode='55000';end if;
 if old.status in ('ready','missing') and new.status='pending' then raise exception 'ALB_IMMUTABLE' using errcode='55000';end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_refs_v1(d jsonb)
 RETURNS TABLE(ref_key text, element_id uuid, resource_kind text, asset_id uuid, source_snapshot_id uuid, usage text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select (e->>'id')||':image',(e->>'id')::uuid,'asset',(e->>'asset_id')::uuid,null::uuid,'image'
 from jsonb_array_elements(d->'elements') e where e->>'type'='image'
 union all
 select (e->>'id')||':source:'||s.value,(e->>'id')::uuid,'source_snapshot',null::uuid,s.value::uuid,'text_source'
 from jsonb_array_elements(d->'elements') e cross join lateral jsonb_array_elements_text(coalesce(e->'source_snapshot_ids','[]')) s where e->>'type'='text'
$function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_reject_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin raise exception 'ALB_IMMUTABLE' using errcode='55000';end $function$
;

CREATE OR REPLACE FUNCTION app_private.travel_book_snapshot_valid_v1(d jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text; v jsonb;
begin
 if d is null or jsonb_typeof(d)<>'object' or octet_length(d::text)>32768 or d-'label'-'local_date'-'place_label'<>'{}'::jsonb then return false;end if;
 for k,v in select * from jsonb_each(d) loop
   if jsonb_typeof(v)<>'string' or length(v#>>'{}')>500 then return false;end if;
   if k='local_date' then
     if (v#>>'{}')!~'^\d{4}-\d{2}-\d{2}$' then return false;end if;
     perform (v#>>'{}')::date;
   end if;
 end loop;
 return true;
exception when others then return false;
end $function$
;

CREATE OR REPLACE FUNCTION place_private.capture_binding_subject()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin
 if new.proposal_id is null then select document#>array['decisions',split_part(new.subject_key,':',1)] into new.subject_snapshot from public.trip_briefs where id=new.brief_id;end if;return new;
end $function$
;

CREATE OR REPLACE FUNCTION place_private.generation_places()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if tg_op='UPDATE' then if new.place_snapshot is distinct from old.place_snapshot then raise exception 'Immutable geographic snapshot';end if;return new;end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into new.place_snapshot from (select distinct on (b.subject_key) b.id binding_id,b.subject_key,b.place_version_id,to_jsonb(v) place from public.place_bindings b join public.place_versions v on v.id=b.place_version_id where b.brief_id=new.brief_id and b.proposal_id is null and b.owner_id=new.owner_id and b.brief_revision<=new.brief_revision and b.subject_snapshot=new.brief_snapshot#>array['decisions',split_part(b.subject_key,':',1)] order by b.subject_key,b.revision desc)x;return new;
end $function$
;

CREATE OR REPLACE FUNCTION place_private.subject(p_owner uuid, p_subject jsonb)
 RETURNS trip_briefs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.trip_briefs;p public.trip_proposals;k text:=p_subject->>'key';d jsonb;begin
 select * into b from public.trip_briefs where id=(p_subject->>'brief_id')::uuid and owner_id=p_owner;
 if b.id is null then raise exception 'Unavailable' using errcode='42501';end if;
 if p_subject->>'proposal_id' is not null then
 select x.* into p from public.trip_proposals x join public.proposal_generations g on g.id=x.generation_id where x.id=(p_subject->>'proposal_id')::uuid and g.brief_id=b.id and g.owner_id=p_owner;
 if p.id is null or not exists(select 1 from jsonb_array_elements((p.document#>'{candidate,route,stops}')||(p.document#>'{candidate,components}')) x where x->>'id'=k) then raise exception 'Invalid subject' using errcode='22023';end if;
 else
 d=b.document#>array['decisions',split_part(k,':',1)];
 if d is null or d->>'field' not in ('origin','destination') or d->>'knowledge'<>'known' or split_part(k,':',2)!~'^[0-9]+$' or d#>array['value','places',split_part(k,':',2)] is null then raise exception 'Invalid subject' using errcode='22023';end if;
 end if;return b;
end $function$
;

CREATE OR REPLACE FUNCTION proposal_private.cleanup_standalone_component_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cid text;
begin
  select component_id into cid
  from public.trip_standalone_component_links
  where trip_id=old.trip_id and source_kind=tg_argv[0] and source_id=old.id;

  if cid is not null then
    delete from public.trip_standalone_component_links
    where trip_id=old.trip_id and component_id=cid;
  end if;
  return old;
end $function$
;

CREATE OR REPLACE FUNCTION proposal_private.document_valid(d jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select octet_length(d::text)<=65536 and extensions.jsonb_matches_schema($schema${"type":"object","properties":{"schema_version":{"type":"integer","enum":[1]},"candidate":{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":120},"summary":{"type":"string","minLength":1,"maxLength":600},"route":{"type":"object","properties":{"stops":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"destination":{"type":"string","minLength":1,"maxLength":120},"nights":{"anyOf":[{"type":"integer","minimum":1,"maximum":730},{"type":"null"}]},"start_date":{"anyOf":[{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$"},{"type":"null"}]},"end_date":{"anyOf":[{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$"},{"type":"null"}]}},"required":["id","destination","nights","start_date","end_date"],"additionalProperties":false},"minItems":1,"maxItems":20},"legs":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"from_stop_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"to_stop_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"mode":{"anyOf":[{"type":"string","minLength":1,"maxLength":80},{"type":"null"}]},"transit_nights":{"anyOf":[{"type":"integer","minimum":0,"maximum":730},{"type":"null"}]}},"required":["id","from_stop_id","to_stop_id","mode","transit_nights"],"additionalProperties":false},"minItems":0,"maxItems":19}},"required":["stops","legs"],"additionalProperties":false},"components":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"kind":{"type":"string","enum":["transport","accommodation","experience"]},"subject_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"description":{"type":"string","minLength":1,"maxLength":600},"claim_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100}},"required":["id","kind","subject_id","description","claim_ids"],"additionalProperties":false},"minItems":0,"maxItems":40},"experience_blocks":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"title":{"type":"string","minLength":1,"maxLength":120},"suggestion":{"type":"string","minLength":1,"maxLength":600},"decision_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100},"component_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100},"claim_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100}},"required":["id","title","suggestion","decision_ids","component_ids","claim_ids"],"additionalProperties":false},"minItems":3,"maxItems":5},"reasons":{"type":"array","items":{"type":"object","properties":{"decision_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"explanation":{"type":"string","minLength":1,"maxLength":600},"claim_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100}},"required":["decision_id","explanation","claim_ids"],"additionalProperties":false},"minItems":0,"maxItems":200},"tradeoffs":{"type":"array","items":{"type":"object","properties":{"description":{"type":"string","minLength":1,"maxLength":600},"decision_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100}},"required":["description","decision_ids"],"additionalProperties":false},"minItems":0,"maxItems":30},"claims":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"subject_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"statement":{"type":"string","minLength":1,"maxLength":600},"decision_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100},"verification_needed":{"type":"string","minLength":1,"maxLength":600}},"required":["id","subject_id","statement","decision_ids","verification_needed"],"additionalProperties":false},"minItems":0,"maxItems":100},"scope_bindings":{"type":"array","items":{"type":"object","properties":{"scope_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"subject_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":1,"maxItems":60}},"required":["scope_id","subject_ids"],"additionalProperties":false},"minItems":0,"maxItems":50}},"required":["title","summary","route","components","experience_blocks","reasons","tradeoffs","claims","scope_bindings"],"additionalProperties":false},"evaluations":{"type":"array","items":{"type":"object","properties":{"decision_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"field":{"type":"string","minLength":1,"maxLength":100},"scope":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"strength":{"anyOf":[{"type":"string","enum":["hard","preference","flexible"]},{"type":"null"}]},"knowledge":{"type":"string","enum":["known","unknown","indifferent"]},"state":{"type":"string","enum":["satisfied","unresolved","violated"]},"reason":{"type":"string","minLength":1,"maxLength":100}},"required":["decision_id","field","scope","strength","knowledge","state","reason"],"additionalProperties":false},"minItems":0,"maxItems":200},"verification":{"type":"array","items":{"type":"object","properties":{"claim_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"certainty":{"type":"string","enum":["confirmed","provider_available","probable","pending_verification"]},"reason":{"type":"string","minLength":1,"maxLength":100},"evidence":{"type":"array","items":{"type":"object","properties":{"source":{"type":"string","minLength":1,"maxLength":200},"locator":{"type":"string","minLength":1,"maxLength":2000},"observed_at":{"type":"string","minLength":1,"maxLength":40},"valid_until":{"type":"string","minLength":1,"maxLength":40}},"required":["source","locator","observed_at","valid_until"],"additionalProperties":false},"minItems":0,"maxItems":10}},"required":["claim_id","certainty","reason","evidence"],"additionalProperties":false},"minItems":0,"maxItems":100}},"required":["schema_version","candidate","evaluations","verification"],"additionalProperties":false}$schema$::json,d) and not exists(select 1 from jsonb_array_elements(d->'verification') v where v->>'certainty'='provider_available') and not exists(select 1 from jsonb_array_elements(d->'evaluations') e where e->>'strength'='hard' and e->>'state'='violated');
$function$
;

CREATE OR REPLACE FUNCTION proposal_private.freeze_handed_off_brief()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin
 if old.trip_id is not null then raise exception 'Brief already formalized' using errcode='55000';end if;return new;
end $function$
;

CREATE OR REPLACE FUNCTION proposal_private.handoff_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin raise exception 'Handoff origin is immutable' using errcode='22023';end $function$
;

CREATE OR REPLACE FUNCTION proposal_private.handoff_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare h public.trip_proposal_handoffs;b public.trip_briefs;p public.trip_proposals;g public.proposal_generations;n integer;
begin
 if tg_table_name='trip_briefs' then
  select * into b from public.trip_briefs where id=new.id;
  if b.trip_id is null then return null;end if;
  select * into h from public.trip_proposal_handoffs where brief_id=b.id;
 elsif tg_table_name='trip_proposal_handoffs' then select * into h from public.trip_proposal_handoffs where id=new.id;
 else select * into h from public.trip_proposal_handoffs where id=new.handoff_id;end if;
 if h.id is null then raise exception 'Missing handoff' using errcode='23514';end if;
 select * into b from public.trip_briefs where id=h.brief_id;
 select * into p from public.trip_proposals where id=h.proposal_id;
 select * into g from public.proposal_generations where id=p.generation_id;
 if b.trip_id is distinct from h.trip_id or b.owner_id<>h.owner_id or b.revision<>h.brief_revision+1 or g.owner_id<>h.owner_id or g.brief_id<>h.brief_id or g.brief_revision<>h.brief_revision or g.snapshot_hash<>h.snapshot_hash
 or not exists(select 1 from public.trips t where t.id=h.trip_id and t.owner_id=h.owner_id)
 or not exists(select 1 from public.trip_members m where m.trip_id=h.trip_id and m.user_id=h.owner_id) then raise exception 'Inconsistent handoff' using errcode='23514';end if;
 select count(*) into n from public.trip_proposal_component_links where handoff_id=h.id;
 if n<>jsonb_array_length(p.document#>'{candidate,components}') or exists(
 select 1 from public.trip_proposal_component_links l where l.handoff_id=h.id and not exists(
 select 1 from jsonb_array_elements(p.document#>'{candidate,components}') c where c->>'id'=l.component_id and (
 (c->>'kind'='accommodation' and l.accommodation_id is not null) or (c->>'kind'='experience' and l.activity_id is not null) or (c->>'kind'='transport' and (l.flight_id is not null or l.activity_id is not null))))) then raise exception 'Incomplete component mappings' using errcode='23514';end if;
 return null;
end $function$
;

CREATE OR REPLACE FUNCTION proposal_private.immutable_proposal()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin raise exception 'Immutable proposal' using errcode='22023';end $function$
;

CREATE OR REPLACE FUNCTION proposal_private.immutable_round()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin
 if row(new.round_number,new.previous_generation_id,new.refinement,new.excluded_routes,new.material_key) is distinct from row(old.round_number,old.previous_generation_id,old.refinement,old.excluded_routes,old.material_key) then raise exception 'Immutable round context' using errcode='22023';end if;return new;
end $function$
;

CREATE OR REPLACE FUNCTION proposal_private.immutable_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin
 if row(new.id,new.owner_id,new.brief_id,new.brief_revision,new.brief_schema_version,new.brief_snapshot,new.snapshot_hash,new.engine_version,new.generator_version,new.verifier_version,new.policy_version,new.created_at) is distinct from row(old.id,old.owner_id,old.brief_id,old.brief_revision,old.brief_schema_version,old.brief_snapshot,old.snapshot_hash,old.engine_version,old.generator_version,old.verifier_version,old.policy_version,old.created_at) then raise exception 'Immutable generation input' using errcode='22023';end if;return new;end $function$
;

CREATE OR REPLACE FUNCTION proposal_private.initialize_round()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare previous public.proposal_generations;begin
 perform 1 from public.trip_briefs where id=new.brief_id and owner_id=new.owner_id for update;
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 select count(*)+1 into new.round_number from public.proposal_generations where brief_id=new.brief_id;
 new.material_key=proposal_private.material_key(new.brief_snapshot);
 if new.previous_generation_id is not null then
  select * into previous from public.proposal_generations where id=new.previous_generation_id and brief_id=new.brief_id and owner_id=new.owner_id;
  if not found then raise exception 'Invalid previous generation' using errcode='42501';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('fingerprint',p.fingerprint,'route',p.document#>'{candidate,route}') order by g.created_at,p.position),'[]') into new.excluded_routes
 from public.trip_proposals p join public.proposal_generations g on g.id=p.generation_id where g.brief_id=new.brief_id and coalesce(g.material_key,proposal_private.material_key(g.brief_snapshot))=new.material_key;
 if octet_length(new.excluded_routes::text)>524288 then raise exception 'Exploration context limit' using errcode='54000';end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION proposal_private.material_key(d jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select encode(sha256(convert_to(jsonb_build_object(
 'decisions',coalesce((select jsonb_agg(v order by v::text) from (select value-'origin'-'label' as v from jsonb_each(d->'decisions') where (value->>'field'<>'notes' and value->>'field' not like 'custom.%') or value->>'strength'='hard') q),'[]'),
 'travelers',coalesce((select jsonb_agg(value order by value::text) from jsonb_each(d->'travelers')),'[]'),
 'scopes',coalesce((select jsonb_object_agg(key,value-'label') from jsonb_each(d->'scopes')),'{}'))::text,'UTF8')),'hex');
$function$
;

CREATE OR REPLACE FUNCTION proposal_private.refinement_valid(r jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(extensions.jsonb_matches_schema('{"type":"object","required":["chips","text"],"additionalProperties":false,"properties":{"chips":{"type":"array","uniqueItems":true,"maxItems":6,"items":{"type":"string","enum":["cheaper","more_snow","more_christmas","fewer_transfers","calmer","different_destinations"]}},"text":{"type":"string","maxLength":1000}}}'::json,r),false);
$function$
;

CREATE OR REPLACE FUNCTION proposal_private.round_number(g proposal_generations)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(g.round_number,(select count(*) from public.proposal_generations a where a.brief_id=g.brief_id and (a.created_at,a.id)<=(g.created_at,g.id)));
$function$
;

CREATE OR REPLACE FUNCTION proposal_private.route_key(r jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select jsonb_agg(lower(regexp_replace(btrim(normalize(value->>'destination',NFKC)),'\s+',' ','g')) order by ord) from jsonb_array_elements(r->'stops') with ordinality a(value,ord);
$function$
;

CREATE OR REPLACE FUNCTION proposal_private.standalone_component_link_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Standalone component mapping is immutable' using errcode='22023';
end
$function$
;

CREATE OR REPLACE FUNCTION public.alb03_claim_v1(p_asset_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.alb03_claim_v1(p_asset_id,p_actor) $function$
;

CREATE OR REPLACE FUNCTION public.alb03_finish_v1(p_asset_id uuid, p_actor uuid, p_lease_id uuid, p_descriptor jsonb, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.alb03_finish_v1(p_asset_id,p_actor,p_lease_id,p_descriptor,p_error) $function$
;

CREATE OR REPLACE FUNCTION public.apply_trip_brief_patch_v1(p_brief_id uuid, p_operation_id uuid, p_expected_revision bigint, p_set jsonb DEFAULT '{}'::jsonb, p_remove jsonb DEFAULT '{}'::jsonb, p_confirm_hard text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=auth.uid(); current_brief public.trip_briefs; receipt public.trip_brief_operations;
  request jsonb; next_doc jsonb; collection text; entry record; key text; old_decision jsonb;
  changed_scope boolean; protected_scope text; was_created boolean:=false;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_brief_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
    or p_set is null or p_remove is null or p_confirm_hard is null
    or array_position(p_confirm_hard,null) is not null or cardinality(p_confirm_hard)>200
    or jsonb_typeof(p_set)<>'object' or jsonb_typeof(p_remove)<>'object'
    or (p_set-'decisions'-'scopes'-'travelers')<>'{}' or (p_remove-'decisions'-'scopes'-'travelers')<>'{}'
    or octet_length(p_set::text)+octet_length(p_remove::text)>131072 then
    raise exception 'Invalid patch envelope' using errcode='22023';
  end if;
  foreach collection in array array['decisions','scopes','travelers'] loop
    if p_set ? collection and jsonb_typeof(p_set->collection)<>'object' then raise exception 'Set must contain maps' using errcode='22023'; end if;
    if p_remove ? collection and jsonb_typeof(p_remove->collection)<>'array' then raise exception 'Remove must contain ID arrays' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(p_remove->collection,'[]')) x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~ '^[a-z][a-z0-9_-]{0,63}$')
      or exists(select 1 from jsonb_array_elements_text(coalesce(p_remove->collection,'[]')) x group by x having count(*)>1)
      or exists(select 1 from jsonb_array_elements_text(coalesce(p_remove->collection,'[]')) x where coalesce(p_set->collection,'{}') ? x) then
      raise exception 'Invalid or ambiguous removal' using errcode='22023';
    end if;
  end loop;
  request:=jsonb_build_object('brief_id',p_brief_id,'expected_revision',p_expected_revision,'set',p_set,'remove',p_remove,'confirm_hard',p_confirm_hard);
  -- Serializes duplicate operation IDs, including attempts against different IDs.
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_operation_id::text,0));
  select * into receipt from public.trip_brief_operations where owner_id=actor and operation_id=p_operation_id;
  if found then
    if receipt.request is distinct from request then raise exception 'Operation ID reused with different request' using errcode='22023'; end if;
    select * into current_brief from public.trip_briefs where id=receipt.brief_id and owner_id=actor;
    return jsonb_build_object('brief',to_jsonb(current_brief),'applied_revision',receipt.applied_revision,'replayed',true);
  end if;
  if p_expected_revision=0 then
    insert into public.trip_briefs(id,owner_id,document) values(p_brief_id,actor,'{"decisions":{},"scopes":{},"travelers":{}}')
      on conflict(id) do nothing;
    was_created:=found;
  end if;
  select * into current_brief from public.trip_briefs where id=p_brief_id for update;
  if not found or current_brief.owner_id<>actor then raise exception 'Brief unavailable' using errcode='42501'; end if;
  if current_brief.trip_id is not null then raise exception 'Brief already formalized' using errcode='55000'; end if;
  if not was_created and current_brief.revision<>p_expected_revision then raise exception 'Brief revision conflict; reload before editing' using errcode='40001'; end if;
  if cardinality(p_confirm_hard)<>(select count(distinct x) from unnest(p_confirm_hard) x)
     or exists(select 1 from unnest(p_confirm_hard) x where coalesce(current_brief.document->'decisions'->x->>'strength','')<>'hard') then
    raise exception 'Confirmation must name existing hard decisions' using errcode='22023'; end if;
  next_doc:=current_brief.document;
  foreach collection in array array['decisions','scopes','travelers'] loop
    for key in select jsonb_array_elements_text(coalesce(p_remove->collection,'[]')) loop
      if not (next_doc->collection ? key) then raise exception 'Cannot remove missing ID' using errcode='22023'; end if;
      next_doc:=jsonb_set(next_doc,array[collection],(next_doc->collection)-key);
    end loop;
    next_doc:=jsonb_set(next_doc,array[collection],(next_doc->collection)||coalesce(p_set->collection,'{}'));
  end loop;
  for entry in select * from jsonb_each(current_brief.document->'decisions') loop
    old_decision:=entry.value;
    changed_scope:=false; protected_scope:=old_decision->>'scope';
    while protected_scope<>'global' loop
      if current_brief.document->'scopes'->protected_scope is distinct from next_doc->'scopes'->protected_scope then changed_scope:=true; end if;
      protected_scope:=current_brief.document->'scopes'->protected_scope->>'parent';
    end loop;
    if old_decision->>'strength'='hard' and
      (old_decision is distinct from next_doc->'decisions'->entry.key or changed_scope) and not (entry.key=any(p_confirm_hard)) then
      raise exception 'Explicit confirmation required for hard decision %',entry.key using errcode='22023';
    end if;
    if old_decision->>'origin'='explicit_user' and next_doc->'decisions' ? entry.key and
      (next_doc->'decisions'->entry.key->>'origin') is distinct from 'explicit_user' then
      raise exception 'An interpretation cannot replace an explicit decision' using errcode='22023';
    end if;
    -- IDs are identities, not movable slots. Remove + put is an explicit change.
    if next_doc->'decisions' ? entry.key and
      (old_decision->>'field',old_decision->>'scope') is distinct from
      (next_doc->'decisions'->entry.key->>'field',next_doc->'decisions'->entry.key->>'scope') then
      raise exception 'Decision field/scope immutable for an existing ID' using errcode='22023'; end if;
  end loop;
  -- Also reject laundering explicit authority via a different decision ID.
  if exists(select 1 from jsonb_each(current_brief.document->'decisions') a join jsonb_each(next_doc->'decisions') b
      on a.value->>'field'=b.value->>'field' and a.value->>'scope'=b.value->>'scope'
      where a.value->>'origin'='explicit_user' and b.value->>'origin'<>'explicit_user') then
    raise exception 'An interpretation cannot replace an explicit decision' using errcode='22023'; end if;
  if not public.trip_brief_valid_v1(next_doc) then raise exception 'Invalid brief document or conflicting scopes' using errcode='22023'; end if;
  update public.trip_briefs set document=next_doc,
    revision=case when was_created then 1 else revision+1 end,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
    where id=p_brief_id returning * into current_brief;
  insert into public.trip_brief_operations(owner_id,operation_id,brief_id,request,applied_revision)
    values(actor,p_operation_id,p_brief_id,request,current_brief.revision);
  return jsonb_build_object('brief',to_jsonb(current_brief),'applied_revision',current_brief.revision,'replayed',false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.audit_trip_photo_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op='UPDATE' then
    -- Allow auth.users ON DELETE SET NULL; do not restore the departing user ID.
    if new.updated_by is null and old.updated_by is not null and
      (new.document_id,new.trip_id,new.local_date,new.activity_id,new.itinerary_item_id,new.upload_batch_id,new.selection_index)
      is not distinct from (old.document_id,old.trip_id,old.local_date,old.activity_id,old.itinerary_item_id,old.upload_batch_id,old.selection_index) then
      return new;
    end if;
    if (new.document_id,new.trip_id,new.upload_batch_id,new.selection_index) is distinct from
       (old.document_id,old.trip_id,old.upload_batch_id,old.selection_index) then
      raise exception 'Identitat de foto immutable' using errcode='22023';
    end if;
    new.created_at:=old.created_at;
    new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  else
    new.created_at:=clock_timestamp();new.updated_at:=new.created_at;
  end if;
  new.updated_by:=auth.uid();
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.capture_travel_book_context_v1(p_trip_id uuid, p_book_id uuid, p_operation_id uuid, p_kind text, p_source_id uuid, p_fields text[], p_text_reviewed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.capture_travel_book_context_v1(p_trip_id,p_book_id,p_operation_id,p_kind,p_source_id,p_fields,p_text_reviewed) $function$
;

CREATE OR REPLACE FUNCTION public.change_travel_book_structure_v1(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_expected_structure_version bigint, p_add jsonb, p_remove uuid[], p_order uuid[])
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.change_travel_book_structure_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,p_expected_structure_version,p_add,p_remove,p_order) $function$
;

CREATE OR REPLACE FUNCTION public.claim_notification_deliveries(p_batch_size integer DEFAULT 10, p_lease_seconds integer DEFAULT 600)
 RETURNS SETOF notification_deliveries
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_batch_size is null or p_batch_size not between 1 and 100 then
    raise exception 'p_batch_size must be between 1 and 100'
      using errcode = '22023';
  end if;

  if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'p_lease_seconds must be between 30 and 900'
      using errcode = '22023';
  end if;

  return query
  with claimable as (
    select
      delivery.id,
      case delivery.status
        when 'pending' then delivery.scheduled_for
        when 'retry' then delivery.next_attempt_at
        when 'processing' then delivery.lease_until
      end as due_at
    from public.notification_deliveries as delivery
    where
      (delivery.status = 'pending' and delivery.scheduled_for <= statement_timestamp())
      or (delivery.status = 'retry' and delivery.next_attempt_at <= statement_timestamp())
      or (delivery.status = 'processing' and delivery.lease_until <= statement_timestamp())
    order by
      due_at asc,
      delivery.scheduled_for asc,
      delivery.created_at asc,
      delivery.id asc
    for update of delivery skip locked
    limit p_batch_size
  ),
  claimed as (
    update public.notification_deliveries as delivery
    set
      status = 'processing',
      attempt_count = delivery.attempt_count + 1,
      next_attempt_at = null,
      lease_until = statement_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = statement_timestamp()
    from claimable
    where delivery.id = claimable.id
    returning delivery.*
  )
  select claimed.*
  from claimed
  order by
    case claimed.status
      when 'processing' then claimed.scheduled_for
    end asc,
    claimed.created_at asc,
    claimed.id asc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_place_query_v1(p_owner uuid, p_query jsonb, p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h text:=md5(p_query::text);q place_private.queries;k text;n integer;lim integer;begin
 if not exists(select 1 from auth.users where id=p_owner) or length(p_query->>'text') not between 1 and 500 or octet_length(p_query::text)>2048 then raise exception 'Invalid query';end if;
 perform pg_advisory_xact_lock(hashtextextended('place-query:'||p_owner||h,0));
 select * into q from place_private.queries where owner_id=p_owner and query_hash=h;
 if q.status='completed' and q.expires_at>now() then return jsonb_build_object('cached',true,'results',q.results,'token',q.token,'query_hash',h);end if;
 if q.lease_until>now() then return jsonb_build_object('pending',true);end if;
 -- Global then owner locks have a fixed order. Limits are trusted server configuration.
 foreach k in array array['global:'||current_date,'second:'||date_trunc('second',clock_timestamp())::text,'user:'||p_owner||':'||current_date] loop
 lim=case when k like 'global:%' then (p_config->>'globalDaily')::int when k like 'second:%' then (p_config->>'globalPerSecond')::int else (p_config->>'userDaily')::int end;
 insert into place_private.quota values(k,1) on conflict(bucket) do update set used=place_private.quota.used+1 returning used into n;
 if n>lim then raise exception 'rate_limited' using errcode='P0001';end if;
 end loop;
 insert into place_private.queries(owner_id,query_hash,query,status,lease_until) values(p_owner,h,p_query,'running',now()+make_interval(secs=>ceil((p_config->>'timeoutMs')::numeric/1000)::int+16)) on conflict(owner_id,query_hash) do update set query=excluded.query,status='running',lease_until=excluded.lease_until,token=gen_random_uuid(),results=null,expires_at=null returning * into q;
 return jsonb_build_object('token',q.token,'query_hash',h);
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_proposal_generation_v1(p_owner uuid, p_generation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.proposal_generations;begin
 select * into g from public.proposal_generations where id=p_generation and owner_id=p_owner for update;
 if not found then raise exception 'Generation unavailable' using errcode='42501';end if;
 if g.status not in ('pending','running') or (g.status='running' and g.lease_expires_at>clock_timestamp()) then return null;end if;
 update public.proposal_generations set status='running',attempt_number=attempt_number+1,attempt_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '90 seconds',updated_at=now() where id=g.id returning * into g;
 return to_jsonb(g);
end $function$
;

CREATE OR REPLACE FUNCTION public.confirm_place_v1(p_owner uuid, p_subject jsonb, p_token uuid, p_hash text, p_index integer, p_expected_revision bigint, p_expected_brief_revision bigint, p_operation_id uuid, p_token_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.trip_briefs;q place_private.queries;v jsonb;pid uuid;vid uuid;bid uuid;r bigint;req jsonb;prior place_private.operations;begin
 req=jsonb_build_object('subject',p_subject,'token',p_token,'hash',p_hash,'index',p_index,'revision',p_expected_revision,'brief_revision',p_expected_brief_revision);
 perform pg_advisory_xact_lock(hashtextextended('place-operation:'||p_owner||p_operation_id,0));
 select * into prior from place_private.operations where owner_id=p_owner and operation_id=p_operation_id;
 if found then if prior.request<>req then raise exception 'Operation reused' using errcode='22023';end if;return (select to_jsonb(x) from public.place_bindings x where id=prior.binding_id);end if;
 b=place_private.subject(p_owner,p_subject);
 select * into b from public.trip_briefs where id=b.id for update;
 if b.trip_id is not null then raise exception 'Brief frozen' using errcode='55000';end if;
 if b.revision<>p_expected_brief_revision then raise exception 'Brief changed' using errcode='40001';end if;
 select coalesce(max(revision),0) into r from public.place_bindings where owner_id=p_owner and brief_id=b.id and proposal_id is not distinct from (p_subject->>'proposal_id')::uuid and subject_key=p_subject->>'key';
 if r<>p_expected_revision then raise exception 'Binding changed' using errcode='40001';end if;
 select * into q from place_private.queries where owner_id=p_owner and query_hash=p_hash and token=p_token and status='completed' and expires_at>now();
 -- Candidate expiry is bounded independently of the 24h result cache.
 if q.token is null or p_index<0 or p_index>=jsonb_array_length(q.results) then raise exception 'Candidate unavailable' using errcode='22023';end if;
 v=q.results->p_index;
 if v->>'timezone_status'='verified' and not exists(select 1 from pg_timezone_names where name=v->>'timezone') then raise exception 'Invalid timezone' using errcode='22023';end if;
 insert into public.places(provider,provider_place_id) values(v->>'provider',v->>'provider_place_id') on conflict(provider,provider_place_id) do update set provider=excluded.provider returning id into pid;
 insert into public.place_versions(place_id,canonical_name,kind,administrative_area,country_code,latitude,longitude,coordinate_role,timezone,timezone_status,provider,provider_place_id,source,attribution,resolution_version,content_hash)
 values(pid,v->>'canonical_name',v->>'kind',v->>'administrative_area',v->>'country_code',(v->>'latitude')::float8,(v->>'longitude')::float8,v->>'coordinate_role',v->>'timezone',v->>'timezone_status',v->>'provider',v->>'provider_place_id',v->>'source',v->>'attribution',v->>'resolution_version',md5(v::text)) on conflict(place_id,content_hash) do nothing returning id into vid;
 if vid is null then select id into vid from public.place_versions where place_id=pid and content_hash=md5(v::text);end if;
 if p_subject->>'proposal_id' is null then update public.trip_briefs set revision=revision+1,updated_at=now() where id=b.id returning * into b;end if;
 insert into public.place_bindings(owner_id,brief_id,proposal_id,subject_key,original_text,state,place_version_id,selection_method,brief_revision,revision) values(p_owner,b.id,(p_subject->>'proposal_id')::uuid,p_subject->>'key',q.query->>'text','resolved',vid,'user_selected',b.revision,r+1) returning id into bid;
 insert into place_private.operations values(p_owner,p_operation_id,req,bid);
 return (select to_jsonb(x) from public.place_bindings x where id=bid);
end $function$
;

CREATE OR REPLACE FUNCTION public.confirm_trip_component_v1(p_trip_id uuid, p_component_id text, p_expected_updated_at timestamp with time zone, p_operation_id uuid, p_expected_evidence_document_id uuid DEFAULT NULL::uuid, p_evidence_document_id uuid DEFAULT NULL::uuid, p_evidence_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  h public.trip_proposal_handoffs;
  l public.trip_proposal_component_links;
  receipt public.trip_component_confirmation_operations;
  req jsonb;
  source_kind text;
  source_id uuid;
  allowed_role text;
  current_status text;
  current_updated_at timestamptz;
  current_evidence uuid;
  result_updated_at timestamptz;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if p_trip_id is null
     or p_component_id is null
     or p_component_id !~ '^[a-z][a-z0-9_-]{0,63}$'
     or p_expected_updated_at is null
     or p_operation_id is null then
    raise exception 'Invalid confirmation request' using errcode='22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'Trip unavailable' using errcode='42501';
  end if;

  req := jsonb_build_object(
    'trip_id', p_trip_id,
    'component_id', p_component_id,
    'expected_updated_at', p_expected_updated_at,
    'expected_evidence_document_id', p_expected_evidence_document_id,
    'evidence_document_id', p_evidence_document_id,
    'evidence_role', p_evidence_role
  );

  perform pg_advisory_xact_lock(
    hashtextextended('tb05-confirm:' || actor::text || ':' || p_operation_id::text, 0)
  );

  select *
  into receipt
  from public.trip_component_confirmation_operations
  where actor_id = actor
    and operation_id = p_operation_id;

  if found then
    if receipt.request is distinct from req then
      raise exception 'Operation reused with different request' using errcode='22023';
    end if;

    return jsonb_build_object(
      'operation_id', receipt.operation_id,
      'trip_id', receipt.trip_id,
      'component_id', receipt.component_id,
      'source_kind', receipt.source_kind,
      'source_id', receipt.source_id,
      'confirmation_source', receipt.confirmation_source,
      'evidence_document_id', receipt.evidence_document_id,
      'evidence_role', receipt.evidence_role,
      'confirmed_at', receipt.confirmed_at,
      'replayed', true
    );
  end if;

  select h0.*
    into h
  from public.trip_proposal_handoffs h0
  where h0.trip_id = p_trip_id
  limit 1;

  if h.id is null then
    raise exception 'TB handoff unavailable' using errcode='P0002';
  end if;

  select l0.*
    into l
  from public.trip_proposal_component_links l0
  where l0.handoff_id = h.id
    and l0.trip_id = p_trip_id
    and l0.component_id = p_component_id
  limit 1;

  if l.component_id is null then
    raise exception 'TB component unavailable' using errcode='P0002';
  end if;

  if l.accommodation_id is not null then
    source_kind := 'accommodation';
    source_id := l.accommodation_id;
    allowed_role := 'voucher';

    if p_evidence_role is not null and p_evidence_role <> allowed_role then
      raise exception 'Invalid evidence role for component' using errcode='22023';
    end if;

    select a.reservation_status, a.updated_at
      into current_status, current_updated_at
    from public.trip_accommodations a
    where a.trip_id = p_trip_id and a.id = source_id
    for update;

    select d.document_id
      into current_evidence
    from public.trip_accommodation_documents d
    where d.trip_id = p_trip_id
      and d.accommodation_id = source_id
      and d.document_role = allowed_role
    for update;

  elsif l.flight_id is not null then
    source_kind := 'flight';
    source_id := l.flight_id;
    allowed_role := 'booking';

    if p_evidence_role is not null and p_evidence_role <> allowed_role then
      raise exception 'Invalid evidence role for component' using errcode='22023';
    end if;

    select f.flight_status, f.updated_at
      into current_status, current_updated_at
    from public.trip_flights f
    where f.trip_id = p_trip_id and f.id = source_id
    for update;

    select d.document_id
      into current_evidence
    from public.trip_flight_documents d
    where d.trip_id = p_trip_id
      and d.flight_id = source_id
      and d.document_role = allowed_role
    for update;

  else
    source_kind := 'activity';
    source_id := l.activity_id;
    allowed_role := coalesce(p_evidence_role, 'booking');

    if allowed_role not in ('booking','ticket') then
      raise exception 'Invalid evidence role for component' using errcode='22023';
    end if;

    select a.reservation_status, a.updated_at
      into current_status, current_updated_at
    from public.trip_activities a
    where a.trip_id = p_trip_id and a.id = source_id
    for update;

    select d.document_id
      into current_evidence
    from public.trip_activity_documents d
    where d.trip_id = p_trip_id
      and d.activity_id = source_id
      and d.document_role = allowed_role
    for update;
  end if;

  if current_updated_at is null then
    raise exception 'Operational source unavailable' using errcode='P0002';
  end if;

  if current_updated_at is distinct from p_expected_updated_at then
    raise exception 'Component version conflict' using errcode='40001';
  end if;

  if current_status = 'cancelled' then
    raise exception 'Cancelled component cannot be confirmed' using errcode='22023';
  end if;

  if current_evidence is distinct from p_expected_evidence_document_id then
    raise exception 'Evidence version conflict' using errcode='40001';
  end if;

  if p_evidence_document_id is not null then
    if p_evidence_role is null then
      raise exception 'Evidence role required' using errcode='22023';
    end if;

    if not exists (
      select 1
      from public.travel_documents d
      where d.trip_id = p_trip_id
        and d.id = p_evidence_document_id
    ) then
      raise exception 'Evidence document must belong to this trip' using errcode='23503';
    end if;
  elsif p_evidence_role is not null then
    raise exception 'Evidence role requires a document' using errcode='22023';
  end if;

  if source_kind = 'accommodation' then
    if current_status <> 'confirmed' then
      update public.trip_accommodations
      set reservation_status = 'confirmed'
      where trip_id = p_trip_id and id = source_id
      returning updated_at into result_updated_at;
    else
      result_updated_at := current_updated_at;
    end if;

    if current_evidence is distinct from p_evidence_document_id then
      delete from public.trip_accommodation_documents
      where trip_id = p_trip_id
        and accommodation_id = source_id
        and document_role = allowed_role;

      if p_evidence_document_id is not null then
        insert into public.trip_accommodation_documents(
          trip_id, accommodation_id, document_id, document_role, created_by
        ) values (
          p_trip_id, source_id, p_evidence_document_id, allowed_role, actor
        );
      end if;
    end if;

  elsif source_kind = 'flight' then
    if current_status <> 'confirmed' then
      update public.trip_flights
      set flight_status = 'confirmed'
      where trip_id = p_trip_id and id = source_id
      returning updated_at into result_updated_at;
    else
      result_updated_at := current_updated_at;
    end if;

    if current_evidence is not distinct from p_evidence_document_id then
      null;
    else
      delete from public.trip_flight_documents
      where trip_id = p_trip_id
        and flight_id = source_id
        and document_role = allowed_role;

      if p_evidence_document_id is not null then
        insert into public.trip_flight_documents(
          trip_id, flight_id, document_id, document_role, created_by
        ) values (
          p_trip_id, source_id, p_evidence_document_id, allowed_role, actor
        );
      end if;
    end if;

  else
    if current_status <> 'confirmed' then
      update public.trip_activities
      set reservation_status = 'confirmed'
      where trip_id = p_trip_id and id = source_id
      returning updated_at into result_updated_at;
    else
      result_updated_at := current_updated_at;
    end if;

    if current_evidence is distinct from p_evidence_document_id then
      delete from public.trip_activity_documents
      where trip_id = p_trip_id
        and activity_id = source_id
        and document_role = allowed_role;

      if p_evidence_document_id is not null then
        insert into public.trip_activity_documents(
          trip_id, activity_id, document_id, document_role, created_by
        ) values (
          p_trip_id, source_id, p_evidence_document_id, allowed_role, actor
        );
      end if;
    end if;
  end if;

  insert into public.trip_component_confirmation_operations(
    actor_id, operation_id, handoff_id, trip_id, component_id,
    source_kind, source_id, confirmation_source,
    evidence_document_id, evidence_role, request
  ) values (
    actor, p_operation_id, h.id, p_trip_id, p_component_id,
    source_kind, source_id, 'user_manual',
    p_evidence_document_id,
    p_evidence_role,
    req
  )
  returning * into receipt;

  return jsonb_build_object(
    'operation_id', receipt.operation_id,
    'trip_id', receipt.trip_id,
    'component_id', receipt.component_id,
    'source_kind', receipt.source_kind,
    'source_id', receipt.source_id,
    'confirmation_source', receipt.confirmation_source,
    'evidence_document_id', receipt.evidence_document_id,
    'evidence_role', receipt.evidence_role,
    'confirmed_at', receipt.confirmed_at,
    'source_updated_at', result_updated_at,
    'replayed', false
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_trip_component_with_cost_v1(p_trip_id uuid, p_component_id text, p_expected_updated_at timestamp with time zone, p_operation_id uuid, p_expected_evidence_document_id uuid DEFAULT NULL::uuid, p_evidence_document_id uuid DEFAULT NULL::uuid, p_evidence_role text DEFAULT NULL::text, p_cost_expected_revision bigint DEFAULT 0, p_expected_amount numeric DEFAULT NULL::numeric, p_confirmed_amount numeric DEFAULT NULL::numeric, p_currency text DEFAULT NULL::text, p_expected_quality text DEFAULT 'unknown'::text, p_verified_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scope jsonb DEFAULT '{}'::jsonb, p_unknown_required_costs jsonb DEFAULT '[]'::jsonb, p_excluded_costs jsonb DEFAULT '[]'::jsonb, p_cost_evidence_document_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  confirmation jsonb;
  cost_result jsonb;
begin
  confirmation := public.confirm_trip_component_v1(
    p_trip_id,p_component_id,p_expected_updated_at,p_operation_id,
    p_expected_evidence_document_id,p_evidence_document_id,p_evidence_role
  );
  cost_result := public.set_trip_component_cost_v1(
    p_trip_id,p_component_id,p_cost_expected_revision,p_operation_id,
    p_expected_amount,p_confirmed_amount,p_currency,p_expected_quality,p_verified_at,p_scope,
    p_unknown_required_costs,p_excluded_costs,coalesce(p_cost_evidence_document_id,p_evidence_document_id)
  );
  return confirmation || jsonb_build_object('cost',cost_result,'source_updated_at',coalesce(cost_result->'source_updated_at',confirmation->'source_updated_at'));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_travel_book_edition_v1(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_title text, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.create_travel_book_edition_v1(p_trip_id,p_book_id,p_edition_id,p_title,p_operation_id) $function$
;

CREATE OR REPLACE FUNCTION public.create_travel_book_revision_v1(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_revision_id uuid, p_expected_structure_version bigint, p_expected_compositions jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.create_travel_book_revision_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,p_revision_id,p_expected_structure_version,p_expected_compositions) $function$
;

CREATE OR REPLACE FUNCTION public.create_travel_book_v1(p_trip_id uuid, p_book_id uuid, p_title text, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.create_travel_book_v1(p_trip_id,p_book_id,p_title,p_operation_id) $function$
;

CREATE OR REPLACE FUNCTION public.create_trip(p_name text)
 RETURNS TABLE(id uuid, name text, invite_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trip public.trips;
begin
  if auth.uid() is null then
    raise exception 'Cal iniciar sessió';
  end if;
  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Escriu un nom per al viatge';
  end if;
  if exists(select 1 from public.trip_members where user_id = auth.uid()) then
    raise exception 'Ja formes part d’un viatge';
  end if;

  insert into public.trips(name, owner_id)
  values (trim(p_name), auth.uid())
  returning * into v_trip;

  insert into public.trip_members(trip_id, user_id)
  values (v_trip.id, auth.uid());

  return query select v_trip.id, v_trip.name, v_trip.invite_code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_trip_v2(p_name text, p_start_date date, p_end_date date, p_time_zone text)
 RETURNS TABLE(id uuid, name text, invite_code text, owner_id uuid, start_date date, end_date date, time_zone text, experience_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  authenticated_user_id uuid := auth.uid();
  normalized_name text := btrim(p_name);
  normalized_time_zone text := btrim(p_time_zone);
  created_trip public.trips%rowtype;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 1 and 100 then
    raise exception 'El nom del viatge ha de tenir entre 1 i 100 caràcters';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'Les dates d’inici i fi són obligatòries';
  end if;

  if p_end_date < p_start_date then
    raise exception 'La data de fi no pot ser anterior a la data d’inici';
  end if;

  if normalized_time_zone is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = normalized_time_zone
     ) then
    raise exception 'La zona horària no és una zona IANA vàlida';
  end if;

  insert into public.trips (
    name,
    owner_id,
    start_date,
    end_date,
    time_zone
  )
  values (
    normalized_name,
    authenticated_user_id,
    p_start_date,
    p_end_date,
    normalized_time_zone
  )
  returning * into created_trip;

  insert into public.trip_members (trip_id, user_id)
  values (created_trip.id, authenticated_user_id);

  perform public.initialize_generic_trip_checklist(created_trip.id);

  return query
  select
    created_trip.id,
    created_trip.name,
    created_trip.invite_code,
    created_trip.owner_id,
    created_trip.start_date,
    created_trip.end_date,
    created_trip.time_zone,
    created_trip.experience_key;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_trip_with_stops_v1(p_name text, p_start_date date, p_end_date date, p_stops jsonb)
 RETURNS TABLE(id uuid, name text, invite_code text, owner_id uuid, start_date date, end_date date, time_zone text, experience_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  authenticated_user_id uuid := auth.uid();
  stop_count integer; stop_row jsonb; stop_index integer := 0;
  stop_name text; stop_label text; stop_timezone text; stop_provider text; stop_provider_place_id text;
  stop_admin text; stop_country text; stop_lat double precision; stop_lon double precision;
  first_timezone text; created_trip record;
begin
  if authenticated_user_id is null then raise exception 'Cal iniciar sessió' using errcode='42501'; end if;
  if p_stops is null or jsonb_typeof(p_stops)<>'array' then raise exception 'Cal indicar almenys una destinació'; end if;
  stop_count:=jsonb_array_length(p_stops);
  if stop_count not between 1 and 20 then raise exception 'El viatge ha de tenir entre 1 i 20 destinacions'; end if;
  for stop_row in select value from jsonb_array_elements(p_stops) loop
    stop_index:=stop_index+1;
    if jsonb_typeof(stop_row)<>'object' then raise exception 'Destinació no vàlida'; end if;
    stop_label:=btrim(stop_row->>'label'); stop_name:=btrim(stop_row->>'canonical_name');
    stop_timezone:=btrim(stop_row->>'time_zone'); stop_provider:=btrim(stop_row->>'provider');
    stop_provider_place_id:=btrim(stop_row->>'provider_place_id'); stop_admin:=nullif(btrim(stop_row->>'administrative_area'),'');
    stop_country:=nullif(upper(btrim(stop_row->>'country_code')),'');
    begin stop_lat:=(stop_row->>'latitude')::double precision; stop_lon:=(stop_row->>'longitude')::double precision;
    exception when others then raise exception 'Coordenades de destinació no vàlides'; end;
    if stop_label is null or char_length(stop_label) not between 1 and 120
       or stop_name is null or char_length(stop_name) not between 1 and 500
       or stop_provider<>'geoapify'
       or stop_provider_place_id is null or char_length(stop_provider_place_id) not between 1 and 500
       or stop_lat not between -90 and 90 or stop_lon not between -180 and 180
       or (stop_country is not null and stop_country !~ '^[A-Z]{2}$')
       or stop_timezone is null
       or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=stop_timezone)
    then raise exception 'Destinació no vàlida o zona horària no verificable'; end if;
    if stop_index=1 then first_timezone:=stop_timezone; end if;
  end loop;
  select * into created_trip from public.create_trip_v2(p_name,p_start_date,p_end_date,first_timezone);
  stop_index:=0;
  for stop_row in select value from jsonb_array_elements(p_stops) loop
    stop_index:=stop_index+1;
    insert into public.trip_stops(trip_id,position,label,canonical_name,administrative_area,country_code,latitude,longitude,time_zone,provider,provider_place_id)
    values (created_trip.id,stop_index,btrim(stop_row->>'label'),btrim(stop_row->>'canonical_name'),
      nullif(btrim(stop_row->>'administrative_area'),''),nullif(upper(btrim(stop_row->>'country_code')),''),
      (stop_row->>'latitude')::double precision,(stop_row->>'longitude')::double precision,
      btrim(stop_row->>'time_zone'),btrim(stop_row->>'provider'),btrim(stop_row->>'provider_place_id'));
  end loop;
  return query select created_trip.id,created_trip.name,created_trip.invite_code,created_trip.owner_id,
    created_trip.start_date,created_trip.end_date,created_trip.time_zone,created_trip.experience_key;
end; $function$
;

CREATE OR REPLACE FUNCTION public.discard_construction_trip_v1(p_trip_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select app_private.discard_construction_trip_v1(p_trip_id);
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_accommodation_document_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then return new; end if;
  if auth.uid() is null then raise exception 'Cal iniciar sessio' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then new.created_at := statement_timestamp(); return new; end if;
  if new.trip_id is distinct from old.trip_id or new.accommodation_id is distinct from old.accommodation_id or new.document_role is distinct from old.document_role then raise exception 'No es pot canviar l ambit de l associacio documental' using errcode = '42501'; end if;
  new.created_by := auth.uid(); new.created_at := statement_timestamp(); return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_accommodation_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then return new; end if;
  if auth.uid() is null then raise exception 'Cal iniciar sessio' using errcode = '42501'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names as timezone_record where timezone_record.name = new.time_zone) then raise exception 'La zona horaria no es una zona IANA valida' using errcode = '22023'; end if;
  if tg_op = 'INSERT' then
    new.updated_by := null; new.created_at := statement_timestamp(); new.updated_at := new.created_at;
  else
    if new.id is distinct from old.id or new.trip_id is distinct from old.trip_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then raise exception 'No es poden modificar els camps immutables de l allotjament' using errcode = '42501'; end if;
    new.updated_by := auth.uid(); new.updated_at := statement_timestamp();
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_activity_document_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
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
     or new.activity_id is distinct from old.activity_id
     or new.document_role is distinct from old.document_role then
    raise exception 'No es pot canviar l ambit de l associacio documental'
      using errcode = '42501';
  end if;

  new.created_by := auth.uid();
  new.created_at := statement_timestamp();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_activity_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if new.time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.time_zone
     ) then
    raise exception 'La zona horaria de l activitat no es valida'
      using errcode = '22023';
  end if;

  if new.transport_arrival_time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.transport_arrival_time_zone
     ) then
    raise exception 'La zona horaria d arribada del transport no es valida'
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
      raise exception 'No es poden modificar els camps immutables de l activitat'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_car_rental_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_day_metadata_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  new.title := nullif(btrim(new.title), '');
  new.summary := nullif(btrim(new.summary), '');

  if exists (
    select 1
    from public.trips as trip
    where trip.id = new.trip_id
      and trip.start_date is not null
      and trip.end_date is not null
      and new.local_date not between trip.start_date and trip.end_date
  ) then
    raise exception 'La data editorial queda fora del viatge'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.updated_by := null;
    new.created_at := statement_timestamp();
    new.updated_at := new.created_at;
  else
    if new.id is distinct from old.id
       or new.trip_id is distinct from old.trip_id
       or new.local_date is distinct from old.local_date
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'No es poden modificar els camps immutables de la capcalera del dia'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_flight_document_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
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
     or new.flight_id is distinct from old.flight_id
     or new.document_role is distinct from old.document_role then
    raise exception 'No es pot canviar l ambit de l associacio documental'
      using errcode = '42501';
  end if;

  new.created_by := auth.uid();
  new.created_at := statement_timestamp();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_flight_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if new.departure_time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.departure_time_zone
     ) then
    raise exception 'La zona horaria de sortida no es valida'
      using errcode = '22023';
  end if;

  if new.arrival_time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.arrival_time_zone
     ) then
    raise exception 'La zona horaria d arribada no es valida'
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
      raise exception 'No es poden modificar els camps immutables del vol'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_itinerary_item_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if new.time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.time_zone
     ) then
    raise exception 'La zona horaria de l element d itinerari no es valida'
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
      raise exception 'No es poden modificar els camps immutables de l element d itinerari'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_trip_progress_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  previous jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  incoming jsonb := to_jsonb(new);
  field_name text;
  fields text[];
  changed boolean := false;
  stamp timestamptz := clock_timestamp();
begin
  fields := case tg_table_name
    when 'trip_accommodations' then array['check_in_completed_at','check_out_completed_at']
    when 'trip_itinerary_items' then array['status']
    else array['completed_at'] end;
  foreach field_name in array fields loop
    if field_name = 'status' then
      if (incoming->>'status' = 'completed') is not distinct from (coalesce(previous->>'status','planned') = 'completed') then continue; end if;
      if incoming->>'status' = 'completed' and previous->>'status' = 'cancelled' then
        raise exception 'Reactiva el planning cancellat abans de marcar-lo fet' using errcode = '22023';
      end if;
    elsif coalesce(incoming->field_name,'null'::jsonb) is not distinct from coalesce(previous->field_name,'null'::jsonb) then
      continue;
    end if;
    changed := true;
    if auth.uid() is null or not public.is_trip_member(new.trip_id)
       or not exists (select 1 from public.trips t where t.id = new.trip_id and t.experience_key is distinct from 'london-2026') then
      raise exception 'Progres no disponible per a aquest viatge' using errcode = '42501';
    end if;
    if field_name <> 'status' and incoming->>field_name is not null then
      if coalesce(incoming->>'reservation_status',incoming->>'flight_status') = 'cancelled' then
        raise exception 'Un element cancellat no es pot marcar fet' using errcode = '22023';
      end if;
      -- Preserve an existing mark; never accept a client-supplied time.
      incoming := jsonb_set(incoming,array[field_name],to_jsonb(coalesce((previous->>field_name)::timestamptz,stamp)));
    end if;
  end loop;
  if changed then
    incoming := jsonb_set(incoming,'{updated_at}',to_jsonb(greatest(stamp,coalesce((previous->>'updated_at')::timestamptz,stamp)+interval '1 microsecond')));
    new := jsonb_populate_record(new,incoming);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_trip_flight_travelers(p_trip_id uuid, p_flight_ids uuid[], p_names text[])
 RETURNS TABLE(traveler_id uuid, display_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid:=auth.uid();
  v_name text;
  v_traveler uuid;
  v_flight uuid;
begin
  if v_user is null or not public.is_trip_member(p_trip_id) then
    raise exception 'No autoritzat' using errcode='42501';
  end if;

  foreach v_name in array coalesce(p_names,array[]::text[]) loop
    v_name:=btrim(v_name);
    if v_name='' then continue; end if;

    select tt.id
      into v_traveler
      from public.trip_travelers as tt
     where tt.trip_id=p_trip_id
       and lower(tt.display_name)=lower(v_name);

    if v_traveler is null then
      insert into public.trip_travelers(trip_id,display_name,created_by)
      values(p_trip_id,v_name,v_user)
      returning id into v_traveler;
    end if;

    foreach v_flight in array coalesce(p_flight_ids,array[]::uuid[]) loop
      if not exists(
        select 1
          from public.trip_flights as tf
         where tf.trip_id=p_trip_id
           and tf.id=v_flight
      ) then
        raise exception 'Vol fora del viatge' using errcode='23503';
      end if;

      insert into public.trip_flight_travelers(trip_id,flight_id,traveler_id,created_by)
      values(p_trip_id,v_flight,v_traveler,v_user)
      on conflict do nothing;
    end loop;

    traveler_id:=v_traveler;
    display_name:=v_name;
    return next;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.ensure_trip_standalone_component_v1(p_trip_id uuid, p_source_kind text, p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.explore_more_proposals_v1(p_owner uuid, p_brief uuid, p_revision bigint, p_previous uuid, p_operation uuid, p_generator text, p_refinement jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.trip_briefs;g public.proposal_generations;r public.proposal_operations;req jsonb;previous public.proposal_generations;latest uuid;
begin
 if p_owner is null or p_operation is null or p_previous is null or p_revision is null or p_generator is null or length(p_generator) not between 1 and 200 or not proposal_private.refinement_valid(p_refinement) or (jsonb_array_length(p_refinement->'chips')=0 and btrim(p_refinement->>'text')='') then raise exception 'Invalid refinement' using errcode='22023';end if;
 req=jsonb_build_object('brief',p_brief,'revision',p_revision,'previous',p_previous,'generator',p_generator,'refinement',p_refinement);
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_operation::text,0));
 select * into r from public.proposal_operations where owner_id=p_owner and operation_id=p_operation;
 if found then
  if r.action<>'explore_more' or r.request<>req then raise exception 'Operation reused' using errcode='22023';end if;
  select * into g from public.proposal_generations where id=r.generation_id;return to_jsonb(g);
 end if;
 select * into b from public.trip_briefs where id=p_brief and owner_id=p_owner for update;
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 if b.revision<>p_revision then raise exception 'Brief changed' using errcode='40001';end if;
 select * into previous from public.proposal_generations where id=p_previous and brief_id=b.id and owner_id=p_owner;
 if not found then raise exception 'Previous unavailable' using errcode='42501';end if;
 select id into latest from public.proposal_generations where brief_id=b.id order by round_number desc nulls last,created_at desc,id desc limit 1;
 if latest<>p_previous or previous.status not in ('completed','no_results') then raise exception 'Round changed or unfinished' using errcode='40001';end if;
 insert into public.proposal_generations(owner_id,brief_id,brief_revision,brief_schema_version,brief_snapshot,snapshot_hash,engine_version,generator_version,verifier_version,policy_version,previous_generation_id,refinement)
 values(p_owner,b.id,b.revision,b.schema_version,b.document,encode(sha256(convert_to(b.document::text,'UTF8')),'hex'),'tb04-engine-v1',p_generator,'no-factual-source-v1','tb04-policy-v1',p_previous,p_refinement) returning * into g;
 insert into public.proposal_operations values(p_owner,p_operation,'explore_more',req,g.id,now());return to_jsonb(g);
end $function$
;

CREATE OR REPLACE FUNCTION public.fail_proposal_generation_v1(p_owner uuid, p_generation uuid, p_token uuid, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin
 if p_error not in ('provider_error','provider_auth_error','provider_rate_limited','provider_timeout','provider_transport_error','provider_refusal','provider_incomplete','provider_invalid_response','invalid_candidate','invalid_verifier_result','configuration_error','engine_error') then p_error='engine_error';end if;
 update public.proposal_generations set status='failed',error_code=p_error,finished_at=now(),updated_at=now() where id=p_generation and owner_id=p_owner and status='running' and attempt_token=p_token and lease_expires_at>clock_timestamp();
 if not found then raise exception 'Stale attempt' using errcode='40001';end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.finalize_trip_photo(p_trip_id uuid, p_document_id uuid, p_title text, p_file_name text, p_mime_type text, p_upload_batch_id uuid, p_selection_index integer, p_local_date date, p_activity_id uuid, p_itinerary_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.travel_documents; m public.trip_photo_metadata; ext text; path text; uid uuid:=auth.uid();
begin
  if uid is null or not public.is_trip_member(p_trip_id) or not exists
    (select 1 from public.trips where id=p_trip_id and experience_key is distinct from 'london-2026') then
    raise exception 'No tens acces a les fotos contextuals' using errcode='42501';
  end if;
  ext:=case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
    when 'image/heif' then 'heif'
  end;
  if p_document_id is null or p_upload_batch_id is null or p_selection_index is null or p_selection_index not between 0 and 19
    or ext is null or nullif(btrim(p_title),'') is null or length(p_title)>160
    or nullif(btrim(p_file_name),'') is null or length(p_file_name)>1024 then
    raise exception 'Dades de foto no valides' using errcode='22023';
  end if;
  path:=p_trip_id::text||'/photos/'||uid::text||'/'||p_document_id::text||'.'||ext;
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text,0));
  select * into d from public.travel_documents where id=p_document_id for update;
  if found then
    select * into m from public.trip_photo_metadata where document_id=d.id;
    if d.trip_id<>p_trip_id or d.created_by<>uid or d.category<>'Foto' or d.file_path<>path
      or d.file_name<>p_file_name or m.document_id is null
      or m.upload_batch_id is distinct from p_upload_batch_id or m.selection_index is distinct from p_selection_index then
      raise exception 'Identitat de pujada incompatible' using errcode='22023';
    end if;
    return jsonb_build_object('document',to_jsonb(d),'metadata',to_jsonb(m));
  end if;
  insert into public.travel_documents(id,trip_id,title,category,file_name,file_path,mime_type,created_by)
    values(p_document_id,p_trip_id,btrim(p_title),'Foto',p_file_name,path,p_mime_type,uid) returning * into d;
  insert into public.trip_photo_metadata(document_id,trip_id,local_date,activity_id,itinerary_item_id,upload_batch_id,selection_index)
    values(d.id,p_trip_id,p_local_date,p_activity_id,p_itinerary_item_id,p_upload_batch_id,p_selection_index) returning * into m;
  return jsonb_build_object('document',to_jsonb(d),'metadata',to_jsonb(m));
end; $function$
;

CREATE OR REPLACE FUNCTION public.finish_place_query_v1(p_owner uuid, p_hash text, p_token uuid, p_results jsonb, p_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>5 or octet_length(p_results::text)>65536 or p_seconds not between 1 and 604800 then raise exception 'Invalid results';end if;
 update place_private.queries set status='completed',results=p_results,expires_at=now()+make_interval(secs=>p_seconds),lease_until=null where owner_id=p_owner and query_hash=p_hash and token=p_token and status='running' and lease_until>now();
 if not found then raise exception 'Query expired' using errcode='40001';end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.finish_proposal_generation_v1(p_owner uuid, p_generation uuid, p_token uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.proposal_generations;b public.trip_briefs;item jsonb;d record;h text;i integer:=0;n integer;
begin
 -- Consistent lock ordering with request: Brief then generation.
 select b0.* into b from public.trip_briefs b0 join public.proposal_generations g0 on g0.brief_id=b0.id where g0.id=p_generation and g0.owner_id=p_owner for update of b0;
 if not found then raise exception 'Unavailable' using errcode='42501';end if;
 select * into g from public.proposal_generations where id=p_generation and owner_id=p_owner for update;
 h=encode(sha256(convert_to(p_result::text,'UTF8')),'hex');
 if g.attempt_token=p_token and g.result_hash=h and g.status in ('completed','no_results','obsolete') then return to_jsonb(g);end if;
 if g.status<>'running' or g.attempt_token is distinct from p_token or g.lease_expires_at<=clock_timestamp() then raise exception 'Stale attempt' using errcode='40001';end if;
 if b.revision<>g.brief_revision then update public.proposal_generations set status='obsolete',result_hash=h,finished_at=now(),updated_at=now() where id=g.id returning * into g;return to_jsonb(g);end if;
 if jsonb_typeof(p_result->'proposals') is distinct from 'array' or octet_length(p_result::text)>262144 then raise exception 'Invalid result' using errcode='22023';end if;
 n=jsonb_array_length(p_result->'proposals');
 if n>3 or (n>0 and p_result->>'status'<>'completed') or (n=0 and (p_result->>'status'<>'no_results' or coalesce(p_result->>'result_reason','') not in ('incompatible','insufficient_information','no_new_alternatives'))) then raise exception 'Invalid result count/status' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_result->'proposals') loop
  if exists(select 1 from jsonb_array_elements(g.excluded_routes) x where x->>'fingerprint'=item->>'fingerprint' or proposal_private.route_key(x->'route')=proposal_private.route_key(item#>'{document,candidate,route}')) then raise exception 'Repeated route' using errcode='22023';end if;
  if not proposal_private.document_valid(item->'document') then raise exception 'Invalid proposal' using errcode='22023';end if;
  if jsonb_array_length(item#>'{document,evaluations}')<>(select count(*) from jsonb_each(g.brief_snapshot->'decisions')) then raise exception 'Missing decision coverage' using errcode='22023';end if;
  for d in select key,value from jsonb_each(g.brief_snapshot->'decisions') loop
   if (select count(*) from jsonb_array_elements(item#>'{document,evaluations}') e where e->>'decision_id'=d.key and e->>'field'=d.value->>'field' and e->>'scope'=d.value->>'scope' and e->>'strength' is not distinct from d.value->>'strength' and e->>'knowledge'=d.value->>'knowledge')<>1 then raise exception 'Invalid decision coverage' using errcode='22023';end if;
  end loop;
  i=i+1;insert into public.trip_proposals(generation_id,position,fingerprint,document) values(g.id,i,item->>'fingerprint',item->'document');
 end loop;
 update public.proposal_generations set status=p_result->>'status',result_reason=p_result->>'result_reason',result_hash=h,finished_at=now(),updated_at=now() where id=g.id returning * into g;
 return to_jsonb(g);
end $function$
;

CREATE OR REPLACE FUNCTION public.formalize_trip_proposal_legacy_v1(p_brief_id uuid, p_expected_brief_revision bigint, p_proposal_id uuid, p_expected_generation_id uuid, p_expected_snapshot_hash text, p_operation_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();b public.trip_briefs;p public.trip_proposals;g public.proposal_generations;h public.trip_proposal_handoffs;r public.trip_handoff_operations;req jsonb;components jsonb;c jsonb;choice jsonb;target uuid;t uuid;outcome jsonb;tz text;d1 date;d2 date;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_operation_id is null or p_brief_id is null or p_proposal_id is null or p_expected_generation_id is null or p_expected_brief_revision is null or p_expected_brief_revision<1 or p_expected_snapshot_hash is null or p_expected_snapshot_hash!~'^[0-9a-f]{64}$' then raise exception 'Invalid request' using errcode='22023';end if;
 if not coalesce(extensions.jsonb_matches_schema('{"type":"object","additionalProperties":false,"required":["name","time_zone","start_date","end_date","acknowledge_unresolved","components"],"properties":{"name":{"type":"string","minLength":1,"maxLength":100},"time_zone":{"type":"string","minLength":1,"maxLength":100},"start_date":{"type":["string","null"],"pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$"},"end_date":{"type":["string","null"],"pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$"},"acknowledge_unresolved":{"type":"boolean"},"components":{"type":"object","maxProperties":40,"additionalProperties":{"type":"object","additionalProperties":false,"required":["target","time_zone"],"properties":{"target":{"enum":["accommodation","flight","activity","transport"]},"time_zone":{"type":["string","null"],"maxLength":100}}}}}}'::json,p_details),false) then raise exception 'Invalid details' using errcode='22023';end if;
 req=jsonb_build_object('brief_id',p_brief_id,'revision',p_expected_brief_revision,'proposal_id',p_proposal_id,'generation_id',p_expected_generation_id,'snapshot_hash',p_expected_snapshot_hash,'details',p_details);
 if octet_length(req::text)>65536 then raise exception 'Request too large' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('handoff:'||actor::text||':'||p_operation_id::text,0));
 select * into r from public.trip_handoff_operations where owner_id=actor and operation_id=p_operation_id;
 if found then
  if r.request is distinct from req then raise exception 'Operation reused' using errcode='22023';end if;
  select * into h from public.trip_proposal_handoffs where id=r.handoff_id;
  return public.get_trip_handoff_v1(h.brief_id)||'{"replayed":true}'::jsonb;
 end if;
 select * into b from public.trip_briefs where id=p_brief_id and owner_id=actor for update;
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 select * into h from public.trip_proposal_handoffs where brief_id=b.id;
 if found then
  if h.request is distinct from req then raise exception 'Brief already formalized with another request' using errcode='40001';end if;
  if b.trip_id is distinct from h.trip_id or (select count(*) from public.trip_proposal_component_links where handoff_id=h.id)<>(select jsonb_array_length(document#>'{candidate,components}') from public.trip_proposals where id=h.proposal_id) then raise exception 'Incomplete handoff' using errcode='23514';end if;
  insert into public.trip_handoff_operations values(actor,p_operation_id,h.id,req,clock_timestamp());return public.get_trip_handoff_v1(b.id);
 end if;
 if b.trip_id is not null then raise exception 'Missing handoff' using errcode='23514';end if;
 if b.revision<>p_expected_brief_revision then raise exception 'Brief revision conflict' using errcode='40001';end if;
 select * into p from public.trip_proposals where id=p_proposal_id;
 select * into g from public.proposal_generations where id=p.generation_id and owner_id=actor and brief_id=b.id;
 if not found then raise exception 'Proposal unavailable' using errcode='42501';end if;
 if g.id<>p_expected_generation_id or g.brief_revision<>b.revision or g.snapshot_hash<>p_expected_snapshot_hash or g.status<>'completed' then raise exception 'Proposal snapshot conflict' using errcode='40001';end if;
 if exists(select 1 from jsonb_array_elements(p.document->'evaluations') e where e->>'strength'='hard' and e->>'state'='violated') then raise exception 'Hard violation' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p.document->'evaluations') e where e->>'strength'='hard' and e->>'state'='unresolved') and not (p_details->>'acknowledge_unresolved')::boolean then raise exception 'Unresolved essentials require acknowledgement' using errcode='22023';end if;
 if btrim(p_details->>'name')='' then raise exception 'Name required' using errcode='22023';end if;
 tz=p_details->>'time_zone';if not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Explicit IANA timezone required' using errcode='22023';end if;
 d1=(p_details->>'start_date')::date;d2=(p_details->>'end_date')::date;
 if (d1 is null)<>(d2 is null) or d2<d1 then raise exception 'Invalid date pair' using errcode='22023';end if;
 components=p.document#>'{candidate,components}';
 if (select count(*) from jsonb_each(p_details->'components'))<>jsonb_array_length(components) then raise exception 'Exact component coverage required' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(components) loop
  choice=p_details->'components'->(c->>'id');
  if choice is null or not ((c->>'kind'='accommodation' and choice->>'target'='accommodation') or (c->>'kind'='experience' and choice->>'target'='activity') or (c->>'kind'='transport' and choice->>'target' in ('flight','transport'))) then raise exception 'Explicit component classification required' using errcode='22023';end if;
  if c->>'kind'='accommodation' then
   if choice->>'time_zone' is null or not exists(select 1 from pg_timezone_names where name=choice->>'time_zone') then raise exception 'Accommodation timezone required' using errcode='22023';end if;
  elsif choice->>'time_zone' is not null then raise exception 'No inferred scheduling timezone' using errcode='22023';end if;
 end loop;
 insert into public.trips(name,owner_id,start_date,end_date,time_zone) values(btrim(p_details->>'name'),actor,d1,d2,tz) returning id into t;
 insert into public.trip_members(trip_id,user_id) values(t,actor);
 insert into public.trip_proposal_handoffs(owner_id,brief_id,brief_revision,proposal_id,trip_id,snapshot_hash,request) values(actor,b.id,b.revision,p.id,t,g.snapshot_hash,req) returning * into h;
 for c in select value from jsonb_array_elements(components) loop
  choice=p_details->'components'->(c->>'id');
  if choice->>'target'='accommodation' then
   insert into public.trip_accommodations(trip_id,accommodation_type,name,time_zone,reservation_status,notes,created_by) values(t,'other','Allotjament per concretar',choice->>'time_zone','planning',c->>'description',actor) returning id into target;
   insert into public.trip_proposal_component_links(handoff_id,trip_id,component_id,accommodation_id) values(h.id,t,c->>'id',target);
  elsif choice->>'target'='flight' then
   insert into public.trip_flights(trip_id,flight_status,notes,created_by) values(t,'planning',c->>'description',actor) returning id into target;
   insert into public.trip_proposal_component_links(handoff_id,trip_id,component_id,flight_id) values(h.id,t,c->>'id',target);
  else
   insert into public.trip_activities(trip_id,title,activity_type,reservation_status,notes,created_by) values(t,case when choice->>'target'='transport' then 'Transport per concretar' else 'Activitat per concretar' end,case when choice->>'target'='transport' then 'transport' else 'other' end,'planning',c->>'description',actor) returning id into target;
   insert into public.trip_proposal_component_links(handoff_id,trip_id,component_id,activity_id) values(h.id,t,c->>'id',target);
  end if;
 end loop;
 update public.trip_briefs set trip_id=t,revision=revision+1,updated_at=clock_timestamp() where id=b.id;
 insert into public.trip_handoff_operations values(actor,p_operation_id,h.id,req,clock_timestamp());
 outcome=public.get_trip_handoff_v1(b.id);return outcome||'{"already_formalized":false}'::jsonb;
end $function$
;

CREATE OR REPLACE FUNCTION public.formalize_trip_proposal_v1(p_brief_id uuid, p_expected_brief_revision bigint, p_proposal_id uuid, p_expected_generation_id uuid, p_expected_snapshot_hash text, p_operation_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.trip_proposal_handoffs where brief_id=p_brief_id and owner_id=auth.uid()) then raise exception 'Geographic resolution required; update the application' using errcode='55000';end if;
 return public.formalize_trip_proposal_legacy_v1(p_brief_id,p_expected_brief_revision,p_proposal_id,p_expected_generation_id,p_expected_snapshot_hash,p_operation_id,p_details);
end $function$
;

CREATE OR REPLACE FUNCTION public.formalize_trip_proposal_v2(p_brief_id uuid, p_expected_brief_revision bigint, p_proposal_id uuid, p_expected_generation_id uuid, p_expected_snapshot_hash text, p_operation_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();req jsonb;receipt place_private.handoff_receipts;p public.trip_proposals;g public.proposal_generations;b public.trip_briefs;bind public.place_bindings;v public.place_versions;entry record;c jsonb;leg jsonb;refs jsonb:=p_details->'bindings';versions jsonb:='{}';choices jsonb:='{}';choice jsonb;zone text;main text:=p_details->>'principal_stop_id';legacy jsonb;result jsonb;h uuid;old jsonb;link public.trip_proposal_component_links;own boolean;begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_operation_id is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>65536 or jsonb_typeof(refs)<>'object' or jsonb_typeof(p_details->'components')<>'object' or exists(select 1 from jsonb_object_keys(p_details) k where k not in ('name','start_date','end_date','acknowledge_unresolved','components','bindings','principal_stop_id')) then raise exception 'Invalid details' using errcode='22023';end if;
 req=jsonb_build_object('brief',p_brief_id,'revision',p_expected_brief_revision,'proposal',p_proposal_id,'generation',p_expected_generation_id,'hash',p_expected_snapshot_hash,'details',p_details);
 perform pg_advisory_xact_lock(hashtextextended('geo-handoff:'||actor||p_operation_id,0));
 select * into receipt from place_private.handoff_receipts where owner_id=actor and operation_id=p_operation_id;
 if found then if receipt.request<>req then raise exception 'Operation reused' using errcode='22023';end if;return receipt.result||'{"replayed":true}'::jsonb;end if;
 select * into b from public.trip_briefs where id=p_brief_id and owner_id=actor for update;
 if b.id is null then raise exception 'Unavailable' using errcode='42501';end if;
 select x.* into p from public.trip_proposals x join public.proposal_generations y on y.id=x.generation_id where x.id=p_proposal_id and y.brief_id=b.id and y.owner_id=actor;
 if p.id is null then raise exception 'Unavailable' using errcode='42501';end if;
 select * into g from public.proposal_generations where id=p.generation_id;
 if g.id<>p_expected_generation_id or g.brief_revision<>p_expected_brief_revision or g.snapshot_hash<>p_expected_snapshot_hash then raise exception 'Snapshot changed' using errcode='40001';end if;
 select x.handoff_id into h from public.trip_place_snapshots x join public.trip_proposal_handoffs y on y.id=x.handoff_id where y.brief_id=b.id;
 if h is not null then
 select hr.request into old from place_private.handoff_receipts hr where hr.result->>'handoff_id'=h::text limit 1;
 if old<>req then raise exception 'Formalization changed' using errcode='40001';end if;
 result=public.get_trip_handoff_v1(b.id);insert into place_private.handoff_receipts values(actor,p_operation_id,req,result);return result;
 end if;
 if b.revision<>p_expected_brief_revision or b.trip_id is not null then raise exception 'Brief changed' using errcode='40001';end if;
 if not exists(select 1 from jsonb_array_elements(p.document#>'{candidate,route,stops}') s where s->>'id'=main) then raise exception 'Select principal base' using errcode='22023';end if;
 for entry in select * from jsonb_each_text(refs) loop
 select * into bind from public.place_bindings where id=entry.value::uuid and owner_id=actor and proposal_id=p.id and brief_id=b.id and subject_key=entry.key and state='resolved';
 if bind.id is null or exists(select 1 from public.place_bindings x where x.owner_id=actor and x.proposal_id=p.id and x.subject_key=entry.key and x.revision>bind.revision) then raise exception 'Binding unavailable or stale' using errcode='40001';end if;
 select * into v from public.place_versions where id=bind.place_version_id;
 if v.timezone_status<>'verified' or bind.created_at<now()-make_interval(days=>(select fresh_days from place_private.settings)) then raise exception 'Location needs verification' using errcode='22023';end if;
 versions=versions||jsonb_build_object(entry.key,to_jsonb(v));
 end loop;
 for c in select * from jsonb_array_elements(p.document#>'{candidate,route,stops}') loop
 if not versions ? (c->>'id') then raise exception 'Resolve every base' using errcode='22023';end if;
 end loop;
 for c in select * from jsonb_array_elements(p.document#>'{candidate,components}') loop
 choice=p_details#>array['components',c->>'id'];
 if choice is null or exists(select 1 from jsonb_object_keys(choice) k where k<>'target') then raise exception 'Invalid component choice' using errcode='22023';end if;
 zone=coalesce(versions#>>array[c->>'id','timezone'],versions#>>array[c->>'subject_id','timezone']);
 if c->>'kind'='accommodation' and zone is null then raise exception 'Resolve accommodation location' using errcode='22023';end if;
 choices=choices||jsonb_build_object(c->>'id',jsonb_build_object('target',choice->>'target','time_zone',case when c->>'kind'='accommodation' then zone else null end));
 end loop;
 if (select count(*) from jsonb_object_keys(p_details->'components'))<>jsonb_array_length(p.document#>'{candidate,components}') then raise exception 'Invalid component coverage' using errcode='22023';end if;
 legacy=jsonb_build_object('name',p_details->'name','start_date',p_details->'start_date','end_date',p_details->'end_date','acknowledge_unresolved',p_details->'acknowledge_unresolved','time_zone',versions#>>array[main,'timezone'],'components',choices);
 result=public.formalize_trip_proposal_legacy_v1(p_brief_id,p_expected_brief_revision,p_proposal_id,p_expected_generation_id,p_expected_snapshot_hash,p_operation_id,legacy);
 h=(result->>'handoff_id')::uuid;
 insert into public.trip_place_snapshots values(h,(refs->>main)::uuid,jsonb_build_object('binding_ids',refs,'versions',versions,'principal_stop_id',main));
 for link in select * from public.trip_proposal_component_links where handoff_id=h loop
 select x into c from jsonb_array_elements(p.document#>'{candidate,components}') x where x->>'id'=link.component_id;
 own=versions ? link.component_id;zone=coalesce(versions#>>array[link.component_id,'timezone'],versions#>>array[c->>'subject_id','timezone']);
 if link.activity_id is not null and c->>'kind'='experience' then update public.trip_activities set time_zone=zone where id=link.activity_id;end if;
 if own and versions#>>array[link.component_id,'coordinate_role']='exact_location' then
 if link.accommodation_id is not null then update public.trip_accommodations set latitude=(versions#>>array[link.component_id,'latitude'])::float8,longitude=(versions#>>array[link.component_id,'longitude'])::float8 where id=link.accommodation_id;
 elsif link.activity_id is not null then update public.trip_activities set latitude=(versions#>>array[link.component_id,'latitude'])::float8,longitude=(versions#>>array[link.component_id,'longitude'])::float8 where id=link.activity_id;end if;
 end if;
 if link.flight_id is not null then
 select x into leg from jsonb_array_elements(p.document#>'{candidate,route,legs}') x where x->>'id'=c->>'subject_id';
 if leg is not null then update public.trip_flights set departure_time_zone=versions#>>array[leg->>'from_stop_id','timezone'],arrival_time_zone=versions#>>array[leg->>'to_stop_id','timezone'] where id=link.flight_id;end if;
 end if;
 end loop;
 insert into place_private.handoff_receipts values(actor,p_operation_id,req,result);return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.get_my_trip()
 RETURNS TABLE(id uuid, name text, invite_code text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, t.name, t.invite_code
  from public.trips t
  join public.trip_members m on m.trip_id = t.id
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_trips()
 RETURNS TABLE(id uuid, name text, invite_code text, owner_id uuid, start_date date, end_date date, time_zone text, experience_key text, is_owner boolean, member_since timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select trip.id,trip.name,trip.invite_code,trip.owner_id,trip.start_date,trip.end_date,trip.time_zone,trip.experience_key,
    trip.owner_id=auth.uid() as is_owner,membership.created_at as member_since
  from public.trip_members membership
  join public.trips trip on trip.id=membership.trip_id
  where membership.user_id=auth.uid() and trip.discarded_at is null
  order by membership.created_at,trip.id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_place_bindings_v1(p_subject jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform place_private.subject(auth.uid(),p_subject);
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select distinct on (b.subject_key) b.*,to_jsonb(v) place,(b.proposal_id is not null or b.subject_snapshot=(select document#>array['decisions',split_part(b.subject_key,':',1)] from public.trip_briefs where id=b.brief_id)) subject_current from public.place_bindings b left join public.place_versions v on v.id=b.place_version_id where b.owner_id=auth.uid() and b.brief_id=(p_subject->>'brief_id')::uuid and b.proposal_id is not distinct from (p_subject->>'proposal_id')::uuid order by b.subject_key,b.revision desc)x),'[]');
end $function$
;

CREATE OR REPLACE FUNCTION public.get_proposals_v1(p_brief uuid, p_generation uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.proposal_generations;b public.trip_briefs;current_id uuid;begin
 select * into b from public.trip_briefs where id=p_brief and owner_id=auth.uid();
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 select id into current_id from public.proposal_generations where brief_id=b.id and owner_id=auth.uid() order by round_number desc nulls last,created_at desc,id desc limit 1;
 select * into g from public.proposal_generations where brief_id=b.id and owner_id=auth.uid() and id=coalesce(p_generation,current_id);
 if not found then
  if p_generation is not null then raise exception 'Generation unavailable' using errcode='42501';end if;
  return jsonb_build_object('generation',null,'proposals','[]'::jsonb,'brief_revision',b.revision,'stale',false,'current_generation_id',null,'historical',false);
 end if;
 return jsonb_build_object('generation',(to_jsonb(g)-'brief_snapshot'-'attempt_token'-'excluded_routes')||jsonb_build_object('round_number',proposal_private.round_number(g)),'brief_revision',b.revision,'stale',b.revision<>g.brief_revision,'current_generation_id',current_id,'historical',g.id<>current_id,'proposals',coalesce((select jsonb_agg(to_jsonb(p) order by position) from public.trip_proposals p where generation_id=g.id),'[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION public.get_travel_book_ingestion_v1(p_trip_id uuid, p_book_id uuid, p_asset_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.get_travel_book_ingestion_v1(p_trip_id,p_book_id,p_asset_id) $function$
;

CREATE OR REPLACE FUNCTION public.get_travel_book_operation_v1(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.get_travel_book_operation_v1(p_operation_id) $function$
;

CREATE OR REPLACE FUNCTION public.get_trip_budget_v1(p_trip_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare settings jsonb; currencies jsonb; unknown_components integer; total_components integer; unknown_required integer;
begin
  if auth.uid() is null or not public.is_trip_member(p_trip_id) then raise exception 'Trip unavailable' using errcode='42501'; end if;

  select case when b.trip_id is null then null else jsonb_build_object('target_amount',b.target_amount,'maximum_amount',b.maximum_amount,'currency',b.currency,'revision',b.revision,'updated_at',b.updated_at) end
  into settings from (select p_trip_id as trip_id) x left join public.trip_budget_settings b on b.trip_id=x.trip_id;

  with components as (
    select trip_id,component_id from public.trip_proposal_component_links where trip_id=p_trip_id
    union
    select trip_id,component_id from public.trip_standalone_component_links where trip_id=p_trip_id
  ), priced as (
    select x.component_id,c.currency,c.expected_amount,c.confirmed_amount,c.unknown_required_costs,coalesce(c.confirmed_amount,c.expected_amount) effective_amount
    from components x
    left join public.trip_component_costs c on c.trip_id=x.trip_id and c.component_id=x.component_id
  )
  select count(*)::int,count(*) filter(where effective_amount is null)::int,
         coalesce(sum(case when unknown_required_costs is null then 0 else jsonb_array_length(unknown_required_costs) end),0)::int
  into total_components,unknown_components,unknown_required from priced;

  with components as (
    select trip_id,component_id from public.trip_proposal_component_links where trip_id=p_trip_id
    union
    select trip_id,component_id from public.trip_standalone_component_links where trip_id=p_trip_id
  ), priced as (
    select c.currency,c.expected_amount,c.confirmed_amount,coalesce(c.confirmed_amount,c.expected_amount) effective_amount,(c.confirmed_amount is not null) is_confirmed
    from components x
    join public.trip_component_costs c on c.trip_id=x.trip_id and c.component_id=x.component_id
    where coalesce(c.confirmed_amount,c.expected_amount) is not null
  ), grouped as (
    select currency,round(sum(effective_amount),2) total,
           round(coalesce(sum(effective_amount) filter(where is_confirmed),0),2) confirmed_total,
           round(coalesce(sum(effective_amount) filter(where not is_confirmed),0),2) expected_total,
           count(*)::int priced_components,
           count(*) filter(where confirmed_amount is not null)::int confirmed_components,
           count(*) filter(where confirmed_amount is null and expected_amount is not null)::int expected_components
    from priced group by currency
  )
  select coalesce(jsonb_agg(to_jsonb(grouped) order by currency),'[]'::jsonb) into currencies from grouped;

  return jsonb_build_object('trip_id',p_trip_id,'settings',settings,'currencies',coalesce(currencies,'[]'::jsonb),'total_components',coalesce(total_components,0),'unknown_components',coalesce(unknown_components,0),'unknown_required_costs',coalesce(unknown_required,0),'provisional',coalesce(unknown_components,0)>0 or coalesce(unknown_required,0)>0);
end $function$
;

CREATE OR REPLACE FUNCTION public.get_trip_handoff_v1(p_brief_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h public.trip_proposal_handoffs;begin
 if auth.uid() is null or not exists(select 1 from public.trip_briefs where id=p_brief_id and owner_id=auth.uid()) then raise exception 'Unavailable' using errcode='42501';end if;
 select * into h from public.trip_proposal_handoffs where brief_id=p_brief_id and owner_id=auth.uid();
 if not found then return null;end if;
 if not exists(select 1 from public.trip_briefs b where b.id=h.brief_id and b.trip_id=h.trip_id and b.revision=h.brief_revision+1) or (select count(*) from public.trip_proposal_component_links where handoff_id=h.id)<>(select jsonb_array_length(document#>'{candidate,components}') from public.trip_proposals where id=h.proposal_id) then raise exception 'Incomplete handoff' using errcode='23514';end if;
 return jsonb_build_object('handoff_id',h.id,'trip_id',h.trip_id,'brief_revision',h.brief_revision+1,'component_links',coalesce((select jsonb_agg(to_jsonb(l) order by component_id) from public.trip_proposal_component_links l where handoff_id=h.id),'[]'::jsonb),'already_formalized',true,'replayed',false);
end $function$
;

CREATE OR REPLACE FUNCTION public.initialize_generic_trip_checklist(p_trip_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  authenticated_user_id uuid := auth.uid();
  target_experience_key text;
  inserted_count integer;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.trip_members as membership
    where membership.trip_id = p_trip_id
      and membership.user_id = authenticated_user_id
  ) then
    raise exception 'No formes part d’aquest viatge'
      using errcode = '42501';
  end if;

  select trip.experience_key
  into target_experience_key
  from public.trips as trip
  where trip.id = p_trip_id;

  if target_experience_key = 'london-2026' then
    return 0;
  end if;

  insert into public.checklist_items (
    trip_id,
    text,
    category,
    template_key,
    created_by
  )
  values
    (p_trip_id,'Revisar documentació personal necessària','documents','universal-documents-review-personal',authenticated_user_id),
    (p_trip_id,'Guardar còpies dels documents importants','documents','universal-documents-save-copies',authenticated_user_id),
    (p_trip_id,'Preparar l''equipatge','luggage','universal-luggage-prepare',authenticated_user_id),
    (p_trip_id,'Revisar les restriccions d''equipatge','luggage','universal-luggage-review-restrictions',authenticated_user_id),
    (p_trip_id,'Preparar medicació personal necessària','health','universal-health-prepare-medication',authenticated_user_id),
    (p_trip_id,'Revisar targetes i mitjans de pagament','money','universal-money-review-payment-methods',authenticated_user_id),
    (p_trip_id,'Preparar mòbil, carregadors i adaptadors necessaris','technology','universal-technology-prepare-devices',authenticated_user_id),
    (p_trip_id,'Revisar les reserves de transport','transport','universal-transport-review-bookings',authenticated_user_id),
    (p_trip_id,'Revisar les reserves del viatge','reservations','universal-reservations-review-trip',authenticated_user_id),
    (p_trip_id,'Deixar la casa preparada abans de marxar','home','universal-home-prepare-before-leaving',authenticated_user_id)
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_trip_member(p_trip_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1
    from public.trip_members membership
    join public.trips trip on trip.id=membership.trip_id
    where membership.trip_id=p_trip_id
      and membership.user_id=auth.uid()
      and trip.discarded_at is null
  );
$function$
;

CREATE OR REPLACE FUNCTION public.join_trip(p_invite_code text)
 RETURNS TABLE(id uuid, name text, invite_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trip public.trips;
begin
  if auth.uid() is null then
    raise exception 'Cal iniciar sessió';
  end if;

  if trim(coalesce(p_invite_code, '')) = '' then
    raise exception 'Escriu el codi d’invitació';
  end if;

  if exists (
    select 1
    from public.trip_members m
    where m.user_id = auth.uid()
  ) then
    raise exception 'Ja formes part d’un viatge';
  end if;

  select t.*
  into v_trip
  from public.trips t
  where t.invite_code = upper(trim(p_invite_code));

  if v_trip.id is null then
    raise exception 'Codi incorrecte';
  end if;

  insert into public.trip_members (trip_id, user_id)
  values (v_trip.id, auth.uid());

  return query
  select v_trip.id, v_trip.name, v_trip.invite_code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.join_trip_v2(p_invite_code text)
 RETURNS TABLE(id uuid, name text, invite_code text, owner_id uuid, start_date date, end_date date, time_zone text, experience_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  authenticated_user_id uuid := auth.uid();
  normalized_invite_code text := upper(btrim(p_invite_code));
  joined_trip public.trips%rowtype;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió';
  end if;

  if normalized_invite_code is null or normalized_invite_code = '' then
    raise exception 'Escriu un codi d’invitació';
  end if;

  select trip.*
  into joined_trip
  from public.trips as trip
  where trip.invite_code = normalized_invite_code;

  if joined_trip.id is null then
    raise exception 'Codi incorrecte';
  end if;

  insert into public.trip_members (trip_id, user_id)
  values (joined_trip.id, authenticated_user_id)
  on conflict (trip_id, user_id) do nothing;

  return query
  select
    joined_trip.id,
    joined_trip.name,
    joined_trip.invite_code,
    joined_trip.owner_id,
    joined_trip.start_date,
    joined_trip.end_date,
    joined_trip.time_zone,
    joined_trip.experience_key;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_proposal_history_v1(p_brief uuid, p_before bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.trip_briefs where id=p_brief and owner_id=auth.uid()) then raise exception 'Brief unavailable' using errcode='42501';end if;
 return (select jsonb_build_object('rounds',coalesce(jsonb_agg(to_jsonb(r) order by round_number desc),'[]'::jsonb),'next_before',case when count(*)=10 then min(round_number) else null end) from (
 select g.id,proposal_private.round_number(g) as round_number,g.status,g.created_at,g.brief_revision,(select count(*) from public.trip_proposals p where p.generation_id=g.id) as proposal_count
 from public.proposal_generations g where g.brief_id=p_brief and g.owner_id=auth.uid() and (p_before is null or proposal_private.round_number(g)<p_before) order by proposal_private.round_number(g) desc limit 10) r);
end $function$
;

CREATE OR REPLACE FUNCTION public.protect_contextual_photo_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (new.trip_id,new.id,new.category) is distinct from (old.trip_id,old.id,old.category)
     and exists(select 1 from public.trip_photo_metadata where document_id=old.id) then
    raise exception 'Una foto contextual no es pot moure ni reclassificar' using errcode='22023';
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.request_proposals_v1(p_owner uuid, p_brief uuid, p_revision bigint, p_operation uuid, p_generator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.trip_briefs;g public.proposal_generations;r public.proposal_operations;req jsonb;
begin
 if p_owner is null or p_operation is null or p_revision is null or p_revision<1 or p_generator is null or length(p_generator) not between 1 and 200 then raise exception 'Invalid request' using errcode='22023';end if;
 req=jsonb_build_object('brief',p_brief,'revision',p_revision,'generator',p_generator);
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_operation::text,0));
 select * into r from public.proposal_operations where owner_id=p_owner and operation_id=p_operation;
 if found then
  if r.action<>'generate' or r.request<>req then raise exception 'Operation reused' using errcode='22023';end if;
  select * into g from public.proposal_generations where id=r.generation_id;return to_jsonb(g);
 end if;
 select * into b from public.trip_briefs where id=p_brief and owner_id=p_owner for update;
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 if b.revision<>p_revision then raise exception 'Brief changed' using errcode='40001';end if;
 insert into public.proposal_generations(owner_id,brief_id,brief_revision,brief_schema_version,brief_snapshot,snapshot_hash,engine_version,generator_version,verifier_version,policy_version)
 values(p_owner,b.id,b.revision,b.schema_version,b.document,encode(sha256(convert_to(b.document::text,'UTF8')),'hex'),'tb04-engine-v1',p_generator,'no-factual-source-v1','tb04-policy-v1') on conflict do nothing;
 select * into g from public.proposal_generations where brief_id=b.id and brief_revision=b.revision and engine_version='tb04-engine-v1' and generator_version=p_generator and verifier_version='no-factual-source-v1' and policy_version='tb04-policy-v1' and previous_generation_id is null;
 insert into public.proposal_operations values(p_owner,p_operation,'generate',req,g.id,now());
 return to_jsonb(g);
end $function$
;

CREATE OR REPLACE FUNCTION public.request_travel_book_photo_v1(p_trip_id uuid, p_book_id uuid, p_document_id uuid, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.request_travel_book_photo_v1(p_trip_id,p_book_id,p_document_id,p_operation_id) $function$
;

CREATE OR REPLACE FUNCTION public.retry_proposals_v1(p_owner uuid, p_generation uuid, p_operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.proposal_generations;r public.proposal_operations;req jsonb:=jsonb_build_object('generation',p_generation);
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_operation::text,0));
 select * into r from public.proposal_operations where owner_id=p_owner and operation_id=p_operation;
 if found then
  if r.action<>'retry' or r.request<>req then raise exception 'Operation reused' using errcode='22023';end if;
  select * into g from public.proposal_generations where id=r.generation_id;return to_jsonb(g);
 end if;
 select * into g from public.proposal_generations where id=p_generation and owner_id=p_owner for update;
 if not found then raise exception 'Generation unavailable' using errcode='42501';end if;
 if g.status='failed' then update public.proposal_generations set status='pending',error_code=null,finished_at=null,updated_at=now() where id=g.id returning * into g;end if;
 insert into public.proposal_operations values(p_owner,p_operation,'retry',req,g.id,now());return to_jsonb(g);
end $function$
;

CREATE OR REPLACE FUNCTION public.save_travel_book_compositions_v1(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select app_private.save_travel_book_compositions_v1(p_trip_id,p_book_id,p_edition_id,p_operation_id,p_changes) $function$
;

CREATE OR REPLACE FUNCTION public.set_trip_budget_settings_v1(p_trip_id uuid, p_expected_revision bigint, p_operation_id uuid, p_target_amount numeric DEFAULT NULL::numeric, p_maximum_amount numeric DEFAULT NULL::numeric, p_currency text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  existing public.trip_budget_settings;
  receipt public.trip_budget_setting_operations;
  normalized_currency text := nullif(upper(trim(p_currency)), '');
  req jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_trip_id is null or p_expected_revision is null or p_expected_revision < 0 or p_operation_id is null then raise exception 'Invalid budget request' using errcode='22023'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception 'Trip unavailable' using errcode='42501'; end if;
  if p_target_amount is not null and p_target_amount < 0 then raise exception 'Target amount must be non-negative' using errcode='22023'; end if;
  if p_maximum_amount is not null and p_maximum_amount < 0 then raise exception 'Maximum amount must be non-negative' using errcode='22023'; end if;
  if p_target_amount is not null and p_maximum_amount is not null and p_maximum_amount < p_target_amount then raise exception 'Maximum budget cannot be below target' using errcode='22023'; end if;
  if (p_target_amount is not null or p_maximum_amount is not null) and (normalized_currency is null or normalized_currency !~ '^[A-Z]{3}$') then raise exception 'Budget currency required' using errcode='22023'; end if;
  if p_target_amount is null and p_maximum_amount is null then normalized_currency:=null; end if;

  req:=jsonb_build_object('trip_id',p_trip_id,'expected_revision',p_expected_revision,'target_amount',p_target_amount,'maximum_amount',p_maximum_amount,'currency',normalized_currency);
  perform pg_advisory_xact_lock(hashtextextended('tb06-budget:'||actor::text||':'||p_operation_id::text,0));
  select * into receipt from public.trip_budget_setting_operations where actor_id=actor and operation_id=p_operation_id;
  if found then
    if receipt.request is distinct from req then raise exception 'Operation reused with different request' using errcode='22023'; end if;
    select * into existing from public.trip_budget_settings where trip_id=receipt.trip_id;
    return jsonb_build_object('trip_id',existing.trip_id,'target_amount',existing.target_amount,'maximum_amount',existing.maximum_amount,'currency',existing.currency,'revision',existing.revision,'updated_at',existing.updated_at,'replayed',true);
  end if;

  select * into existing from public.trip_budget_settings where trip_id=p_trip_id for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'Budget version conflict' using errcode='40001'; end if;
    insert into public.trip_budget_settings(trip_id,target_amount,maximum_amount,currency,revision,updated_by)
    values(p_trip_id,p_target_amount,p_maximum_amount,normalized_currency,1,actor)
    returning * into existing;
  else
    if existing.revision <> p_expected_revision then raise exception 'Budget version conflict' using errcode='40001'; end if;
    update public.trip_budget_settings set
      target_amount=p_target_amount,maximum_amount=p_maximum_amount,currency=normalized_currency,
      revision=existing.revision+1,updated_by=actor,updated_at=now()
    where trip_id=p_trip_id returning * into existing;
  end if;

  insert into public.trip_budget_setting_operations(actor_id,operation_id,trip_id,request,result_revision)
  values(actor,p_operation_id,p_trip_id,req,existing.revision);

  return jsonb_build_object('trip_id',existing.trip_id,'target_amount',existing.target_amount,'maximum_amount',existing.maximum_amount,'currency',existing.currency,'revision',existing.revision,'updated_at',existing.updated_at,'replayed',false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_trip_component_cost_v1(p_trip_id uuid, p_component_id text, p_expected_revision bigint, p_operation_id uuid, p_expected_amount numeric DEFAULT NULL::numeric, p_confirmed_amount numeric DEFAULT NULL::numeric, p_currency text DEFAULT NULL::text, p_expected_quality text DEFAULT 'unknown'::text, p_verified_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scope jsonb DEFAULT '{}'::jsonb, p_unknown_required_costs jsonb DEFAULT '[]'::jsonb, p_excluded_costs jsonb DEFAULT '[]'::jsonb, p_evidence_document_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  l public.trip_proposal_component_links;
  s public.trip_standalone_component_links;
  existing public.trip_component_costs;
  receipt public.trip_component_cost_operations;
  req jsonb;
  normalized_currency text := nullif(upper(trim(p_currency)), '');
  source_kind text;
  source_id uuid;
  source_handoff_id uuid;
  next_revision bigint;
  effective_amount numeric;
  source_updated_at timestamptz;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_trip_id is null or p_component_id is null or p_component_id !~ '^[a-z][a-z0-9_-]{0,63}$' or p_expected_revision is null or p_expected_revision < 0 or p_operation_id is null then raise exception 'Invalid cost request' using errcode='22023'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception 'Trip unavailable' using errcode='42501'; end if;
  if p_expected_amount is not null and p_expected_amount < 0 then raise exception 'Expected amount must be non-negative' using errcode='22023'; end if;
  if p_confirmed_amount is not null and p_confirmed_amount < 0 then raise exception 'Confirmed amount must be non-negative' using errcode='22023'; end if;
  if normalized_currency is not null and normalized_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a 3-letter code' using errcode='22023'; end if;
  if (p_expected_amount is not null or p_confirmed_amount is not null) and normalized_currency is null then raise exception 'Currency required for priced component' using errcode='22023'; end if;
  if p_expected_amount is null then
    if p_expected_quality <> 'unknown' or p_verified_at is not null then raise exception 'Unknown expected price cannot be verified' using errcode='22023'; end if;
  elsif p_expected_quality = 'estimated' then
    if p_verified_at is not null then raise exception 'Estimated price cannot have verification time' using errcode='22023'; end if;
  elsif p_expected_quality = 'verified' then
    if p_verified_at is null then raise exception 'Verified price requires verification time' using errcode='22023'; end if;
  else raise exception 'Invalid expected price quality' using errcode='22023'; end if;
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' or octet_length(p_scope::text) > 4096 then raise exception 'Invalid price scope' using errcode='22023'; end if;
  if p_unknown_required_costs is null or jsonb_typeof(p_unknown_required_costs) <> 'array' or jsonb_array_length(p_unknown_required_costs) > 20 then raise exception 'Invalid unknown required costs' using errcode='22023'; end if;
  if p_excluded_costs is null or jsonb_typeof(p_excluded_costs) <> 'array' or jsonb_array_length(p_excluded_costs) > 20 then raise exception 'Invalid excluded costs' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_unknown_required_costs) v where jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 200) then raise exception 'Invalid unknown required cost item' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_excluded_costs) v where jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 200) then raise exception 'Invalid excluded cost item' using errcode='22023'; end if;
  if p_evidence_document_id is not null and not exists(select 1 from public.travel_documents d where d.trip_id=p_trip_id and d.id=p_evidence_document_id) then raise exception 'Cost evidence must belong to this trip' using errcode='23503'; end if;

  select * into l from public.trip_proposal_component_links where trip_id=p_trip_id and component_id=p_component_id limit 1;
  if found then
    source_handoff_id:=l.handoff_id;
    if l.accommodation_id is not null then source_kind:='accommodation'; source_id:=l.accommodation_id;
    elsif l.flight_id is not null then source_kind:='flight'; source_id:=l.flight_id;
    else source_kind:='activity'; source_id:=l.activity_id; end if;
  else
    select * into s from public.trip_standalone_component_links where trip_id=p_trip_id and component_id=p_component_id;
    if not found then raise exception 'Budget component unavailable' using errcode='P0002'; end if;
    source_handoff_id:=null;
    source_kind:=s.source_kind;
    source_id:=s.source_id;
  end if;

  req := jsonb_build_object('trip_id',p_trip_id,'component_id',p_component_id,'expected_revision',p_expected_revision,'expected_amount',p_expected_amount,'confirmed_amount',p_confirmed_amount,'currency',normalized_currency,'expected_quality',p_expected_quality,'verified_at',p_verified_at,'scope',p_scope,'unknown_required_costs',p_unknown_required_costs,'excluded_costs',p_excluded_costs,'evidence_document_id',p_evidence_document_id);
  perform pg_advisory_xact_lock(hashtextextended('tb06-cost:'||actor::text||':'||p_operation_id::text,0));
  select * into receipt from public.trip_component_cost_operations where actor_id=actor and operation_id=p_operation_id;
  if found then
    if receipt.request is distinct from req then raise exception 'Operation reused with different request' using errcode='22023'; end if;
    select * into existing from public.trip_component_costs where trip_id=receipt.trip_id and component_id=receipt.component_id;
    return jsonb_build_object('trip_id',existing.trip_id,'component_id',existing.component_id,'source_kind',existing.source_kind,'source_id',existing.source_id,'expected_amount',existing.expected_amount,'confirmed_amount',existing.confirmed_amount,'currency',existing.currency,'expected_quality',existing.expected_quality,'verified_at',existing.verified_at,'confirmed_at',existing.confirmed_at,'scope',existing.scope,'unknown_required_costs',existing.unknown_required_costs,'excluded_costs',existing.excluded_costs,'evidence_document_id',existing.evidence_document_id,'revision',existing.revision,'updated_at',existing.updated_at,'replayed',true);
  end if;

  select * into existing from public.trip_component_costs where trip_id=p_trip_id and component_id=p_component_id for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'Cost version conflict' using errcode='40001'; end if;
    insert into public.trip_component_costs(trip_id,component_id,handoff_id,source_kind,source_id,expected_amount,confirmed_amount,currency,expected_quality,verified_at,confirmed_at,scope,unknown_required_costs,excluded_costs,evidence_document_id,revision,updated_by)
    values(p_trip_id,p_component_id,source_handoff_id,source_kind,source_id,p_expected_amount,p_confirmed_amount,normalized_currency,p_expected_quality,p_verified_at,case when p_confirmed_amount is null then null else now() end,p_scope,p_unknown_required_costs,p_excluded_costs,p_evidence_document_id,1,actor)
    returning * into existing;
  else
    if existing.revision <> p_expected_revision then raise exception 'Cost version conflict' using errcode='40001'; end if;
    if existing.handoff_id is distinct from source_handoff_id or existing.source_kind <> source_kind or existing.source_id <> source_id then raise exception 'Component cost identity conflict' using errcode='23503'; end if;
    next_revision:=existing.revision+1;
    update public.trip_component_costs set expected_amount=p_expected_amount,confirmed_amount=p_confirmed_amount,currency=normalized_currency,expected_quality=p_expected_quality,verified_at=p_verified_at,confirmed_at=case when p_confirmed_amount is null then null when existing.confirmed_amount is distinct from p_confirmed_amount then now() else existing.confirmed_at end,scope=p_scope,unknown_required_costs=p_unknown_required_costs,excluded_costs=p_excluded_costs,evidence_document_id=p_evidence_document_id,revision=next_revision,updated_by=actor,updated_at=now()
    where trip_id=p_trip_id and component_id=p_component_id returning * into existing;
  end if;

  effective_amount:=coalesce(existing.confirmed_amount,existing.expected_amount);
  if source_kind='activity' then
    update public.trip_activities set amount=effective_amount,currency=case when effective_amount is null then null else existing.currency end
    where trip_id=p_trip_id and id=source_id returning updated_at into source_updated_at;
  end if;

  insert into public.trip_component_cost_operations(actor_id,operation_id,trip_id,component_id,request,result_revision) values(actor,p_operation_id,p_trip_id,p_component_id,req,existing.revision);
  return jsonb_build_object('trip_id',existing.trip_id,'component_id',existing.component_id,'source_kind',existing.source_kind,'source_id',existing.source_id,'expected_amount',existing.expected_amount,'confirmed_amount',existing.confirmed_amount,'currency',existing.currency,'expected_quality',existing.expected_quality,'verified_at',existing.verified_at,'confirmed_at',existing.confirmed_at,'scope',existing.scope,'unknown_required_costs',existing.unknown_required_costs,'excluded_costs',existing.excluded_costs,'evidence_document_id',existing.evidence_document_id,'revision',existing.revision,'updated_at',existing.updated_at,'source_updated_at',source_updated_at,'replayed',false);
end $function$
;

CREATE OR REPLACE FUNCTION public.set_trip_event_completed(p_trip_id uuid, p_source_type text, p_source_id uuid, p_source_event text, p_completed boolean, p_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  table_name text;
  progress_column text;
  current_row jsonb;
  current_completed boolean;
  cancelled boolean;
begin
  if auth.uid() is null or not public.is_trip_member(p_trip_id)
     or not exists (select 1 from public.trips t where t.id=p_trip_id and t.experience_key is distinct from 'london-2026') then
    raise exception 'No tens acces al progres d aquest viatge' using errcode='42501';
  end if;
  if p_completed is null or p_expected_updated_at is null or p_source_id is null then
    raise exception 'Falten el valor explicit o la versio esperada' using errcode='22023';
  end if;
  case
    when p_source_type='activity' and p_source_event='start' then table_name:='trip_activities';progress_column:='completed_at';
    when p_source_type='flight' and p_source_event='departure' then table_name:='trip_flights';progress_column:='completed_at';
    when p_source_type='accommodation' and p_source_event='check_in' then table_name:='trip_accommodations';progress_column:='check_in_completed_at';
    when p_source_type='accommodation' and p_source_event='check_out' then table_name:='trip_accommodations';progress_column:='check_out_completed_at';
    when p_source_type='manual' and p_source_event='manual' then table_name:='trip_itinerary_items';progress_column:='status';
    else raise exception 'Font o esdeveniment no admès' using errcode='22023';
  end case;
  -- Identifiers come exclusively from the closed mapping above, never the caller.
  execute format('select to_jsonb(s) from public.%I s where s.trip_id=$1 and s.id=$2 for update',table_name)
    into current_row using p_trip_id,p_source_id;
  if current_row is null then raise exception 'L element ja no existeix o no es accessible' using errcode='P0002'; end if;
  current_completed := case when progress_column='status' then current_row->>'status'='completed' else current_row->>progress_column is not null end;
  cancelled := coalesce(current_row->>'reservation_status',current_row->>'flight_status',current_row->>'status')='cancelled';
  if p_completed and cancelled then raise exception 'Un element cancellat no es pot marcar fet' using errcode='22023'; end if;
  -- Same desired state is idempotent, even after another member already set it.
  -- A stale opposing command must never silently overwrite the latest state.
  if current_completed is distinct from p_completed then
    if (current_row->>'updated_at')::timestamptz is distinct from p_expected_updated_at then
      raise exception 'Conflicte: el registre ha canviat. Recarrega abans de tornar-ho a provar.' using errcode='40001';
    end if;
    if progress_column='status' then
      execute format('update public.%I s set status=$3 where s.trip_id=$1 and s.id=$2 returning to_jsonb(s)',table_name)
        into current_row using p_trip_id,p_source_id,case when p_completed then 'completed' else 'planned' end;
    else
      execute format('update public.%I s set %I=$3 where s.trip_id=$1 and s.id=$2 returning to_jsonb(s)',table_name,progress_column)
        into current_row using p_trip_id,p_source_id,case when p_completed then clock_timestamp() else null::timestamptz end;
    end if;
    if current_row is null then raise exception 'No s ha pogut actualitzar el registre' using errcode='42501'; end if;
  end if;
  return jsonb_build_object('trip_id',p_trip_id,'source_type',p_source_type,'source_id',p_source_id,'source_event',p_source_event,
    'is_completed',case when progress_column='status' then current_row->>'status'='completed' else current_row->>progress_column is not null end,
    'completed_at',case when progress_column='status' then null else current_row->>progress_column end,
    'updated_at',current_row->>'updated_at','row',current_row);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_trip_flight_document_link(p_trip_id uuid, p_flight_id uuid, p_document_role text, p_document_id uuid, p_expected_flight_updated_at timestamp with time zone, p_linked boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_flight_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio' using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_flight_id is null
     or p_document_role is null
     or p_document_id is null
     or p_expected_flight_updated_at is null
     or p_linked is null then
    raise exception 'Falten dades per modificar el document del vol'
      using errcode = '22004';
  end if;

  if p_document_role not in ('boarding_pass', 'baggage_tag') then
    raise exception 'Aquest rol documental no admet aquesta operacio'
      using errcode = '22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge' using errcode = '42501';
  end if;

  select flight.updated_at
  into v_flight_updated_at
  from public.trip_flights as flight
  where flight.trip_id = p_trip_id
    and flight.id = p_flight_id
  for update;

  if not found then
    raise exception 'El vol ja no existeix' using errcode = 'P0002';
  end if;

  if v_flight_updated_at is distinct from p_expected_flight_updated_at then
    raise exception 'Conflicte de versio del vol' using errcode = '40001';
  end if;

  if p_linked then
    if not exists (
      select 1
      from public.travel_documents as document
      where document.trip_id = p_trip_id
        and document.id = p_document_id
    ) then
      raise exception 'El document no pertany al viatge actiu' using errcode = '23503';
    end if;

    insert into public.trip_flight_documents (
      trip_id, flight_id, document_id, document_role, created_by
    ) values (
      p_trip_id, p_flight_id, p_document_id, p_document_role, v_user_id
    )
    on conflict (trip_id, flight_id, document_role, document_id) do nothing;
  else
    delete from public.trip_flight_documents
    where trip_id = p_trip_id
      and flight_id = p_flight_id
      and document_role = p_document_role
      and document_id = p_document_id;
  end if;

  return p_linked;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_trip_photo_context(p_trip_id uuid, p_document_id uuid, p_expected_updated_at timestamp with time zone, p_local_date date, p_activity_id uuid, p_itinerary_item_id uuid)
 RETURNS trip_photo_metadata
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.trip_photo_metadata;
begin
  if auth.uid() is null or not public.is_trip_member(p_trip_id) or not exists
    (select 1 from public.trips where id=p_trip_id and experience_key is distinct from 'london-2026') then
    raise exception 'No tens acces a les fotos contextuals' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text,0));
  perform 1 from public.travel_documents where id=p_document_id and trip_id=p_trip_id and category='Foto' for update;
  if not found then raise exception 'Foto no disponible' using errcode='P0002'; end if;
  select * into m from public.trip_photo_metadata where document_id=p_document_id for update;
  if m.updated_at is distinct from p_expected_updated_at then
    raise exception 'El context ha canviat. Reobre el formulari abans de desar.' using errcode='40001';
  end if;
  if m.document_id is null then
    insert into public.trip_photo_metadata(document_id,trip_id,local_date,activity_id,itinerary_item_id)
      values(p_document_id,p_trip_id,p_local_date,p_activity_id,p_itinerary_item_id) returning * into m;
  else
    update public.trip_photo_metadata set local_date=p_local_date,activity_id=p_activity_id,itinerary_item_id=p_itinerary_item_id
      where document_id=p_document_id and trip_id=p_trip_id returning * into m;
  end if;
  return m;
end; $function$
;

CREATE OR REPLACE FUNCTION public.sync_notification_deliveries()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  inserted_count integer := 0;
  affected_count integer := 0;
begin
  -- Keep the normalized reminder layer synchronized first.
  perform public.sync_trip_reminders();

  -- ============================================================
  -- LEGACY LONDON DELIVERIES
  -- Preserve existing behavior unchanged.
  -- ============================================================

  update public.notification_deliveries as delivery
  set
    status = 'missed',
    next_attempt_at = null,
    lease_until = null,
    sent_at = null,
    last_error_code = 'notifications-disabled',
    updated_at = statement_timestamp()
  from public.itinerary_activities as activity
  where delivery.activity_id = activity.id
    and delivery.notification_kind = 'activity-1h'
    and delivery.status in ('pending', 'retry')
    and not activity.notifications_enabled;

  update public.notification_deliveries as delivery
  set
    status = 'gone',
    next_attempt_at = null,
    lease_until = null,
    sent_at = null,
    last_error_code = 'subscription-inactive',
    updated_at = statement_timestamp()
  from public.itinerary_activities as activity,
       public.push_subscriptions as subscription
  where delivery.activity_id = activity.id
    and delivery.subscription_id = subscription.id
    and delivery.notification_kind = 'activity-1h'
    and delivery.status in ('pending', 'retry')
    and activity.notifications_enabled
    and not subscription.active;

  update public.notification_deliveries as delivery
  set
    scheduled_for = activity.starts_at
      - pg_catalog.make_interval(mins => activity.notify_before_minutes),
    status = 'pending',
    attempt_count = 0,
    next_attempt_at = null,
    lease_until = null,
    sent_at = null,
    last_error_code = null,
    updated_at = statement_timestamp()
  from public.itinerary_activities as activity,
       public.push_subscriptions as subscription
  where delivery.activity_id = activity.id
    and delivery.subscription_id = subscription.id
    and delivery.notification_kind = 'activity-1h'
    and activity.notifications_enabled
    and activity.starts_at > statement_timestamp()
    and subscription.active
    and (
      (
        delivery.status in ('pending', 'retry')
        and delivery.scheduled_for is distinct from (
          activity.starts_at
            - pg_catalog.make_interval(mins => activity.notify_before_minutes)
        )
      )
      or (
        delivery.status = 'missed'
        and (
          delivery.last_error_code = 'notifications-disabled'
          or (
            delivery.last_error_code in (
              'delivery-expired',
              'retry-window-expired'
            )
            and delivery.scheduled_for is distinct from (
              activity.starts_at
                - pg_catalog.make_interval(
                    mins => activity.notify_before_minutes
                  )
            )
          )
        )
      )
      or (
        delivery.status = 'gone'
        and delivery.last_error_code = 'subscription-inactive'
      )
    );

  insert into public.notification_deliveries (
    activity_id,
    subscription_id,
    notification_kind,
    scheduled_for,
    status
  )
  select
    activity.id,
    subscription.id,
    'activity-1h',
    activity.starts_at
      - pg_catalog.make_interval(mins => activity.notify_before_minutes),
    'pending'
  from public.itinerary_activities as activity
  join public.push_subscriptions as subscription
    on subscription.trip_id = activity.trip_id
   and subscription.active
  where activity.notifications_enabled
    and activity.starts_at > statement_timestamp()
  on conflict (
    activity_id,
    subscription_id,
    notification_kind
  ) do nothing;

  get diagnostics affected_count = row_count;
  inserted_count := inserted_count + affected_count;

  -- ============================================================
  -- UNIVERSAL TRIP REMINDER DELIVERIES
  -- ============================================================

  -- Reminder became disabled/cancelled.
  update public.notification_deliveries as delivery
  set
    status = 'missed',
    next_attempt_at = null,
    lease_until = null,
    sent_at = null,
    last_error_code = 'reminder-disabled',
    updated_at = statement_timestamp()
  from public.trip_reminders as reminder
  where delivery.reminder_id = reminder.id
    and delivery.notification_kind = reminder.reminder_kind
    and delivery.status in ('pending', 'retry')
    and not reminder.enabled;

  -- Subscription became inactive.
  update public.notification_deliveries as delivery
  set
    status = 'gone',
    next_attempt_at = null,
    lease_until = null,
    sent_at = null,
    last_error_code = 'subscription-inactive',
    updated_at = statement_timestamp()
  from public.trip_reminders as reminder,
       public.push_subscriptions as subscription
  where delivery.reminder_id = reminder.id
    and delivery.subscription_id = subscription.id
    and delivery.notification_kind = reminder.reminder_kind
    and delivery.status in ('pending', 'retry')
    and reminder.enabled
    and not subscription.active;

  -- Re-arm when timing changes, a reminder is re-enabled,
  -- or an inactive subscription becomes active again.
  update public.notification_deliveries as delivery
  set
    scheduled_for = reminder.scheduled_for,
    status = 'pending',
    attempt_count = 0,
    next_attempt_at = null,
    lease_until = null,
    sent_at = null,
    last_error_code = null,
    updated_at = statement_timestamp()
  from public.trip_reminders as reminder,
       public.push_subscriptions as subscription
  where delivery.reminder_id = reminder.id
    and delivery.subscription_id = subscription.id
    and delivery.notification_kind = reminder.reminder_kind
    and reminder.enabled
    and reminder.event_at > statement_timestamp()
    and subscription.active
    and (
      (
        delivery.status in ('pending', 'retry')
        and delivery.scheduled_for is distinct from reminder.scheduled_for
      )
      or (
        delivery.status = 'missed'
        and (
          delivery.last_error_code = 'reminder-disabled'
          or (
            delivery.last_error_code in (
              'delivery-expired',
              'retry-window-expired'
            )
            and delivery.scheduled_for
              is distinct from reminder.scheduled_for
          )
        )
      )
      or (
        delivery.status = 'gone'
        and delivery.last_error_code = 'subscription-inactive'
      )
    );

  -- Create new universal deliveries.
  insert into public.notification_deliveries (
    reminder_id,
    subscription_id,
    notification_kind,
    scheduled_for,
    status
  )
  select
    reminder.id,
    subscription.id,
    reminder.reminder_kind,
    reminder.scheduled_for,
    'pending'
  from public.trip_reminders as reminder
  join public.push_subscriptions as subscription
    on subscription.trip_id = reminder.trip_id
   and subscription.active
  where reminder.enabled
    and reminder.event_at > statement_timestamp()
  on conflict do nothing;

  get diagnostics affected_count = row_count;
  inserted_count := inserted_count + affected_count;

  return inserted_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_trip_accommodation_voucher(p_trip_id uuid, p_accommodation_id uuid, p_expected_accommodation_updated_at timestamp with time zone, p_expected_document_id uuid, p_new_document_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user_id uuid := auth.uid(); v_accommodation_updated_at timestamptz; v_current_document_id uuid;
begin
  if v_user_id is null then raise exception 'Cal iniciar sessio' using errcode = '42501'; end if;
  if p_trip_id is null or p_accommodation_id is null or p_expected_accommodation_updated_at is null then raise exception 'Falten dades per sincronitzar el voucher' using errcode = '22004'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception 'No formes part d aquest viatge' using errcode = '42501'; end if;
  select accommodation.updated_at into v_accommodation_updated_at from public.trip_accommodations as accommodation where accommodation.trip_id = p_trip_id and accommodation.id = p_accommodation_id for update;
  if not found then raise exception 'L allotjament ja no existeix' using errcode = 'P0002'; end if;
  if v_accommodation_updated_at is distinct from p_expected_accommodation_updated_at then raise exception 'Conflicte de versio de l allotjament' using errcode = '40001'; end if;
  v_current_document_id := null;
  select relation.document_id into v_current_document_id from public.trip_accommodation_documents as relation where relation.trip_id = p_trip_id and relation.accommodation_id = p_accommodation_id and relation.document_role = 'voucher' for update;
  if v_current_document_id is distinct from p_expected_document_id then raise exception 'Conflicte de voucher de l allotjament' using errcode = '40001'; end if;
  if p_new_document_id is not null and not exists (select 1 from public.travel_documents as document where document.trip_id = p_trip_id and document.id = p_new_document_id) then raise exception 'El document no pertany al viatge actiu' using errcode = '23503'; end if;
  if p_new_document_id is null then
    delete from public.trip_accommodation_documents where trip_id = p_trip_id and accommodation_id = p_accommodation_id and document_role = 'voucher';
  elsif p_new_document_id is distinct from v_current_document_id then
    insert into public.trip_accommodation_documents (trip_id,accommodation_id,document_id,document_role,created_by) values (p_trip_id,p_accommodation_id,p_new_document_id,'voucher',v_user_id)
    on conflict (trip_id, accommodation_id, document_role) do update set document_id = excluded.document_id, created_by = excluded.created_by;
  end if;
  return p_new_document_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.sync_trip_activity_document(p_trip_id uuid, p_activity_id uuid, p_document_role text, p_expected_activity_updated_at timestamp with time zone, p_expected_document_id uuid, p_new_document_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_activity_updated_at timestamptz;
  v_current_document_id uuid;
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_activity_id is null
     or p_document_role is null
     or p_expected_activity_updated_at is null then
    raise exception 'Falten dades per sincronitzar el document de l activitat'
      using errcode = '22004';
  end if;

  if p_document_role not in ('booking', 'ticket') then
    raise exception 'Rol documental d activitat no valid'
      using errcode = '22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge'
      using errcode = '42501';
  end if;

  select activity.updated_at
  into v_activity_updated_at
  from public.trip_activities as activity
  where activity.trip_id = p_trip_id
    and activity.id = p_activity_id
  for update;

  if not found then
    raise exception 'L activitat ja no existeix'
      using errcode = 'P0002';
  end if;

  if v_activity_updated_at is distinct from p_expected_activity_updated_at then
    raise exception 'Conflicte de versio de l activitat'
      using errcode = '40001';
  end if;

  v_current_document_id := null;

  select relation.document_id
  into v_current_document_id
  from public.trip_activity_documents as relation
  where relation.trip_id = p_trip_id
    and relation.activity_id = p_activity_id
    and relation.document_role = p_document_role
  for update;

  if v_current_document_id is distinct from p_expected_document_id then
    raise exception 'Conflicte de document de l activitat'
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
    delete from public.trip_activity_documents
    where trip_id = p_trip_id
      and activity_id = p_activity_id
      and document_role = p_document_role;

  elsif p_new_document_id is distinct from v_current_document_id then
    insert into public.trip_activity_documents (
      trip_id,
      activity_id,
      document_id,
      document_role,
      created_by
    ) values (
      p_trip_id,
      p_activity_id,
      p_new_document_id,
      p_document_role,
      v_user_id
    )
    on conflict (trip_id, activity_id, document_role)
    do update set
      document_id = excluded.document_id,
      created_by = excluded.created_by;
  end if;

  return p_new_document_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_trip_flight_document(p_trip_id uuid, p_flight_id uuid, p_document_role text, p_expected_flight_updated_at timestamp with time zone, p_expected_document_id uuid, p_new_document_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_flight_updated_at timestamptz;
  v_current_document_id uuid;
  v_current_count integer;
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio' using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_flight_id is null
     or p_document_role is null
     or p_expected_flight_updated_at is null then
    raise exception 'Falten dades per sincronitzar el document del vol'
      using errcode = '22004';
  end if;

  if p_document_role not in ('booking', 'boarding_pass', 'baggage_tag') then
    raise exception 'Rol documental de vol no valid' using errcode = '22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge' using errcode = '42501';
  end if;

  select flight.updated_at
  into v_flight_updated_at
  from public.trip_flights as flight
  where flight.trip_id = p_trip_id
    and flight.id = p_flight_id
  for update;

  if not found then
    raise exception 'El vol ja no existeix' using errcode = 'P0002';
  end if;

  if v_flight_updated_at is distinct from p_expected_flight_updated_at then
    raise exception 'Conflicte de versio del vol' using errcode = '40001';
  end if;

  perform 1
  from public.trip_flight_documents as relation
  where relation.trip_id = p_trip_id
    and relation.flight_id = p_flight_id
    and relation.document_role = p_document_role
  for update;

  select count(*), (array_agg(relation.document_id order by relation.document_id))[1]
  into v_current_count, v_current_document_id
  from public.trip_flight_documents as relation
  where relation.trip_id = p_trip_id
    and relation.flight_id = p_flight_id
    and relation.document_role = p_document_role;

  if v_current_count > 1 then
    raise exception 'Aquest rol documental conte diversos documents; actualitza Freya'
      using errcode = '40001';
  end if;

  if v_current_document_id is distinct from p_expected_document_id then
    raise exception 'Conflicte de document del vol' using errcode = '40001';
  end if;

  if p_new_document_id is not null
     and not exists (
       select 1
       from public.travel_documents as document
       where document.trip_id = p_trip_id
         and document.id = p_new_document_id
     ) then
    raise exception 'El document no pertany al viatge actiu' using errcode = '23503';
  end if;

  if p_new_document_id is distinct from v_current_document_id then
    delete from public.trip_flight_documents
    where trip_id = p_trip_id
      and flight_id = p_flight_id
      and document_role = p_document_role;

    if p_new_document_id is not null then
      insert into public.trip_flight_documents (
        trip_id, flight_id, document_id, document_role, created_by
      ) values (
        p_trip_id, p_flight_id, p_new_document_id, p_document_role, v_user_id
      );
    end if;
  end if;

  return p_new_document_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_trip_flight_documents(p_trip_id uuid, p_flight_id uuid, p_document_role text, p_expected_flight_updated_at timestamp with time zone, p_expected_document_ids uuid[], p_new_document_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_flight_updated_at timestamptz;
  v_expected uuid[];
  v_requested uuid[];
  v_current uuid[];
begin
  if v_user_id is null then
    raise exception 'Cal iniciar sessio' using errcode = '42501';
  end if;

  if p_trip_id is null
     or p_flight_id is null
     or p_document_role is null
     or p_expected_flight_updated_at is null then
    raise exception 'Falten dades per sincronitzar els documents del vol'
      using errcode = '22004';
  end if;

  if p_document_role not in ('boarding_pass', 'baggage_tag') then
    raise exception 'Aquest rol documental no admet multiples documents'
      using errcode = '22023';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'No formes part d aquest viatge' using errcode = '42501';
  end if;

  select coalesce(array_agg(value order by value), array[]::uuid[])
  into v_expected
  from (select distinct unnest(coalesce(p_expected_document_ids, array[]::uuid[])) as value) valueset;

  select coalesce(array_agg(value order by value), array[]::uuid[])
  into v_requested
  from (select distinct unnest(coalesce(p_new_document_ids, array[]::uuid[])) as value) valueset;

  select flight.updated_at
  into v_flight_updated_at
  from public.trip_flights as flight
  where flight.trip_id = p_trip_id
    and flight.id = p_flight_id
  for update;

  if not found then
    raise exception 'El vol ja no existeix' using errcode = 'P0002';
  end if;

  if v_flight_updated_at is distinct from p_expected_flight_updated_at then
    raise exception 'Conflicte de versio del vol' using errcode = '40001';
  end if;

  perform 1
  from public.trip_flight_documents as relation
  where relation.trip_id = p_trip_id
    and relation.flight_id = p_flight_id
    and relation.document_role = p_document_role
  for update;

  select coalesce(array_agg(relation.document_id order by relation.document_id), array[]::uuid[])
  into v_current
  from public.trip_flight_documents as relation
  where relation.trip_id = p_trip_id
    and relation.flight_id = p_flight_id
    and relation.document_role = p_document_role;

  if v_current is distinct from v_expected then
    raise exception 'Conflicte de documents del vol' using errcode = '40001';
  end if;

  if exists (
    select 1
    from unnest(v_requested) as requested(document_id)
    where not exists (
      select 1
      from public.travel_documents as document
      where document.trip_id = p_trip_id
        and document.id = requested.document_id
    )
  ) then
    raise exception 'Algun document no pertany al viatge actiu' using errcode = '23503';
  end if;

  delete from public.trip_flight_documents
  where trip_id = p_trip_id
    and flight_id = p_flight_id
    and document_role = p_document_role
    and not (document_id = any(v_requested));

  insert into public.trip_flight_documents (
    trip_id, flight_id, document_id, document_role, created_by
  )
  select p_trip_id, p_flight_id, requested.document_id, p_document_role, v_user_id
  from unnest(v_requested) as requested(document_id)
  on conflict (trip_id, flight_id, document_role, document_id) do nothing;

  return v_requested;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_trip_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  changed_count integer := 0;
  affected_count integer := 0;
begin

  -- ------------------------------------------------------------
  -- Flights: departure -> 5 hours
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    flight.trip_id,
    'flight',
    flight.id,
    'flight_departure',
    coalesce(
      nullif(
        pg_catalog.concat_ws(
          ' ',
          nullif(pg_catalog.btrim(flight.airline), ''),
          nullif(pg_catalog.btrim(flight.flight_number), '')
        ),
        ''
      ),
      nullif(
        pg_catalog.concat_ws(
          ' → ',
          nullif(pg_catalog.btrim(flight.departure_city), ''),
          nullif(pg_catalog.btrim(flight.arrival_city), '')
        ),
        ''
      ),
      'Vol'
    ),
    flight.departure_at,
    300,
    flight.departure_at - interval '300 minutes',
    true,
    flight.updated_at
  from public.trip_flights as flight
  where flight.departure_at is not null
    and flight.departure_at > statement_timestamp()
    and flight.completed_at is null
    and flight.flight_status <> 'cancelled'
    and (flight.flight_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.flight_id=flight.id))
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Accommodation: check-in -> 2 hours
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    accommodation.trip_id,
    'accommodation',
    accommodation.id,
    'accommodation_check_in',
    accommodation.name,
    accommodation.check_in_at,
    120,
    accommodation.check_in_at - interval '120 minutes',
    true,
    accommodation.updated_at
  from public.trip_accommodations as accommodation
  where accommodation.check_in_at is not null
    and accommodation.check_in_at > statement_timestamp()
    and accommodation.check_in_completed_at is null
    and accommodation.reservation_status <> 'cancelled'
    and (accommodation.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.accommodation_id=accommodation.id))
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Accommodation: check-out -> 2 hours
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    accommodation.trip_id,
    'accommodation',
    accommodation.id,
    'accommodation_check_out',
    accommodation.name,
    accommodation.check_out_at,
    120,
    accommodation.check_out_at - interval '120 minutes',
    true,
    accommodation.updated_at
  from public.trip_accommodations as accommodation
  where accommodation.check_out_at is not null
    and accommodation.check_out_at > statement_timestamp()
    and accommodation.check_out_completed_at is null
    and accommodation.reservation_status <> 'cancelled'
    and (accommodation.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.accommodation_id=accommodation.id))
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Activities / restaurants: start -> 1 hour
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    activity.trip_id,
    'activity',
    activity.id,
    'activity_start',
    activity.title,
    activity.start_at,
    60,
    activity.start_at - interval '60 minutes',
    true,
    activity.updated_at
  from public.trip_activities as activity
  where activity.start_at is not null
    and activity.start_at > statement_timestamp()
    and activity.completed_at is null
    and activity.reservation_status <> 'cancelled'
    and (activity.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.activity_id=activity.id))
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Manual itinerary: exact only -> 1 hour
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    item.trip_id,
    'itinerary_item',
    item.id,
    'itinerary_exact',
    item.title,
    item.starts_at,
    60,
    item.starts_at - interval '60 minutes',
    true,
    item.updated_at
  from public.trip_itinerary_items as item
  where item.timing_kind = 'exact'
    and item.starts_at is not null
    and item.starts_at > statement_timestamp()
    and item.status = 'planned'
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Disable reminders whose canonical source is no longer eligible.
  -- We keep the row for audit/stability instead of deleting it.
  -- ------------------------------------------------------------

  update public.trip_reminders as reminder
  set
    enabled = false,
    updated_at = statement_timestamp()
  where reminder.enabled
    and (
      (
        reminder.source_kind = 'flight'
        and reminder.reminder_kind = 'flight_departure'
        and not exists (
          select 1
          from public.trip_flights as flight
          where flight.id = reminder.source_id
            and flight.trip_id = reminder.trip_id
            and flight.departure_at is not null
            and flight.departure_at > statement_timestamp()
    and flight.completed_at is null
            and flight.flight_status <> 'cancelled'
    and (flight.flight_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.flight_id=flight.id))
        )
      )

      or (
        reminder.source_kind = 'accommodation'
        and reminder.reminder_kind = 'accommodation_check_in'
        and not exists (
          select 1
          from public.trip_accommodations as accommodation
          where accommodation.id = reminder.source_id
            and accommodation.trip_id = reminder.trip_id
            and accommodation.check_in_at is not null
            and accommodation.check_in_at > statement_timestamp()
    and accommodation.check_in_completed_at is null
            and accommodation.reservation_status <> 'cancelled'
    and (accommodation.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.accommodation_id=accommodation.id))
        )
      )

      or (
        reminder.source_kind = 'accommodation'
        and reminder.reminder_kind = 'accommodation_check_out'
        and not exists (
          select 1
          from public.trip_accommodations as accommodation
          where accommodation.id = reminder.source_id
            and accommodation.trip_id = reminder.trip_id
            and accommodation.check_out_at is not null
            and accommodation.check_out_at > statement_timestamp()
    and accommodation.check_out_completed_at is null
            and accommodation.reservation_status <> 'cancelled'
    and (accommodation.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.accommodation_id=accommodation.id))
        )
      )

      or (
        reminder.source_kind = 'activity'
        and reminder.reminder_kind = 'activity_start'
        and not exists (
          select 1
          from public.trip_activities as activity
          where activity.id = reminder.source_id
            and activity.trip_id = reminder.trip_id
            and activity.start_at is not null
            and activity.start_at > statement_timestamp()
    and activity.completed_at is null
            and activity.reservation_status <> 'cancelled'
    and (activity.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.activity_id=activity.id))
        )
      )

      or (
        reminder.source_kind = 'itinerary_item'
        and reminder.reminder_kind = 'itinerary_exact'
        and not exists (
          select 1
          from public.trip_itinerary_items as item
          where item.id = reminder.source_id
            and item.trip_id = reminder.trip_id
            and item.timing_kind = 'exact'
            and item.starts_at is not null
            and item.starts_at > statement_timestamp()
            and item.status = 'planned'
        )
      )
    );

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  return changed_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trip_brief_interest_aliases_v1()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
select $catalog${"interest.christmas":["christmas","nadal"],"interest.christmas_markets":["christmas markets","mercats de nadal"],"interest.snow":["snow","neu"],"interest.snow_activities":["snow activities","activitats de neu"],"interest.gastronomy":["gastronomy","gastronomia"],"interest.culture":["culture","cultura"],"interest.nature":["nature","natura"],"interest.spa_relaxation":["spa relaxation","relax / spa"],"interest.nightlife":["nightlife","nit / plans especials"],"interest.shopping":["shopping","compres"],"interest.special_places":["special places","llocs especials"]}$catalog$::jsonb;
$function$
;

CREATE OR REPLACE FUNCTION public.trip_brief_interest_label_key_v1(label text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
select lower(btrim(regexp_replace(normalize(label, NFKC),
  U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')) collate pg_catalog."und-x-icu");
$function$
;

CREATE OR REPLACE FUNCTION public.trip_brief_schema_v1()
 RETURNS json
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
select $json${"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"decisions":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":200,"additionalProperties":{"oneOf":[{"type":"object","properties":{"field":{"anyOf":[{"enum":["interest.christmas","interest.christmas_markets","interest.snow","interest.snow_activities","interest.gastronomy","interest.culture","interest.nature","interest.spa_relaxation","interest.nightlife","interest.shopping","interest.special_places","hotel.amenity.spa","hotel.amenity.pool","hotel.amenity.parking","hotel.amenity.gym","destination.multidestination","dates","dates.flexibility_days","origin","destination","duration","pace","budget","interests","flight.departure_window","flight.arrival_window","flight.max_stops","flight.max_duration_minutes","flight.alternative_airports","flight.low_cost","baggage","hotel.comfort","hotel.location","hotel.room","hotel.breakfast","hotel.cancellation","hotel.amenities","hotel.stars","hotel.rating","experience.styles","notes"]},{"type":"string","pattern":"^interest\\.free\\.[0-9a-f]{32}$"},{"type":"string","pattern":"^custom\\.[a-z][a-z0-9_]{0,49}$"}]},"scope":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"origin":{"enum":["explicit_user","interpreted_from_user","system_default"]},"knowledge":{"const":"unknown"},"label":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"}},"required":["field","scope","origin","knowledge"],"additionalProperties":false,"allOf":[{"if":{"properties":{"field":{"pattern":"^interest\\.free\\.[0-9a-f]{32}$"}}},"then":{"required":["label"]},"else":{"not":{"required":["label"]}}}]},{"type":"object","properties":{"field":{"anyOf":[{"enum":["interest.christmas","interest.christmas_markets","interest.snow","interest.snow_activities","interest.gastronomy","interest.culture","interest.nature","interest.spa_relaxation","interest.nightlife","interest.shopping","interest.special_places","hotel.amenity.spa","hotel.amenity.pool","hotel.amenity.parking","hotel.amenity.gym","destination.multidestination","dates","dates.flexibility_days","origin","destination","duration","pace","budget","interests","flight.departure_window","flight.arrival_window","flight.max_stops","flight.max_duration_minutes","flight.alternative_airports","flight.low_cost","baggage","hotel.comfort","hotel.location","hotel.room","hotel.breakfast","hotel.cancellation","hotel.amenities","hotel.stars","hotel.rating","experience.styles","notes"]},{"type":"string","pattern":"^interest\\.free\\.[0-9a-f]{32}$"},{"type":"string","pattern":"^custom\\.[a-z][a-z0-9_]{0,49}$"}]},"scope":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"origin":{"enum":["explicit_user","interpreted_from_user","system_default"]},"knowledge":{"const":"indifferent"},"strength":{"enum":["hard","preference","flexible"]},"label":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"}},"required":["field","scope","origin","knowledge","strength"],"additionalProperties":false,"allOf":[{"if":{"properties":{"field":{"pattern":"^interest\\.free\\.[0-9a-f]{32}$"}}},"then":{"required":["label"]},"else":{"not":{"required":["label"]}}}]},{"type":"object","properties":{"field":{"anyOf":[{"enum":["interest.christmas","interest.christmas_markets","interest.snow","interest.snow_activities","interest.gastronomy","interest.culture","interest.nature","interest.spa_relaxation","interest.nightlife","interest.shopping","interest.special_places","hotel.amenity.spa","hotel.amenity.pool","hotel.amenity.parking","hotel.amenity.gym","destination.multidestination","dates","dates.flexibility_days","origin","destination","duration","pace","budget","interests","flight.departure_window","flight.arrival_window","flight.max_stops","flight.max_duration_minutes","flight.alternative_airports","flight.low_cost","baggage","hotel.comfort","hotel.location","hotel.room","hotel.breakfast","hotel.cancellation","hotel.amenities","hotel.stars","hotel.rating","experience.styles","notes"]},{"type":"string","pattern":"^interest\\.free\\.[0-9a-f]{32}$"},{"type":"string","pattern":"^custom\\.[a-z][a-z0-9_]{0,49}$"}]},"scope":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"origin":{"enum":["explicit_user","interpreted_from_user","system_default"]},"knowledge":{"const":"known"},"strength":{"enum":["hard","preference","flexible"]},"value":{},"label":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"}},"required":["field","scope","origin","knowledge","strength","value"],"additionalProperties":false,"allOf":[{"if":{"properties":{"field":{"const":"interest.christmas"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.christmas_markets"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.snow"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.snow_activities"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.gastronomy"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.culture"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.nature"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.spa_relaxation"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.nightlife"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.shopping"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.special_places"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"hotel.amenity.spa"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"hotel.amenity.pool"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"hotel.amenity.parking"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"hotel.amenity.gym"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"destination.multidestination"}}},"then":{"properties":{"value":{"type":"boolean"}}}},{"if":{"properties":{"field":{"const":"dates"}}},"then":{"properties":{"value":{"oneOf":[{"type":"object","properties":{"mode":{"const":"exact"},"start":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"end":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"}},"required":["mode","start","end"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"window"},"earliest":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"latest":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"}},"required":["mode","earliest","latest"],"additionalProperties":false}]}}}},{"if":{"properties":{"field":{"const":"dates.flexibility_days"}}},"then":{"properties":{"value":{"type":"integer","minimum":0,"maximum":365}}}},{"if":{"properties":{"field":{"const":"origin"}}},"then":{"properties":{"value":{"type":"object","properties":{"places":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["places"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"destination"}}},"then":{"properties":{"value":{"oneOf":[{"type":"object","properties":{"mode":{"const":"open"}},"required":["mode"],"additionalProperties":false},{"type":"object","properties":{"mode":{"enum":["known","partial"]},"places":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","places"],"additionalProperties":false}]}}}},{"if":{"properties":{"field":{"const":"duration"}}},"then":{"properties":{"value":{"type":"object","properties":{"unit":{"enum":["days","nights"]},"min":{"type":"integer","minimum":1,"maximum":730},"max":{"type":"integer","minimum":1,"maximum":730}},"required":["unit","min","max"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"pace"}}},"then":{"properties":{"value":{"enum":["relaxed","balanced","active"]}}}},{"if":{"properties":{"field":{"const":"budget"}}},"then":{"properties":{"value":{"oneOf":[{"type":"object","properties":{"mode":{"const":"price_discovery"},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"target"},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"amount":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","currency","amount"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"maximum"},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"amount":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","currency","amount"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"target_stretch"},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"amount":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"stretch":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","currency","amount","stretch"],"additionalProperties":false}]}}}},{"if":{"properties":{"field":{"const":"interests"}}},"then":{"properties":{"value":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"flight.departure_window"}}},"then":{"properties":{"value":{"type":"object","properties":{"weekdays":{"type":"array","items":{"type":"integer","minimum":1,"maximum":7},"minItems":1,"maxItems":7,"uniqueItems":true},"local_date":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"min":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"max":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"time_zone":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"}},"required":[],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"flight.arrival_window"}}},"then":{"properties":{"value":{"type":"object","properties":{"weekdays":{"type":"array","items":{"type":"integer","minimum":1,"maximum":7},"minItems":1,"maxItems":7,"uniqueItems":true},"local_date":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"min":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"max":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"time_zone":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"}},"required":[],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"flight.max_stops"}}},"then":{"properties":{"value":{"type":"integer","minimum":0,"maximum":5}}}},{"if":{"properties":{"field":{"const":"flight.max_duration_minutes"}}},"then":{"properties":{"value":{"type":"integer","minimum":1,"maximum":4320}}}},{"if":{"properties":{"field":{"const":"flight.alternative_airports"}}},"then":{"properties":{"value":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"flight.low_cost"}}},"then":{"properties":{"value":{"type":"boolean"}}}},{"if":{"properties":{"field":{"const":"baggage"}}},"then":{"properties":{"value":{"type":"object","properties":{"shared":{"type":"array","items":{"type":"object","properties":{"kind":{"enum":["personal","cabin","checked","other"]},"quantity":{"type":"integer","minimum":1,"maximum":20},"weight_kg":{"type":"number","exclusiveMinimum":0,"maximum":100},"note":{"type":"string","minLength":1,"maxLength":500,"pattern":"\\S"}},"required":["kind","quantity"],"additionalProperties":false},"minItems":1,"maxItems":30,"uniqueItems":true},"per_traveler":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":30,"additionalProperties":{"type":"array","items":{"type":"object","properties":{"kind":{"enum":["personal","cabin","checked","other"]},"quantity":{"type":"integer","minimum":1,"maximum":20},"weight_kg":{"type":"number","exclusiveMinimum":0,"maximum":100},"note":{"type":"string","minLength":1,"maxLength":500,"pattern":"\\S"}},"required":["kind","quantity"],"additionalProperties":false},"minItems":1,"maxItems":30,"uniqueItems":true}}},"required":[],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"hotel.comfort"}}},"then":{"properties":{"value":{"enum":["economic","comfortable","special"]}}}},{"if":{"properties":{"field":{"const":"hotel.location"}}},"then":{"properties":{"value":{"enum":["central","well_connected"]}}}},{"if":{"properties":{"field":{"const":"hotel.room"}}},"then":{"properties":{"value":{"type":"object","properties":{"type":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"},"rooms":{"type":"integer","minimum":1,"maximum":30},"occupancy":{"type":"integer","minimum":1,"maximum":60}},"required":["type"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"hotel.breakfast"}}},"then":{"properties":{"value":{"type":"boolean"}}}},{"if":{"properties":{"field":{"const":"hotel.cancellation"}}},"then":{"properties":{"value":{"enum":["free","refundable","non_refundable_acceptable"]}}}},{"if":{"properties":{"field":{"const":"hotel.amenities"}}},"then":{"properties":{"value":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"hotel.stars"}}},"then":{"properties":{"value":{"type":"integer","minimum":1,"maximum":5}}}},{"if":{"properties":{"field":{"const":"hotel.rating"}}},"then":{"properties":{"value":{"type":"object","properties":{"min":{"type":"number","minimum":0,"maximum":10},"scale":{"enum":[5,10]},"source":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"}},"required":["min","scale","source"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"experience.styles"}}},"then":{"properties":{"value":{"type":"array","items":{"enum":["independent","audio_guide","guided_visit","organized_excursion","independent_excursion","combination"]},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"notes"}}},"then":{"properties":{"value":{"type":"string","minLength":1,"maxLength":2000,"pattern":"\\S"}}}},{"if":{"properties":{"field":{"pattern":"^custom\\."}}},"then":{"properties":{"value":{"type":"string","minLength":1,"maxLength":1000,"pattern":"\\S"}}}},{"if":{"properties":{"field":{"pattern":"^interest\\.free\\.[0-9a-f]{32}$"}}},"then":{"required":["label"],"properties":{"value":{"const":true}}},"else":{"not":{"required":["label"]}}}]}]}},"scopes":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":50,"additionalProperties":{"type":"object","properties":{"kind":{"enum":["destination","stay","component","leg"]},"parent":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"label":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"}},"required":["kind","parent","label"],"additionalProperties":false}},"travelers":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":30,"additionalProperties":{"type":"object","properties":{"kind":{"enum":["adult","child"]},"age":{"type":"integer","minimum":0,"maximum":17}},"required":["kind"],"additionalProperties":false}}},"required":["decisions","scopes","travelers"],"additionalProperties":false}$json$::json;
$function$
;

CREATE OR REPLACE FUNCTION public.trip_brief_valid_v1(doc jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  entry record; other record; scope_id text; parent_id text; chain text[];
  value jsonb; ancestor jsonb; bag_id text;
begin
  if doc is null or octet_length(doc::text)>131072
     or not extensions.jsonb_matches_schema(public.trip_brief_schema_v1(),doc) then return false; end if;
  if doc->'scopes' ? 'global' then return false; end if;
  for entry in select * from jsonb_each(doc->'scopes') loop
    scope_id:=entry.key; chain:='{}';
    loop
      if scope_id='global' then exit; end if;
      if scope_id=any(chain) or not (doc->'scopes' ? scope_id) then return false; end if;
      chain:=array_append(chain,scope_id);
      if cardinality(chain)>4 then return false; end if;
      parent_id:=doc->'scopes'->scope_id->>'parent';
      if parent_id<>'global' and not (
        (doc->'scopes'->scope_id->>'kind'='stay' and doc->'scopes'->parent_id->>'kind'='destination') or
        (doc->'scopes'->scope_id->>'kind'='component' and doc->'scopes'->parent_id->>'kind' in ('stay','destination')) or
        (doc->'scopes'->scope_id->>'kind'='leg' and doc->'scopes'->parent_id->>'kind'='component')
      ) then return false; end if;
      scope_id:=parent_id;
    end loop;
  end loop;
  if exists(select 1 from jsonb_each(doc->'travelers') d where d.value->>'kind'='adult' and d.value ? 'age') then return false; end if;
  if exists(select 1 from jsonb_each(doc->'decisions') d group by d.value->>'field',d.value->>'scope' having count(*)>1) then return false; end if;
  for entry in select * from jsonb_each(doc->'decisions') loop
    value:=entry.value->'value'; scope_id:=entry.value->>'scope';
    if scope_id<>'global' and not (doc->'scopes' ? scope_id) then return false; end if;
    if entry.value->>'strength'='hard' and entry.value->>'origin'<>'explicit_user' then return false; end if;
    if entry.value->>'knowledge'='known' then
      case entry.value->>'field'
        when 'dates' then
          if value->>'mode'='exact' then
            if (value->>'start')::date>(value->>'end')::date then return false; end if;
          else
            if (value->>'earliest')::date>(value->>'latest')::date then return false; end if;
          end if;
        when 'duration' then
          if (value->>'min')::int>(value->>'max')::int then return false; end if;
        when 'hotel.rating' then
          if (value->>'min')::numeric>(value->>'scale')::numeric then return false; end if;
        when 'flight.departure_window','flight.arrival_window' then
          if not (value ? 'min' or value ? 'max') then return false; end if;
          if value ? 'min' and value ? 'max' and value->>'min'>value->>'max' then return false; end if;
          if value ? 'local_date' then
            perform (value->>'local_date')::date;
            if value ? 'weekdays' and not (value->'weekdays' @> jsonb_build_array(extract(isodow from (value->>'local_date')::date)::int)) then return false; end if;
          end if;
        when 'baggage' then
          if value='{}'::jsonb or value='{"per_traveler":{}}'::jsonb then return false; end if;
          for bag_id in select jsonb_object_keys(coalesce(value->'per_traveler','{}')) loop
            if not (doc->'travelers' ? bag_id) then return false; end if;
          end loop;
        else null;
      end case;
    end if;
    -- A narrower scope cannot weaken an inherited hard, even by UNKNOWN.
    while scope_id<>'global' loop
      scope_id:=doc->'scopes'->scope_id->>'parent';
      select d.value into ancestor from jsonb_each(doc->'decisions') d
        where d.value->>'scope'=scope_id and d.value->>'field'=entry.value->>'field';
      if ancestor->>'strength'='hard' and
        (ancestor - 'scope') is distinct from (entry.value - 'scope') then return false; end if;
    end loop;
  end loop;
  -- TB-01.1: preserve every legacy invariant above; add family-level guards.
  if exists(select 1 from jsonb_each(doc->'decisions') d
    where d.value->>'field' like 'interest.%'
    group by d.value->>'scope' having count(*)>30) then return false; end if;
  for entry in select * from jsonb_each(doc->'decisions') loop
    if entry.value->>'field' like 'interest.free.%' then
      if public.trip_brief_interest_label_key_v1(entry.value->>'label')='' then return false; end if;
      -- One free-interest identity cannot acquire different labels by scope.
      if exists(select 1 from jsonb_each(doc->'decisions') d
        where d.value->>'field'=entry.value->>'field'
        and public.trip_brief_interest_label_key_v1(d.value->>'label')<>
            public.trip_brief_interest_label_key_v1(entry.value->>'label')) then return false; end if;
    end if;
    scope_id:=entry.value->>'scope';
    loop
      for other in select * from jsonb_each(doc->'decisions') d
        where d.value->>'scope'=scope_id and d.key<>entry.key loop
        -- Reject either direction of legacy/new along the same inheritance chain.
        if ((entry.value->>'field'='interests' and other.value->>'field' like 'interest.%')
          or (other.value->>'field'='interests' and entry.value->>'field' like 'interest.%')
          or (entry.value->>'field'='hotel.amenities' and other.value->>'field' like 'hotel.amenity.%')
          or (other.value->>'field'='hotel.amenities' and entry.value->>'field' like 'hotel.amenity.%')) then return false; end if;
        -- Distinct UUIDs must not launder duplicates or inherited hard interests.
        if entry.value->>'field' like 'interest.free.%' and other.value->>'field' like 'interest.free.%'
          and entry.value->>'field'<>other.value->>'field'
          and public.trip_brief_interest_label_key_v1(entry.value->>'label')=
              public.trip_brief_interest_label_key_v1(other.value->>'label') then return false; end if;
        if entry.value->>'field' like 'interest.free.%'
          and coalesce(public.trip_brief_interest_aliases_v1()->(other.value->>'field'),'[]'::jsonb)
            ? public.trip_brief_interest_label_key_v1(entry.value->>'label') then return false; end if;
        if other.value->>'field' like 'interest.free.%'
          and coalesce(public.trip_brief_interest_aliases_v1()->(entry.value->>'field'),'[]'::jsonb)
            ? public.trip_brief_interest_label_key_v1(other.value->>'label') then return false; end if;
      end loop;
      exit when scope_id='global';
      scope_id:=doc->'scopes'->scope_id->>'parent';
    end loop;
  end loop;

  return true;
exception when others then return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_trip_v1(p_trip_id uuid, p_name text, p_start_date date, p_end_date date, p_time_zone text)
 RETURNS TABLE(id uuid, name text, invite_code text, owner_id uuid, start_date date, end_date date, time_zone text, experience_key text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  authenticated_user_id uuid := auth.uid();
  normalized_name text := btrim(p_name);
  normalized_time_zone text := btrim(p_time_zone);
  updated_trip public.trips%rowtype;
begin
  if authenticated_user_id is null then
    raise exception 'Cal iniciar sessió'
      using errcode = '42501';
  end if;

  if p_trip_id is null then
    raise exception 'El viatge és obligatori';
  end if;

  if normalized_name is null
     or char_length(normalized_name) not between 1 and 100 then
    raise exception 'El nom del viatge ha de tenir entre 1 i 100 caràcters';
  end if;

  if p_start_date is null or p_end_date is null then
    raise exception 'Les dates d’inici i fi són obligatòries';
  end if;

  if p_end_date < p_start_date then
    raise exception 'La data de fi no pot ser anterior a la data d’inici';
  end if;

  if normalized_time_zone is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = normalized_time_zone
     ) then
    raise exception 'La zona horària no és una zona IANA vàlida';
  end if;

  update public.trips
  set
    name = normalized_name,
    start_date = p_start_date,
    end_date = p_end_date,
    time_zone = normalized_time_zone
  where public.trips.id = p_trip_id
    and public.trips.owner_id = authenticated_user_id
    and public.trips.experience_key is distinct from 'london-2026'
  returning public.trips.*
  into updated_trip;

  if not found then
    raise exception 'Només la persona propietària pot editar aquest viatge'
      using errcode = '42501';
  end if;

  return query
  select
    updated_trip.id,
    updated_trip.name,
    updated_trip.invite_code,
    updated_trip.owner_id,
    updated_trip.start_date,
    updated_trip.end_date,
    updated_trip.time_zone,
    updated_trip.experience_key;
end;
$function$
;

ALTER TABLE "app_private"."alb03_ingestions"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "asset_id" uuid NOT NULL,
  ADD COLUMN "source_id" uuid NOT NULL,
  ADD COLUMN "source_path" text NOT NULL,
  ADD COLUMN "source_token" text NOT NULL,
  ADD COLUMN "snapshot_id" uuid NOT NULL,
  ADD COLUMN "lease_id" uuid,
  ADD COLUMN "lease_until" timestamp with time zone,
  ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "error_code" text,
  ADD COLUMN "source_hash" text,
  ADD COLUMN "source_orientation" smallint,
  ADD COLUMN "created_by" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE "app_private"."alb03_requests"
  ADD COLUMN "actor_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "result" jsonb NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE "place_private"."handoff_receipts"
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "result" jsonb NOT NULL;

ALTER TABLE "place_private"."operations"
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "binding_id" uuid NOT NULL;

ALTER TABLE "place_private"."queries"
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "query_hash" text NOT NULL,
  ADD COLUMN "query" jsonb NOT NULL,
  ADD COLUMN "status" text NOT NULL,
  ADD COLUMN "lease_until" timestamp with time zone,
  ADD COLUMN "token" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "results" jsonb,
  ADD COLUMN "expires_at" timestamp with time zone;

ALTER TABLE "place_private"."quota"
  ADD COLUMN "bucket" text NOT NULL,
  ADD COLUMN "used" integer NOT NULL;

ALTER TABLE "place_private"."settings"
  ADD COLUMN "singleton" boolean DEFAULT true NOT NULL,
  ADD COLUMN "fresh_days" integer DEFAULT 90 NOT NULL;

ALTER TABLE "public"."checklist_items"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "text" text NOT NULL,
  ADD COLUMN "done" boolean DEFAULT false NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "category" text,
  ADD COLUMN "template_key" text,
  ADD COLUMN "dismissed" boolean DEFAULT false NOT NULL;

ALTER TABLE "public"."itinerary_activities"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "stable_activity_id" text NOT NULL,
  ADD COLUMN "title" text NOT NULL,
  ADD COLUMN "description" text,
  ADD COLUMN "starts_at" timestamp with time zone NOT NULL,
  ADD COLUMN "time_zone" text,
  ADD COLUMN "booked" boolean DEFAULT false NOT NULL,
  ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN "notify_before_minutes" smallint DEFAULT 60 NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."notification_deliveries"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "activity_id" uuid,
  ADD COLUMN "subscription_id" uuid NOT NULL,
  ADD COLUMN "notification_kind" text DEFAULT 'activity-1h'::text NOT NULL,
  ADD COLUMN "scheduled_for" timestamp with time zone NOT NULL,
  ADD COLUMN "status" text NOT NULL,
  ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "next_attempt_at" timestamp with time zone,
  ADD COLUMN "lease_until" timestamp with time zone,
  ADD COLUMN "sent_at" timestamp with time zone,
  ADD COLUMN "last_error_code" text,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "reminder_id" uuid;

ALTER TABLE "public"."place_bindings"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "brief_id" uuid NOT NULL,
  ADD COLUMN "proposal_id" uuid,
  ADD COLUMN "subject_key" text NOT NULL,
  ADD COLUMN "original_text" text NOT NULL,
  ADD COLUMN "state" text NOT NULL,
  ADD COLUMN "place_version_id" uuid,
  ADD COLUMN "selection_method" text,
  ADD COLUMN "brief_revision" bigint NOT NULL,
  ADD COLUMN "revision" bigint NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "subject_snapshot" jsonb;

ALTER TABLE "public"."place_versions"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "place_id" uuid NOT NULL,
  ADD COLUMN "canonical_name" text NOT NULL,
  ADD COLUMN "kind" text NOT NULL,
  ADD COLUMN "administrative_area" text,
  ADD COLUMN "country_code" text,
  ADD COLUMN "latitude" double precision NOT NULL,
  ADD COLUMN "longitude" double precision NOT NULL,
  ADD COLUMN "coordinate_role" text NOT NULL,
  ADD COLUMN "timezone" text,
  ADD COLUMN "timezone_status" text NOT NULL,
  ADD COLUMN "provider" text NOT NULL,
  ADD COLUMN "provider_place_id" text NOT NULL,
  ADD COLUMN "source" text NOT NULL,
  ADD COLUMN "attribution" text NOT NULL,
  ADD COLUMN "resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "resolution_version" text NOT NULL,
  ADD COLUMN "content_hash" text NOT NULL;

ALTER TABLE "public"."places"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "provider" text NOT NULL,
  ADD COLUMN "provider_place_id" text NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."proposal_generations"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "brief_id" uuid NOT NULL,
  ADD COLUMN "brief_revision" bigint NOT NULL,
  ADD COLUMN "brief_schema_version" integer NOT NULL,
  ADD COLUMN "brief_snapshot" jsonb NOT NULL,
  ADD COLUMN "snapshot_hash" text NOT NULL,
  ADD COLUMN "engine_version" text NOT NULL,
  ADD COLUMN "generator_version" text NOT NULL,
  ADD COLUMN "verifier_version" text NOT NULL,
  ADD COLUMN "policy_version" text NOT NULL,
  ADD COLUMN "status" text DEFAULT 'pending'::text NOT NULL,
  ADD COLUMN "result_reason" text,
  ADD COLUMN "error_code" text,
  ADD COLUMN "attempt_number" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "attempt_token" uuid,
  ADD COLUMN "lease_expires_at" timestamp with time zone,
  ADD COLUMN "result_hash" text,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "finished_at" timestamp with time zone,
  ADD COLUMN "round_number" bigint,
  ADD COLUMN "previous_generation_id" uuid,
  ADD COLUMN "refinement" jsonb DEFAULT '{"text": "", "chips": []}'::jsonb NOT NULL,
  ADD COLUMN "excluded_routes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN "material_key" text,
  ADD COLUMN "place_snapshot" jsonb;

ALTER TABLE "public"."proposal_operations"
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "action" text NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "generation_id" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."push_subscriptions"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "user_id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "endpoint" text NOT NULL,
  ADD COLUMN "p256dh" text NOT NULL,
  ADD COLUMN "auth" text NOT NULL,
  ADD COLUMN "active" boolean DEFAULT true NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."travel_book_asset_variants"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "asset_id" uuid NOT NULL,
  ADD COLUMN "kind" text NOT NULL,
  ADD COLUMN "pipeline_version" integer NOT NULL,
  ADD COLUMN "content_hash" text NOT NULL,
  ADD COLUMN "width_px" integer NOT NULL,
  ADD COLUMN "height_px" integer NOT NULL,
  ADD COLUMN "mime_type" text NOT NULL,
  ADD COLUMN "file_extension" text NOT NULL,
  ADD COLUMN "byte_size" integer NOT NULL,
  ADD COLUMN "orientation" smallint NOT NULL,
  ADD COLUMN "storage_bucket" text NOT NULL,
  ADD COLUMN "storage_path" text NOT NULL;

ALTER TABLE "public"."travel_book_assets"
  ADD COLUMN "id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "asset_key" uuid NOT NULL,
  ADD COLUMN "version" integer NOT NULL,
  ADD COLUMN "kind" text DEFAULT 'image'::text NOT NULL,
  ADD COLUMN "source_document_id" uuid,
  ADD COLUMN "source_document_id_at_capture" uuid,
  ADD COLUMN "status" text DEFAULT 'pending'::text NOT NULL,
  ADD COLUMN "content_hash" text,
  ADD COLUMN "mime_type" text,
  ADD COLUMN "width_px" integer,
  ADD COLUMN "height_px" integer,
  ADD COLUMN "storage_bucket" text,
  ADD COLUMN "storage_path" text,
  ADD COLUMN "verified_at" timestamp with time zone,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "updated_by" uuid NOT NULL;

ALTER TABLE "public"."travel_book_composition_versions"
  ADD COLUMN "composition_id" uuid NOT NULL,
  ADD COLUMN "version" bigint NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "edition_id" uuid NOT NULL,
  ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "document" jsonb NOT NULL,
  ADD COLUMN "hash_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "document_hash" text GENERATED ALWAYS AS (app_private.travel_book_hash_v1(document)) STORED,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL;

ALTER TABLE "public"."travel_book_compositions"
  ADD COLUMN "id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "edition_id" uuid NOT NULL,
  ADD COLUMN "kind" text NOT NULL,
  ADD COLUMN "current_version" bigint DEFAULT 1 NOT NULL,
  ADD COLUMN "removed_at" timestamp with time zone,
  ADD COLUMN "removed_by" uuid,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "updated_by" uuid NOT NULL;

ALTER TABLE "public"."travel_book_editions"
  ADD COLUMN "id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "title" text NOT NULL,
  ADD COLUMN "structure_version" bigint DEFAULT 1 NOT NULL,
  ADD COLUMN "next_revision_number" bigint DEFAULT 1 NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "updated_by" uuid NOT NULL;

ALTER TABLE "public"."travel_book_operations"
  ADD COLUMN "actor_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "edition_id" uuid,
  ADD COLUMN "operation_type" text NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "result" jsonb NOT NULL,
  ADD COLUMN "status" text DEFAULT 'applied'::text NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE "public"."travel_book_pages"
  ADD COLUMN "id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "edition_id" uuid NOT NULL,
  ADD COLUMN "composition_id" uuid NOT NULL,
  ADD COLUMN "slot" smallint NOT NULL,
  ADD COLUMN "position" integer,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL;

ALTER TABLE "public"."travel_book_resource_refs"
  ADD COLUMN "composition_id" uuid NOT NULL,
  ADD COLUMN "composition_version" bigint NOT NULL,
  ADD COLUMN "ref_key" text NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "edition_id" uuid NOT NULL,
  ADD COLUMN "element_id" uuid NOT NULL,
  ADD COLUMN "resource_kind" text NOT NULL,
  ADD COLUMN "asset_id" uuid,
  ADD COLUMN "source_snapshot_id" uuid,
  ADD COLUMN "usage" text NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE "public"."travel_book_revision_compositions"
  ADD COLUMN "revision_id" uuid NOT NULL,
  ADD COLUMN "composition_id" uuid NOT NULL,
  ADD COLUMN "composition_version" bigint NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "edition_id" uuid NOT NULL;

ALTER TABLE "public"."travel_book_revisions"
  ADD COLUMN "id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "edition_id" uuid NOT NULL,
  ADD COLUMN "revision_number" bigint NOT NULL,
  ADD COLUMN "structure_version" bigint NOT NULL,
  ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "manifest" jsonb NOT NULL,
  ADD COLUMN "hash_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "manifest_hash" text GENERATED ALWAYS AS (app_private.travel_book_hash_v1(manifest)) STORED,
  ADD COLUMN "resource_state_at_capture" text NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL;

ALTER TABLE "public"."travel_book_source_snapshots"
  ADD COLUMN "id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "book_id" uuid NOT NULL,
  ADD COLUMN "source_kind" text NOT NULL,
  ADD COLUMN "source_id" uuid,
  ADD COLUMN "source_version" text,
  ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "classification" text NOT NULL,
  ADD COLUMN "origin" text NOT NULL,
  ADD COLUMN "availability_at_capture" text NOT NULL,
  ADD COLUMN "payload" jsonb NOT NULL,
  ADD COLUMN "hash_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "payload_hash" text GENERATED ALWAYS AS (app_private.travel_book_hash_v1(payload)) STORED,
  ADD COLUMN "captured_at" timestamp with time zone NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL;

ALTER TABLE "public"."travel_books"
  ADD COLUMN "id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "title" text NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL;

ALTER TABLE "public"."travel_documents"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "title" text NOT NULL,
  ADD COLUMN "category" text DEFAULT 'Altres'::text NOT NULL,
  ADD COLUMN "file_name" text NOT NULL,
  ADD COLUMN "file_path" text NOT NULL,
  ADD COLUMN "mime_type" text,
  ADD COLUMN "created_by" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."travel_expenses"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "description" text NOT NULL,
  ADD COLUMN "amount" numeric(12,2) NOT NULL,
  ADD COLUMN "currency" text DEFAULT 'GBP'::text NOT NULL,
  ADD COLUMN "paid_by" text DEFAULT 'Compte comú'::text NOT NULL,
  ADD COLUMN "category" text DEFAULT 'Altres'::text NOT NULL,
  ADD COLUMN "expense_date" date,
  ADD COLUMN "place" text,
  ADD COLUMN "created_by" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "receipt_path" text;

ALTER TABLE "public"."travel_parking"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "parking_name" text,
  ADD COLUMN "reservation_code" text,
  ADD COLUMN "entry_at" timestamp with time zone,
  ADD COLUMN "exit_at" timestamp with time zone,
  ADD COLUMN "address" text,
  ADD COLUMN "floor" text,
  ADD COLUMN "zone" text,
  ADD COLUMN "spot" text,
  ADD COLUMN "notes" text,
  ADD COLUMN "latitude" double precision,
  ADD COLUMN "longitude" double precision,
  ADD COLUMN "photo_path" text,
  ADD COLUMN "updated_by" uuid,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_accommodation_documents"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "accommodation_id" uuid NOT NULL,
  ADD COLUMN "document_id" uuid NOT NULL,
  ADD COLUMN "document_role" text DEFAULT 'voucher'::text NOT NULL,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_accommodations"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "accommodation_type" text NOT NULL,
  ADD COLUMN "name" text NOT NULL,
  ADD COLUMN "address" text,
  ADD COLUMN "location_text" text,
  ADD COLUMN "latitude" double precision,
  ADD COLUMN "longitude" double precision,
  ADD COLUMN "check_in_at" timestamp with time zone,
  ADD COLUMN "check_out_at" timestamp with time zone,
  ADD COLUMN "time_zone" text NOT NULL,
  ADD COLUMN "booking_reference" text,
  ADD COLUMN "booking_provider" text,
  ADD COLUMN "reservation_status" text DEFAULT 'planning'::text NOT NULL,
  ADD COLUMN "phone" text,
  ADD COLUMN "email" text,
  ADD COLUMN "website_url" text,
  ADD COLUMN "room_number" text,
  ADD COLUMN "notes" text,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "updated_by" uuid,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "city" text,
  ADD COLUMN "postal_code" text,
  ADD COLUMN "region" text,
  ADD COLUMN "country" text,
  ADD COLUMN "check_in_completed_at" timestamp with time zone,
  ADD COLUMN "check_out_completed_at" timestamp with time zone,
  ADD COLUMN "check_in_date" date,
  ADD COLUMN "check_out_date" date;

ALTER TABLE "public"."trip_activities"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "title" text NOT NULL,
  ADD COLUMN "activity_type" text DEFAULT 'other'::text NOT NULL,
  ADD COLUMN "start_at" timestamp with time zone,
  ADD COLUMN "end_at" timestamp with time zone,
  ADD COLUMN "time_zone" text,
  ADD COLUMN "venue_name" text,
  ADD COLUMN "address" text,
  ADD COLUMN "city" text,
  ADD COLUMN "latitude" double precision,
  ADD COLUMN "longitude" double precision,
  ADD COLUMN "reservation_status" text DEFAULT 'planning'::text NOT NULL,
  ADD COLUMN "booking_reference" text,
  ADD COLUMN "provider" text,
  ADD COLUMN "contact_phone" text,
  ADD COLUMN "contact_email" text,
  ADD COLUMN "website_url" text,
  ADD COLUMN "people_count" integer,
  ADD COLUMN "amount" numeric(12,2),
  ADD COLUMN "currency" text,
  ADD COLUMN "notes" text,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "updated_by" uuid,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "completed_at" timestamp with time zone,
  ADD COLUMN "transport_mode" text,
  ADD COLUMN "transport_origin_name" text,
  ADD COLUMN "transport_origin_address" text,
  ADD COLUMN "transport_origin_city" text,
  ADD COLUMN "transport_destination_name" text,
  ADD COLUMN "transport_destination_address" text,
  ADD COLUMN "transport_destination_city" text,
  ADD COLUMN "transport_arrival_time_zone" text,
  ADD COLUMN "transport_service_number" text,
  ADD COLUMN "transport_seat" text,
  ADD COLUMN "transport_platform" text;

ALTER TABLE "public"."trip_activity_documents"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "activity_id" uuid NOT NULL,
  ADD COLUMN "document_id" uuid NOT NULL,
  ADD COLUMN "document_role" text NOT NULL,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_brief_operations"
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "brief_id" uuid NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "applied_revision" bigint NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE "public"."trip_briefs"
  ADD COLUMN "id" uuid NOT NULL,
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "revision" bigint DEFAULT 1 NOT NULL,
  ADD COLUMN "trip_id" uuid,
  ADD COLUMN "document" jsonb NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE "public"."trip_budget_setting_operations"
  ADD COLUMN "actor_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "result_revision" bigint NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_budget_settings"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "target_amount" numeric(14,2),
  ADD COLUMN "maximum_amount" numeric(14,2),
  ADD COLUMN "currency" text,
  ADD COLUMN "revision" bigint DEFAULT 1 NOT NULL,
  ADD COLUMN "updated_by" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_car_rental_documents"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "car_rental_id" uuid NOT NULL,
  ADD COLUMN "document_id" uuid NOT NULL,
  ADD COLUMN "document_role" text NOT NULL,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_car_rentals"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "provider" text,
  ADD COLUMN "booking_reference" text,
  ADD COLUMN "pickup_location" text,
  ADD COLUMN "pickup_city" text,
  ADD COLUMN "pickup_at" timestamp with time zone,
  ADD COLUMN "pickup_time_zone" text,
  ADD COLUMN "return_location" text,
  ADD COLUMN "return_city" text,
  ADD COLUMN "return_at" timestamp with time zone,
  ADD COLUMN "return_time_zone" text,
  ADD COLUMN "vehicle_class" text,
  ADD COLUMN "vehicle_model" text,
  ADD COLUMN "license_plate" text,
  ADD COLUMN "transmission" text,
  ADD COLUMN "fuel_policy" text,
  ADD COLUMN "pickup_fuel_level" text,
  ADD COLUMN "return_fuel_level" text,
  ADD COLUMN "pickup_mileage" integer,
  ADD COLUMN "return_mileage" integer,
  ADD COLUMN "insurance" text,
  ADD COLUMN "excess_amount" numeric(12,2),
  ADD COLUMN "excess_currency" text,
  ADD COLUMN "deposit_amount" numeric(12,2),
  ADD COLUMN "deposit_currency" text,
  ADD COLUMN "phone" text,
  ADD COLUMN "email" text,
  ADD COLUMN "website_url" text,
  ADD COLUMN "reservation_status" text DEFAULT 'planning'::text NOT NULL,
  ADD COLUMN "notes" text,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "updated_by" uuid,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_component_confirmation_operations"
  ADD COLUMN "actor_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "handoff_id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "component_id" text NOT NULL,
  ADD COLUMN "source_kind" text NOT NULL,
  ADD COLUMN "source_id" uuid NOT NULL,
  ADD COLUMN "confirmation_source" text DEFAULT 'user_manual'::text NOT NULL,
  ADD COLUMN "evidence_document_id" uuid,
  ADD COLUMN "evidence_role" text,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "confirmed_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL;

ALTER TABLE "public"."trip_component_cost_operations"
  ADD COLUMN "actor_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "component_id" text NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "result_revision" bigint NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_component_costs"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "component_id" text NOT NULL,
  ADD COLUMN "handoff_id" uuid,
  ADD COLUMN "source_kind" text NOT NULL,
  ADD COLUMN "source_id" uuid NOT NULL,
  ADD COLUMN "expected_amount" numeric(14,2),
  ADD COLUMN "confirmed_amount" numeric(14,2),
  ADD COLUMN "currency" text,
  ADD COLUMN "expected_quality" text DEFAULT 'unknown'::text NOT NULL,
  ADD COLUMN "verified_at" timestamp with time zone,
  ADD COLUMN "confirmed_at" timestamp with time zone,
  ADD COLUMN "scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN "unknown_required_costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN "excluded_costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN "evidence_document_id" uuid,
  ADD COLUMN "revision" bigint DEFAULT 1 NOT NULL,
  ADD COLUMN "updated_by" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_day_metadata"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "local_date" date NOT NULL,
  ADD COLUMN "title" text,
  ADD COLUMN "summary" text,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "updated_by" uuid,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_flight_documents"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "flight_id" uuid NOT NULL,
  ADD COLUMN "document_id" uuid NOT NULL,
  ADD COLUMN "document_role" text NOT NULL,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_flight_traveler_documents"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "flight_id" uuid NOT NULL,
  ADD COLUMN "traveler_id" uuid NOT NULL,
  ADD COLUMN "document_id" uuid NOT NULL,
  ADD COLUMN "document_role" text DEFAULT 'boarding_pass'::text NOT NULL,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_flight_travelers"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "flight_id" uuid NOT NULL,
  ADD COLUMN "traveler_id" uuid NOT NULL,
  ADD COLUMN "seat" text,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_flights"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "airline" text,
  ADD COLUMN "flight_number" text,
  ADD COLUMN "departure_airport_code" text,
  ADD COLUMN "departure_airport_name" text,
  ADD COLUMN "departure_city" text,
  ADD COLUMN "departure_at" timestamp with time zone,
  ADD COLUMN "departure_time_zone" text,
  ADD COLUMN "arrival_airport_code" text,
  ADD COLUMN "arrival_airport_name" text,
  ADD COLUMN "arrival_city" text,
  ADD COLUMN "arrival_at" timestamp with time zone,
  ADD COLUMN "arrival_time_zone" text,
  ADD COLUMN "booking_reference" text,
  ADD COLUMN "departure_terminal" text,
  ADD COLUMN "arrival_terminal" text,
  ADD COLUMN "seat" text,
  ADD COLUMN "baggage" text,
  ADD COLUMN "flight_status" text DEFAULT 'planning'::text NOT NULL,
  ADD COLUMN "notes" text,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "updated_by" uuid,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "completed_at" timestamp with time zone,
  ADD COLUMN "passengers" text;

ALTER TABLE "public"."trip_handoff_operations"
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "operation_id" uuid NOT NULL,
  ADD COLUMN "handoff_id" uuid NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE "public"."trip_itinerary_items"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "title" text NOT NULL,
  ADD COLUMN "timing_kind" text NOT NULL,
  ADD COLUMN "local_date" date,
  ADD COLUMN "starts_at" timestamp with time zone,
  ADD COLUMN "ends_at" timestamp with time zone,
  ADD COLUMN "time_zone" text,
  ADD COLUMN "daypart" text,
  ADD COLUMN "location_name" text,
  ADD COLUMN "address" text,
  ADD COLUMN "city" text,
  ADD COLUMN "notes" text,
  ADD COLUMN "status" text DEFAULT 'planned'::text NOT NULL,
  ADD COLUMN "is_fixed" boolean DEFAULT false NOT NULL,
  ADD COLUMN "is_optional" boolean DEFAULT false NOT NULL,
  ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "updated_by" uuid,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "approximate_start_time" time without time zone,
  ADD COLUMN "approximate_end_time" time without time zone;

ALTER TABLE "public"."trip_members"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "user_id" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_photo_metadata"
  ADD COLUMN "document_id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "local_date" date,
  ADD COLUMN "activity_id" uuid,
  ADD COLUMN "itinerary_item_id" uuid,
  ADD COLUMN "upload_batch_id" uuid,
  ADD COLUMN "selection_index" integer,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  ADD COLUMN "updated_by" uuid;

ALTER TABLE "public"."trip_place_snapshots"
  ADD COLUMN "handoff_id" uuid NOT NULL,
  ADD COLUMN "principal_binding_id" uuid NOT NULL,
  ADD COLUMN "bindings" jsonb NOT NULL;

ALTER TABLE "public"."trip_proposal_component_links"
  ADD COLUMN "handoff_id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "component_id" text NOT NULL,
  ADD COLUMN "accommodation_id" uuid,
  ADD COLUMN "flight_id" uuid,
  ADD COLUMN "activity_id" uuid;

ALTER TABLE "public"."trip_proposal_handoffs"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "brief_id" uuid NOT NULL,
  ADD COLUMN "brief_revision" bigint NOT NULL,
  ADD COLUMN "proposal_id" uuid NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "snapshot_hash" text NOT NULL,
  ADD COLUMN "mapping_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "request" jsonb NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE "public"."trip_proposals"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "generation_id" uuid NOT NULL,
  ADD COLUMN "position" smallint NOT NULL,
  ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "fingerprint" text NOT NULL,
  ADD COLUMN "document" jsonb NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_reminders"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "source_kind" text NOT NULL,
  ADD COLUMN "source_id" uuid NOT NULL,
  ADD COLUMN "reminder_kind" text NOT NULL,
  ADD COLUMN "title" text NOT NULL,
  ADD COLUMN "event_at" timestamp with time zone NOT NULL,
  ADD COLUMN "default_notify_before_minutes" integer NOT NULL,
  ADD COLUMN "scheduled_for" timestamp with time zone NOT NULL,
  ADD COLUMN "enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN "source_updated_at" timestamp with time zone NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_standalone_component_links"
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "component_id" text NOT NULL,
  ADD COLUMN "source_kind" text NOT NULL,
  ADD COLUMN "source_id" uuid NOT NULL,
  ADD COLUMN "created_by" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trip_stops"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "position" integer NOT NULL,
  ADD COLUMN "label" text NOT NULL,
  ADD COLUMN "canonical_name" text NOT NULL,
  ADD COLUMN "administrative_area" text,
  ADD COLUMN "country_code" text,
  ADD COLUMN "latitude" double precision NOT NULL,
  ADD COLUMN "longitude" double precision NOT NULL,
  ADD COLUMN "time_zone" text NOT NULL,
  ADD COLUMN "provider" text NOT NULL,
  ADD COLUMN "provider_place_id" text NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE "public"."trip_travelers"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "trip_id" uuid NOT NULL,
  ADD COLUMN "display_name" text NOT NULL,
  ADD COLUMN "created_by" uuid DEFAULT auth.uid(),
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;

ALTER TABLE "public"."trips"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  ADD COLUMN "name" text NOT NULL,
  ADD COLUMN "invite_code" text DEFAULT upper(substr(encode(gen_random_bytes(8), 'hex'::text), 1, 10)) NOT NULL,
  ADD COLUMN "owner_id" uuid NOT NULL,
  ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "time_zone" text,
  ADD COLUMN "start_date" date,
  ADD COLUMN "end_date" date,
  ADD COLUMN "experience_key" text,
  ADD COLUMN "discarded_at" timestamp with time zone,
  ADD COLUMN "discarded_by" uuid;

ALTER TABLE "app_private"."alb03_ingestions" ADD CONSTRAINT "alb03_ingestions_pkey" PRIMARY KEY (id);

ALTER TABLE "app_private"."alb03_requests" ADD CONSTRAINT "alb03_requests_pkey" PRIMARY KEY (actor_id, operation_id);

ALTER TABLE "place_private"."handoff_receipts" ADD CONSTRAINT "handoff_receipts_pkey" PRIMARY KEY (owner_id, operation_id);

ALTER TABLE "place_private"."operations" ADD CONSTRAINT "operations_pkey" PRIMARY KEY (owner_id, operation_id);

ALTER TABLE "place_private"."queries" ADD CONSTRAINT "queries_pkey" PRIMARY KEY (owner_id, query_hash);

ALTER TABLE "place_private"."quota" ADD CONSTRAINT "quota_pkey" PRIMARY KEY (bucket);

ALTER TABLE "place_private"."settings" ADD CONSTRAINT "settings_pkey" PRIMARY KEY (singleton);

ALTER TABLE "public"."checklist_items" ADD CONSTRAINT "checklist_items_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."itinerary_activities" ADD CONSTRAINT "itinerary_activities_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."places" ADD CONSTRAINT "places_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."proposal_operations" ADD CONSTRAINT "proposal_operations_pkey" PRIMARY KEY (owner_id, operation_id);

ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_pkey" PRIMARY KEY (asset_id, kind);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_book_composition_versions" ADD CONSTRAINT "travel_book_composition_versions_pkey" PRIMARY KEY (composition_id, version);

ALTER TABLE "public"."travel_book_compositions" ADD CONSTRAINT "travel_book_compositions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_book_editions" ADD CONSTRAINT "travel_book_editions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_book_operations" ADD CONSTRAINT "travel_book_operations_pkey" PRIMARY KEY (actor_id, operation_id);

ALTER TABLE "public"."travel_book_pages" ADD CONSTRAINT "travel_book_pages_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_book_resource_refs" ADD CONSTRAINT "travel_book_resource_refs_pkey" PRIMARY KEY (composition_id, composition_version, ref_key);

ALTER TABLE "public"."travel_book_revision_compositions" ADD CONSTRAINT "travel_book_revision_compositions_pkey" PRIMARY KEY (revision_id, composition_id);

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_books" ADD CONSTRAINT "travel_books_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_documents" ADD CONSTRAINT "travel_documents_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_expenses" ADD CONSTRAINT "travel_expenses_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."travel_parking" ADD CONSTRAINT "travel_parking_pkey" PRIMARY KEY (trip_id);

ALTER TABLE "public"."trip_accommodation_documents" ADD CONSTRAINT "trip_accommodation_documents_pkey" PRIMARY KEY (trip_id, accommodation_id, document_id);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_activity_documents" ADD CONSTRAINT "trip_activity_documents_pkey" PRIMARY KEY (trip_id, activity_id, document_role);

ALTER TABLE "public"."trip_brief_operations" ADD CONSTRAINT "trip_brief_operations_pkey" PRIMARY KEY (owner_id, operation_id);

ALTER TABLE "public"."trip_briefs" ADD CONSTRAINT "trip_briefs_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_budget_setting_operations" ADD CONSTRAINT "trip_budget_setting_operations_pkey" PRIMARY KEY (actor_id, operation_id);

ALTER TABLE "public"."trip_budget_settings" ADD CONSTRAINT "trip_budget_settings_pkey" PRIMARY KEY (trip_id);

ALTER TABLE "public"."trip_car_rental_documents" ADD CONSTRAINT "trip_car_rental_documents_pkey" PRIMARY KEY (trip_id, car_rental_id, document_id);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_component_confirmation_operations" ADD CONSTRAINT "trip_component_confirmation_operations_pkey" PRIMARY KEY (actor_id, operation_id);

ALTER TABLE "public"."trip_component_cost_operations" ADD CONSTRAINT "trip_component_cost_operations_pkey" PRIMARY KEY (actor_id, operation_id);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_pkey" PRIMARY KEY (trip_id, component_id);

ALTER TABLE "public"."trip_day_metadata" ADD CONSTRAINT "trip_day_metadata_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_flight_documents" ADD CONSTRAINT "trip_flight_documents_pkey" PRIMARY KEY (trip_id, flight_id, document_role, document_id);

ALTER TABLE "public"."trip_flight_traveler_documents" ADD CONSTRAINT "trip_flight_traveler_documents_pkey" PRIMARY KEY (trip_id, flight_id, traveler_id, document_role, document_id);

ALTER TABLE "public"."trip_flight_travelers" ADD CONSTRAINT "trip_flight_travelers_pkey" PRIMARY KEY (trip_id, flight_id, traveler_id);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_handoff_operations" ADD CONSTRAINT "trip_handoff_operations_pkey" PRIMARY KEY (owner_id, operation_id);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_members" ADD CONSTRAINT "trip_members_pkey" PRIMARY KEY (trip_id, user_id);

ALTER TABLE "public"."trip_photo_metadata" ADD CONSTRAINT "trip_photo_metadata_pkey" PRIMARY KEY (document_id);

ALTER TABLE "public"."trip_place_snapshots" ADD CONSTRAINT "trip_place_snapshots_pkey" PRIMARY KEY (handoff_id);

ALTER TABLE "public"."trip_proposal_component_links" ADD CONSTRAINT "trip_proposal_component_links_pkey" PRIMARY KEY (handoff_id, component_id);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_proposals" ADD CONSTRAINT "trip_proposals_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_reminders" ADD CONSTRAINT "trip_reminders_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_standalone_component_links" ADD CONSTRAINT "trip_standalone_component_links_pkey" PRIMARY KEY (trip_id, component_id);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trip_travelers" ADD CONSTRAINT "trip_travelers_pkey" PRIMARY KEY (id);

ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_pkey" PRIMARY KEY (id);

ALTER TABLE "app_private"."alb03_ingestions" ADD CONSTRAINT "alb03_ingestions_asset_id_key" UNIQUE (asset_id);

ALTER TABLE "app_private"."alb03_ingestions" ADD CONSTRAINT "alb03_ingestions_book_id_source_id_source_token_key" UNIQUE (book_id, source_id, source_token);

ALTER TABLE "public"."itinerary_activities" ADD CONSTRAINT "itinerary_activities_trip_stable_activity_key" UNIQUE (trip_id, stable_activity_id);

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_activity_subscription_kind_key" UNIQUE (activity_id, subscription_id, notification_kind);

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_owner_id_brief_id_proposal_id_subject_key_re_key" UNIQUE NULLS NOT DISTINCT (owner_id, brief_id, proposal_id, subject_key, revision);

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_place_id_content_hash_key" UNIQUE (place_id, content_hash);

ALTER TABLE "public"."places" ADD CONSTRAINT "places_provider_provider_place_id_key" UNIQUE (provider, provider_place_id);

ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_endpoint_trip_key" UNIQUE (endpoint, trip_id);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_book_id_asset_key_version_key" UNIQUE (book_id, asset_key, version);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_trip_id_book_id_id_key" UNIQUE (trip_id, book_id, id);

ALTER TABLE "public"."travel_book_composition_versions" ADD CONSTRAINT "travel_book_composition_versi_trip_id_book_id_edition_id_co_key" UNIQUE (trip_id, book_id, edition_id, composition_id, version);

ALTER TABLE "public"."travel_book_compositions" ADD CONSTRAINT "travel_book_compositions_trip_id_book_id_edition_id_id_key" UNIQUE (trip_id, book_id, edition_id, id);

ALTER TABLE "public"."travel_book_editions" ADD CONSTRAINT "travel_book_editions_trip_id_book_id_id_key" UNIQUE (trip_id, book_id, id);

ALTER TABLE "public"."travel_book_pages" ADD CONSTRAINT "travel_book_pages_composition_id_slot_key" UNIQUE (composition_id, slot);

ALTER TABLE "public"."travel_book_pages" ADD CONSTRAINT "travel_book_pages_edition_id_position_key" UNIQUE (edition_id, "position") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "public"."travel_book_pages" ADD CONSTRAINT "travel_book_pages_trip_id_book_id_edition_id_id_key" UNIQUE (trip_id, book_id, edition_id, id);

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_edition_id_revision_number_key" UNIQUE (edition_id, revision_number);

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_trip_id_book_id_edition_id_id_key" UNIQUE (trip_id, book_id, edition_id, id);

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_trip_id_book_id_id_key" UNIQUE (trip_id, book_id, id);

ALTER TABLE "public"."travel_books" ADD CONSTRAINT "travel_books_trip_id_id_key" UNIQUE (trip_id, id);

ALTER TABLE "public"."travel_documents" ADD CONSTRAINT "travel_documents_file_path_key" UNIQUE (file_path);

ALTER TABLE "public"."travel_documents" ADD CONSTRAINT "travel_documents_trip_id_id_key" UNIQUE (trip_id, id);

ALTER TABLE "public"."trip_accommodation_documents" ADD CONSTRAINT "trip_accommodation_documents_one_role_key" UNIQUE (trip_id, accommodation_id, document_role);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_trip_id_id_key" UNIQUE (trip_id, id);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_trip_id_id_key" UNIQUE (trip_id, id);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_trip_id_id_key" UNIQUE (trip_id, id);

ALTER TABLE "public"."trip_day_metadata" ADD CONSTRAINT "trip_day_metadata_trip_date_key" UNIQUE (trip_id, local_date);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_trip_id_id_key" UNIQUE (trip_id, id);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_trip_id_id_key" UNIQUE (trip_id, id);

ALTER TABLE "public"."trip_photo_metadata" ADD CONSTRAINT "trip_photo_metadata_trip_id_upload_batch_id_selection_index_key" UNIQUE (trip_id, upload_batch_id, selection_index);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_brief_id_key" UNIQUE (brief_id);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_id_trip_id_key" UNIQUE (id, trip_id);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_proposal_id_key" UNIQUE (proposal_id);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_trip_id_key" UNIQUE (trip_id);

ALTER TABLE "public"."trip_proposals" ADD CONSTRAINT "trip_proposals_generation_id_fingerprint_key" UNIQUE (generation_id, fingerprint);

ALTER TABLE "public"."trip_proposals" ADD CONSTRAINT "trip_proposals_generation_id_position_key" UNIQUE (generation_id, "position");

ALTER TABLE "public"."trip_reminders" ADD CONSTRAINT "trip_reminders_source_unique" UNIQUE (trip_id, source_kind, source_id, reminder_kind);

ALTER TABLE "public"."trip_standalone_component_links" ADD CONSTRAINT "trip_standalone_component_lin_trip_id_source_kind_source_id_key" UNIQUE (trip_id, source_kind, source_id);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_trip_id_position_key" UNIQUE (trip_id, "position");

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_trip_id_provider_provider_place_id_key" UNIQUE (trip_id, provider, provider_place_id);

ALTER TABLE "public"."trip_travelers" ADD CONSTRAINT "trip_travelers_trip_id_id_key" UNIQUE (trip_id, id);

ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_invite_code_key" UNIQUE (invite_code);

ALTER TABLE "app_private"."alb03_ingestions" ADD CONSTRAINT "alb03_ingestions_error_code_check" CHECK (error_code = ANY (ARRAY['SOURCE_MISSING'::text, 'SOURCE_CHANGED'::text, 'INVALID_IMAGE'::text, 'LIMIT_EXCEEDED'::text, 'STORAGE_ERROR'::text, 'MASTER_MISSING'::text, 'DERIVATIVE_UNSUPPORTED'::text, 'DERIVATIVE_CAPACITY'::text, 'DERIVATIVE_COLOR'::text, 'DERIVATIVE_FAILED'::text]));

ALTER TABLE "app_private"."alb03_ingestions" ADD CONSTRAINT "alb03_ingestions_source_hash_check" CHECK (source_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "app_private"."alb03_ingestions" ADD CONSTRAINT "alb03_ingestions_source_orientation_check" CHECK (source_orientation >= 0 AND source_orientation <= 8);

ALTER TABLE "place_private"."settings" ADD CONSTRAINT "settings_fresh_days_check" CHECK (fresh_days >= 1 AND fresh_days <= 365);

ALTER TABLE "place_private"."settings" ADD CONSTRAINT "settings_singleton_check" CHECK (singleton);

ALTER TABLE "public"."checklist_items" ADD CONSTRAINT "checklist_items_category_not_blank" CHECK (category IS NULL OR category = btrim(category) AND char_length(category) >= 1 AND char_length(category) <= 50);

ALTER TABLE "public"."checklist_items" ADD CONSTRAINT "checklist_items_template_key_not_blank" CHECK (template_key IS NULL OR template_key = btrim(template_key) AND char_length(template_key) >= 1 AND char_length(template_key) <= 100);

ALTER TABLE "public"."checklist_items" ADD CONSTRAINT "checklist_items_text_check" CHECK (char_length(TRIM(BOTH FROM text)) >= 1 AND char_length(TRIM(BOTH FROM text)) <= 300);

ALTER TABLE "public"."itinerary_activities" ADD CONSTRAINT "itinerary_activities_description_length" CHECK (description IS NULL OR char_length(description) >= 1 AND char_length(description) <= 2000);

ALTER TABLE "public"."itinerary_activities" ADD CONSTRAINT "itinerary_activities_notify_before_minutes_range" CHECK (notify_before_minutes >= 1 AND notify_before_minutes <= 10080);

ALTER TABLE "public"."itinerary_activities" ADD CONSTRAINT "itinerary_activities_stable_activity_id_not_blank" CHECK (stable_activity_id = btrim(stable_activity_id) AND char_length(stable_activity_id) >= 1 AND char_length(stable_activity_id) <= 200);

ALTER TABLE "public"."itinerary_activities" ADD CONSTRAINT "itinerary_activities_time_zone_not_blank" CHECK (time_zone IS NULL OR time_zone = btrim(time_zone) AND char_length(time_zone) >= 1 AND char_length(time_zone) <= 100);

ALTER TABLE "public"."itinerary_activities" ADD CONSTRAINT "itinerary_activities_title_not_blank" CHECK (title = btrim(title) AND char_length(title) >= 1 AND char_length(title) <= 200);

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_attempt_count_nonnegative" CHECK (attempt_count >= 0);

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_exactly_one_source" CHECK (activity_id IS NOT NULL AND reminder_id IS NULL OR activity_id IS NULL AND reminder_id IS NOT NULL);

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_last_error_code_length" CHECK (last_error_code IS NULL OR last_error_code = btrim(last_error_code) AND char_length(last_error_code) >= 1 AND char_length(last_error_code) <= 100);

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_kind_not_blank" CHECK (notification_kind = btrim(notification_kind) AND char_length(notification_kind) >= 1 AND char_length(notification_kind) <= 100);

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_status_valid" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'retry'::text, 'sent'::text, 'gone'::text, 'failed'::text, 'missed'::text]));

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_check" CHECK ((state = 'resolved'::text) = (place_version_id IS NOT NULL));

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_original_text_check" CHECK (length(original_text) >= 1 AND length(original_text) <= 500);

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_revision_check" CHECK (revision > 0);

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_selection_method_check" CHECK (selection_method = ANY (ARRAY['user_selected'::text, 'reused_binding'::text]));

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_state_check" CHECK (state = ANY (ARRAY['unresolved'::text, 'ambiguous'::text, 'needs_confirmation'::text, 'resolved'::text, 'stale'::text]));

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_subject_key_check" CHECK (length(subject_key) >= 1 AND length(subject_key) <= 200);

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_canonical_name_check" CHECK (length(canonical_name) >= 1 AND length(canonical_name) <= 500);

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_check" CHECK ((timezone_status = 'verified'::text) = (timezone IS NOT NULL));

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_coordinate_role_check" CHECK (coordinate_role = ANY (ARRAY['representative_point'::text, 'exact_location'::text]));

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_country_code_check" CHECK (country_code ~ '^[A-Z]{2}$'::text);

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_latitude_check" CHECK (latitude >= '-90'::integer::double precision AND latitude <= 90::double precision);

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_longitude_check" CHECK (longitude >= '-180'::integer::double precision AND longitude <= 180::double precision);

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_timezone_status_check" CHECK (timezone_status = ANY (ARRAY['verified'::text, 'needs_specific_location'::text, 'unavailable'::text]));

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_exclusions_limit" CHECK (jsonb_typeof(excluded_routes) = 'array'::text AND octet_length(excluded_routes::text) <= 524288);

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_attempt_number_check" CHECK (attempt_number >= 0);

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_brief_revision_check" CHECK (brief_revision > 0);

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_brief_schema_version_check" CHECK (brief_schema_version = 1);

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_brief_snapshot_check" CHECK (trip_brief_valid_v1(brief_snapshot));

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_check" CHECK (status <> 'running'::text OR attempt_token IS NOT NULL AND lease_expires_at IS NOT NULL);

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_check1" CHECK (status <> 'no_results'::text OR result_reason IS NOT NULL);

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_check2" CHECK (status <> 'failed'::text OR error_code IS NOT NULL);

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_result_reason_check" CHECK (result_reason = ANY (ARRAY['incompatible'::text, 'insufficient_information'::text, 'no_new_alternatives'::text]));

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'no_results'::text, 'failed'::text, 'obsolete'::text]));

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_refinement_valid" CHECK (proposal_private.refinement_valid(refinement));

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_round_positive" CHECK (round_number IS NULL OR round_number > 0);

ALTER TABLE "public"."proposal_operations" ADD CONSTRAINT "proposal_operations_action_check" CHECK (action = ANY (ARRAY['generate'::text, 'retry'::text, 'explore_more'::text]));

ALTER TABLE "public"."proposal_operations" ADD CONSTRAINT "proposal_operations_request_check" CHECK (octet_length(request::text) <= 4096);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_byte_size_check" CHECK (byte_size >= 1 AND byte_size <= 33554432);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_check" CHECK (mime_type = 'image/jpeg'::text AND file_extension = 'jpg'::text OR mime_type = 'image/png'::text AND file_extension = 'png'::text OR mime_type = 'image/webp'::text AND file_extension = 'webp'::text OR mime_type = 'image/heic'::text AND file_extension = 'heic'::text OR mime_type = 'image/heif'::text AND file_extension = 'heif'::text);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_check1" CHECK ((width_px::bigint * height_px) <= 200000000);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_check2" CHECK (kind = 'original'::text OR mime_type = 'image/png'::text AND orientation = 1 AND GREATEST(width_px, height_px) <= 1600);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_check3" CHECK (kind <> 'thumbnail'::text OR GREATEST(width_px, height_px) <= 320);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_content_hash_check" CHECK (content_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_height_px_check" CHECK (height_px >= 1 AND height_px <= 32768);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_kind_check" CHECK (kind = ANY (ARRAY['original'::text, 'preview'::text, 'thumbnail'::text]));

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_orientation_check" CHECK (orientation >= 0 AND orientation <= 8);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_pipeline_version_check" CHECK (pipeline_version = 1);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_storage_bucket_check" CHECK (storage_bucket = 'travel-book'::text);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_storage_path_check" CHECK (length(storage_path) < 1024 AND storage_path !~ '(^/|://|\?|\.\.)'::text);

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_width_px_check" CHECK (width_px >= 1 AND width_px <= 32768);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_check" CHECK ((storage_bucket IS NULL) = (storage_path IS NULL));

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_check1" CHECK (storage_bucket IS NULL OR length(storage_bucket) >= 1 AND length(storage_bucket) <= 100 AND length(storage_path) >= 1 AND length(storage_path) <= 1024 AND storage_path !~ '(^/|://|\?|(^|/)\.\.(/|$))'::text);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_check2" CHECK (status <> 'ready'::text OR content_hash IS NOT NULL AND mime_type IS NOT NULL AND width_px IS NOT NULL AND height_px IS NOT NULL AND storage_path IS NOT NULL AND verified_at IS NOT NULL);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_content_hash_check" CHECK (content_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_height_px_check" CHECK (height_px > 0);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_kind_check" CHECK (kind = 'image'::text);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_mime_type_check" CHECK (mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]));

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'ready'::text, 'missing'::text]));

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_version_check" CHECK (version >= 1);

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_width_px_check" CHECK (width_px > 0);

ALTER TABLE "public"."travel_book_composition_versions" ADD CONSTRAINT "travel_book_composition_versions_check" CHECK ((document ->> 'composition_id'::text) = composition_id::text);

ALTER TABLE "public"."travel_book_composition_versions" ADD CONSTRAINT "travel_book_composition_versions_document_check" CHECK (app_private.travel_book_composition_valid_v1(document));

ALTER TABLE "public"."travel_book_composition_versions" ADD CONSTRAINT "travel_book_composition_versions_hash_version_check" CHECK (hash_version = 1);

ALTER TABLE "public"."travel_book_composition_versions" ADD CONSTRAINT "travel_book_composition_versions_schema_version_check" CHECK (schema_version = 1);

ALTER TABLE "public"."travel_book_composition_versions" ADD CONSTRAINT "travel_book_composition_versions_version_check" CHECK (version >= 1 AND version <= '9007199254740991'::bigint);

ALTER TABLE "public"."travel_book_compositions" ADD CONSTRAINT "travel_book_compositions_check" CHECK ((removed_at IS NULL) = (removed_by IS NULL));

ALTER TABLE "public"."travel_book_compositions" ADD CONSTRAINT "travel_book_compositions_current_version_check" CHECK (current_version >= 1 AND current_version <= '9007199254740991'::bigint);

ALTER TABLE "public"."travel_book_compositions" ADD CONSTRAINT "travel_book_compositions_kind_check" CHECK (kind = ANY (ARRAY['page'::text, 'spread'::text]));

ALTER TABLE "public"."travel_book_editions" ADD CONSTRAINT "travel_book_editions_next_revision_number_check" CHECK (next_revision_number >= 1 AND next_revision_number <= '9007199254740991'::bigint);

ALTER TABLE "public"."travel_book_editions" ADD CONSTRAINT "travel_book_editions_structure_version_check" CHECK (structure_version >= 1 AND structure_version <= '9007199254740991'::bigint);

ALTER TABLE "public"."travel_book_editions" ADD CONSTRAINT "travel_book_editions_title_check" CHECK (title = btrim(title) AND length(title) >= 1 AND length(title) <= 160);

ALTER TABLE "public"."travel_book_operations" ADD CONSTRAINT "travel_book_operations_operation_type_check" CHECK (operation_type = ANY (ARRAY['create_book'::text, 'create_edition'::text, 'structure'::text, 'save'::text, 'revision'::text]));

ALTER TABLE "public"."travel_book_operations" ADD CONSTRAINT "travel_book_operations_request_check" CHECK (jsonb_typeof(request) = 'object'::text AND octet_length(request::text) <= 1048576);

ALTER TABLE "public"."travel_book_operations" ADD CONSTRAINT "travel_book_operations_result_check" CHECK (jsonb_typeof(result) = 'object'::text AND octet_length(result::text) <= 262144);

ALTER TABLE "public"."travel_book_operations" ADD CONSTRAINT "travel_book_operations_status_check" CHECK (status = 'applied'::text);

ALTER TABLE "public"."travel_book_pages" ADD CONSTRAINT "travel_book_pages_position_check" CHECK ("position" >= 0);

ALTER TABLE "public"."travel_book_pages" ADD CONSTRAINT "travel_book_pages_slot_check" CHECK (slot = ANY (ARRAY[0, 1]));

ALTER TABLE "public"."travel_book_resource_refs" ADD CONSTRAINT "travel_book_resource_refs_check" CHECK (resource_kind = 'asset'::text AND usage = 'image'::text AND asset_id IS NOT NULL AND source_snapshot_id IS NULL OR resource_kind = 'source_snapshot'::text AND usage = 'text_source'::text AND source_snapshot_id IS NOT NULL AND asset_id IS NULL);

ALTER TABLE "public"."travel_book_resource_refs" ADD CONSTRAINT "travel_book_resource_refs_ref_key_check" CHECK (length(ref_key) <= 120);

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_hash_version_check" CHECK (hash_version = 1);

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_manifest_check" CHECK (jsonb_typeof(manifest) = 'object'::text);

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_resource_state_at_capture_check" CHECK (resource_state_at_capture = ANY (ARRAY['complete'::text, 'incomplete'::text]));

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_revision_number_check" CHECK (revision_number >= 1 AND revision_number <= '9007199254740991'::bigint);

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_schema_version_check" CHECK (schema_version = 1);

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_structure_version_check" CHECK (structure_version >= 1 AND structure_version <= '9007199254740991'::bigint);

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_availability_at_capture_check" CHECK (availability_at_capture = ANY (ARRAY['available'::text, 'unavailable'::text]));

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_check" CHECK (origin = 'trip_source'::text AND source_kind <> 'editorial'::text AND source_id IS NOT NULL OR origin = 'explicit_editorial_input'::text AND source_kind = 'editorial'::text AND source_id IS NULL);

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_classification_check" CHECK (classification = ANY (ARRAY['context'::text, 'user_statement'::text, 'source_evidence'::text]));

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_hash_version_check" CHECK (hash_version = 1);

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_origin_check" CHECK (origin = ANY (ARRAY['trip_source'::text, 'explicit_editorial_input'::text]));

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_payload_check" CHECK (app_private.travel_book_snapshot_valid_v1(payload));

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_schema_version_check" CHECK (schema_version = 1);

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_source_kind_check" CHECK (source_kind = ANY (ARRAY['trip'::text, 'photo'::text, 'day'::text, 'activity'::text, 'planning'::text, 'accommodation'::text, 'flight'::text, 'stop'::text, 'car_rental'::text, 'editorial'::text]));

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_source_version_check" CHECK (length(source_version) <= 200);

ALTER TABLE "public"."travel_books" ADD CONSTRAINT "travel_books_title_check" CHECK (title = btrim(title) AND length(title) >= 1 AND length(title) <= 160);

ALTER TABLE "public"."travel_expenses" ADD CONSTRAINT "travel_expenses_amount_check" CHECK (amount > 0::numeric);

ALTER TABLE "public"."travel_expenses" ADD CONSTRAINT "travel_expenses_currency_check" CHECK (currency = ANY (ARRAY['GBP'::text, 'EUR'::text]));

ALTER TABLE "public"."travel_expenses" ADD CONSTRAINT "travel_expenses_paid_by_check" CHECK (paid_by = ANY (ARRAY['Eva'::text, 'Xesc'::text, 'Compte comú'::text]));

ALTER TABLE "public"."trip_accommodation_documents" ADD CONSTRAINT "trip_accommodation_documents_role_check" CHECK (document_role = 'voucher'::text);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_address_check" CHECK (address IS NULL OR address = btrim(address) AND char_length(address) >= 1 AND char_length(address) <= 500);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_booking_provider_check" CHECK (booking_provider IS NULL OR booking_provider = btrim(booking_provider) AND char_length(booking_provider) >= 1 AND char_length(booking_provider) <= 200);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_booking_reference_check" CHECK (booking_reference IS NULL OR booking_reference = btrim(booking_reference) AND char_length(booking_reference) >= 1 AND char_length(booking_reference) <= 200);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_city_check" CHECK (city IS NULL OR city = btrim(city) AND city ~ '[^[:space:]]'::text AND char_length(city) >= 1 AND char_length(city) <= 200);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_coordinates_pair_check" CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_country_check" CHECK (country IS NULL OR country = btrim(country) AND country ~ '[^[:space:]]'::text AND char_length(country) >= 1 AND char_length(country) <= 200);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_date_order_check" CHECK (check_in_date IS NULL OR check_out_date IS NULL OR check_out_date >= check_in_date);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_dates_check" CHECK (check_in_at IS NULL OR check_out_at IS NULL OR check_out_at > check_in_at);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_email_check" CHECK (email IS NULL OR email = btrim(email) AND char_length(email) >= 1 AND char_length(email) <= 254);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_latitude_check" CHECK (latitude IS NULL OR latitude >= '-90'::integer::double precision AND latitude <= 90::double precision);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_location_text_check" CHECK (location_text IS NULL OR location_text = btrim(location_text) AND char_length(location_text) >= 1 AND char_length(location_text) <= 200);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_longitude_check" CHECK (longitude IS NULL OR longitude >= '-180'::integer::double precision AND longitude <= 180::double precision);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_name_check" CHECK (name = btrim(name) AND char_length(name) >= 1 AND char_length(name) <= 200);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_notes_check" CHECK (notes IS NULL OR notes = btrim(notes) AND char_length(notes) >= 1 AND char_length(notes) <= 4000);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_phone_check" CHECK (phone IS NULL OR phone = btrim(phone) AND char_length(phone) >= 1 AND char_length(phone) <= 50);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_postal_code_check" CHECK (postal_code IS NULL OR postal_code = btrim(postal_code) AND postal_code ~ '[^[:space:]]'::text AND char_length(postal_code) >= 1 AND char_length(postal_code) <= 40);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_region_check" CHECK (region IS NULL OR region = btrim(region) AND region ~ '[^[:space:]]'::text AND char_length(region) >= 1 AND char_length(region) <= 200);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_reservation_status_check" CHECK (reservation_status = ANY (ARRAY['planning'::text, 'reserved'::text, 'confirmed'::text, 'cancelled'::text]));

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_room_number_check" CHECK (room_number IS NULL OR room_number = btrim(room_number) AND char_length(room_number) >= 1 AND char_length(room_number) <= 100);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_time_zone_check" CHECK (time_zone = btrim(time_zone) AND char_length(time_zone) >= 1 AND char_length(time_zone) <= 100);

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_type_check" CHECK (accommodation_type = ANY (ARRAY['hotel'::text, 'apartment'::text, 'house'::text, 'hostel'::text, 'resort'::text, 'other'::text]));

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_website_url_check" CHECK (website_url IS NULL OR website_url = btrim(website_url) AND char_length(website_url) >= 1 AND char_length(website_url) <= 2048 AND website_url ~* '^https?://[^[:space:]]+$'::text);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_address_check" CHECK (address IS NULL OR address = btrim(address) AND char_length(address) >= 1 AND char_length(address) <= 500);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_amount_check" CHECK (amount IS NULL OR amount >= 0::numeric);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_amount_currency_check" CHECK (amount IS NULL OR currency IS NOT NULL);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_booking_reference_check" CHECK (booking_reference IS NULL OR booking_reference = btrim(booking_reference) AND char_length(booking_reference) >= 1 AND char_length(booking_reference) <= 200);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_city_check" CHECK (city IS NULL OR city = btrim(city) AND char_length(city) >= 1 AND char_length(city) <= 200);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_contact_email_check" CHECK (contact_email IS NULL OR contact_email = btrim(contact_email) AND char_length(contact_email) >= 1 AND char_length(contact_email) <= 254);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_contact_phone_check" CHECK (contact_phone IS NULL OR contact_phone = btrim(contact_phone) AND char_length(contact_phone) >= 1 AND char_length(contact_phone) <= 50);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_coordinates_pair_check" CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_currency_check" CHECK (currency IS NULL OR currency = upper(btrim(currency)) AND currency ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_dates_check" CHECK (start_at IS NULL OR end_at IS NULL OR end_at > start_at);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_end_requires_start_check" CHECK (end_at IS NULL OR start_at IS NOT NULL);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_latitude_check" CHECK (latitude IS NULL OR latitude >= '-90'::integer::double precision AND latitude <= 90::double precision);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_longitude_check" CHECK (longitude IS NULL OR longitude >= '-180'::integer::double precision AND longitude <= 180::double precision);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_notes_check" CHECK (notes IS NULL OR notes = btrim(notes) AND char_length(notes) >= 1 AND char_length(notes) <= 4000);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_people_count_check" CHECK (people_count IS NULL OR people_count >= 1 AND people_count <= 10000);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_provider_check" CHECK (provider IS NULL OR provider = btrim(provider) AND char_length(provider) >= 1 AND char_length(provider) <= 200);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_reservation_status_check" CHECK (reservation_status = ANY (ARRAY['planning'::text, 'reserved'::text, 'confirmed'::text, 'cancelled'::text]));

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_time_zone_check" CHECK (time_zone IS NULL OR time_zone = btrim(time_zone) AND char_length(time_zone) >= 1 AND char_length(time_zone) <= 100);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_time_zone_required_check" CHECK (start_at IS NULL AND end_at IS NULL OR time_zone IS NOT NULL);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_title_check" CHECK (title = btrim(title) AND char_length(title) >= 1 AND char_length(title) <= 200);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_arrival_time_zone_check" CHECK (transport_arrival_time_zone IS NULL OR transport_arrival_time_zone = btrim(transport_arrival_time_zone) AND char_length(transport_arrival_time_zone) >= 1 AND char_length(transport_arrival_time_zone) <= 100);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_destination_address_check" CHECK (transport_destination_address IS NULL OR transport_destination_address = btrim(transport_destination_address) AND char_length(transport_destination_address) >= 1 AND char_length(transport_destination_address) <= 500);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_destination_city_check" CHECK (transport_destination_city IS NULL OR transport_destination_city = btrim(transport_destination_city) AND char_length(transport_destination_city) >= 1 AND char_length(transport_destination_city) <= 200);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_destination_name_check" CHECK (transport_destination_name IS NULL OR transport_destination_name = btrim(transport_destination_name) AND char_length(transport_destination_name) >= 1 AND char_length(transport_destination_name) <= 200);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_fields_scope_check" CHECK ((activity_type = ANY (ARRAY['transport'::text, 'transport_activity'::text])) OR transport_mode IS NULL AND transport_origin_name IS NULL AND transport_origin_address IS NULL AND transport_origin_city IS NULL AND transport_destination_name IS NULL AND transport_destination_address IS NULL AND transport_destination_city IS NULL AND transport_arrival_time_zone IS NULL AND transport_service_number IS NULL AND transport_seat IS NULL AND transport_platform IS NULL);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_mode_check" CHECK (transport_mode IS NULL OR (transport_mode = ANY (ARRAY['train'::text, 'bus'::text, 'ferry'::text, 'transfer'::text, 'taxi'::text, 'vtc'::text, 'metro'::text, 'tram'::text, 'public_transport'::text, 'other'::text])));

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_origin_address_check" CHECK (transport_origin_address IS NULL OR transport_origin_address = btrim(transport_origin_address) AND char_length(transport_origin_address) >= 1 AND char_length(transport_origin_address) <= 500);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_origin_city_check" CHECK (transport_origin_city IS NULL OR transport_origin_city = btrim(transport_origin_city) AND char_length(transport_origin_city) >= 1 AND char_length(transport_origin_city) <= 200);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_origin_name_check" CHECK (transport_origin_name IS NULL OR transport_origin_name = btrim(transport_origin_name) AND char_length(transport_origin_name) >= 1 AND char_length(transport_origin_name) <= 200);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_platform_check" CHECK (transport_platform IS NULL OR transport_platform = btrim(transport_platform) AND char_length(transport_platform) >= 1 AND char_length(transport_platform) <= 100);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_seat_check" CHECK (transport_seat IS NULL OR transport_seat = btrim(transport_seat) AND char_length(transport_seat) >= 1 AND char_length(transport_seat) <= 100);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_transport_service_number_check" CHECK (transport_service_number IS NULL OR transport_service_number = btrim(transport_service_number) AND char_length(transport_service_number) >= 1 AND char_length(transport_service_number) <= 100);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_type_check" CHECK (activity_type = btrim(activity_type) AND char_length(activity_type) >= 1 AND char_length(activity_type) <= 50 AND activity_type ~ '^[a-z][a-z0-9_]*$'::text);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_venue_name_check" CHECK (venue_name IS NULL OR venue_name = btrim(venue_name) AND char_length(venue_name) >= 1 AND char_length(venue_name) <= 200);

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_website_url_check" CHECK (website_url IS NULL OR website_url = btrim(website_url) AND char_length(website_url) >= 1 AND char_length(website_url) <= 2048 AND website_url ~* '^https?://[^[:space:]]+$'::text);

ALTER TABLE "public"."trip_activity_documents" ADD CONSTRAINT "trip_activity_documents_role_check" CHECK (document_role = ANY (ARRAY['booking'::text, 'ticket'::text]));

ALTER TABLE "public"."trip_brief_operations" ADD CONSTRAINT "trip_brief_operations_applied_revision_check" CHECK (applied_revision > 0);

ALTER TABLE "public"."trip_brief_operations" ADD CONSTRAINT "trip_brief_operations_request_check" CHECK (octet_length(request::text) <= 262144);

ALTER TABLE "public"."trip_briefs" ADD CONSTRAINT "trip_briefs_document_check" CHECK (trip_brief_valid_v1(document));

ALTER TABLE "public"."trip_briefs" ADD CONSTRAINT "trip_briefs_revision_check" CHECK (revision >= 1 AND revision <= '9007199254740991'::bigint);

ALTER TABLE "public"."trip_briefs" ADD CONSTRAINT "trip_briefs_schema_version_check" CHECK (schema_version = 1);

ALTER TABLE "public"."trip_budget_settings" ADD CONSTRAINT "trip_budget_settings_check" CHECK (target_amount IS NULL OR maximum_amount IS NULL OR maximum_amount >= target_amount);

ALTER TABLE "public"."trip_budget_settings" ADD CONSTRAINT "trip_budget_settings_check1" CHECK (target_amount IS NULL AND maximum_amount IS NULL AND currency IS NULL OR currency IS NOT NULL);

ALTER TABLE "public"."trip_budget_settings" ADD CONSTRAINT "trip_budget_settings_currency_check" CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."trip_budget_settings" ADD CONSTRAINT "trip_budget_settings_maximum_amount_check" CHECK (maximum_amount IS NULL OR maximum_amount >= 0::numeric);

ALTER TABLE "public"."trip_budget_settings" ADD CONSTRAINT "trip_budget_settings_revision_check" CHECK (revision > 0);

ALTER TABLE "public"."trip_budget_settings" ADD CONSTRAINT "trip_budget_settings_target_amount_check" CHECK (target_amount IS NULL OR target_amount >= 0::numeric);

ALTER TABLE "public"."trip_car_rental_documents" ADD CONSTRAINT "trip_car_rental_documents_role_check" CHECK (document_role = ANY (ARRAY['reservation'::text, 'contract'::text, 'insurance'::text, 'pickup_photo'::text, 'return_photo'::text]));

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_booking_reference_check" CHECK (booking_reference IS NULL OR booking_reference = btrim(booking_reference) AND char_length(booking_reference) >= 1 AND char_length(booking_reference) <= 200);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_dates_check" CHECK (pickup_at IS NULL OR return_at IS NULL OR return_at > pickup_at);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_deposit_amount_check" CHECK (deposit_amount IS NULL OR deposit_amount >= 0::numeric);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_deposit_currency_check" CHECK (deposit_currency IS NULL OR deposit_currency ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_deposit_pair_check" CHECK ((deposit_amount IS NULL) = (deposit_currency IS NULL));

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_email_check" CHECK (email IS NULL OR email = btrim(email) AND char_length(email) >= 1 AND char_length(email) <= 254);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_excess_amount_check" CHECK (excess_amount IS NULL OR excess_amount >= 0::numeric);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_excess_currency_check" CHECK (excess_currency IS NULL OR excess_currency ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_excess_pair_check" CHECK ((excess_amount IS NULL) = (excess_currency IS NULL));

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_fuel_policy_check" CHECK (fuel_policy IS NULL OR fuel_policy = btrim(fuel_policy) AND char_length(fuel_policy) >= 1 AND char_length(fuel_policy) <= 200);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_insurance_check" CHECK (insurance IS NULL OR insurance = btrim(insurance) AND char_length(insurance) >= 1 AND char_length(insurance) <= 500);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_license_plate_check" CHECK (license_plate IS NULL OR license_plate = btrim(license_plate) AND char_length(license_plate) >= 1 AND char_length(license_plate) <= 40);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_mileage_order_check" CHECK (pickup_mileage IS NULL OR return_mileage IS NULL OR return_mileage >= pickup_mileage);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_notes_check" CHECK (notes IS NULL OR notes = btrim(notes) AND char_length(notes) >= 1 AND char_length(notes) <= 4000);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_phone_check" CHECK (phone IS NULL OR phone = btrim(phone) AND char_length(phone) >= 1 AND char_length(phone) <= 50);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_pickup_city_check" CHECK (pickup_city IS NULL OR pickup_city = btrim(pickup_city) AND char_length(pickup_city) >= 1 AND char_length(pickup_city) <= 200);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_pickup_fuel_check" CHECK (pickup_fuel_level IS NULL OR pickup_fuel_level = btrim(pickup_fuel_level) AND char_length(pickup_fuel_level) >= 1 AND char_length(pickup_fuel_level) <= 80);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_pickup_location_check" CHECK (pickup_location IS NULL OR pickup_location = btrim(pickup_location) AND char_length(pickup_location) >= 1 AND char_length(pickup_location) <= 500);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_pickup_mileage_check" CHECK (pickup_mileage IS NULL OR pickup_mileage >= 0);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_pickup_time_zone_check" CHECK (pickup_time_zone IS NULL OR pickup_time_zone = btrim(pickup_time_zone) AND char_length(pickup_time_zone) >= 1 AND char_length(pickup_time_zone) <= 100);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_pickup_zone_required" CHECK (pickup_at IS NULL OR pickup_time_zone IS NOT NULL);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_provider_check" CHECK (provider IS NULL OR provider = btrim(provider) AND char_length(provider) >= 1 AND char_length(provider) <= 200);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_return_city_check" CHECK (return_city IS NULL OR return_city = btrim(return_city) AND char_length(return_city) >= 1 AND char_length(return_city) <= 200);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_return_fuel_check" CHECK (return_fuel_level IS NULL OR return_fuel_level = btrim(return_fuel_level) AND char_length(return_fuel_level) >= 1 AND char_length(return_fuel_level) <= 80);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_return_location_check" CHECK (return_location IS NULL OR return_location = btrim(return_location) AND char_length(return_location) >= 1 AND char_length(return_location) <= 500);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_return_mileage_check" CHECK (return_mileage IS NULL OR return_mileage >= 0);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_return_time_zone_check" CHECK (return_time_zone IS NULL OR return_time_zone = btrim(return_time_zone) AND char_length(return_time_zone) >= 1 AND char_length(return_time_zone) <= 100);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_return_zone_required" CHECK (return_at IS NULL OR return_time_zone IS NOT NULL);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_status_check" CHECK (reservation_status = ANY (ARRAY['planning'::text, 'reserved'::text, 'confirmed'::text, 'cancelled'::text]));

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_transmission_check" CHECK (transmission IS NULL OR (transmission = ANY (ARRAY['manual'::text, 'automatic'::text, 'unknown'::text])));

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_vehicle_class_check" CHECK (vehicle_class IS NULL OR vehicle_class = btrim(vehicle_class) AND char_length(vehicle_class) >= 1 AND char_length(vehicle_class) <= 100);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_vehicle_model_check" CHECK (vehicle_model IS NULL OR vehicle_model = btrim(vehicle_model) AND char_length(vehicle_model) >= 1 AND char_length(vehicle_model) <= 200);

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_website_check" CHECK (website_url IS NULL OR website_url = btrim(website_url) AND char_length(website_url) >= 1 AND char_length(website_url) <= 2048 AND website_url ~* '^https?://[^[:space:]]+$'::text);

ALTER TABLE "public"."trip_component_confirmation_operations" ADD CONSTRAINT "trip_component_confirmation_operation_confirmation_source_check" CHECK (confirmation_source = 'user_manual'::text);

ALTER TABLE "public"."trip_component_confirmation_operations" ADD CONSTRAINT "trip_component_confirmation_operations_check" CHECK (evidence_document_id IS NULL AND evidence_role IS NULL OR evidence_document_id IS NOT NULL AND evidence_role IS NOT NULL);

ALTER TABLE "public"."trip_component_confirmation_operations" ADD CONSTRAINT "trip_component_confirmation_operations_request_check" CHECK (octet_length(request::text) <= 32768);

ALTER TABLE "public"."trip_component_confirmation_operations" ADD CONSTRAINT "trip_component_confirmation_operations_source_kind_check" CHECK (source_kind = ANY (ARRAY['accommodation'::text, 'flight'::text, 'activity'::text]));

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_check" CHECK (expected_amount IS NULL AND expected_quality = 'unknown'::text AND verified_at IS NULL OR expected_amount IS NOT NULL AND expected_quality = 'estimated'::text AND verified_at IS NULL OR expected_amount IS NOT NULL AND expected_quality = 'verified'::text AND verified_at IS NOT NULL);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_check1" CHECK (confirmed_amount IS NULL AND confirmed_at IS NULL OR confirmed_amount IS NOT NULL AND confirmed_at IS NOT NULL);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_component_id_check" CHECK (component_id ~ '^[a-z][a-z0-9_-]{0,63}$'::text);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_confirmed_amount_check" CHECK (confirmed_amount IS NULL OR confirmed_amount >= 0::numeric);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_currency_check" CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'::text);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_excluded_costs_check" CHECK (jsonb_typeof(excluded_costs) = 'array'::text);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_expected_amount_check" CHECK (expected_amount IS NULL OR expected_amount >= 0::numeric);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_expected_quality_check" CHECK (expected_quality = ANY (ARRAY['unknown'::text, 'estimated'::text, 'verified'::text]));

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_revision_check" CHECK (revision > 0);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_scope_check" CHECK (jsonb_typeof(scope) = 'object'::text);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_source_kind_check" CHECK (source_kind = ANY (ARRAY['accommodation'::text, 'flight'::text, 'activity'::text, 'car_rental'::text]));

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_unknown_required_costs_check" CHECK (jsonb_typeof(unknown_required_costs) = 'array'::text);

ALTER TABLE "public"."trip_day_metadata" ADD CONSTRAINT "trip_day_metadata_summary_check" CHECK (summary IS NULL OR summary = btrim(summary) AND char_length(summary) >= 1 AND char_length(summary) <= 1000);

ALTER TABLE "public"."trip_day_metadata" ADD CONSTRAINT "trip_day_metadata_title_check" CHECK (title IS NULL OR title = btrim(title) AND char_length(title) >= 1 AND char_length(title) <= 160);

ALTER TABLE "public"."trip_flight_documents" ADD CONSTRAINT "trip_flight_documents_role_check" CHECK (document_role = ANY (ARRAY['booking'::text, 'boarding_pass'::text, 'baggage_tag'::text]));

ALTER TABLE "public"."trip_flight_traveler_documents" ADD CONSTRAINT "trip_flight_traveler_documents_role_check" CHECK (document_role = 'boarding_pass'::text);

ALTER TABLE "public"."trip_flight_travelers" ADD CONSTRAINT "trip_flight_travelers_seat_check" CHECK (seat IS NULL OR seat = btrim(seat) AND char_length(seat) >= 1 AND char_length(seat) <= 100);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_airline_check" CHECK (airline IS NULL OR airline = btrim(airline) AND char_length(airline) >= 1 AND char_length(airline) <= 200);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_arrival_airport_code_check" CHECK (arrival_airport_code IS NULL OR arrival_airport_code = upper(btrim(arrival_airport_code)) AND arrival_airport_code ~ '^[A-Z0-9]{3,4}$'::text);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_arrival_airport_name_check" CHECK (arrival_airport_name IS NULL OR arrival_airport_name = btrim(arrival_airport_name) AND char_length(arrival_airport_name) >= 1 AND char_length(arrival_airport_name) <= 200);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_arrival_city_check" CHECK (arrival_city IS NULL OR arrival_city = btrim(arrival_city) AND char_length(arrival_city) >= 1 AND char_length(arrival_city) <= 200);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_arrival_terminal_check" CHECK (arrival_terminal IS NULL OR arrival_terminal = btrim(arrival_terminal) AND char_length(arrival_terminal) >= 1 AND char_length(arrival_terminal) <= 50);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_arrival_time_zone_check" CHECK (arrival_time_zone IS NULL OR arrival_time_zone = btrim(arrival_time_zone) AND char_length(arrival_time_zone) >= 1 AND char_length(arrival_time_zone) <= 100);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_arrival_time_zone_required_check" CHECK (arrival_at IS NULL OR arrival_time_zone IS NOT NULL);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_baggage_check" CHECK (baggage IS NULL OR baggage = btrim(baggage) AND char_length(baggage) >= 1 AND char_length(baggage) <= 500);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_booking_reference_check" CHECK (booking_reference IS NULL OR booking_reference = btrim(booking_reference) AND char_length(booking_reference) >= 1 AND char_length(booking_reference) <= 200);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_dates_check" CHECK (departure_at IS NULL OR arrival_at IS NULL OR arrival_at > departure_at);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_departure_airport_code_check" CHECK (departure_airport_code IS NULL OR departure_airport_code = upper(btrim(departure_airport_code)) AND departure_airport_code ~ '^[A-Z0-9]{3,4}$'::text);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_departure_airport_name_check" CHECK (departure_airport_name IS NULL OR departure_airport_name = btrim(departure_airport_name) AND char_length(departure_airport_name) >= 1 AND char_length(departure_airport_name) <= 200);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_departure_city_check" CHECK (departure_city IS NULL OR departure_city = btrim(departure_city) AND char_length(departure_city) >= 1 AND char_length(departure_city) <= 200);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_departure_terminal_check" CHECK (departure_terminal IS NULL OR departure_terminal = btrim(departure_terminal) AND char_length(departure_terminal) >= 1 AND char_length(departure_terminal) <= 50);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_departure_time_zone_check" CHECK (departure_time_zone IS NULL OR departure_time_zone = btrim(departure_time_zone) AND char_length(departure_time_zone) >= 1 AND char_length(departure_time_zone) <= 100);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_departure_time_zone_required_check" CHECK (departure_at IS NULL OR departure_time_zone IS NOT NULL);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_flight_number_check" CHECK (flight_number IS NULL OR flight_number = btrim(flight_number) AND char_length(flight_number) >= 1 AND char_length(flight_number) <= 30);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_notes_check" CHECK (notes IS NULL OR notes = btrim(notes) AND char_length(notes) >= 1 AND char_length(notes) <= 4000);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_passengers_check" CHECK (passengers IS NULL OR passengers = btrim(passengers) AND char_length(passengers) >= 1 AND char_length(passengers) <= 1000);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_seat_check" CHECK (seat IS NULL OR seat = btrim(seat) AND char_length(seat) >= 1 AND char_length(seat) <= 100);

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_status_check" CHECK (flight_status = ANY (ARRAY['planning'::text, 'reserved'::text, 'confirmed'::text, 'cancelled'::text]));

ALTER TABLE "public"."trip_handoff_operations" ADD CONSTRAINT "trip_handoff_operations_request_check" CHECK (octet_length(request::text) <= 65536);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_address_check" CHECK (address IS NULL OR address = btrim(address) AND char_length(address) >= 1 AND char_length(address) <= 500);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_approximate_time_order_check" CHECK (approximate_end_time IS NULL OR approximate_end_time > approximate_start_time);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_city_check" CHECK (city IS NULL OR city = btrim(city) AND char_length(city) >= 1 AND char_length(city) <= 200);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_daypart_check" CHECK (daypart IS NULL OR (daypart = ANY (ARRAY['morning'::text, 'midday'::text, 'afternoon'::text, 'evening'::text, 'night'::text])));

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_location_name_check" CHECK (location_name IS NULL OR location_name = btrim(location_name) AND char_length(location_name) >= 1 AND char_length(location_name) <= 200);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_notes_check" CHECK (notes IS NULL OR notes = btrim(notes) AND char_length(notes) >= 1 AND char_length(notes) <= 4000);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_status_check" CHECK (status = ANY (ARRAY['planned'::text, 'completed'::text, 'cancelled'::text]));

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_time_order_check" CHECK (ends_at IS NULL OR ends_at > starts_at);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_time_zone_check" CHECK (time_zone IS NULL OR time_zone = btrim(time_zone) AND char_length(time_zone) >= 1 AND char_length(time_zone) <= 100);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_timing_fields_check" CHECK (timing_kind = 'exact'::text AND starts_at IS NOT NULL AND time_zone IS NOT NULL AND local_date IS NULL AND daypart IS NULL AND approximate_start_time IS NULL AND approximate_end_time IS NULL OR timing_kind = 'approximate'::text AND local_date IS NOT NULL AND approximate_start_time IS NOT NULL AND time_zone IS NOT NULL AND starts_at IS NULL AND ends_at IS NULL AND daypart IS NULL OR (timing_kind = ANY (ARRAY['date'::text, 'all_day'::text])) AND local_date IS NOT NULL AND starts_at IS NULL AND ends_at IS NULL AND daypart IS NULL AND approximate_start_time IS NULL AND approximate_end_time IS NULL OR timing_kind = 'daypart'::text AND local_date IS NOT NULL AND starts_at IS NULL AND ends_at IS NULL AND daypart IS NOT NULL AND approximate_start_time IS NULL AND approximate_end_time IS NULL OR timing_kind = 'unscheduled'::text AND local_date IS NULL AND starts_at IS NULL AND ends_at IS NULL AND daypart IS NULL AND approximate_start_time IS NULL AND approximate_end_time IS NULL);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_timing_kind_check" CHECK (timing_kind = ANY (ARRAY['exact'::text, 'approximate'::text, 'date'::text, 'all_day'::text, 'daypart'::text, 'unscheduled'::text]));

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_title_check" CHECK (title = btrim(title) AND char_length(title) >= 1 AND char_length(title) <= 200);

ALTER TABLE "public"."trip_photo_metadata" ADD CONSTRAINT "photo_batch_pair" CHECK (upload_batch_id IS NULL AND selection_index IS NULL OR upload_batch_id IS NOT NULL AND selection_index IS NOT NULL AND selection_index >= 0 AND selection_index <= 19);

ALTER TABLE "public"."trip_photo_metadata" ADD CONSTRAINT "photo_one_source" CHECK (num_nonnulls(activity_id, itinerary_item_id) <= 1);

ALTER TABLE "public"."trip_proposal_component_links" ADD CONSTRAINT "trip_proposal_component_links_check" CHECK (num_nonnulls(accommodation_id, flight_id, activity_id) = 1);

ALTER TABLE "public"."trip_proposal_component_links" ADD CONSTRAINT "trip_proposal_component_links_component_id_check" CHECK (component_id ~ '^[a-z][a-z0-9_-]{0,63}$'::text);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_brief_revision_check" CHECK (brief_revision > 0);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_mapping_version_check" CHECK (mapping_version = 1);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_request_check" CHECK (octet_length(request::text) <= 65536);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_snapshot_hash_check" CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "public"."trip_proposals" ADD CONSTRAINT "trip_proposals_document_check" CHECK (proposal_private.document_valid(document));

ALTER TABLE "public"."trip_proposals" ADD CONSTRAINT "trip_proposals_fingerprint_check" CHECK (fingerprint ~ '^[0-9a-f]{64}$'::text);

ALTER TABLE "public"."trip_proposals" ADD CONSTRAINT "trip_proposals_position_check" CHECK ("position" >= 1 AND "position" <= 3);

ALTER TABLE "public"."trip_proposals" ADD CONSTRAINT "trip_proposals_schema_version_check" CHECK (schema_version = 1);

ALTER TABLE "public"."trip_reminders" ADD CONSTRAINT "trip_reminders_kind_check" CHECK (reminder_kind = ANY (ARRAY['flight_departure'::text, 'accommodation_check_in'::text, 'accommodation_check_out'::text, 'activity_start'::text, 'itinerary_exact'::text]));

ALTER TABLE "public"."trip_reminders" ADD CONSTRAINT "trip_reminders_notify_before_check" CHECK (default_notify_before_minutes >= 1 AND default_notify_before_minutes <= 10080);

ALTER TABLE "public"."trip_reminders" ADD CONSTRAINT "trip_reminders_schedule_check" CHECK (scheduled_for <= event_at);

ALTER TABLE "public"."trip_reminders" ADD CONSTRAINT "trip_reminders_source_kind_check" CHECK (source_kind = ANY (ARRAY['flight'::text, 'accommodation'::text, 'activity'::text, 'itinerary_item'::text]));

ALTER TABLE "public"."trip_reminders" ADD CONSTRAINT "trip_reminders_source_kind_match_check" CHECK (source_kind = 'flight'::text AND reminder_kind = 'flight_departure'::text OR source_kind = 'accommodation'::text AND (reminder_kind = ANY (ARRAY['accommodation_check_in'::text, 'accommodation_check_out'::text])) OR source_kind = 'activity'::text AND reminder_kind = 'activity_start'::text OR source_kind = 'itinerary_item'::text AND reminder_kind = 'itinerary_exact'::text);

ALTER TABLE "public"."trip_reminders" ADD CONSTRAINT "trip_reminders_title_check" CHECK (title = btrim(title) AND char_length(title) >= 1 AND char_length(title) <= 300);

ALTER TABLE "public"."trip_standalone_component_links" ADD CONSTRAINT "trip_standalone_component_links_component_id_check" CHECK (component_id ~ '^[a-z][a-z0-9_-]{0,63}$'::text);

ALTER TABLE "public"."trip_standalone_component_links" ADD CONSTRAINT "trip_standalone_component_links_source_kind_check" CHECK (source_kind = ANY (ARRAY['accommodation'::text, 'flight'::text, 'activity'::text, 'car_rental'::text]));

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_administrative_area_check" CHECK (administrative_area IS NULL OR administrative_area = btrim(administrative_area) AND char_length(administrative_area) >= 1 AND char_length(administrative_area) <= 200);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_canonical_name_check" CHECK (canonical_name = btrim(canonical_name) AND char_length(canonical_name) >= 1 AND char_length(canonical_name) <= 500);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_country_code_check" CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'::text);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_label_check" CHECK (label = btrim(label) AND char_length(label) >= 1 AND char_length(label) <= 120);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_latitude_check" CHECK (latitude >= '-90'::integer::double precision AND latitude <= 90::double precision);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_longitude_check" CHECK (longitude >= '-180'::integer::double precision AND longitude <= 180::double precision);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_position_check" CHECK ("position" >= 1 AND "position" <= 20);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_provider_check" CHECK (provider = 'geoapify'::text);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_provider_place_id_check" CHECK (provider_place_id = btrim(provider_place_id) AND char_length(provider_place_id) >= 1 AND char_length(provider_place_id) <= 500);

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_time_zone_check" CHECK (time_zone = btrim(time_zone) AND char_length(time_zone) >= 1 AND char_length(time_zone) <= 100);

ALTER TABLE "public"."trip_travelers" ADD CONSTRAINT "trip_travelers_name_check" CHECK (display_name = btrim(display_name) AND char_length(display_name) >= 1 AND char_length(display_name) <= 200);

ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_dates_both_null_or_present" CHECK (start_date IS NULL AND end_date IS NULL OR start_date IS NOT NULL AND end_date IS NOT NULL);

ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_discard_pair" CHECK ((discarded_at IS NULL) = (discarded_by IS NULL));

ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_end_date_not_before_start_date" CHECK (start_date IS NULL OR end_date >= start_date);

ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_experience_key_not_blank" CHECK (experience_key IS NULL OR experience_key = btrim(experience_key) AND char_length(experience_key) >= 1 AND char_length(experience_key) <= 50);

ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_name_check" CHECK (char_length(TRIM(BOTH FROM name)) >= 1 AND char_length(TRIM(BOTH FROM name)) <= 100);

ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_time_zone_not_blank" CHECK (time_zone IS NULL OR time_zone = btrim(time_zone) AND char_length(time_zone) >= 1 AND char_length(time_zone) <= 100);

ALTER TABLE "app_private"."alb03_ingestions" ADD CONSTRAINT "alb03_ingestions_trip_id_book_id_asset_id_fkey" FOREIGN KEY (trip_id, book_id, asset_id) REFERENCES travel_book_assets(trip_id, book_id, id) ON DELETE RESTRICT;

ALTER TABLE "app_private"."alb03_ingestions" ADD CONSTRAINT "alb03_ingestions_trip_id_book_id_snapshot_id_fkey" FOREIGN KEY (trip_id, book_id, snapshot_id) REFERENCES travel_book_source_snapshots(trip_id, book_id, id) ON DELETE RESTRICT;

ALTER TABLE "app_private"."alb03_requests" ADD CONSTRAINT "alb03_requests_trip_id_book_id_fkey" FOREIGN KEY (trip_id, book_id) REFERENCES travel_books(trip_id, id) ON DELETE RESTRICT;

ALTER TABLE "place_private"."operations" ADD CONSTRAINT "operations_binding_id_fkey" FOREIGN KEY (binding_id) REFERENCES place_bindings(id);

ALTER TABLE "place_private"."queries" ADD CONSTRAINT "queries_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id);

ALTER TABLE "public"."checklist_items" ADD CONSTRAINT "checklist_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."checklist_items" ADD CONSTRAINT "checklist_items_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."itinerary_activities" ADD CONSTRAINT "itinerary_activities_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_activity_id_fkey" FOREIGN KEY (activity_id) REFERENCES itinerary_activities(id) ON DELETE CASCADE;

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_reminder_id_fkey" FOREIGN KEY (reminder_id) REFERENCES trip_reminders(id) ON DELETE CASCADE;

ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE;

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_brief_id_fkey" FOREIGN KEY (brief_id) REFERENCES trip_briefs(id);

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id);

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_place_version_id_fkey" FOREIGN KEY (place_version_id) REFERENCES place_versions(id);

ALTER TABLE "public"."place_bindings" ADD CONSTRAINT "place_bindings_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES trip_proposals(id);

ALTER TABLE "public"."place_versions" ADD CONSTRAINT "place_versions_place_id_fkey" FOREIGN KEY (place_id) REFERENCES places(id);

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_brief_id_fkey" FOREIGN KEY (brief_id) REFERENCES trip_briefs(id) ON DELETE CASCADE;

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."proposal_generations" ADD CONSTRAINT "proposal_generations_previous_generation_id_fkey" FOREIGN KEY (previous_generation_id) REFERENCES proposal_generations(id);

ALTER TABLE "public"."proposal_operations" ADD CONSTRAINT "proposal_operations_generation_id_fkey" FOREIGN KEY (generation_id) REFERENCES proposal_generations(id) ON DELETE CASCADE;

ALTER TABLE "public"."proposal_operations" ADD CONSTRAINT "proposal_operations_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."travel_book_asset_variants" ADD CONSTRAINT "travel_book_asset_variants_trip_id_book_id_asset_id_fkey" FOREIGN KEY (trip_id, book_id, asset_id) REFERENCES travel_book_assets(trip_id, book_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_trip_id_book_id_fkey" FOREIGN KEY (trip_id, book_id) REFERENCES travel_books(trip_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_assets" ADD CONSTRAINT "travel_book_assets_trip_id_source_document_id_fkey" FOREIGN KEY (trip_id, source_document_id) REFERENCES travel_documents(trip_id, id) ON DELETE SET NULL (source_document_id);

ALTER TABLE "public"."travel_book_composition_versions" ADD CONSTRAINT "travel_book_composition_versi_trip_id_book_id_edition_id_c_fkey" FOREIGN KEY (trip_id, book_id, edition_id, composition_id) REFERENCES travel_book_compositions(trip_id, book_id, edition_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_compositions" ADD CONSTRAINT "travel_book_compositions_trip_id_book_id_edition_id_fkey" FOREIGN KEY (trip_id, book_id, edition_id) REFERENCES travel_book_editions(trip_id, book_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_compositions" ADD CONSTRAINT "travel_book_current_version_fk" FOREIGN KEY (id, current_version) REFERENCES travel_book_composition_versions(composition_id, version) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "public"."travel_book_editions" ADD CONSTRAINT "travel_book_editions_trip_id_book_id_fkey" FOREIGN KEY (trip_id, book_id) REFERENCES travel_books(trip_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_operations" ADD CONSTRAINT "travel_book_operations_trip_id_book_id_edition_id_fkey" FOREIGN KEY (trip_id, book_id, edition_id) REFERENCES travel_book_editions(trip_id, book_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_operations" ADD CONSTRAINT "travel_book_operations_trip_id_book_id_fkey" FOREIGN KEY (trip_id, book_id) REFERENCES travel_books(trip_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_pages" ADD CONSTRAINT "travel_book_pages_trip_id_book_id_edition_id_composition_i_fkey" FOREIGN KEY (trip_id, book_id, edition_id, composition_id) REFERENCES travel_book_compositions(trip_id, book_id, edition_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_resource_refs" ADD CONSTRAINT "travel_book_resource_refs_trip_id_book_id_asset_id_fkey" FOREIGN KEY (trip_id, book_id, asset_id) REFERENCES travel_book_assets(trip_id, book_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_resource_refs" ADD CONSTRAINT "travel_book_resource_refs_trip_id_book_id_edition_id_compo_fkey" FOREIGN KEY (trip_id, book_id, edition_id, composition_id, composition_version) REFERENCES travel_book_composition_versions(trip_id, book_id, edition_id, composition_id, version) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_resource_refs" ADD CONSTRAINT "travel_book_resource_refs_trip_id_book_id_source_snapshot__fkey" FOREIGN KEY (trip_id, book_id, source_snapshot_id) REFERENCES travel_book_source_snapshots(trip_id, book_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_revision_compositions" ADD CONSTRAINT "travel_book_revision_composit_trip_id_book_id_edition_id_c_fkey" FOREIGN KEY (trip_id, book_id, edition_id, composition_id, composition_version) REFERENCES travel_book_composition_versions(trip_id, book_id, edition_id, composition_id, version) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_revision_compositions" ADD CONSTRAINT "travel_book_revision_composit_trip_id_book_id_edition_id_r_fkey" FOREIGN KEY (trip_id, book_id, edition_id, revision_id) REFERENCES travel_book_revisions(trip_id, book_id, edition_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_revisions" ADD CONSTRAINT "travel_book_revisions_trip_id_book_id_edition_id_fkey" FOREIGN KEY (trip_id, book_id, edition_id) REFERENCES travel_book_editions(trip_id, book_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_book_source_snapshots" ADD CONSTRAINT "travel_book_source_snapshots_trip_id_book_id_fkey" FOREIGN KEY (trip_id, book_id) REFERENCES travel_books(trip_id, id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_books" ADD CONSTRAINT "travel_books_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE RESTRICT;

ALTER TABLE "public"."travel_documents" ADD CONSTRAINT "travel_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."travel_documents" ADD CONSTRAINT "travel_documents_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."travel_expenses" ADD CONSTRAINT "travel_expenses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."travel_expenses" ADD CONSTRAINT "travel_expenses_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."travel_parking" ADD CONSTRAINT "travel_parking_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."travel_parking" ADD CONSTRAINT "travel_parking_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_accommodation_documents" ADD CONSTRAINT "trip_accommodation_documents_accommodation_fkey" FOREIGN KEY (trip_id, accommodation_id) REFERENCES trip_accommodations(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_accommodation_documents" ADD CONSTRAINT "trip_accommodation_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_accommodation_documents" ADD CONSTRAINT "trip_accommodation_documents_document_fkey" FOREIGN KEY (trip_id, document_id) REFERENCES travel_documents(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_accommodations" ADD CONSTRAINT "trip_accommodations_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_activities" ADD CONSTRAINT "trip_activities_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_activity_documents" ADD CONSTRAINT "trip_activity_documents_activity_fkey" FOREIGN KEY (trip_id, activity_id) REFERENCES trip_activities(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_activity_documents" ADD CONSTRAINT "trip_activity_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_activity_documents" ADD CONSTRAINT "trip_activity_documents_document_fkey" FOREIGN KEY (trip_id, document_id) REFERENCES travel_documents(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_brief_operations" ADD CONSTRAINT "trip_brief_operations_brief_id_fkey" FOREIGN KEY (brief_id) REFERENCES trip_briefs(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_brief_operations" ADD CONSTRAINT "trip_brief_operations_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_briefs" ADD CONSTRAINT "trip_briefs_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_briefs" ADD CONSTRAINT "trip_briefs_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id);

ALTER TABLE "public"."trip_budget_setting_operations" ADD CONSTRAINT "trip_budget_setting_operations_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);

ALTER TABLE "public"."trip_budget_setting_operations" ADD CONSTRAINT "trip_budget_setting_operations_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_budget_settings" ADD CONSTRAINT "trip_budget_settings_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_budget_settings" ADD CONSTRAINT "trip_budget_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE "public"."trip_car_rental_documents" ADD CONSTRAINT "trip_car_rental_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_car_rental_documents" ADD CONSTRAINT "trip_car_rental_documents_document_fkey" FOREIGN KEY (trip_id, document_id) REFERENCES travel_documents(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_car_rental_documents" ADD CONSTRAINT "trip_car_rental_documents_rental_fkey" FOREIGN KEY (trip_id, car_rental_id) REFERENCES trip_car_rentals(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_car_rentals" ADD CONSTRAINT "trip_car_rentals_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_component_confirmation_operations" ADD CONSTRAINT "trip_component_confirmation_o_trip_id_evidence_document_id_fkey" FOREIGN KEY (trip_id, evidence_document_id) REFERENCES travel_documents(trip_id, id);

ALTER TABLE "public"."trip_component_confirmation_operations" ADD CONSTRAINT "trip_component_confirmation_operations_handoff_id_trip_id_fkey" FOREIGN KEY (handoff_id, trip_id) REFERENCES trip_proposal_handoffs(id, trip_id);

ALTER TABLE "public"."trip_component_confirmation_operations" ADD CONSTRAINT "trip_component_confirmation_operations_owner_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);

ALTER TABLE "public"."trip_component_cost_operations" ADD CONSTRAINT "trip_component_cost_operations_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);

ALTER TABLE "public"."trip_component_cost_operations" ADD CONSTRAINT "trip_component_cost_operations_trip_id_component_id_fkey" FOREIGN KEY (trip_id, component_id) REFERENCES trip_component_costs(trip_id, component_id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_handoff_id_trip_id_fkey" FOREIGN KEY (handoff_id, trip_id) REFERENCES trip_proposal_handoffs(id, trip_id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_trip_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_trip_id_evidence_document_id_fkey" FOREIGN KEY (trip_id, evidence_document_id) REFERENCES travel_documents(trip_id, id);

ALTER TABLE "public"."trip_component_costs" ADD CONSTRAINT "trip_component_costs_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE "public"."trip_day_metadata" ADD CONSTRAINT "trip_day_metadata_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_day_metadata" ADD CONSTRAINT "trip_day_metadata_trip_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_day_metadata" ADD CONSTRAINT "trip_day_metadata_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_flight_documents" ADD CONSTRAINT "trip_flight_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_flight_documents" ADD CONSTRAINT "trip_flight_documents_document_fkey" FOREIGN KEY (trip_id, document_id) REFERENCES travel_documents(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_flight_documents" ADD CONSTRAINT "trip_flight_documents_flight_fkey" FOREIGN KEY (trip_id, flight_id) REFERENCES trip_flights(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_flight_traveler_documents" ADD CONSTRAINT "trip_flight_traveler_document_trip_id_flight_id_traveler_i_fkey" FOREIGN KEY (trip_id, flight_id, traveler_id) REFERENCES trip_flight_travelers(trip_id, flight_id, traveler_id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_flight_traveler_documents" ADD CONSTRAINT "trip_flight_traveler_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_flight_traveler_documents" ADD CONSTRAINT "trip_flight_traveler_documents_trip_id_document_id_fkey" FOREIGN KEY (trip_id, document_id) REFERENCES travel_documents(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_flight_travelers" ADD CONSTRAINT "trip_flight_travelers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_flight_travelers" ADD CONSTRAINT "trip_flight_travelers_trip_id_flight_id_fkey" FOREIGN KEY (trip_id, flight_id) REFERENCES trip_flights(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_flight_travelers" ADD CONSTRAINT "trip_flight_travelers_trip_id_traveler_id_fkey" FOREIGN KEY (trip_id, traveler_id) REFERENCES trip_travelers(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_flights" ADD CONSTRAINT "trip_flights_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_handoff_operations" ADD CONSTRAINT "trip_handoff_operations_handoff_id_fkey" FOREIGN KEY (handoff_id) REFERENCES trip_proposal_handoffs(id);

ALTER TABLE "public"."trip_handoff_operations" ADD CONSTRAINT "trip_handoff_operations_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id);

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_trip_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_itinerary_items" ADD CONSTRAINT "trip_itinerary_items_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_members" ADD CONSTRAINT "trip_members_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_members" ADD CONSTRAINT "trip_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_photo_metadata" ADD CONSTRAINT "trip_photo_metadata_trip_id_activity_id_fkey" FOREIGN KEY (trip_id, activity_id) REFERENCES trip_activities(trip_id, id) ON DELETE SET NULL (activity_id);

ALTER TABLE "public"."trip_photo_metadata" ADD CONSTRAINT "trip_photo_metadata_trip_id_document_id_fkey" FOREIGN KEY (trip_id, document_id) REFERENCES travel_documents(trip_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_photo_metadata" ADD CONSTRAINT "trip_photo_metadata_trip_id_itinerary_item_id_fkey" FOREIGN KEY (trip_id, itinerary_item_id) REFERENCES trip_itinerary_items(trip_id, id) ON DELETE SET NULL (itinerary_item_id);

ALTER TABLE "public"."trip_photo_metadata" ADD CONSTRAINT "trip_photo_metadata_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_place_snapshots" ADD CONSTRAINT "trip_place_snapshots_handoff_id_fkey" FOREIGN KEY (handoff_id) REFERENCES trip_proposal_handoffs(id);

ALTER TABLE "public"."trip_place_snapshots" ADD CONSTRAINT "trip_place_snapshots_principal_binding_id_fkey" FOREIGN KEY (principal_binding_id) REFERENCES place_bindings(id);

ALTER TABLE "public"."trip_proposal_component_links" ADD CONSTRAINT "trip_proposal_component_links_handoff_id_trip_id_fkey" FOREIGN KEY (handoff_id, trip_id) REFERENCES trip_proposal_handoffs(id, trip_id);

ALTER TABLE "public"."trip_proposal_component_links" ADD CONSTRAINT "trip_proposal_component_links_trip_id_accommodation_id_fkey" FOREIGN KEY (trip_id, accommodation_id) REFERENCES trip_accommodations(trip_id, id);

ALTER TABLE "public"."trip_proposal_component_links" ADD CONSTRAINT "trip_proposal_component_links_trip_id_activity_id_fkey" FOREIGN KEY (trip_id, activity_id) REFERENCES trip_activities(trip_id, id);

ALTER TABLE "public"."trip_proposal_component_links" ADD CONSTRAINT "trip_proposal_component_links_trip_id_flight_id_fkey" FOREIGN KEY (trip_id, flight_id) REFERENCES trip_flights(trip_id, id);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_brief_id_fkey" FOREIGN KEY (brief_id) REFERENCES trip_briefs(id);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES trip_proposals(id);

ALTER TABLE "public"."trip_proposal_handoffs" ADD CONSTRAINT "trip_proposal_handoffs_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id);

ALTER TABLE "public"."trip_proposals" ADD CONSTRAINT "trip_proposals_generation_id_fkey" FOREIGN KEY (generation_id) REFERENCES proposal_generations(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_reminders" ADD CONSTRAINT "trip_reminders_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_standalone_component_links" ADD CONSTRAINT "trip_standalone_component_links_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE "public"."trip_standalone_component_links" ADD CONSTRAINT "trip_standalone_component_links_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_stops" ADD CONSTRAINT "trip_stops_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trip_travelers" ADD CONSTRAINT "trip_travelers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."trip_travelers" ADD CONSTRAINT "trip_travelers_trip_id_fkey" FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;

ALTER TABLE "public"."trips" ADD CONSTRAINT "trips_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX alb03_ingestions_scope ON app_private.alb03_ingestions USING btree (trip_id, book_id, snapshot_id);

CREATE INDEX alb03_requests_scope ON app_private.alb03_requests USING btree (trip_id, book_id);

CREATE UNIQUE INDEX checklist_items_trip_template_key_idx ON public.checklist_items USING btree (trip_id, template_key) WHERE (template_key IS NOT NULL);

CREATE INDEX itinerary_activities_notifications_starts_at_idx ON public.itinerary_activities USING btree (starts_at) WHERE (notifications_enabled = true);

CREATE INDEX notification_deliveries_expired_lease_claim_idx ON public.notification_deliveries USING btree (lease_until, scheduled_for) WHERE (status = 'processing'::text);

CREATE INDEX notification_deliveries_pending_claim_idx ON public.notification_deliveries USING btree (scheduled_for) WHERE (status = 'pending'::text);

CREATE UNIQUE INDEX notification_deliveries_reminder_subscription_kind_key ON public.notification_deliveries USING btree (reminder_id, subscription_id, notification_kind) WHERE (reminder_id IS NOT NULL);

CREATE INDEX notification_deliveries_retry_claim_idx ON public.notification_deliveries USING btree (next_attempt_at, scheduled_for) WHERE (status = 'retry'::text);

CREATE INDEX place_binding_subject ON public.place_bindings USING btree (owner_id, brief_id, proposal_id, subject_key, revision DESC);

CREATE INDEX proposal_generations_owner_brief ON public.proposal_generations USING btree (owner_id, brief_id, created_at DESC);

CREATE UNIQUE INDEX proposal_initial_identity ON public.proposal_generations USING btree (brief_id, brief_revision, engine_version, generator_version, verifier_version, policy_version) WHERE (previous_generation_id IS NULL);

CREATE INDEX proposal_previous_generation ON public.proposal_generations USING btree (previous_generation_id);

CREATE UNIQUE INDEX proposal_round_number ON public.proposal_generations USING btree (brief_id, round_number) WHERE (round_number IS NOT NULL);

CREATE INDEX push_subscriptions_user_trip_active_idx ON public.push_subscriptions USING btree (user_id, trip_id, active);

CREATE INDEX travel_book_variants_scope ON public.travel_book_asset_variants USING btree (trip_id, book_id, asset_id);

CREATE INDEX travel_book_assets_source_idx ON public.travel_book_assets USING btree (trip_id, source_document_id) WHERE (source_document_id IS NOT NULL);

CREATE INDEX travel_book_assets_status_idx ON public.travel_book_assets USING btree (trip_id, book_id, status);

CREATE INDEX travel_book_compositions_active_idx ON public.travel_book_compositions USING btree (edition_id, id) WHERE (removed_at IS NULL);

CREATE INDEX travel_book_compositions_scope_idx ON public.travel_book_compositions USING btree (trip_id, book_id, edition_id);

CREATE INDEX travel_book_editions_book_idx ON public.travel_book_editions USING btree (trip_id, book_id, created_at, id);

CREATE INDEX travel_book_operations_book_idx ON public.travel_book_operations USING btree (trip_id, book_id, created_at);

CREATE INDEX travel_book_operations_edition_idx ON public.travel_book_operations USING btree (trip_id, book_id, edition_id);

CREATE INDEX travel_book_pages_scope_idx ON public.travel_book_pages USING btree (trip_id, book_id, edition_id, composition_id);

CREATE INDEX travel_book_refs_asset_idx ON public.travel_book_resource_refs USING btree (trip_id, book_id, asset_id) WHERE (asset_id IS NOT NULL);

CREATE INDEX travel_book_refs_scope_idx ON public.travel_book_resource_refs USING btree (trip_id, book_id, edition_id, composition_id, composition_version);

CREATE INDEX travel_book_refs_snapshot_idx ON public.travel_book_resource_refs USING btree (trip_id, book_id, source_snapshot_id) WHERE (source_snapshot_id IS NOT NULL);

CREATE INDEX travel_book_revision_versions_idx ON public.travel_book_revision_compositions USING btree (trip_id, book_id, edition_id, composition_id, composition_version);

CREATE INDEX travel_book_snapshots_source_idx ON public.travel_book_source_snapshots USING btree (trip_id, book_id, source_kind, source_id, captured_at DESC);

CREATE INDEX travel_books_trip_created_idx ON public.travel_books USING btree (trip_id, created_at DESC, id);

CREATE INDEX trip_accommodation_documents_created_by_idx ON public.trip_accommodation_documents USING btree (created_by) WHERE (created_by IS NOT NULL);

CREATE INDEX trip_accommodation_documents_document_idx ON public.trip_accommodation_documents USING btree (trip_id, document_id);

CREATE INDEX trip_accommodations_chronology_idx ON public.trip_accommodations USING btree (trip_id, check_in_at, created_at, id);

CREATE INDEX trip_accommodations_created_by_idx ON public.trip_accommodations USING btree (created_by) WHERE (created_by IS NOT NULL);

CREATE INDEX trip_accommodations_updated_by_idx ON public.trip_accommodations USING btree (updated_by) WHERE (updated_by IS NOT NULL);

CREATE INDEX trip_activities_chronology_idx ON public.trip_activities USING btree (trip_id, start_at, created_at, id);

CREATE INDEX trip_activities_created_by_idx ON public.trip_activities USING btree (created_by) WHERE (created_by IS NOT NULL);

CREATE INDEX trip_activities_updated_by_idx ON public.trip_activities USING btree (updated_by) WHERE (updated_by IS NOT NULL);

CREATE INDEX trip_activity_documents_created_by_idx ON public.trip_activity_documents USING btree (created_by) WHERE (created_by IS NOT NULL);

CREATE INDEX trip_activity_documents_document_idx ON public.trip_activity_documents USING btree (trip_id, document_id);

CREATE INDEX trip_brief_operations_brief_idx ON public.trip_brief_operations USING btree (brief_id);

CREATE UNIQUE INDEX brief_operational_trip_idx ON public.trip_briefs USING btree (trip_id) WHERE (trip_id IS NOT NULL);

CREATE INDEX trip_briefs_owner_updated_idx ON public.trip_briefs USING btree (owner_id, updated_at DESC, id);

CREATE INDEX trip_budget_setting_operations_trip_idx ON public.trip_budget_setting_operations USING btree (trip_id);

CREATE INDEX trip_budget_settings_updated_by_idx ON public.trip_budget_settings USING btree (updated_by);

CREATE INDEX trip_car_rental_documents_created_by_idx ON public.trip_car_rental_documents USING btree (created_by) WHERE (created_by IS NOT NULL);

CREATE INDEX trip_car_rental_documents_document_idx ON public.trip_car_rental_documents USING btree (trip_id, document_id);

CREATE INDEX trip_car_rental_documents_rental_role_idx ON public.trip_car_rental_documents USING btree (trip_id, car_rental_id, document_role);

CREATE INDEX trip_car_rentals_chronology_idx ON public.trip_car_rentals USING btree (trip_id, pickup_at, created_at, id);

CREATE INDEX trip_car_rentals_created_by_idx ON public.trip_car_rentals USING btree (created_by) WHERE (created_by IS NOT NULL);

CREATE INDEX trip_car_rentals_updated_by_idx ON public.trip_car_rentals USING btree (updated_by) WHERE (updated_by IS NOT NULL);

CREATE INDEX trip_component_confirmation_evidence_idx ON public.trip_component_confirmation_operations USING btree (trip_id, evidence_document_id) WHERE (evidence_document_id IS NOT NULL);

CREATE INDEX trip_component_confirmation_handoff_idx ON public.trip_component_confirmation_operations USING btree (handoff_id, trip_id);

CREATE INDEX trip_component_confirmation_trip_idx ON public.trip_component_confirmation_operations USING btree (trip_id, component_id, confirmed_at DESC);

CREATE INDEX trip_component_cost_operations_component_idx ON public.trip_component_cost_operations USING btree (trip_id, component_id);

CREATE INDEX trip_component_costs_evidence_idx ON public.trip_component_costs USING btree (trip_id, evidence_document_id) WHERE (evidence_document_id IS NOT NULL);

CREATE INDEX trip_component_costs_handoff_idx ON public.trip_component_costs USING btree (handoff_id, trip_id);

CREATE INDEX trip_component_costs_source_idx ON public.trip_component_costs USING btree (trip_id, source_kind, source_id);

CREATE INDEX trip_component_costs_updated_by_idx ON public.trip_component_costs USING btree (updated_by);

CREATE INDEX trip_flight_documents_created_by_idx ON public.trip_flight_documents USING btree (created_by) WHERE (created_by IS NOT NULL);

CREATE INDEX trip_flight_documents_document_idx ON public.trip_flight_documents USING btree (trip_id, document_id);

CREATE UNIQUE INDEX trip_flight_documents_one_booking_idx ON public.trip_flight_documents USING btree (trip_id, flight_id) WHERE (document_role = 'booking'::text);

CREATE INDEX trip_flights_chronology_idx ON public.trip_flights USING btree (trip_id, departure_at, created_at, id);

CREATE INDEX trip_flights_created_by_idx ON public.trip_flights USING btree (created_by) WHERE (created_by IS NOT NULL);

CREATE INDEX trip_flights_updated_by_idx ON public.trip_flights USING btree (updated_by) WHERE (updated_by IS NOT NULL);

CREATE INDEX handoff_operations_handoff_idx ON public.trip_handoff_operations USING btree (handoff_id);

CREATE INDEX trip_itinerary_items_local_date_idx ON public.trip_itinerary_items USING btree (trip_id, local_date, sort_order, id);

CREATE INDEX trip_itinerary_items_manual_order_idx ON public.trip_itinerary_items USING btree (trip_id, sort_order, created_at, id);

CREATE INDEX trip_itinerary_items_starts_at_idx ON public.trip_itinerary_items USING btree (trip_id, starts_at, sort_order, id);

CREATE INDEX trip_members_user_id_idx ON public.trip_members USING btree (user_id);

CREATE INDEX trip_photo_metadata_activity ON public.trip_photo_metadata USING btree (trip_id, activity_id) WHERE (activity_id IS NOT NULL);

CREATE INDEX trip_photo_metadata_day ON public.trip_photo_metadata USING btree (trip_id, local_date);

CREATE INDEX trip_photo_metadata_planning ON public.trip_photo_metadata USING btree (trip_id, itinerary_item_id) WHERE (itinerary_item_id IS NOT NULL);

CREATE UNIQUE INDEX handoff_accommodation_idx ON public.trip_proposal_component_links USING btree (accommodation_id) WHERE (accommodation_id IS NOT NULL);

CREATE UNIQUE INDEX handoff_activity_idx ON public.trip_proposal_component_links USING btree (activity_id) WHERE (activity_id IS NOT NULL);

CREATE UNIQUE INDEX handoff_flight_idx ON public.trip_proposal_component_links USING btree (flight_id) WHERE (flight_id IS NOT NULL);

CREATE INDEX handoff_link_trip_idx ON public.trip_proposal_component_links USING btree (trip_id);

CREATE INDEX handoff_owner_idx ON public.trip_proposal_handoffs USING btree (owner_id);

CREATE INDEX trip_reminders_due_idx ON public.trip_reminders USING btree (scheduled_for, id) WHERE enabled;

CREATE INDEX trip_reminders_trip_schedule_idx ON public.trip_reminders USING btree (trip_id, scheduled_for, id) WHERE enabled;

CREATE INDEX trip_stops_trip_position_idx ON public.trip_stops USING btree (trip_id, "position");

CREATE UNIQUE INDEX trip_travelers_name_idx ON public.trip_travelers USING btree (trip_id, lower(display_name));

ALTER TABLE "app_private"."alb03_ingestions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "app_private"."alb03_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."checklist_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."itinerary_activities" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."notification_deliveries" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."place_bindings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."place_versions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."places" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."proposal_generations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."proposal_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_asset_variants" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_assets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_composition_versions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_compositions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_editions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_pages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_resource_refs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_revision_compositions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_revisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_book_source_snapshots" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_books" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_documents" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_expenses" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."travel_parking" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_accommodation_documents" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_accommodations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_activities" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_activity_documents" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_brief_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_briefs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_budget_setting_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_budget_settings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_car_rental_documents" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_car_rentals" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_component_confirmation_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_component_cost_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_component_costs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_day_metadata" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_flight_documents" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_flight_traveler_documents" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_flight_travelers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_flights" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_handoff_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_itinerary_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_members" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_photo_metadata" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_place_snapshots" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_proposal_component_links" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_proposal_handoffs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_proposals" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_reminders" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_standalone_component_links" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_stops" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trip_travelers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."trips" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can add checklist" ON "public"."checklist_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = auth.uid())));

CREATE POLICY "members can delete checklist" ON "public"."checklist_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update checklist" ON "public"."checklist_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "members can view checklist" ON "public"."checklist_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can view itinerary activities" ON "public"."itinerary_activities" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "binding_owner" ON "public"."place_bindings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "proposal_generation_owner" ON "public"."proposal_generations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "users can create own push subscriptions" ON "public"."push_subscriptions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((user_id = auth.uid()) AND is_trip_member(trip_id)));

CREATE POLICY "users can delete own push subscriptions" ON "public"."push_subscriptions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "users can update own push subscriptions" ON "public"."push_subscriptions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((user_id = auth.uid()) AND is_trip_member(trip_id))) WITH CHECK (((user_id = auth.uid()) AND is_trip_member(trip_id)));

CREATE POLICY "users can view own push subscriptions" ON "public"."push_subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid()));

CREATE POLICY "travel_book_variants_read" ON "public"."travel_book_asset_variants" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_book_assets_read" ON "public"."travel_book_assets" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_book_composition_versions_read" ON "public"."travel_book_composition_versions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_book_compositions_read" ON "public"."travel_book_compositions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_book_editions_read" ON "public"."travel_book_editions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_book_operations_read" ON "public"."travel_book_operations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_trip_member(trip_id) AND (actor_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY "travel_book_pages_read" ON "public"."travel_book_pages" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_book_resource_refs_read" ON "public"."travel_book_resource_refs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_book_revision_compositions_read" ON "public"."travel_book_revision_compositions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_book_revisions_read" ON "public"."travel_book_revisions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_book_source_snapshots_read" ON "public"."travel_book_source_snapshots" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "travel_books_read" ON "public"."travel_books" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "trip members can delete documents" ON "public"."travel_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "trip members can insert documents" ON "public"."travel_documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = auth.uid())));

CREATE POLICY "trip members can read documents" ON "public"."travel_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "trip members can update documents" ON "public"."travel_documents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "trip members add expenses" ON "public"."travel_expenses" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM trip_members tm
  WHERE ((tm.trip_id = travel_expenses.trip_id) AND (tm.user_id = auth.uid()))))));

CREATE POLICY "trip members delete expenses" ON "public"."travel_expenses" AS PERMISSIVE FOR DELETE TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM trip_members tm
  WHERE ((tm.trip_id = travel_expenses.trip_id) AND (tm.user_id = auth.uid())))));

CREATE POLICY "trip members read expenses" ON "public"."travel_expenses" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM trip_members tm
  WHERE ((tm.trip_id = travel_expenses.trip_id) AND (tm.user_id = auth.uid())))));

CREATE POLICY "members can add parking" ON "public"."travel_parking" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (updated_by = auth.uid())));

CREATE POLICY "members can delete parking" ON "public"."travel_parking" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update parking" ON "public"."travel_parking" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "members can view parking" ON "public"."travel_parking" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can add accommodation documents" ON "public"."trip_accommodation_documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete accommodation documents" ON "public"."trip_accommodation_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update accommodation documents" ON "public"."trip_accommodation_documents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can view accommodation documents" ON "public"."trip_accommodation_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can add accommodations" ON "public"."trip_accommodations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete accommodations" ON "public"."trip_accommodations" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update accommodations" ON "public"."trip_accommodations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "members can view accommodations" ON "public"."trip_accommodations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can add activities" ON "public"."trip_activities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete activities" ON "public"."trip_activities" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update activities" ON "public"."trip_activities" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "members can view activities" ON "public"."trip_activities" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can add activity documents" ON "public"."trip_activity_documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete activity documents" ON "public"."trip_activity_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update activity documents" ON "public"."trip_activity_documents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can view activity documents" ON "public"."trip_activity_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "brief_owner_delete" ON "public"."trip_briefs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((owner_id = ( SELECT auth.uid() AS uid)) AND (trip_id IS NULL)));

CREATE POLICY "brief_owner_read" ON "public"."trip_briefs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "trip members can view TB budget settings" ON "public"."trip_budget_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND is_trip_member(trip_id)));

CREATE POLICY "members can add car rental documents" ON "public"."trip_car_rental_documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete car rental documents" ON "public"."trip_car_rental_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can view car rental documents" ON "public"."trip_car_rental_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can add car rentals" ON "public"."trip_car_rentals" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete car rentals" ON "public"."trip_car_rentals" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update car rentals" ON "public"."trip_car_rentals" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "members can view car rentals" ON "public"."trip_car_rentals" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "trip members can view TB confirmations" ON "public"."trip_component_confirmation_operations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND is_trip_member(trip_id)));

CREATE POLICY "trip members can view TB component costs" ON "public"."trip_component_costs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND is_trip_member(trip_id)));

CREATE POLICY "members can add trip day metadata" ON "public"."trip_day_metadata" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete trip day metadata" ON "public"."trip_day_metadata" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update trip day metadata" ON "public"."trip_day_metadata" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "members can view trip day metadata" ON "public"."trip_day_metadata" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can add flight documents" ON "public"."trip_flight_documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete flight documents" ON "public"."trip_flight_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update flight documents" ON "public"."trip_flight_documents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can view flight documents" ON "public"."trip_flight_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members manage traveler flight documents" ON "public"."trip_flight_traveler_documents" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members manage flight travelers" ON "public"."trip_flight_travelers" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can add flights" ON "public"."trip_flights" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete flights" ON "public"."trip_flights" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update flights" ON "public"."trip_flights" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "members can view flights" ON "public"."trip_flights" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can add manual itinerary items" ON "public"."trip_itinerary_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can delete manual itinerary items" ON "public"."trip_itinerary_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can update manual itinerary items" ON "public"."trip_itinerary_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK (is_trip_member(trip_id));

CREATE POLICY "members can view manual itinerary items" ON "public"."trip_itinerary_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "members can view memberships" ON "public"."trip_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((user_id = auth.uid()) OR is_trip_member(trip_id)));

CREATE POLICY "photo_metadata_member_read" ON "public"."trip_photo_metadata" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "trip_place_owner" ON "public"."trip_place_snapshots" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM trip_proposal_handoffs h
  WHERE ((h.id = trip_place_snapshots.handoff_id) AND (h.owner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "handoff_link_owner" ON "public"."trip_proposal_component_links" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM trip_proposal_handoffs h
  WHERE ((h.id = trip_proposal_component_links.handoff_id) AND (h.owner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "handoff_owner" ON "public"."trip_proposal_handoffs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((owner_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "proposal_owner" ON "public"."trip_proposals" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM proposal_generations g
  WHERE ((g.id = trip_proposals.generation_id) AND (g.owner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "trip members can view standalone component links" ON "public"."trip_standalone_component_links" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((( SELECT auth.uid() AS uid) IS NOT NULL) AND is_trip_member(trip_id)));

CREATE POLICY "trip_stops_member_read" ON "public"."trip_stops" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(trip_id));

CREATE POLICY "trip_stops_owner_write" ON "public"."trip_stops" AS PERMISSIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_stops.trip_id) AND (t.owner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM trips t
  WHERE ((t.id = trip_stops.trip_id) AND (t.owner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "members manage travelers" ON "public"."trip_travelers" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_trip_member(trip_id)) WITH CHECK ((is_trip_member(trip_id) AND (created_by = ( SELECT auth.uid() AS uid))));

CREATE POLICY "members can view trips" ON "public"."trips" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_trip_member(id));

CREATE POLICY "owners can update generic trips" ON "public"."trips" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((( SELECT auth.uid() AS uid) = owner_id) AND (experience_key IS DISTINCT FROM 'london-2026'::text))) WITH CHECK (((( SELECT auth.uid() AS uid) = owner_id) AND (experience_key IS DISTINCT FROM 'london-2026'::text)));

CREATE TRIGGER alb03_requests_immutable BEFORE DELETE OR UPDATE ON app_private.alb03_requests FOR EACH ROW EXECUTE FUNCTION app_private.travel_book_reject_mutation();

CREATE TRIGGER capture_binding_subject BEFORE INSERT ON place_bindings FOR EACH ROW EXECUTE FUNCTION place_private.capture_binding_subject();

CREATE TRIGGER place_binding_immutable BEFORE DELETE OR UPDATE ON place_bindings FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_immutable();

CREATE TRIGGER place_version_immutable BEFORE DELETE OR UPDATE ON place_versions FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_immutable();

CREATE TRIGGER generation_places BEFORE INSERT OR UPDATE ON proposal_generations FOR EACH ROW EXECUTE FUNCTION place_private.generation_places();

CREATE TRIGGER immutable_round BEFORE UPDATE ON proposal_generations FOR EACH ROW EXECUTE FUNCTION proposal_private.immutable_round();

CREATE TRIGGER immutable_snapshot BEFORE UPDATE ON proposal_generations FOR EACH ROW EXECUTE FUNCTION proposal_private.immutable_snapshot();

CREATE TRIGGER initialize_proposal_round BEFORE INSERT ON proposal_generations FOR EACH ROW EXECUTE FUNCTION proposal_private.initialize_round();

CREATE TRIGGER travel_book_variants_immutable BEFORE DELETE OR UPDATE ON travel_book_asset_variants FOR EACH ROW EXECUTE FUNCTION app_private.travel_book_reject_mutation();

CREATE TRIGGER travel_book_master_immutable BEFORE UPDATE ON travel_book_assets FOR EACH ROW EXECUTE FUNCTION app_private.travel_book_protect_master_v1();

CREATE TRIGGER travel_book_composition_versions_immutable BEFORE DELETE OR UPDATE ON travel_book_composition_versions FOR EACH ROW EXECUTE FUNCTION app_private.travel_book_reject_mutation();

CREATE TRIGGER travel_book_operations_immutable BEFORE DELETE OR UPDATE ON travel_book_operations FOR EACH ROW EXECUTE FUNCTION app_private.travel_book_reject_mutation();

CREATE TRIGGER travel_book_resource_refs_immutable BEFORE DELETE OR UPDATE ON travel_book_resource_refs FOR EACH ROW EXECUTE FUNCTION app_private.travel_book_reject_mutation();

CREATE TRIGGER travel_book_revision_compositions_immutable BEFORE DELETE OR UPDATE ON travel_book_revision_compositions FOR EACH ROW EXECUTE FUNCTION app_private.travel_book_reject_mutation();

CREATE TRIGGER travel_book_revisions_immutable BEFORE DELETE OR UPDATE ON travel_book_revisions FOR EACH ROW EXECUTE FUNCTION app_private.travel_book_reject_mutation();

CREATE TRIGGER travel_book_source_snapshots_immutable BEFORE DELETE OR UPDATE ON travel_book_source_snapshots FOR EACH ROW EXECUTE FUNCTION app_private.travel_book_reject_mutation();

CREATE TRIGGER protect_contextual_photo BEFORE UPDATE ON travel_documents FOR EACH ROW EXECUTE FUNCTION protect_contextual_photo_document();

CREATE TRIGGER enforce_trip_accommodation_document_integrity_trigger BEFORE INSERT OR UPDATE ON trip_accommodation_documents FOR EACH ROW EXECUTE FUNCTION enforce_trip_accommodation_document_integrity();

CREATE TRIGGER cleanup_standalone_accommodation_budget AFTER DELETE ON trip_accommodations FOR EACH ROW EXECUTE FUNCTION proposal_private.cleanup_standalone_component_link('accommodation');

CREATE TRIGGER enforce_trip_accommodation_integrity_trigger BEFORE INSERT OR UPDATE ON trip_accommodations FOR EACH ROW EXECUTE FUNCTION enforce_trip_accommodation_integrity();

CREATE TRIGGER zz_trip_progress_integrity BEFORE INSERT OR UPDATE ON trip_accommodations FOR EACH ROW EXECUTE FUNCTION enforce_trip_progress_integrity();

CREATE TRIGGER cleanup_standalone_activity_budget AFTER DELETE ON trip_activities FOR EACH ROW EXECUTE FUNCTION proposal_private.cleanup_standalone_component_link('activity');

CREATE TRIGGER enforce_trip_activity_integrity_trigger BEFORE INSERT OR UPDATE ON trip_activities FOR EACH ROW EXECUTE FUNCTION enforce_trip_activity_integrity();

CREATE TRIGGER zz_trip_progress_integrity BEFORE INSERT OR UPDATE ON trip_activities FOR EACH ROW EXECUTE FUNCTION enforce_trip_progress_integrity();

CREATE TRIGGER enforce_trip_activity_document_integrity_trigger BEFORE INSERT OR UPDATE ON trip_activity_documents FOR EACH ROW EXECUTE FUNCTION enforce_trip_activity_document_integrity();

CREATE CONSTRAINT TRIGGER brief_handoff_integrity AFTER INSERT OR UPDATE ON trip_briefs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_integrity();

CREATE TRIGGER freeze_handed_off_brief BEFORE UPDATE ON trip_briefs FOR EACH ROW EXECUTE FUNCTION proposal_private.freeze_handed_off_brief();

CREATE TRIGGER trip_budget_setting_operations_immutable BEFORE DELETE OR UPDATE ON trip_budget_setting_operations FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_immutable();

CREATE TRIGGER cleanup_standalone_car_rental_budget AFTER DELETE ON trip_car_rentals FOR EACH ROW EXECUTE FUNCTION proposal_private.cleanup_standalone_component_link('car_rental');

CREATE TRIGGER enforce_trip_car_rental_integrity_trigger BEFORE INSERT OR UPDATE ON trip_car_rentals FOR EACH ROW EXECUTE FUNCTION enforce_trip_car_rental_integrity();

CREATE TRIGGER trip_component_confirmation_immutable BEFORE DELETE OR UPDATE ON trip_component_confirmation_operations FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_immutable();

CREATE TRIGGER trip_component_cost_operations_immutable BEFORE DELETE OR UPDATE ON trip_component_cost_operations FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_immutable();

CREATE TRIGGER enforce_trip_day_metadata_integrity_trigger BEFORE INSERT OR UPDATE ON trip_day_metadata FOR EACH ROW EXECUTE FUNCTION enforce_trip_day_metadata_integrity();

CREATE TRIGGER enforce_trip_flight_document_integrity_trigger BEFORE INSERT OR UPDATE ON trip_flight_documents FOR EACH ROW EXECUTE FUNCTION enforce_trip_flight_document_integrity();

CREATE TRIGGER cleanup_standalone_flight_budget AFTER DELETE ON trip_flights FOR EACH ROW EXECUTE FUNCTION proposal_private.cleanup_standalone_component_link('flight');

CREATE TRIGGER enforce_trip_flight_integrity_trigger BEFORE INSERT OR UPDATE ON trip_flights FOR EACH ROW EXECUTE FUNCTION enforce_trip_flight_integrity();

CREATE TRIGGER zz_trip_progress_integrity BEFORE INSERT OR UPDATE ON trip_flights FOR EACH ROW EXECUTE FUNCTION enforce_trip_progress_integrity();

CREATE TRIGGER handoff_receipt_immutable BEFORE DELETE OR UPDATE ON trip_handoff_operations FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_immutable();

CREATE TRIGGER enforce_trip_itinerary_item_integrity_trigger BEFORE INSERT OR UPDATE ON trip_itinerary_items FOR EACH ROW EXECUTE FUNCTION enforce_trip_itinerary_item_integrity();

CREATE TRIGGER zz_trip_progress_integrity BEFORE INSERT OR UPDATE ON trip_itinerary_items FOR EACH ROW EXECUTE FUNCTION enforce_trip_progress_integrity();

CREATE TRIGGER photo_metadata_audit BEFORE INSERT OR UPDATE ON trip_photo_metadata FOR EACH ROW EXECUTE FUNCTION audit_trip_photo_metadata();

CREATE TRIGGER trip_place_immutable BEFORE DELETE OR UPDATE ON trip_place_snapshots FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_immutable();

CREATE TRIGGER handoff_link_immutable BEFORE DELETE OR UPDATE ON trip_proposal_component_links FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_immutable();

CREATE CONSTRAINT TRIGGER handoff_link_integrity AFTER INSERT ON trip_proposal_component_links DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_integrity();

CREATE TRIGGER handoff_immutable BEFORE DELETE OR UPDATE ON trip_proposal_handoffs FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_immutable();

CREATE CONSTRAINT TRIGGER handoff_integrity AFTER INSERT ON trip_proposal_handoffs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION proposal_private.handoff_integrity();

CREATE TRIGGER immutable_proposal BEFORE UPDATE ON trip_proposals FOR EACH ROW EXECUTE FUNCTION proposal_private.immutable_proposal();

CREATE TRIGGER standalone_component_link_immutable BEFORE DELETE OR UPDATE ON trip_standalone_component_links FOR EACH ROW EXECUTE FUNCTION proposal_private.standalone_component_link_immutable();

REVOKE ALL ON ALL TABLES IN SCHEMA "app_private" FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "app_private" FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA "place_private" FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "place_private" FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA "proposal_private" FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "proposal_private" FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC, anon, authenticated, service_role;

GRANT DELETE ON TABLE "public"."checklist_items" TO "anon";

GRANT INSERT ON TABLE "public"."checklist_items" TO "anon";

GRANT REFERENCES ON TABLE "public"."checklist_items" TO "anon";

GRANT SELECT ON TABLE "public"."checklist_items" TO "anon";

GRANT TRIGGER ON TABLE "public"."checklist_items" TO "anon";

GRANT TRUNCATE ON TABLE "public"."checklist_items" TO "anon";

GRANT UPDATE ON TABLE "public"."checklist_items" TO "anon";

GRANT DELETE ON TABLE "public"."checklist_items" TO "authenticated";

GRANT INSERT ON TABLE "public"."checklist_items" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."checklist_items" TO "authenticated";

GRANT SELECT ON TABLE "public"."checklist_items" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."checklist_items" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."checklist_items" TO "authenticated";

GRANT UPDATE ON TABLE "public"."checklist_items" TO "authenticated";

GRANT DELETE ON TABLE "public"."checklist_items" TO "service_role";

GRANT INSERT ON TABLE "public"."checklist_items" TO "service_role";

GRANT REFERENCES ON TABLE "public"."checklist_items" TO "service_role";

GRANT SELECT ON TABLE "public"."checklist_items" TO "service_role";

GRANT TRIGGER ON TABLE "public"."checklist_items" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."checklist_items" TO "service_role";

GRANT UPDATE ON TABLE "public"."checklist_items" TO "service_role";

GRANT SELECT ON TABLE "public"."itinerary_activities" TO "authenticated";

GRANT DELETE ON TABLE "public"."itinerary_activities" TO "service_role";

GRANT INSERT ON TABLE "public"."itinerary_activities" TO "service_role";

GRANT REFERENCES ON TABLE "public"."itinerary_activities" TO "service_role";

GRANT SELECT ON TABLE "public"."itinerary_activities" TO "service_role";

GRANT TRIGGER ON TABLE "public"."itinerary_activities" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."itinerary_activities" TO "service_role";

GRANT UPDATE ON TABLE "public"."itinerary_activities" TO "service_role";

GRANT DELETE ON TABLE "public"."notification_deliveries" TO "service_role";

GRANT INSERT ON TABLE "public"."notification_deliveries" TO "service_role";

GRANT REFERENCES ON TABLE "public"."notification_deliveries" TO "service_role";

GRANT SELECT ON TABLE "public"."notification_deliveries" TO "service_role";

GRANT TRIGGER ON TABLE "public"."notification_deliveries" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."notification_deliveries" TO "service_role";

GRANT UPDATE ON TABLE "public"."notification_deliveries" TO "service_role";

GRANT SELECT ON TABLE "public"."place_bindings" TO "authenticated";

GRANT SELECT ON TABLE "public"."proposal_generations" TO "authenticated";

GRANT DELETE ON TABLE "public"."push_subscriptions" TO "authenticated";

GRANT INSERT ON TABLE "public"."push_subscriptions" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."push_subscriptions" TO "authenticated";

GRANT SELECT ON TABLE "public"."push_subscriptions" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."push_subscriptions" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."push_subscriptions" TO "authenticated";

GRANT UPDATE ON TABLE "public"."push_subscriptions" TO "authenticated";

GRANT DELETE ON TABLE "public"."push_subscriptions" TO "service_role";

GRANT INSERT ON TABLE "public"."push_subscriptions" TO "service_role";

GRANT REFERENCES ON TABLE "public"."push_subscriptions" TO "service_role";

GRANT SELECT ON TABLE "public"."push_subscriptions" TO "service_role";

GRANT TRIGGER ON TABLE "public"."push_subscriptions" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."push_subscriptions" TO "service_role";

GRANT UPDATE ON TABLE "public"."push_subscriptions" TO "service_role";

GRANT SELECT ON TABLE "public"."travel_book_asset_variants" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_assets" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_composition_versions" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_compositions" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_editions" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_operations" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_pages" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_resource_refs" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_revision_compositions" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_revisions" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_book_source_snapshots" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_books" TO "authenticated";

GRANT DELETE ON TABLE "public"."travel_documents" TO "anon";

GRANT INSERT ON TABLE "public"."travel_documents" TO "anon";

GRANT REFERENCES ON TABLE "public"."travel_documents" TO "anon";

GRANT SELECT ON TABLE "public"."travel_documents" TO "anon";

GRANT TRIGGER ON TABLE "public"."travel_documents" TO "anon";

GRANT TRUNCATE ON TABLE "public"."travel_documents" TO "anon";

GRANT UPDATE ON TABLE "public"."travel_documents" TO "anon";

GRANT DELETE ON TABLE "public"."travel_documents" TO "authenticated";

GRANT INSERT ON TABLE "public"."travel_documents" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."travel_documents" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_documents" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."travel_documents" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."travel_documents" TO "authenticated";

GRANT UPDATE ON TABLE "public"."travel_documents" TO "authenticated";

GRANT DELETE ON TABLE "public"."travel_documents" TO "service_role";

GRANT INSERT ON TABLE "public"."travel_documents" TO "service_role";

GRANT REFERENCES ON TABLE "public"."travel_documents" TO "service_role";

GRANT SELECT ON TABLE "public"."travel_documents" TO "service_role";

GRANT TRIGGER ON TABLE "public"."travel_documents" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."travel_documents" TO "service_role";

GRANT UPDATE ON TABLE "public"."travel_documents" TO "service_role";

GRANT DELETE ON TABLE "public"."travel_expenses" TO "anon";

GRANT INSERT ON TABLE "public"."travel_expenses" TO "anon";

GRANT REFERENCES ON TABLE "public"."travel_expenses" TO "anon";

GRANT SELECT ON TABLE "public"."travel_expenses" TO "anon";

GRANT TRIGGER ON TABLE "public"."travel_expenses" TO "anon";

GRANT TRUNCATE ON TABLE "public"."travel_expenses" TO "anon";

GRANT UPDATE ON TABLE "public"."travel_expenses" TO "anon";

GRANT DELETE ON TABLE "public"."travel_expenses" TO "authenticated";

GRANT INSERT ON TABLE "public"."travel_expenses" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."travel_expenses" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_expenses" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."travel_expenses" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."travel_expenses" TO "authenticated";

GRANT UPDATE ON TABLE "public"."travel_expenses" TO "authenticated";

GRANT DELETE ON TABLE "public"."travel_expenses" TO "service_role";

GRANT INSERT ON TABLE "public"."travel_expenses" TO "service_role";

GRANT REFERENCES ON TABLE "public"."travel_expenses" TO "service_role";

GRANT SELECT ON TABLE "public"."travel_expenses" TO "service_role";

GRANT TRIGGER ON TABLE "public"."travel_expenses" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."travel_expenses" TO "service_role";

GRANT UPDATE ON TABLE "public"."travel_expenses" TO "service_role";

GRANT DELETE ON TABLE "public"."travel_parking" TO "anon";

GRANT INSERT ON TABLE "public"."travel_parking" TO "anon";

GRANT REFERENCES ON TABLE "public"."travel_parking" TO "anon";

GRANT SELECT ON TABLE "public"."travel_parking" TO "anon";

GRANT TRIGGER ON TABLE "public"."travel_parking" TO "anon";

GRANT TRUNCATE ON TABLE "public"."travel_parking" TO "anon";

GRANT UPDATE ON TABLE "public"."travel_parking" TO "anon";

GRANT DELETE ON TABLE "public"."travel_parking" TO "authenticated";

GRANT INSERT ON TABLE "public"."travel_parking" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."travel_parking" TO "authenticated";

GRANT SELECT ON TABLE "public"."travel_parking" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."travel_parking" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."travel_parking" TO "authenticated";

GRANT UPDATE ON TABLE "public"."travel_parking" TO "authenticated";

GRANT DELETE ON TABLE "public"."travel_parking" TO "service_role";

GRANT INSERT ON TABLE "public"."travel_parking" TO "service_role";

GRANT REFERENCES ON TABLE "public"."travel_parking" TO "service_role";

GRANT SELECT ON TABLE "public"."travel_parking" TO "service_role";

GRANT TRIGGER ON TABLE "public"."travel_parking" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."travel_parking" TO "service_role";

GRANT UPDATE ON TABLE "public"."travel_parking" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_accommodation_documents" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_accommodation_documents" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_accommodation_documents" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_accommodation_documents" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_accommodation_documents" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_accommodation_documents" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_accommodation_documents" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_accommodation_documents" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_accommodations" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_accommodations" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_accommodations" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_accommodations" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_accommodations" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_accommodations" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_accommodations" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_accommodations" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_accommodations" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_accommodations" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_accommodations" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_activities" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_activities" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_activities" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_activities" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_activities" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_activities" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_activities" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_activities" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_activities" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_activities" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_activities" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_activity_documents" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_activity_documents" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_activity_documents" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_activity_documents" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_activity_documents" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_activity_documents" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_activity_documents" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_activity_documents" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_briefs" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_briefs" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_budget_settings" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_car_rental_documents" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_car_rental_documents" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_car_rental_documents" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_car_rental_documents" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_car_rental_documents" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_car_rental_documents" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_car_rental_documents" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_car_rental_documents" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_car_rental_documents" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_car_rental_documents" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_car_rentals" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_car_rentals" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_car_rentals" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_car_rentals" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_car_rentals" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_car_rentals" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_car_rentals" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_car_rentals" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_car_rentals" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_car_rentals" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_car_rentals" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_component_confirmation_operations" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_component_costs" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_day_metadata" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_day_metadata" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_day_metadata" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_day_metadata" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_day_metadata" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_day_metadata" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_day_metadata" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_day_metadata" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_day_metadata" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_day_metadata" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_day_metadata" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_flight_documents" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_flight_documents" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_flight_documents" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_flight_documents" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_flight_documents" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_flight_documents" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_flight_documents" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_flight_documents" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_flight_traveler_documents" TO "anon";

GRANT INSERT ON TABLE "public"."trip_flight_traveler_documents" TO "anon";

GRANT REFERENCES ON TABLE "public"."trip_flight_traveler_documents" TO "anon";

GRANT SELECT ON TABLE "public"."trip_flight_traveler_documents" TO "anon";

GRANT TRIGGER ON TABLE "public"."trip_flight_traveler_documents" TO "anon";

GRANT TRUNCATE ON TABLE "public"."trip_flight_traveler_documents" TO "anon";

GRANT UPDATE ON TABLE "public"."trip_flight_traveler_documents" TO "anon";

GRANT DELETE ON TABLE "public"."trip_flight_traveler_documents" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_flight_traveler_documents" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."trip_flight_traveler_documents" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_flight_traveler_documents" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."trip_flight_traveler_documents" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."trip_flight_traveler_documents" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_flight_traveler_documents" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_flight_traveler_documents" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_flight_traveler_documents" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_flight_traveler_documents" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_flight_traveler_documents" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_flight_traveler_documents" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_flight_traveler_documents" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_flight_traveler_documents" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_flight_travelers" TO "anon";

GRANT INSERT ON TABLE "public"."trip_flight_travelers" TO "anon";

GRANT REFERENCES ON TABLE "public"."trip_flight_travelers" TO "anon";

GRANT SELECT ON TABLE "public"."trip_flight_travelers" TO "anon";

GRANT TRIGGER ON TABLE "public"."trip_flight_travelers" TO "anon";

GRANT TRUNCATE ON TABLE "public"."trip_flight_travelers" TO "anon";

GRANT UPDATE ON TABLE "public"."trip_flight_travelers" TO "anon";

GRANT DELETE ON TABLE "public"."trip_flight_travelers" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_flight_travelers" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."trip_flight_travelers" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_flight_travelers" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."trip_flight_travelers" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."trip_flight_travelers" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_flight_travelers" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_flight_travelers" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_flight_travelers" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_flight_travelers" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_flight_travelers" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_flight_travelers" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_flight_travelers" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_flight_travelers" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_flights" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_flights" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_flights" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_flights" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_flights" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_flights" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_flights" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_flights" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_flights" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_flights" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_flights" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_itinerary_items" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_itinerary_items" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_itinerary_items" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_itinerary_items" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_itinerary_items" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_itinerary_items" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_itinerary_items" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_itinerary_items" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_itinerary_items" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_itinerary_items" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_itinerary_items" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_members" TO "anon";

GRANT INSERT ON TABLE "public"."trip_members" TO "anon";

GRANT REFERENCES ON TABLE "public"."trip_members" TO "anon";

GRANT SELECT ON TABLE "public"."trip_members" TO "anon";

GRANT TRIGGER ON TABLE "public"."trip_members" TO "anon";

GRANT TRUNCATE ON TABLE "public"."trip_members" TO "anon";

GRANT UPDATE ON TABLE "public"."trip_members" TO "anon";

GRANT DELETE ON TABLE "public"."trip_members" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_members" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."trip_members" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_members" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."trip_members" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."trip_members" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_members" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_members" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_members" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_members" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_members" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_members" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_members" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_members" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_photo_metadata" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_photo_metadata" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_photo_metadata" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_photo_metadata" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_photo_metadata" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_photo_metadata" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_photo_metadata" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_photo_metadata" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_place_snapshots" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_proposal_component_links" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_proposal_component_links" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_proposal_handoffs" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_proposals" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_reminders" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_reminders" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_reminders" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_reminders" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_reminders" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_reminders" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_reminders" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_standalone_component_links" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_stops" TO "anon";

GRANT INSERT ON TABLE "public"."trip_stops" TO "anon";

GRANT REFERENCES ON TABLE "public"."trip_stops" TO "anon";

GRANT SELECT ON TABLE "public"."trip_stops" TO "anon";

GRANT TRIGGER ON TABLE "public"."trip_stops" TO "anon";

GRANT TRUNCATE ON TABLE "public"."trip_stops" TO "anon";

GRANT UPDATE ON TABLE "public"."trip_stops" TO "anon";

GRANT DELETE ON TABLE "public"."trip_stops" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_stops" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."trip_stops" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_stops" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."trip_stops" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."trip_stops" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_stops" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_stops" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_stops" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_stops" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_stops" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_stops" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_stops" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_stops" TO "service_role";

GRANT DELETE ON TABLE "public"."trip_travelers" TO "anon";

GRANT INSERT ON TABLE "public"."trip_travelers" TO "anon";

GRANT REFERENCES ON TABLE "public"."trip_travelers" TO "anon";

GRANT SELECT ON TABLE "public"."trip_travelers" TO "anon";

GRANT TRIGGER ON TABLE "public"."trip_travelers" TO "anon";

GRANT TRUNCATE ON TABLE "public"."trip_travelers" TO "anon";

GRANT UPDATE ON TABLE "public"."trip_travelers" TO "anon";

GRANT DELETE ON TABLE "public"."trip_travelers" TO "authenticated";

GRANT INSERT ON TABLE "public"."trip_travelers" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."trip_travelers" TO "authenticated";

GRANT SELECT ON TABLE "public"."trip_travelers" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."trip_travelers" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."trip_travelers" TO "authenticated";

GRANT UPDATE ON TABLE "public"."trip_travelers" TO "authenticated";

GRANT DELETE ON TABLE "public"."trip_travelers" TO "service_role";

GRANT INSERT ON TABLE "public"."trip_travelers" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trip_travelers" TO "service_role";

GRANT SELECT ON TABLE "public"."trip_travelers" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trip_travelers" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trip_travelers" TO "service_role";

GRANT UPDATE ON TABLE "public"."trip_travelers" TO "service_role";

GRANT DELETE ON TABLE "public"."trips" TO "anon";

GRANT INSERT ON TABLE "public"."trips" TO "anon";

GRANT REFERENCES ON TABLE "public"."trips" TO "anon";

GRANT SELECT ON TABLE "public"."trips" TO "anon";

GRANT TRIGGER ON TABLE "public"."trips" TO "anon";

GRANT TRUNCATE ON TABLE "public"."trips" TO "anon";

GRANT DELETE ON TABLE "public"."trips" TO "authenticated";

GRANT INSERT ON TABLE "public"."trips" TO "authenticated";

GRANT REFERENCES ON TABLE "public"."trips" TO "authenticated";

GRANT SELECT ON TABLE "public"."trips" TO "authenticated";

GRANT TRIGGER ON TABLE "public"."trips" TO "authenticated";

GRANT TRUNCATE ON TABLE "public"."trips" TO "authenticated";

GRANT DELETE ON TABLE "public"."trips" TO "service_role";

GRANT INSERT ON TABLE "public"."trips" TO "service_role";

GRANT REFERENCES ON TABLE "public"."trips" TO "service_role";

GRANT SELECT ON TABLE "public"."trips" TO "service_role";

GRANT TRIGGER ON TABLE "public"."trips" TO "service_role";

GRANT TRUNCATE ON TABLE "public"."trips" TO "service_role";

GRANT UPDATE ON TABLE "public"."trips" TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_activity_document_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_trip_member"(p_trip_id uuid) TO "anon";

GRANT EXECUTE ON FUNCTION "public"."is_trip_member"(p_trip_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."is_trip_member"(p_trip_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_trip"(p_name text) TO "anon";

GRANT EXECUTE ON FUNCTION "public"."create_trip"(p_name text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."create_trip"(p_name text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_my_trip"() TO "anon";

GRANT EXECUTE ON FUNCTION "public"."get_my_trip"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_my_trip"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."join_trip"(p_invite_code text) TO "anon";

GRANT EXECUTE ON FUNCTION "public"."join_trip"(p_invite_code text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."join_trip"(p_invite_code text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."claim_notification_deliveries"(p_batch_size integer, p_lease_seconds integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."finish_place_query_v1"(p_owner uuid, p_hash text, p_token uuid, p_results jsonb, p_seconds integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."confirm_place_v1"(p_owner uuid, p_subject jsonb, p_token uuid, p_hash text, p_index integer, p_expected_revision bigint, p_expected_brief_revision bigint, p_operation_id uuid, p_token_seconds integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."formalize_trip_proposal_v2"(p_brief_id uuid, p_expected_brief_revision bigint, p_proposal_id uuid, p_expected_generation_id uuid, p_expected_snapshot_hash text, p_operation_id uuid, p_details jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."alb03_can_read_object_v1"(path text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."join_trip_v2"(p_invite_code text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."join_trip_v2"(p_invite_code text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."initialize_generic_trip_checklist"(p_trip_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."initialize_generic_trip_checklist"(p_trip_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_accommodation_document_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_trip_v2"(p_name text, p_start_date date, p_end_date date, p_time_zone text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_trip_v2"(p_name text, p_start_date date, p_end_date date, p_time_zone text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_accommodation_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_place_bindings_v1"(p_subject jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."claim_place_query_v1"(p_owner uuid, p_query jsonb, p_config jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_trip_accommodation_voucher"(p_trip_id uuid, p_accommodation_id uuid, p_expected_accommodation_updated_at timestamp with time zone, p_expected_document_id uuid, p_new_document_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."sync_trip_accommodation_voucher"(p_trip_id uuid, p_accommodation_id uuid, p_expected_accommodation_updated_at timestamp with time zone, p_expected_document_id uuid, p_new_document_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_flight_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_flight_document_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_activity_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_trip_activity_document"(p_trip_id uuid, p_activity_id uuid, p_document_role text, p_expected_activity_updated_at timestamp with time zone, p_expected_document_id uuid, p_new_document_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."sync_trip_activity_document"(p_trip_id uuid, p_activity_id uuid, p_document_role text, p_expected_activity_updated_at timestamp with time zone, p_expected_document_id uuid, p_new_document_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_itinerary_item_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_day_metadata_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_trip_flight_document"(p_trip_id uuid, p_flight_id uuid, p_document_role text, p_expected_flight_updated_at timestamp with time zone, p_expected_document_id uuid, p_new_document_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."sync_trip_flight_document"(p_trip_id uuid, p_flight_id uuid, p_document_role text, p_expected_flight_updated_at timestamp with time zone, p_expected_document_id uuid, p_new_document_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_trip_flight_documents"(p_trip_id uuid, p_flight_id uuid, p_document_role text, p_expected_flight_updated_at timestamp with time zone, p_expected_document_ids uuid[], p_new_document_ids uuid[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."sync_trip_flight_documents"(p_trip_id uuid, p_flight_id uuid, p_document_role text, p_expected_flight_updated_at timestamp with time zone, p_expected_document_ids uuid[], p_new_document_ids uuid[]) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_trip_flight_document_link"(p_trip_id uuid, p_flight_id uuid, p_document_role text, p_document_id uuid, p_expected_flight_updated_at timestamp with time zone, p_linked boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_trip_flight_document_link"(p_trip_id uuid, p_flight_id uuid, p_document_role text, p_document_id uuid, p_expected_flight_updated_at timestamp with time zone, p_linked boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."formalize_trip_proposal_v1"(p_brief_id uuid, p_expected_brief_revision bigint, p_proposal_id uuid, p_expected_generation_id uuid, p_expected_snapshot_hash text, p_operation_id uuid, p_details jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."sync_notification_deliveries"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_trip_v1"(p_trip_id uuid, p_name text, p_start_date date, p_end_date date, p_time_zone text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_trip_v1"(p_trip_id uuid, p_name text, p_start_date date, p_end_date date, p_time_zone text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_progress_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_trip_event_completed"(p_trip_id uuid, p_source_type text, p_source_id uuid, p_source_event text, p_completed boolean, p_expected_updated_at timestamp with time zone) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_trip_event_completed"(p_trip_id uuid, p_source_type text, p_source_id uuid, p_source_event text, p_completed boolean, p_expected_updated_at timestamp with time zone) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_trip_reminders"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."audit_trip_photo_metadata"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."protect_contextual_photo_document"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_trip_photo_context"(p_trip_id uuid, p_document_id uuid, p_expected_updated_at timestamp with time zone, p_local_date date, p_activity_id uuid, p_itinerary_item_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_trip_photo_context"(p_trip_id uuid, p_document_id uuid, p_expected_updated_at timestamp with time zone, p_local_date date, p_activity_id uuid, p_itinerary_item_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."apply_trip_brief_patch_v1"(p_brief_id uuid, p_operation_id uuid, p_expected_revision bigint, p_set jsonb, p_remove jsonb, p_confirm_hard text[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."request_proposals_v1"(p_owner uuid, p_brief uuid, p_revision bigint, p_operation uuid, p_generator text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."retry_proposals_v1"(p_owner uuid, p_generation uuid, p_operation uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."claim_proposal_generation_v1"(p_owner uuid, p_generation uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."fail_proposal_generation_v1"(p_owner uuid, p_generation uuid, p_token uuid, p_error text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."finish_proposal_generation_v1"(p_owner uuid, p_generation uuid, p_token uuid, p_result jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_proposals_v1"(p_brief uuid, p_generation uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."explore_more_proposals_v1"(p_owner uuid, p_brief uuid, p_revision bigint, p_previous uuid, p_operation uuid, p_generator text, p_refinement jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_proposal_history_v1"(p_brief uuid, p_before bigint) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_trip_handoff_v1"(p_brief_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."confirm_trip_component_v1"(p_trip_id uuid, p_component_id text, p_expected_updated_at timestamp with time zone, p_operation_id uuid, p_expected_evidence_document_id uuid, p_evidence_document_id uuid, p_evidence_role text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_trip_budget_settings_v1"(p_trip_id uuid, p_expected_revision bigint, p_operation_id uuid, p_target_amount numeric, p_maximum_amount numeric, p_currency text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."set_trip_component_cost_v1"(p_trip_id uuid, p_component_id text, p_expected_revision bigint, p_operation_id uuid, p_expected_amount numeric, p_confirmed_amount numeric, p_currency text, p_expected_quality text, p_verified_at timestamp with time zone, p_scope jsonb, p_unknown_required_costs jsonb, p_excluded_costs jsonb, p_evidence_document_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."create_travel_book_v1"(p_trip_id uuid, p_book_id uuid, p_title text, p_operation_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."create_travel_book_edition_v1"(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_title text, p_operation_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."confirm_trip_component_with_cost_v1"(p_trip_id uuid, p_component_id text, p_expected_updated_at timestamp with time zone, p_operation_id uuid, p_expected_evidence_document_id uuid, p_evidence_document_id uuid, p_evidence_role text, p_cost_expected_revision bigint, p_expected_amount numeric, p_confirmed_amount numeric, p_currency text, p_expected_quality text, p_verified_at timestamp with time zone, p_scope jsonb, p_unknown_required_costs jsonb, p_excluded_costs jsonb, p_cost_evidence_document_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_trip_budget_v1"(p_trip_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."ensure_trip_standalone_component_v1"(p_trip_id uuid, p_source_kind text, p_source_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."change_travel_book_structure_v1"(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_expected_structure_version bigint, p_add jsonb, p_remove uuid[], p_order uuid[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."create_travel_book_edition_v1"(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_title text, p_operation_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."change_travel_book_structure_v1"(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_expected_structure_version bigint, p_add jsonb, p_remove uuid[], p_order uuid[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."enforce_trip_car_rental_integrity"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_travel_book_operation_v1"(p_operation_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."discard_construction_trip_v1"(p_trip_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."discard_construction_trip_v1"(p_trip_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."create_travel_book_revision_v1"(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_revision_id uuid, p_expected_structure_version bigint, p_expected_compositions jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."get_travel_book_operation_v1"(p_operation_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."create_trip_with_stops_v1"(p_name text, p_start_date date, p_end_date date, p_stops jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_trip_with_stops_v1"(p_name text, p_start_date date, p_end_date date, p_stops jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."get_my_trips"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_my_trips"() TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."discard_construction_trip_v1"(p_trip_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."ensure_trip_flight_travelers"(p_trip_id uuid, p_flight_ids uuid[], p_names text[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."ensure_trip_flight_travelers"(p_trip_id uuid, p_flight_ids uuid[], p_names text[]) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_travel_book_ingestion_v1"(p_trip_id uuid, p_book_id uuid, p_asset_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."create_travel_book_v1"(p_trip_id uuid, p_book_id uuid, p_title text, p_operation_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."save_travel_book_compositions_v1"(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_changes jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."alb03_finish_v1"(p_asset_id uuid, p_actor uuid, p_lease_id uuid, p_descriptor jsonb, p_error text) TO "service_role";

GRANT EXECUTE ON FUNCTION "app_private"."save_travel_book_compositions_v1"(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_changes jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."create_travel_book_revision_v1"(p_trip_id uuid, p_book_id uuid, p_edition_id uuid, p_operation_id uuid, p_revision_id uuid, p_expected_structure_version bigint, p_expected_compositions jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."capture_travel_book_context_v1"(p_trip_id uuid, p_book_id uuid, p_operation_id uuid, p_kind text, p_source_id uuid, p_fields text[], p_text_reviewed boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."capture_travel_book_context_v1"(p_trip_id uuid, p_book_id uuid, p_operation_id uuid, p_kind text, p_source_id uuid, p_fields text[], p_text_reviewed boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."request_travel_book_photo_v1"(p_trip_id uuid, p_book_id uuid, p_document_id uuid, p_operation_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."request_travel_book_photo_v1"(p_trip_id uuid, p_book_id uuid, p_document_id uuid, p_operation_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "app_private"."get_travel_book_ingestion_v1"(p_trip_id uuid, p_book_id uuid, p_asset_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."alb03_claim_v1"(p_asset_id uuid, p_actor uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "app_private"."alb03_claim_v1"(p_asset_id uuid, p_actor uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."alb03_finish_v1"(p_asset_id uuid, p_actor uuid, p_lease_id uuid, p_descriptor jsonb, p_error text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."finalize_trip_photo"(p_trip_id uuid, p_document_id uuid, p_title text, p_file_name text, p_mime_type text, p_upload_batch_id uuid, p_selection_index integer, p_local_date date, p_activity_id uuid, p_itinerary_item_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."finalize_trip_photo"(p_trip_id uuid, p_document_id uuid, p_title text, p_file_name text, p_mime_type text, p_upload_batch_id uuid, p_selection_index integer, p_local_date date, p_activity_id uuid, p_itinerary_item_id uuid) TO "service_role";

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

-- Non-personal configuration constant from the reviewed place-resolution migration.

INSERT INTO place_private.settings(singleton,fresh_days) VALUES(true,90);

COMMIT;

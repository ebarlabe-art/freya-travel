-- ALB-03: allow benign ".." inside a filename while still rejecting traversal segments.
create or replace function app_private.request_travel_book_photo_v1(p_trip_id uuid,p_book_id uuid,p_document_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;

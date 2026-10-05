reset role;
create temporary table ingestion_fixture as select gen_random_uuid() photo,gen_random_uuid() op,null::uuid asset,null::uuid lease;
grant select,update on ingestion_fixture to authenticated,service_role;
insert into public.travel_documents(id,trip_id,title,category,file_name,file_path,mime_type,created_by)
select i.photo,f.trip,'Sunset','Foto','sunset.png',f.trip::text||'/photos/'||i.photo::text||'.png','image/png',f.a from alb_fixture f,ingestion_fixture i;
insert into storage.objects(bucket_id,name) select 'trip-documents',file_path from public.travel_documents where id=(select photo from ingestion_fixture);
insert into public.trip_photo_metadata(document_id,trip_id,local_date) select i.photo,f.trip,'2026-10-01' from ingestion_fixture i,alb_fixture f;
set local role authenticated;
do $$declare f alb_fixture;i ingestion_fixture;r jsonb;r2 jsonb;s jsonb;begin
 select * into f from alb_fixture;select * into i from ingestion_fixture;
 r:=public.request_travel_book_photo_v1(f.trip,f.book,i.photo,i.op);
 r2:=public.request_travel_book_photo_v1(f.trip,f.book,i.photo,i.op);
 perform pg_temp.assert_alb(r=r2,'operation replay');
 r2:=public.request_travel_book_photo_v1(f.trip,f.book,i.photo,gen_random_uuid());
 perform pg_temp.assert_alb(r=r2,'same source version reused across operations');
 update ingestion_fixture set asset=(r->>'asset_id')::uuid;
 perform pg_temp.assert_alb((select status='pending' from public.travel_book_assets where id=(r->>'asset_id')::uuid),'pending until physical verification');
 perform pg_temp.assert_alb((select payload='{"local_date":"2026-10-01"}'::jsonb from public.travel_book_source_snapshots where id=(r->>'snapshot_id')::uuid),'photo snapshot minimal, title not automatically copied');
 perform pg_temp.expect_alb_error(format('select public.get_travel_book_ingestion_v1(%L,%L,%L)',f.trip,f.other_book,r->>'asset_id'),'P0002');
 perform pg_temp.expect_alb_error(format('select public.request_travel_book_photo_v1(%L,%L,%L,%L)',f.other_trip,f.cross_book,i.photo,gen_random_uuid()),'P0002');
 perform pg_temp.expect_alb_error(format('select public.request_travel_book_photo_v1(%L,%L,%L,%L)',f.trip,f.other_book,i.photo,i.op),'22023');
 perform pg_temp.expect_alb_error(format('select public.capture_travel_book_context_v1(%L,%L,%L,''trip'',%L,array[''label''],false)',f.trip,f.book,gen_random_uuid(),f.trip),'22023');
 perform pg_temp.expect_alb_error(format('select public.capture_travel_book_context_v1(%L,%L,%L,''trip'',%L,array[''booking_reference''],true)',f.trip,f.book,gen_random_uuid(),f.trip),'22023');
 s:=public.capture_travel_book_context_v1(f.trip,f.book,gen_random_uuid(),'trip',f.trip,array['label'],true);
 perform pg_temp.assert_alb((select payload='{"label":"ALB fixture"}'::jsonb and classification='context' from public.travel_book_source_snapshots where id=(s->>'snapshot_id')::uuid),'reviewed trip source is context');
 perform pg_temp.assert_alb(s=public.capture_travel_book_context_v1(f.trip,f.book,gen_random_uuid(),'trip',f.trip,array['label'],true),'identical snapshot reused');
 perform pg_temp.assert_alb(not has_function_privilege('authenticated','public.alb03_claim_v1(uuid,uuid)','EXECUTE'),'client cannot claim');
 perform pg_temp.assert_alb(not has_function_privilege('authenticated','public.alb03_finish_v1(uuid,uuid,uuid,jsonb,text)','EXECUTE'),'client cannot mark ready');
end$$;
reset role;
update public.trips set name='booking_ref: PRIVATE123' where id=(select trip from alb_fixture);
set local role authenticated;
select pg_temp.expect_alb_error(format('select public.capture_travel_book_context_v1(%L,%L,%L,''trip'',%L,array[''label''],true)',trip,book,gen_random_uuid(),trip),'22023') from alb_fixture;
reset role;
create function pg_temp.alb_descriptor(aid uuid) returns jsonb language plpgsql as $$
declare a public.travel_book_assets;root text;d jsonb;kind text;begin
 select * into a from public.travel_book_assets where id=aid;
 root:=a.trip_id::text||'/'||a.book_id::text||'/'||a.asset_key::text||'/'||a.version::text||'/v1/';
 d:='{}';
 foreach kind in array array['original','preview','thumbnail'] loop
 d:=d||jsonb_build_object(kind,jsonb_build_object('hash',repeat('b',64),'width',100,'height',80,'path',root||kind||'.png','mime','image/png','ext','png','byte_size',100,'orientation',1));end loop;return d;
end$$;
-- Fixtures call the trusted boundary as postgres: descriptors are not proof of physical IO.
-- Real bytes and read-back verification are covered separately by WASM/orchestration tests.
do $$declare i ingestion_fixture;f alb_fixture;j jsonb;begin
 select * into i from ingestion_fixture;select * into f from alb_fixture;
 j:=public.alb03_claim_v1(i.asset,f.a);update ingestion_fixture set lease=(j#>>'{job,lease_id}')::uuid;
 perform pg_temp.expect_alb_error(format('select public.alb03_claim_v1(%L,%L)',i.asset,f.a),'55P03');
 perform public.alb03_finish_v1(i.asset,f.a,(j#>>'{job,lease_id}')::uuid,null,'STORAGE_ERROR');
 perform pg_temp.assert_alb((select status='pending' from public.travel_book_assets where id=i.asset),'retryable failure stays pending');
 j:=public.alb03_claim_v1(i.asset,f.a);
 perform pg_temp.expect_alb_error(format('select public.alb03_finish_v1(%L,%L,%L,%L::jsonb,null)',i.asset,f.a,(select lease from ingestion_fixture),pg_temp.alb_descriptor(i.asset)),'40001');
 perform public.alb03_finish_v1(i.asset,f.a,(j#>>'{job,lease_id}')::uuid,jsonb_build_object('original',pg_temp.alb_descriptor(i.asset)->'original'));
 perform pg_temp.assert_alb((select status='pending' from public.travel_book_assets where id=i.asset),'original alone is not ready');
 perform pg_temp.assert_alb((public.get_travel_book_ingestion_v1(f.trip,f.book,i.asset)->>'processing_state')='derivative_pending','explicit derivative pending');
 perform pg_temp.expect_alb_error(format('update public.travel_book_asset_variants set content_hash=%L where asset_id=%L and kind=''original''',repeat('c',64),i.asset),'55000');
 perform public.alb03_finish_v1(i.asset,f.a,(j#>>'{job,lease_id}')::uuid,pg_temp.alb_descriptor(i.asset));
 perform pg_temp.assert_alb((select status='ready' and storage_path not like '%?%' from public.travel_book_assets where id=i.asset),'verified ready with stable path');
 perform pg_temp.assert_alb((select count(*)=3 from public.travel_book_asset_variants where asset_id=i.asset),'original and both derivatives persisted');
 perform pg_temp.expect_alb_error(format('update public.travel_book_assets set content_hash=%L where id=%L',repeat('c',64),i.asset),'55000');
 perform pg_temp.expect_alb_error(format('update public.travel_book_asset_variants set width_px=1 where asset_id=%L',i.asset),'55000');
end$$;
-- A replacement object creates the next version in the same book-local family.
do $$declare f alb_fixture;i ingestion_fixture;r jsonb;second uuid;j jsonb;begin
 select * into f from alb_fixture;select * into i from ingestion_fixture;
 update storage.objects set updated_at=updated_at+interval '1 second' where bucket_id='trip-documents' and name=f.trip::text||'/photos/'||i.photo::text||'.png';
 r:=public.request_travel_book_photo_v1(f.trip,f.book,i.photo,gen_random_uuid());second:=(r->>'asset_id')::uuid;
 perform pg_temp.assert_alb(second<>i.asset and (select version=2 and asset_key=(select asset_key from public.travel_book_assets where id=i.asset) from public.travel_book_assets where id=second),'new source version keeps asset family');
 perform pg_temp.expect_alb_error(format('insert into public.travel_book_asset_variants(trip_id,book_id,asset_id,kind,pipeline_version,content_hash,width_px,height_px,mime_type,storage_bucket,storage_path,file_extension,byte_size,orientation) values(%L,%L,%L,''preview'',1,%L,1,1,''image/png'',''travel-book'',''x'',''png'',100,1)',f.trip,f.other_book,second,repeat('a',64)),'23503');
 j:=public.alb03_claim_v1(second,f.a);
 update storage.objects set updated_at=updated_at+interval '1 second' where bucket_id='trip-documents' and name=f.trip::text||'/photos/'||i.photo::text||'.png';
 perform pg_temp.expect_alb_error(format('select public.alb03_finish_v1(%L,%L,%L,%L::jsonb,null)',second,f.a,j#>>'{job,lease_id}',pg_temp.alb_descriptor(second)),'40001');
 perform public.alb03_finish_v1(second,f.a,(j#>>'{job,lease_id}')::uuid,null,'SOURCE_CHANGED');
 perform pg_temp.assert_alb((select status='pending' from public.travel_book_assets where id=second),'changed source cannot finalize');
end$$;
-- HEIC original is durable and readable while ALB-02 remains pending (no MIME constraint changes).
do $$declare f alb_fixture;i ingestion_fixture;r jsonb;j jsonb;aid uuid;d jsonb;begin
 select * into f from alb_fixture;select * into i from ingestion_fixture;
 update public.travel_documents set mime_type='image/heic' where id=i.photo;
 r:=public.request_travel_book_photo_v1(f.trip,f.book,i.photo,gen_random_uuid());aid:=(r->>'asset_id')::uuid;
 j:=public.alb03_claim_v1(aid,f.a);
 d:=jsonb_build_object('original',(pg_temp.alb_descriptor(aid)->'original')||jsonb_build_object('mime','image/heic','ext','heic','orientation',0,'path',replace(pg_temp.alb_descriptor(aid)#>>'{original,path}','original.png','original.heic')));
 perform public.alb03_finish_v1(aid,f.a,(j#>>'{job,lease_id}')::uuid,d);
 perform pg_temp.assert_alb((select status='pending' and content_hash is null and mime_type is null from public.travel_book_assets where id=aid),'HEIC does not pretend to be web ready');
 perform pg_temp.assert_alb(app_private.alb03_can_read_object_v1(d#>>'{original,path}'),'member can read preserved original while pending');
 perform pg_temp.expect_alb_error(format('select public.alb03_finish_v1(%L,%L,%L,%L::jsonb)',aid,f.a,j#>>'{job,lease_id}',jsonb_set(d,'{original,hash}',to_jsonb(repeat('c',64)))),'55000');
 perform public.alb03_finish_v1(aid,f.a,(j#>>'{job,lease_id}')::uuid,null,'DERIVATIVE_UNSUPPORTED');
 perform pg_temp.assert_alb((public.get_travel_book_ingestion_v1(f.trip,f.book,aid)->>'processing_state')='derivative_pending','HEIC processing state explicit');
 perform pg_temp.assert_alb((select mime_type='image/heic' and file_extension='heic' from public.travel_book_asset_variants where asset_id=aid),'HEIC original format retained');
end$$;
-- Source deletion preserves editorial snapshot and verified descriptor.
delete from public.travel_documents where id=(select photo from ingestion_fixture);
select pg_temp.assert_alb((select source_document_id is null and source_document_id_at_capture=(select photo from ingestion_fixture) and status='ready' from public.travel_book_assets where id=(select asset from ingestion_fixture)),'source deletion preserves ready asset and historical ID');
set local role authenticated;
select pg_temp.assert_alb((public.get_travel_book_ingestion_v1(f.trip,f.book,i.asset)#>>'{asset,status}')='ready','state available after source deletion') from alb_fixture f,ingestion_fixture i;
select pg_temp.assert_alb((select count(*)=3 from public.travel_book_asset_variants where asset_id=(select asset from ingestion_fixture)),'member reads derivatives');
reset role;
delete from public.trip_members where trip_id=(select trip from alb_fixture) and user_id=(select a from alb_fixture);
set local role authenticated;
select pg_temp.assert_alb((select count(*)=0 from public.travel_book_asset_variants),'RLS after revocation');
select pg_temp.expect_alb_error(format('select public.get_travel_book_ingestion_v1(%L,%L,%L)',f.trip,f.book,i.asset),'42501') from alb_fixture f,ingestion_fixture i;
reset role;
insert into public.trip_members(trip_id,user_id) select trip,a from alb_fixture;
update public.trips set discarded_at=now(),discarded_by=(select a from alb_fixture) where id=(select trip from alb_fixture);
select pg_temp.expect_alb_error(format('select public.alb03_claim_v1(%L,%L)',i.asset,f.a),'42501') from alb_fixture f,ingestion_fixture i;
select pg_temp.assert_alb((select not public from storage.buckets where id='travel-book'),'private bucket');
select pg_temp.assert_alb(not has_table_privilege('authenticated','public.travel_book_asset_variants','INSERT,UPDATE,DELETE'),'no direct client writes');
select pg_temp.assert_alb(not has_table_privilege('service_role','app_private.alb03_ingestions','INSERT,UPDATE,DELETE'),'service uses RPC only');
rollback;

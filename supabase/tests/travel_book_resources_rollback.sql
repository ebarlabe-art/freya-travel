reset role;
create temporary table alb_resources as select gen_random_uuid() doc,gen_random_uuid() asset,gen_random_uuid() foreign_asset,gen_random_uuid() snapshot,gen_random_uuid() revision;
grant select on alb_resources to authenticated;
do $$declare f alb_fixture;r alb_resources;begin
 select * into f from alb_fixture;select * into r from alb_resources;
 insert into public.travel_documents(id,trip_id,title,category,file_name,file_path,created_by) values(r.doc,f.trip,'Photo','Foto','photo.jpg',f.trip||'/photos/'||r.doc||'.jpg',f.a);
 insert into public.travel_book_assets(id,trip_id,book_id,asset_key,version,source_document_id,source_document_id_at_capture,created_by,updated_by)
 values(r.asset,f.trip,f.book,gen_random_uuid(),1,r.doc,r.doc,f.a,f.a),(r.foreign_asset,f.trip,f.other_book,gen_random_uuid(),1,null,null,f.a,f.a);
 insert into public.travel_book_source_snapshots(id,trip_id,book_id,source_kind,source_id,classification,origin,availability_at_capture,payload,captured_at,created_by)
 values(r.snapshot,f.trip,f.book,'trip',f.trip,'context','trip_source','available','{"label":"Planned trip"}',clock_timestamp(),f.a);
end$$;
set local role authenticated;
do $$declare f alb_fixture;r alb_resources;d jsonb;req jsonb;expected jsonb;begin
 select * into f from alb_fixture;select * into r from alb_resources;
 select document into d from public.travel_book_composition_versions where composition_id=f.c1 and version=1;
 d:=jsonb_set(d,'{canvas}','{"unit":"mm","width":100,"height":100}');
 d:=jsonb_set(d,'{elements}',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'type','image','asset_id',r.asset,'geometry',jsonb_build_object('x',0,'y',0,'width',20,'height',20,'rotation',0),'locks',jsonb_build_object('content',false,'geometry',false),'crop',jsonb_build_object('x',0,'y',0,'width',1,'height',1))));
 req:=jsonb_build_array(jsonb_build_object('expected_version',1,'document',d));
 perform public.save_travel_book_compositions_v1(f.trip,f.book,f.edition,gen_random_uuid(),req);
 perform pg_temp.assert_alb((select count(*)=1 from public.travel_book_resource_refs where asset_id=r.asset),'refs extracted by server');
 select jsonb_agg(jsonb_build_object('id',id,'version',current_version)) into expected from public.travel_book_compositions where edition_id=f.edition;
 perform public.create_travel_book_revision_v1(f.trip,f.book,f.edition,gen_random_uuid(),r.revision,2,expected);
 perform pg_temp.assert_alb((select resource_state_at_capture='incomplete' from public.travel_book_revisions where id=r.revision),'pending resource checkpoint incomplete');
 d:=jsonb_set(d,'{elements,0,asset_id}',to_jsonb(r.foreign_asset));
 req:=jsonb_build_array(jsonb_build_object('expected_version',2,'document',d));
 perform pg_temp.expect_alb_error(format('select public.save_travel_book_compositions_v1(%L,%L,%L,%L,%L)',f.trip,f.book,f.edition,gen_random_uuid(),req),'23503');
end$$;
reset role;
do $$declare f alb_fixture;r alb_resources;begin
 select * into f from alb_fixture;select * into r from alb_resources;
 delete from public.travel_documents where id=r.doc;
 perform pg_temp.assert_alb((select source_document_id is null and source_document_id_at_capture=r.doc from public.travel_book_assets where id=r.asset),'gallery deletion preserves asset and historical origin');
 perform pg_temp.assert_alb(exists(select 1 from public.travel_book_resource_refs where asset_id=r.asset),'gallery deletion preserves uses');
 update public.travel_book_assets set status='ready',content_hash=repeat('a',64),mime_type='image/jpeg',width_px=100,height_px=100,storage_bucket='editorial-test',storage_path='immutable/test.jpg',verified_at=clock_timestamp() where id=r.asset;
 perform pg_temp.expect_alb_error(format('update public.travel_book_assets set content_hash=repeat(%L,64) where id=%L','b',r.asset),'55000');
 perform pg_temp.assert_alb((select resource_state_at_capture='incomplete' and manifest#>>'{assets,0,status}'='pending' from public.travel_book_revisions where id=r.revision),'checkpoint never upgrades after resources become ready');
 perform pg_temp.expect_alb_error(format('delete from public.travel_book_source_snapshots where id=%L',r.snapshot),'55000');
 perform pg_temp.expect_alb_error(format('insert into public.travel_book_resource_refs(composition_id,composition_version,trip_id,book_id,edition_id,ref_key,element_id,resource_kind,asset_id,usage) values(%L,2,%L,%L,%L,%L,gen_random_uuid(),%L,%L,%L)',f.c1,f.trip,f.book,f.edition,'bad','asset',r.foreign_asset,'image'),'23503');
end$$;
rollback;

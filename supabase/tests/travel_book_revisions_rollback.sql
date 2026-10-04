do $$declare f alb_fixture;r jsonb;rev uuid:=gen_random_uuid();expected jsonb;op uuid:=gen_random_uuid();begin
 select * into f from alb_fixture;
 select jsonb_agg(jsonb_build_object('id',id,'version',current_version)) into expected from public.travel_book_compositions where edition_id=f.edition;
 r:=public.create_travel_book_revision_v1(f.trip,f.book,f.edition,op,rev,2,expected);
 perform pg_temp.assert_alb((select count(*)=2 from public.travel_book_revision_compositions where revision_id=rev),'revision pins versions with FKs');
 perform pg_temp.alb_save(f.c1,1,'later');
 perform pg_temp.assert_alb((select composition_version=1 from public.travel_book_revision_compositions where revision_id=rev and composition_id=f.c1),'later save preserves revision');
 perform pg_temp.assert_alb(public.create_travel_book_revision_v1(f.trip,f.book,f.edition,op,rev,2,expected)-'replayed'=r-'replayed','revision replay returns original');
 perform pg_temp.expect_alb_error(format('select public.create_travel_book_revision_v1(%L,%L,%L,%L,%L,2,%L)',f.trip,f.book,f.edition,gen_random_uuid(),gen_random_uuid(),expected),'40001');
end$$;
reset role;
do $$declare f alb_fixture;r uuid;begin
 select * into f from alb_fixture;select id into r from public.travel_book_revisions where edition_id=f.edition;
 perform pg_temp.expect_alb_error(format('update public.travel_book_revisions set manifest=%L where id=%L','{}',r),'55000');
 perform pg_temp.expect_alb_error(format('delete from public.travel_book_composition_versions where composition_id=%L',f.c1),'55000');
 perform pg_temp.expect_alb_error(format('delete from public.trips where id=%L',f.trip),'23503');
 perform pg_temp.expect_alb_error(format('insert into public.travel_book_revision_compositions(revision_id,composition_id,composition_version,trip_id,book_id,edition_id) values(%L,%L,1,%L,%L,%L)',r,gen_random_uuid(),f.trip,f.book,f.edition),'23503');
 perform pg_temp.expect_alb_error(format('insert into public.travel_book_pages(id,trip_id,book_id,edition_id,composition_id,slot,created_by) values(gen_random_uuid(),%L,%L,%L,%L,1,%L)',f.other_trip,f.cross_book,f.edition,f.c1,f.a),'23503');
end$$;
rollback;

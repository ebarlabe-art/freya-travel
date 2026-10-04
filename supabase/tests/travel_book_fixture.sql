-- Test-only fixture, prepended by the local runner within each rollback suite.
begin;
create temporary table alb_fixture as select gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() outsider,gen_random_uuid() trip,gen_random_uuid() other_trip,
 gen_random_uuid() book,gen_random_uuid() other_book,gen_random_uuid() cross_book,gen_random_uuid() edition,gen_random_uuid() other_edition,
 gen_random_uuid() c1,gen_random_uuid() c2,gen_random_uuid() p1,gen_random_uuid() p2,gen_random_uuid() p3;
grant select on alb_fixture to authenticated;
create function pg_temp.assert_alb(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
create function pg_temp.expect_alb_error(command text,expected text) returns void language plpgsql as $$
declare actual text;
begin
 begin execute command; exception when others then get stacked diagnostics actual=returned_sqlstate; if actual=expected then return;end if;raise exception 'Expected %, got %: %',expected,actual,sqlerrm;end;
 raise exception 'Expected error %, command succeeded: %',expected,command;
end$$;
do $$declare f alb_fixture;begin
 select * into f from alb_fixture;
 insert into auth.users(id) values(f.a),(f.b),(f.outsider);
 insert into public.trips(id,name,owner_id,time_zone) values(f.trip,'ALB fixture',f.a,'UTC'),(f.other_trip,'Other ALB fixture',f.a,'UTC');
 insert into public.trip_members(trip_id,user_id) values(f.trip,f.a),(f.trip,f.b),(f.other_trip,f.a);
 perform set_config('request.jwt.claim.sub',f.a::text,true);
end$$;
set local role authenticated;
do $$declare f alb_fixture;begin
 select * into f from alb_fixture;
 perform public.create_travel_book_v1(f.trip,f.book,'Book',gen_random_uuid());
 perform public.create_travel_book_v1(f.trip,f.other_book,'Other book',gen_random_uuid());
 perform public.create_travel_book_v1(f.other_trip,f.cross_book,'Other trip book',gen_random_uuid());
 perform public.create_travel_book_edition_v1(f.trip,f.book,f.edition,'Edition',gen_random_uuid());
 perform public.create_travel_book_edition_v1(f.trip,f.book,f.other_edition,'Second edition',gen_random_uuid());
 perform public.change_travel_book_structure_v1(f.trip,f.book,f.edition,gen_random_uuid(),1,jsonb_build_array(jsonb_build_object('id',f.c1,'page_ids',jsonb_build_array(f.p1)),jsonb_build_object('id',f.c2,'page_ids',jsonb_build_array(f.p2,f.p3))),'{}',array[f.c1,f.c2]);
end$$;
create function pg_temp.alb_save(cid uuid,expected bigint,label text,op uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
declare f alb_fixture;d jsonb;begin
 select * into f from alb_fixture;
 select v.document into d from public.travel_book_composition_versions v join public.travel_book_compositions c on c.id=v.composition_id and c.current_version=v.version where c.id=cid;
 d:=jsonb_set(d,'{metadata,label}',to_jsonb(label));
 return public.save_travel_book_compositions_v1(f.trip,f.book,f.edition,op,jsonb_build_array(jsonb_build_object('expected_version',expected,'document',d)));
end$$;

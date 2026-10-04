begin;
create function pg_temp.assert_alb(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;end$$;
select pg_temp.assert_alb((select count(*)=11 from pg_tables where schemaname='public' and tablename like 'travel_book%'),'eleven tables');
select pg_temp.assert_alb((select bool_and(rowsecurity) from pg_tables where schemaname='public' and tablename like 'travel_book%'),'all RLS enabled');
select pg_temp.assert_alb(not exists(select 1 from pg_tables where schemaname='public' and tablename like 'travel_book%' and has_table_privilege('authenticated',format('public.%I',tablename),'INSERT,UPDATE,DELETE')),'no direct member writes');
select pg_temp.assert_alb(not exists(select 1 from pg_tables where schemaname='public' and tablename like 'travel_book%' and has_table_privilege('service_role',format('public.%I',tablename),'INSERT,UPDATE,DELETE')),'no service role bypass writes');
select pg_temp.assert_alb(app_private.travel_book_composition_valid_v1('{"schema_version":1,"composition_id":"00000000-0000-4000-8000-000000000010","kind":"page","page_ids":["00000000-0000-4000-8000-000000000011"],"canvas":{"unit":"mm","width":null,"height":null},"elements":[],"locks":{"layout":false},"metadata":{"label":null}}'),'pending canvas valid');
select pg_temp.assert_alb(not app_private.travel_book_snapshot_valid_v1('{"booking_ref":"secret"}'),'snapshot rejects sensitive unknown fields');
select pg_temp.assert_alb(not app_private.travel_book_snapshot_valid_v1('{"local_date":"2026-02-31"}'),'snapshot validates actual date');

select pg_temp.assert_alb(app_private.travel_book_hash_v1('{}')='44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a','hash v1 known SHA-256 vector');
select pg_temp.assert_alb(app_private.travel_book_hash_v1('{"b":2,"a":1}')=app_private.travel_book_hash_v1('{"a":1,"b":2}'),'hash independent of input key order');
select pg_temp.assert_alb(not has_function_privilege('authenticated','app_private.travel_book_finish_v1(uuid,uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE'),'receipt helper cannot be called by member');
select pg_temp.assert_alb(not has_function_privilege('anon','public.create_travel_book_v1(uuid,uuid,text,uuid)','EXECUTE'),'anon cannot create');
do $$ declare d jsonb:='{"schema_version":1,"composition_id":"00000000-0000-4000-8000-000000000010","kind":"page","page_ids":["00000000-0000-4000-8000-000000000011"],"canvas":{"unit":"mm","width":null,"height":null},"elements":[],"locks":{"layout":false},"metadata":{"label":null}}';begin
 perform pg_temp.assert_alb(not app_private.travel_book_composition_valid_v1(d||'{"extra":true}'),'unknown document property');
 perform pg_temp.assert_alb(not app_private.travel_book_composition_valid_v1(jsonb_set(d,'{schema_version}','2')),'unsupported schema');
 perform pg_temp.assert_alb(not app_private.travel_book_composition_valid_v1(jsonb_set(d,'{canvas,width}','10')),'partial canvas');
 perform pg_temp.assert_alb(not app_private.travel_book_composition_valid_v1(jsonb_set(d,'{kind}','"spread"')),'spread needs two pages');
end$$;
rollback;

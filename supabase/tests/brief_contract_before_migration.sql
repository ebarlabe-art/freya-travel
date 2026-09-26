-- Disposable database only: real v1 rows/receipts, not synthetic rewrites.
insert into auth.users(id) values ('41000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',false);
do $$ declare i integer; strength text; patch jsonb; begin
  for i in 1..4 loop
    strength:=(array['hard','preference','flexible'])[i];
    patch:=case when i=4 then '{}'::jsonb else jsonb_build_object('decisions',jsonb_build_object(
      'legacy',jsonb_build_object('field','interests','scope','global','origin','explicit_user','knowledge','known','strength',strength,'value',jsonb_build_array('Neu','Mercats de Nadal')),
      'hotel',jsonb_build_object('field','hotel.amenities','scope','global','origin','explicit_user','knowledge','known','strength',strength,'value',jsonb_build_array('spa')))) end;
    perform public.apply_trip_brief_patch_v1(('41000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('42000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,0,patch);
  end loop;
end $$;
create table public.tb011_rows_before as select to_jsonb(b) as row from public.trip_briefs b;
create table public.tb011_receipts_before as select to_jsonb(o) as row from public.trip_brief_operations o;
create table public.tb011_rpc_before as select pg_get_functiondef('public.apply_trip_brief_patch_v1(uuid,uuid,bigint,jsonb,jsonb,text[])'::regprocedure) as definition;

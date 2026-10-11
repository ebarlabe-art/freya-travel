-- STAGING ONLY. Synthetic trip-creation smoke test with full rollback.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('a1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','test-create-trip@example.invalid','',now(),'{}','{}',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $check$
declare actual integer;
begin
 perform 1 from public.create_trip_v2('Riga - prova','2026-12-27'::date,'2026-12-30'::date,'Europe/Riga');
 select count(*) into actual from public.get_my_trips();
 if actual<>1 then raise exception 'CREATE_TRIP_V2_FAILED'; end if;
 select count(*) into actual from public.checklist_items;
 if actual<>10 then raise exception 'GENERIC_CHECKLIST_FAILED: %',actual; end if;
end $check$;
rollback;
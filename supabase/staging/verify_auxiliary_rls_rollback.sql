-- Isolated Supabase PROVES only. Entire test is rollback-only.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('a1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','aux-alice@example.invalid','',now(),'{}','{}',now(),now()),
('b2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','aux-bob@example.invalid','',now(),'{}','{}',now(),now());
insert into public.trips(id,name,owner_id) values
('c3333333-3333-4333-8333-333333333333','A','a1111111-1111-4111-8111-111111111111'),
('d4444444-4444-4444-8444-444444444444','B','b2222222-2222-4222-8222-222222222222');
insert into public.trip_members(trip_id,user_id) values
('c3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111'),
('d4444444-4444-4444-8444-444444444444','b2222222-2222-4222-8222-222222222222');
insert into public.travel_parking(trip_id,parking_name,updated_by) values
('c3333333-3333-4333-8333-333333333333','Car park A','a1111111-1111-4111-8111-111111111111'),
('d4444444-4444-4444-8444-444444444444','Car park B','b2222222-2222-4222-8222-222222222222');
insert into public.push_subscriptions(user_id,trip_id,endpoint,p256dh,auth) values
('a1111111-1111-4111-8111-111111111111','c3333333-3333-4333-8333-333333333333','https://push.invalid/a','synthetic','synthetic'),
('b2222222-2222-4222-8222-222222222222','d4444444-4444-4444-8444-444444444444','https://push.invalid/b','synthetic','synthetic');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $verify$
declare denied boolean;
begin
 if (select count(*) from public.travel_parking)<>1 then raise exception 'A_PARKING_LEAK'; end if;
 if (select count(*) from public.push_subscriptions)<>1 then raise exception 'A_PUSH_LEAK'; end if;
 denied:=false;
 begin
  insert into public.travel_parking(trip_id,parking_name,updated_by)
  values('d4444444-4444-4444-8444-444444444444','Wrong','a1111111-1111-4111-8111-111111111111')
  on conflict (trip_id) do update set parking_name=excluded.parking_name;
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'A_CAN_MUTATE_B_PARKING'; end if;
 denied:=false;
 begin
  insert into public.push_subscriptions(user_id,trip_id,endpoint,p256dh,auth)
  values('a1111111-1111-4111-8111-111111111111','d4444444-4444-4444-8444-444444444444','https://push.invalid/attack','synthetic','synthetic');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'A_CAN_REGISTER_B_PUSH'; end if;
end $verify$;
select set_config('request.jwt.claim.sub','b2222222-2222-4222-8222-222222222222',true);
do $verify$
begin
 if (select count(*) from public.travel_parking)<>1 then raise exception 'B_PARKING_LEAK'; end if;
 if (select count(*) from public.push_subscriptions)<>1 then raise exception 'B_PUSH_LEAK'; end if;
end $verify$;
reset role;
delete from public.trip_members where trip_id='c3333333-3333-4333-8333-333333333333';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $verify$
begin
 if (select count(*) from public.travel_parking)<>0 then raise exception 'REVOKED_PARKING_VISIBLE'; end if;
end $verify$;
rollback;
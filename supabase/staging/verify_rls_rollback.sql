-- STAGING ONLY. Synthetic two-account RLS assertions with rollback.
-- Run on isolated project waatqrqyddurultrazbn. No rows survive this test.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('a1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','stage-alice-rls@example.invalid','',now(),'{}','{}',now(),now()),
('b2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','stage-bob-rls@example.invalid','',now(),'{}','{}',now(),now());
insert into public.trips(id,name,owner_id) values
('c3333333-3333-4333-8333-333333333333','Test A','a1111111-1111-4111-8111-111111111111'),
('d4444444-4444-4444-8444-444444444444','Test B','b2222222-2222-4222-8222-222222222222');
insert into public.trip_members(trip_id,user_id) values
('c3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111'),
('d4444444-4444-4444-8444-444444444444','b2222222-2222-4222-8222-222222222222');
insert into public.travel_documents(trip_id,title,file_name,file_path,mime_type,created_by) values
('c3333333-3333-4333-8333-333333333333','Test A','a.pdf','c3333333-3333-4333-8333-333333333333/a.pdf','application/pdf','a1111111-1111-4111-8111-111111111111'),
('d4444444-4444-4444-8444-444444444444','Test B','b.pdf','d4444444-4444-4444-8444-444444444444/b.pdf','application/pdf','b2222222-2222-4222-8222-222222222222');
insert into storage.objects(bucket_id,name) values
('trip-documents','c3333333-3333-4333-8333-333333333333/a.pdf'),
('trip-documents','d4444444-4444-4444-8444-444444444444/b.pdf');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $check$
declare rejected boolean;
begin
 if (select count(*) from public.trips)<>1 then raise exception 'A_TRIP_RLS_FAILED'; end if;
 if (select count(*) from public.travel_documents)<>1 then raise exception 'A_DOCUMENT_RLS_FAILED'; end if;
 if (select count(*) from storage.objects where bucket_id='trip-documents')<>1 then raise exception 'A_STORAGE_RLS_FAILED'; end if;
 if app_private.staging_document_storage_member('trip-documents','d4444444-4444-4444-8444-444444444444/b.pdf') then raise exception 'A_CAN_READ_B_STORAGE'; end if;
 if app_private.staging_document_storage_member('trip-documents','not-a-uuid/a.pdf') then raise exception 'UNSAFE_STORAGE_PATH'; end if;
 rejected:=false;
 begin
  insert into public.travel_documents(trip_id,title,file_name,file_path,mime_type,created_by)
  values ('d4444444-4444-4444-8444-444444444444','attack','attack.pdf','d4444444-4444-4444-8444-444444444444/attack.pdf','application/pdf','a1111111-1111-4111-8111-111111111111');
 exception when insufficient_privilege then rejected:=true;
 end;
 if not rejected then raise exception 'A_CAN_INSERT_B_DOCUMENT'; end if;
 rejected:=false;
 begin
  insert into storage.objects(bucket_id,name)
  values ('trip-documents','d4444444-4444-4444-8444-444444444444/attack.pdf');
 exception when insufficient_privilege then rejected:=true;
 end;
 if not rejected then raise exception 'A_CAN_INSERT_B_FILE'; end if;
end $check$;

select set_config('request.jwt.claim.sub','b2222222-2222-4222-8222-222222222222',true);
do $check$
begin
 if (select count(*) from public.trips)<>1 then raise exception 'B_TRIP_RLS_FAILED'; end if;
 if (select count(*) from public.travel_documents)<>1 then raise exception 'B_DOCUMENT_RLS_FAILED'; end if;
 if (select count(*) from storage.objects where bucket_id='trip-documents')<>1 then raise exception 'B_STORAGE_RLS_FAILED'; end if;
 if app_private.staging_document_storage_member('trip-documents','c3333333-3333-4333-8333-333333333333/a.pdf') then raise exception 'B_CAN_READ_A_STORAGE'; end if;
end $check$;

reset role;
delete from public.trip_members where trip_id='c3333333-3333-4333-8333-333333333333';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
do $check$
begin
 if (select count(*) from public.trips)<>0 then raise exception 'REVOKED_TRIP_STILL_VISIBLE'; end if;
 if (select count(*) from public.travel_documents)<>0 then raise exception 'REVOKED_DOCUMENT_STILL_VISIBLE'; end if;
 if (select count(*) from storage.objects where bucket_id='trip-documents')<>0 then raise exception 'REVOKED_STORAGE_STILL_VISIBLE'; end if;
end $check$;
rollback;
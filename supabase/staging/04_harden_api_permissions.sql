-- STAGING ONLY: Supabase bootstrap default function grants left legacy RPCs
-- executable by anon despite REVOKE FROM PUBLIC. Remove that exposure.
revoke execute on function public.create_trip(text) from anon;
revoke execute on function public.join_trip(text) from anon;
revoke execute on function public.get_my_trip() from anon;
revoke execute on function public.is_trip_member(uuid) from anon;

-- The Storage membership helper is internal RLS plumbing, not an API RPC.
-- Move its original OID to an unexposed schema; existing policies keep
-- referencing it without changing their authorization checks.
create schema if not exists app_private;
revoke all on schema app_private from public,anon;
grant usage on schema app_private to authenticated;
alter function public.staging_document_storage_member(text,text)
 set schema app_private;
revoke all on function app_private.staging_document_storage_member(text,text)
 from public,anon;
grant execute on function app_private.staging_document_storage_member(text,text)
 to authenticated;

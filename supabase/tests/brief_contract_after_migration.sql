do $$ begin
  if exists((select row from public.tb011_rows_before except select to_jsonb(b) from public.trip_briefs b)
    union all (select to_jsonb(b) from public.trip_briefs b except select row from public.tb011_rows_before)) then raise exception 'Migration rewrote Brief rows'; end if;
  if exists((select row from public.tb011_receipts_before except select to_jsonb(o) from public.trip_brief_operations o)
    union all (select to_jsonb(o) from public.trip_brief_operations o except select row from public.tb011_receipts_before)) then raise exception 'Migration rewrote receipts'; end if;
  if (select definition from public.tb011_rpc_before)<>pg_get_functiondef('public.apply_trip_brief_patch_v1(uuid,uuid,bigint,jsonb,jsonb,text[])'::regprocedure) then raise exception 'Migration changed RPC'; end if;
  if exists(select 1 from public.trip_briefs where not public.trip_brief_valid_v1(document) or schema_version<>1) then raise exception 'Legacy invalidated'; end if;
end $$;
drop table public.tb011_rows_before,public.tb011_receipts_before,public.tb011_rpc_before;
delete from auth.users where id='41000000-0000-4000-8000-000000000001';

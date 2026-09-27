begin;
do $$ begin
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename in ('proposal_generations','trip_proposals','proposal_operations')) then raise exception 'Unexpected Realtime publication';end if;
 if has_function_privilege('authenticated','public.finish_proposal_generation_v1(uuid,uuid,uuid,jsonb)','execute') or has_function_privilege('anon','public.get_proposals_v1(uuid,uuid)','execute') then raise exception 'Unsafe RPC grants';end if;
 if has_table_privilege('authenticated','public.proposal_operations','select') or has_table_privilege('authenticated','public.trip_proposals','insert') or has_table_privilege('service_role','public.trip_proposals','insert') then raise exception 'Unsafe table grants';end if;
 if exists(select 1 from pg_class where oid in ('public.proposal_generations'::regclass,'public.trip_proposals'::regclass,'public.proposal_operations'::regclass) and not relrowsecurity) then raise exception 'Missing RLS';end if;
end $$;
rollback;

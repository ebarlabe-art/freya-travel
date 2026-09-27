-- TB-04.2: additive round context; historical generation/proposal payloads untouched.
begin;
alter table public.proposal_generations
 add column round_number bigint,
 add column previous_generation_id uuid references public.proposal_generations(id),
 add column refinement jsonb not null default '{"chips":[],"text":""}',
 add column excluded_routes jsonb not null default '[]',
 add column material_key text;
alter table public.proposal_generations add constraint proposal_round_positive check(round_number is null or round_number>0);
create unique index proposal_round_number on public.proposal_generations(brief_id,round_number) where round_number is not null;
create index proposal_previous_generation on public.proposal_generations(previous_generation_id);
-- Preserve initial-generation deduplication, while permitting deliberate child rounds.
do $$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.proposal_generations'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (brief_id, brief_revision, engine_version, generator_version, verifier_version, policy_version)' loop
 execute format('alter table public.proposal_generations drop constraint %I',c.conname);
 end loop;
end $$;
create unique index proposal_initial_identity on public.proposal_generations(brief_id,brief_revision,engine_version,generator_version,verifier_version,policy_version) where previous_generation_id is null;
alter table public.proposal_generations drop constraint proposal_generations_result_reason_check;
alter table public.proposal_generations add constraint proposal_generations_result_reason_check check(result_reason in ('incompatible','insufficient_information','no_new_alternatives'));
alter table public.proposal_operations drop constraint proposal_operations_action_check;
alter table public.proposal_operations add constraint proposal_operations_action_check check(action in ('generate','retry','explore_more'));
create function proposal_private.refinement_valid(r jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(extensions.jsonb_matches_schema('{"type":"object","required":["chips","text"],"additionalProperties":false,"properties":{"chips":{"type":"array","uniqueItems":true,"maxItems":6,"items":{"type":"string","enum":["cheaper","more_snow","more_christmas","fewer_transfers","calmer","different_destinations"]}},"text":{"type":"string","maxLength":1000}}}'::json,r),false);
$$;
alter table public.proposal_generations add constraint proposal_refinement_valid check(proposal_private.refinement_valid(refinement));
alter table public.proposal_generations add constraint proposal_exclusions_limit check(jsonb_typeof(excluded_routes)='array' and octet_length(excluded_routes::text)<=524288);
create function proposal_private.material_key(d jsonb) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
 'decisions',coalesce((select jsonb_agg(v order by v::text) from (select value-'origin'-'label' as v from jsonb_each(d->'decisions') where (value->>'field'<>'notes' and value->>'field' not like 'custom.%') or value->>'strength'='hard') q),'[]'),
 'travelers',coalesce((select jsonb_agg(value order by value::text) from jsonb_each(d->'travelers')),'[]'),
 'scopes',coalesce((select jsonb_object_agg(key,value-'label') from jsonb_each(d->'scopes')),'{}'))::text,'UTF8')),'hex');
$$;
create function proposal_private.route_key(r jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_agg(lower(regexp_replace(btrim(normalize(value->>'destination',NFKC)),'\s+',' ','g')) order by ord) from jsonb_array_elements(r->'stops') with ordinality a(value,ord);
$$;
create function proposal_private.initialize_round() returns trigger language plpgsql set search_path='' as $$
declare previous public.proposal_generations;begin
 perform 1 from public.trip_briefs where id=new.brief_id and owner_id=new.owner_id for update;
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 select count(*)+1 into new.round_number from public.proposal_generations where brief_id=new.brief_id;
 new.material_key=proposal_private.material_key(new.brief_snapshot);
 if new.previous_generation_id is not null then
  select * into previous from public.proposal_generations where id=new.previous_generation_id and brief_id=new.brief_id and owner_id=new.owner_id;
  if not found then raise exception 'Invalid previous generation' using errcode='42501';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('fingerprint',p.fingerprint,'route',p.document#>'{candidate,route}') order by g.created_at,p.position),'[]') into new.excluded_routes
 from public.trip_proposals p join public.proposal_generations g on g.id=p.generation_id where g.brief_id=new.brief_id and coalesce(g.material_key,proposal_private.material_key(g.brief_snapshot))=new.material_key;
 if octet_length(new.excluded_routes::text)>524288 then raise exception 'Exploration context limit' using errcode='54000';end if;
 return new;
end $$;
create trigger initialize_proposal_round before insert on public.proposal_generations for each row execute function proposal_private.initialize_round();
create function proposal_private.immutable_round() returns trigger language plpgsql set search_path='' as $$ begin
 if row(new.round_number,new.previous_generation_id,new.refinement,new.excluded_routes,new.material_key) is distinct from row(old.round_number,old.previous_generation_id,old.refinement,old.excluded_routes,old.material_key) then raise exception 'Immutable round context' using errcode='22023';end if;return new;
end $$;
create trigger immutable_round before update on public.proposal_generations for each row execute function proposal_private.immutable_round();
create function public.explore_more_proposals_v1(p_owner uuid,p_brief uuid,p_revision bigint,p_previous uuid,p_operation uuid,p_generator text,p_refinement jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.trip_briefs;g public.proposal_generations;r public.proposal_operations;req jsonb;previous public.proposal_generations;latest uuid;
begin
 if p_owner is null or p_operation is null or p_previous is null or p_revision is null or p_generator is null or length(p_generator) not between 1 and 200 or not proposal_private.refinement_valid(p_refinement) or (jsonb_array_length(p_refinement->'chips')=0 and btrim(p_refinement->>'text')='') then raise exception 'Invalid refinement' using errcode='22023';end if;
 req=jsonb_build_object('brief',p_brief,'revision',p_revision,'previous',p_previous,'generator',p_generator,'refinement',p_refinement);
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_operation::text,0));
 select * into r from public.proposal_operations where owner_id=p_owner and operation_id=p_operation;
 if found then
  if r.action<>'explore_more' or r.request<>req then raise exception 'Operation reused' using errcode='22023';end if;
  select * into g from public.proposal_generations where id=r.generation_id;return to_jsonb(g);
 end if;
 select * into b from public.trip_briefs where id=p_brief and owner_id=p_owner for update;
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 if b.revision<>p_revision then raise exception 'Brief changed' using errcode='40001';end if;
 select * into previous from public.proposal_generations where id=p_previous and brief_id=b.id and owner_id=p_owner;
 if not found then raise exception 'Previous unavailable' using errcode='42501';end if;
 select id into latest from public.proposal_generations where brief_id=b.id order by round_number desc nulls last,created_at desc,id desc limit 1;
 if latest<>p_previous or previous.status not in ('completed','no_results') then raise exception 'Round changed or unfinished' using errcode='40001';end if;
 insert into public.proposal_generations(owner_id,brief_id,brief_revision,brief_schema_version,brief_snapshot,snapshot_hash,engine_version,generator_version,verifier_version,policy_version,previous_generation_id,refinement)
 values(p_owner,b.id,b.revision,b.schema_version,b.document,encode(sha256(convert_to(b.document::text,'UTF8')),'hex'),'tb04-engine-v1',p_generator,'no-factual-source-v1','tb04-policy-v1',p_previous,p_refinement) returning * into g;
 insert into public.proposal_operations values(p_owner,p_operation,'explore_more',req,g.id,now());return to_jsonb(g);
end $$;
create or replace function public.request_proposals_v1(p_owner uuid,p_brief uuid,p_revision bigint,p_operation uuid,p_generator text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.trip_briefs;g public.proposal_generations;r public.proposal_operations;req jsonb;
begin
 if p_owner is null or p_operation is null or p_revision is null or p_revision<1 or p_generator is null or length(p_generator) not between 1 and 200 then raise exception 'Invalid request' using errcode='22023';end if;
 req=jsonb_build_object('brief',p_brief,'revision',p_revision,'generator',p_generator);
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_operation::text,0));
 select * into r from public.proposal_operations where owner_id=p_owner and operation_id=p_operation;
 if found then
  if r.action<>'generate' or r.request<>req then raise exception 'Operation reused' using errcode='22023';end if;
  select * into g from public.proposal_generations where id=r.generation_id;return to_jsonb(g);
 end if;
 select * into b from public.trip_briefs where id=p_brief and owner_id=p_owner for update;
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 if b.revision<>p_revision then raise exception 'Brief changed' using errcode='40001';end if;
 insert into public.proposal_generations(owner_id,brief_id,brief_revision,brief_schema_version,brief_snapshot,snapshot_hash,engine_version,generator_version,verifier_version,policy_version)
 values(p_owner,b.id,b.revision,b.schema_version,b.document,encode(sha256(convert_to(b.document::text,'UTF8')),'hex'),'tb04-engine-v1',p_generator,'no-factual-source-v1','tb04-policy-v1') on conflict do nothing;
 select * into g from public.proposal_generations where brief_id=b.id and brief_revision=b.revision and engine_version='tb04-engine-v1' and generator_version=p_generator and verifier_version='no-factual-source-v1' and policy_version='tb04-policy-v1' and previous_generation_id is null;
 insert into public.proposal_operations values(p_owner,p_operation,'generate',req,g.id,now());
 return to_jsonb(g);
end $$;
create or replace function public.finish_proposal_generation_v1(p_owner uuid,p_generation uuid,p_token uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.proposal_generations;b public.trip_briefs;item jsonb;d record;h text;i integer:=0;n integer;
begin
 -- Consistent lock ordering with request: Brief then generation.
 select b0.* into b from public.trip_briefs b0 join public.proposal_generations g0 on g0.brief_id=b0.id where g0.id=p_generation and g0.owner_id=p_owner for update of b0;
 if not found then raise exception 'Unavailable' using errcode='42501';end if;
 select * into g from public.proposal_generations where id=p_generation and owner_id=p_owner for update;
 h=encode(sha256(convert_to(p_result::text,'UTF8')),'hex');
 if g.attempt_token=p_token and g.result_hash=h and g.status in ('completed','no_results','obsolete') then return to_jsonb(g);end if;
 if g.status<>'running' or g.attempt_token is distinct from p_token or g.lease_expires_at<=clock_timestamp() then raise exception 'Stale attempt' using errcode='40001';end if;
 if b.revision<>g.brief_revision then update public.proposal_generations set status='obsolete',result_hash=h,finished_at=now(),updated_at=now() where id=g.id returning * into g;return to_jsonb(g);end if;
 if jsonb_typeof(p_result->'proposals') is distinct from 'array' or octet_length(p_result::text)>262144 then raise exception 'Invalid result' using errcode='22023';end if;
 n=jsonb_array_length(p_result->'proposals');
 if n>3 or (n>0 and p_result->>'status'<>'completed') or (n=0 and (p_result->>'status'<>'no_results' or coalesce(p_result->>'result_reason','') not in ('incompatible','insufficient_information','no_new_alternatives'))) then raise exception 'Invalid result count/status' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_result->'proposals') loop
  if exists(select 1 from jsonb_array_elements(g.excluded_routes) x where x->>'fingerprint'=item->>'fingerprint' or proposal_private.route_key(x->'route')=proposal_private.route_key(item#>'{document,candidate,route}')) then raise exception 'Repeated route' using errcode='22023';end if;
  if not proposal_private.document_valid(item->'document') then raise exception 'Invalid proposal' using errcode='22023';end if;
  if jsonb_array_length(item#>'{document,evaluations}')<>(select count(*) from jsonb_each(g.brief_snapshot->'decisions')) then raise exception 'Missing decision coverage' using errcode='22023';end if;
  for d in select key,value from jsonb_each(g.brief_snapshot->'decisions') loop
   if (select count(*) from jsonb_array_elements(item#>'{document,evaluations}') e where e->>'decision_id'=d.key and e->>'field'=d.value->>'field' and e->>'scope'=d.value->>'scope' and e->>'strength' is not distinct from d.value->>'strength' and e->>'knowledge'=d.value->>'knowledge')<>1 then raise exception 'Invalid decision coverage' using errcode='22023';end if;
  end loop;
  i=i+1;insert into public.trip_proposals(generation_id,position,fingerprint,document) values(g.id,i,item->>'fingerprint',item->'document');
 end loop;
 update public.proposal_generations set status=p_result->>'status',result_reason=p_result->>'result_reason',result_hash=h,finished_at=now(),updated_at=now() where id=g.id returning * into g;
 return to_jsonb(g);
end $$;
create function proposal_private.round_number(g public.proposal_generations) returns bigint language sql stable set search_path='' as $$
 select coalesce(g.round_number,(select count(*) from public.proposal_generations a where a.brief_id=g.brief_id and (a.created_at,a.id)<=(g.created_at,g.id)));
$$;
create or replace function public.get_proposals_v1(p_brief uuid,p_generation uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.proposal_generations;b public.trip_briefs;current_id uuid;begin
 select * into b from public.trip_briefs where id=p_brief and owner_id=auth.uid();
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 select id into current_id from public.proposal_generations where brief_id=b.id and owner_id=auth.uid() order by round_number desc nulls last,created_at desc,id desc limit 1;
 select * into g from public.proposal_generations where brief_id=b.id and owner_id=auth.uid() and id=coalesce(p_generation,current_id);
 if not found then
  if p_generation is not null then raise exception 'Generation unavailable' using errcode='42501';end if;
  return jsonb_build_object('generation',null,'proposals','[]'::jsonb,'brief_revision',b.revision,'stale',false,'current_generation_id',null,'historical',false);
 end if;
 return jsonb_build_object('generation',(to_jsonb(g)-'brief_snapshot'-'attempt_token'-'excluded_routes')||jsonb_build_object('round_number',proposal_private.round_number(g)),'brief_revision',b.revision,'stale',b.revision<>g.brief_revision,'current_generation_id',current_id,'historical',g.id<>current_id,'proposals',coalesce((select jsonb_agg(to_jsonb(p) order by position) from public.trip_proposals p where generation_id=g.id),'[]'::jsonb));
end $$;
create function public.list_proposal_history_v1(p_brief uuid,p_before bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.trip_briefs where id=p_brief and owner_id=auth.uid()) then raise exception 'Brief unavailable' using errcode='42501';end if;
 return (select jsonb_build_object('rounds',coalesce(jsonb_agg(to_jsonb(r) order by round_number desc),'[]'::jsonb),'next_before',case when count(*)=10 then min(round_number) else null end) from (
 select g.id,proposal_private.round_number(g) as round_number,g.status,g.created_at,g.brief_revision,(select count(*) from public.trip_proposals p where p.generation_id=g.id) as proposal_count
 from public.proposal_generations g where g.brief_id=p_brief and g.owner_id=auth.uid() and (p_before is null or proposal_private.round_number(g)<p_before) order by proposal_private.round_number(g) desc limit 10) r);
end $$;
revoke all on all functions in schema proposal_private from public,anon,authenticated,service_role;
revoke all on function public.explore_more_proposals_v1(uuid,uuid,bigint,uuid,uuid,text,jsonb),public.list_proposal_history_v1(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.explore_more_proposals_v1(uuid,uuid,bigint,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.list_proposal_history_v1(uuid,bigint) to authenticated;
commit;

-- TB-04 additive only. No operational writes; Brief rows/receipts untouched.
begin;
create schema if not exists proposal_private;
revoke all on schema proposal_private from public,anon,authenticated,service_role;
create function proposal_private.document_valid(d jsonb) returns boolean language sql immutable set search_path='' as $fn$
 select octet_length(d::text)<=65536 and extensions.jsonb_matches_schema($schema${"type":"object","properties":{"schema_version":{"type":"integer","enum":[1]},"candidate":{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":120},"summary":{"type":"string","minLength":1,"maxLength":600},"route":{"type":"object","properties":{"stops":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"destination":{"type":"string","minLength":1,"maxLength":120},"nights":{"anyOf":[{"type":"integer","minimum":1,"maximum":730},{"type":"null"}]},"start_date":{"anyOf":[{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$"},{"type":"null"}]},"end_date":{"anyOf":[{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$"},{"type":"null"}]}},"required":["id","destination","nights","start_date","end_date"],"additionalProperties":false},"minItems":1,"maxItems":20},"legs":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"from_stop_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"to_stop_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"mode":{"anyOf":[{"type":"string","minLength":1,"maxLength":80},{"type":"null"}]},"transit_nights":{"anyOf":[{"type":"integer","minimum":0,"maximum":730},{"type":"null"}]}},"required":["id","from_stop_id","to_stop_id","mode","transit_nights"],"additionalProperties":false},"minItems":0,"maxItems":19}},"required":["stops","legs"],"additionalProperties":false},"components":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"kind":{"type":"string","enum":["transport","accommodation","experience"]},"subject_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"description":{"type":"string","minLength":1,"maxLength":600},"claim_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100}},"required":["id","kind","subject_id","description","claim_ids"],"additionalProperties":false},"minItems":0,"maxItems":40},"experience_blocks":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"title":{"type":"string","minLength":1,"maxLength":120},"suggestion":{"type":"string","minLength":1,"maxLength":600},"decision_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100},"component_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100},"claim_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100}},"required":["id","title","suggestion","decision_ids","component_ids","claim_ids"],"additionalProperties":false},"minItems":3,"maxItems":5},"reasons":{"type":"array","items":{"type":"object","properties":{"decision_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"explanation":{"type":"string","minLength":1,"maxLength":600},"claim_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100}},"required":["decision_id","explanation","claim_ids"],"additionalProperties":false},"minItems":0,"maxItems":200},"tradeoffs":{"type":"array","items":{"type":"object","properties":{"description":{"type":"string","minLength":1,"maxLength":600},"decision_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100}},"required":["description","decision_ids"],"additionalProperties":false},"minItems":0,"maxItems":30},"claims":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"subject_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"statement":{"type":"string","minLength":1,"maxLength":600},"decision_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":0,"maxItems":100},"verification_needed":{"type":"string","minLength":1,"maxLength":600}},"required":["id","subject_id","statement","decision_ids","verification_needed"],"additionalProperties":false},"minItems":0,"maxItems":100},"scope_bindings":{"type":"array","items":{"type":"object","properties":{"scope_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"subject_ids":{"type":"array","items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"minItems":1,"maxItems":60}},"required":["scope_id","subject_ids"],"additionalProperties":false},"minItems":0,"maxItems":50}},"required":["title","summary","route","components","experience_blocks","reasons","tradeoffs","claims","scope_bindings"],"additionalProperties":false},"evaluations":{"type":"array","items":{"type":"object","properties":{"decision_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"field":{"type":"string","minLength":1,"maxLength":100},"scope":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"strength":{"anyOf":[{"type":"string","enum":["hard","preference","flexible"]},{"type":"null"}]},"knowledge":{"type":"string","enum":["known","unknown","indifferent"]},"state":{"type":"string","enum":["satisfied","unresolved","violated"]},"reason":{"type":"string","minLength":1,"maxLength":100}},"required":["decision_id","field","scope","strength","knowledge","state","reason"],"additionalProperties":false},"minItems":0,"maxItems":200},"verification":{"type":"array","items":{"type":"object","properties":{"claim_id":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"certainty":{"type":"string","enum":["confirmed","provider_available","probable","pending_verification"]},"reason":{"type":"string","minLength":1,"maxLength":100},"evidence":{"type":"array","items":{"type":"object","properties":{"source":{"type":"string","minLength":1,"maxLength":200},"locator":{"type":"string","minLength":1,"maxLength":2000},"observed_at":{"type":"string","minLength":1,"maxLength":40},"valid_until":{"type":"string","minLength":1,"maxLength":40}},"required":["source","locator","observed_at","valid_until"],"additionalProperties":false},"minItems":0,"maxItems":10}},"required":["claim_id","certainty","reason","evidence"],"additionalProperties":false},"minItems":0,"maxItems":100}},"required":["schema_version","candidate","evaluations","verification"],"additionalProperties":false}$schema$::json,d) and not exists(select 1 from jsonb_array_elements(d->'verification') v where v->>'certainty'='provider_available') and not exists(select 1 from jsonb_array_elements(d->'evaluations') e where e->>'strength'='hard' and e->>'state'='violated');
$fn$;
create table public.proposal_generations (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 brief_id uuid not null references public.trip_briefs(id) on delete cascade,
 brief_revision bigint not null check(brief_revision>0),brief_schema_version integer not null check(brief_schema_version=1),
 brief_snapshot jsonb not null check(public.trip_brief_valid_v1(brief_snapshot)),snapshot_hash text not null,
 engine_version text not null, generator_version text not null, verifier_version text not null, policy_version text not null,
 status text not null default 'pending' check(status in ('pending','running','completed','no_results','failed','obsolete')),
 result_reason text check(result_reason in ('incompatible','insufficient_information')),error_code text,
 attempt_number integer not null default 0 check(attempt_number>=0), attempt_token uuid,lease_expires_at timestamptz,
 result_hash text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),finished_at timestamptz,
 unique(brief_id,brief_revision,engine_version,generator_version,verifier_version,policy_version),
 check(status<>'running' or (attempt_token is not null and lease_expires_at is not null)),
 check(status<>'no_results' or result_reason is not null),check(status<>'failed' or error_code is not null)
);
create index proposal_generations_owner_brief on public.proposal_generations(owner_id,brief_id,created_at desc);
create table public.trip_proposals (
 id uuid primary key default gen_random_uuid(),generation_id uuid not null references public.proposal_generations(id) on delete cascade,
 position smallint not null check(position between 1 and 3),schema_version integer not null default 1 check(schema_version=1),
 fingerprint text not null check(fingerprint~'^[0-9a-f]{64}$'),document jsonb not null check(proposal_private.document_valid(document)),
 created_at timestamptz not null default now(),unique(generation_id,position),unique(generation_id,fingerprint)
);
create table public.proposal_operations (
 owner_id uuid not null references auth.users(id) on delete cascade,operation_id uuid not null,
 action text not null check(action in ('generate','retry')),request jsonb not null check(octet_length(request::text)<=4096),
 generation_id uuid not null references public.proposal_generations(id) on delete cascade,created_at timestamptz not null default now(),
 primary key(owner_id,operation_id)
);
alter table public.proposal_generations enable row level security;
alter table public.trip_proposals enable row level security;
alter table public.proposal_operations enable row level security;
revoke all on public.proposal_generations,public.trip_proposals,public.proposal_operations from public,anon,authenticated,service_role;
grant select on public.proposal_generations,public.trip_proposals to authenticated;
create policy proposal_generation_owner on public.proposal_generations for select to authenticated using(owner_id=(select auth.uid()));
create policy proposal_owner on public.trip_proposals for select to authenticated using(exists(select 1 from public.proposal_generations g where g.id=generation_id and g.owner_id=(select auth.uid())));
create function proposal_private.immutable_proposal() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Immutable proposal' using errcode='22023';end $$;
create trigger immutable_proposal before update on public.trip_proposals for each row execute function proposal_private.immutable_proposal();
create function proposal_private.immutable_snapshot() returns trigger language plpgsql set search_path='' as $$ begin
 if row(new.id,new.owner_id,new.brief_id,new.brief_revision,new.brief_schema_version,new.brief_snapshot,new.snapshot_hash,new.engine_version,new.generator_version,new.verifier_version,new.policy_version,new.created_at) is distinct from row(old.id,old.owner_id,old.brief_id,old.brief_revision,old.brief_schema_version,old.brief_snapshot,old.snapshot_hash,old.engine_version,old.generator_version,old.verifier_version,old.policy_version,old.created_at) then raise exception 'Immutable generation input' using errcode='22023';end if;return new;end $$;
create trigger immutable_snapshot before update on public.proposal_generations for each row execute function proposal_private.immutable_snapshot();

-- Internal RPC: owner comes from getUser(jwt) in Edge, never the request body.
create function public.request_proposals_v1(p_owner uuid,p_brief uuid,p_revision bigint,p_operation uuid,p_generator text) returns jsonb
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
 select * into g from public.proposal_generations where brief_id=b.id and brief_revision=b.revision and engine_version='tb04-engine-v1' and generator_version=p_generator and verifier_version='no-factual-source-v1' and policy_version='tb04-policy-v1';
 insert into public.proposal_operations values(p_owner,p_operation,'generate',req,g.id,now());
 return to_jsonb(g);
end $$;
create function public.retry_proposals_v1(p_owner uuid,p_generation uuid,p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.proposal_generations;r public.proposal_operations;req jsonb:=jsonb_build_object('generation',p_generation);
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||p_operation::text,0));
 select * into r from public.proposal_operations where owner_id=p_owner and operation_id=p_operation;
 if found then
  if r.action<>'retry' or r.request<>req then raise exception 'Operation reused' using errcode='22023';end if;
  select * into g from public.proposal_generations where id=r.generation_id;return to_jsonb(g);
 end if;
 select * into g from public.proposal_generations where id=p_generation and owner_id=p_owner for update;
 if not found then raise exception 'Generation unavailable' using errcode='42501';end if;
 if g.status='failed' then update public.proposal_generations set status='pending',error_code=null,finished_at=null,updated_at=now() where id=g.id returning * into g;end if;
 insert into public.proposal_operations values(p_owner,p_operation,'retry',req,g.id,now());return to_jsonb(g);
end $$;
create function public.claim_proposal_generation_v1(p_owner uuid,p_generation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.proposal_generations;begin
 select * into g from public.proposal_generations where id=p_generation and owner_id=p_owner for update;
 if not found then raise exception 'Generation unavailable' using errcode='42501';end if;
 if g.status not in ('pending','running') or (g.status='running' and g.lease_expires_at>clock_timestamp()) then return null;end if;
 update public.proposal_generations set status='running',attempt_number=attempt_number+1,attempt_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '90 seconds',updated_at=now() where id=g.id returning * into g;
 return to_jsonb(g);
end $$;
create function public.finish_proposal_generation_v1(p_owner uuid,p_generation uuid,p_token uuid,p_result jsonb) returns jsonb
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
 if n>3 or (n>0 and p_result->>'status'<>'completed') or (n=0 and (p_result->>'status'<>'no_results' or coalesce(p_result->>'result_reason','') not in ('incompatible','insufficient_information'))) then raise exception 'Invalid result count/status' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_result->'proposals') loop
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
create function public.fail_proposal_generation_v1(p_owner uuid,p_generation uuid,p_token uuid,p_error text) returns void
language plpgsql security definer set search_path='' as $$ begin
 if p_error not in ('provider_error','provider_auth_error','provider_rate_limited','provider_timeout','provider_transport_error','provider_refusal','provider_incomplete','provider_invalid_response','invalid_candidate','invalid_verifier_result','configuration_error','engine_error') then p_error='engine_error';end if;
 update public.proposal_generations set status='failed',error_code=p_error,finished_at=now(),updated_at=now() where id=p_generation and owner_id=p_owner and status='running' and attempt_token=p_token and lease_expires_at>clock_timestamp();
 if not found then raise exception 'Stale attempt' using errcode='40001';end if;
end $$;
create function public.get_proposals_v1(p_brief uuid,p_generation uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.proposal_generations;b public.trip_briefs;begin
 select * into b from public.trip_briefs where id=p_brief and owner_id=auth.uid();
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 select * into g from public.proposal_generations where brief_id=b.id and owner_id=auth.uid() and (p_generation is null or id=p_generation) order by created_at desc,id desc limit 1;
 if not found then return jsonb_build_object('generation',null,'proposals','[]'::jsonb,'brief_revision',b.revision,'stale',false);end if;
 return jsonb_build_object('generation',to_jsonb(g)-'brief_snapshot'-'attempt_token','brief_revision',b.revision,'stale',b.revision<>g.brief_revision,'proposals',coalesce((select jsonb_agg(to_jsonb(p) order by position) from public.trip_proposals p where generation_id=g.id),'[]'::jsonb));
end $$;
revoke all on all functions in schema proposal_private from public,anon,authenticated,service_role;
revoke all on function public.request_proposals_v1(uuid,uuid,bigint,uuid,text),public.retry_proposals_v1(uuid,uuid,uuid),public.claim_proposal_generation_v1(uuid,uuid),public.finish_proposal_generation_v1(uuid,uuid,uuid,jsonb),public.fail_proposal_generation_v1(uuid,uuid,uuid,text),public.get_proposals_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_proposals_v1(uuid,uuid,bigint,uuid,text),public.retry_proposals_v1(uuid,uuid,uuid),public.claim_proposal_generation_v1(uuid,uuid),public.finish_proposal_generation_v1(uuid,uuid,uuid,jsonb),public.fail_proposal_generation_v1(uuid,uuid,uuid,text) to service_role;
grant execute on function public.get_proposals_v1(uuid,uuid) to authenticated;
commit;

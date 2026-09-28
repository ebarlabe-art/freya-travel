-- TB-04.4.2: additive factual geography. No backfill, no outbound calls.
begin;
create schema place_private;
revoke all on schema place_private from public,anon,authenticated;
create table public.places(id uuid primary key default gen_random_uuid(),provider text not null,provider_place_id text not null,created_at timestamptz not null default now(),unique(provider,provider_place_id));
create table public.place_versions(
 id uuid primary key default gen_random_uuid(),place_id uuid not null references public.places(id),
 canonical_name text not null check(length(canonical_name) between 1 and 500),kind text not null,
 administrative_area text,country_code text check(country_code ~ '^[A-Z]{2}$'),
 latitude double precision not null check(latitude between -90 and 90),longitude double precision not null check(longitude between -180 and 180),
 coordinate_role text not null check(coordinate_role in ('representative_point','exact_location')),
 timezone text,timezone_status text not null check(timezone_status in ('verified','needs_specific_location','unavailable')),
 provider text not null,provider_place_id text not null,source text not null,attribution text not null,
 resolved_at timestamptz not null default now(),resolution_version text not null,content_hash text not null,
 check((timezone_status='verified')=(timezone is not null)),unique(place_id,content_hash)
);
create table public.place_bindings(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 brief_id uuid not null references public.trip_briefs(id),proposal_id uuid references public.trip_proposals(id),
 subject_key text not null check(length(subject_key) between 1 and 200),original_text text not null check(length(original_text) between 1 and 500),
 state text not null check(state in ('unresolved','ambiguous','needs_confirmation','resolved','stale')),
 place_version_id uuid references public.place_versions(id),selection_method text check(selection_method in ('user_selected','reused_binding')),
 brief_revision bigint not null,revision bigint not null check(revision>0),created_at timestamptz not null default now(),
 check((state='resolved')=(place_version_id is not null)),unique nulls not distinct(owner_id,brief_id,proposal_id,subject_key,revision)
);
create index place_binding_subject on public.place_bindings(owner_id,brief_id,proposal_id,subject_key,revision desc);
alter table public.places enable row level security;alter table public.place_versions enable row level security;alter table public.place_bindings enable row level security;
revoke all on public.places,public.place_versions,public.place_bindings from public,anon,authenticated,service_role;
-- No public catalogue browsing: the owner reads versions through the binding RPC.
create policy binding_owner on public.place_bindings for select to authenticated using(owner_id=(select auth.uid()));
grant select on public.place_bindings to authenticated;
create trigger place_version_immutable before update or delete on public.place_versions for each row execute function proposal_private.handoff_immutable();
create trigger place_binding_immutable before update or delete on public.place_bindings for each row execute function proposal_private.handoff_immutable();
alter table public.place_bindings add column subject_snapshot jsonb;
create function place_private.capture_binding_subject() returns trigger language plpgsql set search_path='' as $$begin
 if new.proposal_id is null then select document#>array['decisions',split_part(new.subject_key,':',1)] into new.subject_snapshot from public.trip_briefs where id=new.brief_id;end if;return new;
end $$;
create trigger capture_binding_subject before insert on public.place_bindings for each row execute function place_private.capture_binding_subject();
alter table public.proposal_generations add column place_snapshot jsonb;
create function place_private.generation_places() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' then if new.place_snapshot is distinct from old.place_snapshot then raise exception 'Immutable geographic snapshot';end if;return new;end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into new.place_snapshot from (select distinct on (b.subject_key) b.id binding_id,b.subject_key,b.place_version_id,to_jsonb(v) place from public.place_bindings b join public.place_versions v on v.id=b.place_version_id where b.brief_id=new.brief_id and b.proposal_id is null and b.owner_id=new.owner_id and b.brief_revision<=new.brief_revision and b.subject_snapshot=new.brief_snapshot#>array['decisions',split_part(b.subject_key,':',1)] order by b.subject_key,b.revision desc)x;return new;
end $$;
create trigger generation_places before insert or update on public.proposal_generations for each row execute function place_private.generation_places();
create table place_private.queries(owner_id uuid references auth.users(id),query_hash text,query jsonb not null,status text not null,lease_until timestamptz,token uuid not null default gen_random_uuid(),results jsonb,expires_at timestamptz,primary key(owner_id,query_hash));
create table place_private.quota(bucket text primary key,used integer not null);
create table place_private.operations(owner_id uuid,operation_id uuid,request jsonb not null,binding_id uuid not null references public.place_bindings(id),primary key(owner_id,operation_id));
create table place_private.handoff_receipts(owner_id uuid,operation_id uuid,request jsonb not null,result jsonb not null,primary key(owner_id,operation_id));
create table public.trip_place_snapshots(handoff_id uuid primary key references public.trip_proposal_handoffs(id),principal_binding_id uuid not null references public.place_bindings(id),bindings jsonb not null);
alter table public.trip_place_snapshots enable row level security;
revoke all on public.trip_place_snapshots from public,anon,authenticated,service_role;
grant select on public.trip_place_snapshots to authenticated;
create policy trip_place_owner on public.trip_place_snapshots for select to authenticated using(exists(select 1 from public.trip_proposal_handoffs h where h.id=handoff_id and h.owner_id=(select auth.uid())));
create trigger trip_place_immutable before update or delete on public.trip_place_snapshots for each row execute function proposal_private.handoff_immutable();

create function place_private.subject(p_owner uuid,p_subject jsonb) returns public.trip_briefs language plpgsql security definer set search_path='' as $$
declare b public.trip_briefs;p public.trip_proposals;k text:=p_subject->>'key';d jsonb;begin
 select * into b from public.trip_briefs where id=(p_subject->>'brief_id')::uuid and owner_id=p_owner;
 if b.id is null then raise exception 'Unavailable' using errcode='42501';end if;
 if p_subject->>'proposal_id' is not null then
 select x.* into p from public.trip_proposals x join public.proposal_generations g on g.id=x.generation_id where x.id=(p_subject->>'proposal_id')::uuid and g.brief_id=b.id and g.owner_id=p_owner;
 if p.id is null or not exists(select 1 from jsonb_array_elements((p.document#>'{candidate,route,stops}')||(p.document#>'{candidate,components}')) x where x->>'id'=k) then raise exception 'Invalid subject' using errcode='22023';end if;
 else
 d=b.document#>array['decisions',split_part(k,':',1)];
 if d is null or d->>'field' not in ('origin','destination') or d->>'knowledge'<>'known' or split_part(k,':',2)!~'^[0-9]+$' or d#>array['value','places',split_part(k,':',2)] is null then raise exception 'Invalid subject' using errcode='22023';end if;
 end if;return b;
end $$;
create function public.get_place_bindings_v1(p_subject jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform place_private.subject(auth.uid(),p_subject);
 return coalesce((select jsonb_agg(to_jsonb(x)) from(select distinct on (b.subject_key) b.*,to_jsonb(v) place,(b.proposal_id is not null or b.subject_snapshot=(select document#>array['decisions',split_part(b.subject_key,':',1)] from public.trip_briefs where id=b.brief_id)) subject_current from public.place_bindings b left join public.place_versions v on v.id=b.place_version_id where b.owner_id=auth.uid() and b.brief_id=(p_subject->>'brief_id')::uuid and b.proposal_id is not distinct from (p_subject->>'proposal_id')::uuid order by b.subject_key,b.revision desc)x),'[]');
end $$;

create function public.claim_place_query_v1(p_owner uuid,p_query jsonb,p_config jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare h text:=md5(p_query::text);q place_private.queries;k text;n integer;lim integer;begin
 if not exists(select 1 from auth.users where id=p_owner) or length(p_query->>'text') not between 1 and 500 or octet_length(p_query::text)>2048 then raise exception 'Invalid query';end if;
 perform pg_advisory_xact_lock(hashtextextended('place-query:'||p_owner||h,0));
 select * into q from place_private.queries where owner_id=p_owner and query_hash=h;
 if q.status='completed' and q.expires_at>now() then return jsonb_build_object('cached',true,'results',q.results,'token',q.token,'query_hash',h);end if;
 if q.lease_until>now() then return jsonb_build_object('pending',true);end if;
 -- Global then owner locks have a fixed order. Limits are trusted server configuration.
 foreach k in array array['global:'||current_date,'second:'||date_trunc('second',clock_timestamp())::text,'user:'||p_owner||':'||current_date] loop
 lim=case when k like 'global:%' then (p_config->>'globalDaily')::int when k like 'second:%' then (p_config->>'globalPerSecond')::int else (p_config->>'userDaily')::int end;
 insert into place_private.quota values(k,1) on conflict(bucket) do update set used=place_private.quota.used+1 returning used into n;
 if n>lim then raise exception 'rate_limited' using errcode='P0001';end if;
 end loop;
 insert into place_private.queries(owner_id,query_hash,query,status,lease_until) values(p_owner,h,p_query,'running',now()+make_interval(secs=>ceil((p_config->>'timeoutMs')::numeric/1000)::int+16)) on conflict(owner_id,query_hash) do update set query=excluded.query,status='running',lease_until=excluded.lease_until,token=gen_random_uuid(),results=null,expires_at=null returning * into q;
 return jsonb_build_object('token',q.token,'query_hash',h);
end $$;
create function public.finish_place_query_v1(p_owner uuid,p_hash text,p_token uuid,p_results jsonb,p_seconds integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>5 or octet_length(p_results::text)>65536 or p_seconds not between 1 and 604800 then raise exception 'Invalid results';end if;
 update place_private.queries set status='completed',results=p_results,expires_at=now()+make_interval(secs=>p_seconds),lease_until=null where owner_id=p_owner and query_hash=p_hash and token=p_token and status='running' and lease_until>now();
 if not found then raise exception 'Query expired' using errcode='40001';end if;
end $$;

create function public.confirm_place_v1(p_owner uuid,p_subject jsonb,p_token uuid,p_hash text,p_index integer,p_expected_revision bigint,p_expected_brief_revision bigint,p_operation_id uuid,p_token_seconds integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.trip_briefs;q place_private.queries;v jsonb;pid uuid;vid uuid;bid uuid;r bigint;req jsonb;prior place_private.operations;begin
 req=jsonb_build_object('subject',p_subject,'token',p_token,'hash',p_hash,'index',p_index,'revision',p_expected_revision,'brief_revision',p_expected_brief_revision);
 perform pg_advisory_xact_lock(hashtextextended('place-operation:'||p_owner||p_operation_id,0));
 select * into prior from place_private.operations where owner_id=p_owner and operation_id=p_operation_id;
 if found then if prior.request<>req then raise exception 'Operation reused' using errcode='22023';end if;return (select to_jsonb(x) from public.place_bindings x where id=prior.binding_id);end if;
 b=place_private.subject(p_owner,p_subject);
 select * into b from public.trip_briefs where id=b.id for update;
 if b.trip_id is not null then raise exception 'Brief frozen' using errcode='55000';end if;
 if b.revision<>p_expected_brief_revision then raise exception 'Brief changed' using errcode='40001';end if;
 select coalesce(max(revision),0) into r from public.place_bindings where owner_id=p_owner and brief_id=b.id and proposal_id is not distinct from (p_subject->>'proposal_id')::uuid and subject_key=p_subject->>'key';
 if r<>p_expected_revision then raise exception 'Binding changed' using errcode='40001';end if;
 select * into q from place_private.queries where owner_id=p_owner and query_hash=p_hash and token=p_token and status='completed' and expires_at>now();
 -- Candidate expiry is bounded independently of the 24h result cache.
 if q.token is null or p_index<0 or p_index>=jsonb_array_length(q.results) then raise exception 'Candidate unavailable' using errcode='22023';end if;
 v=q.results->p_index;
 if v->>'timezone_status'='verified' and not exists(select 1 from pg_timezone_names where name=v->>'timezone') then raise exception 'Invalid timezone' using errcode='22023';end if;
 insert into public.places(provider,provider_place_id) values(v->>'provider',v->>'provider_place_id') on conflict(provider,provider_place_id) do update set provider=excluded.provider returning id into pid;
 insert into public.place_versions(place_id,canonical_name,kind,administrative_area,country_code,latitude,longitude,coordinate_role,timezone,timezone_status,provider,provider_place_id,source,attribution,resolution_version,content_hash)
 values(pid,v->>'canonical_name',v->>'kind',v->>'administrative_area',v->>'country_code',(v->>'latitude')::float8,(v->>'longitude')::float8,v->>'coordinate_role',v->>'timezone',v->>'timezone_status',v->>'provider',v->>'provider_place_id',v->>'source',v->>'attribution',v->>'resolution_version',md5(v::text)) on conflict(place_id,content_hash) do nothing returning id into vid;
 if vid is null then select id into vid from public.place_versions where place_id=pid and content_hash=md5(v::text);end if;
 if p_subject->>'proposal_id' is null then update public.trip_briefs set revision=revision+1,updated_at=now() where id=b.id returning * into b;end if;
 insert into public.place_bindings(owner_id,brief_id,proposal_id,subject_key,original_text,state,place_version_id,selection_method,brief_revision,revision) values(p_owner,b.id,(p_subject->>'proposal_id')::uuid,p_subject->>'key',q.query->>'text','resolved',vid,'user_selected',b.revision,r+1) returning id into bid;
 insert into place_private.operations values(p_owner,p_operation_id,req,bid);
 return (select to_jsonb(x) from public.place_bindings x where id=bid);
end $$;
revoke all on all functions in schema place_private from public,anon,authenticated,service_role;
revoke all on function public.get_place_bindings_v1(jsonb),public.claim_place_query_v1(uuid,jsonb,jsonb),public.finish_place_query_v1(uuid,text,uuid,jsonb,integer),public.confirm_place_v1(uuid,jsonb,uuid,text,integer,bigint,bigint,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_place_bindings_v1(jsonb) to authenticated;
grant execute on function public.claim_place_query_v1(uuid,jsonb,jsonb),public.finish_place_query_v1(uuid,text,uuid,jsonb,integer),public.confirm_place_v1(uuid,jsonb,uuid,text,integer,bigint,bigint,uuid,integer) to service_role;
create table place_private.settings(singleton boolean primary key default true check(singleton),fresh_days integer not null default 90 check(fresh_days between 1 and 365));
insert into place_private.settings values(true,90);
alter function public.formalize_trip_proposal_v1(uuid,bigint,uuid,uuid,text,uuid,jsonb) rename to formalize_trip_proposal_legacy_v1;
revoke all on function public.formalize_trip_proposal_legacy_v1(uuid,bigint,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.formalize_trip_proposal_v1(p_brief_id uuid,p_expected_brief_revision bigint,p_proposal_id uuid,p_expected_generation_id uuid,p_expected_snapshot_hash text,p_operation_id uuid,p_details jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.trip_proposal_handoffs where brief_id=p_brief_id and owner_id=auth.uid()) then raise exception 'Geographic resolution required; update the application' using errcode='55000';end if;
 return public.formalize_trip_proposal_legacy_v1(p_brief_id,p_expected_brief_revision,p_proposal_id,p_expected_generation_id,p_expected_snapshot_hash,p_operation_id,p_details);
end $$;
create function public.formalize_trip_proposal_v2(p_brief_id uuid,p_expected_brief_revision bigint,p_proposal_id uuid,p_expected_generation_id uuid,p_expected_snapshot_hash text,p_operation_id uuid,p_details jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();req jsonb;receipt place_private.handoff_receipts;p public.trip_proposals;g public.proposal_generations;b public.trip_briefs;bind public.place_bindings;v public.place_versions;entry record;c jsonb;leg jsonb;refs jsonb:=p_details->'bindings';versions jsonb:='{}';choices jsonb:='{}';choice jsonb;zone text;main text:=p_details->>'principal_stop_id';legacy jsonb;result jsonb;h uuid;old jsonb;link public.trip_proposal_component_links;own boolean;begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_operation_id is null or jsonb_typeof(p_details)<>'object' or octet_length(p_details::text)>65536 or jsonb_typeof(refs)<>'object' or jsonb_typeof(p_details->'components')<>'object' or exists(select 1 from jsonb_object_keys(p_details) k where k not in ('name','start_date','end_date','acknowledge_unresolved','components','bindings','principal_stop_id')) then raise exception 'Invalid details' using errcode='22023';end if;
 req=jsonb_build_object('brief',p_brief_id,'revision',p_expected_brief_revision,'proposal',p_proposal_id,'generation',p_expected_generation_id,'hash',p_expected_snapshot_hash,'details',p_details);
 perform pg_advisory_xact_lock(hashtextextended('geo-handoff:'||actor||p_operation_id,0));
 select * into receipt from place_private.handoff_receipts where owner_id=actor and operation_id=p_operation_id;
 if found then if receipt.request<>req then raise exception 'Operation reused' using errcode='22023';end if;return receipt.result||'{"replayed":true}'::jsonb;end if;
 select * into b from public.trip_briefs where id=p_brief_id and owner_id=actor for update;
 if b.id is null then raise exception 'Unavailable' using errcode='42501';end if;
 select x.* into p from public.trip_proposals x join public.proposal_generations y on y.id=x.generation_id where x.id=p_proposal_id and y.brief_id=b.id and y.owner_id=actor;
 if p.id is null then raise exception 'Unavailable' using errcode='42501';end if;
 select * into g from public.proposal_generations where id=p.generation_id;
 if g.id<>p_expected_generation_id or g.brief_revision<>p_expected_brief_revision or g.snapshot_hash<>p_expected_snapshot_hash then raise exception 'Snapshot changed' using errcode='40001';end if;
 select x.handoff_id into h from public.trip_place_snapshots x join public.trip_proposal_handoffs y on y.id=x.handoff_id where y.brief_id=b.id;
 if h is not null then
 select hr.request into old from place_private.handoff_receipts hr where hr.result->>'handoff_id'=h::text limit 1;
 if old<>req then raise exception 'Formalization changed' using errcode='40001';end if;
 result=public.get_trip_handoff_v1(b.id);insert into place_private.handoff_receipts values(actor,p_operation_id,req,result);return result;
 end if;
 if b.revision<>p_expected_brief_revision or b.trip_id is not null then raise exception 'Brief changed' using errcode='40001';end if;
 if not exists(select 1 from jsonb_array_elements(p.document#>'{candidate,route,stops}') s where s->>'id'=main) then raise exception 'Select principal base' using errcode='22023';end if;
 for entry in select * from jsonb_each_text(refs) loop
 select * into bind from public.place_bindings where id=entry.value::uuid and owner_id=actor and proposal_id=p.id and brief_id=b.id and subject_key=entry.key and state='resolved';
 if bind.id is null or exists(select 1 from public.place_bindings x where x.owner_id=actor and x.proposal_id=p.id and x.subject_key=entry.key and x.revision>bind.revision) then raise exception 'Binding unavailable or stale' using errcode='40001';end if;
 select * into v from public.place_versions where id=bind.place_version_id;
 if v.timezone_status<>'verified' or bind.created_at<now()-make_interval(days=>(select fresh_days from place_private.settings)) then raise exception 'Location needs verification' using errcode='22023';end if;
 versions=versions||jsonb_build_object(entry.key,to_jsonb(v));
 end loop;
 for c in select * from jsonb_array_elements(p.document#>'{candidate,route,stops}') loop
 if not versions ? (c->>'id') then raise exception 'Resolve every base' using errcode='22023';end if;
 end loop;
 for c in select * from jsonb_array_elements(p.document#>'{candidate,components}') loop
 choice=p_details#>array['components',c->>'id'];
 if choice is null or exists(select 1 from jsonb_object_keys(choice) k where k<>'target') then raise exception 'Invalid component choice' using errcode='22023';end if;
 zone=coalesce(versions#>>array[c->>'id','timezone'],versions#>>array[c->>'subject_id','timezone']);
 if c->>'kind'='accommodation' and zone is null then raise exception 'Resolve accommodation location' using errcode='22023';end if;
 choices=choices||jsonb_build_object(c->>'id',jsonb_build_object('target',choice->>'target','time_zone',case when c->>'kind'='accommodation' then zone else null end));
 end loop;
 if (select count(*) from jsonb_object_keys(p_details->'components'))<>jsonb_array_length(p.document#>'{candidate,components}') then raise exception 'Invalid component coverage' using errcode='22023';end if;
 legacy=jsonb_build_object('name',p_details->'name','start_date',p_details->'start_date','end_date',p_details->'end_date','acknowledge_unresolved',p_details->'acknowledge_unresolved','time_zone',versions#>>array[main,'timezone'],'components',choices);
 result=public.formalize_trip_proposal_legacy_v1(p_brief_id,p_expected_brief_revision,p_proposal_id,p_expected_generation_id,p_expected_snapshot_hash,p_operation_id,legacy);
 h=(result->>'handoff_id')::uuid;
 insert into public.trip_place_snapshots values(h,(refs->>main)::uuid,jsonb_build_object('binding_ids',refs,'versions',versions,'principal_stop_id',main));
 for link in select * from public.trip_proposal_component_links where handoff_id=h loop
 select x into c from jsonb_array_elements(p.document#>'{candidate,components}') x where x->>'id'=link.component_id;
 own=versions ? link.component_id;zone=coalesce(versions#>>array[link.component_id,'timezone'],versions#>>array[c->>'subject_id','timezone']);
 if link.activity_id is not null and c->>'kind'='experience' then update public.trip_activities set time_zone=zone where id=link.activity_id;end if;
 if own and versions#>>array[link.component_id,'coordinate_role']='exact_location' then
 if link.accommodation_id is not null then update public.trip_accommodations set latitude=(versions#>>array[link.component_id,'latitude'])::float8,longitude=(versions#>>array[link.component_id,'longitude'])::float8 where id=link.accommodation_id;
 elsif link.activity_id is not null then update public.trip_activities set latitude=(versions#>>array[link.component_id,'latitude'])::float8,longitude=(versions#>>array[link.component_id,'longitude'])::float8 where id=link.activity_id;end if;
 end if;
 if link.flight_id is not null then
 select x into leg from jsonb_array_elements(p.document#>'{candidate,route,legs}') x where x->>'id'=c->>'subject_id';
 if leg is not null then update public.trip_flights set departure_time_zone=versions#>>array[leg->>'from_stop_id','timezone'],arrival_time_zone=versions#>>array[leg->>'to_stop_id','timezone'] where id=link.flight_id;end if;
 end if;
 end loop;
 insert into place_private.handoff_receipts values(actor,p_operation_id,req,result);return result;
end $$;
revoke all on function public.formalize_trip_proposal_v1(uuid,bigint,uuid,uuid,text,uuid,jsonb),public.formalize_trip_proposal_v2(uuid,bigint,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.formalize_trip_proposal_v1(uuid,bigint,uuid,uuid,text,uuid,jsonb),public.formalize_trip_proposal_v2(uuid,bigint,uuid,uuid,text,uuid,jsonb) to authenticated;
commit;

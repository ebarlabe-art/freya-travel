-- TB-04.4: explicit atomic operational handoff. No legacy backfill.
begin;
create table public.trip_proposal_handoffs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 brief_id uuid not null unique references public.trip_briefs(id),
 brief_revision bigint not null check(brief_revision>0),
 proposal_id uuid not null unique references public.trip_proposals(id),
 trip_id uuid not null unique references public.trips(id),
 snapshot_hash text not null check(snapshot_hash ~ '^[0-9a-f]{64}$'),
 mapping_version integer not null default 1 check(mapping_version=1),
 request jsonb not null check(octet_length(request::text)<=65536),
 created_at timestamptz not null default clock_timestamp(),
 unique(id,trip_id)
);
create index handoff_owner_idx on public.trip_proposal_handoffs(owner_id);
create table public.trip_proposal_component_links (
 handoff_id uuid not null, trip_id uuid not null, component_id text not null,
 accommodation_id uuid,flight_id uuid,activity_id uuid,
 primary key(handoff_id,component_id),
 foreign key(handoff_id,trip_id) references public.trip_proposal_handoffs(id,trip_id),
 foreign key(trip_id,accommodation_id) references public.trip_accommodations(trip_id,id),
 foreign key(trip_id,flight_id) references public.trip_flights(trip_id,id),
 foreign key(trip_id,activity_id) references public.trip_activities(trip_id,id),
 check(num_nonnulls(accommodation_id,flight_id,activity_id)=1),
 check(component_id ~ '^[a-z][a-z0-9_-]{0,63}$')
);
create unique index handoff_accommodation_idx on public.trip_proposal_component_links(accommodation_id) where accommodation_id is not null;
create unique index handoff_flight_idx on public.trip_proposal_component_links(flight_id) where flight_id is not null;
create unique index handoff_activity_idx on public.trip_proposal_component_links(activity_id) where activity_id is not null;
create index handoff_link_trip_idx on public.trip_proposal_component_links(trip_id);
create table public.trip_handoff_operations (
 owner_id uuid not null references auth.users(id),operation_id uuid not null,
 handoff_id uuid not null references public.trip_proposal_handoffs(id),
 request jsonb not null check(octet_length(request::text)<=65536),
 created_at timestamptz not null default clock_timestamp(),primary key(owner_id,operation_id)
);
create index handoff_operations_handoff_idx on public.trip_handoff_operations(handoff_id);
alter table public.trip_proposal_handoffs enable row level security;
alter table public.trip_proposal_component_links enable row level security;
alter table public.trip_handoff_operations enable row level security;
revoke all on public.trip_proposal_handoffs,public.trip_proposal_component_links,public.trip_handoff_operations from public,anon,authenticated,service_role;
grant select on public.trip_proposal_handoffs,public.trip_proposal_component_links to authenticated;
create policy handoff_owner on public.trip_proposal_handoffs for select to authenticated using(owner_id=(select auth.uid()));
create policy handoff_link_owner on public.trip_proposal_component_links for select to authenticated using(exists(select 1 from public.trip_proposal_handoffs h where h.id=handoff_id and h.owner_id=(select auth.uid())));
alter table public.trip_briefs drop constraint brief_handoff_not_implemented;
create unique index brief_operational_trip_idx on public.trip_briefs(trip_id) where trip_id is not null;
create function proposal_private.handoff_immutable() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Handoff origin is immutable' using errcode='22023';end $$;
create trigger handoff_immutable before update or delete on public.trip_proposal_handoffs for each row execute function proposal_private.handoff_immutable();
create trigger handoff_link_immutable before update or delete on public.trip_proposal_component_links for each row execute function proposal_private.handoff_immutable();
create trigger handoff_receipt_immutable before update or delete on public.trip_handoff_operations for each row execute function proposal_private.handoff_immutable();
create function proposal_private.handoff_integrity() returns trigger language plpgsql set search_path='' as $$
declare h public.trip_proposal_handoffs;b public.trip_briefs;p public.trip_proposals;g public.proposal_generations;n integer;
begin
 if tg_table_name='trip_briefs' then
  select * into b from public.trip_briefs where id=new.id;
  if b.trip_id is null then return null;end if;
  select * into h from public.trip_proposal_handoffs where brief_id=b.id;
 elsif tg_table_name='trip_proposal_handoffs' then select * into h from public.trip_proposal_handoffs where id=new.id;
 else select * into h from public.trip_proposal_handoffs where id=new.handoff_id;end if;
 if h.id is null then raise exception 'Missing handoff' using errcode='23514';end if;
 select * into b from public.trip_briefs where id=h.brief_id;
 select * into p from public.trip_proposals where id=h.proposal_id;
 select * into g from public.proposal_generations where id=p.generation_id;
 if b.trip_id is distinct from h.trip_id or b.owner_id<>h.owner_id or b.revision<>h.brief_revision+1 or g.owner_id<>h.owner_id or g.brief_id<>h.brief_id or g.brief_revision<>h.brief_revision or g.snapshot_hash<>h.snapshot_hash
 or not exists(select 1 from public.trips t where t.id=h.trip_id and t.owner_id=h.owner_id)
 or not exists(select 1 from public.trip_members m where m.trip_id=h.trip_id and m.user_id=h.owner_id) then raise exception 'Inconsistent handoff' using errcode='23514';end if;
 select count(*) into n from public.trip_proposal_component_links where handoff_id=h.id;
 if n<>jsonb_array_length(p.document#>'{candidate,components}') or exists(
 select 1 from public.trip_proposal_component_links l where l.handoff_id=h.id and not exists(
 select 1 from jsonb_array_elements(p.document#>'{candidate,components}') c where c->>'id'=l.component_id and (
 (c->>'kind'='accommodation' and l.accommodation_id is not null) or (c->>'kind'='experience' and l.activity_id is not null) or (c->>'kind'='transport' and (l.flight_id is not null or l.activity_id is not null))))) then raise exception 'Incomplete component mappings' using errcode='23514';end if;
 return null;
end $$;
create constraint trigger handoff_integrity after insert on public.trip_proposal_handoffs deferrable initially deferred for each row execute function proposal_private.handoff_integrity();
create constraint trigger handoff_link_integrity after insert on public.trip_proposal_component_links deferrable initially deferred for each row execute function proposal_private.handoff_integrity();
create constraint trigger brief_handoff_integrity after insert or update on public.trip_briefs deferrable initially deferred for each row execute function proposal_private.handoff_integrity();
create function proposal_private.freeze_handed_off_brief() returns trigger language plpgsql set search_path='' as $$ begin
 if old.trip_id is not null then raise exception 'Brief already formalized' using errcode='55000';end if;return new;
end $$;
create trigger freeze_handed_off_brief before update on public.trip_briefs for each row execute function proposal_private.freeze_handed_off_brief();
create function public.get_trip_handoff_v1(p_brief_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.trip_proposal_handoffs;begin
 if auth.uid() is null or not exists(select 1 from public.trip_briefs where id=p_brief_id and owner_id=auth.uid()) then raise exception 'Unavailable' using errcode='42501';end if;
 select * into h from public.trip_proposal_handoffs where brief_id=p_brief_id and owner_id=auth.uid();
 if not found then return null;end if;
 if not exists(select 1 from public.trip_briefs b where b.id=h.brief_id and b.trip_id=h.trip_id and b.revision=h.brief_revision+1) or (select count(*) from public.trip_proposal_component_links where handoff_id=h.id)<>(select jsonb_array_length(document#>'{candidate,components}') from public.trip_proposals where id=h.proposal_id) then raise exception 'Incomplete handoff' using errcode='23514';end if;
 return jsonb_build_object('handoff_id',h.id,'trip_id',h.trip_id,'brief_revision',h.brief_revision+1,'component_links',coalesce((select jsonb_agg(to_jsonb(l) order by component_id) from public.trip_proposal_component_links l where handoff_id=h.id),'[]'::jsonb),'already_formalized',true,'replayed',false);
end $$;
create function public.formalize_trip_proposal_v1(p_brief_id uuid,p_expected_brief_revision bigint,p_proposal_id uuid,p_expected_generation_id uuid,p_expected_snapshot_hash text,p_operation_id uuid,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();b public.trip_briefs;p public.trip_proposals;g public.proposal_generations;h public.trip_proposal_handoffs;r public.trip_handoff_operations;req jsonb;components jsonb;c jsonb;choice jsonb;target uuid;t uuid;outcome jsonb;tz text;d1 date;d2 date;
begin
 if actor is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_operation_id is null or p_brief_id is null or p_proposal_id is null or p_expected_generation_id is null or p_expected_brief_revision is null or p_expected_brief_revision<1 or p_expected_snapshot_hash is null or p_expected_snapshot_hash!~'^[0-9a-f]{64}$' then raise exception 'Invalid request' using errcode='22023';end if;
 if not coalesce(extensions.jsonb_matches_schema('{"type":"object","additionalProperties":false,"required":["name","time_zone","start_date","end_date","acknowledge_unresolved","components"],"properties":{"name":{"type":"string","minLength":1,"maxLength":100},"time_zone":{"type":"string","minLength":1,"maxLength":100},"start_date":{"type":["string","null"],"pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$"},"end_date":{"type":["string","null"],"pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$"},"acknowledge_unresolved":{"type":"boolean"},"components":{"type":"object","maxProperties":40,"additionalProperties":{"type":"object","additionalProperties":false,"required":["target","time_zone"],"properties":{"target":{"enum":["accommodation","flight","activity","transport"]},"time_zone":{"type":["string","null"],"maxLength":100}}}}}}'::json,p_details),false) then raise exception 'Invalid details' using errcode='22023';end if;
 req=jsonb_build_object('brief_id',p_brief_id,'revision',p_expected_brief_revision,'proposal_id',p_proposal_id,'generation_id',p_expected_generation_id,'snapshot_hash',p_expected_snapshot_hash,'details',p_details);
 if octet_length(req::text)>65536 then raise exception 'Request too large' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('handoff:'||actor::text||':'||p_operation_id::text,0));
 select * into r from public.trip_handoff_operations where owner_id=actor and operation_id=p_operation_id;
 if found then
  if r.request is distinct from req then raise exception 'Operation reused' using errcode='22023';end if;
  select * into h from public.trip_proposal_handoffs where id=r.handoff_id;
  return public.get_trip_handoff_v1(h.brief_id)||'{"replayed":true}'::jsonb;
 end if;
 select * into b from public.trip_briefs where id=p_brief_id and owner_id=actor for update;
 if not found then raise exception 'Brief unavailable' using errcode='42501';end if;
 select * into h from public.trip_proposal_handoffs where brief_id=b.id;
 if found then
  if h.request is distinct from req then raise exception 'Brief already formalized with another request' using errcode='40001';end if;
  if b.trip_id is distinct from h.trip_id or (select count(*) from public.trip_proposal_component_links where handoff_id=h.id)<>(select jsonb_array_length(document#>'{candidate,components}') from public.trip_proposals where id=h.proposal_id) then raise exception 'Incomplete handoff' using errcode='23514';end if;
  insert into public.trip_handoff_operations values(actor,p_operation_id,h.id,req,clock_timestamp());return public.get_trip_handoff_v1(b.id);
 end if;
 if b.trip_id is not null then raise exception 'Missing handoff' using errcode='23514';end if;
 if b.revision<>p_expected_brief_revision then raise exception 'Brief revision conflict' using errcode='40001';end if;
 select * into p from public.trip_proposals where id=p_proposal_id;
 select * into g from public.proposal_generations where id=p.generation_id and owner_id=actor and brief_id=b.id;
 if not found then raise exception 'Proposal unavailable' using errcode='42501';end if;
 if g.id<>p_expected_generation_id or g.brief_revision<>b.revision or g.snapshot_hash<>p_expected_snapshot_hash or g.status<>'completed' then raise exception 'Proposal snapshot conflict' using errcode='40001';end if;
 if exists(select 1 from jsonb_array_elements(p.document->'evaluations') e where e->>'strength'='hard' and e->>'state'='violated') then raise exception 'Hard violation' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p.document->'evaluations') e where e->>'strength'='hard' and e->>'state'='unresolved') and not (p_details->>'acknowledge_unresolved')::boolean then raise exception 'Unresolved essentials require acknowledgement' using errcode='22023';end if;
 if btrim(p_details->>'name')='' then raise exception 'Name required' using errcode='22023';end if;
 tz=p_details->>'time_zone';if not exists(select 1 from pg_timezone_names where name=tz) then raise exception 'Explicit IANA timezone required' using errcode='22023';end if;
 d1=(p_details->>'start_date')::date;d2=(p_details->>'end_date')::date;
 if (d1 is null)<>(d2 is null) or d2<d1 then raise exception 'Invalid date pair' using errcode='22023';end if;
 components=p.document#>'{candidate,components}';
 if (select count(*) from jsonb_each(p_details->'components'))<>jsonb_array_length(components) then raise exception 'Exact component coverage required' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(components) loop
  choice=p_details->'components'->(c->>'id');
  if choice is null or not ((c->>'kind'='accommodation' and choice->>'target'='accommodation') or (c->>'kind'='experience' and choice->>'target'='activity') or (c->>'kind'='transport' and choice->>'target' in ('flight','transport'))) then raise exception 'Explicit component classification required' using errcode='22023';end if;
  if c->>'kind'='accommodation' then
   if choice->>'time_zone' is null or not exists(select 1 from pg_timezone_names where name=choice->>'time_zone') then raise exception 'Accommodation timezone required' using errcode='22023';end if;
  elsif choice->>'time_zone' is not null then raise exception 'No inferred scheduling timezone' using errcode='22023';end if;
 end loop;
 insert into public.trips(name,owner_id,start_date,end_date,time_zone) values(btrim(p_details->>'name'),actor,d1,d2,tz) returning id into t;
 insert into public.trip_members(trip_id,user_id) values(t,actor);
 insert into public.trip_proposal_handoffs(owner_id,brief_id,brief_revision,proposal_id,trip_id,snapshot_hash,request) values(actor,b.id,b.revision,p.id,t,g.snapshot_hash,req) returning * into h;
 for c in select value from jsonb_array_elements(components) loop
  choice=p_details->'components'->(c->>'id');
  if choice->>'target'='accommodation' then
   insert into public.trip_accommodations(trip_id,accommodation_type,name,time_zone,reservation_status,notes,created_by) values(t,'other','Allotjament per concretar',choice->>'time_zone','planning',c->>'description',actor) returning id into target;
   insert into public.trip_proposal_component_links(handoff_id,trip_id,component_id,accommodation_id) values(h.id,t,c->>'id',target);
  elsif choice->>'target'='flight' then
   insert into public.trip_flights(trip_id,flight_status,notes,created_by) values(t,'planning',c->>'description',actor) returning id into target;
   insert into public.trip_proposal_component_links(handoff_id,trip_id,component_id,flight_id) values(h.id,t,c->>'id',target);
  else
   insert into public.trip_activities(trip_id,title,activity_type,reservation_status,notes,created_by) values(t,case when choice->>'target'='transport' then 'Transport per concretar' else 'Activitat per concretar' end,case when choice->>'target'='transport' then 'transport' else 'other' end,'planning',c->>'description',actor) returning id into target;
   insert into public.trip_proposal_component_links(handoff_id,trip_id,component_id,activity_id) values(h.id,t,c->>'id',target);
  end if;
 end loop;
 update public.trip_briefs set trip_id=t,revision=revision+1,updated_at=clock_timestamp() where id=b.id;
 insert into public.trip_handoff_operations values(actor,p_operation_id,h.id,req,clock_timestamp());
 outcome=public.get_trip_handoff_v1(b.id);return outcome||'{"already_formalized":false}'::jsonb;
end $$;
revoke all on function public.formalize_trip_proposal_v1(uuid,bigint,uuid,uuid,text,uuid,jsonb),public.get_trip_handoff_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.formalize_trip_proposal_v1(uuid,bigint,uuid,uuid,text,uuid,jsonb),public.get_trip_handoff_v1(uuid) to authenticated;
revoke all on all functions in schema proposal_private from public,anon,authenticated,service_role;

create or replace function public.apply_trip_brief_patch_v1(
  p_brief_id uuid, p_operation_id uuid, p_expected_revision bigint,
  p_set jsonb default '{}', p_remove jsonb default '{}', p_confirm_hard text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid:=auth.uid(); current_brief public.trip_briefs; receipt public.trip_brief_operations;
  request jsonb; next_doc jsonb; collection text; entry record; key text; old_decision jsonb;
  changed_scope boolean; protected_scope text; was_created boolean:=false;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_brief_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
    or p_set is null or p_remove is null or p_confirm_hard is null
    or array_position(p_confirm_hard,null) is not null or cardinality(p_confirm_hard)>200
    or jsonb_typeof(p_set)<>'object' or jsonb_typeof(p_remove)<>'object'
    or (p_set-'decisions'-'scopes'-'travelers')<>'{}' or (p_remove-'decisions'-'scopes'-'travelers')<>'{}'
    or octet_length(p_set::text)+octet_length(p_remove::text)>131072 then
    raise exception 'Invalid patch envelope' using errcode='22023';
  end if;
  foreach collection in array array['decisions','scopes','travelers'] loop
    if p_set ? collection and jsonb_typeof(p_set->collection)<>'object' then raise exception 'Set must contain maps' using errcode='22023'; end if;
    if p_remove ? collection and jsonb_typeof(p_remove->collection)<>'array' then raise exception 'Remove must contain ID arrays' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(p_remove->collection,'[]')) x where jsonb_typeof(x)<>'string' or (x#>>'{}') !~ '^[a-z][a-z0-9_-]{0,63}$')
      or exists(select 1 from jsonb_array_elements_text(coalesce(p_remove->collection,'[]')) x group by x having count(*)>1)
      or exists(select 1 from jsonb_array_elements_text(coalesce(p_remove->collection,'[]')) x where coalesce(p_set->collection,'{}') ? x) then
      raise exception 'Invalid or ambiguous removal' using errcode='22023';
    end if;
  end loop;
  request:=jsonb_build_object('brief_id',p_brief_id,'expected_revision',p_expected_revision,'set',p_set,'remove',p_remove,'confirm_hard',p_confirm_hard);
  -- Serializes duplicate operation IDs, including attempts against different IDs.
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_operation_id::text,0));
  select * into receipt from public.trip_brief_operations where owner_id=actor and operation_id=p_operation_id;
  if found then
    if receipt.request is distinct from request then raise exception 'Operation ID reused with different request' using errcode='22023'; end if;
    select * into current_brief from public.trip_briefs where id=receipt.brief_id and owner_id=actor;
    return jsonb_build_object('brief',to_jsonb(current_brief),'applied_revision',receipt.applied_revision,'replayed',true);
  end if;
  if p_expected_revision=0 then
    insert into public.trip_briefs(id,owner_id,document) values(p_brief_id,actor,'{"decisions":{},"scopes":{},"travelers":{}}')
      on conflict(id) do nothing;
    was_created:=found;
  end if;
  select * into current_brief from public.trip_briefs where id=p_brief_id for update;
  if not found or current_brief.owner_id<>actor then raise exception 'Brief unavailable' using errcode='42501'; end if;
  if current_brief.trip_id is not null then raise exception 'Brief already formalized' using errcode='55000'; end if;
  if not was_created and current_brief.revision<>p_expected_revision then raise exception 'Brief revision conflict; reload before editing' using errcode='40001'; end if;
  if cardinality(p_confirm_hard)<>(select count(distinct x) from unnest(p_confirm_hard) x)
     or exists(select 1 from unnest(p_confirm_hard) x where coalesce(current_brief.document->'decisions'->x->>'strength','')<>'hard') then
    raise exception 'Confirmation must name existing hard decisions' using errcode='22023'; end if;
  next_doc:=current_brief.document;
  foreach collection in array array['decisions','scopes','travelers'] loop
    for key in select jsonb_array_elements_text(coalesce(p_remove->collection,'[]')) loop
      if not (next_doc->collection ? key) then raise exception 'Cannot remove missing ID' using errcode='22023'; end if;
      next_doc:=jsonb_set(next_doc,array[collection],(next_doc->collection)-key);
    end loop;
    next_doc:=jsonb_set(next_doc,array[collection],(next_doc->collection)||coalesce(p_set->collection,'{}'));
  end loop;
  for entry in select * from jsonb_each(current_brief.document->'decisions') loop
    old_decision:=entry.value;
    changed_scope:=false; protected_scope:=old_decision->>'scope';
    while protected_scope<>'global' loop
      if current_brief.document->'scopes'->protected_scope is distinct from next_doc->'scopes'->protected_scope then changed_scope:=true; end if;
      protected_scope:=current_brief.document->'scopes'->protected_scope->>'parent';
    end loop;
    if old_decision->>'strength'='hard' and
      (old_decision is distinct from next_doc->'decisions'->entry.key or changed_scope) and not (entry.key=any(p_confirm_hard)) then
      raise exception 'Explicit confirmation required for hard decision %',entry.key using errcode='22023';
    end if;
    if old_decision->>'origin'='explicit_user' and next_doc->'decisions' ? entry.key and
      (next_doc->'decisions'->entry.key->>'origin') is distinct from 'explicit_user' then
      raise exception 'An interpretation cannot replace an explicit decision' using errcode='22023';
    end if;
    -- IDs are identities, not movable slots. Remove + put is an explicit change.
    if next_doc->'decisions' ? entry.key and
      (old_decision->>'field',old_decision->>'scope') is distinct from
      (next_doc->'decisions'->entry.key->>'field',next_doc->'decisions'->entry.key->>'scope') then
      raise exception 'Decision field/scope immutable for an existing ID' using errcode='22023'; end if;
  end loop;
  -- Also reject laundering explicit authority via a different decision ID.
  if exists(select 1 from jsonb_each(current_brief.document->'decisions') a join jsonb_each(next_doc->'decisions') b
      on a.value->>'field'=b.value->>'field' and a.value->>'scope'=b.value->>'scope'
      where a.value->>'origin'='explicit_user' and b.value->>'origin'<>'explicit_user') then
    raise exception 'An interpretation cannot replace an explicit decision' using errcode='22023'; end if;
  if not public.trip_brief_valid_v1(next_doc) then raise exception 'Invalid brief document or conflicting scopes' using errcode='22023'; end if;
  update public.trip_briefs set document=next_doc,
    revision=case when was_created then 1 else revision+1 end,
    updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
    where id=p_brief_id returning * into current_brief;
  insert into public.trip_brief_operations(owner_id,operation_id,brief_id,request,applied_revision)
    values(actor,p_operation_id,p_brief_id,request,current_brief.revision);
  return jsonb_build_object('brief',to_jsonb(current_brief),'applied_revision',current_brief.revision,'replayed',false);
end;
$$;

create or replace function public.sync_trip_reminders()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_count integer := 0;
  affected_count integer := 0;
begin

  -- ------------------------------------------------------------
  -- Flights: departure -> 5 hours
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    flight.trip_id,
    'flight',
    flight.id,
    'flight_departure',
    coalesce(
      nullif(
        pg_catalog.concat_ws(
          ' ',
          nullif(pg_catalog.btrim(flight.airline), ''),
          nullif(pg_catalog.btrim(flight.flight_number), '')
        ),
        ''
      ),
      nullif(
        pg_catalog.concat_ws(
          ' → ',
          nullif(pg_catalog.btrim(flight.departure_city), ''),
          nullif(pg_catalog.btrim(flight.arrival_city), '')
        ),
        ''
      ),
      'Vol'
    ),
    flight.departure_at,
    300,
    flight.departure_at - interval '300 minutes',
    true,
    flight.updated_at
  from public.trip_flights as flight
  where flight.departure_at is not null
    and flight.departure_at > statement_timestamp()
    and flight.completed_at is null
    and flight.flight_status <> 'cancelled'
    and (flight.flight_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.flight_id=flight.id))
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Accommodation: check-in -> 2 hours
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    accommodation.trip_id,
    'accommodation',
    accommodation.id,
    'accommodation_check_in',
    accommodation.name,
    accommodation.check_in_at,
    120,
    accommodation.check_in_at - interval '120 minutes',
    true,
    accommodation.updated_at
  from public.trip_accommodations as accommodation
  where accommodation.check_in_at is not null
    and accommodation.check_in_at > statement_timestamp()
    and accommodation.check_in_completed_at is null
    and accommodation.reservation_status <> 'cancelled'
    and (accommodation.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.accommodation_id=accommodation.id))
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Accommodation: check-out -> 2 hours
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    accommodation.trip_id,
    'accommodation',
    accommodation.id,
    'accommodation_check_out',
    accommodation.name,
    accommodation.check_out_at,
    120,
    accommodation.check_out_at - interval '120 minutes',
    true,
    accommodation.updated_at
  from public.trip_accommodations as accommodation
  where accommodation.check_out_at is not null
    and accommodation.check_out_at > statement_timestamp()
    and accommodation.check_out_completed_at is null
    and accommodation.reservation_status <> 'cancelled'
    and (accommodation.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.accommodation_id=accommodation.id))
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Activities / restaurants: start -> 1 hour
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    activity.trip_id,
    'activity',
    activity.id,
    'activity_start',
    activity.title,
    activity.start_at,
    60,
    activity.start_at - interval '60 minutes',
    true,
    activity.updated_at
  from public.trip_activities as activity
  where activity.start_at is not null
    and activity.start_at > statement_timestamp()
    and activity.completed_at is null
    and activity.reservation_status <> 'cancelled'
    and (activity.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.activity_id=activity.id))
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Manual itinerary: exact only -> 1 hour
  -- ------------------------------------------------------------

  insert into public.trip_reminders (
    trip_id,
    source_kind,
    source_id,
    reminder_kind,
    title,
    event_at,
    default_notify_before_minutes,
    scheduled_for,
    enabled,
    source_updated_at
  )
  select
    item.trip_id,
    'itinerary_item',
    item.id,
    'itinerary_exact',
    item.title,
    item.starts_at,
    60,
    item.starts_at - interval '60 minutes',
    true,
    item.updated_at
  from public.trip_itinerary_items as item
  where item.timing_kind = 'exact'
    and item.starts_at is not null
    and item.starts_at > statement_timestamp()
    and item.status = 'planned'
  on conflict (
    trip_id,
    source_kind,
    source_id,
    reminder_kind
  )
  do update set
    title = excluded.title,
    event_at = excluded.event_at,
    default_notify_before_minutes =
      excluded.default_notify_before_minutes,
    scheduled_for = excluded.scheduled_for,
    enabled = true,
    source_updated_at = excluded.source_updated_at,
    updated_at = statement_timestamp();

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;


  -- ------------------------------------------------------------
  -- Disable reminders whose canonical source is no longer eligible.
  -- We keep the row for audit/stability instead of deleting it.
  -- ------------------------------------------------------------

  update public.trip_reminders as reminder
  set
    enabled = false,
    updated_at = statement_timestamp()
  where reminder.enabled
    and (
      (
        reminder.source_kind = 'flight'
        and reminder.reminder_kind = 'flight_departure'
        and not exists (
          select 1
          from public.trip_flights as flight
          where flight.id = reminder.source_id
            and flight.trip_id = reminder.trip_id
            and flight.departure_at is not null
            and flight.departure_at > statement_timestamp()
    and flight.completed_at is null
            and flight.flight_status <> 'cancelled'
    and (flight.flight_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.flight_id=flight.id))
        )
      )

      or (
        reminder.source_kind = 'accommodation'
        and reminder.reminder_kind = 'accommodation_check_in'
        and not exists (
          select 1
          from public.trip_accommodations as accommodation
          where accommodation.id = reminder.source_id
            and accommodation.trip_id = reminder.trip_id
            and accommodation.check_in_at is not null
            and accommodation.check_in_at > statement_timestamp()
    and accommodation.check_in_completed_at is null
            and accommodation.reservation_status <> 'cancelled'
    and (accommodation.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.accommodation_id=accommodation.id))
        )
      )

      or (
        reminder.source_kind = 'accommodation'
        and reminder.reminder_kind = 'accommodation_check_out'
        and not exists (
          select 1
          from public.trip_accommodations as accommodation
          where accommodation.id = reminder.source_id
            and accommodation.trip_id = reminder.trip_id
            and accommodation.check_out_at is not null
            and accommodation.check_out_at > statement_timestamp()
    and accommodation.check_out_completed_at is null
            and accommodation.reservation_status <> 'cancelled'
    and (accommodation.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.accommodation_id=accommodation.id))
        )
      )

      or (
        reminder.source_kind = 'activity'
        and reminder.reminder_kind = 'activity_start'
        and not exists (
          select 1
          from public.trip_activities as activity
          where activity.id = reminder.source_id
            and activity.trip_id = reminder.trip_id
            and activity.start_at is not null
            and activity.start_at > statement_timestamp()
    and activity.completed_at is null
            and activity.reservation_status <> 'cancelled'
    and (activity.reservation_status='confirmed' or not exists(select 1 from public.trip_proposal_component_links tb where tb.activity_id=activity.id))
        )
      )

      or (
        reminder.source_kind = 'itinerary_item'
        and reminder.reminder_kind = 'itinerary_exact'
        and not exists (
          select 1
          from public.trip_itinerary_items as item
          where item.id = reminder.source_id
            and item.trip_id = reminder.trip_id
            and item.timing_kind = 'exact'
            and item.starts_at is not null
            and item.starts_at > statement_timestamp()
            and item.status = 'planned'
        )
      )
    );

  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  return changed_count;
end;
$$;
grant select on public.trip_proposal_component_links to service_role;
commit;

-- TB-08.3f · standalone operational components in the live budget
begin;

create table public.trip_standalone_component_links (
  trip_id uuid not null references public.trips(id) on delete cascade,
  component_id text not null check (component_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  source_kind text not null check (source_kind in ('accommodation','flight','activity')),
  source_id uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (trip_id, component_id),
  unique (trip_id, source_kind, source_id)
);

alter table public.trip_standalone_component_links enable row level security;
revoke all on public.trip_standalone_component_links from public, anon, authenticated, service_role;
grant select on public.trip_standalone_component_links to authenticated;
create policy "trip members can view standalone component links"
on public.trip_standalone_component_links
for select to authenticated
using ((select auth.uid()) is not null and public.is_trip_member(trip_id));

alter table public.trip_component_costs alter column handoff_id drop not null;
alter table public.trip_component_costs
  add constraint trip_component_costs_trip_fkey
  foreign key (trip_id) references public.trips(id) on delete cascade;

create or replace function proposal_private.standalone_component_link_immutable()
returns trigger language plpgsql set search_path='' as $fn$
begin
  if pg_trigger_depth() > 1 then return old; end if;
  raise exception 'Standalone component mapping is immutable' using errcode='22023';
end
$fn$;

create trigger standalone_component_link_immutable
before update or delete on public.trip_standalone_component_links
for each row execute function proposal_private.standalone_component_link_immutable();

create or replace function proposal_private.cleanup_standalone_component_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare cid text;
begin
  select component_id into cid
  from public.trip_standalone_component_links
  where trip_id=old.trip_id and source_kind=tg_argv[0] and source_id=old.id;

  if cid is not null then
    delete from public.trip_component_costs
    where trip_id=old.trip_id and component_id=cid;
    delete from public.trip_standalone_component_links
    where trip_id=old.trip_id and component_id=cid;
  end if;
  return old;
end $$;

revoke all on function proposal_private.standalone_component_link_immutable() from public, anon, authenticated, service_role;
revoke all on function proposal_private.cleanup_standalone_component_link() from public, anon, authenticated, service_role;

create trigger cleanup_standalone_flight_budget
after delete on public.trip_flights
for each row execute function proposal_private.cleanup_standalone_component_link('flight');

create trigger cleanup_standalone_accommodation_budget
after delete on public.trip_accommodations
for each row execute function proposal_private.cleanup_standalone_component_link('accommodation');

create trigger cleanup_standalone_activity_budget
after delete on public.trip_activities
for each row execute function proposal_private.cleanup_standalone_component_link('activity');

create or replace function public.ensure_trip_standalone_component_v1(
  p_trip_id uuid,
  p_source_kind text,
  p_source_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  row_link public.trip_standalone_component_links;
  cid text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_trip_id is null or p_source_id is null or p_source_kind not in ('accommodation','flight','activity') then
    raise exception 'Invalid standalone component request' using errcode='22023';
  end if;
  if not public.is_trip_member(p_trip_id) then raise exception 'Trip unavailable' using errcode='42501'; end if;

  if p_source_kind='flight' then
    if not exists(select 1 from public.trip_flights where trip_id=p_trip_id and id=p_source_id) then raise exception 'Flight unavailable' using errcode='P0002'; end if;
  elsif p_source_kind='accommodation' then
    if not exists(select 1 from public.trip_accommodations where trip_id=p_trip_id and id=p_source_id) then raise exception 'Accommodation unavailable' using errcode='P0002'; end if;
  else
    if not exists(select 1 from public.trip_activities where trip_id=p_trip_id and id=p_source_id) then raise exception 'Activity unavailable' using errcode='P0002'; end if;
  end if;

  select * into row_link
  from public.trip_standalone_component_links
  where trip_id=p_trip_id and source_kind=p_source_kind and source_id=p_source_id;

  if not found then
    cid := 'standalone_' || p_source_kind || '_' || replace(p_source_id::text,'-','');
    insert into public.trip_standalone_component_links(trip_id,component_id,source_kind,source_id,created_by)
    values(p_trip_id,cid,p_source_kind,p_source_id,actor)
    on conflict (trip_id,source_kind,source_id) do nothing;

    select * into row_link
    from public.trip_standalone_component_links
    where trip_id=p_trip_id and source_kind=p_source_kind and source_id=p_source_id;
  end if;

  return jsonb_build_object(
    'trip_id',row_link.trip_id,
    'component_id',row_link.component_id,
    'source_kind',row_link.source_kind,
    'source_id',row_link.source_id
  );
end $$;

revoke all on function public.ensure_trip_standalone_component_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ensure_trip_standalone_component_v1(uuid,text,uuid) to authenticated;

create or replace function public.set_trip_component_cost_v1(
  p_trip_id uuid, p_component_id text, p_expected_revision bigint, p_operation_id uuid,
  p_expected_amount numeric default null, p_confirmed_amount numeric default null,
  p_currency text default null, p_expected_quality text default 'unknown',
  p_verified_at timestamptz default null, p_scope jsonb default '{}'::jsonb,
  p_unknown_required_costs jsonb default '[]'::jsonb, p_excluded_costs jsonb default '[]'::jsonb,
  p_evidence_document_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  l public.trip_proposal_component_links;
  s public.trip_standalone_component_links;
  existing public.trip_component_costs;
  receipt public.trip_component_cost_operations;
  req jsonb;
  normalized_currency text := nullif(upper(trim(p_currency)), '');
  source_kind text;
  source_id uuid;
  source_handoff_id uuid;
  next_revision bigint;
  effective_amount numeric;
  source_updated_at timestamptz;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_trip_id is null or p_component_id is null or p_component_id !~ '^[a-z][a-z0-9_-]{0,63}$' or p_expected_revision is null or p_expected_revision < 0 or p_operation_id is null then raise exception 'Invalid cost request' using errcode='22023'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception 'Trip unavailable' using errcode='42501'; end if;
  if p_expected_amount is not null and p_expected_amount < 0 then raise exception 'Expected amount must be non-negative' using errcode='22023'; end if;
  if p_confirmed_amount is not null and p_confirmed_amount < 0 then raise exception 'Confirmed amount must be non-negative' using errcode='22023'; end if;
  if normalized_currency is not null and normalized_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a 3-letter code' using errcode='22023'; end if;
  if (p_expected_amount is not null or p_confirmed_amount is not null) and normalized_currency is null then raise exception 'Currency required for priced component' using errcode='22023'; end if;
  if p_expected_amount is null then
    if p_expected_quality <> 'unknown' or p_verified_at is not null then raise exception 'Unknown expected price cannot be verified' using errcode='22023'; end if;
  elsif p_expected_quality = 'estimated' then
    if p_verified_at is not null then raise exception 'Estimated price cannot have verification time' using errcode='22023'; end if;
  elsif p_expected_quality = 'verified' then
    if p_verified_at is null then raise exception 'Verified price requires verification time' using errcode='22023'; end if;
  else raise exception 'Invalid expected price quality' using errcode='22023'; end if;
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' or octet_length(p_scope::text) > 4096 then raise exception 'Invalid price scope' using errcode='22023'; end if;
  if p_unknown_required_costs is null or jsonb_typeof(p_unknown_required_costs) <> 'array' or jsonb_array_length(p_unknown_required_costs) > 20 then raise exception 'Invalid unknown required costs' using errcode='22023'; end if;
  if p_excluded_costs is null or jsonb_typeof(p_excluded_costs) <> 'array' or jsonb_array_length(p_excluded_costs) > 20 then raise exception 'Invalid excluded costs' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_unknown_required_costs) v where jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 200) then raise exception 'Invalid unknown required cost item' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_excluded_costs) v where jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 200) then raise exception 'Invalid excluded cost item' using errcode='22023'; end if;
  if p_evidence_document_id is not null and not exists(select 1 from public.travel_documents d where d.trip_id=p_trip_id and d.id=p_evidence_document_id) then raise exception 'Cost evidence must belong to this trip' using errcode='23503'; end if;

  select * into l from public.trip_proposal_component_links where trip_id=p_trip_id and component_id=p_component_id limit 1;
  if found then
    source_handoff_id:=l.handoff_id;
    if l.accommodation_id is not null then source_kind:='accommodation'; source_id:=l.accommodation_id;
    elsif l.flight_id is not null then source_kind:='flight'; source_id:=l.flight_id;
    else source_kind:='activity'; source_id:=l.activity_id; end if;
  else
    select * into s from public.trip_standalone_component_links where trip_id=p_trip_id and component_id=p_component_id;
    if not found then raise exception 'Budget component unavailable' using errcode='P0002'; end if;
    source_handoff_id:=null;
    source_kind:=s.source_kind;
    source_id:=s.source_id;
  end if;

  req := jsonb_build_object('trip_id',p_trip_id,'component_id',p_component_id,'expected_revision',p_expected_revision,'expected_amount',p_expected_amount,'confirmed_amount',p_confirmed_amount,'currency',normalized_currency,'expected_quality',p_expected_quality,'verified_at',p_verified_at,'scope',p_scope,'unknown_required_costs',p_unknown_required_costs,'excluded_costs',p_excluded_costs,'evidence_document_id',p_evidence_document_id);
  perform pg_advisory_xact_lock(hashtextextended('tb06-cost:'||actor::text||':'||p_operation_id::text,0));
  select * into receipt from public.trip_component_cost_operations where actor_id=actor and operation_id=p_operation_id;
  if found then
    if receipt.request is distinct from req then raise exception 'Operation reused with different request' using errcode='22023'; end if;
    select * into existing from public.trip_component_costs where trip_id=receipt.trip_id and component_id=receipt.component_id;
    return jsonb_build_object('trip_id',existing.trip_id,'component_id',existing.component_id,'source_kind',existing.source_kind,'source_id',existing.source_id,'expected_amount',existing.expected_amount,'confirmed_amount',existing.confirmed_amount,'currency',existing.currency,'expected_quality',existing.expected_quality,'verified_at',existing.verified_at,'confirmed_at',existing.confirmed_at,'scope',existing.scope,'unknown_required_costs',existing.unknown_required_costs,'excluded_costs',existing.excluded_costs,'evidence_document_id',existing.evidence_document_id,'revision',existing.revision,'updated_at',existing.updated_at,'replayed',true);
  end if;

  select * into existing from public.trip_component_costs where trip_id=p_trip_id and component_id=p_component_id for update;
  if not found then
    if p_expected_revision <> 0 then raise exception 'Cost version conflict' using errcode='40001'; end if;
    insert into public.trip_component_costs(trip_id,component_id,handoff_id,source_kind,source_id,expected_amount,confirmed_amount,currency,expected_quality,verified_at,confirmed_at,scope,unknown_required_costs,excluded_costs,evidence_document_id,revision,updated_by)
    values(p_trip_id,p_component_id,source_handoff_id,source_kind,source_id,p_expected_amount,p_confirmed_amount,normalized_currency,p_expected_quality,p_verified_at,case when p_confirmed_amount is null then null else now() end,p_scope,p_unknown_required_costs,p_excluded_costs,p_evidence_document_id,1,actor)
    returning * into existing;
  else
    if existing.revision <> p_expected_revision then raise exception 'Cost version conflict' using errcode='40001'; end if;
    if existing.handoff_id is distinct from source_handoff_id or existing.source_kind <> source_kind or existing.source_id <> source_id then raise exception 'Component cost identity conflict' using errcode='23503'; end if;
    next_revision:=existing.revision+1;
    update public.trip_component_costs set expected_amount=p_expected_amount,confirmed_amount=p_confirmed_amount,currency=normalized_currency,expected_quality=p_expected_quality,verified_at=p_verified_at,confirmed_at=case when p_confirmed_amount is null then null when existing.confirmed_amount is distinct from p_confirmed_amount then now() else existing.confirmed_at end,scope=p_scope,unknown_required_costs=p_unknown_required_costs,excluded_costs=p_excluded_costs,evidence_document_id=p_evidence_document_id,revision=next_revision,updated_by=actor,updated_at=now()
    where trip_id=p_trip_id and component_id=p_component_id returning * into existing;
  end if;

  effective_amount:=coalesce(existing.confirmed_amount,existing.expected_amount);
  if source_kind='activity' then
    update public.trip_activities set amount=effective_amount,currency=case when effective_amount is null then null else existing.currency end
    where trip_id=p_trip_id and id=source_id returning updated_at into source_updated_at;
  end if;

  insert into public.trip_component_cost_operations(actor_id,operation_id,trip_id,component_id,request,result_revision) values(actor,p_operation_id,p_trip_id,p_component_id,req,existing.revision);
  return jsonb_build_object('trip_id',existing.trip_id,'component_id',existing.component_id,'source_kind',existing.source_kind,'source_id',existing.source_id,'expected_amount',existing.expected_amount,'confirmed_amount',existing.confirmed_amount,'currency',existing.currency,'expected_quality',existing.expected_quality,'verified_at',existing.verified_at,'confirmed_at',existing.confirmed_at,'scope',existing.scope,'unknown_required_costs',existing.unknown_required_costs,'excluded_costs',existing.excluded_costs,'evidence_document_id',existing.evidence_document_id,'revision',existing.revision,'updated_at',existing.updated_at,'source_updated_at',source_updated_at,'replayed',false);
end $$;

create or replace function public.get_trip_budget_v1(p_trip_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare settings jsonb; currencies jsonb; unknown_components integer; total_components integer; unknown_required integer;
begin
  if auth.uid() is null or not public.is_trip_member(p_trip_id) then raise exception 'Trip unavailable' using errcode='42501'; end if;

  select case when b.trip_id is null then null else jsonb_build_object('target_amount',b.target_amount,'maximum_amount',b.maximum_amount,'currency',b.currency,'revision',b.revision,'updated_at',b.updated_at) end
  into settings from (select p_trip_id as trip_id) x left join public.trip_budget_settings b on b.trip_id=x.trip_id;

  with components as (
    select trip_id,component_id from public.trip_proposal_component_links where trip_id=p_trip_id
    union
    select trip_id,component_id from public.trip_standalone_component_links where trip_id=p_trip_id
  ), priced as (
    select x.component_id,c.currency,c.expected_amount,c.confirmed_amount,c.unknown_required_costs,coalesce(c.confirmed_amount,c.expected_amount) effective_amount
    from components x
    left join public.trip_component_costs c on c.trip_id=x.trip_id and c.component_id=x.component_id
  )
  select count(*)::int,count(*) filter(where effective_amount is null)::int,
         coalesce(sum(case when unknown_required_costs is null then 0 else jsonb_array_length(unknown_required_costs) end),0)::int
  into total_components,unknown_components,unknown_required from priced;

  with components as (
    select trip_id,component_id from public.trip_proposal_component_links where trip_id=p_trip_id
    union
    select trip_id,component_id from public.trip_standalone_component_links where trip_id=p_trip_id
  ), priced as (
    select c.currency,c.expected_amount,c.confirmed_amount,coalesce(c.confirmed_amount,c.expected_amount) effective_amount,(c.confirmed_amount is not null) is_confirmed
    from components x
    join public.trip_component_costs c on c.trip_id=x.trip_id and c.component_id=x.component_id
    where coalesce(c.confirmed_amount,c.expected_amount) is not null
  ), grouped as (
    select currency,round(sum(effective_amount),2) total,
           round(coalesce(sum(effective_amount) filter(where is_confirmed),0),2) confirmed_total,
           round(coalesce(sum(effective_amount) filter(where not is_confirmed),0),2) expected_total,
           count(*)::int priced_components,
           count(*) filter(where confirmed_amount is not null)::int confirmed_components,
           count(*) filter(where confirmed_amount is null and expected_amount is not null)::int expected_components
    from priced group by currency
  )
  select coalesce(jsonb_agg(to_jsonb(grouped) order by currency),'[]'::jsonb) into currencies from grouped;

  return jsonb_build_object('trip_id',p_trip_id,'settings',settings,'currencies',coalesce(currencies,'[]'::jsonb),'total_components',coalesce(total_components,0),'unknown_components',coalesce(unknown_components,0),'unknown_required_costs',coalesce(unknown_required,0),'provisional',coalesce(unknown_components,0)>0 or coalesce(unknown_required,0)>0);
end $$;

revoke all on function public.get_trip_budget_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_trip_budget_v1(uuid) to authenticated;

commit;

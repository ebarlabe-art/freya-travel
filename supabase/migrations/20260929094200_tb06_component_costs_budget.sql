-- TB-06 · Contracte de preus i pressupost
-- Component costs are authoritative for TB components. travel_expenses remains actual spending, not budget projection.

create table public.trip_component_costs (
  trip_id uuid not null,
  component_id text not null,
  handoff_id uuid not null,
  source_kind text not null check (source_kind in ('accommodation','flight','activity')),
  source_id uuid not null,
  expected_amount numeric(14,2),
  confirmed_amount numeric(14,2),
  currency text,
  expected_quality text not null default 'unknown' check (expected_quality in ('unknown','estimated','verified')),
  verified_at timestamptz,
  confirmed_at timestamptz,
  scope jsonb not null default '{}'::jsonb,
  unknown_required_costs jsonb not null default '[]'::jsonb,
  excluded_costs jsonb not null default '[]'::jsonb,
  evidence_document_id uuid,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, component_id),
  foreign key (handoff_id, trip_id) references public.trip_proposal_handoffs(id, trip_id) on delete cascade,
  foreign key (trip_id, evidence_document_id) references public.travel_documents(trip_id, id),
  check (component_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  check (expected_amount is null or expected_amount >= 0),
  check (confirmed_amount is null or confirmed_amount >= 0),
  check (currency is null or currency ~ '^[A-Z]{3}$'),
  check (
    (expected_amount is null and expected_quality = 'unknown' and verified_at is null)
    or (expected_amount is not null and expected_quality = 'estimated' and verified_at is null)
    or (expected_amount is not null and expected_quality = 'verified' and verified_at is not null)
  ),
  check ((confirmed_amount is null and confirmed_at is null) or (confirmed_amount is not null and confirmed_at is not null)),
  check (jsonb_typeof(scope) = 'object'),
  check (jsonb_typeof(unknown_required_costs) = 'array'),
  check (jsonb_typeof(excluded_costs) = 'array')
);

create index trip_component_costs_handoff_idx on public.trip_component_costs(handoff_id, trip_id);
create index trip_component_costs_source_idx on public.trip_component_costs(trip_id, source_kind, source_id);
create index trip_component_costs_evidence_idx on public.trip_component_costs(trip_id, evidence_document_id) where evidence_document_id is not null;

create table public.trip_component_cost_operations (
  actor_id uuid not null references auth.users(id),
  operation_id uuid not null,
  trip_id uuid not null,
  component_id text not null,
  request jsonb not null,
  result_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key(actor_id, operation_id),
  foreign key (trip_id, component_id) references public.trip_component_costs(trip_id, component_id) on delete cascade
);

create table public.trip_budget_settings (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  target_amount numeric(14,2),
  maximum_amount numeric(14,2),
  currency text,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_amount is null or target_amount >= 0),
  check (maximum_amount is null or maximum_amount >= 0),
  check (target_amount is null or maximum_amount is null or maximum_amount >= target_amount),
  check (currency is null or currency ~ '^[A-Z]{3}$'),
  check ((target_amount is null and maximum_amount is null and currency is null) or currency is not null)
);

create table public.trip_budget_setting_operations (
  actor_id uuid not null references auth.users(id),
  operation_id uuid not null,
  trip_id uuid not null references public.trips(id) on delete cascade,
  request jsonb not null,
  result_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key(actor_id, operation_id)
);

alter table public.trip_component_costs enable row level security;
alter table public.trip_component_cost_operations enable row level security;
alter table public.trip_budget_settings enable row level security;
alter table public.trip_budget_setting_operations enable row level security;

create policy "trip members can view TB component costs"
on public.trip_component_costs for select to authenticated
using ((select auth.uid()) is not null and public.is_trip_member(trip_id));

create policy "trip members can view TB budget settings"
on public.trip_budget_settings for select to authenticated
using ((select auth.uid()) is not null and public.is_trip_member(trip_id));

revoke all on public.trip_component_costs from public, anon, authenticated, service_role;
revoke all on public.trip_component_cost_operations from public, anon, authenticated, service_role;
revoke all on public.trip_budget_settings from public, anon, authenticated, service_role;
revoke all on public.trip_budget_setting_operations from public, anon, authenticated, service_role;
grant select on public.trip_component_costs to authenticated;
grant select on public.trip_budget_settings to authenticated;

create trigger trip_component_cost_operations_immutable
before update or delete on public.trip_component_cost_operations
for each row execute function proposal_private.handoff_immutable();

create trigger trip_budget_setting_operations_immutable
before update or delete on public.trip_budget_setting_operations
for each row execute function proposal_private.handoff_immutable();

create or replace function public.set_trip_component_cost_v1(
  p_trip_id uuid, p_component_id text, p_expected_revision bigint, p_operation_id uuid,
  p_expected_amount numeric default null, p_confirmed_amount numeric default null,
  p_currency text default null, p_expected_quality text default 'unknown',
  p_verified_at timestamptz default null, p_scope jsonb default '{}'::jsonb,
  p_unknown_required_costs jsonb default '[]'::jsonb, p_excluded_costs jsonb default '[]'::jsonb,
  p_evidence_document_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid(); l public.trip_proposal_component_links; existing public.trip_component_costs;
  receipt public.trip_component_cost_operations; req jsonb; normalized_currency text := nullif(upper(trim(p_currency)), '');
  source_kind text; source_id uuid; next_revision bigint; effective_amount numeric; source_updated_at timestamptz;
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
  if l.component_id is null then raise exception 'TB component unavailable' using errcode='P0002'; end if;
  if l.accommodation_id is not null then source_kind:='accommodation'; source_id:=l.accommodation_id;
  elsif l.flight_id is not null then source_kind:='flight'; source_id:=l.flight_id;
  else source_kind:='activity'; source_id:=l.activity_id; end if;

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
    values(p_trip_id,p_component_id,l.handoff_id,source_kind,source_id,p_expected_amount,p_confirmed_amount,normalized_currency,p_expected_quality,p_verified_at,case when p_confirmed_amount is null then null else now() end,p_scope,p_unknown_required_costs,p_excluded_costs,p_evidence_document_id,1,actor)
    returning * into existing;
  else
    if existing.revision <> p_expected_revision then raise exception 'Cost version conflict' using errcode='40001'; end if;
    if existing.handoff_id <> l.handoff_id or existing.source_kind <> source_kind or existing.source_id <> source_id then raise exception 'Component cost identity conflict' using errcode='23503'; end if;
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
end; $$;

create or replace function public.set_trip_budget_settings_v1(p_trip_id uuid,p_expected_revision bigint,p_operation_id uuid,p_target_amount numeric default null,p_maximum_amount numeric default null,p_currency text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.trip_budget_settings; receipt public.trip_budget_setting_operations; normalized_currency text:=nullif(upper(trim(p_currency)),''); req jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_trip_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null then raise exception 'Invalid budget request' using errcode='22023'; end if;
  if not public.is_trip_member(p_trip_id) then raise exception 'Trip unavailable' using errcode='42501'; end if;
  if p_target_amount is not null and p_target_amount<0 then raise exception 'Target amount must be non-negative' using errcode='22023'; end if;
  if p_maximum_amount is not null and p_maximum_amount<0 then raise exception 'Maximum amount must be non-negative' using errcode='22023'; end if;
  if p_target_amount is not null and p_maximum_amount is not null and p_maximum_amount<p_target_amount then raise exception 'Maximum budget cannot be below target' using errcode='22023'; end if;
  if (p_target_amount is not null or p_maximum_amount is not null) and (normalized_currency is null or normalized_currency !~ '^[A-Z]{3}$') then raise exception 'Budget currency required' using errcode='22023'; end if;
  if p_target_amount is null and p_maximum_amount is null then normalized_currency:=null; end if;
  req:=jsonb_build_object('trip_id',p_trip_id,'expected_revision',p_expected_revision,'target_amount',p_target_amount,'maximum_amount',p_maximum_amount,'currency',normalized_currency);
  perform pg_advisory_xact_lock(hashtextextended('tb06-budget:'||actor::text||':'||p_operation_id::text,0));
  select * into receipt from public.trip_budget_setting_operations where actor_id=actor and operation_id=p_operation_id;
  if found then
    if receipt.request is distinct from req then raise exception 'Operation reused with different request' using errcode='22023'; end if;
    select * into existing from public.trip_budget_settings where trip_id=receipt.trip_id;
    return jsonb_build_object('trip_id',existing.trip_id,'target_amount',existing.target_amount,'maximum_amount',existing.maximum_amount,'currency',existing.currency,'revision',existing.revision,'updated_at',existing.updated_at,'replayed',true);
  end if;
  select * into existing from public.trip_budget_settings where trip_id=p_trip_id for update;
  if not found then
    if p_expected_revision<>0 then raise exception 'Budget version conflict' using errcode='40001'; end if;
    insert into public.trip_budget_settings(trip_id,target_amount,maximum_amount,currency,revision,updated_by) values(p_trip_id,p_target_amount,p_maximum_amount,normalized_currency,1,actor) returning * into existing;
  else
    if existing.revision<>p_expected_revision then raise exception 'Budget version conflict' using errcode='40001'; end if;
    update public.trip_budget_settings set target_amount=p_target_amount,maximum_amount=p_maximum_amount,currency=normalized_currency,revision=existing.revision+1,updated_by=actor,updated_at=now() where trip_id=p_trip_id returning * into existing;
  end if;
  insert into public.trip_budget_setting_operations(actor_id,operation_id,trip_id,request,result_revision) values(actor,p_operation_id,p_trip_id,req,existing.revision);
  return jsonb_build_object('trip_id',existing.trip_id,'target_amount',existing.target_amount,'maximum_amount',existing.maximum_amount,'currency',existing.currency,'revision',existing.revision,'updated_at',existing.updated_at,'replayed',false);
end; $$;

create or replace function public.confirm_trip_component_with_cost_v1(
  p_trip_id uuid,p_component_id text,p_expected_updated_at timestamptz,p_operation_id uuid,
  p_expected_evidence_document_id uuid default null,p_evidence_document_id uuid default null,p_evidence_role text default null,
  p_cost_expected_revision bigint default 0,p_expected_amount numeric default null,p_confirmed_amount numeric default null,p_currency text default null,
  p_expected_quality text default 'unknown',p_verified_at timestamptz default null,p_scope jsonb default '{}'::jsonb,
  p_unknown_required_costs jsonb default '[]'::jsonb,p_excluded_costs jsonb default '[]'::jsonb,p_cost_evidence_document_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare confirmation jsonb; cost_result jsonb;
begin
  confirmation:=public.confirm_trip_component_v1(p_trip_id,p_component_id,p_expected_updated_at,p_operation_id,p_expected_evidence_document_id,p_evidence_document_id,p_evidence_role);
  cost_result:=public.set_trip_component_cost_v1(p_trip_id,p_component_id,p_cost_expected_revision,p_operation_id,p_expected_amount,p_confirmed_amount,p_currency,p_expected_quality,p_verified_at,p_scope,p_unknown_required_costs,p_excluded_costs,coalesce(p_cost_evidence_document_id,p_evidence_document_id));
  return confirmation || jsonb_build_object('cost',cost_result,'source_updated_at',coalesce(cost_result->'source_updated_at',confirmation->'source_updated_at'));
end; $$;

revoke all on function public.set_trip_component_cost_v1(uuid,text,bigint,uuid,numeric,numeric,text,text,timestamptz,jsonb,jsonb,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_trip_component_cost_v1(uuid,text,bigint,uuid,numeric,numeric,text,text,timestamptz,jsonb,jsonb,jsonb,uuid) to authenticated;
revoke all on function public.set_trip_budget_settings_v1(uuid,bigint,uuid,numeric,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.set_trip_budget_settings_v1(uuid,bigint,uuid,numeric,numeric,text) to authenticated;
revoke all on function public.confirm_trip_component_with_cost_v1(uuid,text,timestamptz,uuid,uuid,uuid,text,bigint,numeric,numeric,text,text,timestamptz,jsonb,jsonb,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.confirm_trip_component_with_cost_v1(uuid,text,timestamptz,uuid,uuid,uuid,text,bigint,numeric,numeric,text,text,timestamptz,jsonb,jsonb,jsonb,uuid) to authenticated;

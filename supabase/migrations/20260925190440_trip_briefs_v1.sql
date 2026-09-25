-- TB-01 only. No operational tables, publication, policies or functions changed.
-- Schema literal is frozen for v1; parity tested against domain/trip-brief.mjs.
create schema if not exists extensions;
create extension if not exists pg_jsonschema with schema extensions;

create function public.trip_brief_schema_v1() returns json
language sql immutable set search_path = '' as $schema$
select $json${"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"decisions":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":200,"additionalProperties":{"oneOf":[{"type":"object","properties":{"field":{"anyOf":[{"enum":["dates","dates.flexibility_days","origin","destination","duration","pace","budget","interests","flight.departure_window","flight.arrival_window","flight.max_stops","flight.max_duration_minutes","flight.alternative_airports","flight.low_cost","baggage","hotel.comfort","hotel.location","hotel.room","hotel.breakfast","hotel.cancellation","hotel.amenities","hotel.stars","hotel.rating","experience.styles","notes"]},{"type":"string","pattern":"^custom\\.[a-z][a-z0-9_]{0,49}$"}]},"scope":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"origin":{"enum":["explicit_user","interpreted_from_user","system_default"]},"knowledge":{"const":"unknown"}},"required":["field","scope","origin","knowledge"],"additionalProperties":false},{"type":"object","properties":{"field":{"anyOf":[{"enum":["dates","dates.flexibility_days","origin","destination","duration","pace","budget","interests","flight.departure_window","flight.arrival_window","flight.max_stops","flight.max_duration_minutes","flight.alternative_airports","flight.low_cost","baggage","hotel.comfort","hotel.location","hotel.room","hotel.breakfast","hotel.cancellation","hotel.amenities","hotel.stars","hotel.rating","experience.styles","notes"]},{"type":"string","pattern":"^custom\\.[a-z][a-z0-9_]{0,49}$"}]},"scope":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"origin":{"enum":["explicit_user","interpreted_from_user","system_default"]},"knowledge":{"const":"indifferent"},"strength":{"enum":["hard","preference","flexible"]}},"required":["field","scope","origin","knowledge","strength"],"additionalProperties":false},{"type":"object","properties":{"field":{"anyOf":[{"enum":["dates","dates.flexibility_days","origin","destination","duration","pace","budget","interests","flight.departure_window","flight.arrival_window","flight.max_stops","flight.max_duration_minutes","flight.alternative_airports","flight.low_cost","baggage","hotel.comfort","hotel.location","hotel.room","hotel.breakfast","hotel.cancellation","hotel.amenities","hotel.stars","hotel.rating","experience.styles","notes"]},{"type":"string","pattern":"^custom\\.[a-z][a-z0-9_]{0,49}$"}]},"scope":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"origin":{"enum":["explicit_user","interpreted_from_user","system_default"]},"knowledge":{"const":"known"},"strength":{"enum":["hard","preference","flexible"]},"value":{}},"required":["field","scope","origin","knowledge","strength","value"],"additionalProperties":false,"allOf":[{"if":{"properties":{"field":{"const":"dates"}}},"then":{"properties":{"value":{"oneOf":[{"type":"object","properties":{"mode":{"const":"exact"},"start":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"end":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"}},"required":["mode","start","end"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"window"},"earliest":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"latest":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"}},"required":["mode","earliest","latest"],"additionalProperties":false}]}}}},{"if":{"properties":{"field":{"const":"dates.flexibility_days"}}},"then":{"properties":{"value":{"type":"integer","minimum":0,"maximum":365}}}},{"if":{"properties":{"field":{"const":"origin"}}},"then":{"properties":{"value":{"type":"object","properties":{"places":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["places"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"destination"}}},"then":{"properties":{"value":{"oneOf":[{"type":"object","properties":{"mode":{"const":"open"}},"required":["mode"],"additionalProperties":false},{"type":"object","properties":{"mode":{"enum":["known","partial"]},"places":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","places"],"additionalProperties":false}]}}}},{"if":{"properties":{"field":{"const":"duration"}}},"then":{"properties":{"value":{"type":"object","properties":{"unit":{"enum":["days","nights"]},"min":{"type":"integer","minimum":1,"maximum":730},"max":{"type":"integer","minimum":1,"maximum":730}},"required":["unit","min","max"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"pace"}}},"then":{"properties":{"value":{"enum":["relaxed","balanced","active"]}}}},{"if":{"properties":{"field":{"const":"budget"}}},"then":{"properties":{"value":{"oneOf":[{"type":"object","properties":{"mode":{"const":"price_discovery"},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"target"},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"amount":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","currency","amount"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"maximum"},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"amount":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","currency","amount"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"target_stretch"},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"amount":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"stretch":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","currency","amount","stretch"],"additionalProperties":false}]}}}},{"if":{"properties":{"field":{"const":"interests"}}},"then":{"properties":{"value":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"flight.departure_window"}}},"then":{"properties":{"value":{"type":"object","properties":{"weekdays":{"type":"array","items":{"type":"integer","minimum":1,"maximum":7},"minItems":1,"maxItems":7,"uniqueItems":true},"local_date":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"min":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"max":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"time_zone":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"}},"required":[],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"flight.arrival_window"}}},"then":{"properties":{"value":{"type":"object","properties":{"weekdays":{"type":"array","items":{"type":"integer","minimum":1,"maximum":7},"minItems":1,"maxItems":7,"uniqueItems":true},"local_date":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"min":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"max":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"time_zone":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"}},"required":[],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"flight.max_stops"}}},"then":{"properties":{"value":{"type":"integer","minimum":0,"maximum":5}}}},{"if":{"properties":{"field":{"const":"flight.max_duration_minutes"}}},"then":{"properties":{"value":{"type":"integer","minimum":1,"maximum":4320}}}},{"if":{"properties":{"field":{"const":"flight.alternative_airports"}}},"then":{"properties":{"value":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"flight.low_cost"}}},"then":{"properties":{"value":{"type":"boolean"}}}},{"if":{"properties":{"field":{"const":"baggage"}}},"then":{"properties":{"value":{"type":"object","properties":{"shared":{"type":"array","items":{"type":"object","properties":{"kind":{"enum":["personal","cabin","checked","other"]},"quantity":{"type":"integer","minimum":1,"maximum":20},"weight_kg":{"type":"number","exclusiveMinimum":0,"maximum":100},"note":{"type":"string","minLength":1,"maxLength":500,"pattern":"\\S"}},"required":["kind","quantity"],"additionalProperties":false},"minItems":1,"maxItems":30,"uniqueItems":true},"per_traveler":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":30,"additionalProperties":{"type":"array","items":{"type":"object","properties":{"kind":{"enum":["personal","cabin","checked","other"]},"quantity":{"type":"integer","minimum":1,"maximum":20},"weight_kg":{"type":"number","exclusiveMinimum":0,"maximum":100},"note":{"type":"string","minLength":1,"maxLength":500,"pattern":"\\S"}},"required":["kind","quantity"],"additionalProperties":false},"minItems":1,"maxItems":30,"uniqueItems":true}}},"required":[],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"hotel.comfort"}}},"then":{"properties":{"value":{"enum":["economic","comfortable","special"]}}}},{"if":{"properties":{"field":{"const":"hotel.location"}}},"then":{"properties":{"value":{"enum":["central","well_connected"]}}}},{"if":{"properties":{"field":{"const":"hotel.room"}}},"then":{"properties":{"value":{"type":"object","properties":{"type":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"},"rooms":{"type":"integer","minimum":1,"maximum":30},"occupancy":{"type":"integer","minimum":1,"maximum":60}},"required":["type"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"hotel.breakfast"}}},"then":{"properties":{"value":{"type":"boolean"}}}},{"if":{"properties":{"field":{"const":"hotel.cancellation"}}},"then":{"properties":{"value":{"enum":["free","refundable","non_refundable_acceptable"]}}}},{"if":{"properties":{"field":{"const":"hotel.amenities"}}},"then":{"properties":{"value":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"hotel.stars"}}},"then":{"properties":{"value":{"type":"integer","minimum":1,"maximum":5}}}},{"if":{"properties":{"field":{"const":"hotel.rating"}}},"then":{"properties":{"value":{"type":"object","properties":{"min":{"type":"number","minimum":0,"maximum":10},"scale":{"enum":[5,10]},"source":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"}},"required":["min","scale","source"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"experience.styles"}}},"then":{"properties":{"value":{"type":"array","items":{"enum":["independent","audio_guide","guided_visit","organized_excursion","independent_excursion","combination"]},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"notes"}}},"then":{"properties":{"value":{"type":"string","minLength":1,"maxLength":2000,"pattern":"\\S"}}}},{"if":{"properties":{"field":{"pattern":"^custom\\."}}},"then":{"properties":{"value":{"type":"string","minLength":1,"maxLength":1000,"pattern":"\\S"}}}}]}]}},"scopes":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":50,"additionalProperties":{"type":"object","properties":{"kind":{"enum":["destination","stay","component","leg"]},"parent":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"label":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"}},"required":["kind","parent","label"],"additionalProperties":false}},"travelers":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":30,"additionalProperties":{"type":"object","properties":{"kind":{"enum":["adult","child"]},"age":{"type":"integer","minimum":0,"maximum":17}},"required":["kind"],"additionalProperties":false}}},"required":["decisions","scopes","travelers"],"additionalProperties":false}$json$::json;
$schema$;

create function public.trip_brief_valid_v1(doc jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  entry record; other record; scope_id text; parent_id text; chain text[];
  value jsonb; ancestor jsonb; bag_id text;
begin
  if doc is null or octet_length(doc::text)>131072
     or not extensions.jsonb_matches_schema(public.trip_brief_schema_v1(),doc) then return false; end if;
  if doc->'scopes' ? 'global' then return false; end if;
  for entry in select * from jsonb_each(doc->'scopes') loop
    scope_id:=entry.key; chain:='{}';
    loop
      if scope_id='global' then exit; end if;
      if scope_id=any(chain) or not (doc->'scopes' ? scope_id) then return false; end if;
      chain:=array_append(chain,scope_id);
      if cardinality(chain)>4 then return false; end if;
      parent_id:=doc->'scopes'->scope_id->>'parent';
      if parent_id<>'global' and not (
        (doc->'scopes'->scope_id->>'kind'='stay' and doc->'scopes'->parent_id->>'kind'='destination') or
        (doc->'scopes'->scope_id->>'kind'='component' and doc->'scopes'->parent_id->>'kind' in ('stay','destination')) or
        (doc->'scopes'->scope_id->>'kind'='leg' and doc->'scopes'->parent_id->>'kind'='component')
      ) then return false; end if;
      scope_id:=parent_id;
    end loop;
  end loop;
  if exists(select 1 from jsonb_each(doc->'travelers') d where d.value->>'kind'='adult' and d.value ? 'age') then return false; end if;
  if exists(select 1 from jsonb_each(doc->'decisions') d group by d.value->>'field',d.value->>'scope' having count(*)>1) then return false; end if;
  for entry in select * from jsonb_each(doc->'decisions') loop
    value:=entry.value->'value'; scope_id:=entry.value->>'scope';
    if scope_id<>'global' and not (doc->'scopes' ? scope_id) then return false; end if;
    if entry.value->>'strength'='hard' and entry.value->>'origin'<>'explicit_user' then return false; end if;
    if entry.value->>'knowledge'='known' then
      case entry.value->>'field'
        when 'dates' then
          if value->>'mode'='exact' then
            if (value->>'start')::date>(value->>'end')::date then return false; end if;
          else
            if (value->>'earliest')::date>(value->>'latest')::date then return false; end if;
          end if;
        when 'duration' then
          if (value->>'min')::int>(value->>'max')::int then return false; end if;
        when 'hotel.rating' then
          if (value->>'min')::numeric>(value->>'scale')::numeric then return false; end if;
        when 'flight.departure_window','flight.arrival_window' then
          if not (value ? 'min' or value ? 'max') then return false; end if;
          if value ? 'min' and value ? 'max' and value->>'min'>value->>'max' then return false; end if;
          if value ? 'local_date' then
            perform (value->>'local_date')::date;
            if value ? 'weekdays' and not (value->'weekdays' @> jsonb_build_array(extract(isodow from (value->>'local_date')::date)::int)) then return false; end if;
          end if;
        when 'baggage' then
          if value='{}'::jsonb or value='{"per_traveler":{}}'::jsonb then return false; end if;
          for bag_id in select jsonb_object_keys(coalesce(value->'per_traveler','{}')) loop
            if not (doc->'travelers' ? bag_id) then return false; end if;
          end loop;
        else null;
      end case;
    end if;
    -- A narrower scope cannot weaken an inherited hard, even by UNKNOWN.
    while scope_id<>'global' loop
      scope_id:=doc->'scopes'->scope_id->>'parent';
      select d.value into ancestor from jsonb_each(doc->'decisions') d
        where d.value->>'scope'=scope_id and d.value->>'field'=entry.value->>'field';
      if ancestor->>'strength'='hard' and
        (ancestor - 'scope') is distinct from (entry.value - 'scope') then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.trip_briefs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version=1),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  trip_id uuid references public.trips(id),
  document jsonb not null check (public.trip_brief_valid_v1(document)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint brief_handoff_not_implemented check (trip_id is null)
);
create index trip_briefs_owner_updated_idx on public.trip_briefs(owner_id,updated_at desc,id);
-- Receipts retain the exact request, not a stale response snapshot. No expiration
-- in v1: deleting a receipt would break the retry guarantee.
create table public.trip_brief_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  brief_id uuid not null references public.trip_briefs(id) on delete cascade,
  request jsonb not null check (octet_length(request::text)<=262144),
  applied_revision bigint not null check (applied_revision>0),
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,operation_id)
);
create index trip_brief_operations_brief_idx on public.trip_brief_operations(brief_id);
alter table public.trip_briefs enable row level security;
alter table public.trip_brief_operations enable row level security;
revoke all on public.trip_briefs,public.trip_brief_operations from public,anon,authenticated,service_role;
grant select on public.trip_briefs to authenticated;
create policy brief_owner_read on public.trip_briefs for select to authenticated using (owner_id=(select auth.uid()));

-- Sole mutation boundary: authenticated owner command, not an AI/tool endpoint.
-- Never grant this RPC to an autonomous actor using an owner's identity.
create function public.apply_trip_brief_patch_v1(
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
revoke all on function public.trip_brief_schema_v1(),public.trip_brief_valid_v1(jsonb),public.apply_trip_brief_patch_v1(uuid,uuid,bigint,jsonb,jsonb,text[]) from public,anon,authenticated,service_role;
grant execute on function public.apply_trip_brief_patch_v1(uuid,uuid,bigint,jsonb,jsonb,text[]) to authenticated;
-- No Realtime publication: explicit reload + CAS is sufficient for private v1.

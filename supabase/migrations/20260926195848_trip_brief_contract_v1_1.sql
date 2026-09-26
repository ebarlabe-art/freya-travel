-- TB-01.1: additive schema-v1 extension. DB FIRST, client SECOND.
-- No row/receipt rewriting, no RPC, grants, RLS or version changes.
-- Historical TB-01 migration remains immutable.
begin;
create or replace function public.trip_brief_schema_v1() returns json
language sql immutable set search_path = '' as $schema$
select $json${"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"decisions":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":200,"additionalProperties":{"oneOf":[{"type":"object","properties":{"field":{"anyOf":[{"enum":["interest.christmas","interest.christmas_markets","interest.snow","interest.snow_activities","interest.gastronomy","interest.culture","interest.nature","interest.spa_relaxation","interest.nightlife","interest.shopping","interest.special_places","hotel.amenity.spa","hotel.amenity.pool","hotel.amenity.parking","hotel.amenity.gym","destination.multidestination","dates","dates.flexibility_days","origin","destination","duration","pace","budget","interests","flight.departure_window","flight.arrival_window","flight.max_stops","flight.max_duration_minutes","flight.alternative_airports","flight.low_cost","baggage","hotel.comfort","hotel.location","hotel.room","hotel.breakfast","hotel.cancellation","hotel.amenities","hotel.stars","hotel.rating","experience.styles","notes"]},{"type":"string","pattern":"^interest\\.free\\.[0-9a-f]{32}$"},{"type":"string","pattern":"^custom\\.[a-z][a-z0-9_]{0,49}$"}]},"scope":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"origin":{"enum":["explicit_user","interpreted_from_user","system_default"]},"knowledge":{"const":"unknown"},"label":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"}},"required":["field","scope","origin","knowledge"],"additionalProperties":false,"allOf":[{"if":{"properties":{"field":{"pattern":"^interest\\.free\\.[0-9a-f]{32}$"}}},"then":{"required":["label"]},"else":{"not":{"required":["label"]}}}]},{"type":"object","properties":{"field":{"anyOf":[{"enum":["interest.christmas","interest.christmas_markets","interest.snow","interest.snow_activities","interest.gastronomy","interest.culture","interest.nature","interest.spa_relaxation","interest.nightlife","interest.shopping","interest.special_places","hotel.amenity.spa","hotel.amenity.pool","hotel.amenity.parking","hotel.amenity.gym","destination.multidestination","dates","dates.flexibility_days","origin","destination","duration","pace","budget","interests","flight.departure_window","flight.arrival_window","flight.max_stops","flight.max_duration_minutes","flight.alternative_airports","flight.low_cost","baggage","hotel.comfort","hotel.location","hotel.room","hotel.breakfast","hotel.cancellation","hotel.amenities","hotel.stars","hotel.rating","experience.styles","notes"]},{"type":"string","pattern":"^interest\\.free\\.[0-9a-f]{32}$"},{"type":"string","pattern":"^custom\\.[a-z][a-z0-9_]{0,49}$"}]},"scope":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"origin":{"enum":["explicit_user","interpreted_from_user","system_default"]},"knowledge":{"const":"indifferent"},"strength":{"enum":["hard","preference","flexible"]},"label":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"}},"required":["field","scope","origin","knowledge","strength"],"additionalProperties":false,"allOf":[{"if":{"properties":{"field":{"pattern":"^interest\\.free\\.[0-9a-f]{32}$"}}},"then":{"required":["label"]},"else":{"not":{"required":["label"]}}}]},{"type":"object","properties":{"field":{"anyOf":[{"enum":["interest.christmas","interest.christmas_markets","interest.snow","interest.snow_activities","interest.gastronomy","interest.culture","interest.nature","interest.spa_relaxation","interest.nightlife","interest.shopping","interest.special_places","hotel.amenity.spa","hotel.amenity.pool","hotel.amenity.parking","hotel.amenity.gym","destination.multidestination","dates","dates.flexibility_days","origin","destination","duration","pace","budget","interests","flight.departure_window","flight.arrival_window","flight.max_stops","flight.max_duration_minutes","flight.alternative_airports","flight.low_cost","baggage","hotel.comfort","hotel.location","hotel.room","hotel.breakfast","hotel.cancellation","hotel.amenities","hotel.stars","hotel.rating","experience.styles","notes"]},{"type":"string","pattern":"^interest\\.free\\.[0-9a-f]{32}$"},{"type":"string","pattern":"^custom\\.[a-z][a-z0-9_]{0,49}$"}]},"scope":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"origin":{"enum":["explicit_user","interpreted_from_user","system_default"]},"knowledge":{"const":"known"},"strength":{"enum":["hard","preference","flexible"]},"value":{},"label":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"}},"required":["field","scope","origin","knowledge","strength","value"],"additionalProperties":false,"allOf":[{"if":{"properties":{"field":{"const":"interest.christmas"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.christmas_markets"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.snow"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.snow_activities"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.gastronomy"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.culture"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.nature"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.spa_relaxation"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.nightlife"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.shopping"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"interest.special_places"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"hotel.amenity.spa"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"hotel.amenity.pool"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"hotel.amenity.parking"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"hotel.amenity.gym"}}},"then":{"properties":{"value":{"const":true}}}},{"if":{"properties":{"field":{"const":"destination.multidestination"}}},"then":{"properties":{"value":{"type":"boolean"}}}},{"if":{"properties":{"field":{"const":"dates"}}},"then":{"properties":{"value":{"oneOf":[{"type":"object","properties":{"mode":{"const":"exact"},"start":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"end":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"}},"required":["mode","start","end"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"window"},"earliest":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"latest":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"}},"required":["mode","earliest","latest"],"additionalProperties":false}]}}}},{"if":{"properties":{"field":{"const":"dates.flexibility_days"}}},"then":{"properties":{"value":{"type":"integer","minimum":0,"maximum":365}}}},{"if":{"properties":{"field":{"const":"origin"}}},"then":{"properties":{"value":{"type":"object","properties":{"places":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["places"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"destination"}}},"then":{"properties":{"value":{"oneOf":[{"type":"object","properties":{"mode":{"const":"open"}},"required":["mode"],"additionalProperties":false},{"type":"object","properties":{"mode":{"enum":["known","partial"]},"places":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","places"],"additionalProperties":false}]}}}},{"if":{"properties":{"field":{"const":"duration"}}},"then":{"properties":{"value":{"type":"object","properties":{"unit":{"enum":["days","nights"]},"min":{"type":"integer","minimum":1,"maximum":730},"max":{"type":"integer","minimum":1,"maximum":730}},"required":["unit","min","max"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"pace"}}},"then":{"properties":{"value":{"enum":["relaxed","balanced","active"]}}}},{"if":{"properties":{"field":{"const":"budget"}}},"then":{"properties":{"value":{"oneOf":[{"type":"object","properties":{"mode":{"const":"price_discovery"},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"target"},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"amount":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","currency","amount"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"maximum"},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"amount":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","currency","amount"],"additionalProperties":false},{"type":"object","properties":{"mode":{"const":"target_stretch"},"currency":{"type":"string","pattern":"^[A-Z]{3}$"},"amount":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"stretch":{"type":"number","minimum":0,"maximum":100000000,"multipleOf":0.01},"includes":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}},"required":["mode","currency","amount","stretch"],"additionalProperties":false}]}}}},{"if":{"properties":{"field":{"const":"interests"}}},"then":{"properties":{"value":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"flight.departure_window"}}},"then":{"properties":{"value":{"type":"object","properties":{"weekdays":{"type":"array","items":{"type":"integer","minimum":1,"maximum":7},"minItems":1,"maxItems":7,"uniqueItems":true},"local_date":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"min":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"max":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"time_zone":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"}},"required":[],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"flight.arrival_window"}}},"then":{"properties":{"value":{"type":"object","properties":{"weekdays":{"type":"array","items":{"type":"integer","minimum":1,"maximum":7},"minItems":1,"maxItems":7,"uniqueItems":true},"local_date":{"type":"string","pattern":"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$","format":"date"},"min":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"max":{"type":"string","pattern":"^([01][0-9]|2[0-3]):[0-5][0-9]$"},"time_zone":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"}},"required":[],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"flight.max_stops"}}},"then":{"properties":{"value":{"type":"integer","minimum":0,"maximum":5}}}},{"if":{"properties":{"field":{"const":"flight.max_duration_minutes"}}},"then":{"properties":{"value":{"type":"integer","minimum":1,"maximum":4320}}}},{"if":{"properties":{"field":{"const":"flight.alternative_airports"}}},"then":{"properties":{"value":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"flight.low_cost"}}},"then":{"properties":{"value":{"type":"boolean"}}}},{"if":{"properties":{"field":{"const":"baggage"}}},"then":{"properties":{"value":{"type":"object","properties":{"shared":{"type":"array","items":{"type":"object","properties":{"kind":{"enum":["personal","cabin","checked","other"]},"quantity":{"type":"integer","minimum":1,"maximum":20},"weight_kg":{"type":"number","exclusiveMinimum":0,"maximum":100},"note":{"type":"string","minLength":1,"maxLength":500,"pattern":"\\S"}},"required":["kind","quantity"],"additionalProperties":false},"minItems":1,"maxItems":30,"uniqueItems":true},"per_traveler":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":30,"additionalProperties":{"type":"array","items":{"type":"object","properties":{"kind":{"enum":["personal","cabin","checked","other"]},"quantity":{"type":"integer","minimum":1,"maximum":20},"weight_kg":{"type":"number","exclusiveMinimum":0,"maximum":100},"note":{"type":"string","minLength":1,"maxLength":500,"pattern":"\\S"}},"required":["kind","quantity"],"additionalProperties":false},"minItems":1,"maxItems":30,"uniqueItems":true}}},"required":[],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"hotel.comfort"}}},"then":{"properties":{"value":{"enum":["economic","comfortable","special"]}}}},{"if":{"properties":{"field":{"const":"hotel.location"}}},"then":{"properties":{"value":{"enum":["central","well_connected"]}}}},{"if":{"properties":{"field":{"const":"hotel.room"}}},"then":{"properties":{"value":{"type":"object","properties":{"type":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"},"rooms":{"type":"integer","minimum":1,"maximum":30},"occupancy":{"type":"integer","minimum":1,"maximum":60}},"required":["type"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"hotel.breakfast"}}},"then":{"properties":{"value":{"type":"boolean"}}}},{"if":{"properties":{"field":{"const":"hotel.cancellation"}}},"then":{"properties":{"value":{"enum":["free","refundable","non_refundable_acceptable"]}}}},{"if":{"properties":{"field":{"const":"hotel.amenities"}}},"then":{"properties":{"value":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80,"pattern":"\\S"},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"hotel.stars"}}},"then":{"properties":{"value":{"type":"integer","minimum":1,"maximum":5}}}},{"if":{"properties":{"field":{"const":"hotel.rating"}}},"then":{"properties":{"value":{"type":"object","properties":{"min":{"type":"number","minimum":0,"maximum":10},"scale":{"enum":[5,10]},"source":{"type":"string","minLength":1,"maxLength":100,"pattern":"\\S"}},"required":["min","scale","source"],"additionalProperties":false}}}},{"if":{"properties":{"field":{"const":"experience.styles"}}},"then":{"properties":{"value":{"type":"array","items":{"enum":["independent","audio_guide","guided_visit","organized_excursion","independent_excursion","combination"]},"minItems":1,"maxItems":30,"uniqueItems":true}}}},{"if":{"properties":{"field":{"const":"notes"}}},"then":{"properties":{"value":{"type":"string","minLength":1,"maxLength":2000,"pattern":"\\S"}}}},{"if":{"properties":{"field":{"pattern":"^custom\\."}}},"then":{"properties":{"value":{"type":"string","minLength":1,"maxLength":1000,"pattern":"\\S"}}}},{"if":{"properties":{"field":{"pattern":"^interest\\.free\\.[0-9a-f]{32}$"}}},"then":{"required":["label"],"properties":{"value":{"const":true}}},"else":{"not":{"required":["label"]}}}]}]}},"scopes":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":50,"additionalProperties":{"type":"object","properties":{"kind":{"enum":["destination","stay","component","leg"]},"parent":{"anyOf":[{"const":"global"},{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}]},"label":{"type":"string","minLength":1,"maxLength":120,"pattern":"\\S"}},"required":["kind","parent","label"],"additionalProperties":false}},"travelers":{"type":"object","propertyNames":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"maxProperties":30,"additionalProperties":{"type":"object","properties":{"kind":{"enum":["adult","child"]},"age":{"type":"integer","minimum":0,"maximum":17}},"required":["kind"],"additionalProperties":false}}},"required":["decisions","scopes","travelers"],"additionalProperties":false}$json$::json;
$schema$;

-- Same whitespace set as ECMAScript \s; normalize for equality only.
-- UTF8 and und-x-icu are explicit prerequisites, not silently substituted.
create function public.trip_brief_interest_label_key_v1(label text) returns text
language sql immutable strict set search_path = '' as $norm$
select lower(btrim(regexp_replace(normalize(label, NFKC),
  U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')) collate pg_catalog."und-x-icu");
$norm$;

-- Explicit catalog spellings only: no semantic/synonym inference.
create function public.trip_brief_interest_aliases_v1() returns jsonb
language sql immutable set search_path = '' as $aliases$
select $catalog${"interest.christmas":["christmas","nadal"],"interest.christmas_markets":["christmas markets","mercats de nadal"],"interest.snow":["snow","neu"],"interest.snow_activities":["snow activities","activitats de neu"],"interest.gastronomy":["gastronomy","gastronomia"],"interest.culture":["culture","cultura"],"interest.nature":["nature","natura"],"interest.spa_relaxation":["spa relaxation","relax / spa"],"interest.nightlife":["nightlife","nit / plans especials"],"interest.shopping":["shopping","compres"],"interest.special_places":["special places","llocs especials"]}$catalog$::jsonb;
$aliases$;

create or replace function public.trip_brief_valid_v1(doc jsonb) returns boolean
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
  -- TB-01.1: preserve every legacy invariant above; add family-level guards.
  if exists(select 1 from jsonb_each(doc->'decisions') d
    where d.value->>'field' like 'interest.%'
    group by d.value->>'scope' having count(*)>30) then return false; end if;
  for entry in select * from jsonb_each(doc->'decisions') loop
    if entry.value->>'field' like 'interest.free.%' then
      if public.trip_brief_interest_label_key_v1(entry.value->>'label')='' then return false; end if;
      -- One free-interest identity cannot acquire different labels by scope.
      if exists(select 1 from jsonb_each(doc->'decisions') d
        where d.value->>'field'=entry.value->>'field'
        and public.trip_brief_interest_label_key_v1(d.value->>'label')<>
            public.trip_brief_interest_label_key_v1(entry.value->>'label')) then return false; end if;
    end if;
    scope_id:=entry.value->>'scope';
    loop
      for other in select * from jsonb_each(doc->'decisions') d
        where d.value->>'scope'=scope_id and d.key<>entry.key loop
        -- Reject either direction of legacy/new along the same inheritance chain.
        if ((entry.value->>'field'='interests' and other.value->>'field' like 'interest.%')
          or (other.value->>'field'='interests' and entry.value->>'field' like 'interest.%')
          or (entry.value->>'field'='hotel.amenities' and other.value->>'field' like 'hotel.amenity.%')
          or (other.value->>'field'='hotel.amenities' and entry.value->>'field' like 'hotel.amenity.%')) then return false; end if;
        -- Distinct UUIDs must not launder duplicates or inherited hard interests.
        if entry.value->>'field' like 'interest.free.%' and other.value->>'field' like 'interest.free.%'
          and entry.value->>'field'<>other.value->>'field'
          and public.trip_brief_interest_label_key_v1(entry.value->>'label')=
              public.trip_brief_interest_label_key_v1(other.value->>'label') then return false; end if;
        if entry.value->>'field' like 'interest.free.%'
          and coalesce(public.trip_brief_interest_aliases_v1()->(other.value->>'field'),'[]'::jsonb)
            ? public.trip_brief_interest_label_key_v1(entry.value->>'label') then return false; end if;
        if other.value->>'field' like 'interest.free.%'
          and coalesce(public.trip_brief_interest_aliases_v1()->(entry.value->>'field'),'[]'::jsonb)
            ? public.trip_brief_interest_label_key_v1(other.value->>'label') then return false; end if;
      end loop;
      exit when scope_id='global';
      scope_id:=doc->'scopes'->scope_id->>'parent';
    end loop;
  end loop;

  return true;
exception when others then return false;
end;
$$;


revoke all on function public.trip_brief_interest_label_key_v1(text), public.trip_brief_interest_aliases_v1()
from public, anon, authenticated, service_role;

-- Validate compatibility without changing a document, timestamp or receipt.
do $$ begin
  if exists(select 1 from public.trip_briefs where not public.trip_brief_valid_v1(document)) then
    raise exception 'TB-01.1 compatibility check failed; no data was converted';
  end if;
end $$;
commit;

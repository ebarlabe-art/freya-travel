-- LOCAL ONLY. Owner isolation uses actual authenticated/anon roles; all rolled back.
begin;
create temporary table brief_fixture(a uuid default gen_random_uuid(),b uuid default gen_random_uuid(),brief uuid default gen_random_uuid(),op uuid default gen_random_uuid(),initial jsonb);
insert into brief_fixture(initial) values ('{
 "scopes":{"outbound":{"kind":"leg","parent":"global","label":"Anada"},"riga":{"kind":"destination","parent":"global","label":"Riga"}},
 "travelers":{"adult_a":{"kind":"adult"},"child_a":{"kind":"child","age":8}},
 "decisions":{
  "dates":{"field":"dates","scope":"global","origin":"explicit_user","knowledge":"unknown"},
  "destination":{"field":"destination","scope":"global","origin":"explicit_user","knowledge":"known","strength":"flexible","value":{"mode":"partial","places":["Bàltic"]}},
  "budget":{"field":"budget","scope":"global","origin":"explicit_user","knowledge":"known","strength":"preference","value":{"mode":"maximum","amount":2000,"currency":"EUR","includes":["flights","hotels"]}},
  "friday":{"field":"flight.departure_window","scope":"outbound","origin":"explicit_user","knowledge":"known","strength":"hard","value":{"weekdays":[5],"min":"18:00"}},
  "bags":{"field":"baggage","scope":"global","origin":"explicit_user","knowledge":"known","strength":"hard","value":{"per_traveler":{"adult_a":[{"kind":"cabin","quantity":1}]},"shared":[{"kind":"checked","quantity":1,"weight_kg":20}]}},
  "hotel":{"field":"hotel.comfort","scope":"global","origin":"explicit_user","knowledge":"known","strength":"preference","value":"comfortable"},
  "riga_hotel":{"field":"hotel.comfort","scope":"riga","origin":"explicit_user","knowledge":"known","strength":"preference","value":"special"},
  "spa":{"field":"hotel.amenities","scope":"riga","origin":"explicit_user","knowledge":"known","strength":"preference","value":["spa"]},
  "interests":{"field":"interests","scope":"global","origin":"explicit_user","knowledge":"known","strength":"preference","value":["ambient nadalenc","neu","gastronomia"]},
  "stops":{"field":"flight.max_stops","scope":"global","origin":"explicit_user","knowledge":"indifferent","strength":"flexible"}
 }}');
grant select on brief_fixture to authenticated;
create function pg_temp.assert_brief(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.reject_brief(brief uuid,rev bigint,patch jsonb,removals jsonb default '{}',confirmation text[] default '{}') returns void language plpgsql as $$
begin
 perform public.apply_trip_brief_patch_v1(brief,gen_random_uuid(),rev,patch,removals,confirmation);
 raise exception 'Invalid patch accepted: %',patch;
exception when invalid_parameter_value then null;
end; $$;
-- Snapshot all pre-existing operational rows, not just counts.
create temporary table operational_before(table_name text primary key,rows jsonb);
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename not in ('trip_briefs','trip_brief_operations') loop
  execute format('insert into operational_before select %L,coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]'') from public.%I x',t.tablename,t.tablename);
 end loop;
 insert into auth.users(id) select a from brief_fixture union all select b from brief_fixture;
 perform pg_temp.assert_brief(not has_table_privilege('authenticated','public.trip_briefs','INSERT,UPDATE,DELETE,TRUNCATE'),'no direct writes');
 perform pg_temp.assert_brief(not has_table_privilege('anon','public.trip_briefs','SELECT'),'anon cannot read');
 perform pg_temp.assert_brief(not has_table_privilege('authenticated','public.trip_brief_operations','SELECT,INSERT,UPDATE,DELETE'),'receipts private');
 perform pg_temp.assert_brief(not has_function_privilege('anon','public.apply_trip_brief_patch_v1(uuid,uuid,bigint,jsonb,jsonb,text[])','EXECUTE'),'anon cannot mutate');
 perform pg_temp.assert_brief(not exists(select 1 from pg_publication_tables where tablename in ('trip_briefs','trip_brief_operations')),'no Realtime');
end; $$;
set local role authenticated;
do $$ declare f brief_fixture; r jsonb; retry jsonb; before_doc jsonb; patch jsonb; oldhard jsonb; fresh_id uuid; op uuid; v bigint; begin
 select * into f from brief_fixture; perform set_config('request.jwt.claim.sub',f.a::text,true);
 r:=public.apply_trip_brief_patch_v1(f.brief,f.op,0,f.initial);
 perform pg_temp.assert_brief(r->'brief'->'document'=f.initial,'partial create roundtrip exact');
 perform pg_temp.assert_brief((select document=f.initial and revision=1 and trip_id is null and owner_id=f.a from public.trip_briefs where id=f.brief),'read resumes exact data');
 perform pg_temp.assert_brief(r->'brief'->'document'->'decisions'->'dates'->>'knowledge'='unknown','unknown preserved');
 perform pg_temp.assert_brief(r->'brief'->'document'->'decisions'->'stops'->>'knowledge'='indifferent','indifferent preserved');
 perform pg_temp.assert_brief(r->'brief'->'document'->'decisions'->'destination'->>'strength'='flexible','flexible preserved');
 retry:=public.apply_trip_brief_patch_v1(f.brief,f.op,0,f.initial);
 perform pg_temp.assert_brief(retry->>'replayed'='true' and retry->'brief'=r->'brief','lost create reply retry exact');
 before_doc:=f.initial;
 patch:=jsonb_build_object('decisions',jsonb_build_object('budget',jsonb_set(f.initial->'decisions'->'budget','{value,amount}','1800')));
 op:=gen_random_uuid(); r:=public.apply_trip_brief_patch_v1(f.brief,op,1,patch);
 perform pg_temp.assert_brief(r->'brief'->>'revision'='2','revision increments');
 perform pg_temp.assert_brief((r->'brief'->'document'#-'{decisions,budget}')=(before_doc#-'{decisions,budget}'),'budget-only patch preserves every other byte-semantic value');
 retry:=public.apply_trip_brief_patch_v1(f.brief,op,1,patch);
 perform pg_temp.assert_brief(retry->'brief'=r->'brief' and retry->>'replayed'='true','lost update reply no double revision');
 begin
  perform public.apply_trip_brief_patch_v1(f.brief,gen_random_uuid(),1,patch); raise exception 'Stale CAS accepted';
 exception when serialization_failure then null; end;
 perform pg_temp.reject_brief(f.brief,2,jsonb_build_object('decisions',jsonb_build_object('friday',jsonb_set(f.initial->'decisions'->'friday','{value,min}','"17:00"'))));
 perform pg_temp.reject_brief(f.brief,2,'{}','{"decisions":["friday"]}');
 perform pg_temp.reject_brief(f.brief,2,'{"decisions":{"budget":{"field":"budget","scope":"global","origin":"system_default","knowledge":"unknown"}}}');
 perform pg_temp.reject_brief(f.brief,2,'{"decisions":{"budget_new":{"field":"budget","scope":"global","origin":"interpreted_from_user","knowledge":"unknown"}}}','{"decisions":["budget"]}');
 perform pg_temp.reject_brief(f.brief,2,'{"decisions":{"friday":{"field":"flight.departure_window","scope":"global","origin":"explicit_user","knowledge":"known","strength":"hard","value":{"min":"18:00"}}}}','{}',array['friday']);
 perform pg_temp.reject_brief(f.brief,2,'{}','{"travelers":["adult_a"]}');
 perform pg_temp.reject_brief(f.brief,2,'{}','{"scopes":["outbound"]}','{friday,bags}');
 perform pg_temp.reject_brief(f.brief,2,'{"scopes":{"riga":{"kind":"destination","parent":"riga","label":"Cycle"}}}','{}','{friday,bags}');
 -- A scoped override cannot defeat an existing global hard.
 perform pg_temp.reject_brief(f.brief,2,'{"decisions":{"local_bags":{"field":"baggage","scope":"riga","origin":"explicit_user","knowledge":"indifferent","strength":"flexible"}}}');
 -- Explicit confirmation is tied to current revision and names the hard being edited.
 patch:=jsonb_build_object('decisions',jsonb_build_object('friday',jsonb_set(f.initial->'decisions'->'friday','{value,min}','"19:00"')));
 r:=public.apply_trip_brief_patch_v1(f.brief,gen_random_uuid(),2,patch,'{}',array['friday']);
 perform pg_temp.assert_brief(r->'brief'->'document'#>>'{decisions,friday,value,min}'='19:00','confirmed hard edit works');
 retry:=public.apply_trip_brief_patch_v1(f.brief,f.op,0,f.initial);
 perform pg_temp.assert_brief(retry->>'applied_revision'='1' and retry->'brief'->>'revision'='3' and retry->'brief'->'document'#>>'{decisions,friday,value,min}'='19:00','old retry returns current data without reverting later edits');
 begin perform public.apply_trip_brief_patch_v1(f.brief,f.op,0,'{}'); raise exception 'operation reused'; exception when invalid_parameter_value then null; end;
 -- No-null contract, typed values, no free JSON, no impossible date/time/range.
 for patch in select value from jsonb_array_elements('[
  {"decisions":{"bad":null}},
  {"extra":{}},
  {"decisions":{"bad":{"field":"dates","scope":"global","origin":"explicit_user","knowledge":"unknown","strength":"flexible"}}},
  {"decisions":{"bad":{"field":"pace","scope":"global","origin":"explicit_user","knowledge":"indifferent","strength":"preference","value":"active"}}},
  {"decisions":{"bad":{"field":"hotel.breakfast","scope":"global","origin":"explicit_user","knowledge":"known","strength":"hard","value":"yes"}}},
  {"decisions":{"bad":{"field":"not_a_field","scope":"global","origin":"explicit_user","knowledge":"unknown"}}},
  {"decisions":{"bad":{"field":"custom.foo","scope":"global","origin":"explicit_user","knowledge":"known","strength":"preference","value":{"anything":true}}}},
  {"decisions":{"dates":{"field":"dates","scope":"global","origin":"explicit_user","knowledge":"known","strength":"preference","value":{"mode":"exact","start":"2026-02-30","end":"2026-03-05"}}}},
  {"decisions":{"dates":{"field":"dates","scope":"global","origin":"explicit_user","knowledge":"known","strength":"preference","value":{"mode":"window","earliest":"2026-12-30","latest":"2026-12-01"}}}},
  {"decisions":{"bad":{"field":"flight.arrival_window","scope":"global","origin":"explicit_user","knowledge":"known","strength":"preference","value":{"min":"25:00"}}}},
  {"decisions":{"bad":{"field":"duration","scope":"global","origin":"explicit_user","knowledge":"known","strength":"preference","value":{"unit":"nights","min":8,"max":4}}}},
  {"decisions":{"bad":{"field":"hotel.stars","scope":"global","origin":"system_default","knowledge":"known","strength":"hard","value":4}}},
  {"travelers":{"adult_a":{"kind":"adult","name":"unnecessary"}}}
 ]') loop perform pg_temp.reject_brief(f.brief,3,patch); end loop;
 -- Duplicate semantic cell rejected even under another ID.
 perform pg_temp.reject_brief(f.brief,3,jsonb_build_object('decisions',jsonb_build_object('hotel_duplicate',f.initial->'decisions'->'hotel')));
 perform pg_temp.reject_brief(f.brief,3,'{}','{"decisions":["missing"]}');
 perform pg_temp.reject_brief(f.brief,3,'{"decisions":null}');
 perform pg_temp.reject_brief(f.brief,3,'{}','{}',array['budget']);
 perform pg_temp.assert_brief((select revision=3 from public.trip_briefs where id=f.brief),'all rejected commands rolled back');
 -- New unrelated scopes do not demand hard confirmations; reparenting does.
 fresh_id:=gen_random_uuid();r:=public.apply_trip_brief_patch_v1(fresh_id,gen_random_uuid(),0,f.initial);
 r:=public.apply_trip_brief_patch_v1(fresh_id,gen_random_uuid(),1,'{"scopes":{"tallinn":{"kind":"destination","parent":"global","label":"Tallinn"}}}');
 perform pg_temp.assert_brief(r->'brief'->'document'->'decisions'=f.initial->'decisions','new scope leaves every hard untouched');
 perform pg_temp.reject_brief(fresh_id,2,'{"scopes":{"outbound":{"kind":"leg","parent":"global","label":"Tornada"}}}');
 r:=public.apply_trip_brief_patch_v1(fresh_id,gen_random_uuid(),2,'{}','{"decisions":["friday"]}',array['friday']);
 perform pg_temp.assert_brief(not (r->'brief'->'document'->'decisions' ? 'friday'),'intentional confirmed hard removal');
 -- Fully unknown brief and date windows do not infer exact dates.
 fresh_id:=gen_random_uuid();r:=public.apply_trip_brief_patch_v1(fresh_id,gen_random_uuid(),0);
 perform pg_temp.assert_brief(r->'brief'->'document'='{"decisions":{},"scopes":{},"travelers":{}}','empty valid');
 r:=public.apply_trip_brief_patch_v1(fresh_id,gen_random_uuid(),1,'{"decisions":{"window":{"field":"dates","scope":"global","origin":"explicit_user","knowledge":"known","strength":"flexible","value":{"mode":"window","earliest":"2026-12-01","latest":"2026-12-31"}}}}');
 perform pg_temp.assert_brief(not (r->'brief'->'document'#>'{decisions,window,value}' ? 'start'),'no invented exact dates');
 -- Every budget mode can persist; unknown is knowledge, never zero.
 v:=2;
 for patch in select value from jsonb_array_elements('[{"mode":"price_discovery"},{"mode":"target","currency":"EUR","amount":1200},{"mode":"maximum","currency":"EUR","amount":1800},{"mode":"target_stretch","currency":"EUR","amount":1200,"stretch":200}]') loop
  r:=public.apply_trip_brief_patch_v1(fresh_id,gen_random_uuid(),v,jsonb_build_object('decisions',jsonb_build_object('budget',jsonb_build_object('field','budget','scope','global','origin','explicit_user','knowledge','known','strength','preference','value',patch))));v:=v+1;
 end loop;
 -- RLS: a second user has no read/mutation access, even knowing IDs/receipts.
 perform set_config('request.jwt.claim.sub',f.b::text,true);
 perform pg_temp.assert_brief((select count(*)=0 from public.trip_briefs),'B cannot read A');
 begin perform public.apply_trip_brief_patch_v1(f.brief,f.op,0,f.initial); raise exception 'B accessed A'; exception when insufficient_privilege then null; end;
 begin perform public.apply_trip_brief_patch_v1(f.brief,gen_random_uuid(),3); raise exception 'B edited A'; exception when insufficient_privilege then null; end;
 begin insert into public.trip_briefs(id,owner_id,document) values(gen_random_uuid(),f.b,'{}'); raise exception 'direct insert bypass'; exception when insufficient_privilege then null; end;
 begin update public.trip_briefs set revision=20; raise exception 'direct update bypass'; exception when insufficient_privilege then null; end;
 r:=public.apply_trip_brief_patch_v1(gen_random_uuid(),gen_random_uuid(),0);
 perform pg_temp.assert_brief(r->'brief'->>'owner_id'=f.b::text,'B can create own');
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.apply_trip_brief_patch_v1(gen_random_uuid(),gen_random_uuid(),0); raise exception 'unauthenticated mutation'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$ declare t record; after_rows jsonb; begin
 for t in select * from operational_before loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),''[]'') from public.%I x',t.table_name) into after_rows;
  perform pg_temp.assert_brief(after_rows=t.rows,'no side effects on '||t.table_name);
 end loop;
end; $$;
rollback;

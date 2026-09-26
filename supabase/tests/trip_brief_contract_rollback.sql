-- TB-01.1 local Red Team; all fixtures/mutations roll back.
begin;
create function pg_temp.check_contract(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'TB-01.1 FAIL: %',label; end if; end $$;
create function pg_temp.d(field text, strength text default 'preference', scope text default 'global') returns jsonb language sql as $$
select jsonb_build_object('field',field,'scope',scope,'origin','explicit_user','knowledge','known','strength',strength,'value',true) $$;
create function pg_temp.doc(decisions jsonb, scopes jsonb default '{}') returns jsonb language sql as $$
select jsonb_build_object('decisions',decisions,'scopes',scopes,'travelers','{}'::jsonb) $$;
create function pg_temp.valid(decisions jsonb, wanted boolean, label text, scopes jsonb default '{}') returns void language plpgsql as $$
begin perform pg_temp.check_contract(public.trip_brief_valid_v1(pg_temp.doc(decisions,scopes))=wanted,label); end $$;
create function pg_temp.rejected(id uuid,rev bigint,patch jsonb,removed jsonb default '{}',confirmed text[] default '{}') returns void language plpgsql as $$
begin
 perform public.apply_trip_brief_patch_v1(id,gen_random_uuid(),rev,patch,removed,confirmed);
 raise exception 'Invalid mutation accepted';
exception when invalid_parameter_value then null;
end $$;
do $$ declare field text; d jsonb; free1 jsonb; free2 jsonb; legacy jsonb; scopes jsonb; ds jsonb; i integer; strength text; begin
 for field in select jsonb_object_keys(public.trip_brief_interest_aliases_v1()) union all select unnest(array['hotel.amenity.spa','hotel.amenity.pool','hotel.amenity.parking','hotel.amenity.gym']) loop
   foreach strength in array array['hard','preference','flexible'] loop
     perform pg_temp.valid(jsonb_build_object('d',pg_temp.d(field,strength)),true,field||'/'||strength);
   end loop;
   d:=pg_temp.d(field);
   perform pg_temp.valid(jsonb_build_object('d',d||'{"value":false}'),false,'positive interest/amenity only');
   perform pg_temp.valid(jsonb_build_object('d',(d-'value')||'{"knowledge":"indifferent"}'),true,'indifferent has no value');
   perform pg_temp.valid(jsonb_build_object('d',(d-'value'-'strength')||'{"knowledge":"unknown"}'),true,'unknown has no strength/value');
   perform pg_temp.valid(jsonb_build_object('d',d||'{"label":"Injected"}'),false,'label only on free family');
 end loop;
 d:=pg_temp.d('destination.multidestination');
 perform pg_temp.valid(jsonb_build_object('multi',d),true,'multidestination true');
 perform pg_temp.valid(jsonb_build_object('multi',d||'{"value":false}'),true,'multidestination false');
 perform pg_temp.valid(jsonb_build_object('multi',(d-'value')||'{"knowledge":"indifferent"}'),true,'multidestination indifferent');
 perform pg_temp.valid(jsonb_build_object('multi',(d-'value'-'strength')||'{"knowledge":"unknown"}'),true,'multidestination unknown');
 perform pg_temp.valid(jsonb_build_object('multi',d||'{"knowledge":"indifferent"}'),false,'indifferent forbids value');
 perform pg_temp.valid(jsonb_build_object('multi',(d-'value')||'{"knowledge":"unknown"}'),false,'unknown forbids strength');
 perform pg_temp.valid(jsonb_build_object('multi',d||'{"value":"indifferent"}'),false,'no string encoding');
 perform pg_temp.valid(jsonb_build_object('a',pg_temp.d('interest.christmas_markets','hard'),'b',pg_temp.d('interest.snow'),'c',pg_temp.d('interest.gastronomy','flexible')),true,'independent mixed strengths');
 perform pg_temp.valid(jsonb_build_object('a',pg_temp.d('hotel.amenity.spa','hard'),'b',pg_temp.d('hotel.amenity.pool'),'c',(pg_temp.d('hotel.comfort')-'value')||'{"knowledge":"indifferent"}'),true,'hotel indifferent plus spa hard');
 perform pg_temp.valid(jsonb_build_object('x',pg_temp.d('interest.unknown_catalog')),false,'closed known catalog');
 perform pg_temp.valid(jsonb_build_object('x',pg_temp.d('hotel.amenity.unknown')),false,'closed amenity catalog');
 free1:=pg_temp.d('interest.free.11111111111141118111111111111111')||'{"label":"  Fotografia  NOCTURNA  "}';
 free2:=pg_temp.d('interest.free.22222222222242228222222222222222')||'{"label":"fotografia nocturna"}';
 perform pg_temp.valid(jsonb_build_object('x',free1),true,'raw label accepted');
 perform pg_temp.valid(jsonb_build_object('x',free1-'label'),false,'label required');
 perform pg_temp.valid(jsonb_build_object('x',free1||jsonb_build_object('label',repeat('😀',80))),true,'80 codepoints accepted');
 perform pg_temp.valid(jsonb_build_object('x',free1||jsonb_build_object('label',repeat('x',81))),false,'81 rejected');
 perform pg_temp.valid(jsonb_build_object('x',free1||jsonb_build_object('label',U&' \FEFF ')),false,'normalized blank rejected');
 perform pg_temp.valid(jsonb_build_object('x',free1||'{"field":"interest.free.user_text"}'),false,'unsafe field rejected');
 perform pg_temp.valid(jsonb_build_object('x',free1-'value'-'strength'||'{"knowledge":"unknown"}'),true,'unknown keeps identity label');
 perform pg_temp.valid(jsonb_build_object('x',free1-'value'||'{"knowledge":"indifferent"}'),true,'indifferent keeps identity label');
 perform pg_temp.valid(jsonb_build_object('a',free1,'b',free2),false,'duplicate case and spaces');
 perform pg_temp.valid(jsonb_build_object('a',free1||'{"label":"Ｎｅｕ"}','b',pg_temp.d('interest.snow')),false,'explicit catalog duplicate');
 perform pg_temp.valid(jsonb_build_object('a',free1||'{"label":"Café"}','b',free2||'{"label":"CAFÉ"}'),false,'unicode equivalence');
 perform pg_temp.valid(jsonb_build_object('a',free1||'{"label":"cafe"}','b',free2||'{"label":"café"}'),true,'accents not discarded');
 perform pg_temp.valid(jsonb_build_object('a',free1||'{"label":"snow sports"}','b',pg_temp.d('interest.snow_activities')),true,'no synonym inference');
 perform pg_temp.check_contract(public.trip_brief_interest_label_key_v1(U&'A\FEFFB')='a b','JS whitespace parity');
 perform pg_temp.check_contract(public.trip_brief_interest_label_key_v1('İ')=U&'i\0307','unicode lowercase parity');
 perform pg_temp.check_contract(public.trip_brief_interest_label_key_v1('ΟΣ')='ος','contextual unicode lowercase parity');
 scopes:='{"city":{"kind":"destination","parent":"global","label":"City"},"other":{"kind":"destination","parent":"global","label":"Other"},"stay":{"kind":"stay","parent":"city","label":"Stay"}}';
 foreach field in array array['interests','hotel.amenities'] loop
   legacy:=pg_temp.d(field,'hard')||jsonb_build_object('value',jsonb_build_array('legacy text'));
   d:=pg_temp.d(case when field='interests' then 'interest.snow' else 'hotel.amenity.spa' end);
   perform pg_temp.valid(jsonb_build_object('old',legacy),true,'legacy remains valid');
   perform pg_temp.valid(jsonb_build_object('old',legacy,'new',d),false,'same scope legacy/new');
   perform pg_temp.valid(jsonb_build_object('old',legacy,'new',d||'{"scope":"stay"}'),false,'legacy ancestor',scopes);
   perform pg_temp.valid(jsonb_build_object('old',legacy||'{"scope":"stay"}','new',d),false,'legacy descendant',scopes);
   perform pg_temp.valid(jsonb_build_object('old',legacy||'{"scope":"city"}','new',d||'{"scope":"other"}'),true,'independent siblings',scopes);
 end loop;
 perform pg_temp.valid(jsonb_build_object('old',free1||'{"strength":"hard"}','new',free2||'{"scope":"stay"}'),false,'new UUID cannot shadow hard ancestor',scopes);
 perform pg_temp.valid(jsonb_build_object('old',free1,'new',free2||'{"scope":"stay"}'),false,'duplicate across chain even soft',scopes);
 perform pg_temp.valid(jsonb_build_object('old',free1||'{"scope":"city"}','new',free2||'{"scope":"other"}'),true,'free labels in independent siblings',scopes);
 perform pg_temp.valid(jsonb_build_object('old',free1,'new',free1||'{"scope":"stay","label":"Different"}'),false,'identity cannot change meaning by scope',scopes);
 perform pg_temp.valid(jsonb_build_object('old',pg_temp.d('interest.snow','hard'),'new',pg_temp.d('interest.snow','preference','city')),false,'native hard inheritance',scopes);
 perform pg_temp.valid(jsonb_build_object('x',pg_temp.d('interest.snow','hard')||'{"origin":"interpreted_from_user"}'),false,'AI cannot be hard');
 ds:='{}';
 for i in 1..31 loop
   ds:=ds||jsonb_build_object('i'||i,pg_temp.d('interest.free.'||lpad(to_hex(i),32,'0'))||jsonb_build_object('label','Interest '||i));
   if i=30 then perform pg_temp.valid(ds,true,'30 interests'); end if;
 end loop;
 perform pg_temp.valid(ds,false,'31 interests rejected');
 ds:='{}';for i in 1..201 loop ds:=ds||jsonb_build_object('d'||i,pg_temp.d('custom.x'||i)||'{"value":"x"}');end loop;
 perform pg_temp.valid(ds-'d201',true,'200 decisions preserved');perform pg_temp.valid(ds,false,'201 rejected');
 ds:='{}';for i in 1..140 loop ds:=ds||jsonb_build_object('d'||i,pg_temp.d('custom.x'||i)||jsonb_build_object('value',repeat('x',1000)));end loop;
 perform pg_temp.valid(ds,false,'128 KiB document bound');
end $$;

create temporary table contract_fixture(owner uuid default gen_random_uuid(),other_owner uuid default gen_random_uuid(),brief uuid default gen_random_uuid(),op uuid default gen_random_uuid());
insert into contract_fixture default values;
insert into auth.users(id) select owner from contract_fixture union all select other_owner from contract_fixture;
grant select on contract_fixture to authenticated;
set local role authenticated;
do $$ declare f contract_fixture; r jsonb; replay jsonb; doc jsonb; patch jsonb; before_hard jsonb; legacy_id uuid; begin
 select * into f from contract_fixture;perform set_config('request.jwt.claim.sub',f.owner::text,true);
 patch:=jsonb_build_object('decisions',jsonb_build_object('hard',pg_temp.d('interest.christmas_markets','hard'),'snow',pg_temp.d('interest.snow'),'spa',pg_temp.d('hotel.amenity.spa','hard')));
 r:=public.apply_trip_brief_patch_v1(f.brief,f.op,0,patch);before_hard:=r#>'{brief,document,decisions,hard}';
 perform pg_temp.check_contract((r#>>'{brief,schema_version}')::int=1,'schema stays v1');
 r:=public.apply_trip_brief_patch_v1(f.brief,gen_random_uuid(),1,jsonb_build_object('decisions',jsonb_build_object('snow',pg_temp.d('interest.snow','flexible'))));
 perform pg_temp.check_contract(r#>'{brief,document,decisions,hard}'=before_hard,'unrelated hard intact');
 r:=public.apply_trip_brief_patch_v1(f.brief,gen_random_uuid(),2,'{}','{"decisions":["snow"]}');
 perform pg_temp.check_contract(not (r#>'{brief,document,decisions}' ? 'snow') and r#>'{brief,document,decisions,hard}'=before_hard,'remove only selected interest');
 perform pg_temp.rejected(f.brief,3,'{}','{"decisions":["hard"]}');
 perform pg_temp.rejected(f.brief,3,jsonb_build_object('decisions',jsonb_build_object('hard',pg_temp.d('interest.christmas_markets','preference'))));
 r:=public.apply_trip_brief_patch_v1(f.brief,gen_random_uuid(),3,jsonb_build_object('decisions',jsonb_build_object('hard',pg_temp.d('interest.christmas_markets','flexible'))),'{}',array['hard']);
 replay:=public.apply_trip_brief_patch_v1(f.brief,f.op,0,patch);
 perform pg_temp.check_contract((replay->>'replayed')::boolean and replay->'brief'=r->'brief','old create retry returns current row');
 begin perform public.apply_trip_brief_patch_v1(f.brief,gen_random_uuid(),3);raise exception 'stale CAS accepted';exception when serialization_failure then null;end;
 doc:=r#>'{brief,document}';
 perform pg_temp.rejected(f.brief,4,jsonb_build_object('decisions',jsonb_build_object('spa',pg_temp.d('hotel.amenity.spa','preference'))));
 perform pg_temp.check_contract((select document from public.trip_briefs where id=f.brief)=doc,'rejection atomic');
 -- Free label is never normalized in storage; hard label edits require confirmation.
 patch:=jsonb_build_object('decisions',jsonb_build_object('free',pg_temp.d('interest.free.11111111111141118111111111111111','hard')||'{"label":"  Fotografia NOCTURNA  "}'));
 r:=public.apply_trip_brief_patch_v1(f.brief,gen_random_uuid(),4,patch);
 perform pg_temp.check_contract(r#>>'{brief,document,decisions,free,label}'='  Fotografia NOCTURNA  ','label preserved exactly');
 perform pg_temp.rejected(f.brief,5,jsonb_set(patch,'{decisions,free,label}','"New label"'));
 -- Legacy rows remain editable, and only explicit confirmed atomic conversion works.
 legacy_id:=gen_random_uuid();patch:=jsonb_build_object('decisions',jsonb_build_object('legacy',pg_temp.d('interests','hard')||'{"value":["Neu"]}'));
 r:=public.apply_trip_brief_patch_v1(legacy_id,gen_random_uuid(),0,patch);
 r:=public.apply_trip_brief_patch_v1(legacy_id,gen_random_uuid(),1,'{"decisions":{"note":{"field":"notes","scope":"global","origin":"explicit_user","knowledge":"known","strength":"preference","value":"Text"}}}');
 perform pg_temp.check_contract(r#>>'{brief,document,decisions,legacy,strength}'='hard','legacy hard preserved by notes edit');
 patch:=jsonb_build_object('decisions',jsonb_build_object('legacy',pg_temp.d('interests','hard')||'{"value":["Neu","Gastronomia"]}'));
 perform pg_temp.rejected(legacy_id,2,patch);
 r:=public.apply_trip_brief_patch_v1(legacy_id,gen_random_uuid(),2,patch,'{}',array['legacy']);
 perform pg_temp.check_contract(r#>'{brief,document,decisions,legacy,value}'='["Neu","Gastronomia"]'::jsonb and r#>>'{brief,document,decisions,legacy,strength}'='hard','legacy remains explicitly editable without loss');
 patch:=jsonb_build_object('decisions',jsonb_build_object('snow',pg_temp.d('interest.snow','hard')));
 perform pg_temp.rejected(legacy_id,3,patch);perform pg_temp.rejected(legacy_id,3,patch,'{"decisions":["legacy"]}');
 r:=public.apply_trip_brief_patch_v1(legacy_id,gen_random_uuid(),3,patch,'{"decisions":["legacy"]}',array['legacy']);
 perform pg_temp.check_contract(r#>>'{brief,document,decisions,snow,strength}'='hard' and not (r#>'{brief,document,decisions}' ? 'legacy'),'explicit atomic conversion only');
 -- New fields use the unchanged ownership boundary.
 perform set_config('request.jwt.claim.sub',f.other_owner::text,true);
 perform pg_temp.check_contract((select count(*)=0 from public.trip_briefs),'new fields owner-only RLS');
 begin perform public.apply_trip_brief_patch_v1(f.brief,gen_random_uuid(),5,patch);raise exception 'ownership bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 perform pg_temp.check_contract(not has_function_privilege('authenticated','public.trip_brief_interest_label_key_v1(text)','EXECUTE'),'normalizer private');
 perform pg_temp.check_contract(not has_function_privilege('anon','public.trip_brief_interest_aliases_v1()','EXECUTE'),'catalog helper private');
 perform pg_temp.check_contract(not has_table_privilege('authenticated','public.trip_brief_operations','SELECT,INSERT,UPDATE,DELETE'),'receipts private');
end $$;
rollback;

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {interestCatalog,hotelAmenityCatalog,freeInterestPattern,createFreeInterest,normalizeInterestLabel,briefSchemaV1,valueSchemas,resolveBriefDecision,prepareBriefPatch} from '../domain/trip-brief.mjs';
const old=JSON.parse(readFileSync(new URL('../supabase/migrations/20260925190440_trip_briefs_v1.sql',import.meta.url),'utf8').split('$json$')[1]);
test('all historic value schemas and document limits remain unchanged',()=>{
 for(const rule of old.properties.decisions.additionalProperties.oneOf[2].allOf){const field=rule.if.properties.field.const;if(field)assert.deepEqual(valueSchemas[field],rule.then.properties.value)}
 for(const key of ['decisions','scopes','travelers'])assert.equal(briefSchemaV1.properties[key].maxProperties,old.properties[key].maxProperties);
});
test('explicit catalog: 11 independent interests, 4 amenities, boolean multidestination',()=>{
 assert.equal(Object.keys(interestCatalog).length,11);assert.equal(Object.keys(hotelAmenityCatalog).length,4);
 for(const f of [...Object.keys(interestCatalog).map(k=>'interest.'+k),...Object.keys(hotelAmenityCatalog).map(k=>'hotel.amenity.'+k)])assert.deepEqual(valueSchemas[f],{const:true});
 assert.deepEqual(valueSchemas['destination.multidestination'],{type:'boolean'});
});
test('free IDs are random, text-independent; raw label retained, no silent merge',()=>{
 const label='  Fotografia  NOCTURNA  ',a=createFreeInterest(label),b=createFreeInterest(label);
 assert.notEqual(a.field,b.field);assert.match(a.field,new RegExp(freeInterestPattern));assert.equal(a.label,label);assert.equal(a.value,true);assert.equal(a.strength,'preference');
});
test('normalization handles compatibility, case, accents, whitespace; never synonyms',()=>{
 for(const [a,b] of [[' ＮＥＵ\u00a0','neu'],['Cafe\u0301','CAFÉ'],['A\uFEFFB','a b'],['İ','i\u0307'],['ΟΣ','ος']])assert.equal(normalizeInterestLabel(a),normalizeInterestLabel(b));
 assert.notEqual(normalizeInterestLabel('cafe'),normalizeInterestLabel('café'));assert.notEqual(normalizeInterestLabel('Neu'),normalizeInterestLabel('Snow'));
});
test('free labels: 80 Unicode codepoints, mandatory nonblank, valid strength',()=>{
 assert.equal([...createFreeInterest('😀'.repeat(80)).label].length,80);
 for(const label of ['', ' \uFEFF ', 'a'.repeat(81), null])assert.throws(()=>createFreeInterest(label));
 assert.throws(()=>createFreeInterest('x',{strength:'invented'}));
});
test('independent strengths and partial patches do not mutate or delete other hard interests',()=>{
 const hard={field:'interest.christmas_markets',scope:'global',origin:'explicit_user',knowledge:'known',strength:'hard',value:true};
 const soft={...hard,field:'interest.snow',strength:'preference'};const document={decisions:{hard,soft},scopes:{},travelers:{}};
 const before=structuredClone(document),command=prepareBriefPatch({expectedRevision:5,set:{decisions:{soft:{...soft,strength:'flexible'}}}});
 assert.equal(command.p_expected_revision,5);assert.deepEqual(Object.keys(command.p_set.decisions),['soft']);assert.deepEqual(document,before);assert.equal(resolveBriefDecision(document,'interest.christmas_markets').decision.strength,'hard');
});
test('labels belong only to free fields for all knowledge branches',()=>{
 for(const variant of briefSchemaV1.properties.decisions.additionalProperties.oneOf){const guard=variant.allOf.at(-1);assert.equal(guard.if.properties.field.pattern,freeInterestPattern);assert.deepEqual(guard.then.required,['label']);assert.deepEqual(guard.else,{not:{required:['label']}});assert.ok(!variant.required.includes('label'))}
});
test('SQL duplicate catalog has exactly the explicit spellings from JS',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20260926195848_trip_brief_contract_v1_1.sql',import.meta.url),'utf8');
 const aliases=JSON.parse(sql.split('$catalog$')[1]);
 assert.deepEqual(aliases,Object.fromEntries(Object.entries(interestCatalog).map(([key,label])=>['interest.'+key,[normalizeInterestLabel(key.replaceAll('_',' ')),normalizeInterestLabel(label)]])));
 assert.doesNotMatch(sql,/create or replace function public.apply_trip_brief_patch_v1|update public.trip_briefs|update public.trip_brief_operations|alter table public.trip_briefs/i);
});

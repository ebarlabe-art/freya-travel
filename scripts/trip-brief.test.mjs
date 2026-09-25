import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { briefSchemaV1, emptyBriefDocument, resolveBriefDecision, prepareBriefPatch, applyBriefPatch, readBrief } from '../domain/trip-brief.mjs';
const decision = (scope, value, origin = 'explicit_user') => ({ field: 'hotel.comfort', scope, origin, knowledge: 'known', strength: 'preference', value });
test('schema in migration is the frozen version of the domain contract', () => {
 const sql = readFileSync(new URL('../supabase/migrations/20260925190440_trip_briefs_v1.sql',import.meta.url),'utf8');
 assert.deepEqual(JSON.parse(sql.split('$json$')[1]), briefSchemaV1);
});
test('scope overrides preserve global defaults; nearest explicit wins', () => {
 const doc = emptyBriefDocument(); doc.scopes.riga = { kind:'destination', parent:'global', label:'Riga' };
 doc.scopes.hotel = { kind:'component', parent:'riga', label:'Hotel' };
 doc.decisions.global = decision('global','comfortable'); doc.decisions.riga = decision('riga','special');
 const before = structuredClone(doc);
 assert.equal(resolveBriefDecision(doc,'hotel.comfort').decision.value,'comfortable');
 assert.equal(resolveBriefDecision(doc,'hotel.comfort','hotel').decision.value,'special');
 assert.deepEqual(doc,before);
});
test('interpretation cannot shadow explicit ancestor; remains unconfirmed alone', () => {
 const doc = emptyBriefDocument();doc.scopes.riga={kind:'destination',parent:'global',label:'Riga'};
 doc.decisions.global=decision('global','comfortable');doc.decisions.riga=decision('riga','special','interpreted_from_user');
 assert.equal(resolveBriefDecision(doc,'hotel.comfort','riga').id,'global');
 delete doc.decisions.global;assert.equal(resolveBriefDecision(doc,'hotel.comfort','riga').requiresConfirmation,true);
});
test('unknown, flexible and indifferent have distinct roundtrip semantics', () => {
 const doc = emptyBriefDocument(); doc.decisions.unknown={field:'dates',scope:'global',origin:'explicit_user',knowledge:'unknown'};
 doc.decisions.flex={field:'destination',scope:'global',origin:'explicit_user',knowledge:'known',strength:'flexible',value:{mode:'open'}};
 doc.decisions.indifferent={field:'flight.max_stops',scope:'global',origin:'explicit_user',knowledge:'indifferent',strength:'preference'};
 const loaded=JSON.parse(JSON.stringify(doc));assert.deepEqual(loaded,doc);
 assert.equal(resolveBriefDecision(loaded,'dates').decision.strength,undefined);
 assert.equal(resolveBriefDecision(loaded,'destination').decision.knowledge,'known');
 assert.equal(resolveBriefDecision(loaded,'flight.max_stops').decision.value,undefined);
});
test('prepared partial command survives restart/retry unchanged; caller mutation cannot change snapshot', async () => {
 const set={decisions:{budget:{field:'budget'}}}; const command=prepareBriefPatch({expectedRevision:5,set});set.decisions.budget.field='dates';
 const restored=JSON.parse(JSON.stringify(command));const calls=[];
 const client={rpc:async(name,payload)=>{calls.push({name,payload});if(calls.length===1)throw Error('lost response');return {data:{brief:{revision:6},replayed:true,applied_revision:6}}}};
 await assert.rejects(applyBriefPatch(client,command),/lost response/);
 const result=await applyBriefPatch(client,restored);assert.equal(result.replayed,true);assert.deepEqual(calls[0],calls[1]);
 assert.equal(command.p_set.decisions.budget.field,'budget');assert.deepEqual(Object.keys(command.p_set),['decisions']);
});
test('CAS conflict stays explicit, no automatic rebase or new operation', async () => {
 let count=0;await assert.rejects(applyBriefPatch({rpc:async()=>{count++;return {error:{message:'reload',code:'40001'}}}},prepareBriefPatch()),{code:'40001'});assert.equal(count,1);
});
test('read uses owner-protected canonical table and returns exact document', async () => {
 const expected={id:'brief',revision:7,document:emptyBriefDocument()};
 const query={select:s=>{assert.equal(s,'*');return query},eq:(column,id)=>{assert.equal(column,'id');assert.equal(id,'brief');return query},maybeSingle:async()=>({data:expected})};
 const row=await readBrief({from:table=>{assert.equal(table,'trip_briefs');return query}},'brief');assert.deepEqual(row,expected);
});

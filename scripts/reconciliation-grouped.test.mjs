import test from 'node:test';import assert from 'node:assert/strict';
import {suggestedReconciliationTarget as target} from '../domain/import-itinerary-reconciliation-ui.mjs';
import {initialPlanningDecisions as initial,refreshAutomaticDecisions as refresh} from '../domain/import-itinerary-planning-ui.mjs';
const old={id:'14000000-0000-4000-8000-000000000001',title:'Catedral de Riga',city:'Riga',location_name:'Catedral de Riga',localDate:'2030-12-27',starts_at:'2030-12-27T10:00Z',ends_at:'2030-12-27T11:00Z',time_zone:'UTC',timing_kind:'exact',status:'planned',is_fixed:false,photo_count:0,link_count:0};
const item=(n,title='Riga Cathedral',values={},extra={})=>({source_order:n,included:true,classification_hint:'manual',review_flags:[],source_warnings:[],values:{title,city:'Riga',location_name:title,local_date:'2030-12-27',start_local_time:'10:00',end_local_time:'11:00',time_zone:'UTC',...values},...extra});
const state=(decisions=[],extra={})=>({existing:[old],decisions,retire:[],...extra});
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};
const keep={source_order:0,action:'keep',target_id:old.id,automatic:true};

test('A-03 target: explicit actions, zero/ambiguous matches and every protected field',()=>{
 const i=freeze(item(0));
 for(const action of [undefined,null,'add','skip','review','UPDATE'])assert.equal(target(i,[old],action),null);
 assert.equal(target(i,[],'keep'),null);
 assert.equal(target(i,[old,{...old,id:'second'}],'keep'),null);
 assert.equal(target(i,[old],'update'),old.id);
 for(const patch of [{status:'completed'},{status:'cancelled'},{status:undefined},{is_fixed:true},{photo_count:1},{link_count:1},{photo_count:'0'}]){
  const rows=freeze([{...old,...patch}]);assert.equal(target(i,rows,'update'),null);assert.equal(target(i,rows,'keep'),old.id);
 }
 assert.equal(target(i,[{...old,photo_count:0,link_count:0}],'update'),old.id);
});
test('A-03 target: date conflicts, missing identity and original error contract',()=>{
 const i=item(0,'Arribada a l’apartament',{local_date:'2030-12-28',start_local_time:'00:15'});
 assert.equal(target(i,[{...old,title:i.values.title,timeLabel:'00:15'}],'keep'),old.id);
 assert.equal(target(item(0),[{...old,city:'Tallinn'}],'update'),null);
 assert.equal(target(item(0),[{...old,id:undefined}],'keep'),undefined);
 assert.equal(target(null,null,'add'),null);
 assert.throws(()=>target(null,[old],'keep'),TypeError);
});
test('A-03 initial: KEEP precedes ADD, original decisions/exclusions survive without mutation',()=>{
 const snapshot=freeze({items:[item(1,'Parc Bastejkalna'),item(0),item(2,'Passeig nou',{}, {included:false}),item(3,'Museu nou')]});
 const s=freeze(state([{source_order:3,action:'skip'}]));const before=JSON.stringify([snapshot,s]);
 assert.deepEqual(initial(snapshot,s),[keep,{source_order:1,action:'add'}]);
 assert.equal(JSON.stringify([snapshot,s]),before);
 assert.deepEqual(initial({items:[]},state()),[]);
});
test('A-03 initial: classification/unified warnings and overlap preprocessing stay distinct',()=>{
 for(const unified of [false,true]){
  const snapshot=freeze({items:[item(1,'Nova visita',{}, {review_flags:['uncertain_extraction']}),item(2,'Altra visita',{}, {source_warnings:['literal warning']}),item(3,'Passeig parc',{}, {review_flags:['possible_overlap_in_review']}),item(4,'Transport',{}, {classification_hint:'flight'})]});
  const s=freeze(state([], {unified}));
  assert.deepEqual(initial(snapshot,s),unified?[{source_order:3,action:'add'}]:[1,2,3].map(source_order=>({source_order,action:'add'})));
  assert.deepEqual(snapshot.items[2].review_flags,['possible_overlap_in_review']);
 }
});
test('A-03 refresh: preserve manual decisions/order, revalidate only previous automatic orders',()=>{
 const manual={source_order:2,action:'skip'};
 const snapshot=freeze({items:[item(0),item(2,'Passeig nou'),item(3,'Altra visita',{}, {included:false})]});
 const s=freeze(state([keep,manual,{source_order:3,action:'keep'},{source_order:99,action:'skip'}]));
 const result=refresh(snapshot,s);assert.deepEqual(result,[manual,keep]);
 assert.equal(result[0],manual,'preserve existing reference contract for manual decisions');
 assert.notEqual(result,s.decisions);
 assert.deepEqual(refresh({items:[item(0)]},state()),[],'do not introduce new automatic decisions');
 assert.deepEqual(refresh({items:[item(0,'Riga Cathedral',{notes:'Canvi'})]},state([keep])),[]);
 assert.deepEqual(refresh({items:[item(0,undefined,{}, {included:false})]},state([keep])),[]);
 assert.deepEqual(refresh({items:[item(0)]},state([keep],{existing:[old,{...old,id:'second'}]})),[]);
});
test('A-03 planning helpers preserve required-input errors',()=>{
 assert.throws(()=>initial({items:[item(0)]},{existing:[old]}),TypeError);
 assert.throws(()=>refresh({},state([keep])),TypeError);
});

test('A-03 compatible exports share implementations; domain has no UI dependency and assets exist',async()=>{
 const reconciliation=await import('../domain/import-itinerary-reconciliation.mjs');
 const planning=await import('../domain/import-itinerary-planning.mjs');
 assert.equal(reconciliation.suggestedReconciliationTarget,target);
 assert.equal(planning.initialPlanningDecisions,initial);assert.equal(planning.refreshAutomaticDecisions,refresh);
 const {readFile}=await import('node:fs/promises');const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
 for(const module of ['import-itinerary-planning.mjs','import-itinerary-reconciliation.mjs'])
  assert.doesNotMatch(await read('domain/'+module),/from ['"][^'"]*-ui\.mjs['"]/);
 for(const name of ['import-itinerary-planning.mjs','import-itinerary-planning-ui.mjs','import-itinerary-reconciliation.mjs','import-itinerary-reconciliation-ui.mjs']){
  assert.ok((await read('scripts/package-pages.mjs')).includes("'"+name+"'"));
  assert.ok((await read('sw.js')).includes("'./domain/"+name+"'"));
 }
});

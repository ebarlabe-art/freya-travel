import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeUnmatchedReconciliationDecisions as propose} from '../domain/import-itinerary-reconciliation-ui.mjs';
import {initialPlanningDecisions} from '../domain/import-itinerary-planning-ui.mjs';
import {prepareFlashDecisions} from '../domain/import-itinerary-flash.mjs';
const blocked=['invalid_title','invalid_date','invalid_start_time','invalid_end_time','invalid_time_zone','timezone_needs_confirmation','date_required_for_time','time_order_needs_review','possible_duplicate_in_review','possible_overlap_in_review'];
const item=(source_order,values={},extra={})=>({source_order,included:true,classification_hint:'manual',review_flags:[],values:{title:'Passeig pel parc Bastejkalna',local_date:'2030-12-28',start_local_time:'10:00',...values},...extra});
const state=(existing=[],decisions=[])=>({existing,decisions,retire:[]});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
const add=n=>({source_order:n,action:'add'});

test('A-02 eligibility preserves every blocking review flag and accepts informational flags',()=>{
 for(const flag of blocked)assert.deepEqual(propose({items:[item(0,{}, {review_flags:[flag]})]},state()),[],flag);
 for(const flags of [undefined,null,[],['uncertain_extraction'],['informational_only']])
  assert.deepEqual(propose({items:[item(0,{}, {review_flags:flags})]},state()),[add(0)]);
});
test('A-02 eligibility preserves excluded, missing and whitespace fields without extra validation',()=>{
 for(const values of [{title:''},{title:' \n '},{title:null},{title:undefined},{local_date:''},{local_date:null},{local_date:undefined}])
  assert.deepEqual(propose({items:[item(0,values)]},state()),[]);
 assert.deepEqual(propose({items:[item(0,{}, {included:false})]},state()),[]);
 for(const included of [undefined,null,0,true])assert.deepEqual(propose({items:[item(0,{}, {included})]},state()),[add(0)]);
 // This shortcut consumes upstream validation flags; it is not another validator.
 assert.deepEqual(propose({items:[item(0,{local_date:'pending',start_local_time:''})]},state()),[add(0)]);
});
test('A-02 any existing decision excludes the exact source_order; missing decisions is supported',()=>{
 for(const action of ['add','update','keep','skip','review'])assert.deepEqual(propose({items:[item(0)]},state([],[{source_order:0,action}])),[]);
 assert.deepEqual(propose({items:[item(0)]},{existing:[]}),[add(0)]);
 assert.deepEqual(propose({items:[item(0)]},state([],[{source_order:'0',action:'skip'}])),[add(0)]);
});
test('A-02 exact, ambiguous, rescheduled and midnight matches never become automatic ADD',()=>{
 const old={id:'existing',title:'Catedral de Riga',localDate:'2030-12-27',timeLabel:'10:00',status:'planned'};
 for(const existing of [[old],[old,{...old,id:'second'}],[{...old,is_fixed:true,photo_count:2,link_count:1,status:'completed'}]])
  assert.deepEqual(propose({items:[item(0,{title:old.title,local_date:old.localDate})]},state(existing)),[]);
 assert.deepEqual(propose({items:[item(0,{title:old.title})]},state([old])),[],'landmark on another day needs review');
 const midnight={...old,title:'Arribada a l’apartament',timeLabel:'00:15'};
 assert.deepEqual(propose({items:[item(0,{title:midnight.title,start_local_time:'00:15'})]},state([midnight])),[],'adjacent midnight date conflict');
 assert.deepEqual(propose({items:[item(0,{title:'Esmorzar'})]},state([{...old,title:'Esmorzar'}])),[add(0)],'generic breakfast on a different day is distinct');
});
test('A-02 order, determinism and deeply frozen inputs; return values share no mutable decisions',()=>{
 const snapshot=freeze({items:[item(9),item(2,{title:'Huskies opcionals'}),item(7)]});
 const s=freeze(state([],[{source_order:7,action:'skip'}]));const before=JSON.stringify([snapshot,s]);
 const result=propose(snapshot,s);assert.deepEqual(result,[add(9),add(2)]);
 result[0].action='skip';result.push(add(44));assert.deepEqual(propose(snapshot,s),[add(9),add(2)]);
 assert.equal(JSON.stringify([snapshot,s]),before);
 assert.deepEqual(propose(freeze({items:[]}),s),[]);
});
test('A-02 existing caller preprocessing remains distinct: overlaps reviewed by planning/flash',()=>{
 const snapshot=freeze({items:[item(0,{}, {review_flags:['possible_overlap_in_review']})]});const s=freeze(state());
 assert.deepEqual(propose(snapshot,s),[]);
 assert.deepEqual(initialPlanningDecisions(snapshot,s),[add(0)]);
 assert.deepEqual(prepareFlashDecisions(snapshot,s,{projection:[]}),[add(0)]);
 assert.deepEqual(snapshot.items[0].review_flags,['possible_overlap_in_review']);
});
test('A-02 malformed required inputs retain errors rather than producing fabricated decisions',()=>{
 assert.throws(()=>propose({},state()),TypeError);
 assert.throws(()=>propose({items:[item(0)]},{}),TypeError);
 assert.throws(()=>propose({items:[item(0,{title:42})]},state()),TypeError);
});

test('A-02 domain export and legacy UI export share one implementation',async()=>{
 const domain=await import('../domain/import-itinerary-reconciliation.mjs');
 assert.equal(domain.proposeUnmatchedReconciliationDecisions,propose);
});
test('A-02 consumers use the existing domain asset, without a new runtime path',async()=>{
 const {readFile}=await import('node:fs/promises');
 const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
 for(const name of ['import-itinerary-flash.mjs','import-itinerary-planning.mjs']){
  const text=await read('domain/'+name);
  assert.match(text,/import \{[^}]*proposeUnmatchedReconciliationDecisions[^}]*\} from '\.\/import-itinerary-reconciliation\.mjs'/);
  assert.doesNotMatch(text,/from '\.\/import-itinerary-reconciliation-ui\.mjs'/);
 }
 const domain=await read('domain/import-itinerary-reconciliation.mjs');
 assert.doesNotMatch(domain,/from ['"][^'"]*-ui\.mjs['"]/);
 for(const name of ['import-itinerary-reconciliation.mjs','import-itinerary-reconciliation-ui.mjs','import-itinerary-flash.mjs','import-itinerary-planning-ui.mjs']){
  assert.ok((await read('scripts/package-pages.mjs')).includes("'"+name+"'"));
  assert.ok((await read('sw.js')).includes("'./domain/"+name+"'"));
 }
});

import test from 'node:test';import assert from 'node:assert/strict';
import {prepareFlashDecisions,flashQueue,decideFlash,undoFlash,flashRecommendation,flashPlanningHtml,flashHtml,reopenFlashMatches} from '../domain/import-itinerary-flash.mjs';
import {analyzePlanning} from '../domain/import-itinerary-planning-ui.mjs';
const id=n=>'14000000-0000-4000-8000-'+String(n).padStart(12,'0');
const old={id:id(1),title:'Catedral de Riga',city:'Riga',localDate:'2030-12-27',timeLabel:'10:00',starts_at:'2030-12-27T10:00Z',ends_at:'2030-12-27T11:00Z',time_zone:'UTC',timing_kind:'exact',status:'planned',photo_count:0,link_count:0,updated_at:'2030-12-01T00:00Z'};
const item=(n,title='Riga Cathedral',extra={})=>({source_order:n,included:true,classification_hint:'manual',source_warnings:['Confiança limitada'],review_flags:['uncertain_extraction'],values:{title,city:'Riga',local_date:'2030-12-28',start_local_time:'09:30',end_local_time:'10:30',time_zone:'UTC',...extra}});
const context={projection:[],convertLocalTime:s=>s+':00Z',sourcesReady:true,days:['2030-12-27','2030-12-28'],startDate:'2030-12-27',endDate:'2030-12-28'};
const setup=()=>({snapshot:{read_only:true,items:[item(0),item(1,'Parc nou')]},state:{existing:[old],decisions:[],retire:[]},flash:{deferred:[],history:[],targets:{}}});
test('#196 only probable matches enter flash queue, not extraction uncertainty',()=>{
 const {snapshot,state,flash}=setup();state.decisions=prepareFlashDecisions(snapshot,state,context);
 assert.deepEqual(state.decisions,[{source_order:1,action:'add'}]);assert.deepEqual(flashQueue(snapshot,state,context,flash).map(x=>x.source_order),[0]);
});
test('#196 empty trip fast path uses existing validation and has no flash',()=>{
 const {snapshot,state,flash}=setup();state.existing=[];state.decisions=prepareFlashDecisions(snapshot,state,context);
 assert.equal(state.decisions.length,2);assert.deepEqual(flashQueue(snapshot,state,context,flash),[]);
 assert.equal(analyzePlanning(snapshot,state,context).combined.plan.can_commit,true);
 const invalid={...snapshot,items:[item(0,'Parc',{local_date:''})]};assert.deepEqual(prepareFlashDecisions(invalid,{...state,decisions:[]},context),[]);
});
test('#196 decision/undo/postpone stay in draft; protected records cannot move',()=>{
 const {snapshot,state,flash}=setup(),before=structuredClone(state.existing);state.decisions=prepareFlashDecisions(snapshot,state,context);
 decideFlash(snapshot,state,context,flash,0,'later');assert.equal(flashQueue(snapshot,state,context,flash).length,0);assert.equal(analyzePlanning(snapshot,state,context).combined.plan.can_commit,false);
 undoFlash(state,flash);assert.equal(flashQueue(snapshot,state,context,flash).length,1);
 decideFlash(snapshot,state,context,flash,0,'update',old.id);assert.equal(state.decisions.find(d=>d.source_order===0).action,'update');assert.deepEqual(state.existing,before);
 undoFlash(state,flash);state.existing[0]={...old,is_fixed:true};assert.throws(()=>decideFlash(snapshot,state,context,flash,0,'update',old.id),/protegida/);
 assert.equal(flashRecommendation(snapshot,state,context,snapshot.items[0],state.existing[0]).choice,'keep');
});
test('#196 recommendation uses whole planning with fixed commitments and admits missing evidence',()=>{
 const {snapshot,state}=setup();snapshot.items=snapshot.items.slice(0,1);
 assert.equal(flashRecommendation(snapshot,state,context,snapshot.items[0],old).text,'No tinc prou informació per recomanar una data');
 const booking={key:'activity:fixed',sourceId:id(8),sourceType:'activity',title:'Reserva confirmada',localDate:'2030-12-28',startsAt:'2030-12-28T09:45:00Z',endsAt:'2030-12-28T10:30:00Z',timeZone:'UTC',timingKind:'exact',status:'confirmed'};
 const recommendation=flashRecommendation(snapshot,state,{...context,projection:[booking]},snapshot.items[0],old);
 assert.equal(recommendation.choice,'keep');assert.match(recommendation.text,/Reserva confirmada/);
 assert.equal(flashRecommendation(snapshot,state,{...context,sourcesReady:false},snapshot.items[0],old).choice,null);
});
test('#196 final overview has exactly two main groups; missing data is not a conflict',()=>{
 const {snapshot,state,flash}=setup();state.existing=[];state.decisions=prepareFlashDecisions(snapshot,state,context);
 snapshot.items[1].values.local_date='2030-12-27';snapshot.items[1].values.end_local_time='';
 const a=analyzePlanning(snapshot,state,context),html=flashPlanningHtml(a,snapshot,state,context,flash);
 assert.equal((html.match(/<section data-flash-/g)||[]).length,2);assert.match(html,/Itinerari vàlid, sense conflictes/);assert.match(html,/Conflictes per resoldre/);assert.match(html,/No s’han detectat incompatibilitats/);assert.doesNotMatch(html,/aspectes pendents|trams pendents/);
});
test('#196 related flight is a confirmation choice, never an automatic reservation change',()=>{
 const {snapshot,state,flash}=setup();snapshot.items=[{...item(0,'Vol BCN → RIX'),classification_hint:'flight'}];state.existing=[];
 const ctx={...context,projection:[{key:'flight:fixed',sourceType:'flight',title:'Barcelona → Riga',localDate:'2030-12-28',startsAt:'2030-12-28T08:00Z',timeZone:'UTC',status:'confirmed'}]};
 assert.deepEqual(prepareFlashDecisions(snapshot,state,ctx),[]);assert.equal(flashQueue(snapshot,state,ctx,flash).length,1);
 assert.throws(()=>decideFlash(snapshot,state,ctx,flash,0,'update','flight:fixed'),/protegida/);
 decideFlash(snapshot,state,ctx,flash,0,'keep','flight:fixed');assert.deepEqual(state.decisions,[{source_order:0,action:'skip'}]);
});
test('#196 ambiguous targets require explicit selection; strings are escaped',()=>{
 const {snapshot,state,flash}=setup();state.existing.push({...old,id:id(2)});
 assert.throws(()=>decideFlash(snapshot,state,context,flash,0,'keep',''),/Tria primer/);
 const a=analyzePlanning(snapshot,state,context);const html=flashHtml(snapshot,state,context,flash,a);assert.match(html,/data-flash-target=/);assert.match(html,/Selecciona la visita existent/);
});

test('#200 users can reopen previous PDF choices before confirmation without changing existing data',()=>{
 const {snapshot,state,flash}=setup(),original=structuredClone(state.existing);
 state.decisions=prepareFlashDecisions(snapshot,state,context);
 decideFlash(snapshot,state,context,flash,0,'keep',old.id);
 const before=analyzePlanning(snapshot,state,context);
 assert.match(flashPlanningHtml(before,snapshot,state,context,flash),/data-flash-revisit/);
 assert.equal(flashQueue(snapshot,state,context,flash).length,0);
 assert.equal(reopenFlashMatches(snapshot,state,context,flash),1);
 assert.deepEqual(state.decisions,[{source_order:1,action:'add'}]);
 assert.deepEqual(flashQueue(snapshot,state,context,flash).map(x=>x.source_order),[0]);
 assert.deepEqual(state.existing,original);
 assert.equal(flash.history.length,0);
 assert.equal(reopenFlashMatches(snapshot,state,context,flash),0);
});

test('#210 cathedral missing final time never prefers a date over a flexible breakfast',()=>{
 const {snapshot,state}=setup();snapshot.items=[item(0,'Catedral de Riga i plaça principal del centre històric',{end_local_time:''})];
 state.existing[0]={...old,title:'Visita a la Catedral de Riga, plaça Doma laukums'};
 const breakfast={key:'activity:breakfast',sourceType:'activity',title:'Esmorzar lliure prop del centre',localDate:'2030-12-28',startsAt:'2030-12-28T09:00Z',endsAt:'2030-12-28T10:00Z',timeZone:'UTC',timingKind:'exact',status:'planned'};
 const result=flashRecommendation(snapshot,state,{...context,projection:[breakfast]},snapshot.items[0],state.existing[0]);
 assert.equal(result.choice,null);assert.match(result.text,/Viabilitat pendent/);assert.match(result.text,/durada/);assert.match(result.text,/flexible/);assert.doesNotMatch(result.text,/Conservar evita/);
 snapshot.items[0].values.end_local_time='10:30';
 const complete=flashRecommendation(snapshot,state,{...context,projection:[breakfast]},snapshot.items[0],state.existing[0]);assert.equal(complete.choice,null);assert.match(complete.text,/flexible/);
 breakfast.status='confirmed';assert.equal(flashRecommendation(snapshot,state,{...context,projection:[breakfast]},snapshot.items[0],state.existing[0]).choice,'keep');
});

import test from 'node:test';import assert from 'node:assert/strict';
import {canonicalPlanningFlights,matchingPlanningFlight} from '../domain/flight-journey-identity.mjs';
import {assessCombinedItinerary,proposeItinerarySolutions,acceptItinerarySolution,editItinerarySolution,conflictRecommendation,planningPairs} from '../domain/import-itinerary-planning.mjs';
import {compareImportActivity,createItineraryReview,summarizeItineraryReview} from '../domain/import-itinerary-review.mjs';
const flight=(id,number='AY1020',extra={})=>({key:id,tripId:'trip',sourceType:'flight',title:'Tallinn → Helsinki',startsAt:'2027-01-02T09:00:00+02:00',endsAt:'2027-01-02T10:00:00+02:00',localDate:'2027-01-02',timeZone:'Europe/Tallinn',timingKind:'exact',flightIdentity:{flight_number:number,departure_airport_code:'TLL',arrival_airport_code:'HEL'},...extra});
const conflicts=items=>assessCombinedItinerary({items,complete:true}).issues.filter(i=>i.kind==='conflict');
test('#208 two individual AY1020 / AY1653 tickets are one scheduling journey; no mutation or zero-distance self route',()=>{
 for(const number of ['AY1020','AY1653']){
  const a=flight('a',number,{documents:['private'],passengers:'Eva',seat:'1A'}),b=flight('b',number,{title:'Flight ticket Xesc',seat:'1B',passengers:'Xesc',documents:['other'],flightIdentity:{flight_number:number}}),rows=[a,b],before=structuredClone(rows);
  assert.equal(conflicts(rows).length,0);assert.equal(planningPairs(rows).length,0);assert.equal(canonicalPlanningFlights(rows).length,1);assert.deepEqual(rows,before);
 }
});
test('#208 coincident distinct flights, ambiguous routes, another trip, different instants and missing identity stay conflicts',()=>{
 const a=flight('a');
 for(const b of [flight('b','AY1653'),flight('b','AY1020',{tripId:'other'}),flight('b','AY1020',{startsAt:'2027-01-02T07:05Z'}),flight('b','AY1020',{flightIdentity:{}})])assert.equal(conflicts([a,b]).length,1);
 const other=flight('c','AY1020',{flightIdentity:{flight_number:'AY1020',departure_airport_code:'TLL',arrival_airport_code:'RIX'}}),unknown=flight('b','AY1020',{flightIdentity:{flight_number:'AY1020'}});
 assert.equal(canonicalPlanningFlights([a,other,unknown]).length,3);
 assert.equal(conflicts([a,flight('b','AY1020',{startsAt:'2027-01-02T07:00Z',timeZone:'UTC'})]).length,0);
 assert.equal(conflicts([a,flight('b','AY1020',{endsAt:'2027-01-02T08:15Z'})]).length,1);
});
test('#208 PDF flight matching uses explicit number and actual departure, not every flight of the day',()=>{
 const rows=[flight('a'),flight('b','AY1020',{flightIdentity:{flight_number:'AY1020'}}),flight('c','AY1653')];
 const value={title:'Vol AY1020 TLL–HEL',local_date:'2027-01-02',start_local_time:'09:00',time_zone:'Europe/Tallinn'};
 assert.equal(matchingPlanningFlight(value,rows,s=>s+':00+02:00').length,2);
 assert.equal(matchingPlanningFlight({...value,title:'Vol de retorn'},rows,s=>s+':00+02:00').length,0);
 assert.equal(matchingPlanningFlight(value,rows,s=>s+':00Z').length,0);
});
const old={id:'old',title:'Museu Nacional d’Art de Letònia',city:'Riga',location_name:'Museu Nacional d’Art de Letònia',starts_at:'2026-12-28T08:00Z',ends_at:'2026-12-28T09:00Z',time_zone:'Europe/Riga',localDate:'2026-12-28',timeLabel:'10:00'};
const values={title:old.title,city:'Riga',location_name:old.location_name,local_date:'2026-12-28',start_local_time:'10:00',end_local_time:'11:00',time_zone:'Europe/Riga'};
test('#208 repeat PDF unchanged; changed time/name gets before/after; generic/multiple candidates never silently unify',()=>{
 assert.equal(compareImportActivity(values,[old]).kind,'unchanged');
 const result=compareImportActivity({...values,title:'Visita al Museu Nacional d’Art de Letònia',start_local_time:'11:00'},[old]);
 assert.equal(result.kind,'modified');assert.deepEqual(result.changes.find(x=>x.key==='start_local_time'),{key:'start_local_time',before:'10:00',after:'11:00'});
 assert.equal(compareImportActivity(values,[old,{...old,id:'other'}]).kind,'ambiguous');
 assert.equal(compareImportActivity({...values,title:'Museu'},[{...old,title:'Museu'}]).kind,'ambiguous');
 assert.equal(compareImportActivity({...values,title:'Biblioteca Nacional'},[old]).kind,'new');
});
const item=(key,title,start,end,extra={})=>({key,title,sourceType:'manual',sourceOrder:key==='park'?0:1,mutable:true,localDate:'2026-12-28',timeZone:'Europe/Riga',timingKind:'exact',startsAt:start,endsAt:end,...extra});
const park=item('park','Passeig al parc Bastejkalna','2026-12-28T08:30Z','2026-12-28T09:30Z'),museum=item('museum',old.title,'2026-12-28T08:00Z','2026-12-28T09:00Z');
const context={startDate:'2026-12-28',endDate:'2026-12-29',days:['2026-12-28'],convertLocalTime:s=>s+':00+02:00'};
test('#208 museum/park prefers flexible walk with confidence and missing evidence; accept/edit/cancel remain draft only',()=>{
 const combined={items:[museum,park],complete:true},before=structuredClone(combined),solutions=proposeItinerarySolutions(combined,{},context);
 assert.ok(solutions.length);assert.equal(solutions[0].sourceOrder,0);assert.equal(solutions[0].confidence,'baixa');assert.match(solutions[0].reason,/flexible/);assert.match(solutions[0].reason,/obertures/);
 const review={read_only:true,items:[{source_order:0,original:{title:park.title},edits:{}},{source_order:1,original:{title:museum.title},edits:{}}]},original=structuredClone(review);
 const accepted=acceptItinerarySolution(review,solutions[0],combined,{},context);assert.notDeepEqual(accepted,review);assert.deepEqual(review,original);assert.deepEqual(combined,before);
 const edited=editItinerarySolution(review,solutions[0],{local_date:'2026-12-28',start_local_time:'15:00',end_local_time:'16:00'},combined,{},context);assert.equal(edited.items[0].edits.start_local_time,'15:00');assert.deepEqual(review,original);
 assert.throws(()=>editItinerarySolution(review,solutions[0],{local_date:'2026-12-28',start_local_time:'10:30',end_local_time:'11:30'},combined,{},context),/conflicte/);
 const incomplete={...combined,items:[museum,{...park,endsAt:null,mutable:false}]};const analysis={combined:incomplete,solutions:proposeItinerarySolutions(incomplete,{},context)};
 assert.match(conflictRecommendation(analysis,{items:incomplete.items}).reason,/confirmar|verificar/);
 assert.ok(proposeItinerarySolutions({items:[{...museum,mutable:false,sourceType:'activity'},park],complete:true},{},context).every(p=>p.sourceOrder===0));
});
test('#208 review overlap flags distinguish shared numbered flights from distinct flights',()=>{
 const field=value=>({value,confidence:'high',evidence:[{kind:'text',excerpt:value,page:1}]});const proposal={schema_version:1,source:{kind:'document',document_id:'doc',mime_type:'application/pdf'},candidates:['Vol AY1020 TLL–HEL','Vol AY1020 TLL–HEL'].map((title,i)=>({source_order:i,classification_hint:'flight',warnings:[],fields:Object.fromEntries(Object.entries({...values,title,local_date:'2027-01-02'}).map(([k,v])=>[k,field(v)]))}))};
 const review=createItineraryReview(proposal,{tripId:'trip',userId:'user',documentId:'doc'});
 assert.ok(summarizeItineraryReview(review).items.every(i=>!i.review_flags.includes('possible_overlap_in_review')));
 review.items[1].edits.title='Vol AY1653 TLL–HEL';assert.ok(summarizeItineraryReview(review).items.every(i=>i.review_flags.includes('possible_overlap_in_review')));
});
test('#208 incomplete duration yields verification, not arbitrary rescheduling; exact transports stay protected',async()=>{
 const {combineImportItinerary}=await import('../domain/import-itinerary-planning.mjs');
 const incomplete={items:[museum,{...park,endsAt:null}],complete:true};
 assert.deepEqual(proposeItinerarySolutions(incomplete,{},context),[]);
 for(const title of ['Entrada al museu a les 10','Tren Riga Tallinn','Transport reservat','Vol AY1020']){
  const snapshot={read_only:true,items:[{source_order:0,included:true,classification_hint:'manual',review_flags:[],values:{...values,title}}]};
  const result=combineImportItinerary(snapshot,{existing:[],decisions:[{source_order:0,action:'add'}],retire:[]},context);assert.equal(result.items[0].mutable,false);
 }
});

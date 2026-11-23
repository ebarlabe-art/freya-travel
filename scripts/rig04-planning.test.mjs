import test from 'node:test';import assert from 'node:assert/strict';
import {matchingExistingImportItems,equivalentItineraryPlace,compareImportActivity,createItineraryReview,summarizeItineraryReview} from '../domain/import-itinerary-review.mjs';
import {automaticEquivalentDecisions,combineImportItinerary,assessCombinedItinerary,proposeItinerarySolutions,acceptItinerarySolution,planningRouteKey,planningSignature,planningRouteInput} from '../domain/import-itinerary-planning.mjs';
import {initialPlanningDecisions,refreshAutomaticDecisions} from '../domain/import-itinerary-planning-ui.mjs';
import {flashQueue,flashHtml} from '../domain/import-itinerary-flash.mjs';
import {planItineraryReconciliation} from '../domain/import-itinerary-reconciliation.mjs';
import {createRouteHandler} from '../supabase/functions/itinerary-route/handler.mjs';
const id=n=>'14000000-0000-4000-8000-'+String(n).padStart(12,'0'),now=Date.parse('2030-12-20T10:00Z');
const convertLocalTime=s=>s+':00Z';
const old={id:id(1),title:'Catedral de Riga',city:'Riga',location_name:'Catedral de Riga',localDate:'2030-12-27',starts_at:'2030-12-27T10:00Z',ends_at:'2030-12-27T11:00Z',time_zone:'UTC',timing_kind:'exact',status:'planned',photo_count:0,link_count:0,updated_at:'2030-12-20T08:00Z'};
const item=(order,title='Riga Cathedral',more={})=>({source_order:order,included:true,classification_hint:'manual',review_flags:[],values:{title,city:'Riga',location_name:title,local_date:'2030-12-27',start_local_time:'10:00',end_local_time:'11:00',time_zone:'UTC',...more}});
const context={projection:[],convertLocalTime,startDate:'2030-12-26',endDate:'2031-01-02',days:['2030-12-27','2030-12-28'],sourcesReady:true};
const state=(decisions=[])=>({existing:[old],decisions,retire:[]});
const event=(key,start,end,extras={})=>({key,title:key,sourceType:'manual',localDate:'2030-12-27',timeZone:'UTC',timingKind:'exact',startsAt:'2030-12-27T'+start+':00Z',endsAt:end?'2030-12-27T'+end+':00Z':null,...extras});
const combined=items=>({items,complete:true});
const route={route:{method:'routing',mode:'walk',duration_seconds:900,distance_m:1000,source:'synthetic provider',calculated_at:new Date(now).toISOString()}};
test('RIG04 known translations stay city scoped; no generic, compound or wrong-saint equivalence',()=>{
 assert.equal(equivalentItineraryPlace(old,item(0).values),true);
 for(const v of [{title:'Riga Cathedral',city:'Tallinn'},{title:'Museu',city:'Riga'},{title:'Riga Cathedral i dinar',city:'Riga'},{title:'Riga Cathedral'}])assert.equal(equivalentItineraryPlace(old,v),false);
 assert.equal(equivalentItineraryPlace({title:'Basilica di San Petronio',city:'Bologna'},{title:'Basilica di San Domenico',city:'Bologna'}),false);
 assert.equal(matchingExistingImportItems(item(0,'Riga Cathedral',{local_date:'2030-12-28'}).values,[old]).length,1);
 assert.equal(matchingExistingImportItems({title:'Museu',city:'Tallinn',local_date:'2030-12-27'},[{title:'Museu',city:'Riga',localDate:'2030-12-27'}]).length,0);
});
test('RIG04 automatic KEEP requires unique identity and all operational values equal; never repeated decisions',()=>{
 const snapshot={read_only:true,items:[item(0)]};const decisions=automaticEquivalentDecisions(snapshot,[old]);assert.equal(decisions[0].action,'keep');
 assert.deepEqual(automaticEquivalentDecisions(snapshot,[old],decisions),[]);
 assert.deepEqual(refreshAutomaticDecisions({items:[item(0,'Riga Cathedral',{notes:'Nova reserva'})]},{existing:[old],decisions}),[]);
 for(const change of [{notes:'reserva diferent'},{address:'altra entrada'},{start_local_time:'10:15'},{end_local_time:''},{local_date:'2030-12-28'}])assert.deepEqual(automaticEquivalentDecisions({items:[item(0,'Riga Cathedral',change)]},[old]),[]);
 assert.deepEqual(automaticEquivalentDecisions(snapshot,[old,{...old,id:id(2)}]),[]);
 assert.deepEqual(automaticEquivalentDecisions({items:[item(0),item(1)]},[old]),[]);
});
test('RIG04 Barcelona: five literal duplicates stay unchanged with medium-confidence evidence',()=>{
 const before={
  ...old,id:id(88),title:'Visita a la Sagrada Família',city:'Barcelona',
  location_name:'Basílica de la Sagrada Família',address:'Carrer de Mallorca, 401',notes:'',
  localDate:'2027-04-10',starts_at:'2027-04-10T08:00:00Z',ends_at:'2027-04-10T09:15:00Z',
  time_zone:'Europe/Madrid'
 };
 const values={title:before.title,local_date:'2027-04-10',start_local_time:'10:00',
  end_local_time:'11:15',time_zone:before.time_zone,location_name:before.location_name,
  city:before.city,address:before.address,notes:''};
 const existing=structuredClone(before);
 const duplicate={...item(0,before.title),values,review_flags:['uncertain_extraction','possible_existing_duplicate'],
  source_warnings:['Any agafat del títol general']};
 const original=structuredClone(duplicate);
 const state={read_only:true,items:[duplicate]};
 assert.deepEqual(automaticEquivalentDecisions(state,[existing]),[{source_order:0,action:'keep',target_id:before.id,automatic:true}]);
 assert.deepEqual(automaticEquivalentDecisions(state,[existing],[{source_order:0,action:'keep',target_id:before.id,automatic:true}]),[]);
 assert.deepEqual(duplicate,original);
 assert.deepEqual(existing,before);
 for(const diff of [{notes:'Visita guiada'},{address:'Carrer de Mallorca, 402'},
  {city:'Girona'},{start_local_time:'10:15'},{end_local_time:'11:30'},{local_date:'2027-04-11'},
  {location_name:'Un altre monument'}]){
  assert.deepEqual(automaticEquivalentDecisions({items:[{...duplicate,values:{...values,...diff}}]},[existing]),[],
   'A changed value must remain reviewable: '+Object.keys(diff)[0]);
 }
 assert.deepEqual(automaticEquivalentDecisions(state,[before,{...before,id:id(89)}]),[],
  'Two identical existing activities require manual review');
 assert.deepEqual(automaticEquivalentDecisions({items:[duplicate,{...duplicate,source_order:1}]},[before]),[],
  'Repeated PDF rows require manual review');
 assert.deepEqual(automaticEquivalentDecisions({items:[{...duplicate,source_warnings:['Evidència pendent: cal revisar']}]},[before]),
  [{source_order:0,action:'keep',target_id:before.id,automatic:true}],
  'An identical saved activity needs no extra decision even if PDF evidence is uncertain');
});

test('RIG04 actual PDF classification: unchanged activity skips flash and only modified rows need review',()=>{
 const stored={...old,id:id(150),title:'Visita a la Sagrada Família',location_name:'Basílica de la Sagrada Família',
  city:'Barcelona',address:'Carrer de Mallorca, 401',notes:null,localDate:'2027-04-10',
  starts_at:'2027-04-10T08:00:00Z',ends_at:'2027-04-10T09:15:00Z',time_zone:'Europe/Madrid'};
 const row={...item(0,stored.title),classification_hint:'activity',
  values:{title:stored.title,location_name:stored.location_name,city:stored.city,address:stored.address,
   notes:'',local_date:'2027-04-10',start_local_time:'10:00',end_local_time:'11:15',time_zone:'Europe/Madrid'},
  source_warnings:['Confiança mitjana: revisa la informació'],
  review_flags:['uncertain_extraction','possible_existing_duplicate']};
 const snapshot={read_only:true,items:[row]},existing=[stored],before=structuredClone({snapshot,existing});
 assert.equal(compareImportActivity(row.values,existing).kind,'unchanged','the UI comparison labels it unchanged');
 assert.equal(compareImportActivity({...row.values,notes:''},[{...stored,notes:':'}]).kind,'unchanged',
  'A punctuation-only note imported from an empty PDF note is not an activity change');
 assert.equal(compareImportActivity({...row.values,notes:'Reserva confirmada'},[{...stored,notes:':'}]).kind,'modified',
  'Meaningful notes must never be hidden');
 const decisions=automaticEquivalentDecisions(snapshot,existing);
 assert.deepEqual(decisions,[{source_order:0,action:'keep',target_id:stored.id,automatic:true}]);
 const state={existing,decisions,retire:[]};
 assert.equal(flashQueue(snapshot,state,{projection:[]},{deferred:[],history:[],targets:{}}).length,0);
 assert.equal(flashHtml(snapshot,state,{projection:[]},{deferred:[],history:[],targets:{}},{combined:{items:[]},assessment:{issues:[]},solutions:[]}), '');
 assert.equal(planItineraryReconciliation({snapshot,existing,decisions}).can_commit,false);
 assert.deepEqual({snapshot,existing},before);
 const changed={...row,values:{...row.values,end_local_time:'11:30'}};
 assert.equal(compareImportActivity(changed.values,existing).kind,'modified');
 assert.deepEqual(automaticEquivalentDecisions({items:[changed]},existing),[]);
 assert.equal(flashQueue({items:[changed]},{existing,decisions:[]},{projection:[]},{deferred:[]}).length,1);
 const missing={...row,source_order:1,values:{...row.values,title:'Una visita diferent'}};
 assert.deepEqual(automaticEquivalentDecisions({items:[row,missing]},existing),[...decisions]);
 assert.deepEqual(automaticEquivalentDecisions({items:[row,{...row,source_order:2}]},existing),[],
  'Repeated PDF rows must be reviewed');
});
test('RIG04 Barcelona reimport: all six unchanged visits are silent despite extraction warnings',()=>{
 const sources=[
  ['Visita a la Sagrada Família','2027-04-10','10:00','11:15','Basílica de la Sagrada Família','Barcelona','Carrer de Mallorca, 401',''],
  ['Visita a la Casa Batlló','2027-04-10','12:00','13:00','Casa Batlló','Barcelona','Passeig de Gràcia, 43',''],
  ['Passeig lliure i descans','2027-04-10','15:30','16:15','','','',':'],
  ['Visita al Palau de la Música Catalana','2027-04-11','09:30','10:30','Palau de la Música Catalana','Barcelona','Carrer del Palau de la Música, 4-6',''],
  ['Visita a la Catedral de Barcelona','2027-04-11','11:30','12:30','Catedral de Barcelona','Barcelona','Pla de la Seu, s/n',''],
  ['Temps lliure pel centre','2027-04-11','15:00','16:00','','','','']
 ];
 const when=(date,time)=>new Date(Date.parse(date+'T'+time+':00Z')-2*3600e3).toISOString();
 const existing=sources.map(([title,date,start,end,location_name,city,address,notes],i)=>({
  id:id(120+i),title,location_name:location_name||null,city:city||null,address:address||null,notes:notes||null,
  localDate:date,starts_at:when(date,start),ends_at:when(date,end),
  time_zone:'Europe/Madrid',timing_kind:'exact',status:'planned',updated_at:'2026-11-23T09:00:00Z',photo_count:0,link_count:0
 }));
 const items=sources.map(([title,local_date,start_local_time,end_local_time,location_name,city,address,notes],i)=>({
  source_order:i,included:![2,5].includes(i),classification_hint:[2,5].includes(i)?'manual':'activity',
  review_flags:['uncertain_extraction',...(i===0?['possible_existing_duplicate']:[])],
  source_warnings:[2,5].includes(i)?['Evidència pendent: comprova el document']:['Confiança mitjana: verifica el text'],
  values:{title,local_date,start_local_time,end_local_time,time_zone:'Europe/Madrid',location_name,city,address,notes:i===2?'':notes}
 }));
 const snapshot={read_only:true,items};
 const original=structuredClone({snapshot,existing});
 const decisions=automaticEquivalentDecisions(snapshot,existing);
 assert.deepEqual(decisions.map(d=>[d.source_order,d.action]),[[0,'keep'],[1,'keep'],[2,'skip'],[3,'keep'],[4,'keep'],[5,'skip']]);
 const reconciled=planItineraryReconciliation({snapshot,existing,decisions});
 assert.equal(reconciled.summary.pending,0);
 assert.equal(reconciled.summary.new,0);
 assert.equal(reconciled.summary.updated,0);
 assert.equal(reconciled.summary.preserved,6);
 assert.equal(reconciled.can_commit,false);
 assert.deepEqual({snapshot,existing},original);
 const unknown={...items[5],source_order:6,values:{...items[5].values,title:'Una nova activitat de temps lliure'}};
 const more={read_only:true,items:[...items,unknown]};
 const partial=automaticEquivalentDecisions(more,existing);
 assert.equal(partial.length,6);
 const pending=planItineraryReconciliation({snapshot:more,existing,decisions:partial});
 assert.equal(pending.summary.pending,1,'A new uncertain activity still requires a choice');
 assert.equal(pending.conflicts[0].reason,'excluded_needs_decision');
 const changed={read_only:true,items:items.map((entry,i)=>i===0?{...entry,values:{...entry.values,address:'Carrer de Mallorca, 402'}}:entry)};
 assert.equal(automaticEquivalentDecisions(changed,existing).some(d=>d.source_order===0),false);
 const duplicated={read_only:true,items:[...items,{...items[0],source_order:7}]};
 assert.equal(automaticEquivalentDecisions(duplicated,existing).some(d=>d.source_order===0),false);
});
test('RIG04 combination preserves existing identity, protected reservation and source input',()=>{
 const snapshot={read_only:true,items:[item(0),item(1,'Passeig nou',{start_local_time:'12:00',end_local_time:'13:00'})]},r=state();r.decisions=initialPlanningDecisions(snapshot,r);
 const flight=event('flight:1','08:00','09:00',{sourceType:'flight',documents:[{secret:'not needed'}],bookingCode:'private'}),before=structuredClone({snapshot,r,flight});
 const result=combineImportItinerary(snapshot,r,{...context,projection:[flight]});assert.equal(result.items.length,3);assert.equal(result.items.find(x=>x.sourceId===old.id).title,old.title);assert.equal(result.items.find(x=>x.key==='flight:1').documents,undefined);
 assert.deepEqual({snapshot,r,flight},before);
 const booked={read_only:true,items:[item(0,'Booked guided tour')]};
 assert.equal(combineImportItinerary(booked,{existing:[],decisions:[{source_order:0,action:'add'}],retire:[]},context).items[0].mutable,false);
});
test('RIG04 verifies all overlapping intervals including a fixed instant and midnight in UTC',()=>{
 const a=event('visit','10:00','12:00'),b=event('reservation','11:00',null,{sourceType:'activity'});
 assert.equal(assessCombinedItinerary(combined([a,b]),{now}).counts.conflicts,1);
 const overnight={...a,startsAt:'2030-12-27T23:30:00+02:00',endsAt:'2030-12-28T01:00:00+02:00'},f={...b,startsAt:'2030-12-27T23:00:00Z',endsAt:'2030-12-28T00:00:00Z'};
 assert.equal(assessCombinedItinerary(combined([overnight,f]),{now}).counts.conflicts,0);
});
test('RIG04 reuses route feasibility; missing, stale, approximate and transit evidence cannot certify viability',()=>{
 const a=event('A','10:00','11:00'),b=event('B','11:10','12:00'),key=planningRouteKey(a,b);
 assert.ok(assessCombinedItinerary(combined([a,b]),{routes:{[key]:route},now}).issues.some(x=>x.code==='travel'));
 const short={route:{...route.route,duration_seconds:480}};assert.ok(assessCombinedItinerary(combined([a,b]),{routes:{[key]:short},now}).issues.some(x=>x.kind==='tight'));
 for(const value of [null,{route:{...route.route,method:'straight_line'}},{route:{...route.route,calculated_at:'2030-01-01T00:00Z'}}])assert.ok(assessCombinedItinerary(combined([a,b]),{routes:{[key]:value},now}).issues.some(x=>x.code==='route'));
 assert.equal(assessCombinedItinerary(combined([a,b]),{now}).status,'pending');
 assert.ok(assessCombinedItinerary(combined([a,{...b,timingKind:'approximate'}]),{now}).issues.some(x=>x.code==='duration'));
});
test('RIG04 opening evidence needs identity, source, date, timezone and freshness',()=>{
 const a=event('A','10:00','11:00');const h={verified:true,source:'synthetic venue',date:a.localDate,timeZone:a.timeZone,place:planningSignature([a.title,a.location_name,a.address,a.city]),checkedAt:new Date(now).toISOString(),intervals:[['2030-12-27T12:00Z','2030-12-27T18:00Z']]};
 assert.equal(assessCombinedItinerary(combined([a]),{openings:{A:h},now}).status,'conflict');
 for(const change of [{source:null},{date:'2030-12-28'},{place:'other'},{checkedAt:'2020-01-01T00:00Z'}])assert.equal(assessCombinedItinerary(combined([a]),{openings:{A:{...h,...change}},now}).status,'pending');
});
test('RIG04 solutions are draft-only, protect bookings, stale acceptance fails and alternative days stay within trip',()=>{
 const a=event('pdf:0','10:00','11:30',{mutable:true,sourceOrder:0}),b=event('booking','11:00','12:00',{sourceType:'activity',mutable:false});
 const c=combined([a,b]),solutions=proposeItinerarySolutions(c,{now},context);
 assert.ok(solutions.some(x=>x.kind==='time_order'));assert.ok(solutions.some(x=>x.kind==='day'));assert.ok(solutions.every(x=>x.sourceOrder===0));
 const review={read_only:true,items:[{source_order:0,edits:{},original:{title:'Visit'}}]},before=structuredClone(review);
 const edited=acceptItinerarySolution(review,solutions[0],c,{now},context);assert.notDeepEqual(edited,review);assert.deepEqual(review,before);assert.equal(b.startsAt,'2030-12-27T11:00:00Z');
 assert.throws(()=>acceptItinerarySolution(review,solutions[0],combined([a,{...b,endsAt:'2030-12-27T14:00Z'}])),/ha canviat/);
 assert.throws(()=>acceptItinerarySolution(review,solutions[0],c,{now,sourcesReady:false},context),/viabilitat han canviat/);
 assert.deepEqual(proposeItinerarySolutions(c,{now,sourcesReady:false},context),[]);
});
test('RIG04 new trip uses identical combination and viability; conditional plan never becomes fixed',()=>{
 const snapshot={read_only:true,items:[item(0,'Huskies opcionals'),item(1,'Museu') ]},r={existing:[],decisions:[{source_order:0,action:'add'},{source_order:1,action:'add'}],retire:[]};
 const c=combineImportItinerary(snapshot,r,context);assert.equal(c.items[0].timingKind,'approximate');assert.equal(c.items[0].fixed,false);assert.ok(assessCombinedItinerary(c,{now}).issues.some(x=>x.code==='conditional'));
});
test('RIG04 draft route HTTP reuses provider, validates membership, refuses forged coordinates and never reads draft IDs',async()=>{
 let allowed=true,reads=0,routes=0;const h=createRouteHandler({authenticate:async()=>id(3),readTrip:async()=>allowed,readItem:async()=>{reads++;throw Error('unexpected')},readStops:async()=>[{canonical_name:'Riga',country_code:'LV'}],provider:{resolve:async(row,ctx)=>{assert.equal(ctx.city,'Riga');assert.equal(row.latitude,undefined);return {point:{id:row.title,lat:56,lon:24}}},route:async()=>{routes++;return route.route}}});
 const input={kind:'draft',trip_id:id(5),mode:'walk',origin:{draft:{title:'A',location_name:'A',address:'',city:'Riga'}},destination:{draft:{title:'B',location_name:'B',address:'',city:'Riga'}}};
 const request=body=>h(new Request('http://local',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(body)}));
 assert.equal((await request(input)).status,200);assert.equal(reads,0);assert.equal(routes,1);
 assert.equal((await request({...input,origin:{draft:{...input.origin.draft,latitude:56}}})).status,400);
 allowed=false;assert.equal((await request(input)).status,403);assert.equal(routes,1);
});

test('RIG04 review: incomplete duration, approximate time, location and real transport stay pending',()=>{
 for(const change of [{endsAt:null},{timingKind:'approximate'},{location_name:'',address:''},{title:'Bus a Sigulda'}]){
  const a=event('A','10:00','11:00',{location_name:'A',...change});
  const h={verified:true,source:'synthetic',date:a.localDate,timeZone:a.timeZone,place:planningSignature([a.title,a.location_name,a.address,a.city]),checkedAt:new Date(now).toISOString(),intervals:[['2030-12-27T00:00Z','2030-12-28T00:00Z']]};
  assert.equal(assessCombinedItinerary(combined([a]),{openings:{A:h},now}).status,'pending');
 }
 const a=event('A','10:00','11:00'),b=event('B','13:00','14:00');
 assert.ok(assessCombinedItinerary(combined([a,b]),{routes:{[planningRouteKey(a,b)]:{route:{...route.route,duration_seconds:3600}}},now}).issues.some(i=>i.code==='walking_assumption'));
});
test('RIG04 review: >20 pairs advance, failures retry, stale/invalid cache cannot certify or block refresh',async()=>{
 const {calculatePlanningRoutes,planningHtml}=await import('../domain/import-itinerary-planning-ui.mjs');
 const items=Array.from({length:23},(_,i)=>event('pdf:'+i,String(i).padStart(2,'0')+':00',String(i).padStart(2,'0')+':30',{values:{title:'Place '+i,location_name:'Place '+i,city:'Riga'},title:'Place '+i}));
 const a={combined:combined(items),routes:{}},calls=[];
 await calculatePlanningRoutes(a,{tripId:id(5),current:()=>true,online:true,invoke:async input=>{calls.push(input.origin.draft.title);return {error:'no_route'}}});
 assert.equal(calls.length,20);
 await calculatePlanningRoutes(a,{tripId:id(5),current:()=>true,online:true,invoke:async input=>{calls.push(input.origin.draft.title);return {route:{...route.route,calculated_at:new Date().toISOString()}}}});
 assert.deepEqual(calls.slice(20,22),['Place 20','Place 21']);
 const key=planningRouteKey(items[0],items[1]);a.routes[key]={route:{...route.route,calculated_at:new Date().toISOString(),method:'straight_line'}};
 await calculatePlanningRoutes(a,{tripId:id(5),current:()=>true,online:true,invoke:async input=>{calls.push(input.origin.draft.title);return {route:{...route.route,calculated_at:new Date().toISOString()}}}});
 assert.equal(a.routes[key].route.method,'routing');
 const altered={...items[0],title:'Other place'};assert.notEqual(planningRouteKey(altered,items[1]),key);
 a.routes[key].route.calculated_at='2020-01-01T00:00Z';
 const c={...combined(items.slice(0,2)),plan:{rows:[],summary:{preserved:0,new:2}}};
 const html=planningHtml({...a,combined:c,assessment:assessCombinedItinerary(c,{routes:a.routes}),solutions:[],options:{bufferMinutes:5}});
 assert.doesNotMatch(html,/15 min a peu/);assert.match(html,/1 de 1 trams pendents/);
});
test('RIG04 review: draft Edge auth, validation, stale references and rate limits precede provider calls',async()=>{
 let user=null,member=true,count=0;
 const h=createRouteHandler({authenticate:async()=>user,readTrip:async()=>member,readItem:async()=>({trip_id:id(5),updated_at:'old'}),readStops:async()=>[],provider:{resolve:async()=>{count++;return {point:{lat:56,lon:24}}},route:async()=>route.route},maxPerMinute:1});
 const d={draft:{title:'A',location_name:'A',address:'',city:'Riga'}},input={kind:'draft',trip_id:id(5),mode:'walk',origin:d,destination:d};
 const req=body=>h(new Request('http://local',{method:'POST',body:JSON.stringify(body)}));
 assert.equal((await req(input)).status,401);user=id(3);member=false;assert.equal((await req(input)).status,403);member=true;
 assert.equal((await req({...input,origin:{draft:{...d.draft,title:'x'.repeat(201)}}})).status,400);
 assert.equal((await req({...input,origin:{type:'manual',id:id(7),updated_at:'new'}})).status,409);assert.equal(count,0);
 assert.equal((await req(input)).status,200);assert.equal((await req(input)).status,429);assert.equal(count,2);
});

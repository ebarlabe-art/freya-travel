import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const pure=html.split('// TRIP_HOME_PURE_START')[1].split('// TRIP_HOME_PURE_END')[0].replace(/^ —[^\n]*\n/,'');
const context=vm.createContext({Intl,Date});
vm.runInContext(pure,context);
const derive=(snapshot,now)=>context.deriveTripHomeState(snapshot,now);
const trip={id:'a',start_date:'2026-09-10',end_date:'2026-09-12',time_zone:'Europe/Madrid'};
const item=(key,fields={})=>({key,tripId:'a',sourceType:'activity',sourceId:key,sourceEvent:'start',sourceUpdatedAt:'2026-09-01T00:00:00Z',title:key,timingKind:'exact',startsAt:'2026-09-10T10:00:00Z',endsAt:'2026-09-10T11:00:00Z',localDate:'2026-09-10',localOrder:720,status:'confirmed',reservationStatus:fields.status||'confirmed',isCompleted:fields.status==='completed',isCancelled:fields.status==='cancelled',completedAt:null,...fields});
const snapshot=(items=[],fields={})=>({trip,ready:true,items,checklist:[],...fields});
const keys=items=>Array.from(items,item=>item.key);

test('future countdown uses trip calendar dates and next reserved/confirmed item',()=>{
  const value=derive(snapshot([item('planning',{status:'planning',startsAt:'2026-09-10T07:00:00Z'}),item('confirmed')],{checklist:[{text:'pending'},{done:true},{dismissed:true}]}),'2026-09-08T23:00:00Z');
  assert.equal(value.phase,'future');assert.equal(value.daysUntil,1);assert.equal(value.next.key,'confirmed');assert.equal(value.pendingChecklist.length,1);
});
test('active interval includes start and excludes end',()=>{
  assert.deepEqual(keys(derive(snapshot([item('a')]),'2026-09-10T10:00:00Z').current),['a']);
  assert.equal(derive(snapshot([item('a')]),'2026-09-10T11:00:00Z').current.length,0);
});
test('past begins at midnight in the trip timezone, end date is inclusive',()=>{
  assert.equal(derive(snapshot(),'2026-09-12T21:59:59Z').phase,'active');
  assert.equal(derive(snapshot(),'2026-09-12T22:00:00Z').phase,'past');
});
test('invalid dates or timezone require setup instead of device-time fallback',()=>{
  for(const fields of [{time_zone:'bad/zone'},{time_zone:null},{time_zone:undefined},{start_date:null},{start_date:'2026-02-31'},{end_date:'2026-09-01'}])assert.equal(derive(snapshot([],{trip:{...trip,...fields}}),'2026-09-10').phase,'setup');
});
test('opposite timezone can still be before the first trip day',()=>{
  const state=derive(snapshot([],{trip:{...trip,time_zone:'America/Los_Angeles'}}),'2026-09-10T01:00:00Z');
  assert.equal(state.today,'2026-09-09');assert.equal(state.phase,'future');
});
test('DST calendar countdown is not a 24-hour duration calculation',()=>{
  const state=derive(snapshot([],{trip:{...trip,start_date:'2026-03-30',end_date:'2026-03-31'}}),'2026-03-28T23:30:00Z');
  assert.equal(state.daysUntil,1);
});
test('without an end there is never a fabricated current interval',()=>{
  const state=derive(snapshot([item('point',{endsAt:null})]),'2026-09-10T10:30:00Z');
  assert.equal(state.current.length,0);assert.deepEqual(keys(state.points),['point']);
});
test('check-in/out remain points even if inconsistent input includes an end',()=>{
  const state=derive(snapshot([item('check-in',{sourceType:'accommodation'})]),'2026-09-10T10:30:00Z');
  assert.equal(state.current.length,0);assert.equal(state.points.length,1);
});
test('approximate, daypart and all-day keep uncertainty and do not compete for NOW/NEXT',()=>{
  const items=['approximate','daypart','all_day','date'].map(kind=>item(kind,{timingKind:kind,startsAt:null,endsAt:null,timeLabel:kind==='approximate'?'~ 12:00–13:00':'Matí'}));
  const state=derive(snapshot(items),'2026-09-10T10:30:00Z');
  assert.equal(state.current.length,0);assert.equal(state.next,null);assert.equal(state.flexible.length,4);assert.equal(state.flexible[0].timeLabel,'~ 12:00–13:00');
});
test('cancelled and completed stay in day planning but not NOW/NEXT',()=>{
  const state=derive(snapshot([item('cancelled',{status:'cancelled'}),item('completed',{status:'completed'})]),'2026-09-10T09:00:00Z');
  assert.equal(state.next,null);assert.equal(state.current.length,0);assert.equal(state.todayItems.length,2);
});
test('overlapping intervals are all visible, earliest ending first',()=>{
  const state=derive(snapshot([item('long',{endsAt:'2026-09-10T12:00:00Z'}),item('short')]),'2026-09-10T10:30:00Z');
  assert.deepEqual(keys(state.current),['short','long']);
});
test('simultaneous NEXT appointments are not silently hidden',()=>{
  const state=derive(snapshot([item('a'),item('b')]),'2026-09-10T09:00:00Z');
  assert.equal(state.next.key,'a');assert.deepEqual(keys(state.nextCoincidences),['b']);
});
test('undated plans stay undated instead of being assigned to today',()=>{
  const state=derive(snapshot([item('idea',{timingKind:'unscheduled',startsAt:null,endsAt:null,localDate:null})]),'2026-09-10T10:00:00Z');
  assert.equal(state.flexible.length,0);assert.equal(state.unscheduled[0].key,'idea');assert.equal(state.next,null);
});
test('NEXT orders absolute instants, not source local dates or array order',()=>{
  const state=derive(snapshot([item('later',{startsAt:'2026-09-11T00:10:00+14:00',localDate:'2026-09-11'}),item('first',{startsAt:'2026-09-09T23:00:00-10:00',localDate:'2026-09-09'})]),'2026-09-10T08:00:00Z');
  assert.equal(state.next.key,'first');
});
test('overnight exact interval remains current after local midnight',()=>{
  const state=derive(snapshot([item('flight',{sourceType:'flight',startsAt:'2026-09-10T21:00:00Z',endsAt:'2026-09-11T03:00:00Z'})]),'2026-09-11T00:30:00Z');
  assert.equal(state.current[0].key,'flight');assert.equal(state.dayFinished,false);
});
test('day wrap preserves planning and previews next day without asserting completion',()=>{
  const state=derive(snapshot([item('past'),item('tomorrow',{startsAt:'2026-09-11T10:00:00Z',localDate:'2026-09-11'})]),'2026-09-10T20:00:00Z');
  assert.equal(state.dayFinished,true);assert.equal(state.todayItems[0].status,'confirmed');assert.equal(state.nextDay[0].key,'tomorrow');
});
test('partial load must not infer no more events',()=>{
  const state=derive(snapshot([item('partial')],{ready:false,checklist:null}),'2026-09-10T10:30:00Z');
  assert.equal(state.next,null);assert.equal(state.current.length,0);assert.equal(state.dayFinished,false);assert.equal(state.pendingChecklist,null);
});
test('foreign trip items cannot enter the result and selector does not mutate input',()=>{
  const input=snapshot([item('foreign',{tripId:'b'}),item('own')]);const before=JSON.stringify(input);
  const state=derive(input,'2026-09-10T10:30:00Z');assert.deepEqual(keys(state.current),['own']);assert.equal(JSON.stringify(input),before);
});

function loaderHarness(){
  const renders=[],pending=[],calls=[];
  const sandbox=vm.createContext({console,Promise,Map,setInterval,clearInterval,
    document:{addEventListener(){}},window:{addEventListener(){}},
    trip:{id:'a'},session:{user:{id:'u1'}},tripLoadGeneration:1,
    itinerarySourceReady:{},isLondonTrip:()=>sandbox.trip?.experience_key==='london-2026',
    itinerarySourceMarker:(type,id,generation,user)=>`${type}:${user}:${id}:${generation}`,
    itineraryRequestIsCurrent:(id,generation,user)=>sandbox.trip?.id===id&&sandbox.tripLoadGeneration===generation&&sandbox.session?.user?.id===user,
    renderTripHome:()=>renders.push(`${sandbox.session?.user?.id}:${sandbox.trip?.id}:${sandbox.tripLoadGeneration}`),
    scheduleItineraryRebuild:()=>{},loadTripDayMetadata:async()=>[],
    invalidateTripProgressLoads:()=>{},
  });
  for(const [type,name] of [['flight','fetchAgendaFlights'],['activity','fetchAgendaActivities'],['accommodation','fetchAgendaAccommodations'],['manual','fetchAgendaManualItems']])sandbox[name]=()=>{
    const id=sandbox.trip.id,generation=sandbox.tripLoadGeneration,user=sandbox.session.user.id;
    calls.push(type);
    return new Promise(resolve=>pending.push({type,finish:(success=true)=>{
      if(success&&sandbox.itineraryRequestIsCurrent(id,generation,user))sandbox.itinerarySourceReady[type]=sandbox.itinerarySourceMarker(type,id,generation,user);
      resolve([]);
    }}));
  };
  sandbox.itinerarySourcesAreReady=()=>['flight','activity','accommodation','manual'].every(type=>sandbox.itinerarySourceReady[type]===sandbox.itinerarySourceMarker(type,sandbox.trip.id,sandbox.tripLoadGeneration,sandbox.session.user.id));
  const block=html.slice(html.indexOf('let tripHomeTimer='),html.indexOf('function tripHomeSourceRow'));
  vm.runInContext(block,sandbox);
  return {sandbox,renders,pending,calls};
}
test('concurrent Home/Itinerary batch consumers share four source fetches',async()=>{
  const {sandbox,pending,calls}=loaderHarness();
  const one=sandbox.ensureTripAgenda(),two=sandbox.ensureTripAgenda();assert.equal(one,two);assert.equal(calls.length,4);
  pending.forEach(entry=>entry.finish());assert.equal(await one,true);assert.equal(await two,true);
  await sandbox.ensureTripAgenda();assert.equal(calls.length,4);
});
test('realtime/mutation during in-flight fetch queues reconciliation, not a lost event',async()=>{
  const {sandbox,pending,calls}=loaderHarness();
  const first=sandbox.loadActivities(true),second=sandbox.loadActivities(true);assert.equal(first,second);
  pending[0].finish();await new Promise(setImmediate);assert.equal(calls.length,2);
  pending[1].finish();await first;
});
test('failed source makes the shared snapshot incomplete; explicit retry can recover',async()=>{
  const {sandbox,pending}=loaderHarness();const first=sandbox.ensureTripAgenda();pending.forEach(entry=>entry.finish(entry.type!=='flight'));
  assert.equal(await first,false);const second=sandbox.ensureTripAgenda(true);pending.slice(4).forEach(entry=>entry.finish());assert.equal(await second,true);
});
test('old trip/user/generation completions cannot render into the new context',async()=>{
  for(const change of [s=>{s.trip={id:'b'};s.tripLoadGeneration++},s=>{s.session={user:{id:'u2'}}},s=>{s.tripLoadGeneration++},s=>{s.trip=null;s.session=null}]){
    const {sandbox,pending,renders}=loaderHarness();const old=sandbox.ensureTripAgenda();const count=renders.length;
    change(sandbox);pending.forEach(entry=>entry.finish());assert.equal(await old,false);assert.equal(renders.length,count);
  }
});
test('London never invokes generic agenda loaders',async()=>{
  const {sandbox,calls}=loaderHarness();sandbox.trip.experience_key='london-2026';assert.equal(await sandbox.ensureTripAgenda(),false);assert.equal(calls.length,0);
});
test('Home clock only recomputes in memory and shared loading does not consume deep links',()=>{
  const clock=html.slice(html.indexOf('function updateTripHomeClock'),html.indexOf('function itineraryTimeZone'));
  assert.doesNotMatch(clock,/loadFlights|loadActivities|loadDocuments|db\.|setAppView/);
  const batch=html.slice(html.indexOf('function ensureTripAgenda'),html.indexOf('function tripHomeSourceRow'));
  assert.doesNotMatch(batch,/initialViewApplied|pendingInitialRoute|rebuildGenericItinerary/);
  assert.match(html,/context\?\.originView/);
});

function renderHarness(items,options={}){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',querySelectorAll:()=>[]});
    return elements.get(id);
  };
  const NativeDate=Date;
  class Clock extends NativeDate{constructor(value){super(arguments.length?value:'2026-09-10T10:30:00Z')}}
  const sandbox=vm.createContext({
    Intl,Date:Clock,URL,Map,console,
    trip:options.trip||trip,session:{user:{id:'u1'}},tripLoadGeneration:1,
    $:element,isLondonTrip:()=>options.london||false,
    itinerarySourcesAreReady:()=>options.ready!==false,
    normalizedItineraryProjection:()=>items,
    itineraryRequestIsCurrent:()=>true,
    tripHomeChecklist:[],agendaBatch:null,agendaRequests:new Map(),tripHomeAgendaAttempted:true,
    itinerarySourceReady:{flight:'ready'},
    accommodationRows:options.accommodations||[],flightRows:[],activityRows:options.activities||[],manualItineraryRows:[],
    itineraryDocumentsFor:(type,id)=>options.links?.[id]||[],
    accommodationVoucherDocumentId:id=>options.vouchers?.[id]||'',
    activityDocumentId:(id,role)=>options.activityDocuments?.[`${id}:${role}`]||'',
    itineraryStatusLabel:status=>status,
    itinerarySourceLabel:type=>`Obrir ${type}`,
  });
  vm.runInContext(pure,sandbox);
  vm.runInContext(html.split('// TRIP_PROGRESS_START')[1].split('// TRIP_PROGRESS_END')[0].replace(/^ —[^\n]*\n/,''),sandbox);
  vm.runInContext(html.match(/^function esc\(s\).*$/m)[0],sandbox);
  vm.runInContext(html.slice(html.indexOf('function safeWebsiteUrl'),html.indexOf('function compactLocationParts')),sandbox);
  vm.runInContext(html.slice(html.indexOf('function tripHomeSourceRow'),html.indexOf('function updateTripHomeClock')),sandbox);
  sandbox.renderTripHome();
  return {sandbox,elements,content:element('tripHomeContent').innerHTML};
}
test('render uses authoritative voucher ID and actual accommodation contact columns',()=>{
  const {content}=renderHarness([item('stay',{sourceType:'accommodation',endsAt:null,startsAt:'2026-09-10T12:00:00Z',timeLabel:'14:00',subtitle:'Address'})],{
    accommodations:[{id:'stay',trip_id:'a',phone:'+34 123',website_url:'https://hotel.example',notes:'<script>bad</script>'}],
    links:{stay:[{role:'voucher',label:'Voucher'}]},vouchers:{stay:'real-document-id'},
  });
  assert.match(content,/data-home-document="real-document-id"/);assert.match(content,/href="tel:\+34123"/);
  assert.match(content,/href="https:\/\/hotel.example\/"/);assert.doesNotMatch(content,/<script>bad/);assert.match(content,/&lt;script&gt;/);
});
test('render shows booking and ticket IDs separately and rejects unsafe website protocols',()=>{
  const {content}=renderHarness([item('activity')],{
    activities:[{id:'activity',trip_id:'a',contact_phone:'123',website_url:'javascript:alert(1)'}],
    links:{activity:[{role:'booking',label:'Reserva'},{role:'ticket',label:'Entrada'}]},
    activityDocuments:{'activity:booking':'booking-id','activity:ticket':'ticket-id'},
  });
  assert.match(content,/data-home-document="booking-id"/);assert.match(content,/data-home-document="ticket-id"/);assert.doesNotMatch(content,/href="javascript:/);
});
test('partial render has no authoritative NOW/NEXT card and offers retry',()=>{
  const {content}=renderHarness([item('would-be-current')],{ready:false});
  assert.match(content,/No tenim tota l’agenda/);assert.match(content,/data-home-retry/);assert.doesNotMatch(content,/would-be-current/);
});
test('past render offers existing gallery/planning, never fictitious album creation',()=>{
  const {content}=renderHarness([],{trip:{...trip,end_date:'2026-09-09',start_date:'2026-09-08'}});
  assert.match(content,/Un viatge per recordar/);assert.match(content,/data-home-view="photosView"/);assert.doesNotMatch(content,/Crear àlbum/);
});
test('London render leaves Home untouched',()=>{
  const {content}=renderHarness([item('a')],{london:true});assert.equal(content,'');
});
test('completed Home card stays visible in Fet avui with undo and a distinct reservation badge',()=>{
  const {content}=renderHarness([item('done',{isCompleted:true,completedAt:'2026-09-10T10:15:00Z'})]);
  assert.match(content,/<h3>Fet avui<\/h3>/);assert.match(content,/Desfer/);assert.match(content,/trip-progress-badge/);assert.match(content,/generic-itinerary-status confirmed/);assert.doesNotMatch(content,/ARA · previst/);
});
test('past trip still exposes completed items and undo, not just gallery',()=>{
  const {content}=renderHarness([item('done',{isCompleted:true,completedAt:'2026-09-09T10:15:00Z'})],{trip:{...trip,start_date:'2026-09-08',end_date:'2026-09-09'}});
  assert.match(content,/Altres elements fets/);assert.match(content,/Desfer/);assert.match(content,/Fotos del viatge/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const block=name=>html.split(`// ${name}_START`)[1].split(`// ${name}_END`)[0].replace(/^ —[^\n]*\n/,'');
const pure=vm.createContext({Intl,Date});vm.runInContext(block('TRIP_HOME_PURE'),pure);
const trip={id:'a',time_zone:'Europe/Madrid',start_date:'2026-09-10',end_date:'2026-09-12'};
const base={key:'activity:one:start',tripId:'a',sourceType:'activity',sourceId:'one',sourceEvent:'start',sourceUpdatedAt:'v1',title:'Plan',timingKind:'exact',startsAt:'2026-09-10T10:00:00Z',endsAt:'2026-09-10T11:00:00Z',localDate:'2026-09-10',status:'confirmed',reservationStatus:'confirmed',isCompleted:false,isCancelled:false,completedAt:null};
const derive=items=>pure.deriveTripHomeState({trip,ready:true,items,checklist:[]},'2026-09-10T10:30:00Z');
test('all canonical source progress is independent from commercial reservation',()=>{
  for(const [sourceType,sourceEvent,column] of [['activity','start','completed_at'],['flight','departure','completed_at'],['accommodation','check_in','check_in_completed_at'],['accommodation','check_out','check_out_completed_at']]){
    const item={...base,sourceType,sourceEvent};
    const row={reservation_status:'confirmed',flight_status:'confirmed',[column]:'2026-09-10T10:15:00Z'};
    const value=pure.normalizedTripProgress(item,row);
    assert.equal(value.reservationStatus,'confirmed');assert.equal(value.isCompleted,true);assert.equal(value.completedAt,row[column]);assert.equal(value.isCancelled,false);
    const undone=pure.normalizedTripProgress(item,{...row,[column]:null});assert.equal(undone.isCompleted,false);
  }
});
test('check-in and check-out are independent in the normalized projection',()=>{
  const row={reservation_status:'confirmed',check_in_completed_at:'2026-09-10T10:00:00Z',check_out_completed_at:null};
  assert.equal(pure.normalizedTripProgress({...base,sourceType:'accommodation',sourceEvent:'check_in'},row).isCompleted,true);
  assert.equal(pure.normalizedTripProgress({...base,sourceType:'accommodation',sourceEvent:'check_out'},row).isCompleted,false);
});
test('manual completed reuses status without inventing a reservation or done timestamp',()=>{
  const item=pure.normalizedTripProgress({...base,sourceType:'manual'},{status:'completed',updated_at:'2026-09-10T10:30:00Z'});
  assert.equal(item.isCompleted,true);assert.equal(item.completedAt,null);assert.equal(item.reservationStatus,null);
});
test('done leaves NOW/NEXT but remains in Fet avui; undo restores eligibility',()=>{
  const done={...base,isCompleted:true,completedAt:'2026-09-10T10:15:00Z'};
  const state=derive([done]);assert.equal(state.current.length,0);assert.equal(state.next,null);assert.equal(state.completedToday[0].key,base.key);
  assert.equal(derive([base]).current[0].key,base.key);
  const next={...done,startsAt:'2026-09-10T12:00:00Z'};assert.equal(derive([next]).next,null);
});
test('old/manual/unscheduled completion never disappears without trace',()=>{
  const state=derive([{...base,isCompleted:true,localDate:'2026-09-09',startsAt:null,timingKind:'unscheduled',sourceType:'manual'}, {...base,key:'undated',isCompleted:true,localDate:null,startsAt:null,timingKind:'unscheduled',completedAt:'2026-09-10T10:00:00Z'}]);
  assert.equal(state.completedOther.length,1);assert.equal(state.completedToday.length,1);
});
test('completedAt day uses trip timezone, not UTC/device day',()=>{
  const state=derive([{...base,isCompleted:true,completedAt:'2026-09-09T23:00:00Z'}]);assert.equal(state.completedToday.length,1);
});
test('past is unmarked, never automatically completed; cancelled does not compete',()=>{
  const past={...base,endsAt:'2026-09-10T10:10:00Z'};
  const state=derive([past,{...base,key:'cancelled',isCancelled:true}]);
  assert.equal(state.pastUnmarked.length,1);assert.equal(state.completedToday.length,0);assert.equal(state.current.length,0);assert.equal(past.isCompleted,false);
});
test('an overnight interval still happening is not mislabeled as past',()=>{
  const state=derive([{...base,startsAt:'2026-09-09T21:00:00Z',endsAt:'2026-09-10T12:00:00Z'}]);
  assert.equal(state.current.length,1);assert.equal(state.pastUnmarked.length,0);
});
test('optional flexible done items retain tags and stay out of plans still to do',()=>{
  const optional={...base,timingKind:'approximate',timeLabel:'~ 12:00',tags:['Opcional','Flexible'],isCompleted:true};
  const state=derive([optional]);assert.equal(state.flexible.length,0);assert.equal(state.completedToday[0].tags[0],'Opcional');
});

function harness(){
  const requests=[],loads=[],messages=[],renders=[],invalidations=[];
  const row={id:'one',trip_id:'a',updated_at:'v1',completed_at:null};
  const sandbox=vm.createContext({console,Map,Date,Promise,
    trip:{...trip},session:{user:{id:'u1'}},tripLoadGeneration:1,
    activityLoadSequence:0,flightLoadSequence:0,accommodationLoadSequence:0,manualItineraryLoadSequence:0,
    isLondonTrip:()=>sandbox.trip?.experience_key==='london-2026',
    itineraryRequestIsCurrent:(id,generation,user)=>sandbox.trip?.id===id&&sandbox.tripLoadGeneration===generation&&sandbox.session?.user?.id===user,
    itinerarySourcesAreReady:()=>true,
    tripHomeSourceRow:()=>row,
    msg:(...args)=>messages.push(args),scheduleItineraryRebuild:()=>renders.push({...row}),
    db:{rpc:(name,args)=>new Promise((resolve,reject)=>requests.push({name,args,resolve,reject}))},
    esc:String,itineraryStatusLabel:String,
  });
  for(const [type,name] of [['activity','loadActivities'],['flight','loadFlights'],['accommodation','loadAccommodations'],['manual','loadManualItineraryItems']])sandbox[name]=async()=>{loads.push(type);invalidations.push(sandbox.activityLoadSequence);return []};
  vm.runInContext(block('TRIP_PROGRESS'),sandbox);
  return {sandbox,requests,loads,messages,renders,row,invalidations};
}
const success=(completed=true,version='v2')=>({data:{trip_id:'a',source_id:'one',is_completed:completed,updated_at:version,row:{id:'one',trip_id:'a',updated_at:version,completed_at:completed?'2026-09-10T10:30:00Z':null}}});
test('one tap sends an explicit desired value, trip and exact CAS baseline; repeat tap coalesces',async()=>{
  const h=harness();const pending=h.sandbox.setTripEventCompleted(base,true,'message');
  await h.sandbox.setTripEventCompleted(base,true,'message');assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].name,'set_trip_event_completed');assert.equal(h.requests[0].args.p_completed,true);assert.equal(h.requests[0].args.p_trip_id,'a');assert.equal(h.requests[0].args.p_expected_updated_at,'v1');
  h.requests[0].resolve(success());await pending;assert.equal(h.row.updated_at,'v2');assert.equal(h.loads.length,1);assert.equal(h.invalidations[0],1);
  const undo=h.sandbox.setTripEventCompleted({...base,sourceUpdatedAt:'v2',isCompleted:true},false,'message');assert.equal(h.requests[1].args.p_completed,false);h.requests[1].resolve(success(false,'v3'));await undo;assert.equal(h.row.completed_at,null);
});
test('a later RPC response cannot replace a newer Realtime row',async()=>{
  const h=harness();const pending=h.sandbox.setTripEventCompleted(base,true,'message');h.row.updated_at='v3';h.row.completed_at=null;
  h.requests[0].resolve(success());await pending;assert.equal(h.row.updated_at,'v3');assert.equal(h.row.completed_at,null);assert.equal(h.loads.length,1);
});
test('a pre-event in-flight source fetch cannot paint after Realtime queues a newer refresh',async()=>{
  const h=harness(),pending=[];const s=h.sandbox;
  s.renderTripHome=()=>{};s.itinerarySourceReady={};
  s.itinerarySourceMarker=(type,id,generation,user)=>`${type}:${id}:${generation}:${user}`;
  s.fetchAgendaActivities=()=>{
    const sequence=++s.activityLoadSequence;
    return new Promise(resolve=>pending.push(data=>{if(sequence===s.activityLoadSequence)Object.assign(h.row,data);resolve([])}));
  };
  vm.runInContext(html.slice(html.indexOf('let tripHomeTimer='),html.indexOf('function tripHomeSourceRow')),s);
  const first=s.loadActivities(true);s.loadActivities(true);
  pending[0]({updated_at:'stale',completed_at:null});await new Promise(setImmediate);
  assert.equal(h.row.updated_at,'v1');assert.equal(pending.length,2);
  pending[1]({updated_at:'newest',completed_at:'2026-09-10T10:00:00Z'});await first;assert.equal(h.row.updated_at,'newest');
});
test('conflict reloads source and requires a new user decision, never automatic retry',async()=>{
  const h=harness();const pending=h.sandbox.setTripEventCompleted(base,true,'message');h.requests[0].resolve({error:{code:'40001'}});await pending;
  assert.equal(h.requests.length,1);assert.equal(h.loads.length,1);assert.match(h.messages.at(-1)[1],/ha canviat/);assert.equal(h.row.updated_at,'v1');
});
test('late success/error/throw after trip, user, generation or logout cannot mutate visible state',async()=>{
  for(const change of [s=>s.trip={id:'b'},s=>s.session={user:{id:'u2'}},s=>s.tripLoadGeneration++,s=>{s.trip=null;s.session=null}]){
    for(const outcome of ['success','error','throw']){
      const h=harness();const pending=h.sandbox.setTripEventCompleted(base,true,'message');const count=h.messages.length,renderCount=h.renders.length;change(h.sandbox);
      if(outcome==='throw')h.requests[0].reject(new Error('offline'));else h.requests[0].resolve(outcome==='error'?{error:{code:'40001'}}:success());
      await pending;assert.equal(h.messages.length,count);assert.equal(h.renders.length,renderCount);assert.equal(h.loads.length,0);assert.equal(h.row.updated_at,'v1');
    }
  }
});
test('switch during follow-up load suppresses late messages and renders',async()=>{
  const h=harness();let finish;h.sandbox.loadActivities=()=>new Promise(resolve=>{finish=resolve});
  const pending=h.sandbox.setTripEventCompleted(base,true,'message');h.requests[0].resolve(success());await new Promise(setImmediate);
  h.sandbox.trip={id:'b'};const n=h.renders.length,m=h.messages.length;finish([]);await pending;assert.equal(h.renders.length,n);assert.equal(h.messages.length,m);
});
test('London and cancelled mark-done never invoke RPC; cancelled done may be undone',async()=>{
  const h=harness();h.sandbox.trip.experience_key='london-2026';await h.sandbox.setTripEventCompleted(base,true,'message');assert.equal(h.requests.length,0);
  h.sandbox.trip.experience_key=null;await h.sandbox.setTripEventCompleted({...base,isCancelled:true},true,'message');assert.equal(h.requests.length,0);
  assert.equal(h.sandbox.tripProgressButton({...base,isCancelled:true}),'');
  assert.match(h.sandbox.tripProgressButton({...base,isCompleted:true,isCancelled:true}),/Desfer/);
});
test('failure preserves state and releases busy control',async()=>{
  const h=harness();const pending=h.sandbox.setTripEventCompleted(base,true,'message');assert.match(h.sandbox.tripProgressButton(base),/disabled/);
  h.requests[0].reject(new Error('network'));await pending;assert.equal(h.row.updated_at,'v1');assert.doesNotMatch(h.sandbox.tripProgressButton(base),/disabled/);assert.match(h.messages.at(-1)[1],/Refresca/);
});
test('version-only changes invalidate cached Home controls and preserve fresh CAS baselines',()=>{
  const h=harness();const one=h.sandbox.tripProgressButton(base),two=h.sandbox.tripProgressButton({...base,sourceUpdatedAt:'v2'});
  assert.notEqual(one,two);assert.match(two,/data-progress-version="v2"/);
});
test('detached button from trip A cannot act for trip B',()=>{
  const h=harness(),button={dataset:{tripProgress:base.key,completed:'true'}};
  h.sandbox.bindTripProgress({querySelectorAll:()=>[button]},[base],'message');h.sandbox.trip={id:'b'};button.onclick();assert.equal(h.requests.length,0);
});
test('Itinerary renders completion separately without removing reservation, optional or undo',()=>{
  const h=harness();h.sandbox.itinerarySourceLabel=String;
  vm.runInContext(html.slice(html.indexOf('function renderItineraryItem'),html.indexOf('function bindItineraryActions')),h.sandbox);
  const markup=h.sandbox.renderItineraryItem({...base,isCompleted:true,details:[],documents:[],icon:'📝',tags:['Opcional','Flexible']});
  for(const text of ['trip-progress-done','confirmed','trip-progress-badge','✓ Fet','Desfer','Opcional','Flexible'])assert.ok(markup.includes(text),text);
});
test('projection uses canonical progress; migration is additive and universal reminder filters are present',()=>{
  const projection=html.slice(html.indexOf('function normalizedItineraryProjection'),html.indexOf('function itineraryStatusLabel'));
  assert.match(projection,/normalizedTripProgress/);
  const sql=readFileSync(new URL('../supabase/migrations/20260918174037_shared_trip_progress.sql',import.meta.url),'utf8');
  for(const field of ['flight.completed_at','activity.completed_at','accommodation.check_in_completed_at','accommodation.check_out_completed_at'])assert.equal(sql.split(`${field} is null`).length-1,2);
  assert.doesNotMatch(sql,/create or replace function public.sync_notification_deliveries|alter table public.itinerary_activities/);
});

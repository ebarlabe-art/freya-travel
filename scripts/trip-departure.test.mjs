import test from 'node:test';
import assert from 'node:assert/strict';
import {departurePlan,departureEstimate,deviceRouteOrigin,DEFAULT_MARGIN} from '../domain/trip-departure.mjs';
import {createRouteHandler} from '../supabase/functions/itinerary-route/handler.mjs';
import {routeProvider} from '../supabase/functions/itinerary-route/provider.mjs';

const now=Date.parse('2030-03-31T00:50:00Z');
const date=delta=>new Date(now+delta*60000).toISOString();
const trip='12000000-0000-4000-8000-000000000001',a='12000000-0000-4000-8000-000000000002',
 b='12000000-0000-4000-8000-000000000003';
const point={latitude:41.386,longitude:2.17};
const visit=(key,start,extra={})=>({key,sourceType:'activity',sourceId:key,sourceUpdatedAt:date(-120),
 startsAt:date(start),timingKind:'exact',timeZone:'Europe/Madrid',...extra});
const row=(item,extra={})=>({updated_at:item.sourceUpdatedAt,title:'Museum',...point,...extra});
const route=(mode='walk',patch={})=>({route:{method:'routing',mode,distance_m:900,duration_seconds:590,
 calculated_at:date(0),origin:point,destination:{latitude:41.39,longitude:2.18},...patch}});

test('selects the next verified candidate without treating a completed visit, transport, fuzzy time or provisional date as next',()=>{
 const previous=visit('previous',-20,{endsAt:date(5),isCompleted:true});
 const targets=[
  visit('cancelled',1,{isCancelled:true}),visit('completed',2,{isCompleted:true}),
  visit('walk',3,{timingKind:'approximate'}),visit('fixedDate',4,{overnightCorrectionDate:'2030-03-31'}),
  visit('missing',5),visit('transport',8),visit('target',15),visit('later',20),previous
 ];
 const readRow=item=>item.key==='missing'?{updated_at:item.sourceUpdatedAt}:
  row(item,item.key==='transport'?{activity_type:'transport'}:{});
 const plan=departurePlan(targets,readRow,now);
 assert.equal(plan.destination.key,'target');assert.equal(plan.previous,previous);
 assert.ok(plan.options.some(item=>item.key==='later'));
 assert.equal(departurePlan([visit('missing',5)],readRow,now),null);
 assert.equal(departurePlan(targets.filter(item=>item.key!=='missing').concat(visit('unknownEarlier',-2)),
  item=>item.key==='unknownEarlier'?{updated_at:item.sourceUpdatedAt}:readRow(item),now).previous,null);
});

test('departure, usable slack and the three alerts account for the buffer, previous end and DST',()=>{
 const item=visit('next',45);
 const good=departureEstimate(item,route(),'walk',DEFAULT_MARGIN,now);
 assert.equal(good.status,'onTime');
 assert.equal(good.duration,10);
 assert.equal(good.minutes,25);
 // The interval crosses the Madrid DST transition. Compute on instants, then format the local time.
 assert.equal(new Date(good.leaveBy).toISOString(),'2030-03-31T01:15:10.000Z');
 assert.equal(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:item.timeZone}).format(good.leaveBy),'03:15');
 assert.equal(departureEstimate(item,route(),'walk',DEFAULT_MARGIN,now,now+20*60000).status,'soon');
 assert.equal(departureEstimate(item,route(),'walk',DEFAULT_MARGIN,now,now+40*60000).status,'late');
 assert.equal(new URL(good.url).searchParams.get('travelmode'),'walking');
 for(const bad of [null,route('drive'),route('walk',{calculated_at:date(-6)}),route('walk',{duration_seconds:null}),
  route('walk',{origin:{latitude:null,longitude:0}})])assert.equal(departureEstimate(item,bad,'walk',10,now),null);
 assert.equal(departureEstimate(item,route(),'walk',181,now),null);
});

test('one-time location requests fail closed on denied, stale and inaccurate positions',async()=>{
 let calls=0;
 const valid={getCurrentPosition(ok,_bad,options){
  calls++;assert.equal(options.maximumAge,0);ok({timestamp:now,coords:{...point,accuracy:20}});
 }};
 assert.deepEqual(await deviceRouteOrigin(valid,()=>now),{type:'device',...point});
 assert.equal(calls,1);
 for(const [geo,message] of [
  [{getCurrentPosition(_ok,bad){bad({code:1})}},'locationDenied'],
  [{getCurrentPosition(ok){ok({timestamp:now,coords:{...point,accuracy:400}})}},'locationInaccurate'],
  [{getCurrentPosition(ok){ok({timestamp:now-61000,coords:{...point,accuracy:10}})}},'locationInaccurate'],
  [null,'locationUnavailable']
 ])await assert.rejects(deviceRouteOrigin(geo,()=>now),new RegExp(message));
});

const ref=id=>({type:'activity',id,updated_at:date(-120)});
const device={type:'device',...point};
function fixture(overrides={}){
 const routes=[],reads=[];
 const h=createRouteHandler({
  authenticate:async auth=>auth==='Bearer fixture'?'traveler':null,
  readTrip:async(_auth,id)=>id===trip,
  readStops:async()=>[],
  readItem:async(_auth,id,r)=>{reads.push(r.id);return {trip_id:id,updated_at:date(-120)}},
  provider:{resolve:async()=>({point:{id:'museum',label:'Museum',lat:41.39,lon:2.18}}),
   route:async(origin,_destination,mode,options)=>{routes.push({origin,options});return route(mode).route}},
  ...overrides
 });
 const invoke=(patch={},auth='Bearer fixture')=>h(new Request('https://fixture.test',{
  method:'POST',headers:{authorization:auth},body:JSON.stringify({kind:'departure',trip_id:trip,origin:device,destination:ref(b),mode:'walk',...patch})
 }));
 return {invoke,routes,reads};
}

test('GPS is only accepted for the authorized departure contract and never cached by the provider',async()=>{
 const f=fixture();
 assert.equal((await f.invoke({},'Bearer invalid')).status,401);
 assert.equal((await f.invoke({trip_id:a})).status,403);
 assert.equal((await f.invoke({kind:'other'})).status,400);
 assert.equal((await f.invoke({origin:{...device,latitude:91}})).status,400);
 assert.equal((await f.invoke({origin:{...device,notes:'private'}})).status,400);
 assert.equal((await f.invoke({destination:device})).status,400);
 assert.equal((await f.invoke({destination:{...ref(b),updated_at:'old'}})).status,409);
 assert.equal(f.routes.length,0);
 assert.equal((await f.invoke({kind:'draft',origin:{...device,type:'selected'}})).status,400);
 f.reads.length=0;
 assert.equal((await f.invoke()).status,200);
 assert.deepEqual(f.reads,[b]);
 assert.equal(f.routes[0].origin.lat,point.latitude);
 assert.equal(f.routes[0].options.cache,false);
 assert.equal((await f.invoke({origin:ref(a),mode:'drive'})).status,200);
 assert.equal(f.routes[1].options.cache,true);
 assert.equal((await f.invoke({origin:{...device,type:'selected'}})).status,200);
 assert.equal(f.routes[2].options.cache,false);
 const far=fixture({readItem:async()=>({trip_id:a,updated_at:date(-120)})});
 assert.equal((await far.invoke()).status,403);assert.equal(far.routes.length,0);
});

test('the departure contract rejects a representative point before routing',async()=>{
 const f=fixture({provider:{resolve:async()=>({point:{label:'Town',approximate:true}}),
  route:async()=>assert.fail('A town centroid cannot be used as an arrival point')}});
 const result=await(await f.invoke()).json();
 assert.equal(result.destination.error,'approximate_place');assert.equal(result.route,undefined);
});

test('the provider bypasses its memo for device coordinates while keeping the existing route memo',async()=>{
 let calls=0;
 const p=routeProvider({key:'fixture',spacingMs:0,now:()=>now,fetcher:async()=>{
  calls++;return Response.json({features:[{geometry:{type:'MultiLineString',coordinates:[[[2.17,41.386],[2.18,41.39]]]},
   properties:{mode:'walk',distance:900,distance_units:'meters',time:590}}]});
 }});
 const from={id:'device',lat:41.386,lon:2.17},to={id:'visit',lat:41.39,lon:2.18};
 await p.route(from,to,'walk',{cache:false});await p.route(from,to,'walk',{cache:false});
 assert.equal(calls,2);
 await p.route(from,to,'walk');await p.route(from,to,'walk');
 assert.equal(calls,3);
});

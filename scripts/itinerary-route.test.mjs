import test from 'node:test';
import assert from 'node:assert/strict';
import {visitPairs,routeFeasibility,RouteQueue} from '../domain/itinerary-route.mjs';
import {routeProvider,destinationContext} from '../supabase/functions/itinerary-route/provider.mjs';
import {createRouteHandler} from '../supabase/functions/itinerary-route/handler.mjs';
import {routeBackend} from '../supabase/functions/itinerary-route/backend.mjs';
const tid='11800000-0000-4000-8000-000000000001',aId='11800000-0000-4000-8000-000000000002',bId='11800000-0000-4000-8000-000000000003';
const visit=(id,extra={})=>({tripId:tid,key:'manual:'+id,sourceType:'manual',sourceId:id,sourceUpdatedAt:'v1',localDate:'2030-03-31',timingKind:'exact',startsAt:'2030-03-31T08:00:00Z',endsAt:'2030-03-31T09:00:00Z',...extra});
const route={method:'routing',duration_seconds:600};
test('pairs reuse visible order, skip cancellations, retain optional/fixed/daypart and stop at other reservations',()=>{
 const a=visit(aId,{tags:['Opcional']}),b=visit(bId,{timingKind:'daypart',tags:['Fix']});
 const pairs=visitPairs([a,visit('cancel',{isCancelled:true}),b],tid,a.localDate);assert.equal(pairs.length,1);assert.equal(pairs[0].origin,a);assert.equal(pairs[0].destination,b);
 for(const barrier of [{sourceType:'flight'},{sourceType:'accommodation'},{sourceType:'activity',isTransport:true}])assert.equal(visitPairs([a,visit('barrier',barrier),b],tid,a.localDate).length,0);
 assert.equal(visitPairs([a,{...b,tripId:'another'}],tid,a.localDate).length,0);assert.equal(visitPairs([a,{...b,localDate:'2030-04-01'}],tid,a.localDate).length,0);
});
test('feasibility uses real instants including DST, explicit margin, route and known end',()=>{
 const a=visit(aId),b=visit(bId,{startsAt:'2030-03-31T09:20:00Z'});
 assert.equal(routeFeasibility(a,b,route,5).status,'Factible amb marge estimat');assert.equal(routeFeasibility(a,b,route,15).status,'Molt ajustat');
 assert.equal(routeFeasibility(a,{...b,startsAt:'2030-03-31T08:50:00Z'},route,5).status,'No factible');
 for(const [first,next,r,margin]of [[{...a,endsAt:null},b,route,5],[a,b,null,5],[a,b,route,null],[{...a,timingKind:'approximate'},b,route,5],[a,{...b,timingKind:'daypart'},route,5],[a,{...b,timingKind:'unscheduled'},route,5],[{...a,endsAt:'2030-03-31T09:00:00'},b,route,5]])assert.equal(routeFeasibility(first,next,r,margin).status,'Dades insuficients');
 const dst=routeFeasibility({...a,startsAt:'2030-03-31T00:30:00+01:00',endsAt:'2030-03-31T01:50:00+01:00'},{...b,startsAt:'2030-03-31T03:20:00+02:00'},route,5);assert.equal(dst.gapMinutes,30);
});
const places=[{name:'Museum A',formatted:'Museum A, Bologna',city:'Bologna',country_code:'it',result_type:'amenity',place_id:'A',lat:44.49,lon:11.34},{name:'Museum B',formatted:'Museum B, Bologna',city:'Bologna',country_code:'it',result_type:'amenity',place_id:'B',lat:44.5,lon:11.35}];
const geo=p=>({results:p});
const result=mode=>({features:[{geometry:{type:'MultiLineString',coordinates:[[[11.34,44.49],[11.35,44.5]]]},properties:{mode,distance:1200,distance_units:'meters',time:900}}]});
function provider(overrides={}){
 const calls=[];const fetcher=async url=>{calls.push(url);assert.equal(url.searchParams.get('apiKey'),'server-secret');return Response.json(url.pathname.endsWith('/routing')?result(url.searchParams.get('mode')):geo([places[url.searchParams.get('text').includes('Museum B')?1:0]]))};
 return {calls,p:routeProvider({key:'server-secret',fetcher,spacingMs:0,...overrides})};
}
const ctx={city:'Bologna',country:'it'};
test('HTTP routing contract walk/drive/transit: real route geometry, metric values, no straight-line fallback; brief cache and mode key',async()=>{
 const {p,calls}=provider(),a=(await p.resolve({location_name:'Museum A'},ctx)).point,b=(await p.resolve({venue_name:'Museum B'},ctx)).point;
 for(const mode of ['walk','drive','transit']){const r=await p.route(a,b,mode);assert.equal(r.method,'routing');assert.equal(r.distance_m,1200);assert.equal(r.duration_seconds,900);assert.equal(r.mode,mode);if(mode==='transit')assert.match(r.quality,/sense horaris/);await p.route(a,b,mode)}
 assert.equal(calls.length,5);assert.equal(calls[2].searchParams.get('waypoints'),'44.49,11.34|44.5,11.35');
});
test('geocoding never confirms ambiguous, wrong city/country, broad or inexact first result; manual choice rechecked',async()=>{
 assert.equal(destinationContext({city:'Bologna'},[{canonical_name:'Riga',country_code:'LV'}]),null);
 assert.equal(destinationContext({},[{canonical_name:'Bologna',country_code:'IT'},{canonical_name:'Riga',country_code:'LV'}]),null);
 for(const patch of [{city:'Riga'},{country_code:'lv'},{result_type:'city'},{lat:null}]){
  const {p}=provider({fetcher:async()=>Response.json(geo([{...places[0],...patch}]))});assert.equal((await p.resolve({location_name:'Museum A'},ctx)).error,'no_match');
 }
 const {p}=provider({fetcher:async()=>Response.json(geo([places[0],{...places[0],place_id:'other',name:'Museum Annex'}]))});
 assert.equal((await p.resolve({location_name:'Museum A'},ctx)).error,'ambiguous');assert.equal((await p.resolve({location_name:'Museum A'},ctx,'A')).point.id,'A');assert.equal((await p.resolve({location_name:'Museum A'},ctx,'forged')).error,'ambiguous');
 assert.equal((await p.resolve({},ctx)).error,'missing_place');assert.equal((await p.resolve({location_name:'Museum A'},null)).error,'missing_context');
});
test('HTTP 429, timeout, unavailable transit and malformed routes never manufacture a result',async()=>{
 for(const [fetcher,expected]of [[async()=>new Response('',{status:429}),'rate_limited'],[async()=>{throw Error('timeout')},'provider_unavailable'],[async()=>new Response('',{status:400}),'mode_unavailable'],[async()=>Response.json({features:[]}),'no_route'],[async()=>Response.json({features:[{properties:{time:12,distance:12},geometry:{}}]}),'invalid_response']]){
  const {p}=provider({fetcher});await assert.rejects(p.route({id:'A',lat:44,lon:11},{id:'B',lat:45,lon:12},'transit'),new RegExp(expected));
 }
});
test('provider quota counts HTTP calls, cache expires and errors are not cached',async()=>{
 let now=0;const {p,calls}=provider({now:()=>now,maxCalls:2});const a={id:'A',lat:44,lon:11},b={id:'B',lat:45,lon:12};await p.route(a,b,'walk');await p.route(a,b,'walk');assert.equal(calls.length,1);now=300001;await p.route(a,b,'walk');await assert.rejects(p.route(a,b,'drive'),/rate_limited/);now=86400000;await p.route(a,b,'drive');assert.equal(calls.length,3);
});
function handler(options={}){
 const {p,calls}=provider();let allowed=true;
 const h=createRouteHandler({authenticate:async auth=>auth==='Bearer good'?'user':null,readTrip:async()=>allowed,readStops:async()=>[{canonical_name:'Bologna',country_code:'IT'}],readItem:async(_auth,t,r)=>({id:r.id,trip_id:t,location_name:r.id===aId?'Museum A':'Museum B',updated_at:'v1',city:'Bologna'}),provider:p,...options});
 const invoke=(patch={},auth='Bearer good')=>h(new Request('https://local',{method:'POST',headers:{authorization:auth},body:JSON.stringify({trip_id:tid,origin:{type:'manual',id:aId,updated_at:'v1'},destination:{type:'manual',id:bId,updated_at:'v1'},mode:'walk',...patch})}));
 return {invoke,calls,deny:()=>allowed=false};
}
test('membership is rechecked before cached lookup, unauthorized/cross-trip sources and stale rows denied',async()=>{
 const h=handler();assert.equal((await h.invoke({},'Bearer bad')).status,401);assert.equal(h.calls.length,0);assert.equal((await h.invoke()).status,200);h.deny();assert.equal((await h.invoke()).status,403);assert.equal(h.calls.length,3);
 const other=handler({readItem:async()=>({trip_id:'another',updated_at:'v1'})});assert.equal((await other.invoke()).status,403);assert.equal(other.calls.length,0);
 const stale=handler();assert.equal((await stale.invoke({origin:{type:'manual',id:aId,updated_at:'old'}})).status,409);assert.equal(stale.calls.length,0);
 const limited=handler({maxPerMinute:1});await limited.invoke();assert.equal((await limited.invoke()).status,429);
});
test('backend forwards caller JWT with trip AND item filters; reads only necessary fields',async()=>{
 const calls=[];const b=routeBackend({url:'https://local',anon:'anon',fetcher:async(url,options)=>{calls.push({url,options});return Response.json([{id:aId}])}});
 await b.readItem('Bearer user',tid,{type:'manual',id:aId});const c=calls[0];assert.equal(c.options.headers.Authorization,'Bearer user');assert.equal(c.url.searchParams.get('trip_id'),'eq.'+tid);assert.equal(c.url.searchParams.get('id'),'eq.'+aId);assert.doesNotMatch(c.url.searchParams.get('select'),/notes|booking|contact|payment|\*/);
});
test('queue bounds parallel requests, shares pending/cache, invalidates user/trip and avoids offline calls',async()=>{
 let pending=[],calls=0,now=0;const q=new RouteQueue({now:()=>now,invoke:()=>{calls++;return new Promise(r=>pending.push(r))},max:3});
 const a=q.request('a',{}),duplicate=q.request('a',{}),b=q.request('b',{}),c=q.request('c',{});assert.equal(calls,2);pending.shift()({status:'ready'});await a;assert.equal(calls,3);pending.shift()({status:'ready'});pending.shift()({status:'ready'});await Promise.all([duplicate,b,c]);assert.equal((await q.request('d',{})).error,'limit');await q.request('a',{});assert.equal(calls,3);assert.equal((await q.request('e',{},{online:false})).error,'offline');
 now=60000;q.reset('another-user-trip');const stale=q.request('a',{});q.reset('third-user');pending.shift()({route:{}});assert.equal((await stale).error,'stale_record');assert.equal(q.entries.size,0);
});
test('queue circuit breaker stops remaining queued work and explicit retry recovers',async()=>{
 let calls=0;const q=new RouteQueue({parallel:1,invoke:async()=>++calls===1?{error:'rate_limited'}:{status:'ready'}});
 const a=q.request('a',{}),b=q.request('b',{}),c=q.request('c',{});await Promise.all([a,b,c]);assert.equal(calls,1);assert.equal((await q.request('a',{},{retry:true})).status,'ready');
});
test('client request timeout leaves a recoverable error instead of an infinite pending card',async()=>{
 const q=new RouteQueue({timeoutMs:5,invoke:()=>new Promise(()=>{})});assert.equal((await q.request('timeout',{})).error,'provider_unavailable');
});
test('handler returns ambiguous candidates without computing any route',async()=>{
 let routed=0;const h=handler({provider:{resolve:async()=>({error:'ambiguous',candidates:[{id:'one',label:'Museum'}]}),route:async()=>{routed++}}});const r=await(await h.invoke()).json();assert.equal(r.status,'insufficient');assert.equal(routed,0);assert.equal(r.origin.candidates.length,1);
});

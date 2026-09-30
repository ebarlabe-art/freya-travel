import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyBriefDocument} from '../domain/trip-brief.mjs';
import {compileFlightLegSearch,compileFlightSearchFromBrief,compileHotelSearch,flightSearchDefaultsFromBrief,hotelSearchDefaultsFromBrief} from '../domain/travel-search.mjs';
import {createSkyscannerFlightsAdapter,parseSkyscannerResults,selectSkyscannerPlace,skyscannerPrice} from '../supabase/functions/travel-search/providers/skyscanner-core.mjs';

function known(field,value,strength='preference'){return {field,scope:'global',origin:'explicit_user',knowledge:'known',strength,value}}
function baseBrief(){
 const d=emptyBriefDocument();
 d.decisions.o=known('origin',{places:['Barcelona']},'hard');
 d.decisions.x=known('destination',{mode:'known',places:['Riga']},'hard');
 d.decisions.d=known('dates',{mode:'exact',start:'2026-12-26',end:'2026-12-30'},'hard');
 d.travelers.a={kind:'adult'};d.travelers.c={kind:'child',age:12};
 return d;
}
test('Brief compiler requires explicit exact route/dates/travelers and preserves flight preferences',()=>{
 const d=baseBrief();d.decisions.s=known('flight.max_stops',0,'hard');
 const r=compileFlightSearchFromBrief(d,{market:'ES',locale:'ca-ES',currency:'EUR',cabin:'economy'});
 assert.equal(r.ready,true);assert.equal(r.query.origin,'Barcelona');assert.equal(r.query.destination,'Riga');assert.equal(r.query.trip_type,'round_trip');assert.equal(r.query.adults,1);assert.deepEqual(r.query.children_ages,[12]);
 assert.deepEqual(r.query.preferences[0],{key:'max_stops',decision_id:'s',strength:'hard',value:0});
});
test('unconfirmed interpretation is never promoted into a provider query',()=>{
 const d=baseBrief();d.decisions.o.origin='interpreted_from_user';
 const r=compileFlightSearchFromBrief(d,{market:'ES',locale:'ca-ES',currency:'EUR',cabin:'economy'});
 assert.equal(r.ready,false);assert.ok(r.blockers.some(x=>x.code==='origin_required'));
});
test('flexible date window blocks live-price search rather than inventing dates',()=>{
 const d=baseBrief();d.decisions.d.value={mode:'window',earliest:'2026-12-20',latest:'2027-01-05'};
 const r=compileFlightSearchFromBrief(d,{market:'ES',locale:'ca-ES',currency:'EUR',cabin:'economy'});
 assert.equal(r.ready,false);assert.ok(r.blockers.some(x=>x.code==='exact_dates_required'));
});
test('ambiguous multiple places block search rather than silently choosing one',()=>{
 const d=baseBrief();d.decisions.o.value.places=['Barcelona','Girona'];
 const r=compileFlightSearchFromBrief(d,{market:'ES',locale:'ca-ES',currency:'EUR',cabin:'economy'});
 assert.equal(r.ready,false);assert.ok(r.blockers.some(x=>x.code==='origin_required'));
});
test('Skyscanner helpers honor price units and exact autosuggest match',()=>{
 assert.equal(skyscannerPrice({amount:'12345',unit:'PRICE_UNIT_CENTI'}),123.45);
 const p=selectSkyscannerPlace({places:[{entityId:'1',name:'Riga Airport',iataCode:'RIX',type:'PLACE_TYPE_AIRPORT'},{entityId:'2',name:'Riga',iataCode:'RIX',type:'PLACE_TYPE_CITY'}]},'Riga');
 assert.equal(p.entityId,'2');
});
test('hard preference unsupported by adapter fails closed before provider calls',async()=>{
 let calls=0;const q=compileFlightSearchFromBrief(Object.assign(baseBrief(),{decisions:{...baseBrief().decisions,s:known('flight.max_stops',0,'hard')}}),{market:'ES',locale:'ca-ES',currency:'EUR',cabin:'economy'}).query;
 const adapter=createSkyscannerFlightsAdapter({apiKey:'test',fetchImpl:async()=>{calls++;throw Error('must not call')}});
 const r=await adapter.search(q);assert.equal(calls,0);assert.equal(r.error,'unsupported_hard_preferences');assert.deepEqual(r.unapplied_preferences,['max_stops']);
});
test('real adapter contract resolves places, creates/polls live search and returns sanitized price/deeplink',async()=>{
 const calls=[];const responses=[
  {places:[{entityId:'BCN_ENTITY',name:'Barcelona',iataCode:'BCN',type:'PLACE_TYPE_CITY'}]},
  {places:[{entityId:'RIX_ENTITY',name:'Riga',iataCode:'RIX',type:'PLACE_TYPE_CITY'}]},
  {sessionToken:'sess',status:'RESULT_STATUS_INCOMPLETE',content:{results:{itineraries:{a:{legIds:['l1','l2'],pricingOptions:[{price:{amount:'15000',unit:'PRICE_UNIT_CENTI'},transferType:'TRANSFER_TYPE_MANAGED',items:[{deepLink:'https://example.test/a'}]}]}}}}},
  {sessionToken:'sess',status:'RESULT_STATUS_COMPLETE',action:'RESULT_ACTION_REPLACED',content:{results:{itineraries:{a:{legIds:['l1','l2'],pricingOptions:[{price:{amount:'14000',unit:'PRICE_UNIT_CENTI'},transferType:'TRANSFER_TYPE_MANAGED',items:[{deepLink:'https://example.test/a'}]}]}}}}},
 ];
 const fetchImpl=async(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body)});return {ok:true,status:200,json:async()=>responses.shift()}};
 const q=compileFlightSearchFromBrief(baseBrief(),{market:'ES',locale:'ca-ES',currency:'EUR',cabin:'economy'}).query;
 const r=await createSkyscannerFlightsAdapter({apiKey:'test',fetchImpl,pollDelayMs:0}).search(q);
 assert.equal(calls.length,4);assert.match(calls[0].url,/autosuggest\/flights/);assert.match(calls[2].url,/flights\/live\/search\/create/);assert.match(calls[3].url,/poll\/sess/);
 assert.equal(calls[2].body.query.queryLegs.length,2);assert.equal(calls[2].body.query.adults,1);assert.deepEqual(calls[2].body.query.childrenAges,[12]);
 assert.equal(r.results.length,1);assert.equal(r.results[0].price.amount,140);assert.equal(r.results[0].price.currency,'EUR');assert.equal(r.results[0].deeplink,'https://example.test/a');
 assert.equal(r.results[0].raw.resolved_origin.entityId,'BCN_ENTITY');assert.equal(r.results[0].raw.resolved_destination.entityId,'RIX_ENTITY');
});
test('multiple booking links are preserved but not misrepresented as one deeplink',()=>{
 const q={currency:'EUR'},payload={content:{results:{itineraries:{a:{legIds:[],pricingOptions:[{price:{amount:'100',unit:'PRICE_UNIT_WHOLE'},items:[{deepLink:'https://example.test/a'},{deepLink:'https://example.test/b'}]}]}}}}};
 const rows=parseSkyscannerResults([payload],q,{origin:{name:'A'},destination:{name:'B'}});
 assert.equal(rows[0].deeplink,undefined);assert.deepEqual(rows[0].raw.booking_links,['https://example.test/a','https://example.test/b']);
});

test('TB-08.2 compiles a one-way leg without manufacturing a return date',()=>{
 const d=baseBrief();
 const r=compileFlightLegSearch(d,{origin:'Barcelona',destination:'Riga',startDate:'2026-12-26',adults:2,childrenAges:[],market:'ES',locale:'ca-ES',currency:'EUR',cabin:'economy'});
 assert.equal(r.ready,true);
 assert.equal(r.query.trip_type,'one_way');
 assert.equal(r.query.end_date,null);
 assert.equal(r.query.origin,'Barcelona');
 assert.equal(r.query.destination,'Riga');
});
test('Skyscanner one-way search sends exactly one query leg',async()=>{
 const responses=[
  {places:[{entityId:'BCN_ENTITY',name:'Barcelona',iataCode:'BCN',type:'PLACE_TYPE_CITY'}]},
  {places:[{entityId:'RIX_ENTITY',name:'Riga',iataCode:'RIX',type:'PLACE_TYPE_CITY'}]},
  {sessionToken:'sess',status:'RESULT_STATUS_COMPLETE',content:{results:{itineraries:{}}}},
 ];
 const calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body)});return {ok:true,status:200,json:async()=>responses.shift()}};
 const q=compileFlightLegSearch(baseBrief(),{origin:'Barcelona',destination:'Riga',startDate:'2026-12-26',adults:1,childrenAges:[],market:'ES',locale:'ca-ES',currency:'EUR',cabin:'economy'}).query;
 await createSkyscannerFlightsAdapter({apiKey:'test',fetchImpl,pollDelayMs:0}).search(q);
 assert.equal(calls[2].body.query.queryLegs.length,1);
});

test('TB-08.2 traveler defaults never invent an adult',()=>{
 const d=emptyBriefDocument();
 const defaults=flightSearchDefaultsFromBrief(d);
 assert.equal(defaults.adults,0);
 assert.equal(defaults.children_count,0);
 assert.ok(defaults.traveler_blockers.some(x=>x.code==='adult_traveler_required'));
});

test('flight leg search validates culture without recursion',()=>{
 const d=baseBrief();
 const r=compileFlightLegSearch(d,{origin:'Barcelona',destination:'Riga',startDate:'2026-12-26',adults:2,childrenAges:[8],market:'ES',locale:'ca-ES',currency:'EUR',cabin:'economy'});
 assert.equal(r.ready,true);
 assert.equal(r.query.children_ages.length,1);
});

test('TB-08.5 hotel search does not require flight-only fields',()=>{
 const r=compileHotelSearch({destination:'Tallinn',startDate:'2026-12-30',endDate:'2027-01-02',adults:2,childrenAges:[],rooms:2,market:'ES',locale:'ca-ES',currency:'EUR'});
 assert.equal(r.ready,true);assert.equal(r.query.destination,'Tallinn');assert.equal(r.query.services[0],'hotels');assert.equal(r.query.rooms,2);assert.equal(r.query.origin,undefined);assert.equal(r.query.cabin,undefined);
});
test('TB-08.5 hotel search rejects invalid stay dates and never invents adults',()=>{
 const bad=compileHotelSearch({destination:'Tallinn',startDate:'2027-01-02',endDate:'2026-12-30',adults:2,market:'ES',locale:'ca-ES',currency:'EUR'});
 assert.equal(bad.ready,false);assert.ok(bad.blockers.some(x=>x.code==='stay_dates_required'));const defaults=hotelSearchDefaultsFromBrief(emptyBriefDocument());assert.equal(defaults.adults,0);assert.ok(defaults.traveler_blockers.some(x=>x.code==='adult_traveler_required'));
});

test('TB-08.5 hotel search validates room count',()=>{
 const bad=compileHotelSearch({destination:'Tallinn',startDate:'2026-12-30',endDate:'2027-01-02',adults:2,rooms:0,market:'ES',locale:'ca-ES',currency:'EUR'});
 assert.equal(bad.ready,false);assert.ok(bad.blockers.some(x=>x.code==='rooms_required'));
});

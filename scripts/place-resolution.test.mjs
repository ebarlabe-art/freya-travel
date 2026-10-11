import {normalizeOpenMeteoPlace,openMeteoAdapter} from '../supabase/functions/place-resolution/providers/open-meteo-staging.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeGeoapify,geoapifyAdapter} from '../supabase/functions/place-resolution/providers/geoapify.mjs';
import {placeConfig} from '../supabase/functions/place-resolution/config.mjs';
import {signCandidate,verifyCandidate,createPlaceHandler} from '../supabase/functions/place-resolution/handler.mjs';
import {inheritPlace,primaryStop,validIana,PlaceClient} from '../domain/place-resolution.mjs';
const raw={name:'Synthetic place',result_type:'city',country_code:'de',lat:48,lon:11,timezone:{name:'Europe/Berlin'},place_id:'synthetic',datasource:{sourcename:'test',attribution:'Synthetic test only'}};
for(const label of ['city','homonym','typo','exonym','airport'])test('factual candidate retained without name heuristics: '+label,()=>{const p=normalizeGeoapify({...raw,name:label,result_type:label==='airport'?'amenity':'city'});assert.equal(p.canonical_name,label);assert.equal(p.timezone,'Europe/Berlin')});
for(const kind of ['region','island','country'])test(kind+' does not inherit centroid timezone',()=>{const p=normalizeGeoapify({...raw,result_type:kind});assert.equal(p.timezone,null);assert.equal(p.timezone_status,'needs_specific_location')});
test('missing/invalid timezone never uses device or model',()=>{for(const timezone of [null,{name:'UTC+1'},{name:'fiction'}])assert.equal(normalizeGeoapify({...raw,timezone}).timezone_status,'unavailable');assert.equal(validIana('UTC+1'),false)});
test('same base inherits timezone without hotel coordinates; own activity and transport independent',()=>{const base=normalizeGeoapify(raw),own=normalizeGeoapify({...raw,result_type:'building',timezone:{name:'Europe/Helsinki'}});assert.deepEqual(inheritPlace({base,kind:'accommodation'}),{timezone:'Europe/Berlin',latitude:null,longitude:null,inherited:true});assert.equal(inheritPlace({own,base,kind:'activity'}).timezone,'Europe/Helsinki');assert.deepEqual(inheritPlace({from:base,to:own,kind:'transport'}),{origin:'Europe/Berlin',destination:'Europe/Helsinki'});assert.equal(inheritPlace({base,kind:'itinerary'}).timezone,'Europe/Berlin')});
test('DST uses IANA date rules and principal stop is first overnight',()=>{assert.notEqual(new Intl.DateTimeFormat('en',{timeZone:'Europe/Berlin',timeZoneName:'shortOffset'}).format(new Date('2026-01-01')),new Intl.DateTimeFormat('en',{timeZone:'Europe/Berlin',timeZoneName:'shortOffset'}).format(new Date('2026-07-01')));assert.equal(primaryStop({route:{stops:[{id:'transit',nights:null},{id:'base',nights:2}]}}),'base')});
for(const [status,error] of [[429,'rate_limited'],[503,'provider_unavailable']])test('provider '+status,async()=>{await assert.rejects(geoapifyAdapter({key:'synthetic',config:placeConfig(),fetcher:async()=>new Response('',{status})}).search({text:'query',language:'ca'}),new RegExp(error))});
for(const body of ['broken','{}','{"results":[{}]}'])test('invalid/incomplete response '+body,async()=>{await assert.rejects(geoapifyAdapter({key:'synthetic',config:placeConfig(),fetcher:async()=>new Response(body)}).search({text:'query',language:'ca'}),/invalid_response/)});
test('timeout is normalized without leaking URL/key; no retry',async()=>{let calls=0;await assert.rejects(geoapifyAdapter({key:'synthetic',config:placeConfig(),fetcher:async()=>{calls++;throw Error('secret URL')}}).search({text:'x',language:'ca'}),/provider_unavailable/);assert.equal(calls,1)});
test('candidate token rejects manipulation, expiry and other owner',async()=>{const t=await signCandidate({owner:'a',expires:200},'synthetic-secret');assert.equal((await verifyCandidate(t,'a','synthetic-secret',100)).owner,'a');for(const [value,owner,time]of [[t,'b',100],[t,'a',201],[{...t,payload:{...t.payload,index:2}},'a',100]])await assert.rejects(verifyCandidate(value,owner,'synthetic-secret',time));});
test('handler cache hit/miss and no-match cache; normalized input only',async()=>{let queries=0,provider=0,saved;const config=placeConfig();const handler=createPlaceHandler({config,tokenSecret:'synthetic',authenticate:async()=> 'owner',adapter:{search:async input=>{provider++;assert.deepEqual(Object.keys(input).sort(),['language','text']);return []}},rpc:async(name,args)=>{if(name==='claim_place_query_v1'){queries++;return queries===1?{token:'t',query_hash:'h'}:{token:'t',query_hash:'h',cached:true,results:[]}}saved=args;}});for(let i=0;i<2;i++){const r=await handler(new Request('https://test',{method:'POST',body:JSON.stringify({action:'search',text:'x',notes:'not forwarded'})}));assert.equal((await r.json()).error,'no_match')}assert.equal(provider,1);assert.equal(saved.p_seconds,300)});
test('unauthenticated caller never consumes provider quota',async()=>{const handler=createPlaceHandler({authenticate:async()=>null,rpc:()=>{throw Error('should not call')}});assert.equal((await handler(new Request('https://test',{method:'POST'}))).status,401)});

test('client transport error carries normalized code for offline UX',async()=>{const client=new PlaceClient({functions:{invoke:async()=>({error:{message:'offline'}})}});await assert.rejects(client.searchPlaces({text:'test'}),error=>error.code==='provider_unavailable'&&error.message==='provider_unavailable')});

const rigaRow={id:456172,name:'Riga',feature_code:'PPLC',country_code:'LV',latitude:56.946,longitude:24.106,timezone:'Europe/Riga',admin1:'Riga'};
test('staging Open-Meteo Riga is a verified city and retains GeoNames attribution',()=>{
 const candidate=normalizeOpenMeteoPlace(rigaRow);
 assert.equal(candidate.canonical_name,'Riga');
 assert.equal(candidate.timezone,'Europe/Riga');
 assert.equal(candidate.timezone_status,'verified');
 assert.equal(candidate.provider,'open-meteo');
 assert.equal(candidate.provider_place_id,'456172');
 assert.match(candidate.attribution,/CC BY 4.0/);
 assert.equal(candidate.country_code,'LV');
});
test('staging non-city region cannot inherit inaccurate centroid time zone',()=>{
 const region=normalizeOpenMeteoPlace({...rigaRow,feature_code:'ADM1'});
 assert.equal(region.timezone,null);
 assert.equal(region.timezone_status,'needs_specific_location');
});
test('staging Open-Meteo adapter sends no secret and validates response',async()=>{
 let calls=0;
 const api=openMeteoAdapter({config:placeConfig(),fetcher:async url=>{
  calls++;
  assert.equal(url.hostname,'geocoding-api.open-meteo.com');
  assert.equal(url.searchParams.get('name'),'Riga');
  assert.equal(url.searchParams.get('count'),'5');
  assert.equal(url.searchParams.get('language'),'ca');
  assert.equal(url.searchParams.get('apikey'),null);
  return new Response(JSON.stringify({results:[rigaRow]}),{status:200});
 }});
 const list=await api.search({text:'Riga',language:'ca'});
 assert.equal(calls,1);
 assert.equal(list[0].timezone,'Europe/Riga');
});
test('staging Open-Meteo rejects corrupt data, 429 and outages',async()=>{
 for(const body of ['not-json','{"results":[{}]}','{"results":"bad"}']){
  const api=openMeteoAdapter({config:placeConfig(),fetcher:async()=>new Response(body)});
  await assert.rejects(api.search({text:'Riga',language:'ca'}),/invalid_response/);
 }
 const rate=openMeteoAdapter({config:placeConfig(),fetcher:async()=>new Response('',{status:429})});
 await assert.rejects(rate.search({text:'Riga',language:'ca'}),/rate_limited/);
});
test('staging Edge entrypoint has project guard; production remains Geoapify',async()=>{
 const {readFileSync}=await import('node:fs');
 const preview=readFileSync(new URL('../supabase/functions/place-resolution/index.staging.ts',import.meta.url),'utf8');
 const production=readFileSync(new URL('../supabase/functions/place-resolution/index.ts',import.meta.url),'utf8');
 assert.match(preview,/staging_only_project_mismatch/);
 assert.match(preview,/waatqrqyddurultrazbn/);
 assert.match(preview,/openMeteoAdapter/);
 assert.match(production,/geoapifyAdapter/);
 assert.doesNotMatch(production,/openMeteoAdapter/);
});

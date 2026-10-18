import test from 'node:test';
import assert from 'node:assert/strict';
import {placeRpc} from '../supabase/functions/place-resolution/backend.mjs';
import {createPlaceHandler} from '../supabase/functions/place-resolution/handler.mjs';
import {geoapifyAdapter} from '../supabase/functions/place-resolution/providers/geoapify.mjs';
import {placeConfig} from '../supabase/functions/place-resolution/config.mjs';

test('production regression: successful uncached geocode + finish RPC 204 returns 200, then cache hit',async()=>{
 let cached=null,providerCalls=0,finishes=0;
 const rpc=placeRpc({url:'https://fixture.invalid',service:'synthetic',fetcher:async(url,request)=>{
  if(url.endsWith('/claim_place_query_v1'))return Response.json(cached?{cached:true,results:cached,token:'t',query_hash:'h'}:{token:'t',query_hash:'h'});
  assert.ok(url.endsWith('/finish_place_query_v1'));
  cached=JSON.parse(request.body).p_results;finishes++;
  return new Response(null,{status:204});
 }});
 const adapter=geoapifyAdapter({key:'synthetic',config:placeConfig(),fetcher:async url=>{
  providerCalls++;assert.equal(url.searchParams.get('filter'),'countrycode:it');
  return Response.json({results:[{name:'Torre dell’Orologio',city:'Bolonya',country_code:'it',result_type:'amenity',
   lat:44.4937,lon:11.3426,place_id:'synthetic-tower',timezone:{name:'Europe/Rome'},datasource:{sourcename:'fixture',attribution:'Synthetic test data'}}]});
 }});
 const handler=createPlaceHandler({authenticate:async()=> 'owner',tokenSecret:'synthetic',rpc,adapter});
 for(let i=0;i<2;i++){
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({action:'search',text:'Torre dell’Orologio, Bolonya',country_code:'IT',language:'ca'})}));
  assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.candidates[0].place.canonical_name,'Torre dell’Orologio');
  assert.equal(data.candidates[0].place.locality,'Bolonya');assert.ok(data.candidates[0].candidate_token.signature);
 }
 assert.equal(providerCalls,1);assert.equal(finishes,1);
});
test('only the void finish RPC accepts 204; malformed JSON and SQL failures are not success',async()=>{
 const empty=placeRpc({url:'https://fixture.invalid',service:'synthetic',fetcher:async()=>new Response(null,{status:204})});
 assert.equal(await empty('finish_place_query_v1',{}),null);
 await assert.rejects(empty('claim_place_query_v1',{}),/invalid_response/);
 for(const [status,body,code] of [[409,{message:'Query expired',code:'40001'},'40001'],[400,{message:'rate_limited',code:'P0001'},'P0001']]){
  const rpc=placeRpc({url:'https://fixture.invalid',service:'synthetic',fetcher:async()=>Response.json(body,{status})});
  await assert.rejects(rpc('finish_place_query_v1',{}),e=>e.code===code);
 }
 const malformed=placeRpc({url:'https://fixture.invalid',service:'synthetic',fetcher:async()=>new Response('not JSON')});
 await assert.rejects(malformed('finish_place_query_v1',{}),/invalid_response/);
});

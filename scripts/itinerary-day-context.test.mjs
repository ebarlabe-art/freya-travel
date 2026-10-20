import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDayContextHandler} from '../supabase/functions/itinerary-day-context/handler.mjs';
const trip='11800000-0000-4000-8000-000000000001';
const body={trip_id:trip,local_date:'2030-03-31',destination:'Bologna, Italia',
 items:[{title:'Basílica de San Petronio',when:'2030-03-31T10:00:00+02:00'}]};
const call=(handler,input=body,token='Bearer test')=>handler(new Request('https://example.test/functions/v1/itinerary-day-context',{
 method:'POST',headers:{authorization:token,'content-type':'application/json'},body:JSON.stringify(input)
}));
const setup=(override={})=>{
 let calls=0;
 const handler=createDayContextHandler({
  authenticate:async token=>token==='Bearer test'?'member':null,
  readTrip:async()=>true,
  generate:async()=>{calls++;return {title:'Història de Bolonya',summary:'Un dia per descobrir monuments de la ciutat.'}},
  now:()=>Date.parse('2030-03-30T12:00:00Z'),...override
 });
 return {handler,calls:()=>calls};
};
test('day-context requires a valid session and current trip membership before model call',async()=>{
 const s=setup({readTrip:async()=>false});
 assert.equal((await call(s.handler)).status,403);
 assert.equal((await call(s.handler,body,'Bearer wrong')).status,401);
 assert.equal(s.calls(),0);
});
test('day-context validates itinerary bounds and returns a bounded contextual suggestion',async()=>{
 const s=setup();
 assert.equal((await call(s.handler,{...body,items:[]})).status,400);
 assert.equal((await call(s.handler,{...body,items:[{title:'x'.repeat(221)}]})).status,400);
 const response=await call(s.handler);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{title:'Història de Bolonya',summary:'Un dia per descobrir monuments de la ciutat.'});
 assert.equal(s.calls(),1);
});
test('day-context uses a per-user day budget to avoid unbounded paid calls',async()=>{
 const s=setup({maxDaily:1});
 assert.equal((await call(s.handler)).status,200);
 assert.equal((await call(s.handler)).status,429);
 assert.equal(s.calls(),1);
});
test('day-context rejects overlong provider output',async()=>{
 const s=setup({generate:async()=>({title:'x'.repeat(161),summary:'Una visita.'})});
 const response=await call(s.handler);
 assert.equal(response.status,502);
 assert.equal((await response.json()).error,'invalid_response');
});
test('frontend integrates auto-once generation, explicit re-generation and shared-row protection',()=>{
 const s=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(s,/dayContextAttempted=new Set\(\),dayContextPending=new Set\(\)/);
 assert.match(s,/generateItineraryDayContext\(selected,true\)/);
 assert.match(s,/data-generate-day-context/);
 assert.match(s,/if\(dayMetadataForDate\(localDate\)\|\|dayMetadataEditor\?/);
 assert.match(s,/\.select\('id'\)\.eq\('trip_id',tripId\)\.eq\('local_date',localDate\)\.maybeSingle\(\)/);
 assert.match(s,/dayMetadataEditor\.title=title;dayMetadataEditor\.summary=summary/);
});

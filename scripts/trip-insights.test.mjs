import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {insightScope,insightPhase,validateInsightReport,insightCacheKey,insightCacheSignature,readInsightCache,saveInsightCache} from '../domain/trip-insights.mjs';
import {createTripInsightsHandler} from '../supabase/functions/trip-insights/handler.mjs';
const trip={id:'11111111-1111-4111-8111-111111111111',start_date:'2027-08-14',end_date:'2027-08-30'};
const stop=(name,country_code)=>({canonical_name:name,country_code});
const report={checked_at:'2026-11-24',items:[{topic:'entry',destination:'Mongòlia',title:'Revisar entrada',detail:'Consulta els requisits oficials aplicables al teu passaport.',source_title:'Font oficial',source_url:'https://www.gov.mn/entry'}]};
test('A4 universal: no country whitelist; verified itinerary geography is the only destination input',()=>{
 const s=insightScope({trip,stops:[stop('Ulaanbaatar','MN'),stop('Papeete','PF'),stop('Ulaanbaatar','MN')]});
 assert.deepEqual(s.destinations,[{name:'Ulaanbaatar',country_code:'MN'},{name:'Papeete',country_code:'PF'}]);
 assert.deepEqual(insightScope({trip,stops:[]}).destinations,[]);
 assert.equal(insightPhase(trip,new Date(2027,7,17,12)),'during');
 assert.equal(insightPhase(trip,new Date(2027,8,1,12)),'past');
 assert.equal(insightScope({trip:{...trip,experience_key:'london-2026'}}),null);
});
test('A4 universal: every claim requires a real web search citation URL',()=>{
 assert.equal(validateInsightReport(report,{sourceUrls:['https://www.gov.mn/entry']}).items.length,1);
 assert.throws(()=>validateInsightReport(report,{sourceUrls:['https://not-the-source.example/']}),/invalid_response/);
 assert.throws(()=>validateInsightReport({...report,items:[{...report.items[0],source_url:'http://127.0.0.1/private'}]}),/invalid_response/);
 assert.throws(()=>validateInsightReport({...report,items:[]}),/source_unavailable/);
});
test('A4 universal: cache respects account, trip, geographic changes and age',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const s=insightScope({trip,stops:[stop('Ulaanbaatar','MN')]});
 const k=insightCacheKey('alice',trip.id);
 saveInsightCache(storage,k,s,report,1000);
 assert.deepEqual(readInsightCache(storage,k,s,{now:2000}),report);
 assert.equal(readInsightCache(storage,k,{...s,destinations:[{name:'Suva',country_code:'FJ'}]},{now:2000}),null);
 assert.equal(readInsightCache(storage,k,s,{now:72*3600*1000+1001}),null);
 assert.notEqual(k,insightCacheKey('bob',trip.id));
});
const identity='11111111-1111-4111-8111-111111111111';
const body={trip_id:identity};
const make=({authorize=async()=> 'member',readTrip=async()=>trip,readStops=async()=>[stop('Ulaanbaatar','MN')],generate=async()=>({report,sourceUrls:['https://www.gov.mn/entry']})}={})=>createTripInsightsHandler({authorize,readTrip,readStops,generate,now:()=>new Date('2026-11-24T12:00:00Z').getTime()});
const req=(obj=body,authorization='Bearer valid')=>new Request('https://example.test',{method:'POST',headers:{Authorization:authorization},body:JSON.stringify(obj)});
test('A4 universal: endpoint does not call AI for unauthorized or trips not readable through RLS',async()=>{
 let called=0;const deny=make({authorize:async()=>null,generate:async()=>{called++;return {report,sourceUrls:[]}}});
 assert.equal((await deny(req())).status,401);
 const outside=make({readTrip:async()=>null,generate:async()=>{called++;return {report,sourceUrls:[]}}});
 assert.equal((await outside(req())).status,403);assert.equal(called,0);
});
test('A4 universal: server decides dates and destinations; caller cannot forge an itinerary or destination',async()=>{
 const h=make();
 assert.equal((await h(req({...body,destinations:[{name:'Injected',country_code:'XX'}]}))).status,400);
 const resp=await h(req());assert.equal(resp.status,200);
 const obj=await resp.json();assert.equal(obj.checked_at,'2026-11-24');assert.equal(obj.items[0].destination,'Mongòlia');
});
test('A4 universal: no unverifiable AI answer; no sources means failure',async()=>{
 const h=make({generate:async()=>({report,sourceUrls:['https://www.elsewhere.example/']})});
 assert.equal((await h(req())).status,422);
});
test('A4 universal: UI automatically invokes authorized research and keeps the existing trip',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/functions.invoke\('trip-insights'/);
 assert.match(html,/renderTripInsights\(\)/);
 assert.match(html,/readInsightCache/);
 assert.doesNotMatch(html,/GUIDES\[code\]/);
});

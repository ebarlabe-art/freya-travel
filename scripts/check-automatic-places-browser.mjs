// Built app + actual PDF proposal/review/write + actual route handler/provider.
// Transport, authentication and persistence fixtures are synthetic; external requests blocked.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {itineraryPdfTranscriptToProposal} from '../supabase/functions/import-itinerary/transcript.mjs';
import {createItineraryReview,summarizeItineraryReview} from '../domain/import-itinerary-review.mjs';
import {prepareItineraryImportRows} from '../domain/import-itinerary-write.mjs';
import {normalizeGeoapify} from '../supabase/functions/place-resolution/providers/geoapify.mjs';
import {routeProvider} from '../supabase/functions/itinerary-route/provider.mjs';
import {createRouteHandler} from '../supabase/functions/itinerary-route/handler.mjs';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const engine=process.env.ROUTE_ENGINE||'chromium',dist=resolve('dist');
const id=n=>'12800000-0000-4000-8000-'+String(n).padStart(12,'0'),userId=id(1),tripId=id(2),documentId=id(3);
const source={kind:'document',document_id:documentId,file_name:'London.pdf',mime_type:'application/pdf'};
const transcript={complete:true,warnings:[],pages:[{page:1,text:'27/12/2026 · Zona horària: Europe/London\n09:00–10:00 British Museum\n10:05–11:00 Tower of London\n12:00–13:00 London Eye'}]};
const proposal=itineraryPdfTranscriptToProposal(transcript,source),review=createItineraryReview(proposal,{userId,tripId,documentId});
const snapshot=summarizeItineraryReview(review);
const imported=await prepareItineraryImportRows(snapshot,{userId,tripId,documentId,convertLocalTime:s=>s+':00Z'});
const rows=imported.map((row,i)=>({...row,resolved_location:null,updated_at:'2030-01-01T00:00:00Z',created_at:'2030-01-01T00:00:00Z'}));
// A manually-created plan uses exactly the same location workflow.
rows.push({...rows[0],id:id(4),title:'National Gallery',location_name:null,starts_at:'2026-12-27T14:00:00Z',ends_at:'2026-12-27T15:00:00Z',sort_order:4});
rows.push({...rows[0],id:id(5),title:'Unknown Museum',location_name:null,starts_at:'2026-12-27T16:00:00Z',ends_at:'2026-12-27T17:00:00Z',sort_order:5});
rows.push({...rows[0],id:id(6),title:'Central Museum',location_name:null,starts_at:'2026-12-27T18:00:00Z',ends_at:'2026-12-27T19:00:00Z',sort_order:6});
const activity={id:id(7),trip_id:tripId,title:'Westminster Abbey',venue_name:null,address:null,city:'London',
 activity_type:'museum',reservation_status:'confirmed',start_at:'2026-12-27T13:15:00Z',end_at:'2026-12-27T13:45:00Z',
 time_zone:'Europe/London',booking_reference:'KEEP-RESERVATION',notes:'Original ticket',latitude:null,longitude:null,
 resolved_location:null,created_at:'2030-01-01T00:00:00Z',updated_at:'2030-01-01T00:00:00Z'};
const activityOriginal=structuredClone(activity),allRows=[...rows,activity];
const originals=structuredClone(rows),writes=[],searches=[];
const stops=[{trip_id:tripId,canonical_name:'London',country_code:'GB',position:1,time_zone:'Europe/London'}];
const tripRow={id:tripId,name:'London v27',start_date:'2026-12-27',end_date:'2026-12-27',time_zone:'Europe/London',owner_id:userId,is_owner:true,experience_key:null};
const raw=name=>({name,formatted:name+', London',city:'London',country_code:'gb',result_type:'amenity',place_id:name,
 lat:51.5,lon:-0.12,timezone:{name:'Europe/London'},datasource:{sourcename:'fixture',attribution:'Synthetic data'}});
const provider=routeProvider({key:'synthetic',spacingMs:0,fetcher:async url=>url.pathname.endsWith('/routing')?
 Response.json({features:[{geometry:{type:'MultiLineString',coordinates:[[[-0.12,51.5],[-0.11,51.5]]]},properties:{mode:url.searchParams.get('mode'),distance:1200,time:900,distance_units:'meters'}}]}):
 Response.json({results:[raw('British Museum')]})});
const handler=createRouteHandler({authenticate:async()=>userId,readTrip:async()=>true,readStops:async()=>stops,
 readItem:async(_auth,_trip,ref)=>allRows.find(row=>row.id===ref.id),provider});
const server=createServer(async(req,res)=>{
 const name=new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,''),path=resolve(dist,name||'index.html');
 if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
 await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
 await page.exposeFunction('fixtureRead',table=>structuredClone(table==='trip_activities'?[activity]:rows));
 await page.exposeFunction('fixtureUpdate',({patch,filters})=>{
  const row=allRows.find(row=>filters.every(([key,value])=>(row[key]??null)===value));
  if(!row)return {data:null,error:null};
  writes.push({id:row.id,patch});Object.assign(row,patch,{updated_at:new Date(Date.now()+writes.length).toISOString()});
  return {data:{id:row.id},error:null};
 });
 await page.exposeFunction('fixtureInvoke',async(name,body)=>{
  if(name==='itinerary-route')return {data:await(await handler(new Request('https://synthetic',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(body)}))).json(),error:null};
  if(name!=='place-resolution')return {data:{},error:null};
  searches.push(body);
  const title=body.text.split(',')[0],places=title==='Unknown Museum'?[]:title==='Central Museum'?
   [normalizeGeoapify({...raw(title),place_id:'one'}),normalizeGeoapify({...raw(title),place_id:'two'})]:[normalizeGeoapify(raw(title))];
  return {data:{candidates:places.map(place=>({place}))},error:null};
 });
 await page.goto(url);await page.waitForFunction(()=>typeof renderSession==='function');await page.locator('#loginCard').waitFor({state:'visible'});
 await page.evaluate(async({tripRow,stops,userId})=>{
  db.rpc=async name=>({data:name==='get_my_trips'?[tripRow]:[],error:null});
  db.from=table=>{
   let patch=null,filters=[],columns=null;
   const execute=async()=>patch?window.fixtureUpdate({patch,filters}):{data:['trip_itinerary_items','trip_activities'].includes(table)?await window.fixtureRead(table):table==='trip_stops'?stops.map(stop=>columns&&columns!=='*'?Object.fromEntries(columns.split(',').map(key=>[key,stop[key]])):stop):[],error:null};
   const q=new Proxy({}, {get:(_,key)=>{
    if(key==='then')return (success,failure)=>execute().then(success,failure);
    if(key==='select')return value=>{columns=value;return q};
    if(key==='update')return value=>{patch=value;return q};
    if(key==='eq'||key==='is')return (field,value)=>{filters.push([field,value]);return q};
    if(key==='maybeSingle')return execute;
    return ()=>q;
   }});return q;
  };
  db.channel=()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe:async()=>{}};return c};db.removeChannel=async()=>{};
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:(name,{body})=>window.fixtureInvoke(name,body)}});
  await renderSession({user:{id:userId,email:'v27@example.invalid'}});await selectTrip(tripRow.id,{open:true});
 },{tripRow,stops,userId});
 await page.locator('#genericItineraryModuleCard').click();
 await page.waitForFunction(()=>manualItineraryRows.filter(row=>row.resolved_location).length===4&&activityRows.some(row=>row.resolved_location));
 await page.locator('.agenda-route-compact').filter({hasText:/15 min/}).first().waitFor();
 assert.equal(writes.length,5,'Three imported places, one manual plan and one reserved activity, no location confirmation clicks');
 for(const key of Object.keys(activityOriginal).filter(k=>!['resolved_location','updated_at','venue_name'].includes(k)))assert.deepEqual(activity[key],activityOriginal[key],key);
 assert.equal(activity.venue_name,'Westminster Abbey');
 for(const row of rows){
  const original=originals.find(r=>r.id===row.id);
  for(const key of Object.keys(original).filter(k=>!['resolved_location','updated_at','location_name'].includes(k)))assert.deepEqual(row[key],original[key],key);
  if(original.location_name)assert.equal(row.location_name,original.location_name);
 }
 assert.equal(rows[4].resolved_location,null);assert.equal(rows[5].resolved_location,null);
 assert.ok(searches.every(s=>s.country_code==='GB'));
 await page.locator('.agenda-route-diagnosis').filter({hasText:/horaris es mantenen/}).waitFor();
 const details=page.locator('[data-route-options]').first();await details.locator('summary').click();
 const map=page.locator('[data-route-map]').first();assert.match(await map.getAttribute('href'),/origin=51.5%2C-0.12/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.right>innerWidth}).map(n=>({tag:n.tagName,cls:n.className,width:n.getBoundingClientRect().width,text:n.textContent.slice(0,90)})).slice(0,16))));
 // Reopening the agenda reuses stored geography without repeating geocoding/writes.
 const before=searches.length;
 await page.evaluate(async()=>{await loadManualItineraryItems(true);renderGenericItinerary()});
 await page.waitForFunction(()=>document.querySelector('.agenda-route-compact')?.textContent.includes('15 min'));
 assert.equal(searches.length,before);assert.equal(writes.length,5);assert.deepEqual(errors,[]);
 console.log(`PASS ${engine}: PDF proposal/review/write → automatic London locations and manual activity → routes, conflict warning, map, unknown/ambiguous pending, exact original fields, reload reuse, 390px.`);
}finally{await browser.close();await new Promise(r=>server.close(r))}

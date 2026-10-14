// Real Pages/PWA regression; every data request is synthetic and all external traffic is blocked.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const dist=resolve('dist'),id=n=>'12800000-0000-4000-8000-'+String(n).padStart(12,'0');
const tripRow={id:id(1),name:'Synthetic Baltic trip',start_date:'2026-12-26',end_date:'2027-01-02',time_zone:'Europe/Riga',experience_key:null,owner_id:id(2),is_owner:true,invite_code:'SYNTHETIC'};
const rows=Array.from({length:13},(_,i)=>({id:id(10+i),trip_id:tripRow.id,title:i===0?'Esmorzar lliure al centre històric de Riga (Vecrīga).':'Synthetic plan '+i,timing_kind:'exact',starts_at:`2026-12-${i<7?'27':'28'}T${String(7+(i%7)).padStart(2,'0')}:00:00Z`,ends_at:null,time_zone:'Europe/Riga',location_name:null,status:'planned',sort_order:i,created_by:id(2),updated_at:'2026-10-12T22:36:00Z'}));
const server=createServer(async(req,res)=>{const path=resolve(dist,decodeURIComponent(new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,''))||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
 const ctx=await browser.newContext({viewport:process.env.ITINERARY_TABLET?{width:1024,height:768}:{width:390,height:844},isMobile:!process.env.ITINERARY_TABLET,hasTouch:true,serviceWorkers:'allow'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
 await ctx.routeWebSocket('**/*',s=>s.close());
 await ctx.addInitScript(()=>{sessionStorage.testBoot=String(Number(sessionStorage.testBoot||0)+1)});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 async function boot(failure=true){
  await page.goto(url);await page.waitForFunction(()=>typeof renderSession==='function'&&navigator.serviceWorker.controller);
  await page.locator('#loginCard').waitFor({state:'visible'});
  await page.evaluate(async({tripRow,rows,failure})=>{
   window.fixture={rows,failure,writes:0,reads:{},delay:null};
   db.rpc=async name=>({data:name==='get_my_trips'?[tripRow]:[],error:null});
   db.from=table=>{const q=new Proxy({}, {get:(_,key)=>key==='then'?async resolve=>{
    fixture.reads[table]=(fixture.reads[table]||0)+1;
    if(table==='trip_flight_documents'&&fixture.delay)await fixture.delay;
    return resolve({data:table==='trip_itinerary_items'?fixture.rows:[],error:fixture.expired?{message:'JWT expired',code:'PGRST303'}:table==='trip_flight_documents'&&fixture.failure?{message:'Synthetic unavailable source'}:null});
   }:()=>{if(['insert','update','delete','upsert'].includes(key)){fixture.writes++;throw Error('Unexpected mutation')}return q}});return q};
   db.channel=()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe:async()=>{}};return c};db.removeChannel=async()=>{};
   Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async()=>({data:{candidates:[]},error:null})}});
   await renderSession({user:{id:tripRow.owner_id,email:'synthetic@example.invalid'}});await selectTrip(tripRow.id,{open:true});
  },{tripRow,rows,failure});
  await page.locator('#genericItineraryModuleCard').click();
 }
 await boot();
 await page.waitForFunction(()=>itineraryProjection.length===13);
 assert.equal(await page.locator('[data-generic-itinerary-day]').count(),8);
 // On-device diagnosis is visible without exposing account IDs or resetting offline data.
 await page.locator('#pwaDiagnostic summary').click();
 await page.waitForFunction(()=>document.querySelector('#pwaDiagnosticSummary')?.textContent.includes('Planning llegit: 13'));
 const diagnosis=await page.locator('#pwaDiagnosticSummary').innerText();
 assert.match(diagnosis,/Versió de la pàgina: pwa-inline-sdk-v22/);
 assert.match(diagnosis,/Mode: Safari \/ navegador · Ruta: \/freya-travel\//);
 assert.match(diagnosis,/Planning llegit: 13 · Planning visible: 13/);
 assert.doesNotMatch(diagnosis,/synthetic@example|12800000-0000-4000/);
 await page.locator('#pwaDiagnosticRefresh').click();
 await page.waitForFunction(()=>document.querySelector('#pwaDiagnosticSummary')?.textContent.includes('Versió pública consultada: pwa-inline-sdk-v22'));
 assert.equal(await page.evaluate(()=>fixture.writes),0);
 await page.locator('#pwaDiagnostic summary').click();
 for(const [day,count] of [['27',7],['28',6]]){
  await page.locator(`[data-generic-itinerary-day="2026-12-${day}"]`).click();
  assert.equal(await page.locator('#genericItineraryDays [data-itinerary-key]').count(),count);
 }
 assert.match(await page.locator('#itinerarySourceStatus').innerText(),/Vols i documents de vol: no s’ha pogut carregar/);
 assert.equal(await page.evaluate(()=>itinerarySourcesAreReady()),false);
 assert.equal(await page.evaluate(()=>deriveTripHomeState({trip,ready:itinerarySourcesAreReady(),items:itineraryProjection},'2026-12-27T07:00:00Z').next),null);
 // Retry only the failed source, without discarding or refetching the successful manual read.
 const reads=await page.evaluate(()=>fixture.reads.trip_itinerary_items);
 await page.evaluate(()=>{fixture.failure=false});await page.locator('#retryItinerarySources').click();
 await page.waitForFunction(()=>itinerarySourcesAreReady());
 assert.equal(await page.evaluate(()=>fixture.reads.trip_itinerary_items),reads);
 await page.locator('#itinerarySourceStatus').waitFor({state:'hidden'});
 // A slow flight source cannot delay day tabs or manual items, even on an initially empty projection.
 await page.evaluate(()=>{
  clearGenericItineraryState();fixture.delay=new Promise(r=>window.releaseFlight=r);
  void loadGenericItinerary(true);
 });
 await page.waitForFunction(()=>itineraryProjection.length===13);
 assert.equal(await page.locator('[data-generic-itinerary-day]').count(),8);
 assert.match(await page.locator('#itinerarySourceStatus').innerText(),/Vols i documents de vol: carregant/);
 await page.evaluate(()=>{releaseFlight();fixture.delay=null});await page.waitForFunction(()=>itinerarySourcesAreReady());
 // Cache must not overwrite a fresh manual source when another source fails.
 await page.evaluate(()=>{
  persistOfflineAgendaSnapshot();const value=JSON.parse(localStorage.getItem(offlineTripKey()));
  value.agenda.manualItineraryRows=value.agenda.manualItineraryRows.slice(0,1);
  localStorage.setItem(offlineTripKey(),JSON.stringify(value));fixture.failure=true;
 });
 await page.evaluate(()=>loadGenericItinerary(true));
 assert.equal(await page.evaluate(()=>itineraryProjection.length),13);
 assert.equal(await page.evaluate(()=>itinerarySourcesAreReady()),false);
 // Reload/PWA reopening retains no misleading complete state.
 await boot();await page.waitForFunction(()=>itineraryProjection.length===13);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await page.locator('[data-generic-itinerary-day="2026-12-27"]').click();
 assert.equal(await page.locator('#genericItineraryDays [data-itinerary-key]').count(),7);
 assert.match(await page.locator('#genericItineraryDays').innerText(),/09:00/);
 // Real review and save handler with already-imported rows: no write/confirmation, direct navigation.
 await page.evaluate(async()=>{
  await openItineraryImport();const state=itineraryImportState;
  state.api=await loadTravelBookModule('import-itinerary-review.mjs');state.saveApi=await loadTravelBookModule('import-itinerary-write.mjs');
  state.documentId='12800000-0000-4000-8000-000000000099';
  state.review={read_only:true,warnings:[],items:fixture.rows.map((row,i)=>{
   const local=isoToZonedLocal(row.starts_at,row.time_zone);
   return {source_order:i,included:true,original:{title:row.title,local_date:local.slice(0,10),start_local_time:local.slice(11,16),time_zone:row.time_zone},edits:{},confidence:{title:'high'},evidence:{},source_warnings:[],source_flags:[]};
  })};
  state.review.items.push({...state.review.items[0],source_order:13});
  state.saveApi.deselectExactImportDuplicates(state.review);
  $('itineraryImportPreview').classList.remove('hidden');renderItineraryImportPreview();
 });
 assert.equal(await page.locator('[data-import-include]').count(),14);
 assert.equal(await page.locator('[data-import-include]:checked').count(),13);
 await page.locator('#itineraryImportWrite').click();
 await page.locator('#itineraryImportViewExisting').waitFor({state:'visible'});
 assert.match(await page.locator('#itineraryImportSaveStatus').innerText(),/13 activitats seleccionades ja consten/);
 assert.equal(await page.evaluate(()=>fixture.writes),0);
 await page.locator('#itineraryImportViewExisting').click();
 await page.waitForFunction(()=>document.querySelectorAll('#genericItineraryDays [data-itinerary-key]').length===7);
 await page.locator('#itineraryImportPanel').waitFor({state:'hidden'});
 // Real menus and browser Back/Forward preserve itinerary access.
 await page.evaluate(()=>setAppView('upcomingTripsView'));
 await page.locator('[data-select-trip]').first().click();await page.locator('#genericDashboardView').waitFor({state:'visible'});
 await page.locator('#genericItineraryModuleCard').click();await page.locator('#itineraryView').waitFor({state:'visible'});
 await page.locator('#itineraryView [data-back]').click();await page.locator('#genericDashboardView').waitFor({state:'visible'});
 await page.goBack();await page.locator('#upcomingTripsView').waitFor({state:'visible'});
 await page.goForward();await page.locator('#genericDashboardView').waitFor({state:'visible'});
 await page.locator('#genericItineraryModuleCard').click();await page.locator('#itineraryView').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>itineraryProjection.length),13);
 // Cached-only mode is explicitly incomplete and never replaces current rows.
 await page.evaluate(()=>{fixture.failure=false});await page.evaluate(()=>loadGenericItinerary(true));
 await ctx.setOffline(true);
 await page.evaluate(()=>{clearGenericItineraryState();void loadGenericItinerary()});
 await page.waitForFunction(()=>itineraryProjection.length===13);
 assert.equal(await page.evaluate(()=>itinerarySourcesAreReady()),false);
 assert.match(await page.locator('#itinerarySourceStatus').innerText(),/dades anteriors/);
 await ctx.setOffline(false);await page.waitForFunction(()=>itinerarySourcesAreReady());
 // Expired JWT responses preserve prior rows only as unverified, with visible retry.
 await page.evaluate(()=>{fixture.expired=true});await page.evaluate(()=>loadGenericItinerary(true));
 assert.equal(await page.evaluate(()=>itineraryProjection.length),13);assert.equal(await page.evaluate(()=>itinerarySourcesAreReady()),false);
 await page.locator('#retryItinerarySources').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.match(await page.locator('#genericItineraryMessage').innerText(),/sessió ha caducat/);
 await page.locator('[data-generic-itinerary-day="2026-12-27"]').click();
 await page.screenshot({path:process.env.ITINERARY_TABLET?'/tmp/freya-itinerary-loading-tablet.png':'/tmp/freya-itinerary-loading-mobile.png',fullPage:true});
 // Late completions after switching user/trip must not paint old activities.
 await page.evaluate(()=>{fixture.expired=false;fixture.delay=new Promise(r=>window.releaseFlight=r);void loadGenericItinerary(true)});
 await page.waitForFunction(()=>agendaRequests.size>0);
 await page.evaluate(()=>{clearGenericItineraryState();session={user:{id:'other-user'}};trip={...trip,id:'other-trip'};tripLoadGeneration++;fixture.rows=[];releaseFlight();fixture.delay=null;void loadGenericItinerary(true)});
 await page.waitForFunction(()=>itinerarySourcesAreReady());assert.equal(await page.evaluate(()=>itineraryProjection.length),0);
 await page.evaluate(()=>renderSession(null));await page.locator('#loginCard').waitFor({state:'visible'});
 assert.equal(await page.locator('#itineraryView').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('PASS real build '+(process.env.ITINERARY_TABLET?'1024px desktop UA/touch':'390px/PWA')+': 13 plans (7+6), 8 days, failed/slow source, targeted retry, stale cache, reload/pageshow, duplicate navigation with zero writes, menus/Back/Forward, offline/reconnect, expired session, account/trip switch and logout. Physical iPhone pending.');
}finally{await browser.close();await new Promise(r=>server.close(r))}

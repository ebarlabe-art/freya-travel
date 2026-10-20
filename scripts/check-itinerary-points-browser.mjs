// Built app + actual PDF proposal/review/write + actual route handler/provider.
// Transport, authentication and persistence fixtures are synthetic; external requests blocked.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
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
const titles=['Piazza Maggiore, Fontana del Nettuno i basílica de San Petronio','Passeig per l’entorn de les Due Torri i visita a Piazza Santo Stefano','Quadrilatero i dinar','Esmorzar i passeig pel centre històric','Aperitiu a Via del Pratello','Unknown Museum','Central Museum'];
const rows=titles.map((title,i)=>({...imported[0],id:id(20+i),title,city:'Bologna',location_name:null,address:null,resolved_location:null,location_points:null,updated_at:'2030-01-01T00:00:00Z',created_at:'2030-01-01T00:00:00Z',sort_order:i,starts_at:'2026-12-27T'+String(9+i).padStart(2,'0')+':00:00Z',ends_at:'2026-12-27T'+String(10+i).padStart(2,'0')+':00:00Z'}));
const activity={id:id(7),trip_id:tripId,title:'Museo Sintetico',venue_name:null,address:null,city:'Bologna',
 activity_type:'museum',reservation_status:'confirmed',start_at:'2026-12-27T08:15:00Z',end_at:'2026-12-27T08:45:00Z',
 time_zone:'Europe/London',booking_reference:'KEEP-RESERVATION',notes:'Original ticket',latitude:null,longitude:null,
 resolved_location:null,location_points:null,created_at:'2030-01-01T00:00:00Z',updated_at:'2030-01-01T00:00:00Z'};
const activityOriginal=structuredClone(activity),allRows=[...rows,activity];
const originals=structuredClone(rows),writes=[],searches=[];
let releaseSearch=null;
const stops=[{trip_id:tripId,canonical_name:'Bologna',country_code:'IT',position:1,time_zone:'Europe/London'}];
const tripRow={id:tripId,name:'Synthetic points trip',start_date:'2026-12-27',end_date:'2026-12-27',time_zone:'Europe/London',owner_id:userId,is_owner:true,experience_key:null};
const raw=name=>({name,formatted:name+', Bologna',city:'Bologna',country_code:'it',result_type:'amenity',place_id:name,
 lat:44.49,lon:11.34,timezone:{name:'Europe/London'},datasource:{sourcename:'fixture',attribution:'Synthetic data'}});
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
const browser=await pw[engine].launch({headless:true,...(process.env.IMPORT_BROWSER_PATH?{executablePath:process.env.IMPORT_BROWSER_PATH}:{})});
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
  if(body.text.startsWith('Service failure'))return {data:{error:'provider_unavailable'},error:null};
  if(body.text.startsWith('Delayed'))await new Promise(resolve=>{releaseSearch=resolve});
  const title=body.text.split(',')[0],places=title==='Basilica di San Domenico'?
   [normalizeGeoapify({...raw(title),place_id:'domenico-1',formatted:'Basilica di San Domenico, Piazza San Domenico, 40124 Bologna BO, Italia'}),
    normalizeGeoapify({...raw(title),place_id:'domenico-2',lat:44.49012,lon:11.34009,formatted:'Basilica di San Domenico, 40125 Bologna BO, Italia'}),
    normalizeGeoapify({...raw('Basilica di Santo Stefano'),place_id:'stefano',formatted:'Basilica di Santo Stefano, Piazza Santo Stefano, Bologna'})]:
   title==='Unknown Museum'?[]:title==='Central Museum'?
   [normalizeGeoapify({...raw(title),place_id:'one'}),normalizeGeoapify({...raw(title),place_id:'two',lat:44.53})]:[normalizeGeoapify({...raw(title==='centre històric'?'Centro Storico':title==='Basilica de San Petronio'?'Basilica di San Petronio':title),result_type:['Quadrilatero','centre històric'].includes(title)?'suburb':title==='Via del Pratello'?'street':'amenity'})];
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
  window.fixtureRealtime=[];
  db.channel=()=>{const c={on:(_event,filter,callback)=>{window.fixtureRealtime.push({table:filter.table,callback});return c},subscribe:()=>c,unsubscribe:async()=>{}};return c};db.removeChannel=async()=>{};
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:(name,{body})=>window.fixtureInvoke(name,body)}});
  await renderSession({user:{id:userId,email:'v27@example.invalid'}});await selectTrip(tripRow.id,{open:true});
 },{tripRow,stops,userId});
 await page.locator('#genericItineraryModuleCard').click();
 await page.waitForFunction(()=>manualItineraryRows.length===7&&manualItineraryRows.every(row=>row.location_points)&&activityRows.some(row=>row.location_points));
 assert.equal(writes.length,8,'One geography-only patch per activity; no duplicate activities');
 assert.deepEqual(rows.map(row=>row.location_points.points.length),[3,2,1,1,1,1,1]);
 for(const i of [2,3,4])assert.equal(rows[i].location_points.points[0].status,'approximate');
 for(const i of [5,6])assert.equal(rows[i].location_points.points[0].status,'pending');
 assert.ok(searches.every(s=>s.country_code==='IT'));
 for(const row of allRows){const original=row===activity?activityOriginal:originals.find(r=>r.id===row.id);for(const key of Object.keys(original).filter(k=>!['location_points','updated_at'].includes(k)))assert.deepEqual(row[key],original[key],key+' unchanged')}
 const first=page.locator('[data-activity-points="manual:'+rows[0].id+'"]');
 await first.tap();
 let editor=page.locator('[data-activity-point-editor]');await editor.waitFor({state:'visible'}).catch(async e=>{console.error('Editor diagnostics',await page.locator('#genericItineraryMessage').textContent(),errors);throw e});
 const selectPoint=async n=>{const toggle=editor.getByRole('button',{name:'Edita el punt '+n,exact:true});if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.tap()};
 const pointOptions=async n=>{await selectPoint(n);const options=editor.locator('fieldset').nth(n-1).locator('[data-point-actions]');if(await options.getAttribute('open')===null)await options.locator('summary').tap()};
 assert.equal(await editor.locator('fieldset').count(),3);
 assert.equal(await editor.locator('[data-point-body]:visible').count(),1,'Only selected point expanded');
 assert.equal(await editor.getByRole('button',{name:'Puja el punt 2',exact:true}).isVisible(),false,'Secondary controls tucked away');
 await editor.screenshot({path:resolve(tmpdir(),'freya-compact-editor-'+engine+'.png')});
 // Native names and linguistic variants are user queries, never invented coordinates or automatic choices.
 for(const [n,query]of [[1,'Piazza Maggiore'],[2,'Fontana del Nettuno'],[3,'Basilica di San Petronio'],[3,'Basilica de San Petronio']]){
  await selectPoint(n);await editor.getByLabel('Nom del punt '+n,{exact:true}).fill(query);
  const box=editor.locator('fieldset').nth(n-1);
  await box.getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
  await box.locator('[data-point-results] button').first().waitFor();
  assert.match(await box.locator('[data-point-feedback]').innerText(),/Tria el lloc/);
  assert.equal(writes.length,8,'Searching variants never saves or auto-confirms');
  assert.match(await box.locator('[data-point-toggle]').innerText(),/Tria una coincidència/,'Candidate requires explicit selection');
  await box.locator('[data-point-results] button').first().tap();
  assert.match(await box.locator('[data-point-toggle]').innerText(),/Ubicació verificada/);
  assert.equal(writes.length,8,'Selecting each of the three monuments keeps an unsaved draft');
 }
 assert.ok(searches.some(s=>s.text.startsWith('Basilica di San Petronio,')));
 assert.ok(searches.some(s=>s.text.startsWith('Basilica de San Petronio,')),'Distinct language variants reach provider');
 await selectPoint(1);await editor.getByLabel('Nom del punt 1',{exact:true}).fill('Unknown Museum');
 await editor.locator('fieldset').first().getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
 await editor.locator('fieldset').first().locator('[data-point-feedback]').filter({hasText:'Cap coincidència verificable'}).waitFor();
 assert.equal(await editor.locator('fieldset').first().locator('[data-point-results] button').count(),0);
 await selectPoint(1);
 await editor.getByLabel('Nom del punt 1',{exact:true}).fill('Service failure');
 await editor.locator('fieldset').first().getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
 await editor.locator('fieldset').first().locator('[data-point-feedback][data-error="true"]').waitFor();
 assert.ok((await editor.locator('fieldset').first().locator('[data-point-feedback]').innerText()).length>0,'Provider error shown next to search');
 await selectPoint(2);
 assert.match(await editor.locator('fieldset').first().locator('[data-point-toggle]').innerText(),/Cerca no disponible/,'Collapsed point makes its error visible');
 await selectPoint(1);
 assert.equal(await editor.locator('fieldset').first().locator('[data-point-feedback][data-error="true"]').isVisible(),true,'Error survives point switching');
 await editor.getByRole('button',{name:'Cancel·la',exact:true}).tap();await first.tap();await editor.waitFor({state:'visible'});

 // Real touch-sized UI: same-name nearby provider records collapse; different basilicas stay.
 const firstInput=editor.getByLabel('Nom del punt 1',{exact:true});
 await firstInput.fill('Basilica di San Domenico');
 await editor.locator('fieldset').first().getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
 await editor.locator('[data-point-results] button').first().waitFor();
 const basilicaButtons=editor.locator('fieldset').first().locator('[data-point-results] button');
 assert.equal(await basilicaButtons.count(),1,'nearby San Domenico records collapsed and Santo Stefano excluded');
 assert.equal(await basilicaButtons.first().locator('strong').innerText(),'Basilica di San Domenico');
 assert.match(await basilicaButtons.first().locator('small').innerText(),/Piazza San Domenico · Lloc exacte/);
 assert.equal(await basilicaButtons.filter({hasText:'Santo Stefano'}).count(),0,'Wrong saint must never appear');
 const queriesBeforeToggle=searches.length;await selectPoint(2);await selectPoint(1);
 assert.equal(await basilicaButtons.count(),1);assert.equal(searches.length,queriesBeforeToggle);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no sideways mobile scrolling');
 assert.equal(writes.length,8,'searching and grouping candidates never writes');
 await firstInput.fill('Piazza Maggiore provisional');
 await page.evaluate(async()=>{await loadManualItineraryItems(true);renderGenericItinerary()});
 assert.equal(await editor.isVisible(),true,'Open editor survives planning refresh');
 assert.equal(await editor.getByLabel('Nom del punt 1',{exact:true}).evaluate(node=>document.activeElement===node),true,'Focused name survives reconciliation');
 await page.locator('#refreshGenericItinerary').tap();
 await page.waitForFunction(()=>itineraryLoadBatch===0);
 assert.equal(await editor.isVisible(),true,'Editor survives actual refresh button');
 assert.equal(await editor.getByLabel('Nom del punt 1',{exact:true}).inputValue(),'Piazza Maggiore provisional');
 // Real background enrichment of another activity must not close or save this editor.
 rows[1].location_points=null;rows[1].updated_at='2032-01-01T00:00:00Z';
 const beforeBackground=writes.length;
 await page.evaluate(async()=>{await loadManualItineraryItems(true);renderGenericItinerary()});
 await page.waitForFunction(()=>manualItineraryRows[1].location_points!==null);
 assert.equal(writes.length,beforeBackground+1);assert.equal(writes.at(-1).id,rows[1].id);
 assert.equal(await editor.getByLabel('Nom del punt 1',{exact:true}).inputValue(),'Piazza Maggiore provisional');
 await pointOptions(2);
 await editor.getByRole('button',{name:'Puja el punt 2',exact:true}).tap();
 await selectPoint(2);
 await editor.getByLabel('Nom del punt 2',{exact:true}).fill('Delayed Piazza');
 await editor.locator('fieldset').nth(1).getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
 await editor.locator('fieldset').nth(1).locator('[data-point-feedback]').filter({hasText:'Cercant'}).waitFor();
 await selectPoint(1);
 const beforeReview=writes.length;
 await page.evaluate(async()=>{
  const callbacks=window.fixtureRealtime.filter(c=>c.table==='trip_itinerary_items');
  if(!callbacks.length)throw Error('No real Realtime subscription registered');
  await Promise.all(callbacks.map(c=>c.callback()));renderGenericItinerary();
 });
 assert.equal(await editor.isVisible(),true,'In-flight search survives Realtime reconciliation');
 for(let i=0;!releaseSearch&&i<100;i++)await new Promise(r=>setTimeout(r,10));
 assert.ok(releaseSearch);releaseSearch();releaseSearch=null;
 await selectPoint(2);
 const candidate=editor.locator('[data-point-results] button').filter({hasText:'Delayed Piazza'});
 await candidate.waitFor();
 await candidate.evaluate(node=>{node.focus();node.scrollIntoView({block:'center'})});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const position=await candidate.evaluate(node=>node.getBoundingClientRect().top);
 await page.evaluate(()=>renderGenericItinerary());
 const afterPosition=await candidate.evaluate(node=>node.getBoundingClientRect().top);
 assert.ok(Math.abs(afterPosition-position)<3,`Viewport anchor survives rerender: ${position} → ${afterPosition}`);
 await candidate.tap();
 await page.evaluate(()=>renderGenericItinerary());
 assert.match(await editor.locator('fieldset').nth(1).innerText(),/Delayed Piazza/);
 assert.match(await editor.locator('fieldset').first().innerText(),/Fontana/);
 // Remote same-activity revision: retain selected candidate, order and typed text, block save until review.
 rows[0].updated_at='2033-01-01T00:00:00Z';
 rows[0].location_points.points[0].query='Remote Piazza';
 await page.evaluate(async()=>{await loadManualItineraryItems(true);renderGenericItinerary()});
 await editor.getByRole('alert').filter({hasText:'activitat ha canviat'}).waitFor();
 assert.equal(await editor.getByRole('button',{name:'Desa els punts',exact:true}).isDisabled(),true);
 await editor.getByText('Revisa els canvis de l’activitat',{exact:true}).tap();
 await editor.getByRole('alert').getByText(/Remote Piazza/).waitFor();
 await editor.getByRole('alert').screenshot({path:resolve(tmpdir(),'freya-point-conflict-'+engine+'.png')});
 await page.evaluate(()=>renderGenericItinerary());
 assert.equal(await editor.getByRole('alert').locator('details').getAttribute('open'),'','Open conflict review survives refresh');
 await editor.getByRole('button',{name:'Conserva el meu esborrany sobre aquesta versió',exact:true}).tap();
 assert.equal(await editor.getByRole('button',{name:'Desa els punts',exact:true}).isEnabled(),true);
 assert.equal(writes.length,beforeReview,'Refresh, candidate selection and conflict review never save');
 assert.equal(await editor.getByLabel('Nom del punt 2',{exact:true}).inputValue(),'Delayed Piazza');
 await editor.getByRole('button',{name:'Cancel·la',exact:true}).tap();
 rows[0].location_points.points[0].query='Piazza Maggiore';
 await page.evaluate(async()=>{await loadManualItineraryItems(true);renderGenericItinerary()});
 await first.tap();await editor.waitFor({state:'visible'});


 await editor.locator('fieldset').first().screenshot({path:resolve(tmpdir(),'freya-point-editor-'+engine+'.png')});
 await pointOptions(2);
 await editor.getByRole('button',{name:'Puja el punt 2',exact:true}).tap();
 await pointOptions(3);
 await editor.getByRole('button',{name:'Elimina el punt 3',exact:true}).tap();
 await editor.getByRole('button',{name:'Afegeix un punt',exact:true}).tap();
 await selectPoint(3);
 await editor.getByLabel('Nom del punt 3',{exact:true}).fill('Via del Pratello');
 await editor.locator('fieldset').nth(2).getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
 await editor.locator('[data-point-results] button').filter({hasText:'Via del Pratello'}).tap();
 await editor.getByRole('button',{name:'Desa els punts',exact:true}).tap();
 await page.waitForFunction(()=>manualItineraryRows[0].location_points.points[0].place.canonical_name==='Fontana del Nettuno');
 assert.deepEqual(rows[0].location_points.points.map(p=>p.place.canonical_name),['Fontana del Nettuno','Piazza Maggiore','Via del Pratello']);
 assert.equal(rows[0].location_points.points[2].status,'approximate');
 assert.ok(writes.every(w=>Object.keys(w.patch).join(',')==='location_points'));
 const before=searches.length;
 await page.evaluate(async()=>{await loadManualItineraryItems(true);renderGenericItinerary()});
 await first.waitFor({state:'visible'});await first.tap();
 editor=page.locator('[data-activity-point-editor]');await editor.waitFor({state:'visible'}).catch(async e=>{console.error('Editor diagnostics',await page.locator('#genericItineraryMessage').textContent(),errors);throw e});
 assert.match(await editor.locator('fieldset').first().innerText(),/Fontana del Nettuno/);
 assert.equal(searches.length,before,'Saved ordered locations reused on reload');
 await selectPoint(1);
 await editor.getByLabel('Nom del punt 1',{exact:true}).fill('Fontana corretta');
 await editor.locator('fieldset').first().getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
 await editor.locator('[data-point-results] button').filter({hasText:'Fontana corretta'}).tap();
 await editor.getByRole('button',{name:'Desa els punts',exact:true}).tap();
 await page.waitForFunction(()=>manualItineraryRows[0].location_points.points[0].place.canonical_name==='Fontana corretta');
 assert.equal(rows[0].title,originals[0].title,'Point correction never renames the activity');
 await first.tap();editor=page.locator('[data-activity-point-editor]');await editor.waitFor({state:'visible'});
 // A second member changes the revision after this editor opened.
 rows[0].updated_at='2031-01-01T00:00:00Z';const writesBefore=writes.length;
 await editor.getByRole('button',{name:'Desa els punts',exact:true}).tap();
 await editor.getByRole('status').filter({hasText:'activitat ha canviat'}).waitFor();
 assert.equal(writes.length,writesBefore,'Stale editor must not overwrite');
 await editor.getByRole('button',{name:'Cancel·la',exact:true}).tap();
 assert.equal(await page.locator('[data-activity-point-editor]').count(),0);
 await first.tap();await editor.waitFor({state:'visible'});
 await selectPoint(1);
 await editor.getByLabel('Nom del punt 1',{exact:true}).fill('Delayed cancel');
 await editor.locator('fieldset').first().getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
 for(let i=0;!releaseSearch&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.ok(releaseSearch);
 await editor.getByRole('button',{name:'Cancel·la',exact:true}).tap();releaseSearch();releaseSearch=null;
 await page.evaluate(()=>renderGenericItinerary());
 assert.equal(await editor.count(),0,'Cancelled search never resurrects editor');
 await first.tap();await editor.waitFor({state:'visible'});
 await selectPoint(1);
 await editor.getByLabel('Nom del punt 1',{exact:true}).fill('Delayed trip change');
 await editor.locator('fieldset').first().getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
 for(let i=0;!releaseSearch&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.ok(releaseSearch);
 await page.evaluate(()=>selectTrip('missing-trip',{open:true}));
 releaseSearch();releaseSearch=null;
 assert.equal(await editor.count(),0,'Leaving the trip cancels editor');
 assert.equal(writes.length,writesBefore,'Cancellation and trip change never save');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile layout');
 assert.deepEqual(errors,[]);
 console.log(`PASS ${engine}: compact single-point controls, native/variant names, local errors/no-match, candidate state on fold/reopen; ordered multi-point enrichment, approximate zones, ambiguous pending, actual mobile add/search/select/reorder/remove/save clicks, geography-only CAS writes, reload reuse; editor preservation through enrichment, Realtime, refresh and pending search; scroll, candidates, conflict review and cancellation; no accidental writes.`);
}finally{await browser.close();await new Promise(r=>server.close(r))}

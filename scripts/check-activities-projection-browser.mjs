// Isolated synthetic data only. Block all remote HTTP and WebSocket traffic.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const engine=process.env.ACTIVITIES_ENGINE||'chromium',dist=resolve('dist'),id=n=>'17600000-0000-4000-8000-'+String(n).padStart(12,'0');
const trips=[{id:id(1),name:'Bolonya sintètica',time_zone:'Europe/Rome'},{id:id(2),name:'Eivissa sintètica',time_zone:'Europe/Madrid'},{id:id(3),name:'Londres sintètic',time_zone:'Europe/London',experience_key:'london-2026'}].map(t=>({...t,owner_id:id(9),start_date:'2026-12-27',end_date:'2026-12-28',is_owner:true}));
const manuals=trips.slice(0,2).flatMap((t,i)=>['exact','approximate','date','all_day','daypart','unscheduled'].map((kind,j)=>({id:id(20+i*10+j),trip_id:t.id,title:['Piazza Maggiore','San Luca','Dinar lliure','Portici','Trasllat a l’aeroport','Passeig pendent'][j],timing_kind:kind,starts_at:kind==='exact'?'2026-12-27T09:00:00Z':null,ends_at:null,local_date:['exact','unscheduled'].includes(kind)?null:'2026-12-27',time_zone:t.time_zone,approximate_start_time:kind==='approximate'?'12:00:00':null,approximate_end_time:null,daypart:kind==='daypart'?'afternoon':null,location_name:j===0?'Piazza Maggiore':null,city:i?'Eivissa':'Bolonya',notes:null,status:'planned',is_fixed:false,is_optional:false,sort_order:j,updated_at:'2026-10-22T10:00:00Z'})));
const activities=trips.slice(0,2).flatMap((t,i)=>[{id:id(50+i),trip_id:t.id,title:'Museu reservat',activity_type:'museum',reservation_status:'confirmed',start_at:'2026-12-28T09:00:00Z',time_zone:t.time_zone,updated_at:'2026-10-22T10:00:00Z'},{id:id(60+i),trip_id:t.id,title:'Bus reservat',activity_type:'transport',reservation_status:'reserved',start_at:null,updated_at:'2026-10-22T10:00:00Z'}]);
const server=createServer(async(req,res)=>{const path=resolve(dist,decodeURIComponent(new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,''))||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
 const ctx=await browser.newContext({viewport:process.env.ACTIVITIES_TABLET?{width:1024,height:768}:{width:390,height:844},isMobile:!process.env.ACTIVITIES_TABLET,hasTouch:true,serviceWorkers:'allow'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 async function boot(){
  await page.goto(url);await page.waitForFunction(()=>typeof renderSession==='function');await page.locator('#loginCard').waitFor({state:'visible'});
  await page.evaluate(async({trips,manuals,activities})=>{
   window.fixture={manuals,activities,writes:[],failManual:false};
   db.rpc=async name=>({data:name==='get_my_trips'?trips:[],error:null});
   db.from=table=>{const filters={},state={};const q=new Proxy({}, {get:(_,key)=>key==='then'?async resolve=>{
    if(fixture.failManual&&table==='trip_itinerary_items')return resolve({data:null,error:{message:'Synthetic failure'}});
    let rows=table==='trip_itinerary_items'?fixture.manuals:table==='trip_activities'?fixture.activities:table==='trip_activity_documents'?trips.slice(0,2).flatMap((t,i)=>['booking','ticket'].map((role,j)=>({trip_id:t.id,activity_id:'17600000-0000-4000-8000-'+String(50+i).padStart(12,'0'),document_id:'17600000-0000-4000-8000-'+String(80+j).padStart(12,'0'),document_role:role}))):table==='checklist_items'?['Reservar el pàrquing de l’aeroport','Guardar la planta i la plaça del cotxe','Fer una foto del lloc on hem aparcat','Preparar menjar i aigua per als dos gats','Netejar la sorra dels gats','Confirmar qui cuidarà els gats i deixar-li les claus'].map(text=>({trip_id:trips[2].id,text})):[];
    rows=rows.filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v));
    if(state.patch){fixture.writes.push({table,filters:{...filters},patch:state.patch});rows.forEach(row=>Object.assign(row,state.patch,{updated_at:'2026-10-22T11:00:00Z'}))}
    return resolve({data:state.single?rows[0]||null:rows,error:null});
   }:(...args)=>{if(key==='eq')filters[args[0]]=args[1];if(key==='update')state.patch=args[0];if(key==='maybeSingle'||key==='single')state.single=true;if(['insert','upsert','delete'].includes(key))throw Error('Unexpected '+key);return q}});return q};
   db.channel=()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe:async()=>{}};return c};db.removeChannel=async()=>{};
   Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async()=>({data:{candidates:[]},error:null})}});
   await renderSession({user:{id:trips[0].owner_id,email:'synthetic@example.invalid'}});await selectTrip(trips[0].id,{open:true});
  },{trips,manuals,activities});
 }
 await boot();await page.locator('#genericActivitiesModuleCard').click();
 await page.waitForFunction(()=>document.querySelectorAll('#activityList [data-activity-key]').length===7);
 assert.equal(await page.locator('#activityCount').innerText(),'7 activitats');
 assert.match(await page.locator('#activityList').innerText(),/~ 12:00/);
 assert.match(await page.locator('#activityList').innerText(),/Àpat del planning/);assert.match(await page.locator('#activityList').innerText(),/Trasllat del planning/);
 assert.equal(await page.locator('#activityList [data-activity-document]').count(),2);
 assert.equal(await page.locator('#activityList [data-activity-key^="manual:"] [data-activity-document]').count(),0);
 await page.locator(`[data-edit-activity="${id(50)}"]`).click();
 assert.equal(await page.locator('#activityTitle').inputValue(),'Museu reservat');
 assert.equal(await page.locator('#activityBookingDocument').inputValue(),id(80));
 assert.equal(await page.locator('#activityTicketDocument').inputValue(),id(81));
 await page.locator('#cancelActivity').click();
 assert.equal(await page.locator('#activityList').getByText('Bus reservat',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>fixture.writes.length),0);
 const key='manual:'+id(20),link=()=>page.locator(`[data-activity-planning="${key}"]`);
 await link().click();await page.locator('#itineraryView').waitFor({state:'visible'});
 await page.locator('#itineraryView [data-back]').click();await page.locator('#activitiesView').waitFor({state:'visible'});
 await page.goForward();await page.locator('#itineraryView').waitFor({state:'visible'});
 await page.goBack();await page.locator('#activitiesView').waitFor({state:'visible'});
 await link().click();await page.locator(`[data-itinerary-key="${key}"] [data-itinerary-source]`).click();
 await page.locator('#manualItineraryTitle').fill('Piazza Maggiore editada');await page.locator('#saveManualItinerary').click();
 await page.waitForFunction(()=>fixture.writes.length===1);
 assert.deepEqual(await page.evaluate(()=>fixture.writes.map(x=>({table:x.table,id:x.filters.id,trip:x.filters.trip_id,version:x.filters.updated_at}))),[{table:'trip_itinerary_items',id:id(20),trip:id(1),version:'2026-10-22T10:00:00Z'}]);
 await page.locator('#itineraryView [data-back]').click();await page.locator('#activitiesView').waitFor({state:'visible'});
 assert.equal(await page.locator('#activityList').getByText('Piazza Maggiore editada',{exact:true}).count(),1);
 // Repeated reads and imported IDs never materialize duplicate activity records.
 await page.evaluate(async()=>{await ensureTripAgenda(true);await loadActivityViewData()});
 assert.equal(await page.locator('#activityList [data-activity-key]').count(),7);
 await page.evaluate(()=>{persistOfflineAgendaSnapshot()});await ctx.setOffline(true);
 await page.evaluate(()=>{clearGenericItineraryState();setAppView('activitiesView')});
 await page.waitForFunction(()=>document.querySelectorAll('#activityList [data-activity-key]').length===7);
 assert.match(await page.locator('#activitySourceStatus').innerText(),/consulta/);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 assert.equal(await page.locator('#activityList [data-activity-key]').count(),7);
 await ctx.setOffline(false);
 // New trip must discard the old projection and route scope.
 await page.evaluate(async id=>{await selectTrip(id,{open:true});setAppView('activitiesView')},id(2));
 await page.waitForFunction(()=>document.querySelectorAll('#activityList [data-activity-key]').length===7);
 assert.equal(await page.locator(`[data-activity-key="${key}"]`).count(),0);
 assert.match(await page.locator('#activityList').innerText(),/Eivissa/);
 // Failed manual read is visible; success can be retried without losing reservations.
 await page.evaluate(async()=>{fixture.failManual=true;clearGenericItineraryState();manualItineraryRows=[];await loadActivityViewData()});
 assert.match(await page.locator('#activitySourceStatus').innerText(),/Llista parcial/);
 await page.evaluate(async()=>{fixture.failManual=false;await loadActivityViewData()});
 assert.equal(await page.locator('#activityList [data-activity-key]').count(),7);
 await page.evaluate(async id=>{await selectTrip(id,{open:true});setAppView('activitiesView')},id(3));
 await page.locator('#dashboardView').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>unifiedActivityItems().length),0);
 assert.equal(await page.evaluate(()=>fixture.writes.length),1);
 await boot();await page.locator('#genericActivitiesModuleCard').click();
 await page.waitForFunction(()=>document.querySelectorAll('#activityList [data-activity-key]').length===7);
 assert.equal(await page.evaluate(()=>fixture.writes.length),0);
 assert.deepEqual(errors,[]);console.log(`PASS unified activities ${engine}: synthetic Bolonya/Eivissa/London, stable IDs, explicit edit, Back/Forward, partial loading and offline.`);
}finally{await browser.close();server.close()}

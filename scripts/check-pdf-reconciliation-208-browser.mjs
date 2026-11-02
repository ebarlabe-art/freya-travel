// Real Pages build and touch controls; only synthetic transport/state. No remote writes.
import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {createServer} from 'node:http';import {resolve,extname,sep} from 'node:path';import {pathToFileURL} from 'node:url';
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),engine=process.env.PLANNING_ENGINE||'chromium',dist=resolve('dist');
const server=createServer(async(req,res)=>{const path=resolve(dist,new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,'')||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:process.env.RECONCILE_TABLET?{width:1024,height:768}:{width:390,height:844},isMobile:!process.env.RECONCILE_TABLET,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 const seed=async()=>{
  const id=n=>'20800000-0000-4000-8000-'+String(n).padStart(12,'0');
  session={user:{id:id(3)}};trip={id:id(1),name:'Riga sintètic #208',start_date:'2026-12-26',end_date:'2027-01-02',time_zone:'Europe/Riga'};
  const title='Museu Nacional d’Art de Letònia';
  const existing=[{id:id(20),trip_id:trip.id,title,city:'Riga',location_name:title,timing_kind:'exact',starts_at:'2026-12-28T08:00Z',ends_at:'2026-12-28T09:00Z',time_zone:'Europe/Riga',updated_at:'2026-11-02T12:00Z',status:'planned',photo_count:0,link_count:0,is_fixed:false}];
  const field=value=>({value,confidence:'high',evidence:[{kind:'text',excerpt:value,page:1}]});
  const candidates=[[title,'10:15','11:15'],['Passeig al parc Bastejkalna','10:30','11:30']].map(([title,start,end],source_order)=>({source_order,classification_hint:'manual',warnings:[],fields:Object.fromEntries(Object.entries({title,city:'Riga',location_name:title,local_date:'2026-12-28',start_local_time:start,end_local_time:end,time_zone:'Europe/Riga'}).map(([k,v])=>[k,field(v)]))}));
  flightRows=['AY1020','AY1020','AY1653','AY1653'].map((number,i)=>({id:id(30+i),trip_id:trip.id,flight_number:number,departure_airport_code:i%2?'':i<2?'TLL':'HEL',arrival_airport_code:i%2?'':i<2?'HEL':'BCN',departure_at:i<2?'2027-01-02T07:00Z':'2027-01-02T10:00Z',arrival_at:i<2?'2027-01-02T08:00Z':'2027-01-02T13:00Z',departure_time_zone:'Europe/Helsinki',arrival_time_zone:i<2?'Europe/Helsinki':'Europe/Madrid',passengers:i%2?'Xesc':'Eva',seat:i%2?'1B':'1A',updated_at:'2026-11-02T12:00Z'}));
  for(const type of ['flight','accommodation','activity','manual']){const marker=itinerarySourceMarker(type,trip.id,tripLoadGeneration,session.user.id);itinerarySourceReady[type]=marker;itinerarySourceAvailable[type]=marker}
  itineraryProjection=normalizedItineraryProjection(trip.id,tripLoadGeneration,session.user.id);
  const api=await loadTravelBookModule('import-itinerary-review.mjs'),saveApi=await loadTravelBookModule('import-itinerary-write.mjs');
  const proposal={schema_version:1,source:{kind:'document',document_id:id(6),mime_type:'application/pdf'},candidates};
  itineraryImportState={tripId:trip.id,userId:session.user.id,generation:tripLoadGeneration,api,saveApi,documentId:id(6),review:api.createItineraryReview(proposal,{tripId:trip.id,userId:session.user.id,documentId:id(6)}),busy:false};
  window.fixture={existing,before:JSON.stringify(existing),flights:JSON.stringify(flightRows),writes:[],reads:0};
  db.rpc=async(name,request)=>{if(name==='read_itinerary_reconciliation')return {data:structuredClone(existing),error:null};if(name!=='commit_itinerary_reconciliation')throw Error('Unexpected RPC');fixture.writes.push(request);return {data:{operation_id:request.p_operation_id,added:1,updated:1,retired:0},error:null}};
  db.from=table=>{if(table!=='travel_documents')throw Error('Unexpected table');let photos=false;const q={select:()=>q,eq:(k,v)=>{if(k==='category'&&v==='Foto')photos=true;return q},neq:()=>q,order:async()=>({data:photos?[]:[{id:id(6),title:'PDF sintètic 208',file_name:'synthetic.pdf',mime_type:'application/pdf',category:'Altres'}],error:null})};return q};
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async(name,{body})=>name==='import-itinerary'?(fixture.reads++,{data:{proposal:{...proposal,source:{...proposal.source,document_id:body.document_id}}},error:null}):{data:null,error:{message:'Synthetic route unavailable'}}}});
  loadGenericItinerary=async()=>{};
  APP_VIEWS.forEach(id=>document.getElementById(id)?.classList.toggle('hidden',id!=='itineraryView'));configureItineraryContent();
  for(const id of ['itineraryView','itineraryImportPanel','itineraryImportPreview']){let n=document.getElementById(id);while(n){n.classList.remove('hidden');n=n.parentElement}}document.getElementById('loginCard').classList.add('hidden');document.getElementById('itineraryImportSource').classList.add('hidden');renderItineraryImportPreview();
 };
 for(const choice of ['keep','update']){
  await page.evaluate(seed);
  await page.locator('#openItineraryImport').tap();await page.locator('#itineraryImportUpload').tap();await page.locator('#itineraryImportChooseExisting').tap();
  await page.locator('#itineraryImportExisting').selectOption('20800000-0000-4000-8000-000000000006');await page.locator('#itineraryImportConsent').check();await page.locator('#itineraryImportAnalyze').tap();
  await page.waitForFunction(()=>itineraryImportState?.planning&&!itineraryImportState.preparing&&!itineraryImportState.planningBusy);
  assert.equal(await page.evaluate(()=>fixture.reads),1);
  assert.equal(await page.locator('[data-import-comparison="modified"]').count(),1);assert.match(await page.locator('#itineraryImportFlash').innerText(),/Abans · Inici/);assert.match(await page.locator('#itineraryImportFlash').innerText(),/Després · Inici/);
  assert.equal(await page.evaluate(()=>itineraryImportState.planning.assessment.issues.filter(i=>i.kind==='conflict'&&i.keys.some(k=>k.startsWith('flight:'))).length),0);
  await page.locator('[data-flash-action="'+choice+'"]').tap();
  const flash=page.locator('#itineraryConflictFlash');await flash.waitFor({state:'visible'});assert.match(await flash.innerText(),/Bastejkalna/);assert.match(await flash.innerText(),/Confiança baixa/);assert.match(await flash.innerText(),/obertures/);
  const before=await page.evaluate(()=>JSON.stringify(itineraryImportState.review));
  await flash.locator('[data-solution-editor] > summary').tap();await flash.locator('[data-solution-start]').fill('15:00');await flash.locator('[data-planning-cancel-edit]').tap();
  assert.equal(await page.evaluate(()=>JSON.stringify(itineraryImportState.review)),before);assert.equal(await page.evaluate(()=>fixture.writes.length),0);
  if(choice==='keep'){
   await flash.locator('[data-solution-editor] > summary').tap();await flash.locator('[data-solution-end]').fill('16:00');await flash.locator('[data-planning-edit]').tap();
  }else await flash.locator('[data-planning-accept]').first().tap();
  await page.waitForFunction(()=>itineraryImportState.planning.assessment.counts.conflicts===0);
  assert.equal(await page.evaluate(()=>fixture.writes.length),0);assert.equal(await page.evaluate(()=>JSON.stringify(fixture.existing)===fixture.before&&JSON.stringify(flightRows)===fixture.flights),true);
  await page.locator('#itineraryImportWrite').tap();await page.locator('#itineraryImportConfirm').waitFor({state:'visible'});
  if(choice==='keep'){await page.locator('#itineraryImportConfirmNo').tap();await page.waitForFunction(()=>!itineraryImportState.busy);assert.equal(await page.evaluate(()=>fixture.writes.length),0)}
  else {assert.match(await page.locator('#itineraryImportConfirmText').innerText(),/1 actualitzades/);await page.locator('#itineraryImportConfirmYes').tap();await page.waitForFunction(()=>itineraryImportState===null&&document.getElementById('genericItineraryMessage').textContent.includes('Planning desat'));const request=await page.evaluate(()=>fixture.writes);assert.equal(request.length,1);assert.equal(request[0].p_document_id,'20800000-0000-4000-8000-000000000006');assert.match(JSON.stringify(request[0].p_changes),/20800000-0000-4000-8000-000000000020/);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 assert.deepEqual(errors,[]);console.log('PASS #208 '+engine+': real PDF flow, shared-flight projection, before/after, keep/update, park priority, confidence, edit/cancel/accept, final cancel/confirm, original tickets unchanged.');
}finally{await browser.close();server.close()}

// Real Pages build and touch controls; only synthetic transport/state. No remote writes.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {resolve,extname,sep} from 'node:path';import {pathToFileURL} from 'node:url';
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),engine=process.env.PLANNING_ENGINE||'chromium',dist=resolve('dist');
const server=createServer(async(req,res)=>{const path=resolve(dist,new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,'')||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:process.env.RECONCILE_TABLET?{width:1024,height:768}:{width:390,height:844},isMobile:!process.env.RECONCILE_TABLET,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 const installFixture=async mode=>{
  const id=n=>'14000000-0000-4000-8000-'+String(n).padStart(12,'0');
  session={user:{id:id(3)}};trip={id:id(1),name:'Riga sintètic RIG04',start_date:'2030-12-26',end_date:'2031-01-02',time_zone:'Europe/Riga'};
  const field=value=>({value,confidence:'high',evidence:[{kind:'text',excerpt:value,page:1}]});
  const existing=mode==='new'?[]:[{id:id(20),trip_id:id(1),title:'Catedral de Riga',city:'Riga',location_name:'Catedral de Riga',timing_kind:'exact',starts_at:'2030-12-27T08:00:00Z',ends_at:'2030-12-27T09:00:00Z',time_zone:'Europe/Riga',local_date:null,updated_at:'2026-10-29T12:00:00Z',status:'planned',photo_count:0,link_count:0,is_fixed:false}];
  const candidates=[['Riga Cathedral','2030-12-27','10:00','11:00'],['Museu','2030-12-27','10:30','12:00'],['Museu','2030-12-28','10:00','11:00']].map(([title,date,start,end],i)=>({source_order:i,classification_hint:'manual',warnings:[],fields:{title:field(title),city:field('Riga'),location_name:field(title),local_date:field(date),start_local_time:field(start),end_local_time:field(end),time_zone:field('Europe/Riga')}}));
  const api=await loadTravelBookModule('import-itinerary-review.mjs'),saveApi=await loadTravelBookModule('import-itinerary-write.mjs');
  itineraryProjection=mode==='new'?[]:[{key:'activity:'+id(30),tripId:trip.id,sourceId:id(30),sourceType:'activity',title:'Reserva confirmada',localDate:'2030-12-27',startsAt:'2030-12-27T09:15:00Z',endsAt:'2030-12-27T10:15:00Z',timeZone:'Europe/Riga',timingKind:'exact',status:'confirmed',sourceUpdatedAt:'2026-10-29T12:00Z'}];
  for(const type of ['flight','accommodation','activity','manual'])itinerarySourceReady[type]=itinerarySourceMarker(type,trip.id,tripLoadGeneration,session.user.id);
  itineraryImportState={tripId:trip.id,userId:session.user.id,generation:tripLoadGeneration,api,saveApi,documentId:id(6),review:api.createItineraryReview({schema_version:1,source:{kind:'document',document_id:id(6),mime_type:'application/pdf'},candidates},{tripId:trip.id,userId:session.user.id,documentId:id(6)}),busy:false};
  window.fixture={proposal:{schema_version:1,source:{kind:'document',document_id:id(6),mime_type:'application/pdf'},candidates},existing,before:JSON.stringify(existing),agenda:JSON.stringify(itineraryProjection),writes:0,requests:[],fail:true};
  db.rpc=async(name)=>{if(name==='read_itinerary_reconciliation')return {data:structuredClone(existing),error:null};fixture.writes++;throw Error('No writes allowed')};
  db.from=table=>{if(table!=='travel_documents')throw Error('Unexpected table');let photos=false;const q={select:()=>q,eq:(k,v)=>{if(k==='category'&&v==='Foto')photos=true;return q},neq:()=>q,order:async()=>({data:photos?[]:[{id:id(6),title:'PDF sintètic RIG04',file_name:'synthetic.pdf',mime_type:'application/pdf',category:'Altres'}],error:null}),insert:()=>{fixture.writes++;throw Error('No writes')},update:()=>{fixture.writes++;throw Error('No writes')}};return q};
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async(name,{body})=>{if(name==='import-itinerary')return {data:{proposal:fixture.proposal},error:null};fixture.requests.push(body);await new Promise(r=>setTimeout(r,30));return fixture.fail?{data:null,error:{message:'network failure'}}:{data:{route:{method:'routing',mode:'walk',distance_m:1000,duration_seconds:600,source:'Synthetic route',calculated_at:new Date().toISOString()}},error:null}}}});
  APP_VIEWS.forEach(id=>document.getElementById(id)?.classList.toggle('hidden',id!=='itineraryView'));configureItineraryContent();
  for(const id of ['itineraryView','itineraryImportPanel','itineraryImportPreview']){let n=document.getElementById(id);while(n){n.classList.remove('hidden');n=n.parentElement}}document.getElementById('loginCard').classList.add('hidden');document.getElementById('itineraryImportSource').classList.add('hidden');renderItineraryImportPreview();
 };
 for(const mode of ['existing','new']){
  await page.evaluate(installFixture,mode);
  await page.locator('#openItineraryImport').tap();
  await page.locator('#itineraryImportUpload').tap();await page.locator('#itineraryImportChooseExisting').tap();
  await page.locator('#itineraryImportExisting').selectOption('14000000-0000-4000-8000-000000000006');
  await page.locator('#itineraryImportConsent').check();await page.locator('#itineraryImportAnalyze').tap();
  await page.locator('#itineraryImportPreview').waitFor({state:'visible'});
  await page.locator('#itineraryImportPlanning').tap();await page.locator('[data-planning-summary]').waitFor();
  assert.equal(await page.locator('#itineraryImportDecisionDetails').evaluate(n=>n.open),false);
  assert.equal(await page.locator('#itineraryImportPdfDetails').evaluate(n=>n.open),false);
  const before=await page.evaluate(()=>JSON.stringify(itineraryImportState.review));
  assert.equal(await page.evaluate(()=>fixture.writes),0);
  const counts=await page.evaluate(()=>({keep:itineraryImportState.reconciliation.decisions.filter(x=>x.action==='keep').length,add:itineraryImportState.reconciliation.decisions.filter(x=>x.action==='add').length}));
  assert.deepEqual(counts,mode==='existing'?{keep:1,add:2}:{keep:0,add:3});
  assert.match(await page.locator('[data-planning-summary]').innerText(),/incompatibilitats/);
  await page.locator('[data-planning-accept]').first().tap();
  assert.notEqual(await page.evaluate(()=>JSON.stringify(itineraryImportState.review)),before);
  assert.equal(await page.evaluate(()=>JSON.stringify(fixture.existing)===fixture.before&&JSON.stringify(itineraryProjection)===fixture.agenda),true);
  assert.equal(await page.evaluate(()=>fixture.writes),0);assert.match(await page.locator('#itineraryImportSaveStatus').innerText(),/només a l’esborrany/);
  await page.locator('[data-planning-routes]').tap();await page.waitForFunction(()=>!itineraryImportState.planningBusy);
  await page.locator('[data-planning-pending] summary').tap();
  assert.match(await page.locator('#itineraryPlanningReport').innerText(),/pendent|verificar/);
  const requests=await page.evaluate(()=>fixture.requests);assert.ok(requests.length>0,JSON.stringify(await page.evaluate(()=>({items:itineraryImportState.planning.combined.items,routes:itineraryImportState.planning.routes,status:document.getElementById("itineraryImportSaveStatus").textContent}))));assert.ok(requests.every(r=>r.kind==='draft'));
  assert.doesNotMatch(JSON.stringify(requests),/bookingCode|documents|notes/);
  await page.evaluate(()=>fixture.fail=false);await page.locator('[data-planning-routes]').tap();await page.waitForFunction(()=>!itineraryImportState.planningBusy);
  assert.equal(await page.evaluate(()=>fixture.writes),0);
  assert.ok(await page.evaluate(()=>itineraryImportState.planning.assessment.issues.some(i=>i.code==='travel')),'verified route reveals insufficient transfer time');
  await page.locator('[data-planning-calculated] summary').tap();
  assert.match(await page.locator('#itineraryPlanningReport').innerText(),/10 min a peu/);
  await page.locator('#itineraryImportWrite').tap();await page.locator('#itineraryImportConfirm').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>fixture.writes),0);
  await page.locator('#itineraryImportConfirmNo').tap();await page.waitForFunction(()=>!itineraryImportState.busy);
  assert.equal(await page.evaluate(()=>fixture.writes),0);
  const afterRoutes=await page.evaluate(()=>fixture.requests.length);
  await page.locator('[data-planning-routes]').tap();await page.waitForFunction(()=>!itineraryImportState.planningBusy);
  assert.equal(await page.evaluate(()=>fixture.requests.length),afterRoutes,'fresh routes are reused');
  await page.locator('#itineraryImportPdfDetails > summary').tap();
  const endField=page.locator('input[data-import-edit="2"][data-import-field="end_local_time"]');
  const card=page.locator('#itineraryImportCandidates details').filter({has:endField});
  if(!await card.evaluate(n=>n.open))await card.locator('summary').first().tap();
  await endField.fill('');await endField.press('Tab');
  assert.ok(await page.evaluate(()=>itineraryImportState.planning.assessment.issues.some(i=>i.code==='duration'&&i.keys.includes('pdf:2'))));
  assert.notEqual(await page.evaluate(()=>itineraryImportState.planning.assessment.status),'supported');
  await page.locator('#itineraryImportPlanning').tap();
  assert.equal(await page.evaluate(()=>new Set(itineraryImportState.reconciliation.decisions.map(d=>d.source_order)).size===itineraryImportState.reconciliation.decisions.length),true);
  if(mode==='existing'){
   await page.evaluate(()=>{itineraryImportState.api.changeItineraryReviewItem(itineraryImportState.review,0,'start_local_time','10:15');renderItineraryImportPreview()});
   assert.equal(await page.evaluate(()=>itineraryImportState.reconciliation.decisions.some(d=>d.source_order===0&&d.automatic)),false,'changed PDF hours invalidate automatic equivalence');
  }
  assert.notEqual(await page.locator('[data-planning-summary]').innerText(),'Compatible amb les dades verificades; els trajectes són estimacions','missing openings cannot certify the itinerary');
  await page.locator('#itineraryImportExit').tap();assert.equal(await page.evaluate(()=>itineraryImportState),null);
 }
 assert.deepEqual(errors,[]);console.log('PASS RIG04 '+engine+': existing/new draft, multilingual KEEP, distinct museums, fixed reservation, real touch acceptance, route failure/retry, cancel, zero writes.');
}finally{await browser.close();server.close()}

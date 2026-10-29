// Real Pages build and touch controls; only synthetic transport/state. No remote writes.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {resolve,extname,sep} from 'node:path';import {pathToFileURL} from 'node:url';
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),engine=process.env.RECONCILE_ENGINE||'chromium',dist=resolve('dist');
const server=createServer(async(req,res)=>{const path=resolve(dist,new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,'')||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:process.env.RECONCILE_TABLET?{width:1024,height:768}:{width:390,height:844},isMobile:!process.env.RECONCILE_TABLET,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 const installFixture=async()=>{
  const id=n=>'13000000-0000-4000-8000-'+String(n).padStart(12,'0');window.rigId=id;
  session={user:{id:id(3)}};trip={id:id(1),name:'Riga + Tallinn sintètic',start_date:'2030-12-26',end_date:'2031-01-02',time_zone:'Europe/Riga'};
  const field=value=>({value,confidence:'high',evidence:[{kind:'text',excerpt:value,page:1}]});
  const names=['Catedral de Riga','Casa dels Caps Negres','Mercat Central de Riga','Passeig antic'];
  const existing=Array.from({length:13},(_,i)=>({id:id(20+i),trip_id:id(1),title:names[i]||'Visita antiga '+i,timing_kind:'exact',starts_at:'2030-12-27T08:00:00Z',time_zone:'Europe/Riga',local_date:null,updated_at:'2026-10-29T12:00:00Z',status:'planned',photo_count:0,link_count:0,is_fixed:false}));
  const candidates=Array.from({length:25},(_,i)=>({source_order:i,classification_hint:'manual',warnings:[],fields:{title:field(i===5?'(a confirmar) Huskies si hi ha neu':names[i]||'Visita nova '+i),local_date:field('2030-12-'+(28+i%3)),start_local_time:field(String(8+Math.floor(i/3)).padStart(2,'0')+':00'),time_zone:field(i%3===2?'Europe/Tallinn':'Europe/Riga'),location_name:field('Lloc sintètic '+i)}}));
  const api=await loadTravelBookModule('import-itinerary-review.mjs'),saveApi=await loadTravelBookModule('import-itinerary-write.mjs');
  const source={kind:'document',document_id:id(6),mime_type:'application/pdf'};
  itineraryProjection=[];for(const type of ['flight','accommodation','activity','manual'])itinerarySourceReady[type]=itinerarySourceMarker(type,trip.id,tripLoadGeneration,session.user.id);
  itineraryImportState={tripId:trip.id,userId:session.user.id,generation:tripLoadGeneration,api,saveApi,documentId:id(6),review:api.createItineraryReview({schema_version:1,source,candidates},{tripId:trip.id,userId:session.user.id,documentId:id(6)}),busy:false};
  window.fixture={existing,writes:[],mode:'network',loads:0};db.rpc=async(name,payload)=>{if(name==='read_itinerary_reconciliation')return {data:structuredClone(fixture.existing),error:null};if(name!=='commit_itinerary_reconciliation')throw Error('Unexpected RPC');fixture.writes.push(structuredClone(payload));await new Promise(r=>setTimeout(r,200));if(fixture.mode==='network')return {data:null,error:{message:'Failed to fetch'}};if(fixture.mode==='stale')return {data:null,error:{code:'PT409',message:'RIG_STALE'}};return {data:{operation_id:payload.p_operation_id,added:20,updated:3,retired:1},error:null}};
  db.from=()=>{throw Error('No separate writes/queries allowed in atomic save')};loadGenericItinerary=async()=>{fixture.loads++};
  APP_VIEWS.forEach(id=>document.getElementById(id)?.classList.toggle('hidden',id!=='itineraryView'));configureItineraryContent();
  for(const id of ['itineraryView','itineraryImportPanel','itineraryImportPreview']){let n=document.getElementById(id);while(n){n.classList.remove('hidden');n=n.parentElement}}document.getElementById('loginCard').classList.add('hidden');document.getElementById('itineraryImportSource').classList.add('hidden');renderItineraryImportPreview();
 };
 await page.evaluate(installFixture);
 await page.locator('#itineraryImportCompare').tap();await page.locator('[data-reconcile-summary]').waitFor();
 assert.match(await page.locator('[data-reconcile-summary]').innerText(),/13 existents conservades · 25 decisions pendents/);assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),true);
 for(let i=0;i<25;i++){
  const row=page.locator(`[data-reconcile-row="${i}"]`);await row.locator('summary').tap();
  await row.locator('[data-reconcile-action]').selectOption(i<3?'update':i===3?'keep':i===4?'skip':'add');
  if(i<4)await row.locator('[data-reconcile-target]').selectOption(await page.evaluate(n=>rigId(20+n),i));
 }
 assert.match(await page.locator('[data-reconcile-row="5"]').innerText(),/sense avís d’hora exacta/);
 const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,x:scrollX,wide:[...document.querySelectorAll('body *')].filter(n=>n.clientWidth&&n.scrollWidth>n.clientWidth+1).slice(0,15).map(n=>({tag:n.tagName,id:n.id,c:n.clientWidth,s:n.scrollWidth})),overflow:[...document.querySelectorAll('body *')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.right+scrollX>innerWidth+1}).slice(0,12).map(n=>({tag:n.tagName,id:n.id,cls:n.className,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right}))}));
 assert.ok(layout.scroll<=layout.width,'no horizontal overflow with expanded targets: '+JSON.stringify(layout));
 const old=page.locator('#itineraryImportReconciliation > details').last();await old.locator('summary').tap();await old.locator('[data-reconcile-retire]').nth(4).selectOption('retire');
 assert.match(await page.locator('[data-reconcile-summary]').innerText(),/20 noves · 3 actualitzacions · 1 retirades · 9 existents conservades · 0 decisions pendents/);
 await page.locator('#itineraryImportWrite').tap();await page.locator('#itineraryImportConfirmNo').tap();assert.equal(await page.evaluate(()=>fixture.writes.length),0);
 await ctx.setOffline(true);await page.evaluate(()=>renderItineraryImportPreview());assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),true);await ctx.setOffline(false);await page.evaluate(()=>renderItineraryImportPreview());
 await page.locator('#itineraryImportWrite').tap();assert.match(await page.locator('#itineraryImportConfirmText').innerText(),/20 noves, 3 actualitzades, 1 retirades/);await page.locator('#itineraryImportConfirmYes').tap();
 await page.waitForFunction(()=>document.getElementById('itineraryImportSaveStatus').textContent.includes('No s’ha confirmat'));assert.equal(await page.evaluate(()=>fixture.writes.length),1);
 assert.equal(await page.locator('[data-reconcile-action]').first().isDisabled(),true,'uncertain payload cannot be edited before retry');
 const firstRequests=await page.evaluate(()=>fixture.writes);
 await page.locator('#itineraryImportExit').tap();await page.reload();await page.locator('#loginCard').waitFor({state:'visible'});await page.evaluate(installFixture);await page.evaluate(()=>openItineraryImport());
 assert.equal(await page.locator('[data-reconcile-action]').first().isDisabled(),true,'confirmed payload recovers after closing/reopening');
 await page.evaluate(()=>fixture.mode='ok');await page.locator('#itineraryImportWrite').tap();await page.waitForFunction(()=>fixture.loads===1);
 const requests=firstRequests.concat(await page.evaluate(()=>fixture.writes));assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1],'same operation and payload after lost response');assert.equal(requests[0].p_expected_existing.length,13);assert.equal(requests[0].p_changes.length,24);
 const husky=requests[0].p_changes.find(row=>row.fields.title.includes('Huskies'));
 assert.equal(husky.fields.timing_kind,'approximate');assert.equal(husky.fields.starts_at,null);assert.equal(husky.fields.is_optional,true);assert.ok(husky.fields.approximate_start_time);
 assert.equal(await page.locator('#itineraryImportPanel').isVisible(),false);
 await page.evaluate(installFixture);await page.locator('#itineraryImportCompare').tap();await page.locator('[data-reconcile-summary]').waitFor();
 await page.evaluate(()=>{const r=itineraryImportState.reconciliation;r.decisions=itineraryImportState.review.items.map(i=>({source_order:i.source_order,action:'skip'}));r.decisions[0]={source_order:0,action:'update',target_id:rigId(20)};fixture.mode='stale';renderItineraryImportPreview()});
 await page.locator('#itineraryImportWrite').tap();await page.locator('#itineraryImportConfirmYes').tap();
 await page.waitForFunction(()=>document.getElementById('itineraryImportSaveStatus').textContent.includes('planning ha canviat'));
 assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),true);
assert.equal(await page.evaluate(()=>fixture.writes.length),1);
 assert.deepEqual(errors,[]);
 console.log(`PASS RIG-03B ${engine}: real touch 13→25 comparison, explicit choices/retirement, pending guard, cancel, offline, slow RPC, identical retry, return to itinerary, no direct writes.`);
}finally{await browser.close();server.close()}

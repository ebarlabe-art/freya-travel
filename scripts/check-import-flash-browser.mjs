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
 const installFixture=async mode=>{
  const id=n=>'14000000-0000-4000-8000-'+String(n).padStart(12,'0');
  session={user:{id:id(3)}};trip={id:id(1),name:'Riga sintètic RIG04',start_date:'2030-12-26',end_date:'2031-01-02',time_zone:'Europe/Riga'};
  const field=value=>({value,confidence:'high',evidence:[{kind:'text',excerpt:value,page:1}]});
  const existing=['new','local'].includes(mode)?[]:[{id:id(20),trip_id:id(1),title:'Catedral de Riga',city:'Riga',location_name:'Catedral de Riga',timing_kind:'exact',starts_at:'2030-12-27T08:00:00Z',ends_at:'2030-12-27T09:00:00Z',time_zone:'Europe/Riga',local_date:null,updated_at:'2026-10-29T12:00:00Z',status:'planned',photo_count:0,link_count:0,is_fixed:false}];
  const candidates=[['Riga Cathedral','2030-12-27','10:00','11:00'],['Museu','2030-12-27','10:30','12:00'],['Museu','2030-12-28','10:00','11:00']].map(([title,date,start,end],i)=>({source_order:i,classification_hint:'manual',warnings:[],fields:{title:field(title),city:field('Riga'),location_name:field(title),local_date:field(date),start_local_time:field(start),end_local_time:field(end),time_zone:field('Europe/Riga')}}));

  candidates.splice(0,candidates.length,...[['Riga Cathedral','09:30','10:30'],['House of the Blackheads','12:00','13:00'],['Passeig nou','15:00','16:00']].map(([title,start,end],i)=>({source_order:i,classification_hint:'manual',warnings:['Confiança limitada'],fields:{title:field(title),city:field('Riga'),location_name:field(title),local_date:field('2030-12-28'),start_local_time:field(start),end_local_time:field(end),time_zone:field('Europe/Riga')}})));
  if(mode!=='new'){
   existing.push({...existing[0],id:id(21),title:'Casa dels Caps Negres',location_name:'Casa dels Caps Negres',starts_at:'2030-12-27T09:15:00Z',ends_at:'2030-12-27T10:15:00Z',is_fixed:mode==='protected'});
  }
  const api=await loadTravelBookModule('import-itinerary-review.mjs'),saveApi=await loadTravelBookModule('import-itinerary-write.mjs');
  itineraryProjection=['new','local'].includes(mode)?[]:[{key:'activity:'+id(30),tripId:trip.id,sourceId:id(30),sourceType:'activity',title:'Reserva confirmada',localDate:'2030-12-28',startsAt:'2030-12-28T07:45:00Z',endsAt:'2030-12-28T08:15:00Z',timeZone:'Europe/Riga',timingKind:'exact',status:'confirmed',sourceUpdatedAt:'2026-10-29T12:00Z'}];
  for(const type of ['flight','accommodation','activity','manual'])itinerarySourceReady[type]=itinerarySourceMarker(type,trip.id,tripLoadGeneration,session.user.id);
  itineraryImportState={tripId:trip.id,userId:session.user.id,generation:tripLoadGeneration,api,saveApi,documentId:id(6),review:api.createItineraryReview({schema_version:1,source:{kind:'document',document_id:id(6),mime_type:'application/pdf'},candidates},{tripId:trip.id,userId:session.user.id,documentId:id(6)}),busy:false};
  window.fixture={mode,proposal:{schema_version:1,source:{kind:'document',document_id:id(6),mime_type:'application/pdf'},candidates},existing,before:JSON.stringify(existing),agenda:JSON.stringify(itineraryProjection),writes:0,requests:[],fail:true};
  db.rpc=async(name)=>{if(name==='read_itinerary_reconciliation')return {data:structuredClone(existing),error:null};fixture.writes++;throw Error('No writes allowed')};
  db.from=table=>{if(table!=='travel_documents')throw Error('Unexpected table');let photos=false;const q={select:()=>q,eq:(k,v)=>{if(k==='category'&&v==='Foto')photos=true;return q},neq:()=>q,order:async()=>({data:photos?[]:[{id:id(6),title:'PDF sintètic RIG04',file_name:'synthetic.pdf',mime_type:'application/pdf',category:'Altres'}],error:null}),insert:()=>{fixture.writes++;throw Error('No writes')},update:()=>{fixture.writes++;throw Error('No writes')}};return q};
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async(name,{body})=>{if(name==='import-itinerary'){fixture.transient=!!body.file;return {data:{proposal:{...fixture.proposal,source:{...fixture.proposal.source,document_id:body.document_id}}},error:null};}fixture.requests.push(body);await new Promise(r=>setTimeout(r,30));return fixture.fail?{data:null,error:{message:'network failure'}}:{data:{route:{method:'routing',mode:'walk',distance_m:1000,duration_seconds:600,source:'Synthetic route',calculated_at:new Date().toISOString()}},error:null}}}});
  APP_VIEWS.forEach(id=>document.getElementById(id)?.classList.toggle('hidden',id!=='itineraryView'));configureItineraryContent();
  for(const id of ['itineraryView','itineraryImportPanel','itineraryImportPreview']){let n=document.getElementById(id);while(n){n.classList.remove('hidden');n=n.parentElement}}document.getElementById('loginCard').classList.add('hidden');document.getElementById('itineraryImportSource').classList.add('hidden');renderItineraryImportPreview();
 };
 const capture=process.env.FLASH_SCREENSHOTS;if(capture)await mkdir(capture,{recursive:true});
 for(const mode of ['existing','new','protected']){
  await page.evaluate(installFixture,mode);
  await page.locator('#openItineraryImport').tap();await page.locator('#itineraryImportUpload').tap();await page.locator('#itineraryImportChooseExisting').tap();
  await page.locator('#itineraryImportExisting').selectOption('14000000-0000-4000-8000-000000000006');await page.locator('#itineraryImportConsent').check();await page.locator('#itineraryImportAnalyze').tap();
  await page.waitForFunction(()=>itineraryImportState?.flashApi&&!itineraryImportState.preparing);
  assert.equal(await page.evaluate(()=>fixture.writes),0);
  assert.equal(await page.locator('#itineraryImportAdvanced').evaluate(n=>n.open),false);
  if(mode!=='new'){
   assert.equal(await page.locator('[data-flash-order]').getAttribute('data-flash-order'),'0');
   assert.match(await page.locator('.flash-progress').innerText(),/1 de 2/i);
   assert.match(await page.locator('.flash-advice').innerText(),/Conservar evita/);
   assert.equal(await page.locator('.flash-options > section').count(),2);
   if(capture&&mode==='existing')await page.locator('#itineraryImportFlash').screenshot({path:capture+'/'+engine+'-flash.png'});
   await page.locator('[data-flash-action="keep"]').tap();assert.equal(await page.locator('[data-flash-order]').getAttribute('data-flash-order'),'1');
   if(mode==='protected')assert.equal(await page.locator('[data-flash-action="update"]').isDisabled(),true);
   else assert.match(await page.locator('.flash-advice').innerText(),/No tinc prou informació/);
   await page.locator('#itineraryImportFlash [data-flash-undo]').tap();assert.equal(await page.locator('[data-flash-order]').getAttribute('data-flash-order'),'0');
   await page.locator('[data-flash-action="keep"]').tap();
   await page.locator('[data-flash-action="later"]').tap();assert.equal(await page.locator('#itineraryImportFlash').isVisible(),false);
   assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),true);
   await page.locator('[data-flash-resume]').tap();assert.equal(await page.locator('[data-flash-order]').getAttribute('data-flash-order'),'1');
   await page.locator('[data-flash-action="keep"]').tap();
   if(mode==='existing'){
    await page.locator('#itineraryPlanningReport [data-flash-revisit]').tap();
    assert.equal(await page.locator('[data-flash-order]').getAttribute('data-flash-order'),'0','revisit restores the first match card');
    await page.locator('[data-flash-action="keep"]').tap();
    await page.locator('[data-flash-action="keep"]').tap();
    await page.locator('#itineraryPlanningReport [data-flash-undo]').tap();
    await page.locator('#itineraryImportFlash [data-flash-undo]').tap();
    await page.locator('[data-flash-action="update"]').tap();
    await page.locator('[data-flash-action="keep"]').tap();
    assert.match(await page.locator('[data-flash-conflicts]').innerText(),/Reserva confirmada/);
    if(capture)await page.locator('#itineraryPlanningReport').screenshot({path:capture+'/'+engine+'-conflicts.png'});
   }
  }else assert.equal(await page.locator('[data-flash-order]').count(),0,'empty trip skips flash');
  assert.equal(await page.locator('#itineraryPlanningReport .flash-overview > section').count(),2);
  assert.equal(await page.locator('[data-planning-routes]').isVisible(),false);
  assert.doesNotMatch(await page.locator('#itineraryPlanningReport').innerText(),/aspectes pendents|trams pendents|decisions per prendre/);
  if(capture&&mode==='new')await page.locator('#itineraryPlanningReport').screenshot({path:capture+'/'+engine+'-empty.png'});
  if(capture&&mode==='existing')await page.locator('#itineraryPlanningReport').screenshot({path:capture+'/'+engine+'-overview.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(mode==='existing'){
   await page.locator('#itineraryConflictFlash').waitFor({state:'visible'});
   assert.match(await page.locator('#itineraryConflictFlash').innerText(),/Reserva confirmada/);
   assert.equal(await page.locator('#itineraryPlanningReport .itinerary-conflict-badge').count(),2);
   await page.locator('#itineraryImportWrite').tap();
   assert.equal(await page.locator('#itineraryImportConfirm').isVisible(),false,'unreviewed conflict blocks confirmation');
   assert.equal(await page.evaluate(()=>fixture.writes),0);
   if(capture)await page.locator('#itineraryConflictFlash').screenshot({path:capture+'/'+engine+'-conflict-flash.png'});
   await page.locator('[data-conflict-ack]').tap();
   await page.waitForFunction(()=>itineraryImportState.reviewedConflicts?.length>0);
   assert.match(await page.locator('.itinerary-conflict-summary').innerText(),/Revisat, no resolt/);
   // Changed source evidence must invalidate acknowledgement, including at final confirmation.
   await page.evaluate(()=>{itineraryImportState.reconciliation.existing[0].updated_at='2030-12-02T00:00:00Z';renderItineraryImportPreview()});
   await page.locator('[data-conflict-ack]').waitFor({state:'visible'});
   await page.locator('[data-conflict-ack]').tap();
  }else assert.equal(await page.locator('#itineraryConflictFlash').isVisible(),false,'no alarm for uncertainty alone');
  await page.locator('#itineraryImportWrite').tap();await page.locator('#itineraryImportConfirm').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>fixture.writes),0);
  if(mode==='existing'){
   assert.match(await page.locator('#itineraryImportConfirmText').innerText(),/NO resolts/);
   await page.evaluate(()=>{itineraryImportState.reconciliation.existing[0].updated_at='2030-12-03T00:00:00Z'});
   await page.locator('#itineraryImportConfirmYes').tap();
   await page.waitForFunction(()=>!itineraryImportState.busy);
   assert.equal(await page.evaluate(()=>fixture.writes),0,'changed evidence at confirmation does not write');
   await page.locator('[data-conflict-ack]').tap();
   await page.locator('#itineraryImportWrite').tap();await page.locator('#itineraryImportConfirm').waitFor({state:'visible'});
  }
  await page.locator('#itineraryImportConfirmNo').tap();await page.waitForFunction(()=>!itineraryImportState.busy);
  assert.equal(await page.evaluate(()=>JSON.stringify(fixture.existing)===fixture.before&&JSON.stringify(itineraryProjection)===fixture.agenda),true);
  if(mode==='existing'){
   await page.locator('[data-conflict-open]').tap();
   await page.locator('#itineraryConflictFlash [data-planning-accept]').tap();
   assert.equal(await page.locator('#itineraryConflictFlash').isVisible(),false,'safe proposal resolves overlap in draft');
   assert.equal(await page.evaluate(()=>fixture.writes),0);
  }
  await page.locator('#itineraryImportExit').tap();
  await page.waitForFunction(()=>itineraryImportState===null);
  if(mode==='existing'){
   await page.locator('#openItineraryImport').tap();
   await page.waitForFunction(()=>itineraryImportState?.flashApi&&itineraryImportState?.reconciliation?.existing);
   assert.match(await page.locator('#itineraryImportStatus').innerText(),/Revisió recuperada/);
   assert.equal(await page.evaluate(()=>fixture.writes),0,'pause and resume never commit');
   await page.locator('#itineraryImportDiscardDraft').tap();
   await page.waitForFunction(()=>itineraryImportState?.review===null);
   await page.locator('#itineraryImportExit').tap();
   await page.waitForFunction(()=>itineraryImportState===null);
  }else await page.evaluate(async()=>{
   const api=await loadTravelBookModule('import-itinerary-draft.mjs');
   await api.discardImportDraft({userId:session.user.id,tripId:trip.id});
  });
 }
 await page.evaluate(()=>{
  renderAgendaRoutes=()=>{};proposeItineraryAutoPlaces=()=>{};proposeActivityPoints=async()=>{};generateItineraryDayContext=async()=>{};renderItineraryDayWeather=()=>{};
  itineraryProjection=[['Museu Nacional d’Art de Letònia','10:30','12:00'],['Reserva confirmada','11:30','12:30']].map(([title,start,end],i)=>({key:'manual:synthetic'+i,tripId:trip.id,sourceId:'synthetic'+i,sourceType:'manual',title,localDate:'2030-12-28',timeZone:'UTC',startsAt:'2030-12-28T'+start+':00Z',endsAt:'2030-12-28T'+end+':00Z',timingKind:'exact',status:'planned',timeLabel:start,details:[],documents:[],tags:[],eyebrow:'Planning sintètic',icon:'📝'}));
  genericItinerarySelectedDay='2030-12-28';genericItinerarySelectedTripId=trip.id;renderGenericItinerary();
 });
 await page.locator('#agendaConflictSummary [data-conflict-open]').waitFor({state:'visible'});
 assert.equal(await page.locator('#genericItineraryDays [data-conflict-badge]').count(),2);
 assert.match(await page.locator('#agendaConflictSummary').innerText(),/1 conflicte horari/);
 await page.locator('#agendaConflictSummary [data-conflict-open]').tap();
 await page.waitForFunction(()=>document.activeElement?.dataset.itineraryKey==='manual:synthetic0');
 if(capture){await page.locator('#agendaConflictSummary').screenshot({path:capture+'/'+engine+'-agenda-conflicts.png'});await page.locator('#genericItineraryDays').screenshot({path:capture+'/'+engine+'-agenda-cards.png'});}
 assert.equal(await page.evaluate(()=>fixture.writes),0);
 assert.deepEqual(errors,[]);console.log('PASS #196/#198 '+engine+': sequential flash, alternatives, whole-plan advice, unknown evidence, undo, postpone, protected visit, empty-trip fast path, cancellation, conflict gate/review/invalidation/solution, agenda badges, zero writes.');
}finally{await browser.close();server.close()}

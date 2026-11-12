// Packaged PWA, real import/review/writer and cultural handler; synthetic provider,
// auth and persistence only. Every non-local request and websocket is blocked.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {itineraryPdfTranscriptToProposal} from '../supabase/functions/import-itinerary/transcript.mjs';
import {normalizeGeoapify} from '../supabase/functions/place-resolution/providers/geoapify.mjs';
import {createCulturalGuideHandler} from '../supabase/functions/cultural-guide/handler.mjs';
import {culturalArticle,proposedSections} from './fixtures/cultural-guide.mjs';
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),engine=process.env.CULTURE_ENGINE||'chromium',dist=resolve('dist');
const id=n=>'22300000-0000-4000-8000-'+String(n).padStart(12,'0');
const titles=['Saint-Bertrand-de-Comminges','Bagnères-de-Luchon','Passeig pel bosc de Carlac'];
const places=titles.map((name,i)=>normalizeGeoapify({name:i===2?'Bòsc de Carlac':name,place_id:'synthetic-aran-'+i,country_code:i===2?'es':'fr',city:i===2?'Bausen':name,result_type:i===2?'natural.forest':'city',lat:[43.026,42.79,42.844][i],lon:[0.571,0.593,0.71][i],formatted:name+', '+(i===2?'Bausen, Espanya':'França'),datasource:{sourcename:'fixture',attribution:'Synthetic fixture'}}));
const ambiguous={...places[0],provider_place_id:'synthetic-distant-homonym',latitude:48,locality:'Other locality',formatted_address:'Synthetic distant homonym, France'};
const transcript={complete:true,warnings:[],pages:[{page:1,text:'07/11/2026 · Zona horària: Europe/Madrid\n09:00–10:00 '+titles[0]+'\n11:00–12:00 '+titles[1]+'\n15:00–16:00 '+titles[2]}]};
const proposal=itineraryPdfTranscriptToProposal(transcript,{kind:'document',document_id:id(3),mime_type:'application/pdf'});
const rows=[],writes=[],searches=[],calls=[],documents=[],uploads=[];
const handler=createCulturalGuideHandler({authenticate:async()=>id(2),readItem:async(_auth,trip,type,item)=>rows.find(r=>r.trip_id===trip&&r.id===item),search:async p=>[culturalArticle(p,places.findIndex(x=>x.provider_place_id===p.provider_place_id))],readArticle:async(_lang,pageid)=>culturalArticle(places[pageid-100],pageid-100),generate:async payload=>{calls.push(payload);return proposedSections({title:payload.source_title,extract:payload.source_text})}});
const server=createServer(async(req,res)=>{const path=resolve(dist,new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,'')||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true});let pageForDebug;
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage(),errors=[];pageForDebug=page;page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('fixtureRead',table=>table==='trip_itinerary_items'?rows:table==='travel_documents'?documents:table==='trip_stops'?[{trip_id:id(1),canonical_name:'Arties',country_code:'ES',time_zone:'Europe/Madrid',position:1}]:[]);
 await page.exposeFunction('fixtureDocument',data=>{const row={...data,id:id(3),created_at:'2026-11-01T00:00:00Z'};documents.push(row);return {data:row,error:null}});
 await page.exposeFunction('fixtureUpload',({path,size})=>{uploads.push({path,size});return {error:null}});
 await page.exposeFunction('fixtureUpdate',({patch,filters})=>{const row=rows.find(r=>filters.every(([k,v])=>(r[k]??null)===v));assert.ok(row,'optimistic update matches');assert.deepEqual(Object.keys(patch),['location_points']);writes.push({id:row.id,patch});Object.assign(row,patch,{updated_at:new Date(Date.now()+writes.length).toISOString()});return {data:{id:row.id},error:null}});
 await page.exposeFunction('fixtureRpc',(name,body)=>{if(name==='read_itinerary_reconciliation')return {data:structuredClone(rows),error:null};if(name==='commit_itinerary_reconciliation'){assert.equal(rows.length,0);for(const c of body.p_changes){assert.equal(c.action,'add');rows.push({...c.fields,id:c.id,trip_id:body.p_trip_id,created_by:id(2),status:'planned',is_fixed:false,location_points:null,resolved_location:null,created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'})}writes.push({import:body});return {data:{operation_id:body.p_operation_id,added:rows.length,updated:0,retired:0},error:null}}return {data:[],error:null}});
 await page.exposeFunction('fixtureInvoke',async(name,body)=>{
  if(name==='import-itinerary')return {data:{proposal:{...proposal,source:{...proposal.source,document_id:body.document_id}}},error:null};
  if(name==='place-resolution'){searches.push(body);const p=body.text==='Luchon'?places[1]:places.find(p=>body.text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').startsWith(p.canonical_name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')));return {data:{candidates:(!p||body.country_code&&body.country_code!==p.country_code?[]:p===places[0]?[p,ambiguous]:[p]).map(place=>({place}))},error:null}}
  if(name==='cultural-guide'){calls.push(body);const response=await handler(new Request('https://synthetic',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify(body)}));return {data:await response.json(),error:null}}
  return {data:{error:'no_match'},error:null};
 });
 await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 await page.evaluate(async({tripId,userId})=>{
  db.rpc=(name,body)=>window.fixtureRpc(name,body);
  db.from=table=>{let patch=null,insert=null,filters=[];const execute=async()=>insert?window.fixtureDocument(insert):patch?window.fixtureUpdate({patch,filters}):{data:(await window.fixtureRead(table)).filter(r=>filters.every(([k,v])=>r[k]===v)),error:null};const q=new Proxy({}, {get:(_,key)=>{if(key==='then')return (yes,no)=>execute().then(yes,no);if(key==='insert'&&table==='travel_documents')return value=>{insert=value;return q};if(key==='single')return execute;if(key==='update')return value=>{patch=value;return q};if(key==='eq'||key==='is')return (k,v)=>{filters.push([k,v]);return q};if(key==='maybeSingle')return async()=>{const r=await execute();return {...r,data:Array.isArray(r.data)?r.data[0]||null:r.data}};if(['insert','upsert','delete'].includes(key))throw Error('Unexpected mutation '+table);return ()=>q}});return q};
  Object.defineProperty(db,'storage',{configurable:true,value:{from:()=>({upload:(path,file)=>window.fixtureUpload({path,size:file.size})})}});
  db.channel=()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe:async()=>{}};return c};db.removeChannel=async()=>{};
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:(name,{body})=>window.fixtureInvoke(name,body)}});
  session={user:{id:userId}};trip={id:tripId,name:'Vall d’Aran · nou sintètic',start_date:'2026-11-07',end_date:'2026-11-07',time_zone:'Europe/Madrid'};
  tripStopRows=(await db.from('trip_stops').select('*').eq('trip_id',trip.id)).data;
  await ensureTripAgenda(true);setAppView('itineraryView');configureItineraryContent();
  let n=document.getElementById('itineraryView');while(n){n.classList.remove('hidden');n=n.parentElement}document.getElementById('loginCard').classList.add('hidden');
 },{tripId:id(1),userId:id(2)});
 await page.locator('#openItineraryImport').tap();await page.locator('#itineraryImportUploadFile').setInputFiles('scripts/fixtures/aran/synthetic-cultural-itinerary.pdf');await page.locator('#itineraryImportConsent').check();await page.locator('#itineraryImportAnalyze').tap();
 await page.waitForFunction(()=>itineraryImportState?.reconciliation&&!itineraryImportState.preparing&&!itineraryImportState.planningBusy&&!itineraryImportState.busy);
 assert.equal(writes.length,0);assert.equal(await page.evaluate(()=>itineraryImportState.review.items.length),3);
 await page.locator('#itineraryImportWrite').tap();await page.locator('#itineraryImportConfirmYes').tap();
 await page.waitForFunction(()=>manualItineraryRows.length===3);assert.equal(rows.length,3);assert.equal(uploads.length,1);assert.equal(documents.length,1);
 await page.evaluate(()=>{genericItinerarySelectedTripId=trip.id;genericItinerarySelectedDay='2026-11-07';renderGenericItinerary()});
 await page.waitForFunction(()=>manualItineraryRows.every(r=>r.location_points));
 const originals=structuredClone(rows);assert.ok(rows.every(r=>!r.location_points.points.some(p=>p.place)),'base Arties never auto-links French towns or approximate forest');assert.equal(calls.length,0);
 for(let i=0;i<3;i++){
  const row=rows.find(r=>r.title===titles[i]),card=page.locator(`[data-itinerary-key="manual:${row.id}"]`);
  await card.locator('[data-cultural-guide]').tap();await page.locator('[data-guide-verify]').tap();
  const editor=page.locator('[data-activity-point-editor]');if(i===1)await editor.getByLabel('Nom del punt 1',{exact:true}).fill('Luchon');await editor.getByRole('button',{name:'Cerca aquest punt',exact:true}).tap();
  await editor.locator('.point-place-option').first().waitFor();assert.equal(await editor.locator('.point-place-option').count(),i===0?2:1);
  assert.ok(!rows.find(r=>r.id===row.id).location_points.points[0].place,'search needs confirmation');assert.equal(calls.length,i*2);
  await editor.locator('.point-place-option').first().tap();await editor.getByRole('button',{name:'Desa els punts',exact:true}).tap();await editor.waitFor({state:'detached'});assert.equal(rows.find(r=>r.id===row.id).location_points.points[0].query,places[i].canonical_name,'explicit choice retains provider canonical identity for guide');
  await card.locator('[data-cultural-guide]').tap();await page.locator('[data-guide-text="history"]').waitFor();
  assert.ok((await page.locator('[data-guide-text="history"]').innerText()).includes(places[i].canonical_name));
  assert.equal(calls.filter(c=>c.action==='prepare').at(-1).source_id,row.id);assert.equal(calls.filter(c=>c.action==='prepare').at(-1).place_key,'geoapify:'+places[i].provider_place_id);
  await page.screenshot({path:`/tmp/freya-aran-${engine}-${i}.png`,fullPage:true});
  // Generated proposal remains local; closing preserves the draft without sharing.
  page.once('dialog',d=>d.accept());await page.locator('[data-guide-close]').tap();await page.locator('#culturalGuideDialog').waitFor({state:'hidden'});
 }
 assert.ok(searches.some(s=>s.text===titles[0]&&!s.country_code));
 for(const row of rows){const original=originals.find(r=>r.id===row.id);for(const k of Object.keys(original).filter(k=>!['location_points','updated_at'].includes(k)))assert.deepEqual(row[k],original[k],k)}
 assert.equal(writes.filter(w=>w.patch?.location_points?.points.some(p=>p.place)).length,3);assert.equal(calls.filter(c=>c.action==='prepare').length,3);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log(`PASS Aran cultural flow ${engine}: PDF upload/review/confirmed import → pending cross-border and ambiguous places → guide verification action → explicit geography save → automatic guide preparation for Saint-Bertrand, Bagnères-de-Luchon, Carlac; original fields preserved; 390px; no external traffic.`);
}catch(e){console.error(await pageForDebug?.evaluate(()=>({editor:!!document.querySelector('[data-activity-point-editor]'),view:visibleAppView(),message:document.getElementById('genericItineraryMessage')?.textContent,html:document.getElementById('genericItineraryContent')?.innerText.slice(0,1000),status:document.getElementById('itineraryImportStatus')?.textContent,save:document.getElementById('itineraryImportSaveStatus')?.textContent,state:itineraryImportState&&{busy:itineraryImportState.busy,preparing:itineraryImportState.preparing,reconciliation:!!itineraryImportState.reconciliation,items:itineraryImportState.review?.items}})));throw e}finally{await browser.close();await new Promise(r=>server.close(r))}

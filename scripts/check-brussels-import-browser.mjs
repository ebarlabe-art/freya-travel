// Real browser picker, preview, and confirmation with an anonymized two-day replay.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {itineraryPdfTranscriptToProposal,itineraryPdfEnrichTimeZones} from '../supabase/functions/import-itinerary/transcript.mjs';
import {brusselsTranscript,brusselsSource,brusselsTrip,verifiedBrusselsStops} from './fixtures/brussels/itinerary.mjs';

const raw=itineraryPdfTranscriptToProposal(brusselsTranscript,brusselsSource);
const proposal=await itineraryPdfEnrichTimeZones(raw,{
 transcript:brusselsTranscript,source:brusselsSource,tripStops:verifiedBrusselsStops,resolvePlace:async()=>null
});
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const engine=process.env.PLANNING_ENGINE||'chromium',dist=resolve('dist');
const server=createServer(async(req,res)=>{
 const path=resolve(dist,new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,'')||'index.html');
 if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}
 try{
  const body=await readFile(path);
  res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');
  res.end(body);
 }catch{res.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true,...(process.env.IMPORT_BROWSER_PATH?{executablePath:process.env.IMPORT_BROWSER_PATH}:{})});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:'ca-ES',serviceWorkers:'block'});
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
 await ctx.routeWebSocket('**/*',socket=>socket.close());
 const page=await ctx.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
 await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 await page.evaluate(({proposal,brusselsTrip})=>{
  session={user:{id:'17200000-0000-4000-8000-000000000003'}};
  trip=brusselsTrip;
  itineraryProjection=[];
  for(const type of ['flight','accommodation','activity','manual']){
   const marker=itinerarySourceMarker(type,trip.id,tripLoadGeneration,session.user.id);
   itinerarySourceReady[type]=marker;itinerarySourceAvailable[type]=marker;
  }
  window.fixture={reads:0,uploads:0,rows:[],commits:[]};
  db.rpc=async(name,request)=>{
   if(name==='read_itinerary_reconciliation')return {data:[],error:null};
   if(name!=='commit_itinerary_reconciliation')throw Error('Unexpected RPC '+name);
   fixture.commits.push(request);
   fixture.rows=request.p_changes.map(change=>change.fields);
   return {data:{operation_id:request.p_operation_id,added:fixture.rows.length,updated:0,retired:0},error:null};
  };
  db.storage.from=()=>({upload:async()=>{fixture.uploads++;return {data:{},error:null}}});
  db.from=()=>{const q={select:()=>q,eq:()=>q,neq:()=>q,order:async()=>({data:[],error:null}),
   insert:row=>({select:()=>({single:async()=>({data:{...row,id:'17200000-0000-4000-8000-000000000099'},error:null})})})};
   return q;
  };
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async(name,{body})=>{
   if(name!=='import-itinerary')return {data:null,error:{message:'Unavailable in replay'}};
   fixture.reads++;
   if(fixture.reads===1)return {data:{error:'provider_error'},error:null};
   const candidates=structuredClone(proposal.candidates);
   // An unreliable field is repaired in the visible row editor before saving.
   delete candidates[0].fields.time_zone;
   return {data:{proposal:{...proposal,candidates,source:{...proposal.source,document_id:body.document_id}}},error:null};
  }}});
  loadGenericItinerary=async()=>{};
  APP_VIEWS.forEach(id=>document.getElementById(id)?.classList.toggle('hidden',id!=='itineraryView'));
  configureItineraryContent();
  for(let node=document.getElementById('itineraryView');node;node=node.parentElement)node.classList.remove('hidden');
  document.getElementById('loginCard').classList.add('hidden');
 },{proposal,brusselsTrip});
 const picker=page.waitForEvent('filechooser');
 await page.locator('#openItineraryImport').tap();
 await (await picker).setFiles({name:brusselsSource.file_name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Synthetic upload for the anonymous transcription replay\n%%EOF\n')});
 await page.locator('#itineraryImportConsent').check();
 const analyze=page.locator('#itineraryImportAnalyze');
 await analyze.tap();
 await analyze.filter({hasText:'Torna-ho a provar'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>[fixture.reads,fixture.uploads,fixture.commits.length]),[1,0,0]);
 await analyze.tap();
 await page.waitForFunction(()=>itineraryImportState?.reconciliation?.plan&&!itineraryImportState.preparing&&!itineraryImportState.planningBusy);
 const preview=page.locator('#itineraryImportDayPreview');
 assert.equal(await preview.locator('section').count(),2);
 assert.equal(await preview.locator('[data-import-preview-day="2026-12-01"] li').count(),10);
 assert.equal(await preview.locator('[data-import-preview-day="2026-12-02"] li').count(),7);
 assert.match(await preview.innerText(),/10 Carrer de Mostra/);
 assert.match(await preview.innerText(),/https:\/\/example.org\/programa/);
 assert.equal(await page.locator('#itineraryImportActions button:visible').count(),3);
 assert.equal(await page.locator('#itineraryImportAdvanced').evaluate(node=>node.open),false);
 assert.equal(await page.locator('#itineraryPlanningReport').isVisible(),false,'ordinary preview lists each activity once');
 assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),true);
 const first=preview.locator('li').first();
 assert.match(await first.innerText(),/Confirma el fus horari/);
 await first.getByRole('button',{name:'Edita',exact:true}).tap();
 const zone=page.locator('[data-import-edit="0"][data-import-field="time_zone"]');
 await zone.fill('Europe/Brussels');await zone.blur();
 await page.waitForFunction(()=>itineraryImportState?.reconciliation?.plan?.summary.new===17);
 assert.equal(await page.locator('#itineraryImportWrite').isEnabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#itineraryImportWrite').tap();
 await page.locator('#itineraryImportConfirm').waitFor({state:'visible'});
 await page.locator('#itineraryImportConfirmNo').tap();
 assert.deepEqual(await page.evaluate(()=>[fixture.uploads,fixture.commits.length]),[0,0]);
 await page.locator('#itineraryImportWrite').tap();await page.locator('#itineraryImportConfirmYes').tap();
 await page.waitForFunction(()=>itineraryImportState===null);
 assert.deepEqual(await page.evaluate(()=>[fixture.uploads,fixture.commits.length,fixture.rows.length]),[1,1,17]);
 assert.equal(await page.evaluate(()=>new Set(fixture.commits[0].p_changes.map(change=>change.id)).size),17);
 assert.deepEqual(errors,[]);
 console.log(`PASS ${engine}: file picker, retry, 17 entries across two days, local repair, cancellation, and one confirmed write`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}

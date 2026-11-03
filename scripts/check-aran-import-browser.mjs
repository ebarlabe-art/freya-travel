// Original PDF bytes; replay a captured real OpenAI response, without live API calls.
// Network, trip and persistence are isolated. No production reads/writes.
import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {createServer} from 'node:http';import {resolve,extname,sep} from 'node:path';import {pathToFileURL} from 'node:url';
import {itineraryPdfTranscriptToProposal,itineraryPdfEnrichTimeZones} from '../supabase/functions/import-itinerary/transcript.mjs';
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),engine=process.env.PLANNING_ENGINE||'chromium',dist=resolve('dist');
const server=createServer(async(req,res)=>{const path=resolve(dist,new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,'')||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const transcript=JSON.parse(await readFile('scripts/fixtures/aran/openai-verified-transcript.json','utf8'));
const rawProposal=itineraryPdfTranscriptToProposal(transcript,{kind:'document',document_id:'21200000-0000-4000-8000-000000000006',mime_type:'application/pdf'});
const proposal=await itineraryPdfEnrichTimeZones(rawProposal,{transcript,source:rawProposal.source,resolvePlace:async city=>city==='ARTIES'?'Europe/Madrid':null});
const browser=await pw[engine].launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 await page.evaluate(async proposal=>{
  const id=n=>'21200000-0000-4000-8000-'+String(n).padStart(12,'0');
  session={user:{id:id(3)}};trip={id:id(1),name:'Aran · prova local',start_date:'2026-11-06',end_date:'2026-11-09',time_zone:'Europe/Madrid'};
  flightRows=[];itineraryProjection=[];window.fixture={proposal,writes:[],reads:0};
  for(const type of ['flight','accommodation','activity','manual']){const m=itinerarySourceMarker(type,trip.id,tripLoadGeneration,session.user.id);itinerarySourceReady[type]=m;itinerarySourceAvailable[type]=m}
  db.rpc=async(name,request)=>{if(name==='read_itinerary_reconciliation')return {data:[],error:null};fixture.writes.push({name,request});throw Error('Write forbidden in preview test')};
  db.from=()=>{const q={select:()=>q,eq:()=>q,neq:()=>q,order:async()=>({data:[],error:null})};return q};
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async(name,{body})=>{
   if(name!=='import-itinerary')return {data:null,error:{message:'Route unavailable in local test'}};
   fixture.reads++;fixture.file=body.file?.name;fixture.bytes=body.file?.base64?.length;fixture.fileHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(atob(body.file.base64),c=>c.charCodeAt(0))))).map(x=>x.toString(16).padStart(2,'0')).join('');
   return {data:{proposal:{...proposal,source:{...proposal.source,document_id:body.document_id}}},error:null};
  }}});
  loadGenericItinerary=async()=>{};APP_VIEWS.forEach(id=>document.getElementById(id)?.classList.toggle('hidden',id!=='itineraryView'));configureItineraryContent();
  let n=document.getElementById('itineraryView');while(n){n.classList.remove('hidden');n=n.parentElement}document.getElementById('loginCard').classList.add('hidden');
 },proposal);
 await page.locator('#openItineraryImport').tap();
 await page.locator('#itineraryImportUploadFile').setInputFiles('scripts/fixtures/aran/original.pdf');
 await page.locator('#itineraryImportConsent').check();await page.locator('#itineraryImportAnalyze').tap();
 await page.waitForFunction(()=>itineraryImportState?.review&&!itineraryImportState.preparing&&!itineraryImportState.planningBusy&&!itineraryImportState.busy);
 assert.equal(await page.evaluate(()=>fixture.reads),1);assert.equal(await page.evaluate(()=>fixture.file),'original.pdf');
 assert.equal(await page.evaluate(()=>fixture.fileHash),(await readFile('scripts/fixtures/aran/sha256.txt','utf8')).trim());
 const items=await page.evaluate(()=>itineraryImportState.review.items);
 assert.match(items[14].source_warnings.join(' '),/Evidència pendent/);assert.equal(items[14].included,false);
 assert.equal(items.length,16);assert.equal(items.filter(i=>i.included).length,12);
 assert.equal(items.filter(i=>i.original.local_date==='2026-11-09').length,2);
 assert.equal(await page.evaluate(()=>fixture.writes.length),0);
 assert.doesNotMatch(await page.locator('#itineraryPlanningReport').innerText(),/00:00/);
 // Alternatives are visible without navigating three nested details panels.
 assert.equal(await page.locator('#itineraryImportAlternatives').isVisible(),true);
 assert.equal(await page.locator('[data-import-alternative]').count(),4);
 assert.equal(await page.locator('[data-alternative-day="2026-11-09"] [data-import-alternative]').count(),2);
 const alternative=page.locator('[data-import-alternative="14"]');
 assert.equal(await alternative.isChecked(),false);
 await alternative.check();await page.waitForFunction(()=>itineraryImportState.review.items[14].included===true);
 assert.equal(await page.locator('#itineraryImportAlternatives').isVisible(),true);
 await alternative.uncheck();await page.waitForFunction(()=>itineraryImportState.review.items[14].included===false);
 assert.equal(await page.evaluate(()=>itineraryImportState.review.items.filter(i=>i.included).length),12);
 assert.equal(await page.evaluate(()=>fixture.writes.length),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#itineraryImportWrite').tap();await page.locator('#itineraryImportConfirm').waitFor({state:'visible'});
 await page.locator('#itineraryImportConfirmNo').tap();assert.equal(await page.evaluate(()=>fixture.writes.length),0);
 await mkdir('artifacts/aran',{recursive:true});await page.screenshot({path:`artifacts/aran/${engine}-review.png`,fullPage:true});
 assert.deepEqual(errors,[]);console.log(`PASS Aran ${engine}: original PDF selection, captured-real-provider 16 proposals/12 selected, four dates, visible grouped opt-in/cancel alternatives, no writes, 390x844.`);
}finally{await browser.close();await new Promise(r=>server.close(r))}

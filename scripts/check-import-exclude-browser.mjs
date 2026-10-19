// Real built app and real touch event; only fixture state, external transport blocked.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const engine=process.env.IMPORT_ENGINE||'webkit',dist=resolve('dist');
const server=createServer(async(req,res)=>{
 const name=new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,''),path=resolve(dist,name||'index.html');
 if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 let external=0;await ctx.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(url).origin)return route.continue();external++;return route.abort()});
 await ctx.routeWebSocket('**/*',s=>s.close());
 for(const mode of ['stable','refreshing','offline']){
 await ctx.setOffline(false);
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 await page.evaluate(async()=>{
  const field=value=>({value,confidence:'high',evidence:[{kind:'text',excerpt:value,page:1}]});
  const api=await loadTravelBookModule('import-itinerary-review.mjs');
  session={user:{id:'synthetic-user'}};trip={id:'synthetic-trip',experience_key:null};
  const source={kind:'document',document_id:'synthetic-doc',mime_type:'application/pdf'};
  const candidates=Array.from({length:21},(_,i)=>({source_order:i,classification_hint:'manual',warnings:[],fields:{title:field('Activitat de prova '+i),local_date:field('2026-10-24'),start_local_time:field(i===20?'00:15':'10:00'),time_zone:field('Europe/Rome')}}));
  itineraryProjection=candidates.map((c,i)=>({title:c.fields.title.value,localDate:i===20?'2026-10-23':'2026-10-24',timeLabel:c.fields.start_local_time.value}));
  for(const type of ['flight','accommodation','activity','manual'])itinerarySourceReady[type]=itinerarySourceMarker(type,trip.id,tripLoadGeneration,session.user.id);
  itineraryImportState={tripId:trip.id,userId:session.user.id,generation:tripLoadGeneration,api,review:api.createItineraryReview({schema_version:1,source,candidates},{tripId:trip.id,userId:session.user.id,documentId:source.document_id}),busy:false,saveCompleted:false};
  for(const id of ['itineraryView','itineraryImportPanel','itineraryImportPreview']){let n=document.getElementById(id);while(n){n.classList.remove('hidden');n=n.parentElement}}
  document.getElementById('loginCard').classList.add('hidden');document.getElementById('itineraryImportSource').classList.add('hidden');
  window.beforeExisting=JSON.stringify(itineraryProjection);
  renderItineraryImportPreview();
 });
 assert.match(await page.locator('#itineraryImportSummary').innerText(),/^21 de 21/);
 assert.equal(await page.locator('.itinerary-import-warning').filter({hasText:'Possible duplicat amb un dia diferent'}).count(),1);
 assert.equal(await page.evaluate(()=>itineraryImportState.api.summarizeItineraryReview(itineraryImportState.review,itineraryProjection).items.filter(x=>x.review_flags.includes('possible_existing_duplicate')).length),20);
 if(mode==='refreshing')await page.evaluate(()=>{itinerarySourceReady.manual=null});
 if(mode==='offline')await ctx.setOffline(true);
 const beforeRequests=external;
 const start=Date.now();await page.locator('#itineraryImportExcludeExisting').tap();
 assert.ok(Date.now()-start<1500,'Touch handler must complete without freezing');
 await page.waitForFunction(()=>document.getElementById('itineraryImportSummary').textContent.startsWith('0 de 21'),null,{timeout:2000});
 assert.equal(await page.locator('[data-import-include]:checked').count(),0);
 assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),true);
 assert.equal(await page.evaluate(()=>JSON.stringify(itineraryProjection)===window.beforeExisting),true);
 assert.equal(external,beforeRequests,'Selection must not issue any external request');
 assert.equal(await page.locator('#itineraryImportExcludeExisting').isDisabled(),true);
 assert.equal(await page.locator('[data-import-candidate]').count(),21,'Excluded activities remain available for review');
 await page.locator('[data-import-include="0"]').check();
 assert.match(await page.locator('#itineraryImportSummary').innerText(),/^1 de 21/);
 if(mode==='offline')assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS '+mode+' real mobile tap: 21 -> 0, original agenda unchanged.');
 await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r))}

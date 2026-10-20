// Real built app and real touch event; only fixture state, external transport blocked.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
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
const browser=await pw[engine].launch({headless:true,...(process.env.IMPORT_BROWSER_PATH?{executablePath:process.env.IMPORT_BROWSER_PATH}:{})});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 let external=0;await ctx.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(url).origin)return route.continue();external++;return route.abort()});
 await ctx.routeWebSocket('**/*',s=>s.close());
 for(const mode of ['stable','refreshing','offline','mixed','new']){
 await ctx.setOffline(false);
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 await page.evaluate(async(mode)=>{
  const field=value=>({value,confidence:'high',evidence:[{kind:'text',excerpt:value,page:1}]});
  const api=await loadTravelBookModule('import-itinerary-review.mjs');
  session={user:{id:'synthetic-user'}};trip={id:'synthetic-trip',experience_key:null};
  const source={kind:'document',document_id:'synthetic-doc',mime_type:'application/pdf'};
  const candidates=Array.from({length:21},(_,i)=>({source_order:i,classification_hint:'manual',warnings:['Any agafat del títol general: 2026'],fields:{title:field('Activitat de prova '+i),local_date:field('2026-10-24'),start_local_time:field(i===20?'00:15':'10:00'),time_zone:field('Europe/Rome')}}));
  if(mode==='mixed')candidates.push({...candidates[0],source_order:21,fields:{...candidates[0].fields,title:field('Passeig nou sintètic')}});
  itineraryProjection=candidates.slice(0,mode==='new'?0:21).map((c,i)=>({title:c.fields.title.value,localDate:i===20?'2026-10-23':'2026-10-24',timeLabel:c.fields.start_local_time.value}));
  for(const type of ['flight','accommodation','activity','manual'])itinerarySourceReady[type]=itinerarySourceMarker(type,trip.id,tripLoadGeneration,session.user.id);
  itineraryImportState={tripId:trip.id,userId:session.user.id,generation:tripLoadGeneration,api,review:api.createItineraryReview({schema_version:1,source,candidates},{tripId:trip.id,userId:session.user.id,documentId:source.document_id}),busy:false,saveCompleted:false};
  for(const id of ['itineraryView','itineraryImportPanel','itineraryImportPreview']){let n=document.getElementById(id);while(n){n.classList.remove('hidden');n=n.parentElement}}
  document.getElementById('loginCard').classList.add('hidden');document.getElementById('itineraryImportSource').classList.add('hidden');
  window.beforeExisting=JSON.stringify(itineraryProjection);
  renderItineraryImportPreview();
 },mode);
 if(mode==='new'){
  assert.equal(await page.locator('#itineraryImportExcludeExisting').isDisabled(),true);
  assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),false);
  assert.equal(await page.locator('[data-import-include]:checked').count(),21);
  assert.equal(await page.locator('#itineraryImportExcluded').count(),0);
  assert.deepEqual(errors,[]);await page.close();console.log('PASS new-only unchanged');continue;
 }
 const total=mode==='mixed'?22:21,remaining=mode==='mixed'?1:0;
 assert.match(await page.locator('#itineraryImportSummary').innerText(),new RegExp('^'+total+' de '+total));
 assert.equal(await page.locator('.itinerary-import-warning').filter({hasText:'Possible duplicat amb un dia diferent'}).count(),1);
 assert.equal(await page.evaluate(()=>itineraryImportState.api.summarizeItineraryReview(itineraryImportState.review,itineraryProjection).items.filter(x=>x.review_flags.includes('possible_existing_duplicate')).length),20);
 if(mode==='refreshing')await page.evaluate(()=>{itinerarySourceReady.manual=null});
 if(mode==='offline')await ctx.setOffline(true);
 const beforeRequests=external;
 const start=Date.now();await page.locator('#itineraryImportExcludeExisting').tap();
 assert.ok(Date.now()-start<1500,'Touch handler must complete without freezing');
 await page.waitForFunction(({remaining,total})=>document.getElementById('itineraryImportSummary').textContent.startsWith(remaining+' de '+total),{remaining,total},{timeout:2000});
 assert.equal(await page.locator('[data-import-include]:checked').count(),remaining);
 assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),remaining===0);
 assert.equal(await page.evaluate(()=>JSON.stringify(itineraryProjection)===window.beforeExisting),true);
 assert.equal(external,beforeRequests,'Selection must not issue any external request');
 assert.equal(await page.locator('#itineraryImportExcludeExisting').isDisabled(),true);
 assert.equal(await page.locator('[data-import-candidate]').count(),total,'Excluded activities remain available for review');
 assert.match(await page.locator('#itineraryImportReviewResult').innerText(),/Revisió completada.*20 coincidències · 1 conflicte de data/s);
 assert.equal(await page.locator('#itineraryImportExcluded').getAttribute('open'),null);
 assert.equal(await page.locator('#itineraryImportExcluded .itinerary-import-warning:visible').count(),0);
 assert.equal(await page.locator('#itineraryImportExcluded [data-import-candidate][open]').count(),0);
 assert.match(await page.locator('#itineraryImportExcluded>summary').innerText(),/21.*1 conflicte de data/s);
 assert.equal(await page.locator('#itineraryImportRemaining').innerText(),remaining?'1 activitat seleccionada per afegir':'No hi ha activitats noves per importar');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow on iPhone');
 if(mode==='stable')await page.locator('#itineraryImportPanel').screenshot({path:resolve(tmpdir(),'freya-import-summary-mobile-'+engine+'.png')});
 await page.locator('#itineraryImportExcluded>summary').tap();
 await page.locator('[data-import-candidate="20"]>summary').tap();
 assert.equal(await page.locator('[data-import-candidate="20"] .itinerary-import-warning').filter({hasText:'Possible duplicat amb un dia diferent'}).isVisible(),true);
 await page.locator('[data-import-candidate="0"]>summary').tap();
 await page.locator('[data-import-include="0"]').tap();
 assert.match(await page.locator('#itineraryImportSummary').innerText(),new RegExp('^'+(remaining+1)+' de '+total));
 if(mode==='offline')assert.equal(await page.locator('#itineraryImportWrite').isDisabled(),true);
 assert.equal(await page.locator('#itineraryImportExcluded [data-import-candidate]').count(),20);
 assert.equal(await page.locator('#itineraryImportCandidates>[data-import-candidate="0"] [data-import-include]').isChecked(),true);
 assert.equal(await page.evaluate(()=>JSON.stringify(itineraryProjection)===window.beforeExisting),true);
 assert.equal(external,beforeRequests);
 await page.locator('#itineraryImportExit').tap();
 assert.equal(await page.locator('#itineraryImportPanel').isVisible(),false);
 assert.equal(await page.evaluate(()=>itineraryImportState===null),true);
 assert.deepEqual(errors,[]);
 console.log('PASS '+mode+' real mobile tap: '+total+' -> '+remaining+' -> '+(remaining+1)+', conflict accessible, exit works, original agenda unchanged.');
 await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r))}

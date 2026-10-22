// Real packaged application. Synthetic trips, source articles, model and voices; external traffic blocked.
import {pointSnapshot} from '../domain/itinerary-place-points.mjs';
import {installCulturalGuideFixture} from './fixtures/install-cultural-guide-fixture.mjs';
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {resolve,extname,sep} from 'node:path';import {pathToFileURL} from 'node:url';
import {bolognaPlaces,cultureId,cultureRow,culturalArticle,proposedSections} from './fixtures/cultural-guide.mjs';import {guideProposal,guidePlaceKey} from '../domain/cultural-guide.mjs';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright'),engine=process.env.CULTURE_ENGINE||'chromium',dist=resolve('dist');
const trips=[{id:cultureId(1),name:'Bolonya sintètica',time_zone:'Europe/Rome'},{id:cultureId(2),name:'Eivissa sintètica',time_zone:'Europe/Madrid'},{id:cultureId(3),name:'Londres sintètic',time_zone:'Europe/London',experience_key:'london-2026'}].map(t=>({...t,owner_id:cultureId(9),start_date:'2026-12-27',end_date:'2026-12-28',is_owner:true}));
const eivissa={...bolognaPlaces[0],canonical_name:'Dalt Vila',provider_place_id:'synthetic-eivissa',country_code:'ES',locality:'Eivissa',latitude:38.906,longitude:1.436};
const manuals=[...bolognaPlaces.map((p,i)=>cultureRow(p,i)),cultureRow(eivissa,10,cultureId(2))],documents=[...bolognaPlaces,eivissa].map((p,i)=>guideProposal(p,culturalArticle(p,i),proposedSections(culturalArticle(p,i))));
const compound=cultureRow(bolognaPlaces[0],30);compound.title='Piazza Maggiore, Fontana del Nettuno i basílica de San Petronio';compound.location_points=pointSnapshot(compound,bolognaPlaces.slice(0,3).map((p,i)=>({id:'point-'+i,query:p.canonical_name,place:p})));manuals.push(compound);
const server=createServer(async(req,res)=>{const path=resolve(dist,decodeURIComponent(new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,''))||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
 const ctx=await browser.newContext({viewport:process.env.CULTURE_TABLET?{width:1024,height:768}:{width:390,height:844},isMobile:!process.env.CULTURE_TABLET,hasTouch:true,serviceWorkers:'allow'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await ctx.routeWebSocket('**/*',s=>s.close());
 await ctx.addInitScript(()=>{
  window.__tts={voices:[{lang:'ca-ES',name:'Synthetic Catalan'}],spoken:[],actions:[],paused:false};window.confirm=()=>true;
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>__tts.voices,get paused(){return __tts.paused},get speaking(){return __tts.spoken.length>0},cancel(){__tts.actions.push('stop')},pause(){__tts.actions.push('pause');__tts.paused=true},resume(){__tts.actions.push('resume');__tts.paused=false},speak(u){__tts.spoken.push({text:u.text,rate:u.rate,voice:u.voice});u.onstart?.()}}});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text}};
 });
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto(url);await page.waitForFunction(()=>typeof renderSession==='function');await page.locator('#loginCard').waitFor({state:'visible'});
 await page.evaluate(installCulturalGuideFixture,{trips,manuals,documents});
 await page.locator('#genericActivitiesModuleCard').click();await page.waitForFunction(()=>document.querySelectorAll('#activityList [data-cultural-guide]').length===6);
 const dialog=page.locator('#culturalGuideDialog'),root=page.locator('#culturalGuideRoot');
 async function choosePlace(){if(await root.locator('[data-guide-place]').count())await root.locator('[data-guide-place]').first().click()}
 async function openGuide(i=0){await page.locator(`#activityList [data-cultural-guide="manual:${cultureId(20+i)}"]`).click();await dialog.waitFor({state:'visible'});await choosePlace();await page.waitForFunction(()=>document.querySelector('[data-guide-status]')?.textContent==='Cap fitxa desada per a aquest lloc.'||document.querySelector('[data-guide-status]')?.textContent?.startsWith('Proposta no desada.')||document.querySelector('[data-guide-status]')?.textContent?.startsWith('Confirma quina font')||document.querySelector('[data-guide-status]')?.textContent?.startsWith('Fitxa desada.')||document.querySelector('[data-guide-status]')?.textContent?.includes('Consulta offline'))}
 async function closeGuide(){await root.locator('[data-guide-close]').click();await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>!history.state?.culturalGuide)}
 // Reproduce iPhone compound visit with the real Supabase Functions client and HTTP errors.
 let httpMode='server';
 await ctx.route('**/functions/v1/cultural-guide',async route=>{
  const body=route.request().postDataJSON();assert.equal(body.action,'prepare');
  if(httpMode==='network')return route.abort('failed');
  await new Promise(r=>setTimeout(r,150));
  return route.fulfill({status:httpMode==='server'?503:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(httpMode==='server'?{error:'invalid_response',stage:'generate',request_id:cultureId(99)}:{document:documents.find(d=>d.place_key===body.place_key)})});
 });
 await page.evaluate(()=>fixture.http=true);
 await page.locator(`#activityList [data-cultural-guide="manual:${cultureId(50)}"]`).click();await dialog.waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>fixture.writes.length),0);assert.equal(await root.locator('.cultural-guide-section').count(),0);
 await root.locator('[data-guide-place="2"]').click();await root.locator('[aria-busy="true"]').waitFor();
 await root.locator('[data-guide-status][role="alert"]').waitFor();assert.match(await root.locator('[data-guide-status]').innerText(),/incompleta.*Referència:/);
 assert.equal(await root.locator('.cultural-guide-section').count(),0);await root.locator('[data-guide-status]').isVisible();
 const visibleStatus=()=>root.locator('[data-guide-status]').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight});assert.equal(await visibleStatus(),true);
 httpMode='network';await root.locator('[data-guide-retry]').click();await root.locator('[data-guide-status][role="alert"]').waitFor();assert.match(await root.locator('[data-guide-status]').innerText(),/connectar/);
 httpMode='success';await root.locator('[data-guide-retry]').click();await root.locator('[data-guide-text="history"]').waitFor();assert.equal(await root.locator('[data-guide-text="history"]').innerText(),documents[2].sections.history.text);
 assert.equal(await root.evaluate(el=>!!(el.querySelector('.cultural-guide-sources').compareDocumentPosition(el.querySelector('[data-guide-listen]'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
 await root.locator('[data-guide-save]').click();assert.equal(await page.evaluate(()=>fixture.writes.length),0);assert.match(await root.locator('[data-guide-status]').innerText(),/confirma la revisió/);assert.equal(await visibleStatus(),true);
 await root.locator('[data-guide-body]').evaluate(el=>el.scrollTop=el.scrollHeight);assert.equal(await visibleStatus(),true);
 await closeGuide();await page.evaluate(()=>{fixture.http=false;mergeOfflineTripSnapshot({culturalGuideDrafts:[]})});
 for(let i=0;i<5;i++){
  await openGuide(i);assert.equal(await root.locator('h2').innerText(),bolognaPlaces[i].canonical_name);
  await root.locator('[data-guide-save]').waitFor({state:'visible'});assert.equal(await root.locator('[data-guide-text="history"]').innerText(),documents[i].sections.history.text);
  await root.locator('[data-guide-reviewed]').check();await root.locator('[data-guide-save]').click();await page.waitForFunction(n=>fixture.guides.length===n,i+1);await page.waitForFunction(()=>document.querySelector('[data-guide-status]').textContent.includes('Fitxa desada al viatge'));
  await closeGuide();
 }
 assert.equal(await page.evaluate(()=>fixture.writes.length),5);assert.ok((await page.evaluate(()=>fixture.writes)).every(w=>w.table==='trip_cultural_guides'));
 // Existing saved place is reused from any visit and can be edited without duplicating records.
 const beforeSavedOpen=await page.evaluate(()=>fixture.calls.length);await openGuide();assert.equal(await page.evaluate(()=>fixture.calls.length),beforeSavedOpen);await root.locator('[data-guide-edit]').click();await root.locator('[data-guide-section="history"]').fill('Correcció manual sintètica');await root.locator('[data-guide-reviewed]').check();await root.locator('[data-guide-save]').click();await page.waitForFunction(()=>fixture.guides[0].revision===2);assert.equal(await page.evaluate(()=>fixture.guides.length),5);await closeGuide();
 // Compare-and-swap conflict keeps the typed draft and requires explicit reload.
 await openGuide();await root.locator('[data-guide-edit]').click();await root.locator('[data-guide-section="history"]').fill('Esborrany en conflicte');await root.locator('[data-guide-reviewed]').check();await page.evaluate(()=>fixture.guides[0].revision++);await root.locator('[data-guide-save]').click();await page.waitForFunction(()=>document.querySelector('[data-guide-status]').textContent.includes('altra persona'));
 assert.equal(await root.locator('[data-guide-section="history"]').inputValue(),'Esborrany en conflicte');await root.locator('[data-guide-reload]').click();await page.waitForFunction(()=>document.querySelector('[data-guide-status]').textContent.startsWith('Fitxa desada.'));
 // No native Catalan voice: retain text, require consent for an alternative.
 await page.evaluate(()=>{__tts.voices=[{lang:'es-ES'}];__tts.spoken=[]});await root.locator('[data-guide-listen]').click();assert.match(await root.locator('[data-guide-status]').innerText(),/No hi ha veu catalana/);assert.equal(await page.evaluate(()=>__tts.spoken.length),0);
 await root.locator('[data-guide-fallback]').check();await root.locator('[data-guide-listen]').click();assert.equal(await page.evaluate(()=>__tts.spoken.length),1);await root.locator('[data-guide-pause]').click();await root.locator('[data-guide-resume]').click();await root.locator('[data-guide-rate]').selectOption('1.15');assert.equal(await page.evaluate(()=>__tts.spoken.at(-1).rate),1.15);await root.locator('[data-guide-stop]').click();await closeGuide();
 // Back closes the dialog; forward restores the same visit, not another source.
 await openGuide(4);await page.goBack();await dialog.waitFor({state:'hidden'});await page.goForward();await dialog.waitFor({state:'visible'});await choosePlace();await page.waitForFunction(()=>document.querySelector('#culturalGuideHeading').textContent==='Teatro Anatomico');await closeGuide();
 // Eivissa uses identical universal code; wrong identity proposals cannot be saved.
 await page.evaluate(async id=>{await selectTrip(id,{open:true});setAppView('activitiesView')},cultureId(2));await openGuide(10);
 await page.evaluate(()=>fixture.mismatch=true);await root.locator('[data-guide-propose]').click();await page.waitForFunction(()=>document.querySelector('[data-guide-status]').textContent.includes('no correspon exactament'));assert.equal(await root.locator('[data-guide-section]').count(),0);await closeGuide();
 // A late source response cannot reopen the dialog after switching trips.
 await page.evaluate(()=>fixture.mismatch=false);await openGuide(10);
 const priorCalls=await page.evaluate(()=>fixture.calls.length);await page.evaluate(()=>{fixture.mismatch=false;fixture.delay=new Promise(r=>fixture.release=r)});await root.locator('[data-guide-search]').click();await page.waitForFunction(n=>fixture.calls.length===n+1,priorCalls);
 await page.evaluate(async id=>{await selectTrip(id,{open:true});setAppView('discoverView');fixture.release();fixture.delay=null},cultureId(3));await dialog.waitFor({state:'hidden'});
 // London preserves all 13 cards while using the same device narration and controls.
 await page.evaluate(async id=>{fixture.mismatch=false;await selectTrip(id,{open:true});setAppView('discoverView')},cultureId(3));assert.equal(await page.locator('#guideGrid .place-guide').count(),13);await page.locator('[data-listen-guide]').first().click();await page.locator('#audioPause').click();await page.locator('#audioPause').click();await page.locator('#audioStop').click();
 // Reopen saved cards from Itinerary; no new guide writes when opening or listening.
 await page.evaluate(async id=>{await selectTrip(id,{open:true});setAppView('itineraryView')},cultureId(1));await page.waitForFunction(()=>document.querySelectorAll('#genericItineraryDays [data-cultural-guide]').length===6);await page.locator(`#genericItineraryDays [data-cultural-guide="manual:${cultureId(20)}"]`).click();await dialog.waitFor({state:'visible'});await choosePlace();await page.waitForFunction(()=>document.querySelector('[data-guide-status]').textContent.startsWith('Fitxa desada.'));assert.match(await root.innerText(),/Correcció manual sintètica/);await closeGuide();
 if(process.env.CULTURE_SCREENSHOT){await page.locator(`#genericItineraryDays [data-cultural-guide="manual:${cultureId(20)}"]`).click();await dialog.waitFor({state:'visible'});await page.screenshot({path:process.env.CULTURE_SCREENSHOT});await closeGuide()}
 const count=await page.evaluate(()=>fixture.writes.length);await page.waitForFunction(()=>navigator.serviceWorker.controller);await ctx.setOffline(true);
 await page.evaluate(()=>setAppView('activitiesView'));await openGuide();assert.match(await root.innerText(),/Correcció manual sintètica/);assert.match(await root.locator('[data-guide-status]').innerText(),/offline/);assert.equal(await root.locator('[data-guide-edit]').isDisabled(),true);await closeGuide();assert.equal(await page.evaluate(()=>fixture.writes.length),count);
 // Real reload with only authorized offline snapshots; all service traffic stays blocked.
 if(engine!=='webkit'){
  await page.reload();await page.locator('#tripsHomeView').waitFor({state:'visible'});await page.locator('[data-home-view="upcomingTripsView"]').click();await page.locator(`[data-select-trip="${cultureId(1)}"]`).click();await page.locator('#genericActivitiesModuleCard').click();await openGuide();assert.match(await root.innerText(),/Correcció manual sintètica/);await closeGuide();
 }
 await ctx.setOffline(false);assert.deepEqual(errors,[]);console.log(`PASS cultural guide ${engine}: five exact Bologna places, independent sources, explicit save/CAS, TTS controls/fallback, Activities/Itinerary/Back/Forward, Eivissa, 13 London guides, offline and reload.`);
}finally{await browser.close();server.close()}

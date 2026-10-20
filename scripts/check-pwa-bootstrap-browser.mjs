// Real built shell and SDK. Only HTTP fixtures, never production accounts/data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const engine=process.env.PWA_ENGINE||'chromium';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const dist=resolve('dist'),legacy=await readFile(new URL('./fixtures/pwa-sw-v20.js',import.meta.url),'utf8');
let fault='',oldWorker=null;
const server=createServer(async(req,res)=>{
 if(fault==='offline'){req.socket.destroy();return}
 const name=new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,''),path=resolve(dist,name||'index.html');
 if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}
 if(fault==='shell503'&&(name==='vendor/supabase.js'||!name||name==='index.html')){res.writeHead(503).end();return}
 if(fault==='sdk'&&name==='vendor/supabase.js'){res.writeHead(503).end();return}
 if(fault==='worker'&&name==='sw.js'){res.writeHead(503).end();return}
 try{
  let body=await readFile(path);
  if(name==='sw.js'&&oldWorker)body=legacy.replaceAll('6444-v20','6444-v'+oldWorker);
  if(fault==='syntax'&&(!name||name==='index.html'))body=body.toString().replace("const FREYA_FRONTEND_RELEASE=","const deliberatelyBroken = ; const FREYA_FRONTEND_RELEASE=");
  if(['sdk','init','session'].includes(fault)&&(!name||name==='index.html')){
   const marker="window.freyaBoot.step(window.supabase?.createClient?'app':'sdk');";
   const inject=fault==='sdk'?"window.supabase=undefined;window.freyaBoot.fail('sdk');":
    fault==='init'?"window.supabase.createClient=function(){throw Error('synthetic init')};":
    "const originalCreate=window.supabase.createClient;window.supabase.createClient=function(...args){const client=originalCreate(...args);client.auth.getSession=()=>new Promise(()=>{});client.auth.onAuthStateChange=()=>({data:{subscription:{unsubscribe(){}}}});return client};";
   const text=body.toString();if(!text.includes(marker))throw Error('Missing inline SDK marker');
   body=text.replace(marker,inject+'\n'+marker);
  }
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(body);
 }catch{res.writeHead(404).end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const uid='13200000-0000-4000-8000-000000000001',tid='13200000-0000-4000-8000-000000000002';
const trip={id:tid,name:'Synthetic Baltic trip',owner_id:uid,is_owner:true,start_date:'2026-12-26',end_date:'2027-01-02',time_zone:'Europe/Riga'};
const rows=Array.from({length:13},(_,i)=>({id:`13200000-0000-4000-8000-${String(i+10).padStart(12,'0')}`,trip_id:tid,title:'Synthetic plan '+i,timing_kind:'exact',starts_at:`2026-12-${i<7?'27':'28'}T07:00:00Z`,time_zone:'Europe/Riga',location_name:null,status:'planned',sort_order:i}));
let writes=0;
async function context({sw=false,persisted=false,tablet=false}={}){
 const ctx=await browser.newContext({viewport:tablet?{width:1024,height:768}:{width:390,height:844},hasTouch:true,isMobile:!tablet,serviceWorkers:sw?'allow':'block'});
 await ctx.addInitScript(({persisted,uid})=>{
  sessionStorage.boots=String(Number(sessionStorage.boots||0)+1);
  Object.defineProperty(navigator,'standalone',{get:()=>true});
  localStorage.setItem('freya-unsynced-test-draft','preserve');
  if(persisted&&!sessionStorage.seeded){
   const token='eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({sub:uid,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'}))+'.synthetic';
   localStorage.setItem('sb-otueskpksylzvkhldoft-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:uid,email:'synthetic@example.invalid'}}));sessionStorage.seeded='1';
  }
 },{persisted,uid});
 await ctx.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url());if(u.origin===new URL(url).origin)return route.continue();
  if(u.hostname==='otueskpksylzvkhldoft.supabase.co'){
   const headers={'access-control-allow-origin':new URL(url).origin,'access-control-allow-credentials':'true','access-control-allow-headers':request.headers()['access-control-request-headers']||'authorization,apikey,x-client-info,content-type','access-control-allow-methods':'GET,POST,HEAD,OPTIONS'};
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(!['GET','HEAD'].includes(request.method())&&!u.pathname.includes('/rpc/')&&!u.pathname.includes('/functions/')){writes++;throw Error('Unexpected data mutation')}
   const data=u.pathname.endsWith('/rpc/get_my_trips')?[trip]:u.pathname.endsWith('/trip_itinerary_items')?rows:u.pathname.endsWith('/user')?{id:uid}:[];
   return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(data)});
  }return route.abort();
 });
 await ctx.routeWebSocket('**/*',s=>s.close());return ctx;
}
try{
 for(const kind of ['sdk','init','syntax','session']){
  fault=kind;const ctx=await context(),page=await ctx.newPage();page.setDefaultTimeout(20000);
  await page.goto(url);await page.locator('#retryFreyaBoot').waitFor();
  assert.match(await page.locator('#loading').innerText(),new RegExp(kind==='sdk'?'component d’accés':kind==='session'?'sessió':'iniciar aquesta versió'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('freya-unsynced-test-draft')),'preserve');
  fault='';await page.locator('#retryFreyaBoot').click();await page.locator('#loginCard').waitFor({state:'visible'});
  assert.equal(await page.locator('#loading').isVisible(),false);await ctx.close();console.log('PASS '+engine+' inline SDK failure/retry '+kind);
 }
 // Browser-level regression for the actual iPhone screenshot (also runs on WebKit).
 {
  fault='';const ctx=await context(),page=await ctx.newPage();page.setDefaultTimeout(20000);
  await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
  await page.evaluate(async()=>{
   const {mountQuickItineraryPlace}=await import('/freya-travel/domain/itinerary-quick-place.mjs');
   const host=document.createElement('div');host.id='quickPlacePhoneFixture';
   host.style.cssText='width:260px;max-width:100%;padding:8px;box-sizing:border-box';
   document.body.append(host);
   const place=name=>({canonical_name:name,administrative_area:'Emília-Romanya',country_code:'IT',
    coordinate_role:'exact_location',latitude:44.493,longitude:11.344});
   window.quickPlaceFixture=mountQuickItineraryPlace({
    host,row:{id:'bolonya-poi',title:'Archiginnasio i Teatro Anatomico (entrada subjecta a horaris i disponibilitat).'},
    query:'Archiginnasio, Bolonya',current:()=>true,
    initialOptions:[place("Biblioteca Comunale dell'Archiginnasio"),place("Via dell'Archiginnasio"),
     place("Archiginnasio Palace and Anatomical Theater"),place('Archiginnasio di Bologna')],
    search:async()=>({options:[]}),save:async()=>true
   });
  });
  const panel=page.locator('#quickPlacePhoneFixture');
  assert.equal(await panel.locator('button:visible').count(),3,'Only close, search and recommended place are visible; alternatives remain collapsed');
  assert.match(await panel.locator('[data-quick-place-results] > button').innerText(),/Confirma: Archiginnasio Palace and Anatomical Theater/);
  assert.equal(await panel.locator('[data-quick-place-results] details button').count(),3);
  assert.equal(await panel.locator('button.ghost').evaluate(button=>{
   const rect=button.getBoundingClientRect();
   return getComputedStyle(button).whiteSpace==='nowrap'&&rect.width>=84&&button.scrollWidth<=button.clientWidth+1;
  }),true,'Close button must never appear vertically stacked on 260px iPhone-like card');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await panel.locator('button.ghost').click();
  assert.equal(await panel.locator('[data-quick-itinerary-place]').count(),0);
  await ctx.close();console.log('PASS '+engine+' 260px compound place picker + non-vertical close button');
 }
 for(const tablet of [false,true]){
  const ctx=await context({persisted:true,tablet}),page=await ctx.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#tripsHomeView').waitFor({state:'visible'});
  await page.locator('[data-home-view="upcomingTripsView"]').click();await page.locator('[data-select-trip]').click();await page.locator('#genericItineraryModuleCard').click();
  for(const [day,count] of [['27',7],['28',6]]){await page.locator(`[data-generic-itinerary-day="2026-12-${day}"]`).click();await page.waitForFunction(count=>document.querySelectorAll('#genericItineraryDays [data-itinerary-key]').length===count,count)}
  await page.waitForFunction(()=>!itineraryAutoPlaceContext||[...itineraryAutoPlaceContext.days.values()].every(day=>!day.running));
  await page.reload();await page.locator('#tripsHomeView').waitFor({state:'visible'});assert.equal(await page.locator('#loading').isVisible(),false);
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await ctx.close();console.log('PASS '+engine+' persisted auth/13 plans/reload '+(tablet?'tablet':'390px'));
 }
 // Real old SW scripts, shell/SDK caches and activation. Never delete the legacy data cache.
 for(const version of [18,19,20]){
  oldWorker=version;const ctx=await context({sw:true}),page=await ctx.newPage();page.setDefaultTimeout(25000);
  await page.goto(url);await page.waitForFunction(()=>navigator.serviceWorker.controller);await page.locator('#loginCard').waitFor({state:'visible'});
  await page.evaluate(async()=>{const c=await caches.open('freya-travel-v1.5');await c.put('/freya-travel/local-copy',new Response('keep'));});
  assert.equal(await page.locator('#updateToast').isVisible(),false,'First installation is not an app update');
  const boots=await page.evaluate(()=>sessionStorage.boots);
  oldWorker=null;await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
  await page.waitForFunction(async version=>{const keys=await caches.keys(),r=await navigator.serviceWorker.getRegistration();return keys.includes('freya-travel-release-6444-v33')&&!keys.includes('freya-travel-release-6444-v'+version)&&r?.active?.state==='activated'&&!r.installing&&!r.waiting&&navigator.serviceWorker.controller?.state==='activated'},version);
  assert.equal(await page.evaluate(()=>sessionStorage.boots),boots,'An activated update must not reload a usable app or lose drafts');
  await page.waitForFunction(()=>new Promise(resolve=>{
   const channel=new MessageChannel(),timer=setTimeout(()=>resolve(false),500);
   channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data?.cache==='freya-travel-release-6444-v33')};
   navigator.serviceWorker.controller?.postMessage({type:'FREYA_BOOT_VERSION'},[channel.port2]);
  }));
  await page.reload();await page.locator('#loginCard').waitFor({state:'visible'});
  await page.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated');
  assert.equal(await page.evaluate(async()=>!!(await (await caches.open('freya-travel-release-6444-v33')).match(new URL('index.html',location.href).href))),true);
  // 503 is not an offline exception: the previous worker returned the error instead of its SDK cache.
  fault='shell503';await page.reload().catch(async error=>{console.error('SW fallback failure',version,await page.evaluate(async()=>({keys:await caches.keys(),controller:navigator.serviceWorker.controller?.state,cache:!!(await (await caches.open('freya-travel-release-6444-v33')).match('./index.html'))})).catch(()=>null));throw error});await page.locator('#loginCard').waitFor({state:'visible'});fault='';
  assert.equal(await page.evaluate(async()=>await (await caches.open('freya-travel-v1.5')).match('/freya-travel/local-copy').then(r=>r.text())),'keep');
  await page.goto(url+'freya-travel-v1.5/');await page.waitForURL(url);await page.locator('#loginCard').waitFor({state:'visible'});
  // WebKit's automation-level setOffline rejects navigation before dispatching to SW.
  // Drop actual server connections and set the offline hint instead; Chromium also uses native emulation.
  if(engine==='webkit'){await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));fault='offline'}
  else await ctx.setOffline(true);
  await page.reload();await page.locator('#loginCard').waitFor({state:'visible'});fault='';
  assert.equal(await page.evaluate(()=>localStorage.getItem('freya-unsynced-test-draft')),'preserve');await ctx.close();console.log('PASS '+engine+' SW v'+version+' upgrade, cached 503 recovery, legacy entry, cold offline');
 }
 assert.equal(writes,0);console.log('PASS '+engine+' bootstrap; no remote writes. Physical installed iPhone pending.');
}finally{fault='';await browser.close();await new Promise(r=>server.close(r))}

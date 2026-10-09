// Exercises the actual Pages build, not an extracted or rewritten HTML fixture.
// Playwright is test tooling only; CI installs it outside the application package.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const dist=resolve(process.env.PAGES_DIST||resolve(root,'dist'));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const missing=[];
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=resolve(dist,decodeURIComponent(pathname.replace(/^\/freya-travel\//,''))||'index.html');
  if(!pathname.startsWith('/freya-travel/')||!file.startsWith(dist+sep)){res.writeHead(404).end();return}
  try{const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(body)}
  catch{missing.push(pathname);res.writeHead(404,{'Content-Type':'text/html'}).end('Not found')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/freya-travel/';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const apis=['travelBookProposalApi','travelBookBatchApi','travelBookEditorApi'];
async function context(options={}){
  const ctx=await browser.newContext(options);
  // Keep this packaging test independent of CDN availability and never access production data.
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({path:resolve(root,'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),contentType:'text/javascript'}));
  await ctx.route('https://otueskpksylzvkhldoft.supabase.co/**',route=>route.abort());
  return ctx;
}
try{
  const ctx=await context({serviceWorkers:'block'}),page=await ctx.newPage(),errors=[],modules=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(/travel-book.*\.mjs/.test(response.url()))modules.push({url:response.url(),status:response.status(),type:response.headers()['content-type']})});
  await page.goto(url,{waitUntil:'load'});
  for(const api of apis)await page.evaluate(async name=>{const a=window[name](),b=window[name]();if(a!==b)throw Error('Concurrent imports are not shared');await a},api);
  assert.equal(modules.length,3,JSON.stringify(modules));
  for(const module of modules){assert.equal(module.status,200);assert.match(module.type,/javascript/);assert.ok(new URL(module.url).pathname.startsWith('/freya-travel/domain/'),module.url)}
  assert.deepEqual(errors,[]);
  console.log('PASS fresh browser: all Travel Book entry modules load from domain/ with the editor dependency bundled');
  await ctx.close();


  // Functional encrypted vault regression: real IndexedDB + WebCrypto, no
  // external Supabase requests, no real documents or credentials.
  const vaultCtx=await context({serviceWorkers:'block'}),vaultPage=await vaultCtx.newPage();
  await vaultPage.goto(url,{waitUntil:'load'});
  const vaultResult=await vaultPage.evaluate(async()=>{
    session={user:{id:'test-vault-owner'}};
    trip={id:'test-vault-trip',experience_key:null};
    tripLoadGeneration++;
    const scope=offlineDocScope();
    const bytes=new Uint8Array([37,80,68,70,45,49,46,52,10,65,66,67]);
    const doc={id:'test-ticket',file_path:'test-vault-trip/boarding.pdf',file_name:'boarding.pdf',mime_type:'application/pdf'};
    await offlineDocSaveBlob(scope,doc,new Blob([bytes],{type:'application/pdf'}));
    const database=await offlineDocDatabase(),encrypted=await offlineDocRead(database,'records',offlineDocId(scope.userId,scope.tripId,doc.id));
    if(!encrypted?.ciphertext||encrypted.ciphertext.byteLength<=bytes.byteLength)throw Error('No encrypted bytes stored');
    const restored=await offlineDocGetBlob(scope,doc);
    const actual=new Uint8Array(await restored.blob.arrayBuffer());
    if(actual.join(',')!==bytes.join(','))throw Error('Offline document contents differ');
    const alternate=offlineDocId('another-user',scope.tripId,doc.id);
    if(alternate===encrypted.key)throw Error('Vault keys are not user scoped');
    const wrongPath=await offlineDocGetBlob(scope,{...doc,file_path:'another-path.pdf'});
    if(wrongPath)throw Error('Changed document path must invalidate cached bytes');
    const beforeClose=await offlineDocRead(database,'keys',scope.userId);
    if(!beforeClose)throw Error('No account key');
    // A real in-app logout revokes the active local scope, but must no longer
    // remove encrypted copies. The same account can reopen them without download.
    clearOfflineUserData(scope.userId);
    session=null;trip=null;
    if(offlineDocScope())throw Error('Signed-out account retained an offline document scope');
    const stillStored=await offlineDocRead(database,'records',encrypted.key);
    const stillKey=await offlineDocRead(database,'keys',scope.userId);
    if(!stillStored||!stillKey)throw Error('Logout deleted a previously saved offline document');
    if(stillKey.extractable||stillKey.algorithm?.name!=='AES-GCM'||stillKey.algorithm?.length!==256)
      throw Error('Persistent document key is not non-exportable AES-256-GCM');
    let exportBlocked=false;
    try{await crypto.subtle.exportKey('raw',stillKey)}catch(_){exportBlocked=true}
    if(!exportBlocked)throw Error('Document key was exported');
    if(await offlineDocGetBlob(scope,doc))throw Error('Old scope survived explicit logout');
    session={user:{id:'test-vault-other'}};
    trip={id:'test-vault-trip',experience_key:null};
    if(await offlineDocGetBlob(offlineDocScope(),doc))throw Error('Other account read private PDF');
    const otherKey=await offlineDocKey(database,'test-vault-other',true);
    let wrongKeyBlocked=false;
    try{await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(encrypted.iv)},otherKey,encrypted.ciphertext)}
    catch(_){wrongKeyBlocked=true}
    if(!wrongKeyBlocked)throw Error('Other account decrypted private PDF');
    session={user:{id:'test-vault-owner'}};
    trip={id:'test-vault-trip',experience_key:null};
    const restoredAfterLogin=await offlineDocGetBlob(offlineDocScope(),doc);
    if(!restoredAfterLogin)throw Error('Same account cannot reopen offline document after login');
    if(new Uint8Array(await restoredAfterLogin.blob.arrayBuffer()).join(',')!==bytes.join(','))
      throw Error('Preserved offline document contents changed after logout');
    // Purging one account must not erase another account's encrypted copies.
    session={user:{id:'test-vault-other'}};tripLoadGeneration++;
    const otherScope=offlineDocScope(),otherDoc={id:'other-document',file_path:'test-vault-trip/other.pdf',file_name:'other.pdf',mime_type:'application/pdf'};
    await offlineDocSaveBlob(otherScope,otherDoc,new Blob([bytes],{type:'application/pdf'}));
    const otherId=offlineDocId(otherScope.userId,otherScope.tripId,otherDoc.id);
    session={user:{id:'test-vault-owner'}};tripLoadGeneration++;
    const purgeButton=document.getElementById('purgeOfflineDocuments');
    if(purgeButton?.onclick!==purgeOfflineDocumentCopies)throw Error('Purge UI button not connected');
    const originalConfirm=window.confirm;
    window.confirm=()=>false;
    await purgeOfflineDocumentCopies();
    if(!await offlineDocRead(database,'records',encrypted.key))throw Error('Cancel erased a saved document');
    window.confirm=()=>true;
    await purgeOfflineDocumentCopies();
    window.confirm=originalConfirm;
    if(!document.getElementById('offlinePurgeMsg').textContent.includes('S’han esborrat'))
      throw Error('Purge UI did not confirm removal');
    if(await offlineDocRead(database,'records',encrypted.key))throw Error('Purge retained owner encrypted bytes');
    if(await offlineDocRead(database,'keys',scope.userId))throw Error('Purge retained owner key');
    if(!await offlineDocRead(database,'records',otherId)||!await offlineDocRead(database,'keys',otherScope.userId))
      throw Error('Purge erased a different account');
    session={user:{id:'test-vault-other'}};tripLoadGeneration++;
    if(!await offlineDocGetBlob(offlineDocScope(),otherDoc))throw Error('Other account lost its document');
    await clearOfflineDocumentUserData(otherScope.userId);
    return {bytes:actual.length,encrypted:true,cleaned:true};
  });
  assert.ok(vaultResult.encrypted&&vaultResult.cleaned);
  console.log('PASS functional encrypted offline PDF vault and account data removal');
  await vaultCtx.close();

  for(const api of apis){
    const retryCtx=await context({serviceWorkers:'block'}),retryPage=await retryCtx.newPage();
    const file={travelBookProposalApi:'proposal',travelBookBatchApi:'batch',travelBookEditorApi:'editor-state'}[api];
    let attempts=0;
    await retryCtx.route(`**/domain/travel-book-${file}.mjs*`,route=>++attempts===1?route.abort('failed'):route.continue());
    await retryPage.goto(url,{waitUntil:'load'});
    assert.equal(await retryPage.evaluate(async name=>{try{await window[name]();return false}catch{return true}},api),true);
    await retryPage.evaluate(async name=>{await window[name]()},api);
    assert.equal(attempts,2);
    console.log('PASS failed import retries without reload: '+api);
    await retryCtx.close();
  }


  // Functional regression: render one real Travel Book page and drag a sticker.
  const dragCtx=await context({serviceWorkers:'block'}),dragPage=await dragCtx.newPage();
  await dragPage.goto(url,{waitUntil:'load'});
  await dragPage.evaluate(()=>{
    const proposal={
      title:'Drag test',
      stats:{ready_photos:1},
      cover:null,
      warnings:[],
      sections:[{
        key:'day:2026-10-06',role:'day',local_date:'2026-10-06',items:[{asset_id:'11111111-1111-1111-1111-111111111111'}],
        pages:[{index:0,layout_hint:'hero',creative_style:'hero_editorial',title:'Test',subtitle:null,stickers:['sparkle'],sticker_positions:{sparkle:{x:82,y:18,rotation:0}},items:[{asset_id:'11111111-1111-1111-1111-111111111111',overlay_text:null}]}]
      }]
    };
    renderTravelBookProposal(proposal,new Map(),1,{});
    for(let el=document.getElementById('travelBookView');el;el=el.parentElement)el.classList.remove('hidden');
  });
  const sticker=dragPage.locator('.travel-book-sticker').first();
  await sticker.waitFor({state:'visible'});
  await sticker.scrollIntoViewIfNeeded();
  const before=await sticker.evaluate(el=>({left:el.style.left,top:el.style.top}));
  const box=await sticker.boundingBox(); assert.ok(box);
  const hit=await dragPage.evaluate(({x,y})=>{const el=document.elementFromPoint(x,y);return {tag:el?.tagName||null,cls:el?.className||null,sticker:el?.dataset?.sticker||null};},{x:box.x+box.width/2,y:box.y+box.height/2});
  console.log('DRAG hit target',JSON.stringify(hit));
  assert.equal(hit.sticker,'sparkle',`Sticker drag is blocked by ${JSON.stringify(hit)}`);
  await dragPage.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await dragPage.mouse.down();
  await dragPage.mouse.move(box.x-80,box.y+90,{steps:8});
  await dragPage.mouse.up();
  const after=await sticker.evaluate(el=>({left:el.style.left,top:el.style.top}));
  assert.notDeepEqual(after,before,JSON.stringify({before,after}));
  console.log('PASS functional sticker drag changes rendered position');
  await dragCtx.close();

  // Isolated responsive rendering check, independent of offline auth startup.
  const narrowCtx=await context({serviceWorkers:'block'}),narrowPage=await narrowCtx.newPage();
  await narrowPage.goto(url,{waitUntil:'load'});
  await narrowPage.evaluate(()=>{
    session={user:{id:'responsive-fixture'}};
    trip={id:'responsive-trip',experience_key:null};
    document.getElementById('tripView').classList.remove('hidden');
    document.getElementById('documentsView').classList.remove('hidden');
    renderDocuments([{id:'responsive-document',title:'Bitllet molt llarg per a una pantalla estreta',
      file_name:'document-amb-un-nom-extraordinariament-llarg-per-provar-amplada.pdf',
      file_path:'fixture/test.pdf',mime_type:'application/pdf',category:'Reserva'}]);
    document.querySelector('#documentsList [data-offline-forget]')?.classList.remove('hidden');
  });
  for(const width of [320,375,430]){
    await narrowPage.setViewportSize({width,height:700});
    const layout=await narrowPage.evaluate(()=>{
      const buttons=[...document.querySelectorAll('#documentsView .doc-actions button,#purgeOfflineDocuments')]
        .filter(el=>el.getClientRects().length);
      return {count:buttons.length,purgeVisible:buttons.some(el=>el.id==='purgeOfflineDocuments'),overflow:buttons.filter(el=>{
        const rect=el.getBoundingClientRect(),card=el.closest('.doc-card,.card').getBoundingClientRect();
        return rect.left<card.left-1||rect.right>card.right+1||rect.right>innerWidth+1;
      }).map(el=>el.textContent.trim())};
    });
    assert.ok(layout.count>=4&&layout.purgeVisible,JSON.stringify({width,layout}));
    assert.deepEqual(layout.overflow,[],JSON.stringify({width,layout}));
  }
  console.log('PASS document actions and offline purge fit 320/375/430px iPhone layouts');
  await narrowCtx.close();

  const pwaCtx=await context(),pwa=await pwaCtx.newPage();
  // Seed the prior cache before the real new worker installs.
  await pwa.addInitScript(async()=>{if(!sessionStorage.getItem('seeded-old-cache')){sessionStorage.setItem('seeded-old-cache','1');await Promise.all([caches.open('freya-travel-release-6444-v4'),caches.open('another-app-unrelated-cache')])}});
  await pwa.goto(url,{waitUntil:'load'});
  await pwa.waitForFunction(()=>!!navigator.serviceWorker.controller);
  // The app may reload once when the new worker takes control. Treat that as
  // part of the upgrade path instead of racing evaluate() against navigation.
  await pwa.waitForTimeout(250);
  await pwa.waitForLoadState('load');
  const workerSource=await readFile(resolve(dist,'sw.js'),'utf8');
  const currentCacheName=workerSource.match(/const CACHE='([^']+)'/)?.[1];
  assert.ok(currentCacheName,'Service worker must declare a named cache');
  const cacheNames=await pwa.evaluate(()=>caches.keys());
  assert.ok(cacheNames.includes(currentCacheName));
  assert.ok(!cacheNames.includes('freya-travel-release-6444-v4'));
  assert.ok(cacheNames.includes('another-app-unrelated-cache'),'A Freya upgrade must not remove another app cache');
  const cached=await pwa.evaluate(async name=>{const c=await caches.open(name);return (await c.keys()).map(r=>new URL(r.url).pathname)},currentCacheName);
  for(const file of ['proposal','batch','editor-state','composition'])assert.ok(cached.includes(`/freya-travel/domain/travel-book-${file}.mjs`));
  assert.ok(cached.includes('/freya-travel/vendor/supabase.js'),'Bundled Supabase runtime must be precached');
  // Seed one private PDF under an explicitly simulated valid local account
  // while network is available. Do not use real accounts or Supabase data.
  await pwa.waitForFunction(()=>authInitializationResolved===true);
  await pwa.evaluate(async()=>{
    session={user:{id:'test-offline-cold-owner'}};
    trip={id:'test-offline-cold-trip',experience_key:null};
    tripLoadGeneration++;
    const scope=offlineDocScope();
    const doc={id:'cold-pass',file_path:'test-offline-cold-trip/pass.pdf',file_name:'pass.pdf',mime_type:'application/pdf'};
    await offlineDocSaveBlob(scope,doc,new Blob([new Uint8Array([37,80,68,70,45,49,46,55,10])],{type:'application/pdf'}));
  });
  await pwaCtx.setOffline(true);
  for(const api of apis)await pwa.evaluate(async name=>{await window[name]()},api);
  // Force a cold navigation with network completely unavailable: testing
  // imports in an already-open page does not cover the PWA bootstrap.
  const offlineErrors=[];
  pwa.on('pageerror',error=>offlineErrors.push(error.message));
  await pwa.reload({waitUntil:'load'});
  await pwa.waitForFunction(()=>typeof window.supabase?.createClient==='function');
  assert.equal(await pwa.evaluate(()=>navigator.onLine),false);
  assert.deepEqual(offlineErrors,[],'Cold offline PWA bootstrap should have no uncaught JS errors');
  await pwa.waitForFunction(()=>authInitializationResolved===true);
  const reopenedDocument=await pwa.evaluate(async()=>{
    // The app still requires a valid account session. The test simulates
    // that condition without ever storing real user credentials.
    session={user:{id:'test-offline-cold-owner'}};
    trip={id:'test-offline-cold-trip',experience_key:null};
    tripLoadGeneration++;
    const doc={id:'cold-pass',file_path:'test-offline-cold-trip/pass.pdf',file_name:'pass.pdf',mime_type:'application/pdf'};
    const cached=await offlineDocGetBlob(offlineDocScope(),doc);
    if(!cached)throw Error('Cold reopened PWA cannot decrypt its cached document');
    await openDocument(doc.id,[doc]);
    const iframe=document.querySelector('#documentViewerBody iframe');
    if(!iframe?.src?.startsWith('blob:'))throw Error('Cached PDF was not opened locally');
    const raw=new Uint8Array(await cached.blob.arrayBuffer());
    const localUrl=iframe.src;
    closeDocumentViewer();
    if(!document.getElementById('documentViewer').classList.contains('hidden'))throw Error('Cached PDF viewer did not close');
    await clearOfflineDocumentUserData(session.user.id);
    return {localUrl:localUrl.startsWith('blob:'),byteCount:raw.length,offline:navigator.onLine===false};
  });
  assert.equal(reopenedDocument.offline,true);
  assert.equal(reopenedDocument.localUrl,true);
  assert.equal(reopenedDocument.byteCount,9);
  console.log('PASS PWA cold reopens encrypted PDF in mode avio with simulated authenticated user scope');
  console.log('PASS PWA cold reopens offline with locally bundled Supabase runtime');
  assert.deepEqual(missing.filter(path=>/\.m?js$/.test(path)),[]);
  console.log('PASS PWA old cache retired; current cache contains full graph and loads modules offline');
  await pwaCtx.close();

  // E2E: a pre-authorized local account must restore its own trip, document
  // cards and itinerary after an entirely new page opens without a network.
  // Seed only while online; do NOT inject session/trip after reopening.
  const coldCtx=await context(),coldOnline=await coldCtx.newPage();
  await coldOnline.goto(url,{waitUntil:'load'});
  await coldOnline.waitForFunction(()=>!!navigator.serviceWorker.controller&&authInitializationResolved===true);
  await coldOnline.locator('#loginCard').waitFor({state:'visible'});
  await coldOnline.evaluate(()=>{
    const userId='test-offline-ui-owner',tripId='test-offline-ui-trip';
    // Simulated previously authenticated online session (no real credentials).
    session={user:{id:userId,email:'offline-test@example.invalid'},access_token:'test-only-online-token'};
    const row={id:tripId,name:'Viatge fictici offline',start_date:'2026-10-09',end_date:'2026-10-10',time_zone:'Europe/Madrid',is_owner:true,experience_key:null};
    if(!rememberOfflineTrips([row],userId)||readOfflineSessionGrant()?.userId!==userId)
      throw Error('Online trip snapshot did not establish the genuine local read grant');
    const agenda={
      flightRows:[],flightDocumentLinks:[],accommodationRows:[],accommodationDocumentLinks:[],
      activityRows:[],activityDocumentLinks:[],dayMetadataRows:[],
      manualItineraryRows:[{id:'test-offline-plan',trip_id:tripId,title:'Passeig fictici offline',timing_kind:'all_day',local_date:'2026-10-09',time_zone:'Europe/Madrid',status:'planned'}]
    };
    const documentRows=[{id:'test-offline-doc',trip_id:tripId,title:'Reserva ficticia offline',category:'Reserva',file_name:'reserva-test.pdf',file_path:'test-only/reserva-test.pdf',mime_type:'application/pdf'}];
    if(!mergeOfflineTripSnapshot({agenda,documentRows,tripStopRows:[],checklistItems:[]},tripId,userId))
      throw Error('Could not prepare offline trip data while online');
  });
  await coldCtx.setOffline(true);
  await coldOnline.close(); // A fresh page must bootstrap without the previous JS globals.
  const coldReopen=await coldCtx.newPage();
  await coldReopen.goto(url,{waitUntil:'load'});
  await coldReopen.locator('[data-select-trip="test-offline-ui-trip"]').waitFor({state:'visible',timeout:15000});
  assert.deepEqual(await coldReopen.evaluate(()=>({
    userId:session?.user?.id,readOnly:offlineReadOnlySession,hasToken:!!session?.access_token,online:navigator.onLine
  })),{userId:'test-offline-ui-owner',readOnly:true,hasToken:false,online:false});
  await coldReopen.locator('[data-select-trip="test-offline-ui-trip"]').click();
  await coldReopen.locator('#genericDashboardView [data-open="itineraryView"]').click();
  await coldReopen.locator('#genericItineraryDays').getByText('Passeig fictici offline').waitFor({state:'visible',timeout:15000});
  await coldReopen.evaluate(()=>setAppView('genericDashboardView')); // Navigate only; never inject the account or trip.
  await coldReopen.locator('#genericDashboardView [data-open="documentsView"]').click();
  await coldReopen.locator('#documentsList .doc-card h3').getByText('Reserva ficticia offline').waitFor({state:'visible',timeout:15000});
  assert.equal(await coldReopen.evaluate(()=>trip?.id),'test-offline-ui-trip');
  console.log('PASS new offline page automatically restores local session, trip, itinerary and document cards');
  await coldReopen.close();
  // iOS can report navigator.onLine=true despite no server connectivity.
  // Reopen from scratch with network still blocked and do not inject a session.
  const unreliableNetwork=await coldCtx.newPage();
  await unreliableNetwork.addInitScript(()=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});
  });
  await unreliableNetwork.goto(url,{waitUntil:'load'});
  assert.equal(await unreliableNetwork.evaluate(()=>navigator.onLine),true);
  try{
    await unreliableNetwork.locator('[data-select-trip="test-offline-ui-trip"]').waitFor({state:'visible',timeout:8000});
  }catch(error){
    const diagnostic=await unreliableNetwork.evaluate(()=>({
      online:navigator.onLine,authReady:authInitializationResolved,
      activeUser:session?.user?.id||null,readOnly:offlineReadOnlySession,
      grantUser:readOfflineSessionGrant()?.userId||null,
      storedTripCount:readOfflineTrips('test-offline-ui-owner')?.rows?.length??null,
      loadedTripCount:trips.length,selectedTrip:trip?.id||null,
      authVisible:!document.getElementById('auth').classList.contains('hidden'),
      tripVisible:!document.getElementById('tripView').classList.contains('hidden'),
      noTripVisible:!document.getElementById('noTrip').classList.contains('hidden'),
      loadMessage:document.getElementById('tripLoadError')?.textContent||''
    }));
    console.error('OFFLINE_FALSE_ONLINE_COLD_START_DIAGNOSTIC',JSON.stringify(diagnostic));
    throw error;
  }
  assert.deepEqual(await unreliableNetwork.evaluate(()=>({
    userId:session?.user?.id,readOnly:offlineReadOnlySession,tripCount:trips.length
  })),{userId:'test-offline-ui-owner',readOnly:true,tripCount:1});
  console.log('PASS local recovery with unavailable Internet and misleading navigator.onLine');
  // Security gate: an explicit UI logout must revoke the local grant even
  // when the browser falsely claims Internet connectivity.
  await unreliableNetwork.locator('.logout:visible').first().click();
  await unreliableNetwork.locator('#loginCard').waitFor({state:'visible',timeout:10000});
  assert.deepEqual(await unreliableNetwork.evaluate(()=>({
    userId:session?.user?.id||null,offlineGrant:readOfflineSessionGrant(),
    savedTrips:readOfflineTrips('test-offline-ui-owner')
  })),{userId:null,offlineGrant:null,savedTrips:null});
  await unreliableNetwork.close();
  const loggedOutColdOpen=await coldCtx.newPage();
  await loggedOutColdOpen.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true}));
  await loggedOutColdOpen.goto(url,{waitUntil:'load'});
  await loggedOutColdOpen.locator('#loginCard').waitFor({state:'visible',timeout:10000});
  assert.equal(await loggedOutColdOpen.locator('[data-select-trip="test-offline-ui-trip"]').count(),0);
  assert.equal(await loggedOutColdOpen.evaluate(()=>!!session||offlineReadOnlySession),false);
  console.log('PASS explicit logout revokes offline access across cold restart with misleading online signal');
  // Security gate: a grant older than 30 days cannot unlock local data,
  // even though the trip snapshot is still stored on this same device.
  await loggedOutColdOpen.close();
  await coldCtx.setOffline(false);
  const expiredSeed=await coldCtx.newPage();
  await expiredSeed.goto(url,{waitUntil:'load'});
  await expiredSeed.waitForFunction(()=>authInitializationResolved===true);
  await expiredSeed.evaluate(()=>{
    const userId='test-expired-owner';
    session={user:{id:userId,email:'expired-test@example.invalid'},access_token:'test-only-online-token'};
    if(!rememberOfflineTrips([{
      id:'test-expired-trip',name:'Viatge amb concessio caducada',
      start_date:'2026-10-09',end_date:'2026-10-10',time_zone:'Europe/Madrid',
      is_owner:true,experience_key:null
    }],userId))throw Error('Could not seed expiring offline grant');
    const grant=JSON.parse(localStorage.getItem(OFFLINE_AUTH_GRANT_KEY));
    grant.verifiedAt=Date.now()-OFFLINE_AUTH_GRANT_MAX_AGE_MS-1000;
    localStorage.setItem(OFFLINE_AUTH_GRANT_KEY,JSON.stringify(grant));
    if(readOfflineSessionGrant())throw Error('Expired grant was accepted');
    if(!readOfflineTrips(userId))throw Error('Trip snapshot was unexpectedly removed');
  });
  await coldCtx.setOffline(true);
  await expiredSeed.close();
  const expiredReopen=await coldCtx.newPage();
  await expiredReopen.goto(url,{waitUntil:'load'});
  await expiredReopen.waitForFunction(()=>authInitializationResolved===true);
  await expiredReopen.locator('#loginCard').waitFor({state:'visible',timeout:10000});
  assert.deepEqual(await expiredReopen.evaluate(()=>({
    userId:session?.user?.id||null,readOnly:offlineReadOnlySession,
    grantAccepted:!!readOfflineSessionGrant(),
    cachedTripExists:!!readOfflineTrips('test-expired-owner'),
    tripCardCount:document.querySelectorAll('[data-select-trip="test-expired-trip"]').length
  })),{userId:null,readOnly:false,grantAccepted:false,cachedTripExists:true,tripCardCount:0});
  console.log('PASS expired local grant denies offline entry while retaining cached trip metadata');
  await expiredReopen.close();
  await coldCtx.setOffline(false);
  // Two account snapshots coexist on one device. Only beta has the latest
  // valid online grant; do not inject user or trip after offline reopening.
  const switchSeed=await coldCtx.newPage();
  await switchSeed.goto(url,{waitUntil:'load'});
  await switchSeed.waitForFunction(()=>authInitializationResolved===true);
  await switchSeed.evaluate(()=>{
    for(const name of ['alpha','beta']){
      const userId='account-'+name,tripId='trip-'+name;
      session={user:{id:userId,email:name+'@example.invalid'},access_token:'test-only-online-token'};
      const rows=[{id:tripId,name:'Viatge privat '+name,start_date:'2026-10-09',
        end_date:'2026-10-10',time_zone:'Europe/Madrid',is_owner:true,experience_key:null}];
      const agenda={flightRows:[],flightDocumentLinks:[],accommodationRows:[],
        accommodationDocumentLinks:[],activityRows:[],activityDocumentLinks:[],
        dayMetadataRows:[],manualItineraryRows:[{id:'manual-'+name,trip_id:tripId,
          title:'Pla privat '+name,timing_kind:'all_day',local_date:'2026-10-09',
          time_zone:'Europe/Madrid',status:'planned'}]};
      const documentRows=[{id:'doc-'+name,trip_id:tripId,title:'Document privat '+name,
        category:'Reserva',file_name:name+'.pdf',file_path:'test-only/'+name+'.pdf',
        mime_type:'application/pdf'}];
      if(!rememberOfflineTrips(rows,userId)||
        !mergeOfflineTripSnapshot({agenda,documentRows,tripStopRows:[],checklistItems:[]},tripId,userId))
        throw Error('Could not prepare isolated account '+name);
    }
    if(readOfflineSessionGrant()?.userId!=='account-beta'||
      !readOfflineTrips('account-alpha')||!readOfflineTripSnapshot('trip-alpha','account-alpha'))
      throw Error('Expected two cached accounts with only beta authorized');
  });
  await coldCtx.setOffline(true);
  await switchSeed.close();
  const isolatedReopen=await coldCtx.newPage();
  await isolatedReopen.goto(url,{waitUntil:'load'});
  await isolatedReopen.locator('[data-select-trip="trip-beta"]').waitFor({state:'visible',timeout:15000});
  assert.deepEqual(await isolatedReopen.evaluate(()=>({
    owner:session?.user?.id,readOnly:offlineReadOnlySession,hasToken:!!session?.access_token,
    visibleTrips:trips.map(row=>row.id),alphaStillStored:!!readOfflineTrips('account-alpha'),
    forbiddenRead:readOfflineTripSnapshot('trip-alpha')===null
  })),{owner:'account-beta',readOnly:true,hasToken:false,
    visibleTrips:['trip-beta'],alphaStillStored:true,forbiddenRead:true});
  assert.equal(await isolatedReopen.locator('[data-select-trip="trip-alpha"]').count(),0);
  await isolatedReopen.locator('[data-select-trip="trip-beta"]').click();
  await isolatedReopen.locator('#genericDashboardView [data-open="documentsView"]').click();
  await isolatedReopen.locator('#documentsList .doc-card h3').getByText('Document privat beta').waitFor({state:'visible'});
  assert.equal(await isolatedReopen.locator('#documentsList').getByText('Document privat alpha').count(),0);
  await isolatedReopen.evaluate(()=>setAppView('genericDashboardView'));
  await isolatedReopen.locator('#genericDashboardView [data-open="itineraryView"]').click();
  await isolatedReopen.locator('#genericItineraryDays').getByText('Pla privat beta').waitFor({state:'visible'});
  assert.equal(await isolatedReopen.locator('#genericItineraryContent').getByText('Pla privat alpha').count(),0);
  console.log('PASS same-device accounts isolate cached trips, document cards and itinerary after cold offline start');
  // A deliberately expired SDK session must not defeat the valid offline grant.
  await isolatedReopen.evaluate(()=>{
    const key=db.auth.storageKey;
    if(!key||readOfflineSessionGrant()?.userId!=='account-beta')throw Error('Missing verified SDK fixture scope');
    localStorage.setItem(key,JSON.stringify({
      access_token:'expired-fixture-access',refresh_token:'expired-fixture-refresh',
      token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)-120,
      user:{id:'account-beta',email:'beta@example.invalid',role:'authenticated',aud:'authenticated'}
    }));
  });
  await isolatedReopen.close();
  const expiredSdkPage=await coldCtx.newPage();
  await expiredSdkPage.goto(url,{waitUntil:'load'});
  await expiredSdkPage.locator('[data-select-trip="trip-beta"]').waitFor({state:'visible',timeout:15000});
  assert.deepEqual(await expiredSdkPage.evaluate(()=>({
    account:session?.user?.id,readOnly:offlineReadOnlySession,serverToken:!!session?.access_token,
    storedAccessExpired:JSON.parse(localStorage.getItem(db.auth.storageKey)).expires_at<Date.now()/1000
  })),{account:'account-beta',readOnly:true,serverToken:false,storedAccessExpired:true});
  console.log('PASS expired Supabase SDK session fixture cold-opens cached trip in read-only mode');
  await coldCtx.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}

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
  await dragPage.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await dragPage.mouse.down();
  await dragPage.mouse.move(box.x-80,box.y+90,{steps:8});
  await dragPage.mouse.up();
  const after=await sticker.evaluate(el=>({left:el.style.left,top:el.style.top}));
  assert.notDeepEqual(after,before,JSON.stringify({before,after}));
  console.log('PASS functional sticker drag changes rendered position');
  await dragCtx.close();

  const pwaCtx=await context(),pwa=await pwaCtx.newPage();
  // Seed the prior cache before the real new worker installs.
  await pwa.addInitScript(async()=>{if(!sessionStorage.getItem('seeded-old-cache')){sessionStorage.setItem('seeded-old-cache','1');await caches.open('freya-travel-release-6444-v4')}});
  await pwa.goto(url,{waitUntil:'load'});
  await pwa.waitForFunction(()=>!!navigator.serviceWorker.controller);
  // The app may reload once when the new worker takes control. Treat that as
  // part of the upgrade path instead of racing evaluate() against navigation.
  await pwa.waitForTimeout(250);
  await pwa.waitForLoadState('load');
  const cacheNames=await pwa.evaluate(()=>caches.keys());
  assert.ok(cacheNames.includes('freya-travel-release-6444-v5'));
  assert.ok(!cacheNames.includes('freya-travel-release-6444-v4'));
  const cached=await pwa.evaluate(async()=>{const c=await caches.open('freya-travel-release-6444-v5');return (await c.keys()).map(r=>new URL(r.url).pathname)});
  for(const file of ['proposal','batch','editor-state','composition'])assert.ok(cached.includes(`/freya-travel/domain/travel-book-${file}.mjs`));
  await pwaCtx.setOffline(true);
  for(const api of apis)await pwa.evaluate(async name=>{await window[name]()},api);
  assert.deepEqual(missing.filter(path=>/\.m?js$/.test(path)),[]);
  console.log('PASS PWA v4 cache retired; v5 contains full graph and loads modules offline');
  await pwaCtx.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}

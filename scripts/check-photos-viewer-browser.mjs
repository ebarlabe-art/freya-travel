// Real gallery, touch controls and native history traversal. No remote writes or credentials.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const engine=process.env.PHOTO_ENGINE||'webkit',dist=resolve('dist');
const server=createServer(async(req,res)=>{try{
 const name=new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,'');
 const path=resolve(dist,name||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}
 res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');
 res.end(await readFile(process.env.PHOTO_BASELINE_HTML&&path===resolve(dist,'index.html')?process.env.PHOTO_BASELINE_HTML:path));
 }catch(e){res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/freya-travel/`,browser=await pw[engine].launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
 await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',r=>r.fulfill({path:resolve(dist,'vendor/supabase.js'),contentType:'text/javascript'}));
 await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 await page.evaluate(async()=>{
  session={user:{id:'viewer-user'}};trip={id:'viewer-trip',experience_key:'generic',title:'Galeria sintètica'};tripLoadGeneration++;
  activityRows=[];manualItineraryRows=[];
  const rows=Array.from({length:12},(_,i)=>({id:`photo-${i}`,trip_id:trip.id,created_by:session.user.id,category:'Foto',title:`${i<6?'Antiga':'Nova'} ${i}`,file_path:`viewer-trip/photos/photo-${i}.png`,file_name:`photo-${i}.png`,mime_type:'image/png',created_at:i<6?'2026-01-01T12:00:00Z':'2026-11-10T12:00:00Z'}));
  const metadata=rows.slice(6).map(r=>({document_id:r.id,trip_id:trip.id,local_date:'2026-11-10',updated_at:'2026-11-10T12:00:00Z'}));
  window.viewerFixture=JSON.stringify({rows,metadata});window.viewerWrites=0;window.viewerPopstates=0;
  window.addEventListener('popstate',()=>window.viewerPopstates++);
  const forbidden=()=>{window.viewerWrites++;throw Error('Viewer must never write')};
  db.from=table=>{const q={select:()=>q,eq:()=>q,order:()=>q,then:(a,b)=>Promise.resolve({data:table==='travel_documents'?rows:metadata}).then(a,b),insert:forbidden,update:forbidden,delete:forbidden};return q};db.rpc=forbidden;
  const c=document.createElement('canvas');c.width=64;c.height=64;c.getContext('2d').fillRect(0,0,64,64);const image=c.toDataURL('image/png');
  db.storage.from=()=>({createSignedUrl:async()=>({data:{signedUrl:image}}),upload:forbidden,remove:forbidden});
  window.viewerSnapshot=()=>JSON.stringify({rows,metadata});
  APP_VIEWS.forEach(id=>document.getElementById(id)?.classList.toggle('hidden',id!=='photosView'));
  let n=document.getElementById('photosView');while(n){n.classList.remove('hidden');n=n.parentElement}
  document.getElementById('loginCard').classList.add('hidden');document.getElementById('photoForm').classList.add('hidden');
  await loadGenericPhotos();
 });
 const open=async i=>{await page.locator(`[data-photo-open="photo-${i}"]`).tap();await page.locator('#photoLightbox').waitFor({state:'visible'});await page.waitForFunction(()=>$('photoLightboxImage').complete&&$('photoLightboxImage').naturalWidth>0);assert.equal(await page.evaluate(()=>photoNavigation.id),`photo-${i}`)};
 for(let i=0;i<12;i++){
  await open(i);const before=await page.evaluate(()=>window.viewerPopstates);
  await page.locator('#photoLightboxClose').tap();await page.locator('#photoLightbox').waitFor({state:'hidden'});
  await page.waitForFunction(n=>window.viewerPopstates>n,before);
  const state=await page.evaluate(()=>({pending:photoHistoryPending,nav:photoNavigation,returning:!!photoReturnPosition,marker:history.state?.freyaPhoto||null}));
  assert.equal(state.pending,false,`photo ${i}: native popstate must release opening guard: ${JSON.stringify(state)}`);
  assert.equal(state.nav,null);assert.equal(state.returning,false);
 }
 // Browser Back and Forward must not poison subsequent photo navigation.
 await open(0);await page.goBack();await page.locator('#photoLightbox').waitFor({state:'hidden'});
 await page.goForward();await open(6);await page.locator('#photoLightboxClose').tap();await page.waitForFunction(()=>!photoHistoryPending);
 // Context editor cancellation returns to the same photo, then to the gallery.
 await open(1);await page.locator('#editOpenedPhoto').tap();await page.locator('#photoContextEditor').waitFor({state:'visible'});
 await page.goBack();await page.locator('#photoContextEditor').waitFor({state:'hidden'});await page.locator('#photoLightbox').waitFor({state:'visible'});
 await page.locator('#photoLightboxClose').tap();await page.waitForFunction(()=>!photoHistoryPending);await open(7);
 assert.equal(await page.evaluate(()=>window.viewerWrites),0);
 assert.equal(await page.evaluate(()=>window.viewerSnapshot()===window.viewerFixture),true);assert.deepEqual(errors,[]);
 await mkdir('artifacts',{recursive:true});await page.screenshot({path:`artifacts/photos-viewer-${engine}.png`});
 console.log(`${engine}: 12 consecutive old/new photos + Back/Forward + editor return; zero writes, unchanged fixtures, zero JS errors`);
}finally{await browser.close();await new Promise(r=>server.close(r))}

// Real built UI, touch controls, IndexedDB/CryptoKey, reload. Synthetic backend only.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';import {createServer} from 'node:http';import {resolve,extname,sep} from 'node:path';import {pathToFileURL} from 'node:url';
const pw=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const engine=process.env.PHOTO_ENGINE||'webkit',dist=resolve('dist'),objects=new Map(),docs=new Map(),metadata=new Map();
let lostFinalize=false,lostUpload=false,failUpload=false,delay=0,uploads=0,finalizes=0;
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://local');const json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x))};
 if(u.pathname==='/fixture'){
  const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),op=u.searchParams.get('op');
  if(op==='upload'){uploads++;if(delay)await new Promise(r=>setTimeout(r,delay));if(failUpload){failUpload=false;return json({error:{message:'Load failed'}})}const path=u.searchParams.get('path');const duplicate=objects.has(path);objects.set(path,bytes);if(lostUpload){lostUpload=false;res.statusCode=503;return json({error:{message:'Load failed'}})}return json(duplicate?{error:{statusCode:'409'}}:{data:{path}})}
  if(op==='list'){const folder=u.searchParams.get('path'),search=u.searchParams.get('search');return json({data:[...objects].filter(([p])=>p===folder+'/'+search).map(([p,b])=>({name:p.split('/').pop(),metadata:{size:b.length}}))})}
  if(op==='rpc'){const p=JSON.parse(bytes);finalizes++;const id=p.p_document_id,path=p.p_trip_id+'/photos/u/'+id+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'}[p.p_mime_type]);
   assert.ok(objects.has(path),'finalize only after object verification');assert.ok(p.p_selection_index<20);
   if(!docs.has(id)){docs.set(id,{id,trip_id:p.p_trip_id,created_by:'u',category:'Foto',title:p.p_title,file_name:p.p_file_name,file_path:path,mime_type:p.p_mime_type,created_at:new Date().toISOString()});metadata.set(id,{document_id:id,trip_id:p.p_trip_id,upload_batch_id:p.p_upload_batch_id,selection_index:p.p_selection_index,local_date:p.p_local_date,activity_id:p.p_activity_id,itinerary_item_id:p.p_itinerary_item_id})}
   if(lostFinalize){lostFinalize=false;res.statusCode=503;return json({error:{message:'Load failed'}})}return json({data:{document:docs.get(id),metadata:metadata.get(id)}});
  }
  if(op==='read'){const filters=JSON.parse(u.searchParams.get('filters')),rows=[...(u.searchParams.get('table')==='travel_documents'?docs:metadata).values()].filter(r=>filters.every(([k,v])=>r[k]===v));return json({data:u.searchParams.get('single')==='true'?(rows[0]||null):rows})}
 }
 if(u.pathname==='/image'){const path=u.searchParams.get('path'),body=objects.get(path);if(!body){res.writeHead(404).end();return}res.setHeader('Content-Type',path.endsWith('.png')?'image/png':path.endsWith('.jpg')?'image/jpeg':'image/heic');res.end(body);return}
 const name=u.pathname.replace(/^\/freya-travel\//,''),path=resolve(dist,name||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}
 res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch(e){res.writeHead(500).end(e.message)}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage();page.setDefaultTimeout(20000);const errors=[],interruptedIds=new Set();let forcedOffline=false;page.on('pageerror',e=>{// WebKit emits an access-control pageerror for an intentionally aborted read during reload/offline. Scope the allowance to those exact synthetic job IDs.
 if(engine==='webkit'&&[...interruptedIds].some(id=>e.message.includes(id))&&e.message.includes('/fixture?op=read&table=travel_documents&')&&e.message.endsWith('due to access control checks.'))return;errors.push(e.message)});
 async function init(user='u',tripId='trip'){
  await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
  await page.evaluate(async({user,tripId})=>{
   session={user:{id:user}};trip={id:tripId,experience_key:'generic',title:'Synthetic photos'};tripLoadGeneration++;activityRows=[];manualItineraryRows=[{id:'planning',trip_id:tripId,title:'Passeig sintètic'}];
   const call=async(op,params={},body)=>{const r=await fetch('/fixture?'+new URLSearchParams({op,...params}),body?{method:'POST',body}:{});return r.json()};
   db.from=table=>{const filters=[];let single=false;const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q},order:()=>q,maybeSingle:()=>{single=true;return q},then:(a,b)=>call('read',{table,filters:JSON.stringify(filters),single}).then(a,b)};return q};
   db.rpc=(name,p)=>{if(name!=='finalize_trip_photo')throw Error('Unexpected RPC');return call('rpc',{},JSON.stringify(p))};
   db.storage.from=()=>({upload:(path,file,options)=>{if(options.upsert)throw Error('upsert prohibited');return call('upload',{path},file)},list:(path,{search})=>call('list',{path,search}),createSignedUrl:async path=>({data:{signedUrl:'/image?path='+encodeURIComponent(path)}})});
   APP_VIEWS.forEach(id=>document.getElementById(id)?.classList.toggle('hidden',id!=='photosView'));
   for(const id of ['photosView','photoUploadV2']){let n=document.getElementById(id);while(n){n.classList.remove('hidden');n=n.parentElement}}
   document.getElementById('loginCard').classList.add('hidden');document.getElementById('photoForm').classList.add('hidden');
   renderPhotoQueue();await restorePhotoQueue();await loadGenericPhotos();
  },{user,tripId});
 }
 await init();const jpeg=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;c.getContext('2d').fillRect(0,0,64,64);return c.toDataURL('image/jpeg',0.95).split(',')[1]}),'base64');
 const files=n=>Array.from({length:n},(_,i)=>({name:`photo-${n}-${i}.jpg`,mimeType:'image/jpeg',buffer:jpeg}));
 const waitReady=()=>page.waitForFunction(()=>!photoQueuePreparing&&!photoQueueRunning);
 for(const n of [5,20,50]){
  await page.locator('#photoFilesV2').setInputFiles(files(n));await waitReady();
  assert.equal(await page.evaluate(()=>photoQueue.length),n);
  await page.locator('[data-photo-date="batch"]').fill('2030-11-07');await page.locator('[data-photo-source="batch"]').selectOption('manual:planning');await page.locator('[data-apply-photo-context]').tap();
  await page.evaluate(()=>photoPersistence); // durability, not only in-memory preview
  if(n===20){await init();assert.equal(await page.evaluate(()=>photoQueue.length),20)}
  if(n===50){lostFinalize=true;lostUpload=true;delay=10}
  const start=docs.size;await page.locator('#photoQueueUpload').tap();await waitReady();
  if(n===50){assert.ok(await page.locator('[data-photo-retry]').count());await page.locator('#photoQueueRetry').tap();await waitReady()}
  assert.equal(docs.size,start+n);assert.ok([...objects.values()].every(bytes=>bytes.equals(jpeg)),'stored bytes equal originals');assert.equal(await page.evaluate(()=>photoQueue.filter(j=>j.status==='uploaded').length),n);
  assert.ok([...metadata.values()].every(m=>m.local_date==='2030-11-07'&&m.itinerary_item_id==='planning'));
  await init();assert.equal(await page.locator('#photosList [data-photo-id]').count(),docs.size);assert.equal(await page.evaluate(()=>photoQueue.filter(j=>j.status==='uploaded').length),n);
  await page.locator('#photosList img').first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const img=document.querySelector('#photosList img');return img?.complete&&img.naturalWidth>0});
  const before=uploads;await page.locator('#photoQueueClear').tap();await waitReady();assert.equal(await page.evaluate(()=>photoQueue.length),0);assert.equal(uploads,before);
  console.log(`PASS ${engine} ${n} photos: original bytes + finalization + metadata + gallery after reload; no duplicate`);
 }
 // Actual touch retry while the worker is active; late response is not a second photo.
 failUpload=true;delay=180;await page.locator('#photoFilesV2').setInputFiles(files(3));await waitReady();await page.locator('#photoQueueUpload').tap();await page.locator('[data-photo-retry]').first().tap();await waitReady();assert.equal(await page.evaluate(()=>photoQueue.filter(j=>j.status==='uploaded').length),3);
 await page.locator('#photoQueueClear').tap();await waitReady();
 // Uncommitted queue survives closing/reopening but is invisible in other scopes.
 await page.locator('#photoFilesV2').setInputFiles(files(2));await waitReady();const ids=await page.evaluate(()=>photoQueue.map(j=>j.id));
 await init('other');assert.equal(await page.evaluate(()=>photoQueue.length),0);await init('u','other-trip');assert.equal(await page.evaluate(()=>photoQueue.length),0);await init();assert.deepEqual(await page.evaluate(()=>photoQueue.map(j=>j.id)),ids);
 // Genuine persistent scope with HEIC/HEIF original bytes (no decoder assumption).
 await page.locator('#photoFilesV2').setInputFiles([{name:'synthetic.heic',mimeType:'image/heic',buffer:await readFile('scripts/fixtures/photos/synthetic.heic')},{name:'synthetic.heif',mimeType:'image/heif',buffer:await readFile('scripts/fixtures/photos/synthetic.heic')}]);await waitReady();await page.locator('#photoQueueUpload').tap();await waitReady();assert.equal(await page.evaluate(()=>photoQueue.filter(j=>j.status==='uploaded').length),4);
 // Reload during a slow upload retains UUID/path; a late Storage completion is reconciled.
 await page.locator('#photoQueueClear').tap();await waitReady();delay=800;
 await page.locator('#photoFilesV2').setInputFiles(files(4));await waitReady();const resumedIds=await page.evaluate(()=>photoQueue.map(j=>j.id));resumedIds.forEach(id=>interruptedIds.add(id));
 await page.locator('#photoQueueUpload').tap();await page.waitForFunction(()=>photoQueue.some(j=>j.status==='uploading'));
 await init();assert.deepEqual(await page.evaluate(()=>photoQueue.map(j=>j.id)),resumedIds);
 await page.locator('#photoQueueRetry').tap();await waitReady();if(await page.evaluate(()=>photoQueue.some(j=>j.status==='pending'))){await page.locator('#photoQueueUpload').tap();await waitReady()}
 assert.equal(await page.evaluate(()=>photoQueue.filter(j=>j.status==='uploaded').length),4);delay=0;
 // Offline failure is individual, then a real touch retry resumes from durable bytes.
 await page.locator('#photoQueueClear').tap();await waitReady();await page.locator('#photoFilesV2').setInputFiles([{name:'offline.jpg',mimeType:'image/jpeg',buffer:jpeg}]);await waitReady();
 interruptedIds.add(await page.evaluate(()=>photoQueue[0].id));forcedOffline=true;await ctx.setOffline(true);await page.locator('#photoQueueUpload').tap();await waitReady();assert.equal(await page.evaluate(()=>photoQueue[0].status),'error');
 await ctx.setOffline(false);forcedOffline=false;await page.locator('[data-photo-retry]').tap();await waitReady();assert.equal(await page.evaluate(()=>photoQueue[0].status),'uploaded');
 // Large original preserved byte-for-byte; oversize file remains an explicit local error.
 await page.locator('#photoQueueClear').tap();await waitReady();const large=Buffer.concat([jpeg,Buffer.alloc(16*1024*1024)]);
 await page.locator('#photoFilesV2').setInputFiles([{name:'large.jpg',mimeType:'image/jpeg',buffer:large},{name:'too-large.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(33*1024*1024)}]);await waitReady();
 assert.equal(await page.evaluate(()=>photoQueue.find(j=>j.file.name==='too-large.jpg').invalid),true);assert.match(await page.locator('#photoQueueList').textContent(),/32 MB/);
 await page.locator('#photoQueueUpload').tap();await waitReady();assert.equal(await page.evaluate(()=>photoQueue.filter(j=>j.status==='uploaded').length),1);assert.ok([...objects.values()].some(bytes=>bytes.equals(large)));
 // Web Locks exclusion is real, not a mocked boolean guard.
 await page.evaluate(async()=>{const store=await photoStore();let release,entered;const started=new Promise(r=>entered=r);const first=store.exclusive(photoScope(),async()=>{entered();await new Promise(r=>release=r)});await started;let denied=false;try{await store.exclusive(photoScope(),()=>{throw Error('must not enter')})}catch(e){denied=/altra finestra/.test(e.message)}release();await first;if(!denied)throw Error('Missing exclusive worker')});
 await mkdir('artifacts/photos-upload',{recursive:true});await page.screenshot({path:`artifacts/photos-upload/${engine}-queue.png`,fullPage:false});
 assert.equal(objects.size,docs.size);assert.deepEqual(errors,[]);console.log(`PASS ${engine} retries/scope isolation/persistent originals; objects=${objects.size}, documents=${docs.size}, finalizations=${finalizes}`);
 await ctx.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}

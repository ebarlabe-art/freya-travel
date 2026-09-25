import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.split('// PHOTO_V2_START')[1].split('// PHOTO_V2_END')[0].replace(/^ —[^\n]*\n/,'');
function harness(){
 const nodes=new Map();const element=id=>{if(!nodes.has(id)){const children=new Map();nodes.set(id,{innerHTML:'',textContent:'',value:'',classList:{add(){},toggle(){}},querySelectorAll:()=>[],querySelector:selector=>{if(!children.has(selector))children.set(selector,{});return children.get(selector)}})}return nodes.get(id)};
 let n=0;const s=vm.createContext({console,setTimeout,clearTimeout,URL:{createObjectURL:()=>`blob:${++n}`,revokeObjectURL:()=>{}},crypto:{randomUUID:()=>`id-${++n}`},$:element,trip:{id:'a'},session:{user:{id:'u'}},tripLoadGeneration:1,isLondonTrip:()=>false,activityRows:[],manualItineraryRows:[],photoRows:[],esc:v=>String(v??''),setAppView:view=>s.view=view});
 s.tripRequestIsCurrent=(id,generation)=>s.trip?.id===id&&s.tripLoadGeneration===generation;
 s.DOC_BUCKET='trip-documents';
 vm.runInContext(code,s);const renderQueue=s.renderPhotoQueue;s.renderPhotoQueue=()=>{};
 return {s,nodes,element,renderQueue,get:expression=>vm.runInContext(expression,s)};
}
const job=()=>({id:'photo-id',path:'a/photos/u/photo-id.jpg',status:'pending',uploaded:false,context:{},file:{name:'a.jpg'},error:''});
const success={data:{metadata:{document_id:'photo-id',updated_at:'version'}}};
test('hanging network operation becomes retryable error; late completion cannot update queue',async()=>{
 const {s}=harness();let complete;const request=new Promise(resolve=>complete=resolve);
 await assert.rejects(s.photoRequestWithTimeout(request,5),/connexió/);complete(success);
});
test('independent errors, stable retry path and no second object after finalize error',async()=>{
 const {s}=harness();let fail=true;const paths=[],j=job(),other=job();other.id='other';
 const io={changed(){},upload:async j=>{paths.push(j.path);return {}},finalize:async()=>fail?{error:{message:'lost response'}}:success};
 await s.executePhotoJob(j,io,()=>true);assert.equal(j.status,'error');assert.equal(j.uploaded,true);
 fail=false;await s.executePhotoJob(other,io,()=>true);assert.equal(other.status,'uploaded');
 await s.executePhotoJob(j,io,()=>true);assert.equal(j.status,'uploaded');assert.equal(paths.length,2);assert.equal(j.path,'a/photos/u/photo-id.jpg');
});
test('lost storage response retries identical path and accepts only duplicate, not arbitrary failures',async()=>{
 const {s}=harness();let attempt=0,finalized=0;const j=job(),paths=[];
 const io={changed(){},upload:async j=>{paths.push(j.path);return ++attempt===1?{error:{message:'network lost'}}:{error:{statusCode:'409',message:'exists'}}},finalize:async()=>{finalized++;return success}};
 await s.executePhotoJob(j,io,()=>true);assert.equal(j.status,'error');assert.equal(finalized,0);
 await s.executePhotoJob(j,io,()=>true);assert.equal(j.status,'uploaded');assert.deepEqual(paths,[j.path,j.path]);assert.equal(finalized,1);
});
test('storage throw is one-photo error, not a rejected batch',async()=>{
 const {s}=harness(),j=job();await s.executePhotoJob(j,{changed(){},upload:async()=>{throw Error('offline')},finalize:()=>assert.fail()},()=>true);assert.equal(j.status,'error');assert.match(j.error,/offline/);
});
test('switch during storage prevents finalize and late UI messages',async()=>{
 const {s}=harness(),j=job();let current=true,changes=0;
 await s.executePhotoJob(j,{changed(){changes++},upload:async()=>{current=false;return {}},finalize:()=>assert.fail('must not finalize')},()=>current);
 assert.equal(changes,1);assert.equal(j.uploaded,false);
});
test('switch during finalize does not render or mutate new session state',async()=>{
 const {s}=harness(),j=job();j.uploaded=true;let current=true,changes=0;
 await s.executePhotoJob(j,{changed(){changes++},finalize:async()=>{current=false;return success}},()=>current);
 assert.equal(changes,1);assert.equal(j.status,'uploading');assert.equal(j.metadata,undefined);
});
test('user, trip, generation, London are independent isolation guards',()=>{
 const {s}=harness(),scope=s.photoScope();assert.equal(s.photoScopeCurrent(scope),true);
 s.session.user.id='b';assert.equal(s.photoScopeCurrent(scope),false);s.session.user.id='u';
 s.trip.id='b';assert.equal(s.photoScopeCurrent(scope),false);s.trip.id='a';
 s.tripLoadGeneration++;assert.equal(s.photoScopeCurrent(scope),false);s.tripLoadGeneration=1;
 s.isLondonTrip=()=>true;assert.equal(s.photoScopeCurrent(scope),false);
});
test('selection: limit20, stable batch/index, repeated selection ignored, invalid isolated, no inferred context',()=>{
 const {s,get}=harness(),file=(i,type='image/jpeg')=>({name:`${i}.jpg`,size:10,lastModified:i,type});
 s.selectPhotoFiles([file(1),file(2,'image/heic')]);assert.equal(get('photoQueue.length'),2);assert.equal(get('photoQueue[0].status'),'pending');assert.equal(get('photoQueue[1].status'),'error');assert.equal(get('photoQueue[0].context.local_date'),null);
 s.selectPhotoFiles([file(1),file(3)]);assert.equal(get('photoQueue.length'),3);assert.equal(get('photoQueue[2].index'),2);assert.equal(get('photoQueue[0].batchId===photoQueue[2].batchId'),true);
 s.selectPhotoFiles(Array.from({length:18},(_,i)=>file(i+4)));assert.equal(get('photoQueue.length'),3);
 s.selectPhotoFiles(Array.from({length:17},(_,i)=>file(i+4)));assert.equal(get('photoQueue.length'),20);
});
test('context preselection remains editable, independent per photo, reset clears all',()=>{
 const {s,get}=harness();vm.runInContext("photoBatchContext={local_date:'2026-09-22',activity_id:'source',itinerary_item_id:null}",s);
 s.selectPhotoFiles([{name:'one',type:'image/png',size:1}]);vm.runInContext("photoBatchContext.activity_id='other'",s);assert.equal(get('photoQueue[0].context.activity_id'),'source');
 s.resetPhotoV2();assert.equal(get('photoQueue.length'),0);assert.equal(get('photoContextDraft'),null);assert.equal(get('photoBatchContext.activity_id'),null);
});
const selectedFile={name:'test.jpg',type:'image/jpeg',size:10,lastModified:1};
function changeBatch(h,date,source){
 const box=h.element('photoBatchContext');box.querySelector('[data-photo-date]').onchange({target:{value:date}});box.querySelector('[data-photo-source]').onchange({target:{value:source}});
}
test('files selected before context: visible explicit action applies it and redraws individual fields',()=>{
 const h=harness();h.s.renderPhotoQueue=h.renderQueue;h.s.selectPhotoFiles([selectedFile]);
 changeBatch(h,'2026-09-13','activity:one');assert.equal(h.get('photoQueue[0].context.local_date'),null);
 assert.match(h.element('photoBatchActions').innerHTML,/Aplicar a totes les fotos pendents/);
 h.element('photoBatchActions').querySelector('[data-apply-photo-context]').onclick();
 assert.equal(h.get('photoQueue[0].context.local_date'),'2026-09-13');assert.equal(h.get('photoQueue[0].context.activity_id'),'one');
 assert.match(h.element('photoQueueList').innerHTML,/value="2026-09-13"/);assert.match(h.element('photoQueueList').innerHTML,/value="activity:one" selected/);
 assert.match(h.element('photoQueueMessage').textContent,/1 fotos pendents/);
});
test('context chosen before files is copied, including planning, without automatic later changes',()=>{
 const h=harness();h.s.renderPhotoQueue=h.renderQueue;h.renderQueue();changeBatch(h,'2026-09-14','manual:plan');h.s.selectPhotoFiles([selectedFile]);
 assert.equal(h.get('photoQueue[0].context.itinerary_item_id'),'plan');assert.equal(h.get('photoQueue[0].context.activity_id'),null);
 changeBatch(h,'2026-09-15','');assert.equal(h.get('photoQueue[0].context.local_date'),'2026-09-14');
});
test('individual selector marks customization; batch action preserves it and reports skipped photos',()=>{
 const h=harness();h.s.selectPhotoFiles([selectedFile,{...selectedFile,name:'two.jpg'}]);
 const card=h.element('individual');card.dataset={photoJob:h.get('photoQueue[0].id')};h.element('photoQueueList').querySelectorAll=selector=>selector==='[data-photo-job]'?[card]:[];h.s.renderPhotoQueue=h.renderQueue;h.renderQueue();
 card.querySelector('[data-photo-source]').onchange({target:{value:'manual:personal'}});
 assert.equal(h.get('photoQueue[0].contextCustomized'),true);assert.match(card.querySelector('[data-photo-personalized]').textContent,/personalitzat/);
 changeBatch(h,'2026-09-13','activity:batch');h.s.applyPhotoBatchContext();
 assert.equal(h.get('photoQueue[0].context.itinerary_item_id'),'personal');assert.equal(h.get('photoQueue[0].context.local_date'),null);assert.equal(h.get('photoQueue[1].context.activity_id'),'batch');
 assert.match(h.element('photoQueueList').innerHTML,/value="manual:personal" selected/);assert.match(h.element('photoQueueMessage').textContent,/1 fotos amb context personalitzat conservades/);
});
test('batch action cannot touch errors, uploaded photos or in-flight requests; stale button cannot cross trips',()=>{
 const h=harness();h.s.renderPhotoQueue=h.renderQueue;h.s.selectPhotoFiles([selectedFile]);changeBatch(h,'2026-09-13','activity:one');
 const click=h.element('photoBatchActions').querySelector('[data-apply-photo-context]').onclick;h.s.trip.id='b';click();assert.equal(h.get('photoQueue[0].context.activity_id'),null);h.s.trip.id='a';
 for(const status of ['error','uploaded','uploading']){vm.runInContext(`photoQueue[0].status='${status}'`,h.s);h.s.applyPhotoBatchContext();assert.equal(h.get('photoQueue[0].context.activity_id'),null)}
 vm.runInContext("photoQueue[0].status='pending';photoQueueRunning=true",h.s);h.s.applyPhotoBatchContext();assert.equal(h.get('photoQueue[0].context.activity_id'),null);
});
function savedContextHarness(){
 const h=harness();vm.runInContext("let photoRows=[];photoQueue=[{id:'photo',status:'uploaded',file:{name:'photo.jpg'},metadata:{local_date:null},context:{}}]",h.s);
 const box=h.element('saved-context');box.dataset={savedPhotoContext:'photo'};h.element('photoQueueList').querySelectorAll=selector=>selector==='[data-saved-photo-context]'?[box]:[];
 h.s.photoDate=String;h.s.activityRows=[{trip_id:'a',id:'source',title:'Activitat actual'}];h.s.manualItineraryRows=[{trip_id:'a',id:'plan',title:'Planning actual'}];
 const state={title:'photo',row:{document_id:'photo',trip_id:'a',local_date:'2026-09-13',activity_id:'source',itinerary_item_id:null,updated_at:'v1'}};
 h.s.db={from:table=>{const result=Promise.resolve({data:table==='travel_documents'?[{id:'photo',title:state.title,file_path:'path'}]:[{...state.row}]});const q={select:()=>q,eq:()=>q,order:()=>result,then:(...args)=>result.then(...args)};return q},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'signed'}})})}};
 return {...h,state,box};
}
test('successful CAS correction refreshes both queue and gallery from backend, not stale job.metadata',async()=>{
 const h=savedContextHarness();await h.s.loadGenericPhotos();assert.match(h.box.innerHTML,/Activitat actual/);assert.match(h.element('photosList').innerHTML,/Activitat actual/);
 vm.runInContext("photoContextDraft={id:'photo',scope:photoScope(),version:'v1',saving:false,context:{local_date:'2026-09-14',activity_id:null,itinerary_item_id:'plan'}}",h.s);
 h.s.db.rpc=async(name,payload)=>{assert.equal(name,'set_trip_photo_context');assert.equal(payload.p_expected_updated_at,'v1');h.state.row={...h.state.row,local_date:payload.p_local_date,activity_id:null,itinerary_item_id:'plan',updated_at:'v2'};return {data:h.state.row}};
 await h.s.savePhotoContext({preventDefault(){}});assert.equal(h.get('photoContextDraft'),null);
 for(const rendered of [h.box.innerHTML,h.element('photosList').innerHTML]){assert.match(rendered,/14 set · Planning actual/);assert.doesNotMatch(rendered,/Activitat actual/)}
});
test('Realtime refresh updates saved representations but preserves a stale open editor and its CAS baseline',async()=>{
 const h=savedContextHarness();await h.s.loadGenericPhotos();vm.runInContext("photoContextDraft={id:'photo',scope:photoScope(),version:'v1',saving:false,context:{local_date:'2026-09-12',activity_id:'source',itinerary_item_id:null}}",h.s);
 h.state.row={...h.state.row,local_date:'2026-09-16',activity_id:null,itinerary_item_id:'plan',updated_at:'v2'};
 await h.s.loadGenericPhotos(true);assert.match(h.box.innerHTML,/16 set · Planning actual/);assert.match(h.element('photosList').innerHTML,/16 set · Planning actual/);
 assert.equal(h.get('photoContextDraft.version'),'v1');assert.equal(h.get('photoContextDraft.context.local_date'),'2026-09-12');
});
test('ambiguous finalization retry keeps original payload/identity; does not become a context update',async()=>{
 const h=harness(),calls=[];h.s.uploadPhotoV2Object=async()=>({});h.s.loadGenericPhotos=async()=>{};
 h.s.db={rpc:async(name,payload)=>{calls.push({name,...payload});return calls.length===1?{error:{message:'lost response'}}:success}};
 h.s.selectPhotoFiles([selectedFile]);vm.runInContext("photoQueue[0].context.local_date='2026-09-13'",h.s);await h.s.runPhotoQueue();
 assert.equal(h.get('photoQueue[0].status'),'error');assert.equal(h.get('photoQueue[0].finalizationContext.local_date'),'2026-09-13');
 // Even a detached control cannot alter the retry snapshot after an uncertain commit.
 vm.runInContext("photoQueue[0].context.local_date='2026-09-20'",h.s);h.renderQueue();assert.match(h.element('photoQueueList').innerHTML,/<fieldset disabled>/);assert.match(h.element('photoQueueList').innerHTML,/mateix context/);
 await h.s.runPhotoQueue(h.get('photoQueue[0].id'));assert.deepEqual(calls[0],calls[1]);assert.equal(h.get('photoQueue[0].status'),'uploaded');assert.equal(h.get('photoQueue[0].metadata'),undefined);
});
test('explicit FK rejection unlocks correction without changing retry object identity',async()=>{
 const h=harness(),j=job();j.context={activity_id:'deleted'};j.uploaded=true;
 await h.s.executePhotoJob(j,{changed(){},finalize:async()=>({error:{code:'23503',message:'source deleted'}})},()=>true);
 assert.equal(j.finalizationContext,null);j.context={activity_id:'replacement'};
 await h.s.executePhotoJob(j,{changed(){},finalize:async value=>{assert.equal(value.finalizationContext.activity_id,'replacement');return success}},()=>true);assert.equal(j.status,'uploaded');assert.equal(j.path,'a/photos/u/photo-id.jpg');
});
test('backend confirmation of an ambiguous upload promotes it to correction flow, without reupload',async()=>{
 const h=savedContextHarness();vm.runInContext("photoQueue[0].status='error';photoQueue[0].finalizationContext={};photoQueue[0].batchId='batch';photoQueue[0].index=0",h.s);h.state.row.upload_batch_id='batch';h.state.row.selection_index=0;
 h.s.renderPhotoQueue=h.renderQueue;await h.s.loadGenericPhotos();assert.equal(h.get('photoQueue[0].status'),'uploaded');assert.match(h.element('photoQueueList').innerHTML,/Edita context de la foto desada/);assert.doesNotMatch(h.element('photoQueueList').innerHTML,/data-photo-retry/);
});
test('gallery preserves selection order inside batches, newest batches first; legacy rows remain visible',()=>{
 const {s}=harness();const rows=[{id:'first',created_at:'2026-09-22T10:00:00Z'},{id:'last',created_at:'2026-09-22T10:01:00Z'},{id:'old',created_at:'2026-09-21T00:00:00Z'}];
 const metadata=[{document_id:'first',upload_batch_id:'batch',selection_index:0},{document_id:'last',upload_batch_id:'batch',selection_index:1}];
 assert.deepEqual(Array.from(s.orderedGenericPhotos(rows,metadata),row=>row.id),['first','last','old']);assert.equal(rows[0].id,'first');
});
test('late photo/metadata loads cannot paint after user/trip switch',async()=>{
 for(const change of [s=>s.trip.id='b',s=>s.session.user.id='v',s=>s.tripLoadGeneration++]){
  const {s,get}=harness();vm.runInContext('let photoRows=[];',s);let finish;const response=new Promise(resolve=>finish=resolve);let renders=0;
  s.renderGenericPhotos=()=>renders++;s.db={from:()=>{const q={select:()=>q,eq:()=>q,order:()=>response,then:(...args)=>response.then(...args)};return q}};
  const pending=s.loadGenericPhotos();change(s);finish({data:[{id:'old',document_id:'old'}]});await pending;assert.equal(renders,0);assert.equal(get('photoRows.length'),0);assert.equal(get('photoMetadata.length'),0);
 }
});
test('older same-trip loads cannot replace newer metadata/rows',async()=>{
 const {s,get}=harness();vm.runInContext('let photoRows=[];',s);const resolvers=[];let renders=0;
 s.renderGenericPhotos=()=>renders++;s.db={from:()=>{const p=new Promise(resolve=>resolvers.push(resolve));const q={select:()=>q,eq:()=>q,order:()=>p,then:(...args)=>p.then(...args)};return q}};
 const old=s.loadGenericPhotos(),fresh=s.loadGenericPhotos();resolvers[2]({data:[{id:'new'}]});resolvers[3]({data:[{document_id:'new'}]});await fresh;
 resolvers[0]({data:[{id:'old'}]});resolvers[1]({data:[{document_id:'old'}]});await old;assert.equal(get('photoRows[0].id'),'new');assert.equal(get('photoMetadata[0].document_id'),'new');assert.equal(renders,1);
});
test('late signed URLs cannot replace the new trip gallery',async()=>{
 const {s,nodes}=harness();vm.runInContext("let photoRows=[{id:'one',file_path:'a/photo.jpg'}]",s);let finish;
 s.db={storage:{from:()=>({createSignedUrl:()=>new Promise(resolve=>finish=resolve)})}};
 const pending=s.renderGenericPhotos();s.trip.id='b';finish({data:{signedUrl:'old-url'}});await pending;assert.equal(nodes.has('photosList'),false);
});
test('actual batch scheduler continues after one RPC error and retries only that photo',async()=>{
 const {s,get}=harness();s.Image=class{decode(){return Promise.resolve()}removeAttribute(){}};
 const uploads=[];let calls=0;s.db={storage:{from:()=>({upload:async path=>{uploads.push(path);return {}}})},rpc:async()=>++calls===1?{error:{message:'offline'}}:success};s.loadGenericPhotos=async()=>{};
 s.selectPhotoFiles([{name:'one.jpg',size:10,type:'image/jpeg',lastModified:1},{name:'two.jpg',size:10,type:'image/jpeg',lastModified:2}]);
 await s.runPhotoQueue();assert.equal(get('photoQueue[0].status'),'error');assert.equal(get('photoQueue[1].status'),'uploaded');assert.equal(get('photoQueueRunning'),false);
 await s.runPhotoQueue(get('photoQueue[0].id'));assert.equal(get('photoQueue[0].status'),'uploaded');assert.equal(uploads.length,2);assert.equal(calls,3);
});
test('failed metadata load disables context editing instead of inventing a NULL CAS version',async()=>{
 const {s,get}=harness();vm.runInContext('let photoRows=[];',s);s.renderGenericPhotos=()=>{};
 s.db={from:table=>{const p=Promise.resolve(table==='travel_documents'?{data:[{id:'legacy'}]}:{error:{message:'network'}});const q={select:()=>q,eq:()=>q,order:()=>p,then:(...args)=>p.then(...args)};return q}};
 await s.loadGenericPhotos();s.openPhotoContextEditor('legacy');assert.equal(get('photoContextDraft'),null);assert.equal(get('photoMetadataUnavailable'),true);assert.equal(get('photoRows[0].id'),'legacy');
});
test('context correction sends original baseline; conflict preserves current form without silent overwrite',async()=>{
 const {s,get,nodes}=harness();vm.runInContext("photoContextDraft={id:'photo',scope:photoScope(),version:'original',context:{local_date:'2026-09-22',activity_id:'a1',itinerary_item_id:null},saving:false}",s);
 let args;s.db={rpc:async(name,input)=>{assert.equal(name,'set_trip_photo_context');args=input;return {error:{code:'40001'}}}};
 await s.savePhotoContext({preventDefault(){}});assert.equal(args.p_expected_updated_at,'original');assert.equal(get('photoContextDraft.version'),'original');assert.equal(get('photoContextDraft.context.activity_id'),'a1');assert.match(nodes.get('photoContextMessage').textContent,/altre participant/);assert.equal(get('photoContextDraft.saving'),false);
});
test('static JS compiles, HTML IDs unique, entry parity',()=>{
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/src=/.test(match[1])&&!/application\/ld\+json/.test(match[1]))new vm.Script(match[2]);
 const staticHtml=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');const ids=Array.from(staticHtml.matchAll(/\bid="([^"]+)"/g),m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 assert.equal(readFileSync(new URL('../404.html',import.meta.url),'utf8'),html);
});
test('source action offers only activity/manual; explicit click proposes source/day',()=>{
 const {s,get}=harness();assert.equal(s.photoContextAction({sourceType:'flight'}),'');assert.equal(s.photoContextAction({sourceType:'accommodation'}),'');
 const item={key:'activity:one',sourceType:'activity',sourceId:'one',tripId:'a',localDate:'2026-09-22'},button={dataset:{addContextPhotos:item.key}};
 const container={querySelectorAll:selector=>selector==='[data-add-context-photos]'?[button]:[]};s.bindContextPhotoActions(container,[item]);button.onclick();assert.equal(s.view,'photosView');assert.equal(get('photoBatchContext.activity_id'),'one');assert.equal(get('photoBatchContext.local_date'),'2026-09-22');
 s.trip.id='b';s.view=null;button.onclick();assert.equal(s.view,null);
});
test('unsupported formats, empty and huge files have individual clear errors',()=>{
 const {s}=harness();for(const type of ['image/heic','image/heif','video/mp4','image/svg+xml'])assert.match(s.photoFileError({type,size:1}),/Format/);
 assert.match(s.photoFileError({type:'image/jpeg',size:0}),/buit/);assert.match(s.photoFileError({type:'image/png',size:16*1024*1024}),/15 MB/);assert.equal(s.photoFileError({type:'image/webp',size:100}),'');
});
test('no localStorage/automatic context inference; legacy London uploader remains gated',()=>{
 assert.doesNotMatch(code,/localStorage|exif|geolocation|deriveTripHomeState/);
 assert.match(html,/preparePhotoV2\(\);if\(!isLondonTrip\(\)\)return loadGenericPhotos/);
 assert.match(html,/function clearTripScopedState\(\)\{\s*resetPhotoV2\(\)/);
 assert.match(html,/if\(!isLondonTrip\(\)\)return;\s*const tripId=trip.id,generation=tripLoadGeneration,userId=session.user.id;\s*const files=\[\.\.\.\$\('photoFile'\)/);
});

test('compact summary: day/activity, day/planning, manual planning location and no duplicate place',()=>{
 const h=harness();vm.runInContext('photoMetadataUnavailable=false',h.s);
 h.s.activityRows=[{trip_id:'a',id:'activity',title:'Cala Comte',location_name:'Cala Comte'}];
 h.s.manualItineraryRows=[{trip_id:'a',id:'plan',title:'Sopar',location_name:'Can Rafalet'}];
 assert.equal(h.s.photoContextLabel({local_date:'2026-09-13',activity_id:'activity'}),'13 set · Cala Comte');
 assert.equal(h.s.photoContextLabel({local_date:'2026-09-12',itinerary_item_id:'plan'}),'12 set · Sopar · Can Rafalet');
 h.s.manualItineraryRows[0].title='';
 assert.equal(h.s.photoContextLabel({itinerary_item_id:'plan'}),'Font vinculada · Can Rafalet');
});
test('caption-only, context-only, legacy and empty photos keep a compact authoritative summary',()=>{
 const h=harness();vm.runInContext("photoMetadataUnavailable=false;photoMetadata=[{document_id:'day',local_date:'2026-09-13'}]",h.s);
 assert.match(h.s.photoSummaryHtml({id:'day',title:''}),/>13 set</);
 assert.doesNotMatch(h.s.photoSummaryHtml({id:'day',title:''}),/photo-summary-caption/);
 assert.match(h.s.photoSummaryHtml({id:'legacy',title:'Record antic'}),/Sense context.*Record antic/);
 assert.match(h.s.photoSummaryHtml({id:'empty'}),/Sense context/);
 assert.doesNotMatch(h.s.photoSummaryHtml({id:'empty'}),/undefined|null|photo-summary-caption/);
 const long='Última tarda a Eivissa '.repeat(30);
 assert.ok(h.s.photoSummaryHtml({id:'caption',title:long}).includes(long.trim()));
 assert.match(html,/\.photo-summary \.photo-summary-line\{color:#3d294c;/);
 assert.match(html,/\.photo-summary \.photo-summary-line\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
});
test('remote context removal and title changes update queue/gallery, never the open draft',async()=>{
 const h=savedContextHarness();await h.s.loadGenericPhotos();
 vm.runInContext("photoContextDraft={id:'photo',scope:photoScope(),version:'v1',title:'Esborrany',originalTitle:'photo',context:{activity_id:'source'}}",h.s);
 h.state.title='Comentari remot';h.state.row={document_id:'photo',updated_at:'v2'};
 await h.s.loadGenericPhotos(true);
 for(const rendered of [h.box.innerHTML,h.element('photosList').innerHTML]){
  assert.match(rendered,/Sense context/);assert.match(rendered,/Comentari remot/);assert.doesNotMatch(rendered,/Activitat actual/);
 }
 assert.equal(h.get('photoContextDraft.title'),'Esborrany');assert.equal(h.get('photoContextDraft.version'),'v1');
});
test('title save uses existing document field and original-value guard, then reconciles both representations',async()=>{
 const h=savedContextHarness();await h.s.loadGenericPhotos();const from=h.s.db.from;let update,filters=[];
 vm.runInContext("photoContextDraft={id:'photo',scope:photoScope(),version:'v1',title:'Última tarda',originalTitle:'photo',context:{},saving:false,titleSaving:false}",h.s);
 h.s.db.from=table=>{
  const q={update:value=>{update=value;return q},eq:(key,value)=>{filters.push([key,value]);return q},select:()=>q,maybeSingle:async()=>{h.state.title=update.title;return {data:{id:'photo',title:update.title}}}};
  return {...from(table),update:q.update};
 };
 await h.s.savePhotoTitle({preventDefault(){}});
 assert.equal(update.title,'Última tarda');assert.deepEqual(filters,[['trip_id','a'],['id','photo'],['category','Foto'],['title','photo']]);
 for(const rendered of [h.box.innerHTML,h.element('photosList').innerHTML])assert.match(rendered,/Última tarda/);
 assert.equal(h.get('photoContextDraft.version'),'v1');assert.equal(h.get('photoContextDraft.originalTitle'),'Última tarda');
});
test('failed/conflicting title saves never display unconfirmed text and preserve draft',async()=>{
 for(const response of [{error:{message:'offline'}},{data:null}]){
  const h=savedContextHarness();await h.s.loadGenericPhotos();
  vm.runInContext("photoContextDraft={id:'photo',scope:photoScope(),title:'No confirmat',originalTitle:'photo',context:{},saving:false}",h.s);
  const q={update:()=>q,eq:()=>q,select:()=>q,maybeSingle:async()=>response};h.s.db.from=()=>q;
  await h.s.savePhotoTitle({preventDefault(){}});
  assert.doesNotMatch(h.element('photosList').innerHTML,/No confirmat/);assert.equal(h.get('photoContextDraft.title'),'No confirmat');
  assert.ok(h.element('photoTitleMessage').textContent);assert.equal(h.get('photoContextDraft.titleSaving'),false);
 }
});
test('confirmed context paints existing cards before any signed URL refresh finishes',async()=>{
 const h=savedContextHarness();await h.s.loadGenericPhotos();const box={dataset:{photoSummary:'photo'},innerHTML:''};
 h.element('photosList').querySelectorAll=selector=>selector==='[data-photo-summary]'?[box]:[];
 vm.runInContext("photoContextDraft={id:'photo',scope:photoScope(),version:'v1',context:{local_date:null,activity_id:null,itinerary_item_id:null},saving:false}",h.s);
 h.s.db.rpc=async()=>({data:{document_id:'photo',updated_at:'v2'}});
 let finish;h.s.loadGenericPhotos=()=>new Promise(resolve=>finish=resolve);
 const saving=h.s.savePhotoContext({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
 assert.match(box.innerHTML,/Sense context/);assert.match(h.box.innerHTML,/Sense context/);
 finish();await saving;
});

test('context save never closes an unsaved title draft',async()=>{
 const h=savedContextHarness();vm.runInContext("photoContextDraft={id:'photo',scope:photoScope(),title:'Pendent',originalTitle:'photo',context:{},saving:false}",h.s);
 h.s.db.rpc=()=>assert.fail('must save title explicitly first');
 await h.s.savePhotoContext({preventDefault(){}});
 assert.equal(h.get('photoContextDraft.title'),'Pendent');assert.match(h.element('photoContextMessage').textContent,/Desa primer/);
});
test('source rename refreshes existing summaries without resigning images or touching editor',async()=>{
 const h=savedContextHarness();await h.s.loadGenericPhotos();const box={dataset:{photoSummary:'photo'},innerHTML:''};
 h.element('photosList').querySelectorAll=selector=>selector==='[data-photo-summary]'?[box]:[];
 h.s.activityRows[0].title='Nou nom';h.s.db.storage.from=()=>assert.fail('no image refresh needed');
 h.s.refreshPhotoSummaries();
 assert.match(box.innerHTML,/Nou nom/);assert.match(h.box.innerHTML,/Nou nom/);
});

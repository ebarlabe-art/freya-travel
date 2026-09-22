import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.split('// PHOTO_V2_START')[1].split('// PHOTO_V2_END')[0].replace(/^ —[^\n]*\n/,'');
function harness(){
 const nodes=new Map();const element=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',classList:{add(){},toggle(){}},querySelectorAll:()=>[],querySelector:()=>({})});return nodes.get(id)};
 let n=0;const s=vm.createContext({console,setTimeout,clearTimeout,URL:{createObjectURL:()=>`blob:${++n}`,revokeObjectURL:()=>{}},crypto:{randomUUID:()=>`id-${++n}`},$:element,trip:{id:'a'},session:{user:{id:'u'}},tripLoadGeneration:1,isLondonTrip:()=>false,activityRows:[],manualItineraryRows:[],esc:v=>String(v??''),setAppView:view=>s.view=view});
 s.tripRequestIsCurrent=(id,generation)=>s.trip?.id===id&&s.tripLoadGeneration===generation;
 s.DOC_BUCKET='trip-documents';
 vm.runInContext(code,s);s.renderPhotoQueue=()=>{};
 return {s,nodes,get:expression=>vm.runInContext(expression,s)};
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

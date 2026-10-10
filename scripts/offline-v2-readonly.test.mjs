import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as vmModule from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fallback=readFileSync(new URL('../404.html',import.meta.url),'utf8');
const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('Offline V2 retains V1 user-scoped snapshots and parity',()=>{
  assert.match(html,/const OFFLINE_CACHE_VERSION=1;/);
  assert.match(html,/freya-offline-trip-v/);
  assert.match(html,/value\?.userId===userId&&value\?.tripId===tripId/);
  assert.equal(html,fallback);
});

test('Checklist online reads prime the offline cache, and offline reads never invoke Supabase',()=>{
  assert.match(html,/if\(!isLondonTrip\(\)\&\&connectionUnavailable\(\)\)\{/);
  assert.match(html,/Array\.isArray\(cached\?\.checklistItems\)/);
  assert.match(html,/mergeOfflineTripSnapshot\(\{checklistItems:items\}\)/);
  assert.match(html,/el\.disabled=connectionUnavailable\(\)\|\|usingOfflineCache/);
  assert.match(html,/No s’ha desat; podràs afegir la tasca/);
});

test('Parking summary and full details use cached data and block offline saves',()=>{
  assert.match(html,/mergeOfflineTripSnapshot\(\{parkingSummary:data\|\|\{\},parkingRow:data\|\|null\}\)/);
  assert.match(html,/mergeOfflineTripSnapshot\(\{parkingRow\}\)/);
  assert.match(html,/setParkingControlsDisabled\(connectionUnavailable\(\)\|\|usingOfflineParking\)/);
  assert.match(html,/No s’ha desat res; torna-ho a provar/);
  assert.match(html,/No es pot eliminar la foto/);
});


test('Opening a trip online caches full parking details automatically',async()=>{
  const code=html.slice(html.indexOf('async function loadParkingSummary(){'),html.indexOf('async function loadParking(){'));
  const row={parking_name:'Aeroport',floor:'P6',zone:'Zona taronja',spot:'219',notes:'A tocar de la sortida',reservation_code:'ABC'};
  let queried=null,stored=null;const status={textContent:''};
  const ctx=vmModule.createContext({
    trip:{id:'trip-1'},session:{user:{id:'user-1'}},tripLoadGeneration:1,
    isLondonTrip:()=>false,connectionUnavailable:()=>false,readOfflineTripSnapshot:()=>null,
    tripRequestIsCurrent:()=>true,
    db:{from:table=>{assert.equal(table,'travel_parking');return {select:fields=>{queried=fields;return {eq:()=>({maybeSingle:async()=>({data:row,error:null})})}}}}},
    $:id=>id==='genericParkingModuleStatus'?status:null,
    mergeOfflineTripSnapshot:patch=>{stored=patch;return true},
    updateConnectivityBanner:()=>{},offlineSnapshotActive:false,offlineSnapshotSavedAt:null
  });
  vmModule.runInContext(code,ctx);
  await ctx.loadParkingSummary();
  assert.equal(queried,'*','The default trip load must request the complete parking row');
  assert.equal(stored.parkingSummary.spot,'219');
  assert.equal(stored.parkingRow.notes,'A tocar de la sortida');
  assert.equal(stored.parkingRow.reservation_code,'ABC');
  assert.equal(status.textContent,'P6 · Zona taronja · 219');
  assert.match(html,/loadParkingSummary\(\)/);
});

test('Older offline snapshots with only parking summary show the spot within detail view',async()=>{
  const code=html.slice(html.indexOf('async function loadParking(){'),html.indexOf('function parkingPayload('));
  const values={};const messages=[];let networkCalls=0,disabled=false;
  const summary={parking_name:'Aeroport',floor:'P6',zone:'Zona taronja',spot:'219'};
  const ctx=vmModule.createContext({
    trip:{id:'trip-1'},session:{user:{id:'user-1'}},tripLoadGeneration:1,
    parkingLoadsPending:0,parkingRow:null,offlineSnapshotActive:false,offlineSnapshotSavedAt:null,documentRows:[],
    isLondonTrip:()=>false,connectionUnavailable:()=>true,
    readOfflineTripSnapshot:()=>({parkingSummary:summary,savedAt:'2026-10-08T20:00:00Z'}),
    tripRequestIsCurrent:()=>true,
    setParkingControlsDisabled:value=>{disabled=value},
    parkingMessage:message=>messages.push(message),
    parkingValue:(id,value)=>{values[id]=value},
    parkingText:(id,value)=>{values[id]=value},
    parkingSpotLabel:row=>[row.floor,row.zone,row.spot].filter(Boolean).join(' · '),
    updateParkingMap:()=>{},renderParkingPhoto:async()=>{},loadDocuments:async()=>[],updateParkingReservationUi:async()=>{},
    updateConnectivityBanner:()=>{},mergeOfflineTripSnapshot:()=>{},
    $:()=>({classList:{toggle:()=>{}}}),
    db:{from:()=>{networkCalls++;throw Error('Network access not permitted offline')}}
  });
  vmModule.runInContext(code,ctx);
  await ctx.loadParking();
  assert.equal(values.parkingFloor,'P6');
  assert.equal(values.parkingZone,'Zona taronja');
  assert.equal(values.parkingSpot,'219');
  assert.equal(values.parkingReturnSpot,'P6 · Zona taronja · 219');
  assert.equal(disabled,true);
  assert.equal(networkCalls,0);
  assert.match(messages.at(-1),/resum desat/);
});

test('Offline V2 shell includes locally bundled Supabase',()=>{
  assert.match(worker,/\.\/vendor\/supabase\.js/);
  assert.match(html,/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/);
});

test('Service worker removes only Freya-owned cache generations',async()=>{
  const vm=await import('node:vm');
  let onActivate,deleted=[],claimed=false;
  const names=['freya-travel-release-6444-v4','freya-travel-release-6444-v5','freya-travel-release-6444-v7','freya-travel-release-6444-v8','freya-travel-release-6444-v9','another-app-unrelated-cache'];
  const sandbox=vm.createContext({URL,self:{location:new URL('https://example.test/freya-travel/sw.js'),addEventListener(type,fn){if(type==='activate')onActivate=fn},clients:{claim:async()=>{claimed=true}}},caches:{keys:async()=>names,delete:async key=>{deleted.push(key);return true}}});
  vm.runInContext(worker,sandbox);
  let pending;onActivate({waitUntil:p=>pending=p});await pending;
  assert.equal(claimed,true);
  assert.deepEqual(deleted.sort(),['freya-travel-release-6444-v4','freya-travel-release-6444-v5','freya-travel-release-6444-v7','freya-travel-release-6444-v8']);
});

test('Offline V2 logout clears only current account metadata and no-trip fallback is explicit',()=>{
  const vm=requireVm();
  const begin=html.indexOf('function clearOfflineUserData('),end=html.indexOf('function rememberOfflineTrips(',begin);
  assert.ok(begin!==-1&&end>begin);
  const values=new Map([
    ['freya-offline-trips-v1:eva','{}'],
    ['freya-offline-trip-v1:eva:trip-a','{}'],
    ['freya-offline-trip-v1:xesc:trip-b','{}'],
    ['freya-offline-trips-v1:xesc','{}'],
    ['freya-selected-trip-eva','trip-a'],
    ['another-app','keep']
  ]);
  const store={get length(){return values.size},key:index=>[...values.keys()][index]||null,removeItem:key=>values.delete(key)};
  let privateVaultDeletes=0;
  const scope=vm.createContext({localStorage:store,session:{user:{id:'eva'}},OFFLINE_CACHE_VERSION:1,offlineTripsKey:id=>'freya-offline-trips-v1:'+id,offlineDocEpoch:0,offlineReadOnlySession:false,clearOfflineSessionGrant:()=>true,closeDocumentViewer(){},clearOfflineDocumentUserData:async()=>{privateVaultDeletes++}});
  vm.runInContext(html.slice(begin,end),scope);
  assert.equal(scope.clearOfflineUserData(),true);
  assert.equal(privateVaultDeletes,0,'Logout must not delete encrypted document bytes or keys');
  assert.deepEqual([...values.keys()].sort(),['another-app','freya-offline-trip-v1:xesc:trip-b','freya-offline-trips-v1:xesc'].sort());
  assert.match(html,/Sense connexió i sense cap viatge desat en aquest dispositiu/);
  assert.match(html,/clearOfflineUserData\(logoutUserId\)/);
});
function requireVm(){return vmModule}

test('Logout preserves encrypted account vault while denying signed-out reads',()=>{
  const logout=html.slice(html.indexOf("document.querySelectorAll('.logout')"),html.indexOf("let manualTripStops="));
  const cleanup=html.slice(html.indexOf('function clearOfflineUserData('),html.indexOf('// Offline document vault.'));
  const vault=html.slice(html.indexOf('async function offlineDocForget('),html.indexOf('async function offlineDocStatus('));
  assert.match(logout,/clearOfflineUserData\(logoutUserId\)/);
  assert.doesNotMatch(logout,/clearOfflineDocumentUserData\(/);
  assert.doesNotMatch(cleanup,/clearOfflineDocumentUserData\(/);
  assert.match(cleanup,/offlineDocEpoch\+\+/);
  assert.match(cleanup,/closeDocumentViewer\(\)/);
  assert.match(vault,/async function clearOfflineDocumentUserData\(userId\)/,
    'Account-wide vault purge stays available for an explicit delete action');
  assert.match(html,/async function offlineDocGetBlob\(scope,doc\)\{\s*if\(!offlineDocScopeCurrent\(scope\)\)return null/);
  assert.match(html,/row\.userId!==scope\.userId\|\|row\.tripId!==scope\.tripId/);
  assert.match(html,/await offlineDocForget\(scope,id\)/);
  assert.match(html,/const key=await offlineDocKey\(database,scope\.userId\)/);
});

test('Offline V2 keeps user-switch teardown and handles rejected auth initialization',()=>{
  const auth=html.slice(html.indexOf('db.auth.onAuthStateChange('));
  assert.match(auth,/if\(event==='SIGNED_OUT'\)\{/);
  assert.match(auth,/if\(event==='INITIAL_SESSION'&&navigator\.onLine===false\)/);
  assert.match(auth,/if\(restoreOfflineReadOnlySession\(\)\)return/);
  assert.match(auth,/clearOfflineUserData\(session\?\.user\?\.id\|\|lastAuthenticatedUserId\)/);
  assert.match(auth,/if\(passwordRecoveryMode\)\{session=next/);
  assert.match(auth,/renderSession\(next\);/);
  assert.doesNotMatch(auth,/onAuthStateChange\(\(event,next\)=>\{\s*session=next;/);
  assert.match(auth,/\.catch\(\(\)=>\{/);
  assert.match(auth,/renderSession\(null\);msg\('authMsg'/);
});

test('Intermittent network failures must fall back to cached document metadata',async()=>{
  const snippet=html.slice(html.indexOf('async function loadDocuments('),html.indexOf('function renderDocuments('));
  const existing=[{id:'one',title:'Boarding pass'}];
  let restored=0;
  const ctx=vmModule.createContext({
    trip:{id:'t'},documentRows:existing,
    session:{user:{id:'u'}},isLondonTrip:()=>false,connectionUnavailable:()=>false,
    tripLoadGeneration:4,tripRequestIsCurrent:()=>true,
    db:{from:()=>({select:()=>({eq:()=>({neq:()=>({order:()=>Promise.reject(Error('network down'))})})})})},
    clearAccommodationVoucherFocus:()=>{},restoreOfflineDocuments:()=>{restored++;return true},
    msg:()=>{},console
  });
  vmModule.runInContext(snippet,ctx);
  assert.equal(await ctx.loadDocuments(true),existing);
  assert.equal(restored,1);
});
test('Trip stop and car-rental reads fall back on network exceptions without wiping cache',()=>{
  assert.match(html,/mergeOfflineTripSnapshot\(\{tripStopRows:stops\}/);
  assert.match(html,/Array\.isArray\(cached\?\.tripStopRows\)/);
  assert.match(html,/catch\(fetchError\)\{rentals=\{error:fetchError\}/);
});


function offlineAuthScope({online=false,withTrips=true,sessionToken=true}={}){
  const values=new Map();
  const store={
    getItem:key=>values.get(key)||null,
    setItem:(key,value)=>{values.set(key,value)},
    removeItem:key=>values.delete(key)
  };
  const restored=[];
  const mock={
    navigator:{onLine:online},localStorage:store,passwordRecoveryMode:false,
    session:sessionToken?{user:{id:'user-a',email:'tester@example.test'},access_token:'verified-token'}:null,
    readOfflineTrips:userId=>withTrips&&userId==='user-a'?{rows:[{id:'trip-a'}]}:null,
    safeOfflineWrite:(key,val)=>{store.setItem(key,JSON.stringify(val));return true},
    renderSession:next=>{restored.push(next);return Promise.resolve()},
    Date,offlineDocEpoch:0,
    clearOfflineDocumentUserData:async()=>{},closeDocumentViewer:()=>{}
  };
  const context=vmModule.createContext(mock);
  const start=html.indexOf('const OFFLINE_AUTH_GRANT_KEY=');
  const end=html.indexOf('function clearOfflineUserData(',start);
  assert.ok(start>0&&end>start,'Offline grant helpers must be present');
  vmModule.runInContext(html.slice(start,end),context);
  return {context,values,restored,mock};
}

test('Offline grant is issued ONLY after an online authenticated read and is scoped to cached trips',()=>{
  const s=offlineAuthScope({online:true});
  assert.equal(s.context.rememberOfflineSessionGrant('user-a'),true);
  const grant=JSON.parse(s.values.get('freya-offline-session-grant-v1'));
  assert.equal(grant.userId,'user-a');
  assert.equal(s.context.readOfflineSessionGrant().userId,'user-a');
  assert.equal(s.context.rememberOfflineSessionGrant('user-b'),false);
  s.mock.navigator.onLine=false;
  assert.equal(s.context.rememberOfflineSessionGrant('user-a'),false);
  const noTrips=offlineAuthScope({online:true,withTrips:false});
  noTrips.context.rememberOfflineSessionGrant('user-a');
  assert.equal(noTrips.context.readOfflineSessionGrant(),null);
  const noToken=offlineAuthScope({online:true,sessionToken:false});
  assert.equal(noToken.context.rememberOfflineSessionGrant('user-a'),false);
});

test('Cold expired-token recovery permits ONLY local read-only reentry; stale or missing grants fail closed',()=>{
  const s=offlineAuthScope({online:true});
  s.context.rememberOfflineSessionGrant('user-a');
  assert.equal(s.context.restoreOfflineReadOnlySession(),false,'Online cannot use local grant to bypass sign-in');
  s.mock.navigator.onLine=false;s.mock.session=null;
  assert.equal(s.context.restoreOfflineReadOnlySession(),true);
  assert.equal(s.restored.length,1);
  assert.equal(s.restored[0].offlineOnly,true);
  assert.equal(s.restored[0].user.id,'user-a');
  assert.equal(s.restored[0].access_token,undefined);
  assert.equal(s.context.restoreOfflineReadOnlySession(),true);
  const expired=JSON.parse(s.values.get('freya-offline-session-grant-v1'));
  expired.verifiedAt=Date.now()-31*24*60*60*1000;
  s.values.set('freya-offline-session-grant-v1',JSON.stringify(expired));
  assert.equal(s.context.readOfflineSessionGrant(),null);
  const bad=offlineAuthScope({online:false});
  bad.values.set('freya-offline-session-grant-v1',JSON.stringify({version:1,userId:'other',verifiedAt:Date.now()}));
  assert.equal(bad.context.restoreOfflineReadOnlySession(),false);
});

test('Explicit logout revokes the local grant even when offline; no auto reentry',()=>{
  const s=offlineAuthScope({online:true});
  s.context.rememberOfflineSessionGrant('user-a');
  s.mock.navigator.onLine=false;
  assert.equal(s.context.restoreOfflineReadOnlySession(),true);
  assert.equal(s.context.clearOfflineSessionGrant('user-a'),true);
  assert.equal(s.context.readOfflineSessionGrant(),null);
  // Storage release in another tab must also block a read-only session.
  assert.match(html,/event\.key===OFFLINE_AUTH_GRANT_KEY&&!event\.newValue&&offlineReadOnlySession/);
  assert.match(html,/if\(event==='SIGNED_OUT'\)\{\s*if\(restoreOfflineReadOnlySession\(\)\)return/);
  assert.match(html,/clearOfflineSessionGrant\(userId\)/);
  assert.match(html,/if\(offlineReadOnlySession\)\{/);
  assert.match(html,/if\(navigator\.onLine!==false\)void validateOfflineSessionAfterReconnect\(\)/);
});

test('Offline read-only mode blocks write paths until Supabase getUser has validated reconnection',()=>{
  assert.match(html,/function connectionUnavailable\(\)\{return .*offlineReadOnlySession/);
  assert.match(html,/if\(checked\.error\)throw checked\.error/);
  assert.match(html,/checked\.data\?\.user\?\.id!==previousId/);
  assert.match(html,/offlineReadOnlySession=false;\s*await renderSession\(data\.session\)/);
  assert.match(html,/offlineAuthNetworkError\(error\)/);
  assert.match(html,/Per iniciar sessió cal connexió a Internet/);
  assert.match(html,/const networkAbsent=navigator\.onLine===false/);
  assert.match(html,/await db\.auth\.signOut\(\{scope:networkAbsent\?'local':'global'\}\)/);
  assert.match(html,/finally\{\s*offlineReadOnlySession=false;\s*await renderSession\(null\)/);
  assert.match(html,/const OFFLINE_AUTH_GRANT_MAX_AGE_MS=30\*24\*60\*60\*1000/);
});

test('Offline documents require explicit download, encrypted account-scoped IndexedDB and bounded storage',()=>{
  assert.match(html,/const OFFLINE_DOC_DB='freya-offline-private-documents-v1'/);
  assert.match(html,/crypto\.subtle\.generateKey\(\{name:'AES-GCM',length:256\},false/);
  assert.match(html,/crypto\.subtle\.encrypt\(\{name:'AES-GCM',iv\},key,bytes\)/);
  assert.match(html,/crypto\.subtle\.decrypt\(\{name:'AES-GCM',iv:new Uint8Array\(row.iv\)\},key,row.ciphertext\)/);
  assert.match(html,/const OFFLINE_DOC_PER_FILE=12\*1024\*1024/);
  assert.match(html,/const OFFLINE_DOC_ACCOUNT_LIMIT=55\*1024\*1024/);
  assert.match(html,/data-offline-save/);
  assert.match(html,/\.download\(doc.file_path\)/);
  assert.doesNotMatch(html.slice(html.indexOf('async function offlineDocSaveBlob'),html.indexOf('async function offlineDocGetBlob')),/signedUrl|createSignedUrl/);
});
test('Offline documents are not served by the service worker, and blob links are revoked',()=>{
  assert.doesNotMatch(worker,/offline-private-documents|offline-docs\/.*cache/);
  assert.match(html,/URL\.revokeObjectURL\(documentViewerObjectUrl\)/);
  const auth=html.slice(html.indexOf('db.auth.onAuthStateChange('));
  assert.match(auth,/if\(event==='SIGNED_OUT'\)\{/);
  assert.match(auth,/if\(restoreOfflineReadOnlySession\(\)\)return;/);
  assert.match(auth,/restoreOfflineWhenAuthServerUnreachable\(\)\.then\(restored=>/);
  assert.match(auth,/if\(restored\|\|offlineReadOnlySession\)return;/);
  assert.match(auth,/clearOfflineUserData\(session\?\.user\?\.id\|\|lastAuthenticatedUserId\|\|grant\.userId\)/);
  assert.match(html,/if\(!grant\|\|\(session\?\.user\?\.id&&session\.user\.id!==grant\.userId\)\)return false;/);
  assert.match(html,/clearOfflineDocumentUserData\(userId\)/);
  assert.match(html,/offlineDocEpoch\+\+/);
});

test('Concurrent tabs elect one CryptoKey atomically and enforce quotas in IDB transaction',()=>{
  const start=html.indexOf('async function offlineDocKey('),end=html.indexOf('function offlineDocType(',start);
  const source=html.slice(start,end);
  assert.match(source,/store\.get\(userId\)/);
  assert.match(source,/if\(request\.result\)output\(request\.result\)/);
  assert.match(source,/store\.add\(generated,userId\)/);
  const atomic=html.slice(html.indexOf('function offlineDocAtomicSave('),html.indexOf('async function offlineDocSaveBlob('));
  assert.match(atomic,/store\.index\('byUser'\)\.getAll\(scope\.userId\)/);
  assert.match(atomic,/OFFLINE_DOC_ACCOUNT_LIMIT/);
  assert.match(atomic,/OFFLINE_DOC_TRIP_LIMIT/);
  assert.match(atomic,/offlineDocPruneTrip/);
  assert.match(html,/offlineDocPruneTrip\(vaultScope,serverDocs\)/);
  assert.match(html,/id="parkingSavePhotoOffline"/);
  assert.match(html,/offlineDocSaveBlob\(scope,parkingOfflinePhotoDocument\(path\),data\)/);
  assert.match(html,/offlineDocGetBlob\(scope,parkingOfflinePhotoDocument\(path\)\)/);
  assert.match(html,/await renderParkingPhoto\(row\.photo_path,tripId,generation\)/);
  assert.match(html,/value\.documentId!=='freya-parking-photo-v1'/);
});

test('Offline parking loads cached document metadata and restores its reservation action',async()=>{
  const snippet=html.slice(html.indexOf('async function loadParking(){'),html.indexOf('function parkingPayload('));
  const doc={id:'res-1',title:'Reserva aparcament',file_path:'t/reserva.pdf',mime_type:'application/pdf'};
  let metadataLoads=0,renderCalls=0,remoteCalls=0;
  const $=()=>({classList:{toggle(){}},textContent:'',disabled:false});
  const ctx=vmModule.createContext({
    trip:{id:'t'},session:{user:{id:'u'}},tripLoadGeneration:1,parkingLoadsPending:0,
    parkingRow:null,documentRows:[],offlineSnapshotActive:false,offlineSnapshotSavedAt:null,
    isLondonTrip:()=>false,connectionUnavailable:()=>true,
    readOfflineTripSnapshot:()=>({parkingRow:{parking_name:'Aeroport'}}),
    tripRequestIsCurrent:()=>true,setParkingControlsDisabled:()=>{},parkingMessage:()=>{},
    parkingValue:()=>{},parkingText:()=>{},parkingSpotLabel:()=>'',updateParkingMap:()=>{},
    renderParkingPhoto:async()=>{},updateConnectivityBanner:()=>{},$,
    loadDocuments:async()=>{metadataLoads++;ctx.documentRows=[doc];return [doc]},
    updateParkingReservationUi:async()=>{renderCalls++;assert.equal(ctx.documentRows[0]?.id,'res-1')},
    db:{from:()=>{remoteCalls++;throw Error('unexpected network')}} 
  });
  vmModule.runInContext(snippet,ctx);
  await ctx.loadParking();
  assert.equal(metadataLoads,1);assert.equal(renderCalls,1);assert.equal(remoteCalls,0);
});

test('Encrypted parking reservation preview opens offline without a second download, and is cleared',async()=>{
  const helper=html.slice(html.indexOf('function clearParkingReservationPreview(){'),html.indexOf('function parkingOfflinePhotoDocument('));
  const fn=html.slice(html.indexOf('async function updateParkingReservationUi('),html.indexOf("$('parkingOpenDocuments').onclick=",html.indexOf('async function updateParkingReservationUi(')));
  const doc={id:'res-1',title:'Reserva aparcament',file_path:'t/reserva.png',mime_type:'image/png'};
  const elems=new Map(),flags=new Map();
  function $(id){
    if(!elems.has(id)){
      const present=new Set();flags.set(id,present);
      elems.set(id,{src:'',textContent:'',onclick:null,
        classList:{add:v=>present.add(v),remove:v=>present.delete(v)},
        removeAttribute(name){if(name==='src')this.src=''}
      });
    }
    return elems.get(id);
  }
  let downloads=0,opens=0;const revoked=[];
  const ctx=vmModule.createContext({
    parkingReservationObjectUrl:null,parkingReservationRenderSequence:0,documentRows:[doc],
    $,findParkingReservationDocument:()=>doc,parkingText:(id,v)=>{$(id).textContent=v},
    connectionUnavailable:()=>true,offlineDocScope:()=>({userId:'u',tripId:'t'}),
    offlineDocScopeCurrent:()=>true,tripRequestIsCurrent:()=>true,
    offlineDocGetBlob:async()=>({blob:{},mime:'image/png'}),
    openDocument:()=>{opens++},URL:{createObjectURL:()=> 'blob:local-private',revokeObjectURL:v=>revoked.push(v)},
    db:{storage:{from:()=>{downloads++;throw Error('unexpected network')}}},DOC_BUCKET:'documents'
  });
  vmModule.runInContext(helper+fn,ctx);
  await ctx.updateParkingReservationUi('t',1,true);
  assert.equal($('parkingReservationImage').src,'blob:local-private');
  assert.equal(flags.get('parkingReservationPreview').has('visible'),true);
  assert.equal(flags.get('parkingViewReservation').has('hidden'),false);
  $('parkingViewReservation').onclick();
  assert.equal(opens,1);assert.equal(downloads,0);
  ctx.clearParkingReservationPreview();
  assert.deepEqual(revoked,['blob:local-private']);
  assert.equal($('parkingReservationImage').src,'');
  assert.match(html,/if\(nextUserId!==session\?\.user\?\.id\)\{resetBuilderUi\(\);clearParkingReservationPreview\(\)\}/);
});

test('Cold offline without a prior valid grant must show login even if Supabase auth never resolves',async()=>{
  const begin=html.lastIndexOf('if(navigator.onLine===false&&!passwordRecoveryMode){');
  const end=html.indexOf('db.auth.getSession().then(',begin);
  assert.ok(begin>0&&end>begin);
  const piece=html.slice(begin,end),calls=[];
  const context=vmModule.createContext({
    navigator:{onLine:false},passwordRecoveryMode:false,authInitializationResolved:false,
    restoreOfflineReadOnlySession:()=>false,
    renderSession:async(value)=>{calls.push(['renderSession',value])},
    msg:(id,message,isError)=>calls.push(['msg',id,message,isError])
  });
  vmModule.runInContext(piece,context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(context.authInitializationResolved,true);
  assert.equal(calls[0][0],'renderSession');
  assert.equal(calls[0][1],null,'Fail closed: do not synthesize a session');
  assert.match(calls.find(x=>x[0]==='msg')[2],/No hi ha una sessió offline autoritzada/);
});
test('Valid offline grant still opens cached data without showing login',()=>{
  const begin=html.lastIndexOf('if(navigator.onLine===false&&!passwordRecoveryMode){');
  const end=html.indexOf('db.auth.getSession().then(',begin);
  const calls=[];
  const context=vmModule.createContext({
    navigator:{onLine:false},passwordRecoveryMode:false,authInitializationResolved:false,
    restoreOfflineReadOnlySession:()=>{calls.push('grant');return true},
    renderSession:()=>{calls.push('login');return Promise.resolve()},
    msg:()=>calls.push('error')
  });
  vmModule.runInContext(html.slice(begin,end),context);
  assert.equal(context.authInitializationResolved,true);
  assert.deepEqual(calls,['grant']);
});
test('An SDK/bootstrap failure cannot keep an infinite splash on the iPhone',()=>{
  const sdkIndex=html.indexOf('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>');
  const fallbackIndex=html.indexOf('Standalone-safe bootstrap diagnostic');
  assert.ok(fallbackIndex>0&&fallbackIndex<sdkIndex);
  assert.match(html.slice(fallbackIndex,sdkIndex),/setTimeout\(/);
  assert.match(html.slice(fallbackIndex,sdkIndex),/No cal esborrar l’app ni les còpies offline/);
  assert.match(worker,/const CACHE='freya-travel-release-6444-v9'/);
});

test('Parking offline leaves read-only Veure reserva enabled while disabling edits',()=>{
  const source=html.slice(html.indexOf('function setParkingControlsDisabled('),html.indexOf('function parkingSpotLabel('));
  assert.match(source,/#parkingForm button:not\(#parkingViewReservation\)/);
  const selectors=[];
  const edits=[{id:'parkingName',disabled:false},{id:'parkingSave',disabled:false}];
  const preview={id:'parkingViewReservation',disabled:false};
  const ctx=vmModule.createContext({
    document:{querySelectorAll(selector){
      selectors.push(selector);
      return selector.includes(':not(#parkingViewReservation)')?edits:[...edits,preview];
    }}
  });
  vmModule.runInContext(source,ctx);
  ctx.setParkingControlsDisabled(true);
  assert.ok(edits.every(e=>e.disabled));
  assert.equal(preview.disabled,false,'The offline reservation viewer is never a write action');
  ctx.setParkingControlsDisabled(false);
  assert.ok(edits.every(e=>!e.disabled));
  assert.equal(selectors.length,2);
  assert.match(html,/button\.classList\.remove\('hidden'\);button\.disabled=false;\s*button\.onclick=\(\)=>openDocument\(doc\.id,documentRows,'parkingMsg'\)/);
  assert.match(worker,/const CACHE='freya-travel-release-6444-v9'/);
});

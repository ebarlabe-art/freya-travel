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
  assert.match(html,/mergeOfflineTripSnapshot\(\{parkingSummary:data\|\|\{\}\}\)/);
  assert.match(html,/mergeOfflineTripSnapshot\(\{parkingRow\}\)/);
  assert.match(html,/setParkingControlsDisabled\(connectionUnavailable\(\)\|\|usingOfflineParking\)/);
  assert.match(html,/No s’ha desat res; torna-ho a provar/);
  assert.match(html,/No es pot eliminar la foto/);
});

test('Offline V2 shell includes locally bundled Supabase',()=>{
  assert.match(worker,/\.\/vendor\/supabase\.js/);
  assert.match(html,/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/);
});

test('Service worker removes only Freya-owned cache generations',async()=>{
  const vm=await import('node:vm');
  let onActivate,deleted=[],claimed=false;
  const names=['freya-travel-release-6444-v4','freya-travel-release-6444-v5','freya-travel-release-6444-v7','another-app-unrelated-cache'];
  const sandbox=vm.createContext({URL,self:{location:new URL('https://example.test/freya-travel/sw.js'),addEventListener(type,fn){if(type==='activate')onActivate=fn},clients:{claim:async()=>{claimed=true}}},caches:{keys:async()=>names,delete:async key=>{deleted.push(key);return true}}});
  vm.runInContext(worker,sandbox);
  let pending;onActivate({waitUntil:p=>pending=p});await pending;
  assert.equal(claimed,true);
  assert.deepEqual(deleted.sort(),['freya-travel-release-6444-v4','freya-travel-release-6444-v5']);
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
  const scope=vm.createContext({localStorage:store,session:{user:{id:'eva'}},OFFLINE_CACHE_VERSION:1,offlineTripsKey:id=>'freya-offline-trips-v1:'+id});
  vm.runInContext(html.slice(begin,end),scope);
  assert.equal(scope.clearOfflineUserData(),true);
  assert.deepEqual([...values.keys()].sort(),['another-app','freya-offline-trip-v1:xesc:trip-b','freya-offline-trips-v1:xesc'].sort());
  assert.match(html,/Sense connexió i sense cap viatge desat en aquest dispositiu/);
  assert.match(html,/clearOfflineUserData\(session\?\.user\?\.id\)/);
});
function requireVm(){return vmModule}

test('Offline V2 keeps user-switch teardown and handles rejected auth initialization',()=>{
  const auth=html.slice(html.indexOf('db.auth.onAuthStateChange('));
  assert.match(auth,/if\(event==='SIGNED_OUT'\)clearOfflineUserData/);
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

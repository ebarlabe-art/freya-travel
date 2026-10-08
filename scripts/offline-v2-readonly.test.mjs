import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

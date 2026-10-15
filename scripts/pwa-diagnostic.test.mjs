import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fallback=readFileSync(new URL('../404.html',import.meta.url),'utf8');
const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('PWA diagnostic is read only, scoped and has an explicit version marker',()=>{
  assert.equal(html,fallback,'404.html must match index.html');
  assert.match(html,/const FREYA_FRONTEND_RELEASE='pwa-smart-places-v26'/);
  assert.match(html,/id="pwaDiagnostic"/);
  assert.match(html,/id="pwaDiagnosticSummary"/);
  assert.match(html,/id="pwaDiagnosticRefresh"/);
  const diagnostic=html.slice(html.indexOf('async function refreshPwaDiagnostics('),html.indexOf('function renderItinerarySourceStatus('));
  assert.match(diagnostic,/row\.trip_id===trip\?\.id/);
  assert.match(diagnostic,/sourceType==='manual'/);
  assert.match(diagnostic,/navigator\.serviceWorker\.getRegistration/);
  assert.match(diagnostic,/registration\.update\(\)/);
  assert.match(diagnostic,/cache:'no-store'/);
  assert.doesNotMatch(diagnostic,/localStorage\.(removeItem|clear)|caches\.delete|indexedDB\.deleteDatabase/);
  assert.doesNotMatch(diagnostic,/access_token|refresh_token|session\.user\.email|\.invite_code/);
});
test('The new SW cache version is unique and the existing network-first navigation remains',()=>{
  assert.match(worker,/const CACHE='freya-travel-release-6444-v26'/);
  assert.match(worker,/if\(isNavigation \|\| isIndexRequest\)/);
  assert.match(worker,/fetch\(request\)\.then\(response/);
  assert.match(worker,/keys\(\)\.then\(keys=>Promise\.all\(keys\.filter/);
});

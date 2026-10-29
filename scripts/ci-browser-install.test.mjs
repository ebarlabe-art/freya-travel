import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('./ci-browser-install.sh',import.meta.url).pathname;
for(const stage of ['tooling','dependencies','browser'])test(`browser installer propagates ${stage} failures/timeouts and diagnoses them`,()=>{
 const dir=mkdtempSync(join(tmpdir(),'freya-browser-ci-'));
 try{
  const calls=join(dir,'calls');
  const stub=(name,body)=>writeFileSync(join(dir,name),'#!/bin/bash\n'+body,{mode:0o755});
  stub('node','echo node "$@" >> "$CALLS"\nexit 0\n');stub('npm','echo npm "$@" >> "$CALLS"\nexit 0\n');stub('sudo','cat >/dev/null\nexit 0\n');
  stub('timeout','echo timeout "$@" >> "$CALLS"\nexit "${INSTALL_EXIT:-0}"\n');
  for(const code of [0,1,124]){
   const run=spawnSync('bash',[script,stage,'webkit'],{env:{...process.env,NODE_TEST_CONTEXT:'',PATH:dir+':'+process.env.PATH,RUNNER_TEMP:dir,CALLS:calls,INSTALL_EXIT:String(code)},encoding:'utf8',timeout:10000});
   assert.equal(run.status,code,run.stderr);const log=readFileSync(join(dir,'browser-install-logs',`webkit-${stage}.log`),'utf8');
   assert.match(log,new RegExp(`exit ${code}`));if(code)assert.match(log,/::error::Browser installation failed/);
  }
  const callText=readFileSync(calls,'utf8');assert.match(callText,/timeout --signal=TERM --kill-after=/);assert.ok(!callText.includes('--with-deps'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('workflow retains every existing browser invocation on an independent required engine',()=>{
 const current=readFileSync(new URL('../.github/workflows/pr-checks.yml',import.meta.url),'utf8');
 const expected=["ACTIVITIES_ENGINE=webkit PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-activities-projection-browser.mjs", "ACTIVITIES_TABLET=1 PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-activities-projection-browser.mjs", "CULTURE_ENGINE=webkit PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-cultural-guide-browser.mjs", "CULTURE_TABLET=1 PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-cultural-guide-browser.mjs", "IMPORT_ENGINE=chromium PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-import-exclude-browser.mjs", "IMPORT_ENGINE=webkit PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-import-exclude-browser.mjs", "ITINERARY_TABLET=1 PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-itinerary-loading-browser.mjs", "PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-activities-projection-browser.mjs", "PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-automatic-places-browser.mjs", "PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-cultural-guide-browser.mjs", "PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-itinerary-loading-browser.mjs", "PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-itinerary-points-browser.mjs", "PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-itinerary-route-browser.mjs", "PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-pwa-bootstrap-browser.mjs", "PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-shared-trip-browser.mjs", "PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-travel-book-runtime-browser.mjs", "PWA_ENGINE=webkit PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-pwa-bootstrap-browser.mjs", "ROUTE_ENGINE=webkit PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-automatic-places-browser.mjs", "ROUTE_ENGINE=webkit PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-itinerary-points-browser.mjs", "ROUTE_ENGINE=webkit PLAYWRIGHT_MODULE=\"$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs\" node scripts/check-itinerary-route-browser.mjs"];
 const commands=text=>[...text.matchAll(/^        run: (.*node scripts\/check-.*browser\.mjs)$/gm)].map(m=>m[1]).sort();
 expected.push('RECONCILE_ENGINE=${{ matrix.engine }} PLAYWRIGHT_MODULE="$RUNNER_TEMP/travel-book-browser/node_modules/playwright-core/index.mjs" node scripts/check-itinerary-reconciliation-browser.mjs');
 assert.deepEqual(commands(current),expected.sort());
 const browser=current.split('  browser-tests:')[1].split('  legacy-suite:')[0];
 assert.match(browser,/fail-fast: false/);assert.match(browser,/engine: \[chromium, webkit\]/);assert.doesNotMatch(browser,/continue-on-error:|needs:/);
 assert.match(browser,/if: always\(\)/);assert.match(browser,/actions\/upload-artifact@v4/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const first=html.slice(html.indexOf('<script>\n// Safe bootstrap watchdog'),html.indexOf('</script>',html.indexOf('// Safe bootstrap watchdog')));

test('Bootstrap starts before the SDK, classifies failures and never clears local data',()=>{
 assert.ok(first.includes('window.__freyaBoot={stage:'));
 assert.ok(html.indexOf('window.__freyaBoot={stage:')<html.indexOf('@supabase/supabase-js@2'));
 assert.match(html,/window\.__freyaBootStage\?\.\('main'\)/);
 assert.match(html,/window\.__freyaBootStage\?\.\('auth'\)/);
 assert.match(html,/window\.__freyaBootStage\?\.\('session'\)/);
 assert.match(first,/id='freyaBootstrapRetry'/);
 assert.doesNotMatch(first,/localStorage\.(removeItem|clear)|indexedDB\.deleteDatabase|caches\.delete|auth\.signOut/);
 assert.match(worker,/freya-travel-release-6444-v21/);
});

test('Watchdog classifies missing SDK and offers a user-triggered retry with no destructive side effects',()=>{
 const elements=[];
 const splash={classList:{contains:()=>false},replaceChildren(...items){elements.push(...items)}};
 const ctx={
  window:{matchMedia:()=>({matches:true}),supabase:null,addEventListener:()=>{},setTimeout:null},
  navigator:{standalone:true,onLine:true},
  document:{getElementById:()=>splash,createElement:tag=>({tag,style:{},textContent:'',onclick:null})},
  location:{reload:()=>{ctx.reloads++}},reloads:0
 };
 ctx.window.setTimeout=(callback)=>{ctx.tick=callback};
 vm.runInNewContext(first.replace(/^<script>\n|<\/script>$/g,''),ctx);
 ctx.tick();
 const message=elements.map(e=>e.textContent).join(' ');
 assert.match(message,/Diagnòstic: SDK/);
 assert.match(message,/App instal·lada/);
 assert.match(message,/No s’han esborrat/);
 assert.equal(elements.at(-1).id,'freyaBootstrapRetry');
 assert.equal(ctx.reloads,0);
 elements.at(-1).onclick();
 assert.equal(ctx.reloads,1);
});

import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),worker=await readFile(new URL('../sw.js',import.meta.url),'utf8');
function shell(fetch,source=worker){
 const handlers={},cached={status:200,body:'known shell'},puts=[];
 let abort;
 const c=vm.createContext({URL,AbortController,fetch,setTimeout:fn=>{abort=fn;return 1},clearTimeout(){},
  self:{location:new URL('https://test/freya-travel/sw.js'),addEventListener:(n,h)=>handlers[n]=h},
  caches:{open:async()=>({match:async()=>cached,put:async(...args)=>puts.push(args)})}});
 vm.runInContext(source,c);return {c,handlers,cached,puts,abort:()=>abort()};
}
test('shell/SDK HTTP errors return known cached response, never cache a 503',async()=>{
 const h=shell(async()=>({ok:false,status:503}));
 assert.equal(await h.c.shellResponse('request','key'),h.cached);assert.equal(h.puts.length,0);
});
test('stalled shell request is aborted and recovers cache within the bounded deadline',async()=>{
 const h=shell((_r,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));
 const pending=h.c.shellResponse('request','key');h.abort();assert.equal(await pending,h.cached);
});
test('worker does not intercept sibling app resources',()=>{
 const h=shell(()=>{throw Error('unexpected fetch')});let captured=false;
 h.handlers.fetch({request:{method:'GET',url:'https://test/another-app/app.js',destination:'script'},respondWith:()=>{captured=true}});assert.equal(captured,false);
});
function bootstrap(){
 const listeners={},timers=[],children=[];let redirected;
 const splash={classList:{remove(){},add(){}},replaceChildren(){children.length=0},appendChild:c=>children.push(c)};
 const ctx=vm.createContext({URL,Promise,Date,navigator:{},location:{href:'https://test/freya-travel/?view=password-recovery#type=recovery',replace:u=>redirected=u},
  document:{getElementById:()=>splash,createElement:()=>({style:{}})},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){}});
 ctx.window=ctx;ctx.addEventListener=(name,fn)=>listeners[name]=fn;
 const start=html.indexOf('// Runs before SDK/application parsing.');vm.runInContext(html.slice(start,html.indexOf('</script>',start)),ctx);
 return {ctx,listeners,timers,children,redirect:()=>redirected};
}
test('pre-SDK watchdog identifies pending session without inventing auth or exposing errors',()=>{
 const h=bootstrap();h.ctx.freyaBoot.step('session');h.timers.at(-1)();
 assert.match(h.children.map(c=>c.textContent).join(' '),/sessió no ha acabat/);
 assert.equal(h.children.at(-1).id,'retryFreyaBoot');
 h.children.at(-1).onclick();const u=new URL(h.redirect());assert.equal(u.searchParams.get('view'),'password-recovery');assert.equal(u.hash,'#type=recovery');assert.ok(u.searchParams.has('freya_boot_retry'));
});
test('parse/init error recovery never prints exception content and stops after successful entry',()=>{
 const h=bootstrap();h.ctx.freyaBoot.step('app');h.listeners.error({error:Error('secret-personal-data')});
 const text=h.children.map(c=>c.textContent).join(' ');assert.match(text,/iniciar aquesta versió/);assert.doesNotMatch(text,/secret-personal-data/);
 h.ctx.freyaBoot.ready();h.children.length=0;h.listeners.error({error:Error('later')});assert.equal(h.children.length,0);
});
test('legacy worker retirement preserves caches; bootstrap never deletes local state',async()=>{
 const old=await readFile(new URL('../freya-travel-v1.5/sw.js',import.meta.url),'utf8');assert.doesNotMatch(old,/caches\.delete/);assert.match(old,/registration\.unregister/);
 const start=html.indexOf('// Runs before SDK/application parsing.');assert.doesNotMatch(html.slice(start,html.indexOf('</script>',start)),/localStorage\.(clear|removeItem)|indexedDB\.deleteDatabase|caches\.delete/);
});

test('storage quota/cache failure cannot discard a successful online shell response',async()=>{
 const response={ok:true,clone(){return this}},h=shell(async()=>response);
 h.c.caches.open=async()=>{throw Error('quota')};assert.equal(await h.c.shellResponse('request','key'),response);
});

test('regression reproduced: previous worker delivered HTTP 503 instead of its cached entry',async()=>{
 const previous=await readFile(new URL('./fixtures/pwa-sw-v20.js',import.meta.url),'utf8');
 const response={ok:false,status:503};
 for(const [source,expected] of [[previous,503],[worker,200]]){
  const h=shell(async()=>response,source);let pending;
  h.handlers.fetch({request:{method:'GET',mode:'navigate',destination:'document',url:'https://test/freya-travel/'},respondWith:value=>pending=value});
  assert.equal((await pending).status,expected);
 }
});

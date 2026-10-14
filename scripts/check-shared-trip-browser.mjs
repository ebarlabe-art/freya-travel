// Actual Pages build + mobile browser. Synthetic Supabase adapter, not live Auth/RLS.
// SQL permissions/concurrency are exercised separately by test-shared-trip-db.mjs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const dist=resolve('dist');
const server=createServer(async(req,res)=>{const path=resolve(dist,decodeURIComponent(new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,''))||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const rows=[],members=new Set();let creates=0,failOwnerList=false;
async function client(user,viewport,isMobile=true){
 const ctx=await browser.newContext({viewport,isMobile,hasTouch:true,serviceWorkers:'allow'});
 await ctx.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url());if(u.origin===new URL(url).origin)return route.continue();
  if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes('@supabase/supabase-js'))return route.fulfill({path:resolve('node_modules/@supabase/supabase-js/dist/umd/supabase.js'),contentType:'text/javascript'});
  if(!u.hostname.endsWith('.supabase.co'))return route.abort();
  return route.fulfill({json:[]});
 });
 // The suite never opens a production Realtime socket.
 await ctx.routeWebSocket('**/*',socket=>socket.close());
 await ctx.addInitScript(()=>{sessionStorage.testBoot=String(Number(sessionStorage.testBoot||0)+1);window.sharedInvitation=null;Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedInvitation=data}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedInvitation=text}}})});
 const page=await ctx.newPage();await page.exposeFunction('syntheticRpc',async(rpc,body={})=>{   let data=[];
  if(rpc==='get_my_trips'&&user==='owner'&&failOwnerList)throw Error('Synthetic network failure');
  if(rpc==='get_my_trips')data=rows.filter(t=>user==='owner'||members.has(user+':'+t.id)).map(t=>({...t,is_owner:user==='owner'}));
  if(rpc==='create_trip_with_stops_v1'){
   creates++;const t={id:'12500000-0000-4000-8000-'+String(creates).padStart(12,'0'),name:body.p_name,start_date:body.p_start_date,end_date:body.p_end_date,time_zone:'UTC',experience_key:null,invite_code:'SYNTH'+creates,owner_id:'owner'};rows.push(t);data=[t];
  }
  if(rpc==='join_trip_v2'){const t=rows.find(t=>t.invite_code===body.p_invite_code);if(!t)return {error:{message:'Codi incorrecte'}};members.add(user+':'+t.id);data=[t]}
 return {data,error:null};});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function start(){await page.goto(url);await page.waitForFunction(()=>navigator.serviceWorker.controller&&typeof renderSession==='function');await page.locator('#loginCard').waitFor({state:'visible'});await page.evaluate(async user=>{db.rpc=(name,args)=>window.syntheticRpc(name,args);db.from=()=>{const q=new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>Promise.resolve({data:[],error:null}).then(resolve):()=>q});return q};db.channel=()=>{const channel={on:()=>channel,subscribe:()=>channel,unsubscribe:async()=>{}};return channel};db.removeChannel=async()=>{};await renderSession({user:{id:user,email:user+'@example.invalid'}})},user);await page.locator('#tripsHomeView').waitFor({state:'visible'})}
 await start();return {ctx,page,errors,start};
}
try{
 const a=await client('owner',{width:390,height:844}),p=a.page;
 await p.locator('[data-home-view="designTripView"]').click();await p.locator('[data-home-view="manualTripView"]').click();
 // Use an already resolved synthetic stop; external place search is out of scope.
 await p.evaluate(()=>{manualTripStops=[{label:'Synthetic destination',place:{canonical_name:'Synthetic destination',latitude:0,longitude:0,timezone:'UTC',provider:'geoapify',provider_place_id:'synthetic-browser'}}];renderManualTripStops()});
 await p.locator('#tripName').fill('Synthetic shared trip');await p.locator('#tripStartDate').fill('2030-01-01');await p.locator('#tripEndDate').fill('2030-01-02');await p.locator('#createTrip').click();
 await p.locator('#genericDashboardView').waitFor({state:'visible'});assert.equal(creates,1);
 await p.locator('#genericTravelersToggle').click();await p.locator('#shareGenericTrip').click();assert.match(await p.evaluate(()=>sharedInvitation.text),/SYNTH1/);
 await p.locator('#copyGenericCode').click();assert.equal(await p.evaluate(()=>copiedInvitation),'SYNTH1');
 await p.goBack();await p.locator('#manualTripView').waitFor({state:'visible'});await p.goForward();await p.locator('#genericDashboardView').waitFor({state:'visible'});
 const b=await client('friend',{width:390,height:844});await b.page.locator('[data-home-view="joinTripView"]').click();await b.page.locator('#inviteInput').fill(' synth1 ');await b.page.locator('#joinTrip').click();await b.page.locator('#genericDashboardView').waitFor({state:'visible'});
 assert.equal(await b.page.evaluate(()=>trip.id),rows[0].id);assert.equal(await b.page.locator('#inviteInput').inputValue(),'');
 await b.start();await b.page.locator('[data-home-view="upcomingTripsView"]').click();assert.equal(await b.page.locator('[data-select-trip]').count(),1);await b.page.locator('[data-select-trip]').click();await b.page.locator('#genericDashboardView').waitFor({state:'visible'});
 await b.page.evaluate(()=>navigator.serviceWorker.ready);assert.ok(await b.page.evaluate(()=>navigator.serviceWorker.controller));
 await b.ctx.setOffline(true);await b.page.reload();await b.page.waitForFunction(()=>typeof renderSession==='function');await b.page.evaluate(async()=>{await renderSession({user:{id:'friend',email:'friend@example.invalid'}})});await b.page.locator('#tripsHomeView').waitFor({state:'visible'});assert.equal(await b.page.evaluate(()=>trips.length),1);await b.ctx.setOffline(false);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // iPad Safari can identify as desktop: exercise desktop mode with touch.
 const tablet=await client('owner',{width:1024,height:768},false);assert.equal(await tablet.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 for(const c of [a,b,tablet])assert.deepEqual(c.errors,[]);
 assert.equal(creates,1);assert.equal(members.size,1);
 // A successful write followed by an unreadable list must not invite a duplicate.
 await p.evaluate(()=>navigateBuilder('manualTripView'));
 await p.evaluate(()=>{manualTripStops=[{label:'Synthetic',place:{canonical_name:'Synthetic',latitude:0,longitude:0,timezone:'UTC',provider:'geoapify',provider_place_id:'second'}}];renderManualTripStops()});
 await p.locator('#tripStartDate').fill('2030-02-01');await p.locator('#tripEndDate').fill('2030-02-02');failOwnerList=true;
 await p.locator('#createTrip').click();await p.waitForFunction(()=>document.getElementById('tripMsg').textContent.includes('No el tornis a crear'));
 assert.equal(await p.locator('#tripMsg').isVisible(),true);assert.equal(await p.locator('#tripStartDate').inputValue(),'');assert.equal(creates,2);
 await p.locator('#createTrip').click();assert.equal(creates,2);failOwnerList=false;
 console.log('PASS confirmed creation + failed refresh: no duplicate or unrelated trip; actual build: 390px create → native-share/clipboard adapters → Back/Forward → second user joins same trip → reload → service-worker offline reopen; 1024px layout. Synthetic transport; physical iPhone/real share sheet pending.');
}finally{await browser.close();await new Promise(r=>server.close(r))}

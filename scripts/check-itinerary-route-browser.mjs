// Real Pages build + real domain/UI + real HTTP handler/provider with synthetic transport.
// Never requests a production database, geocoder or routing service.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRouteHandler} from '../supabase/functions/itinerary-route/handler.mjs';
import {routeProvider} from '../supabase/functions/itinerary-route/provider.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const dist=resolve('dist'),id=n=>'11800000-0000-4000-8000-'+String(n).padStart(12,'0'),tid=id(1);
const tripRow={id:tid,name:'Synthetic itinerary',start_date:'2030-03-31',end_date:'2030-04-01',time_zone:'Europe/Rome',experience_key:null,owner_id:'owner',is_owner:true,invite_code:'SYNTHETIC'};
const stops=[{trip_id:tid,canonical_name:'Bologna',country_code:'IT',position:1,time_zone:'Europe/Rome'}];
const item=(n,name,start,end,extra={})=>({id:id(n),trip_id:tid,title:name,location_name:name,city:'Bologna',time_zone:'Europe/Rome',timing_kind:'exact',starts_at:start,ends_at:end,status:'planned',is_fixed:true,is_optional:false,updated_at:'2030-01-01T00:00:00Z',created_by:'owner',sort_order:n,...extra});
const rows=[item(2,'Museum A','2030-03-31T08:00:00Z','2030-03-31T09:00:00Z'),item(3,'Cancelled','2030-03-31T09:05:00Z',null,{status:'cancelled'}),item(4,'Museum B','2030-03-31T09:30:00Z','2030-03-31T10:30:00Z',{is_optional:true}),item(5,'No place',null,null,{timing_kind:'daypart',local_date:'2030-04-01',daypart:'morning',location_name:null}),item(6,'Museum B',null,null,{timing_kind:'approximate',local_date:'2030-04-01',approximate_start_time:'12:00'})];
let httpCalls=0,routeCalls=0,fail=false,release;
const provider=routeProvider({key:'synthetic-server-only',spacingMs:0,fetcher:async url=>{
 httpCalls++;
 if(url.pathname.endsWith('/geocode/search')){const name=url.searchParams.get('text').includes('Museum A')?'Museum A':'Museum B';const p={name,formatted:name+', Bologna',city:'Bologna',country_code:'it',result_type:'amenity',place_id:name,lat:44.49,lon:name==='Museum A'?11.34:11.35};return Response.json({results:[p]})}
 return Response.json({features:[{geometry:{type:'MultiLineString',coordinates:[[[11.34,44.49],[11.35,44.49]]]},properties:{mode:url.searchParams.get('mode'),distance:1200,distance_units:'meters',time:900}}]});
}});
const handler=createRouteHandler({authenticate:async auth=>auth==='Bearer owner'?'owner':null,readTrip:async(_auth,t)=>t===tid,readItem:async(_auth,t,ref)=>rows.find(r=>r.trip_id===t&&r.id===ref.id),readStops:async()=>stops,provider});
const server=createServer(async(req,res)=>{const path=resolve(dist,decodeURIComponent(new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,''))||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
 await ctx.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());await ctx.routeWebSocket('**/*',socket=>socket.close());
 await ctx.addInitScript(()=>{sessionStorage.routeTestBoot=String(Number(sessionStorage.routeTestBoot||0)+1)});
 const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('routeFixture',async(body,user)=>{
  routeCalls++;if(release)await new Promise(r=>release=r);
  if(fail)return {error:'rate_limited'};
  const response=await handler(new Request('https://synthetic/route',{method:'POST',headers:{authorization:'Bearer '+user},body:JSON.stringify(body)}));return response.json();
 });
 async function boot(target=page,pwa=true){
  await target.goto(url);await target.waitForFunction(pwa=>typeof renderSession==='function'&&(!pwa||(Number(sessionStorage.routeTestBoot)>=2&&navigator.serviceWorker.controller)),pwa);await target.locator('#loginCard').waitFor({state:'visible'});
  await target.evaluate(async({tripRow,rows,stops})=>{
   window.testRows=rows;
   db.rpc=async name=>({data:name==='get_my_trips'?[tripRow]:[],error:null});
   db.from=table=>{const q=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:table==='trip_itinerary_items'?window.testRows:table==='trip_stops'?stops:[],error:null}).then(resolve):()=>q});return q};
   db.channel=()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe:async()=>{}};return c};db.removeChannel=async()=>{};
   Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async(name,{body})=>({data:name==='itinerary-route'?await window.routeFixture(body,session.user.id):{candidates:[]},error:null})}});
   await renderSession({user:{id:'owner',email:'owner@example.invalid'}});await selectTrip(tripRow.id,{open:true});
  },{tripRow,rows,stops});
 }
 await boot();assert.equal(routeCalls,0,'Home must not calculate routes');
 await page.locator('#genericItineraryModuleCard').click();await page.locator('[data-agenda-route]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('1.2 km')).catch(async e=>{console.error(await page.locator('[data-agenda-route]').innerText(),{routeCalls,httpCalls,errors});throw e});
 assert.equal(await page.locator('[data-agenda-route]').count(),1);assert.match(await page.locator('[data-agenda-route]').innerText(),/Dades insuficients.*Indica el marge/s);
 await page.locator('[data-route-buffer]').fill('5');await page.locator('[data-route-buffer]').press('Tab');await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('Factible amb marge estimat'));
 await page.locator('[data-route-mode]').selectOption('drive');await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('Cotxe')&&document.querySelector('[data-agenda-route]')?.textContent.includes('1.2 km'));
 await page.locator('[data-route-mode]').selectOption('transit');await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('sense horaris en viu'));
 const before=routeCalls;await page.locator('[data-generic-itinerary-day="2030-04-01"]').click();await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('Falta un lloc'));assert.equal(routeCalls,before);
 await page.locator('[data-generic-itinerary-day="2030-03-31"]').click();await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('1.2 km'));assert.equal(routeCalls,before,'same pair/mode remains cached');
 await ctx.setOffline(true);await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('Sense connexió'));assert.equal(routeCalls,before);await ctx.setOffline(false);await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('1.2 km'));
 await page.locator('[data-route-edit="origin"]').click();await page.locator('#manualItineraryFormCard').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>manualItineraryRows[0].location_name),'Museum A'); // Opening correction does not mutate the source.
 await page.evaluate(()=>closeManualItineraryForm());
 // Reopen the real PWA; preferences survive, route is recalculated rather than persisted as fact.
 await boot();await page.locator('#genericItineraryModuleCard').click();await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('1.2 km'));assert.equal(await page.locator('[data-route-mode]').inputValue(),'transit');assert.equal(await page.locator('[data-route-buffer]').inputValue(),'5');
 fail=true;await page.locator('[data-route-mode]').selectOption('walk');await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('Límit de consultes'));fail=false;await page.locator('[data-route-retry]').click();await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('1.2 km'));
 // An inexact match requires a deliberate choice; changing the fixture version invalidates the old pair.
 rows[0].location_name='Museum A alternative';rows[0].updated_at='2030-01-02T00:00:00Z';
 await boot();await page.locator('#genericItineraryModuleCard').click();await page.locator('[data-route-choice="origin"]').waitFor();
 await page.locator('[data-route-choice="origin"]').selectOption('Museum A');await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('1.2 km'));
 rows[0].location_name='Museum A';rows[0].updated_at='2030-01-03T00:00:00Z';
 await boot();await page.locator('#genericItineraryModuleCard').click();await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('1.2 km'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:process.env.ROUTE_SCREENSHOT||'/tmp/freya-itinerary-route-mobile.png',fullPage:true});
 // Pending response must never paint a different user's trip.
 release=true;await page.locator('[data-route-mode]').selectOption('drive');await page.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('Calculant'));
 await page.evaluate(()=>{clearGenericItineraryState();session={user:{id:'outsider'}};trip={...trip,id:'different-trip'};setAppView('genericDashboardView')});release();release=null;
 assert.equal(await page.locator('[data-agenda-route]').count(),0);
 const tablet=await browser.newContext({viewport:{width:1024,height:768},isMobile:false,hasTouch:true,serviceWorkers:'block'});
 await tablet.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await tablet.routeWebSocket('**/*',s=>s.close());
 const tab=await tablet.newPage();await tab.exposeFunction('routeFixture',async body=>(await handler(new Request('https://synthetic',{method:'POST',headers:{authorization:'Bearer owner'},body:JSON.stringify(body)}))).json());
 await boot(tab,false);await tab.locator('#genericItineraryModuleCard').click();await tab.waitForFunction(()=>document.querySelector('[data-agenda-route]')?.textContent.includes('1.2 km'));
 assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 console.log(`PASS real build mobile/PWA: automatic routes, three modes, explicit margin, missing locations/daypart, cache, offline/reconnect, correction via existing editor, reload, 429 retry, user/trip switch; ${routeCalls} synthetic handler requests, ${httpCalls} simulated provider calls. Physical iPhone pending.`);
}finally{await browser.close();await new Promise(r=>server.close(r))}

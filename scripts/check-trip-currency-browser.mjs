// Actual Pages build and service worker. The trip and rate payloads are fixtures.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RATE_ENDPOINT} from '../domain/trip-currency.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE
  ?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const dist=resolve('dist');
const server=createServer(async(request,response)=>{
  const name=new URL(request.url,'http://local').pathname.replace(/^\/freya-travel\//,'');
  const path=resolve(dist,name||'index.html');
  if(!path.startsWith(dist+sep)){response.writeHead(404).end();return}
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.webmanifest':'application/manifest+json'};
  try{
    const body=await readFile(path);
    response.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');
    response.end(body);
  }catch{response.writeHead(404).end()}
});
const launchOptions={headless:true};
if(process.env.CHROME_PATH)launchOptions.executablePath=process.env.CHROME_PATH;
const browser=await chromium.launch(launchOptions);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const origin=new URL(url).origin;
const owner='00000000-0000-4000-8000-000000000001',guest='00000000-0000-4000-8000-000000000002';
const formatDay=offset=>new Date(Date.now()+offset*86_400_000).toISOString().slice(0,10);
const fixtures=[
  ['Londres','Europe/London','london-2026',-20,-15,[]],
  ['Riga i Tallinn','Europe/Riga',null,15,20,[['Riga','LV'],['Tallinn','EE']]],
  ['Japó','Asia/Tokyo',null,-2,2,[['Tokyo','JP']]],
  ['Sri Lanka i Maldives','Asia/Colombo',null,25,30,[['Colombo','LK'],['Malé','MV']]]
].map(([name,time_zone,experience_key,start,end,stops],index)=>({
  trip:{id:`10000000-0000-4000-8000-00000000000${index+1}`,name,time_zone,experience_key,
    start_date:formatDay(start),end_date:formatDay(end),is_owner:true,owner_id:owner,invite_code:'FIXTURE'},
  stops:stops.map(([canonical_name,country_code],position)=>({id:String(position),position,
    canonical_name,country_code,time_zone}))
}));
const quoteTime=Math.floor(Date.now()/1000)-600;
const ratePayload={result:'success',base_code:'EUR',time_last_update_unix:quoteTime,
  time_next_update_unix:quoteTime+86400,rates:{EUR:1,GBP:.85,JPY:170,LKR:350,MVR:18,USD:1.17}};
const context=await browser.newContext({locale:'ca-ES',viewport:{width:390,height:844},
  deviceScaleFactor:2,isMobile:true,hasTouch:true});
let requests=0;
await context.route('**/*',async route=>{
  const request=route.request(),target=new URL(request.url());
  if(target.origin===origin)return route.continue();
  if(target.href===RATE_ENDPOINT){
    requests++;
    assert.equal(request.method(),'GET');
    assert.equal(request.headers().authorization,undefined);
    assert.equal(request.headers().referer,undefined);
    return route.fulfill({json:ratePayload,headers:{'access-control-allow-origin':'*'}});
  }
  if(target.hostname.endsWith('.supabase.co'))return route.fulfill({json:[]});
  return route.abort();
});
await context.routeWebSocket('**/*',socket=>socket.close());
const page=await context.newPage();
page.setDefaultTimeout(12000);
const errors=[];
page.on('pageerror',error=>errors.push(error.message));

async function showSession(user){
  await page.waitForFunction(()=>typeof renderSession==='function'&&authInitializationResolved);
  await page.evaluate(async({fixtures,user})=>{
    const rows=fixtures.map(item=>item.trip);
    db.rpc=async name=>({data:name==='get_my_trips'?rows:[],error:null});
    db.from=table=>{
      let selected;
      const query=new Proxy({}, {get(_,key){
        if(key==='then')return resolve=>Promise.resolve({data:table==='trip_stops'
          ?fixtures.find(item=>item.trip.id===selected)?.stops||[]:[],error:null}).then(resolve);
        if(key==='eq')return (field,value)=>{if(field==='trip_id')selected=value;return query};
        return ()=>query;
      }});
      return query;
    };
    db.channel=()=>{
      const channel={on:()=>channel,subscribe:()=>channel,unsubscribe:async()=>{}};
      return channel;
    };
    db.removeChannel=async()=>{};
    await renderSession({user:{id:user,email:user+'@example.invalid'}});
  },{fixtures,user});
  await page.locator('#tripsHomeView').waitFor({state:'visible'});
}

async function openTrip(index,category){
  if(category)await page.locator('#tripsHomeView [data-home-view="'+category+'"]').click();
  await page.locator(`[data-select-trip="${fixtures[index].trip.id}"]:visible`).click();
  const dashboard=page.locator(fixtures[index].trip.experience_key?'#dashboardView':'#genericDashboardView');
  await dashboard.locator('[data-open="tripCurrencyView"]').tap();
  await page.locator('#currencyBody').waitFor({state:'visible'});
  return dashboard;
}

async function waitStatus(text){
  await page.waitForFunction(value=>document.getElementById('currencyStatus').textContent.includes(value),text);
}

async function returnToHome(dashboard){
  await page.locator('#currencyBack').tap();
  await dashboard.waitFor({state:'visible'});
  await dashboard.locator('[data-trips-home],#backToTrips').click();
  await dashboard.waitFor({state:'hidden'});
  if(!await page.locator('#tripsHomeView').isVisible()){
    await page.locator('[data-builder-back="tripsHomeView"]:visible').first().click();
  }
  await page.locator('#tripsHomeView').waitFor({state:'visible'});
}

const input=page.locator('#currencyAmount'),local=page.locator('#currencyLocal'),usual=page.locator('#currencyUsual');
const result=page.locator('#currencyResult');
try{
  await page.goto(url);
  await showSession(owner);
  await page.waitForFunction(()=>navigator.serviceWorker.controller);

  let dashboard=await openTrip(1,'upcomingTripsView');
  assert.match(await page.locator('#currencyDestinations').innerText(),/Riga · EUR\s+Tallinn · EUR/);
  assert.equal(await usual.inputValue(),'EUR');
  assert.equal(await local.inputValue(),'EUR');
  await waitStatus('No cal fer cap conversió');
  assert.equal(await page.locator('#currencySwap').isDisabled(),true);
  assert.equal(requests,0);
  await returnToHome(dashboard);

  dashboard=await openTrip(0,'pastTripsView');
  assert.equal(await local.inputValue(),'GBP');
  await page.locator('#currencyQuote').waitFor({state:'visible'});
  assert.match(await result.innerText(),/85,00\s*GBP/);
  assert.equal(await page.locator('#currencyRateTime').getAttribute('datetime'),new Date(quoteTime*1000).toISOString());
  assert.equal(await page.locator('#currencyQuote a').getAttribute('href'),'https://www.exchangerate-api.com');
  assert.match(await page.locator('#currencyBody').innerText(),/comissions/);
  await page.locator('#currencySwap').tap();
  assert.equal(await input.inputValue(),'85');
  assert.match(await result.innerText(),/100,00\s*EUR/);
  await page.goBack();
  await dashboard.waitFor({state:'visible'});
  await page.goForward();
  await page.locator('#currencyBody').waitFor({state:'visible'});
  assert.equal(await input.inputValue(),'85');
  await returnToHome(dashboard);

  dashboard=await openTrip(2);
  assert.equal(await local.inputValue(),'JPY');
  await input.fill('2,50');
  assert.match(await result.innerText(),/425\s*JPY/);
  assert.equal(await page.locator('#tripCurrencyView').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  const button=await page.locator('#currencySwap').boundingBox();
  assert.ok(button.width>=44&&button.height>=44);
  await returnToHome(dashboard);

  dashboard=await openTrip(3,'upcomingTripsView');
  assert.match(await page.locator('#currencyDestinations').innerText(),/Colombo · LKR\s+Malé · MVR/);
  assert.equal(await local.inputValue(),'LKR');
  assert.match(await result.innerText(),/35.000,00\s*LKR/);
  await local.selectOption('MVR');
  assert.match(await result.innerText(),/1[.\s]?800,00\s*MVR/);
  await usual.selectOption('USD');
  assert.equal(requests,1,'Reuse one published snapshot for every supported pair');
  await returnToHome(dashboard);

  await context.setOffline(true);
  await page.reload();
  await showSession(owner);
  dashboard=await openTrip(3,'upcomingTripsView');
  assert.equal(await usual.inputValue(),'USD');
  await local.selectOption('MVR');
  await waitStatus('Sense connexió');
  assert.match(await result.innerText(),/1[.\s]?538,46\s*MVR/);
  assert.equal(await page.locator('#currencyRateTime').getAttribute('datetime'),new Date(quoteTime*1000).toISOString());
  assert.equal(requests,1);
  await returnToHome(dashboard);

  await context.setOffline(false);
  await showSession(guest);
  await openTrip(3,'upcomingTripsView');
  assert.equal(await usual.inputValue(),'EUR','The usual currency is local to the current account');
  assert.equal(await local.inputValue(),'LKR');
  assert.equal(await input.inputValue(),'100');
  assert.deepEqual(errors,[]);
  console.log('PASS A5 390px touch: four trips, no same-currency request, swap, Back/Forward, offline cold reload, source timestamp and account isolation.');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

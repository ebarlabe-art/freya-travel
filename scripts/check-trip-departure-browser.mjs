import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE
  ?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const dist=resolve('dist');
const server=createServer(async(request,response)=>{
 const path=resolve(dist,new URL(request.url,'http://local').pathname.replace(/^\/freya-travel\//,'')||'index.html');
 if(!path.startsWith(dist+sep)){response.writeHead(404).end();return}
 try{
  const body=await readFile(path);
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'};
  response.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');
  response.end(body);
 }catch{response.writeHead(404).end()}
});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const stamp=minutes=>new Date(Date.now()+minutes*60000).toISOString();
const zone='Europe/Madrid';
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const trip={id:id(1),name:'Eivissa',time_zone:zone,start_date:stamp(-2880).slice(0,10),
 end_date:stamp(2880).slice(0,10),is_owner:true};
const activities=[['Previous museum',-45,5,38.909,1.435],['Appointment without a point',18,23,null,null],
 ['Next exhibition',45,75,38.9095,1.436],['Selected square',90,100,38.91,1.437]]
 .map(([title,start,end,latitude,longitude],i)=>({
  id:id(i+2),trip_id:trip.id,title,activity_type:'visit',reservation_status:'confirmed',
  start_at:stamp(start),end_at:stamp(end),time_zone:zone,updated_at:stamp(-120),city:'Eivissa',latitude,longitude
 }));
const ticketId=id(7);
const link={trip_id:trip.id,activity_id:activities[2].id,document_id:ticketId,document_role:'ticket'};
const ticket={id:ticketId,trip_id:trip.id,title:'Exhibition ticket',file_path:'fixture.png',mime_type:'image/png',category:'Entrades'};
const calls=[],searches=[];
const context=await browser.newContext({viewport:{width:390,height:844},locale:'en-GB',hasTouch:true,isMobile:true,reducedMotion:'reduce'});
await context.addInitScript(()=>{
 window.b1PositionCalls=0;
 window.b1AllowLocation=false;
 navigator.geolocation.getCurrentPosition=(ok,bad)=>{
  window.b1PositionCalls++;
  if(!window.b1AllowLocation){bad({code:1});return}
  ok({timestamp:Date.now(),coords:{latitude:38.908,longitude:1.435,accuracy:14}});
 };
 navigator.geolocation.watchPosition=()=>{throw Error('Continuous location is forbidden')};
});
await context.route('**/*',async route=>{
 const target=new URL(route.request().url());
 if(target.origin===new URL(url).origin)return route.continue();
 if(target.hostname.endsWith('.supabase.co')&&target.pathname.endsWith('/place-resolution')){
  const body=route.request().postDataJSON();searches.push(body);
  return route.fulfill({json:{candidates:[{place:{provider:'geoapify',provider_place_id:'station',canonical_name:'Station entrance',
    formatted_address:'Station entrance, Eivissa',country_code:'ES',latitude:38.91,longitude:1.438,source:'test',
    attribution:'test',coordinate_role:'exact_location',timezone_status:'verified',timezone:zone}}]}});
 }
 if(target.hostname.endsWith('.supabase.co')&&target.pathname.endsWith('/itinerary-route')){
  const body=route.request().postDataJSON();calls.push(body);
  if(body.mode==='transit')return route.fulfill({status:422,json:{error:'mode_unavailable'}});
  return route.fulfill({json:{status:'ready',route:{method:'routing',mode:body.mode,distance_m:1200,duration_seconds:900,
    calculated_at:new Date().toISOString(),
    origin:body.origin.latitude!=null?{latitude:body.origin.latitude,longitude:body.origin.longitude}:{latitude:38.909,longitude:1.435},
    destination:{latitude:38.9095,longitude:1.436}}}});
 }
 if(target.hostname.endsWith('.supabase.co'))return route.fulfill({json:[]});
 return route.abort();
});
await context.routeWebSocket('**/*',socket=>socket.close());
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const field=key=>page.locator(`[data-b1="${key}"]`);
const status=field('status');
async function expectText(locator,pattern){
 await locator.filter({hasText:pattern}).waitFor({state:'visible'});
}
try{
 await page.goto(url);await page.waitForFunction(()=>typeof renderSession==='function'&&authInitializationResolved);
 await page.evaluate(async({trip,activities,link,ticket,uid})=>{
  db.rpc=async name=>({data:name==='get_my_trips'?[trip]:[],error:null});
  db.from=table=>{
   const data={trip_activities:activities,trip_activity_documents:[link],travel_documents:[ticket]}[table]||[];
   const query=new Proxy({}, {get(_,key){
    if(key==='then')return (resolve,reject)=>Promise.resolve({data,error:null}).then(resolve,reject);
    return ()=>query;
   }});
   return query;
  };
  db.channel=()=>{const channel={on:()=>channel,subscribe:()=>channel,unsubscribe:async()=>{}};return channel};
  db.removeChannel=async()=>{};
  openDocument=async id=>{window.b1OpenedTicket=id};
  await renderSession({user:{id:uid,email:'fixture@example.invalid'}});
 },{trip,activities,link,ticket,uid:id(9)});
 await page.locator(`[data-select-trip="${trip.id}"]:visible`).click();
 await page.locator('#departureTitle').waitFor({state:'visible'});
 await expectText(field('target'),/Next exhibition/);
 assert.equal(await field('margin').inputValue(),'10');
 assert.equal(await page.evaluate(()=>window.b1PositionCalls),0);
 assert.equal(calls.length,0);
 await page.getByRole('button',{name:'Open ticket',exact:true}).tap();
 await page.waitForFunction(id=>window.b1OpenedTicket===id,ticketId);
 await field('calculate').tap();
 await expectText(status,/Location permission denied/);
 assert.equal(calls.length,0);
 await field('origin').selectOption('previous');
 await expectText(field('originNote'),/previous activity ends/);
 await field('calculate').tap();
 await expectText(status,/You have time/);
 assert.equal(calls[0].origin.id,activities[0].id);
 assert.equal(calls[0].destination.id,activities[2].id);
 await expectText(field('duration'),/15 min/);
 assert.equal(new URL(await field('route').getAttribute('href')).searchParams.get('travelmode'),'walking');
 await field('margin').fill('20');await field('margin').blur();
 await expectText(status,/Leave soon/);
 await field('margin').fill('40');await field('margin').blur();
 await expectText(status,/Not enough time/);
 await field('origin').selectOption(`activity:${activities[3].id}:start`);
 await field('mode').selectOption('transit');await field('calculate').tap();
 await expectText(status,/found no route/);
 assert.equal(calls[1].origin.id,activities[3].id);
 assert.equal(await field('result').isVisible(),false);
 await field('origin').selectOption('selected');
 await field('query').fill('Station entrance, Eivissa');
 await field('search').tap();
 await page.getByRole('button',{name:'Station entrance, Eivissa',exact:true}).tap();
 assert.deepEqual(searches,[{action:'search',text:'Station entrance, Eivissa',language:'en'}]);
 await field('mode').selectOption('walk');await field('calculate').tap();
 await field('result').waitFor({state:'visible'});
 assert.deepEqual(calls[2].origin,{type:'selected',latitude:38.91,longitude:1.438});
 await page.evaluate(()=>window.b1AllowLocation=true);
 await field('origin').selectOption('device');await field('mode').selectOption('drive');await field('calculate').tap();
 await field('result').waitFor({state:'visible'});
 assert.equal(calls[3].origin.type,'device');assert.equal(calls[3].mode,'drive');
 assert.equal(await page.evaluate(()=>window.b1PositionCalls),2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.DEPARTURE_CAPTURE)await page.locator('#tripDepartureSlot').screenshot({path:process.env.DEPARTURE_CAPTURE});
 await context.setOffline(true);
 await expectText(status,/You’re offline/);
 assert.equal(await field('calculate').isDisabled(),true);
 assert.equal(await field('route').isVisible(),false);
 assert.equal(calls.length,4);
 assert.deepEqual(errors,[]);
 console.log('PASS B1 390px: next verified visit, ticket link, explicit GPS denied/accepted, saved origins, all modes, margin, and offline.');
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
}

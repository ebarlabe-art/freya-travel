import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {extractActivityPoints,pointSnapshot} from '../domain/itinerary-place-points.mjs';

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
const firstDay=stamp(1440).slice(0,10), secondDay=stamp(2880).slice(0,10);
const plannedTrip={...trip,id:id(20),name:'Riga and Tallinn fixture',start_date:firstDay,end_date:secondDay};
const plannedActivities=[
 [firstDay,'Riga museum','07:00','08:00'],[firstDay,'Riga gallery','08:20','09:30'],
 [secondDay,'Tallinn museum','09:00','10:00']
].map(([day,title,start,end],i)=>({
 ...activities[0],id:id(21+i),trip_id:plannedTrip.id,title,
 start_at:day+'T'+start+':00Z',end_at:day+'T'+end+':00Z'
}));
// One newly imported address and three untouched pending rows in a multistop trip.
const liveAddressActivity=activities[2];
Object.assign(liveAddressActivity,{latitude:null,longitude:null,address:'Carrer de Mostra 12, 07800 Eivissa',location_points:null});
const stops=[
 {trip_id:plannedTrip.id,country_code:'LV',canonical_name:'Riga',time_zone:'Europe/Riga',position:0},
 {trip_id:plannedTrip.id,country_code:'EE',canonical_name:'Tallinn',time_zone:'Europe/Tallinn',position:1}
];
for(const [i,row] of plannedActivities.entries()){
 Object.assign(row,{latitude:null,longitude:null,city:null,venue_name:row.title,time_zone:stops[i===2?1:0].time_zone});
 row.location_points=pointSnapshot(row,extractActivityPoints(row));
}
const hotel={id:id(24),trip_id:plannedTrip.id,name:'Riga hotel',address:'Riga hotel',reservation_status:'confirmed',
 latitude:56.95,longitude:24.11,time_zone:zone};
const ticketId=id(7);
const link={trip_id:trip.id,activity_id:activities[2].id,document_id:ticketId,document_role:'ticket'};
const ticket={id:ticketId,trip_id:trip.id,title:'Exhibition ticket',file_path:'fixture.png',mime_type:'image/png',category:'Entrades'};
const calls=[],searches=[],automaticSearches=[];
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
  const body=route.request().postDataJSON();
  if(body.language==='ca'){
   automaticSearches.push(body);
   const rows=[liveAddressActivity,...plannedActivities];
   const chosen=rows.find(row=>body.text.startsWith(row.address||row.venue_name));
   if(!chosen)return route.fulfill({json:{candidates:[]}});
   const district=chosen===liveAddressActivity?{country_code:'ES',canonical_name:'Eivissa'}:stops.find(stop=>stop.time_zone===chosen.time_zone);
   return route.fulfill({json:{candidates:[{place:{provider:'geoapify',provider_place_id:chosen.id,canonical_name:chosen.title,
    formatted_address:chosen===liveAddressActivity?'Sala d’exposicions, 12 Carrer de Mostra, 07800 Eivissa':chosen.title+', '+district.canonical_name,
    locality:district.canonical_name,country_code:district.country_code,latitude:38.91,longitude:1.438,
    attribution:'Synthetic',coordinate_role:'exact_location'}}]}});
  }
  searches.push(body);
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
 await page.evaluate(async({trip,activities,plannedTrip,plannedActivities,stops,hotel,link,ticket,uid})=>{
  db.rpc=async name=>({data:name==='get_my_trips'?[trip,plannedTrip]:[],error:null});
  window.b1GeoWrites=[];
  db.from=table=>{
   let patch;
   let data={trip_stops:stops,trip_activities:[...activities,...plannedActivities],trip_accommodations:[hotel],
    trip_activity_documents:[link],travel_documents:[ticket]}[table]||[];
   const query=new Proxy({}, {get(_,key){
    if(key==='update')return value=>{patch=value;return query};
    if(key==='maybeSingle')return async()=>{
     if(table!=='trip_activities'||data.length!==1||Object.keys(patch).join()!=='location_points')throw Error('Unexpected geography write');
     const row=data[0];
     Object.assign(row,patch,{updated_at:new Date().toISOString()});
     window.b1GeoWrites.push(row.id);
     return {data:structuredClone(row),error:null};
    };
    if(key==='eq')return (field,value)=>{data=data.filter(row=>row[field]===value);return query};
    if(key==='then')return (resolve,reject)=>Promise.resolve({data,error:null}).then(resolve,reject);
    return ()=>query;
   }});
   return query;
  };
  db.channel=()=>{const channel={on:()=>channel,subscribe:()=>channel,unsubscribe:async()=>{}};return channel};
  db.removeChannel=async()=>{};
  openDocument=async id=>{window.b1OpenedTicket=id};
  await renderSession({user:{id:uid,email:'fixture@example.invalid'}});
 },{trip,activities,plannedTrip,plannedActivities,stops,hotel,link,ticket,uid:id(9)});
 await page.locator(`[data-select-trip="${trip.id}"]:visible`).click();
 await page.locator('#departureTitle').waitFor({state:'visible'});
 await page.waitForFunction(id=>activityRows.some(row=>row.id===id&&row.location_points?.points?.[0]?.status==='resolved'),liveAddressActivity.id);
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
 await context.setOffline(false);
 await page.evaluate(id=>selectTrip(id,{open:true}),plannedTrip.id);
 await page.locator('#genericItineraryModuleCard').tap();
 const planner=page.locator('#plannedDepartureSlot');
 await expectText(planner.getByRole('heading'),/Plan your journeys/);
 await page.waitForFunction(ids=>ids.every(id=>activityRows.some(row=>row.id===id&&row.location_points?.points?.[0]?.status==='resolved')),plannedActivities.map(row=>row.id));
 await expectText(field('destination'),/Riga gallery/);
 assert.deepEqual(automaticSearches.map(search=>search.country_code),[undefined,'LV','LV','EE']);
 assert.deepEqual(await page.evaluate(()=>window.b1GeoWrites),[liveAddressActivity.id,...plannedActivities.map(row=>row.id)]);
 assert.equal(calls.length,4,'Future agenda must not fetch any routes automatically');
 assert.equal(await field('origin').inputValue(),'previous');
 assert.equal(await field('origin').locator('option[value="device"]').count(),0);
 await field('margin').fill('10');await field('margin').blur();
 await field('calculate').tap();
 await expectText(status,/Not enough time in the planned schedule/);
 await expectText(field('available'),/-5 min/);
 await expectText(field('duration'),/15 min/);
 await expectText(field('quality'),/Planning estimate/);
 assert.equal(calls[4].origin.id,plannedActivities[0].id);
 assert.equal(calls[4].destination.id,plannedActivities[1].id);
 await field('margin').fill('0');await field('margin').blur();
 await expectText(status,/fits with the planned buffer/);
 await expectText(field('available'),/5 min/);
 assert.equal(calls.length,5,'Changing the buffer must reuse the current estimate');
 await field('destination').selectOption({label:await field('destination').locator('option').first().textContent()});
 await field('origin').selectOption('lodging:'+hotel.id);
 await field('calculate').tap();
 await expectText(status,/needed to check the gap/);
 await expectText(field('available'),/—/);
 assert.deepEqual(calls[5].origin,{type:'selected',latitude:hotel.latitude,longitude:hotel.longitude});
 await field('ready').fill('06:00');
 await expectText(status,/fits with the planned buffer/);
 await field('origin').selectOption('selected');
 await field('query').fill('Station entrance, Riga');
 await field('search').tap();
 await page.getByRole('button',{name:'Station entrance, Eivissa',exact:true}).tap();
 await field('mode').selectOption('drive');await field('calculate').tap();
 await field('result').waitFor({state:'visible'});
 assert.equal(calls[6].origin.type,'selected');assert.equal(calls[6].mode,'drive');
 await page.locator('[data-generic-itinerary-day="'+secondDay+'"]').tap();
 await expectText(field('destination'),/Tallinn museum/);
 assert.equal(await field('result').isVisible(),false);
 assert.equal(calls.length,7);
 assert.equal(await page.evaluate(()=>window.b1PositionCalls),2);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(automaticSearches.length,4,'Saved points are reused after refresh and when changing itinerary day');
 assert.deepEqual(errors,[]);
 console.log('PASS B1 390px: next verified visit, ticket link, explicit GPS denied/accepted, new postal address, saved origins, all modes, margin, and offline. Multistop pending places recovered without manual verification. B1.1: future days, on-demand routes, schedule conflict, lodging, and custom origin.');
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
}

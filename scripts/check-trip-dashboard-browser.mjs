import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE
  ?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const dist=resolve('dist'),captures=process.env.TRIP_DASHBOARD_CAPTURES;
if(captures)await mkdir(captures,{recursive:true});
const server=createServer(async(request,response)=>{
  const name=new URL(request.url,'http://local').pathname.replace(/^\/freya-travel\//,'');
  const path=resolve(dist,name||'index.html');
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
const user='00000000-0000-4000-8000-000000000001';
const day=offset=>new Date(Date.now()+offset*86_400_000).toISOString().slice(0,10);
const fixtures=[
  {key:'london',name:'Londres',zone:'Europe/London',range:[-40,-36],experience_key:'london-2026'},
  {key:'riga',name:'Riga i Tallinn',zone:'Europe/Riga',range:[14,18],stops:[['Riga','LV'],['Tallinn','EE']]},
  {key:'eivissa',name:'Eivissa',zone:'Europe/Madrid',range:[-2,2],stops:[['Eivissa','ES']]},
  {key:'records',name:'Eivissa · Records',zone:'Europe/Madrid',range:[-12,-6],stops:[['Eivissa','ES']]}
].map(({key,name,zone,range,experience_key=null,stops=[]},index)=>({key,
  trip:{id:`10000000-0000-4000-8000-00000000000${index+1}`,name,experience_key,time_zone:zone,
    start_date:day(range[0]),end_date:day(range[1]),is_owner:key!=='records',owner_id:user,invite_code:'LOCAL'},
  stops:stops.map(([canonical_name,country_code],position)=>({id:String(position),position,
    canonical_name,country_code,time_zone:zone}))
}));
const planning=fixtures[1].trip.id;

try{
  for(const [mode,viewport,locale] of [
    ['mobile',{width:390,height:844},'ca-ES'],
    ['desktop',{width:1280,height:900},'en-GB']
  ]){
    const context=await browser.newContext({viewport,locale,isMobile:mode==='mobile',hasTouch:mode==='mobile',reducedMotion:'reduce'});
    await context.route('**/*',route=>{
      const target=new URL(route.request().url());
      if(target.origin===new URL(url).origin)return route.continue();
      if(target.pathname.endsWith('/trip-insights'))return route.fulfill({status:503,json:{error:'unavailable'}});
      if(target.hostname.endsWith('.supabase.co'))return route.fulfill({json:[]});
      return route.abort();
    });
    await context.routeWebSocket('**/*',socket=>socket.close());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.setDefaultTimeout(12000);
    await page.goto(url);
    await page.waitForFunction(()=>typeof renderSession==='function'&&authInitializationResolved);
    await page.evaluate(async({fixtures,user,planning})=>{
      db.rpc=async name=>({data:name==='get_my_trips'?fixtures.map(item=>item.trip):[],error:null});
      db.from=table=>{
        let selected;
        const query=new Proxy({}, {get(_,key){
          if(key==='then')return (resolve,reject)=>{
            const data=table==='trip_stops'?fixtures.find(item=>item.trip.id===selected)?.stops||[]:
              table==='trip_proposal_handoffs'?[{trip_id:planning}]:table==='checklist_items'?
                [{id:'check-a',text:'Test',done:false,category:'general'}]:[];
            return Promise.resolve({data,error:null}).then(resolve,reject);
          };
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
      await renderSession({user:{id:user,email:'fixture@example.invalid'}});
    },{fixtures,user,planning});
    const home=page.locator('#tripsHomeView');
    await home.waitFor({state:'visible'});

    for(const [index,category] of [[0,'pastTripsView'],[1,'upcomingTripsView'],[2,null],[3,'pastTripsView']]){
      const {key,trip}=fixtures[index],generic=key!=='london';
      if(category)await home.locator(`[data-home-view="${category}"]`).click();
      await page.locator(`[data-select-trip="${trip.id}"]:visible`).click();
      const dashboard=page.locator(generic?'#genericDashboardView':'#dashboardView');
      await dashboard.waitFor({state:'visible'});
      if(generic)await dashboard.locator('#genericChecklistModuleStatus').getByText(mode==='mobile'?'1 tasca pendent':'1 task left',{exact:true}).waitFor();
      const grid=dashboard.locator(generic?'#genericConfirmedSection .menu-grid':'.menu-grid');
      assert.equal(await grid.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),
        mode==='desktop'&&generic?3:2);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const cards=await grid.locator('.menu-card').evaluateAll(nodes=>nodes.map(node=>{
        const style=getComputedStyle(node),icon=node.querySelector('.icon'),title=node.querySelector('strong'),copy=node.querySelector('small');
        return {height:node.getBoundingClientRect().height,border:style.borderRadius,
          ordered:icon.getBoundingClientRect().top<title.getBoundingClientRect().top&&title.getBoundingClientRect().top<copy.getBoundingClientRect().top,
          overflow:node.scrollWidth>node.clientWidth};
      }));
      assert.ok(cards.every(card=>card.height>=112&&card.border==='20px'&&card.ordered&&!card.overflow));
      if(key==='riga'){
        assert.equal(await dashboard.locator('#tripHome').isVisible(),false);
        assert.equal(await dashboard.locator('#genericBuildCard').isVisible(),true);
        assert.equal(await dashboard.locator('#genericInsightsOpen').isVisible(),true);
        assert.match(await dashboard.locator('#genericTripMeta').innerText(),/Riga → Tallinn/);
      }else if(key==='eivissa'){
        await dashboard.locator('#tripHome').waitFor({state:'visible'});
        const live=await dashboard.locator('#tripHome').boundingBox();
        const prep=await dashboard.locator('#genericDashboardIntro').boundingBox();
        assert.ok(live.y<prep.y);
      }else if(key==='records'){
        assert.equal(await dashboard.locator('#genericPastRecordsSection').isVisible(),true);
        assert.equal(await dashboard.locator('#tripHome').isVisible(),false);
        assert.equal(await dashboard.locator('#genericDashboardIntro').isVisible(),false);
        assert.equal(await dashboard.locator('#genericPhotosModuleCard').isVisible(),false);
        assert.equal(await dashboard.locator('#genericTripSettingsToggle').isVisible(),false);
        assert.ok((await dashboard.locator('#genericPastRecordsSection').boundingBox()).y+
          (await dashboard.locator('#genericPastRecordsSection').boundingBox()).height<
          (await dashboard.locator('#genericConfirmedSection').boundingBox()).y);
      }else{
        assert.match(await grid.locator('[onclick]').getAttribute('onclick'),/freya-travel-v1\.5\/itinerary\.html/);
      }
      if(captures)await dashboard.screenshot({path:resolve(captures,`${mode}-${key}.png`)});
      const entry=dashboard.locator(key==='riga'?'#genericItineraryModuleCard':
        key==='records'?'#genericPastRecordsSection [data-open="travelBookView"]':'[data-open="checklistView"]');
      await entry.click();
      const target=page.locator(key==='riga'?'#itineraryView':key==='records'?'#travelBookView':'#checklistView');
      await target.waitFor({state:'visible'});
      await target.locator(key==='records'?'#travelBookBack':'[data-source-back]:visible,[data-back]:visible').first().click();
      await dashboard.waitFor({state:'visible'});
      if(key==='riga'){
        await dashboard.locator('#genericTravelersToggle').click();
        await dashboard.locator('#genericTravelersCard').waitFor({state:'visible'});
        await dashboard.locator('#genericTripSettingsToggle').click();
        await dashboard.locator('#genericTripSettingsCard').waitFor({state:'visible'});
      }
      await dashboard.locator('[data-trips-home],#backToTrips').click();
      await dashboard.waitFor({state:'hidden'});
      if(category)await page.locator(`#${category} [data-builder-back="tripsHomeView"]`).click();
      await home.waitFor({state:'visible'});
    }
    await page.setViewportSize({width:320,height:720});
    if(mode==='mobile'){
      await page.locator(`[data-select-trip="${fixtures[2].trip.id}"]:visible`).click();
      const narrowGrid=page.locator('#genericConfirmedSection .menu-grid');
      await narrowGrid.waitFor({state:'visible'});
      assert.equal(await narrowGrid.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),1);
    }
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`PASS ${mode} ${viewport.width}px: London, Riga/Tallinn, Eivissa active and past; headings, mosaic, access and return.`);
  }
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

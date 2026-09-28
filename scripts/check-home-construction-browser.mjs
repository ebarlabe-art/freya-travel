// Synthetic transport; actual Home markup, classification and rendering at 390px.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const markup=html.slice(html.indexOf('    <div id="tripsHomeView"'),html.indexOf('    <div id="genericDashboardView"'));
const pure=html.slice(html.indexOf('function homeTripPhase('),html.indexOf('function resetBuilderUi('));
const render=html.slice(html.indexOf('function renderTripsHome(){'),html.indexOf('// HOME-01 navigation'));
const load=html.slice(html.indexOf('async function loadHomeTrips('),html.indexOf('async function refreshTrips('));
const body=`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${html.match(/<style>([\s\S]*?)<\/style>/)[1]}</style><main class="shell">${markup}</main><script>
const $=id=>document.getElementById(id),esc=String,tripDuration=()=>null,isLondonTrip=()=>false,tripDateRange=()=>'';let trip=null,trips=[];
function openHomeTrip(id){history.pushState({detail:id},'');$('constructionView').classList.add('hidden');$('tripsHomeView').classList.remove('hidden')}
window.onpopstate=()=>{$('tripsHomeView').classList.add('hidden');$('constructionView').classList.remove('hidden')};
${pure}${render}${load}
const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[{trip_id:'tb'}]})};
const client={rpc:async()=>({data:[{id:'tb',name:'Viatge TB',start_date:null,end_date:null,time_zone:'Europe/Madrid'},{id:'legacy',name:'Legacy',start_date:null,end_date:null}]}),from:()=>q};
(async()=>{trips=await loadHomeTrips(client,'owner',()=>true);renderTripsHome();$('tripsHomeView').classList.add('hidden');$('constructionView').classList.remove('hidden')})();</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(body)});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});const ctx=await browser.newContext({viewport:{width:390,height:844}});let p=await ctx.newPage();const url=`http://127.0.0.1:${server.address().port}`;
 for(let i=0;i<3;i++){if(i===2){await p.close();p=await ctx.newPage()}p.on('pageerror',e=>console.error(e.message));await p.goto(url);await p.locator('#constructionTripsList [data-select-trip="tb"]').waitFor();assert.equal(await p.locator('[data-select-trip="tb"]').count(),1);assert.equal(await p.locator('#undatedTripsList [data-select-trip="legacy"]').count(),1);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)}
 await p.locator('#constructionTripsList button').click();await p.goBack();await p.locator('#constructionView').waitFor({state:'visible'});console.log('PASS 4/4: mobile single card/no duplication, reload, reopened context page, Back');
}finally{await browser?.close();await new Promise(r=>server.close(r))}

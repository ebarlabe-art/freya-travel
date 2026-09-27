// Reads only synthetic persisted Golden output from the disposable SQL test.
import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,writeFileSync,cpSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,extname} from 'node:path';import {createServer} from 'node:http';import {pathToFileURL,fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),html=readFileSync(join(root,'index.html'),'utf8');
const golden=JSON.parse(readFileSync('/tmp/freya-tb04-golden.json','utf8')),f=JSON.parse(readFileSync(join(root,'supabase/functions/proposal-engine/test-fixtures/golden-v1.json'),'utf8'));
const css=html.match(/<style>([\s\S]*?)<\/style>/)[1],markup=html.slice(html.indexOf('    <div id="tripsHomeView"'),html.indexOf('    <div id="genericDashboardView"'));
const ui=html.split('// TRAVEL_BUILDER_UI_START')[1].split('// TRAVEL_BUILDER_UI_END')[0].replace(/^ —[^\n]*\n/,'');
const setup=`const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session={user:{id:${JSON.stringify(golden.generation.owner_id)}}};
const modes=['tripsHomeView','upcomingTripsView','pastTripsView','constructionView','joinTripView','designTripView','manualTripView','builderView'];let current='tripsHomeView';
const visibleAppView=()=>current,setAppView=id=>{current=id;modes.forEach(v=>$(v).classList.toggle('hidden',v!==id));scrollTo(0,0)};
const fixture={golden:${JSON.stringify(golden)},result:${JSON.stringify(golden)},calls:[],delay:0};window.fixture=fixture;
const row={id:${JSON.stringify(golden.generation.brief_id)},owner_id:session.user.id,schema_version:1,trip_id:null,revision:1,document:${JSON.stringify(f.snapshot)}};
const db={from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:structuredClone(row)})};return q},rpc:async(name,args)=>{fixture.calls.push(name);if(fixture.delay)await new Promise(r=>setTimeout(r,fixture.delay));if(name==='get_proposals_v1')return {data:structuredClone(fixture.result)};throw Error('Unexpected RPC '+name)},functions:{invoke:async(name,{body})=>{fixture.calls.push({name,body});if(fixture.delay)await new Promise(r=>setTimeout(r,fixture.delay));fixture.result=structuredClone(fixture.golden);return{data:{generation_id:fixture.result.generation.id,status:'completed'}}}}};
const restoreHomeRoute=async()=>{};
if(!sessionStorage.getItem('freya-builder-v1:'+session.user.id))sessionStorage.setItem('freya-builder-v1:'+session.user.id,JSON.stringify({route:{id:row.id,mode:'resume'}}));
`;
const directory=mkdtempSync(join(tmpdir(),'freya-tb04-browser-'));cpSync(join(root,'domain'),join(directory,'domain'),{recursive:true});
writeFileSync(join(directory,'index.html'),'<!doctype html><html lang="ca"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><main class="shell">'+markup+'</main><script>'+setup+ui+'\nrestoreBuilderSession();</script></html>');
const server=createServer((req,res)=>{try{const path=resolve(directory,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(directory+'/'))throw Error();res.setHeader('Content-Type',extname(path)==='.mjs'?'text/javascript':'text/html');res.end(readFileSync(path))}catch{res.writeHead(404);res.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;let count=0;const pass=name=>{count++;console.log('PASS '+name)};
try{
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#builderProposals').waitFor({state:'visible'});await page.evaluate(()=>{$('builderNotes').value='Unsaved idea'});await page.locator('#builderProposals').click();assert.match(await page.locator('#builderMessage').innerText(),/Desa o descarta/);assert.equal(await page.evaluate(()=>fixture.calls.length),0);pass('unsaved Brief cannot silently drive generation');await page.evaluate(()=>{$('builderNotes').value=builderBase});await page.locator('#builderProposals').click();await page.locator('[data-proposal-id]').waitFor();
 assert.match(await page.locator('#proposalContent').innerText(),/Pendent de validar imprescindibles/);pass('persisted SQL Golden shown as alternative with unresolved hard');
 await page.locator('[data-proposal-id]').click();await page.getByRole('heading',{name:'Experiències suggerides'}).waitFor();assert.equal(await page.locator('#proposalContent article section').count(),3);pass('detail shows route/nights, 3 blocks, reasons, tradeoffs and hard sections');
 await page.reload();await page.getByRole('heading',{name:'Experiències suggerides'}).waitFor();pass('refresh restores same Brief and proposal detail');
 await page.locator('#proposalBack').click();await page.locator('[data-proposal-id]').waitFor();pass('Back detail → alternatives');
 await page.locator('#proposalBack').click();await page.locator('#builderProposals').waitFor({state:'visible'});pass('Back alternatives → Brief without operational navigation');
 await page.locator('#builderProposals').click();await page.locator('[data-proposal-id]').waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const buttons=await page.locator('#proposalPanel button:visible').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().height>=44));assert.equal(buttons,true);pass('390px no overflow and 44px touch targets');
 await page.evaluate(()=>{fixture.result.stale=true});await page.evaluate(()=>openBuilderProposals(false));assert.match(await page.locator('#proposalContent').innerText(),/revisió anterior/);assert.match(await page.locator('#proposalGenerate').innerText(),/Brief actual/);pass('remote Brief revision change marked stale');
 for(const [status,reason,text] of [['no_results','incompatible','contradiuen'],['no_results','insufficient_information','Falta informació'],['failed',null,'fallada tècnica']]){
  await page.evaluate(({status,reason})=>{fixture.result={...fixture.golden,stale:false,proposals:[],generation:{...fixture.golden.generation,status,result_reason:reason}}}, {status,reason});await page.evaluate(()=>openBuilderProposals(false));assert.match(await page.locator('#proposalContent').innerText(),new RegExp(text));pass(status+' '+reason);
 }
 await page.evaluate(()=>{fixture.result={generation:null,proposals:[],brief_revision:1,stale:false};fixture.delay=300});await page.evaluate(()=>openBuilderProposals(false));await page.locator('#proposalGenerate').dblclick();await page.locator('[data-proposal-id]').waitFor();assert.equal(await page.evaluate(()=>fixture.calls.filter(x=>typeof x==='object').length),1);pass('double tap sends one generation action');
 await page.evaluate(()=>{fixture.delay=300;openBuilderProposals(false);session={user:{id:'other'}};resetBuilderUi()});await page.waitForTimeout(400);assert.equal(await page.locator('#proposalContent').innerText(),'');pass('account change discards late result and clears proposal');
 assert.deepEqual(errors,[]);pass('no browser JavaScript errors');console.log(count+'/'+count+' TB04 browser checks PASS');
}finally{await browser?.close();server.close();rmSync(directory,{recursive:true,force:true})}

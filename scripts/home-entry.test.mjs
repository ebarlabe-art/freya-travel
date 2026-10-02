import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const builder=html.split('// TRAVEL_BUILDER_UI_START')[1].split('// TRAVEL_BUILDER_UI_END')[0].replace(/^ —[^\n]*\n/,'');
const home=html.slice(html.indexOf('function renderTripsHome(){'),html.indexOf('function updateTripPresentation(){'));
function harness(){
 const nodes=new Map(),listeners={},docListeners={};
 const $=id=>{if(!nodes.has(id)){const hidden=new Set();nodes.set(id,{value:'',textContent:'',innerHTML:'',removeAttribute(){},setAttribute(){},disabled:false,classList:{add:k=>hidden.add(k),contains:k=>hidden.has(k),toggle(k,yes){yes?hidden.add(k):hidden.delete(k)}},querySelectorAll:()=>[]})}return nodes.get(id)};
 const ctx=vm.createContext({setInterval,clearInterval,console,Date,Intl,session:{user:{id:'u'}},trips:[],trip:null,history:{state:null,pushState(s){this.state=s},replaceState(s){this.state=s},back(){this.backCalled=true}},window:{addEventListener:(k,f)=>(listeners[k]??=[]).push(f)},document:{visibilityState:'visible',querySelectorAll:()=>[],addEventListener:(k,f)=>docListeners[k]=f},sessionStorage:{getItem:()=>null,setItem(){}},confirm:()=>true,$,esc:String,db:{},visibleAppView:()=>ctx.view||'tripsHomeView',setAppView:v=>ctx.view=v,selectTrip:async(id)=>{ctx.selected=id;ctx.view='genericDashboardView'},tripDuration:()=>1,isLondonTrip:()=>false,tripDateRange:()=>'',clearTimeout:()=>{},setTimeout:(fn,ms)=>{ctx.timer={fn,ms};return 1}});
 vm.runInContext(builder,ctx);vm.runInContext(home,ctx);
 const realLoadBuilderList=ctx.loadBuilderList;
 ctx.getBuilderController=async()=>({controller:{state:{}}});ctx.loadBuilderList=()=>ctx.loadedBriefs=true;
 return {s:ctx,$,realLoadBuilderList,pop:state=>listeners.popstate.forEach(f=>f({state})),docListeners};
}
const trip=(fields={})=>({id:'t',name:'Trip',start_date:'2026-09-10',end_date:'2026-09-12',time_zone:'Europe/Madrid',...fields});
test('trip-local inclusive start/end; future and past',()=>{
 const {s}=harness();for(const [now,expected] of [['2026-09-09T21:59:59Z','upcoming'],['2026-09-09T22:00:00Z','active'],['2026-09-12T21:59:59Z','active'],['2026-09-12T22:00:00Z','past']])assert.equal(s.homeTripPhase(trip(),now),expected);
});
test('same instant uses each destination timezone, including across midnight and DST',()=>{
 const {s}=harness();const now='2026-09-10T00:30:00Z';assert.equal(s.homeTripPhase(trip({time_zone:'America/Los_Angeles'}),now),'upcoming');assert.equal(s.homeTripPhase(trip({time_zone:'Asia/Tokyo'}),now),'active');
 const dst=trip({start_date:'2026-03-29',end_date:'2026-03-29'});assert.equal(s.homeTripPhase(dst,'2026-03-29T21:59:59Z'),'active');assert.equal(s.homeTripPhase(dst,'2026-03-29T22:00:00Z'),'past');
});
test('missing/invalid dates and timezone are undated, never fabricated upcoming',()=>{
 const {s}=harness();for(const patch of [{start_date:null},{end_date:null},{start_date:null,end_date:null},{time_zone:null},{time_zone:'invalid'},{start_date:'2026-02-31'},{end_date:'2026-01-01'}])assert.equal(s.homeTripPhase(trip(patch),'2026-09-09T12:00:00Z'),'undated');
});
test('London and Eivissa are past using only real metadata, independent of their names',()=>{
 const {s}=harness();for(const t of [trip({name:'Londres',start_date:'2026-08-06',end_date:'2026-08-11',time_zone:'Europe/London'}),trip({name:'Eivissa',start_date:'2026-09-09',end_date:'2026-09-13'})]){assert.equal(s.homeTripPhase(t,'2026-09-26T12:00:00Z'),'past');assert.equal(s.homeTripPhase({...t,name:'Different',experience_key:null},'2026-09-26T12:00:00Z'),'past')}
});
test('five doors; forms are outside Home; active above doors and undated below',()=>{
 const entry=html.split('id="tripsHomeView"')[1].split('id="upcomingTripsView"')[0];assert.equal((entry.match(/data-home-view=/g)||[]).length,5);assert.doesNotMatch(entry,/<form|inviteInput|builderBriefList/);assert.ok(entry.indexOf('id="homeActive"')<entry.indexOf('class="home-doors"'));assert.match(entry,/Dates pendents/);
 const design=html.split('id="designTripView"')[1].split('id="manualTripView"')[0];assert.equal((design.match(/data-builder-mode=/g)||[]).length,3);assert.doesNotMatch(design,/builderBriefList/);assert.match(design,/Afegeix el meu viatge/);
 const construction=html.split('id="constructionView"')[1].split('id="designTripView"')[0];assert.match(construction,/Idees en esborrany.*builderBriefList/s);assert.doesNotMatch(construction,/data-builder-mode/);
 const join=html.split('id="joinTripView"')[1].split('id="constructionView"')[0];assert.match(join,/inviteInput/);
});
test('empty trips hide conditional blocks and show category empty states',()=>{
 const {s,$}=harness();s.renderTripsHome();assert.ok($('homeActive').classList.contains('hidden'));assert.ok($('homeUndated').classList.contains('hidden'));assert.ok(!$('homeTripsEmpty').classList.contains('hidden'));assert.match($('upcomingTripsList').innerHTML,/Encara no tens/);assert.match($('pastTripsList').innerHTML,/Encara no tens/);
});
test('active and undated visible on Home; categories are exclusive and cards remain operational',()=>{
 const {s,$}=harness();s.trips=[trip({id:'a',start_date:'2000-01-01',end_date:'2099-12-31'}),trip({id:'u',start_date:null,end_date:null}),trip({id:'p',start_date:'2000-01-01',end_date:'2000-01-02'}),trip({id:'f',start_date:'2099-01-01',end_date:'2099-01-02'})];s.renderTripsHome();for(const [id,list] of [['a','activeTripsList'],['u','undatedTripsList'],['p','pastTripsList'],['f','upcomingTripsList']])assert.equal(($ (list).innerHTML.match(/data-select-trip="([^"]+)"/)||[])[1],id);assert.ok(!$('homeActive').classList.contains('hidden'));assert.ok(!$('homeUndated').classList.contains('hidden'));
});
test('category Back, owner isolation and refresh do not create trips or briefs',async()=>{
 const h=harness();h.s.navigateBuilder('pastTripsView');assert.equal(h.s.view,'pastTripsView');h.s.builderBack('tripsHomeView');assert.equal(h.s.history.backCalled,true);h.pop({builderNav:{owner:'u',view:'tripsHomeView',depth:0}});assert.equal(h.s.view,'tripsHomeView');h.s.history.state={builderNav:{owner:'u',view:'constructionView',depth:1}};await h.s.restoreHomeRoute();assert.equal(h.s.view,'constructionView');assert.equal(h.s.loadedBriefs,true);h.s.history.state={builderNav:{owner:'alien',view:'joinTripView'}};await h.s.restoreHomeRoute();assert.equal(h.s.view,'constructionView');
});
test('category → trip → Back and forward, plus detail refresh',async()=>{
 const h=harness();h.s.trips=[trip()];h.s.navigateBuilder('pastTripsView');const parent=h.s.history.state;await h.s.openHomeTrip('t');const detail=h.s.history.state;assert.equal(h.s.selected,'t');h.s.returnFromHomeTrip();assert.equal(h.s.history.backCalled,true);h.s.history.state=parent;h.pop(parent);assert.equal(h.s.view,'pastTripsView');h.s.history.state=detail;h.pop(detail);assert.equal(h.s.view,'genericDashboardView');h.s.view='tripsHomeView';await h.s.restoreHomeRoute();assert.equal(h.s.view,'genericDashboardView');
});
test('manual/join parents preserved; photo and operational navigation not hijacked',async()=>{
 for(const parent of ['manualTripView','joinTripView']){const h=harness();h.s.view=parent;h.s.recordHomeTripEntry('t');assert.equal(h.s.history.state.homeTripDetail.parent,parent);for(const view of ['photosView','documentsView','itineraryView']){h.s.view=view;h.pop({builderNav:{owner:'u',view:parent}});assert.equal(h.s.view,view)}}
});
test('operational Builder trips in construction expose safe discard only for owned handoffs',()=>{
 const {s,$}=harness();s.trips=[trip({id:'b',start_date:null,end_date:null,tb_handoff:true,is_owner:true})];s.renderTripsHome();assert.match($('constructionTripsList').innerHTML,/data-discard-trip="b"/);
 s.trips=[trip({id:'s',start_date:null,end_date:null,tb_handoff:true,is_owner:false})];s.renderTripsHome();assert.doesNotMatch($('constructionTripsList').innerHTML,/data-discard-trip=/);
});
test('clock repaints at next minute boundary and resumes on visibility without backend requests',()=>{
 const h=harness();h.s.updateHomeClock();assert.ok(h.s.timer.ms>0&&h.s.timer.ms<=60020);h.s.document.visibilityState='hidden';h.s.timer=null;h.s.updateHomeClock();assert.equal(h.s.timer,null);h.s.document.visibilityState='visible';h.docListeners.visibilitychange();assert.ok(h.s.timer);const clock=home.slice(home.indexOf('function updateHomeClock'));assert.doesNotMatch(clock,/db\.|loadBuilderList|selectTrip/);
});
test('join and manual mutation handlers, Photos and Smart Home remain byte-identical',()=>{
 const old=execFileSync('git',['show','HEAD:index.html'],{encoding:'utf8'});
 for(const [start,end] of [["$('createTripForm').onsubmit=","$('copyCode').onclick="],['// PHOTO_V2_START','// PHOTO_V2_END'],['// TRIP_HOME_PURE_START','// TRIP_HOME_PURE_END']]){assert.ok(html.includes(start));assert.equal(html.slice(html.indexOf(start),html.indexOf(end)),old.slice(old.indexOf(start),old.indexOf(end)))}
});
test('construction empty and multiple briefs keep truthful labels, without any mutation',async()=>{
 const h=harness();let rows=[];
 h.s.getBuilderController=async()=>({api:{withBriefTimeout:p=>p,listOpenBriefs:async()=>rows,briefLabel:r=>r.label},controller:{state:{}}});
 await h.realLoadBuilderList();assert.match(h.$('builderListMessage').textContent,/Encara no tens/);assert.ok(h.$('builderContinue').classList.contains('hidden'));
 rows=[{id:'new',label:'Riga',updated_at:'2026-09-26T10:00:00Z'},{id:'old',label:'Viatge en preparació',updated_at:'2026-09-25T10:00:00Z'}];await h.realLoadBuilderList();assert.match(h.$('builderBriefList').innerHTML,/Riga.*Viatge en preparació/s);assert.ok(!h.$('builderContinue').classList.contains('hidden'));
});
test('join normalizes the code, uses the existing RPC and opens the returned trip',async()=>{
 const h=harness();let called,opened;Object.assign(h.s,{msg(){},refreshTrips:async v=>opened=v});h.s.db={rpc:async(name,args)=>{called={name,args};return {data:[{id:'joined'}]}}};h.$('inviteInput').value=' abc ';
 const handler=html.slice(html.indexOf("$('joinTrip').onclick="),html.indexOf("$('copyCode').onclick="));vm.runInContext(handler,h.s);await h.$('joinTrip').onclick();assert.equal(called.name,'join_trip_v2');assert.equal(called.args.p_invite_code,'ABC');assert.equal(opened.preferredTripId,'joined');assert.equal(opened.open,true);assert.equal(h.$('joinTrip').disabled,false);
});
test('classification is independent of the device timezone',()=>{
 const code=builder.slice(builder.indexOf('function homeTripPhase'),builder.indexOf('function resetBuilderUi'));
 const program=code+";console.log(homeTripPhase("+JSON.stringify(trip())+",'2026-09-09T22:30:00Z'))";
 for(const TZ of ['Pacific/Honolulu','Asia/Tokyo','Europe/London'])assert.equal(execFileSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',env:{...process.env,TZ}}).trim(),'active');
});

test('TB handoff classifies undated trip once; legacy and dated TB keep temporal rules',()=>{
 const {s,$}=harness();s.trips=[trip({id:'tb',tb_handoff:true,start_date:null,end_date:null}),trip({id:'legacy',start_date:null,end_date:null})];
 s.renderTripsHome();assert.equal(($('constructionTripsList').innerHTML.match(/data-select-trip=/g)||[]).length,1);assert.doesNotMatch($('undatedTripsList').innerHTML,/data-select-trip="tb"/);assert.match($('undatedTripsList').innerHTML,/legacy/);
 for(const phase of ['upcoming','active','past']){const now={upcoming:'2026-09-09',active:'2026-09-11',past:'2026-09-13'}[phase];assert.equal(s.homeTripGroups([trip({tb_handoff:true})],now)[0].key,phase)}
 assert.equal(s.homeTripGroups([]).length,0);
 s.view='constructionView';s.recordHomeTripEntry('tb');assert.equal(s.history.state.homeTripDetail.parent,'constructionView');
});
test('fresh Home loads recover handoff provenance without persisted client state; user switch discards results',async()=>{
 const code=html.slice(html.indexOf('async function loadHomeTrips('),html.indexOf('async function refreshTrips('));const ctx=vm.createContext({});vm.runInContext(code,ctx);
 let reads=0;const client={rpc:async()=>({data:[trip({start_date:null,end_date:null})]}),from:name=>{assert.equal(name,'trip_proposal_handoffs');const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>{reads++;return {data:[{trip_id:'t'}]}}};return q}};
 for(let i=0;i<3;i++){const rows=await ctx.loadHomeTrips(client,'owner',()=>true);assert.equal(rows[0].tb_handoff,true);assert.equal(harness().s.homeTripGroups(rows)[0].key,'construction')}
 assert.equal(reads,3);assert.equal(await ctx.loadHomeTrips(client,'owner',()=>false),null);
 client.from=()=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[]})};return q};assert.equal((await ctx.loadHomeTrips(client,'owner',()=>true))[0].tb_handoff,false);
});

test('Builder distinguishes drafts from operational trips and offers direct open',()=>{
 assert.match(html,/function operationalTripForBrief\(/);
 assert.match(html,/data-open-operational-brief/);
 assert.match(html,/✅ Viatge creat/);
 assert.match(html,/Obre el viatge i afegeix reserves/);
 assert.match(html,/💭 Idea en esborrany/);
});

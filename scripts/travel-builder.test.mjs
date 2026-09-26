import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as api from '../domain/travel-builder.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.split('// TRAVEL_BUILDER_UI_START')[1].split('// TRAVEL_BUILDER_UI_END')[0].replace(/^ —[^\n]*\n/,'');
const row=(id='brief',fields={})=>({id,owner_id:'u',schema_version:1,trip_id:null,revision:1,updated_at:'2026-09-26T10:00:00Z',document:{decisions:{},scopes:{},travelers:{}},...fields});
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)}};
const known=(field,value)=>({field,scope:'global',knowledge:'known',origin:'explicit_user',strength:'preference',value});
function harness(){
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,classList:{add(){},toggle(){},contains(){return false}},querySelectorAll:()=>[],setAttribute(){}});return nodes.get(id)};
 const listeners={};const context=vm.createContext({console,Date,session:{user:{id:'u'}},sessionStorage:memory(),confirm:()=>true,history:{state:null,length:1,pushState(s){this.state=s;this.length++},replaceState(s){this.state=s},back(){this.backCalled=true}},window:{addEventListener:(event,fn)=>listeners[event]=fn},document:{querySelectorAll:()=>[]},$,esc:v=>String(v??''),db:{},visibleAppView:()=>context.view||'designTripView',setAppView:view=>context.view=view});
 vm.runInContext(code,context);context.loadBuilderApi=async()=>api;
 return {s:context,$,listeners,get:value=>vm.runInContext(value,context)};
}
function server(rows=[]){
 const calls=[];const client={rpc:async(name,payload)=>{
  calls.push({name,payload:structuredClone(payload)});
  let r=rows.find(r=>r.id===payload.p_brief_id);if(!r){r=row(payload.p_brief_id);rows.push(r)}
  if(payload.p_set.decisions)Object.assign(r.document.decisions,payload.p_set.decisions);
  r.revision++;return {data:{brief:structuredClone(r)}};
 },from:table=>{
  assert.equal(table,'trip_briefs');const filters={};let range=[0,99];
  const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q},is:(k,v)=>{filters[k]=v;return q},order:()=>q,range:(a,b)=>{range=[a,b];return q},maybeSingle:async()=>({data:rows.find(r=>r.id===filters.id)||null}),then:(a,b)=>Promise.resolve({data:rows.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v)).slice(range[0],range[1]+1)}).then(a,b)};
  return q;
 }};
 return {client,calls,rows};
}
test('known facts are truthful; unknown or unconfirmed destination never becomes a title',()=>{
 const r=row();assert.equal(api.briefLabel(r),'Viatge en preparació');
 r.document.decisions.dest={field:'destination',scope:'global',knowledge:'unknown',origin:'explicit_user'};
 assert.equal(api.briefLabel(r),'Viatge en preparació');
 r.document.decisions.dest=known('destination',{mode:'partial',places:['Riga','Tallinn']});
 r.document.decisions.dates=known('dates',{mode:'exact',start:'2026-12-26',end:'2027-01-02'});
 assert.match(api.briefLabel(r),/Riga \+ Tallinn.*2026-12-26/);
 r.document.decisions.dest.origin='interpreted_from_user';assert.doesNotMatch(api.briefLabel(r),/Riga/);
});
test('multiple drafts, owner filtering, open-only, recent order and paginated list',async()=>{
 const rows=Array.from({length:103},(_,i)=>row('r'+i,{updated_at:`2026-09-${String(i%20+1).padStart(2,'0')}T10:00:00Z`}));
 rows.push(row('alien',{owner_id:'other'}),row('formalized',{trip_id:'trip'}));
 const result=await api.listOpenBriefs(server(rows).client,'u');
 assert.equal(result.length,103);assert.ok(result.every(r=>r.owner_id==='u'&&r.trip_id===null));
 assert.ok(result.every((r,i)=>!i||result[i-1].updated_at>=r.updated_at));
 assert.deepEqual(await api.listOpenBriefs(server().client,'u'),[]);
});
test('three doors each create a new brief via TB01 only; resume never creates',async()=>{
 const {client,calls}=server(),store=memory(),c=new api.BuilderSession(client,'u',store),ids=[];
 for(const mode of Object.keys(api.builderModes)){c.prepareStart(mode);ids.push((await c.execute()).id)}
 assert.equal(new Set(ids).size,3);assert.ok(calls.every(c=>c.name==='apply_trip_brief_patch_v1'));
 await api.loadOwnedBrief(client,'u',ids[0]);assert.equal(calls.length,3);
 await assert.rejects(api.loadOwnedBrief(client,'other',ids[0]),/disponible/);
});
test('lost response and refresh reuse exact creation command and operation identity',async()=>{
 const storage=memory();let count=0;const calls=[];const client={rpc:async(name,payload)=>{calls.push(structuredClone(payload));if(++count===1)throw Error('network');return {data:{brief:row(payload.p_brief_id)}}}};
 let c=new api.BuilderSession(client,'u',storage);c.prepareStart('inspire');
 await assert.rejects(c.execute(),/network/);c=new api.BuilderSession(client,'u',storage);
 assert.throws(()=>c.prepareStart('idea'),/pendent/);await c.execute();assert.deepEqual(calls[0],calls[1]);assert.equal(c.state.pending,undefined);
 assert.equal(new api.BuilderSession(client,'other',storage).state.route,undefined);
});
test('notes use existing field, provenance, original CAS, stable retry and hard protection',async()=>{
 const r=row();r.document.decisions.existing=known('notes','Original');r.revision=8;
 const command=api.notesPatch(r,'Vull neu i Nadal.');
 assert.equal(command.p_expected_revision,8);assert.equal(command.p_set.decisions.existing.value,'Vull neu i Nadal.');
 assert.equal(command.p_set.decisions.existing.origin,'explicit_user');assert.equal(command.p_set.decisions.existing.field,'notes');
 r.document.decisions.existing.strength='hard';assert.throws(()=>api.notesPatch(r,'Nou'),/confirmar/);
 assert.deepEqual(api.notesPatch(r,'Nou',true).p_confirm_hard,['existing']);
 assert.deepEqual(api.notesPatch(r,'',true).p_remove,{decisions:['existing']});
 assert.throws(()=>api.notesPatch(r,'a'.repeat(2001),true),/2.000/);
});
test('storage failure prevents sending; timeout does not manufacture another command',async()=>{
 const c=new api.BuilderSession({rpc:()=>assert.fail()},'u',{getItem:()=>null,setItem:()=>{throw Error('quota')}});
 assert.throws(()=>c.prepareStart('idea'),/quota/);
 await assert.rejects(api.withBriefTimeout(new Promise(()=>{}),2),/mateixa/);
});
test('double tap on a door creates only one draft and never an operational trip',async()=>{
 const h=harness(),backend=server();h.s.db=backend.client;
 await Promise.all([h.s.startBuilder('inspire'),h.s.startBuilder('inspire')]);
 assert.equal(backend.calls.length,1);assert.equal(h.s.view,'builderView');assert.equal(h.get('builderRow.owner_id'),'u');
 assert.equal(backend.rows[0].trip_id,null);
});
test('resume partial brief shows known destination, notes, no new writes or repeated destination question',async()=>{
 const r=row();r.document.decisions.dest=known('destination',{mode:'known',places:['Riga']});r.document.decisions.notes=known('notes','M’agrada la neu');
 const h=harness(),backend=server([r]);h.s.db=backend.client;
 await h.s.resumeBuilder(r.id,'destination');
 assert.equal(backend.calls.length,0);assert.equal(h.$('builderNotes').value,'M’agrada la neu');
 assert.match(h.$('builderKnown').textContent,/Riga/);assert.match(h.$('builderPrompt').textContent,/Què més/);
});
test('CAS conflict keeps typed text and requires explicit reload; deleted brief cannot be resumed',async()=>{
 const h=harness(),backend=server([row()]);h.s.db=backend.client;await h.s.resumeBuilder('brief');
 h.$('builderNotes').value='Text local';h.s.db.rpc=async()=>({error:{code:'40001',message:'Conflict'}});
 await h.s.saveBuilderNotes({preventDefault(){}});
 assert.equal(h.$('builderNotes').value,'Text local');assert.equal(h.get('builderConflict'),true);
 assert.equal(h.$('builderSave').disabled,true);assert.match(h.$('builderMessage').textContent,/altre dispositiu/);
 const other=harness();other.s.db=server().client;await other.s.resumeBuilder('deleted');assert.equal(other.get('builderRow'),null);
 assert.match(other.$('builderListMessage').textContent,/no està disponible/);
});
test('pending operation survives refresh and restoration never writes until retry',async()=>{
 const h=harness(),backend=server();h.s.db=backend.client;
 const c=new api.BuilderSession(backend.client,'u',h.s.sessionStorage);c.prepareStart('idea');
 await h.s.restoreBuilderSession();assert.equal(h.s.view,'builderView');assert.equal(backend.calls.length,0);
 assert.equal(h.$('builderNotes').disabled,true);await h.s.runBuilderPending();assert.equal(backend.calls.length,1);
});
test('logout during slow create cannot paint next user UI',async()=>{
 const h=harness();let finish;h.s.db={rpc:(name,p)=>new Promise(resolve=>finish=()=>resolve({data:{brief:row(p.p_brief_id)}}))};
 const pending=h.s.startBuilder('idea');await new Promise(resolve=>setImmediate(resolve));
 h.s.resetBuilderUi();h.s.session={user:{id:'other'}};finish();await pending;
 assert.equal(h.get('builderRow'),null);assert.equal(h.$('builderNotes').value,'');
});
test('Home groups active/future/past without changing trip data or selection',()=>{
 const h=harness(),trips=[{id:'past',start_date:'2026-01-01',end_date:'2026-01-02'},{id:'future',start_date:'2027-01-01',end_date:'2027-01-02'},{id:'now',start_date:'2026-09-25',end_date:'2026-09-27'}];
 const before=JSON.stringify(trips),groups=h.s.homeTripGroups(trips,'2026-09-26');
 assert.equal(groups.map(g=>g.label).join(','),'En curs,Propers,Passats');assert.equal(groups[0].rows[0].id,'now');assert.equal(JSON.stringify(trips),before);
});
test('separate views, complete manual form, old Search entry removed, backend intact',()=>{
 assert.match(html,/id="designTripView"/);assert.match(html,/id="manualTripView"/);assert.match(html,/id="builderView"/);
 const home=html.split('id="tripsHomeView"')[1].split('id="designTripView"')[0];assert.doesNotMatch(home,/createTripForm|tripSearchForm/);
 const manual=html.split('id="manualTripView"')[1].split('id="builderView"')[0];
 assert.match(manual,/id="createTripForm"[\s\S]*id="createTrip"[\s\S]*<\/form>/);
 assert.doesNotMatch(html,/Buscar amb Freya|createTripSearchMethod|tripSearchForm/);
 assert.match(html,/db.rpc\('create_trip_v2'/);assert.ok(readFileSync(new URL('../supabase/functions/travel-search/index.ts',import.meta.url),'utf8'));
 assert.doesNotMatch(code,/initialize_generic_trip_checklist|create_trip_v2|selectTrip\(/);
});
test('Back is owner-scoped, guards dirty state, ignores photo history and restored entry has safe fallback',async()=>{
 const h=harness();h.s.db=server([row()]).client;await h.s.resumeBuilder('brief','resume',true);
 assert.equal(h.s.history.state.builderNav.depth,0);h.s.builderBack('designTripView');assert.equal(h.s.history.backCalled,undefined);assert.equal(h.s.view,'designTripView');
 h.listeners.popstate({state:{freyaPhoto:{token:'photo'}}});assert.equal(h.s.view,'designTripView');
 h.listeners.popstate({state:{builderNav:{owner:'other',view:'tripsHomeView'}}});assert.equal(h.s.view,'designTripView');
});
test('Home popstate never hijacks NAV-01 return or operational trip views',()=>{
 const h=harness();for(const view of ['photosView','genericDashboardView','itineraryView','documentsView']){
  h.s.view=view;h.listeners.popstate({state:{builderNav:{owner:'u',view:'tripsHomeView'}}});assert.equal(h.s.view,view);
 }
});
test('manual create continues using operational RPC and opens the new trip',async()=>{
 const handler=html.slice(html.indexOf("$('createTripForm').onsubmit="),html.indexOf("$('joinTrip').onclick="));
 const h=harness();let rpc,refresh;
 Object.assign(h.s,{msg(){},console,refreshTrips:async options=>refresh=options});
 h.$('tripName').value='Roma';h.$('tripStartDate').value='2027-04-01';h.$('tripEndDate').value='2027-04-04';h.$('tripTimeZone').value='Europe/Rome';h.$('createTripForm').reset=()=>{};
 h.s.db={rpc:async(name,payload)=>{rpc={name,payload};return {data:[{id:'new-trip'}]}}};
 vm.runInContext(handler,h.s);await h.$('createTripForm').onsubmit({preventDefault(){}});
 assert.equal(rpc.name,'create_trip_v2');assert.equal(refresh.preferredTripId,'new-trip');assert.equal(refresh.open,true);assert.equal(h.$('createTrip').disabled,false);
});
test('PWA caches both TB01 and TB02 modules, legacy entries and reminder handlers remain',()=>{
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.match(sw,/\.\/domain\/travel-builder\.mjs/);assert.match(sw,/\.\/domain\/trip-brief\.mjs/);
 assert.match(sw,/freya-travel-v1.5\/itinerary.html/);assert.match(sw,/notificationclick/);
});
test('cannot forget a pending identity on storage read failure or post-response write failure',async()=>{
 assert.throws(()=>new api.BuilderSession({},'u',{getItem:()=>{throw Error('storage unavailable')}}),/storage unavailable/);
 const storage=memory(),set=storage.setItem;let writes=0,calls=[];
 storage.setItem=(k,v)=>{writes++;if(writes===3)throw Error('quota after response');set(k,v)};
 const client={rpc:async(name,p)=>{calls.push(structuredClone(p));return {data:{brief:row(p.p_brief_id)}}}};
 const c=new api.BuilderSession(client,'u',storage);c.prepareStart('idea');
 await assert.rejects(c.execute(),/quota/);assert.ok(c.state.pending);await c.execute();
 assert.deepEqual(calls[0],calls[1]);assert.equal(c.state.pending,undefined);
});

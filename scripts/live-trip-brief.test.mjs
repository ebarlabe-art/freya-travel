import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyBriefDocument} from '../domain/trip-brief.mjs';
import {BuilderSession} from '../domain/travel-builder.mjs';
import {fieldCommand,freeInterestCommand,travelersCommand,baggageValue,personalBaggageValue,formCommand,liveProjection,nextBlock,LiveBriefEditor,choices} from '../domain/live-trip-brief.mjs';
const row=()=>({id:'00000000-0000-4000-8000-000000000010',owner_id:'u',schema_version:1,trip_id:null,revision:1,document:emptyBriefDocument()});
const known=(field,value,strength='preference',scope='global')=>({field,scope,knowledge:'known',origin:'explicit_user',strength,value});
function apply(r,c){assert.equal(c.p_expected_revision,r.revision);for(const collection of ['decisions','travelers','scopes']){Object.assign(r.document[collection],c.p_set[collection]);for(const id of c.p_remove[collection]||[])delete r.document[collection][id]}r.revision++;return r}
const only=c=>Object.values(c.p_set.decisions)[0];
test('live projection shows confirmed facts only, truthful empty state, no inferred NLP',()=>{
 const r=row();assert.deepEqual(liveProjection(r),[]);
 r.document.decisions={unknown:{field:'dates',scope:'global',knowledge:'unknown',origin:'explicit_user'},pending:{...known('origin',{places:['Paris']}),origin:'interpreted_from_user'},note:known('notes','Vull Nadal, neu i motos de neu')};
 assert.equal(liveProjection(r).length,1);assert.equal(liveProjection(r)[0].block,'notes');assert.equal(Object.keys(r.document.decisions).length,3);
});
test('all doors share same model; initial priority and resume skip already answered questions',()=>{
 const r=row();assert.equal(nextBlock(r,'inspire'),'interests');assert.equal(nextBlock(r,'destination'),'destination');assert.equal(nextBlock(r,'idea'),'notes');
 r.document.decisions.d=known('destination',{mode:'known',places:['Riga']});assert.equal(nextBlock(r,'destination'),'dates');
 r.document.decisions.i={field:'interests',scope:'global',origin:'explicit_user',knowledge:'unknown'};assert.equal(nextBlock(r,'inspire'),'dates');
});
test('hard + preference are independent, changing or deleting one preserves the other',()=>{
 const r=row();r.document.decisions.snow=known('interest.snow',true,'hard');
 apply(r,fieldCommand(r,'interest.christmas_markets',{value:true}));
 const id=Object.keys(r.document.decisions).find(x=>x!=='snow');
 apply(r,fieldCommand(r,'interest.christmas_markets',{value:true,strength:'flexible'}));
 assert.equal(r.document.decisions.snow.strength,'hard');assert.equal(r.document.decisions[id].strength,'flexible');
 apply(r,fieldCommand(r,'interest.christmas_markets',{remove:true}));assert.deepEqual(Object.keys(r.document.decisions),['snow']);
 const command=fieldCommand(r,'interest.snow',{remove:true});assert.deepEqual(command.p_confirm_hard,['snow']);
});
test('custom interests have random IDs, preserve raw label, reject normalized duplicates and known collisions',()=>{
 const r=row();apply(r,freeInterestCommand(r,'  Foto nocturna  '));const d=Object.values(r.document.decisions)[0];assert.match(d.field,/^interest\.free\.[a-f0-9]{32}$/);assert.equal(d.label,'  Foto nocturna  ');
 assert.throws(()=>freeInterestCommand(r,'ＦＯＴＯ nocturna'),/existeix/);
 apply(r,fieldCommand(r,'interest.snow',{value:true}));assert.throws(()=>freeInterestCommand(r,' Neu '),/existeix/);
 assert.doesNotThrow(()=>freeInterestCommand(r,'Snow sports'));
});
test('30 interests bound includes unknown, and the 31st never becomes an operation',()=>{
 const r=row();for(let i=0;i<30;i++)apply(r,freeInterestCommand(r,'Interès '+i));assert.equal(liveProjection(r).length,30);assert.throws(()=>freeInterestCommand(r,'Un altre'),/30/);
});
test('legacy hard editable without conversion; new family rejected along global scope chain',()=>{
 const r=row();r.document.decisions.legacy=known('interests',['Neu','Nadal'],'hard');
 assert.throws(()=>fieldCommand(r,'interest.snow',{value:true}),/representació/);
 const command=formCommand(r,'interests',{text:'Neu\nNadal\nNatura'});assert.equal(only(command).strength,'hard');assert.deepEqual(command.p_confirm_hard,['legacy']);assert.equal(only(command).field,'interests');
 r.document.decisions.legacy.scope='stay';r.document.scopes.stay={kind:'stay',parent:'global',label:'Riga'};assert.throws(()=>fieldCommand(r,'interest.snow',{value:true}),/representació/);
});
test('multidestination uses boolean, indifferent/unknown discriminators, never destination count',()=>{
 const r=row();r.document.decisions.d=known('destination',{mode:'known',places:['Riga','Tallinn']});assert.equal(liveProjection(r).length,1);
 for(const value of [true,false]){const c=fieldCommand(r,'destination.multidestination',{value});assert.equal(only(c).value,value)}
 const i=only(fieldCommand(r,'destination.multidestination',{knowledge:'indifferent'}));assert.equal(i.knowledge,'indifferent');assert.ok(!('value' in i));
 const u=only(fieldCommand(r,'destination.multidestination',{knowledge:'unknown'}));assert.ok(!('strength'in u)&&!('value'in u));
});
test('exact/flexible dates replace one decision; null, invalid and reversed dates rejected',()=>{
 const r=row();apply(r,formCommand(r,'dates',{mode:'exact',start:'2026-12-26',end:'2027-01-02'}));
 apply(r,formCommand(r,'dates',{mode:'window',start:'2026-12-20',end:'2027-01-10'}));assert.equal(Object.keys(r.document.decisions).length,1);assert.deepEqual(Object.values(r.document.decisions)[0].value,{mode:'window',earliest:'2026-12-20',latest:'2027-01-10'});
 for(const start of ['','2026-02-30','2028-01-01'])assert.throws(()=>formCommand(r,'dates',{mode:'exact',start,end:'2027-01-02'}),/dates/);
});
test('budget modes retain semantics: stretch additional, discovery no invented amount',()=>{
 const r=row();for(const mode of ['price_discovery','target','maximum','target_stretch']){
  const v=only(formCommand(r,'budget',{mode,amount:'2000',stretch:'150',currency:'EUR'})).value;
  assert.equal(v.mode,mode);if(mode==='price_discovery')assert.ok(!('amount'in v));else assert.equal(v.amount,2000);if(mode==='target_stretch')assert.equal(v.stretch,150);
 }
 assert.throws(()=>formCommand(r,'budget',{mode:'target',amount:'',currency:'EUR'}));
});
test('direct hard changing to one stop retains strength and requires explicit confirmation',()=>{
 const r=row();r.document.decisions.stops=known('flight.max_stops',0,'hard');const c=fieldCommand(r,'flight.max_stops',{value:1});assert.equal(only(c).strength,'hard');assert.deepEqual(c.p_confirm_hard,['stops']);assert.equal(c.p_expected_revision,1);
});
test('hotel indifferent plus hard spa coexist; amenities individual, styles intentionally aggregate',()=>{
 const r=row();apply(r,fieldCommand(r,'hotel.comfort',{knowledge:'indifferent'}));apply(r,fieldCommand(r,'hotel.amenity.spa',{value:true,strength:'hard'}));apply(r,fieldCommand(r,'experience.styles',{value:['independent','guided_visit']}));
 assert.equal(liveProjection(r).length,3);assert.equal(liveProjection(r).find(x=>x.block==='amenities').strength,'hard');
});
test('multiple children preserve traveler IDs and unknown ages without inventing defaults',()=>{
 const r=row();apply(r,travelersCommand(r,2,[4,8,undefined]));const ids=Object.keys(r.document.travelers);apply(r,travelersCommand(r,2,[5,9,undefined]));assert.deepEqual(Object.keys(r.document.travelers),ids);assert.equal(Object.values(r.document.travelers).filter(t=>t.kind==='child').length,3);assert.match(liveProjection(r)[0].label,/edat pendent/);
 assert.throws(()=>travelersCommand(r,2,[18]));assert.throws(()=>travelersCommand(r,30,[2]));
});
test('shared baggage incoherence and orphan travelers blocked without silently removing bags',()=>{
 const r=row();assert.throws(()=>baggageValue(r,1,0,0,1),/viatgers/);apply(r,travelersCommand(r,2,[]));assert.throws(()=>baggageValue(r,1,1,1,1),/compartir/);
 apply(r,fieldCommand(r,'baggage',{value:baggageValue(r,1,0,0,1)}));assert.throws(()=>travelersCommand(r,1,[]),/equipatge/);assert.equal(Object.keys(r.document.travelers).length,2);
});
test('new structured commands survive refresh, lost response, retry and preserve exact CAS/operation',async()=>{
 const r=row(),map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},calls=[];let fail=true;
 const client={rpc:async(name,c)=>{calls.push(structuredClone(c));if(fail){fail=false;throw Error('slow network')}return {data:{brief:r}}}};
 const a=new BuilderSession(client,'u',storage),command=fieldCommand(r,'interest.snow',{value:true});a.prepareCommand(r,command);await assert.rejects(a.execute());
 const b=new BuilderSession(client,'u',storage);assert.throws(()=>b.prepareCommand(r,command),/pendent/);await b.execute();assert.deepEqual(calls[0],calls[1]);assert.equal(new BuilderSession(client,'other',storage).state.pending,undefined);
});
test('structured CAS rejection never rebases or silently creates a second operation',async()=>{
 const r=row(),map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};const c=new BuilderSession({rpc:async()=>({error:{code:'40001',message:'Conflict'}})},'u',storage);
 c.prepareCommand(r,fieldCommand(r,'pace',{value:'relaxed'}));const command=structuredClone(c.state.pending.command);await assert.rejects(c.execute(),e=>e.code==='40001');assert.deepEqual(c.state.pending.command,command);
});
test('UI submit locks double taps and honors cancelled hard confirmation',async()=>{
 let done,calls=0;const editor=new LiveBriefEditor({querySelectorAll:()=>[]},{save:async()=>{calls++;await new Promise(r=>done=r)},openNotes:()=>{}});editor.row=row();const c=fieldCommand(editor.row,'pace',{value:'relaxed'});const pending=editor.submit(()=>c);await editor.submit(()=>c);assert.equal(calls,1);done();await pending;
 globalThis.confirm=()=>false;c.p_confirm_hard=['protected'];await editor.submit(()=>c);assert.equal(calls,1);delete globalThis.confirm;
});
test('SQL and receipt contract untouched; all new assets cached, navigation scoped',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');assert.match(sw,/live-trip-brief\.mjs/);assert.match(html,/builderLive\?\.dirty/);assert.match(html,/Aquest viatge s’ha actualitzat en un altre lloc/);assert.match(html,/id="builderReview"/);
 assert.equal(choices['flight.departure_window'][0][1].min,'06:00');
});
test('travelers can describe children without inventing an accompanying adult; empty group rejected',()=>{
 const r=row();apply(r,travelersCommand(r,0,[12,14]));assert.equal(Object.values(r.document.travelers).some(t=>t.kind==='adult'),false);assert.throws(()=>travelersCommand(r,0,[]));
});
test('cancelled hard edit restores displayed selection; dirty form blocks competing writes',async()=>{
 let renders=0,calls=0,error;const editor=new LiveBriefEditor({querySelector:()=>({set textContent(v){error=v}}),querySelectorAll:()=>[]},{save:async()=>calls++,openNotes:()=>{}});editor.row=row();editor.row.document.decisions.s=known('interest.snow',true,'hard');editor.render=()=>renders++;globalThis.confirm=()=>false;
 await editor.submit(()=>fieldCommand(editor.row,'interest.snow',{value:true,strength:'flexible'}));delete globalThis.confirm;assert.equal(calls,0);assert.equal(renders,1);
 editor.dirty=true;await editor.submit(()=>fieldCommand(editor.row,'pace',{value:'active'}));assert.equal(calls,0);assert.match(error,/Desa o descarta/);
});
test('per-traveler baggage quantities differ while preserving existing weight, notes and stable IDs',()=>{
 const r=row();r.document.travelers={adult:{kind:'adult'},child:{kind:'child',age:8}};r.document.decisions.b=known('baggage',{per_traveler:{adult:[{kind:'cabin',quantity:1,weight_kg:10,note:'motxilla'}]}});
 const v=personalBaggageValue(r,{adult_personal:'1',adult_cabin:'2',adult_checked:'0',child_personal:'1',child_cabin:'0',child_checked:'0',shared:'1'});
 assert.equal(v.per_traveler.adult.find(b=>b.kind==='cabin').quantity,2);assert.equal(v.per_traveler.adult.find(b=>b.kind==='cabin').weight_kg,10);assert.equal(v.per_traveler.adult.find(b=>b.kind==='cabin').note,'motxilla');assert.equal(v.per_traveler.child.length,1);assert.equal(v.shared[0].quantity,1);
});

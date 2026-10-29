import test from 'node:test';import assert from 'node:assert/strict';
import {prepareReconciliationRequest,reconciliationPlan,reconciliationHtml,classifyReconciliationTiming} from '../domain/import-itinerary-reconciliation-ui.mjs';
const id=n=>'13000000-0000-4000-8000-'+String(n).padStart(12,'0');
const old={id:id(1),title:'Catedral de Riga',localDate:'2030-12-27',timeLabel:'10:00',status:'planned',updated_at:'2026-10-29T12:00Z',photo_count:0,link_count:0};
const item=(n,title,date='2030-12-28')=>({source_order:n,included:true,review_flags:[],values:{title,local_date:date,start_local_time:'10:00',time_zone:'Europe/Riga'}});
const context={tripId:id(2),documentId:id(3),userId:id(4),tripStartDate:'2030-12-26',tripEndDate:'2031-01-02',convertLocalTime:(local,zone)=>{assert.equal(zone,'Europe/Riga');return local.replace('10:00','08:00')+':00Z'}};
test('RIG03B explicit update reuses writer time conversion and stable identity without ownership fields',async()=>{
 const s={items:[item(0,'Catedral de Riga'),item(1,'Huskies opcionals')],read_only:true},r={existing:[old],decisions:[{source_order:0,action:'update',target_id:old.id},{source_order:1,action:'add'}],retire:[]};
 const p=await prepareReconciliationRequest(s,r,context);assert.equal(p.p_changes[0].id,old.id);assert.equal(p.p_changes[0].fields.local_date,null);assert.equal(p.p_changes[0].fields.starts_at,'2030-12-28T08:00:00Z');
 for(const c of p.p_changes)for(const key of ['created_by','trip_id','status','is_fixed','id'])assert.equal(key in c.fields,false,key);
 assert.equal(p.p_changes[1].fields.is_optional,true);assert.equal(p.p_expected_existing.length,1);
});
test('RIG03B keep protected existing is explicit and does not write; unsafe update rejected',()=>{
 const s={items:[item(0,'Catedral de Riga')],read_only:true},r={existing:[{...old,photo_count:2}],decisions:[{source_order:0,action:'keep',target_id:old.id}],retire:[]};
 assert.equal(reconciliationPlan(s,r).summary.preserved,1);assert.equal(reconciliationPlan(s,r).can_commit,false);
 r.decisions[0].action='update';assert.throws(()=>reconciliationPlan(s,r),/fotos/);
});
test('RIG03B generic museums on separate days remain distinct, all 25 require a decision',()=>{
 const s={items:Array.from({length:25},(_,i)=>item(i,i<2?'Museu':'Visita nova '+i,i===0?'2030-12-27':'2030-12-28')),read_only:true};
 const r={existing:[],decisions:[],retire:[]};assert.equal(reconciliationPlan(s,r).summary.pending,25);
 r.decisions=s.items.map(i=>({source_order:i.source_order,action:'add'}));assert.equal(reconciliationPlan(s,r).can_commit,true);
 assert.match(reconciliationHtml(s,r),/25 noves/);
});
test('RIG03B summary escapes PDF text and no pending proposal can be serialized',async()=>{
 const s={items:[item(0,'<img src=x onerror=alert(1)>')],read_only:true},r={existing:[],decisions:[],retire:[]};
 assert.doesNotMatch(reconciliationHtml(s,r),/<img/);await assert.rejects(prepareReconciliationRequest(s,r,context),/Resol totes/);
});


test('RIG03B real Riga PDF: tentative times stay approximate, conditional adventures stay optional',async()=>{
 const cases=[
  {title:'(orientatiu) Sortida de Riga cap a Sigulda',day:'2030-12-27',hour:'08:30',optional:false},
  {title:'SOFT-LUGE / SKELETONBOB, PENDENT DE RESERVA.',day:'2030-12-27',hour:'12:00',optional:true},
  {title:'(a confirmar) Excursió amb huskies; si no hi ha neu, alternativa de rodes',day:'2030-12-30',hour:'10:30',optional:true}
 ];
 const s={read_only:true,items:cases.map((c,i)=>({...item(i,c.title,c.day),values:{
  title:c.title,local_date:c.day,start_local_time:c.hour,time_zone:'Europe/Riga',location_name:'Lloc de prova'
 }}))};
 const state={existing:[],retire:[],decisions:s.items.map(x=>({source_order:x.source_order,action:'add'}))};
 const p=await prepareReconciliationRequest(s,state,{...context,convertLocalTime:(local,zone)=>{assert.equal(zone,'Europe/Riga');return local.replace('T','T')+':00Z'}});
 assert.equal(p.p_changes.length,3);
 for(const [i,c] of cases.entries()){
  const f=p.p_changes[i].fields;
  assert.equal(f.timing_kind,'approximate',c.title);
  assert.equal(f.local_date,c.day,c.title);
  assert.equal(f.approximate_start_time,c.hour,c.title);
  assert.equal(f.starts_at,null,c.title);
  assert.equal(f.ends_at,null,c.title);
  assert.equal(f.is_optional,c.optional,c.title);
 }
 assert.match(reconciliationHtml(s,state),/sense avís d’hora exacta/);
});
test('RIG03B confirmed time remains exact; provisional UPDATE retains approximate local clock',async()=>{
 const good=item(0,'Mirador de Sigulda amb hora confirmada');
 const tentative=item(1,'Visita a la Casa dels Caps Negres (orientatiu)');
 const s={read_only:true,items:[good,tentative]};
 const state={existing:[old],decisions:[{source_order:0,action:'add'},{source_order:1,action:'update',target_id:old.id}],retire:[]};
 const p=await prepareReconciliationRequest(s,state,context);
 assert.equal(p.p_changes[0].fields.timing_kind,'exact');
 assert.equal(p.p_changes[0].fields.starts_at,'2030-12-28T08:00:00Z');
 assert.equal(p.p_changes[1].id,old.id);
 assert.equal(p.p_changes[1].fields.timing_kind,'approximate');
 assert.equal(p.p_changes[1].fields.starts_at,null);
 assert.equal(p.p_changes[1].fields.approximate_start_time,'10:00');
 assert.equal(p.p_changes[1].fields.local_date,'2030-12-28');
});
test('RIG03B classifier distinguishes approximate time from optional activity without inventing confirmation',()=>{
 assert.deepEqual(classifyReconciliationTiming({title:'(orientatiu) Passeig a Riga'}),{is_optional:false,is_tentative:true});
 assert.deepEqual(classifyReconciliationTiming({title:'Excursió (a confirmar) segons disponibilitat'}),{is_optional:true,is_tentative:true});
 assert.deepEqual(classifyReconciliationTiming({title:'Motos de neu si hi ha neu'}),{is_optional:true,is_tentative:true});
 assert.deepEqual(classifyReconciliationTiming({title:'Museu de Riga, entrada confirmada 10:00'}),{is_optional:false,is_tentative:false});
});

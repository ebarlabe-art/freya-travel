import test from 'node:test';import assert from 'node:assert/strict';
import {prepareReconciliationRequest,reconciliationPlan,reconciliationHtml} from '../domain/import-itinerary-reconciliation-ui.mjs';
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

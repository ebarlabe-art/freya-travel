import test from 'node:test';
import assert from 'node:assert/strict';
import {planItineraryReconciliation} from '../domain/import-itinerary-reconciliation.mjs';
const id=(n)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const old=(n,title,date='2026-12-27',hour='10:00',other={})=>({
 id:id(n),title,localDate:date,timeLabel:hour,
 updated_at:'2026-10-29T12:00:'+String(n%60).padStart(2,'0')+'Z',
 status:'planned',photo_count:0,link_count:0,...other
});
const page=(order,title,date='2026-12-28',hour='09:30',other={})=>({
 source_order:order,included:true,
 values:{title,local_date:date,start_local_time:hour,time_zone:'Europe/Riga'},
 review_flags:[],...other
});
const pdf=(...items)=>({read_only:true,items});
const existing=[
 old(1,'Visita a la Catedral de Riga, plaça Doma laukums.'),
 old(2,'Visita exterior de la Casa dels Caps Negres, plaça Rātslaukums.'),
 old(3,'Passeig per la riba del riu Daugava.'),
 old(4,'Dinar lliure al centre de Riga.'),
 old(5,'Visita al Mercat Central de Riga (Rīgas Centrāltirgus).'),
 old(6,'Passeig pel Mercat de Nadal del centre històric.'),
 old(7,'Esmorzar lliure al centre de Riga.'),
 ...Array.from({length:6},(_,i)=>old(i+8,'Visita antiga '+(i+8),'2026-12-28'))
];
test('RIG-03: 13 old Riga visits remain unchanged and cannot be retired by merely importing a PDF',()=>{
 const before=structuredClone(existing);
 const items=[
  page(0,'SOFT-LUGE / SKELETONBOB PENDENT DE RESERVA','2026-12-27','12:00'),
  page(1,'Catedral de Riga i plaça principal del centre històric.'),
  page(2,'Casa dels Caps Negres i antiga plaça de l’Ajuntament.'),
  page(3,'Excursió amb huskies','2026-12-30','10:30')
 ];
 const snapshot=pdf(...items);
 const plan=planItineraryReconciliation({snapshot,existing});
 assert.equal(plan.read_only,true);
 assert.equal(plan.summary.pending,4);
 assert.equal(plan.summary.preserved,13);
 assert.equal(plan.summary.retired,0);
 assert.equal(plan.can_commit,false);
 assert.equal(plan.rows[1].matches[0].id,id(1));
 assert.equal(plan.rows[2].matches[0].id,id(2));
 assert.deepEqual(existing,before);
 assert.deepEqual(snapshot.items,items);
});
test('RIG-03: explicit selections may move named places and add Sigulda without duplicating',()=>{
 const snapshot=pdf(page(0,'SOFT-LUGE / SKELETONBOB PENDENT DE RESERVA','2026-12-27','12:00'),
  page(1,'Catedral de Riga i plaça principal del centre històric.'),
  page(2,'Casa dels Caps Negres i antiga plaça de l’Ajuntament.'));
 const plan=planItineraryReconciliation({snapshot,existing,decisions:[
  {source_order:0,action:'add'},
  {source_order:1,action:'update',target_id:id(1)},
  {source_order:2,action:'update',target_id:id(2)}
 ]});
 assert.deepEqual(plan.summary,{new:1,updated:2,skipped:0,pending:0,retired:0,preserved:11});
 assert.equal(plan.rows[1].expected_target_updated_at,existing[0].updated_at);
 assert.equal(plan.can_commit,true);
 assert.equal(plan.expected_existing.length,13);
});
test('RIG-03: no two PDF items may update the same existing visit',()=>{
 const snapshot=pdf(page(0,'Catedral de Riga'),page(1,'Catedral de Riga segona visita'));
 assert.throws(()=>planItineraryReconciliation({snapshot,existing,decisions:[
  {source_order:0,action:'update',target_id:id(1)},
  {source_order:1,action:'update',target_id:id(1)}
 ]}),/Dues activitats/);
});
test('RIG-03: no inferred deletion from missing PDF visits and only explicit retire IDs allowed',()=>{
 const plan=planItineraryReconciliation({snapshot:pdf(page(0,'Excursió a Sigulda')),
  existing,decisions:[{source_order:0,action:'add'}],retireExistingIds:[id(3)]});
 assert.equal(plan.summary.retired,1);
 assert.equal(plan.summary.preserved,12);
 assert.deepEqual(plan.retire[0],{id:id(3),expected_updated_at:existing[2].updated_at,title:existing[2].title});
});
test('RIG-03: cannot remove/update completed, photographed or linked visits',()=>{
 const sensitive=[
  old(21,'Castell ja visitat','2026-12-27','10:00',{status:'completed'}),
  old(22,'Mercat amb fotos','2026-12-27','11:00',{photo_count:1}),
  old(23,'Visita amb vincles','2026-12-27','12:00',{link_count:1})
 ];
 for(const row of sensitive){
  assert.throws(()=>planItineraryReconciliation({snapshot:pdf(page(0,'Nova visita')),
   existing:sensitive,retireExistingIds:[row.id]}),/no es pot retirar/);
  assert.throws(()=>planItineraryReconciliation({snapshot:pdf(page(0,'Nova visita')),
   existing:sensitive,decisions:[{source_order:0,action:'update',target_id:row.id}]}),/té progrés/);
 }
});
test('RIG-03: cannot turn an existing landmark match into duplicate add',()=>{
 const snapshot=pdf(page(0,'Catedral de Riga i plaça principal del centre històric.'));
 assert.throws(()=>planItineraryReconciliation({snapshot,existing,
  decisions:[{source_order:0,action:'add'}]}),/possible coincidència/);
});
test('RIG-03: conflicting choices, stale references and reusing a target to retire fail closed',()=>{
 const snapshot=pdf(page(0,'Castell de Sigulda'));
 assert.throws(()=>planItineraryReconciliation({snapshot,existing,
  decisions:[{source_order:0,action:'update',target_id:id(97)}]}),/ja no es troba/);
 assert.throws(()=>planItineraryReconciliation({snapshot,existing,
  decisions:[{source_order:0,action:'skip'},{source_order:0,action:'add'}]}),/repetida/);
 assert.throws(()=>planItineraryReconciliation({snapshot,existing,
  decisions:[{source_order:0,action:'update',target_id:id(1)}],
  retireExistingIds:[id(1)]}),/actualitzar i retirar/);
});
test('RIG-03: excluded items, missing day and invalid flags cannot slip into a commit',()=>{
 const excluded=page(0,'Mercat',undefined,undefined,{included:false});
 const review=pdf(excluded);
 assert.equal(planItineraryReconciliation({snapshot:review,existing}).summary.skipped,1);
 assert.throws(()=>planItineraryReconciliation({snapshot:review,existing,
  decisions:[{source_order:0,action:'add'}]}),/activitat exclosa/);
 const broken=pdf(page(0,'Dia indeterminat', '', '',{
  review_flags:['timezone_needs_confirmation']}));
 assert.throws(()=>planItineraryReconciliation({snapshot:broken,existing,
  decisions:[{source_order:0,action:'add'}]}),/nom i la data/);
});
test('RIG-03: server must compare all id+updated_at base rows to reject concurrent edits',()=>{
 const plan=planItineraryReconciliation({snapshot:pdf(page(0,'Nou')),existing,
  decisions:[{source_order:0,action:'add'}]});
 assert.deepEqual(plan.expected_existing.map(row=>row.id),existing.map(row=>row.id));
 assert.deepEqual(plan.expected_existing.map(row=>row.updated_at),existing.map(row=>row.updated_at));
 assert.equal(plan.requires_user_confirmation,true);
 assert.equal(Object.hasOwn(plan,'save'),false);
});

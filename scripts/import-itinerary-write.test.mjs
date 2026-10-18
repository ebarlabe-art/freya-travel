import test from 'node:test';
import assert from 'node:assert/strict';
import {findExistingItineraryImportItems,deselectExactImportDuplicates,stableItineraryImportId,prepareItineraryImportRows}
 from '../domain/import-itinerary-write.mjs';

const tripId='56c825cb-d857-42b5-a101-d53014b69df1';
const userId='c3ef7a60-4bc7-4f66-941c-7541b0ad1f90';
const documentId='c2fc6146-249f-416b-8f38-69c9d7809cb1';
const base={tripId,userId,documentId,tripStartDate:'2026-12-26',tripEndDate:'2027-01-02',
 convertLocalTime:(value,zone)=>{assert.equal(zone,'Europe/Riga');return value+'+02:00'}};
function item(order,title,date='2026-12-28',start='15:00',end='16:00'){
 return {source_order:order,included:true,original:{title,local_date:date,start_local_time:start},
  values:{title,local_date:date,start_local_time:start,end_local_time:end,time_zone:'Europe/Riga'},
  source_warnings:[],source_flags:[],confidence:{title:'high',local_date:'high'}};
}
const review=(...items)=>({read_only:true,items});
const snapshot=(...items)=>({read_only:true,items});

test('A2.8: duplicate rows from a source are safely deselected before confirmation',()=>{
 const r=review(item(0,'Passeig pel barri modernista'),item(1,'Passeig pel barri modernista'),item(2,'Museu'));
 const count=deselectExactImportDuplicates(r);
 assert.equal(count,1);
 assert.deepEqual(r.items.map(x=>x.included),[true,false,true]);
});

test('A2.8: 13 unique Riga activities can be prepared with exact day and zone',async()=>{
 const r=snapshot(item(0,'Visita museu','2026-12-28','10:30','12:00'),
  item(1,'Passeig parc','2026-12-28','11:45','12:15'),
  {...item(2,'Temps lliure','2026-12-28','',''),values:{
   title:'Temps lliure',local_date:'2026-12-28',daypart:'afternoon',start_local_time:'',end_local_time:''}});
 const rows=await prepareItineraryImportRows(r,base);
 assert.equal(rows.length,3);
 assert.equal(rows[0].timing_kind,'exact');
 assert.equal(rows[0].starts_at,'2026-12-28T10:30+02:00');
 assert.equal(rows[1].ends_at,'2026-12-28T12:15+02:00');
 assert.equal(rows[2].timing_kind,'daypart');
 assert.equal(rows[2].local_date,'2026-12-28');
 assert.equal(rows[2].daypart,'afternoon');
 assert.ok(rows.every(row=>row.trip_id===tripId&&row.created_by===userId&&row.status==='planned'));
});

test('A2.8: same document and row deterministically share a UUID; different rows do not',async()=>{
 const a=await stableItineraryImportId(tripId,documentId,3);
 const b=await stableItineraryImportId(tripId,documentId,3);
 const c=await stableItineraryImportId(tripId,documentId,4);
 assert.match(a,/^[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
 assert.equal(a,b);
 assert.notEqual(a,c);
});

test('A2.8: user selected duplicates are blocked, never saved automatically',async()=>{
 const r=snapshot(item(1,'Alberta iela'),item(2,'Alberta iela'));
 await assert.rejects(prepareItineraryImportRows(r,base),/duplicat seleccionat/i);
});
test('A2.8: existing rows belonging to another document cannot be overwritten',async()=>{
 const oldId=await stableItineraryImportId(tripId,documentId,1);
 const args={...base,existing:[{id:'c744d26d-ad12-4c78-8501-fffb01cf0b69',title:'Alberta iela',localDate:'2026-12-28',timeLabel:'15:00'}]};
 await assert.rejects(prepareItineraryImportRows(snapshot(item(1,'Alberta iela')),args),/ja consta al planning/);
 const idempotent={...base,existing:[{id:oldId,title:'Alberta iela',localDate:'2026-12-28',timeLabel:'15:00'}]};
 const rows=await prepareItineraryImportRows(snapshot(item(1,'Alberta iela')),idempotent);
 assert.equal(rows[0].id,oldId);
});
test('A2.8: incomplete date, zone, order and unknown trip are blocked',async()=>{
 await assert.rejects(prepareItineraryImportRows(snapshot(item(1,'Molt tard','2026-12-28','17:00','16:00')),base),/hora final/);
 await assert.rejects(prepareItineraryImportRows(snapshot(item(1,'Sense dia','','17:00','')),base),/data/);
 await assert.rejects(prepareItineraryImportRows(snapshot(item(1,'Fora viatge','2027-02-01','17:00','')),base),/dins de les dates/);
 await assert.rejects(prepareItineraryImportRows(snapshot(item(1,'Museu')), {...base,tripId:'intrus'}),/invàlid/);
 await assert.rejects(prepareItineraryImportRows(snapshot({...item(1,'Visita'),values:{...item(1,'Visita').values,time_zone:'Invalid/Zone'}}),base),/Zona horària/);
});

test('P0: existing import detection is exact, read-only, and independent of source document',()=>{
 const existing=[{id:'existing',title:'Esmorzar lliure al centre històric de Riga (Vecrīga).',localDate:'2026-12-27',timeLabel:'09:00'}];
 const match=item(0,existing[0].title,'2026-12-27','09:00','');
 const differentTime=item(1,existing[0].title,'2026-12-27','10:00','');
 const excluded={...match,included:false};
 const input=snapshot(match,differentTime,excluded),before=JSON.stringify([input,existing]);
 assert.deepEqual(findExistingItineraryImportItems(input,existing),[existing[0]]);
 assert.equal(JSON.stringify([input,existing]),before);
});

test('write guard blocks numeric fragments and midnight day conflicts, but writes only selected new rows',async()=>{
 await assert.rejects(()=>prepareItineraryImportRows(snapshot(item(0,'16.3')),base),/títol/);
 const old={title:'Arribada al nostre allotjament després del trajecte',localDate:'2026-12-27',timeLabel:'00:15'},before=structuredClone(old);
 const arrival=item(0,old.title+' nocturn','2026-12-28','00:15','');
 await assert.rejects(()=>prepareItineraryImportRows(snapshot(arrival),{...base,existing:[old]}),/altre dia/);
 const rows=await prepareItineraryImportRows(snapshot({...arrival,included:false},item(1,'Visita nova')),{...base,existing:[old]});
 assert.deepEqual(rows.map(x=>x.title),['Visita nova']);assert.deepEqual(old,before);
});

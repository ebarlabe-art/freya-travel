import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeImportProposal,
  importProposalSummary,
  importProposalCanWrite,
  importTargetFields
} from '../domain/import-proposal.mjs';

const field=(value,confidence='high',excerpt='Reserva confirmada')=>({
  value,confidence,evidence:[{kind:'text',excerpt,page:1}]
});
const flight=()=>({
  schema_version:1,
  source:{kind:'document',document_id:'doc-1',file_name:'booking.pdf',mime_type:'application/pdf'},
  target_type:'flight',
  fields:{
    airline:field('Air Baltic'),
    flight_number:field('BT684'),
    booking_reference:field('ABC123','medium','Booking reference ABC123')
  },
  missing_required:[],
  warnings:[]
});

test('normalitza una proposta read-only i preserva evidència',()=>{
  const p=normalizeImportProposal(flight());
  assert.equal(p.target_type,'flight');
  assert.equal(p.fields.flight_number.value,'BT684');
  assert.equal(p.fields.booking_reference.confidence,'medium');
  assert.equal(p.fields.booking_reference.evidence[0].page,1);
  assert.equal(importProposalCanWrite(),false);
});

test('rebutja camps operatius fora del contracte i camps privilegiats',()=>{
  for(const name of ['trip_id','created_by','id','totally_new_field']){
    const p=flight();p.fields[name]=field('forged');
    assert.throws(()=>normalizeImportProposal(p),e=>e.code==='forbidden_import_field');
  }
});

test('rebutja un tipus de peça desconegut',()=>{
  const p=flight();p.target_type='hotel_magic';
  assert.throws(()=>normalizeImportProposal(p),/Tipus de peça no suportat/);
});

test('una importació documental necessita document existent',()=>{
  const p=flight();delete p.source.document_id;
  assert.throws(()=>normalizeImportProposal(p),/document existent/);
});

test('cada camp necessita confiança i evidència explícites',()=>{
  const p=flight();delete p.fields.airline.confidence;
  assert.throws(()=>normalizeImportProposal(p),/Confiança invàlida/);
  const q=flight();q.fields.airline.evidence=[];
  assert.throws(()=>normalizeImportProposal(q),/evidència/);
});

test('no accepta objectes ni arrays com a valors extrets',()=>{
  const p=flight();p.fields.airline=field({name:'Air Baltic'});
  assert.throws(()=>normalizeImportProposal(p),/valors simples/);
  const q=flight();q.fields.airline=field(['Air Baltic']);
  assert.throws(()=>normalizeImportProposal(q),/valors simples/);
});

test('el resum assenyala qualsevol proposta que necessita revisió',()=>{
  const p=flight();
  const s=importProposalSummary(p);
  assert.equal(s.field_count,3);
  assert.equal(s.high_confidence_count,2);
  assert.equal(s.medium_confidence_count,1);
  assert.equal(s.needs_attention,true);
  const q=flight();q.fields.booking_reference.confidence='high';
  assert.equal(importProposalSummary(q).needs_attention,false);
});

test('els cinc tipus operatius tenen una allowlist explícita',()=>{
  assert.deepEqual(Object.keys(importTargetFields).sort(),['accommodation','activity','car_rental','flight','local_transport']);
  for(const fields of Object.values(importTargetFields)){
    assert.ok(fields.length>0);
    assert.equal(fields.includes('trip_id'),false);
    assert.equal(fields.includes('created_by'),false);
  }
});

test('deduplica pendents i avisos sense convertir-los en dades operatives',()=>{
  const p=flight();
  p.missing_required=['Zona horària','Zona horària'];
  p.warnings=['Data poc clara','Data poc clara'];
  const n=normalizeImportProposal(p);
  assert.deepEqual(n.missing_required,['Zona horària']);
  assert.deepEqual(n.warnings,['Data poc clara']);
});

test('transport local només admet camps del seu model operatiu',()=>{
  const p=flight();
  p.target_type='local_transport';
  p.fields={title:field('Riga → Tallinn'),transport_mode:field('bus'),transport_service_number:field('LUX-1')};
  const n=normalizeImportProposal(p);
  assert.equal(n.fields.transport_mode.value,'bus');
  const bad=structuredClone(p);bad.fields.vehicle_model=field('Forbidden');
  assert.throws(()=>normalizeImportProposal(bad),e=>e.code==='forbidden_import_field');
});

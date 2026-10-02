import test from 'node:test';
import assert from 'node:assert/strict';
import {extractImportProposalFromText,classifyImportText} from '../domain/import-text-extractor.mjs';

const source={kind:'document',document_id:'doc-1',file_name:'reservation.txt',mime_type:'text/plain'};

test('extreu un vol explícit sense escriure ni inventar camps',()=>{
  const p=extractImportProposalFromText(`
Flight confirmation
Airline: airBaltic
Flight number: BT684
Booking reference: ABC123
Departure: Barcelona
Arrival: Riga
`,source);
  assert.equal(p.target_type,'flight');
  assert.equal(p.fields.flight_number.value,'BT684');
  assert.equal(p.fields.booking_reference.value,'ABC123');
  assert.equal(p.fields.airline.value,'airBaltic');
  assert.equal('departure_city' in p.fields,false);
  assert.equal(p.source.document_id,'doc-1');
});

test('extreu un allotjament explícit',()=>{
  const p=extractImportProposalFromText(`
Hotel reservation confirmed
Hotel: Grand Poet Hotel and SPA
Check-in: 2026-12-26
Check-out: 2026-12-29
Booking reference: RIGA77
`,source);
  assert.equal(p.target_type,'accommodation');
  assert.equal(p.fields.name.value,'Grand Poet Hotel and SPA');
  assert.equal(p.fields.booking_reference.value,'RIGA77');
});

test('extreu una activitat explícita',()=>{
  const p=extractImportProposalFromText(`
Activity ticket
Activity: Riga bobsleigh experience
Provider: Sigulda Adventures
Booking reference: BOB88
Meeting point: Sigulda
`,source);
  assert.equal(p.target_type,'activity');
  assert.equal(p.fields.title.value,'Riga bobsleigh experience');
  assert.equal(p.fields.provider.value,'Sigulda Adventures');
});

test('extreu un lloguer de cotxe explícit',()=>{
  const p=extractImportProposalFromText(`
Car rental confirmation
Provider: Sixt
Booking reference: CAR55
Pick-up location: Riga Airport
Return location: Tallinn Airport
`,source);
  assert.equal(p.target_type,'car_rental');
  assert.equal(p.fields.provider.value,'Sixt');
  assert.equal(p.fields.pickup_location.value,'Riga Airport');
  assert.equal(p.fields.return_location.value,'Tallinn Airport');
});

test('no converteix una classificació ambigua en una proposta',()=>{
  assert.throws(
    ()=>extractImportProposalFromText('Booking confirmation reference ABC123 for your trip',source),
    e=>e.code==='ambiguous_import_type'
  );
});

test('no crea una proposta si només sap el tipus però no pot acreditar cap camp',()=>{
  assert.throws(
    ()=>extractImportProposalFromText('Flight departure arrival boarding information for your journey',source),
    e=>e.code==='no_import_fields'
  );
});

test('classificació és read-only i pot retornar desconegut',()=>{
  assert.deepEqual(classifyImportText('hello world'),{target_type:null,line_count:1});
});

import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('A2.3 exposes direct import in all five operational pieces',()=>{
  for(const type of ['flight','accommodation','activity','local_transport','car_rental']){
    assert.match(html,new RegExp('data-import-reservation="'+type+'"'));
  }
  assert.match(html,/id="reservationImportFile"[^>]*accept="application\/pdf,image\/png,image\/jpeg,image\/webp"/);
});

test('A2.3 review gate fills forms but never writes an operational piece itself',()=>{
  const apply=html.slice(html.indexOf('async function applyReservationImport(){'),html.indexOf('async function processReservationImportFile('));
  assert.match(apply,/selectedReservationImportFields/);
  assert.match(apply,/openFlightForm/);
  assert.match(apply,/openAccommodationForm/);
  assert.match(apply,/openActivityForm/);
  assert.match(apply,/openLocalTransportForm/);
  assert.match(apply,/openCarRentalForm/);
  assert.doesNotMatch(apply,/\.from\(['"]trip_(flights|accommodations|activities|car_rentals)['"]\).*\.(insert|update)\(/s);
  assert.doesNotMatch(apply,/\.rpc\(['"][^'"]*(create|save|confirm)/i);
});

test('low-confidence values are opt-in and proposal is revalidated client-side',()=>{
  assert.match(html,/const checked=field\.confidence!==['"]low['"]\?['"]checked['"]:['"]/);
  assert.match(html,/api\.normalizeImportProposal\(data\.proposal\)/);
  assert.match(html,/proposal\.source\.document_id!==document\.id/);
});

test('uploaded file becomes a private travel document before read-only extraction',()=>{
  const process=html.slice(html.indexOf('async function processReservationImportFile('),html.indexOf("document.querySelectorAll('[data-import-reservation]"));
  assert.ok(process.indexOf('uploadTripDocument(')<process.indexOf("db.functions.invoke('import-reservation'"));
  assert.match(process,/document_id:document\.id/);
});

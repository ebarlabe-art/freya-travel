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

test('flight UI keeps imported passenger names and renders saved notes',()=>{
  assert.match(html,/id="flightPassengers"/);
  assert.match(html,/passengers:'flightPassengers'/);
  assert.match(html,/passengers:nullable\(\$\('flightPassengers'\)\.value\)/);
  const render=html.slice(html.indexOf('function renderFlights(){'),html.indexOf('function flightDocumentLinksFor'));
  assert.match(render,/row\.notes/);
});

test('itinerary projection already includes dated flights and accommodation check-in/out with maps',()=>{
  const block=html.slice(html.indexOf('function normalizedItineraryProjection'),html.indexOf('function tripReviewSuggestionId'));
  assert.match(block,/flightRows\.forEach/);
  assert.match(block,/departure_at/);
  assert.match(block,/accommodationRows\.forEach/);
  assert.match(block,/check_in/);
  assert.match(block,/check_out/);
  assert.match(block,/accommodationMapUrl/);
});

test('accommodation import maps address and dates into the operational form',()=>{
  const apply=html.slice(html.indexOf('async function applyReservationImport(){'),html.indexOf('async function processReservationImportFile('));
  assert.match(apply,/address:'accommodationAddress'/);
  assert.match(apply,/check_in_at/);
  assert.match(apply,/check_out_at/);
});

test('multi-segment flight import creates separate rows under one booking document',()=>{
  assert.match(html,/async function createImportedFlightSegments/);
  assert.match(html,/proposal\.flight_segments\?\.length>1/);
  assert.match(html,/db\.from\('trip_flights'\)\.insert\(rows\)/);
  assert.match(html,/syncFlightDocument\(row\.id,'booking',document\.id/);
});

test('multi-segment imports materialize reusable travelers for every leg',()=>{
 const block=html.slice(html.indexOf('async function createImportedFlightSegments'),html.indexOf('async function applyReservationImport'));
 assert.match(block,/ensure_trip_flight_travelers/);
 assert.match(block,/p_flight_ids:\(data\|\|\[\]\)\.map\(row=>row\.id\)/);
 assert.match(block,/p_names:passengerNames/);
});

test('flight cards render travelers and individual boarding-pass controls',()=>{
 assert.match(html,/function flightTravelersFor/);
 assert.match(html,/function travelerBoardingPasses/);
 assert.match(html,/data-assign-traveler-document/);
 assert.match(html,/trip_flight_traveler_documents/);
 assert.match(html,/trip_flight_travelers/);
});


test('A2.4 can reuse an existing private trip document without uploading it again',()=>{
  assert.match(html,/id="reservationImportDocument"/);
  assert.match(html,/id="reservationImportUseDocument"/);
  assert.match(html,/id="reservationImportUploadNew"/);
  assert.match(html,/function reservationImportDocuments\(\)/);
  const process=html.slice(html.indexOf('async function processReservationImportDocument('),html.indexOf('async function processReservationImportFile('));
  assert.match(process,/document_id:document\.id/);
  assert.doesNotMatch(process,/uploadTripDocument/);
  const click=html.slice(html.indexOf("document.querySelectorAll('[data-import-reservation]"),html.indexOf("$('reservationImportClose').onclick"));
  assert.match(click,/showReservationImport\(reservationImportState\.target\)/);
  assert.match(click,/processReservationImportDocument\(document\)/);
});

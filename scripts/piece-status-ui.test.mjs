import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261001145500_unify_piece_reservation_status.sql',import.meta.url),'utf8');

const ids=['accommodationStatus','flightStatus','localTransportStatus','activityStatus','carRentalStatus'];

test('all booking-like travel pieces expose the same prominent four-state lifecycle',()=>{
  assert.equal((html.match(/<div class="piece-status-panel" data-piece-status-panel/g)||[]).length,ids.length);
  for(const id of ids){
    const at=html.indexOf('id="'+id+'"');
    assert.ok(at>=0,'missing '+id);
    const block=html.slice(at,at+500);
    for(const value of ['planning','reserved','confirmed','cancelled']){
      assert.match(block,new RegExp('value="'+value+'"'));
    }
  }
  assert.match(html,/ESTAT DE LA PEÇA/);
  assert.match(html,/Encara està en planificació i no es mostrarà com una peça activa del viatge/);
});

test('all operational piece entry points stay visible even before a reservation exists',()=>{
  assert.match(html,/id="genericConfirmedSection" class="generic-trip-section"/);
  for(const id of ['genericFlightsModuleCard','genericAccommodationModuleCard','genericActivitiesModuleCard','genericLocalTransportModuleCard','genericCarRentalModuleCard']){
    const at=html.indexOf('id="'+id+'"');
    assert.ok(at>=0,'missing '+id);
    assert.doesNotMatch(html.slice(at,at+180),/\bhidden\b/);
  }
  assert.match(html,/Afegeix vols/);assert.match(html,/Afegeix allotjament/);assert.match(html,/Afegeix activitats/);assert.match(html,/Afegeix transport/);assert.match(html,/Afegeix cotxe/);
});

test('database constraints allow reserved for flights and accommodations',()=>{
  assert.match(migration,/trip_flights_status_check[\s\S]*'planning','reserved','confirmed','cancelled'/);
  assert.match(migration,/trip_accommodations_reservation_status_check[\s\S]*'planning','reserved','confirmed','cancelled'/);
});

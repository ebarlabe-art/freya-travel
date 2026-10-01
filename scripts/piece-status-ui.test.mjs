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

test('reserved and confirmed pieces are both active in the trip home',()=>{
  assert.match(html,/flightRows\.filter\(row=>\['reserved','confirmed'\]\.includes\(row\.flight_status\)\)/);
  assert.match(html,/accommodationRows\.filter\(row=>\['reserved','confirmed'\]\.includes\(row\.reservation_status\)\)/);
  assert.match(html,/activityRowsForMode\('activity'\)\.filter\(row=>\['reserved','confirmed'\]\.includes\(row\.reservation_status\)\)/);
  assert.match(html,/activityRowsForMode\('local_transport'\)\.filter\(row=>\['reserved','confirmed'\]\.includes\(row\.reservation_status\)\)/);
  assert.match(html,/carRentalRows\.filter\(row=>\['reserved','confirmed'\]\.includes\(row\.reservation_status\)\)/);
});

test('database constraints allow reserved for flights and accommodations',()=>{
  assert.match(migration,/trip_flights_status_check[\s\S]*'planning','reserved','confirmed','cancelled'/);
  assert.match(migration,/trip_accommodations_reservation_status_check[\s\S]*'planning','reserved','confirmed','cancelled'/);
});

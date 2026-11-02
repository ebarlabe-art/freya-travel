import test from 'node:test';
import assert from 'node:assert/strict';
import {loadGroupedFlightCards} from '../domain/flight-card-loader.mjs';

test('loads one flight card with two passenger seats and individual boarding passes',async()=>{
 const data={
  trip_flights:[
   {id:'f1',trip_id:'t1',flight_number:'IB7848',departure_airport_code:'BCN',arrival_airport_code:'RIX',departure_at:'2026-12-26T16:00:00Z',departure_time_zone:'Europe/Madrid'},
   {id:'f2',trip_id:'t1',flight_number:'IB7848',departure_airport_code:'BCN',arrival_airport_code:'RIX',departure_at:'2026-12-26T16:00:00Z',departure_time_zone:'Europe/Madrid'}
  ],
  trip_flight_travelers:[{flight_id:'f1',traveler_id:'e',seat:'12A'},{flight_id:'f2',traveler_id:'x',seat:'12B'}],
  trip_travelers:[{id:'e',display_name:'Eva'},{id:'x',display_name:'Xesc'}],
  trip_flight_traveler_documents:[{flight_id:'f1',traveler_id:'e',document_id:'d1',document_role:'boarding_pass'},{flight_id:'f2',traveler_id:'x',document_id:'d2',document_role:'boarding_pass'}]
 };
 const client={from(name){return {select(){return {eq(key,value){assert.equal(key,'trip_id');assert.equal(value,'t1');return Promise.resolve({data:data[name],error:null})}}}}}};
 const cards=await loadGroupedFlightCards(client,'t1');
 assert.equal(cards.length,1);
 assert.equal(cards[0].flights.length,2);
 assert.deepEqual(cards[0].travelers.map(t=>[t.display_name,t.seat,t.documents[0].document_id]),[['Eva','12A','d1'],['Xesc','12B','d2']]);
});
test('rejects database errors rather than silently hiding passenger records',async()=>{
 const client={from(){return {select(){return {eq(){return Promise.resolve({data:null,error:new Error('db unavailable')})}}}}}};
 await assert.rejects(loadGroupedFlightCards(client,'t1'),/db unavailable/);
});

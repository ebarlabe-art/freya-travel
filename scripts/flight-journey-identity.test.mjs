import test from 'node:test';
import assert from 'node:assert/strict';
import {flightJourneyKey,groupFlightTickets,groupStoredFlightCards,groupFlightsWithTravelers} from '../domain/flight-journey-identity.mjs';
const base={date:'2026-12-26',flightNumber:'IB7848',origin:'BCN',destination:'RIX'};
test('same journey groups different passenger tickets without discarding either',()=>{
 const tickets=[{...base,passenger:'Eva',documentId:'a'},{...base,flightNumber:'IB 7848',passenger:'Xesc',documentId:'b'}];
 const groups=groupFlightTickets(tickets);
 assert.equal(groups.length,1);assert.equal(groups[0].tickets.length,2);
 assert.deepEqual(groups[0].tickets.map(t=>t.documentId),['a','b']);
});
test('distinct flights, routes and dates remain separate',()=>{
 const tickets=[base,{...base,flightNumber:'IB7849'},{...base,date:'2026-12-27'},{...base,destination:'HEL'}];
 assert.equal(groupFlightTickets(tickets).length,4);
});
test('incomplete flight identity never silently groups tickets',()=>{
 assert.equal(flightJourneyKey({...base,origin:''}),null);
 assert.equal(groupFlightTickets([{...base,origin:''},{...base,origin:''}]).length,2);
});

test('flight card shows one journey but retains passenger-specific details',()=>{
 const a={local_departure_date:'2026-12-26',flight_number:'IB7848',departure_airport_code:'BCN',arrival_airport_code:'RIX',passenger:'Eva',seat:'12A',booking_reference:'ABC',document_id:'doc-a'};
 const b={...a,passenger:'Xesc',seat:'12B',document_id:'doc-b'};
 const groups=groupStoredFlightCards([a,b]);
 assert.equal(groups.length,1);
 assert.deepEqual(groups[0].passengers.map(x=>[x.passenger,x.seat,x.document_id]),[['Eva','12A','doc-a'],['Xesc','12B','doc-b']]);
 assert.equal(groups[0].passengers[0].booking_reference,'ABC');
 assert.equal(groups[0].passengers[1].booking_reference,'ABC');
});
test('flight cards with missing identity are never merged',()=>{
 const a={local_departure_date:'2026-12-26',flight_number:'IB7848',departure_airport_code:'BCN'};
 assert.equal(groupStoredFlightCards([a,{...a}]).length,2);
});

test('uses real traveler associations and keeps separate seat assignments',()=>{
 const flight={local_departure_date:'2026-12-26',flight_number:'IB7848',departure_airport_code:'BCN',arrival_airport_code:'RIX'};
 const flights=[{...flight,id:'flight-a'},{...flight,id:'flight-b'}];
 const assignments=[{flight_id:'flight-a',traveler_id:'eva',seat:'12A'},{flight_id:'flight-b',traveler_id:'xesc',seat:'12B'}];
 const travelers=[{id:'eva',display_name:'Eva'},{id:'xesc',display_name:'Xesc'}];
 const groups=groupFlightsWithTravelers(flights,assignments,travelers);
 assert.equal(groups.length,1);
 assert.equal(groups[0].flights.length,2);
 assert.deepEqual(groups[0].travelers.map(t=>[t.display_name,t.seat]),[['Eva','12A'],['Xesc','12B']]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {flightJourneyKey,groupFlightTickets} from '../domain/flight-journey-identity.mjs';
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

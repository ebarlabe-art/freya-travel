import test from 'node:test';
import assert from 'node:assert/strict';
import {renderGroupedFlightCards,mountGroupedFlightCards} from '../domain/flight-card-ui.mjs';

test('renders one journey with two passengers and their own documents',()=>{
 const html=renderGroupedFlightCards([{journeyKey:'t|flight',flight:{flight_number:'IB7848',departure_airport_code:'BCN',arrival_airport_code:'RIX'},flights:[{id:'a'},{id:'b'}],travelers:[{display_name:'Eva',seat:'12A',documents:[{document_id:'doc-e',document_role:'boarding_pass'}]},{display_name:'Xesc',seat:'12B',documents:[{document_id:'doc-x',document_role:'boarding_pass'}]}]}]);
 assert.equal((html.match(/class="flight-journey-card"/g)||[]).length,1);
 for(const token of ['Eva','Xesc','12A','12B','doc-e','doc-x'])assert.ok(html.includes(token),token);
});
test('escapes untrusted passenger names and document attributes',()=>{
 const html=renderGroupedFlightCards([{flight:{flight_number:'IB7848'},flights:[{}],travelers:[{display_name:'<img src=x onerror=alert(1)>',documents:[{document_id:'" onmouseover="evil',document_role:'boarding_pass'}]}]}]);
 assert.ok(!html.includes('<img'));
 assert.ok(html.includes('&lt;img'));
 assert.ok(!html.includes('data-document-id=""'));
});
test('mount hook renders cards for a selected trip without modifying database',async()=>{
 const data={trip_flights:[{id:'f',trip_id:'t',flight_number:'IB7848',departure_airport_code:'BCN',arrival_airport_code:'RIX',departure_at:'2026-12-26T16:00:00Z',departure_time_zone:'Europe/Madrid'}],trip_flight_travelers:[],trip_travelers:[],trip_flight_traveler_documents:[]};
 const client={from(name){return {select(){return {eq(k,v){assert.equal(k,'trip_id');assert.equal(v,'t');return Promise.resolve({data:data[name],error:null})}}}}}};
 const container={innerHTML:''};
 const cards=await mountGroupedFlightCards(container,client,'t');
 assert.equal(cards.length,1);
 assert.match(container.innerHTML,/IB7848/);
});

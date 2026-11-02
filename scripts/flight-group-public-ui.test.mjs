import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('published UI groups existing BCN-RIX flight tickets without changing rows',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const start=html.indexOf('function groupFlightRowsForDisplay(rows){');
 const end=html.indexOf('\nfunction renderFlights()',start);
 assert.ok(start>=0&&end>start,'grouping function must exist in actual public entry');
 const code=html.slice(start,end);
 const context={Intl,Date,Map,trip:{id:'riga-trip'}};
 vm.createContext(context);
 const group=vm.runInContext(code+'\ngroupFlightRowsForDisplay',context);
 const base={trip_id:'riga-trip',flight_number:'IB7848',departure_airport_code:'BCN',arrival_airport_code:'RIX',departure_at:'2026-12-26T15:00:00Z',departure_time_zone:'Europe/Riga'};
 const rows=[{...base,id:'eva'},{...base,id:'xesc'}];
 const result=group(rows);
 assert.equal(result.length,1);
 assert.deepEqual(Array.from(result[0],row=>row.id),['eva','xesc']);
 assert.equal(rows.length,2);
});

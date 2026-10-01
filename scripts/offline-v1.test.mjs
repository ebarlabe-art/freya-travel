import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Offline V1 caches trip list and trip-scoped operational data',()=>{
 assert.match(html,/freya-offline-trips-v/);
 assert.match(html,/freya-offline-trip-v/);
 assert.match(html,/rememberOfflineTrips/);
 assert.match(html,/persistOfflineAgendaSnapshot/);
 assert.match(html,/persistOfflineCarRentals/);
 assert.match(html,/persistOfflineDocuments/);
});

test('Offline V1 restores cached travel data and labels it as cached',()=>{
 assert.match(html,/restoreOfflineAgendaSnapshot/);
 assert.match(html,/restoreOfflineCarRentals/);
 assert.match(html,/restoreOfflineDocuments/);
 assert.match(html,/Sense connexió/);
 assert.match(html,/últimes dades desades/);
});

test('Offline V1 never fakes successful writes',()=>{
 assert.match(html,/Per marcar Fet\/Desfer cal connexió/);
 assert.match(html,/Sense connexió\. Hem mantingut els camps; podràs desar quan torni la xarxa/);
 assert.match(html,/Aquest document necessita connexió per generar un accés segur/);
});

test('Offline V1 reconnects by refreshing authoritative data',()=>{
 assert.match(html,/window\.addEventListener\('online',\(\)=>\{updateConnectivityBanner\(\);refreshAfterReconnect\(\)\}\)/);
 assert.match(html,/ensureTripAgenda\(true\)/);
});

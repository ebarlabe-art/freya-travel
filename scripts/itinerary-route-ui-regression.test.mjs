import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../domain/itinerary-route-ui.mjs',import.meta.url),'utf8');
test('all adjacent activity pairs display actionable route state, even with missing locations',()=>{
 assert.doesNotMatch(code,/if\(!pair\.origin\.hasRoutePlace\|\|!pair\.destination\.hasRoutePlace\)continue/);
 assert.match(code,/if\(!pair\.origin\.hasRoutePlace\|\|!pair\.destination\.hasRoutePlace\)\{state\.result=\{error:'missing_place'/);
 assert.match(code,/data-route-review/);
 assert.match(code,/routeReasons\[reasonCode\]/);
});

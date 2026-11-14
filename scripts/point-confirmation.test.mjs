import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {editPointSearch,selectPointCandidate,pointSaveMessage} from '../domain/itinerary-place-points-ui.mjs';
import {pointSnapshot,samePointSnapshot} from '../domain/itinerary-place-points.mjs';
const place={provider:'geoapify',provider_place_id:'synthetic-luchon-confirmation',canonical_name:'Bagnères-de-Luchon',country_code:'FR',locality:'Bagnères-de-Luchon',kind:'city',latitude:42.79,longitude:0.59,coordinate_role:'representative_point',attribution:'Synthetic fixture'};
test('selection survives subsequent search text and snapshot serialization',()=>{
 const point={id:'p',query:'Luchon',status:'pending',place:null},state={};
 selectPointCandidate(point,state,place);
 editPointSearch(point,state,'Luchon');
 const wire=JSON.parse(JSON.stringify({location_points:pointSnapshot({title:'Synthetic'},[point])}));
 assert.equal(wire.location_points.points[0].place.provider_place_id,place.provider_place_id);
 assert.equal(wire.location_points.points[0].status,'approximate');
 assert.equal(point.query,place.canonical_name);
});
test('pending and mixed saves cannot claim every location is confirmed',()=>{
 const pending={id:'p',query:'Luchon',place:null};
 assert.match(pointSaveMessage(pointSnapshot({},[pending])),/Punts pendents de confirmar: 1/);
 assert.match(pointSaveMessage(pointSnapshot({},[pending,{id:'q',query:'Luchon',place}])),/Ubicacions confirmades: 1. Punts pendents de confirmar: 1/);
 assert.match(pointSaveMessage(pointSnapshot({},[{...pending,place}])),/confirmades al servidor: 1/);
});
test('actual save rejects a server response that loses the chosen place',async()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const code=html.slice(html.indexOf('async function saveActivityPoints('),html.indexOf('async function proposeActivityPoints('));
 const snapshot=pointSnapshot({title:'Synthetic'},[{id:'p',query:'Luchon',place}]);
 for(const losePlace of [false,true]){
  let sent;const persisted=structuredClone(snapshot);
  if(losePlace){persisted.points[0].place=null;persisted.points[0].status='pending'}
  const q={update:body=>(sent=JSON.parse(JSON.stringify(body)),q),eq:()=>q,select:()=>q,maybeSingle:async()=>({data:{id:'synthetic',location_points:persisted},error:null})};
  const c=vm.createContext({itineraryAutoPlaceScope:()=> 's',connectionUnavailable:()=>false,isLondonTrip:()=>false,trip:{id:'synthetic'},db:{from:()=>q},itineraryPointContext:async()=>({api:{samePointSnapshot}})});
  vm.runInContext(code,c);const promise=c.saveActivityPoints({id:'synthetic',updated_at:'v'},snapshot,'s');
  if(losePlace)await assert.rejects(promise,/no ha quedat desada/);else assert.deepEqual(await promise,snapshot);
  assert.equal(sent.location_points.points[0].place.provider_place_id,place.provider_place_id);
 }
});

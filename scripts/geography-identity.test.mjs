import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {activityGeographicPoints,pointSnapshot,pointInput,samePointSnapshot,chooseAutomaticPoint,extractActivityPoints} from '../domain/itinerary-place-points.mjs';
import {culturalPlaces} from '../domain/cultural-guide.mjs';import {routeProvider} from '../supabase/functions/itinerary-route/provider.mjs';
const place=(name,kind='city',extra={})=>({provider:'geoapify',provider_place_id:'synthetic:'+name,canonical_name:name,country_code:'FR',locality:name,kind,latitude:43,longitude:0.5,coordinate_role:'representative_point',attribution:'Synthetic contract fixture',...extra});
test('#228: town and explicitly named restaurant are separate pending subjects; generic meals invent nothing',()=>{
 assert.deepEqual(extractActivityPoints({title:'Dinar a Saint-Bertrand-de-Comminges a Chez Simone'}).map(p=>p.query),['Saint-Bertrand-de-Comminges','Chez Simone']);
 assert.deepEqual(extractActivityPoints({title:'Dinar a Luchon'}).map(p=>p.query),['Luchon']);
 assert.deepEqual(extractActivityPoints({title:'Dinar'}),[]);
});
test('#228: general town/natural guide needs no monument; ambiguous geography remains pending',()=>{
 for(const [name,kind,city,country] of [['Bagnères-de-Luchon','city','Bagnères-de-Luchon','FR'],['Bòsc de Carlac','natural.forest','Bausen','ES']]){
  const p=place(name,kind,{locality:city,country_code:country}),row={title:'Activitat descriptiva',city};
  assert.equal(culturalPlaces({...row,location_points:pointSnapshot(row,[{id:'p',query:name,place:p}])})[0].provider_place_id,p.provider_place_id);
  assert.ok(chooseAutomaticPoint(name,[p],{canonical_name:city,country_code:country}));
  assert.equal(chooseAutomaticPoint(name,[p,{...p,provider_place_id:'distant',latitude:48}],{canonical_name:city,country_code:country}),null);
  assert.equal(chooseAutomaticPoint(name,[p],{canonical_name:'Arties',country_code:'ES'}),null);
 }
});
test('#228: legacy identity feeds map/editor, route and cultural guide without re-geocoding',async()=>{
 const p=place('Saint-Bertrand-de-Comminges'),row={title:'Dinar al poble',location_name:'Nom traduït',address:null,city:'Arties'};row.resolved_location={...pointInput(row),place:p};row.location_points=pointSnapshot(row,[{id:'pending',query:'Títol',place:null}]);
 assert.equal(activityGeographicPoints(row)[0].place.provider_place_id,p.provider_place_id);
 assert.equal(culturalPlaces(row)[0].provider_place_id,p.provider_place_id);
 const provider=routeProvider({key:null,fetcher:()=>{throw Error('No remote lookup allowed')}});assert.equal((await provider.resolve(row,null)).point.id,p.provider_place_id);
 const removed={...row,location_points:pointSnapshot(row,[])};assert.deepEqual(activityGeographicPoints(removed),[]);assert.deepEqual(culturalPlaces(removed),[]);assert.equal((await provider.resolve(removed,null)).error,'missing_place');
});
test('#228: ordinary point save verifies the actual database snapshot, not just an affected id',async()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('async function saveActivityPoints('),stop=html.indexOf('async function proposeActivityPoints(',start),source=html.slice(start,stop),snapshot={version:1,input:{},points:[]};
 for(const [data,ok]of [[{id:'i'},false],[{id:'i',location_points:null},false],[{id:'i',location_points:{points:[],input:{},version:1}},true]]){
  const q={update:()=>q,eq:()=>q,select:()=>q,maybeSingle:async()=>({data,error:null})};
  const c=vm.createContext({itineraryAutoPlaceScope:()=> 'scope',connectionUnavailable:()=>false,isLondonTrip:()=>false,trip:{id:'t'},db:{from:()=>q},itineraryPointContext:async()=>({api:{samePointSnapshot}})});vm.runInContext(source,c);c.row={id:'i',updated_at:'version',_placeSource:'manual'};c.snapshot=snapshot;
  const promise=vm.runInContext("saveActivityPoints(row,snapshot,'scope')",c);if(ok)await promise;else await assert.rejects(promise,/no ha quedat desada/);
 }
});

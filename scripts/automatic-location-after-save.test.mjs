import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as api from '../domain/itinerary-place-points.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('async function proposeActivityPoints(){'),html.indexOf('async function openActivityPointEditor('));
const destinationCode=html.slice(html.indexOf('function itineraryPointDestination('),html.indexOf('function itineraryAutoPlaceVerified('));
const place={provider:'geoapify',provider_place_id:'synthetic-luchon',canonical_name:'Bagnères-de-Luchon',country_code:'FR',locality:'Bagnères-de-Luchon',kind:'city',latitude:42.79,longitude:0.59,coordinate_role:'representative_point',attribution:'Synthetic fixture'};
const row=id=>({id,trip_id:'synthetic-trip',title:'Visit',location_name:place.canonical_name,city:place.locality,address:null,location_points:null,resolved_location:null,local_date:null,updated_at:'v1'});
function setup(rows,find){
 const writes=[],context={scope:'s',api,seen:new Set(),running:false,queue:{count:0,blocked:false,find:async(...args)=>{context.queue.count++;return find(...args)}}};
 const c=vm.createContext({structuredClone,trip:{id:'synthetic-trip'},session:{},manualItineraryRows:rows,activityRows:[],tripStopRows:[],isLocalTransportActivity:()=>false,isLondonTrip:()=>false,connectionUnavailable:()=>false,itineraryPointContext:async()=>context,itineraryAutoPlaceScope:()=> 's',itineraryAutoPlaceRecordKey:r=>r.id+':'+r.updated_at,itineraryAutoPlaceDestination:()=>({canonical_name:place.locality,country_code:'FR'}),loadActivities:async()=>{},loadManualItineraryItems:async()=>{},saveActivityPoints:async(r,snapshot)=>{
  const current=rows.find(x=>x.id===r.id);assert.equal(current.updated_at,r.updated_at,'CAS');
  writes.push(structuredClone(snapshot));current.location_points=structuredClone(snapshot);current.updated_at='v2';
 }});vm.runInContext(destinationCode+code,c);return {run:()=>c.proposeActivityPoints(),writes,context,c};
}
test('unambiguous location resolves undated manual and imported activity without selecting a day',async()=>{
 const rows=[row('manual')],h=setup(rows,async()=>[place]);
 const imported=row('imported');h.c.activityRows=[imported];
 h.c.saveActivityPoints=async(r,snapshot)=>{h.writes.push(snapshot);(r.id==='manual'?rows[0]:imported).location_points=snapshot};
 await h.run();assert.equal(h.writes.length,2);
 for(const snapshot of h.writes){assert.equal(snapshot.points[0].place.provider_place_id,place.provider_place_id);assert.equal(snapshot.points[0].status,'approximate')}
 assert.match(html,/if\(type==='manual'\|\|type==='activity'\)void proposeActivityPoints\(\)\.catch/);
});
test('plausible distant homonyms remain pending for existing manual picker',async()=>{
 const h=setup([row('homonym')],async()=>[place,{...place,provider_place_id:'other',latitude:48}]);await h.run();
 assert.equal(h.writes[0].points[0].status,'pending');assert.equal(h.writes[0].points[0].place,null);
});
test('no result and one provider error do not block a later activity or retry endlessly',async()=>{
 let calls=0;const rows=[row('empty'),row('error'),row('good')];const h=setup(rows,async()=>{calls++;if(calls===1)return [];if(calls===2)throw Error('synthetic provider unavailable');return [place]});
 await h.run();assert.equal(rows[0].location_points.points[0].status,'pending');assert.equal(rows[1].location_points,null);assert.equal(rows[2].location_points.points[0].place.provider_place_id,place.provider_place_id);
 await h.run();assert.equal(calls,3,'unchanged semantic input is not retried after a write');assert.equal(rows.length,3);
});
test('manual identity, explicit removal and manual edits during delayed lookup always win',async()=>{
 const confirmed=row('manual'),removed=row('removed'),legacy=row('legacy');
 confirmed.location_points=api.pointSnapshot(confirmed,[{id:'p',query:place.canonical_name,place}]);removed.location_points=api.pointSnapshot(removed,[]);legacy.resolved_location={...api.pointInput(legacy),place};
 let calls=0;const skipped=setup([confirmed,removed,legacy],async()=>{calls++;return [place]});await skipped.run();assert.equal(calls,0);assert.equal(skipped.writes.length,0);
 for(const remove of [false,true]){
  const r=row('late');let release;const h=setup([r],()=>new Promise(resolve=>{release=resolve}));const pending=h.run();await new Promise(resolve=>setImmediate(resolve));
  r.location_points=api.pointSnapshot(r,remove?[]:[{id:'manual',query:place.canonical_name,place:{...place,provider_place_id:'user-choice'}}]);r.updated_at='manual-v2';
  release([place]);await pending;assert.equal(h.writes.length,0);assert.equal(r.location_points.points.length,remove?0:1);
 }
});

 test('rejected database snapshot and updated_at changes cannot create an automatic write loop',async()=>{
  const r=row('rejected'),h=setup([r],async()=>[place]);let attempts=0;
  h.c.saveActivityPoints=async()=>{attempts++;r.location_points=null;r.updated_at='rejected-'+attempts;throw Error('snapshot invalidated by DB')};
  for(let i=0;i<5;i++)await h.run();
  assert.equal(attempts,1);assert.equal(h.context.queue.count,1);
 });

import test from 'node:test';
import assert from 'node:assert/strict';
import {extractActivityPoints,chooseAutomaticPoint,pointSnapshot,savedActivityPoints,ActivityPointQueue} from '../domain/itinerary-place-points.mjs';
import {normalizeGeoapify} from '../supabase/functions/place-resolution/providers/geoapify.mjs';
import {routeProvider} from '../supabase/functions/itinerary-route/provider.mjs';
const context={canonical_name:'Bologna',country_code:'IT'};
const place=(name,kind='amenity',extra={})=>normalizeGeoapify({name,result_type:kind,place_id:name,city:'Bologna',country_code:'it',lat:44.49,lon:11.34,formatted:name+', Bologna',timezone:{name:'Europe/Rome'},datasource:{sourcename:'fixture',attribution:'Synthetic'},...extra});
test('ordered points: one activity, every named place, no invented meal venues',()=>{
 const cases=[
 ['Piazza Maggiore, Fontana del Nettuno i basílica de San Petronio',['Piazza Maggiore','Fontana del Nettuno','basílica de San Petronio']],
 ['Passeig per l’entorn de les Due Torri i visita a Piazza Santo Stefano',['Due Torri','Piazza Santo Stefano']],
 ['Quadrilatero i dinar',['Quadrilatero']],
 ['Esmorzar i passeig pel centre històric',['centre històric']],
 ['Aperitiu a Via del Pratello',['Via del Pratello']],
 ['British Museum',['British Museum']],['Tower of London',['Tower of London']],['Dinar',[]],['16.3',[]],['Breakfast',[]],['Trasllat a Piazza Maggiore',[]]
 ];
 for(const [title,names]of cases){const row={title,starts_at:'2030-01-01T12:00Z'},before=structuredClone(row);assert.deepEqual(extractActivityPoints(row).map(p=>p.query),names,title);assert.deepEqual(row,before)}
 assert.deepEqual(extractActivityPoints({title:'Hotel',address:'Via 20 Settembre 23'}).map(p=>p.query),['Via 20 Settembre 23']);
 const title=cases[0][0];assert.equal(extractActivityPoints({title,location_name:'Piazza Maggiore',resolved_location:{place:{}}}).length,3,'old automatically stored first location must not hide the remaining points');
});
test('provider keeps street and district names and only provider supplied addresses',()=>{
 assert.equal(place(undefined,'street',{street:'Via del Pratello',place_id:'street'}).canonical_name,'Via del Pratello');
 assert.equal(place(undefined,'building',{place_id:'address',street:'Via XX Settembre',address_line1:'Via XX Settembre 23'}).canonical_name,'Via XX Settembre 23');
 assert.equal(place('Centro Storico','suburb').coordinate_role,'representative_point');
 assert.equal(place('Piazza Maggiore').formatted_address,'Piazza Maggiore, Bologna');
});
test('automatic identification requires a unique whole name, locality, country and supported precision',()=>{
 for(const [query,name,kind]of [['Piazza Maggiore','Piazza Maggiore','amenity'],['centre històric','Centro Storico','suburb'],['Via del Pratello','Via del Pratello','street'],['Quadrilatero','Quadrilatero','district']]){
  assert.ok(chooseAutomaticPoint(query,[place(name,kind)],context));
  assert.equal(chooseAutomaticPoint(query,[place(name,kind),place(name,kind,{place_id:'other'})],context),null);
  assert.equal(chooseAutomaticPoint(query,[place(name,kind,{country_code:'fr'})],context),null);
  assert.equal(chooseAutomaticPoint(query,[place(name,kind,{city:'Roma'})],context),null);
 }
 assert.equal(chooseAutomaticPoint('Centro Storico',[place('Centro Storico','city')],context),null);
 assert.equal(chooseAutomaticPoint('Torre',[place('Torre Asinelli')],context),null);
 assert.equal(chooseAutomaticPoint('Piazza Maggiore',[place('Piazza Maggiore')],null),null);
});
test('snapshot retains approximate status, order and empty user choice; rejects stale input and invalid coordinates',()=>{
 const row={title:'Passeig',city:'Bologna',address:null,location_name:null};
 const points=[{id:'a',query:'Via del Pratello',place:place('Via del Pratello','street')},{id:'b',query:'Unknown',place:null}];
 const snapshot=pointSnapshot(row,points);assert.equal(snapshot.points[0].status,'approximate');assert.equal(snapshot.points[1].status,'pending');
 // JSONB key order is not significant.
 snapshot.input={city:row.city,address:null,location_name:null,title:row.title};
 assert.deepEqual(savedActivityPoints({...row,location_points:snapshot}),snapshot.points);
 assert.equal(savedActivityPoints({...row,title:'Changed',location_points:snapshot}),null);
 assert.deepEqual(pointSnapshot(row,[]).points,[]);
 assert.throws(()=>pointSnapshot(row,[{...points[0],place:{...points[0].place,latitude:500}}]));
 assert.throws(()=>pointSnapshot(row,[points[0],points[0]]));
});
test('query cache, in-flight deduplication, 30-query cap and circuit breaker preserve quota',async()=>{
 let calls=0;const q=new ActivityPointQueue(async()=>{calls++;return [place('Piazza Maggiore')]});
 await Promise.all([q.find('Piazza Maggiore',context),q.find('Piazza Maggiore',context)]);assert.equal(calls,1);
 for(let i=0;i<29;i++)await q.find('Other '+i,context);await assert.rejects(q.find('Above limit',context),/30/);assert.equal(calls,30);
 let errors=0;const broken=new ActivityPointQueue(async()=>{errors++;throw Error('503')});await assert.rejects(broken.find('A',context));await assert.rejects(broken.find('B',context));assert.equal(errors,1);
});
test('routing reuses last/first exact ordered endpoints; approximate, pending and deleted endpoints never fall back to old location',async()=>{
 const row={title:'Two visits',location_name:'Old place',city:'Bologna'};
 row.location_points=pointSnapshot(row,[{id:'a',query:'First',place:place('First')},{id:'b',query:'Last',place:place('Last','amenity',{lat:44.5})}]);
 const provider=routeProvider({key:'synthetic',fetcher:()=>{throw Error('No provider query expected')}});
 assert.equal((await provider.resolve(row,null,null,'first')).point.label,'First');assert.equal((await provider.resolve(row,null,null,'last')).point.label,'Last');
 for(const points of [[],[{id:'a',query:'Unknown',place:null}],[{id:'a',query:'Street',place:place('Street','street')}]] ){
  const next={...row,location_points:pointSnapshot(row,points)};assert.equal((await provider.resolve(next,null)).error,'missing_place');
 }
 assert.equal((await provider.resolve({...row,title:'Changed'},null)).error,'missing_place');
});

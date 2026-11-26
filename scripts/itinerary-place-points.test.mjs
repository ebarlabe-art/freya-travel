import test from 'node:test';
import assert from 'node:assert/strict';
import {extractActivityPoints,alternativeGeographicQuery,activityPointAddress,activityPointVenue,chooseAutomaticPoint,autoPendingPoints,samePointName,matchingPointCandidate,pointSnapshot,savedActivityPoints,ActivityPointQueue,activityNavigationUrl} from '../domain/itinerary-place-points.mjs';
import {normalizeGeoapify} from '../supabase/functions/place-resolution/providers/geoapify.mjs';
import {routeProvider} from '../supabase/functions/itinerary-route/provider.mjs';
import {departurePlan,plannedDepartureChoices} from '../domain/trip-departure.mjs';
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
test('regression #226: lunch at a named town keeps the town as a confirmable location, not a guessed restaurant',()=>{
 const row={title:'Dinar a Sant Bertrand du Conninges a Chez Simone'};
 assert.deepEqual(extractActivityPoints(row).map(p=>p.query),['Sant Bertrand du Conninges','Chez Simone']);
 assert.equal(extractActivityPoints(row)[0].place,null,'the settlement is pending until provider confirmation');
 assert.deepEqual(extractActivityPoints({title:'Dinar a Saint-Bertrand-de-Comminges al restaurant Chez Simone'}).map(p=>p.query),['Saint-Bertrand-de-Comminges','restaurant Chez Simone']);
 assert.deepEqual(extractActivityPoints({title:'Dinar'}),[],'a generic meal must not fabricate a place');
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
  assert.ok(chooseAutomaticPoint(query,[place(name,kind),place(name,kind,{place_id:'other'})],context),'nearby repeated records are one landmark');
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
  const next={...row,location_points:pointSnapshot(row,points)};assert.equal((await provider.resolve(next,null)).error,points[0]?.place?'approximate_place':'missing_place');
 }
 assert.equal((await provider.resolve({...row,title:'Changed'},null)).error,'missing_place');
});

test('a stalled point query releases the UI and opens the circuit without retrying',async()=>{
 let calls=0;const q=new ActivityPointQueue(()=>{calls++;return new Promise(()=>{})},{timeoutMs:5});
 await assert.rejects(q.find('Stalled',context),/no respon/);await assert.rejects(q.find('Other',context));assert.equal(calls,1);
});


test('linguistic query variants do not reuse an empty result from another spelling',async()=>{
 const calls=[];const q=new ActivityPointQueue(async text=>{calls.push(text);return text.startsWith('Basilica di')?[place('Basilica di San Petronio')]:[]});
 assert.deepEqual(await q.find('Basilica de San Petronio',context),[]);
 assert.equal((await q.find('Basilica di San Petronio',context)).length,1);
 await q.find('BASILICA  DI San Petronio',context);assert.equal(calls.length,2,'Case and repeated spaces remain deduplicated');
 assert.ok(chooseAutomaticPoint('Basilica de San Petronio',[place('Basilica di San Petronio'),place('Basilica di San Petronio','amenity',{place_id:'other'})],context));
});

test('no unrelated saints or distant homonyms; only unchanged automatic pending locations can retry',()=>{
 assert.equal(samePointName('basílica de San Petronio','Basilica di San Domenico'),false);
 assert.equal(samePointName('basílica de San Petronio','Basilica di San Petronio'),true);
 const options=[place('Basilica di San Domenico'),place('Basilica di Santo Stefano'),place('Basilica di San Petronio')];
 assert.equal(chooseAutomaticPoint('basílica de San Petronio',options,context).canonical_name,'Basilica di San Petronio');
 assert.equal(chooseAutomaticPoint('Piazza Maggiore',[place('Piazza Maggiore'),place('Piazza Maggiore','amenity',{place_id:'far',lat:44.51})],context),null);
 const row={title:'Piazza Maggiore, Fontana del Nettuno i basílica de San Petronio',city:'Bologna'};
 const original=extractActivityPoints(row);original[1].place=place('Fontana del Nettuno');original[1].status='resolved';
 row.location_points=pointSnapshot(row,original);
 assert.equal(autoPendingPoints(row).length,3);
 const changed=structuredClone(row);changed.location_points.points[0].query='Manual change';assert.equal(autoPendingPoints(changed),null);
 const reordered=structuredClone(row);reordered.location_points.points.reverse();assert.equal(autoPendingPoints(reordered),null);
 assert.equal(autoPendingPoints({...row,location_points:pointSnapshot(row,[])}),null);
});

test('compound Teatro Anatomico becomes a second point and safely upgrades an unedited legacy pending snapshot',()=>{
 const row={title:'Archiginnasio i Teatro Anatomico (entrada subjecta a horaris i disponibilitat)',city:'Bologna'};
 assert.deepEqual(extractActivityPoints(row).map(p=>p.query),['Archiginnasio','Teatro Anatomico']);
 const old={version:1,input:{title:row.title,city:row.city,address:null,location_name:null},points:[{id:'point-0',query:'Archiginnasio i Teatro Anatomico',status:'pending',place:null}]};
 assert.deepEqual(autoPendingPoints({...row,location_points:old}).map(p=>p.query),['Archiginnasio','Teatro Anatomico']);
 const manuallyNamed=structuredClone(old);manuallyNamed.points[0].query='Custom entry';
 assert.equal(autoPendingPoints({...row,location_points:manuallyNamed}),null,'Do not rewrite a manually renamed point');
 const clock=extractActivityPoints({title:'Opcional: visita a la Torre dell’Orologio, amb reserva prèvia'});
 assert.equal(clock.some(p=>p.query==='via'),false,'Never extract Via from inside the word prèvia');
});

test('candidate display matches named landmark aliases without mixing saints or cities',()=>{
 assert.equal(matchingPointCandidate('Archiginnasio',place('Palazzo dell Archiginnasio'),{country_code:'IT',city:'Bologna'}),true);
 assert.equal(matchingPointCandidate('Basilica di San Petronio',place('Basilica di San Domenico')),false);
 assert.equal(matchingPointCandidate('Torre dell Orologio',place('Torre degli Asinelli')),false);
 assert.equal(matchingPointCandidate('Archiginnasio',place('Palazzo dell Archiginnasio','amenity',{city:'Roma'}),{city:'Bologna'}),false);
 assert.equal(matchingPointCandidate('Via',place('Via del Pratello')),false);
 assert.equal(matchingPointCandidate('Archiginnasio',place('Palazzo dell Archiginnasio','amenity',{country_code:'fr'}),{country_code:'IT'}),false);
});

test('postal evidence identifies a venue even when the provider name and municipality spelling differ',async()=>{
 const context={canonical_name:'Brussel·les',country_code:'BE'};
 const row={title:'Visita al Parlamentarium',location_name:'Parlamentarium',address:'Rue Wiertz 60, 1047 Brussel·les'};
 const result=place('Parlamentarium','amenity',{country_code:'be',city:'Bruxelles',formatted:'Parlamentarium, 60 Rue Wiertz, 1047 Bruxelles, Belgique'});
 const find=options=>chooseAutomaticPoint(row.address,options,context,{address:true});
 assert.equal(chooseAutomaticPoint(row.address,[result],context),null,'name matching alone cannot verify a street address');
 const resolved=find([result]);
 assert.equal(resolved?.canonical_name,'Parlamentarium');
 assert.equal(chooseAutomaticPoint('Rue Wiertz, 60, 1047 Bruxelles',[result],context,{address:true})?.provider_place_id,result.provider_place_id);
 assert.equal(chooseAutomaticPoint('Rue Wiertz 60 1047 Bruxelles',[result],context,{address:true})?.provider_place_id,result.provider_place_id);
 assert.equal(chooseAutomaticPoint('60 Rue Wiertz 1047 Bruxelles',[result],context,{address:true})?.provider_place_id,result.provider_place_id);
 assert.equal(find([{...result,formatted_address:'Rue Wiertz 6, 1047 Bruxelles'}]),null);
 assert.equal(find([{...result,formatted_address:'Rue Wiertz 60, 1050 Bruxelles'}]),null);
 assert.equal(find([{...result,formatted_address:'Rue Wiertz 60, Bruxelles'}]),null);
 assert.equal(find([{...result,formatted_address:'Rue Wiertz 60B, 1047 Bruxelles'}]),null);
 assert.equal(find([{...result,country_code:'FR'}]),null);
 assert.equal(find([{...result,coordinate_role:'representative_point'}]),null);
 assert.equal(find([result,{...result,provider_place_id:'distinct-address',latitude:result.latitude+.02}]),null);
 const rowWithTime={...row,updated_at:'2026-11-25T08:00:00Z'};
 const item={key:'manual:fixture',sourceType:'manual',sourceId:'fixture',sourceUpdatedAt:rowWithTime.updated_at,
  tripId:'trip',localDate:'2026-12-01',timingKind:'exact',startsAt:'2026-12-01T08:00:00Z'};
 rowWithTime.location_points=pointSnapshot(rowWithTime,extractActivityPoints(rowWithTime));
 const now=Date.parse('2026-12-01T07:00:00Z');
 assert.equal(departurePlan([item],()=>rowWithTime,now),null);
 assert.deepEqual(plannedDepartureChoices([item],[],()=>rowWithTime,'trip',item.localDate),[]);
 rowWithTime.location_points=pointSnapshot(rowWithTime,[{...extractActivityPoints(rowWithTime)[0],place:resolved}]);
 assert.equal(departurePlan([item],()=>rowWithTime,now).destination,item);
 assert.equal(plannedDepartureChoices([item],[],()=>rowWithTime,'trip',item.localDate)[0].destination,item);
 const provider=routeProvider({key:'synthetic',fetcher:()=>{throw Error('Exact saved endpoints must not be geocoded again')}});
 assert.equal((await provider.resolve(rowWithTime,null)).point.id,result.provider_place_id);
});

test('a complete same-city address lookup does not append or re-query the locality',async()=>{
 const context={canonical_name:'Riga',country_code:'LV'};
 const calls=[];
 const queue=new ActivityPointQueue(async(text,country)=>{calls.push([text,country]);return []});
 await queue.find('Brīvības iela 1, LV-1050 Riga',context);
 await queue.find('Brīvības iela 1, LV-1050 Riga',context);
 assert.deepEqual(calls,[['Brīvības iela 1, LV-1050 Riga','LV']]);
});

test('explicit geographic evidence replaces only old automatic pending points',()=>{
 const context={canonical_name:'Brussel·les',country_code:'BE',time_zone:'Europe/Brussels'};
 const sample=(name,formatted,extra={})=>place(name,'amenity',{country_code:'be',city:'Ixelles - Elsene',
  formatted,state:'Brussel·les-Capital',timezone:{name:'Europe/Brussels'},...extra});
 const cases=[
  [{title:'Visita al Parlamentarium'},'Parlamentarium',sample('Parlamentarium','Parlamentarium, 1050 Ixelles')],
  [{title:'Visita oficial al Parlament Europeu. Place Luxembourg'},'Parlament Europeu',sample('Parlement européen','Parlement européen, 1047 Bruxelles')],
  [{title:'Check in a l’Hotel VAN BELLE',notes:'Bergensesteenweg 39 Anderlecht, 1070 Brussel, Belgium'},
   'Bergensesteenweg 39 Anderlecht, 1070 Brussel, Belgium',sample('Hotel Van Belle','Hotel Van Belle, 39 Chaussée de Mons, 1070 Anderlecht',{city:'Anderlecht'})],
  [{title:'Sopar amb el grup',notes:'Al Restaurant Le Cercle des Voyageurs\nRue des Grands Carmes, 18'},
   'Rue des Grands Carmes, 18',sample('Le Cercle des Voyageurs','Le Cercle des Voyageurs, 18 Rue des Grands Carmes, 1000 Bruxelles',{city:'Bruxelles'})]
 ];
 for(const [row,query,provider] of cases){
  const before=structuredClone(row);
  const [evidence]=extractActivityPoints(row);
  assert.equal(evidence.query,query);
  const choice=chooseAutomaticPoint(query,[provider],context,{address:activityPointAddress(row,query),venue:activityPointVenue(row)});
  assert.equal(choice?.canonical_name,provider.canonical_name,query);
  assert.deepEqual(row,before);
  const old=pointSnapshot(row,[{id:'point-0',query:row.title,place:null}]);
  if(row.title.startsWith('Check in')||row.title.includes('Place Luxembourg')){
   assert.equal(autoPendingPoints({...row,location_points:old})?.[0].query,query);
   old.points[0].query='My custom entrance';
   assert.equal(autoPendingPoints({...row,location_points:old}),null);
  }
  if(row.notes){
   const saved=pointSnapshot(row,[{...evidence,place:choice}],{automatic:true});
   assert.deepEqual(saved.input,{title:row.title,location_name:null,address:null,city:null},'input must exactly match PostgreSQL fingerprint');
   assert.equal(saved.geographic_evidence,query);
   assert.equal(savedActivityPoints({...row,location_points:saved})[0].place.provider_place_id,provider.provider_place_id);
   assert.equal(savedActivityPoints({...row,notes:'Other address',location_points:saved}),null);
  }
 }
 const abroad=sample('Parlamentarium','Parlamentarium, 9000 Gent',{city:'Gent',state:'Oost-Vlaanderen'});
 assert.equal(chooseAutomaticPoint('Parlamentarium',[abroad],context),null);
 assert.equal(chooseAutomaticPoint('Parlamentarium',[cases[0][2],{...cases[0][2],provider_place_id:'far',latitude:45}],context),null);
 assert.equal(chooseAutomaticPoint('Parlamentarium',[{...cases[0][2],timezone:'Europe/Riga'}],context),null);
 assert.equal(alternativeGeographicQuery('Catedral de Riga'),'riga cathedral');
 assert.equal(alternativeGeographicQuery('Museu Nacional'),'national museum');
 assert.equal(alternativeGeographicQuery('Hotel VAN BELLE'),'');
 const riga={canonical_name:'Riga',country_code:'LV',time_zone:'Europe/Riga'};
 const dome=place('Rīgas Doms','amenity',{country_code:'lv',city:'Rīga',timezone:{name:'Europe/Riga'}});
 assert.equal(chooseAutomaticPoint('Catedral de Riga',[dome],riga)?.canonical_name,'Rīgas Doms');
 assert.equal(chooseAutomaticPoint('Catedral de Riga',[{...dome,canonical_name:'Catedral de Sant Pere'}],riga),null);
});

test('only provider-confirmed map link candidates matching the trip context can become route points',()=>{
 const link='https://maps.app.goo.gl/CaseSensitive';
 const row={title:'Punt de trobada',notes:'Enllaç: '+link};
 const [evidence]=extractActivityPoints(row);
 assert.equal(evidence.query,link);
 const result=place('Selected entrance');
 assert.equal(chooseAutomaticPoint(link,[result],context),null);
 assert.ok(chooseAutomaticPoint(link,[{...result,map_reference:link}],context));
 assert.equal(chooseAutomaticPoint(link,[{...result,map_reference:link,locality:'Roma'}],context),null);
});

 test('note-derived snapshot becomes stale on a changed address and can recover without overriding a manual choice',()=>{
 const row={title:'Dinner',notes:'Rue Example, 18'};
 const p={...place('Example'),formatted_address:'Rue Example, 18'};
 const snapshot=pointSnapshot(row,[{...extractActivityPoints(row)[0],place:p}],{automatic:true});
 assert.equal(snapshot.geographic_evidence,'Rue Example, 18');
 const changed={...row,notes:'Rue Example, 20',location_points:snapshot};
 assert.equal(savedActivityPoints(changed),null);
 assert.equal(autoPendingPoints(changed)?.[0].query,'Rue Example, 20');
 const manual=pointSnapshot(row,[{...extractActivityPoints(row)[0],place:p}]);
 assert.equal(autoPendingPoints({...changed,location_points:manual}),null);
 });


test('actual bilingual Geoapify address responses previously rejected in Brussels',async()=>{
 const context={canonical_name:'Brussel·les',country_code:'BE',time_zone:'Europe/Brussels'};
 // Public address fields from the actual Geoapify response, not invented venue labels.
 const cases=[
  ['Bergensesteenweg 39 Anderlecht, 1070 Brussel, Belgium','Chaussée de Mons - Bergense Steenweg 39','Chaussée de Mons - Bergense Steenweg 39, 1070 Anderlecht, Bèlgica','Anderlecht',50.8442149,4.3362738],
  ['Rue des Grands Carmes, 18','Rue des Grands Carmes - Lievevrouwbroersstraat 18','Rue des Grands Carmes - Lievevrouwbroersstraat 18, 1000 Brussel·les, Bèlgica','Brussel·les',50.8451992,4.3493664]
 ];
 const provider=routeProvider({key:'synthetic',fetcher:()=>{throw Error('Must reuse the saved verified location')}});
 for(const [address,name,formatted,city,lat,lon] of cases){
  const row={title:'Named visit',notes:address},p=place(name,'building',{formatted,city,lat,lon,country_code:'be',state:'Brussel·les-Capital',timezone:{name:'Europe/Brussels'}});
  assert.equal(chooseAutomaticPoint(address,[p],context,{address:true})?.provider_place_id,p.provider_place_id);
  assert.equal(chooseAutomaticPoint(address,[{...p,country_code:'FR'}],context,{address:true}),null);
  const wrong={...p,canonical_name:name.replace(/\d+$/,'99'),formatted_address:formatted.replace(/\d+(?=,)/,'99')};
  assert.equal(chooseAutomaticPoint(address,[wrong],context,{address:true}),null);
  const selected=chooseAutomaticPoint(address,[p],context,{address:true});
  row.location_points=pointSnapshot(row,[{...extractActivityPoints(row)[0],place:selected}],{automatic:true});
  assert.equal(savedActivityPoints(row)[0].status,'resolved');
  assert.equal((await provider.resolve(row,null)).point.id,p.provider_place_id);
 }
 const event=place('Rue Wiertz 60','building',{formatted:'Rue Wiertz 60, 1050 Brussel·les, Bèlgica',city:'Brussel·les',country_code:'be',state:'Regió de Brussel·les-Capital',timezone:{name:'Europe/Brussels'}});
 assert.equal(chooseAutomaticPoint('Rue Wiertz 60, 1047 Bruxelles, Belgium',[event],context,{address:true}),null,'postal-code conflict is not silently ignored');
 const row={title:'Lunch',notes:'Rue du Marché aux Poulets 57 (Kiekenmarkt 57)'};
 assert.equal(extractActivityPoints(row)[0].query,'Rue du Marché aux Poulets 57');
});

test('London-style map navigation retains explicit links and addresses without pretending they are verified',()=>{
 const context={canonical_name:'Brussel·les',country_code:'BE'};
 const link='https://maps.app.goo.gl/ExampleMeetingPoint';
 const row={title:'Meeting',notes:'Punt de trobada: '+link};
 assert.equal(activityNavigationUrl(row,context),link);
 assert.equal(activityNavigationUrl({...row,location_points:pointSnapshot(row,[])},context),null);
 const address={title:'Dinner',notes:'Rue Example, 18'};
 const url=new URL(activityNavigationUrl(address,context));
 assert.equal(url.hostname,'www.google.com');
 assert.equal(url.searchParams.get('query'),'Rue Example, 18, Brussel·les');
 assert.equal(savedActivityPoints(address),null);
 const free={title:'Temps lliure',notes:'Recomanem dinar a prop del Parlament Europeu'};
 assert.deepEqual(extractActivityPoints(free),[]);
 assert.equal(activityNavigationUrl(free,context),null);
 const stale={...free,location_points:{version:1,input:{title:free.title,address:null,city:null,location_name:null},geographic_evidence:'Parlament Europeu',points:[{id:'point-0',query:'Parlament Europeu',status:'resolved',place:place('Parlament Europeu')}]}};
 assert.equal(savedActivityPoints(stale),null,'recommendation is not the location of free time');
});

test('a translated square prefix is not part of the native square name',()=>{
 const context={canonical_name:'Riga',country_code:'LV'};
 const p=place('Doma laukums','street',{city:'Riga',country_code:'lv',state:'Riga'});
 assert.equal(alternativeGeographicQuery('plaça Doma laukums'),'doma laukums');
 assert.equal(chooseAutomaticPoint('plaça Doma laukums',[p],context)?.provider_place_id,p.provider_place_id);
 assert.equal(chooseAutomaticPoint('plaça Doma laukums',[{...p,canonical_name:'Doma iela'}],context),null);
});
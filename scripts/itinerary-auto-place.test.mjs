import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fallback=readFileSync(new URL('../404.html',import.meta.url),'utf8');
const start=html.indexOf('function itineraryAutoPlaceRows(');
const end=html.indexOf('async function fetchAgendaManualItems(',start);
assert.ok(start>=0&&end>start,'A2.12 grouped place code must be present');
const source=html.slice(start,end);
const place=(name,coordinate_role='exact_location')=>({
 canonical_name:name,administrative_area:'Rīga',country_code:'LV',locality:'Riga',provider:'geoapify',provider_place_id:name,attribution:'Synthetic',
 latitude:56.95,longitude:24.10,coordinate_role
});

function makeHarness({rows,stops=[{canonical_name:'Riga'}],answers=[{data:{candidates:[{place:place('Castell de Riga')} ]}}]}={}){
 rows??=[{id:'activity-a',title:'Visita al Castell de Riga',location_name:null,address:null,city:null,
  status:'planned',updated_at:'rev-1',local_date:'2026-12-27',trip_id:'trip-a'}];
 const els=new Map(),queries=[],updates=[],messages=[];
 function $(id){
  if(!els.has(id)){
   let hidden=true;
   els.set(id,{innerHTML:'',textContent:'',disabled:false,onclick:null,
    classList:{add(v){if(v==='hidden')hidden=true},remove(v){if(v==='hidden')hidden=false},
     toggle(v,force){if(v==='hidden')hidden=!!force},contains(v){return v==='hidden'&&hidden}},
    querySelectorAll(){return []}});
  }
  return els.get(id);
 }
 let lookup=0;
 const db={functions:{invoke:async (name,payload)=>{
  queries.push({name,payload});
  const result=answers[Math.min(lookup++,answers.length-1)];
  return result;
 }},from(table){
  assert.ok(['trip_itinerary_items','trip_activities'].includes(table));
  return {update(patch){
   const filters=[];
   return {eq(field,value){filters.push({kind:'eq',field,value});return this},
    is(field,value){filters.push({kind:'is',field,value});return this},
    select(value){assert.equal(value,'id');return this},
    async maybeSingle(){
     updates.push({patch,filters});
     const id=filters.find(f=>f.field==='id')?.value;
     const row=rows.find(r=>r.id===id);
     if(!row||!filters.every(f=>f.field==='trip_id'||(f.kind==='is'?(row[f.field]??null)===f.value:row[f.field]===f.value)))
      return {data:null,error:null};
     Object.assign(row,patch);
     return {data:{id},error:null};
    }};
  }};
 }};
 const scope={
  $,$noop:()=>{},trip:{id:'trip-a',name:'Riga'},tripStopRows:stops,session:{user:{id:'user-a'}},
  tripLoadGeneration:3,genericItinerarySelectedDay:'2026-12-27',
  itineraryProjection:rows.map(row=>({sourceType:'manual',sourceId:row.id,localDate:row.local_date})),
  manualItineraryRows:rows,isLocalTransportActivity:row=>row.activity_type==='transport',loadActivities:async()=>{},connectionUnavailable:()=>false,isLondonTrip:()=>false,
  itineraryRequestIsCurrent:()=>true,
  manualItineraryPlaceQuery:row=>(row.title.replace(/^Visita al /,'')+', Riga'),db,
  loadManualItineraryItems:async()=>rows,msg:(_target,message)=>messages.push(message),
  esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 };
 const context=vm.createContext(scope);
 const fn=vm.runInContext('let itineraryAutoPlaceContext=null;'+source+
  ';({itineraryAutoPlaceVerified,itineraryAutoPlaceSnapshot,itineraryAutoPlaceRows,itineraryAutoPlaceFocusedName,itineraryAutoPlaceShouldSearch,itineraryAutoPlaceDefault,itineraryAutoPlaceOptions,'+
  'itineraryAutoPlaceContextFor,itineraryAutoPlaceQuery,proposeItineraryAutoPlaces,saveItineraryAutoPlaces,renderItineraryAutoPlacePanel})',context);
 return {fn,scope,$,queries,updates,messages,rows,context};
}
async function drain(){await new Promise(resolve=>setImmediate(resolve))}

test('A2.12: grouped suggestions are visible without importing a PDF or modifying an activity',async()=>{
 assert.equal(html,fallback);
 assert.match(html,/id="itineraryAutoPlacePanel"/);
 assert.match(html,/id="itineraryAutoPlaceList"/);
 assert.match(html,/id="itineraryAutoPlaceSave"/);
 assert.match(html,/proposeItineraryAutoPlaces\(selected\)/);
 assert.doesNotMatch(source,/db\.from\('trip_itinerary_items'\)\.(?:insert|delete)\(/);
 const h=makeHarness();
 h.fn.proposeItineraryAutoPlaces('2026-12-27');
 await drain();
 assert.equal(h.queries.length,1);
 assert.equal(h.queries[0].name,'place-resolution');
 assert.equal(h.queries[0].payload.body.action,'search');
 assert.equal(h.updates.length,0,'No auto-save while suggestions load');
 const record=h.fn.itineraryAutoPlaceContextFor('2026-12-27').records.get('activity-a:rev-1');
 assert.equal(record.status,'done');
 assert.equal(record.selected,0,'Single explicit matching POI is suggested by default');
 assert.match(h.$('itineraryAutoPlaceList').innerHTML,/Castell de Riga/);
 assert.equal(h.rows[0].location_name,null);
});

test('A2.12: explicit group confirmation updates only location text, on a scoped versioned row',async()=>{
 const h=makeHarness();
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 await h.fn.saveItineraryAutoPlaces('2026-12-27');
 assert.equal(h.updates.length,1);
 assert.deepEqual(Object.keys(h.updates[0].patch),['location_name']);
 assert.equal(h.updates[0].patch.location_name,'Castell de Riga');
 assert.deepEqual(h.updates[0].filters.map(f=>[f.field,f.value]),[
  ['trip_id','trip-a'],['id','activity-a'],['updated_at','rev-1'],['location_name',null]]);
 assert.equal(h.rows[0].location_name,'Castell de Riga');
 assert.match(h.messages.join(' '),/1 ubicacions desades/);
});

test('A2.12: ambiguous or generic results stay unselected and cannot be saved silently',async()=>{
 const h=makeHarness({answers:[{data:{candidates:[
  {place:place('Riga','representative_point')},
  {place:place('Old Town','exact_location')}
 ]}}]});
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 const record=h.fn.itineraryAutoPlaceContextFor('2026-12-27').records.get('activity-a:rev-1');
 assert.equal(record.selected,-1);
 assert.equal(h.$('itineraryAutoPlaceSave').disabled,true);
 await h.fn.saveItineraryAutoPlaces('2026-12-27');
 assert.equal(h.updates.length,0);
});

test('A2.12: generic transfers and meals are not sent for geocoding',async()=>{
 const h=makeHarness({rows:[
  {id:'food',title:'Dinar',local_date:'2026-12-27',location_name:null,address:null,status:'planned',updated_at:'rev-2'},
  {id:'transfer',title:'Trasllat a hotel',local_date:'2026-12-27',location_name:null,address:null,status:'planned',updated_at:'rev-3'}
 ]});
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 assert.equal(h.queries.length,0);
 assert.equal(h.updates.length,0);
});

test('A2.12: duplicate queries reuse trip-session results, without extra provider usage',async()=>{
 const rows=['a','b'].map(id=>({id,title:'Visita al Castell de Riga',local_date:'2026-12-27',
  location_name:null,address:null,status:'planned',updated_at:'rev-'+id}));
 const h=makeHarness({rows});
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 assert.equal(h.queries.length,1);
 assert.equal(h.fn.itineraryAutoPlaceContextFor('2026-12-27').records.size,2);
});

test('A2.12: no active trip scope can reuse suggested locations from another trip',async()=>{
 const h=makeHarness();
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 const old=h.fn.itineraryAutoPlaceContextFor('2026-12-27');
 h.scope.trip={id:'trip-b',name:'Tallinn'};
 h.scope.itineraryProjection=[];
 h.scope.manualItineraryRows=[];
 const newer=h.fn.itineraryAutoPlaceContextFor('2026-12-27');
 assert.notEqual(old,newer);
 assert.equal(newer.records.size,0);
});

test('A2.12: a named landmark with a local-language alias uses that alias in the Geoapify query',async()=>{
 const h=makeHarness({rows:[{id:'market',title:'Visita al Mercat Central de Riga (Rīgas Centrāltirgus)',
  local_date:'2026-12-27',location_name:null,address:null,status:'planned',updated_at:'rev-4'}]});
 const query=h.fn.itineraryAutoPlaceQuery(h.rows[0]);
 assert.match(query,/Rīgas Centrāltirgus/);
 assert.match(query,/Riga/);
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 assert.equal(h.queries.length,1);
 assert.equal(h.queries[0].payload.body.text,query);
});

test('A2.12: first provider outage stops remaining requests and explains failure without updating records',async()=>{
 const rows=['a','b','c'].map((id,i)=>({id,title:['Visita al Castell de Riga','Visita al Mercat Central de Riga','Visita a la Catedral de Riga'][i],
  local_date:'2026-12-27',location_name:null,address:null,status:'planned',updated_at:'rev-'+id}));
 const h=makeHarness({rows,answers:[{error:{status:503},data:{error:'provider_unavailable'}}]});
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 assert.equal(h.queries.length,1,'Provider outage must not trigger repetitive failed requests');
 assert.equal(h.updates.length,0);
 assert.equal(h.$('itineraryAutoPlaceSave').disabled,true);
 assert.match(h.$('itineraryAutoPlaceStatus').textContent,/aturat/);
 assert.match(h.$('itineraryAutoPlaceList').innerHTML,/servei de mapes no respon/i);
 assert.equal(typeof h.$('itineraryAutoPlaceRetry').onclick,'function');
});

test('A2.12: a retry after a temporary provider failure can restart safely without duplicating activities',async()=>{
 const h=makeHarness({answers:[
  {error:{status:503},data:{error:'provider_unavailable'}},
  {data:{candidates:[{place:place('Castell de Riga')}]}}
 ]});
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 assert.equal(h.queries.length,1);
 h.$('itineraryAutoPlaceRetry').onclick();
 await drain();
 assert.equal(h.queries.length,2);
 assert.equal(h.fn.itineraryAutoPlaceContextFor('2026-12-27').records.get('activity-a:rev-1').status,'done');
 assert.equal(h.updates.length,0);
});

test('P0 #140: real Bolonya composite titles query one specific first place, not an invented whole sentence',()=>{
 const h=makeHarness();
 const cases=[
  ['Piazza Maggiore, Fontana del Nettuno i basílica de San Petronio.','Piazza Maggiore'],
  ['Archiginnasio i Teatro Anatomico (entrada subjecta a horaris i disponibilitat).','Archiginnasio'],
  ['Passeig pel Quadrilatero i dinar. Opcions: Salumeria Simoni o Sfoglia Rina.','Quadrilatero'],
  ['Passeig per l’entorn de les Due Torri i visita a Piazza Santo Stefano.','Due Torri'],
  ['Opcional: visita a la Torre dell’Orologio, amb reserva prèvia.','Torre dell’Orologio'],
  ['Aperitiu a la zona de Via del Pratello.','Via del Pratello'],
  ['Sopar proposat a Trattoria da Me · Via San Felice, 50. Recomanable reservar.','Trattoria da Me'],
  ['Esmorzar proposat a Caffè Terzi.','Caffè Terzi'],
  ['Finestrella di Via Piella.','Finestrella di Via Piella'],
  ['Passeig per Via Zamboni, el barri universitari i l’antic gueto jueu.','Via Zamboni'],
  ['Dinar proposat a Trattoria del Rosso.','Trattoria del Rosso']
 ];
 for(const [title,wanted]of cases){
  const row={title};
  assert.equal(h.fn.itineraryAutoPlaceFocusedName(row),wanted,title);
  assert.equal(h.fn.itineraryAutoPlaceQuery(row).split(',')[0],wanted,title);
  assert.equal(h.fn.itineraryAutoPlaceShouldSearch(row),true,title);
 }
 for(const title of ['Dinar','Esmorzar i passeig pel centre històric','Sortida del vol de Barcelona (BCN)','Trasllat orientatiu en taxi cap al centre de Bolonya.']){
  assert.equal(h.fn.itineraryAutoPlaceShouldSearch({title}),false,title);
 }
});
test('P0 #140: itinerary agenda appears before place proposals so hours are visible',()=>{
 assert.ok(html.indexOf('id="genericItineraryDays"')<html.indexOf('id="itineraryAutoPlacePanel"'));
 assert.match(html,/item\.timeLabel/);
 assert.match(html,/item\.sourceType==='manual'&&\/\^\(\?:sortida\|arribada\|trasllat/);
});

test('v25: a single exact automatically recognized place needs no dropdown selection',async()=>{
 const h=makeHarness();
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 assert.match(h.$('itineraryAutoPlaceList').innerHTML,/Ubicació reconeguda/);
 assert.match(h.$('itineraryAutoPlaceList').innerHTML,/Castell de Riga/);
 assert.doesNotMatch(h.$('itineraryAutoPlaceList').innerHTML,/data-itinerary-auto-place="activity-a"/);
 assert.equal(h.$('itineraryAutoPlaceSave').disabled,false);
});

const locatedRow=(title,extra={})=>({id:title,title,trip_id:'trip-a',location_name:null,address:null,city:null,resolved_location:null,
 status:'planned',updated_at:'rev-'+title,local_date:'2026-12-27',starts_at:'2026-12-27T09:00:00Z',ends_at:'2026-12-27T10:00:00Z',
 notes:'Reserva i document originals',is_fixed:true,...extra});
const london=[{canonical_name:'London',country_code:'GB'}];
const londonPlace=name=>({...place(name),locality:'London',country_code:'GB',latitude:51.5,longitude:-0.12});

test('v27: British Museum, Tower of London and London Eye save verified geography without confirmation',async()=>{
 const names=['British Museum','Tower of London','London Eye'],rows=names.map(n=>locatedRow(n));
 const original=structuredClone(rows);
 const h=makeHarness({rows,stops:london,answers:names.map(n=>({data:{candidates:[{place:londonPlace(n)}]}}))});
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();await drain();
 assert.equal(h.updates.length,3);
 for(let i=0;i<3;i++){
  assert.equal(h.rows[i].location_name,names[i]);
  assert.equal(h.rows[i].resolved_location.place.latitude,51.5);
  const {location_name,resolved_location,...preserved}=h.rows[i];
  const {location_name:old,resolved_location:geo,...expected}=original[i];
  assert.deepEqual(preserved,expected,'All original dates, times, descriptions and reservations survive');
 }
 assert.equal(h.queries[0].payload.body.country_code,'GB');
 assert.match(h.queries[0].payload.body.text,/British Museum, London/);
});

test('v27: repeated name in another city or country never becomes an automatic location',()=>{
 const h=makeHarness({stops:london}),row=locatedRow('British Museum');
 assert.equal(h.fn.itineraryAutoPlaceVerified(row,[{...londonPlace('British Museum'),locality:'Oxford'}]),null);
 assert.equal(h.fn.itineraryAutoPlaceVerified(row,[{...londonPlace('British Museum'),country_code:'US'}]),null);
 assert.equal(h.fn.itineraryAutoPlaceVerified(row,[londonPlace('British Museum'),londonPlace('British Museum')]),null);
 assert.equal(h.fn.itineraryAutoPlaceVerified(row,[{...londonPlace('British Museum'),coordinate_role:'representative_point'}]),null);
});

test('v27: multiple stops require an explicit matching activity city; never assume first city',()=>{
 const stops=[...london,{canonical_name:'Oxford',country_code:'GB'}],h=makeHarness({stops}),row=locatedRow('British Museum');
 assert.equal(h.fn.itineraryAutoPlaceVerified(row,[londonPlace('British Museum')]),null);
 assert.doesNotMatch(h.fn.itineraryAutoPlaceQuery(row),/London|Oxford/);
 assert.equal(h.fn.itineraryAutoPlaceVerified({...row,city:'London'},[londonPlace('British Museum')]).canonical_name,'British Museum');
});

test('v27: supplied/imported location text is preserved while reliable geography is added',async()=>{
 const row=locatedRow('Visita al British Museum',{location_name:'British Museum'}),h=makeHarness({rows:[row],stops:london,
  answers:[{data:{candidates:[{place:londonPlace('British Museum')}]}}]});
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();await drain();
 assert.equal(h.updates.length,1);
 assert.deepEqual(Object.keys(h.updates[0].patch),['resolved_location']);
 assert.equal(row.location_name,'British Museum');
});

test('v27: unknown places and unavailable providers never invent coordinates or retry writes on render',async()=>{
 for(const answer of [{data:{candidates:[]}},{data:{error:'provider_unavailable'}}]){
  const h=makeHarness({rows:[locatedRow('Unknown Museum')],stops:london,answers:[answer]});
  h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
  h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
  assert.equal(h.updates.length,0);assert.equal(h.rows[0].resolved_location,null);
 }
});

test('v27: pending geocoder response cannot replace a concurrent manual correction',async()=>{
 let finish;
 const row=locatedRow('British Museum'),h=makeHarness({rows:[row],stops:london});
 h.scope.db.functions.invoke=()=>new Promise(resolve=>finish=resolve);
 h.fn.proposeItineraryAutoPlaces('2026-12-27');
 row.location_name='My meeting point';row.updated_at='manual-correction';
 finish({data:{candidates:[{place:londonPlace('British Museum')}]}});await drain();
 assert.equal(row.location_name,'My meeting point');assert.equal(row.resolved_location,null);assert.equal(h.updates.length,0);
});

test('v27: a saved geographic correction is never searched again',async()=>{
 const row=locatedRow('British Museum',{resolved_location:{place:londonPlace('My entrance')}});
 const h=makeHarness({rows:[row],stops:london});h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 assert.equal(h.queries.length,0);assert.equal(h.updates.length,0);
});

test('v27: reserved activities use the same confidence guard and keep reservation data',async()=>{
 const row={...locatedRow('British Museum'),venue_name:null,activity_type:'museum',reservation_status:'confirmed',
  latitude:null,longitude:null,booking_reference:'KEEP',start_at:'2026-12-27T10:00:00Z'};
 delete row.location_name;
 const h=makeHarness({rows:[row],stops:london,answers:[{data:{candidates:[{place:londonPlace('British Museum')}]}}]});
 h.scope.activityRows=[row];h.scope.manualItineraryRows=[];h.scope.itineraryProjection=[{sourceType:'activity',sourceId:row.id,localDate:row.local_date}];
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();await drain();
 assert.equal(h.updates.length,1);assert.equal(row.venue_name,'British Museum');assert.equal(row.resolved_location.place.latitude,51.5);
 assert.equal(row.booking_reference,'KEEP');assert.equal(row.start_at,'2026-12-27T10:00:00Z');assert.equal(row.reservation_status,'confirmed');
});

test('v27: existing activity coordinates and local transport are excluded from automatic enrichment',()=>{
 const h=makeHarness({stops:london});h.scope.manualItineraryRows=[];
 h.scope.activityRows=[{...locatedRow('British Museum'),latitude:51.5,longitude:-0.12},
  {...locatedRow('London Eye'),activity_type:'transport'}];
 h.scope.itineraryProjection=h.scope.activityRows.map(row=>({sourceType:'activity',sourceId:row.id,localDate:row.local_date}));
 assert.equal(h.fn.itineraryAutoPlaceRows('2026-12-27').length,0);
});

test('v27: same-day adjacent explicit cities disambiguate a multi-stop trip; mixed days/cities/transfers do not',()=>{
 const rows=[locatedRow('Before',{city:'London'}),locatedRow('British Museum'),locatedRow('After',{city:'London'})];
 const h=makeHarness({rows,stops:[...london,{canonical_name:'Oxford',country_code:'GB'}]});
 assert.equal(h.fn.itineraryAutoPlaceVerified(rows[1],[londonPlace('British Museum')]).canonical_name,'British Museum');
 rows[2].city='Oxford';assert.equal(h.fn.itineraryAutoPlaceVerified(rows[1],[londonPlace('British Museum')]),null);
 rows[2].city='London';rows[2].title='Trasllat a London';assert.equal(h.fn.itineraryAutoPlaceVerified(rows[1],[londonPlace('British Museum')]),null);
 rows[2].title='After';h.scope.itineraryProjection[2].localDate='2026-12-28';
 assert.equal(h.fn.itineraryAutoPlaceVerified(rows[1],[londonPlace('British Museum')]),null);
});

test('Bolonya: existing manual plans resolve, persist and are not written twice; ambiguous square stays pending',async()=>{
 const titles=['Opcional: visita a la Torre dell’Orologio, amb reserva prèvia.','Piazza Maggiore, Fontana del Nettuno i basílica de San Petronio.'];
 const rows=titles.map(title=>locatedRow(title)),before=structuredClone(rows);
 const makePlace=(name,id=name)=>({...place(name),locality:'Bolonya',country_code:'IT',latitude:44.4937,longitude:11.3426,provider_place_id:id});
 const h=makeHarness({rows,stops:[{canonical_name:'Bolonya',country_code:'IT'}],answers:[
  {data:{candidates:[{place:makePlace('Torre dell’Orologio')}]}},
  {data:{candidates:[{place:makePlace('Piazza Maggiore','one')},{place:makePlace('Piazza Maggiore','two')}]}}
 ]});
 h.scope.trip.name='Bolonya amb amigues';
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();await drain();
 assert.deepEqual(h.queries.map(q=>q.payload.body.text),['Torre dell’Orologio, Bolonya','Piazza Maggiore, Bolonya']);
 assert.ok(h.queries.every(q=>q.payload.body.country_code==='IT'));
 assert.equal(h.updates.length,1);assert.equal(rows[0].resolved_location.place.canonical_name,'Torre dell’Orologio');
 assert.equal(rows[1].resolved_location,null,'Two distinct POIs remain for human review');
 for(let i=0;i<rows.length;i++)for(const k of Object.keys(before[i]).filter(k=>!['location_name','resolved_location'].includes(k)))assert.deepEqual(rows[i][k],before[i][k]);
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();assert.equal(h.updates.length,1);
 const reloaded=makeHarness({rows:structuredClone(rows),stops:[{canonical_name:'Bolonya',country_code:'IT'}]});
 assert.equal(reloaded.fn.itineraryAutoPlaceRows('2026-12-27').length,1,'Saved tower is not geocoded again after reload');
});

test('trip entry loads the country required by both automatic and manual resolution',()=>{
 const entry=html.slice(html.indexOf('async function selectTrip('),html.indexOf('async function initializeGenericChecklistDefaults('));
 const selected=entry.match(/from\('trip_stops'\)\.select\('([^']+)'\)/)?.[1].split(',');
 assert.ok(selected?.includes('country_code'),'PostgREST only returns explicitly selected columns');
});

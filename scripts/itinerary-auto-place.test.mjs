import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fallback=readFileSync(new URL('../404.html',import.meta.url),'utf8');
const start=html.indexOf('function itineraryAutoPlaceRows(');
const end=html.indexOf('async function fetchAgendaManualItems(',start);
assert.ok(start>=0&&end>start,'A2.11 grouped place code must be present');
const source=html.slice(start,end);
const place=(name,coordinate_role='exact_location')=>({
 canonical_name:name,administrative_area:'Rīga',country_code:'LV',
 latitude:56.95,longitude:24.10,coordinate_role
});

function makeHarness({rows,answers=[{data:{candidates:[{place:place('Castell de Riga')} ]}}]}={}){
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
  assert.equal(table,'trip_itinerary_items');
  return {update(patch){
   const filters=[];
   return {eq(field,value){filters.push({kind:'eq',field,value});return this},
    is(field,value){filters.push({kind:'is',field,value});return this},
    select(value){assert.equal(value,'id');return this},
    async maybeSingle(){
     updates.push({patch,filters});
     const id=filters.find(f=>f.field==='id')?.value;
     const row=rows.find(r=>r.id===id);
     if(!row||row.location_name||!filters.some(f=>f.field==='updated_at'&&f.value===row.updated_at))
      return {data:null,error:null};
     row.location_name=patch.location_name;
     return {data:{id},error:null};
    }};
  }};
 }};
 const scope={
  $,$noop:()=>{},trip:{id:'trip-a',name:'Riga'},session:{user:{id:'user-a'}},
  tripLoadGeneration:3,genericItinerarySelectedDay:'2026-12-27',
  itineraryProjection:rows.map(row=>({sourceType:'manual',sourceId:row.id,localDate:row.local_date})),
  manualItineraryRows:rows,connectionUnavailable:()=>false,isLondonTrip:()=>false,
  itineraryRequestIsCurrent:()=>true,
  manualItineraryPlaceQuery:row=>(row.title.replace(/^Visita al /,'')+', Riga'),db,
  loadManualItineraryItems:async()=>rows,msg:(_target,message)=>messages.push(message),
  esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 };
 const context=vm.createContext(scope);
 const fn=vm.runInContext('let itineraryAutoPlaceContext=null;'+source+
  ';({itineraryAutoPlaceRows,itineraryAutoPlaceShouldSearch,itineraryAutoPlaceDefault,itineraryAutoPlaceOptions,'+
  'itineraryAutoPlaceContextFor,proposeItineraryAutoPlaces,saveItineraryAutoPlaces,renderItineraryAutoPlacePanel})',context);
 return {fn,scope,$,queries,updates,messages,rows,context};
}
async function drain(){await new Promise(resolve=>setImmediate(resolve))}

test('A2.11: grouped suggestions are visible without importing a PDF or modifying an activity',async()=>{
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

test('A2.11: explicit group confirmation updates only location text, on a scoped versioned row',async()=>{
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

test('A2.11: ambiguous or generic results stay unselected and cannot be saved silently',async()=>{
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

test('A2.11: generic transfers and meals are not sent for geocoding',async()=>{
 const h=makeHarness({rows:[
  {id:'food',title:'Dinar',local_date:'2026-12-27',location_name:null,address:null,status:'planned',updated_at:'rev-2'},
  {id:'transfer',title:'Trasllat a hotel',local_date:'2026-12-27',location_name:null,address:null,status:'planned',updated_at:'rev-3'}
 ]});
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 assert.equal(h.queries.length,0);
 assert.equal(h.updates.length,0);
});

test('A2.11: duplicate queries reuse trip-session results, without extra provider usage',async()=>{
 const rows=['a','b'].map(id=>({id,title:'Visita al Castell de Riga',local_date:'2026-12-27',
  location_name:null,address:null,status:'planned',updated_at:'rev-'+id}));
 const h=makeHarness({rows});
 h.fn.proposeItineraryAutoPlaces('2026-12-27');await drain();
 assert.equal(h.queries.length,1);
 assert.equal(h.fn.itineraryAutoPlaceContextFor('2026-12-27').records.size,2);
});

test('A2.11: no active trip scope can reuse suggested locations from another trip',async()=>{
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// A2.10 — user-directed place suggestions for EXISTING itinerary items.
// No destructive actions, no external provider calls or database test fixtures.
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fallback=readFileSync(new URL('../404.html',import.meta.url),'utf8');
const start=html.indexOf('function manualItineraryPlaceQuery(');
const end=html.indexOf('async function fetchAgendaManualItems(',start);
assert.ok(start>0&&end>start,'Place selection helpers are present');
const source=html.slice(start,end);

function harness(providerResult){
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{
   value:'',textContent:'',disabled:false,onclick:null,
   dataset:id==='manualItineraryForm'?{tripId:'trip-1',editId:'activity-1'}:{},
   classList:{contains:()=>false},
   children:[],
   replaceChildren(){this.children=[]},
   append(child){this.children.push(child)}
  });
  return elements.get(id);
 };
 let resolveProvider, saveCalls=0;
 const db={functions:{invoke:()=>new Promise(resolve=>{resolveProvider=resolve})}};
 if(providerResult!==undefined)db.functions.invoke=async()=>providerResult;
 const scope={
  $,trip:{id:'trip-1',name:'Riga'},session:{user:{id:'user-1'}},tripLoadGeneration:4,
  isLondonTrip:()=>false,connectionUnavailable:()=>false,
  itineraryRequestIsCurrent:()=>true,db,
  saveManualItineraryDraft:()=>{saveCalls++},
  document:{createElement:()=>({type:'',className:'',textContent:'',onclick:null})}
 };
 const context=vm.createContext(scope);
 vm.runInContext('let manualItineraryPlaceQueryEpoch=0;'+source,context);
 return {$,context,resolve:payload=>resolveProvider(payload),get saved(){return saveCalls}};
}

test('A2.10: location search is opt-in, embedded in existing editing workflow and scoped to manual itinerary cards',()=>{
 assert.match(html,/id="manualItineraryPlaceQuery"/);
 assert.match(html,/id="manualItineraryPlaceSearch"/);
 assert.match(html,/id="manualItineraryPlaceResults"/);
 assert.match(html,/data-itinerary-find-place/);
 assert.match(html,/data-itinerary-source/);
 assert.match(html,/resetManualItineraryPlaceSearch\(row\)/);
 assert.match(html,/manualItineraryPlaceQueryEpoch\+\+/);
 assert.match(html,/form\.dataset\.tripId!==trip\.id/);
 assert.match(html,/action:'search',text:query,language:'ca'/);
 assert.match(html,/saveManualItineraryDraft\(\)/);
 assert.equal(html,fallback,'Pages fallback must match source');
});

test('A2.10: suggest a query from the existing visit title, without changing the original item',()=>{
 const h=harness({data:{candidates:[]}});
 const query=vm.runInContext("manualItineraryPlaceQuery({title:'Visita al Castell de Riga',city:''})",h.context);
 assert.equal(query,'Castell de Riga');
 assert.equal(h.$('manualItineraryLocation').value,'');
});

test('A2.10: provider suggestions remain uncommitted until user selects and saves',async()=>{
 const h=harness({data:{candidates:[
  {place:{canonical_name:'Castell de Riga',administrative_area:'Rīga',country_code:'LV',
   latitude:56.9502,longitude:24.1005,coordinate_role:'exact_location'}},
  {place:{canonical_name:'Riga',administrative_area:'Rīga',country_code:'LV',
   latitude:56.95,longitude:24.1,coordinate_role:'representative_point'}}
 ]}});
 h.$('manualItineraryPlaceQuery').value='Castell de Riga, Riga';
 h.$('manualItineraryCity').value='';
 await vm.runInContext('searchManualItineraryPlaces()',h.context);
 assert.equal(h.$('manualItineraryLocation').value,'');
 assert.equal(h.$('manualItineraryPlaceResults').children.length,2);
 assert.match(h.$('manualItineraryPlaceResults').children[1].textContent,/aproximada/);
 h.$('manualItineraryPlaceResults').children[0].onclick();
 assert.equal(h.$('manualItineraryLocation').value,'Castell de Riga');
 assert.equal(h.$('manualItineraryCity').value,'','Region must not silently fill city');
 assert.equal(h.$('manualItineraryAddress').value,'','No fabricated address');
 assert.equal(h.saved,1,'Only existing draft save, not database write');
 assert.equal(h.$('manualItineraryPlaceResults').children.length,0);
});

test('A2.10: stale provider results after closing or switching item cannot affect current form',async()=>{
 const h=harness();
 h.$('manualItineraryPlaceQuery').value='Riga';
 const pending=vm.runInContext('searchManualItineraryPlaces()',h.context);
 vm.runInContext('manualItineraryPlaceQueryEpoch++',h.context);
 h.resolve({data:{candidates:[{place:{canonical_name:'Wrong',latitude:1,longitude:1}}]}});
 await pending;
 assert.equal(h.$('manualItineraryLocation').value,'');
 assert.equal(h.$('manualItineraryPlaceResults').children.length,0);
 assert.equal(h.saved,0);
});

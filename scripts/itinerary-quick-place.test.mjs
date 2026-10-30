import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountQuickItineraryPlace,prioritizeItineraryPlaces} from '../domain/itinerary-quick-place.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fallback=readFileSync(new URL('../404.html',import.meta.url),'utf8');
const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const packageScript=readFileSync(new URL('./package-pages.mjs',import.meta.url),'utf8');
const place=(name,role='exact_location')=>({
 canonical_name:name,administrative_area:'Bologna',country_code:'IT',
 coordinate_role:role,latitude:44.4949,longitude:11.3426
});

class FakeNode{
 constructor(tag='div'){
  this.tagName=tag;this.children=[];this.dataset={};this.style={};this.textContent='';
  this.value='';this.disabled=false;this.isConnected=false;this.attributes={};
 }
 setAttribute(name,value){this.attributes[name]=value}
 append(...nodes){for(const node of nodes){node.parent=this;node.isConnected=this.isConnected;this.children.push(node)}}
 replaceChildren(...nodes){for(const old of this.children)old.remove();this.children=[];this.append(...nodes)}
 remove(){
  this.isConnected=false;
  if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);
 }
 querySelectorAll(selector){
  const descendants=this.children.flatMap(node=>[node,...node.querySelectorAll('*')]);
  if(selector==='*')return descendants;
  if(selector==='button')return descendants.filter(node=>node.tagName==='button');
  return [];
 }
 focus(){}
 scrollIntoView(){}
}
async function harness(run){
 const previous=globalThis.document,sections=[];
 globalThis.document={
  createElement:tag=>new FakeNode(tag),
  querySelectorAll:selector=>selector==='[data-quick-itinerary-place]'?sections.filter(s=>s.isConnected):[]
 };
 const host=new FakeNode('article');host.isConnected=true;
 const add=options=>{
  const result=mountQuickItineraryPlace({host,row:{id:'item-1',title:'Archiginnasio'},
   query:'Archiginnasio, Bologna',...options});
  sections.push(result.section);return result;
 };
 try{await run({host,add})}finally{globalThis.document=previous}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('v25: find-place opens direct picker, never the full editor; existing rows only',()=>{
 assert.equal(html,fallback,'Pages fallback and index remain byte-identical');
 assert.match(html,/async function openQuickItineraryPlacePicker\(button\)/);
 assert.match(html,/data-itinerary-find-place/);
 assert.match(html,/void openQuickItineraryPlacePicker\(button\)/);
 assert.doesNotMatch(html,/openManualItineraryForm\(button\.dataset\.itineraryFindPlace\)/);
 assert.match(html,/resolved_location:itineraryAutoPlaceSnapshot\(row,place\)/);
 assert.match(html,/\.eq\('trip_id',tripId\)\.eq\('id',id\)\.eq\('updated_at',revision\)\.is\('location_name',null\)/);
 assert.match(html,/data\?'Ubicació desada/);
 assert.match(packageScript,/'itinerary-quick-place\.mjs'/);
 assert.match(worker,/'\.\/domain\/itinerary-quick-place\.mjs'/);
 assert.match(worker,/freya-travel-release-6444-v44/);
 assert.match(html,/pwa-itinerary-planning-rig04/);
});

test('v25: recognisable landmark is suggested and a single confirmation saves the existing row',async()=>{
 await harness(async({add})=>{
  const saves=[],queries=[];
  const view=add({
   search:async q=>{queries.push(q);return {options:[place('Archiginnasio')]}},
   save:async p=>{saves.push(p.canonical_name);return true},
   current:()=>true
  });
  await settle();
  assert.deepEqual(queries,['Archiginnasio, Bologna']);
  assert.match(view.section.textContent||view.section.children[3].textContent,/ubicació concreta/i);
  const choices=view.section.children.at(-1);
  assert.equal(choices.children.length,1);
  assert.match(choices.children[0].textContent,/Confirma: Archiginnasio/);
  assert.equal(saves.length,0,'A suggestion does not silently write');
  await choices.children[0].onclick();
  assert.deepEqual(saves,['Archiginnasio']);
  assert.equal(view.section.isConnected,false);
 });
});

test('v25: ambiguous location requires a direct choice, no navigation or unexpected write',async()=>{
 await harness(async({add})=>{
  const saves=[];
  const view=add({
   initialOptions:[place('Piazza Maggiore'),place('Piazza Maggiore alternate')],
   search:async()=>{throw Error('cached suggestions should be reused')},
   save:async p=>{saves.push(p.canonical_name);return true},
   current:()=>true
  });
  const choices=view.section.children.at(-1);
  assert.equal(choices.children.length,2);
  assert.match(view.section.children[3].textContent,/Tria la correcta/);
  assert.equal(saves.length,0);
  await choices.children[1].onclick();
  assert.deepEqual(saves,['Piazza Maggiore alternate']);
 });
});

test('v25: approximate or missing candidates cannot be assigned as exact routing places',async()=>{
 await harness(async({add})=>{
  let saves=0;
  const view=add({
   initialOptions:[place('Bologna','representative_point')],
   search:async()=>({options:[]}),
   save:async()=>{saves++;return true}
  });
  assert.equal(view.section.children.at(-1).children.length,0);
  assert.match(view.section.children[3].textContent,/No he trobat un lloc prou concret/);
  assert.equal(saves,0);
 });
});

test('v25: stale response after closing cannot update location or render choices',async()=>{
 await harness(async({add})=>{
  let finish,saves=0;
  const view=add({
   search:()=>new Promise(resolve=>finish=resolve),
   save:async()=>{saves++;return true}
  });
  view.section.children[0].children[1].onclick();
  finish({options:[place('Archiginnasio')]});
  await settle();
  assert.equal(view.section.isConnected,false);
  assert.equal(view.section.children.at(-1).children.length,0);
  assert.equal(saves,0);
 });
});

test('v25: provider outage leaves existing itinerary unchanged and keeps search available',async()=>{
 await harness(async({add})=>{
  let saves=0;
  const view=add({
   search:async()=>({error:'El servei de mapes no respon'}),
   save:async()=>{saves++;return true}
  });
  await settle();
  assert.match(view.section.children[3].textContent,/mapes no respon/);
  assert.equal(view.section.children[2].disabled,false);
  assert.equal(saves,0);
 });
});


test('v26: Archiginnasio + Anatomical Theatre ranks the actual compound POI above nearby street and library',()=>{
 const row={title:'Archiginnasio i Teatro Anatomico (entrada subjecta a horaris i disponibilitat).'};
 const names=[
  "Biblioteca Comunale dell'Archiginnasio",
  "Via dell'Archiginnasio",
  "Archiginnasio Palace and Anatomical Theater",
  "Archiginnasio di Bologna"
 ].map(n=>place(n));
 const result=prioritizeItineraryPlaces(row,'Archiginnasio, Bolonya',names);
 assert.equal(result.recommended?.canonical_name,'Archiginnasio Palace and Anatomical Theater');
 assert.equal(result.choices.length,4);
 assert.equal(result.choices[0].canonical_name,'Archiginnasio Palace and Anatomical Theater');
});

test('v26: a genuinely ambiguous name never picks one city or site automatically',()=>{
 const row={title:'Visita al Museu Central'};
 const names=[place('Museu Central'),place('Museu Central')];
 assert.equal(prioritizeItineraryPlaces(row,'Museu Central, Bolonya',names).recommended,null);
 const generic=[place('Via del Pratello'),place('Via del Pratello 12')];
 assert.equal(prioritizeItineraryPlaces({title:'Passeig per Via del Pratello'},'Via del Pratello, Bolonya',generic).recommended,null);
});

test('v26: compound landmark is promoted; other search results remain accessible without any automatic save',async()=>{
 await harness(async({add})=>{
  let saves=0;
  const row={id:'item-1',title:'Archiginnasio i Teatro Anatomico (entrada subjecta a horaris)'};
  const view=add({
   row,
   initialOptions:[
    place("Biblioteca Comunale dell'Archiginnasio"),
    place("Via dell'Archiginnasio"),
    place("Archiginnasio Palace and Anatomical Theater"),
    place("Archiginnasio di Bologna")
   ],
   search:async()=>{throw Error('Initial options should be reused')},
   save:async()=>{saves++;return true}
  });
  const choices=view.section.children.at(-1);
  assert.equal(choices.children.length,2,'One primary action and collapsed alternatives');
  assert.match(choices.children[0].textContent,/Confirma: Archiginnasio Palace and Anatomical Theater/);
  assert.equal(choices.children[1].tagName,'details');
  assert.match(choices.children[1].children[0].textContent,/altres ubicacions \(3\)/);
  assert.equal(choices.children[1].querySelectorAll('button').length,3);
  assert.equal(saves,0,'No database write just from a strong suggestion');
  const heading=view.section.children[0];
  assert.match(heading.children[1].style.cssText,/white-space:nowrap/);
  assert.match(heading.children[1].textContent,/Tanca/);
  assert.match(heading.style.cssText,/flex-wrap:wrap/);
 });
});

test('quick search uses the shared city/name confidence guard instead of country-only auto selection',async()=>{
 await harness(async({add})=>{
  const chosen=place('Archiginnasio');let saves=0,checks=0;
  add({autoSave:true,countryCode:'IT',initialOptions:[chosen],automaticMatch:options=>{checks++;assert.equal(options[0],chosen);return null},search:async()=>({options:[chosen]}),save:async()=>{saves++;return true}});
  await settle();assert.equal(checks,1);assert.equal(saves,0,'Ambiguous or wrong-city candidate cannot be saved automatically');
  add({autoSave:true,initialOptions:[chosen],automaticMatch:options=>options[0],search:async()=>({options:[chosen]}),save:async p=>{assert.equal(p,chosen);saves++;return true}});
  await settle();assert.equal(saves,1);
 });
});

test('a fresh quick-search result can save after the search busy flag clears',async()=>{
 await harness(async({add})=>{
  const chosen=place('Archiginnasio');let saves=0;
  add({autoSave:true,automaticMatch:options=>options[0],search:async()=>({options:[chosen]}),save:async()=>{saves++;return true}});
  await settle();assert.equal(saves,1);
 });
});

test('same-name candidates save the exact verified object, never the first name match',async()=>{
 await harness(async({add})=>{
  const other={...place('Archiginnasio'),locality:'Other city'},verified={...place('Archiginnasio'),locality:'Bolonya'};let saved;
  add({autoSave:true,initialOptions:[other,verified],automaticMatch:()=>verified,search:async()=>({options:[]}),save:async p=>{saved=p;return true}});
  await settle();assert.equal(saved,verified);
 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pack=readFileSync(new URL('./package-pages.mjs',import.meta.url),'utf8');
const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const script=html.slice(html.indexOf('// A2.7: in-memory-only itinerary review.'),html.indexOf('function categoryIcon(category){'));
test('A2.7: import lives inside generic itinerary without affecting London',()=>{
 assert.match(html,/id="openItineraryImport"/);
 assert.match(html,/id="itineraryImportPanel"/);
 assert.match(html,/id="itineraryImportCandidates"/);
 assert.match(html,/id="itineraryImportWrite" disabled/);
 assert.match(html,/Desar activitats seleccionades/);
 assert.match(script,/isLondonTrip\(\)/);
});
test('A2.7: AI PDF processing requires explicit opt-in, with no silent document sends',()=>{
 assert.match(html,/id="itineraryImportConsent" type="checkbox"/);
 assert.match(html,/servei d.IA d.OpenAI/);
 assert.match(script,/\$\('itineraryImportConsent'\)\.checked/);
 assert.match(script,/db\.functions\.invoke\('import-itinerary'/);
 assert.match(script,/body:\{trip_id:state\.tripId,document_id:doc\.id\}/);
 assert.doesNotMatch(script,/setInterval\(/);
});
test('A2.7: a chosen existing document is reused, file upload is user initiated',()=>{
 assert.match(script,/itineraryImportMimeAllowed\(row\.mime_type\)/);
 assert.match(script,/processItineraryImportDocument\(doc\)/);
 assert.match(script,/uploadTripDocument\(file,/);
 assert.match(script,/result\.size>10\*1024\*1024/);
 assert.match(script,/\$\('itineraryImportUpload'\)\.onclick/);
});
test('A2.7 public: a document-source menu chooses PDF, photo, or a Freya file',()=>{
 assert.match(html,/id="itineraryImportUpload"[^>]*>＋ Pujar un document/);
 assert.match(html,/id="itineraryImportSourceMenu"[^>]*hidden/);
 assert.match(html,/id="itineraryImportChoosePdf"/);
 assert.match(html,/id="itineraryImportChoosePhoto"/);
 assert.match(html,/id="itineraryImportChooseExisting"/);
 assert.match(html,/id="itineraryImportSelectedName"/);
 assert.match(html,/Analitza el document/);
 assert.match(html,/id="itineraryImportConsentWrap"[^>]*hidden/);
 assert.match(script,/showItineraryImportSourceMenu/);
 assert.match(script,/\.eq\('category','Foto'\)/);
 assert.match(script,/itineraryImportMimeAllowed\(row\.mime_type\)/);
 assert.match(script,/state\.file=result/);
 assert.match(script,/state\.uploadedDoc=doc/);
 assert.match(script,/itineraryImportNormalizePhoto/);
 assert.match(script,/canvas\.toBlob/);
 assert.match(script,/\$\('itineraryImportConsent'\)\.checked=false/);
 const start=script.indexOf('async function itineraryImportSelectedLocalFile(');
 const stop=script.indexOf('async function processItineraryImportSelected()',start);
 assert.ok(start>0&&stop>start);
 assert.doesNotMatch(script.slice(start,stop),/uploadTripDocument|functions\.invoke/);
 assert.match(script,/\$\('itineraryImportAnalyze'\)\.onclick/);
});
test('A2.8: write requires a real click, authenticated scope, confirmation and conflict-ignore insert',()=>{
 assert.match(script,/state\.api\.summarizeItineraryReview\(state\.review,existing\)/);
 assert.match(script,/async function writeConfirmedItineraryImport\(/);
 assert.match(script,/itineraryImportStillCurrent\(state\)/);
 assert.match(script,/state\.saveApi\.prepareItineraryImportRows/);
 assert.match(script,/if\(!ok\)/);
 assert.match(script,/db\.from\('trip_itinerary_items'\)\.upsert\(rows/);
 assert.match(script,/onConflict:'trip_id,id',ignoreDuplicates:true/);
 assert.match(script,/\$\('itineraryImportWrite'\)\.onclick/);
 assert.doesNotMatch(script,/db\.from\('trip_itinerary_items'\)\.delete/);
 assert.doesNotMatch(script,/db\.from\('trip_itinerary_items'\)\.update/);
 const analyze=script.slice(script.indexOf('async function processItineraryImportDocument('),
  script.indexOf('const itineraryImportReviewLabels'));
 assert.doesNotMatch(analyze,/\.upsert\(|\.insert\(|\.update\(/);
});
test('A2.7: account, trip and view changes clear preview and block stale requests',()=>{
 assert.match(html,/if\(next\?\.user\?\.id!==session\?\.user\?\.id\)closeItineraryImport\(\)/);
 assert.match(html,/async function selectTrip\(tripId,[^\n]*\{\n  closeItineraryImport\(\)/);
 assert.match(html,/if\(id!=='itineraryView'[^\n]*closeItineraryImport\(\)/);
 assert.match(script,/session\?\.user\?\.id===state\.userId/);
 assert.match(script,/tripLoadGeneration===state\.generation/);
 assert.match(script,/state\.epoch!==requestEpoch/);
});
test('A2.7: reviewed fields are escaped before being inserted in HTML',()=>{
 assert.match(script,/esc\(item\.values\.title/);
 assert.match(script,/esc\(item\.values\[key\]\|\|''\)/);
 assert.match(script,/esc\(ev\?\.\[0\]\?\.excerpt/);
 assert.match(script,/changeItineraryReviewItem/);
});
test('A2.7: Pages includes the same module graph as PWA cache',()=>{
 assert.match(pack,/'import-itinerary-proposal\.mjs'/);
 assert.match(pack,/'import-itinerary-review\.mjs'/);
 assert.match(pack,/'import-itinerary-write\.mjs'/);
 assert.match(worker,/\.\/domain\/import-itinerary-proposal\.mjs/);
 assert.match(worker,/\.\/domain\/import-itinerary-review\.mjs/);
 assert.match(worker,/\.\/domain\/import-itinerary-write\.mjs/);
 assert.match(worker,/freya-travel-release-6444-v41/);
});

test('A2.9: real async completion re-enables the imported itinerary save button',async()=>{
 const start=script.indexOf('async function processItineraryImportDocument(');
 const end=script.indexOf('const itineraryImportReviewLabels',start);
 assert.ok(start>0&&end>start);
 const source=script.slice(start,end);
 const el=new Map();
 const $=id=>{
  if(!el.has(id))el.set(id,{disabled:false,checked:id==='itineraryImportConsent',
   textContent:'',classList:{add(){},remove(){}}});
  return el.get(id);
 };
 const state={tripId:'trip-1',userId:'user-1',generation:1,epoch:0,
  busy:false,review:null,api:null,saveApi:null,documentId:null};
 const renders=[];
 const scope={
  itineraryImportState:state,itineraryImportEpoch:0,$,
  itineraryImportStillCurrent:current=>current===state,
  itineraryImportMimeAllowed:()=>true,
  updateItineraryImportConsent:()=>{},
  renderItineraryImportPreview:()=>{
   // Simulate renderItineraryImportPreview's real disabled condition.
   $('itineraryImportWrite').disabled=!!state.busy||!state.review;
   renders.push({busy:state.busy,disabled:$('itineraryImportWrite').disabled});
  },
  db:{functions:{invoke:async()=>({data:{proposal:{candidates:[]}}})}},
  loadTravelBookModule:async name=>name==='import-itinerary-review.mjs'?
   {createItineraryReview:()=>({items:[{included:true}]})}:
   {deselectExactImportDuplicates:()=>0},
  itineraryImportErrorMessage:()=>'' 
 };
 const fn=vm.runInNewContext(source+'; processItineraryImportDocument',scope);
 await fn({id:'doc-1',mime_type:'application/pdf'});
 assert.deepEqual(renders,[{busy:true,disabled:true},{busy:false,disabled:false}]);
 assert.equal(state.busy,false);
 assert.equal($('itineraryImportWrite').disabled,false);
});

test('A2.9: inline iPhone confirmation resolves only from explicit user interaction',async()=>{
 const start=script.indexOf('function requestItineraryImportConfirmation(');
 const end=script.indexOf('async function writeConfirmedItineraryImport(',start);
 assert.ok(start>0&&end>start);
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{textContent:'',onclick:null,
   classList:{hidden:true,add(name){if(name==='hidden')this.hidden=true},
    remove(name){if(name==='hidden')this.hidden=false}},
   scrollIntoView(){}});
  return elements.get(id);
 };
 const confirm=vm.runInNewContext(script.slice(start,end)+'; requestItineraryImportConfirmation',
  {$,trip:{name:'Riga'}});
 const state={confirmResolver:null};
 let saved=false;
 const accepted=confirm(state,13,2).then(ok=>{saved=ok;return ok});
 assert.equal(saved,false);
 assert.equal($('itineraryImportConfirm').classList.hidden,false);
 assert.match($('itineraryImportConfirmText').textContent,/13 activitats/);
 assert.match($('itineraryImportConfirmText').textContent,/2 activitats tenen avisos/);
 $('itineraryImportConfirmYes').onclick();
 assert.equal(await accepted,true);
 assert.equal(state.confirmResolver,null);
 assert.equal($('itineraryImportConfirm').classList.hidden,true);
 const cancelled=confirm(state,13,0);
 $('itineraryImportConfirmNo').onclick();
 assert.equal(await cancelled,false);
 assert.equal(state.confirmResolver,null);
 assert.equal($('itineraryImportConfirm').classList.hidden,true);
});

test('import review renders existing evidence and excludes matches only on explicit click',async()=>{
 const api=await import('../domain/import-itinerary-review.mjs');
 const field=value=>({value,confidence:'high',evidence:[{kind:'text',excerpt:value,page:1}]});
 const proposal={schema_version:1,source:{kind:'document',document_id:'doc',mime_type:'application/pdf'},candidates:['Museu','Passeig nou'].map((title,i)=>({source_order:i,classification_hint:'manual',fields:{title:field(title),local_date:field('2026-12-28'),start_local_time:field('09:00'),time_zone:field('Europe/Riga')},warnings:[]}))};
 const state={api,review:api.createItineraryReview(proposal,{tripId:'trip',userId:'user',documentId:'doc'})};
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{children:[],querySelectorAll:()=>[],textContent:'',innerHTML:''});return elements.get(id)};
 const start=script.indexOf('const itineraryImportReviewLabels='),end=script.indexOf("$('openItineraryImport').onclick",start);
 vm.runInNewContext(script.slice(start,end)+';renderItineraryImportPreview();',{$,itineraryImportState:state,itineraryImportContextIsCurrent:()=>true,connectionUnavailable:()=>false,offlineReadOnlySession:false,itinerarySourcesAreReady:()=>true,itineraryProjection:[{title:'Museu',localDate:'2026-12-28',timeLabel:'09:00'}],esc:value=>String(value).replaceAll('<','&lt;')});
 assert.match($('itineraryImportCandidates').innerHTML,/Activitat existent/);
 assert.equal(state.review.items[0].included,true,'render must not change selection');
 $('itineraryImportExcludeExisting').onclick();
 assert.deepEqual(state.review.items.map(x=>x.included),[false,true]);
 assert.match($('itineraryImportSaveStatus').textContent,/viatge no s’ha modificat/);
 assert.match($('itineraryImportReviewResult').innerHTML,/Revisió completada/);
 assert.match($('itineraryImportCandidates').innerHTML,/<details id="itineraryImportExcluded"><summary>Veure les activitats excloses \(1\)/);
 assert.equal($('itineraryImportRemaining').textContent,'1 activitat seleccionada per afegir');
 assert.equal($('itineraryImportWrite').disabled,false,'new item remains saveable');
});

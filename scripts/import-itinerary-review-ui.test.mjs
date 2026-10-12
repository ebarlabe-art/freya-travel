import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
 assert.match(worker,/freya-travel-release-6444-v12/);
});

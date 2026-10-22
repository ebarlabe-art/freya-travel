import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fallback=readFileSync(new URL('../404.html',import.meta.url),'utf8');
const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const rules=readFileSync(new URL('../AGENTS.md',import.meta.url),'utf8');

function block(start,end){
 const first=html.indexOf(start),last=html.indexOf(end,first+start.length);
 assert.ok(first>=0&&last>first,'missing function '+start);
 return html.slice(first,last);
}

test('universal-by-default is a repository rule; Pages fallback stays identical',()=>{
 assert.match(rules,/Universalitat obligatòria/);
 assert.equal(html,fallback);
 assert.match(worker,/freya-travel-release-6444-v40/);
});

test('the edited inline script is syntactically valid JavaScript',()=>{
 const begin=html.lastIndexOf('<script>');
 const end=html.lastIndexOf('</script>');
 assert.ok(begin>0&&end>begin);
 assert.doesNotThrow(()=>new vm.Script(html.slice(begin+'<script>'.length,end),{filename:'freya-travel-main.js'}));
});

test('reuses the original device speech engine rather than a second provider',()=>{
 const shared=block('function narrateCatalan(','function speakGuide(');
 const spoken=[],engine={
  cancel(){spoken.push({cancel:true})},
  speak(utterance){spoken.push({text:utterance.text,lang:utterance.lang,rate:utterance.rate})},
  getVoices(){return [{lang:'ca-ES',name:'Catalan'}]}
 };
 const context={speechSynthesis:engine,SpeechSynthesisUtterance:class{constructor(text){this.text=text}},window:{speechSynthesis:engine}};
 vm.runInNewContext('function catalanVoice(){return speechSynthesis.getVoices()[0]}\n'+shared+'\nthis.go=narrateCatalan',context);
 assert.equal(context.go('Bon dia, Bolonya!',{}),true);
 assert.deepEqual(spoken[1],{text:'Bon dia, Bolonya!',lang:'ca-ES',rate:1});
 assert.equal(context.go('   ',{}),false);
 assert.equal(spoken.length,2);
 assert.match(block('function speakGuide(','function initGuide('),/narrateCatalan\(/);
 assert.match(block('function playDayNarration(','function bindDayMetadataEditor('),/narrateCatalan\(/);
});

test('narrates saved trip context only, never bookings or private details',()=>{
 const one=html.match(/function dayNarrationText\(row\)\{[^\n]*\}/)?.[0];
 assert.ok(one);
 const sandbox={};
 vm.runInNewContext(one+'\nthis.project=dayNarrationText',sandbox);
 const row={title:'Dia cultural',summary:'Visites per la ciutat.',booking_reference:'SECRET',notes:'PRIVATE',documents:[{title:'passport'}]};
 assert.equal(sandbox.project(row),'Dia cultural. Visites per la ciutat.');
 assert.equal(sandbox.project({title:'',summary:''}),'');
 assert.equal(sandbox.project({title:'X'.repeat(1400)}).length,1200);
});

test('any destination with saved day context gets controls, an empty day does not',()=>{
 const fn=block('function dayMetadataEditorialHtml(localDate){','function openDayMetadataEditor(localDate){');
 const ctx={
  trip:{id:'trip-a'},session:{user:{id:'member-a'}},
  dayMetadataEditor:null,
  dayContextPending:new Set(),
  itineraryDayHeading:date=>date,
  esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;'),
  row:{title:'Dia de Bolonya',summary:'Piazza Maggiore'}
 };
 ctx.dayMetadataForDate=()=>ctx.row;
 vm.runInNewContext(fn+'\nthis.make=dayMetadataEditorialHtml',ctx);
 const b=ctx.make('2026-10-24');
 assert.match(b,/data-narrate-day='2026-10-24'/);
 assert.match(b,/Pausa \/ continua/);
 assert.match(b,/Atura/);
 ctx.row={title:'Dia de Riga',summary:'Mercat de Nadal'};
 assert.match(ctx.make('2026-12-27'),/data-narrate-day='2026-12-27'/);
 ctx.row=null;
 assert.doesNotMatch(ctx.make('2026-12-28'),/data-narrate-day/);
});

test('narration stops on trip, day and view changes, not tied to London',()=>{
 assert.match(html,/function setAppView\(id\)\{\s*if\(id!=='itineraryView'\)stopDayNarration\(\)/);
 assert.match(html,/async function selectTrip\(tripId,\{open=false,applyDeepLink=false\}=\{\}\)\{\s*closeItineraryImport\(\);\s*stopDayNarration\(\)/);
 assert.match(html,/currentDayNarration\.tripId!==trip\.id\|\|currentDayNarration\.date!==selected/);
 assert.doesNotMatch(block('function playDayNarration(','function bindDayMetadataEditor('),/isLondonTrip\(/);
 assert.match(html,/if\(listen\)listen\.onclick=\(\)=>playDayNarration/);
});

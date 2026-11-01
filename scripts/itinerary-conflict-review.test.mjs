import test from 'node:test';import assert from 'node:assert/strict';
import {agendaConflictAnalysis,importantConflicts,unreviewedConflicts,conflictFlashHtml,conflictSummaryHtml} from '../domain/itinerary-conflict-review.mjs';
import {readFileSync} from 'node:fs';
const items=()=>[{key:'manual:a',sourceType:'manual',title:'Museu',startsAt:'2030-12-28T10:30:00Z',endsAt:'2030-12-28T12:00:00Z',timeZone:'UTC',localDate:'2030-12-28',timingKind:'exact',status:'planned'}, {key:'activity:b',sourceType:'activity',title:'Reserva',startsAt:'2030-12-28T11:30:00Z',endsAt:'2030-12-28T12:30:00Z',timeZone:'UTC',localDate:'2030-12-28',timingKind:'exact',status:'confirmed'}];
test('#198 verified overlap visible without a route, uncertainty does not become alarm',()=>{
 const a=agendaConflictAnalysis(items());assert.equal(importantConflicts(a).length,1);assert.ok(a.assessment.counts.pending>0);
 assert.match(conflictFlashHtml(a),/Conflicte 1 de 1/);assert.match(conflictFlashHtml(a),/data-conflict-ack="0"/);assert.match(conflictFlashHtml(a),/10:30/);assert.match(conflictFlashHtml(a),/12:00/);assert.match(conflictFlashHtml(a),/No hi ha cap canvi segur/);
 const uncertain=items().map(x=>({...x,timingKind:'approximate'}));assert.equal(importantConflicts(agendaConflictAnalysis(uncertain)).length,0);
 assert.equal(importantConflicts(agendaConflictAnalysis(items().map(x=>({...x,status:'cancelled'})))).length,0);
});
test('#198 acknowledgement is explicit, remains unresolved, expires on changed time/version',()=>{
 const a=agendaConflictAnalysis(items()),reviewed=[importantConflicts(a)[0].fingerprint];assert.equal(unreviewedConflicts(a,reviewed).length,0);
 assert.match(conflictSummaryHtml(a,reviewed),/Revisat, no resolt/);assert.equal(conflictFlashHtml(a,reviewed),'');
 const changed=items();changed[0].endsAt='2030-12-28T12:15:00Z';assert.equal(unreviewedConflicts(agendaConflictAnalysis(changed),reviewed).length,1);
 changed[0].sourceUpdatedAt='v2';assert.equal(unreviewedConflicts(agendaConflictAnalysis(changed),reviewed).length,1);
 assert.equal(unreviewedConflicts(agendaConflictAnalysis([]),reviewed).length,0);
});
test('#198 midnight and explicit next start conflict; no invented end',()=>{
 const rows=items();rows[0].startsAt='2030-12-28T23:30:00Z';rows[0].endsAt='2030-12-29T00:30:00Z';rows[1].startsAt='2030-12-29T00:15:00Z';rows[1].endsAt=null;rows[1].localDate='2030-12-29';
 assert.equal(importantConflicts(agendaConflictAnalysis(rows)).length,1);
 rows[0].endsAt=null;assert.equal(importantConflicts(agendaConflictAnalysis(rows)).length,0);
});
test('#198 safe proposal offered only for affected mutable draft; strings escaped',()=>{
 const a=agendaConflictAnalysis(items());a.combined.items[0].mutable=true;a.combined.items[0].sourceOrder=0;
 a.solutions=[{id:0,sourceOrder:9,label:'Unrelated'},{id:1,sourceOrder:0,label:'Museu 12:35–14:05',note:'Revisa les dades'}];
 assert.match(conflictFlashHtml(a),/data-planning-accept="1"/);assert.doesNotMatch(conflictFlashHtml(a),/Unrelated/);
 a.combined.items[0].title='<img src=x>';assert.doesNotMatch(conflictFlashHtml(a),/<img/);
});
test('#198 final write checks conflicts before and after confirmation, before upload',()=>{
 const html=readFileSync('index.html','utf8'),flow=html.slice(html.indexOf('async function writeItineraryReconciliation'),html.indexOf("$('itineraryImportExcludeExisting').onclick"));
 assert.equal((flow.match(/guardImportConflicts\(state\)/g)||[]).length,2);
 assert.ok(flow.indexOf('guardImportConflicts(state)')<flow.indexOf('requestItineraryImportConfirmation'));
 assert.ok(flow.lastIndexOf('guardImportConflicts(state)')<flow.indexOf('uploadTripDocument'));
 assert.match(flow,/NO resolts/);
});

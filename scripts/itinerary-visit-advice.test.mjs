import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recommendedVisitAdvice} from '../domain/itinerary-visit-advice.mjs';
const start={timingKind:'exact',startsAt:'2030-10-20T09:00:00+02:00',endsAt:null,key:'manual:1'};
const next={timingKind:'exact',startsAt:'2030-10-20T10:30:00+02:00',tags:['Fix'],key:'manual:2'};
const suggestion={minutes:60,reason:'Visita principal del matí'};
const trip={route:{method:'routing',mode:'walk',duration_seconds:900,distance_m:1200}};
test('AI durations produce recommended ends without requiring end_at',()=>{
 const x=recommendedVisitAdvice(start,suggestion,next,trip,5);
 assert.equal(x.proposedEnd,'2030-10-20T08:00:00.000Z');
 assert.equal(x.latestLeaveBy,'2030-10-20T08:10:00.000Z');
 assert.equal(x.availableMinutes,70);
 assert.equal(x.shortageMinutes,0);
 assert.equal(x.travelMinutes,15);
 assert.equal(x.nextFixed,true);
});
test('late visit advice warns rather than moving a reserved fixed start',()=>{
 const x=recommendedVisitAdvice(start,{minutes:100,reason:'Llarga'},next,trip,5);
 assert.equal(x.shortageMinutes,30);
 assert.equal(next.startsAt,'2030-10-20T10:30:00+02:00');
});
test('unverified routing never emits a fabricated leave-by or arrival time',()=>{
 const x=recommendedVisitAdvice(start,suggestion,next,{error:'missing_place'},5);
 assert.equal(x.latestLeaveBy,null);
 assert.equal(x.travelMinutes,null);
 assert.equal(x.routePending,true);
 assert.equal(x.proposedEnd,'2030-10-20T08:00:00.000Z');
});
test('a confirmed end cannot be overwritten by an AI estimate',()=>{
 const x=recommendedVisitAdvice({...start,endsAt:'2030-10-20T09:45:00+02:00'},suggestion,next,trip,5);
 assert.equal(x.confirmedEnd,'2030-10-20T07:45:00.000Z');
 assert.equal(x.shortageMinutes,0);
});
test('only bounded suggestions and verified routes can guide schedules',()=>{
 assert.equal(recommendedVisitAdvice(start,{minutes:900},next,trip),null);
 const x=recommendedVisitAdvice({...start,timingKind:'daypart'},suggestion,next,trip);
 assert.equal(x.proposedEnd,null);
 assert.equal(x.latestLeaveBy,'2030-10-20T08:10:00.000Z');
 assert.equal(x.availableMinutes,null);
});
test('new route UI renders per-visit suggestions even without a calculated connection',()=>{
 const s=readFileSync(new URL('../domain/itinerary-route-ui.mjs',import.meta.url),'utf8');
 assert.match(s,/visitPlans=new Map\(\)/);
 assert.match(s,/note\.dataset\.visitAdvice=item\.key/);
 assert.match(s,/recommendedVisitAdvice\(pair\.origin,proposal,pair\.destination,result/);
 assert.match(s,/hora límit de sortida fins que el trajecte estigui verificat/);
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.match(sw,/domain\/itinerary-visit-advice\.mjs/);
});

test('day plan automatically maps model outputs to immutable visit keys and does not write times',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/dayVisitPlans\.set\(key,\{signature,plans:proposals\}\)/);
 assert.match(html,/generateItineraryDayContext\(selected,true\)/);
 assert.match(html,/visitPlans:\(dayVisitPlans\.get\(/);
 const handler=readFileSync(new URL('../supabase/functions/itinerary-day-context/handler.mjs',import.meta.url),'utf8');
 assert.match(handler,/visits\.length!==items\.length/);
 assert.match(handler,/visit\.minutes>360/);
 assert.doesNotMatch(handler,/\.update\(|\.insert\(/);
});

test('arrival-day screenshots: a 09:30 60-minute breakfast cannot end at 10:30 if next start is 10:15',()=>{
 const breakfast={timingKind:'exact',startsAt:'2026-10-24T09:30:00+02:00',endsAt:null};
 const next={timingKind:'exact',startsAt:'2026-10-24T10:15:00+02:00'};
 const result=recommendedVisitAdvice(breakfast,{minutes:60,reason:'Esmorzar tranquil'},next,{error:'missing_place'},5);
 assert.equal(result.proposedEnd,'2026-10-24T08:30:00.000Z');
 assert.equal(result.displayableEnd,'2026-10-24T08:10:00.000Z','Auto-adjust to 10:10, not the impossible 10:30');
 assert.equal(result.plannedMinutes,40,'Automatically cap the visit before the next start');
 assert.equal(result.reducedMinutes,20,'Expose the 20-minute shortening as an explicit proposal');
 assert.equal(result.maxMinutesWithoutTravel,40,'Even without routing there are only 40 minutes before the safety margin');
 assert.equal(result.shortageMinutes,20);
 assert.equal(result.latestLeaveBy,null,'Do not fabricate an ETA');
 assert.equal(result.routePending,true);
});
test('visit guidance stays inside the main card, not the narrow timetable column',()=>{
 const ui=readFileSync(new URL('../domain/itinerary-route-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/querySelector\('\.generic-itinerary-card'\)/);
 assert.match(ui,/agenda-visit-conflict/);
 assert.match(ui,/advice\.displayableEnd/);
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/\.agenda-visit-guidance\{box-sizing:border-box;max-width:100%;min-width:0/);
});
test('Friday arrival-day context includes transportation as fallback without bogus visit-duration cards',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/const sourceItems=visitItems\.length\?visitItems:dayItems/);
 assert.match(html,/\['manual','activity','flight','accommodation'\]\.includes\(x\.sourceType\)/);
 assert.match(html,/const visitKeys=new Set\(visitItems\.map\(x=>x\.key\)\)/);
 assert.match(html,/if\(visitKeys\.has\(sourceItems\[v\.index\]\.key\)\)proposals\.set/);
});
test('explicit after-midnight Saturday 24 arrival has a protected authenticated repair action',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/function suggestedOvernightImportCorrection\(row,timing\)/);
 assert.match(html,/overnightCorrectionDate:overnight\?\.date\|\|null/);
 assert.match(html,/data-confirm-overnight-date/);
 assert.match(html,/async function confirmOvernightItineraryDate\(button\)/);
 assert.match(html,/\.eq\('updated_at',row\.updated_at\)\.select\('id'\)/);
});

test('a verified 5-minute walk + 5-minute buffer further shortens flexible breakfast',()=>{
 const breakfast={timingKind:'exact',startsAt:'2026-10-24T09:30:00+02:00',endsAt:null};
 const next={timingKind:'exact',startsAt:'2026-10-24T10:15:00+02:00'};
 const route={route:{method:'routing',mode:'walk',duration_seconds:300,distance_m:200}};
 const r=recommendedVisitAdvice(breakfast,{minutes:60,reason:'Esmorzar'},next,route,5);
 assert.equal(r.plannedMinutes,35);
 assert.equal(r.displayableEnd,'2026-10-24T08:05:00.000Z');
 assert.equal(r.latestLeaveBy,'2026-10-24T08:05:00.000Z');
 assert.equal(r.routePending,false);
});
test('if no time remains, show conflict instead of proposing negative or zero visit',()=>{
 const r=recommendedVisitAdvice(
  {timingKind:'exact',startsAt:'2026-10-24T10:14:00+02:00'},
  {minutes:30,reason:'Visita'},
  {timingKind:'exact',startsAt:'2026-10-24T10:15:00+02:00'},null,5);
 assert.equal(r.plannedMinutes,0);
 assert.equal(r.cannotFit,true);
 assert.equal(r.displayableEnd,null);
});
test('mobile note reports automatically fitted maximum rather than impossible finish',()=>{
 const ui=readFileSync(new URL('../domain/itinerary-route-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/Freya ajusta la visita a /);
 assert.match(ui,/Encara cal descomptar el trajecte quan es verifiqui/);
 assert.doesNotMatch(ui,/Cal escurçar-la almenys /);
});

test('a verified journey refreshes the guidance with the actual departure allowance',()=>{
 const ui=readFileSync(new URL('../domain/itinerary-route-ui.mjs',import.meta.url),'utf8');
 assert.match(ui,/const writeVisitGuidance=\(note,advice\)=>/);
 assert.match(ui,/if\(visibleAdvice&&proposed\)writeVisitGuidance\(visibleAdvice,proposed\)/);
 assert.match(ui,/writeVisitGuidance\(note,advice\)/);
});

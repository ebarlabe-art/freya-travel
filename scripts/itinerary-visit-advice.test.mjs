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

test('overlapping next activity is flagged even without a verified route',()=>{
 const x=recommendedVisitAdvice({timingKind:'exact',startsAt:'2030-10-20T09:30:00+02:00',endsAt:null}, {minutes:60,reason:'Esmorzar'}, {timingKind:'exact',startsAt:'2030-10-20T10:15:00+02:00'}, {error:'missing_place'},5);
 assert.equal(x.minutesUntilNext,45);
 assert.equal(x.conflictsNext,true);
 assert.equal(x.latestLeaveBy,null);
 const frontend=readFileSync(new URL('../domain/itinerary-route-ui.mjs',import.meta.url),'utf8');
 assert.match(frontend,/note.classList.add\('agenda-visit-conflict'\)/);
 assert.match(frontend,/card.append\(note\)/);
 assert.doesNotMatch(frontend,/anchor.append\(note\)/);
});
test('arrival-only days are used for context, but journeys receive no visit duration card',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/dayContextSourceItems\(tripId,localDate\)/);
 assert.match(html,/if\(!dayContextJourneyOnly\(sourceItems\[v.index\]\)\)proposals.set/);
 assert.match(html,/\.agenda-visit-guidance\{display:grid/);
});

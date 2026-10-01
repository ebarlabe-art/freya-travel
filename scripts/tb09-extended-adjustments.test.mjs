import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('TB-09.3 can move either flexible side of an exact conflict',()=>{
 const block=html.slice(html.indexOf('function tripReviewAdjustmentFor'),html.indexOf('function tripReviewSuggestions'));
 assert.match(block,/tripReviewExactMoveProposal\(suggestion,active,second,first\)/);
 assert.match(block,/tripReviewExactMoveProposal\(suggestion,active,first,second\)/);
});

test('TB-09.3 redistributes only optional flexible manual items on busy days',()=>{
 const block=html.slice(html.indexOf('function tripReviewBusyDayProposal'),html.indexOf('function tripReviewAdjustmentFor'));
 assert.match(block,/optionalOnly:true/);
 assert.match(block,/timingKinds:\['exact','approximate','date','all_day','daypart'\]/);
 assert.doesNotMatch(block,/trip_flights/);
 assert.doesNotMatch(block,/trip_accommodations/);
 assert.doesNotMatch(block,/trip_activities/);
});

test('TB-09.3 preserves timing semantics when moving flexible items to another day',()=>{
 const block=html.slice(html.indexOf('function tripReviewMoveManualToDatePatch'),html.indexOf('function tripReviewPatchFitsDate'));
 assert.match(block,/\['approximate','date','all_day','daypart'\]\.includes/);
 assert.match(block,/zonedLocalToIso/);
 assert.match(block,/duration/);
});

test('TB-09.3 rejects exact move proposals that collide on target day',()=>{
 const block=html.slice(html.indexOf('function tripReviewPatchFitsDate'),html.indexOf('function tripReviewBusyDayProposal'));
 assert.match(block,/return !active\.some/);
 assert.match(block,/start<otherEnd&&end>otherStart/);
});

test('TB-09.3 still routes every change through explicit TB-09.2 confirmation',()=>{
 assert.match(html,/Vols aplicar aquesta proposta al planning compartit\?/);
 assert.match(html,/Per aplicar una proposta cal connexió/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('TB-09.4 safety gate only allows known temporal patch shapes',()=>{
 const block=html.slice(html.indexOf('function tripReviewAdjustmentProposalIsSafe'),html.indexOf('async function applyTripReviewAdjustment'));
 assert.match(block,/exactKeys=\['ends_at','starts_at'\]/);
 assert.match(block,/scheduleKeys=\['local_date','timing_kind'\]/);
 assert.match(block,/dateKeys=\['local_date'\]/);
 assert.match(block,/return false/);
});

test('TB-09.4 safety gate rechecks manual flexible row and exact version',()=>{
 const block=html.slice(html.indexOf('function tripReviewAdjustmentProposalIsSafe'),html.indexOf('async function applyTripReviewAdjustment'));
 assert.match(block,/tripReviewManualRow\(proposal\.sourceId\)/);
 assert.match(block,/row\.trip_id!==trip\.id/);
 assert.match(block,/row\.is_fixed/);
 assert.match(block,/row\.status!=='planned'/);
 assert.match(block,/row\.updated_at!==proposal\.expectedUpdatedAt/);
});

test('TB-09.4 rejects unsafe or stale proposals before update',()=>{
 const block=html.slice(html.indexOf('async function applyTripReviewAdjustment'),html.indexOf('function renderTripReview'));
 assert.match(block,/tripReviewAdjustmentProposalIsSafe\(proposal\)/);
 assert.match(block,/La proposta ja no és segura o ha quedat desactualitzada/);
 assert.match(block,/loadManualItineraryItems\(true\)/);
});

test('TB-09 still requires explicit confirmation and optimistic concurrency',()=>{
 const block=html.slice(html.indexOf('async function applyTripReviewAdjustment'),html.indexOf('function renderTripReview'));
 assert.match(block,/Vols aplicar aquesta proposta al planning compartit\?/);
 assert.match(block,/\.eq\('updated_at',proposal\.expectedUpdatedAt\)/);
});

test('TB-09 never exposes automatic write paths for operational reservations',()=>{
 const block=html.slice(html.indexOf('function tripReviewSuggestionId'),html.indexOf('function itineraryStatusLabel'));
 assert.doesNotMatch(block,/from\('trip_flights'\)\.update/);
 assert.doesNotMatch(block,/from\('trip_accommodations'\)\.update/);
 assert.doesNotMatch(block,/from\('trip_activities'\)\.update/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('TB-09.2 proposes only explicit user-approved adjustments',()=>{
 assert.match(html,/Freya et proposa/);
 assert.match(html,/Aplica proposta/);
 assert.match(html,/Ara no/);
 assert.match(html,/Vols aplicar aquesta proposta al planning compartit\?/);
});

test('TB-09.2 automatic patches are restricted to manual flexible itinerary items',()=>{
 const guard=html.slice(html.indexOf('function tripReviewFlexibleManual'),html.indexOf('function tripAdjustmentFingerprint'));
 const engine=html.slice(html.indexOf('function tripReviewAdjustmentFor'),html.indexOf('function tripReviewSuggestions'));
 assert.match(guard,/sourceType!=='manual'/);
 assert.match(guard,/row\.is_fixed/);
 assert.match(guard,/row\.status!=='planned'/);
 assert.doesNotMatch(engine,/trip_flights/);
 assert.doesNotMatch(engine,/trip_accommodations/);
 assert.doesNotMatch(engine,/trip_activities/);
});

test('TB-09.2 applies with optimistic concurrency and reloads authoritative data',()=>{
 const block=html.slice(html.indexOf('async function applyTripReviewAdjustment'),html.indexOf('function renderTripReview'));
 assert.match(block,/\.eq\('updated_at',proposal\.expectedUpdatedAt\)/);
 assert.match(block,/\.select\('\*'\)\.maybeSingle\(\)/);
 assert.match(block,/loadManualItineraryItems\(true\)/);
});

test('TB-09.2 personal dismissal is owner and trip scoped',()=>{
 assert.match(html,/freya-tb09-dismissed-v1:\$\{session\.user\.id\}:\$\{trip\.id\}/);
 assert.match(html,/localStorage\.setItem/);
});

test('TB-09.2 keeps offline writes blocked',()=>{
 assert.match(html,/Per aplicar una proposta cal connexió/);
});

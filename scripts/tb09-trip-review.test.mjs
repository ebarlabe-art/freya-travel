import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('TB-09.1 exposes a dedicated read-only trip review entry',()=>{
  assert.match(html,/id="buildTripReview"/);
  assert.match(html,/id="tripReviewView"/);
  assert.match(html,/Revisa el viatge amb Freya/);
  assert.match(html,/No modifica res sense que tu ho decideixis/);
});

test('TB-09.1 detects structured itinerary review signals',()=>{
  const block=html.slice(html.indexOf('function tripReviewSuggestions'),html.indexOf('function tripReviewSeverityLabel'));
  assert.match(block,/overlap/);
  assert.match(block,/tight_gap/);
  assert.match(block,/busy_day/);
  assert.match(block,/unscheduled/);
  assert.match(block,/planning/);
  assert.match(block,/reserved/);
  assert.match(block,/documents/);
});

test('TB-09.1 detection remains read-only',()=>{
  const block=html.slice(html.indexOf('function tripReviewSuggestions'),html.indexOf('function tripReviewSeverityLabel'));
  assert.doesNotMatch(block,/\.insert\(/);
  assert.doesNotMatch(block,/\.update\(/);
  assert.doesNotMatch(block,/\.delete\(/);
  assert.doesNotMatch(block,/db\.rpc\(/);
});

test('TB-09.1 review actions navigate to the existing itinerary instead of mutating it',()=>{
  const block=html.slice(html.indexOf('function openTripReviewSuggestion'),html.indexOf('function renderTripReview'));
  assert.match(block,/setAppView\('itineraryView'\)/);
  assert.match(block,/tripHomeItineraryFocus/);
});

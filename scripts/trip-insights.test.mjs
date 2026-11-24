import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildTripInsights,INSIGHTS_SOURCE_DATE} from '../domain/trip-insights.mjs';

const trip={experience_key:null,start_date:'2027-08-14',end_date:'2027-08-30'};
const stop=country_code=>({country_code});
const now=new Date(2026,10,24,12);

test('A4.1: contextual country advice follows existing trip stops with deduplication and source date',()=>{
  const result=buildTripInsights({trip,stops:[stop('LK'),stop('LK'),stop('JP')],now});
  assert.equal(result.phase,'before');
  assert.equal(result.asOf,INSIGHTS_SOURCE_DATE);
  assert.deepEqual(result.entries.map(item=>item.code),['LK','JP']);
  assert.equal(result.entries[0].items[0].source,'Sri Lanka ETA oficial');
  assert.ok(result.entries.every(entry=>entry.items.every(item=>item.url.startsWith('https://')&&item.source)));
});

test('A4.1: never infer visa eligibility, nationality or current FX data',()=>{
  const rows=buildTripInsights({trip,stops:[stop('GB')],now}).entries[0].items;
  assert.match(rows[0].detail,/nacionalitat/);
  assert.ok(rows.every(row=>!/euro|cotització|canvi en viu/i.test(row.detail)));
});

test('A4.1: unsupported destinations do not receive invented requirements',()=>{
  const result=buildTripInsights({trip,stops:[stop('ZZ'),stop('')],now});
  assert.deepEqual(result.entries,[]);
  assert.deepEqual(result.unsupported,['ZZ']);
  assert.equal(result.unknownDestination,false);
  assert.equal(buildTripInsights({trip,stops:[],now}).unknownDestination,true);
});

test('A4.1: active trips show during context, completed trips hide this preparation surface',()=>{
  const during=buildTripInsights({trip,stops:[stop('UK')],now:new Date(2027,7,18,12)});
  assert.equal(during.phase,'during');
  assert.equal(during.entries[0].code,'GB');
  const past=buildTripInsights({trip,stops:[stop('GB')],now:new Date(2027,8,1,12)});
  assert.equal(past.phase,'past');
  assert.equal(past.entries.length,0);
  assert.equal(buildTripInsights({trip:{...trip,experience_key:'london-2026'},stops:[stop('GB')],now}),null);
});

test('A4.1: dashboard has real contextual wiring without a new duplicate itinerary',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/id="genericTripInsights"/);
  assert.match(html,/loadTravelBookModule\('trip-insights\.mjs'\)/);
  assert.match(html,/renderTripInsights\(\)/);
  assert.doesNotMatch(html,/data-open="insightsView"/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {itineraryPdfTranscriptToProposal,itineraryPdfEnrichTimeZones} from '../supabase/functions/import-itinerary/transcript.mjs';
import {createItineraryReview,changeItineraryReviewItem,summarizeItineraryReview} from '../domain/import-itinerary-review.mjs';
import {prepareFlashDecisions} from '../domain/import-itinerary-flash.mjs';
import {importScheduleIssue,prepareReconciliationRequest,reconciliationPlan} from '../domain/import-itinerary-reconciliation-ui.mjs';
import {brusselsTranscript,brusselsSource,brusselsTrip,verifiedBrusselsStops} from './fixtures/brussels/itinerary.mjs';

const scope={tripId:brusselsTrip.id,userId:'17200000-0000-4000-8000-000000000003',documentId:brusselsSource.document_id};
const context={projection:[],startDate:brusselsTrip.start_date,endDate:brusselsTrip.end_date,
 convertLocalTime:(local,zone)=>{assert.equal(zone,'Europe/Brussels');return new Date(local+':00+01:00').toISOString()}};
const initial={existing:[],decisions:[],retire:[]};

test('two Brussels schedule tables go from 17 proposals to 17 confirmed changes with optional fields intact',async()=>{
 const extracted=itineraryPdfTranscriptToProposal(brusselsTranscript,brusselsSource);
 const enriched=await itineraryPdfEnrichTimeZones(extracted,{transcript:brusselsTranscript,source:brusselsSource,
  tripStops:verifiedBrusselsStops,resolvePlace:async()=>null});
 const snapshot=summarizeItineraryReview(createItineraryReview(enriched,scope));
 assert.equal(snapshot.total,17);
 assert.equal(snapshot.selected,17);
 assert.equal(snapshot.items.filter(i=>i.comparison.kind==='new').length,17);
 assert.equal(snapshot.items.filter(i=>i.values.local_date==='2026-12-01').length,9);
 assert.equal(snapshot.items.filter(i=>i.values.local_date==='2026-12-02').length,8);
 const state={...initial,decisions:prepareFlashDecisions(snapshot,initial,context)};
 const plan=reconciliationPlan(snapshot,state);
 assert.equal(plan.summary.new,17);
 assert.equal(plan.can_commit,true);
 const request=await prepareReconciliationRequest(snapshot,state,{...scope,...context,tripStartDate:context.startDate,tripEndDate:context.endDate});
 assert.equal(request.p_changes.length,17);
 assert.equal(new Set(request.p_changes.map(row=>row.id)).size,17);
 const [first,withoutLocation]=request.p_changes;
 assert.equal(first.fields.starts_at,'2026-12-01T07:30:00.000Z');
 assert.equal(first.fields.address,'10 Carrer de Mostra');
 assert.match(first.fields.notes,/Arribeu cinc minuts abans\.\nhttps:\/\/example.org\/programa/);
 assert.equal(withoutLocation.fields.address,null);
 assert.equal(request.p_changes[8].fields.ends_at,null);
});

test('a missing timezone is actionable and resolves after editing the affected row',async()=>{
 const proposal=itineraryPdfTranscriptToProposal(brusselsTranscript,brusselsSource);
 const review=createItineraryReview(proposal,scope);
 const snapshot=summarizeItineraryReview(review);
 assert.equal(snapshot.items[0].comparison.kind,'new');
 assert.equal(importScheduleIssue(snapshot.items[0],context),'timezone_needs_confirmation');
 assert.equal(prepareFlashDecisions(snapshot,initial,context).length,0);
 changeItineraryReviewItem(review,0,'time_zone','Europe/Brussels');
 const repaired=summarizeItineraryReview(review);
 assert.deepEqual(prepareFlashDecisions(repaired,initial,context),[{source_order:0,action:'add'}]);
});

test('a separated table cell cannot supply another activity’s time',()=>{
 const transcript=structuredClone(brusselsTranscript);
 transcript.pages[0].text=transcript.pages[0].text.replace('08:30–09:00 | Trobada del grup','08:30–09:00 | Text intermig | Trobada del grup');
 const proposal=itineraryPdfTranscriptToProposal(transcript,brusselsSource);
 const item=proposal.candidates[0];
 assert.equal(item.fields.start_local_time,undefined);
 assert.match(item.warnings.join(' '),/Evidència pendent/);
});

test('unverified optional description is dropped without blocking a proven itinerary row',()=>{
 const transcript=structuredClone(brusselsTranscript);
 transcript.blocks[0].excerpt='Notes: Informació absent de la taula';
 const snapshot=summarizeItineraryReview(createItineraryReview(itineraryPdfTranscriptToProposal(transcript,brusselsSource),scope));
 assert.equal(snapshot.items[0].included,true);
 assert.equal(snapshot.items[0].values.notes,'');
 assert.equal(snapshot.items[0].values.start_local_time,'08:30');
});

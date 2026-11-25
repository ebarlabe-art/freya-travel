import assert from 'node:assert/strict';
import test from 'node:test';
import {itineraryPdfTranscriptToProposal,itineraryPdfEnrichTimeZones} from '../supabase/functions/import-itinerary/transcript.mjs';
import {createItineraryReview,changeItineraryReviewItem,summarizeItineraryReview} from '../domain/import-itinerary-review.mjs';
import {prepareFlashDecisions} from '../domain/import-itinerary-flash.mjs';
import {importScheduleIssue,prepareReconciliationRequest,reconciliationPlan} from '../domain/import-itinerary-reconciliation-ui.mjs';
import {resolveItineraryDateHeading,extractItineraryProposalFromPages} from '../domain/import-itinerary-text-extractor.mjs';
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
 assert.equal(snapshot.items.filter(i=>i.values.local_date==='2026-12-01').length,10);
 assert.equal(snapshot.items.filter(i=>i.values.local_date==='2026-12-02').length,7);
 assert.deepEqual(snapshot.items[10].evidence.local_date.map(({page,excerpt})=>[page,excerpt]),[
  [2,'Dimecres 2 de desembre'],[1,'Brussel·les, 1 i 2 de desembre 2026']
 ]);
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

test('equivalent document headings provide the year in all five supported languages',()=>{
 const examples=[
  ['Gant, 1 i 2 de desembre 2026','Dimarts 1 de desembre','Dimecres 2 de desembre','Dijous 2 de desembre'],
  ['Gante, 1 y 2 de diciembre de 2026','Martes 1 de diciembre','Miércoles 2 de diciembre','Jueves 2 de diciembre'],
  ['Ghent, December 1 and 2, 2026','Tuesday, December 1','Wednesday 2 December','Thursday 2 December'],
  ['Gand, 1er et 2 décembre 2026','Mardi 1er décembre','Mercredi 2 décembre','Jeudi 2 décembre'],
  ['Gand, 1 e 2 dicembre 2026','Martedì 1 dicembre','Mercoledì 2 dicembre','Giovedì 2 dicembre']
 ];
 for(const [cover,first,second,wrongWeekday] of examples){
  const pages=[{page:1,text:cover}];
  assert.equal(resolveItineraryDateHeading(first,pages)?.date,'2026-12-01',cover);
  assert.equal(resolveItineraryDateHeading(second,pages)?.date,'2026-12-02',cover);
  assert.equal(resolveItineraryDateHeading(wrongWeekday,pages),null,cover);
  assert.equal(resolveItineraryDateHeading(wrongWeekday+' 2026',pages),null,cover);
 }
});

test('a contradictory table heading keeps its times and clears the active day',()=>{
 const text='Gant, 1 i 2 de desembre 2026\nDimarts 1 de desembre\n08:30 Trobada\nDijous 2 de desembre\n09:30 Visita';
 const proposal=extractItineraryProposalFromPages([{page:1,text}],brusselsSource);
 assert.equal(proposal.candidates[0].fields.local_date.value,'2026-12-01');
 assert.equal(proposal.candidates[1].fields.local_date,undefined);
 assert.equal(proposal.candidates[1].fields.start_local_time.value,'09:30');
 assert.match(proposal.warnings.join(' '),/contradictòria/);
 const discreteDays=[{page:1,text:'Gant, 1 i 3 de desembre 2026'}];
 assert.equal(resolveItineraryDateHeading('Dimecres 2 de desembre',discreteDays),null);
});

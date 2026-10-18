import test from 'node:test';
import assert from 'node:assert/strict';
import {createItineraryReview,changeItineraryReviewItem,summarizeItineraryReview,reviewItemValue}
 from '../domain/import-itinerary-review.mjs';

const field=(value,confidence='high')=>({value,confidence,evidence:[{kind:'text',excerpt:String(value),page:1}]});
const candidate=(source_order,title,at='09:00',end='10:00')=>({
 source_order,classification_hint:'activity',fields:{
  title:field(title),local_date:field('2026-12-27'),start_local_time:field(at),
  end_local_time:field(end),time_zone:field('Europe/Riga')},
 warnings:[]
});
const proposal=()=>({schema_version:1,source:{kind:'document',document_id:'doc-1',file_name:'route.pdf',mime_type:'application/pdf'},candidates:[candidate(0,'Museu'),candidate(1,'Passeig','10:00','11:00')]});
const scope={tripId:'trip-1',userId:'owner-1',documentId:'doc-1'};

test('A2.7: opens a copy with immutable original evidence and no server writes',()=>{
 const raw=proposal(),review=createItineraryReview(raw,scope);
 changeItineraryReviewItem(review,0,'title','Museu marítim');
 assert.equal(raw.candidates[0].fields.title.value,'Museu');
 assert.equal(reviewItemValue(review.items[0],'title'),'Museu marítim');
 assert.equal(review.items[0].original.title,'Museu');
 assert.equal(review.items[0].evidence.title[0].excerpt,'Museu');
 const snapshot=summarizeItineraryReview(review);
 assert.equal(snapshot.can_write,false);
 assert.equal(snapshot.read_only,true);
 assert.deepEqual(snapshot.items[0].edited_fields,['title']);
});
test('A2.7: rejects proposal from a different trip/document/user scope',()=>{
 assert.throws(()=>createItineraryReview(proposal(),{...scope,documentId:'other'}),/Abast/);
 assert.throws(()=>createItineraryReview(proposal(),{...scope,tripId:''}),/Abast/);
});
test('A2.7: detects duplicate with existing trip projection but does not delete',()=>{
 const r=createItineraryReview(proposal(),scope);
 const s=summarizeItineraryReview(r,[{title:'Museu',localDate:'2026-12-27',timeLabel:'09:00',sourceType:'manual'}]);
 assert.equal(s.items.length,2);
 assert.ok(s.items[0].review_flags.includes('possible_existing_duplicate'));
});
test('A2.7: overlapping reviewed activities generate two warnings',()=>{
 const r=createItineraryReview(proposal(),scope);
 changeItineraryReviewItem(r,1,'start_local_time','09:30');
 const s=summarizeItineraryReview(r);
 assert.equal(s.items.filter(x=>x.review_flags.includes('possible_overlap_in_review')).length,2);
});
test('A2.7: exact repeated reviewed entries are flagged and preserved',()=>{
 const r=createItineraryReview(proposal(),scope);
 changeItineraryReviewItem(r,1,'title','Museu');changeItineraryReviewItem(r,1,'start_local_time','09:00');
 const s=summarizeItineraryReview(r);
 assert.equal(s.total,2);
 assert.ok(s.items.every(x=>x.review_flags.includes('possible_duplicate_in_review')));
});
test('A2.7: invalid or incomplete edited dates, times and zones require attention',()=>{
 const r=createItineraryReview(proposal(),scope);
 changeItineraryReviewItem(r,0,'local_date','2026-02-29');
 changeItineraryReviewItem(r,0,'start_local_time','25:99');
 changeItineraryReviewItem(r,0,'time_zone','Atlantis/Nowhere');
 const issues=summarizeItineraryReview(r).items[0].review_flags;
 assert.ok(issues.includes('invalid_date'));
 assert.ok(issues.includes('invalid_start_time'));
 assert.ok(issues.includes('invalid_time_zone'));
});
test('A2.7: excluded items remain visible but do not count as selected',()=>{
 const r=createItineraryReview(proposal(),scope);
 changeItineraryReviewItem(r,0,'included',false);
 const s=summarizeItineraryReview(r);
 assert.equal(s.total,2);assert.equal(s.selected,1);
 assert.equal(s.items[0].included,false);
});
test('A2.7: notes length, unapproved fields and invalid selection are rejected',()=>{
 const r=createItineraryReview(proposal(),scope);
 assert.throws(()=>changeItineraryReviewItem(r,0,'notes','x'.repeat(4001)),/llarg/);
 assert.throws(()=>changeItineraryReviewItem(r,0,'trip_id','other'),/no editable/);
 assert.throws(()=>changeItineraryReviewItem(r,0,'included','true'),/Selecció/);
});
test('A2.7: suggestion confidence is not forged by manual corrections',()=>{
 const p=proposal();p.candidates[0].fields.title.confidence='low';
 const r=createItineraryReview(p,scope);
 changeItineraryReviewItem(r,0,'title','Confirmo el nom');
 assert.equal(r.items[0].confidence.title,'low');
 assert.deepEqual(r.items[0].evidence.title,[{kind:'text',excerpt:'Museu',page:1}]);
});
test('A2.7: full date/time and timezone are required for exact mapping, never implicit',()=>{
 const p=proposal();delete p.candidates[0].fields.time_zone;
 const r=createItineraryReview(p,scope);
 const warnings=summarizeItineraryReview(r).items[0].review_flags;
 assert.ok(warnings.includes('timezone_needs_confirmation'));
});

test('A2.7: consumes already normalized endpoint proposals with read-only metadata',async()=>{
 const {normalizeItineraryImportProposal}=await import('../domain/import-itinerary-proposal.mjs');
 const backend=normalizeItineraryImportProposal(proposal());
 const r=createItineraryReview(backend,scope);
 assert.equal(r.items.length,2);
 assert.equal(summarizeItineraryReview(r).can_write,false);
});

test('existing midnight match exposes the conflicting day without mutating either record',async()=>{
 const {matchingExistingImportItems,excludeExistingImportItems}=await import('../domain/import-itinerary-review.mjs');
 const p=proposal();p.candidates[0].fields.title=field('Arribada al nostre allotjament després del trajecte nocturn');
 p.candidates[0].fields.local_date=field('2026-12-28');p.candidates[0].fields.start_local_time=field('00:15');delete p.candidates[0].fields.end_local_time;
 const r=createItineraryReview(p,scope),existing=[{title:'Arribada al nostre allotjament després del trajecte',localDate:'2026-12-27',timeLabel:'00:15'}],before=structuredClone(existing);
 const s=summarizeItineraryReview(r,existing);
 assert.equal(s.items[0].existing_matches[0].localDate,'2026-12-27');
 assert.ok(s.items[0].review_flags.includes('existing_date_conflict'));
 assert.equal(excludeExistingImportItems(r,existing),1);
 assert.equal(r.items[0].included,false);assert.equal(r.items[1].included,true);
 assert.equal(r.items[0].original.local_date,'2026-12-28');assert.deepEqual(existing,before);
 assert.deepEqual(matchingExistingImportItems({title:'Museu',local_date:'2026-12-28',start_local_time:'09:00'},[{title:'Museu',localDate:'2026-12-27',timeLabel:'09:00'}]),[],'daily visits must not match across dates');
});
test('duplicate exclusion respects manual deselection and keeps new items',async()=>{
 const {excludeExistingImportItems}=await import('../domain/import-itinerary-review.mjs');
 const r=createItineraryReview(proposal(),scope);r.items[1].included=false;
 assert.equal(excludeExistingImportItems(r,[{title:'Museu.',localDate:'2026-12-27',timeLabel:'09:00'}]),1);
 assert.deepEqual(r.items.map(x=>x.included),[false,false]);
});
test('numeric fragments in an old or edited proposal require correction',()=>{
 const r=createItineraryReview(proposal(),scope);changeItineraryReviewItem(r,0,'title','16.3');
 assert.ok(summarizeItineraryReview(r).items[0].review_flags.includes('invalid_title'));
});

test('confidence information is separated from actionable date/duplicate warnings',()=>{
 const p=proposal();p.candidates[0].fields.local_date.confidence='medium';p.candidates[0].warnings=['Any agafat del títol general del document: comprova la data.'];
 const r=createItineraryReview(p,scope),s=summarizeItineraryReview(r);
 assert.equal(s.important,0);assert.equal(s.informational,1);assert.equal(s.needsReview,1);
 changeItineraryReviewItem(r,0,'local_date','2026-02-30');
 assert.equal(summarizeItineraryReview(r).important,1);
});

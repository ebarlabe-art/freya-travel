import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeItineraryImportProposal,itineraryImportProposalCanWrite,itineraryImportFieldNames} from '../domain/import-itinerary-proposal.mjs';

const field=(value,confidence='high',page=1)=>({value,confidence,evidence:[{kind:'text',excerpt:String(value),page}]});
const candidate=(order,title,date='2026-12-27',time='09:30')=>({
 source_order:order,classification_hint:'activity',
 fields:{title:field(title),local_date:field(date),start_local_time:field(time),time_zone:field('Europe/Riga')},warnings:[]
});
const proposal=()=>({
 schema_version:1,source:{kind:'document',document_id:'doc-123',file_name:'ruta.pdf',mime_type:'application/pdf'},
 candidates:[candidate(0,'Museu'),candidate(1,'Passeig','2026-12-28','11:00')]
});
test('A2.5 preserves source order, confidence and evidence, read-only',()=>{
 const v=normalizeItineraryImportProposal(proposal());
 assert.equal(v.candidates.length,2);
 assert.equal(v.candidates[0].fields.title.evidence[0].page,1);
 assert.equal(v.read_only,true);
 assert.equal(v.requires_user_confirmation,true);
 assert.equal(itineraryImportProposalCanWrite(),false);
});
test('refuses privileged fields and arbitrary keys',()=>{
 for(const key of ['trip_id','created_by','id','document_id','sql']){
  const p=proposal();p.candidates[0].fields[key]=field('X');
  assert.throws(()=>normalizeItineraryImportProposal(p),e=>e.code==='forbidden_itinerary_import_field');
 }
});
test('requires pre-existing document and evidenced item title',()=>{
 const p=proposal();delete p.source.document_id;
 assert.throws(()=>normalizeItineraryImportProposal(p),/document privat/);
 const q=proposal();delete q.candidates[0].fields.title;
 assert.throws(()=>normalizeItineraryImportProposal(q),/títol/);
});
test('rejects impossible dates and invalid local times',()=>{
 for(const date of ['2026-02-29','2026-13-01','2026-04-31','2026-12-99']){
  const p=proposal();p.candidates[0].fields.local_date=field(date);
  assert.throws(()=>normalizeItineraryImportProposal(p),/Data impossible/);
 }
 const p=proposal();p.candidates[0].fields.start_local_time=field('24:99');
 assert.throws(()=>normalizeItineraryImportProposal(p),/Hora local/);
 const leap=proposal();leap.candidates[0].fields.local_date=field('2028-02-29');
 assert.doesNotThrow(()=>normalizeItineraryImportProposal(leap));
});
test('an unverified time zone is flagged, never silently converted into UTC',()=>{
 const p=proposal();delete p.candidates[0].fields.time_zone;
 const v=normalizeItineraryImportProposal(p);
 assert.ok(v.candidates[0].review_flags.includes('timezone_needs_confirmation'));
 assert.equal(v.candidates[0].fields.start_local_time.value,'09:30');
 assert.equal(v.candidates[0].fields.starts_at,undefined);
});
test('rejects fictitious or invalid time zone names',()=>{
 const p=proposal();p.candidates[0].fields.time_zone=field('Europe/Atlantis');
 assert.throws(()=>normalizeItineraryImportProposal(p),/Zona horària no verificada/);
});
test('end before start is flagged, not silently rewritten',()=>{
 const p=proposal();p.candidates[0].fields.end_local_time=field('08:00');
 assert.ok(normalizeItineraryImportProposal(p).candidates[0].review_flags.includes('time_order_needs_review'));
});
test('repeated rows inside the PDF remain reviewable, not suppressed',()=>{
 const p=proposal();p.candidates[1]=candidate(1,' MUSEU ','2026-12-27','09:30');
 const v=normalizeItineraryImportProposal(p);
 assert.equal(v.candidates.length,2);
 assert.ok(v.candidates.every(x=>x.review_flags.includes('possible_duplicate_in_source')));
});
test('incomplete date and low confidence are flagged',()=>{
 const p=proposal();delete p.candidates[0].fields.local_date;p.candidates[0].fields.title.confidence='low';
 const flags=normalizeItineraryImportProposal(p).candidates[0].review_flags;
 assert.ok(flags.includes('date_required_for_time'));
 assert.ok(flags.includes('uncertain_extraction'));
});
test('evidence, classifications and values are constrained',()=>{
 const p=proposal();p.candidates[0].classification_hint='admin';
 assert.throws(()=>normalizeItineraryImportProposal(p),/Classificació/);
 const q=proposal();q.candidates[0].fields.title.evidence=[];
 assert.throws(()=>normalizeItineraryImportProposal(q),/evidència/);
 const s=proposal();s.candidates[0].fields.title.value={script:'drop'};
 assert.throws(()=>normalizeItineraryImportProposal(s),/invàlid/);
 assert.ok(itineraryImportFieldNames.includes('local_date'));
 assert.equal(itineraryImportFieldNames.includes('trip_id'),false);
});
test('limits number of items and forbids duplicate source order',()=>{
 const p=proposal();p.candidates[1].source_order=0;
 assert.throws(()=>normalizeItineraryImportProposal(p),/ordre original/);
 const q=proposal();q.candidates=Array.from({length:201},(_,i)=>candidate(i,'Lloc '+i));
 assert.throws(()=>normalizeItineraryImportProposal(q),/Nombre d’elements/);
});

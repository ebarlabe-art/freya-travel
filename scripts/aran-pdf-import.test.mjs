import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {itineraryPdfTranscriptToProposal as convert,validateItineraryPdfTranscript} from '../supabase/functions/import-itinerary/transcript.mjs';
import {extractItineraryProposalFromPages,resolveItineraryDateHeading} from '../domain/import-itinerary-text-extractor.mjs';
import {createItineraryReview,changeItineraryReviewItem} from '../domain/import-itinerary-review.mjs';
const root=new URL('./fixtures/aran/',import.meta.url),fixture=()=>JSON.parse(readFileSync(new URL('annotated-transcript.json',root)));
const source={kind:'document',document_id:'aran-test-document',mime_type:'application/pdf'};
const proposal=()=>convert(fixture(),source),v=(c,k)=>c.fields[k]?.value;
test('Aran original: raw text reproduces the zero-candidate failure; literal annotated layout recovers all days',()=>{
 const pages=JSON.parse(readFileSync(new URL('pages.json',root)));
 assert.throws(()=>extractItineraryProposalFromPages(pages,source),e=>e.code==='no_itinerary_candidates');
 const p=proposal();assert.equal(p.candidates.length,17);assert.equal(v(p.candidates[0],'daypart'),'midday');
 assert.deepEqual([...new Set(p.candidates.map(c=>v(c,'local_date')))].sort(),['2026-11-06','2026-11-07','2026-11-08','2026-11-09']);
 assert.deepEqual(p.candidates.filter(c=>v(c,'local_date')==='2026-11-07'&&v(c,'start_local_time')).map(c=>v(c,'start_local_time')),['09:00','10:00','13:30','15:00','17:00']);
 assert.deepEqual(p.candidates.filter(c=>v(c,'local_date')==='2026-11-08'&&v(c,'start_local_time')).map(c=>v(c,'start_local_time')),['09:15','10:00','12:00','13:30','15:30']);
 assert.equal(p.candidates.filter(c=>v(c,'local_date')==='2026-11-06').length,3);
 assert.ok(p.candidates.every(c=>!v(c,'end_local_time')));
 assert.ok(p.candidates.every(c=>c.fields.title.evidence[0].page>=2));
 assert.ok(p.candidates[3].fields.local_date.evidence.some(e=>e.excerpt.includes('2026')));
 assert.ok(!p.candidates.some(c=>/Casa Irene|Biniaran|Tauèrna/.test(v(c,'title'))));
 assert.equal(p.requires_user_confirmation,true);
 const digest=createHash('sha256').update(readFileSync(new URL('original.pdf',root))).digest('hex');
 assert.equal(digest,readFileSync(new URL('sha256.txt',root),'utf8').trim());
});
test('Aran alternatives are individually opt-in, no write and original remains immutable',()=>{
 const p=proposal(),before=JSON.stringify(p),r=createItineraryReview(p,{tripId:'test-trip',userId:'test-user',documentId:source.document_id});
 assert.equal(r.items.filter(x=>x.included).length,13);assert.equal(r.items.filter(x=>!x.included).length,4);
 assert.ok(r.items.filter(x=>x.original.local_date==='2026-11-09').every(x=>!x.included));
 changeItineraryReviewItem(r,13,'included',true);assert.equal(r.items[13].included,true);changeItineraryReviewItem(r,13,'included',false);
 assert.equal(JSON.stringify(p),before);
});
test('semantic anchors reject invented title, hour, page and absent heading',()=>{
 for(const patch of [{title:'Visita inexistent'},{time:'08.00'},{page:99},{heading:'10 DIMARTS'}]){
  const f=fixture();Object.assign(f.blocks[3],patch);assert.throws(()=>validateItineraryPdfTranscript(f),e=>e.code==='invalid_transcript');
 }
});
test('duplicate semantic blocks do not create extra activities',()=>{
 const f=fixture();f.blocks.splice(4,0,structuredClone(f.blocks[3]));assert.equal(convert(f,source).candidates.length,17);
});
test('contextual dates reject conflicting periods, impossible dates, wrong weekdays and out-of-range days',()=>{
 const pages=[{page:1,text:'6–9 de novembre de 2026'}];
 assert.equal(resolveItineraryDateHeading('07 DISSABTE',pages).date,'2026-11-07');
 for(const heading of ['07 DIUMENGE','31 DISSABTE','14 DISSABTE'])assert.equal(resolveItineraryDateHeading(heading,pages),null);
 assert.equal(resolveItineraryDateHeading('07 DISSABTE',[...pages,{page:2,text:'6-9 de novembre de 2027'}]),null);
});
test('other layouts/languages: untimed Spanish and English columns preserve ambiguity and literal evidence',()=>{
 for(const [heading,period,title,time] of [['Sábado 07','6-9 noviembre 2026','Paseo libre',''],['07 Saturday','6 to 9 November 2026','Gallery visit','10:00–11:00']]){
  const text=period+'\n'+heading+'\n'+title+'\n'+time;
  const f={complete:true,warnings:[],pages:[{page:1,text}],blocks:[{page:1,heading,title,time,role:'activity',excerpt:title+(time?'\n'+time:'')}]};
  const c=convert(f,source).candidates[0];assert.equal(v(c,'local_date'),'2026-11-07');assert.equal(v(c,'title'),title);
  if(!time)assert.equal(v(c,'start_local_time'),undefined);else assert.equal(v(c,'end_local_time'),'11:00');
  f.blocks[0].heading='';const ambiguous=convert(f,source).candidates[0];assert.equal(v(ambiguous,'local_date'),undefined);assert.match(ambiguous.warnings.join(' '),/Data ambigua/);
 }
});
test('real Riga guide date layout crosses the year without assigning January to December’s year',()=>{
 const pages=[{page:1,text:'26 DE DESEMBRE DE 2026 — 2 DE GENER DE 2027'}];
 assert.equal(resolveItineraryDateHeading('DILLUNS 28 DE DESEMBRE | Art Nouveau i Riga de postal',pages).date,'2026-12-28');
 assert.equal(resolveItineraryDateHeading('DISSABTE 2 DE GENER',pages).date,'2027-01-02');
});
test('Aran BASE: ARTIES is geographically verified with the existing resolver; no guessed phone timezone',async()=>{
 const {itineraryPdfEnrichTimeZones}=await import('../supabase/functions/import-itinerary/transcript.mjs');
 const f=fixture(),seen=[];
 const p=await itineraryPdfEnrichTimeZones(proposal(),{transcript:f,source,resolvePlace:async city=>{seen.push(city);return city==='ARTIES'?'Europe/Madrid':null}});
 assert.ok(seen.includes('ARTIES'));assert.ok(p.candidates.filter(c=>v(c,'start_local_time')).every(c=>v(c,'time_zone')==='Europe/Madrid'));
 const absent=await itineraryPdfEnrichTimeZones(proposal(),{transcript:f,source,resolvePlace:async()=>null});
 assert.ok(absent.candidates.every(c=>!v(c,'time_zone')));
});
test('a mismatched contextual weekday never inherits the previous valid day',()=>{
 const p=extractItineraryProposalFromPages([{page:1,text:'6-9 novembre 2026\n06 DIVENDRES\n09:00 Visita primera\n07 DIUMENGE\n10:00 Visita ambigua'}],source);
 assert.equal(v(p.candidates[0],'local_date'),'2026-11-06');assert.equal(v(p.candidates[1],'local_date'),undefined);
});
test('a semantic untimed route is an activity, not rejected as a generic document heading',()=>{
 const f={complete:true,warnings:[],pages:[{page:1,text:'2026-11-07\nRuta pel bosc'}],blocks:[{page:1,heading:'2026-11-07',title:'Ruta pel bosc',time:'',role:'activity',excerpt:'Ruta pel bosc'}]};
 assert.equal(convert(f,source).candidates[0].fields.title.value,'Ruta pel bosc');
});

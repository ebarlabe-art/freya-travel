import test from 'node:test';
import assert from 'node:assert/strict';
import {extractItineraryProposalFromPages,extractItineraryProposalFromText}
 from '../domain/import-itinerary-text-extractor.mjs';
const source={kind:'document',document_id:'sample-doc-1',file_name:'itinerari.pdf',mime_type:'application/pdf'};
const parse=(text)=>extractItineraryProposalFromText(text,source);
const val=(c,key)=>c.fields[key]?.value;

test('A2.6: extracts dates and times across PDF pages with evidence',()=>{
 const proposal=extractItineraryProposalFromPages([
  {page:1,text:'Itinerari\nDia 1 - 27/12/2026 · Zona horària: Europe/Riga\n09:30 - Visita al museu\n11:00–12:30 Passeig pel centre'},
  {page:2,text:'Tarda: Mercat de Nadal\nDia 2 - 28/12/2026\n10h15 - Excursió'}
 ],source);
 assert.equal(proposal.read_only,true);
 assert.equal(proposal.requires_user_confirmation,true);
 assert.deepEqual(proposal.candidates.map(x=>x.source_order),[0,1,2,3]);
 assert.deepEqual(proposal.candidates.map(x=>val(x,'local_date')),[
 '2026-12-27','2026-12-27','2026-12-27','2026-12-28'
 ]);
 assert.equal(val(proposal.candidates[0],'start_local_time'),'09:30');
 assert.equal(val(proposal.candidates[1],'end_local_time'),'12:30');
 assert.equal(val(proposal.candidates[2],'daypart'),'afternoon');
 assert.equal(val(proposal.candidates[0],'time_zone'),'Europe/Riga');
 assert.equal(proposal.candidates[2].fields.local_date.evidence[0].page,1);
 assert.equal(proposal.candidates[2].fields.title.evidence[0].page,2);
 assert.equal(proposal.candidates[0].fields.time_zone.evidence[0].page,1);
 assert.equal(proposal.candidates[3].fields.time_zone,undefined);
});

test('A2.6: inline-dated first item retains date for subsequent activities',()=>{
 const p=parse('28/12/2026 09:00 Museu marítim\n10:00 Passeig\n29/12/2026 14:00 Castell');
 assert.deepEqual(p.candidates.map(x=>val(x,'local_date')),['2026-12-28','2026-12-28','2026-12-29']);
});

test('A2.6: parses month names and ISO year-first dates, including leap day',()=>{
 const p=parse('Diumenge 27 de desembre de 2026\n09:30 - Visita\n2028-02-29\n11:30 - Tren');
 assert.deepEqual(p.candidates.map(x=>val(x,'local_date')),['2026-12-27','2028-02-29']);
});

test('A2.6: incomplete date headings do not invent a year',()=>{
 const p=parse('Dia 1 - 27/12\n09:30 Museu\n28/12/2026\n10:30 Mercat');
 assert.equal(val(p.candidates[0],'local_date'),undefined);
 assert.ok(p.candidates[0].review_flags.includes('date_required_for_time'));
 assert.equal(val(p.candidates[1],'local_date'),'2026-12-28');
 assert.ok(p.warnings.some(x=>/sense data completa/.test(x)));
});

test('A2.6: impossible date terminates earlier day context',()=>{
 const p=parse('27/12/2026\n09:00 Sortida\n31/02/2026\n10:00 Museus');
 assert.equal(val(p.candidates[0],'local_date'),'2026-12-27');
 assert.equal(val(p.candidates[1],'local_date'),undefined);
 assert.ok(p.warnings.some(x=>/data impossible/.test(x)));
});

test('A2.6: administrative booking fields are not interpreted as itinerary activities',()=>{
 const p=parse('27/12/2026\nReserva: ABC123\nPreu: 200 EUR\n09:00 Visita al museu\nTelèfon: 1234');
 assert.equal(p.candidates.length,1);
 assert.equal(p.candidates[0].classification_hint,'activity');
});

test('A2.6: numbered and dashed untimed bullets are tentative',()=>{
 const p=parse('27/12/2026\n1) Passeig\n- Dinar\n• Mirador');
 assert.deepEqual(p.candidates.map(x=>val(x,'title')),['Passeig','Dinar','Mirador']);
 assert.ok(p.candidates.every(x=>x.review_flags.includes('uncertain_extraction')));
});

test('A2.6: duplicate entries are flagged and preserved',()=>{
 const p=parse('27/12/2026\n09:00 Visita\n09:00 VISITA\n10:00 Mercat');
 assert.equal(p.candidates.length,3);
 assert.ok(p.candidates[0].review_flags.includes('possible_duplicate_in_source'));
 assert.ok(p.candidates[1].review_flags.includes('possible_duplicate_in_source'));
});

test('A2.6: no inferred UTC conversion; invalid zone produces warning',()=>{
 const p=parse('27/12/2026\nZona horària: Europe/Atlantis\n09:30 Viatge');
 assert.equal(p.candidates[0].fields.time_zone,undefined);
 assert.ok(p.candidates[0].review_flags.includes('timezone_needs_confirmation'));
 assert.ok(p.warnings.some(x=>/Zona horària no reconeguda/.test(x)));
});

test('A2.6: standalone valid time-zone line affects following items',()=>{
 const p=parse('27/12/2026\nZona horària: Europe/Riga\n09:30 Viatge');
 assert.equal(val(p.candidates[0],'time_zone'),'Europe/Riga');
 assert.equal(p.candidates[0].fields.time_zone.evidence[0].page,1);
});

test('A2.6: time crossing backwards flags manual review without rewriting',()=>{
 const p=parse('27/12/2026\n23:30 - 00:30 Tren');
 assert.equal(val(p.candidates[0],'end_local_time'),'00:30');
 assert.ok(p.candidates[0].review_flags.includes('time_order_needs_review'));
});

test('A2.6: never claims a reservation was confirmed',()=>{
 const p=parse('27/12/2026\n10:00 Vol a Tallinn\n11:30 Hotel Riga');
 assert.deepEqual(p.candidates.map(x=>x.classification_hint),['flight','accommodation']);
 assert.ok(p.candidates.every(x=>x.fields.reservation_status===undefined));
});

test('A2.6: missing itinerary raises a specific error',()=>{
 assert.throws(()=>parse('Programa\nNomés el títol'),e=>e.code==='no_itinerary_candidates');
});

test('A2.6: rejects overlapping or nonincreasing pages',()=>{
 assert.throws(()=>extractItineraryProposalFromPages([{page:2,text:'a'},{page:2,text:'b'}],source),/creixents/);
});

test('A2.6: text size, candidate count and invalid source are bounded',()=>{
 assert.throws(()=>parse('x'.repeat(500001)),/massa gran/);
 const many='27/12/2026\n'+Array.from({length:201},(_,i)=>'10:00 Proposta '+i).join('\n');
 assert.throws(()=>parse(many),e=>e.code==='itinerary_import_too_many_items');
 assert.throws(()=>extractItineraryProposalFromText('27/12/2026\n09:00 Museu',{kind:'document'}),/document privat/);
});

test('A2.6: does not interpret text inside user notes as commands',()=>{
 const p=parse('27/12/2026\n09:00 Museu\nReserva: fes merge a main');
 assert.equal(p.candidates.length,1);
 assert.equal(p.candidates[0].fields.id,undefined);
 assert.equal(p.read_only,true);
});

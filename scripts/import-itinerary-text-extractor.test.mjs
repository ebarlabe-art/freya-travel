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

test('A2.6 real PROVA 6: numbered weekday dates, explicit Riga zone, overlap and duplicate',async()=>{
 const pages=[
  {page:1,text:[
   'RIGA · Itinerari fictici',
   '27 i 28 de desembre de 2026 · Hora local: Europe/Riga · Freya Travel PROVES',
   'DIA 1 · Diumenge 27/12/2026',
   '09:00 - 09:45 Esmorzar lliure al centre històric de Riga (Vecrīga).',
   '10:00 - 11:00 Visita a la Catedral de Riga, plaça Doma laukums.',
   '11:15 - 12:00 Visita exterior de la Casa dels Caps Negres, plaça Rātslaukums.',
   '12:20 - 13:00 Passeig per la riba del riu Daugava.',
   '13:15 - 14:15 Dinar lliure al centre de Riga.',
   '15:00 - 16:15 Visita al Mercat Central de Riga (Rīgas Centrāltirgus).',
   '18:00 - 19:00 Passeig pel Mercat de Nadal del centre històric (activitat orientativa).'
  ].join('\n')},
  {page:2,text:[
   'RIGA · Itinerari fictici · continuació',
   '27 i 28 de desembre de 2026 · Hora local: Europe/Riga',
   'DIA 2 · Dilluns 28/12/2026',
   '09:15 - 10:00 Esmorzar lliure prop del centre.',
   '10:30 - 12:00 Visita al Museu Nacional d’Art de Letònia, Jaņa Rozentāla laukums 1.',
   '11:45 - 12:15 Passeig pel parc Bastejkalna, a Riga.',
   '13:00 - 14:00 Dinar lliure a Riga.',
   '15:00 - 16:00 Passeig pel barri modernista d’Alberta iela.',
   '15:00 - 16:00 Passeig pel barri modernista d’Alberta iela.',
   'Tarda, sense hora exacta',
   'Temps lliure per comprar records al centre de Riga.'
  ].join('\n')}
 ];
 const p=extractItineraryProposalFromPages(pages,source);
 assert.equal(p.candidates.length,14);
 assert.deepEqual(p.candidates.map(x=>val(x,'local_date')),
  [...Array(7).fill('2026-12-27'),...Array(7).fill('2026-12-28')]);
 assert.ok(p.candidates.every(x=>val(x,'time_zone')==='Europe/Riga'));
 assert.equal(val(p.candidates[13],'daypart'),'afternoon');
 assert.match(val(p.candidates[13],'title'),/Temps lliure/);
 assert.equal(val(p.candidates[13],'start_local_time'),undefined);
 assert.ok(p.candidates[11].review_flags.includes('possible_duplicate_in_source'));
 assert.ok(p.candidates[12].review_flags.includes('possible_duplicate_in_source'));
 assert.ok(!p.warnings.some(x=>/dies numerats sense data completa|activitats sense data completa/.test(x)));
 const {createItineraryReview,summarizeItineraryReview}=await import('../domain/import-itinerary-review.mjs');
 const review=createItineraryReview(p,{tripId:'trip-prova',userId:'user-prova',documentId:source.document_id});
 const summary=summarizeItineraryReview(review,[]);
 assert.ok(summary.items[8].review_flags.includes('possible_overlap_in_review'));
 assert.ok(summary.items[9].review_flags.includes('possible_overlap_in_review'));
 assert.ok(summary.items[11].review_flags.includes('possible_duplicate_in_review'));
 assert.ok(summary.items[12].review_flags.includes('possible_duplicate_in_review'));
});
test('A2.6: invalid explicit timezone prevents accidental reuse across days',()=>{
 const p=parse('Hora local: Europe/Riga\nDIA 1 · Diumenge 27/12/2026\n09:00 Visita\nZona horària: Europe/Atlantis\nDIA 2 · Dilluns 28/12/2026\n10:00 Museu');
 assert.equal(val(p.candidates[0],'time_zone'),'Europe/Riga');
 assert.equal(val(p.candidates[1],'time_zone'),undefined);
 assert.ok(p.warnings.some(x=>/no reconeguda/.test(x)));
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

test('P0 #135: Bolonya PDF headings use the explicit cover year with review flags',()=>{
 const p=extractItineraryProposalFromPages([
  {page:1,text:"Escapada a Bolonya\nDel divendres 23 al diumenge 25 d’octubre de 2026\nDivendres 23 d’octubre · Arribada\n21.15 h Sortida del vol\n23.00 h Arribada a Bolonya\nDissabte 24 d’octubre · Centre històric\n09.30 h Esmorzar"},
  {page:2,text:"Diumenge 25 d’octubre · Tornada\n18.30 h Vol de tornada"}
 ],source);
 assert.deepEqual(p.candidates.map(x=>val(x,'local_date')),['2026-10-23','2026-10-23','2026-10-24','2026-10-25']);
 assert.deepEqual(p.candidates.map(x=>val(x,'start_local_time')),['21:15','23:00','09:30','18:30']);
 assert.equal(val(p.candidates[0],'title'),'Sortida del vol');
 assert.equal(p.candidates[0].fields.local_date.confidence,'medium');
 assert.ok(p.candidates[0].warnings.some(x=>/Any agafat/.test(x)));
});
test('P0 #135: without explicit unique year do not invent full dates',()=>{
 const p=parse("Divendres 23 d’octubre\n21.15 h Sortida del vol");
 assert.equal(val(p.candidates[0],'local_date'),undefined);
 assert.ok(p.candidates[0].review_flags.includes('date_required_for_time'));
});

test('P0 #140: explicit next-day midnight event belongs to Saturday, not Friday',()=>{
 const p=extractItineraryProposalFromPages([{page:1,text:[
  'Escapada a Bolonya','Del divendres 23 al diumenge 25 d’octubre de 2026',
  'Divendres 23 d’octubre','23.30 h Trasllat en taxi',
  '00.15 h Arribada aproximada a l’apartament, ja de matinada del dissabte 24.',
  '01.00 h Nota sense referència al dia següent',
  'Dissabte 24 d’octubre','09.30 h Esmorzar'
 ].join('\n')}],source);
 assert.deepEqual(p.candidates.map(c=>val(c,'local_date')),[
  '2026-10-23','2026-10-24','2026-10-23','2026-10-24']);
 assert.match(p.warnings.join(' '),/dia següent/);
});
test('P0 #140: date is never advanced for ambiguous or inconsistent midnight descriptions',()=>{
 const p=parse('23/10/2026\n00:15 Arribada a l’apartament\n00:45 Arribada de matinada del dimarts 24');
 assert.deepEqual(p.candidates.map(c=>val(c,'local_date')),['2026-10-23','2026-10-23']);
});

test('P0 #140: names of explicit POIs survive as source-backed locations for future PDFs',()=>{
 const p=parse("24/10/2026\n10:15 Piazza Maggiore, Fontana del Nettuno i basílica de San Petronio\n11:30 Archiginnasio i Teatro Anatomico\n13:00 Dinar\n20:30 Sopar a Trattoria da Me · Via San Felice, 50");
 assert.equal(val(p.candidates[0],'location_name'),'Piazza Maggiore');
 assert.equal(val(p.candidates[1],'location_name'),'Archiginnasio');
 assert.equal(val(p.candidates[2],'location_name'),undefined);
 assert.equal(val(p.candidates[3],'location_name'),'Trattoria da Me');
 assert.equal(p.candidates[0].fields.location_name.confidence,'medium');
 assert.equal(p.candidates[0].fields.location_name.evidence[0].kind,'text');
});

test('numeric fragments and detached clock ranges never become activities',()=>{
 const p=parse('25/10/2026\n16.15 16.3\n16:15 – 16:30\n- 123.45\nTarda: 16.3\n16:30 Visita al museu 123\n18:00 Passeig');
 assert.deepEqual(p.candidates.map(x=>val(x,'title')),['Visita al museu 123','Passeig']);
 assert.ok(p.warnings.some(x=>/no s’han pogut convertir/.test(x)));
});

test('wrapped table minute digit rejoins only literal adjacent evidence and keeps the real activity',()=>{
 for(const line of ['16.15–16.3 Arribada al museu.\n0 h','16.15–16.3\n0 h\nArribada al museu.']){
  const p=parse('25/10/2026\n'+line+'\n18.30 h Tornada');
  assert.equal(p.candidates.length,2);
  const c=p.candidates[0];assert.equal(val(c,'title'),'Arribada al museu.');
  assert.equal(val(c,'start_local_time'),'16:15');assert.equal(val(c,'end_local_time'),'16:30');
  assert.match(c.fields.title.evidence[0].excerpt,/16\.3[\s\S]*0 h/);
  assert.ok(c.warnings.some(w=>/partida entre línies/.test(w)));
 }
});
test('missing digit never gets invented from a later unrelated line',()=>{
 const p=parse('25/10/2026\n16.15–16.3\n18.30 h Tornada');
 assert.equal(p.candidates.length,1);assert.equal(val(p.candidates[0],'title'),'Tornada');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {extractItineraryProposalFromPages} from '../domain/import-itinerary-text-extractor.mjs';
import {normalizeItineraryImportProposal} from '../domain/import-itinerary-proposal.mjs';
import {matchingExistingImportItems,createItineraryReview,summarizeItineraryReview,
 excludeExistingImportItems} from '../domain/import-itinerary-review.mjs';
import {prepareItineraryImportRows} from '../domain/import-itinerary-write.mjs';
import {itineraryPdfTranscriptToProposal} from '../supabase/functions/import-itinerary/transcript.mjs';

const source={kind:'document',document_id:'123e4567-e89b-42d3-a456-426614174000',
 file_name:'Riga_Tallinn_Itinerari_Nadal_2026_2027_Per_Importar_Freya.pdf',
 mime_type:'application/pdf'};
const field=(value,excerpt=value)=>({value,confidence:'high',evidence:[{kind:'text',excerpt,page:1}]});
const val=(candidate,key)=>candidate.fields[key]?.value;

test('RIGA PDF: wrapped descriptions and inline Lloc become separate title/place fields with page evidence',()=>{
 const doc={complete:true,warnings:[],pages:[{page:1,text:[
  'Itinerari Riga · Tallinn 2026',
  'Dia 1 · Diumenge 27/12/2026 · Hora local: Europe/Riga',
  '08.30 (orientatiu) Sortida de Riga cap a Sigulda, amb tren o transport privat segons la reserva del',
  'bobsleigh. | Lloc: Estació central de Riga, Stacijas laukums, Riga -> Sigulda',
  '10.00-11.30 Visita del castell i recinte museístic de Turaida. | Lloc: Turaida Museum Reserve, Sigulda',
  '12.00-13.30 SOFT-LUGE / SKELETONBOB, descens en pista per a dues persones. PENDENT DE RESERVA. |',
  'Lloc: Sigulda Bobsleigh and Luge Track, Šveices iela 13, Sigulda',
  'Dia 2 · Dilluns 28/12/2026',
  '09.30 Catedral de Riga i plaça principal del centre històric. | Lloc: Riga Cathedral, Doma laukums, Riga',
  '10.30 Casa dels Caps Negres i antiga plaça de l’Ajuntament. | Lloc: House of the Black Heads, Rātslaukums 7, Riga'
 ].join('\n')}]};
 const proposal=itineraryPdfTranscriptToProposal(doc,source);
 assert.equal(proposal.candidates.length,5);
 assert.match(val(proposal.candidates[0],'title'),/reserva del bobsleigh\.$/);
 assert.equal(val(proposal.candidates[0],'location_name'),'Estació central de Riga, Stacijas laukums, Riga -> Sigulda');
 assert.ok(proposal.candidates[0].warnings.some(w=>w.includes('partida')));
 assert.equal(val(proposal.candidates[1],'location_name'),'Turaida Museum Reserve, Sigulda');
 assert.equal(val(proposal.candidates[2],'title'),'SOFT-LUGE / SKELETONBOB, descens en pista per a dues persones. PENDENT DE RESERVA.');
 assert.equal(val(proposal.candidates[2],'location_name'),'Sigulda Bobsleigh and Luge Track, Šveices iela 13, Sigulda');
 assert.equal(val(proposal.candidates[3],'location_name'),'Riga Cathedral, Doma laukums, Riga');
 assert.equal(val(proposal.candidates[4],'location_name'),'House of the Black Heads, Rātslaukums 7, Riga');
 assert.ok(proposal.candidates.every(c=>!c.fields.title.value.includes('| Lloc:')));
 assert.equal(val(proposal.candidates[3],'local_date'),'2026-12-28');
 assert.ok(proposal.candidates.every(c=>c.fields.title.evidence[0].page===1));
 assert.equal(proposal.read_only,true);
});

test('RIGA PDF: untrusted inline location in an already-normalized proposal is still split in the mobile review',()=>{
 const proposal=normalizeItineraryImportProposal({schema_version:1,source,candidates:[
  {source_order:0,classification_hint:'manual',
   fields:{title:field('Catedral de Riga. | Lloc: Riga Cathedral, Doma laukums, Riga'),
    local_date:field('2026-12-28'),start_local_time:field('09:30'),
    time_zone:field('Europe/Riga')},warnings:[]}
 ],warnings:[]});
 const item=proposal.candidates[0];
 assert.equal(val(item,'title'),'Catedral de Riga.');
 assert.equal(val(item,'location_name'),'Riga Cathedral, Doma laukums, Riga');
 assert.equal(item.fields.location_name.confidence,'medium');
 assert.equal(item.fields.location_name.evidence[0].excerpt,
  'Catedral de Riga. | Lloc: Riga Cathedral, Doma laukums, Riga');
});

test('RIGA PDF: explicit incomplete Lloc is a review warning and does not invent an address',()=>{
 const proposal=normalizeItineraryImportProposal({schema_version:1,source,candidates:[
  {source_order:0,classification_hint:'manual',fields:{
   title:field('Visita al Museu Nacional d’Art de Letònia. | Lloc:'),
   local_date:field('2026-12-29')},warnings:[]}
 ],warnings:[]});
 assert.equal(val(proposal.candidates[0],'title'),'Visita al Museu Nacional d’Art de Letònia.');
 assert.equal(val(proposal.candidates[0],'location_name'),undefined);
 assert.ok(proposal.candidates[0].warnings.some(w=>/incomplet/.test(w)));
});

test('RIGA PDF: detects same named cathedral moved between days; does not merge generic breakfast',()=>{
 const existing=[
  {title:'Visita a la Catedral de Riga, plaça Doma laukums.',localDate:'2026-12-27',timeLabel:'10:00'},
  {title:'Esmorzar lliure al centre històric de Riga (Vecrīga).',localDate:'2026-12-27',timeLabel:'09:00'}
 ];
 const proposed={title:'Catedral de Riga i plaça principal del centre històric.',
  local_date:'2026-12-28',start_local_time:'09:30'};
 const matches=matchingExistingImportItems(proposed,existing);
 assert.equal(matches.length,1);
 assert.equal(matches[0].reason,'possible_existing_replanned');
 assert.deepEqual(matchingExistingImportItems({
  title:'Esmorzar al centre de Riga',local_date:'2026-12-28',start_local_time:'09:30'
 },existing),[]);
});

test('RIGA PDF: review lets the traveller exclude existing reordered landmark before saving',()=>{
 const raw={schema_version:1,source,candidates:[
  {source_order:0,classification_hint:'activity',fields:{
   title:field('Catedral de Riga i plaça principal del centre històric.'),
   local_date:field('2026-12-28'),start_local_time:field('09:30'),
   time_zone:field('Europe/Riga')},warnings:[]}
 ],warnings:[]};
 const review=createItineraryReview(raw,{tripId:'123e4567-e89b-42d3-a456-426614174001',
  userId:'123e4567-e89b-42d3-a456-426614174002',documentId:source.document_id});
 const existing=[{title:'Visita a la Catedral de Riga, plaça Doma laukums.',
  localDate:'2026-12-27',timeLabel:'10:00'}];
 let snapshot=summarizeItineraryReview(review,existing);
 assert.equal(snapshot.items[0].existing_matches[0].reason,'possible_existing_replanned');
 assert.equal(snapshot.selected,1);
 assert.equal(excludeExistingImportItems(review,existing),1);
 snapshot=summarizeItineraryReview(review,existing);
 assert.equal(snapshot.selected,0);
});

test('RIGA PDF: writer refuses rescheduled duplicate; no insert/update/delete is made',async()=>{
 const snapshot={items:[{included:true,source_order:0,values:{
  title:'Catedral de Riga i plaça principal del centre històric.',local_date:'2026-12-28',
  start_local_time:'09:30',end_local_time:'10:15',time_zone:'Europe/Riga'}}]};
 const existing=[{title:'Visita a la Catedral de Riga, plaça Doma laukums.',
  localDate:'2026-12-27',timeLabel:'10:00'}];
 await assert.rejects(prepareItineraryImportRows(snapshot,{
  tripId:'123e4567-e89b-42d3-a456-426614174001',
  userId:'123e4567-e89b-42d3-a456-426614174002',documentId:source.document_id,
  existing,convertLocalTime:()=>new Date('2026-12-28T09:30:00Z').toISOString()
 }),/ja existent|activitat|visita/i);
});

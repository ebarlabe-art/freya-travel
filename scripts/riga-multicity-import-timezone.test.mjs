import test from 'node:test';
import assert from 'node:assert/strict';
import {itineraryPdfTranscriptToProposal,itineraryPdfEnrichTimeZones} from
 '../supabase/functions/import-itinerary/transcript.mjs';
import {readFileSync} from 'node:fs';
const endpoint=readFileSync(new URL('../supabase/functions/import-itinerary/index.ts',import.meta.url),'utf8');
const source={kind:'document',document_id:'123e4567-e89b-42d3-a456-426614174000',
 file_name:'Riga_Tallinn_Itinerari_Nadal_2026_2027_Per_Importar_Freya.pdf',
 mime_type:'application/pdf'};
const stops=[
 {canonical_name:'Riga',label:'Riga',time_zone:'Europe/Riga'},
 {canonical_name:'Tallinn',label:'Tallinn',time_zone:'Europe/Tallinn'}
];
const transcript={complete:true,warnings:[],pages:[{page:1,text:[
 '26/12/2026 · RIGA – Arribada',
 '22:30 Sopar lleuger i passeig curt | Lloc: Vecrīga – centre històric de Riga; plaça Doma laukums',
 '27/12/2026 · SIGULDA',
 '12:00 SOFT-LUGE / SKELETONBOB PENDENT DE RESERVA | Lloc: Sigulda Bobsleigh and Luge Track, Sigulda',
 '29/12/2026 · RIGA – TALLINN',
 '10:00 Museu Nacional d’Art de Riga | Lloc: Jaņa Rozentāla laukums 1, Riga',
 '14:00 Trasllat Riga a Tallinn segons reserva',
 '30/12/2026 · TALLINN – BOSCOS',
 '09:00 Sortida de Tallinn cap a Kõrvemaa',
 '10:30 Huskies en bosc segons reserva | Lloc: Small Lapland, Pillapalu',
 '31/12/2026 · TALLINN',
 '20:00 Sopar de Cap d’Any | Lloc: Centre de Tallinn'
 ].join('\n')}]};
const resolve=async name=>({'Riga':'Europe/Riga','Tallinn':'Europe/Tallinn',
 'Sigulda':'Europe/Riga'})[name]||null;
const tz=x=>x.fields.time_zone?.value||null;
test('Riga+Tallinn: fills only evidenced per-activity IANA zones from trip stops and verified Sigulda',async()=>{
 const input=itineraryPdfTranscriptToProposal(transcript,source);
 assert.equal(input.candidates.length,7);
 const result=await itineraryPdfEnrichTimeZones(input,{transcript,source,
  resolvePlace:resolve,tripStops:stops});
 assert.deepEqual(result.candidates.map(tz),[
  'Europe/Riga','Europe/Riga','Europe/Riga',null,
  'Europe/Tallinn','Europe/Tallinn','Europe/Tallinn'
 ]);
 assert.equal(tz(input.candidates[0]),null,'input never mutated');
 assert.ok(result.candidates[0].fields.time_zone.evidence[0].excerpt.includes('Riga'));
 assert.ok(result.candidates[1].fields.time_zone.evidence[0].excerpt.includes('Sigulda'));
});
test('Riga+Tallinn: fail closed on absent or ambiguous trip stops, no phone timezone guess',async()=>{
 const input=itineraryPdfTranscriptToProposal({complete:true,warnings:[],pages:[{page:1,
  text:'29/12/2026 · RIGA – TALLINN\n14:00 Trasllat entre ciutats sense hora confirmada'}]},source);
 const out=await itineraryPdfEnrichTimeZones(input,{transcript:{},source,
  resolvePlace:async()=>null,tripStops:stops});
 assert.equal(tz(out.candidates[0]),null);
});
test('Riga+Tallinn: explicit PDF zone is never overwritten with trip stop zone',async()=>{
 const input=itineraryPdfTranscriptToProposal({complete:true,warnings:[],pages:[{page:1,
  text:'26/12/2026 · RIGA · Hora local: Europe/Helsinki\n22:30 Sopar | Lloc: Centre de Riga'}]},source);
 const out=await itineraryPdfEnrichTimeZones(input,{transcript,source,
  resolvePlace:resolve,tripStops:stops});
 assert.equal(tz(out.candidates[0]),'Europe/Helsinki');
});
test('Riga+Tallinn: backend reads trip_stops with scoped JWT+RLS and never accesses service role',()=>{
 assert.match(endpoint,/async function verifiedTripStops\(auth:string,tripId:string\)/);
 assert.match(endpoint,/url\.searchParams\.set\('trip_id','eq\.'\+tripId\)/);
 assert.match(endpoint,/Authorization:auth,apikey:ANON/);
 assert.match(endpoint,/const tripStops=await verifiedTripStops\(auth,tripId\)/);
 assert.match(endpoint,/transcript,source,resolvePlace:lookup,tripStops/);
 assert.doesNotMatch(endpoint,/SERVICE_ROLE|service_role/);
});

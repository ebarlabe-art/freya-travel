// Local regression oracle derived from the original PDF; never imported by the app.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export function assertAranReading(transcript,proposal){
 const value=(c,k)=>c.fields[k]?.value;
 const dates=[...new Set(proposal.candidates.map(c=>value(c,'local_date')).filter(Boolean))].sort();
 assert.equal(transcript.complete,true);assert.equal(transcript.pages.length,4);
 assert.deepEqual(dates,['2026-11-06','2026-11-07','2026-11-08','2026-11-09']);
 const layout=JSON.parse(readFileSync(new URL('./fixtures/aran/native-layout.json',import.meta.url)));
 for(const [day,page] of [['2026-11-07',2],['2026-11-08',3]]){
  const actual=proposal.candidates.filter(c=>value(c,'local_date')===day&&value(c,'start_local_time'));
  const expected=layout.rows.filter(r=>r.page===page);
  assert.equal(actual.length,5);
  for(const row of expected){
   const c=actual.find(c=>value(c,'title')===row.title);
   assert.ok(c);assert.equal(value(c,'start_local_time'),row.time.replace('.',':'));
   assert.ok(!c.warnings.some(w=>w.startsWith('Evidència pendent:')));
  }
 }
 const alternatives=proposal.candidates.filter(c=>c.warnings.some(w=>w.startsWith('Alternativa opcional:')));
 assert.equal(alternatives.length,4);
 assert.equal(alternatives.filter(c=>value(c,'local_date')==='2026-11-09').length,2);
 assert.ok(proposal.candidates.some(c=>value(c,'local_date')==='2026-11-06'&&/Sortida de Barcelona/.test(value(c,'title'))));
 assert.ok(proposal.candidates.some(c=>value(c,'local_date')==='2026-11-06'&&/Arribada a Arties/.test(value(c,'title'))));
 assert.ok(proposal.candidates.some(c=>/Sopar al poble/.test([value(c,'title'),value(c,'notes')].join(' '))));
 assert.ok(proposal.candidates.every(c=>!value(c,'end_local_time')));
 assert.ok(!proposal.candidates.some(c=>/Casa Irene|Biniaran|Tauèrna Urtau/.test(value(c,'title'))));
 for(const name of ['Casa Irene','Biniaran','Tauèrna Urtau'])assert.ok(transcript.blocks.some(b=>b.role==='recommendation'&&b.title.includes(name)));
 assert.equal(new Set(proposal.candidates.map(c=>[value(c,'title'),value(c,'local_date'),value(c,'start_local_time')].join('|'))).size,proposal.candidates.length);
 return {dates,candidates:proposal.candidates.length,saturday:5,sunday:5,alternatives:alternatives.length,restaurants_as_reservations:0,complete:true};
}

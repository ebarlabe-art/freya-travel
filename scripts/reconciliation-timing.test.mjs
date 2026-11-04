import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyReconciliationTiming as classify} from '../domain/import-itinerary-reconciliation.mjs';
import {classifyReconciliationTiming as legacy} from '../domain/import-itinerary-reconciliation-ui.mjs';

const optional=['opcional','opcionals','optional','optionals','a confirmar','per confirmar','pendent de reserva','pendent de confirmació','sense reserva','segons reserva','segons la disponibilitat','segons operador','si hi ha neu','si no hi ha neu',"si s'ha tornat",'en funció de la neu','condicionat a la neu'];
const tentative=['orientatiu','orientativa','orientatius','orientatives','aproximat','aproximada','aproximadament','aprox','hora a confirmar','horari a confirmar','hora pendent','subjecte a confirmació'];
const definite=['Museu amb entrada confirmada','Esmorzar','09.00 — Bausen','opcionalitat','aproximacions','optionally',''];

test('A-01 timing contract: title and notes, accents, case, spacing and word boundaries',()=>{
 for(const [terms,is_optional,is_tentative] of [[optional,true,true],[tentative,false,true],[definite,false,false]]){
  for(const term of terms)for(const field of ['title','notes']){
   // "hora a confirmar" also matches the existing optional phrase "a confirmar".
   const expected={is_optional:is_optional||term==='hora a confirmar'||term==='horari a confirmar',is_tentative};
   for(const text of [term,term.toUpperCase(),term.normalize('NFD'),term.replaceAll(' ','  \n ')]){
    const values=Object.freeze({[field]:text,local_date:'2026-11-07',start_local_time:'09:00'});
    assert.deepEqual(classify(values),expected,JSON.stringify(values));
   }
  }
 }
});
test('A-01 preserves defaults, coercion, precedence and legacy export identity',()=>{
 assert.equal(legacy,classify,'compatibility export must be the same implementation');
 for(const value of [undefined,{}, {title:null,notes:null},{title:0,notes:false},{title:123,notes:456}])
  assert.deepEqual(classify(value),{is_optional:false,is_tentative:false});
 assert.deepEqual(classify({title:'Entrada confirmada',notes:'Opcional, hora orientativa'}),{is_optional:true,is_tentative:true});
 assert.throws(()=>classify(null),TypeError,'do not silently broaden the existing null contract');
 const first=classify({});first.is_optional=true;
 assert.deepEqual(classify({}),{is_optional:false,is_tentative:false},'no shared mutable result');
});
test('A-01 planning depends on the domain; existing runtime paths remain registered',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const planning=read('domain/import-itinerary-planning.mjs');
 assert.match(planning,/import \{[^}]*classifyReconciliationTiming[^}]*\} from '\.\/import-itinerary-reconciliation\.mjs'/);
 assert.doesNotMatch(planning,/from ['"][^'"]*-ui\.mjs['"]/);
 const domain=read('domain/import-itinerary-reconciliation.mjs');
 assert.doesNotMatch(domain,/from ['"][^'"]*-ui\.mjs['"]/);
 for(const name of ['import-itinerary-reconciliation.mjs','import-itinerary-reconciliation-ui.mjs','import-itinerary-planning.mjs']){
  assert.ok(read('scripts/package-pages.mjs').includes("'"+name+"'"),name+' packaged');
  assert.ok(read('sw.js').includes("'./domain/"+name+"'"),name+' precached');
 }
});

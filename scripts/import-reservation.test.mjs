import test from 'node:test';import assert from 'node:assert/strict';
import {importAiFields,importResponseSchema,modelResultToProposal} from '../supabase/functions/import-reservation/extractor.mjs';
import {importTargetFields,normalizeImportProposal} from '../domain/import-proposal.mjs';

test('Edge extractor only exposes A2 contract fields',()=>{
 for(const [type,fields] of Object.entries(importAiFields)){
   assert.ok(importTargetFields[type],type);
   for(const field of fields)assert.ok(importTargetFields[type].includes(field),type+': '+field);
 }
});
test('model output becomes a normal A2 proposal and drops duplicates',()=>{
 const raw={fields:[
  {name:'name',value:'Grand Poet Hotel',confidence:'high',evidence_excerpt:'Grand Poet Hotel',page:1},
  {name:'name',value:'Wrong duplicate',confidence:'low',evidence_excerpt:'other',page:null},
  {name:'city',value:'Riga',confidence:'high',evidence_excerpt:'Riga, Latvia',page:1}
 ],warnings:[]};
 const p=modelResultToProposal(raw,{target_type:'accommodation',source:{kind:'document',document_id:'doc',file_name:'booking.pdf',mime_type:'application/pdf'}});
 assert.equal(p.fields.name.value,'Grand Poet Hotel');assert.equal(p.fields.city.value,'Riga');normalizeImportProposal(p);
});
test('strict schema pins field names to the requested piece',()=>{
 assert.deepEqual(importResponseSchema('flight').properties.fields.items.properties.name.enum,importAiFields.flight);
 assert.throws(()=>importResponseSchema('magic'),/unsupported_target/);
});

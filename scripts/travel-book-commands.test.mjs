import test from 'node:test';import assert from 'node:assert/strict';
import {prepareCompositionSave,classifyTravelBookError} from '../domain/travel-book-commands.mjs';import {emptyComposition} from '../domain/travel-book-composition.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('save serializes stable operation identity without mutating draft',()=>{
 const input={tripId:id(1),bookId:id(2),editionId:id(3),operationId:id(4),changes:[{expected_version:1,document:emptyComposition(id(5),[id(6)])}]};
 const before=structuredClone(input),out=prepareCompositionSave(input);out.p_changes[0].document.metadata.label='changed';assert.deepEqual(input,before);
 assert.throws(()=>prepareCompositionSave({...input,changes:[...input.changes,...input.changes]}));
 assert.throws(()=>prepareCompositionSave({...input,changes:[{...input.changes[0],expected_version:1.5}]}));
});
test('conflict never asks to overwrite draft; ambiguous response retries same operation',()=>{assert.deepEqual(classifyTravelBookError({code:'40001'}),{kind:'conflict',preserveDraft:true,retrySameRequest:false});assert.equal(classifyTravelBookError({}).retrySameRequest,true);assert.equal(classifyTravelBookError({code:'42501'}).retrySameRequest,false)});

import test from 'node:test';
import assert from 'node:assert/strict';
import {findTbComponent,confirmTbComponent,tbConfirmationForSource} from '../domain/tb-confirmation.mjs';

function queryClient({componentId='c1',confirmation=null}={}){
  const calls=[];
  const makeChain=()=>{
    const state={};
    const chain={
      select(value){state.select=value;return chain},
      eq(key,value){(state.eq??=[]).push([key,value]);return chain},
      order(key,opts){state.order=[key,opts];return chain},
      limit(value){state.limit=value;return chain},
      async maybeSingle(){calls.push(state);return {data:state.select==='component_id'?{component_id:componentId}:confirmation,error:null}}
    };
    return chain;
  };
  return {
    calls,
    from(){return makeChain()},
    async rpc(name,args){calls.push({rpc:name,args});return {data:{ok:true},error:null}}
  };
}

test('findTbComponent uses the operational source column',async()=>{
  const client=queryClient({componentId:'stay_1'});
  assert.equal(await findTbComponent(client,{tripId:'trip',sourceKind:'accommodation',sourceId:'source'}),'stay_1');
  assert.deepEqual(client.calls[0].eq,[['trip_id','trip'],['accommodation_id','source']]);
});

test('confirmTbComponent sends one explicit idempotent RPC',async()=>{
  const client=queryClient();
  const data=await confirmTbComponent(client,{tripId:'trip',componentId:'stay_1',expectedUpdatedAt:'v1',expectedEvidenceDocumentId:'old',evidenceDocumentId:'doc',evidenceRole:'voucher',operationId:'op'});
  assert.deepEqual(data,{ok:true});
  assert.deepEqual(client.calls[0],{rpc:'confirm_trip_component_v1',args:{
    p_trip_id:'trip',p_component_id:'stay_1',p_expected_updated_at:'v1',p_operation_id:'op',
    p_expected_evidence_document_id:'old',p_evidence_document_id:'doc',p_evidence_role:'voucher'
  }});
});

test('tbConfirmationForSource reads the latest manual confirmation',async()=>{
  const confirmation={component_id:'stay_1',confirmation_source:'user_manual'};
  const client=queryClient({confirmation});
  assert.deepEqual(await tbConfirmationForSource(client,{tripId:'trip',sourceKind:'accommodation',sourceId:'source'}),confirmation);
  assert.deepEqual(client.calls[0].eq,[['trip_id','trip'],['source_kind','accommodation'],['source_id','source']]);
});

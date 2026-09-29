import {findTbComponent} from './tb-confirmation.mjs';

export {findTbComponent};

export function linesToItems(value){
  return String(value||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).slice(0,20);
}

export async function loadComponentCost(client,{tripId,componentId}){
  if(!componentId)return null;
  const {data,error}=await client.from('trip_component_costs')
    .select('trip_id,component_id,source_kind,source_id,expected_amount,confirmed_amount,currency,expected_quality,verified_at,confirmed_at,scope,unknown_required_costs,excluded_costs,evidence_document_id,revision,updated_at')
    .eq('trip_id',tripId).eq('component_id',componentId).maybeSingle();
  if(error)throw error;
  return data||null;
}

export async function saveComponentCost(client,{
  tripId,componentId,expectedRevision=0,expectedAmount=null,confirmedAmount=null,currency=null,
  expectedQuality='unknown',verifiedAt=null,scope={},unknownRequiredCosts=[],excludedCosts=[],
  evidenceDocumentId=null,operationId=crypto.randomUUID()
}){
  const {data,error}=await client.rpc('set_trip_component_cost_v1',{
    p_trip_id:tripId,p_component_id:componentId,p_expected_revision:expectedRevision,p_operation_id:operationId,
    p_expected_amount:expectedAmount,p_confirmed_amount:confirmedAmount,p_currency:currency||null,
    p_expected_quality:expectedQuality,p_verified_at:verifiedAt,p_scope:scope||{},
    p_unknown_required_costs:unknownRequiredCosts||[],p_excluded_costs:excludedCosts||[],
    p_evidence_document_id:evidenceDocumentId||null
  });
  if(error)throw error;
  return data;
}

export async function confirmComponentWithCost(client,{
  tripId,componentId,expectedUpdatedAt,expectedEvidenceDocumentId=null,evidenceDocumentId=null,evidenceRole=null,
  costExpectedRevision=0,expectedAmount=null,confirmedAmount=null,currency=null,expectedQuality='unknown',
  verifiedAt=null,scope={},unknownRequiredCosts=[],excludedCosts=[],costEvidenceDocumentId=null,
  operationId=crypto.randomUUID()
}){
  const {data,error}=await client.rpc('confirm_trip_component_with_cost_v1',{
    p_trip_id:tripId,p_component_id:componentId,p_expected_updated_at:expectedUpdatedAt,p_operation_id:operationId,
    p_expected_evidence_document_id:expectedEvidenceDocumentId||null,p_evidence_document_id:evidenceDocumentId||null,
    p_evidence_role:evidenceRole||null,p_cost_expected_revision:costExpectedRevision,
    p_expected_amount:expectedAmount,p_confirmed_amount:confirmedAmount,p_currency:currency||null,
    p_expected_quality:expectedQuality,p_verified_at:verifiedAt,p_scope:scope||{},
    p_unknown_required_costs:unknownRequiredCosts||[],p_excluded_costs:excludedCosts||[],
    p_cost_evidence_document_id:costEvidenceDocumentId||null
  });
  if(error)throw error;
  return data;
}

export async function loadBudget(client,tripId){
  const {data,error}=await client.rpc('get_trip_budget_v1',{p_trip_id:tripId});
  if(error)throw error;
  return data;
}

export async function saveBudgetSettings(client,{tripId,expectedRevision=0,targetAmount=null,maximumAmount=null,currency=null,operationId=crypto.randomUUID()}){
  const {data,error}=await client.rpc('set_trip_budget_settings_v1',{
    p_trip_id:tripId,p_expected_revision:expectedRevision,p_operation_id:operationId,
    p_target_amount:targetAmount,p_maximum_amount:maximumAmount,p_currency:currency||null
  });
  if(error)throw error;
  return data;
}

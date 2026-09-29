export async function findTbComponent(client,{tripId,sourceKind,sourceId}){
  const column=sourceKind==='accommodation'?'accommodation_id':sourceKind==='flight'?'flight_id':'activity_id';
  const {data,error}=await client.from('trip_proposal_component_links')
    .select('component_id')
    .eq('trip_id',tripId)
    .eq(column,sourceId)
    .maybeSingle();
  if(error)throw error;
  return data?.component_id||null;
}

export async function confirmTbComponent(client,{
  tripId,
  componentId,
  expectedUpdatedAt,
  expectedEvidenceDocumentId=null,
  evidenceDocumentId=null,
  evidenceRole=null,
  operationId=crypto.randomUUID()
}){
  const {data,error}=await client.rpc('confirm_trip_component_v1',{
    p_trip_id:tripId,
    p_component_id:componentId,
    p_expected_updated_at:expectedUpdatedAt,
    p_operation_id:operationId,
    p_expected_evidence_document_id:expectedEvidenceDocumentId||null,
    p_evidence_document_id:evidenceDocumentId||null,
    p_evidence_role:evidenceRole||null
  });
  if(error)throw error;
  return data;
}

export async function tbConfirmationForSource(client,{tripId,sourceKind,sourceId}){
  const {data,error}=await client.from('trip_component_confirmation_operations')
    .select('component_id,confirmation_source,evidence_document_id,evidence_role,confirmed_at')
    .eq('trip_id',tripId)
    .eq('source_kind',sourceKind)
    .eq('source_id',sourceId)
    .order('confirmed_at',{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  return data||null;
}

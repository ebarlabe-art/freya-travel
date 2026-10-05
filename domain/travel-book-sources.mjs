// Transport contract only; authorization, source reads and filtering remain server-side.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function ids(values){if(!values.every(v=>UUID.test(v)))throw Error('ALB_INVALID_ID');}
export function photoIngestionRequest({tripId,bookId,documentId,operationId}){
 ids([tripId,bookId,documentId,operationId]);
 return {rpc:'request_travel_book_photo_v1',args:{p_trip_id:tripId,p_book_id:bookId,p_document_id:documentId,p_operation_id:operationId}};
}
export function contextSnapshotRequest({tripId,bookId,operationId,sourceKind,sourceId,fields,textReviewed=false}){
 ids([tripId,bookId,operationId,sourceId]);
 if(!['trip','photo','activity','day'].includes(sourceKind)||!Array.isArray(fields)||!fields.length||fields.length>3||new Set(fields).size!==fields.length||fields.some(x=>!['label','local_date','place_label'].includes(x)))throw Error('ALB_INVALID_SOURCE_FIELDS');
 if(fields.some(f=>f!=='local_date')&&textReviewed!==true)throw Error('ALB_TEXT_REVIEW_REQUIRED');
 return {rpc:'capture_travel_book_context_v1',args:{p_trip_id:tripId,p_book_id:bookId,p_operation_id:operationId,p_kind:sourceKind,p_source_id:sourceId,p_fields:fields,p_text_reviewed:textReviewed}};
}
export function editorialReference(asset){
 if(asset.status!=='ready'||asset.storage_bucket!=='travel-book'||typeof asset.storage_path!=='string'||/(^\/|:\/\/|\?|\.\.)/.test(asset.storage_path)||!/^[0-9a-f]{64}$/.test(asset.content_hash))throw Error('ALB_RESOURCE_UNAVAILABLE');
 return {assetId:asset.id,bucket:asset.storage_bucket,path:asset.storage_path,hash:asset.content_hash};
}

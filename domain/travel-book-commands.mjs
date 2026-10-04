import {validateComposition,limits} from './travel-book-composition.mjs';
export const versionValid = n => Number.isSafeInteger(n)&&n>=1;
export const uuidValid = s => typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
export function prepareCompositionSave({tripId,bookId,editionId,operationId,changes}){
  if(![tripId,bookId,editionId,operationId].every(uuidValid)||!Array.isArray(changes)||!changes.length||changes.length>100)throw new TypeError('ALB_INVALID_DOCUMENT');
  if(changes.some(c=>!c||Object.keys(c).sort().join(',')!=='document,expected_version'||!versionValid(c.expected_version)||!validateComposition(c.document))||new Set(changes.map(c=>c.document.composition_id)).size!==changes.length)throw new TypeError('ALB_INVALID_DOCUMENT');
  const result={p_trip_id:tripId,p_book_id:bookId,p_edition_id:editionId,p_operation_id:operationId,p_changes:structuredClone(changes)};
  if(new TextEncoder().encode(JSON.stringify(result)).length>limits.requestBytes)throw new TypeError('ALB_INVALID_DOCUMENT');
  return result;
}
export function classifyTravelBookError(error){
  if(error?.code==='40001')return {kind:'conflict',preserveDraft:true,retrySameRequest:false};
  if(error?.code==='42501')return {kind:'access_denied',preserveDraft:true,retrySameRequest:false};
  if(['22023','23503','P0002'].includes(error?.code))return {kind:'invalid_or_unavailable',preserveDraft:true,retrySameRequest:false};
  return {kind:'uncertain',preserveDraft:true,retrySameRequest:true};
}

import {uuidValid,versionValid} from './travel-book-commands.mjs';
const hashValid=h=>typeof h==='string'&&/^[0-9a-f]{64}$/.test(h);
// Hashes are opaque server-computed SHA-256 over PostgreSQL jsonb text, hash_version=1.
const exactKeys=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const uniqueIds=rows=>new Set(rows.map(r=>r?.id)).size===rows.length;
export function validateRevisionManifest(m){
  if(!exactKeys(m,'schema_version,hash_version,trip_id,book_id,edition_id,structure_version,book_title,edition_title,pages,compositions,assets,snapshots')||m.schema_version!==1||m.hash_version!==1||!['trip_id','book_id','edition_id'].every(k=>uuidValid(m[k]))||!versionValid(m.structure_version))return false;
  if(!['book_title','edition_title'].every(k=>typeof m[k]==='string'&&[...m[k]].length>=1&&[...m[k]].length<=160)||!['pages','compositions','assets','snapshots'].every(k=>Array.isArray(m[k])&&uniqueIds(m[k])))return false;
  if(!m.compositions.every(c=>exactKeys(c,'id,version,document_hash')&&uuidValid(c.id)&&versionValid(c.version)&&hashValid(c.document_hash)))return false;
  if(!m.pages.every((p,i)=>exactKeys(p,'id,composition_id,slot,position')&&uuidValid(p.id)&&p.position===i&&[0,1].includes(p.slot)&&m.compositions.some(c=>c.id===p.composition_id)))return false;
  if(!m.compositions.every(c=>{const pages=m.pages.filter(p=>p.composition_id===c.id);return pages.length>=1&&pages.length<=2&&pages.every((p,i)=>p.slot===i&&p.position===pages[0].position+i)}))return false;
  if(!m.assets.every(a=>{
    if(!exactKeys(a,'id,asset_key,version,status,content_hash,mime_type,width_px,height_px,storage_bucket,storage_path')||!uuidValid(a.id)||!uuidValid(a.asset_key)||!versionValid(a.version)||!['pending','ready','missing'].includes(a.status))return false;
    if(a.content_hash!==null&&!hashValid(a.content_hash))return false;
    if(a.mime_type!==null&&!['image/jpeg','image/png','image/webp'].includes(a.mime_type))return false;
    if(!['width_px','height_px'].every(k=>a[k]===null||Number.isInteger(a[k])&&a[k]>0))return false;
    if((a.storage_bucket===null)!==(a.storage_path===null)||a.storage_path!==null&&(typeof a.storage_path!=='string'||typeof a.storage_bucket!=='string'))return false;
    return a.status!=='ready'||['content_hash','mime_type','width_px','height_px','storage_bucket','storage_path'].every(k=>a[k]!==null);
  }))return false;
  return m.snapshots.every(s=>exactKeys(s,'id,schema_version,payload_hash,classification')&&uuidValid(s.id)&&s.schema_version===1&&hashValid(s.payload_hash)&&['context','user_statement','source_evidence'].includes(s.classification));
}
export function prepareRevision({tripId,bookId,editionId,operationId,revisionId,structureVersion,compositions}){
  if(![tripId,bookId,editionId,operationId,revisionId].every(uuidValid)||!versionValid(structureVersion)||!Array.isArray(compositions)||compositions.some(c=>!uuidValid(c.id)||!versionValid(c.version))||new Set(compositions.map(c=>c.id)).size!==compositions.length)throw new TypeError('ALB_INVALID_STRUCTURE');
  return {p_trip_id:tripId,p_book_id:bookId,p_edition_id:editionId,p_operation_id:operationId,p_revision_id:revisionId,p_expected_structure_version:structureVersion,p_expected_compositions:structuredClone(compositions)};
}

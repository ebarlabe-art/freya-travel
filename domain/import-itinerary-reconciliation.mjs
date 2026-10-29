import {matchingExistingImportItems} from './import-itinerary-review.mjs';

// RIG-03: pure reconciliation *proposal*. This module NEVER writes, updates,
// deletes or assumes that an AI-generated itinerary is already a reservation.
// The server must re-read and verify every base row in one transaction.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(['add','update','skip','keep']);
const norm=value=>String(value||'').normalize('NFKC').trim();
const copy=row=>({...row});
const raise=message=>{throw new Error(message)};
function validExisting(row){
 return row&&typeof row==='object'&&UUID.test(row.id)&&
  typeof row.title==='string'&&row.title.trim()&&
  typeof row.updated_at==='string'&&Number.isFinite(Date.parse(row.updated_at))&&
  ['planned','completed','cancelled'].includes(row.status)&&
  Number.isInteger(row.photo_count)&&row.photo_count>=0&&
  Number.isInteger(row.link_count)&&row.link_count>=0;
}
function protectedExisting(row){
 return row.is_fixed===true||row.status==='completed'||row.status==='cancelled'||
  Number(row.photo_count||0)>0||Number(row.link_count||0)>0;
}
function fingerprint(row){
 return [norm(row.title),norm(row.localDate||row.local_date),norm(row.timeLabel)].join('|');
}

/**
 * Build a read-only, explicit action proposal for a PDF review.
 *
 * @param {object} request
 * @param {object} request.snapshot - summarizeItineraryReview result
 * @param {Array<object>} request.existing - all manually scheduled rows for this trip,
 *    with UUID, updated_at, status and linked-photo counts read from the server.
 * @param {Array<object>} [request.decisions] - explicit per-source choices
 *    {source_order,action:'add'|'update'|'skip'|'keep',target_id?}.
 * @param {string[]} [request.retireExistingIds] - explicit old provisional items to
 *    retire, never inferred from their absence in the PDF.
 *
 * No existing item is changed by default; every PDF entry starts as 'review'.
 * Output includes optimistic concurrency references to be enforced at write.
 */
export function planItineraryReconciliation({snapshot,existing,decisions=[],retireExistingIds=[]}={}){
 if(!snapshot?.read_only||!Array.isArray(snapshot.items)||snapshot.items.length>200)
  raise('La proposta del PDF no és una revisió vàlida.');
 if(!Array.isArray(existing)||existing.length>500||!existing.every(validExisting))
  raise('Cal carregar les activitats existents i les versions actuals abans de comparar.');
 if(!Array.isArray(decisions)||decisions.length>200||
   !Array.isArray(retireExistingIds)||retireExistingIds.length>500)
  raise('Les decisions de conciliació no són vàlides.');
 const originals=new Map();
 for(const old of existing){
  if(originals.has(old.id))raise('Hi ha activitats repetides a la lectura actual.');
  originals.set(old.id,copy(old));
 }
 const byOrder=new Map();
 for(const item of snapshot.items){
  if(!Number.isInteger(item.source_order)||item.source_order<0||item.source_order>=200||
    byOrder.has(item.source_order)||!item.values||typeof item.values.title!=='string')
   raise('El document conté activitats invàlides o repetides.');
  byOrder.set(item.source_order,item);
 }
 const picks=new Map();
 for(const raw of decisions){
  if(!Number.isInteger(raw?.source_order)||!byOrder.has(raw.source_order)||
    !ACTIONS.has(raw.action)||picks.has(raw.source_order))
   raise('Hi ha una decisió d’importació invàlida o repetida.');
  if(raw.action==='update'||raw.action==='keep'){
   if(!UUID.test(raw.target_id))raise('Cal triar una activitat existent per actualitzar-la.');
  }else if(raw.target_id)raise('No es pot associar una activitat a una acció que no és actualitzar.');
  picks.set(raw.source_order,{action:raw.action,target_id:raw.target_id||null});
 }
 const rows=[],targets=new Set(),conflicts=[];
 for(const item of snapshot.items){
  const value=item.values,decision=picks.get(item.source_order)||null;
  const allMatches=existing.filter(old=>matchingExistingImportItems(value,[old]).length);
  const matches=allMatches.map(old=>({
   id:old.id,title:old.title,date:old.localDate||old.local_date||'',
   updated_at:old.updated_at,
   protected:protectedExisting(old)
  }));
  let action=item.included===false?'skip':decision?.action||'review';
  let target=null;
  if(item.included===false&&decision?.action!=='skip'&&decision)
   raise('No es pot modificar una activitat exclosa de la proposta.');
  if(action==='add'&&matches.length)
   raise('Hi ha una possible coincidència: revisa-la abans d’afegir una visita duplicada.');
  if(action==='update'||action==='keep'){
   target=originals.get(decision.target_id);
   if(!target)raise('L’activitat que es vol actualitzar ja no es troba al viatge.');
   if(action==='update'&&protectedExisting(target))raise('Aquesta activitat té progrés, fotos o vincles que cal preservar.');
   if(targets.has(target.id))raise('Dues activitats del PDF no poden substituir la mateixa visita.');
   targets.add(target.id);
  }
  if(action==='add'&&(!norm(value.title)||!norm(value.local_date)))
   raise('Cal confirmar el nom i la data de les visites noves.');
  if(action!=='review'&&action!=='skip'&&action!=='keep'&&
   (item.review_flags||[]).some(flag=>[
    'invalid_title','invalid_date','invalid_start_time','invalid_end_time',
    'invalid_time_zone','timezone_needs_confirmation','date_required_for_time',
    'time_order_needs_review','possible_duplicate_in_review'].includes(flag)))
   raise('Cal corregir els errors del PDF abans de modificar el planning.');
  rows.push({
   source_order:item.source_order,title:value.title,date:value.local_date||'',
   action,values:{...value},matches,target_id:target?.id||null,
   expected_target_updated_at:target?.updated_at||null
  });
  if(action==='review')conflicts.push({source_order:item.source_order,
   reason:matches.length?'possible_existing_match':'decision_required'});
 }
 const retirement=new Set();
 for(const id of retireExistingIds){
  if(!UUID.test(id)||retirement.has(id)||!originals.has(id))
   raise('La llista d’activitats a retirar és invàlida o està desactualitzada.');
  const old=originals.get(id);
  if(protectedExisting(old))raise('Una activitat amb fotos, progrés o vincles no es pot retirar automàticament.');
  if(targets.has(id))raise('Una visita no es pot actualitzar i retirar a la vegada.');
  retirement.add(id);
 }
 const retire=[...retirement].map(id=>({id,expected_updated_at:originals.get(id).updated_at,
  title:originals.get(id).title}));
 const changed=rows.filter(row=>row.action==='add'||row.action==='update');
 const touched=new Set([...retirement,...rows.filter(r=>r.action==='update').map(r=>r.target_id)]);
 return {
  schema_version:1,read_only:true,requires_user_confirmation:true,
  complete:conflicts.length===0,
  summary:{new:rows.filter(row=>row.action==='add').length,
   updated:rows.filter(row=>row.action==='update').length,
   skipped:rows.filter(row=>row.action==='skip').length,
   pending:conflicts.length,retired:retire.length,
   preserved:existing.length-touched.size},
  rows,retire,conflicts,
  expected_existing:existing.map(row=>({
   id:row.id,updated_at:row.updated_at,identity:fingerprint(row)
  })),
  can_commit:conflicts.length===0&&changed.length+retire.length>0
 };
}

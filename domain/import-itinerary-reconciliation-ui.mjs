import {planItineraryReconciliation} from './import-itinerary-reconciliation.mjs';
import {prepareItineraryImportRows} from './import-itinerary-write.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Wording from the imported PDF: a proposed hour is not a confirmed booking.
// Approximate itinerary times remain visible without an exact-time reminder.
export function classifyReconciliationTiming(values={}){
 const wording=String(values.title||'')+' '+String(values.notes||'');
 const text=wording.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
 const conditional=/\b(?:opcionals?|optionals?|a confirmar|per confirmar|pendent de (?:reserva|confirmacio)|sense reserva|segons (?:la )?(?:reserva|disponibilitat|operador)|si (?:no )?hi ha neu|si s'ha tornat|en funcio de la neu|condicionat? a la neu)\b/;
 const tentative=/\b(?:orientatiu|orientativa|orientatius|orientatives|aproximat|aproximada|aproximadament|aprox|hora a confirmar|horari a confirmar|hora pendent|subjecte a confirmacio)\b/;
 const optional=conditional.test(text);
 return {is_optional:optional,is_tentative:optional||tentative.test(text)};
}
export function reconciliationPlan(snapshot,state){return planItineraryReconciliation({snapshot,existing:state.existing,decisions:state.decisions,retireExistingIds:state.retire})}
export function reconciliationHtml(snapshot,state,disabled=false){
 let plan,error;try{plan=reconciliationPlan(snapshot,state)}catch(e){error=e.message}
 const summary=plan?.summary;
 const choices=[['review','Tria què vols fer'],['keep','Conserva existent'],['update','Actualitza la visita existent'],['add','Afegeix visita nova'],['skip','Ignora']];
 const label=old=>`${old.localDate||'Dia pendent'} · ${old.timeLabel||'Sense hora'} — ${old.title}`;
 return `<h3>Compara les dues versions</h3><p>Només es canviaran els plans que confirmis. Les visites retirades quedaran cancel·lades i conservades; els vols, hotels, reserves i documents no es modifiquen.</p><p role="status" data-reconcile-summary>${summary?`${summary.new} noves · ${summary.updated} actualitzacions · ${summary.retired} retirades · ${summary.preserved} existents conservades · ${summary.pending} decisions pendents`:esc(error)}</p>${error?'<p role="alert">Revisa les decisions abans de desar.</p>':''}`+
 snapshot.items.map(item=>{
 const d=state.decisions.find(d=>d.source_order===item.source_order),action=item.included===false?'skip':d?.action||'review';
 const matches=plan?.rows.find(r=>r.source_order===item.source_order)?.matches||[];
 return `<details data-reconcile-row="${item.source_order}"><summary>${esc(item.values.local_date)} — ${esc(item.values.title)} · ${esc(choices.find(x=>x[0]===action)?.[1])}</summary><p>${esc(item.values.start_local_time||'Sense hora')} · ${esc(item.values.time_zone||'Fus pendent')} · ${esc(item.values.location_name||'Lloc pendent')}</p>${classifyReconciliationTiming(item.values).is_tentative&&item.values.start_local_time?'<p role="note">⏳ Hora orientativa o pendent de confirmació: es conservarà com a aproximada, sense avís d’hora exacta. Quan la reserva estigui confirmada, podràs fixar-ne l’hora al planning.</p>':''}${matches.map(m=>`<p>Possible coincidència: ${esc(label(state.existing.find(x=>x.id===m.id)))}</p>`).join('')}<label>Decisió<select data-reconcile-action="${item.source_order}" ${disabled||item.included===false?'disabled':''}>${choices.map(([v,l])=>`<option value="${v}" ${action===v?'selected':''}>${l}</option>`).join('')}</select></label>${['keep','update'].includes(action)?`<label>Visita existent<select data-reconcile-target="${item.source_order}" ${disabled?'disabled':''}><option value="">Selecciona la visita</option>${state.existing.map(old=>`<option value="${old.id}" ${d?.target_id===old.id?'selected':''}>${esc(label(old))}${old.status!=='planned'||old.is_fixed||old.photo_count||old.link_count?' · Protegida':''}</option>`).join('')}</select></label>`:''}<p>Per corregir camps, obre la candidata a la proposta del PDF de sota.</p></details>`;
 }).join('')+`<details><summary>Visites existents que es conservaran o retiraran</summary>${state.existing.map(old=>`<label>${esc(label(old))}<select data-reconcile-retire="${old.id}" ${disabled||old.status!=='planned'||old.is_fixed||old.photo_count||old.link_count?'disabled':''}><option value="keep">Conserva</option><option value="retire" ${state.retire.includes(old.id)?'selected':''}>Retira (cancel·la, sense esborrar)</option></select></label>`).join('')}</details>`;
}
export async function prepareReconciliationRequest(snapshot,state,context){
 const plan=reconciliationPlan(snapshot,state);
 if(!plan.can_commit)throw Error('Resol totes les decisions abans de desar.');
 const changed=plan.rows.filter(r=>['add','update'].includes(r.action));
 const rows=changed.length?await prepareItineraryImportRows({...snapshot,items:snapshot.items.filter(i=>changed.some(r=>r.source_order===i.source_order))},{...context,existing:[]}):[];
 const changes=changed.map((choice,i)=>{
  const {id,trip_id,created_by,status,is_fixed,...fields}=rows[i];
  const classification=classifyReconciliationTiming(choice.values);
  fields.is_optional=classification.is_optional;
  if(classification.is_tentative&&fields.timing_kind==='exact'){
   // Keep the proposed local time without scheduling an exact-time notification.
   fields.timing_kind='approximate';
   fields.local_date=choice.values.local_date;
   fields.approximate_start_time=choice.values.start_local_time;
   fields.approximate_end_time=choice.values.end_local_time||null;
   fields.starts_at=null;
   fields.ends_at=null;
  }
  return {action:choice.action,id:choice.action==='update'?choice.target_id:id,fields};
 });
 changes.push(...plan.retire.map(r=>({action:'retire',id:r.id})));
 return {p_trip_id:context.tripId,p_document_id:context.documentId,p_operation_id:crypto.randomUUID(),p_expected_existing:plan.expected_existing,p_changes:changes};
}
export function reconciliationError(error){return ({RIG_STORAGE:'No s’ha enviat cap canvi: el navegador no permet conservar el comprovant de recuperació. Revisa l’espai o els permisos d’emmagatzematge.',RIG_STALE:'El planning ha canviat. Torna a carregar la comparació i revisa les decisions.',RIG_PROTECTED:'Una visita té fotos, vincles, progrés o un horari fix. No s’ha modificat res.',RIG_FORBIDDEN:'No tens accés a aquest viatge.',RIG_DOCUMENT_UNAVAILABLE:'El document original ja no és accessible.',RIG_DATE:'Revisa les dates respecte del viatge.',RIG_ZONE:'Revisa la zona horària.',RIG_TARGET_EXISTS:'Una visita ja consta al viatge. Recarrega i revisa la comparació.'})[error?.message]||'No s’ha confirmat el desament. Pots reintentar la mateixa operació sense duplicar-la.'}

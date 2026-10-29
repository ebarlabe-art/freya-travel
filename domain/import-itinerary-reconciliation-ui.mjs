import {planItineraryReconciliation} from './import-itinerary-reconciliation.mjs';
import {prepareItineraryImportRows} from './import-itinerary-write.mjs';
import {matchingExistingImportItems} from './import-itinerary-review.mjs';
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

const matchesFor=(item,existing)=>existing.filter(row=>matchingExistingImportItems(item.values,[row]).length>0);
const safeForBulk=item=>item.included!==false&&
 !!item.values.title?.trim()&&!!item.values.local_date&&
 !['invalid_title','invalid_date','invalid_start_time','invalid_end_time','invalid_time_zone','timezone_needs_confirmation','date_required_for_time','time_order_needs_review','possible_duplicate_in_review','possible_overlap_in_review'].some(flag=>(item.review_flags||[]).includes(flag));
/** Explicit, local-only shortcut: it suggests ADD only when no existing visit matches.
 * It never commits or automatically retires existing itinerary entries. */
export function proposeUnmatchedReconciliationDecisions(snapshot,state){
 const used=new Set((state.decisions||[]).map(d=>d.source_order));
 return snapshot.items.filter(item=>!used.has(item.source_order)&&safeForBulk(item)&&
  matchesFor(item,state.existing).length===0).map(item=>({source_order:item.source_order,action:'add'}));
}
export function suggestedReconciliationTarget(item,existing,action){
 if(action!=='update'&&action!=='keep')return null;
 const matches=matchesFor(item,existing);
 if(matches.length!==1)return null;
 const row=matches[0];
 if(action==='update'&&(row.status!=='planned'||row.is_fixed||row.photo_count||row.link_count))return null;
 return row.id;
}
export function reconciliationHtml(snapshot,state,disabled=false){
 let plan,error;
 try{plan=reconciliationPlan(snapshot,state)}catch(e){error=e.message}
 const summary=plan?.summary;
 const choices=[['review','Tria una opció'],['keep','Conserva la visita que ja tenia'],['update','Actualitza la visita existent'],['add','Afegeix al viatge'],['skip','No incorporis la proposta']];
 const oldName=old=>(old.localDate||'Dia pendent')+' · '+(old.timeLabel||'Sense hora')+' — '+old.title;
 const eligible=proposeUnmatchedReconciliationDecisions(snapshot,state);
 const rowDecision=item=>(state.decisions||[]).find(x=>x.source_order===item.source_order);
 const existingMatches=item=>matchesFor(item,state.existing);
 const matched=snapshot.items.filter(item=>existingMatches(item).length>0);
 const unmatched=snapshot.items.filter(item=>existingMatches(item).length===0);
 const pending=summary?.pending??snapshot.items.filter(item=>item.included!==false&&!rowDecision(item)).length;
 let html='<div class="itinerary-reconcile-intro"><h3>Decideix què canvia al viatge</h3>'+
  '<p class="itinerary-reconcile-progress" role="status" data-reconcile-summary>'+
  (summary?summary.new+' noves · '+summary.updated+' actualitzacions · '+summary.retired+' retirades · '+summary.preserved+' existents conservades · '+summary.pending+' decisions pendents':esc(error||'Revisa les decisions'))+'</p>'+
  '<p><strong>'+pending+' decisions per prendre.</strong> Primer revisa les coincidències. Després marca les visites noves. Res no canviarà fins a la confirmació final.</p>'+
  '<p class="muted">Els vols, hotels, reserves i documents no es modificaran. Les visites retirades es conservaran com a cancel·lades.</p>'+
  '</div>';
 if(error)html+='<p role="alert" class="itinerary-import-warning">'+esc(error)+'. Revisa les decisions abans de desar.</p>';
 if(eligible.length)html+='<div class="itinerary-reconcile-quick"><p><strong>'+eligible.length+' visites sense coincidència aparent.</strong> Pots marcar-les com a noves d’un sol cop i revisar-les després.</p>'+
  '<button type="button" id="itineraryReconcileSuggestNew" '+(disabled?'disabled':'')+'>Marca '+eligible.length+' com a noves (sense desar)</button></div>';
 const renderRow=item=>{
  const decision=rowDecision(item);
  const action=item.included===false?'skip':decision?.action||'review';
  const found=existingMatches(item);
  const risky=found.length>0;
  const tag=action==='review'?(risky?'⚠ Possible coincidència':'Pendent de decidir'):
   action==='add'?'✓ Afegir':action==='update'?'✓ Actualitzar':action==='keep'?'✓ Conservar existent':'— Ignorar';
  const date=esc(item.values.local_date||'Dia pendent'),hour=esc(item.values.start_local_time||'Sense hora'),title=esc(item.values.title||'Sense títol');
  let itemHtml='<details class="itinerary-reconcile-card" data-reconcile-row="'+item.source_order+'"><summary>'+
    '<span class="itinerary-reconcile-date">'+date+' · '+hour+'</span><span class="itinerary-reconcile-title">'+title+'</span>'+
    '<span class="itinerary-reconcile-decision">'+esc(tag)+'</span></summary><div class="itinerary-reconcile-body">';
  if(risky){
   itemHtml+='<div class="itinerary-reconcile-existing"><strong>Ja tens programada una visita semblant:</strong>';
   itemHtml+=found.map(old=>'<p>'+esc(oldName(old))+(old.status!=='planned'||old.is_fixed||old.photo_count||old.link_count?' · Protegida':'')+'</p>').join('');
   itemHtml+='</div><p><strong>Què vols fer?</strong> Si és la mateixa visita amb un dia nou, tria «Actualitza la visita existent». Així no la duplicarem.</p>';
  }else itemHtml+='<p>Freya no ha trobat una visita coincident. Pots afegir-la, ignorar-la o vincular-la manualment amb una que ja hi sigui.</p>';
  itemHtml+='<p><strong>Proposta del PDF:</strong> '+date+' · '+hour+' · '+esc(item.values.location_name||'Lloc pendent')+'</p>';
  if(classifyReconciliationTiming(item.values).is_tentative&&item.values.start_local_time)
   itemHtml+='<p role="note" class="itinerary-reconcile-note">⏳ Hora orientativa o pendent de confirmació: es conservarà com a aproximada, sense avís d’hora exacta.</p>';
  itemHtml+='<label>Decisió<select data-reconcile-action="'+item.source_order+'" '+(disabled||item.included===false?'disabled':'')+'>'+
    choices.map(([value,label])=>'<option value="'+value+'" '+(action===value?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>';
  if(action==='update'||action==='keep'){
   const priority=new Set(found.map(x=>x.id));
   const options=[...found,...state.existing.filter(x=>!priority.has(x.id))];
   itemHtml+='<label>Quina visita que ja tens?<select data-reconcile-target="'+item.source_order+'" '+(disabled?'disabled':'')+'><option value="">Tria una visita</option>'+
    options.map(old=>'<option value="'+esc(old.id)+'" '+(decision?.target_id===old.id?'selected':'')+'>'+
     esc(oldName(old))+(old.status!=='planned'||old.is_fixed||old.photo_count||old.link_count?' · Protegida':'')+'</option>').join('')+'</select></label>';
  }
  itemHtml+='<p class="muted">Si cal corregir una data, un lloc o el text, desplega «Editar les dades del PDF» al final de la comparació.</p></div></details>';
  return itemHtml;
 };
 if(matched.length)html+='<h4 class="itinerary-reconcile-section">1 · Possibles coincidències ('+matched.length+')</h4>'+
  '<p class="muted">Compara el que ja tens amb la proposta nova; no cal afegir dues vegades la mateixa visita.</p>'+matched.map(renderRow).join('');
 html+='<h4 class="itinerary-reconcile-section">'+(matched.length?'2':'1')+' · Propostes sense coincidència ('+unmatched.length+')</h4>'+
  '<p class="muted">Aquestes propostes són noves segons la comparació. Revisa si t’interessen abans d’incorporar-les.</p>'+unmatched.map(renderRow).join('');
 const updatedIds=new Set((state.decisions||[]).filter(d=>d.action==='update'||d.action==='keep').map(d=>d.target_id));
 html+='<details class="itinerary-reconcile-old"><summary>Visites que ja tenies: conserva-les o retira-les ('+state.existing.length+')</summary>'+
  '<p>Per defecte es conserven totes. Només retira una visita antiga si ja no forma part del nou itinerari. Retirar significa cancel·lar, no esborrar.</p>'+
  state.existing.map(old=>{
    const protectedRow=old.status!=='planned'||old.is_fixed||old.photo_count||old.link_count;
    const linked=updatedIds.has(old.id);
    return '<label class="itinerary-reconcile-old-row">'+esc(oldName(old))+
      '<select data-reconcile-retire="'+esc(old.id)+'" '+(disabled||protectedRow||linked?'disabled':'')+'><option value="keep">Conserva</option>'+
      '<option value="retire" '+(state.retire.includes(old.id)?'selected':'')+'>Retira (cancel·la)</option></select>'+
      (linked?'<span class="muted">Ja vinculada a una proposta del PDF.</span>':protectedRow?'<span class="muted">Protegida: no es pot retirar aquí.</span>':'')+'</label>';
  }).join('')+'</details>';
 return html;
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

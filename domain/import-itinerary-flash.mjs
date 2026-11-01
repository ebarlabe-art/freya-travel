// Presentation/decision adapter for RIG-03B/RIG-04. No IO or second planning engine.
import {matchingExistingImportItems} from './import-itinerary-review.mjs';
import {analyzePlanning} from './import-itinerary-planning-ui.mjs';
import {proposeUnmatchedReconciliationDecisions} from './import-itinerary-reconciliation-ui.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const protectedRow=r=>r.reservation||r.is_fixed||r.status!=='planned'||r.photo_count>0||r.link_count>0;
export const flashDay=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?new Intl.DateTimeFormat('ca',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(d+'T12:00Z')):'Dia pendent';
const time=(instant,zone)=>{try{return new Intl.DateTimeFormat('ca',{hour:'2-digit',minute:'2-digit',timeZone:zone||'UTC',hourCycle:'h23'}).format(new Date(instant))}catch{return ''}};
export function flashMatches(item,state,context){
 const manual=state.existing.filter(row=>matchingExistingImportItems(item.values,[row]).length);
 const reservations=(context.projection||[]).filter(row=>row.sourceType!=='manual'&&row.status!=='cancelled'&&!row.isCancelled).filter(row=>
  matchingExistingImportItems(item.values,[row]).length||(['flight','accommodation'].includes(item.classification_hint)&&row.sourceType===item.classification_hint&&row.localDate===item.values.local_date));
 return [...manual,...reservations.map(row=>({...row,id:row.key,reservation:true,localDate:row.localDate,timeLabel:time(row.startsAt,row.timeZone),title:row.title}))];
}
export function prepareFlashDecisions(snapshot,state,context){
 // Low extraction confidence is an uncertainty, not a mandatory per-row choice.
 // Required field validation and duplicate guards are still the existing writer's.
 const draft={...snapshot,items:snapshot.items.filter(i=>!flashMatches(i,state,context).length).map(i=>({...i,review_flags:i.review_flags.filter(f=>f!=='possible_overlap_in_review')}))};
 return proposeUnmatchedReconciliationDecisions(draft,state);
}
export function flashQueue(snapshot,state,context,flash){
 return snapshot.items.filter(i=>i.included!==false&&!state.decisions.some(d=>d.source_order===i.source_order)&&!flash.deferred.includes(i.source_order)&&flashMatches(i,state,context).length);
}
export function decideFlash(snapshot,state,context,flash,order,action,targetId){
 const item=snapshot.items.find(i=>i.source_order===order);if(!item||item.included===false)throw Error('La proposta ha canviat.');
 const matches=flashMatches(item,state,context),target=matches.find(r=>r.id===targetId);
 if(!['keep','update','later'].includes(action)||(!target&&action!=='later'))throw Error('Tria primer quina visita coincideix.');
 if(action==='update'&&protectedRow(target))throw Error('Aquesta reserva o visita està protegida.');
 const previous=state.decisions.filter(d=>d.source_order===order),deferred=[...flash.deferred];
 let decisions=state.decisions.filter(d=>d.source_order!==order);
 if(action!=='later')decisions.push({source_order:order,action:target.reservation?'skip':action,...(target.reservation?{}:{target_id:target.id})});
 // Validate the tentative decision using the real reconciliation/planning engine.
 analyzePlanning(snapshot,{...state,decisions},context);
 flash.history.push({order,previous,deferred});flash.deferred=flash.deferred.filter(n=>n!==order);
 if(action==='later')flash.deferred.push(order);
 state.decisions=decisions;
}
export function reopenFlashMatches(snapshot,state,context,flash){
 // Revisit an existing draft, without touching protected rows or persisted data.
 const orders=new Set(snapshot.items.filter(i=>i.included!==false&&flashMatches(i,state,context).length).map(i=>i.source_order));
 const toReview=state.decisions.filter(d=>orders.has(d.source_order)&&!d.automatic);
 if(!toReview.length)return 0;
 state.decisions=state.decisions.filter(d=>!orders.has(d.source_order)||d.automatic);
 flash.deferred=[];flash.history=[];flash.targets={};
 return toReview.length;
}
export function undoFlash(state,flash){const last=flash.history.pop();if(!last)return;state.decisions=[...state.decisions.filter(d=>d.source_order!==last.order),...last.previous];flash.deferred=last.deferred;}
export function flashRecommendation(snapshot,state,context,item,target,previous={}){
 const unknown={choice:null,text:'No tinc prou informació per recomanar una data'};
 if(!target)return unknown;
 if(protectedRow(target))return {choice:'keep',text:'Conserva el compromís existent: està protegit i no es pot moure des d’aquesta importació.'};
 if(context.sourcesReady===false)return unknown;
 try{
  const variants=['keep','update'].map(action=>analyzePlanning(snapshot,{...state,decisions:[...state.decisions.filter(d=>d.source_order!==item.source_order),{source_order:item.source_order,action,target_id:target.id}]},context,previous));
  const problems=variants.map(a=>a.assessment.issues.filter(i=>i.kind==='conflict'||i.kind==='tight'));
  // Compare the whole planning, not only the candidate. Never trade one new
  // conflict for another; route/opening evidence is validated by RIG-04.
  const signature=i=>i.code+'|'+i.message;
  for(let good=0;good<2;good++){
   const bad=1-good,known=new Set(problems[bad].map(signature));
   if(problems[good].length<problems[bad].length&&problems[good].every(i=>known.has(signature(i)))){
    const removed=problems[bad].find(i=>!problems[good].some(j=>signature(j)===signature(i)));
    const action=good===0?'Conservar':'Canviar';
    const other=removed.code==='overlap'?variants[bad].combined.items.find(x=>removed.keys.includes(x.key)&&x.key!=='pdf:'+item.source_order&&x.key!=='manual:'+target.id):null;
    const reason=removed.code==='overlap'?'un solapament horari'+(other?' amb «'+other.title+'»':' amb una altra visita'):removed.code==='travel'?'un trajecte sense prou temps':removed.code==='closed'?'una visita fora de l’horari d’obertura verificat':'un conflicte detectat al planning';
    return {choice:good===0?'keep':'update',text:action+' evita '+reason+'.'};
   }
  }
 }catch{}
 return unknown;
}
const contextHtml=(items,day,exclude)=>items.filter(x=>x.localDate===day&&x.key!==exclude).sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt))).map(x=>'<li>'+esc(time(x.startsAt,x.timeZone)||'Hora pendent')+' · '+esc(x.title)+(x.sourceType!=='manual'||x.fixed?' · Reserva/protegida':'')+'</li>').join('');
export function flashHtml(snapshot,state,context,flash,analysis,{busy=false}={}){
 const queue=flashQueue(snapshot,state,context,flash),item=queue[0];if(!item)return '';
 const matches=flashMatches(item,state,context),target=matches.length===1?matches[0]:matches.find(r=>r.id===flash.targets[item.source_order]);
 const rec=flashRecommendation(snapshot,state,context,item,target,analysis);
 const oldDay=target?.localDate||target?.local_date||'',newDay=item.values.local_date;
 const total=snapshot.items.filter(i=>i.included!==false&&flashMatches(i,state,context).length&&!state.decisions.some(d=>d.source_order===i.source_order&&d.automatic)).length;
 const column=(label,day,hour,key)=>'<section class="flash-option"><small>'+label+'</small><strong>'+esc(flashDay(day))+'</strong><b>'+esc(hour||'Hora pendent')+'</b><details><summary>Altres compromisos</summary><ul>'+contextHtml(analysis.combined.items,day,key)+'</ul></details></section>';
 return '<article class="import-flash" tabindex="-1" aria-labelledby="importFlashTitle" data-flash-order="'+item.source_order+'"><p class="flash-progress">Coincidència '+(total-queue.length+1)+' de '+total+'</p><h3 id="importFlashTitle">'+esc(item.values.title)+'</h3><p>Una visita, dues alternatives. Només canviarem l’esborrany.</p>'+
 (matches.length>1?'<label>Quina visita coincideix?<select data-flash-target="'+item.source_order+'"><option value="">Selecciona la visita existent</option>'+matches.map(r=>'<option value="'+esc(r.id)+'" '+(target?.id===r.id?'selected':'')+'>'+esc(flashDay(r.localDate)+' · '+r.title)+'</option>').join('')+'</select></label>':'')+
 '<div class="flash-options">'+column('Al teu viatge',oldDay,target?.timeLabel,target?.reservation?target.id:'manual:'+target?.id)+column('Al PDF',newDay,item.values.start_local_time,'pdf:'+item.source_order)+'</div><p class="flash-advice"><strong>Freya et proposa</strong><br>'+esc(rec.text)+'</p><div class="flash-actions">'+
 ['keep','update'].map(action=>'<button type="button" data-flash-action="'+action+'" data-flash-target-id="'+esc(target?.id||'')+'" class="'+(rec.choice===action?'flash-recommended':'secondary')+'" '+(busy||!target||(action==='update'&&protectedRow(target))?'disabled':'')+'>'+(action==='keep'?'Conservar ':'Canviar a ')+esc(flashDay(action==='keep'?oldDay:newDay))+'</button>').join('')+'</div><div class="flash-footer"><button type="button" class="secondary" data-flash-action="later" '+(busy?'disabled':'')+'>Decidir més tard</button><button type="button" class="secondary" data-flash-undo '+(busy||!flash.history.length?'disabled':'')+'>Desfer</button></div></article>';
}
export function flashPlanningHtml(analysis,snapshot,state,context,flash,{busy=false}={}){
 const conflicts=analysis.assessment.issues.filter(i=>i.kind==='conflict'||i.kind==='tight');
 const bad=new Set(conflicts.flatMap(i=>i.keys)),verified=new Set(conflicts.filter(i=>i.kind==='conflict').flatMap(i=>i.keys));
 const row=x=>'<li class="flash-plan-row"><time>'+esc(time(x.startsAt,x.timeZone)||'Sense hora')+'</time><div><strong>'+esc(x.title)+'</strong>'+(verified.has(x.key)?'<strong class="itinerary-conflict-badge">⚠ Conflicte horari</strong>':'')+'<small>'+esc(x.key.startsWith('pdf:')?(state.decisions.find(d=>d.source_order===x.sourceOrder)?.action==='update'?'Canvia':'S’incorporarà'):'Es conserva')+'</small></div></li>';
 const days=items=>{const sorted=[...items].sort((a,b)=>String(a.localDate).localeCompare(String(b.localDate))||String(a.startsAt).localeCompare(String(b.startsAt)));let out='',day=null;for(const x of sorted){if(day!==x.localDate){if(day!==null)out+='</ul>';day=x.localDate;out+='<h4>'+esc(flashDay(day))+'</h4><ul class="flash-plan-list">'}out+=row(x)}return out+(day!==null?'</ul>':'');};
 const deferred=snapshot.items.filter(i=>flash.deferred.includes(i.source_order)&&!state.decisions.some(d=>d.source_order===i.source_order));
 const revisitable=snapshot.items.some(i=>i.included!==false&&flashMatches(i,state,context).length&&state.decisions.some(d=>d.source_order===i.source_order&&!d.automatic));
 return '<div class="flash-overview"><section data-flash-valid><h3>Itinerari vàlid, sense conflictes</h3><p class="muted">Sense conflictes detectats amb les dades disponibles. La manca de dades no garanteix la viabilitat.</p>'+days(analysis.combined.items.filter(x=>!bad.has(x.key)))+'</section><section data-flash-conflicts><h3>Conflictes per resoldre</h3>'+(!conflicts.length&&!deferred.length?'<p>No s’han detectat incompatibilitats.</p>':'')+days(analysis.combined.items.filter(x=>bad.has(x.key)))+'<ul>'+conflicts.map(i=>'<li>'+esc(i.message)+'</li>').join('')+'</ul>'+deferred.map(i=>'<p>'+esc(i.values.title)+' · Decisió posposada <button type="button" data-flash-resume="'+i.source_order+'">Revisar coincidència</button></p>').join('')+analysis.solutions.map(p=>'<article class="flash-solution"><p>'+esc(p.label)+'</p><button type="button" data-planning-accept="'+p.id+'" '+(busy?'disabled':'')+'>Acceptar el canvi proposat</button></article>').join('')+'</section></div>'+(revisitable?'<button type="button" class="secondary" data-flash-revisit '+(busy?'disabled':'')+'>Tornar a revisar les coincidències del PDF</button>':'')+'<button type="button" class="secondary" data-flash-undo '+(busy||!flash.history.length?'disabled':'')+'>Desfer l’última decisió</button>';
}

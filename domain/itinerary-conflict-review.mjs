// Presentation and acknowledgement only; RIG-04 remains the single conflict engine.
import {assessCombinedItinerary} from './import-itinerary-planning.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function importantConflicts(analysis){
 return (analysis?.assessment.issues||[]).filter(i=>i.kind==='conflict').map(issue=>{
  const items=analysis.combined.items.filter(x=>issue.keys.includes(x.key));
  const fingerprint=JSON.stringify([issue,items.map(x=>[x.key,x.title,x.startsAt,x.endsAt,x.timeZone,x.timingKind,x.sourceUpdatedAt]),issue.code==='travel'?analysis.routes:issue.code==='closed'?analysis.openings:null]);
  return {...issue,items,fingerprint};
 });
}
export const unreviewedConflicts=(analysis,reviewed=[])=>importantConflicts(analysis).filter(c=>!reviewed.includes(c.fingerprint));
const time=x=>{try{return new Intl.DateTimeFormat('ca',{timeZone:x.timeZone||'UTC',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(x.startsAt))+(x.endsAt?' – '+new Intl.DateTimeFormat('ca',{timeZone:x.timeZone||'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(x.endsAt)):' · final pendent')}catch{return 'Hora pendent'}};
export function conflictFlashHtml(analysis,reviewed=[],{busy=false,selected=null}={}){
 const all=importantConflicts(analysis),conflict=all.find(c=>c.fingerprint===selected)||unreviewedConflicts(analysis,reviewed)[0];if(!conflict)return '';
 const index=all.findIndex(c=>c.fingerprint===conflict.fingerprint),proposal=analysis.solutions?.find(p=>conflict.items.some(x=>x.mutable&&x.sourceOrder===p.sourceOrder));
 return '<article class="import-flash conflict-flash" tabindex="-1" data-conflict-index="'+index+'"><p class="flash-progress">Conflicte '+(index+1)+' de '+all.length+'</p><h3>⚠ Cal revisar aquest horari</h3><div class="flash-options">'+conflict.items.map(x=>'<section class="flash-option"><strong>'+esc(x.title)+'</strong><span>'+esc(time(x))+'</span></section>').join('')+'</div><p>'+esc(conflict.message)+'</p><div class="flash-advice"><strong>Freya et proposa</strong><p>'+esc(proposal?proposal.label:'Revisa els horaris abans del viatge. No hi ha cap canvi segur proposable sense moure un compromís protegit o completar les dades.')+'</p>'+(proposal?'<small>'+esc(proposal.note)+'</small><button type="button" data-planning-accept="'+proposal.id+'" '+(busy?'disabled':'')+'>Acceptar el canvi proposat</button>':'')+'</div><button type="button" class="secondary" data-conflict-ack="'+index+'" '+(busy?'disabled':'')+'>Ho he revisat; mantinc el conflicte</button><p class="muted">No es desa res aquí. El conflicte continuarà destacat fins que es resolgui.</p></article>';
}
export function conflictSummaryHtml(analysis,reviewed=[]){
 const all=importantConflicts(analysis);if(!all.length)return '';
 return '<section class="itinerary-conflict-summary" role="status"><strong>⚠ '+all.length+' conflicte'+(all.length===1?' horari':'s horaris')+' per resoldre</strong><ul>'+all.map((c,i)=>'<li>'+esc(c.message)+' <button type="button" class="secondary" data-conflict-open="'+i+'">'+(reviewed.includes(c.fingerprint)?'Revisat, no resolt · Tornar a veure':'Revisar conflicte')+'</button></li>').join('')+'</ul></section>';
}
export function agendaConflictAnalysis(items){
 const combined={complete:true,items:items.filter(x=>!x.isCancelled&&!x.isCompleted&&!['cancelled','completed'].includes(x.status))};
 return {combined,assessment:assessCombinedItinerary(combined),solutions:[]};
}
export function markConflictCards(root,analysis){
 root.querySelectorAll('[data-conflict-badge]').forEach(n=>n.remove());
 const keys=new Set(importantConflicts(analysis).flatMap(c=>c.keys));
 for(const card of root.querySelectorAll('[data-itinerary-key]'))if(keys.has(card.dataset.itineraryKey)){
  const badge=document.createElement('strong');badge.dataset.conflictBadge='';badge.className='itinerary-conflict-badge';badge.textContent='⚠ Conflicte horari · Revisa el resum del planning';(card.querySelector('.generic-itinerary-card')||card).prepend(badge);
 }
}

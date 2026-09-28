import {contextualRefinements,validateRefinement} from './proposal-refinement.mjs';
import {decisionLabel} from './live-trip-brief.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function effectiveEvaluations(document,now=Date.now()){
 const expired=document.verification.some(v=>v.certainty==='confirmed'&&!v.evidence.some(e=>Date.parse(e.valid_until)>now));
 return document.evaluations.map(e=>expired&&e.reason==='verified_decision'?{...e,state:'unresolved'}:e);
}
const fieldLabel=field=>({'destination.multidestination':'Multidestinació',duration:'Durada',dates:'Dates',budget:'Pressupost',origin:'Origen',destination:'Destinació','interest.snow':'Neu','interest.christmas_markets':'Mercats de Nadal'})[field]||(field.startsWith('interest.')?'Interès del viatge':field.startsWith('hotel.')?'Preferència d’allotjament':field.startsWith('flight.')?'Preferència de vol':field==='notes'?'La teva idea':'Preferència del resum del viatge');
export function renderProposalResult(result,selected=null){
 const generation=result?.generation;
 if(!generation)return '<p>Encara no has explorat alternatives per a aquest resum del viatge.</p>';
 const stale=result.stale||generation.status==='obsolete';
 const banner=(result.historical?`<p role="status">Cerca anterior · ronda ${esc(generation.round_number??'anterior')}</p>`:'<p>Alternatives actuals</p>')+(stale?'<p role="status">El resum del viatge ha canviat. Aquestes alternatives corresponen a una revisió anterior.</p>':'');
 if(['pending','running'].includes(generation.status))return banner+'<p role="status">Preparant alternatives… Pots tornar-hi més tard.</p>';
 if(generation.status==='failed')return banner+'<p role="alert">'+(generation.error_code==='provider_timeout'?'La generació ha trigat massa. Pots tornar-ho a provar.':generation.error_code==='invalid_candidate'?'No he pogut validar les alternatives rebudes. Pots tornar-ho a provar.':'No s’han pogut generar les alternatives per una fallada tècnica. Pots reintentar-ho.')+'</p>';
 if(generation.status==='no_results')return banner+`<p>${generation.result_reason==='no_new_alternatives'?'No he trobat alternatives noves que respectin el que m’has demanat.':generation.result_reason==='incompatible'?'Les alternatives suggerides contradiuen imprescindibles del resum del viatge.':'Falta informació o no s’han pogut proposar alternatives suficients.'}</p>`;
 const rows=result.proposals||[];
 const one=selected&&rows.find(p=>p.id===selected);
 function detail(p){
  const d=p.document,c=d.candidate,evaluations=effectiveEvaluations(d),hard=evaluations.filter(e=>e.strength==='hard');
  const evaluationList=state=>hard.filter(e=>e.state===state).map(e=>`<li>${esc(fieldLabel(e.field))}${e.scope==='global'?'':' · àmbit específic'}</li>`).join('')||'<li>Cap</li>';
  return `<article class="card"><h3>${esc(c.title)}</h3><p>${esc(c.summary)}</p><p><strong>Proposta de disseny · pendent de verificació factual · no és una reserva</strong></p>${hard.some(e=>e.state==='unresolved')?'<p>Pendent de validar imprescindibles</p>':''}<h4>Ruta i nits proposades</h4><ol>${c.route.stops.map(s=>`<li>${esc(s.destination)} · ${s.nights===null?'Nits per concretar':esc(s.nights)+' nits'}</li>`).join('')}</ol>${c.route.legs.map(l=>`<p>Trajecte proposat: ${esc(l.mode||'per concretar')} · ${l.transit_nights===null?'nits de trànsit per verificar':esc(l.transit_nights)+' nits de trànsit'}</p>`).join('')}<h4>Experiències suggerides</h4>${c.experience_blocks.map(b=>`<section><h4>${esc(b.title)}</h4><p>${esc(b.suggestion)}</p></section>`).join('')}<h4>Per què respon al resum del viatge · motius proposats</h4><ul>${c.reasons.map(r=>`<li>${esc(r.explanation)}</li>`).join('')||'<li>Pendent de concretar</li>'}</ul><h4>Concessions</h4><ul>${[...c.tradeoffs.map(t=>`<li>${esc(t.description)}</li>`),...evaluations.filter(e=>e.strength!=='hard'&&e.state==='violated').map(e=>`<li>${esc(fieldLabel(e.field))}: no es compleix en aquest disseny.</li>`)].join('')||'<li>No se n’han identificat; pendent de revisió.</li>'}</ul><h4>Imprescindibles satisfets</h4><ul>${evaluationList('satisfied')}</ul><h4>Imprescindibles pendents de verificar</h4><ul>${evaluationList('unresolved')}</ul>${c.claims.length?'<h4>Afirmacions que necessiten verificació</h4><ul>'+c.claims.map(cl=>`<li>${esc(cl.statement)} · ${esc(d.verification.find(v=>v.claim_id===cl.id)?.certainty==='confirmed'&&d.verification.find(v=>v.claim_id===cl.id)?.evidence.some(e=>Date.parse(e.valid_until)>Date.now())?'Amb evidència vigent':'Pendent de verificació')}</li>`).join('')+'</ul>':''}</article>`;
 }
 if(one)return banner+detail(one);
 return banner+rows.map(p=>{const c=p.document.candidate;return `<article class="card"><h3>${esc(c.title)}</h3><p>Suggeriment pendent de verificació factual</p><p>${c.route.stops.map(s=>esc(s.destination)).join(' → ')}</p>${effectiveEvaluations(p.document).some(e=>e.strength==='hard'&&e.state==='unresolved')?'<p>Pendent de validar imprescindibles</p>':''}<button data-proposal-id="${esc(p.id)}" type="button">Explora aquesta alternativa</button></article>`}).join('');
}
export class ProposalSession{
 constructor(client,owner,storage,isCurrent=()=>true){this.client=client;this.owner=owner;this.storage=storage;this.isCurrent=isCurrent;this.key='freya-proposals-v1:'+owner;this.pending=JSON.parse(storage.getItem(this.key)||'null');this.busy=false;}
 clearPending(){const stored=JSON.parse(this.storage.getItem(this.key)||'null');if(stored?.body.operation_id===this.pending?.body.operation_id)this.storage.removeItem(this.key);this.pending=null;}
 reconcile(result,acknowledged=false){
  const p=this.pending,g=result?.generation;if(!p||!g)return;
  const matches=p.body.action==='explore_more'?g.previous_generation_id===p.body.previous_generation_id&&g.brief_revision===p.body.revision:p.body.action==='retry'?g.id===p.body.generation_id:g.brief_revision===p.body.revision&&g.id!==p.baseline_id;
  const advanced=p.body.action!=='retry'||Number.isInteger(p.baseline_attempt)&&g.attempt_number>p.baseline_attempt;
  if(matches&&['failed','completed','no_results','obsolete'].includes(g.status)&&(acknowledged||advanced))this.clearPending();
 }
 async history(briefId,before=null){const {data,error}=await this.client.rpc('list_proposal_history_v1',{p_brief:briefId,p_before:before});if(error)throw error;if(!this.isCurrent())throw Error('La sessió ha canviat.');return data;}
 async adjacent(briefId,generationId){
  let before=null,newer=null,found=false,next=null;const cursors=new Set();
  do{const page=await this.history(briefId,before);for(const row of page.rounds){if(found)return {previous:row,next};if(row.id===generationId){found=true;next=newer;}newer=row;}before=page.next_before;if(before&&cursors.has(before))throw Error('Historial no disponible.');cursors.add(before);}while(before);
  return {previous:null,next};
 }
 async read(briefId,generationId=null){const {data,error}=await this.client.rpc('get_proposals_v1',{p_brief:briefId,...(generationId?{p_generation:generationId}:{})});if(error)throw error;if(!this.isCurrent())throw Error('La sessió ha canviat.');if(this.pending?.brief_id===briefId)this.reconcile(data);return data;}
 async generate(row,result,refinement){
  if(this.busy)return;
  if(!this.isCurrent()||row.owner_id!==this.owner)throw Error('La sessió ha canviat.');
  if(this.pending&&this.pending.brief_id!==row.id)throw Error('Verifica l’operació pendent de l’altre esborrany.');
  this.busy=true;
  try{
   // An uncertain action is read/replayed first, never replaced by another action.
   if(refinement!==undefined){validateRefinement(refinement);if(result?.historical)throw Error('Torna a la ronda actual abans de refinar.');}
   if(this.pending){result=await this.read(row.id,this.pending.body.generation_id??null);if(!this.pending)return result;}
   const stale=result?.stale||result?.generation?.status==='obsolete';
   const action=refinement!==undefined?'explore_more':!stale&&result?.generation?'retry':'generate';
   if(!this.pending){this.pending={brief_id:row.id,baseline_id:result?.generation?.id??null,baseline_attempt:result?.generation?.attempt_number??0,body:action==='explore_more'?{action,brief_id:row.id,revision:row.revision,previous_generation_id:result.generation.id,refinement:validateRefinement(refinement),operation_id:crypto.randomUUID()}:action==='generate'?{action,brief_id:row.id,revision:row.revision,operation_id:crypto.randomUUID()}:{action,generation_id:result.generation.id,operation_id:crypto.randomUUID()}};this.storage.setItem(this.key,JSON.stringify(this.pending));}
   const {data,error}=await this.client.functions.invoke('proposal-engine',{body:this.pending.body});
   if(!this.isCurrent())return;
   if(error||data?.error){
    let rejected=data?.error;
    if(!rejected&&error?.context?.json)try{rejected=(await error.context.clone().json()).error}catch{}
    if(!this.isCurrent())return;
    if(['brief_or_attempt_changed','unavailable','unauthorized','invalid_request'].includes(rejected)){this.clearPending();throw Object.assign(Error('El resum del viatge o la sessió han canviat. Recarrega abans de continuar.'),{code:rejected});}
    // A known failed attempt can end pending state; a failed read cannot.
    try{const authoritative=await this.read(row.id);if(!this.pending)return authoritative;}catch{}
    throw Error('No s’ha pogut completar la petició. Reintenta per verificar-ne el resultat.');
   }
   const authoritative=await this.read(row.id);
   if(!this.isCurrent())return;
   if(data?.generation_id===authoritative.generation?.id)this.reconcile(authoritative,true);
   // A successful receipt also resolves acceptance while an attempt is running.
   if(data?.generation_id===authoritative.generation?.id||data?.status==='completed')this.clearPending();
   return authoritative;
  }finally{this.busy=false;}
 }
}

export const loadingMessages=['Estic buscant idees que encaixin amb el teu viatge…','Estic valorant diferents maneres de construir-lo…','Estic preparant les alternatives…'];
export function renderRefinement(row,result){
 const hard=Object.entries(row.document.decisions).filter(([,d])=>d.strength==='hard');
 return `<form id="proposalRefinementForm"><h3>Què voldries que canviés?</h3><div class="proposal-chips">${contextualRefinements(row.document,result.proposals).map(([key,label])=>`<label><input type="checkbox" name="refinementChip" value="${key}"> ${esc(label)}</label>`).join('')}</div><button type="button" id="proposalFreeText">✍️ Explica-m’ho tu</button><label id="proposalTextLabel" class="hidden">Què canviaries?<textarea id="proposalRefinementText" maxlength="1000" rows="3"></textarea></label><p>Això orienta la cerca; no modifica les prioritats ni els imprescindibles del resum.</p><button type="submit">Busca alternatives diferents</button></form><section><h3>Per trobar opcions diferents, què estaries disposada a flexibilitzar?</h3>${hard.length?'<p>Tria un imprescindible per revisar-lo al resum. Cap canvi s’aplica sense confirmar-lo.</p>':'<p>Pots revisar les prioritats al resum del viatge.</p>'}<ul>${hard.map(([id,d])=>`<li>${esc(decisionLabel(d))} <button type="button" data-review-decision="${esc(id)}">Revisa aquest imprescindible</button></li>`).join('')}</ul></section>`;
}

import {combineImportItinerary,assessCombinedItinerary,proposeItinerarySolutions,planningPairs,planningRouteInput,planningRouteKey,planningSignature} from './import-itinerary-planning.mjs';
import {proposeUnmatchedReconciliationDecisions} from './import-itinerary-reconciliation-ui.mjs';
import {automaticEquivalentDecisions as equivalentDecisions} from './import-itinerary-planning.mjs';
import {RouteQueue,routeReasons,routeFeasibility,routeIsVerified} from './itinerary-route.mjs';
export {automaticEquivalentDecisions,acceptItinerarySolution} from './import-itinerary-planning.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initialPlanningDecisions(snapshot,state){
 const keeps=equivalentDecisions(snapshot,state.existing,state.decisions);
 // Reuse #191's ADD rules. Overlaps remain in the real review and are the
 // reason for this analysis; remove that flag only for this draft shortcut.
 const draft={...snapshot,items:snapshot.items.filter(i=>i.classification_hint==='manual').map(i=>({...i,review_flags:i.review_flags.filter(f=>f!=='possible_overlap_in_review')}))};
 return [...keeps,...proposeUnmatchedReconciliationDecisions(draft,{...state,decisions:[...state.decisions,...keeps]})];
}
export function refreshAutomaticDecisions(snapshot,state){
 const orders=new Set(state.decisions.filter(d=>d.automatic).map(d=>d.source_order));
 const manual=state.decisions.filter(d=>!d.automatic);
 return [...manual,...equivalentDecisions(snapshot,state.existing,manual).filter(d=>orders.has(d.source_order))];
}

export function analyzePlanning(snapshot,state,context,previous={}){
 const combined=combineImportItinerary(snapshot,state,context),options={routes:previous.routes||{},openings:previous.openings||{},sourcesReady:context.sourcesReady,bufferMinutes:context.bufferMinutes??5};
 const assessment=assessCombinedItinerary(combined,options),solutions=proposeItinerarySolutions(combined,options,context);
 return {combined,assessment,solutions,options,routes:options.routes,openings:options.openings,signature:planningSignature(combined),context};
}
export async function calculatePlanningRoutes(analysis,{tripId,invoke,current,online,onProgress=()=>{}}){
 const queue=new RouteQueue({invoke:input=>current()?invoke(input):Promise.resolve({error:'stale_record'}),max:20,parallel:2});queue.reset(tripId);
 const pairs=planningPairs(analysis.combined.items).filter(p=>{const age=Date.now()-Date.parse(analysis.routes[p.key]?.route?.calculated_at);return !(age>=0&&age<300000)}).slice(0,20);
 // No repeated provider calls for unchanged fresh pairs; changing schedule is local.
 await Promise.all(pairs.map(async pair=>{
  if(!current())return;const input=planningRouteInput(pair,tripId);if(!input)return;
  const saved=analysis.routes[pair.key]?.route,age=Date.now()-Date.parse(saved?.calculated_at);
  if(saved&&age>=0&&age<300000)return;
  const result=await queue.request(pair.key,input,{online});
  if(!current())return;
  const code=result.error||result.origin?.error||result.destination?.error;
  analysis.routes[pair.key]=code?{error:routeReasons[code]||'No s’ha pogut verificar el trajecte'}:result;onProgress();
 }));
}
export function planningHtml(a,{busy=false}={}){
 if(!a)return '';
 const {assessment:s,combined:c}=a;
 const routeRows=planningPairs(c.items).flatMap(({a:origin,b:destination,key})=>{const entry=a.routes[key];if(!routeIsVerified(entry))return [];const r=entry.route,f=routeFeasibility(origin,destination,r,a.options.bufferMinutes);return ['<li>'+esc(origin.title)+' → '+esc(destination.title)+': '+Math.ceil(r.duration_seconds/60)+' min a peu (estimació). '+(Number.isFinite(f.gapMinutes)?'Temps entre visites: '+Math.floor(f.gapMinutes)+' min. ':'')+esc(r.source)+' · '+esc(r.calculated_at)+'</li>']}).join('');
 return '<h3>Itinerari combinat</h3><p role="status" data-planning-summary>'+esc(s.label)+'</p><p>'+c.plan.rows.filter(x=>x.action==='keep').length+' visites reconegudes i unificades · '+c.plan.summary.preserved+' visites existents conservades · '+c.plan.summary.new+' noves · '+s.counts.conflicts+' incompatibilitats · '+s.counts.tight+' marges ajustats · '+s.counts.pending+' aspectes pendents</p>'+
 '<p>Només es modifica l’esborrany. Les hores del PDF encara s’han de contrastar amb les reserves. Marge de càlcul: '+esc(a.options.bufferMinutes)+' min; no és un marge garantit.</p>'+
 '<button type="button" data-planning-routes '+(busy?'disabled':'')+'>'+(busy?'Comprovant trajectes…':'Comprova els trajectes a peu (màxim 20)')+'</button>'+
 (routeRows?'<details open><summary>Trajectes calculats (estimacions)</summary><ul>'+routeRows+'</ul></details>':'')+
 '<ul>'+s.issues.filter(i=>i.kind!=='pending').map(i=>'<li>'+esc(i.message)+'</li>').join('')+'</ul>'+
 '<details><summary>Aspectes pendents de verificar ('+s.counts.pending+')</summary><ul>'+s.issues.filter(i=>i.kind==='pending').map(i=>'<li>'+esc(i.message)+'</li>').join('')+'</ul></details>'+
 '<h4>Solucions proposades</h4>'+(a.solutions.length?a.solutions.map(p=>'<article><p>'+esc(p.label)+'</p><small>'+esc(p.note)+'</small><button type="button" data-planning-accept="'+p.id+'" '+(busy?'disabled':'')+'>Acceptar el canvi proposat</button></article>').join(''):'<p>No hi ha cap canvi segur proposable amb les dades disponibles. Completa les hores, durades o ubicacions; les reserves no es mouen.</p>')+
 '<details><summary>Veure el planning resultant ('+c.items.length+')</summary><ul>'+[...c.items].sort((a,b)=>String(a.localDate).localeCompare(String(b.localDate))||String(a.startsAt).localeCompare(String(b.startsAt))).map(x=>'<li>'+esc(x.localDate)+' · '+esc(x.title)+(x.mutable?' · Esborrany':' · Conservada/protegida')+'</li>').join('')+'</ul></details>';
}

import {visitPairs,routeFeasibility,routeModes,routeReasons,RouteQueue} from './itinerary-route.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let queue,scope='',states=new Map(),listeners;
export function resetAgendaRoutes(){listeners?.abort();queue?.reset('');scope='';states=new Map()}
export function mountAgendaRoutes({root,items,tripId,userId,generation,day,invoke,online,current,onEdit,storage=globalThis.localStorage,contextKey=''}){
 const nextScope=JSON.stringify([userId,tripId,generation]);
 if(scope!==nextScope){resetAgendaRoutes();scope=nextScope;queue=new RouteQueue({invoke});queue.reset(scope)}
 listeners?.abort();listeners=new AbortController();
 root.querySelectorAll('[data-agenda-route]').forEach(node=>node.remove());
 const pairs=visitPairs(items,tripId,day);
 for(const [index,pair]of pairs.entries()){
  // The activity itself already shows that its location is pending.
  if(!pair.origin.hasRoutePlace||!pair.destination.hasRoutePlace)continue;
  const anchor=[...root.querySelectorAll('[data-itinerary-key]')].find(node=>node.dataset.itineraryKey===pair.origin.key);if(!anchor)continue;
  const storageKey='freya-route-options-v1:'+JSON.stringify([userId,tripId,day,pair.origin.key,pair.destination.key]);
  if(states.size>=200)states.delete(states.keys().next().value);
  if(!states.has(pair.key)){
   let saved;try{saved=JSON.parse(storage?.getItem(storageKey)||'null')}catch{}
   states.set(pair.key,{mode:routeModes[saved?.mode]?saved.mode:'walk',buffer:typeof saved?.buffer==='number'&&saved.buffer>=0&&saved.buffer<=180?saved.buffer:null,choices:{},result:null,detailsOpen:false});
  }
  const state=states.get(pair.key),card=document.createElement('section');card.className='agenda-route-card agenda-route-compact-card';card.dataset.agendaRoute=String(index);anchor.after(card);
  let version=0;const live=()=>current()&&scope===nextScope&&card.isConnected;
  const save=()=>{try{storage?.setItem(storageKey,JSON.stringify({mode:state.mode,buffer:state.buffer}))}catch{}};
  const draw=()=>{
   if(!live())return;
   const result=state.result,route=result?.route,error=result?.error;
   const diagnosis=route&&state.buffer!==null?
     routeFeasibility(pair.origin,pair.destination,route,state.buffer):null;
   const needs=result&&!route?[error,...['origin','destination'].map(side=>result[side]?.error)].filter(Boolean):[];
   const modeIcon=route?.mode==='drive'?'🚗':route?.mode==='transit'?'🚌':'🚶';
   const summary=!result?'Calculant trajecte…':route?
     `${modeIcon} ${Math.ceil(route.duration_seconds/60)} min · ${(route.distance_m/1000).toFixed(1)} km · ${esc(routeModes[route.mode])}`:
     error==='offline'?'Sense connexió · trajecte pendent':error==='rate_limited'?'Trajecte temporalment no disponible':'Trajecte pendent de verificar';
   card.innerHTML=`<div class="agenda-route-compact" role="status" aria-live="polite">↳ ${summary}</div>
    <details data-route-options ${state.detailsOpen?'open':''}><summary>Opcions del trajecte</summary>
      <p>${route?esc(result.origin?.label||pair.origin.title)+' → '+esc(result.destination?.label||pair.destination.title):
        (needs.map(code=>esc(routeReasons[code]||'No s’ha pogut consultar la ruta.')).join(' ')||'Encara no hi ha cap trajecte verificat.')}</p>
      <div class="agenda-route-controls"><label>Com vols anar-hi?<select data-route-mode>${Object.entries(routeModes).map(([value,label])=>`<option value="${value}" ${state.mode===value?'selected':''}>${label}</option>`).join('')}</select></label>
      <label>Marge addicional (min)<input data-route-buffer type="number" inputmode="numeric" min="0" max="180" step="1" placeholder="Opcional" value="${state.buffer??''}"></label></div>
      ${route&&diagnosis?`<p class="agenda-route-diagnosis">${esc(diagnosis.status)} · ${esc(diagnosis.reason)}</p>`:''}
      ${route?`<small><a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · ${esc(route.quality)}</small>`:''}
      ${['origin','destination'].map(side=>result?.[side]?.candidates?.length?`<label>${side==='origin'?'Lloc de sortida':'Lloc d’arribada'}<select data-route-choice="${side}"><option value="">Tria el lloc per a aquest càlcul</option>${result[side].candidates.map(c=>`<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label>`:'').join('')}
      <div class="agenda-route-actions">${result&&!route?'<button type="button" data-route-retry>Reintenta</button>':''}<button type="button" data-route-edit="origin">Corregeix l’origen</button><button type="button" data-route-edit="destination">Corregeix la destinació</button></div>
    </details>`;
   const details=card.querySelector('[data-route-options]');
   details.addEventListener('toggle',()=>{if(live())state.detailsOpen=details.open});
   card.querySelector('[data-route-mode]').onchange=e=>{state.mode=e.target.value;state.result=null;save();draw();load()};
   card.querySelector('[data-route-buffer]').onchange=e=>{state.buffer=e.target.value===''?null:Number(e.target.value);save();draw()};
   card.querySelector('[data-route-retry]')?.addEventListener('click',()=>load(true));
   card.querySelectorAll('[data-route-choice]').forEach(select=>select.onchange=()=>{state.choices[select.dataset.routeChoice]=select.value;load()});
   card.querySelectorAll('[data-route-edit]').forEach(button=>button.onclick=()=>onEdit(pair[button.dataset.routeEdit]));
  };
  async function load(retry=false){
   if(!live())return;
   const requestVersion=++version;
   const payload={trip_id:tripId,mode:state.mode,origin:{type:pair.origin.sourceType,id:pair.origin.sourceId,updated_at:pair.origin.sourceUpdatedAt},destination:{type:pair.destination.sourceType,id:pair.destination.sourceId,updated_at:pair.destination.sourceUpdatedAt},choices:{...state.choices}};
   if(!online()){state.result={error:'offline'};draw();return}
   state.result=null;draw();
   const result=await queue.request(JSON.stringify([pair.key,contextKey,payload]),payload,{online:online(),retry});
   if(!live()||requestVersion!==version)return;
   state.result=online()?result:{error:'offline'};draw();
  }
  const refresh=()=>{if(live())load()};
  window.addEventListener('online',refresh,{signal:listeners.signal});window.addEventListener('offline',refresh,{signal:listeners.signal});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh()},{signal:listeners.signal});
  draw();load();
 }
}

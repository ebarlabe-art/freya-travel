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
  const anchor=[...root.querySelectorAll('[data-itinerary-key]')].find(node=>node.dataset.itineraryKey===pair.origin.key);if(!anchor)continue;
  const storageKey='freya-route-options-v1:'+JSON.stringify([userId,tripId,day,pair.origin.key,pair.destination.key]);
  if(states.size>=200)states.delete(states.keys().next().value);
  if(!states.has(pair.key)){
   let saved;try{saved=JSON.parse(storage?.getItem(storageKey)||'null')}catch{}
   states.set(pair.key,{mode:routeModes[saved?.mode]?saved.mode:'walk',buffer:typeof saved?.buffer==='number'&&saved.buffer>=0&&saved.buffer<=180?saved.buffer:null,choices:{},result:null});
  }
  const state=states.get(pair.key),card=document.createElement('section');card.className='agenda-route-card';card.dataset.agendaRoute=String(index);anchor.after(card);
  let version=0;const live=()=>current()&&scope===nextScope&&card.isConnected;
  const save=()=>{try{storage?.setItem(storageKey,JSON.stringify({mode:state.mode,buffer:state.buffer}))}catch{}};
  const draw=()=>{
   if(!live())return;
   const result=state.result,route=result?.route,error=result?.error;
   const diagnosis=routeFeasibility(pair.origin,pair.destination,route,state.buffer);
   const needs=result&&!route?[error,...['origin','destination'].map(side=>result[side]?.error)].filter(Boolean):[];
   card.innerHTML=`<strong>↳ ${esc(pair.origin.title)} → ${esc(pair.destination.title)}</strong>
    <div class="agenda-route-controls"><label>Mode<select data-route-mode>${Object.entries(routeModes).map(([value,label])=>`<option value="${value}" ${state.mode===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <label>Marge desitjat (min)<input data-route-buffer type="number" inputmode="numeric" min="0" max="180" step="1" placeholder="Indica’l" value="${state.buffer??''}"></label></div>
    <p role="status" aria-live="polite">${!result?'Calculant el trajecte…':route?`${esc(result.origin.label)} → ${esc(result.destination.label)} · ${(route.distance_m/1000).toFixed(1)} km · ~${Math.ceil(route.duration_seconds/60)} min · ${esc(routeModes[route.mode])}`:'Dades insuficients: '+needs.map(code=>esc(routeReasons[code]||'No s’ha pogut consultar la ruta.')).join(' ')}</p>
    ${route?`<p><strong>${esc(diagnosis.status)}</strong> · ${esc(diagnosis.reason)}${Number.isFinite(diagnosis.gapMinutes)?` Entre visites: ${Math.floor(diagnosis.gapMinutes)} min; després del trajecte: ${Math.floor(diagnosis.remainingMinutes)} min; marge demanat: ${state.buffer} min.`:''}</p><small><a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · ${esc(route.quality)} Llocs revisats només per a aquest trajecte.</small>`:''}
    ${['origin','destination'].map(side=>result?.[side]?.candidates?.length?`<label>${side==='origin'?'Lloc de sortida':'Lloc d’arribada'}<select data-route-choice="${side}"><option value="">Tria el lloc per a aquest càlcul</option>${result[side].candidates.map(c=>`<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label>`:'').join('')}
    <div class="agenda-route-actions">${result&&!route?'<button type="button" data-route-retry>Reintenta</button>':''}<button type="button" data-route-edit="origin">Corregeix l’origen</button><button type="button" data-route-edit="destination">Corregeix la destinació</button></div>`;
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
   if(!pair.origin.hasRoutePlace||!pair.destination.hasRoutePlace){state.result={error:'missing_place'};draw();return}
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

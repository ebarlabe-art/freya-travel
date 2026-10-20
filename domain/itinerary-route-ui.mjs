import {visitPairs,routeFeasibility,routeModes,routeReasons,routeMapUrl,RouteQueue} from './itinerary-route.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let queue,scope='',states=new Map(),listeners;
export function resetAgendaRoutes(){listeners?.abort();queue?.reset('');scope='';states=new Map()}
export function mountAgendaRoutes({root,items,tripId,userId,generation,day,invoke,online,current,onEdit,storage=globalThis.localStorage,contextKey='',preserveViewport=()=>()=>{}}){
 const nextScope=JSON.stringify([userId,tripId,generation]);
 if(scope!==nextScope){resetAgendaRoutes();scope=nextScope;queue=new RouteQueue({invoke});queue.reset(scope)}
 listeners?.abort();listeners=new AbortController();
 const restoreViewport=preserveViewport();
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
   const restoreDrawViewport=preserveViewport();
   // toggle is queued asynchronously: capture the user's current disclosure
   // before replacing it, and ignore events from the detached previous node.
   const previousDetails=card.querySelector('[data-route-options]');
   if(previousDetails)state.detailsOpen=previousDetails.open;
   const result=state.result,route=result?.route,error=result?.error;
   const diagnosis=route?routeFeasibility(pair.origin,pair.destination,route,state.buffer??0):null;
   const mapUrl=routeMapUrl(route);
   const needs=result&&!route?[error,...['origin','destination'].map(side=>result[side]?.error)].filter(Boolean):[];
   const modeIcon=route?.mode==='drive'?'🚗':route?.mode==='transit'?'🚌':'🚶';
   const summary=!result?'Calculant trajecte…':route?
     `${modeIcon} ${Math.ceil(route.duration_seconds/60)} min · ${(route.distance_m/1000).toFixed(1)} km · ${esc(routeModes[route.mode])}`:
     needs.includes('approximate_place')?'Zona identificada · trajecte pendent de concretar':error==='offline'?'Sense connexió · trajecte pendent':error==='rate_limited'?'Trajecte temporalment no disponible':'Trajecte pendent de verificar';
   card.innerHTML=`<div class="agenda-route-compact" role="status" aria-live="polite">↳ ${summary}</div>
    ${diagnosis?.status==='No factible'||diagnosis?.status==='Molt ajustat'?`<p role="status" class="agenda-route-diagnosis">⚠ ${esc(diagnosis.reason)} Els horaris es mantenen.</p>`:''}
    <details data-route-options ${state.detailsOpen?'open':''}><summary>Opcions del trajecte</summary>
      <p>${route?esc(result.origin?.label||pair.origin.title)+' → '+esc(result.destination?.label||pair.destination.title):
        (needs.map(code=>esc(routeReasons[code]||'No s’ha pogut consultar la ruta.')).join(' ')||'Encara no hi ha cap trajecte verificat.')}</p>
      <div class="agenda-route-controls"><label>Com vols anar-hi?<select data-route-mode>${Object.entries(routeModes).map(([value,label])=>`<option value="${value}" ${state.mode===value?'selected':''}>${label}</option>`).join('')}</select></label>
      <label>Marge addicional (min)<input data-route-buffer type="number" inputmode="numeric" min="0" max="180" step="1" placeholder="Opcional" value="${state.buffer??''}"></label></div>
      ${route&&diagnosis?`<p class="agenda-route-diagnosis">${esc(diagnosis.status)} · ${esc(diagnosis.reason)}</p>`:''}
      ${mapUrl?`<p><a data-route-map href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">🗺 Consulta el trajecte al mapa</a></p>`:''}
      ${route?`<small><a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · ${esc(route.quality)}</small>`:''}
      ${['origin','destination'].map(side=>result?.[side]?.candidates?.length?`<label>${side==='origin'?'Lloc de sortida':'Lloc d’arribada'}<select data-route-choice="${side}"><option value="">Tria el lloc per a aquest càlcul</option>${result[side].candidates.map(c=>`<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label>`:'').join('')}
      <div class="agenda-route-actions">${result&&!route?'<button type="button" data-route-retry>Reintenta</button>':''}<button type="button" data-route-edit="origin">Corregeix l’origen</button><button type="button" data-route-edit="destination">Corregeix la destinació</button></div>
    </details>`;
   const details=card.querySelector('[data-route-options]');
   details.addEventListener('toggle',()=>{if(live()&&details.isConnected&&card.contains(details))state.detailsOpen=details.open});
   card.querySelector('[data-route-mode]').onchange=e=>{state.mode=e.target.value;state.result=null;save();draw();load()};
   card.querySelector('[data-route-buffer]').onchange=e=>{state.buffer=e.target.value===''?null:Number(e.target.value);save();draw()};
   card.querySelector('[data-route-retry]')?.addEventListener('click',()=>load(true));
   card.querySelectorAll('[data-route-choice]').forEach(select=>select.onchange=()=>{state.choices[select.dataset.routeChoice]=select.value;load()});
   card.querySelectorAll('[data-route-edit]').forEach(button=>button.onclick=()=>onEdit(pair[button.dataset.routeEdit]));
   restoreDrawViewport();
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
 // Real walking legs INSIDE a compound activity (one item, several ordered visits).
 // Never draw a straight-line duration and never infer a stop from a vague area.
 for(const item of items){
  if(item.tripId!==tripId||item.localDate!==day||item.isCancelled||item.isTransport||!['manual','activity'].includes(item.sourceType))continue;
  const points=item.locationPoints;
  if(!Array.isArray(points)||points.length<2)continue;
  const anchor=[...root.querySelectorAll('[data-itinerary-key]')].find(node=>node.dataset.itineraryKey===item.key);
  if(!anchor)continue;
  const card=document.createElement('section');card.className='agenda-route-card agenda-route-internal';card.dataset.internalRoutes=item.key;
  const heading=document.createElement('strong');heading.textContent='🚶 Trajectes dins de l’activitat';
  const legs=document.createElement('div');legs.className='agenda-route-internal-legs';
  card.append(heading,legs);anchor.after(card);
  const alive=()=>current()&&scope===nextScope&&card.isConnected;
  for(let i=0;i<points.length-1;i++){
   const a=points[i],b=points[i+1],line=document.createElement('p'),label=(i+1)+' → '+(i+2)+' · ';
   line.className='agenda-route-compact';line.setAttribute('role','status');
   legs.append(line);
   const exact=p=>p?.place?.coordinate_role==='exact_location'&&Number.isFinite(p.place.latitude)&&Number.isFinite(p.place.longitude);
   if(!exact(a)||!exact(b)){
    line.textContent=label+'Pendent de verificar els punts o concretar la zona.';
    continue;
   }
   line.textContent=label+'Calculant el trajecte a peu…';
   const body={trip_id:tripId,kind:'internal',mode:'walk',item:{type:item.sourceType,id:item.sourceId,updated_at:item.sourceUpdatedAt},from_index:i,to_index:i+1};
   const key=JSON.stringify([nextScope,item.key,item.sourceUpdatedAt,'internal',i,contextKey]);
   void queue.request(key,body,{online:online()}).then(result=>{
    if(!alive())return;
    const route=result?.route;
    if(route?.method==='routing'&&Number.isFinite(route.duration_seconds)&&Number.isFinite(route.distance_m)){
     const minutes=Math.ceil(route.duration_seconds/60),distance=(route.distance_m/1000).toFixed(2);
     line.textContent=label+minutes+' min · '+distance+' km a peu';
     const mapUrl=routeMapUrl(route);
     if(mapUrl){const link=document.createElement('a');link.href=mapUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' · Mapa';line.append(link)}
    }else{
     const code=result?.error||result?.origin?.error||result?.destination?.error||'unavailable';
     line.textContent=label+(code==='offline'?'Sense connexió.':routeReasons[code]||'Trajecte pendent de verificar.');
    }
   }).catch(()=>{if(alive())line.textContent=label+'Trajecte temporalment no disponible.'});
  }
 }
 restoreViewport();
}

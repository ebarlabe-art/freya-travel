import {recommendedVisitAdvice} from './itinerary-visit-advice.mjs';
import {visitPairs,routeFeasibility,routeModes,routeReasons,routeMapUrl,RouteQueue,transportPreferences,rentalAvailableForDay,preferredRoute,routeIsVerified,automaticAlternativeMode,visitTimeBudget} from './itinerary-route.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let queue,scope='',states=new Map(),listeners;
export function resetAgendaRoutes(){listeners?.abort();queue?.reset('');scope='';states=new Map()}
export function mountAgendaRoutes({root,items,tripId,userId,generation,day,invoke,online,current,onEdit,storage=globalThis.localStorage,contextKey='',preserveViewport=()=>()=>{},rentals=[],timeZone='UTC',visitPlans=new Map()}){
 const nextScope=JSON.stringify([userId,tripId,generation]);
 if(scope!==nextScope){resetAgendaRoutes();scope=nextScope;queue=new RouteQueue({invoke});queue.reset(scope)}
 listeners?.abort();listeners=new AbortController();
 const restoreViewport=preserveViewport();
 root.querySelectorAll('[data-agenda-route],[data-internal-routes],[data-route-preferences],[data-visit-advice]').forEach(node=>node.remove());
 const carAllowed=rentalAvailableForDay(rentals,day,timeZone);
 const preferenceKey='freya-route-preference-v1:'+JSON.stringify([userId,tripId]);
 let remembered;try{remembered=storage?.getItem(preferenceKey)}catch{}
 const preference=remembered==='walk_car'&&carAllowed?'walk_car':'walk_transit';
 const preferencePanel=document.createElement('div');
 preferencePanel.dataset.routePreferences='';preferencePanel.className='agenda-route-card';
 const preferenceLabel=document.createElement('label');
 preferenceLabel.textContent='🚶 Com prefereixes desplaçar-te durant el viatge? ';
 const picker=document.createElement('select');picker.setAttribute('aria-label','Preferència de transport de l’itinerari');
 for(const [value,name] of Object.entries(transportPreferences)){
  if(value==='walk_car'&&!carAllowed)continue;
  const option=document.createElement('option');option.value=value;option.textContent=name;picker.append(option);
 }
 picker.value=preference;preferenceLabel.append(picker);
 const help=document.createElement('small');
 help.textContent=carAllowed?'Freya prioritza caminades curtes, transport públic a ciutat i cotxe de lloguer només per a distàncies llargues. Pots canviar cada trajecte.':'Freya prioritza caminar i compara el transport públic en distàncies llargues. Cotxe: només amb lloguer reservat o confirmat per al dia.';
 preferencePanel.append(preferenceLabel,help);
 picker.onchange=()=>{
  try{storage?.setItem(preferenceKey,picker.value)}catch{}
  mountAgendaRoutes({root,items,tripId,userId,generation,day,invoke,online,current,onEdit,storage,contextKey,preserveViewport,rentals,timeZone,visitPlans});
 };
 root.prepend(preferencePanel);
 const internalTravel=new Map(),redrawCross=new Map();
 for(const item of items)if(Array.isArray(item.locationPoints)&&item.locationPoints.length>1)internalTravel.set(item.key,{waiting:item.locationPoints.length-1,seconds:0,incomplete:false});
 const pairs=visitPairs(items,tripId,day);
 for(const [index,pair]of pairs.entries()){
  // Even incomplete place pairs need a clear, actionable connector; do not hide them.
  const anchor=[...root.querySelectorAll('[data-itinerary-key]')].find(node=>node.dataset.itineraryKey===pair.origin.key);if(!anchor)continue;
  const storageKey='freya-route-options-v1:'+JSON.stringify([userId,tripId,day,pair.origin.key,pair.destination.key]);
  if(states.size>=200)states.delete(states.keys().next().value);
  if(!states.has(pair.key)){
   let saved;try{saved=JSON.parse(storage?.getItem(storageKey)||'null')}catch{}
   states.set(pair.key,{mode:saved?.mode==='auto'||routeModes[saved?.mode]?saved.mode:'auto',buffer:typeof saved?.buffer==='number'&&saved.buffer>=0&&saved.buffer<=180?saved.buffer:null,choices:{},result:null,detailsOpen:false});
  }
  const state=states.get(pair.key);
  if(state.mode==='drive'&&!carAllowed){state.mode='auto';state.result=null}
  const card=document.createElement('section');card.className='agenda-route-card agenda-route-compact-card';card.dataset.agendaRoute=String(index);anchor.after(card);
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
   const diagnosis=route?routeFeasibility(pair.origin,pair.destination,route,state.buffer??5):null;
   const internal=internalTravel.get(pair.origin.key);
   const budget=route&&(!internal||internal.waiting===0&&!internal.incomplete)?visitTimeBudget(pair.origin,pair.destination,result,internal?.seconds||0,state.buffer??5):null;
   let leaveTime='';
   if(budget)try{leaveTime=new Intl.DateTimeFormat('ca-ES',{timeZone,hour:'2-digit',minute:'2-digit'}).format(new Date(budget.leaveBy))}catch(_){leaveTime=''};
   const mapUrl=routeMapUrl(route);
   const proposal=visitPlans.get(pair.origin.key);
   const proposed=proposal?recommendedVisitAdvice(pair.origin,proposal,pair.destination,result,state.buffer??5):null;
   let proposedDeparture='';
   if(proposed?.latestLeaveBy)try{proposedDeparture=new Intl.DateTimeFormat('ca-ES',{timeZone,hour:'2-digit',minute:'2-digit'}).format(new Date(proposed.latestLeaveBy))}catch(_){};
   const needs=result&&!route?[error,...['origin','destination'].map(side=>result[side]?.error)].filter(Boolean):[];
   const modeIcon=route?.mode==='drive'?'🚗':route?.mode==='transit'?'🚌':'🚶';
   // Do not hide an actionable location error behind a generic "pending" label.
   // The router must have two exact, independently verified endpoints; never invent coordinates.
   const reasonCode=needs.find(code=>routeReasons[code]);
   const unresolvedSide=result?.origin?.error?'origin':result?.destination?.error?'destination':'';
   const summary=!result?'Calculant trajecte…':route?
     `${modeIcon} ${Math.ceil(route.duration_seconds/60)} min · ${(route.distance_m/1000).toFixed(1)} km · ${esc(routeModes[route.mode])}`:
     reasonCode?routeReasons[reasonCode]:error==='offline'?'Sense connexió · reintentarem el trajecte': 'Ruta no disponible. Consulta el motiu i reintenta.';
   const reviewControl=unresolvedSide?'<button type="button" data-route-review="'+unresolvedSide+'">📍 Revisa '+(unresolvedSide==='origin'?'la sortida':'l’arribada')+'</button>':'';
   card.innerHTML=`<div class="agenda-route-compact" role="status" aria-live="polite">↳ ${esc(summary)} ${reviewControl}</div>${state.autoNote?`<p class="agenda-route-diagnosis">${esc(state.autoNote)}</p>`:""}${route?.mode==='transit'?'<p class="agenda-route-diagnosis">Temps estimat de transport públic; no incorpora horaris ni esperes en directe.</p>':''}
    ${budget?`<p class="agenda-route-diagnosis" role="status">${budget.hasConflict?"⚠ Horaris incompatibles:": "Temps màxim orientatiu per a la visita:"} ${esc(String(budget.availableMinutes))} min, descomptant trajectes i marge.${leaveTime?" Sortida recomanada abans de les "+esc(leaveTime)+".":""} No modifica les reserves.</p>`:internal?.incomplete||internal?.waiting?"<p class=\"agenda-route-diagnosis\">Cal verificar els trams interns per calcular el temps disponible.</p>":""}
    ${proposed?.latestLeaveBy?`<p class="agenda-route-diagnosis" role="status">${proposed.shortageMinutes>0?'⚠ La visita proposada no hi cap: cal avançar la sortida almenys '+esc(String(proposed.shortageMinutes))+' min.':'⏰ Per arribar a la visita següent,'} marxeu com a màxim a les ${esc(proposedDeparture)} (${esc(String(proposed.travelMinutes))} min de trajecte + ${esc(String(state.buffer??5))} min de marge). Hora orientativa basada en una ruta verificada; no canvia reserves.</p>`:proposal&&pair.destination?`<p class="agenda-route-diagnosis">Encara no podem fixar l'hora límit de sortida fins que el trajecte estigui verificat.</p>`:''}
    ${diagnosis?.status==='No factible'||diagnosis?.status==='Molt ajustat'?`<p role="status" class="agenda-route-diagnosis">⚠ ${esc(diagnosis.reason)} Els horaris es mantenen.</p>`:''}
    <details data-route-options ${state.detailsOpen?'open':''}><summary>Opcions del trajecte</summary>
      <p>${route?esc(result.origin?.label||pair.origin.title)+' → '+esc(result.destination?.label||pair.destination.title):
        (needs.map(code=>esc(routeReasons[code]||'No s’ha pogut consultar la ruta.')).join(' ')||'Encara no hi ha cap trajecte verificat.')}</p>
      <div class="agenda-route-controls"><label>Com vols anar-hi?<select data-route-mode>${[['auto','Automàtic (menys temps estimat)'],...Object.entries(routeModes).filter(([value])=>value!=='drive'||carAllowed)].map(([value,label])=>`<option value="${value}" ${state.mode===value?'selected':''}>${label}</option>`).join('')}</select></label>
      <label>Marge de seguretat (min)<input data-route-buffer type="number" inputmode="numeric" min="0" max="180" step="1" placeholder="Opcional" value="${state.buffer??5}"></label></div>
      ${route&&diagnosis?`<p class="agenda-route-diagnosis">${esc(diagnosis.status)} · ${esc(diagnosis.reason)}</p>`:''}
      ${mapUrl?`<p><a data-route-map href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">🗺 Consulta el trajecte al mapa</a></p>`:''}
      ${route?`<small><a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · ${esc(route.quality)}</small>`:''}
      ${['origin','destination'].map(side=>result?.[side]?.candidates?.length?`<label>${side==='origin'?'Lloc de sortida':'Lloc d’arribada'}<select data-route-choice="${side}"><option value="">Tria el lloc per a aquest càlcul</option>${result[side].candidates.map(c=>`<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label>`:'').join('')}
      <div class="agenda-route-actions">${result&&!route?'<button type="button" data-route-retry>Reintenta</button>':''}<button type="button" data-route-edit="origin">Corregeix l’origen</button><button type="button" data-route-edit="destination">Corregeix la destinació</button></div>
    </details>`;
   const details=card.querySelector('[data-route-options]');
   details.addEventListener('toggle',()=>{if(live()&&details.isConnected&&card.contains(details))state.detailsOpen=details.open});
   card.querySelector('[data-route-mode]').onchange=e=>{state.mode=e.target.value;state.result=null;save();draw();load()};
   card.querySelector('[data-route-buffer]').onchange=e=>{state.buffer=e.target.value===''?5:Number(e.target.value);save();draw()};
   card.querySelector('[data-route-review]')?.addEventListener('click',event=>onEdit(pair[event.currentTarget.dataset.routeReview]));
   card.querySelector('[data-route-retry]')?.addEventListener('click',()=>load(true));
   card.querySelectorAll('[data-route-choice]').forEach(select=>select.onchange=()=>{state.choices[select.dataset.routeChoice]=select.value;load()});
   card.querySelectorAll('[data-route-edit]').forEach(button=>button.onclick=()=>onEdit(pair[button.dataset.routeEdit]));
   restoreDrawViewport();
  };
  async function load(retry=false){
   if(!live())return;
   const requestVersion=++version;
   const payload={trip_id:tripId,mode:state.mode==='auto'?'walk':state.mode,origin:{type:pair.origin.sourceType,id:pair.origin.sourceId,updated_at:pair.origin.sourceUpdatedAt},destination:{type:pair.destination.sourceType,id:pair.destination.sourceId,updated_at:pair.destination.sourceUpdatedAt},choices:{...state.choices}};
   if(!online()){state.result={error:'offline'};draw();return}
   if(!pair.origin.hasRoutePlace||!pair.destination.hasRoutePlace){state.result={error:'missing_place',origin:!pair.origin.hasRoutePlace?{error:'missing_place'}:{},destination:!pair.destination.hasRoutePlace?{error:'missing_place'}:{}};draw();return}
   state.result=null;state.autoNote='';draw();
   const result=await queue.request(JSON.stringify([pair.key,contextKey,payload]),payload,{online:online(),retry});
   if(!live()||requestVersion!==version)return;
   let chosen=result;
   if(state.mode==='auto'&&routeIsVerified(result)&&result.route.duration_seconds>900){
    const otherMode=automaticAlternativeMode(result,preference,carAllowed);
    const alt={...payload,mode:otherMode};
    const alternative=await queue.request(JSON.stringify([pair.key,contextKey,alt]),alt,{online:online(),retry});
    if(!live()||requestVersion!==version)return;
    chosen=preferredRoute(result,alternative);
    if(!routeIsVerified(alternative))state.autoNote='No s’ha pogut verificar la ruta amb '+(otherMode==='drive'?'cotxe':'transport públic')+'. Es mostra el trajecte a peu, no una comparativa definitiva.';
   }
   state.result=online()?chosen:{error:'offline'};draw();
  }
  const refresh=()=>{if(live())load()};
  window.addEventListener('online',refresh,{signal:listeners.signal});window.addEventListener('offline',refresh,{signal:listeners.signal});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh()},{signal:listeners.signal});
  redrawCross.set(pair.origin.key,draw);
  draw();load();
 }
 // Informal, editable-in-session itinerary suggestions are shown for EVERY visit,
 // including the last activity and visits whose precise location is not verified.
 for(const item of items){
  if(item.tripId!==tripId||item.localDate!==day||item.isCancelled||item.isTransport||!['manual','activity'].includes(item.sourceType))continue;
  const suggestion=visitPlans.get(item.key);
  if(!suggestion)continue;
  const anchor=[...root.querySelectorAll('[data-itinerary-key]')].find(node=>node.dataset.itineraryKey===item.key);
  if(!anchor)continue;
  const next=pairs.find(pair=>pair.origin.key===item.key)?.destination||null;
  const advice=recommendedVisitAdvice(item,suggestion,next);
  if(!advice)continue;
  const format=stamp=>{if(!stamp)return '';try{return new Intl.DateTimeFormat('ca-ES',{timeZone,hour:'2-digit',minute:'2-digit'}).format(new Date(stamp))}catch{return ''}};
  const end=format(advice.confirmedEnd||advice.displayableEnd),nextAt=format(advice.nextStart);
  const note=document.createElement('section');note.dataset.visitAdvice=item.key;
  note.className='agenda-visit-guidance'+(advice.shortageMinutes>0?' agenda-visit-conflict':'');
  const heading=document.createElement('strong');heading.textContent='💡 Durada proposada: '+advice.minutes+' min';
  note.append(heading);
  if(advice.reason){const reason=document.createElement('p');reason.textContent=advice.reason;note.append(reason)}
  const status=document.createElement('p');
  if(advice.shortageMinutes>0){
   status.textContent='⚠ Aquesta durada no encaixa abans de la següent activitat'+(nextAt?' de les '+nextAt:'')+
    '. Cal escurçar-la almenys '+advice.shortageMinutes+' min'+(advice.routePending?', més el temps de desplaçament pendent de verificar.':'.');
  }else if(end){
   status.textContent=advice.confirmedEnd?'Final de la visita fixat: '+end+'.':'Final orientatiu: '+end+'.';
   if(advice.routePending)status.textContent+=' Encara cal comprovar el temps fins a la visita següent.';
  }else status.textContent='Hora de finalització pendent de concretar.';
  note.append(status);
  (anchor.querySelector('.generic-itinerary-card')||anchor).append(note);
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
   const a=points[i],b=points[i+1],line=document.createElement('p'),label=(i+1)+' → '+(i+2)+' · ',summary=internalTravel.get(item.key);
   line.className='agenda-route-compact';line.setAttribute('role','status');
   legs.append(line);
   const exact=p=>p?.place?.coordinate_role==='exact_location'&&Number.isFinite(p.place.latitude)&&Number.isFinite(p.place.longitude);
   if(!exact(a)||!exact(b)){
    line.textContent=label+'Pendent de verificar els punts o concretar la zona.';
    if(summary){summary.waiting--;summary.incomplete=true;redrawCross.get(item.key)?.()}
    continue;
   }
   line.textContent=label+'Calculant el trajecte a peu…';
   const body={trip_id:tripId,kind:'internal',mode:'walk',item:{type:item.sourceType,id:item.sourceId,updated_at:item.sourceUpdatedAt},from_index:i,to_index:i+1};
   const key=JSON.stringify([nextScope,item.key,item.sourceUpdatedAt,'internal',i,contextKey]);
   void queue.request(key,body,{online:online()}).then(result=>{
    if(!alive())return;
    const route=result?.route;
    if(route?.method==='routing'&&Number.isFinite(route.duration_seconds)&&Number.isFinite(route.distance_m)){
     if(summary)summary.seconds+=route.duration_seconds;
     const minutes=Math.ceil(route.duration_seconds/60),distance=(route.distance_m/1000).toFixed(2);
     line.textContent=label+minutes+' min · '+distance+' km a peu';
     const mapUrl=routeMapUrl(route);
     if(mapUrl){const link=document.createElement('a');link.href=mapUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' · Mapa';line.append(link)}
    }else{
     const code=result?.error||result?.origin?.error||result?.destination?.error||'unavailable';
     line.textContent=label+(code==='offline'?'Sense connexió.':routeReasons[code]||'Trajecte pendent de verificar.');
     if(summary)summary.incomplete=true;
    }
    if(summary){summary.waiting--;redrawCross.get(item.key)?.()}
   }).catch(()=>{if(alive()){line.textContent=label+'Trajecte temporalment no disponible.';if(summary){summary.waiting--;summary.incomplete=true;redrawCross.get(item.key)?.()}}});
  }
 }
 restoreViewport();
}

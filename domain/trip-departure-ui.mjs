import {RouteQueue} from './itinerary-route.mjs';
import {validatePlace,validIana} from './place-resolution.mjs';
import {DEFAULT_MARGIN,MAX_MARGIN,departurePlan,departureRef,departureEstimate,deviceRouteOrigin,plannedDepartureChoices,plannedDepartureEstimate} from './trip-departure.mjs';

const translations={
 planTitle:["Planifica els trajectes", "Planifica los trayectos", "Plan your journeys", "Planifiez vos trajets", "Pianifica i tragitti"],
 planEmpty:["Aquest dia no té cap visita amb hora i ubicació prou precises.", "Este día no tiene ninguna visita con hora y ubicación suficientemente precisas.", "This day has no visit with a precise start time and location.", "Aucune visite de ce jour n’a d’heure et de lieu suffisamment précis.", "Per questo giorno non ci sono visite con orario e luogo sufficientemente precisi."],
 planDestination:["Activitat d’arribada", "Actividad de destino", "Destination activity", "Activité de destination", "Attività di destinazione"],
 planLodging:["Allotjament", "Alojamiento", "Accommodation", "Hébergement", "Alloggio"],
 planReady:["Hora a partir de la qual pots sortir (opcional)", "Hora a partir de la que puedes salir (opcional)", "Earliest time you can leave (optional)", "Première heure de départ possible (facultatif)", "Prima ora utile per partire (facoltativa)"],
 planQuality:["Estimació de planificació. Consulta les condicions en directe abans de sortir.", "Estimación de planificación. Consulta las condiciones en directo antes de salir.", "Planning estimate. Check live conditions before leaving.", "Estimation de planification. Vérifiez les conditions en temps réel avant de partir.", "Stima di pianificazione. Verifica le condizioni in tempo reale prima di partire."],
 plannedConflict:["Temps insuficient segons els horaris previstos.", "Tiempo insuficiente según los horarios previstos.", "Not enough time in the planned schedule.", "Temps insuffisant selon les horaires prévus.", "Tempo insufficiente secondo gli orari previsti."],
 plannedFits:["El trajecte hi cap amb el marge previst.", "El trayecto encaja con el margen previsto.", "The journey fits with the planned buffer.", "Le trajet tient dans le temps prévu avec la marge.", "Il tragitto rientra nel tempo previsto con il margine."],
 unknownGap:["Falta una hora de sortida possible o de finalització per calcular el marge.", "Falta una hora de salida posible o de finalización para calcular el margen.", "A possible departure time or a scheduled finish is needed to check the gap.", "Il faut une heure de départ possible ou de fin prévue pour calculer la marge.", "Per calcolare il margine serve un orario di partenza possibile o di fine prevista."],
 invalidReady:["Aquesta hora no és vàlida a la zona horària de sortida.", "Esa hora no es válida en la zona horaria de salida.", "That time is invalid in the departure time zone.", "Cette heure est invalide dans le fuseau horaire du départ.", "L’orario non è valido nel fuso orario di partenza."],
 title:["Quan he de sortir?","¿Cuándo tengo que salir?","When should I leave?","Quand faut-il partir ?","Quando devo partire?"],
 noDestination:["No hi ha cap activitat propera amb hora i punt d’arribada prou precisos.","No hay una próxima actividad con hora y punto de llegada suficientemente precisos.","No upcoming activity has a precise start time and arrival point.","Aucune activité à venir n’a d’heure ni de point d’arrivée suffisamment précis.","Nessuna attività imminente ha un orario e un punto di arrivo sufficientemente precisi."],
 later:["Propera activitat amb un punt d’arribada prou precís.", "Próxima actividad con un punto de llegada suficientemente preciso.", "Next activity with a precise arrival point.", "Prochaine activité avec un point d’arrivée suffisamment précis.", "Prossima attività con un punto di arrivo sufficientemente preciso."],
 origin:["Origen","Origen","Starting point","Point de départ","Punto di partenza"],
 device:["Ubicació actual","Ubicación actual","Current location","Position actuelle","Posizione attuale"],
 previous:["Activitat anterior","Actividad anterior","Previous activity","Activité précédente","Attività precedente"],
 selected:["Un altre lloc", "Otro lugar", "Another place", "Un autre lieu", "Un altro luogo"],
 placeQuery:["Adreça o lloc i ciutat", "Dirección o lugar y ciudad", "Address or place and city", "Adresse ou lieu et ville", "Indirizzo o luogo e città"],
 search:["Cerca el punt d’origen", "Buscar el punto de origen", "Find a starting point", "Chercher le point de départ", "Cerca il punto di partenza"],
 searching:["Cercant llocs…", "Buscando lugares…", "Finding places…", "Recherche de lieux…", "Ricerca dei luoghi…"],
 choosePlace:["Tria un punt concret.", "Elige un punto exacto.", "Choose an exact point.", "Choisissez un point précis.", "Scegli un punto preciso."],
 noPlace:["No s’ha trobat cap punt concret. Afegeix una adreça o ciutat.", "No se ha encontrado un punto exacto. Añade una dirección o ciudad.", "No exact point found. Add an address or city.", "Aucun point précis trouvé. Ajoutez une adresse ou une ville.", "Nessun punto preciso trovato. Aggiungi un indirizzo o una città."],
 saved:["Llocs del viatge","Lugares del viaje","Places in this trip","Lieux du voyage","Luoghi del viaggio"],
 assumed:["Estimació des del lloc escollit. Comprova que hi seràs.","Estimación desde el lugar elegido. Comprueba que estarás allí.","Estimate from the selected place. Check that you’ll be there.","Estimation depuis le lieu choisi. Vérifiez que vous y serez.","Stima dal luogo scelto. Verifica che ti troverai lì."],
 previousEnd:["El marge té en compte l’hora de final de l’activitat anterior.","El margen tiene en cuenta la hora de fin de la actividad anterior.","The time available accounts for when the previous activity ends.","La marge tient compte de l’heure de fin de l’activité précédente.","Il margine tiene conto dell’ora di fine dell’attività precedente."],
 permission:["Si ho demanes, Freya envia la ubicació d’aquest moment al servei de rutes per fer el càlcul.","Si lo solicitas, Freya envía tu ubicación en ese momento al servicio de rutas para hacer el cálculo.","If you ask, Freya sends a one-time location fix to the routing service for this estimate.","À votre demande, Freya transmet ponctuellement votre position au service d’itinéraires pour ce calcul.","Se lo chiedi, Freya invia la tua posizione di quel momento al servizio di percorsi per la stima."],
 mode:["Mode de transport","Modo de transporte","Travel mode","Mode de déplacement","Modalità di spostamento"],
 walk:["A peu","A pie","Walking","À pied","A piedi"],
 transit:["Transport públic","Transporte público","Public transport","Transports en commun","Trasporto pubblico"],
 drive:["Cotxe","Coche","Driving","Voiture","Auto"],
 margin:["Marge de seguretat (min)","Margen de seguridad (min)","Safety buffer (min)","Marge de sécurité (min)","Margine di sicurezza (min)"],
 marginError:["Indica entre 0 i 180 minuts sencers.","Indica entre 0 y 180 minutos enteros.","Enter a whole number from 0 to 180.","Saisissez un nombre entier entre 0 et 180.","Inserisci un numero intero tra 0 e 180."],
 locate:["Calcula amb la meva ubicació","Calcular con mi ubicación","Calculate using my location","Calculer depuis ma position","Calcola dalla mia posizione"],
 calculate:["Calcula el trajecte","Calcular el trayecto","Calculate journey","Calculer le trajet","Calcola il tragitto"],
 locating:["Obtenint la ubicació…","Obteniendo la ubicación…","Getting your location…","Recherche de votre position…","Rilevamento della posizione…"],
 calculating:["Calculant el trajecte…","Calculando el trayecto…","Calculating the journey…","Calcul du trajet…","Calcolo del tragitto…"],
 duration:["Trajecte estimat","Trayecto estimado","Estimated journey","Trajet estimé","Tragitto stimato"],
 leave:["Sortida recomanada","Salida recomendada","Recommended departure","Départ conseillé","Partenza consigliata"],
 available:["Marge disponible amb la reserva de seguretat","Margen disponible con el margen de seguridad","Spare time after the safety buffer","Marge disponible après la marge de sécurité","Margine disponibile dopo il margine di sicurezza"],
 minutes:["{n} min","{n} min","{n} min","{n} min","{n} min"],
 onTime:["Vas bé de temps","Vas bien de tiempo","You have time","Vous avez le temps","Hai tempo"],
 soon:["Has de sortir aviat","Tienes que salir pronto","Leave soon","Partez bientôt","Parti presto"],
 late:["Marge insuficient","Margen insuficiente","Not enough time","Marge insuffisante","Margine insufficiente"],
 route:["Obre la ruta","Abrir la ruta","Open directions","Ouvrir l’itinéraire","Apri le indicazioni"],
 ticket:["Obre l’entrada","Abrir la entrada","Open ticket","Ouvrir le billet","Apri il biglietto"],
 document:["Obre el document","Abrir el documento","Open document","Ouvrir le document","Apri il documento"],
 estimate:["Estimació sense trànsit en directe.","Estimación sin tráfico en directo.","Estimate without live traffic.","Estimation sans trafic en temps réel.","Stima senza traffico in tempo reale."],
 transitEstimate:["Cobertura variable. Consulta els horaris, les esperes i l’estat del servei abans de sortir.","Cobertura variable. Consulta los horarios, las esperas y el estado del servicio antes de salir.","Coverage varies. Check schedules, waiting times and service updates before leaving.","La couverture varie. Vérifiez les horaires, l’attente et l’état du service avant de partir.","La copertura varia. Controlla orari, attese e stato del servizio prima di partire."],
 offline:["Sense connexió. Cal cobertura per calcular un trajecte.","Sin conexión. Necesitas conexión para calcular el trayecto.","You’re offline. Connect to calculate a journey.","Hors connexion. Reconnectez-vous pour calculer le trajet.","Sei offline. Connettiti per calcolare il tragitto."],
 locationDenied:["Permís de localització denegat. Pots triar un lloc del viatge.","Permiso de ubicación denegado. Puedes elegir un lugar del viaje.","Location permission denied. You can choose a place from the trip.","Accès à la position refusé. Vous pouvez choisir un lieu du voyage.","Permesso di localizzazione negato. Puoi scegliere un luogo del viaggio."],
 locationUnavailable:["No s’ha pogut obtenir la ubicació. Pots triar un lloc del viatge.","No se ha podido obtener la ubicación. Puedes elegir un lugar del viaje.","Your location is unavailable. You can choose a place from the trip.","Position indisponible. Vous pouvez choisir un lieu du voyage.","Posizione non disponibile. Puoi scegliere un luogo del viaggio."],
 locationInaccurate:["La ubicació no és prou precisa. Pots triar un lloc del viatge.","La ubicación no es lo bastante precisa. Puedes elegir un lugar del viaje.","Your location isn’t precise enough. You can choose a place from the trip.","La position manque de précision. Vous pouvez choisir un lieu du voyage.","La posizione è troppo imprecisa. Puoi scegliere un luogo del viaggio."],
 originUnverified:["El servei no ha pogut verificar l’origen. Tria un altre punt.","El servicio no ha podido verificar el origen. Elige otro punto.","The starting point could not be verified. Choose another one.","Le point de départ n’a pas pu être vérifié. Choisissez-en un autre.","Impossibile verificare il punto di partenza. Scegline un altro."],
 destinationUnverified:["El servei no ha pogut verificar el punt d’arribada de l’activitat.","El servicio no ha podido verificar el punto de llegada de la actividad.","The activity’s arrival point could not be verified.","Le point d’arrivée de l’activité n’a pas pu être vérifié.","Impossibile verificare il punto di arrivo dell’attività."],
 noRoute:["El proveïdor no ha trobat cap ruta per a aquest mode.","El proveedor no ha encontrado una ruta para este modo.","The provider found no route for this mode.","Le fournisseur n’a trouvé aucun itinéraire pour ce mode.","Il fornitore non ha trovato percorsi per questa modalità."],
 limited:["S’ha arribat al límit de consultes. Torna-ho a provar més tard.","Se ha alcanzado el límite de consultas. Inténtalo más tarde.","Request limit reached. Try again later.","Limite de requêtes atteinte. Réessayez plus tard.","Limite di richieste raggiunto. Riprova più tardi."],
 service:["El servei de rutes no ha pogut donar una estimació fiable.","El servicio de rutas no ha podido dar una estimación fiable.","The routing service could not give a reliable estimate.","Le service d’itinéraires n’a pas pu fournir une estimation fiable.","Il servizio non ha potuto fornire una stima affidabile."],
 expired:["Torna a calcular el trajecte per actualitzar l’estimació.","Vuelve a calcular el trayecto para actualizar la estimación.","Recalculate the journey for an updated estimate.","Recalculez le trajet pour actualiser l’estimation.","Ricalcola il tragitto per aggiornare la stima."],
 stale:["L’agenda ha canviat. Actualitza-la i torna-ho a provar.","La agenda ha cambiado. Actualízala y vuelve a intentarlo.","The itinerary has changed. Refresh it and try again.","Le programme a changé. Actualisez-le puis réessayez.","Il programma è cambiato. Aggiornalo e riprova."]
};

export function departureLabel(language,key){
 const index=['ca','es','en','fr','it'].indexOf(language);
 return translations[key]?.[index<0?0:index]||'';
}

export function mountTripDeparture(root,{language,tripId,userId,online,current,invoke,geolocation,getStorage,readRow,getDocuments,openDocument,searchPlaces,planningDay=null,localToIso}){
 const t=key=>departureLabel(language,key);
 const pref='freya-departure-buffer-v1:'+userId;
 const formatter=new Intl.NumberFormat(language);
 const minutes=n=>t('minutes').replace('{n}',formatter.format(n));
 const planning=!!planningDay;
 const queue=new RouteQueue({invoke,ttl:0,parallel:1,max:6,timeoutMs:30000});
 const doc=root.ownerDocument;
 let plan,signature,selection,result,pending,message,token=0,sourceEnd=-Infinity,zone,selectedPlace=null,prepared=[],preparedSignature;
 root.lang=language;
 root.className='trip-home-card trip-departure';
 root.setAttribute('aria-labelledby','departureTitle');
 root.innerHTML=`<h3 id="departureTitle"><span aria-hidden="true">🧭</span> ${t(planning?'planTitle':'title')}</h3>
  <p><strong data-b1="target"></strong></p>
  <p class="muted hidden" data-b1="later">${t('later')}</p>
  <form novalidate>
   <div class="departure-controls">
    ${planning?`<label class="departure-origin">${t('planDestination')}<select data-b1="destination"></select></label>`:''}
    <label class="departure-origin">${t('origin')}<select data-b1="origin"></select></label>
    <label>${t('mode')}<select data-b1="mode">
      <option value="walk">${t('walk')}</option><option value="transit">${t('transit')}</option><option value="drive">${t('drive')}</option>
    </select></label>
    <label>${t('margin')}<input data-b1="margin" aria-describedby="departureStatus" type="number" inputmode="numeric" min="0" max="${MAX_MARGIN}" step="1"></label>
   </div>
   <div data-b1="placeSearch" class="departure-search hidden">
    <label>${t('placeQuery')}<input type="search" maxlength="200" data-b1="query"></label>
    <button class="secondary" type="button" data-b1="search">${t('search')}</button>
    <div data-b1="matches" class="trip-home-actions"></div>
   </div>
   ${planning?`<label class="departure-ready" data-b1="readyWrap">${t('planReady')}<input data-b1="ready" type="time"></label>`:''}
   <p class="muted" data-b1="originNote"></p>
   <button type="submit" data-b1="calculate"></button>
  </form>
  <p id="departureStatus" data-b1="status" role="status" aria-live="polite"></p>
  <div data-b1="result" class="hidden">
   <dl class="departure-summary">
    <div><dt>${t('duration')}</dt><dd data-b1="duration"></dd></div>
    <div><dt>${t('leave')}</dt><dd data-b1="leave"></dd></div>
    <div><dt>${t('available')}</dt><dd data-b1="available"></dd></div>
   </dl>
   <p class="muted" data-b1="quality"></p>
   <p class="muted"><a href="https://www.geoapify.com/">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a></p>
  </div>
  <div class="trip-home-actions departure-actions">
   <a class="hidden" data-b1="route" target="_blank" rel="noopener noreferrer">${t('route')}</a>
   <div data-b1="documents" class="departure-documents"></div>
  </div>`;
 const field=key=>root.querySelector(`[data-b1="${key}"]`);
 const form=root.querySelector('form');
 const origin=field('origin'),mode=field('mode'),margin=field('margin'),status=field('status');
 const button=field('calculate'),link=field('route'),target=field('target');
 const out=field('result'),group=field('documents');
 const query=field('query'),matches=field('matches'),search=field('search');
 const destination=field('destination'),ready=field('ready');
 let initial=DEFAULT_MARGIN;
 try{
  const stored=getStorage().getItem(pref);
  const value=stored===null?NaN:Number(stored);
  if(validMargin(value))initial=value;
 }catch{}
 margin.value=String(initial);
 function validMargin(value){return Number.isInteger(value)&&value>=0&&value<=MAX_MARGIN}
 function marginValue(){
  return margin.value.trim()===''?NaN:Number(margin.value);
 }
 function invalidate(){token++;pending=null;result=null;message=null;link.removeAttribute('href')}
 function originOption(label,value){
  const option=doc.createElement('option');option.textContent=label;option.value=value;return option;
 }
 function localTime(stamp,timeZone){
  return new Intl.DateTimeFormat(language,{timeZone,day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(stamp);
 }
 const lodging=()=>plan?.lodging?.find(item=>item.key===origin.value);
 const needsSearch=()=>origin.value==='selected'||!!lodging()&&!lodging().coordinates;
 function scheduledPrevious(){
  const previous=plan?.previous;
  return origin.value==='previous'&&previous?.timingKind==='exact'&&
   Date.parse(previous.endsAt)>=Date.parse(previous.startsAt)?previous:null;
 }
 function plannedOrigin(){
  const previous=scheduledPrevious();
  if(previous)return previous;
  if(!ready?.value||!zone)return null;
  const at=localToIso(planningDay+'T'+ready.value,zone);
  return {startsAt:at,endsAt:at,timingKind:'exact'};
 }
 function estimateFor(value,quote){
  if(!planning)return departureEstimate(plan.destination,quote,mode.value,value,Date.now(),sourceEnd);
  let scheduled;
  try{scheduled=plannedOrigin()}catch{}
  return plannedDepartureEstimate(plan.destination,quote,mode.value,value,Date.now(),scheduled);
 }
 function refresh(){
  const connected=online();
  if(!connected&&result){result=null;link.removeAttribute('href')}
  const value=marginValue();
  const estimate=result&&plan?estimateFor(value,result):null;
  const invalid=!validMargin(value);
  if(result&&!estimate&&!invalid){result=null;message='expired'}
  margin.setAttribute('aria-invalid',String(invalid));
  button.textContent=t(origin.value==='device'?'locate':'calculate');
  field('placeSearch').classList.toggle('hidden',!needsSearch());
  field('readyWrap')?.classList.toggle('hidden',!!scheduledPrevious());
  search.disabled=!connected||!!pending||query.value.trim().length<3;
  field('originNote').textContent=(needsSearch()&&selectedPlace?selectedPlace.canonical_name+' · ':'')+
   t(origin.value==='device'?'permission':'assumed')+
   ((planning?scheduledPrevious():origin.value==='previous')?' '+t('previousEnd'):'');
  button.disabled=!connected||!!pending||invalid||needsSearch()&&!selectedPlace;
  out.classList.toggle('hidden',!estimate);
  link.classList.toggle('hidden',!estimate);
  let invalidReady=false;
  if(planning&&estimate)try{plannedOrigin()}catch{invalidReady=true}
  status.textContent=t(!plan?(planning?'planEmpty':'noDestination'):!connected?'offline':
   invalid?'marginError':pending||message||(invalidReady?'invalidReady':estimate?.status)||'');
  status.dataset.departureStatus=estimate?.status||'';
  if(!estimate){link.removeAttribute('href');return}
  field('duration').textContent=minutes(estimate.duration);
  field('leave').textContent=localTime(estimate.leaveBy,zone);
  field('available').textContent=estimate.minutes===null?'—':minutes(estimate.minutes);
  field('quality').textContent=t(planning?'planQuality':mode.value==='transit'?'transitEstimate':'estimate')+
   (planning&&mode.value==='transit'?' '+t('transitEstimate'):'');
  link.href=estimate.url;
 }
 function show(items,next){
  setPlan(departurePlan(items,readRow,Date.now()),next);
 }
 function setPlan(planned,next){
  const key=JSON.stringify(planned&&[departureRef(planned.destination),planned.destination.startsAt,planned.previous?.key,
   planned.options.map(item=>[item.key,item.sourceUpdatedAt]),planned.lodging,next?.key]);
  if(key!==signature){
   invalidate();signature=key;plan=planned;
   form.hidden=!planned;
   selectedPlace=null;query.value='';matches.replaceChildren();
   origin.replaceChildren(...(planning?[]:[originOption(t('device'),'device')]));
   if(ready)ready.value='';
   group.replaceChildren();
   const later=plan&&!planning&&plan.destination.key!==next?.key;
   target.textContent=plan&&!planning?plan.destination.title+(later?' · '+localTime(Date.parse(plan.destination.startsAt),plan.destination.timeZone):''):'';
   target.parentElement.hidden=planning;
   field('later').classList.toggle('hidden',!later);
   if(plan){
    if(plan.previous)origin.append(originOption(t('previous')+' · '+plan.previous.title,'previous'));
    for(const room of plan.lodging||[])origin.append(originOption(t('planLodging')+' · '+room.title,room.key));
    if(planning&&!plan.previous&&!plan.lodging.length)origin.append(originOption(t('selected'),'selected'));
    const saved=doc.createElement('optgroup');saved.label=t('saved');
    for(const item of plan.options)if(item!==plan.previous)saved.append(originOption(item.title,item.key));
    if(saved.children.length)origin.append(saved);
    if(!planning||plan.previous||plan.lodging.length)origin.append(originOption(t('selected'),'selected'));
    if(later||planning){
     for(const document of getDocuments(plan.destination)){
      const action=doc.createElement('button');action.type='button';
      action.textContent=t(document.role==='ticket'?'ticket':'document');
      action.onclick=()=>openDocument(plan.destination,document.documentId,current);
      group.append(action);
     }
    }
   }
   selection=origin.value;
   if(planning&&lodging()&&!lodging().coordinates)query.value=lodging().query;
  }
  refresh();
 }
 function showPlanned(items,accommodations){
  prepared=plannedDepartureChoices(items,accommodations,readRow,tripId,planningDay);
  const key=JSON.stringify(prepared.map(({destination,previous,options,lodging})=>
   [destination.key,destination.sourceUpdatedAt,previous?.key,options.map(item=>[item.key,item.sourceUpdatedAt]),lodging]));
  if(key!==preparedSignature){
   const retained=destination.value;
   preparedSignature=key;
   destination.replaceChildren(...prepared.map(({destination:item})=>
    originOption(item.title+' · '+localTime(Date.parse(item.startsAt),item.timeZone),item.key)));
   destination.value=prepared.some(({destination:item})=>item.key===retained)?retained:
    prepared.find(p=>p.previous)?.destination.key||prepared[0]?.destination.key||'';
  }
  selectPrepared();
 }
 function selectPrepared(){setPlan(prepared.find(p=>p.destination.key===destination.value)||null)}
 if(destination)destination.onchange=selectPrepared;
 if(ready)ready.oninput=refresh;
 origin.onchange=()=>{
  selection=origin.value;invalidate();
  if(planning){
   selectedPlace=null;matches.replaceChildren();query.value=lodging()?.query||'';
   ready.value='';
  }
  refresh();
 };
 mode.onchange=()=>{invalidate();refresh()};
 query.oninput=()=>{selectedPlace=null;matches.replaceChildren();invalidate();refresh()};
 search.onclick=async()=>{
  if(search.disabled||!current()||!online())return;
  invalidate();const request=token;
  selectedPlace=null;matches.replaceChildren();pending='searching';refresh();
  const fresh=()=>token===request&&current();
  try{
   const candidates=await searchPlaces({text:query.value.trim(),language});
   if(!fresh())return;
   for(const candidate of candidates.slice(0,5)){
    let place;try{place=validatePlace(candidate.place)}catch{continue}
    if(place.coordinate_role!=='exact_location')continue;
    const action=doc.createElement('button');action.type='button';
    action.textContent=place.formatted_address||[place.canonical_name,place.locality,place.country_code].filter(Boolean).join(' · ');
    action.onclick=()=>{
     if(!current()||!online())return;
     selectedPlace=place;matches.replaceChildren();invalidate();refresh();button.focus({preventScroll:true});
    };
    matches.append(action);
   }
   message=matches.children.length?'choosePlace':'noPlace';
  }catch(error){if(fresh())message=error.message==='no_match'?'noPlace':error.message==='rate_limited'?'limited':'service'}
  finally{if(fresh()){pending=null;refresh()}}
 };
 margin.oninput=refresh;
 margin.onchange=()=>{
  const value=marginValue();
  if(validMargin(value))try{getStorage().setItem(pref,String(value))}catch{}
  refresh();
 };
 form.onsubmit=async event=>{
  event.preventDefault();
  if(!plan||!current()||!online()||button.disabled)return;
  const request=++token,device=selection==='device',targetItem=plan.destination,selectedMode=mode.value;
  const picked=needsSearch()?selectedPlace:null,room=lodging();
  const chosen=selection==='previous'?plan.previous:plan.options.find(item=>item.key===selection);
  const fresh=()=>token===request&&current();
  result=null;message=null;pending=device?'locating':'calculating';refresh();
  try{
   const from=device?await deviceRouteOrigin(geolocation()):picked?
    {type:'selected',latitude:picked.latitude,longitude:picked.longitude}:room?.coordinates||(chosen&&departureRef(chosen));
   if(!fresh())return;
   if(!online()){message='offline';return}
   if(!from){message='originUnverified';return}
   pending='calculating';refresh();
   const body={kind:'departure',trip_id:tripId,origin:from,destination:departureRef(targetItem),mode:selectedMode};
   const response=await queue.request(String(request),body,{retry:true});
   if(!fresh())return;
   sourceEnd=selection==='previous'?Date.parse(chosen.endsAt):-Infinity;
   zone=[picked?.timezone,room?.timeZone,chosen?.timeZone,targetItem.timeZone].find(validIana);
   if(response?.origin?.error)message='originUnverified';
   else if(response?.destination?.error)message='destinationUnverified';
   else if(['no_route','mode_unavailable'].includes(response?.error))message='noRoute';
   else if(['limit','rate_limited'].includes(response?.error))message='limited';
   else if(['stale_record','unavailable'].includes(response?.error))message='stale';
   else if(estimateFor(DEFAULT_MARGIN,response))result=response;
   else message='service';
  }catch(error){
   if(fresh())message=['locationDenied','locationUnavailable','locationInaccurate'].includes(error.message)?error.message:'service';
  }finally{
   if(fresh()){pending=null;refresh()}
  }
 };
 const connectivity=new AbortController();
 if(planning)for(const event of ['online','offline'])doc.defaultView.addEventListener(event,refresh,{signal:connectivity.signal});
 return {show,showPlanned,dispose(){connectivity.abort();invalidate();queue.reset('');root.remove()}};
}

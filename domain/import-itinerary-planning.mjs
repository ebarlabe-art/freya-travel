// RIG-04: orchestration of existing matching, reconciliation and route contracts.
// Every result is an in-memory proposal. No persistence or provider calls here.
import {equivalentItineraryPlace,changeItineraryReviewItem} from './import-itinerary-review.mjs';
import {planItineraryReconciliation} from './import-itinerary-reconciliation.mjs';
import {routeFeasibility,routeIsVerified} from './itinerary-route.mjs';
import {classifyReconciliationTiming} from './import-itinerary-reconciliation-ui.mjs';
const clean=v=>String(v||'').normalize('NFKC').trim().toLowerCase();
const stamp=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
export const planningSignature=value=>JSON.stringify(value);
const local=(value,zone)=>{try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));return {local_date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute}}catch{return null}};
// An alias alone is NEVER permission to erase a different time, note or address.
export function automaticEquivalentDecisions(snapshot,existing,decisions=[]){
 const decided=new Set(decisions.map(d=>d.source_order)),used=new Set(decisions.map(d=>d.target_id));
 const additions=[];
 for(const item of snapshot.items){
  if(decided.has(item.source_order)||!item.included||item.classification_hint!=='manual'||item.review_flags.some(f=>!f.startsWith('possible_existing_')&&f!=='possible_overlap_in_review')||item.source_warnings?.length)continue;
  const v=item.values,found=existing.filter(old=>equivalentItineraryPlace(v,old));
  if(found.length!==1)continue;
  const old=found[0],start=old.starts_at&&local(old.starts_at,old.time_zone),end=old.ends_at&&local(old.ends_at,old.time_zone);
  if(used.has(old.id)||old.status!=='planned'||old.is_optional||classifyReconciliationTiming(v).is_tentative||old.timing_kind!=='exact'||!v.start_local_time||!v.end_local_time)continue;
  if(v.local_date!==start?.local_date||v.start_local_time!==start?.time||v.end_local_time!==end?.time||end.local_date!==v.local_date||v.time_zone!==old.time_zone)continue;
  if(['notes','address'].some(k=>clean(v[k])!==clean(old[k])))continue;
  if(clean(v.location_name)!==clean(old.location_name)&&!equivalentItineraryPlace({title:v.location_name,city:v.city},{title:old.location_name,city:old.city}))continue;
  // A second PDF entry for this same landmark remains explicitly reviewable.
  if(snapshot.items.filter(other=>other.included&&equivalentItineraryPlace(other.values,v)).length!==1)continue;
  additions.push({source_order:item.source_order,action:'keep',target_id:old.id,automatic:true});used.add(old.id);
 }
 return additions;
}
const projection=row=>({key:'manual:'+row.id,sourceId:row.id,sourceType:'manual',title:row.title,localDate:row.localDate||row.local_date||(row.starts_at&&local(row.starts_at,row.time_zone)?.local_date)||'',startsAt:row.starts_at,endsAt:row.ends_at,timeZone:row.time_zone,timingKind:row.timing_kind,status:row.status,sourceUpdatedAt:row.updated_at,location_name:row.location_name||'',address:row.address||'',city:row.city||'',fixed:!!row.is_fixed,mutable:false});
export function combineImportItinerary(snapshot,state,{projection:agenda=[],convertLocalTime}={}){
 const plan=planItineraryReconciliation({snapshot,existing:state.existing,decisions:state.decisions,retireExistingIds:state.retire});
 const replaced=new Set([...plan.retire.map(r=>r.id),...plan.rows.filter(r=>r.action==='update').map(r=>r.target_id)]);
 const items=state.existing.filter(r=>!replaced.has(r.id)&&r.status!=='cancelled').map(projection);
 // Copy only scheduling fields, never documents, booking codes or private details.
 for(const row of agenda.filter(r=>r.sourceType!=='manual'&&!r.isCancelled&&r.status!=='cancelled'))items.push(Object.fromEntries(['key','sourceId','sourceType','title','localDate','startsAt','endsAt','timeZone','timingKind','status','sourceUpdatedAt'].map(k=>[k,row[k]])));
 for(const row of plan.rows.filter(r=>['add','update'].includes(r.action))){
  const item=snapshot.items.find(i=>i.source_order===row.source_order),v=row.values,conditional=classifyReconciliationTiming(v).is_tentative;
  const convert=t=>t&&v.local_date&&v.time_zone?convertLocalTime(v.local_date+'T'+t,v.time_zone):null;
  const old=state.existing.find(r=>r.id===row.target_id);
  items.push({key:'pdf:'+row.source_order,sourceType:'manual',sourceId:row.target_id,sourceOrder:row.source_order,title:v.title,localDate:v.local_date,startsAt:convert(v.start_local_time),endsAt:convert(v.end_local_time),timeZone:v.time_zone,timingKind:conditional?'approximate':v.start_local_time?'exact':'date',sourceUpdatedAt:old?.updated_at,location_name:v.location_name,address:v.address,city:v.city,values:{...v},conditional,mutable:item.classification_hint==='manual'&&!old?.is_fixed&&!/reserva(?:da|t|tada)?|confirmad[ao]|confirmed|booked|ticket|bitllet|vol\b|flight\b/i.test(v.title+' '+(v.notes||'')),status:'planned',fixed:false});
 }
 if(items.length>200)throw Error('Limita la revisió a 200 elements per analitzar-la al mòbil.');
 return {items,plan,complete:plan.complete};
}
export function planningRouteKey(a,b){return JSON.stringify([a.key,b.key,...[a,b].map(x=>[x.title,x.location_name,x.address,x.city,x.sourceUpdatedAt])])}
export function planningPairs(items){
 const ordered=items.filter(x=>stamp(x.startsAt)!==null).sort((a,b)=>stamp(a.startsAt)-stamp(b.startsAt));
 return ordered.slice(1).flatMap((b,i)=>{const a=ordered[i];return a.localDate===b.localDate?[{a,b,key:planningRouteKey(a,b)}]:[]});
}
export function planningRouteInput(pair,tripId){
 const endpoint=item=>item.values?{draft:Object.fromEntries(['title','location_name','address','city'].map(k=>[k,item.values[k]||'']))}:['manual','activity'].includes(item.sourceType)&&item.sourceId&&item.sourceUpdatedAt?{type:item.sourceType,id:item.sourceId,updated_at:item.sourceUpdatedAt}:null;
 const origin=endpoint(pair.a),destination=endpoint(pair.b);
 return origin&&destination?{kind:'draft',trip_id:tripId,mode:'walk',origin,destination}:null;
}
export const verifiedPlanningRoute=(entry,now)=>routeIsVerified(entry)&&typeof entry.route.source==='string'&&entry.route.source.trim().length>0&&stamp(entry.route.calculated_at)!==null&&now-stamp(entry.route.calculated_at)>=0&&now-stamp(entry.route.calculated_at)<300000;
export function assessCombinedItinerary(combined,{routes={},openings={},bufferMinutes=5,now=Date.now(),sourcesReady=true}={}){
 const issues=[],items=combined.items;
 const add=(kind,code,keys,message)=>issues.push({kind,code,keys,message});
 if(!items.length)add('pending','empty',[],'No hi ha activitats per avaluar.');
 if(!combined.complete)add('pending','decisions',[],'Queden candidates pendents de decidir.');
 if(!sourcesReady)add('pending','sources',[],'Encara falten fonts del viatge; les reserves poden estar incompletes.');
 for(const x of items){
  const start=stamp(x.startsAt),end=stamp(x.endsAt),exact=x.timingKind==='exact';
  if(!exact||start===null||end===null||end<=start)add('pending','duration',[x.key],x.title+': cal confirmar hores i durada de la visita.');
  if(x.conditional)add('pending','conditional',[x.key],x.title+': pla condicional; no és una reserva confirmada.');
  if(x.sourceType==='manual'||x.sourceType==='activity'){
   if(!clean(x.location_name)&&!clean(x.address))add('pending','location',[x.key],x.title+': ubicació pendent de verificar.');
   if(/\b(bus|autob[uú]s|tren|train|metro|taxi|transfer|transport|trasllat|shuttle|ferry|autocar|flight|vol)\b/i.test(x.title+' '+(x.values?.notes||'')))add('pending','mobility',[x.key],x.title+': transport real pendent de verificar; el càlcul a peu no el valida.');
   const h=openings[x.key];
   // Opening evidence is scoped to the exact place, date and timezone, with source.
   const valid=h?.verified===true&&h.source&&h.date===x.localDate&&h.timeZone===x.timeZone&&h.place===planningSignature([x.title,x.location_name,x.address,x.city])&&stamp(h.checkedAt)!==null&&now-stamp(h.checkedAt)>=0&&now-stamp(h.checkedAt)<86400000&&Array.isArray(h.intervals)&&h.intervals.every(p=>p.length===2&&stamp(p[0])!==null&&stamp(p[1])>stamp(p[0]));
   if(!valid)add('pending','opening',[x.key],x.title+': horari d’obertura pendent de verificar.');
   else if(exact&&start!==null&&end!==null&&!h.intervals.some(([a,b])=>stamp(a)<=start&&stamp(b)>=end))add('conflict','closed',[x.key],x.title+': fora de l’horari d’obertura verificat.');
  }
 }
 // UTC instants catch midnight, timezone and overlapping long reservations.
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
  const a=items[i],b=items[j],as=stamp(a.startsAt),ae=stamp(a.endsAt),bs=stamp(b.startsAt),be=stamp(b.endsAt);
  if(a.timingKind==='exact'&&b.timingKind==='exact'&&as!==null&&bs!==null&&((ae!==null&&be!==null&&as<be&&bs<ae)||(ae!==null&&be===null&&as<=bs&&bs<ae)||(be!==null&&ae===null&&bs<=as&&as<be)))add('conflict','overlap',[a.key,b.key],a.title+' i '+b.title+': les franges horàries se solapen.');
 }
 for(const {a,b,key} of planningPairs(items)){
  const entry=routes[key];
  if(!verifiedPlanningRoute(entry,now)){add('pending','route',[a.key,b.key],a.title+' → '+b.title+': trajecte pendent de verificar'+(entry?.error?' ('+entry.error+')':'')+'.');continue}
  if(entry.route.mode==='walk'&&entry.route.duration_seconds>900)add('pending','walking_assumption',[a.key,b.key],'Trajecte a peu superior a 15 min: cal confirmar la mobilitat real o comprovar un altre transport a l’agenda.');
  const result=routeFeasibility(a,b,entry.route,bufferMinutes);
  if(result.status==='No factible')add('conflict','travel',[a.key,b.key],a.title+' → '+b.title+': no hi cap el trajecte calculat.');
  else if(result.status==='Molt ajustat')add('tight','margin',[a.key,b.key],a.title+' → '+b.title+': marge inferior a '+bufferMinutes+' min.');
  else if(result.status==='Dades insuficients')add('pending','route_duration',[a.key,b.key],result.reason);
  if(entry.route.mode==='transit')add('pending','transit',[a.key,b.key],'Transport públic estimat: cal comprovar sortides i servei del dia.');
 }
 const counts={conflicts:issues.filter(i=>i.kind==='conflict').length,tight:issues.filter(i=>i.kind==='tight').length,pending:issues.filter(i=>i.kind==='pending').length};
 return {issues,counts,status:counts.conflicts?'conflict':counts.pending?'pending':counts.tight?'tight':'supported',label:counts.conflicts?'Hi ha incompatibilitats':counts.pending?'Viabilitat pendent de verificar':counts.tight?'Itinerari ajustat':'Compatible amb les dades verificades; els trajectes són estimacions'};
}
export function proposeItinerarySolutions(combined,options,context){
 const base=assessCombinedItinerary(combined,options),bad=new Set(base.issues.filter(x=>x.kind==='conflict'||x.kind==='tight').flatMap(x=>x.keys)),proposals=[];
 const signature=planningSignature(combined);
 if(options.sourcesReady===false)return proposals;
 for(const item of combined.items.filter(x=>x.mutable&&bad.has(x.key)).slice(0,10)){
  const start=stamp(item.startsAt),end=stamp(item.endsAt),duration=end-start;
  if(start===null||end===null||duration<=0||duration>86400000||item.conditional)continue;
  const candidates=new Set();
  for(const other of combined.items.filter(x=>x.key!==item.key&&x.localDate===item.localDate)){
   const os=stamp(other.startsAt),oe=stamp(other.endsAt);
   const durationFor=(a,b)=>{const entry=options.routes?.[planningRouteKey(a,b)];return verifiedPlanningRoute(entry,options.now??Date.now())?entry.route.duration_seconds:0};
   const margin=(options.bufferMinutes??5)*60000;
   if(oe!==null)candidates.add(oe+durationFor(other,item)*1000+margin);
   if(os!==null)candidates.add(os-duration-durationFor(item,other)*1000-margin);
  }
  // Bounded alternate-day proposals inside the trip; never move a reservation.
  for(const day of context.days||[]){if(day===item.localDate)continue;const hour=local(item.startsAt,item.timeZone)?.time;const value=hour&&context.convertLocalTime(day+'T'+hour,item.timeZone);if(stamp(value)!==null)candidates.add(stamp(value))}
  let count=0;
  for(const at of [...candidates].slice(0,40)){
   const first=local(at,item.timeZone),last=local(at+duration,item.timeZone);
   if(!first||!last||first.local_date!==last.local_date||first.local_date<context.startDate||first.local_date>context.endDate)continue;
   const moved={...item,startsAt:new Date(at).toISOString(),endsAt:new Date(at+duration).toISOString(),localDate:first.local_date};
   const trial={...combined,items:combined.items.map(x=>x.key===item.key?moved:x)},next=assessCombinedItinerary(trial,options);
   const oldKeys=new Set(base.issues.filter(x=>x.kind==='conflict').map(x=>x.code+':'+[...x.keys].sort().join('|')));
   if(next.issues.some(x=>x.kind==='conflict'&&!oldKeys.has(x.code+':'+[...x.keys].sort().join('|'))))continue;
   if(next.issues.some(x=>x.kind==='conflict'&&x.keys.includes(item.key)))continue;
   if(next.counts.conflicts>=base.counts.conflicts&&next.counts.tight>=base.counts.tight)continue;
   proposals.push({id:proposals.length,signature,sourceOrder:item.sourceOrder,edits:{local_date:first.local_date,start_local_time:first.time,end_local_time:last.time},label:item.title+': '+first.local_date+' '+first.time+'–'+last.time,note:next.counts.pending?'Ajust de l’esborrany: redueix el conflicte conegut. Viabilitat pendent; cal verificar les dades que falten.':'Compatible amb les dades verificades; revisa el resultat.',kind:first.local_date===item.localDate?'time_order':'day'});
   if(++count===3||proposals.length>=30)break;
  }
  if(proposals.length>=30)break;
 }
 return proposals;
}
export function acceptItinerarySolution(review,solution,combined,options,context){
 if(!solution||solution.signature!==planningSignature(combined))throw Error('L’esborrany ha canviat. Torna a analitzar-lo.');
 if(!options||!context||!proposeItinerarySolutions(combined,options,context).some(p=>p.sourceOrder===solution.sourceOrder&&planningSignature(p.edits)===planningSignature(solution.edits)))throw Error('Les dades de viabilitat han canviat. Revisa les noves propostes.');
 const target=combined.items.find(x=>x.sourceOrder===solution.sourceOrder);
 if(!target?.mutable)throw Error('Aquesta reserva no es pot modificar.');
 const index=review.items.findIndex(x=>x.source_order===solution.sourceOrder);
 const next=structuredClone(review);
 for(const [key,value]of Object.entries(solution.edits))changeItineraryReviewItem(next,index,key,value);
 return next;
}

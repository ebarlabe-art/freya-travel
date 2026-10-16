// Read-only routing/feasibility boundary. Projection order belongs to the agenda.
export const routeModes=Object.freeze({walk:'A peu',drive:'Cotxe',transit:'Transport públic'});
export function visitPairs(items,tripId,day){
 const active=items.filter(x=>x.tripId===tripId&&x.localDate===day&&!x.isCancelled&&x.status!=='cancelled');
 const pairs=[];
 for(let i=1;i<active.length;i++){
  const a=active[i-1],b=active[i];
  // Other reservation types remain barriers: never imply walking across a flight.
  if(![a,b].every(x=>['manual','activity'].includes(x.sourceType)&&!x.isTransport))continue;
  pairs.push({key:JSON.stringify([tripId,day,a.key,b.key,a.sourceUpdatedAt,b.sourceUpdatedAt]),origin:a,destination:b});
 }
 return pairs;
}
const instant=s=>typeof s==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
export function routeFeasibility(a,b,route,bufferMinutes){
 const insufficient=reason=>({status:'Dades insuficients',reason});
 if(a.timingKind!=='exact'||b.timingKind!=='exact')return insufficient('Calen hores exactes; una franja o hora aproximada no confirma el marge.');
 const start=instant(a.startsAt),end=instant(a.endsAt),next=instant(b.startsAt);
 if(start===null||end===null||next===null||end<start)return insufficient('Falta un inici o final confirmat de la primera visita, o l’inici de la següent.');
 if(!route||route.method!=='routing'||!Number.isFinite(route.duration_seconds)||route.duration_seconds<0)return insufficient('Falta una ruta calculada per al mode escollit.');
 if(typeof bufferMinutes!=='number'||!Number.isFinite(bufferMinutes)||bufferMinutes<0||bufferMinutes>180)return insufficient('Indica el marge que vols reservar, en minuts.');
 const gap=(next-end)/60000,remaining=gap-route.duration_seconds/60;
 return {status:remaining<0?'No factible':remaining<bufferMinutes?'Molt ajustat':'Factible amb marge estimat',gapMinutes:gap,remainingMinutes:remaining,
  reason:remaining<0?'El final de la visita i el trajecte superen l’inici següent.':remaining<bufferMinutes?'Hi cap el trajecte, però no el marge que has indicat.':'Hi caben el trajecte i el marge indicat. No garanteix puntualitat ni horaris d’obertura.'};
}
// Open reliable endpoints in the traveller's map application. The map service
// may propose a different route; Freya's estimate remains provider attributed.
export function routeMapUrl(route){
 const points=[route?.origin,route?.destination];
 if(route?.method!=='routing'||!routeModes[route.mode]||!points.every(p=>p&&
  Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180))return null;
 const params=new URLSearchParams({api:'1',origin:`${points[0].latitude},${points[0].longitude}`,
  destination:`${points[1].latitude},${points[1].longitude}`,travelmode:{walk:'walking',drive:'driving',transit:'transit'}[route.mode]});
 return 'https://www.google.com/maps/dir/?'+params;
}
export const routeReasons=Object.freeze({missing_place:'Falta un lloc o una adreça desats.',missing_context:'Falta una ciutat i un país de destinació inequívocs.',ambiguous:'Hi ha més d’un lloc possible. Tria’l per a aquest càlcul.',no_match:'No s’ha pogut verificar el lloc en aquesta ciutat i país.',no_route:'No hi ha cap ruta calculable per a aquests llocs.',mode_unavailable:'Aquest mode no està disponible per a aquest trajecte.',rate_limited:'Límit de consultes assolit. Reintenta més tard.',provider_unavailable:'El servei de rutes no respon. Reintenta més tard.',invalid_response:'La resposta del servei no permet verificar la ruta.',stale_record:'Les visites han canviat. Actualitza l’agenda.',unavailable:'No tens accés a aquest viatge o les visites ja no existeixen.',unauthorized:'Cal iniciar sessió de nou.',offline:'Sense connexió: no es pot consultar una ruta actual.',limit:'Límit preventiu de consultes del dia. Reobre el dia més tard.'});
// Bounded parallelism, in-flight deduplication and brief memory cache. No offline truth.
export class RouteQueue{
 constructor({invoke,now=Date.now,max=20,ttl=300000,parallel=2,timeoutMs=35000}){Object.assign(this,{invoke,now,max,ttl,parallel,timeoutMs});this.reset('')}
 reset(scope){for(const job of this.waiting||[])job.resolve({error:'stale_record'});this.scope=scope;this.entries=new Map();this.count=0;this.windowStart=this.now();this.active=0;this.waiting=[];this.epoch=(this.epoch||0)+1;this.blocked=false}
 async request(key,input,{online=true,retry=false}={}){
  if(!online)return {error:'offline'};
  const prior=this.entries.get(key);
  if(prior?.promise)return prior.promise;
  if(!retry&&prior&&prior.until>this.now())return prior.value;
  if(this.blocked&&!retry)return {error:'provider_unavailable'};
  if(this.now()-this.windowStart>=60000){this.count=0;this.windowStart=this.now()}
  if(this.count>=this.max)return {error:'limit'};
  const epoch=this.epoch;this.count++;
  const run=async()=>{
   if(epoch!==this.epoch)return {error:'stale_record'};
   this.active++;
   let value,timer;
   try{value=this.blocked&&!retry?{error:'provider_unavailable'}:await Promise.race([this.invoke(input),new Promise(resolve=>{timer=setTimeout(()=>resolve({error:'provider_unavailable'}),this.timeoutMs)})])}catch{value={error:'provider_unavailable'}}finally{clearTimeout(timer)}
   if(epoch!==this.epoch)return {error:'stale_record'};
   this.active--;if(['rate_limited','provider_unavailable'].includes(value.error))this.blocked=true;else if(retry)this.blocked=false;
   if(this.entries.size>=200)this.entries.delete(this.entries.keys().next().value);
   this.entries.set(key,{value,until:this.now()+this.ttl});
   const job=this.waiting.shift();if(job)job.resolve(job.run());return value;
  };
  const promise=this.active<this.parallel?run():new Promise(resolve=>this.waiting.push({run,resolve}));
  this.entries.set(key,{promise});return promise;
 }
}

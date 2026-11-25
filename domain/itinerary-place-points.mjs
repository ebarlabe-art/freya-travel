// Ordered geography belongs to one existing activity; never creates agenda rows.
export const MAX_POINTS=12;
export const normalizePointName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/centre historic|historic cent(?:er|re)/g,'centro storico').replace(/\b(?:basílica|basilique)\b/g,'basilica').replace(/[^a-z0-9]+/g,' ').replace(/\b(?:de|di|del|della|dell|la|le|il)\b/g,' ').replace(/\s+/g,' ').trim();
const anchor='(?:Piazza|Plaça|Plaza|Square|Fontana|Font|Fountain|Via|Viale|Carrer|Street|Museu|Museum|Museo|Catedral|Cathedral|Castell|Castle|Basílica|Basilica|Torre|Tower|Mercat|Market|Parc|Park|Palau|Palazzo|Finestrella|Archiginnasio|Teatro|Theatre|Theater|Quadrilatero|Due Torri|centre històric|centro storico|historic centre|B[oò]sc|Fageda)';
function extractLegacyActivityPoints(row){
 // Explicit addresses/venues take precedence over prose; never infer a restaurant from a meal.
 const address=String(row.address||'').trim();
 if(address)return [{id:'point-0',query:address,status:'pending',place:null}];
 const explicit=String(row.location_name||row.venue_name||'').trim();
 const raw=(row.resolved_location?String(row.title||''):explicit)||String(row.title||'');
 // Walks to a named natural landmark are visits too. Keep the distinctive
 // destination (not the generic word 'passeig') for safe geocoding.
 const walkingDestination=!explicit?raw.match(/^(?:passeig|caminada|excursió|ruta|visita)\s+(?:(?:a|al|a la|pel|per|per la|fins a|fins al|fins a la)\s+)?((?:bosc|fageda|parc|jardins|llac|estany|cascada|castell|església|monestir)\s+(?:de|del|dels|de la|d\u2019|d')\s*[\p{L}\p{M}\p{N}\s\u2019'-]+?)(?=\s*[,;.(]|$)/iu):null;
 if(walkingDestination)return [{id:'point-0',query:walkingDestination[1].trim(),status:'pending',place:null}];
 // A meal can also identify a town worth visiting. Extract only an explicit
 // settlement before a named establishment, never infer a restaurant from "dinar".
 // This remains a pending suggestion: no provider identity is assigned silently.
 const meal= !explicit?raw.match(/^(?:dinar|sopar|esmorzar|aperitiu|lunch|dinner|breakfast)\s+(?:a|al|a la|en)\s+(.+?)(?:\s+(?:a|al|a la|en)\s+((?:chez|restaurant|caf[eè]|bar|bistrot|bistro|taverna|hostal|hotel)\b.+))?$/iu):null;
 if(meal)return [...new Set([meal[1],meal[2]].filter(Boolean).map(x=>x.trim()))].map((query,i)=>({id:'point-'+i,query,status:'pending',place:null}));
 if(!raw||/^(?:sortida|arribada|trasllat|transfer|vol|flight|taxi|tren|metro|bus)\b/i.test(raw))return [];
 const parts=raw.split(new RegExp('\\s*[,;]\\s*|\\s+i\\s+(?=(?:visita\\s+a\\s+)?'+anchor+'\\b)|\\s+i\\s+(?=(?:dinar|sopar|esmorzar|aperitiu)\\b)','iu'));
 const names=parts.flatMap(part=>{
  const hit=part.match(new RegExp('(?<![\\p{L}\\p{N}])'+anchor+'(?=\\s|$|[,.;])(?:\\s+[\\p{L}’\'-]+)*','iu'));
  const leading=part.replace(/^(?:opcional:\s*)?(?:visita\s+(?:a|al|a la)\s+)?/i,'').trim();
  const named=hit&&leading.endsWith(hit[0])&&!/^(?:passeig|aperitiu|sopar|esmorzar|dinar|opcional)\b/i.test(leading)?leading:hit?.[0];
  let name=(named||(explicit?part:'')).replace(/\s+(?:amb|durant|segons|despres|després|abans)\b.*$/iu,'').trim().replace(/[.!:]$/,'');
  if(/^(?:dinar|sopar|esmorzar|aperitiu|lunch|dinner|breakfast)\b/i.test(name))name='';
  return name?[name]:[];
 });
 // A simple named visit outside the vocabulary is searched conservatively as a whole.
 if(!names.length&&!explicit){const simple=raw.replace(/^(?:opcional:\s*)?(?:visita\s+(?:a|al|a la)\s+)?/i,'').trim();if(simple&&/\p{L}/u.test(simple)&&!/\b(?:passeig|dinar|sopar|esmorzar|aperitiu|lunch|dinner|breakfast|free time|centre|zona)\b/i.test(simple)&&!/[,:;]/.test(simple))names.push(simple)}
 return [...new Map(names.map(name=>[normalizePointName(name),name])).values()].slice(0,MAX_POINTS).map((query,i)=>({id:'point-'+i,query,status:'pending',place:null}));
}
export function googleMapsUrl(text){
 if(typeof text!=='string'||text.length>500)return null;
 try{
  const url=new URL(text);
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  if(url.hostname==='maps.app.goo.gl'&&/^\/[a-z0-9_-]+$/i.test(url.pathname))return url;
  if(url.hostname==='goo.gl'&&/^\/maps\/[a-z0-9_-]+$/i.test(url.pathname))return url;
  if(['www.google.com','maps.google.com','google.com'].includes(url.hostname)&&
   (/^\/maps(?:\/|$)/.test(url.pathname)||(url.hostname==='maps.google.com'&&url.pathname==='/')))return url;
 }catch{}
 return null;
}
const point=query=>({id:'point-0',query,status:'pending',place:null});
const addressLabel=/^(?:adreça|dirección|address|adresse|indirizzo)\s*:\s*/iu;
const streetCue=/\b(?:rue|chaussée|avenue|boulevard|straat|steenweg|carrer|calle|via|viale|iela|street|road|avenida)\b|\p{L}+steenweg\b/iu;
const venueCue=/(?:^|\s|[’'])(hotel|hôtel|albergo|restaurant|restaurante|ristorante|parlament|parlement|parliament|parlamento|aeroport|aéroport|airport|aeropuerto|aeroporto)\b.+/iu;
const noteLines=row=>String(row.notes||'').split('\n').map(line=>line.trim()).filter(Boolean);
function explicitNotesVenue(lines){
 const venues=[...new Set(lines.map(line=>line.match(venueCue)?.[0]?.replace(/^[\s’']+/, '').trim()).filter(name=>name&&name.length<=200))];
 return venues.length===1?venues[0]:'';
}
function explicitNotesPlace(row){
 const lines=noteLines(row);
 const links=[...new Set(lines.flatMap(line=>line.match(/https:\/\/[^\s<>"']+/gi)||[]).map(value=>value.replace(/[.)]+$/,'')))].filter(googleMapsUrl);
 const addresses=[...new Set(lines.filter(line=>addressLabel.test(line)||streetCue.test(line))
  .map(line=>line.replace(addressLabel,'')).filter(line=>line.length<=500&&postalAddress(line)))];
 if(addresses.length===1)return {query:addresses[0],address:true};
 if(links.length===1)return {query:links[0],address:false};
 const venue=explicitNotesVenue(lines);
 if(venue)return {query:venue,address:false};
 return null;
}
function focusedActivityVenue(title){
 const clause=String(title||'').split(/\.\s+|\s+\(|\s+per part de\b|\s+por parte de\b/iu)[0];
 if(/^(?:sortida|arribada|trasllat|transfer|vol|flight|taxi|tren|metro|bus)\b/i.test(clause))return '';
 const venue=clause.match(venueCue)?.[0]?.replace(/^[\s’']+/, '').trim();
 if(venue&&/\p{L}+\s+.+/u.test(venue))return venue;
 return '';
}
export function extractActivityPoints(row){
 if(row.address?.trim())return extractLegacyActivityPoints(row);
 const notes=explicitNotesPlace(row);
 if(notes&&(notes.address||googleMapsUrl(notes.query)))return [point(notes.query)];
 if(row.location_name?.trim()||row.venue_name?.trim())return extractLegacyActivityPoints(row);
 if(notes)return [point(notes.query)];
 const legacy=extractLegacyActivityPoints(row);
 if(legacy.length>1)return legacy;
 const venue=focusedActivityVenue(row.title);
 return venue?[point(venue)]:legacy;
}
export function activityPointVenue(row){
 return row.location_name?.trim()||row.venue_name?.trim()||explicitNotesVenue(noteLines(row))||focusedActivityVenue(row.title);
}
export function activityPointAddress(row,query){
 const evidence=explicitNotesPlace(row);
 return !!row.address?.trim()||!!(evidence?.address&&evidence.query===query);
}
export function pointInput(row){return {title:row.title||'',location_name:row.location_name||row.venue_name||null,address:row.address||null,city:row.city||null}}
export function validPointPlace(p){
 return !!p&&p.provider==='geoapify'&&typeof p.provider_place_id==='string'&&p.provider_place_id.length>0&&p.provider_place_id.length<=500&&
 typeof p.canonical_name==='string'&&p.canonical_name.trim().length>0&&p.canonical_name.length<=200&&
 Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&
 /^[A-Z]{2}$/.test(p.country_code||'')&&['exact_location','representative_point'].includes(p.coordinate_role)&&
 typeof p.attribution==='string'&&p.attribution.length>0&&p.attribution.length<=2000;
}
export function pointPlace(p){
 if(!validPointPlace(p))throw Error('La resposta no conté una ubicació verificable.');
 return Object.fromEntries(['canonical_name','provider','provider_place_id','country_code','locality','kind','latitude','longitude','coordinate_role','attribution','formatted_address'].map(k=>[k,p[k]??null]));
}
// Accept descriptive prefixes (Palazzo, Museum, etc.) without losing the unique
// identity. A query's distinctive name tokens must ALL occur in the provider name;
// "San Petronio" must never match "San Domenico" or "Santo Stefano".
const genericPointWords=new Set(['palazzo','palace','museo','museum','museu','teatro','theatre','theater','basilica','chiesa','church','cattedrale','cathedral','torre','tower','piazza','square','via','street','viale','carrer','fontana','fountain','the','of','and']);
export function matchingPointCandidate(query,place,context={}){
 if(!validPointPlace(place))return false;
 if(context.country_code&&place.country_code!==context.country_code)return false;
 if(context.city&&normalizePointName(place.locality)!==normalizePointName(context.city))return false;
 const wanted=normalizePointName(query),found=normalizePointName(place.canonical_name);
 if(!wanted||!found)return false;
 if(wanted===found)return true;
 const distinctive=wanted.split(' ').filter(token=>!genericPointWords.has(token)&&token.length>2);
 if(!distinctive.length)return false;
 const foundTokens=new Set(found.split(' '));
 return distinctive.every(token=>foundTokens.has(token));
}
// Exact semantic identity matters: San Domenico and Santo Stefano are NOT San Petronio.
// Normalize articles/accents but never erase the named person or monument.
export const samePointName=(wanted,found)=>!!normalizePointName(wanted)&&normalizePointName(wanted)===normalizePointName(found);
const nearSamePoint=(a,b)=>{
 const north=(a.latitude-b.latitude)*111195;
 const east=(a.longitude-b.longitude)*111195*Math.cos((a.latitude+b.latitude)*Math.PI/360);
 return Number.isFinite(north)&&Number.isFinite(east)&&Math.hypot(north,east)<=120;
};
export function autoPendingPoints(row){
 const saved=savedActivityPoints(row),original=extractActivityPoints(row);
 const snapshot=row.location_points,evidence=snapshot?.geographic_evidence||snapshot?.input?.geographic_evidence;
 // A changed explicit note can invalidate an automatically extracted point, never a manual choice.
 if(!saved&&evidence&&snapshot?.version===1&&Object.entries(pointInput(row)).every(([k,v])=>snapshot.input?.[k]===v)&&
  snapshot.points?.length===1&&snapshot.points[0].id==='point-0'&&snapshot.points[0].query===evidence&&
  original.length===1&&explicitNotesPlace(row)?.query===original[0].query)return original;
 // Only retry unchanged automatically extracted points, never a user-customized set.
 if(!saved?.length||!saved.some(p=>p.status==='pending'&&!p.place))return null;
 if(saved.length===original.length&&saved.every((p,i)=>p.id===original[i].id&&p.query===original[i].query))return saved;
 const legacy=extractLegacyActivityPoints(row);
 if(saved.every(p=>p.status==='pending'&&!p.place)&&saved.length===legacy.length&&
  saved.every((p,i)=>p.id===legacy[i].id&&p.query===legacy[i].query))return original;
 // A legacy auto-extracted compound name may have stored both named places as one
 // pending point. Only expand the untouched point-0 when the whole name is exactly
 // the conjunction of independently extracted named places.
 if(saved.length===1&&saved[0].id==='point-0'&&saved[0].status==='pending'&&!saved[0].place&&original.length>=2&&
    saved[0].query===original.map(p=>p.query).join(' i '))return original;
 return null;
}
// Geography supplies a formatted address and may give the building a venue
// name. Compare street, house number and postal evidence separately.
function streetAddress(value){
 const last=value.match(/^(.+?) (\d{1,5}[a-z]?)$/);
 const first=value.match(/^(\d{1,5}[a-z]?) (.+)$/);
 const identity=last?[last[1],last[2]]:first?[first[2],first[1]]:null;
 return identity&&/[a-z]/.test(identity[0])?{street:identity[0],number:identity[1]}:null;
}
function postalAddress(value){
 const parts=String(value||'').split(/[,;\n]/).map(normalizePointName).filter(Boolean);
 const zip=/^(?:[a-z]{2} )?(\d{4,5})(?: (.+))?$/;
 const postalAreas=parts.map(part=>part.match(zip)).filter(Boolean);
 if(new Set(postalAreas.map(area=>area[1])).size>1)return null;
 const postal=postalAreas[0];
 for(const [index,part] of parts.entries()){
  const inline=part.match(/^(.+?) ((?:[a-z]{2} )?\d{4,5}(?: .+)?)$/);
  const inlineAddress=inline&&streetAddress(inline[1]);
  const trailingLocality=postal&&part.match(/^(.+? \d{1,3}[a-z]?) ([a-z]+(?: [a-z]+)*)$/);
  const address=inlineAddress||streetAddress(part)||(trailingLocality&&streetAddress(trailingLocality[1]))||
   (/^\d{1,3}[a-z]?$/.test(part)&&(
    streetAddress((parts[index-1]||'')+' '+part)||streetAddress(part+' '+(parts[index+1]||''))));
  if(address){
   const inlinePostal=inlineAddress?inline[2].match(zip):null;
   if(postal&&inlinePostal&&postal[1]!==inlinePostal[1])return null;
   const postalArea=postal||inlinePostal;
   return {...address,postcode:postalArea?.[1],locality:postalArea?.[2]};
  }
 }
 return null;
}
export function hasSelfContainedPostalAddress(value){
 return !!postalAddress(value)?.locality;
}
const geographicTerms={
 parlament:'parliament',parlement:'parliament',parlamento:'parliament',
 europeen:'european',europeu:'european',europeo:'european',
 catedral:'cathedral',cathedrale:'cathedral',cattedrale:'cathedral',doms:'cathedral',doma:'cathedral',
 aeroport:'airport',aeropuerto:'airport',aeroporto:'airport',
 museu:'museum',museo:'museum',musee:'museum',nacional:'national',nazionale:'national',
 restaurante:'restaurant',ristorante:'restaurant',albergo:'hotel'
};
export function sameGeographicName(wanted,found,city){
 if(samePointName(wanted,found))return true;
 const locality=normalizePointName(city);
 const key=value=>{
  const tokens=normalizePointName(value).split(' ').map(token=>
   locality&&token===locality+'s'?locality:geographicTerms[token]||token).filter(Boolean);
  const name=tokens.filter(token=>!['hotel','restaurant'].includes(token));
  return (name.length>=2?name:tokens).sort().join(' ');
 };
 const needle=key(wanted);
 return needle.length>0&&needle===key(found);
}
const genericLandmarks=new Set(['parliament','cathedral','airport','museum']);
export function alternativeGeographicQuery(query){
 const parts=normalizePointName(query).split(' ');
 const [type,...rest]=parts.map(token=>geographicTerms[token]||token);
 if(parts[0]===type||!genericLandmarks.has(type)||!rest.length)return '';
 return [...rest,type].join(' ');
}
function placeInContext(place,context){
 if(!context?.canonical_name)return false;
 if(context.time_zone&&place.timezone_status==='verified'&&place.timezone!==context.time_zone)return false;
 if(samePointName(place.locality,context.canonical_name))return true;
 // The provider must independently supply the enclosing administration.
 // Strip only administrative qualifiers, then require the full area name.
 if(!context.country_code||place.country_code!==context.country_code||place.coordinate_role!=='exact_location')return false;
 const area=normalizePointName(place.administrative_area).replace(/\b(?:capital|region|regionale|metropole|metropolitan|metropolitana|district|county|province|provincia|gewest|hoofdstedelijk)\b/g,' ').replace(/\s+/g,' ').trim();
 return samePointName(area,context.canonical_name);
}
function matchesPostalAddress(address,place,context,venue){
 if(place.coordinate_role!=='exact_location')return false;
 const formatted=postalAddress(place.formatted_address);
 const label=postalAddress(place.canonical_name);
 const samePortal=candidate=>candidate?.number===address.number;
 const matching=[formatted,label].some(candidate=>samePortal(candidate)&&candidate.street===address.street)||
  !!(context?.country_code&&address.postcode&&samePortal(formatted)&&
   sameGeographicName(venue,place.canonical_name,context.canonical_name));
 if(!matching||(address.postcode&&address.postcode!==(formatted?.postcode||label?.postcode)))return false;
 const sameCity=[context?.canonical_name,address.locality].some(city=>samePointName(city,place.locality));
 // A verified country and matching postcode identify the same postal area
 // even when the provider uses a different language for the municipality.
 return sameCity||placeInContext(place,context)||!!(context?.country_code&&address.postcode);
}
export function chooseAutomaticPoint(query,options,context,{address=false,venue=''}={}){
 if(context?.country_code&&!/^[A-Z]{2}$/.test(context.country_code))return null;
 const postal=address?postalAddress(query):null;
 if(!postal&&!context?.canonical_name)return null;
 const candidates=options.filter(validPointPlace).filter(p=>(!context?.country_code||p.country_code===context.country_code)&&
  (googleMapsUrl(query)?p.coordinate_role==='exact_location'&&p.map_reference===query&&!!context?.country_code&&placeInContext(p,context):
   postal?matchesPostalAddress(postal,p,context,venue):
   placeInContext(p,context)&&sameGeographicName(query,p.canonical_name,context.canonical_name)));
 if(!candidates.length)return null;
 const unique=[...new Map(candidates.map(p=>[p.provider_place_id,p])).values()];
 // Genuine distant homonyms remain ambiguous; multiple records of the same nearby landmark do not.
 if(!unique.every(p=>p.country_code===unique[0].country_code&&nearSamePoint(p,unique[0])))return null;
 const exact=unique.filter(p=>p.coordinate_role==='exact_location');
 // Outside known trip stops require an explicit matching city and an exact place.
 // Never derive a country from the first result or accept distant homonyms.
 if(!context?.country_code&&!exact.length)return null;
 const allowed=exact.length?exact:unique.filter(p=>(['street','suburb','district','neighbourhood','quarter','city_block','square','natural.forest','forest','park','nature_reserve','national_park'].includes(p.kind)||(['city','town','village','hamlet'].includes(p.kind)&&samePointName(p.canonical_name,context.canonical_name))));
 if(!allowed.length)return null;
 return pointPlace(allowed[0]);
}
export function pointSnapshot(row,points,{automatic=false}={}){
 if(!Array.isArray(points)||points.length>MAX_POINTS||new Set(points.map(p=>p.id)).size!==points.length)throw Error('Llista de punts no vàlida.');
 const evidence=explicitNotesPlace(row)?.query;
 const usesNotes=automatic&&evidence&&points.some(p=>p.query===evidence)&&!extractLegacyActivityPoints(row).some(p=>p.query===evidence);
 // Keep input identical to the PostgreSQL v1 fingerprint; evidence is optional snapshot metadata.
 return {version:1,input:pointInput(row),...(usesNotes?{geographic_evidence:evidence}:{}),points:points.map(p=>{
  if(typeof p.id!=='string'||!p.id||p.id.length>100||typeof p.query!=='string'||!p.query.trim()||p.query.length>500)throw Error('Cal un nom de lloc.');
  return {id:p.id,query:p.query.trim(),status:p.place?(p.place.coordinate_role==='exact_location'?'resolved':'approximate'):'pending',place:p.place?pointPlace(p.place):null};
 })};
}
export function savedActivityPoints(row){
 const s=row.location_points;
 const evidence=s?.geographic_evidence||s?.input?.geographic_evidence;
 if(Object.hasOwn(row,'notes')&&evidence&&evidence!==explicitNotesPlace(row)?.query)return null;
 return s?.version===1&&Object.entries(pointInput(row)).every(([k,v])=>s.input?.[k]===v)&&Array.isArray(s.points)?s.points:null;
}
// A confirmed legacy choice and ordered points share one read contract.
// Empty ordered points are an explicit removal; never resurrect a legacy location.
export function confirmedLegacyPlace(row){
 const s=row.resolved_location,p=s?.place;
 return validPointPlace(p)&&Object.entries(pointInput(row)).every(([k,v])=>(s[k]??null)===v)?p:null;
}
export function activityGeographicPoints(row){
 const points=savedActivityPoints(row);
 if(points?.length===0||points?.some(p=>p.status!=='pending'&&validPointPlace(p.place)))return points;
 const legacy=confirmedLegacyPlace(row);
 return legacy?[{id:'legacy-location',query:legacy.canonical_name,status:legacy.coordinate_role==='exact_location'?'resolved':'approximate',place:pointPlace(legacy)}]:points;
}
export function samePointSnapshot(a,b){
 const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return !!a&&!!b&&canonical(a)===canonical(b);
}
export function pointMapUrl(place){return validPointPlace(place)?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(place.latitude+','+place.longitude):null}
export class ActivityPointQueue{
 constructor(search,{timeoutMs=20000}={}){this.search=search;this.timeoutMs=timeoutMs;this.cache=new Map();this.count=0;this.blocked=false}
 async find(query,context){
  const city=context?.canonical_name;
  if(googleMapsUrl(query)&&!context?.country_code)return [];
  const text=query+(city&&!googleMapsUrl(query)&&!postalAddress(query)?.locality&&!(' '+normalizePointName(query)+' ').includes(' '+normalizePointName(city)+' ')?', '+city:'');
  const key=JSON.stringify([googleMapsUrl(text)?text:text.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase(),context?.country_code]);
  if(this.cache.has(key))return this.cache.get(key);
  if(this.blocked)throw Error('La cerca està aturada perquè el servei no respon. Torna-ho a provar més tard.');
  if(this.count>=30)throw Error('Límit preventiu de 30 consultes assolit.');
  this.count++;
  let timer;
  const promise=Promise.race([Promise.resolve().then(()=>this.search(text,context?.country_code)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('El servei de llocs no respon. Torna-ho a provar més tard.')),this.timeoutMs)})]).then(options=>options.filter(validPointPlace)).finally(()=>clearTimeout(timer));
  this.cache.set(key,promise);
  try{return await promise}catch(e){this.blocked=true;this.cache.delete(key);throw e}
 }
}

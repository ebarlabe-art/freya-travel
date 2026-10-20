// Ordered geography belongs to one existing activity; never creates agenda rows.
export const MAX_POINTS=12;
export const normalizePointName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/centre historic|historic cent(?:er|re)/g,'centro storico').replace(/\b(?:basílica|basilique)\b/g,'basilica').replace(/[^a-z0-9]+/g,' ').replace(/\b(?:de|di|del|della|dell|la|le|il)\b/g,' ').replace(/\s+/g,' ').trim();
const anchor='(?:Piazza|Plaça|Plaza|Square|Fontana|Font|Fountain|Via|Viale|Carrer|Street|Museu|Museum|Museo|Catedral|Cathedral|Castell|Castle|Basílica|Basilica|Torre|Tower|Mercat|Market|Parc|Park|Palau|Palazzo|Finestrella|Archiginnasio|Teatro|Theatre|Theater|Quadrilatero|Due Torri|centre històric|centro storico|historic centre)';
export function extractActivityPoints(row){
 // Explicit addresses/venues take precedence over prose; never infer a restaurant from a meal.
 if(row.address)return [{id:'point-0',query:String(row.address).trim(),status:'pending',place:null}];
 const explicit=String(row.address||row.location_name||row.venue_name||'').trim();
 const raw=(row.resolved_location&&!row.address?String(row.title||''):explicit)||String(row.title||'');
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
 // Only retry unchanged automatically extracted points, never a user-customized set.
 if(!saved?.length||!saved.some(p=>p.status==='pending'&&!p.place))return null;
 if(saved.length===original.length)return saved.every((p,i)=>p.id===original[i].id&&p.query===original[i].query)?saved:null;
 // A legacy auto-extracted compound name may have stored both named places as one
 // pending point. Only expand the untouched point-0 when the whole name is exactly
 // the conjunction of independently extracted named places.
 if(saved.length===1&&saved[0].id==='point-0'&&saved[0].status==='pending'&&!saved[0].place&&original.length>=2&&
    saved[0].query===original.map(p=>p.query).join(' i '))return original;
 return null;
}
export function chooseAutomaticPoint(query,options,context){
 if(!context?.canonical_name||!/^[A-Z]{2}$/.test(context.country_code||''))return null;
 const candidates=options.filter(validPointPlace).filter(p=>p.country_code===context.country_code&&
   normalizePointName(p.locality)===normalizePointName(context.canonical_name)&&samePointName(query,p.canonical_name));
 if(!candidates.length)return null;
 const unique=[...new Map(candidates.map(p=>[p.provider_place_id,p])).values()];
 // Genuine distant homonyms remain ambiguous; multiple records of the same nearby landmark do not.
 if(!unique.every(p=>nearSamePoint(p,unique[0])))return null;
 const exact=unique.filter(p=>p.coordinate_role==='exact_location');
 const allowed=exact.length?exact:unique.filter(p=>['street','suburb','district','neighbourhood','quarter','city_block','square'].includes(p.kind));
 if(!allowed.length)return null;
 return pointPlace(allowed[0]);
}
export function pointSnapshot(row,points){
 if(!Array.isArray(points)||points.length>MAX_POINTS||new Set(points.map(p=>p.id)).size!==points.length)throw Error('Llista de punts no vàlida.');
 return {version:1,input:pointInput(row),points:points.map(p=>{
  if(typeof p.id!=='string'||!p.id||p.id.length>100||typeof p.query!=='string'||!p.query.trim()||p.query.length>500)throw Error('Cal un nom de lloc.');
  return {id:p.id,query:p.query.trim(),status:p.place?(p.place.coordinate_role==='exact_location'?'resolved':'approximate'):'pending',place:p.place?pointPlace(p.place):null};
 })};
}
export function savedActivityPoints(row){
 const s=row.location_points;
 return s?.version===1&&Object.entries(pointInput(row)).every(([k,v])=>s.input?.[k]===v)&&Array.isArray(s.points)?s.points:null;
}
export function pointMapUrl(place){return validPointPlace(place)?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(place.latitude+','+place.longitude):null}
export class ActivityPointQueue{
 constructor(search,{timeoutMs=20000}={}){this.search=search;this.timeoutMs=timeoutMs;this.cache=new Map();this.count=0;this.blocked=false}
 async find(query,context){
  const text=query+(context?.canonical_name?', '+context.canonical_name:'');
  const key=JSON.stringify([text.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase(),context?.country_code]);
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

import {savedActivityPoints,validPointPlace} from '../../../domain/itinerary-place-points.mjs';
const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function destinationContext(row,stops){
 const city=row.city||row.resolved_location?.place?.locality;
 const relevant=city?stops.filter(s=>clean(s.canonical_name)===clean(city)):stops;
 const contexts=[...new Map(relevant.map(s=>[clean(s.canonical_name)+':'+s.country_code,s])).values()];
 if(contexts.length!==1||!contexts[0].country_code)return null;
 return {city:city||contexts[0].canonical_name,country:contexts[0].country_code.toLowerCase()};
}
export function routeProvider({key,fetcher=fetch,timeoutMs=8000,now=Date.now,spacingMs=300,maxCalls=2000}){
 let next=0,day='',count=0;const cache=new Map();
 async function query(url){
  if(!key)throw Error('provider_unavailable');
  const today=new Date(now()).toISOString().slice(0,10);if(today!==day){day=today;count=0}
  if(count>=maxCalls)throw Error('rate_limited');count++;
  const wait=Math.max(0,next-now());next=Math.max(next,now())+spacingMs;if(wait>0)await new Promise(r=>setTimeout(r,wait));
  url.searchParams.set('apiKey',key);
  let response;try{response=await fetcher(url,{signal:AbortSignal.timeout(timeoutMs)})}catch{throw Error('provider_unavailable')}
  if(response.status===429)throw Error('rate_limited');
  if([400,404,501].includes(response.status)&&url.pathname.endsWith('/routing'))throw Error('mode_unavailable');
  if(!response.ok)throw Error('provider_unavailable');
  try{const text=await response.text();if(text.length>2000000)throw Error();return JSON.parse(text)}catch{throw Error('invalid_response')}
 }
 async function memo(id,work){
  const old=cache.get(id);if(old?.pending)return old.pending;if(old&&old.until>now())return old.value;
  const pending=work();if(cache.size>=200)cache.delete(cache.keys().next().value);cache.set(id,{pending});
  try{const value=await pending;cache.set(id,{value,until:now()+300000});return value}
  catch(error){if(cache.get(id)?.pending===pending)cache.delete(id);throw error}
 }
 return {
  async resolve(row,context,choice,endpoint='first'){
   if(row.location_points!==null&&row.location_points!==undefined){
    const points=savedActivityPoints(row),p=(endpoint==='last'?points?.at(-1):points?.[0])?.place;
    // Never fall back to a superseded single location or turn an area centroid into an exact entrance.
    if(!validPointPlace(p)||p.coordinate_role!=='exact_location')return {error:'missing_place'};
    return {point:{id:p.provider_place_id,label:p.canonical_name,lat:p.latitude,lon:p.longitude}};
   }
   if(!choice&&Number.isFinite(row.latitude)&&Math.abs(row.latitude)<=90&&Number.isFinite(row.longitude)&&Math.abs(row.longitude)<=180){
    return {point:{id:'coordinates:'+row.latitude+':'+row.longitude,label:row.venue_name||row.location_name||row.title||row.address,lat:row.latitude,lon:row.longitude}};
   }
   const name=row.location_name||row.venue_name||row.address;
   if(!name)return {error:'missing_place'};
   if(!context)return {error:'missing_context'};
   const saved=row.resolved_location,p=saved?.place;
   if(!choice&&p?.provider==='geoapify'&&typeof p.provider_place_id==='string'&&p.provider_place_id&&
    p.coordinate_role==='exact_location'&&p.country_code?.toLowerCase()===context.country&&
    clean(p.locality)===clean(context.city)&&
    ['location_name','address','city','title'].every(field=>(saved[field]||null)===((field==='location_name'?row.location_name||row.venue_name:row[field])||null))&&
    Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180){
    return {point:{id:p.provider_place_id,label:p.canonical_name,lat:p.latitude,lon:p.longitude}};
   }
   const data=await memo(JSON.stringify(['place',name,row.address,context]),async()=>{
    const url=new URL('https://api.geoapify.com/v1/geocode/search');url.search=new URLSearchParams({text:[name,row.address!==name?row.address:'',context.city,context.country].filter(Boolean).join(', '),filter:'countrycode:'+context.country,lang:'ca',limit:'5',format:'json'}).toString();return query(url);
   });
   if(!Array.isArray(data.results))throw Error('invalid_response');
   const candidates=[...new Map(data.results.filter(p=>
    p.country_code?.toLowerCase()===context.country&&[p.city,p.town,p.village,p.municipality].some(c=>clean(c)===clean(context.city))&&
    ['building','amenity','street'].includes(p.result_type)&&typeof p.place_id==='string'&&
    Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180
   ).map(p=>[p.place_id,{id:p.place_id,label:p.formatted||p.name,lat:p.lat,lon:p.lon,exact:clean(p.name)===clean(name)||clean(p.address_line1)===clean(name)}])).values()];
   if(!candidates.length)return {error:'no_match'};
   const selected=choice?candidates.find(p=>p.id===choice):candidates.length===1&&candidates[0].exact?candidates[0]:null;
   if(!selected)return {error:'ambiguous',candidates:candidates.map(({id,label})=>({id,label}))};
   return {point:selected};
  },
  async route(a,b,mode){
   return memo(JSON.stringify(['route',a.id,b.id,a.lat,a.lon,b.lat,b.lon,mode]),async()=>{
    const url=new URL('https://api.geoapify.com/v1/routing');url.search=new URLSearchParams({waypoints:`${a.lat},${a.lon}|${b.lat},${b.lon}`,mode,units:'metric',format:'geojson'}).toString();
    const data=await query(url),feature=data.features?.[0],p=feature?.properties;
    if(Array.isArray(data.features)&&!data.features.length)throw Error('no_route');
    const lines=feature?.geometry?.coordinates;
    if(!p||p.mode!==mode||String(p.distance_units).toLowerCase()!=='meters'||!Number.isFinite(p.distance)||p.distance<0||!Number.isFinite(p.time)||p.time<0||feature.geometry.type!=='MultiLineString'||!Array.isArray(lines)||!lines.length||!lines.every(line=>Array.isArray(line)&&line.length>=2&&line.every(pt=>Array.isArray(pt)&&pt.length>=2&&Number.isFinite(pt[0])&&Math.abs(pt[0])<=180&&Number.isFinite(pt[1])&&Math.abs(pt[1])<=90)))throw Error('invalid_response');
    return {method:'routing',mode,origin:{latitude:a.lat,longitude:a.lon},destination:{latitude:b.lat,longitude:b.lon},distance_m:p.distance,duration_seconds:p.time,source:'Geoapify Routing / OpenStreetMap',quality:mode==='transit'?'Aproximació de transport públic; sense horaris en viu ni garantia de servei.':'Ruta calculada; temps aproximat, sense trànsit en viu.',calculated_at:new Date(now()).toISOString()};
   });
  }
 };
}

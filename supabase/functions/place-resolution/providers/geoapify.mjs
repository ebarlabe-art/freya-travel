import {validatePlace,validIana} from '../../../../domain/place-resolution.mjs';
import {googleMapsUrl,sameGeographicName} from '../../../../domain/itinerary-place-points.mjs';
export function normalizeGeoapify(p){
 const broad=['country','state','region','county','continent','island','national_park'].includes(p.result_type)||p.category?.startsWith('natural.');
 const zone=!broad&&validIana(p.timezone?.name)?p.timezone.name:null;
 return validatePlace({canonical_name:p.name||p.address_line1||p.street||p.suburb||p.district||p.city||p.formatted,formatted_address:typeof p.formatted==='string'?p.formatted.slice(0,1000):null,locality:p.city||p.town||p.village||p.municipality||null,administrative_area:p.state||p.county||null,kind:p.result_type||'unknown',country_code:p.country_code?.toUpperCase()||null,latitude:p.lat,longitude:p.lon,coordinate_role:['building','amenity'].includes(p.result_type)?'exact_location':'representative_point',timezone:zone,timezone_status:broad?'needs_specific_location':zone?'verified':'unavailable',provider:'geoapify',provider_place_id:p.place_id,source:p.datasource?.sourcename,attribution:p.datasource?.attribution,resolution_version:'geoapify-normalizer-v2'});
}
const shortMapsHost=host=>host==='maps.app.goo.gl'||host==='goo.gl';
async function readGoogleMapsPlace(url,fetcher,signal){
 for(let i=0;i<3&&shortMapsHost(url.hostname);i++){
  // Follow short links ourselves. Each outbound hop must still be Google Maps.
  const response=await fetcher(url,{method:'GET',redirect:'manual',signal});
  const next=response.headers.get('location');
  await response.body?.cancel();
  if(response.status<300||response.status>=400||!next)return null;
  const expanded=googleMapsUrl(new URL(next,url).href);
  if(!expanded)return null;
  url=expanded;
 }
 if(shortMapsHost(url.hostname))return null;
 const name=(url.searchParams.get('query')||url.searchParams.get('q')||
  decodeURIComponent(/^\/maps\/place\/([^/]+)/.exec(url.pathname)?.[1]||'').replace(/\+/g,' ')).trim();
 const explicitPair=name.match(/^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
 // Camera coordinates (@lat,lon) are not the selected destination.
 const pointParams=[...url.pathname.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
 const pair=explicitPair||(pointParams.length===1?pointParams[0]:null);
 const pin=pair&&{latitude:Number(pair[1]),longitude:Number(pair[2])};
 if(pin&&(Math.abs(pin.latitude)>90||Math.abs(pin.longitude)>180))return null;
 if(/\/maps\/(?:dir|d)(?:\/|$)/.test(url.pathname))return null;
 return pin||name?{pin,name:explicitPair?'':name.slice(0,200)}:null;
}
function nearPin(place,pin){
 const latitude=(place.latitude-pin.latitude)*111195;
 const longitude=(place.longitude-pin.longitude)*111195*Math.cos(pin.latitude*Math.PI/180);
 return Math.hypot(latitude,longitude)<=35;
}
export function geoapifyAdapter({key,config,fetcher=fetch,mapFetcher=fetch}){
 async function lookup(path,parameters,signal=AbortSignal.timeout(config.timeoutMs)){
  const url=new URL('https://api.geoapify.com/v1/geocode/'+path);
  url.search=new URLSearchParams({...parameters,limit:String(config.maxResults),format:'json',apiKey:key}).toString();
  let response;
  try{response=await fetcher(url,{signal})}catch{throw Error('provider_unavailable')}
  if(response.status===429)throw Object.assign(Error('rate_limited'),{retryAfter:Math.min(3600,Math.max(1,Number(response.headers.get('retry-after'))||60))});
  if(!response.ok)throw Error('provider_unavailable');
  let body;
  try{const text=await response.text();if(text.length>262144)throw Error();body=JSON.parse(text)}catch{throw Error('invalid_response')}
  if(!Array.isArray(body.results)||body.results.length>config.maxResults)throw Error('invalid_response');
  return body.results.map(normalizeGeoapify);
 }
 return {async search(input){
  if(!key)throw Error('provider_unavailable');
  const filter=input.country_code?{filter:'countrycode:'+input.country_code.toLowerCase()}:{};
  const map=googleMapsUrl(input.text);
  if(!map)return lookup('search',{text:input.text,lang:input.language,...filter});
  // A link may supply identity or a pin, but only Geoapify points are returned.
  // Stop safely on broken links or redirects outside the allowlist.
  let target;
  const signal=AbortSignal.timeout(config.timeoutMs);
  try{target=await readGoogleMapsPlace(map,mapFetcher,signal)}catch{return []}
  if(!target||!input.country_code)return [];
  const data=target.pin&&!target.name?
   await lookup('reverse',{lat:String(target.pin.latitude),lon:String(target.pin.longitude),lang:input.language},signal):
   await lookup('search',{text:target.name,lang:input.language,...filter},signal);
  return data.filter(place=>place.coordinate_role==='exact_location'&&place.country_code===input.country_code&&
   (target.pin?nearPin(place,target.pin):sameGeographicName(target.name,place.canonical_name,place.locality)))
   .map(place=>({...place,map_reference:input.text}));
 }};
}

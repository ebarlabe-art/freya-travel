import {validatePlace,validIana} from '../../../../domain/place-resolution.mjs';

// Non-commercial evaluation only: this provider requires no API key.
// Open-Meteo Geocoding API uses GeoNames data, CC BY 4.0 attribution.
// The production branch continues to use Geoapify with its own credentials.
export function normalizeOpenMeteoPlace(row){
 const city=String(row?.feature_code||'').toUpperCase().startsWith('PPL');
 const tz=city&&validIana(row?.timezone)?row.timezone:null;
 return validatePlace({
  canonical_name:row?.name,
  administrative_area:row?.admin1||null,
  kind:city?'city':String(row?.feature_code||'unknown').toLowerCase(),
  country_code:row?.country_code||null,
  latitude:row?.latitude,longitude:row?.longitude,
  coordinate_role:'representative_point',
  timezone:tz,timezone_status:city?(tz?'verified':'unavailable'):'needs_specific_location',
  provider:'open-meteo',provider_place_id:String(row?.id||''),
  source:'GeoNames via Open-Meteo Geocoding API',
  attribution:'Open-Meteo / GeoNames · CC BY 4.0',
  resolution_version:'open-meteo-staging-v1'
 });
}
export function openMeteoAdapter({config,fetcher=fetch}){
 return {async search(input){
  const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search=new URLSearchParams({
   name:input.text,language:input.language||'ca',
   count:String(config.maxResults),format:'json',
   ...(input.country_code?{countryCode:input.country_code}:{})
  }).toString();
  let response;
  try{response=await fetcher(url,{signal:AbortSignal.timeout(config.timeoutMs)})}
  catch{throw Error('provider_unavailable')}
  if(response.status===429)throw Object.assign(Error('rate_limited'),{retryAfter:60});
  if(!response.ok)throw Error('provider_unavailable');
  let raw;
  try{
   const text=await response.text();
   if(text.length>262144)throw Error('invalid_response');
   raw=JSON.parse(text);
  }catch{throw Error('invalid_response')}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid_response');
  const rows=raw.results===undefined?[]:raw.results;
  if(!Array.isArray(rows)||rows.length>config.maxResults)throw Error('invalid_response');
  try{return rows.map(normalizeOpenMeteoPlace)}
  catch{throw Error('invalid_response')}
 }};
}

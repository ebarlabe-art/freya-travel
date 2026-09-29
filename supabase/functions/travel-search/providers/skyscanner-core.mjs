const API='https://partners.api.skyscanner.net/apiservices/v3';
const CABIN={
  economy:'CABIN_CLASS_ECONOMY',
  premium_economy:'CABIN_CLASS_PREMIUM_ECONOMY',
  business:'CABIN_CLASS_BUSINESS',
  first:'CABIN_CLASS_FIRST',
};
const UNIT_DIVISOR={PRICE_UNIT_WHOLE:1,PRICE_UNIT_CENTI:100,PRICE_UNIT_MILLI:1000,PRICE_UNIT_MICRO:1000000};

const norm=s=>String(s||'').normalize('NFKC').trim().toLowerCase();

export function skyscannerPrice(price){
  if(!price||typeof price.amount!=='string'&&typeof price.amount!=='number')return null;
  const amount=Number(price.amount),divisor=UNIT_DIVISOR[price.unit];
  if(!Number.isFinite(amount)||amount<0||!divisor)return null;
  return amount/divisor;
}
export function selectSkyscannerPlace(payload,input){
  const rows=Array.isArray(payload?.places)?payload.places.filter(p=>p&&['PLACE_TYPE_CITY','PLACE_TYPE_AIRPORT'].includes(p.type)&&typeof p.entityId==='string'):[];
  if(!rows.length)return null;
  const exact=rows.find(p=>norm(p.name)===norm(input)||norm(p.iataCode)===norm(input));
  const p=exact||rows[0];
  return {entityId:p.entityId,name:String(p.name||input),iataCode:typeof p.iataCode==='string'?p.iataCode:null,type:p.type};
}
function dateObject(value){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');
  if(!m)throw new Error('invalid_search_date');
  return {year:Number(m[1]),month:Number(m[2]),day:Number(m[3])};
}
function preferenceKeys(query){return Array.isArray(query.preferences)?query.preferences.map(p=>p.key):[]}
function unsupportedHard(query,supported=new Set()){
  return (query.preferences||[]).filter(p=>p.strength==='hard'&&!supported.has(p.key));
}
function bookingLinks(option){
  return [...new Set((option?.items||[]).map(i=>i?.deepLink).filter(x=>typeof x==='string'&&/^https:\/\//.test(x)))];
}
export function parseSkyscannerResults(payloads,query,resolution){
  const map=new Map();
  for(const payload of payloads){
    const itineraries=payload?.content?.results?.itineraries||{};
    for(const [id,itinerary] of Object.entries(itineraries)){
      const options=Array.isArray(itinerary?.pricingOptions)?itinerary.pricingOptions:[];
      let best=null;
      for(const option of options){
        const amount=skyscannerPrice(option?.price);
        if(amount===null)continue;
        if(!best||amount<best.amount)best={option,amount};
      }
      if(!best)continue;
      const links=bookingLinks(best.option);
      map.set(id,{
        id,
        provider:'skyscanner',
        service:'flights',
        title:`${resolution.origin.name} → ${resolution.destination.name}`,
        subtitle:best.option?.transferType||undefined,
        price:{amount:best.amount,currency:query.currency},
        deeplink:links.length===1?links[0]:undefined,
        raw:{
          booking_links:links,
          transfer_type:best.option?.transferType||null,
          leg_ids:Array.isArray(itinerary?.legIds)?itinerary.legIds:[],
          resolved_origin:resolution.origin,
          resolved_destination:resolution.destination,
        },
      });
    }
  }
  return [...map.values()].sort((a,b)=>a.price.amount-b.price.amount);
}
async function requestJson(fetchImpl,url,apiKey,body,timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:controller.signal,headers:{'x-api-key':apiKey,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    if(!response.ok)throw Object.assign(new Error(response.status===401||response.status===403?'provider_auth_error':response.status===429?'provider_rate_limited':'provider_error'),{code:response.status});
    return await response.json();
  }catch(error){
    if(error?.message&&/^provider_/.test(error.message))throw error;
    throw new Error(controller.signal.aborted?'provider_timeout':'provider_transport_error');
  }finally{clearTimeout(timer)}
}
async function resolvePlace(fetchImpl,apiKey,query,input,isDestination,timeoutMs){
  if(/^[A-Z]{3}$/.test(input))return {iataCode:input,entityId:null,name:input,type:'PLACE_TYPE_AIRPORT'};
  const payload=await requestJson(fetchImpl,`${API}/autosuggest/flights`,apiKey,{query:{market:query.market,locale:query.locale,searchTerm:input,includedEntityTypes:['PLACE_TYPE_CITY','PLACE_TYPE_AIRPORT']},limit:8,isDestination},timeoutMs);
  const resolved=selectSkyscannerPlace(payload,input);
  if(!resolved)throw new Error('place_not_resolved');
  return resolved;
}
function placeId(place){return place.entityId?{entityId:place.entityId}:{iata:place.iataCode}}
export function createSkyscannerFlightsAdapter({apiKey,fetchImpl=fetch,timeoutMs=8000,maxPolls=2,pollDelayMs=150}={}){
  if(typeof apiKey!=='string'||!apiKey.trim())throw new Error('skyscanner_key_missing');
  return {
    async search(query){
      const supported=new Set();
      const hard=unsupportedHard(query,supported);
      if(hard.length)return {provider:'skyscanner',service:'flights',configured:true,results:[],error:'unsupported_hard_preferences',applied_preferences:[],unapplied_preferences:preferenceKeys(query)};
      const [origin,destination]=await Promise.all([
        resolvePlace(fetchImpl,apiKey,query,query.origin,false,timeoutMs),
        resolvePlace(fetchImpl,apiKey,query,query.destination,true,timeoutMs),
      ]);
      const legs=[
        {originPlaceId:placeId(origin),destinationPlaceId:placeId(destination),date:dateObject(query.start_date)},
        {originPlaceId:placeId(destination),destinationPlaceId:placeId(origin),date:dateObject(query.end_date)},
      ];
      const create=await requestJson(fetchImpl,`${API}/flights/live/search/create`,apiKey,{query:{market:query.market,locale:query.locale,currency:query.currency,queryLegs:legs,adults:query.adults,childrenAges:query.children_ages||[],cabinClass:CABIN[query.cabin]}},timeoutMs);
      const payloads=[create],token=create?.sessionToken;
      let latest=create;
      for(let i=0;i<maxPolls&&token&&latest?.status!=='RESULT_STATUS_COMPLETE';i++){
        if(pollDelayMs)await new Promise(r=>setTimeout(r,pollDelayMs));
        latest=await requestJson(fetchImpl,`${API}/flights/live/search/poll/${encodeURIComponent(token)}`,apiKey,undefined,timeoutMs);
        if(latest?.action!=='RESULT_ACTION_NOT_MODIFIED')payloads.push(latest);
      }
      return {
        provider:'skyscanner',service:'flights',configured:true,
        results:parseSkyscannerResults(payloads,query,{origin,destination}),
        applied_preferences:[],
        unapplied_preferences:preferenceKeys(query),
        ...(latest?.status==='RESULT_STATUS_FAILED'?{error:'provider_search_failed'}:{}),
      };
    },
  };
}

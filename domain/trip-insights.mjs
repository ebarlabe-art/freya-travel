// A4.1 · Universal contextual research, independent of destination/country catalogs.
// No personal documents or account secrets enter the AI request.
export const INSIGHT_TOPICS=Object.freeze({
  entry:'Documents i entrada', money:'Diners i pagaments',
  transport:'Transport', connectivity:'Tecnologia i connexió',
  climate:'Clima i equipatge', culture:'Cultura i hàbits'
});
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const COUNTRY=/^[A-Z]{2}$/;
export function insightScope({trip,stops=[]}={}){
  if(!trip||trip.experience_key==='london-2026'||typeof trip.id!=='string')return null;
  const destinations=(Array.isArray(stops)?stops:[]).slice(0,20).map(s=>({
    name:String(s?.canonical_name||s?.label||'').trim().slice(0,160),
    country_code:String(s?.country_code||'').trim().toUpperCase()
  })).filter(s=>s.name&&(!s.country_code||COUNTRY.test(s.country_code)));
  const seen=new Set();
  const unique=destinations.filter(s=>{const key=s.country_code+':'+s.name.toLowerCase();if(seen.has(key))return false;seen.add(key);return true});
  return {trip_id:trip.id,start_date:DATE.test(trip.start_date||'')?trip.start_date:null,end_date:DATE.test(trip.end_date||'')?trip.end_date:null,destinations:unique};
}
export function insightPhase(trip,now=new Date()){
  const day=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  return trip?.end_date&&day>trip.end_date?'past':trip?.start_date&&day>=trip.start_date?'during':'before';
}
export function validSourceUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.hostname.includes('.')&&!/(^|\.)(localhost|local|internal|test)$/.test(url.hostname)&&!(/^(127|10|192\.168)\./.test(url.hostname));}
  catch{return false}
}
export function sourceIdentity(value){
  if(!validSourceUrl(value))return null;
  const url=new URL(value);return url.origin+url.pathname.replace(/\/$/,'');
}
export function validateInsightReport(value,{sourceUrls}={}){
  if(!value||!DATE.test(value.checked_at||'')||!Array.isArray(value.items)||value.items.length>24)throw Error('invalid_response');
  const evidence=sourceUrls&&new Set(sourceUrls.map(sourceIdentity).filter(Boolean));
  const result=[];
  for(const item of value.items){
    if(!item||!INSIGHT_TOPICS[item.topic]||typeof item.title!=='string'||
      typeof item.destination!=='string'||typeof item.detail!=='string'||typeof item.source_title!=='string'||typeof item.source_url!=='string'||
      !item.title.trim()||item.title.length>100||item.destination.length>160||!item.destination.trim()||
      !item.detail.trim()||item.detail.length>620||!item.source_title.trim()||item.source_title.length>180||
      !validSourceUrl(item.source_url)||evidence&&!evidence.has(sourceIdentity(item.source_url)))throw Error('invalid_response');
    result.push({topic:item.topic,destination:item.destination.trim(),title:item.title.trim(),detail:item.detail.trim(),source_title:item.source_title.trim(),source_url:item.source_url});
  }
  if(!result.length)throw Error('source_unavailable');
  return {checked_at:value.checked_at,items:result};
}
export function insightCacheKey(userId,tripId){
  if(!userId||!tripId)return null;
  return 'freya-trip-insights-v2:'+userId+':'+tripId;
}
export function insightCacheSignature(scope){return JSON.stringify([scope?.start_date,scope?.end_date,scope?.destinations]);}
export function readInsightCache(storage,key,scope,{now=Date.now(),maxAgeMs=72*3600*1000}={}){
  if(!key||!scope)return null;
  try{
    const row=JSON.parse(storage.getItem(key)||'null');
    if(row?.signature!==insightCacheSignature(scope)||!Number.isFinite(row?.saved_at)||row.saved_at>now||now-row.saved_at>maxAgeMs)return null;
    return validateInsightReport(row.report);
  }catch{return null}
}
export function saveInsightCache(storage,key,scope,report,now=Date.now()){
  if(!key||!scope)return;
  const checked=validateInsightReport(report);
  try{storage.setItem(key,JSON.stringify({signature:insightCacheSignature(scope),saved_at:now,report:checked}));}catch{}
}

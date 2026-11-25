import {routeIsVerified,routeMapUrl} from './itinerary-route.mjs';
import {activityGeographicPoints,confirmedLegacyPlace,validPointPlace} from './itinerary-place-points.mjs';

export const DEFAULT_MARGIN=10;
export const MAX_MARGIN=180;
export const ROUTE_LIFETIME=300_000;
const instant=value=>typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
const validCoordinates=({latitude,longitude})=>Number.isFinite(latitude)&&Math.abs(latitude)<=90&&
 Number.isFinite(longitude)&&Math.abs(longitude)<=180;

function hasPlace(row,endpoint){
 const legacy=confirmedLegacyPlace(row);
 if(row.location_points!=null){
  const points=activityGeographicPoints(row);
  const endpointPlace=(endpoint==='last'?points?.at(-1):points?.[0])?.place;
  if(validPointPlace(endpointPlace))return endpointPlace.coordinate_role==='exact_location';
  return points?.length!==0&&legacy?.coordinate_role==='exact_location';
 }
 if(validCoordinates(row))return true;
 if(legacy)return legacy.coordinate_role==='exact_location';
 return [row.location_name,row.venue_name,row.address].some(value=>typeof value==='string'&&value.trim());
}
export function departureRef(item){
 return {type:item.sourceType,id:item.sourceId,updated_at:item.sourceUpdatedAt};
}

export function departurePlan(items,readRow,now){
 const visits=items.filter(item=>['manual','activity'].includes(item.sourceType)&&!item.isCancelled&&item.sourceUpdatedAt)
  .map(item=>({item,row:readRow(item)}))
  .filter(({item,row})=>!item.isTransport&&row.updated_at===item.sourceUpdatedAt&&
    !['transport','transport_activity'].includes(row.activity_type)&&
    !(item.sourceType==='manual'&&/^(?:sortida|arribada|trasllat|transfer|vol|flight|taxi|tren|metro|bus)\b/i.test(row.title||'')));
 const scheduled=visits.filter(({item})=>item.timingKind==='exact'&&!item.overnightCorrectionDate&&Number.isFinite(instant(item.startsAt)))
  .sort((a,b)=>instant(a.item.startsAt)-instant(b.item.startsAt)||a.item.key.localeCompare(b.item.key));
 const destination=scheduled.find(({item,row})=>!item.isCompleted&&instant(item.startsAt)>now&&hasPlace(row,'first'))?.item;
 if(!destination)return null;
 const options=visits.filter(({item,row})=>item.key!==destination.key&&hasPlace(row,'last')).map(({item})=>item);
 const lastVisit=scheduled.filter(({item})=>instant(item.startsAt)<=now).at(-1)?.item;
 // Do not silently fall back to an older visit if the immediately previous one lacks a reliable location.
 const previous=lastVisit&&options.includes(lastVisit)&&Number.isFinite(instant(lastVisit.endsAt))&&
  instant(lastVisit.endsAt)>=instant(lastVisit.startsAt)?lastVisit:null;
 return {destination,previous,options};
}

export function departureEstimate(item,response,mode,margin,now,originReadyAt=now){
 const start=instant(item.startsAt),route=response?.route;
 const originUrl=routeMapUrl(route);
 const quoted=instant(route?.calculated_at);
 if(!routeIsVerified(response)||route.mode!==mode||!originUrl||!Number.isFinite(quoted)||quoted>now+60_000||
  now-quoted>=ROUTE_LIFETIME||!Number.isInteger(margin)||margin<0||margin>MAX_MARGIN||!(start>now))return null;
 const leaveBy=start-route.duration_seconds*1000-margin*60_000;
 const minutes=Math.floor((leaveBy-Math.max(now,originReadyAt))/60_000);
 return {leaveBy,minutes,duration:Math.ceil(route.duration_seconds/60),url:originUrl,
  status:minutes<0?'late':minutes<=10?'soon':'onTime'};
}

export function deviceRouteOrigin(geo,now=Date.now){
 if(!geo?.getCurrentPosition)return Promise.reject(Error('locationUnavailable'));
 return new Promise((resolve,reject)=>{
  geo.getCurrentPosition(({coords,timestamp})=>{
   if(!coords||!validCoordinates(coords)||!Number.isFinite(coords.accuracy)||coords.accuracy<0||coords.accuracy>200||
      !Number.isFinite(timestamp)||now()-timestamp>60_000||timestamp-now()>60_000){
    reject(Error('locationInaccurate'));return;
   }
   resolve({type:'device',latitude:coords.latitude,longitude:coords.longitude});
  },error=>reject(Error(error.code===1?'locationDenied':'locationUnavailable')),
  {enableHighAccuracy:true,timeout:12000,maximumAge:0});
 });
}

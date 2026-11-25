import {routeIsVerified,routeMapUrl,visitPairs,routeFeasibility} from './itinerary-route.mjs';
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

function departureVisits(items,readRow){
 return items.filter(item=>['manual','activity'].includes(item.sourceType)&&!item.isCancelled&&item.sourceUpdatedAt)
  .map(item=>({item,row:readRow(item)}))
  .filter(({item,row})=>!item.isTransport&&row.updated_at===item.sourceUpdatedAt&&
    !['transport','transport_activity'].includes(row.activity_type)&&
    !(item.sourceType==='manual'&&/^(?:sortida|arribada|trasllat|transfer|vol|flight|taxi|tren|metro|bus)\b/i.test(row.title||'')));
}

export function departurePlan(items,readRow,now){
 const visits=departureVisits(items,readRow);
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

export function plannedDepartureChoices(items,accommodations,readRow,tripId,day){
 const active=items.filter(item=>item.tripId===tripId&&item.localDate===day&&!item.isCancelled&&item.status!=='cancelled');
 const available=new Map(departureVisits(active,readRow).map(entry=>[entry.item.key,entry]));
 const pairs=visitPairs(active,tripId,day);
 const lodging=accommodations.filter(row=>row.trip_id===tripId&&row.reservation_status!=='cancelled'&&
  (validCoordinates(row)||row.address||row.location_text||row.name)).map(row=>({
   key:'lodging:'+row.id,title:row.name,timeZone:row.time_zone,version:row.updated_at,
   coordinates:validCoordinates(row)?{type:'selected',latitude:row.latitude,longitude:row.longitude}:null,
   query:[row.name,row.address||row.location_text,row.city,row.country].filter(Boolean).join(', ').slice(0,200)
  }));
 const origins=[...available.values()].filter(({item,row})=>hasPlace(row,'last')).map(({item})=>item);
 return [...available.values()].filter(({item,row})=>!item.isCompleted&&item.timingKind==='exact'&&!item.overnightCorrectionDate&&
  Number.isFinite(instant(item.startsAt))&&hasPlace(row,'first')).map(({item})=>{
  const candidate=pairs.find(pair=>pair.destination.key===item.key)?.origin;
  const previous=candidate&&!candidate.overnightCorrectionDate&&origins.includes(candidate)?candidate:null;
  return {destination:item,previous,options:origins.filter(origin=>origin.key!==item.key),lodging};
 });
}

function verifiedDeparture(item,response,mode,margin,now){
 const start=instant(item.startsAt),route=response?.route;
 const url=routeMapUrl(route),quoted=instant(route?.calculated_at);
 if(!routeIsVerified(response)||route.mode!==mode||!url||!Number.isFinite(quoted)||quoted>now+60_000||
  now-quoted>=ROUTE_LIFETIME||!Number.isInteger(margin)||margin<0||margin>MAX_MARGIN||!Number.isFinite(start))return null;
 return {leaveBy:start-route.duration_seconds*1000-margin*60_000,duration:Math.ceil(route.duration_seconds/60),url};
}

export function departureEstimate(item,response,mode,margin,now,originReadyAt=now){
 const estimate=verifiedDeparture(item,response,mode,margin,now);
 if(!estimate||!(instant(item.startsAt)>now))return null;
 const minutes=Math.floor((estimate.leaveBy-Math.max(now,originReadyAt))/60_000);
 return {...estimate,minutes,status:minutes<0?'late':minutes<=10?'soon':'onTime'};
}

export function plannedDepartureEstimate(item,response,mode,margin,now,scheduledOrigin){
 const estimate=verifiedDeparture(item,response,mode,margin,now);
 if(!estimate)return null;
 const diagnosis=scheduledOrigin&&routeFeasibility(scheduledOrigin,item,response.route,margin);
 if(!diagnosis||!Number.isFinite(diagnosis.remainingMinutes))return {...estimate,minutes:null,status:'unknownGap'};
 const minutes=Math.floor(diagnosis.remainingMinutes-margin);
 return {...estimate,minutes,status:minutes<0?'plannedConflict':'plannedFits'};
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

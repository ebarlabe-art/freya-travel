// Itinerary advice is a non-persisted recommendation: no date, booking or time writes.
import {routeIsVerified} from './itinerary-route.mjs';
const instant=s=>typeof s==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
export function recommendedVisitAdvice(item,suggestion,next=null,routeResult=null,bufferMinutes=5){
 if(!item||!suggestion||!Number.isInteger(suggestion.minutes)||suggestion.minutes<10||suggestion.minutes>360)return null;
 const start=item.timingKind==='exact'?instant(item.startsAt):null;
 const fixedEnd=instant(item.endsAt);
 const nextStart=next?.timingKind==='exact'?instant(next.startsAt):null;
 const route=routeIsVerified(routeResult)?routeResult.route:null;
 const buffer=Number.isFinite(bufferMinutes)&&bufferMinutes>=0&&bufferMinutes<=180?bufferMinutes:5;
 const suggestedEnd=start===null?null:new Date(start+suggestion.minutes*60000).toISOString();
 const fixedEndIso=fixedEnd!==null&&start!==null&&fixedEnd>=start?new Date(fixedEnd).toISOString():null;
 const end=fixedEndIso?fixedEnd: start===null?null:start+suggestion.minutes*60000;
 const latestLeave=nextStart!==null&&route?nextStart-route.duration_seconds*1000-buffer*60000:null;
 const available=latestLeave!==null&&start!==null?Math.floor((latestLeave-start)/60000):null;
 const shortage=latestLeave!==null&&end!==null?Math.max(0,Math.ceil((end-latestLeave)/60000)):null;
 return {
  minutes:suggestion.minutes,
  reason:typeof suggestion.reason==='string'?suggestion.reason.slice(0,160):'',
  proposedEnd:suggestedEnd,
  confirmedEnd:fixedEndIso,
  latestLeaveBy:latestLeave===null?null:new Date(latestLeave).toISOString(),
  travelMinutes:route?Math.ceil(route.duration_seconds/60):null,
  availableMinutes:available,
  shortageMinutes:shortage,
  // When a route is missing, there is NO verified departure or travel ETA.
  routePending:!!next&&!route,
  nextFixed:!!next?.tags?.includes('Fix')||next?.sourceType==='activity'&&['confirmed','reserved'].includes(next?.status)
 };
}

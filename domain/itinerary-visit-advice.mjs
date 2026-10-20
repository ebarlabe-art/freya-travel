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
 // Even without a verified route, a suggested duration must never run past
 // the next stated start. We only know an upper bound, not a real ETA.
 const upperLeave=nextStart!==null?nextStart-buffer*60000:null;
 const deadline=latestLeave??upperLeave;
 const shortage=deadline!==null&&end!==null?Math.max(0,Math.ceil((end-deadline)/60000)):null;
 // Shorten only NON-confirmed visits to the maximum available time. With
 // no verified route this remains an upper bound, not a guaranteed arrival.
 const maximumMinutes=deadline!==null&&start!==null?Math.max(0,Math.floor((deadline-start)/60000)):null;
 const plannedMinutes=fixedEndIso?null:maximumMinutes===null?suggestion.minutes:Math.min(suggestion.minutes,maximumMinutes);
 const reducedMinutes=fixedEndIso?0:maximumMinutes!==null?Math.max(0,suggestion.minutes-plannedMinutes):0;
 const cannotFit=fixedEndIso?shortage>0:plannedMinutes!==null&&plannedMinutes<10;
 const displayableEnd=fixedEndIso||start===null||cannotFit?null:new Date(start+plannedMinutes*60000).toISOString();
 return {
  minutes:suggestion.minutes,
  reason:typeof suggestion.reason==='string'?suggestion.reason.slice(0,160):'',
  proposedEnd:suggestedEnd,
  displayableEnd,
  confirmedEnd:fixedEndIso,
  latestLeaveBy:latestLeave===null?null:new Date(latestLeave).toISOString(),
  travelMinutes:route?Math.ceil(route.duration_seconds/60):null,
  availableMinutes:available,
  maxMinutesWithoutTravel:upperLeave!==null&&start!==null?Math.max(0,Math.floor((upperLeave-start)/60000)):null,
  plannedMinutes,
  reducedMinutes,
  cannotFit,
  maximumMinutes,
  nextStart:nextStart!==null?new Date(nextStart).toISOString():null,
  shortageMinutes:shortage,
  // When a route is missing, there is NO verified departure or travel ETA.
  routePending:!!next&&!route,
  nextFixed:!!next?.tags?.includes('Fix')||next?.sourceType==='activity'&&['confirmed','reserved'].includes(next?.status)
 };
}

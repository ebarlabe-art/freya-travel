// Flight identity is a journey identity, never a passenger or ticket identity.
// Conservative: incomplete data must not be merged automatically.
export function flightJourneyKey({date,flightNumber,origin,destination}={}){
 const d=String(date||'').trim(),n=String(flightNumber||'').toUpperCase().replace(/[\s-]/g,'');
 const a=String(origin||'').toUpperCase().trim(),b=String(destination||'').toUpperCase().trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(n)||
    !/^[A-Z]{3}$/.test(a)||!/^[A-Z]{3}$/.test(b)||a===b)return null;
 return [d,n,a,b].join('|');
}
export function groupFlightTickets(tickets=[]){
 const groups=[],index=new Map();
 for(const ticket of tickets){
  const key=flightJourneyKey(ticket);
  if(key&&index.has(key))groups[index.get(key)].tickets.push(ticket);
  else {if(key)index.set(key,groups.length);groups.push({journeyKey:key,tickets:[ticket]});}
 }
 return groups;
}

/**
 * Non-destructive view model for flight cards. The original records and their
 * passenger-specific seat, booking reference and documents remain untouched.
 * Only records with a complete, equal journey identity are grouped.
 */
export function groupStoredFlightCards(rows=[],getLocalDate){
 rows=resolveIncompleteFlightJourneys(rows);
 const groups=[],positions=new Map();
 for(const row of rows){
  const date=typeof getLocalDate==='function'?getLocalDate(row):row.local_departure_date;
  const journey=flightJourneyKey({
   date,flightNumber:row.flight_number,
   origin:row.departure_airport_code,destination:row.arrival_airport_code
  });
  // A flight card may never combine records belonging to different trips.
  const key=journey&&row.trip_id?row.trip_id+'|'+journey:null;
  const item={...row};
  if(key&&positions.has(key))groups[positions.get(key)].passengers.push(item);
  else{
   if(key)positions.set(key,groups.length);
   groups.push({journeyKey:key,flight:item,passengers:[item]});
  }
 }
 return groups;
}

/**
 * Attach existing trip_flight_travelers to the read-only journey projection.
 * Do not infer a passenger from the flight row itself: seat on trip_flights
 * may be legacy data, and multiple travelers can belong to one flight.
 */
export function groupFlightsWithTravelers(flights=[],assignments=[],travelers=[]){
 const names=new Map(travelers.map(person=>[person.id,person.display_name]));
 const byFlight=new Map();
 for(const assignment of assignments){
  if(!byFlight.has(assignment.flight_id))byFlight.set(assignment.flight_id,[]);
  byFlight.get(assignment.flight_id).push({
   traveler_id:assignment.traveler_id,
   display_name:names.get(assignment.traveler_id)||null,
   seat:assignment.seat||null,
   flight_id:assignment.flight_id
  });
 }
 return groupStoredFlightCards(flights).map(group=>({
  ...group,
  flights:group.passengers,
  travelers:group.passengers.flatMap(flight=>byFlight.get(flight.id)||[])
 }));
}

/**
 * Recover incomplete journey identities only from a unique, fully specified
 * flight in the same trip. Flight number and departure instant must match.
 * Never infer airport codes when candidates are ambiguous.
 */
const code=v=>String(v||'').trim().toUpperCase();
const number=v=>code(v).replace(/[\s-]/g,'');
const instant=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const validNumber=v=>/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(number(v));
export function resolveIncompleteFlightJourneys(rows=[]){
 const complete=rows.filter(r=>/^[A-Z]{3}$/.test(code(r.departure_airport_code))&&/^[A-Z]{3}$/.test(code(r.arrival_airport_code))&&code(r.departure_airport_code)!==code(r.arrival_airport_code)&&validNumber(r.flight_number)&&instant(r.departure_at)!==null);
 return rows.map(row=>{
  if(code(row.departure_airport_code)&&code(row.arrival_airport_code))return row;
  if(!row.trip_id||!validNumber(row.flight_number)||instant(row.departure_at)===null)return row;
  const candidates=complete.filter(other=>other.trip_id===row.trip_id&&number(other.flight_number)===number(row.flight_number)&&instant(other.departure_at)===instant(row.departure_at)&&
   (!code(row.departure_airport_code)||code(row.departure_airport_code)===code(other.departure_airport_code))&&(!code(row.arrival_airport_code)||code(row.arrival_airport_code)===code(other.arrival_airport_code)));
  const routes=new Set(candidates.map(c=>code(c.departure_airport_code)+'|'+code(c.arrival_airport_code)));
  if(routes.size!==1)return row;
  return {...row,departure_airport_code:code(candidates[0].departure_airport_code),arrival_airport_code:code(candidates[0].arrival_airport_code)};
 });
}
const person=v=>String(v||'').normalize('NFKC').trim().toLocaleLowerCase().split(' · ').map(x=>x.trim()).sort().join(' · ');
const sameDeparture=(a,b)=>a.trip_id===b.trip_id&&validNumber(a.flight_number)&&number(a.flight_number)===number(b.flight_number)&&instant(a.departure_at)!==null&&instant(a.departure_at)===instant(b.departure_at);
export function flightTicketConflict(a,b){
 return ['departure_airport_code','arrival_airport_code','seat','booking_reference'].some(k=>code(a[k])!==code(b[k]))||
  person(a.passengers)!==person(b.passengers)||number(a.flight_number)!==number(b.flight_number)||instant(a.departure_at)!==instant(b.departure_at)||
  (instant(a.arrival_at)!==null&&instant(b.arrival_at)!==null&&instant(a.arrival_at)!==instant(b.arrival_at));
}
/** Reuse only this document's ticket, never another person's booking. */
export async function planFlightDocumentImport(rows,existing,links,documentId){
 if(!documentId)throw Error('Falta el document original.');
 const resolved=resolveIncompleteFlightJourneys([...existing,...rows]),old=resolved.slice(0,existing.length),incoming=resolved.slice(existing.length),plan=[];
 for(const row of incoming){
  if(!row.trip_id||!validNumber(row.flight_number)||instant(row.departure_at)===null)throw Error('Cal revisar el número i la sortida del vol abans de desar.');
  const linked=old.filter(r=>sameDeparture(r,row)&&links.some(l=>l.trip_id===row.trip_id&&l.flight_id===r.id&&l.document_id===documentId&&l.document_role==='booking'));
  const candidates=linked.filter(r=>person(r.passengers)===person(row.passengers));
  if(candidates.length>1||linked.some(r=>!person(r.passengers)!==!person(row.passengers)))throw Error('Hi ha bitllets amb informació ambigua en aquest document. Revisa els passatgers abans de tornar a importar.');
  const found=candidates[0];
  if(found&&flightTicketConflict(found,row))throw Error('Aquest bitllet ja existeix amb dades diferents. Revisa el vol existent abans de tornar a importar.');
  // Stable ticket ID makes retries after a link/network failure insert-only.
  const identity=JSON.stringify([row.trip_id,documentId,number(row.flight_number),instant(row.departure_at),person(row.passengers)]);
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const h=[...bytes.slice(0,16)].map(b=>b.toString(16).padStart(2,'0')).join(''),id=found?.id||[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
  const previous=plan.find(p=>p.row.id===id);
  if(previous){if(JSON.stringify(previous.row)!==JSON.stringify({...row,id}))throw Error('El PDF conté dades contradictòries del mateix bitllet.');continue}
  plan.push({row:{...row,id},existing:found||null});
 }
 return plan;
}

// Scheduling projection only: never merge tickets or expose passenger/document data.
// Require a resolved route, departure AND arrival instants; differing schedules
// remain separate commitments even if the flight number/date happens to match.
export function canonicalPlanningFlights(items=[]){
 const raw=items.map(x=>({trip_id:x.tripId,...x.flightIdentity,departure_at:x.startsAt}));
 const resolved=resolveIncompleteFlightJourneys(raw),groups=new Map(),result=[];
 items.forEach((item,i)=>{
  const r=resolved[i],start=instant(item.startsAt),end=instant(item.endsAt);
  const journey=item.sourceType==='flight'&&start!==null&&end!==null&&end>start&&r.trip_id&&flightJourneyKey({date:new Date(start).toISOString().slice(0,10),flightNumber:r.flight_number,origin:r.departure_airport_code,destination:r.arrival_airport_code});
  const key=journey?[r.trip_id,journey,start,end].join('|'):null;
  if(key&&groups.has(key))groups.get(key).relatedKeys.push(item.key);
  else {const copy={...item,relatedKeys:[item.key]};result.push(copy);if(key)groups.set(key,copy)}
 });
 return result;
}

// Only explicit flight numbers / IATA pairs in the document are evidence.
// City names and passenger names never stand in for an airport identity.
export function flightReviewIdentity(values,tripId,convertLocalTime){
 const numbers=[...String(values.title||'').matchAll(/\b([A-Z]{2}[ -]?\d{1,4}[A-Z]?)\b/g)].map(m=>number(m[1]));
 if(new Set(numbers).size!==1||!values.local_date||!values.start_local_time||!values.time_zone)return null;
 const route=String(values.title||'').match(/\b([A-Z]{3})\s*(?:→|–|-|\/)\s*([A-Z]{3})\b/);
 let departure;try{departure=convertLocalTime(values.local_date+'T'+values.start_local_time,values.time_zone)}catch{return null}
 if(instant(departure)===null)return null;
 return {trip_id:tripId,flight_number:numbers[0],departure_at:departure,departure_airport_code:route?.[1]||'',arrival_airport_code:route?.[2]||''};
}
export function matchingPlanningFlight(values,agenda,convertLocalTime){
 const flights=agenda.filter(x=>x.sourceType==='flight'),tripIds=new Set(flights.map(x=>x.tripId));
 if(tripIds.size!==1)return [];
 const candidate=flightReviewIdentity(values,[...tripIds][0],convertLocalTime);if(!candidate)return [];
 const raw=flights.map(x=>({...x.flightIdentity,trip_id:x.tripId,departure_at:x.startsAt}));
 const resolved=resolveIncompleteFlightJourneys([...raw,candidate]),wanted=resolved.at(-1);
 const route=r=>flightJourneyKey({date:new Date(instant(r.departure_at)).toISOString().slice(0,10),flightNumber:r.flight_number,origin:r.departure_airport_code,destination:r.arrival_airport_code});
 if(!route(wanted))return [];
 const indexes=resolved.slice(0,-1).flatMap((r,i)=>sameDeparture(r,wanted)&&route(r)===route(wanted)?[i]:[]);
 return indexes.map(i=>flights[i]);
}

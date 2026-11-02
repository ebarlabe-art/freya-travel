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

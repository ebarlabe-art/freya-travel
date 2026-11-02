import {groupFlightsWithTravelers} from './flight-journey-identity.mjs';

// Shared read-only flight-card data source for every trip.
// No write, merge or deletion of existing bookings.
export async function loadGroupedFlightCards(client,tripId,localDepartureDate){
 if(!tripId)throw new Error('Missing trip identifier');
 const [flights,assignments,travelers,documents]=await Promise.all([
  client.from('trip_flights').select('*').eq('trip_id',tripId),
  client.from('trip_flight_travelers').select('flight_id,traveler_id,seat').eq('trip_id',tripId),
  client.from('trip_travelers').select('id,display_name').eq('trip_id',tripId),
  client.from('trip_flight_traveler_documents').select('flight_id,traveler_id,document_id,document_role').eq('trip_id',tripId)
 ]);
 for(const response of [flights,assignments,travelers,documents])if(response.error)throw response.error;
 const byDocument=new Map();
 for(const doc of documents.data||[]){
  const key=doc.flight_id+'|'+doc.traveler_id;
  if(!byDocument.has(key))byDocument.set(key,[]);
  byDocument.get(key).push({document_id:doc.document_id,document_role:doc.document_role});
 }
 const mapped=(flights.data||[]).map(flight=>({
  ...flight,
  local_departure_date:localDepartureDate?localDepartureDate(flight):
   (flight.departure_at&&flight.departure_time_zone
    ?new Intl.DateTimeFormat('sv-SE',{timeZone:flight.departure_time_zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(flight.departure_at))
    :null)
 }));
 return groupFlightsWithTravelers(mapped,assignments.data||[],travelers.data||[]).map(group=>({
  ...group,
  travelers:group.travelers.map(traveler=>({
   ...traveler,
   documents:byDocument.get(traveler.flight_id+'|'+traveler.traveler_id)||[]
  }))
 }));
}

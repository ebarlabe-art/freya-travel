import {loadGroupedFlightCards} from './flight-card-loader.mjs';

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Render flight journeys without creating new reservations or mutating Supabase. */
export function renderGroupedFlightCards(cards=[]){
 return cards.map(group=>{
  const flight=group.flight||{};
  const route=[flight.departure_airport_code,flight.arrival_airport_code].filter(Boolean).map(escapeHtml).join(' → ');
  const title=[flight.airline,flight.flight_number].filter(Boolean).map(escapeHtml).join(' ');
  const people=(group.travelers||[]).map(person=>{
   const docs=(person.documents||[]).map(doc=>'<span class="flight-document" data-document-id="'+escapeHtml(doc.document_id)+'">'+escapeHtml(doc.document_role)+'</span>').join(' ');
   return '<li><strong>'+escapeHtml(person.display_name||'Passatger')+'</strong>'+
    (person.seat?' · Seient '+escapeHtml(person.seat):'')+
    (docs?' · '+docs:'')+'</li>';
  }).join('');
  return '<article class="flight-journey-card" data-journey-key="'+escapeHtml(group.journeyKey||'')+'">'+
   '<h3>✈️ '+title+(route?' · '+route:'')+'</h3>'+
   '<p>'+group.flights.length+' registre(s) de vol · '+(group.travelers||[]).length+' passatger(s)</p>'+
   (people?'<ul>'+people+'</ul>':'')+'</article>';
 }).join('');
}

/** Explicit UI integration point for a trip's flight section. */
export async function mountGroupedFlightCards(container,client,tripId){
 if(!container)throw new Error('Missing flight card container');
 const cards=await loadGroupedFlightCards(client,tripId);
 container.innerHTML=renderGroupedFlightCards(cards);
 return cards;
}

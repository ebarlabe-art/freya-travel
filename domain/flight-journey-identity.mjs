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

// A2.8 — user-confirmed, idempotent itinerary draft materialization.
// Pure conversion: this module performs no network or database writes.
const DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const trim=value=>String(value||'').trim();
const tidy=value=>trim(value).normalize('NFKC').toLocaleLowerCase('ca').replace(/\s+/g,' ');
const isoDay=value=>{
 const m=DATE.exec(value||'');
 return !!m&&Number(m[1])>=1900&&Number(m[1])<=2100&&Number(m[2])>=1&&
  Number(m[2])<=12&&Number(m[3])>=1&&Number(m[3])<=new Date(Date.UTC(+m[1],+m[2],0)).getUTCDate();
};
function abort(message){throw new Error(message)}
function fingerprint(values){
 return [values.local_date||'',values.start_local_time||'',tidy(values.title)].join('|');
}
function existingFingerprint(row){
 const date=trim(row.localDate||row.local_date);
 const start=trim(row.timeLabel).match(/^(\d{2}:\d{2})(?!\d)/)?.[1]||'';
 return [date,start,tidy(row.title)].join('|');
}
function zoneIsValid(zone){
 try{new Intl.DateTimeFormat('en-US',{timeZone:zone});return true}
 catch{return false}
}
export function deselectExactImportDuplicates(review){
 if(!review?.read_only||!Array.isArray(review.items))abort('Revisió no vàlida.');
 const seen=new Set();let removed=0;
 for(const item of review.items){
  const original=item.original||{},key=fingerprint(original);
  if(seen.has(key)){item.included=false;removed++}
  else seen.add(key);
 }
 return removed;
}
export async function stableItineraryImportId(tripId,documentId,sourceOrder){
 if(!UUID.test(tripId)||!UUID.test(documentId)||
  !Number.isInteger(sourceOrder)||sourceOrder<0||sourceOrder>=200)abort('Identificador de la importació invàlid.');
 const seed=new TextEncoder().encode('freya-import-itinerary-v1|'+tripId+'|'+documentId+'|'+sourceOrder);
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',seed)).slice(0,16);
 bytes[6]=(bytes[6]&15)|0x80;bytes[8]=(bytes[8]&63)|128;
 const hex=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
// Uses the same exact title/date/local-time identity as the write guard.
export function findExistingItineraryImportItems(snapshot,existing=[]){
 const byKey=new Map(existing.map(row=>[existingFingerprint(row),row]));
 return (snapshot?.items||[]).filter(item=>item.included).flatMap(item=>{
  const row=byKey.get(fingerprint(item.values||{}));
  return row?[row]:[];
 });
}
export async function prepareItineraryImportRows(snapshot,{tripId,userId,documentId,existing=[],convertLocalTime,tripStartDate=null,tripEndDate=null}){
 if(!UUID.test(tripId)||!UUID.test(userId)||!UUID.test(documentId))abort('Viatge o document invàlid.');
 if(!snapshot||!Array.isArray(snapshot.items)||snapshot.items.length>200||
  !Array.isArray(existing)||typeof convertLocalTime!=='function')abort('La revisió no és vàlida.');
 const selected=snapshot.items.filter(item=>item.included);
 if(!selected.length)abort('No hi ha cap activitat seleccionada.');
 const seen=new Set(),already=new Map(existing.map(row=>[existingFingerprint(row),row])),
  existingIds=new Map(existing.filter(row=>row?.id).map(row=>[row.id,row]));
 const rows=[];
 for(const item of selected){
  const v=item.values||{},title=trim(v.title),date=trim(v.local_date),start=trim(v.start_local_time),
   end=trim(v.end_local_time),zone=trim(v.time_zone),part=trim(v.daypart);
  if(!title||[...title].length>200)abort('Revisa el títol de totes les activitats.');
  if(date&&!isoDay(date))abort('Data no vàlida a «'+title+'».');
  if((tripStartDate&&date&&date<tripStartDate)||(tripEndDate&&date&&date>tripEndDate))
   abort('La data de «'+title+'» no és dins de les dates del viatge.');
  if((start&&!TIME.test(start))||(end&&!TIME.test(end)))abort('Hora no vàlida a «'+title+'».');
  if((start&&!date)||(end&&!start))abort('Completa la data i l’hora inicial de «'+title+'».');
  if(start&&!zone)abort('Confirma la zona horària de «'+title+'».');
  if(zone&&!zoneIsValid(zone))abort('Zona horària no vàlida a «'+title+'».');
  if(part&&!['morning','midday','afternoon','evening','night'].includes(part))abort('Franja horària no vàlida.');
  if(part&&!date)abort('Confirma el dia de «'+title+'».');
  if(end&&end<=start)abort('L’hora final de «'+title+'» ha de ser posterior a la inicial.');
  const key=fingerprint(v);
  if(seen.has(key))abort('Hi ha un duplicat seleccionat: «'+title+'». Desmarca’l abans de desar.');
  const id=await stableItineraryImportId(tripId,documentId,item.source_order);
  const matched=already.get(key);
  if(matched&&matched.id!==id)abort('«'+title+'» ja consta al planning. Obre l’itinerari per consultar les activitats desades.');
  if(existingIds.has(id)&&existingIds.get(id).title!==title)
   abort('«'+title+'» ja s’havia importat. Per modificar-la, edita-la directament al planning.');
  seen.add(key);
  let kind='unscheduled',starts_at=null,ends_at=null,local_date=null,daypart=null,time_zone=null;
  if(start){
   kind='exact';time_zone=zone;
   starts_at=convertLocalTime(date+'T'+start,zone);
   ends_at=end?convertLocalTime(date+'T'+end,zone):null;
   if(!starts_at||!Number.isFinite(Date.parse(starts_at))||
     (end&&(!ends_at||!Number.isFinite(Date.parse(ends_at))||Date.parse(ends_at)<=Date.parse(starts_at))))
    abort('No s’han pogut verificar els horaris de «'+title+'».');
  }else if(date&&part){kind='daypart';local_date=date;daypart=part;time_zone=zone||null}
  else if(date){kind='date';local_date=date;time_zone=zone||null}
  const optional=(value,max)=>{const v=trim(value);if([...v].length>max)abort('Un camp de «'+title+'» és massa llarg.');return v||null};
  rows.push({
   id,
   trip_id:tripId,created_by:userId,title,timing_kind:kind,
   starts_at,ends_at,local_date,daypart,time_zone,
   approximate_start_time:null,approximate_end_time:null,
   location_name:optional(v.location_name,200),address:optional(v.address,500),
   city:optional(v.city,200),notes:optional(v.notes,4000),
   status:'planned',is_fixed:false,is_optional:false,
   sort_order:Number.isInteger(item.source_order)?item.source_order:0
  });
 }
 return rows;
}

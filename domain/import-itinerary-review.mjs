import {normalizeItineraryImportProposal} from './import-itinerary-proposal.mjs';

// A2.7 — pure, in-memory review. Never mutate evidence or write to a trip.
const EDITABLE=new Set(['title','local_date','start_local_time','end_local_time','time_zone','location_name','city','address','notes']);
const DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const LIMITS={title:200,local_date:10,start_local_time:5,end_local_time:5,time_zone:100,location_name:200,city:200,address:500,notes:4000};
const text=(value)=>String(value||'').normalize('NFKC').toLocaleLowerCase('ca').trim().replace(/\s+/g,' ');
function validDate(value){
 const m=DATE.exec(value);
 if(!m)return false;
 const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
 return y>=1900&&y<=2100&&month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(y,month,0)).getUTCDate();
}
function validZone(value){try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}catch{return false;}}
function immutableItem(raw){
 const original=Object.fromEntries(Object.entries(raw.fields).map(([key,field])=>[key,field.value]));
 return {source_order:raw.source_order,classification_hint:raw.classification_hint,original,
  evidence:Object.fromEntries(Object.entries(raw.fields).map(([key,field])=>[key,field.evidence])),
  confidence:Object.fromEntries(Object.entries(raw.fields).map(([key,field])=>[key,field.confidence])),
  source_warnings:[...raw.warnings],source_flags:[...raw.review_flags],edits:{},included:true};
}
export function createItineraryReview(proposal,scope){
 // The A2.6 endpoint returns an already-normalized proposal with derived
 // review_flags/read_only metadata; revalidate ONLY its contract fields.
 const normalized=normalizeItineraryImportProposal({
  schema_version:proposal?.schema_version,source:proposal?.source,
  warnings:proposal?.warnings,
  candidates:proposal?.candidates?.map(candidate=>({
   source_order:candidate.source_order,classification_hint:candidate.classification_hint,
   fields:candidate.fields,warnings:candidate.warnings
  }))
 });
 if(!scope||typeof scope.tripId!=='string'||!scope.tripId||typeof scope.userId!=='string'||!scope.userId||
    typeof scope.documentId!=='string'||scope.documentId!==normalized.source.document_id)
  throw Error('Abast del document i viatge invàlid.');
 return {schema_version:1,scope:{tripId:scope.tripId,userId:scope.userId,documentId:scope.documentId},
  source:normalized.source,warnings:[...normalized.warnings],
  items:normalized.candidates.map(immutableItem),read_only:true};
}
export function reviewItemValue(item,key){
 if(!EDITABLE.has(key))return '';
 return Object.hasOwn(item.edits,key)?item.edits[key]:item.original[key]||'';
}
export function changeItineraryReviewItem(review,index,key,value){
 if(!review?.read_only||!Array.isArray(review.items)||!Number.isInteger(index)||!review.items[index])throw Error('Revisió no disponible.');
 const item=review.items[index];
 if(key==='included'){
  if(typeof value!=='boolean')throw Error('Selecció invàlida.');
  item.included=value;return review;
 }
 if(!EDITABLE.has(key)||typeof value!=='string')throw Error('Camp no editable.');
 if(value.trim().length>LIMITS[key])throw Error('Valor massa llarg.');
 item.edits[key]=value.trim();
 return review;
}
function effective(item){
 return Object.fromEntries([...EDITABLE].map(key=>[key,reviewItemValue(item,key)]));
}
// A place can move days or gain extra wording; compare only distinctive
// landmarks. Never treat a generic meal, city centre or walk as a duplicate.
function sameNamedLandmark(left,right){
 const norm=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[’']/g,"'").replace(/[^a-z0-9]+/g,' ').trim()
  .replace(/^(?:(?:visita|visit)\s+(?:(?:exterior|guiada)\s+)?(?:a|al|de|del|la|el)\s+)+/,'');
 const a=norm(left),b=norm(right);
 const landmark=/\b(?:catedral|cathedral|castell|castle|casa|house|museu|museum|mercat|market|palau|palace|monument|esglesia|church|torre|tower|basilica|sant|saint)\b/;
 if(!landmark.test(a)||!landmark.test(b))return false;
 const stop=new Set(['de','del','dels','la','les','el','els','al','a','i','en','the','of','at','in','and','per','pel','una','un']);
 const containsDistinctivePrefix=(from,to)=>{
  const tokens=from.split(' '),joined=' '+to+' ';
  for(let n=3;n<=Math.min(7,tokens.length);n++){
   const prefix=tokens.slice(0,n);
   if(prefix.filter(token=>!stop.has(token)).length<2)continue;
   const phrase=prefix.join(' ');
   if(phrase.length>=12&&joined.includes(' '+phrase+' '))return true;
  }
  return false;
 };
 return containsDistinctivePrefix(a,b)||containsDistinctivePrefix(b,a);
}
// Conservative matches are review suggestions, never permission to update an existing row.
export function matchingExistingImportItems(candidate,existing=[]){
 const normalize=value=>text(value).replace(/[’']/g,"'").replace(/[.,;:!?]+$/g,'');
 const wanted=normalize(candidate.title),date=candidate.local_date,time=candidate.start_local_time;
 if(!wanted||!date)return [];
 return existing.flatMap(row=>{
  const title=normalize(row.title),day=String(row.localDate||row.local_date||'');
  const at=String(row.timeLabel||'').match(/^(\d{2}:\d{2})/)?.[1]||'';
  const exact=title===wanted;
  const truncated=title.split(' ').length>=6&&wanted.split(' ').length>=6&&
   (wanted.startsWith(title+' ')||title.startsWith(wanted+' '));
  const landmark=!exact&&!truncated&&sameNamedLandmark(candidate.title,row.title);
  if(!exact&&!truncated&&!landmark)return [];
  if(day===date&&(!at||!time||at===time))return [{title:row.title,localDate:day,timeLabel:at,reason:'possible_existing_duplicate'}];
  const delta=Math.abs(Date.parse(date+'T12:00:00Z')-Date.parse(day+'T12:00:00Z'));
  if(day!==date&&(exact||truncated)&&at===time&&/^0[0-5]:[0-5]\d$/.test(time)&&delta===86400000)
   return [{title:row.title,localDate:day,timeLabel:at,reason:'existing_date_conflict'}];
  // Identical *generic* activities (e.g. "Museu" or "Esmorzar") on
  // different days are legitimate. Only an identifiable landmark is a
  // cross-day candidate for rescheduling.
  if(day===date||landmark||sameNamedLandmark(candidate.title,row.title))
   return [{title:row.title,localDate:day,timeLabel:at,reason:'possible_existing_replanned'}];
  return [];
 });
}
export function excludeExistingImportItems(review,existing=[]){
 if(!review?.read_only||!Array.isArray(review.items))throw Error('Revisió no disponible.');
 let removed=0;
 for(const item of review.items)if(item.included&&matchingExistingImportItems(effective(item),existing).length){
  item.included=false;removed++;
 }
 return removed;
}
function candidateFlags(item,existing){
 const c=effective(item),issues=[];
 if(!c.title)issues.push('missing_title');
 else if(!/\p{L}/u.test(c.title))issues.push('invalid_title');
 if(c.local_date&&!validDate(c.local_date))issues.push('invalid_date');
 if(c.start_local_time&&!TIME.test(c.start_local_time))issues.push('invalid_start_time');
 if(c.end_local_time&&!TIME.test(c.end_local_time))issues.push('invalid_end_time');
 if(c.time_zone&&!validZone(c.time_zone))issues.push('invalid_time_zone');
 if(c.end_local_time&&!c.start_local_time)issues.push('end_without_start');
 if(c.start_local_time&&!c.local_date)issues.push('date_required_for_time');
 if(c.start_local_time&&!c.time_zone)issues.push('timezone_needs_confirmation');
 if(c.start_local_time&&c.end_local_time&&TIME.test(c.start_local_time)&&TIME.test(c.end_local_time)&&c.end_local_time<=c.start_local_time)issues.push('time_order_needs_review');
 if(Object.entries(item.confidence).some(([key,v])=>v!=='high'&&!Object.hasOwn(item.edits,key)))issues.push('uncertain_extraction');
 for(const match of matchingExistingImportItems(c,existing))if(!issues.includes(match.reason))issues.push(match.reason);
 return issues;
}
export function summarizeItineraryReview(review,existing=[]){
 if(!review?.read_only||!Array.isArray(review.items))throw Error('Revisió no disponible.');
 const snapshot=review.items.map((item,index)=>({
  index,source_order:item.source_order,classification_hint:item.classification_hint,
  included:item.included,values:effective(item),confidence:{...item.confidence},
  evidence:item.evidence,source_warnings:item.source_warnings.slice(),
  source_flags:item.source_flags.slice(),edited_fields:Object.keys(item.edits),
  existing_matches:matchingExistingImportItems(effective(item),existing),
  review_flags:candidateFlags(item,existing)
 }));
 // Flag exact duplicates across selected candidates without discarding them.
 const seen=new Map();
 for(const item of snapshot.filter(x=>x.included)){
  const c=item.values;
  if(!c.title||!c.local_date)continue;
  const key=[c.local_date,c.start_local_time,text(c.title)].join('|');
  if(seen.has(key)){
   item.review_flags.push('possible_duplicate_in_review');
   const first=seen.get(key);
   if(!first.review_flags.includes('possible_duplicate_in_review'))first.review_flags.push('possible_duplicate_in_review');
  }else seen.set(key,item);
 }
 // Suggest overlap only when both time spans are complete on the same date/time zone.
 const definite=snapshot.filter(x=>x.included&&x.values.local_date&&x.values.time_zone&&
  TIME.test(x.values.start_local_time)&&TIME.test(x.values.end_local_time)&&
  x.values.end_local_time>x.values.start_local_time);
 for(let i=0;i<definite.length;i++)for(let j=i+1;j<definite.length;j++){
  const a=definite[i],b=definite[j],x=a.values,y=b.values;
  if(x.local_date!==y.local_date||x.time_zone!==y.time_zone)continue;
  if(x.start_local_time<y.end_local_time&&y.start_local_time<x.end_local_time){
   if(!a.review_flags.includes('possible_overlap_in_review'))a.review_flags.push('possible_overlap_in_review');
   if(!b.review_flags.includes('possible_overlap_in_review'))b.review_flags.push('possible_overlap_in_review');
  }
 }
 for(const item of snapshot){
  const informationalWarning=w=>/^Any agafat del títol general|^Element sense hora explícita/.test(w);
  item.important_flags=item.review_flags.filter(flag=>flag!=='uncertain_extraction');
  // Low-confidence factual extraction is important; medium confidence stays visible separately.
  if(Object.entries(item.confidence).some(([key,v])=>v==='low'&&!item.edited_fields.includes(key)))item.important_flags.push('uncertain_extraction');
  item.important_warnings=item.source_warnings.filter(w=>!informationalWarning(w));
  item.information=item.source_warnings.filter(informationalWarning);
  if(item.review_flags.includes('uncertain_extraction')&&!item.important_flags.includes('uncertain_extraction'))
   item.information.push('Hi ha camps extrets amb confiança mitjana: contrasta’ls amb el document.');
 }
 const included=snapshot.filter(x=>x.included),needsReview=included.filter(x=>x.review_flags.length||x.source_warnings.length);
 return {items:snapshot,total:snapshot.length,selected:included.length,needsReview:needsReview.length,
  important:included.filter(x=>x.important_flags.length||x.important_warnings.length).length,
  informational:included.filter(x=>x.information.length).length,
  read_only:true,can_write:false,warnings:review.warnings.slice()};
}

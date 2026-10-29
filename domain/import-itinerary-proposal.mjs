// A2.5: read-only, evidence-backed contract for importing complete itineraries.
// Deliberately no database, authentication or write operations.
const FIELD_NAMES=Object.freeze([
 'title','local_date','start_local_time','end_local_time','time_zone',
 'daypart','location_name','address','city','notes'
]);
const FIELD_SET=new Set(FIELD_NAMES);
const CONFIDENCE=new Set(['high','medium','low']);
const SOURCE_KINDS=new Set(['document','screenshot','email','manual']);
const HINTS=new Set(['manual','activity','local_transport','flight','accommodation','car_rental']);
const DAYPARTS=new Set(['morning','midday','afternoon','evening','night']);
const MAX_ITEMS=200;

function fail(message,code='invalid_itinerary_import_proposal'){
 throw Object.assign(new Error(message),{code});
}
function isObject(value){
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
}
function keysOnly(value,allowed,label){
 if(Object.keys(value).some(key=>!allowed.has(key)))fail(label+': camp no admès.','forbidden_itinerary_import_field');
}
function shortString(value,label,max=500){
 if(typeof value!=='string'||!value.trim()||[...value].length>max)fail(label+' invàlid.');
 return value.trim();
}
function trueDate(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
 if(!match)return false;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 if(year<1900||year>2100||month<1||month>12)return false;
 return day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate();
}
function trueTime(value){return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);}
function normalizeEvidence(value){
 if(!Array.isArray(value)||!value.length||value.length>12)fail('Cal acreditar cada camp amb evidència.');
 return value.map(item=>{
  if(!isObject(item))fail('Evidència invàlida.');
  keysOnly(item,new Set(['kind','excerpt','page']),'Evidència');
  if(!['text','visual','metadata'].includes(item.kind))fail('Tipus d’evidència no admès.');
  const out={kind:item.kind};
  if(item.excerpt!==undefined)out.excerpt=shortString(item.excerpt,'Fragment',500);
  if(item.page!==undefined){
   if(!Number.isInteger(item.page)||item.page<1||item.page>10000)fail('Pàgina d’evidència invàlida.');
   out.page=item.page;
  }
  if(out.excerpt===undefined&&out.page===undefined)fail('L’evidència necessita fragment o pàgina.');
  return out;
 });
}
function normalizeField(key,raw){
 if(!isObject(raw))fail('Camp '+key+' invàlid.');
 keysOnly(raw,new Set(['value','confidence','evidence']),'Camp '+key);
 if(!CONFIDENCE.has(raw.confidence))fail('Confiança invàlida: '+key+'.');
 const value=shortString(raw.value,key,key==='notes'?4000:key==='address'?500:200);
 if(key==='local_date'&&!trueDate(value))fail('Data impossible o mal formada.');
 if((key==='start_local_time'||key==='end_local_time')&&!trueTime(value))fail('Hora local invàlida.');
 if(key==='daypart'&&!DAYPARTS.has(value))fail('Franja horària invàlida.');
 if(key==='time_zone'){try{new Intl.DateTimeFormat('en-US',{timeZone:value});}catch{fail('Zona horària no verificada.');}}
 return {value,confidence:raw.confidence,evidence:normalizeEvidence(raw.evidence)};
}
function normalizeList(raw,name,limit=50){
 if(raw===undefined)return [];
 if(!Array.isArray(raw)||raw.length>limit)fail(name+' invàlids.');
 return [...new Set(raw.map(value=>shortString(value,name,300)))];
}
function normalizeSource(raw){
 if(!isObject(raw))fail('Origen invàlid.');
 keysOnly(raw,new Set(['kind','document_id','file_name','mime_type']),'Origen');
 if(!SOURCE_KINDS.has(raw.kind))fail('Tipus d’origen invàlid.');
 const source={kind:raw.kind};
 if(raw.document_id!==undefined)source.document_id=shortString(raw.document_id,'Document',100);
 if(raw.file_name!==undefined)source.file_name=shortString(raw.file_name,'Fitxer',500);
 if(raw.mime_type!==undefined)source.mime_type=shortString(raw.mime_type,'MIME',200);
 if(raw.kind==='document'&&!source.document_id)fail('El PDF ha de referenciar un document privat existent.');
 return source;
}
// A PDF table can include a literal "| Lloc:" in the activity line.
// The text is evidence for a place name, never evidence for exact coordinates.
function splitInlinePlace(fields,warnings){
 const original=fields.title?.value||'';
 const marker=/\s*[|｜]\s*(?:lloc|ubicaci[oó]|location|place|venue|adre[cç]a|address)\s*:\s*/i;
 const match=marker.exec(original);
 if(!match)return;
 const title=original.slice(0,match.index).trim().replace(/[|｜]\s*$/,'');
 const place=original.slice(match.index+match[0].length).trim();
 if(!title||!/[\p{L}]/u.test(title))return;
 fields.title={...fields.title,value:title};
 // This is a human-readable site, not a verified address/geocode.
 if(place&&[...place].length<=200){
  if(!fields.location_name||fields.location_name.confidence!=='high')
   fields.location_name={value:place,confidence:'medium',evidence:fields.title.evidence};
 }else if(!warnings.includes('Lloc explícit incomplet: revisa el PDF original.')){
  warnings.push('Lloc explícit incomplet: revisa el PDF original.');
 }
}
function normalizeCandidate(raw){
 if(!isObject(raw))fail('Element d’itinerari invàlid.');
 keysOnly(raw,new Set(['source_order','classification_hint','fields','warnings']),'Element');
 if(!Number.isInteger(raw.source_order)||raw.source_order<0||raw.source_order>=MAX_ITEMS)fail('Ordre d’origen invàlid.');
 if(!HINTS.has(raw.classification_hint))fail('Classificació no admesa.');
 if(!isObject(raw.fields))fail('Camps d’itinerari invàlids.');
 keysOnly(raw.fields,FIELD_SET,'Camps d’itinerari');
 const fields=Object.fromEntries(Object.entries(raw.fields).map(([key,value])=>[key,normalizeField(key,value)]));
 if(!fields.title)fail('Cada element necessita un títol acreditat.');
 const warnings=normalizeList(raw.warnings,'Avisos');
 splitInlinePlace(fields,warnings);
 const flags=[];
 if(!fields.local_date&&(fields.start_local_time||fields.end_local_time))flags.push('date_required_for_time');
 if(fields.end_local_time&&!fields.start_local_time)flags.push('start_required_for_end');
 if(fields.start_local_time&&!fields.time_zone)flags.push('timezone_needs_confirmation');
 if(fields.start_local_time&&fields.end_local_time&&fields.end_local_time.value<=fields.start_local_time.value)flags.push('time_order_needs_review');
 if(Object.values(fields).some(field=>field.confidence!=='high'))flags.push('uncertain_extraction');
 return {source_order:raw.source_order,classification_hint:raw.classification_hint,
  fields,warnings,review_flags:flags};
}
function candidateFingerprint(candidate){
 const fields=candidate.fields;
 return [
  fields.local_date?.value||'',fields.start_local_time?.value||'',
  fields.title.value.normalize('NFKC').toLocaleLowerCase('ca').replace(/\s+/g,' ').trim()
 ].join('|');
}
export function normalizeItineraryImportProposal(raw){
 if(!isObject(raw))fail('Proposta d’itinerari invàlida.');
 keysOnly(raw,new Set(['schema_version','source','candidates','warnings']),'Proposta');
 if(raw.schema_version!==1)fail('Versió d’itinerari no suportada.','unsupported_itinerary_import_schema');
 const source=normalizeSource(raw.source);
 if(!Array.isArray(raw.candidates)||!raw.candidates.length||raw.candidates.length>MAX_ITEMS)fail('Nombre d’elements d’itinerari invàlid.');
 const candidates=raw.candidates.map(normalizeCandidate),orders=new Set(),fingerprints=new Map();
 for(let index=0;index<candidates.length;index++){
  const candidate=candidates[index];
  if(orders.has(candidate.source_order))fail('L’ordre original conté duplicats.');
  orders.add(candidate.source_order);
  const fingerprint=candidateFingerprint(candidate);
  if(fingerprints.has(fingerprint)){
   candidate.review_flags.push('possible_duplicate_in_source');
   const previous=candidates[fingerprints.get(fingerprint)];
   if(!previous.review_flags.includes('possible_duplicate_in_source'))previous.review_flags.push('possible_duplicate_in_source');
  }else fingerprints.set(fingerprint,index);
 }
 return {schema_version:1,source,candidates,warnings:normalizeList(raw.warnings,'Avisos'),
  read_only:true,requires_user_confirmation:true};
}
export function itineraryImportProposalCanWrite(){return false;}
export const itineraryImportFieldNames=FIELD_NAMES;

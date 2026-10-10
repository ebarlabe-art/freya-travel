import {normalizeItineraryImportProposal} from './import-itinerary-proposal.mjs';

// A2.6: deterministic text-to-proposal extractor, no storage or network access.
// Input pages must already contain extracted text with trustworthy page numbers.
const CALENDAR=/^(?:dia|día|day)\s*\d{1,3}\s*(?:[-:·.–—]\s*|\s+)?/i;
const WEEKDAY=/^(?:(?:dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s+)/i;
const DATE_PREFIX=/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?!\d)/;
const PARTIAL_DATE=/^\d{1,2}[/.]\d{1,2}(?![/.]\d)/;
const MONTH_DATE=/^(\d{1,2})\s+(?:de\s+)?([a-zà-ÿ]+)\s+(?:de\s+)?(\d{4})(?!\d)/i;
const TZ_RE=/(?:\bTZ\b|\btime\s*zone\b|\btimezone\b|\bzona\s+hor[aà]ria\b)\s*[:=]?\s*([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)/i;
const TIME='((?:[01]?\\d|2[0-3])[:.h][0-5]\\d)';
const CLOCK=new RegExp('^'+TIME+'(?:\\s*(?:-|–|—|a|to)\\s*'+TIME+')?\\s*(?:[-–—:·]\\s*)?(.+)$','i');
const BULLET=/^(?:[-*•]\s+|\d{1,2}[.)]\s+)(.+)$/;
const DAYPART=/^(mat[ií]|morning|mañana|tarda|afternoon|vespre|evening|nit|night|migdia|mediod[ií]a)\s*[:–—-]\s*(.+)$/i;
const ADMIN=/^(?:(?:reserva|booking|reference|refer[eè]ncia|localitzador|confirmaci[oó]|tel[eè]fon|phone|contacte|total|preu|price|cost|notes?|document|passaport|passport|p[aà]gina|page)\s*[:#])/i;
const HEADER=/^(?:(?:itinerari|itinerary|programa|planning|pla de viatge|ruta|destinaci[oó])(?:\s+.{0,80})?)$/i;
const MONTHS={
 gener:1,enero:1,january:1,jan:1,
 febrer:2,febrero:2,february:2,feb:2,
 març:3,marc:3,marzo:3,march:3,mar:3,
 abril:4,april:4,abr:4,apr:4,
 maig:5,mayo:5,may:5,
 juny:6,junio:6,june:6,jun:6,
 juliol:7,julio:7,july:7,jul:7,
 agost:8,agosto:8,august:8,ago:8,aug:8,
 setembre:9,septiembre:9,september:9,sept:9,sep:9,
 octubre:10,october:10,oct:10,
 novembre:11,noviembre:11,november:11,nov:11,
 desembre:12,diciembre:12,december:12,des:12,dec:12,dic:12
};

function fail(message,code='invalid_itinerary_text'){
 throw Object.assign(new Error(message),{code});
}
const stripAccents=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function calendarDate(year,month,day){
 const y=Number(year),m=Number(month),d=Number(day);
 if(!Number.isInteger(y)||y<1900||y>2100||m<1||m>12||d<1||d>31)return null;
 if(new Date(Date.UTC(y,m,0)).getUTCDate()<d)return null;
 return String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}
function readDatePrefix(input){
 const clean=input.trim();
 const numeric=clean.match(DATE_PREFIX);
 if(numeric){
  const token=numeric[1],parts=token.split(/[-/.]/);
  const date=parts[0].length===4
   ?calendarDate(parts[0],parts[1],parts[2])
   :calendarDate(parts[2],parts[1],parts[0]);
  return {date,token,rest:clean.slice(numeric[0].length).trim()};
 }
 const word=clean.match(MONTH_DATE);
 if(word){
  const month=MONTHS[stripAccents(word[2])];
  if(month){
   return {date:calendarDate(word[3],month,word[1]),token:word[0],
    rest:clean.slice(word[0].length).trim()};
  }
 }
 return null;
}
function makeField(value,excerpt,page,confidence='high'){
 return {value,confidence,evidence:[{kind:'text',excerpt:excerpt.slice(0,500),page}]};
}
function canonicalTime(value){
 const match=/^(\d{1,2})[:.h](\d{2})$/.exec(value);
 return match?match[1].padStart(2,'0')+':'+match[2]:null;
}
function explicitZone(line){
 const match=line.match(TZ_RE);
 if(!match)return null;
 const value=match[1];
 try{new Intl.DateTimeFormat('en-US',{timeZone:value});return {value,evidence:line};}
 catch{return {invalid:true,evidence:line};}
}
function hintFromTitle(value){
 const t=stripAccents(value);
 if(/^(?:vol\b|flight\b|vuelo\b|avion\b)/.test(t))return 'flight';
 if(/^(?:hotel\b|allotjament\b|alojamiento\b|hostel\b|check[- ]?in\b)/.test(t))return 'accommodation';
 if(/^(?:tren\b|train\b|bus\b|autobus\b|metro\b|ferri\b|ferry\b|transfer\b|trasllat\b)/.test(t))return 'local_transport';
 if(/^(?:lloguer de cotxe\b|alquiler de coche\b|car rental\b|recollida del cotxe\b)/.test(t))return 'car_rental';
 if(/^(?:visita\b|tour\b|excursio\b|museu\b|museo\b|museum\b|entrada\b)/.test(t))return 'activity';
 return 'manual';
}
function cleanTitle(value){
 return value.replace(/^\s*[-*•]\s*/,'').replace(/^\s*[·:–—-]\s*/,'').trim();
}
function readItem(line,hasDay){
 const normalized=line.trim().replace(/^\u2022\s*/,'• ');
 const clock=normalized.match(CLOCK);
 if(clock){
  const title=cleanTitle(clock[3]);
  if(!title)return null;
  return {title,start:canonicalTime(clock[1]),end:clock[2]?canonicalTime(clock[2]):null,confidence:'high'};
 }
 const daypart=normalized.match(DAYPART);
 if(daypart){
  const mapping={mati:'morning',morning:'morning',manana:'morning',tarda:'afternoon',
   afternoon:'afternoon',vespre:'evening',evening:'evening',nit:'night',night:'night',
   migdia:'midday',mediodia:'midday'};
  const title=cleanTitle(daypart[2]);
  if(!title)return null;
  return {title,daypart:mapping[stripAccents(daypart[1])],confidence:'high'};
 }
 if(hasDay){
  const bullet=normalized.match(BULLET);
  if(bullet){
   const title=cleanTitle(bullet[1]);
   if(title&&!ADMIN.test(title)&&!HEADER.test(title))return {title,confidence:'medium'};
  }
 }
 return null;
}
function normalizePages(rawPages){
 if(!Array.isArray(rawPages)||!rawPages.length||rawPages.length>150)fail('Pàgines de text invàlides.');
 let previous=0,total=0;
 return rawPages.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['page','text'].includes(k)))fail('Format de pàgina invàlid.');
  if(!Number.isInteger(raw.page)||raw.page<=previous||raw.page>10000)fail('Les pàgines han de ser creixents i úniques.');
  if(typeof raw.text!=='string')fail('Text de pàgina invàlid.');
  previous=raw.page;
  total+=raw.text.length;
  if(total>500000)fail('Document massa gran per al primer extractor.');
  return {page:raw.page,text:raw.text.replace(/\r\n?/g,'\n')};
 });
}
export function extractItineraryProposalFromPages(rawPages,source={kind:'manual'}){
 const pages=normalizePages(rawPages),candidates=[],warnings=new Set();
 let current=null,unparsed=0,invalidDate=false;
 for(const {page,text} of pages){
  for(const raw of text.split('\n')){
   const line=raw.trim().replace(/\s+/g,' ');
   if(!line||line.length>1000){if(line.length>1000)warnings.add('Línia massa llarga: cal revisar el document.');continue;}
   let work=line.replace(WEEKDAY,'');
   const dayMarker=CALENDAR.test(work);
   if(dayMarker)work=work.replace(CALENDAR,'');
   const datePart=readDatePrefix(work);
   const tz=explicitZone(line);
   if(tz?.invalid)warnings.add('Zona horària no reconeguda: cal revisar-la.');
   if(dayMarker&&!datePart){
    current=null;
    warnings.add('Hi ha dies numerats sense data completa: no s’ha inventat l’any.');
    continue;
   }
   if(datePart){
    if(!datePart.date){
     current=null;
     invalidDate=true;
     warnings.add('Hi ha una data impossible: no s’ha assignat a cap activitat.');
     continue;
    }
    const tail=datePart.rest.replace(/^(?:[-–—·|]\s*)/,'');
    const inline=readItem(tail,false);
    if(inline){
     // Explicit date on the same line belongs only to that item.
     const candidate=makeCandidate(inline,line,page,{date:datePart.date,evidence:line},tz);
     candidates.push(candidate);
    }else{
     // A dated day heading controls subsequent entries, including next PDF page.
     current={date:datePart.date,evidence:line,page,zone:tz&&!tz.invalid?tz:null};
    }
    if(candidates.length>200)fail('Massa activitats al document.','itinerary_import_too_many_items');
    continue;
   }
   if(PARTIAL_DATE.test(work)||/^(?:dia|día|day)\s*\d{1,3}\s*$/.test(line)){
    current=null;warnings.add('Hi ha dates sense any: cal confirmar-les.');continue;
   }
   if(HEADER.test(line)||/^p[àa]g(?:ina)?\s*\d+$/i.test(line))continue;
   const item=readItem(line,!!current);
   if(item){
    candidates.push(makeCandidate(item,line,page,current?{date:current.date,evidence:current.evidence,page:current.page}:null,
      tz&&!tz.invalid?tz:current?.zone));
   }else if(current&&!ADMIN.test(line)&&!tz)unparsed++;
   if(candidates.length>200)fail('Massa activitats al document.','itinerary_import_too_many_items');
  }
 }
 if(!candidates.length)fail('No he pogut identificar cap activitat acreditada.','no_itinerary_candidates');
 if(candidates.some(c=>!c.fields.local_date))warnings.add('Hi ha activitats sense data completa: cal revisar-les.');
 if(unparsed)warnings.add('Algunes línies no s’han pogut convertir en activitats.');
 if(invalidDate)warnings.add('Les dates impossibles no s’han recuperat del context anterior.');
 return normalizeItineraryImportProposal({
  schema_version:1,source,candidates,warnings:[...warnings]
 });
}
function makeCandidate(item,line,page,date,zone){
 const fields={title:makeField(item.title,line,page,item.confidence)};
 if(date)fields.local_date=makeField(date.date,date.evidence,date.page);
 if(item.start)fields.start_local_time=makeField(item.start,line,page);
 if(item.end)fields.end_local_time=makeField(item.end,line,page);
 if(item.daypart)fields.daypart=makeField(item.daypart,line,page);
 if(zone)fields.time_zone=makeField(zone.value,zone.evidence,
  date&&zone===date.zone?date.page:page);
 const warnings=[];
 if(item.confidence==='medium')warnings.push('Element sense hora explícita: revisa’n la classificació.');
 if(!date)warnings.push('Falta la data de l’activitat.');
 return {source_order:0,classification_hint:hintFromTitle(item.title),fields,warnings};
}
export function extractItineraryProposalFromText(rawText,source={kind:'manual'}){
 if(typeof rawText!=='string')fail('Text d’itinerari invàlid.');
 return extractItineraryProposalFromPages([{page:1,text:rawText}],source);
}

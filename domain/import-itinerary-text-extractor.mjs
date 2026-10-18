import {normalizeItineraryImportProposal} from './import-itinerary-proposal.mjs';

// A2.6: deterministic text-to-proposal extractor, no storage or network access.
// Input pages must already contain extracted text with trustworthy page numbers.
const CALENDAR=/^(?:dia|día|day)\s*\d{1,3}\s*(?:[-:·.–—]\s*|\s+)?/i;
const WEEKDAY=/^(?:(?:dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s+)/i;
const DATE_PREFIX=/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?!\d)/;
const PARTIAL_DATE=/^\d{1,2}[/.]\d{1,2}(?![/.]\d)/;
const MONTH_DATE=/^(\d{1,2})\s+(?:(?:de\s+)|d['’])?([a-zà-ÿ]+)\s+(?:de\s+)?(\d{4})(?!\d)/i;
const DAY_MONTH=/^(\d{1,2})\s+(?:(?:de\s+)|d['’])?([a-zà-ÿ]+)\b/i;
const TZ_RE=/(?:\bTZ\b|\btime\s*zone\b|\btimezone\b|\bzona\s+hor[aà]ria\b|\bhora\s+local\b|\blocal\s+time\b)\s*[:=]?\s*([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)/i;
const TIME='((?:[01]?\\d|2[0-3])[:.h][0-5]\\d)';
const CLOCK=new RegExp('^'+TIME+'(?:\\s*h\\b)?(?:\\s*(?:-|–|—|a|to)\\s*'+TIME+'(?:\\s*h\\b)?)?\\s*(?:[-–—:·]\\s*)?(.+)$','i');
const BULLET=/^(?:[-*•]\s+|\d{1,2}[.)]\s+)(.+)$/;
const DAYPART=/^(mat[ií]|morning|mañana|tarda|afternoon|vespre|evening|nit|night|migdia|mediod[ií]a)\s*[:–—-]\s*(.+)$/i;
const UNTYPED_DAYPART=/^(mat[ií]|morning|mañana|tarda|afternoon|vespre|evening|nit|night|migdia|mediod[ií]a)\s*,\s*(?:sense hora exacta|sin hora exacta|no exact time)\s*(?:[:–—-]\s*(.+))?$/i;
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
function readDatePrefix(input,yearHint=null){
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
 const short=clean.match(DAY_MONTH);
 if(short&&yearHint){
  const month=MONTHS[stripAccents(short[2])];
  if(month)return {date:calendarDate(yearHint.year,month,short[1]),token:short[0],
   rest:clean.slice(short[0].length).trim(),confidence:'medium',yearEvidence:yearHint.evidence};
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
function explicitZone(line,page){
 const match=line.match(TZ_RE);
 if(!match)return null;
 const value=match[1];
 try{new Intl.DateTimeFormat('en-US',{timeZone:value});return {value,evidence:line,page};}
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
function daypartValue(label){
 const mapping={mati:'morning',morning:'morning',manana:'morning',tarda:'afternoon',
  afternoon:'afternoon',vespre:'evening',evening:'evening',nit:'night',night:'night',
  migdia:'midday',mediodia:'midday'};
 return mapping[stripAccents(label)]||null;
}
function readItem(line,hasDay){
 const normalized=line.trim().replace(/^\u2022\s*/,'• ');
 const clock=normalized.match(CLOCK);
 if(clock){
  const title=cleanTitle(clock[3]);
  if(!title||!/[\p{L}]/u.test(title))return null;
  return {title,start:canonicalTime(clock[1]),end:clock[2]?canonicalTime(clock[2]):null,confidence:'high'};
 }
 const daypart=normalized.match(DAYPART)||normalized.match(UNTYPED_DAYPART);
 if(daypart&&daypart[2]){
  const title=cleanTitle(daypart[2]);
  if(!title||!/[\p{L}]/u.test(title))return null;
  return {title,daypart:daypartValue(daypart[1]),confidence:'high'};
 }
 if(hasDay){
  const bullet=normalized.match(BULLET);
  if(bullet){
   const title=cleanTitle(bullet[1]);
   if(title&&/\p{L}/u.test(title)&&!ADMIN.test(title)&&!HEADER.test(title))return {title,confidence:'medium'};
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
function documentYearHint(pages){
 const matches=new Map();
 for(const {page,text} of pages)for(const raw of text.split('\n')){
  const line=raw.trim();
  if(!/^(?:escapada|itinerari|viatge|planning|programa|pla de viatge|del\s+)/i.test(line))continue;
  for(const match of line.matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)/g))
   if(!matches.has(match[0]))matches.set(match[0],{year:match[0],evidence:line,page});
 }
 return matches.size===1?[...matches.values()][0]:null;
}
// Only shift a post-midnight event if the text explicitly says it occurs
// on the immediately following weekday AND its calendar day matches.
function explicitNextMorningDate(line,start,current){
 if(!start||!current?.date||Number(start.slice(0,2))>=6)return null;
 const match=line.match(/\bmatinada\s+del\s+(dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)\s+(\d{1,2})(?!\d)/i);
 if(!match)return null;
 const next=new Date(current.date+'T12:00:00Z');if(!Number.isFinite(next.getTime()))return null;
 next.setUTCDate(next.getUTCDate()+1);
 const expected=new Intl.DateTimeFormat('ca-ES',{timeZone:'UTC',weekday:'long'}).format(next);
 if(stripAccents(expected)!==stripAccents(match[1])||next.getUTCDate()!==Number(match[2]))return null;
 return {date:next.toISOString().slice(0,10),page:current.page,
  evidence:line+' | Dia següent explícit: '+match[1]+' '+match[2],confidence:'high'};
}
export function extractItineraryProposalFromPages(rawPages,source={kind:'manual'}){
 const pages=normalizePages(rawPages),candidates=[],warnings=new Set(),yearHint=documentYearHint(pages);
 let current=null,documentZone=null,pendingDaypart=null,unparsed=0,invalidDate=false;
 for(const {page,text} of pages){
  for(const raw of text.split('\n')){
   const line=raw.trim().replace(/\s+/g,' ');
   if(!line||line.length>1000){if(line.length>1000)warnings.add('Línia massa llarga: cal revisar el document.');continue;}
   let work=line.replace(WEEKDAY,'');
   const dayMarker=CALENDAR.test(work);
   // Day labels often precede a weekday: "DIA 1 · Diumenge 27/12/2026".
   if(dayMarker)work=work.replace(CALENDAR,'').replace(WEEKDAY,'').trim();
   const datePart=readDatePrefix(work,yearHint);
   const tz=explicitZone(line,page);
   if(tz?.invalid){
    documentZone=null;
    if(current)current.zone=null;
    warnings.add('Zona horària no reconeguda: cal revisar-la.');
   }else if(tz&&!current&&!datePart&&!dayMarker)documentZone=tz;
   if(dayMarker&&!datePart){
    current=null;pendingDaypart=null;
    warnings.add('Hi ha dies numerats sense data completa: no s’ha inventat l’any.');
    continue;
   }
   if(datePart){
    if(!datePart.date){
     current=null;pendingDaypart=null;
     invalidDate=true;
     warnings.add('Hi ha una data impossible: no s’ha assignat a cap activitat.');
     continue;
    }
    // Keep the explicit date as the active day for subsequent entries, even if
    // the heading also includes the first activity of that day.
    pendingDaypart=null;
    current={date:datePart.date,evidence:datePart.yearEvidence?line+' | Any explícit al document: '+datePart.yearEvidence:line,page,confidence:datePart.confidence||'high',zone:tz&&!tz.invalid?tz:documentZone};
    const tail=datePart.rest.replace(/^(?:[-–—·|]\s*)/,'');
    const inline=readItem(tail,false);
    if(inline){
     // Explicit date on the same line belongs only to that item.
     const candidate=makeCandidate(inline,line,page,{date:datePart.date,evidence:current.evidence,page,confidence:current.confidence},current.zone,candidates.length);
     candidates.push(candidate);
    }
    if(candidates.length>200)fail('Massa activitats al document.','itinerary_import_too_many_items');
    continue;
   }
   if((!CLOCK.test(line)&&PARTIAL_DATE.test(work))||/^(?:dia|día|day)\s*\d{1,3}\s*$/.test(line)){
    current=null;pendingDaypart=null;warnings.add('Hi ha dates sense any: cal confirmar-les.');continue;
   }
   if(HEADER.test(line)||/^p[àa]g(?:ina)?\s*\d+$/i.test(line))continue;
   // A standalone explicit time-zone line annotates the current day.
   if(tz&&!tz.invalid&&/^\s*(?:TZ|time\s*zone|timezone|zona\s+hor[aà]ria|hora\s+local|local\s+time)\b/i.test(line)){
    if(current)current.zone=tz;
    continue;
   }
   const untimed=line.match(UNTYPED_DAYPART);
   if(untimed&&!untimed[2]){
    pendingDaypart={value:daypartValue(untimed[1]),line,page};
    continue;
   }
   let item=readItem(line,!!current);
   if(pendingDaypart){
    // A PDF table may place "Tarda, sense hora exacta" in one column
    // and the title on the next line. Only the immediate next safe line is used.
    if(!item&&!ADMIN.test(line)&&!HEADER.test(line)&&!tz&&
       !/^(?:observaci[oó]|nota\s+de|important|hora\s*\/\s*franja|activitat\s+i\s+lloc)\b/i.test(line)){
      const title=cleanTitle(line);
      if(title&&/\p{L}/u.test(title)&&title.length<=200)item={title,daypart:pendingDaypart.value,confidence:'medium'};
    }
    pendingDaypart=null;
   }
   if(item){
    const dateContext=current?{date:current.date,evidence:current.evidence,page:current.page,confidence:current.confidence}:null;
    const dateForItem=explicitNextMorningDate(line,item.start,dateContext)||dateContext;
    if(dateForItem!==dateContext)warnings.add('Una activitat de matinada indica explícitament el dia següent: comprova-la.');
    candidates.push(makeCandidate(item,line,page,dateForItem,
      tz&&!tz.invalid?tz:current?.zone,candidates.length));
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
// Read a literal, named first stop only. This is NOT a verified map position;
// the routing service must still resolve it in the destination context.
function mentionedPlace(title){
 if(/^(?:sortida|arribada|trasllat|transfer|vol|flight|tren|taxi|bus|metro)\b/i.test(title))return null;
 const raw=title.match(/\b(?:Piazza|Plaça|Plaza|Square|Tower|Eye|Gallery|Abbey|Bridge|Theatre|Via|Carrer|Street|Trattoria|Ristorante|Restaurant|Caffè|Cafè|Café|Museu|Museum|Catedral|Cathedral|Castell|Castle|Basílica|Basilica|Torre|Mercat|Market|Parc|Park|Palau|Palazzo|Finestrella|Archiginnasio|Quadrilatero|Due Torri)(?=\s|$|[.,;])(?:\s+[\p{L}’'-]+){0,7}/iu)?.[0];
 if(!raw)return null;
 const leading=title.replace(/^(?:(?:visita|visit)(?:\s+(?:a|al|el|la|to|the))?\s+|opcional:\s*)/i,'').trim().replace(/[.,;]+$/,'');
 const named=raw&&leading.endsWith(raw)&&!/^(?:passeig|aperitiu|sopar|esmorzar|dinar|opcional)\b/i.test(leading)?leading:raw||leading;
 if(/^(?:dinar|sopar|esmorzar|passeig|lunch|dinner|breakfast|free time)\b/i.test(named))return null;
 const place=named.split(/\s+i\s+(?=(?:visita|retorn|dinar|passeig|sopar|esmorzar|zona|barri)\b|[A-ZÀ-Ü])/i)[0]
  .split(/\s*[,.·;()]\s*/)[0].trim();
 if(place.length<6||place.length>160)return null;
 // Generic words alone cannot become locations.
 if(/^(?:museu|museum|mercat|market|restaurant|parc|park|torre|via|carrer|piazza|plaça|plaza|castell)$/i.test(place))return null;
 return place;
}
function makeCandidate(item,line,page,date,zone,sourceOrder){
 const fields={title:makeField(item.title,line,page,item.confidence)};
 const place=mentionedPlace(item.title);
 if(place)fields.location_name=makeField(place,line,page,'medium');
 if(date)fields.local_date=makeField(date.date,date.evidence,date.page,date.confidence||'high');
 if(item.start)fields.start_local_time=makeField(item.start,line,page);
 if(item.end)fields.end_local_time=makeField(item.end,line,page);
 if(item.daypart)fields.daypart=makeField(item.daypart,line,page);
 if(zone)fields.time_zone=makeField(zone.value,zone.evidence,zone.page);
 const warnings=[];
 if(item.confidence==='medium')warnings.push('Element sense hora explícita: revisa’n la classificació.');
 if(date?.confidence==='medium')warnings.push('Any agafat del títol general del document: comprova la data.');
 if(!date)warnings.push('Falta la data de l’activitat.');
 return {source_order:sourceOrder,classification_hint:hintFromTitle(item.title),fields,warnings};
}
export function extractItineraryProposalFromText(rawText,source={kind:'manual'}){
 if(typeof rawText!=='string')fail('Text d’itinerari invàlid.');
 return extractItineraryProposalFromPages([{page:1,text:rawText}],source);
}

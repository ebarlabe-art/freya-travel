import {normalizeImportProposal} from './import-proposal.mjs';

const evidence=(excerpt,confidence='high')=>({confidence,evidence:[{kind:'text',excerpt}]});
const field=(value,excerpt,confidence='high')=>({value,...evidence(excerpt,confidence)});
const clean=value=>String(value??'').replace(/\r/g,'').trim();
const lineList=text=>clean(text).split('\n').map(v=>v.trim()).filter(Boolean);
const firstMatch=(text,patterns)=>{
  for(const pattern of patterns){
    const match=text.match(pattern);
    if(match)return {value:match[1].trim(),excerpt:match[0].trim()};
  }
  return null;
};
const bookingRef=text=>firstMatch(text,[
  /(?:booking|reservation|confirmation|reference|ref(?:erence)?|localitzador|reserva)\s*(?:number|no\.?|n[uú]m(?:ero)?|code|codi|#|:)\s*[:#-]?\s*([A-Z0-9-]{5,20})/i,
  /(?:PNR|record locator)\s*[:#-]?\s*([A-Z0-9]{5,10})/i
]);
const isoDate=value=>{
  const m=value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  const d=value.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/);
  return d?`${d[3]}-${d[2].padStart(2,'0')}-${d[1].padStart(2,'0')}`:null;
};
const dateMatch=(text,labels)=>{
  for(const label of labels){
    const re=new RegExp(`(?:${label})\\s*[:\\-]?\\s*([^\\n]{0,80})`,'i');
    const m=text.match(re);
    if(m){
      const value=isoDate(m[1]);
      if(value)return {value,excerpt:m[0].trim()};
    }
  }
  return null;
};
const detectType=text=>{
  const scores={
    flight:[/\bflight\b/i,/\bvol\b/i,/boarding/i,/\b[A-Z]{2}\s?\d{2,4}\b/,/departure|arrival|sortida|arribada/i],
    accommodation:[/hotel|hostel|apartment|apartament|resort|accommodation|allotjament/i,/check[ -]?in/i,/check[ -]?out/i],
    activity:[/ticket|entrada|activity|activitat|tour|excursion|excursi[oó]|museum|museu/i,/admission|meeting point|punt de trobada/i],
    car_rental:[/car rental|rent a car|vehicle rental|lloguer de cotxe|lloguer de vehicle/i,/pick[ -]?up|recollida/i,/drop[ -]?off|return location|devoluci[oó]/i]
  };
  const ranked=Object.entries(scores).map(([type,patterns])=>[type,patterns.reduce((n,p)=>n+(p.test(text)?1:0),0)]).sort((a,b)=>b[1]-a[1]);
  if(ranked[0][1]===0||ranked[0][1]===ranked[1][1])return null;
  return ranked[0][0];
};
const sourceOf=source=>({
  kind:source?.kind||'document',
  ...(source?.document_id?{document_id:source.document_id}:{}),
  ...(source?.file_name?{file_name:source.file_name}:{}),
  ...(source?.mime_type?{mime_type:source.mime_type}:{})
});
function flightFields(text){
  const fields={};
  const number=firstMatch(text,[/(?:flight|vol)\s*(?:number|no\.?|n[uú]m(?:ero)?|#|:)\s*[:#-]?\s*([A-Z0-9]{2,3}\s?\d{1,4})/i,/\b([A-Z]{2}\s?\d{2,4})\b/]);
  if(number)fields.flight_number=field(number.value.toUpperCase().replace(/\s+/g,''),number.excerpt);
  const ref=bookingRef(text);if(ref)fields.booking_reference=field(ref.value.toUpperCase(),ref.excerpt);
  const airline=firstMatch(text,[/(?:airline|company|aerol[ií]nia)\s*[:\-]\s*([^\n]{2,80})/i]);
  if(airline)fields.airline=field(airline.value,airline.excerpt,'medium');
  return fields;
}
function accommodationFields(text){
  const fields={};
  const name=firstMatch(text,[/(?:hotel|property|allotjament)\s*[:\-]\s*([^\n]{2,160})/i]);
  if(name)fields.name=field(name.value,name.excerpt);
  const ref=bookingRef(text);if(ref)fields.booking_reference=field(ref.value.toUpperCase(),ref.excerpt);
  const provider=firstMatch(text,[/(?:provider|booking provider|prove[iï]dor)\s*[:\-]\s*([^\n]{2,80})/i]);
  if(provider)fields.booking_provider=field(provider.value,provider.excerpt,'medium');
  return fields;
}
function activityFields(text){
  const fields={};
  const title=firstMatch(text,[/(?:activity|activitat|tour|event|esdeveniment)\s*[:\-]\s*([^\n]{2,160})/i]);
  if(title)fields.title=field(title.value,title.excerpt);
  const ref=bookingRef(text);if(ref)fields.booking_reference=field(ref.value.toUpperCase(),ref.excerpt);
  const provider=firstMatch(text,[/(?:provider|operator|prove[iï]dor)\s*[:\-]\s*([^\n]{2,80})/i]);
  if(provider)fields.provider=field(provider.value,provider.excerpt,'medium');
  return fields;
}
function carRentalFields(text){
  const fields={};
  const provider=firstMatch(text,[/(?:provider|rental company|company|prove[iï]dor)\s*[:\-]\s*([^\n]{2,100})/i]);
  if(provider)fields.provider=field(provider.value,provider.excerpt);
  const ref=bookingRef(text);if(ref)fields.booking_reference=field(ref.value.toUpperCase(),ref.excerpt);
  const pickup=firstMatch(text,[/(?:pick[ -]?up location|recollida)\s*[:\-]\s*([^\n]{2,200})/i]);
  if(pickup)fields.pickup_location=field(pickup.value,pickup.excerpt);
  const ret=firstMatch(text,[/(?:return location|drop[ -]?off|devoluci[oó])\s*[:\-]\s*([^\n]{2,200})/i]);
  if(ret)fields.return_location=field(ret.value,ret.excerpt);
  return fields;
}
export function extractImportProposalFromText(rawText,source={}){
  const text=clean(rawText);
  if(text.length<12)throw Object.assign(new Error('No hi ha prou text per interpretar la reserva.'),{code:'insufficient_import_text'});
  const target_type=detectType(text);
  if(!target_type)throw Object.assign(new Error('No puc identificar amb prou seguretat quin tipus de reserva és.'),{code:'ambiguous_import_type'});
  const builders={flight:flightFields,accommodation:accommodationFields,activity:activityFields,car_rental:carRentalFields};
  const fields=builders[target_type](text);
  const warnings=[];
  if(Object.keys(fields).length===0)warnings.push('S’ha identificat el tipus de reserva, però no hi ha camps prou explícits per proposar.');
  const required={
    flight:['flight_number'],
    accommodation:['name'],
    activity:['title'],
    car_rental:['provider']
  };
  const missing_required=required[target_type].filter(name=>!fields[name]);
  if(Object.keys(fields).length===0){
    // The A2.1 contract deliberately rejects empty proposals. Surface this as an extraction error instead.
    throw Object.assign(new Error('He identificat el tipus de reserva, però no puc acreditar cap dada operativa.'),{code:'no_import_fields'});
  }
  return normalizeImportProposal({
    schema_version:1,
    source:sourceOf(source),
    target_type,
    fields,
    missing_required,
    warnings
  });
}

export function classifyImportText(rawText){
  const text=clean(rawText);
  return {target_type:text?detectType(text):null,line_count:lineList(text).length};
}

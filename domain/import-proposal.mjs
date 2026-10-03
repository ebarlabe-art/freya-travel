const confidenceLevels=new Set(['high','medium','low']);
const sourceKinds=new Set(['document','screenshot','email','manual']);
const targetFields={
  flight:new Set([
    'airline','flight_number','departure_airport_code','departure_airport_name','departure_city','departure_at','departure_time_zone',
    'arrival_airport_code','arrival_airport_name','arrival_city','arrival_at','arrival_time_zone','booking_reference',
    'departure_terminal','arrival_terminal','seat','baggage','passengers','flight_status','notes'
  ]),
  accommodation:new Set([
    'accommodation_type','name','address','location_text','city','postal_code','region','country','latitude','longitude','check_in_at','check_out_at','time_zone',
    'booking_reference','booking_provider','reservation_status','phone','email','website_url','room_number','notes'
  ]),
  activity:new Set([
    'title','activity_type','start_at','end_at','time_zone','venue_name','address','city','latitude','longitude',
    'reservation_status','booking_reference','provider','contact_phone','contact_email','website_url','people_count',
    'amount','currency','notes'
  ]),
  local_transport:new Set([
    'title','transport_mode','start_at','time_zone','end_at','transport_arrival_time_zone',
    'transport_origin_name','transport_origin_address','transport_origin_city',
    'transport_destination_name','transport_destination_address','transport_destination_city',
    'reservation_status','booking_reference','provider','transport_service_number','transport_seat','transport_platform',
    'contact_phone','contact_email','website_url','people_count','notes'
  ]),
  car_rental:new Set([
    'provider','booking_reference','pickup_location','pickup_city','pickup_at','pickup_time_zone','return_location','return_city',
    'return_at','return_time_zone','vehicle_class','vehicle_model','license_plate','transmission','fuel_policy','pickup_fuel_level',
    'return_fuel_level','pickup_mileage','return_mileage','insurance','excess_amount','excess_currency','deposit_amount',
    'deposit_currency','phone','email','website_url','reservation_status','notes'
  ])
};
const forbiddenFields=new Set([
  'id','trip_id','created_by','updated_by','created_at','updated_at','document_id','source_document_id'
]);

function fail(message,code='invalid_import_proposal'){
  throw Object.assign(new Error(message),{code});
}
function plainObject(value){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
}
function assertShortText(value,label,max){
  if(typeof value!=='string'||!value.trim()||[...value].length>max)fail(`${label} invàlid.`);
  return value.trim();
}
function normalizeEvidence(value){
  if(!Array.isArray(value)||value.length===0||value.length>12)fail('L’evidència del camp és invàlida.');
  return value.map((item,index)=>{
    if(!plainObject(item))fail(`Evidència ${index+1} invàlida.`);
    const allowed=new Set(['kind','excerpt','page']);
    if(Object.keys(item).some(key=>!allowed.has(key)))fail('L’evidència conté camps no admesos.');
    if(!['text','visual','metadata'].includes(item.kind))fail('Tipus d’evidència no admès.');
    const out={kind:item.kind};
    if(item.excerpt!==undefined)out.excerpt=assertShortText(item.excerpt,'Fragment d’evidència',500);
    if(item.page!==undefined){
      if(!Number.isInteger(item.page)||item.page<1||item.page>10000)fail('Pàgina d’evidència invàlida.');
      out.page=item.page;
    }
    return out;
  });
}
function normalizeScalar(value){
  if(typeof value==='string'){
    if(!value.trim()||[...value].length>4000)fail('Valor extret invàlid.');
    return value.trim();
  }
  if(typeof value==='number'){
    if(!Number.isFinite(value))fail('Valor numèric invàlid.');
    return value;
  }
  if(typeof value==='boolean')return value;
  fail('Els camps extrets han de ser valors simples.');
}
function normalizeField(name,value){
  if(!plainObject(value))fail(`Camp ${name} invàlid.`);
  const allowed=new Set(['value','confidence','evidence']);
  if(Object.keys(value).some(key=>!allowed.has(key)))fail(`Camp ${name} conté propietats no admeses.`);
  if(!Object.hasOwn(value,'value'))fail(`Falta el valor del camp ${name}.`);
  if(!confidenceLevels.has(value.confidence))fail(`Confiança invàlida al camp ${name}.`);
  return {
    value:normalizeScalar(value.value),
    confidence:value.confidence,
    evidence:normalizeEvidence(value.evidence)
  };
}
export function normalizeImportProposal(input){
  if(!plainObject(input))fail('Proposta d’importació invàlida.');
  const allowedRoot=new Set(['schema_version','source','target_type','fields','missing_required','warnings']);
  if(Object.keys(input).some(key=>!allowedRoot.has(key)))fail('La proposta conté camps arrel no admesos.');
  if(input.schema_version!==1)fail('Versió de proposta no suportada.','unsupported_import_schema');
  if(!plainObject(input.source))fail('Origen d’importació invàlid.');
  const allowedSource=new Set(['kind','document_id','file_name','mime_type']);
  if(Object.keys(input.source).some(key=>!allowedSource.has(key)))fail('L’origen conté camps no admesos.');
  if(!sourceKinds.has(input.source.kind))fail('Tipus d’origen no suportat.');
  const source={kind:input.source.kind};
  if(input.source.document_id!==undefined)source.document_id=assertShortText(input.source.document_id,'document_id',100);
  if(input.source.file_name!==undefined)source.file_name=assertShortText(input.source.file_name,'Nom de fitxer',500);
  if(input.source.mime_type!==undefined)source.mime_type=assertShortText(input.source.mime_type,'MIME type',200);
  if(input.source.kind==='document'&&!source.document_id)fail('Una importació documental ha de referenciar un document existent.');

  if(!Object.hasOwn(targetFields,input.target_type))fail('Tipus de peça no suportat.');
  if(!plainObject(input.fields))fail('Els camps extrets han de ser un objecte.');
  const allowed=targetFields[input.target_type];
  const fields={};
  for(const [name,value] of Object.entries(input.fields)){
    if(forbiddenFields.has(name)||!allowed.has(name))fail(`El camp ${name} no es pot proposar per a ${input.target_type}.`,'forbidden_import_field');
    fields[name]=normalizeField(name,value);
  }
  if(Object.keys(fields).length===0)fail('La proposta ha de contenir almenys un camp extret.');

  const normalizeList=(value,label)=>{
    if(value===undefined)return [];
    if(!Array.isArray(value)||value.length>50)fail(`${label} invàlid.`);
    return [...new Set(value.map(item=>assertShortText(item,label,300)))];
  };

  return {
    schema_version:1,
    source,
    target_type:input.target_type,
    fields,
    missing_required:normalizeList(input.missing_required,'Camp pendent'),
    warnings:normalizeList(input.warnings,'Avís')
  };
}

export function importProposalSummary(proposal){
  const p=normalizeImportProposal(proposal);
  const confidences=Object.values(p.fields).map(field=>field.confidence);
  return {
    target_type:p.target_type,
    field_count:confidences.length,
    low_confidence_count:confidences.filter(value=>value==='low').length,
    medium_confidence_count:confidences.filter(value=>value==='medium').length,
    high_confidence_count:confidences.filter(value=>value==='high').length,
    needs_attention:p.missing_required.length>0||p.warnings.length>0||confidences.some(value=>value!=='high')
  };
}

export function importProposalCanWrite(){
  return false;
}

export const importTargetFields=Object.freeze(Object.fromEntries(
  Object.entries(targetFields).map(([type,fields])=>[type,Object.freeze([...fields])])
));

// TB-04 Candidate boundary. No provider/model names or factual authority here.
const object = properties => ({type:'object', properties, required:Object.keys(properties), additionalProperties:false});
const text = maxLength => ({type:'string', minLength:1, maxLength});
const id = {type:'string', pattern:'^[a-z][a-z0-9_-]{0,63}$'};
const array = (items, minItems, maxItems) => ({type:'array', items, minItems, maxItems});
const nullable = schema => ({anyOf:[schema,{type:'null'}]});
const refs = array(id,0,100);
const date = nullable({type:'string',pattern:'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'});
const nights = nullable({type:'integer',minimum:1,maximum:730});
const stop = object({id, destination:text(120), nights, start_date:date, end_date:date});
const leg = object({id, from_stop_id:id, to_stop_id:id, mode:nullable(text(80)), transit_nights:nullable({type:'integer',minimum:0,maximum:730})});
const component = object({id, kind:{type:'string',enum:['transport','accommodation','experience']}, subject_id:id, description:text(600), claim_ids:refs});
const claim = object({id, subject_id:id, statement:text(600), decision_ids:refs, verification_needed:text(600)});
const block = object({id, title:text(120), suggestion:text(600), decision_ids:refs, component_ids:refs, claim_ids:refs});
const reason = object({decision_id:id, explanation:text(600), claim_ids:refs});
const tradeoff = object({description:text(600), decision_ids:refs});
export const candidateSchema = object({
  title:text(120), summary:text(600),
  route:object({stops:array(stop,1,20),legs:array(leg,0,19)}),
  components:array(component,0,40),
  experience_blocks:array(block,3,5),
  reasons:array(reason,0,200), tradeoffs:array(tradeoff,0,30),
  claims:array(claim,0,100),
  scope_bindings:array(object({scope_id:id,subject_ids:array(id,1,60)}),0,50),
});
export const candidateBatchSchema = object({candidates:array(candidateSchema,0,3)});

export class ProposalError extends Error {
  constructor(code) { super(code); this.name='ProposalError'; this.code=code; }
}
// Diagnostics are opt-in and contain only fixed rules and schema-owned paths.
// Never include received values, user IDs, unknown property names or provider text.
const messages = {
  unsupported_keyword:'Unsupported schema keyword.', type:'Unexpected value type.',
  additionalProperties:'Unexpected property (name omitted).', required:'Required property missing.',
  minItems:'Too few items.', maxItems:'Too many items.', minLength:'Text too short.',
  maxLength:'Text too long.', nonblank:'Text must not be blank.', pattern:'Text does not match required pattern.',
  integer:'Expected a safe integer.', minimum:'Number below minimum.', maximum:'Number above maximum.',
  enum:'Value not in allowed enumeration.', anyOf:'No permitted schema alternative matched.',
  batch_bytes:'Batch exceeds 192 KiB.', candidate_bytes:'Candidate exceeds 64 KiB.',
  unique_ids:'IDs must be unique within a candidate across all entity types.',
  unique_references:'Reference list contains duplicates.', reference_exists:'Referenced entity does not exist in the required namespace.',
  leg_count:'There must be one leg between each consecutive pair of stops.',
  leg_from:'Leg origin must match the preceding stop.', leg_to:'Leg destination must match the following stop.',
  date_pair:'Both dates must be present or both null.', calendar_date:'Date is not a valid calendar date.',
  date_order:'End date must be after start date.', calendar_nights:'Nights must equal the stop calendar-date interval.',
  unique_scope:'Scope may only be bound once.', brief_shape:'Brief decisions and scopes are required.',
};
function fail(options,stage,path,rule,code=rule) {
  const error=new ProposalError(stage==='brief'?'invalid_brief':'invalid_candidate');
  if(options.diagnostics===true)error.diagnostic=Object.freeze({stage,path,code,message:messages[rule],rule});
  throw error;
}
const supported=new Set(['type','properties','required','additionalProperties','items','minItems','maxItems','minLength','maxLength','pattern','minimum','maximum','enum','anyOf']);
function shape(value,schema,options,path) {
  const reject=(rule,code)=>fail(options,'schema',path,rule,code);
  if(Object.keys(schema).some(key=>!supported.has(key)))reject('unsupported_keyword');
  if(schema.anyOf) {
    // Nullable unions retain the precise failing string/integer rule instead of
    // swallowing it in a generic anyOf error. Acceptance remains unchanged.
    const matching=schema.anyOf.filter(option=>option.type===(value===null?'null':Number.isInteger(value)?'integer':typeof value));
    if(matching.length===1){shape(value,matching[0],options,path);return;}
    if(!schema.anyOf.some(option=>{try{shape(value,option,{},path);return true}catch{return false}}))reject('anyOf');
    return;
  }
  const type=schema.type;
  if(type==='null') {if(value!==null)reject('type');return;}
  if(type==='object') {
    if(!value||typeof value!=='object'||Array.isArray(value))reject('type');
    if(Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key)))reject('additionalProperties','unexpected_property');
    for(const key of schema.required)if(!Object.hasOwn(value,key))fail(options,'schema',path+'/'+key,'required');
    for(const [key,child] of Object.entries(schema.properties))shape(value[key],child,options,path+'/'+key);
  } else if(type==='array') {
    if(!Array.isArray(value))reject('type');
    if(value.length<schema.minItems)reject('minItems');
    if(value.length>schema.maxItems)reject('maxItems');
    value.forEach((item,index)=>shape(item,schema.items,options,path+'/'+index));
  } else if(type==='string') {
    if(typeof value!=='string')reject('type');
    if(!value.trim())reject('nonblank');
    if([...value].length<(schema.minLength??0))reject('minLength');
    if([...value].length>(schema.maxLength??Infinity))reject('maxLength');
    if(schema.pattern&&!new RegExp(schema.pattern).test(value))reject('pattern');
  } else if(type==='integer') {
    if(!Number.isSafeInteger(value))reject('integer');
    if(value<schema.minimum)reject('minimum');
    if(value>schema.maximum)reject('maximum');
  } else reject('type');
  if(schema.enum&&!schema.enum.includes(value))reject('enum');
}
export function assertCandidateShape(value,schema=candidateBatchSchema,options={}) {
  shape(value,schema,options,'');
}

export function validateCandidateBatch(batch,brief,options={}) {
  const reject=(path,rule,stage='invariant')=>fail(options,stage,path,rule);
  if(new TextEncoder().encode(JSON.stringify(batch)).length>192*1024)reject('','batch_bytes','limit');
  assertCandidateShape(batch,candidateBatchSchema,options);
  if(!brief?.decisions||!brief?.scopes)reject('','brief_shape','brief');
  const decisionIds=new Set(Object.keys(brief.decisions));
  for(const [ci,candidate] of batch.candidates.entries()) {
    const base='/candidates/'+ci;
    if(new TextEncoder().encode(JSON.stringify(candidate)).length>64*1024)reject(base,'candidate_bytes','limit');
    const {stops,legs}=candidate.route;
    const groups=[['route/stops',stops],['route/legs',legs],['components',candidate.components],['experience_blocks',candidate.experience_blocks],['claims',candidate.claims]];
    const ids=new Set();
    for(const [group,items] of groups)items.forEach((item,index)=>{
      if(ids.has(item.id))reject(base+'/'+group+'/'+index+'/id','unique_ids');ids.add(item.id);
    });
    const subjects=new Set([...stops,...legs,...candidate.components].map(item=>item.id));
    const routeSubjects=new Set([...stops,...legs].map(item=>item.id));
    const claims=new Set(candidate.claims.map(item=>item.id));
    const components=new Set(candidate.components.map(item=>item.id));
    const reference=(value,allowed,path)=>{if(!allowed.has(value))reject(path,'reference_exists')};
    const check=(values,allowed,path)=>{
      const seen=new Set();values.forEach((value,index)=>{
        if(seen.has(value))reject(path+'/'+index,'unique_references');seen.add(value);
        reference(value,allowed,path+'/'+index);
      });
    };
    if(legs.length!==stops.length-1)reject(base+'/route/legs','leg_count');
    legs.forEach((leg,index)=>{
      if(leg.from_stop_id!==stops[index].id)reject(base+'/route/legs/'+index+'/from_stop_id','leg_from');
      if(leg.to_stop_id!==stops[index+1].id)reject(base+'/route/legs/'+index+'/to_stop_id','leg_to');
    });
    stops.forEach((stop,index)=>{
      const path=base+'/route/stops/'+index;
      if((stop.start_date===null)!==(stop.end_date===null))reject(path,'date_pair');
      for(const key of ['start_date','end_date'])if(stop[key]!==null) {
        const parsed=new Date(stop[key]+'T00:00:00Z');
        if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==stop[key])reject(path+'/'+key,'calendar_date');
      }
      if(stop.start_date!==null) {
        if(stop.end_date<=stop.start_date)reject(path+'/end_date','date_order');
        const calendarNights=(Date.parse(stop.end_date)-Date.parse(stop.start_date))/86400000;
        if(stop.nights!==null&&stop.nights!==calendarNights)reject(path+'/nights','calendar_nights');
      }
    });
    candidate.components.forEach((item,i)=>{const p=base+'/components/'+i;reference(item.subject_id,routeSubjects,p+'/subject_id');check(item.claim_ids,claims,p+'/claim_ids')});
    candidate.claims.forEach((item,i)=>{const p=base+'/claims/'+i;reference(item.subject_id,subjects,p+'/subject_id');check(item.decision_ids,decisionIds,p+'/decision_ids')});
    candidate.experience_blocks.forEach((item,i)=>{const p=base+'/experience_blocks/'+i;check(item.decision_ids,decisionIds,p+'/decision_ids');check(item.component_ids,components,p+'/component_ids');check(item.claim_ids,claims,p+'/claim_ids')});
    candidate.reasons.forEach((item,i)=>{const p=base+'/reasons/'+i;reference(item.decision_id,decisionIds,p+'/decision_id');check(item.claim_ids,claims,p+'/claim_ids')});
    candidate.tradeoffs.forEach((item,i)=>check(item.decision_ids,decisionIds,base+'/tradeoffs/'+i+'/decision_ids'));
    const bound=new Set();
    candidate.scope_bindings.forEach((binding,i)=>{
      const p=base+'/scope_bindings/'+i;
      if(!Object.hasOwn(brief.scopes,binding.scope_id))reject(p+'/scope_id','reference_exists');
      if(bound.has(binding.scope_id))reject(p+'/scope_id','unique_scope');
      bound.add(binding.scope_id);check(binding.subject_ids,subjects,p+'/subject_ids');
    });
  }
  return structuredClone(batch);
}

// Persistent output contract is separate from untrusted Candidate input.
const enumText=(...values)=>({type:'string',enum:values});
export const proposalDocumentSchema=object({
 schema_version:{type:'integer',enum:[1]},candidate:candidateSchema,
 evaluations:array(object({decision_id:id,field:text(100),scope:id,strength:nullable(enumText('hard','preference','flexible')),knowledge:enumText('known','unknown','indifferent'),state:enumText('satisfied','unresolved','violated'),reason:text(100)}),0,200),
 verification:array(object({claim_id:id,certainty:enumText('confirmed','provider_available','probable','pending_verification'),reason:text(100),evidence:array(object({source:text(200),locator:text(2000),observed_at:text(40),valid_until:text(40)}),0,10)}),0,100),
});

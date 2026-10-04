// ALB-02 schema is library-independent. SQL freezes this literal and tests parity.
const obj = properties => ({type:'object', properties, required:Object.keys(properties), additionalProperties:false});
const uuid = {type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'};
const num = {type:'number',minimum:-1000000,maximum:1000000};
const positive = {type:'number',exclusiveMinimum:0,maximum:1000000};
const nullable = rule => ({anyOf:[rule,{type:'null'}]});
const geometry = obj({x:num,y:num,width:positive,height:positive,rotation:{type:'number',minimum:-360,maximum:360}});
const locks = obj({content:{type:'boolean'},geometry:{type:'boolean'}});
const shared = {id:uuid,geometry,locks};
export const compositionSchemaV1 = obj({
  schema_version:{const:1},composition_id:uuid,kind:{enum:['page','spread']},
  page_ids:{type:'array',items:uuid,minItems:1,maxItems:2,uniqueItems:true},
  canvas:obj({unit:{const:'mm'},width:nullable(positive),height:nullable(positive)}),
  elements:{type:'array',maxItems:200,items:{oneOf:[
    obj({...shared,type:{const:'text'},role:{enum:['title','body','caption']},text:{type:'string',maxLength:16000},source_snapshot_ids:{type:'array',items:uuid,maxItems:20,uniqueItems:true}}),
    obj({...shared,type:{const:'image'},asset_id:uuid,crop:obj({x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1},width:{type:'number',exclusiveMinimum:0,maximum:1},height:{type:'number',exclusiveMinimum:0,maximum:1}})})
  ]}},
  locks:obj({layout:{type:'boolean'}}),metadata:obj({label:nullable({type:'string',maxLength:160})})
});
export const limits = Object.freeze({compositionBytes:262144,requestBytes:1048576,snapshotBytes:32768});
export function matchesSchema(schema,value) {
  if(schema.oneOf && schema.oneOf.filter(s=>matchesSchema(s,value)).length!==1)return false;
  if(schema.anyOf && !schema.anyOf.some(s=>matchesSchema(s,value)))return false;
  if('const' in schema && value!==schema.const)return false;
  if(schema.enum && !schema.enum.includes(value))return false;
  if(schema.type){
    const type=value===null?'null':Array.isArray(value)?'array':typeof value;
    if(type!==schema.type)return false;
  }
  if(typeof value==='number'){
    if(!Number.isFinite(value))return false;
    if(schema.minimum!==undefined&&value<schema.minimum)return false;
    if(schema.maximum!==undefined&&value>schema.maximum)return false;
    if(schema.exclusiveMinimum!==undefined&&value<=schema.exclusiveMinimum)return false;
  }
  if(typeof value==='string'){
    if(schema.maxLength!==undefined&&[...value].length>schema.maxLength)return false;
    if(schema.pattern&&!new RegExp(schema.pattern).test(value))return false;
  }
  if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems)return false;
    if(schema.maxItems!==undefined&&value.length>schema.maxItems)return false;
    if(schema.uniqueItems&&new Set(value.map(v=>JSON.stringify(v))).size!==value.length)return false;
    if(schema.items&&!value.every(v=>matchesSchema(schema.items,v)))return false;
  } else if(value&&typeof value==='object'&&schema.properties){
    if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
    if(schema.required?.some(k=>!Object.hasOwn(value,k)))return false;
    if(Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k)))return false;
    if(Object.entries(value).some(([k,v])=>!matchesSchema(schema.properties[k],v)))return false;
  }
  return true;
}
export function validateComposition(document){
  try{
    if(!matchesSchema(compositionSchemaV1,document))return false;
    if(new TextEncoder().encode(JSON.stringify(document)).length>limits.compositionBytes)return false;
    if(document.page_ids.length!==(document.kind==='page'?1:2))return false;
    const {width,height}=document.canvas;
    if((width===null)!==(height===null)||width===null&&document.elements.length)return false;
    if(new Set(document.elements.map(e=>e.id)).size!==document.elements.length)return false;
    return document.elements.every(e=>e.type!=='image'||e.crop.x+e.crop.width<=1&&e.crop.y+e.crop.height<=1);
  }catch{return false}
}
export function emptyComposition(id,pageIds){
  const document={schema_version:1,composition_id:id,kind:pageIds.length===1?'page':'spread',page_ids:[...pageIds],canvas:{unit:'mm',width:null,height:null},elements:[],locks:{layout:false},metadata:{label:null}};
  if(!validateComposition(document))throw new TypeError('ALB_INVALID_DOCUMENT');
  return document;
}
export function resourceRefs(document){
  if(!validateComposition(document))throw new TypeError('ALB_INVALID_DOCUMENT');
  return document.elements.flatMap(e=>e.type==='image'?[{ref_key:`${e.id}:image`,element_id:e.id,resource_kind:'asset',asset_id:e.asset_id,source_snapshot_id:null,usage:'image'}]:e.source_snapshot_ids.map(id=>({ref_key:`${e.id}:source:${id}`,element_id:e.id,resource_kind:'source_snapshot',asset_id:null,source_snapshot_id:id,usage:'text_source'})));
}

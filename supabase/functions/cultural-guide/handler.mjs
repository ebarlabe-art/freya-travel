// Map only known validator errors to safe diagnostics. Never log model output or source text.
function validationReason(error){
 const reasons=new Map([
  ['La cita no correspon a la font.','quote_not_in_source'],
  ['Falten les fonts de la secció.','missing_evidence'],
  ['Proposta cultural incompleta.','incomplete_sections'],
  ['Secció cultural no vàlida.','invalid_section'],
  ['Font cultural no vàlida.','invalid_source'],
  ['Cita no vàlida.','invalid_citation'],
  ['Fitxa cultural no vàlida.','invalid_document'],
  ['Camps culturals no vàlids.','invalid_fields'],
  ['La font no correspon exactament al lloc.','identity_mismatch'],
  ['El text no és una transcripció de la font.','source_text_mismatch']
 ]);
 return reasons.get(error?.message)||'other';
}
import {culturalPlaces,guidePlaceKey,guideProposal,sourceMatchesPlace,culturalName} from '../../../domain/cultural-guide.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createCulturalGuideHandler({authenticate,readItem,search,readArticle,generate,now=Date.now,diagnose=(_event)=>{}}){
 const counts=new Map(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
 return async request=>{
  if(request.method==='OPTIONS')return reply({});if(request.method!=='POST')return reply({error:'invalid_request'},405);
  let stage='authenticate',requestId=crypto.randomUUID();
  try{
   const auth=request.headers.get('authorization'),user=await authenticate(auth);if(!user)return reply({error:'unauthorized'},401);
   const raw=await request.text();if(raw.length>2000)return reply({error:'invalid_request'},400);
   let data;try{data=JSON.parse(raw)}catch{return reply({error:'invalid_request'},400)}
   if(!data||Object.keys(data).some(k=>!['action','trip_id','source_type','source_id','place_key','language','pageid'].includes(k))||!uuid.test(data.trip_id)||!uuid.test(data.source_id)||!['manual','activity'].includes(data.source_type)||!['search','propose','prepare'].includes(data.action)||!['ca','it','en'].includes(data.language)||typeof data.place_key!=='string'||data.place_key.length>600||data.action==='propose'&&(!Number.isSafeInteger(data.pageid)||data.pageid<1))return reply({error:'invalid_request'},400);
   // Read under the current caller's RLS; the client cannot supply a name, notes or documents.
   stage='read_visit';const row=await readItem(auth,data.trip_id,data.source_type,data.source_id);if(!row)return reply({error:'unavailable'},403);
   const place=culturalPlaces(row).find(p=>guidePlaceKey(p)===data.place_key);if(!place)return reply({error:'place_changed'},409);
   const day=new Date(now()).toISOString().slice(0,10),prior=counts.get(user),count=prior?.day===day?prior.count:0;
   if(count>=30)return reply({error:'rate_limited'},429);if(counts.size>500)for(const [k,v]of counts)if(v.day!==day)counts.delete(k);counts.set(user,{day,count:count+1});
   stage='search';if(data.action==='search')return reply({candidates:(await search(place,data.language)).slice(0,6).map(p=>({pageid:p.pageid,title:p.title,language:data.language}))});
   let article;
   if(data.action==='prepare'){
    const languages=[...new Set([data.language,place.country_code==='IT'?'it':null,'en'].filter(Boolean))];
    for(const language of languages){
     stage='search';const candidates=await search(place,language);
     const exact=candidates.filter(c=>culturalName(c.title)===culturalName(place.canonical_name));
     stage='read_source';const articles=await Promise.all((exact.length?exact:candidates).slice(0,6).map(async c=>{try{return await readArticle(language,c.pageid)}catch(e){if(e?.message==='source_unsuitable')return null;throw e}}));
     const matches=articles.filter(a=>sourceMatchesPlace(place,a));
     if(matches.length>1)return reply({candidates:matches.map(a=>({pageid:a.pageid,title:a.title,language:a.language})),confirmation_required:true});
     if(matches.length===1){article=matches[0];break}
    }
    if(!article)return reply({error:'source_not_found',stage,request_id:requestId},422);
   }else{stage='read_source';article=await readArticle(data.language,data.pageid)}
   if(!sourceMatchesPlace(place,article))return reply({error:'identity_mismatch'},422);
   stage='generate';
   // Only public content reaches the model; no trip/user IDs, source rows or files.
   const sections=await generate({place_name:place.canonical_name,source_title:article.title,source_text:article.extract.slice(0,18000),source_language:article.language});
   stage='validate';return reply({document:guideProposal(place,article,sections)});
  }catch(error){
   const timeout=['TimeoutError','AbortError'].includes(error?.name);
   const code=timeout?(stage==='generate'?'generation_timeout':'source_timeout'):stage==='validate'?'invalid_response':['not_configured','rate_limited','invalid_response','source_unavailable','source_unsuitable','provider_error'].includes(error?.message)?error.message:'provider_error';
   // No raw provider message, source text, JWT, user or visit identifiers in logs.
   diagnose({event:'cultural_guide_failure',request_id:requestId,stage,code,...(stage==='validate'?{validation_reason:validationReason(error)}:{}),...(Number.isInteger(error?.providerStatus)?{provider_status:error.providerStatus}:{})});
   return reply({error:code,stage,request_id:requestId},code==='rate_limited'?429:503);
  }
 };
}

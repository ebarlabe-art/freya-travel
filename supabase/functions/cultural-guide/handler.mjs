import {culturalPlaces,guidePlaceKey,guideProposal,sourceMatchesPlace} from '../../../domain/cultural-guide.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createCulturalGuideHandler({authenticate,readItem,search,readArticle,generate,now=Date.now}){
 const counts=new Map(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
 return async request=>{
  if(request.method==='OPTIONS')return reply({});if(request.method!=='POST')return reply({error:'invalid_request'},405);
  try{
   const auth=request.headers.get('authorization'),user=await authenticate(auth);if(!user)return reply({error:'unauthorized'},401);
   const raw=await request.text();if(raw.length>2000)return reply({error:'invalid_request'},400);
   let data;try{data=JSON.parse(raw)}catch{return reply({error:'invalid_request'},400)}
   if(!data||Object.keys(data).some(k=>!['action','trip_id','source_type','source_id','place_key','language','pageid'].includes(k))||!uuid.test(data.trip_id)||!uuid.test(data.source_id)||!['manual','activity'].includes(data.source_type)||!['search','propose'].includes(data.action)||!['ca','it','en'].includes(data.language)||typeof data.place_key!=='string'||data.place_key.length>600||data.action==='propose'&&(!Number.isSafeInteger(data.pageid)||data.pageid<1))return reply({error:'invalid_request'},400);
   // Read under the current caller's RLS; the client cannot supply a name, notes or documents.
   const row=await readItem(auth,data.trip_id,data.source_type,data.source_id);if(!row)return reply({error:'unavailable'},403);
   const place=culturalPlaces(row).find(p=>guidePlaceKey(p)===data.place_key);if(!place)return reply({error:'place_changed'},409);
   const day=new Date(now()).toISOString().slice(0,10),prior=counts.get(user),count=prior?.day===day?prior.count:0;
   if(count>=30)return reply({error:'rate_limited'},429);if(counts.size>500)for(const [k,v]of counts)if(v.day!==day)counts.delete(k);counts.set(user,{day,count:count+1});
   if(data.action==='search')return reply({candidates:(await search(place,data.language)).slice(0,6).map(p=>({pageid:p.pageid,title:p.title,language:data.language}))});
   const article=await readArticle(data.language,data.pageid);if(!sourceMatchesPlace(place,article))return reply({error:'identity_mismatch'},422);
   // Only the public article is passed to the model. No trip/user IDs, source rows or files.
   const sections=await generate({place_name:place.canonical_name,source_title:article.title,source_text:article.extract.slice(0,18000),source_language:article.language});
   return reply({document:guideProposal(place,article,sections)});
  }catch(error){const code=['not_configured','rate_limited','invalid_response','source_unavailable'].includes(error?.message)?error.message:'provider_error';return reply({error:code},code==='rate_limited'?429:503)}
 };
}
